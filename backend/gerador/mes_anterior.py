"""
mes_anterior.py — O mês anterior no mesmo dia útil: chave opcional MES_ANTERIOR do payload (só Volume).

Veio da seção E10 do conferir_tendencia.py (descoberta da Etapa 8); o conferir importa daqui o corte, a consulta do
Vol Real com corte e a meta por rota. Decisões da Karen de 21/10/2026:
  1. "Mesmo dia útil" = DIA_ONTEM (dias úteis fechados) limitado ao total do mês anterior (com menos dias úteis, vale
     ele inteiro). O corte (inclusive) vai até a véspera do dia útil seguinte: entram o sábado, o domingo e o feriado
     logo depois do dia útil N, como o Real do mês de referência traz as NF desses dias. DIA_ONTEM = 0: sem corte.
  2. Fechamento: FECHAMENTO x FECHAMENTO. O mês de referência é o fechado e o anterior a ele entra INTEIRO.
  3. Real pela rota ATUAL do cliente (CD_ROTA_Clien): conta na gerência de hoje; o Real das rotas EV* entra na rota
     oculta "{GC}-EV" da gerência comercial, como o Real do mês de referência (só as vendas com rota da meta, 27/10).
  4. % = Real até o corte ÷ meta do mês anterior INTEIRO (META_VOLUME da rota da meta; sem ela, META_NEG): o mesmo
     "% real" dos medidores da Executiva. Δ p.p. e Δ Real ficam para o front.
  5-7. Só os 5 macros de volume (M.INDICADORES_MES_ANTERIOR): coberturas, Todos a Bordo, Del Valle Frut, Imperdoáveis e
     Venda Zero ficam fora.

As três consultas (Vol Real até o corte, META_VOLUME e META_NEG do mês anterior) rodam em threads daemon junto com as
do mês (fontes.carregar). Se alguma falhar ou o conjunto passar de M.MES_ANTERIOR_LIMITE_S, a chave fica fora (aviso
no log) e a rodada segue; uma consulta que ainda estiver rodando não segura o fim do gerar.py.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, NamedTuple

from . import calendario as calmod
from . import fontes, modelo
from . import mapeamento as M
from .consulta import Consulta, e, eq, ou
from .texto import data, numero
from .tipos import Calendario

log = logging.getLogger(__name__)

CM = M.ColMeta
VOL = M.INDICADORES_MES_ANTERIOR
FONTE_DATASPHERE, FONTE_LOCAL = "Datasphere", "cálculo local (seg-sex menos feriados nacionais)"
CASO_NORMAL, CASO_LIMITADO = "normal", "limitado: o mês anterior tem menos dias úteis (vale ele inteiro)"
CASO_SEM_DIA, CASO_FECHAMENTO = "sem dia útil fechado", "fechamento (o mês fechado contra o anterior a ele)"


# ------------------------------------------------------------------ calendário: o corte
class CorteMesAnterior(NamedTuple):
    """O mesmo dia útil no mês anterior ao de referência."""
    ref: date               # 1º dia do mês de referência (o do payload; no fechamento, o mês fechado)
    anterior: date          # 1º dia do mês anterior a ele
    n: int                  # dias úteis fechados no mês de referência (DIA_ONTEM; no fechamento, o total)
    total_ref: int          # dias úteis do mês de referência
    data_ref: date | None   # data do dia útil n no mês de referência (DATA_ONTEM)
    total_ant: int          # dias úteis do mês anterior
    n_ant: int              # dia útil usado no mês anterior: n limitado ao total dele (0 = nenhum)
    data_n: date | None     # data do dia útil n_ant
    corte: date | None      # corte, inclusive: o dia útil n_ant e os dias não úteis logo depois dele
    fonte: str              # FONTE_DATASPHERE ou FONTE_LOCAL (dias úteis do mês anterior)
    caso: str               # CASO_NORMAL, CASO_LIMITADO, CASO_SEM_DIA ou CASO_FECHAMENTO
    limitado: bool          # n > total_ant: o mês anterior tem menos dias úteis e vale inteiro
    n_proporcional: int     # alternativa medida pela E10: n / total_ref x total_ant, arredondado
    fechado: bool = False   # o painel está em fechamento (o anterior entra inteiro)


def linhas_do_mes(linhas_cal: list[dict], ref: date) -> int:
    """Linhas do calendário do Datasphere no mês de `ref`."""
    return sum(1 for l in linhas_cal
               if (d := data(l.get(M.ColCalendario.DATA))) and (d.year, d.month) == (ref.year, ref.month))


def dias_uteis_do_mes(linhas_cal: list[dict], ref: date) -> tuple[list[date], str]:
    """(datas dos dias úteis do mês de `ref`, em ordem; fonte). Pelo calendário do Datasphere (o 1º dia de semana com
    cada NO_DIA_UTIL, calendario.data_do_dia_util); sem as linhas do mês, ou com algum dia útil faltando, pelo cálculo
    local (só os feriados nacionais)."""
    if linhas_do_mes(linhas_cal, ref):
        total = calmod.total_dias_uteis(linhas_cal, ref)
        datas = [calmod.data_do_dia_util(linhas_cal, ref.year, ref.month, i) for i in range(1, total + 1)]
        if datas and all(datas):
            return datas, FONTE_DATASPHERE
    return calmod.dias_uteis_do_mes(ref.year, ref.month), FONTE_LOCAL


def corte_do_dia(datas: list[date], n: int, ref: date) -> date | None:
    """Corte do dia útil `n` (datas = dias úteis do mês de `ref`): a véspera do dia útil seguinte (inclui os dias não
    úteis logo depois do dia n) ou, no último dia útil, o fim do mês; None com n = 0."""
    if n <= 0 or not datas:
        return None
    return datas[n] - timedelta(days=1) if n < len(datas) else fontes.ultimo_dia(ref)


def _inteiro(v: float) -> int:
    """Inteiro arredondado (meio para cima; o round() do Python vai para o par)."""
    return int(Decimal(repr(float(v))).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def corte_mes_anterior(cal: Calendario, linhas_cal: list[dict]) -> CorteMesAnterior:
    """O mesmo dia útil no mês anterior ao de referência: N = DIA_ONTEM (dias úteis fechados), limitado aos dias úteis
    do mês anterior (decisão 1). No fechamento (decisão 2) o anterior entra inteiro (N = total dele, corte = o último
    dia). O corte inclui os dias não úteis logo depois do dia útil N; no último dia útil, vai até o fim do mês."""
    ref = cal.ref or cal.hoje.replace(day=1)
    ant = calmod.mes_anterior(ref)
    datas, fonte = dias_uteis_do_mes(linhas_cal, ant)
    n, total_ant = max(0, cal.dia_ontem), len(datas)
    n_ant = total_ant if cal.fechamento and n else min(n, total_ant)
    caso = (CASO_SEM_DIA if not n_ant else CASO_FECHAMENTO if cal.fechamento else
            CASO_LIMITADO if n > total_ant else CASO_NORMAL)
    prop = min(total_ant, _inteiro(n * total_ant / cal.total_dias_uteis)) if cal.total_dias_uteis else 0
    return CorteMesAnterior(ref, ant, n, cal.total_dias_uteis, cal.data_ontem, total_ant, n_ant,
                            datas[n_ant - 1] if n_ant else None, corte_do_dia(datas, n_ant, ant), fonte, caso,
                            n > total_ant and not cal.fechamento, prop, cal.fechamento)


def filtro_ate(cons: Consulta, corte: date) -> str:
    """DATA_MOVIMENTO até o corte (inclusive), com o literal pelo tipo do $metadata (fontes.literal_data). A data só
    entra no $filter, nunca no groupby."""
    return f"{CM.DATA} le {fontes.literal_data(cons, corte)}"


# ------------------------------------------------------------------ consultas
def _paralelo(tarefas: dict[str, Callable[[], object]]) -> dict[str, object]:
    """Roda as funções ao mesmo tempo em threads DAEMON (uma consulta lenta não segura o fim do gerar.py, ao contrário
    do ThreadPoolExecutor, que espera os seus no fim do processo) e devolve {nome: resultado}; a 1ª exceção sobe."""
    res: dict[str, object] = {}
    erros: list[BaseException] = []

    def roda(nome, fn):
        try:
            res[nome] = fn()
        except BaseException as erro:  # noqa: BLE001
            erros.append(erro)

    threads = [threading.Thread(target=roda, args=(n, fn), daemon=True, name=f"mes-anterior-{n}")
               for n, fn in tarefas.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if erros:
        raise erros[0]
    return res


def _linhas(cons: Consulta, sel: list[str], filtro: str | None, gcs: list[str], rota: str | None = None) -> list[dict]:
    """A consulta inteira; se falhar (ex.: HTTP 500), uma por gerência em paralelo (como fontes._por_rota)."""
    try:
        return cons.linhas(M.OBJ_META, sel, filtro)
    except Exception:  # noqa: BLE001
        if rota or not gcs:
            raise
        partes = fontes._por_gerencia(M.OBJ_META, sel, filtro, gcs, None)
        return [l for ls in _paralelo({g: (lambda a=a: cons.linhas(*a)) for g, a in partes.items()}).values()
                for l in ls]


def consulta_volume(cons: Consulta, anomes: str, gcs: list[str], corte: date | None = None,
                    col_rota: str = CM.ROTA, rota: str | None = None) -> list[dict]:
    """Vol Real do mês por rota x agrupador x NF_STATUS, agregado no servidor (sem cliente nem dia), com os filtros do Vol
    Real do gerador (os 5 macros, FILTRO_PEDIDOS_ONLINE) e, com `corte`, DATA_MOVIMENTO <= corte. Pela rota do cliente,
    também a gerência comercial e a rota da meta (clientes em rotas EV*, como fontes.carregar_volume_real)."""
    sel = fontes._colunas(cons, M.OBJ_META, [col_rota, CM.AGRUPADOR, CM.NF_STATUS, CM.VOL_MES],
                          [CM.GC_COMERCIAL, CM.META_ROTA] if col_rota == CM.ROTA else [])
    filtro = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, [M.AGRUPADORES_VOLUME[k] for k in VOL]),
               M.FILTRO_PEDIDOS_ONLINE, filtro_ate(cons, corte) if corte else None,
               eq(col_rota, rota) if rota else None)
    return _linhas(cons, sel, filtro, gcs, rota)


def real_por_rota(linhas: list[dict], col_rota: str = CM.ROTA) -> tuple[dict, dict]:
    """({rota: {VOL: Vol Real}}, {sigla da gerência comercial: {VOL: Vol Real}} dos clientes em rotas EV*, só as vendas
    com rota da meta), só com os NF_STATUS do Vol Real (M.status_nf_real), como fontes.carregar_volume_real."""
    por_rota: dict = defaultdict(dict)
    ev: dict = defaultdict(dict)
    for l in linhas:
        r, k = fontes._rota(l.get(col_rota)), M.indicador_volume(l.get(CM.AGRUPADOR))
        if not r or k not in VOL or not M.status_nf_real(l.get(CM.NF_STATUS)):
            continue
        v = numero(l.get(CM.VOL_MES))
        por_rota[r][k] = por_rota[r].get(k, 0.0) + v
        gc = (fontes._sigla_gc(l.get(CM.GC_COMERCIAL)) if M.rota_eventual(r) and not fontes.sem_rota_da_meta(l)
              else None)
        if gc:
            ev[gc][k] = ev[gc].get(k, 0.0) + v
    return dict(por_rota), dict(ev)


def carregar_meta_volume(cons: Consulta, anomes: str, rota: str | None = None) -> dict[str, dict[str, float]]:
    """META_VOLUME do mês por rota da meta x macro ({rota: {VOL: meta}}), o maior valor por rota, como
    fontes.carregar_metas (só rota, agrupador e META_VOLUME: sem a cobertura e o incentivo)."""
    sel = fontes._colunas(cons, M.OBJ_META, [CM.META_ROTA, CM.META_AGRUPADOR, CM.META_VOLUME])
    linhas = cons.linhas(M.OBJ_META, sel, e(eq(CM.META_ANOMES, anomes),
                                            ou(CM.META_AGRUPADOR, [M.AGRUPADORES_VOLUME[k] for k in VOL]),
                                            eq(CM.META_ROTA, rota) if rota else None))
    out: dict = defaultdict(dict)
    for l in linhas:
        r, k = fontes._rota(l.get(CM.META_ROTA)), M.indicador_volume(l.get(CM.META_AGRUPADOR))
        if r and k in VOL and l.get(CM.META_VOLUME) not in (None, ""):
            out[r][k] = max(out[r].get(k, 0.0), numero(l.get(CM.META_VOLUME)))
    return dict(out)


def carregar_meta_neg(cons: Consulta, anomes: str, gcs: list[str], rota: str | None = None) -> dict[str, dict[str, float]]:
    """META_NEG do mês inteiro por rota da meta x macro (a meta quando a rota não tem META_VOLUME)."""
    sel = fontes._colunas(cons, M.OBJ_META, [CM.META_ROTA, CM.AGRUPADOR, CM.META_NEG])
    filtro = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, [M.AGRUPADORES_VOLUME[k] for k in VOL]),
               eq(CM.META_ROTA, rota) if rota else None)
    out: dict = defaultdict(dict)
    for l in _linhas(cons, sel, filtro, gcs, rota):
        r, k = fontes._rota(l.get(CM.META_ROTA)), M.indicador_volume(l.get(CM.AGRUPADOR))
        if r and k in VOL and l.get(CM.META_NEG) not in (None, ""):
            out[r][k] = out[r].get(k, 0.0) + numero(l.get(CM.META_NEG))
    return dict(out)


def meta_volume_por_rota(metas_vol: dict, neg_mes: dict | None, gc_rota: dict[str, str],
                         real: dict | None = None) -> dict[str, dict]:
    """{rota: {VOL: meta ou None}} como o gerador (modelo.meta_e_restante: META_VOLUME; sem ela, a soma de META_NEG da
    rota da meta; None = indicador indisponível). Sem nenhuma das duas mas com Real (e na rota oculta das EV*): meta 0
    (só soma o Real), como fontes.carregar (modelo.SEM_META)."""
    out = {}
    for r, gc in gc_rota.items():
        com_real = {k: bool(modelo._r1((real or {}).get(r, {}).get(k) or 0.0)) for k in VOL}
        if r == M.rota_eventuais(gc):
            out[r] = {k: 0.0 if com_real[k] else None for k in VOL}
        else:
            out[r] = {}
            for k in VOL:
                m = modelo.meta_e_restante(metas_vol.get(r, {}).get(k), (neg_mes or {}).get(r, {}).get(k), 0.0, 0, 1)[0]
                out[r][k] = 0.0 if m is None and com_real[k] else m
    return out


# ------------------------------------------------------------------ carga junto com as consultas do mês
@dataclass
class Dados:
    """O que as consultas do mês anterior trouxeram (fontes.carregar -> payload.montar_payload)."""
    corte: CorteMesAnterior
    real: dict = field(default_factory=dict)        # rota do cliente -> VOL -> Vol Real até o corte
    eventuais: dict = field(default_factory=dict)   # sigla da gerência comercial -> VOL -> Vol Real das rotas EV*
    metas_vol: dict = field(default_factory=dict)   # rota da meta -> VOL -> META_VOLUME do mês anterior
    neg: dict = field(default_factory=dict)         # rota da meta -> VOL -> META_NEG do mês anterior inteiro


class Carga:
    """As consultas do mês anterior numa thread daemon; `resultado()` espera até o limite contado do início."""

    def __init__(self, cons: Consulta, corte: CorteMesAnterior, gcs: list[str], rota: str | None,
                 limite_s: float | None = None):
        self.corte = corte
        self.limite_s = M.MES_ANTERIOR_LIMITE_S if limite_s is None else limite_s
        self.inicio = time.monotonic()
        self.fim: float | None = None
        self._res: Dados | None = None
        self._erro: BaseException | None = None
        self._thread = threading.Thread(target=self._roda, args=(cons, gcs, rota), daemon=True, name="mes-anterior")
        self._thread.start()

    def _roda(self, cons, gcs, rota):
        try:
            ant = self.corte.anterior.strftime("%Y%m")
            r = _paralelo({"vol": lambda: consulta_volume(cons, ant, gcs, self.corte.corte, rota=rota),
                           "meta": lambda: carregar_meta_volume(cons, ant, rota),
                           "neg": lambda: carregar_meta_neg(cons, ant, gcs, rota)})
            real, ev = real_por_rota(r["vol"])
            self._res = Dados(self.corte, real, ev, r["meta"], r["neg"])
        except BaseException as erro:  # noqa: BLE001
            self._erro = erro
        finally:
            self.fim = time.monotonic()

    @property
    def segundos(self) -> float:
        """Duração das consultas (até agora, se ainda rodam)."""
        return (self.fim or time.monotonic()) - self.inicio

    def resultado(self) -> tuple[Dados | None, str | None]:
        """(dados, None) ou (None, aviso): falhou ou passou do limite (a thread segue sozinha e morre com o processo)."""
        self._thread.join(max(0.0, self.inicio + self.limite_s - time.monotonic()))
        lab = calmod.rotulo_mes(self.corte.anterior)
        if self._thread.is_alive():
            return None, (f"{M.CHAVE_MES_ANTERIOR} fora do payload: as consultas de {lab} passaram de "
                          f"{self.limite_s:.0f} s (a rodada segue sem a comparação com o mês anterior)")
        if self._erro is not None:
            return None, (f"{M.CHAVE_MES_ANTERIOR} fora do payload: consulta de {lab} falhou "
                          f"({type(self._erro).__name__}: {self._erro})")
        return self._res, None


def iniciar(cons: Consulta, cal: Calendario, linhas_cal: list[dict], gcs: list[str], rota: str | None = None,
            limite_s: float | None = None) -> Carga | None:
    """Dispara as consultas do mês anterior (None sem dia útil fechado: DIA_ONTEM = 0, sem corte e sem chave)."""
    c = corte_mes_anterior(cal, linhas_cal)
    if c.corte is None:
        log.info("%s: sem dia útil fechado em %s (DIA_ONTEM = 0): sem a chave.", M.CHAVE_MES_ANTERIOR, cal.mes_label)
        return None
    log.info("%s: %s até %s (dia útil %d de %d, %s; %s).", M.CHAVE_MES_ANTERIOR, calmod.rotulo_mes(c.anterior),
             c.corte.isoformat(), c.n_ant, c.total_ant, c.caso, c.fonte)
    return Carga(cons, c, gcs, rota, limite_s)


# ------------------------------------------------------------------ a chave do payload
def chave(d: Dados, rotas: list[str], eventuais: dict[str, str]) -> tuple[dict | None, str | None]:
    """(chave MES_ANTERIOR, None) ou (None, aviso). `rotas` = todas as rotas do payload, na ordem dele (Neutraliza,
    virtuais e as ocultas das EV* inclusive); `eventuais` = rota oculta -> gerência (as do payload de hoje).

    Por rota, um par [Real até o corte, Meta do mês anterior] por macro de IND, ou null onde a rota não tem o indicador
    no mês anterior (sem META_VOLUME, META_NEG nem Real; sem as metas e com Real: [Real, 0], como o card). A rota
    oculta "{GC}-EV" leva o
    Real das rotas EV* da gerência comercial, com meta 0 nos macros com Real. Rota do mês anterior que não existe hoje
    fica fora. Real negativo ou valor não finito: a chave fica fora (aviso), nunca reprova a rodada."""
    real = {r: ks for r, ks in d.real.items()}
    for r, gc in eventuais.items():
        real[r] = {k: v for k, v in d.eventuais.get(gc, {}).items() if v}
    gc_rota = {r: eventuais.get(r, "") for r in rotas}
    meta = meta_volume_por_rota(d.metas_vol, d.neg, gc_rota, real)
    por_rota, ruins = {}, []
    for r in rotas:
        vals = []
        for k in VOL:
            m = meta[r][k]
            if m is None:
                vals.append(None)
                continue
            v = real.get(r, {}).get(k, 0.0)
            if not (math.isfinite(v) and math.isfinite(m)) or modelo._r1(v) < 0:
                ruins.append(f"{r}/{M.LABELS[k]}")
            vals.append([modelo._r1(v), modelo._r1(m)])
        por_rota[r] = vals
    if ruins:
        return None, (f"{M.CHAVE_MES_ANTERIOR} fora do payload: Real negativo ou valor inválido em "
                      f"{len(ruins)} rota x macro ({', '.join(ruins[:20])})")
    sem_rota = sorted(gc for gc in d.eventuais if M.rota_eventuais(gc) not in eventuais)
    if sem_rota:
        log.info("%s: Real de rotas EV* de %s sem a rota oculta hoje (fica fora): %s", M.CHAVE_MES_ANTERIOR,
                 calmod.rotulo_mes(d.corte.anterior), ", ".join(sem_rota))
    c = d.corte
    return {"MES_LABEL": calmod.rotulo_mes(c.anterior), "DIA_UTIL": c.n_ant, "TOTAL_DIAS_UTEIS": c.total_ant,
            "DATA_CORTE": c.corte.isoformat(), "FECHADO": c.fechado, "IND": list(VOL), "ROTAS": por_rota}, None
