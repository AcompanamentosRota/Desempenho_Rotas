"""
caderno.py — Pré-venda do último dia útil fechado e mês anterior INTEIRO: as chaves opcionais PRE_VENDA e
MES_ANT_CHEIO do payload (Caderno de Vendas, Frente 2; decisões da Karen de 19/11/2026).

Nenhuma tela lê estas chaves nesta etapa: o front as ignora, como já ignora `negHoje`. Elas existem para o
Caderno por gerência e supervisão (colunas "Pré-venda" e "Real do mês anterior").

As duas ARMADILHAS desta etapa, que o código trata de propósito:

  1. **A data é a do payload, nunca a do relógio.** A pré-venda é do último dia útil FECHADO, que é o
     `DATA_ONTEM` do próprio payload (`Calendario.data_ontem`), a mesma data do Painel de Ritmo. Um
     deslocamento de um dia pelo calendário devolveria domingo numa segunda-feira e o feriado no dia
     seguinte a um feriado, e o Caderno sairia zerado em ~5 dias por mês.
  2. **A pré-venda de cobertura é "quem COMPROU o item naquele dia"**, não "quem ENTROU na cobertura naquele
     dia": um cliente que já tinha comprado o item antes no mês conta de novo aqui. A conta é a mesma da
     cobertura do mês (FX_COBERTURA_REALIZADO > 0, sem NF cancelada, KS TT só nos 4 segmentos foco), só que
     com `DATA_MOVIMENTO = <dia>` no $filter.

Regra de rota, DIFERENTE de propósito entre volume e cobertura:

  - **volume** (os 5 macros + Del Valle Frut, `FX_VOL_PADRAO_FAT` com `NF_STATUS` em M.STATUS_NF_REAL): pela
    **rota da meta** (`CD_ROTA_Chave_Meta_SAP`), como a Neg Restante e a meta do dia. Venda sem chave de meta
    fica fora (como o SAC, `fontes.sem_rota_da_meta`); venda cuja rota da meta é uma EV* entra na rota oculta
    "{GC}-EV" da gerência comercial do cliente.
  - **cobertura** (os 13 itens do ICS GC e dos Novos Negócios + as 3 chaves INC): pela **rota em que a venda
    foi faturada** (`CD_ROTA_Clien`), como a cobertura do mês; as EV* na rota oculta da gerência comercial.
  - **MES_ANT_CHEIO** segue, no volume, a MESMA regra da chave MES_ANTERIOR (rota ATUAL do cliente,
    `CD_ROTA_Clien`, com as EV* na rota oculta), para que as duas colunas do Caderno sejam comparáveis entre
    si — e não a rota da meta da pré-venda.

`MES_ANTERIOR` não muda em nada: aquela chave vai só até o mesmo dia útil (`mes_anterior.filtro_ate`) e a
Evolução da Executiva depende dela. O mês anterior INTEIRO é um valor novo, a mais.

As quatro consultas rodam em threads DAEMON (nunca ThreadPoolExecutor, que segura o fim do processo) junto
com as do mês, com limite próprio (`M.CADERNO_LIMITE_S`). Falha, estouro de tempo, Real negativo ou valor não
finito: a chave fica FORA do payload, com aviso no log, e a rodada segue — nunca um número pela metade e
nunca outra conta no lugar. Os dois blocos são independentes: a pré-venda pode entrar sem o mês anterior
inteiro e vice-versa; dentro de um bloco, volume e cobertura andam juntos.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Callable

from . import calendario as calmod
from . import fontes, modelo
from . import mapeamento as M
from .consulta import Consulta, e, eq, ou
from .mes_anterior import _linhas, _paralelo, corte_mes_anterior
from .texto import inteiro, limpar, numero
from .tipos import Calendario

log = logging.getLogger(__name__)

CM = M.ColMeta
VOL = M.INDICADORES_CADERNO_VOL      # 5 macros + Del Valle Frut
COB = M.INDICADORES_CADERNO_COB      # 13 do ICS GC / Novos Negócios + 3 chaves INC


# ------------------------------------------------------------------ consultas
def consulta_volume(cons: Consulta, anomes: str, gcs: list[str], col_rota: str, dia: date | None = None,
                    rota: str | None = None) -> list[dict]:
    """Vol Real por rota x agrupador x NF_STATUS, agregado no servidor (sem cliente e sem dia), com os filtros do Vol
    Real do gerador (6 agrupadores de volume, FILTRO_PEDIDOS_ONLINE) e, com `dia`, `DATA_MOVIMENTO eq dia`.

    `col_rota` = CM.META_ROTA (pré-venda) ou CM.ROTA (mês anterior inteiro). A gerência comercial vem junto nos dois
    casos (rota oculta das EV*); pela rota do cliente vem também a rota da meta (vendas EV* sem chave de meta).
    A data só entra no $filter, NUNCA no groupby (por dia seriam ~25 mil linhas e ~150 s por medida).
    """
    opcionais = [CM.GC_COMERCIAL] + ([CM.META_ROTA] if col_rota != CM.META_ROTA else [])
    sel = fontes._colunas(cons, M.OBJ_META, [col_rota, CM.AGRUPADOR, CM.NF_STATUS, CM.VOL_MES], opcionais)
    filtro = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, M.AGRUPADORES_CADERNO_VOL), M.FILTRO_PEDIDOS_ONLINE,
               fontes.filtro_hoje(cons, dia) if dia else None, eq(col_rota, rota) if rota else None)
    return _linhas(cons, sel, filtro, gcs, rota)


def consulta_cobertura(cons: Consulta, anomes: str, gcs: list[str], dia: date | None = None,
                       rota: str | None = None) -> list[dict]:
    """Cobertura por rota x cliente x agrupador nos 16 itens, uma consulta por gerência em paralelo (como
    fontes.carregar_vendas: FILTRO_PEDIDOS_ONLINE e FILTRO_SEM_NF_CANCELADA — NF cancelada não é venda) e, com
    `dia`, `DATA_MOVIMENTO eq dia` só no $filter.

    Vai por cliente (e não só por rota x agrupador) porque o KS TT só conta os 4 segmentos foco e a rota oculta das
    EV* precisa dos PVs; o segmento da venda vem junto, para quem não está no roster de hoje.

    Com `dia` (a pré-venda) é UMA consulta, com a divisão por gerência só se ela falhar: um dia sozinho é pequeno e
    não vale ocupar uma consulta por gerência enquanto as do mês rodam. O mês anterior inteiro já nasce dividido por
    gerência, como a consulta de vendas do mês.
    """
    sel = fontes._colunas(cons, M.OBJ_META, [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.COB_MES],
                          [CM.SEGMENTO, CM.GC_COMERCIAL])
    filtro = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, M.AGRUPADORES_CADERNO_COB), M.FILTRO_PEDIDOS_ONLINE,
               M.FILTRO_SEM_NF_CANCELADA, fontes.filtro_hoje(cons, dia) if dia else None,
               eq(CM.ROTA, rota) if rota else None)
    if dia:
        return _linhas(cons, sel, filtro, gcs, rota)
    partes = fontes._por_gerencia(M.OBJ_META, sel, filtro, gcs, rota)
    return [l for ls in _paralelo({g: (lambda a=a: cons.linhas(*a)) for g, a in partes.items()}).values() for l in ls]


# ------------------------------------------------------------------ agregações (puras)
def real_por_rota(linhas: list[dict], col_rota: str) -> tuple[dict, dict]:
    """({rota: {VOL: Vol Real}}, {sigla da gerência comercial: {VOL: Vol Real}} das rotas EV*), só com os NF_STATUS do
    Vol Real (M.status_nf_real), como fontes.carregar_volume_real.

    Pela rota da META (`col_rota` = CM.META_ROTA), a venda sem chave de meta fica fora (o SAC não a soma em gerência
    nenhuma) e a venda cuja rota da meta é uma EV* vai para a gerência comercial do cliente. Pela rota do CLIENTE,
    é a regra da chave MES_ANTERIOR: a linha entra na rota do cliente e, se ela for EV*, também na gerência comercial
    (só as vendas com rota da meta).
    """
    por_rota: dict = defaultdict(dict)
    ev: dict = defaultdict(dict)
    por_meta = col_rota == CM.META_ROTA
    for l in linhas:
        r, k = fontes._rota(l.get(col_rota)), M.indicador_volume(l.get(CM.AGRUPADOR))
        if not r or k not in VOL or not M.status_nf_real(l.get(CM.NF_STATUS)):
            continue
        sem_meta = fontes.sem_rota_da_meta(l)
        if por_meta and sem_meta:
            continue
        v = numero(l.get(CM.VOL_MES))
        por_rota[r][k] = por_rota[r].get(k, 0.0) + v
        gc = fontes._sigla_gc(l.get(CM.GC_COMERCIAL)) if M.rota_eventual(r) and not sem_meta else None
        if gc:
            ev[gc][k] = ev[gc].get(k, 0.0) + v
    return dict(por_rota), dict(ev)


def cobertos_por_rota(linhas: list[dict]) -> tuple[dict, dict, dict]:
    """({rota: {item: PVs}}, {sigla da gerência comercial: {item: PVs}} das rotas EV*, {pv: segmento na venda}).

    Mesma conta da cobertura do mês (fontes.carregar_vendas): `FX_COBERTURA_REALIZADO` > 0 na rota em que a venda foi
    faturada. O KS TT NÃO é filtrado aqui: o filtro de segmento fica em payload.py (`_filtra_ks_tt`), como no resto do
    gerador.
    """
    cob: dict = defaultdict(lambda: defaultdict(set))
    ev: dict = defaultdict(lambda: defaultdict(set))
    segs: dict[int, str] = {}
    for l in linhas:
        r, pv = fontes._rota(l.get(CM.ROTA)), inteiro(l.get(CM.CLIENTE))
        if not r or pv is None:
            continue
        if not fontes._vazio(l.get(CM.SEGMENTO)):
            segs[pv] = limpar(l.get(CM.SEGMENTO))
        k = M.indicador_cobertura(l.get(CM.AGRUPADOR))
        if k and numero(l.get(CM.COB_MES)) > 0:
            cob[r][k].add(pv)
            if M.rota_eventual(r):
                gc = fontes._sigla_gc(l.get(CM.GC_COMERCIAL))
                if gc:
                    ev[gc][k].add(pv)
    return ({r: dict(ks) for r, ks in cob.items()}, {g: dict(ks) for g, ks in ev.items()}, segs)


# ------------------------------------------------------------------ carga junto com as consultas do mês
@dataclass
class Bloco:
    """Um conjunto do Caderno (a pré-venda do dia ou o mês anterior inteiro)."""
    vol: dict = field(default_factory=dict)        # rota -> VOL -> Vol Real
    vol_ev: dict = field(default_factory=dict)     # sigla da gerência comercial -> VOL -> Vol Real das rotas EV*
    cob: dict = field(default_factory=dict)        # rota -> item -> PVs cobertos
    cob_ev: dict = field(default_factory=dict)     # sigla da gerência comercial -> item -> PVs das rotas EV*
    segmentos: dict = field(default_factory=dict)  # pv -> segmento na venda (KS TT de quem não está no roster)
    erro: str | None = None                        # mensagem: o bloco inteiro fica fora do payload


@dataclass
class Dados:
    """O que as consultas do Caderno trouxeram (fontes.carregar -> payload.montar_payload)."""
    dia: date | None          # DATA_ONTEM: último dia útil fechado (None = sem pré-venda nesta rodada)
    mes_ant: date             # 1º dia do mês anterior ao de referência
    total_ant: int            # dias úteis do mês anterior
    pre: Bloco = field(default_factory=Bloco)
    cheio: Bloco = field(default_factory=Bloco)


def _tolerante(tarefas: dict[str, Callable[[], object]]) -> dict[str, tuple[object, BaseException | None]]:
    """Como mes_anterior._paralelo (threads DAEMON), mas guarda o erro de CADA tarefa em vez de parar na primeira:
    a pré-venda e o mês anterior inteiro entram no payload de forma independente."""
    res: dict[str, tuple[object, BaseException | None]] = {}

    def roda(nome, fn):
        try:
            res[nome] = (fn(), None)
        except BaseException as erro:  # noqa: BLE001
            res[nome] = (None, erro)

    threads = [threading.Thread(target=roda, args=(n, fn), daemon=True, name=f"caderno-{n}")
               for n, fn in tarefas.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return res


class Carga:
    """As quatro consultas do Caderno numa thread daemon; `resultado()` espera até o limite contado do início."""

    def __init__(self, cons: Consulta, dia: date | None, anomes: str, mes_ant: date, total_ant: int,
                 gcs: list[str], rota: str | None, limite_s: float | None = None):
        self.dia, self.mes_ant, self.total_ant = dia, mes_ant, total_ant
        self.limite_s = M.CADERNO_LIMITE_S if limite_s is None else limite_s
        self.inicio = time.monotonic()
        self.fim: float | None = None
        self._res: Dados | None = None
        self._erro: BaseException | None = None
        self._thread = threading.Thread(target=self._roda, args=(cons, anomes, gcs, rota), daemon=True,
                                        name="caderno")
        self._thread.start()

    def _roda(self, cons, anomes, gcs, rota):
        try:
            ant = self.mes_ant.strftime("%Y%m")
            tarefas: dict[str, Callable[[], object]] = {
                "cheio_vol": lambda: consulta_volume(cons, ant, gcs, CM.ROTA, None, rota),
                "cheio_cob": lambda: consulta_cobertura(cons, ant, gcs, None, rota),
            }
            if self.dia:
                tarefas["pre_vol"] = lambda: consulta_volume(cons, anomes, gcs, CM.META_ROTA, self.dia, rota)
                tarefas["pre_cob"] = lambda: consulta_cobertura(cons, anomes, gcs, self.dia, rota)
            r = _tolerante(tarefas)
            d = Dados(self.dia, self.mes_ant, self.total_ant)
            d.pre = self._bloco(r, "pre", CM.META_ROTA) if self.dia else Bloco(
                erro=f"{M.CHAVE_PRE_VENDA}: sem dia útil fechado (DATA_ONTEM nulo)")
            d.cheio = self._bloco(r, "cheio", CM.ROTA)
            self._res = d
        except BaseException as erro:  # noqa: BLE001
            self._erro = erro
        finally:
            self.fim = time.monotonic()

    @staticmethod
    def _bloco(r: dict, prefixo: str, col_rota: str) -> Bloco:
        lv, erro_v = r[f"{prefixo}_vol"]
        lc, erro_c = r[f"{prefixo}_cob"]
        erro = erro_v or erro_c
        if erro is not None:
            qual = "volume" if erro_v is not None else "cobertura"
            return Bloco(erro=f"consulta de {qual} falhou ({type(erro).__name__}: {erro})")
        vol, vol_ev = real_por_rota(lv, col_rota)
        cob, cob_ev, segs = cobertos_por_rota(lc)
        return Bloco(vol, vol_ev, cob, cob_ev, segs)

    @property
    def segundos(self) -> float:
        """Duração das consultas (até agora, se ainda rodam)."""
        return (self.fim or time.monotonic()) - self.inicio

    def resultado(self) -> tuple[Dados | None, list[str]]:
        """(dados, avisos). Passou do limite ou a thread quebrou: (None, [aviso]) e as duas chaves ficam fora (a
        thread segue sozinha e morre com o processo). Um bloco com erro vira aviso em `chaves()`."""
        self._thread.join(max(0.0, self.inicio + self.limite_s - time.monotonic()))
        chaves = f"{M.CHAVE_PRE_VENDA} e {M.CHAVE_MES_ANT_CHEIO}"
        if self._thread.is_alive():
            return None, [f"{chaves} fora do payload: as consultas do Caderno passaram de {self.limite_s:.0f} s "
                          "(a rodada segue sem elas)"]
        if self._erro is not None:
            return None, [f"{chaves} fora do payload: a carga do Caderno falhou "
                          f"({type(self._erro).__name__}: {self._erro})"]
        return self._res, []


def iniciar(cons: Consulta, cal: Calendario, linhas_cal: list[dict], gcs: list[str], rota: str | None = None,
            limite_s: float | None = None) -> Carga:
    """Dispara as consultas do Caderno. A data da pré-venda é `cal.data_ontem` (DATA_ONTEM do payload), nunca o
    relógio; sem ela, só o mês anterior inteiro roda."""
    c = corte_mes_anterior(cal, linhas_cal)
    dia = cal.data_ontem
    if dia is None:
        log.info("%s: sem DATA_ONTEM em %s (último dia útil fechado desconhecido): só %s.", M.CHAVE_PRE_VENDA,
                 cal.mes_label, M.CHAVE_MES_ANT_CHEIO)
    else:
        log.info("%s: pré-venda de %s (último dia útil fechado de %s).", M.CHAVE_PRE_VENDA, dia.isoformat(),
                 cal.mes_label)
    log.info("%s: %s inteiro (%d dias úteis).", M.CHAVE_MES_ANT_CHEIO, calmod.rotulo_mes(c.anterior), c.total_ant)
    return Carga(cons, dia, cal.anomes, c.anterior, c.total_ant, gcs, rota, limite_s)


# ------------------------------------------------------------------ as chaves do payload
def _vals(bloco: Bloco, r: str, gc_ev: str | None, disp: set[str],
          filtra_cob: Callable[[str, dict, dict], dict]) -> tuple[list, list]:
    """(v, c) de uma rota: `null` onde o indicador não existe na rota (o payload marcou `unavailable`), senão o número
    (0 quando não houve venda naquele dia / naquele mês)."""
    vol = bloco.vol_ev.get(gc_ev, {}) if gc_ev else bloco.vol.get(r, {})
    cru = bloco.cob_ev.get(gc_ev, {}) if gc_ev else bloco.cob.get(r, {})
    cob = filtra_cob(r, cru, bloco.segmentos)
    return ([None if k not in disp else modelo._r1(vol.get(k, 0.0)) for k in VOL],
            [None if k not in disp else len(cob.get(k, ())) for k in COB])


def _confere(por_rota: dict, chave: str) -> str | None:
    """Aviso (a chave fica fora) se algum valor for negativo ou não finito."""
    ruins = []
    for r, d in por_rota.items():
        for nome, ks, vals in (("volume", VOL, d["v"]), ("cobertura", COB, d["c"])):
            for k, x in zip(ks, vals):
                if x is None:
                    continue
                if not isinstance(x, (int, float)) or not math.isfinite(x) or x < 0:
                    ruins.append(f"{r}/{nome}/{M.LABELS.get(k) or M.VOLUME_EXTRA.get(k, {}).get('label') or k}")
    if not ruins:
        return None
    return (f"{chave} fora do payload: valor negativo ou inválido em {len(ruins)} rota x indicador "
            f"({', '.join(ruins[:20])})")


def chaves(d: Dados, rotas: list[str], eventuais: dict[str, str], disponiveis: dict[str, set[str]],
           filtra_cob: Callable[[str, dict, dict], dict]) -> tuple[dict | None, dict | None, list[str]]:
    """(PRE_VENDA, MES_ANT_CHEIO, avisos). Qualquer uma pode vir None (bloco com erro ou valor inválido).

    `rotas` = todas as rotas do payload, na ordem dele (Neutraliza, virtuais e as ocultas das EV* inclusive);
    `eventuais` = rota oculta -> gerência; `disponiveis` = {rota: indicadores com `unavailable` False no payload}
    (é o que decide o `null`); `filtra_cob(rota, {item: PVs}, {pv: segmento}) -> {item: PVs}` aplica o KS TT, que
    mora em payload.py.
    """
    avisos: list[str] = []
    saida: list[dict | None] = []
    for bloco, chave in ((d.pre, M.CHAVE_PRE_VENDA), (d.cheio, M.CHAVE_MES_ANT_CHEIO)):
        if bloco.erro:
            avisos.append(f"{chave} fora do payload: {bloco.erro}")
            saida.append(None)
            continue
        por_rota = {}
        for r in rotas:
            v, c = _vals(bloco, r, eventuais.get(r), disponiveis.get(r, set()), filtra_cob)
            por_rota[r] = {"v": v, "c": c}
        aviso = _confere(por_rota, chave)
        if aviso:
            avisos.append(aviso)
            saida.append(None)
            continue
        if chave == M.CHAVE_PRE_VENDA:
            saida.append({"DATA": d.dia.isoformat(), "IND_VOL": list(VOL), "IND_COB": list(COB), "ROTAS": por_rota})
        else:
            saida.append({"MES_LABEL": calmod.rotulo_mes(d.mes_ant), "TOTAL_DIAS_UTEIS": d.total_ant,
                          "IND_VOL": list(VOL), "IND_COB": list(COB), "ROTAS": por_rota})
    com_ev = set(d.pre.vol_ev) | set(d.pre.cob_ev) | set(d.cheio.vol_ev) | set(d.cheio.cob_ev)
    sem_rota = sorted(gc for gc in com_ev if M.rota_eventuais(gc) not in eventuais)
    if sem_rota:
        log.info("Caderno: dado de rotas EV* das gerências %s sem a rota oculta no payload de hoje (fica fora).",
                 ", ".join(sem_rota))
    return saida[0], saida[1], avisos
