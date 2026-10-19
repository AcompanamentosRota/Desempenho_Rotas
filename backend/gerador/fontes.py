"""
fontes.py — Consulta o Datasphere e normaliza as linhas em tipos.Fontes.

Consultas (todas analíticas, space DW_BND_COM_SAP; nomes e filtros em mapeamento.py):

  calendario  AM_BND_MTR_CALENDARIO_DATA_ATUAL  dias úteis do mês / dia útil de hoje
  base        AM_BND_BASE_CLIENTE               versão corrente dos clientes ativos das gerências do
                                                painel: rota, visita de hoje, supervisor, vendedor, rede
  vendas      AM_FAT_BND_ANALISE_META           rota x cliente x agrupador (só os 17 agrupadores do painel;
                                                uma consulta por gerência, em paralelo): cobertura do mês,
                                                compras e volume de hoje (online, só pedidos 'Inc. e Exp.'),
                                                meta (META_NEG) por cliente, segmento do cliente
  vol_real    AM_FAT_BND_ANALISE_META           rota x cliente x macro de volume x NF_STATUS (por gerência):
                                                Vol Real = FX_VOL_PADRAO_FAT com status em M.STATUS_NF_REAL
  meta_neg    AM_FAT_BND_ANALISE_META           rota x macro: soma de META_NEG do mês e da parte restante
                                                (DATA_MOVIMENTO de hoje ao fim do mês só no $filter)
  meta_dia    AM_FAT_BND_ANALISE_META           rota x macro: META_RECUPERAVEL_ROTA com DATA_MOVIMENTO = hoje
                                                no $filter (se der erro, repete por gerência)
  metas       AM_FAT_BND_ANALISE_META           rota x agrupador da meta: meta de cobertura e META_VOLUME
                                                (a meta de volume da rota, denominador do volume)
  metas_gc    AM_FAT_BND_ANALISE_META           META_VOLUME e META_COBERTURA do mês por rota -> gerência
                                                (decide o fim do fechamento do mês)
  comodato    AM_FAT_BND_COMODATO               geladeiras Total Ko em contrato: giro zero (Venda Zero)
                                                e ativas; meta de Venda Zero por gerência

Todas agregam no servidor (modo analítico: o $select de dimensões é o groupby) e rodam em paralelo;
DATA_MOVIMENTO só aparece no $filter, nunca no groupby (por dia seriam ~25 mil linhas e ~150 s).

Fechamento do mês (calendario.em_fechamento): o payload inteiro passa a ser do mês anterior (cal.anomes),
Venda Zero fica indisponível e o online continua sendo o de hoje (pedidos do mês atual).

Falha no comodato não derruba a execução (Venda Zero fica indisponível); falha na meta do dia
deixa metaDia = null (registrado no log). Falha nas demais interrompe sem gravar nada.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from . import calendario as calmod
from . import modelo
from . import mapeamento as M
from .consulta import Consulta, e, eq, ou
from .mapeamento import ColBase as B, ColCalendario as CC, ColComodato as CO, ColMeta as CM
from .texto import data, inteiro, limpar, normalizar, numero, titulo
from .tipos import Calendario, Cliente, Equipamento, Fontes, Online, VolumeRota

log = logging.getLogger(__name__)


class ErroMapeamento(Exception):
    """Coluna esperada não existe no modelo do Datasphere (ajuste gerador/mapeamento.py)."""


def _colunas(cons: Consulta, objeto: str, obrigatorias: list[str], opcionais: list[str] = ()) -> list[str]:
    existentes = set(cons.colunas(objeto))
    faltando = [c for c in obrigatorias if c not in existentes]
    if faltando:
        raise ErroMapeamento(f"{objeto}: colunas não encontradas no $metadata: {', '.join(faltando)}. "
                             f"Rode scripts/descobrir.py e ajuste gerador/mapeamento.py.")
    sem = [c for c in opcionais if c not in existentes]
    if sem:
        log.warning("%s: colunas opcionais ausentes (ignoradas): %s", objeto, ", ".join(sem))
    return list(dict.fromkeys(list(obrigatorias) + [c for c in opcionais if c in existentes]))


def _formatar_dias(valor: object) -> str:
    """'SEG-QUI' / 'Seg - Qui' -> 'Seg - Qui' (mesmo formato da tabela DIAS); '--' -> ''."""
    texto = limpar(valor)
    partes = [p.strip() for p in re.split(r"\s*-\s*|\s*/\s*|\s*,\s*", texto) if p.strip()]
    return " - ".join(p[:1].upper() + p[1:3].lower() for p in partes)


def _vazio(valor: object) -> bool:
    return normalizar(valor) in ("", "--", "#", "0", "NAO ATRIBUIDO", "NOT ASSIGNED", "INDETERMINADO")


def _rota(valor: object) -> str:
    return limpar(valor).upper()


# ------------------------------------------------------------------ calendário
def carregar_calendario(cons: Consulta, hoje: date) -> tuple[Calendario, list[dict]]:
    """Calendário do mês de hoje + as linhas do Datasphere (usadas também no fechamento; [] se falhou)."""
    linhas: list[dict] = []
    try:
        linhas = cons.linhas(M.OBJ_CALENDARIO, [CC.DATA, CC.DIAS_UTEIS_MES, CC.DIA_UTIL, CC.DIAS_RESTANTES])
        cal = calmod.do_datasphere(linhas, hoje)
        if cal:
            return cal, linhas
        log.warning("Calendário do Datasphere sem linha para %s; usando cálculo local.", hoje)
    except Exception as erro:   # noqa: BLE001 - qualquer falha cai no plano B
        log.warning("Calendário do Datasphere indisponível (%s); usando cálculo local.", erro)
    return calmod.calcular_local(hoje), linhas


# ------------------------------------------------------------------ base de clientes
def carregar_clientes(cons: Consulta, rota: str | None = None,
                      estatisticas: dict | None = None) -> tuple[list[Cliente], list[str]]:
    """Clientes do painel + valores originais de GC presentes (dividem a consulta de vendas).

    Nada sai em silêncio: as linhas ignoradas são contadas por gerência e motivo (em `estatisticas`,
    se informado, e no log), assim como os supervisores cujo prefixo não é sigla da gerência de origem.
    """
    ignoradas: dict = defaultdict(lambda: defaultdict(int))
    fora_padrao: dict = defaultdict(set)
    sel = _colunas(cons, M.OBJ_BASE_CLIENTE,
                   [B.ROTA, B.CLIENTE, B.NOME, B.SEGMENTO, B.DIA_VISITA, B.VISITA_HOJE, B.GC, B.SUPERVISOR,
                    B.NOME_SUPERVISOR, B.VENDEDOR, B.QUANTIDADE],
                   [B.REDE_NOME])
    filtro = e(M.FILTRO_BASE_CLIENTE, ou(B.GC, M.GC_ORIGEM), eq(B.ROTA, rota) if rota else None)
    linhas = cons.linhas(M.OBJ_BASE_CLIENTE, sel, filtro)
    clientes, gcs, ignorados = [], set(), 0
    for l in linhas:
        pv, r, sv = inteiro(l.get(B.CLIENTE)), _rota(l.get(B.ROTA)), M.codigo_sv(l.get(B.SUPERVISOR))
        origem = limpar(l.get(B.GC))
        motivo = ("sem PV" if pv is None else "rota vazia ou eventual (EV*)" if not M.rota_do_painel(r)
                  else "supervisor de balcão (SV.BL.*)" if sv.startswith(M.SV_IGNORAR_PREFIXOS)
                  else "supervisor fora do padrão SV.<sigla>.<n>" if not M.sv_do_painel(sv) else None)
        if motivo:
            ignorados += 1
            ignoradas[origem][motivo] += 1
            continue
        if not M.sigla_esperada(origem, M.gc_do_sv(sv)):
            fora_padrao[origem].add(sv)
        gcs.add(str(l.get(B.GC) or ""))
        rede = "" if _vazio(l.get(B.REDE_NOME)) else limpar(l.get(B.REDE_NOME)).upper()
        segmento = "" if _vazio(l.get(B.SEGMENTO)) else limpar(l.get(B.SEGMENTO))
        clientes.append(Cliente(
            pv=pv, nome=limpar(l.get(B.NOME)).upper(), rota=r, gc=M.gc_do_sv(sv), sv=sv,
            nome_sv=limpar(l.get(B.NOME_SUPERVISOR)).upper(), consultor=limpar(l.get(B.VENDEDOR)).upper(),
            segmento=segmento, dia_visita="" if _vazio(l.get(B.DIA_VISITA)) else _formatar_dias(l.get(B.DIA_VISITA)),
            visita_hoje=M.eh_sim(l.get(B.VISITA_HOJE)), rede=rede))
    log.info("Base de clientes: %d clientes em %d rotas (%d linhas fora do painel ignoradas)",
             len(clientes), len({c.rota for c in clientes}), ignorados)
    for origem, motivos in sorted(ignoradas.items()):
        log.info("  %s: ignoradas %s", origem or "(sem gerência)", dict(motivos))
    for origem, svs in sorted(fora_padrao.items()):
        log.warning("  %s: supervisores com prefixo fora das siglas da gerência (entram pelo prefixo): %s",
                    origem, ", ".join(sorted(svs)))
    if estatisticas is not None:
        estatisticas["ignoradas"] = {o: dict(m) for o, m in ignoradas.items()}
        estatisticas["fora_padrao"] = {o: sorted(v) for o, v in fora_padrao.items()}
    return clientes, sorted(g for g in gcs if g)


# ------------------------------------------------------------------ vendas do mês + online
def _por_gerencia(obj: str, sel: list[str], filtro: str | None, gcs_originais: list[str], rota: str | None) -> dict:
    """Uma consulta por gerência (rodam em paralelo; cada uma bem menor que a consulta inteira)."""
    if rota or not gcs_originais:
        return {"todas": (obj, sel, filtro)}
    return {g: (obj, sel, e(filtro, eq(CM.GC, g))) for g in gcs_originais}


def carregar_vendas(cons: Consulta, anomes: str, gcs_originais: list[str], rota: str | None, online: Online,
                    so_pedidos_hoje: bool = False):
    """Cobertura do mês, compras, meta por cliente e online de hoje.

    so_pedidos_hoje: só as linhas WF Online (fechamento do mês: o online de hoje é do mês atual,
    enquanto o resto do payload é do mês anterior).
    """
    obj = M.OBJ_META
    sel = _colunas(cons, obj, [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.COB_MES, CM.VOL_MES],
                   [CM.COB_ONLINE, CM.COB_ONLINE_GERAL, CM.VOL_ONLINE, CM.META_VOLUME_CLIENTE, CM.SEGMENTO])
    _colunas(cons, obj, [CM.FONTE, CM.SITUACAO_PEDIDO])   # só confere: entram no $filter, não no $select
    base = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, M.AGRUPADORES_CONSULTA_VENDAS), M.FILTRO_PEDIDOS_ONLINE,
             eq(CM.FONTE, "WF Online") if so_pedidos_hoje else None, eq(CM.ROTA, rota) if rota else None)
    partes = _por_gerencia(obj, sel, base, gcs_originais, rota)
    linhas = [l for ls in cons.em_paralelo(partes).values() for l in ls]

    cobertos: dict = defaultdict(lambda: defaultdict(set))
    compraram: dict = defaultdict(set)
    meta_cli: dict = defaultdict(lambda: defaultdict(dict))
    segmento: dict[int, str] = {}
    for l in linhas:
        r, pv = _rota(l.get(CM.ROTA)), inteiro(l.get(CM.CLIENTE))
        if not r or pv is None:
            continue
        ag = l.get(CM.AGRUPADOR)
        # compras do mês, cobertura e "qualquer compra hoje" só com os 17 agrupadores do painel
        do_painel = M.agrupador_do_painel(ag)
        if do_painel:
            compraram[r]   # rota presente na fonte de vendas (mesmo sem compra)
        if not _vazio(l.get(CM.SEGMENTO)):
            segmento[pv] = limpar(l.get(CM.SEGMENTO))
        k_cob, k_vol = M.indicador_cobertura(ag), M.indicador_volume(ag)
        cob_mes, vol_mes = numero(l.get(CM.COB_MES)), numero(l.get(CM.VOL_MES))
        cob_on, cob_on_g = numero(l.get(CM.COB_ONLINE)), numero(l.get(CM.COB_ONLINE_GERAL))
        vol_on = numero(l.get(CM.VOL_ONLINE))
        if do_painel and (cob_mes > 0 or vol_mes > 0):
            compraram[r].add(pv)
        if k_cob and cob_mes > 0:
            cobertos[r][k_cob].add(pv)
        if k_cob and cob_on > 0:
            online.clientes.setdefault(r, {}).setdefault(k_cob, set()).add(pv)
        if do_painel and (cob_on > 0 or cob_on_g > 0 or vol_on > 0):
            online.qualquer.setdefault(r, set()).add(pv)
        if vol_on and M.agrupador_gdm(ag):   # Desempenho GDM: online de hoje nos agrupadores do GDM
            g = online.gdm_cliente.setdefault(r, {})
            g[pv] = g.get(pv, 0.0) + vol_on
        if k_vol:
            if vol_on:
                online.volume.setdefault(r, {}).setdefault(k_vol, 0.0)
                online.volume[r][k_vol] += vol_on
                por_cli = online.volume_cliente.setdefault(r, {}).setdefault(pv, {})
                por_cli[k_vol] = por_cli.get(k_vol, 0.0) + vol_on
            meta_c = l.get(CM.META_VOLUME_CLIENTE)
            if meta_c not in (None, ""):
                meta_cli[r][pv][k_vol] = meta_cli[r][pv].get(k_vol, 0.0) + numero(meta_c)
    log.info("Vendas: %d linhas, %d rotas, %d com venda online hoje", len(linhas), len(compraram), len(online.qualquer))
    return cobertos, compraram, meta_cli, segmento


# ------------------------------------------------------------------ volume (critério do SAC)
@dataclass
class VolumeMes:
    """Vol Real do mês (FX_VOL_PADRAO_FAT) separado por NF_STATUS."""
    real: dict = field(default_factory=dict)            # rota -> VOL -> Vol Real (status do SAC)
    real_cliente: dict = field(default_factory=dict)    # rota -> pv -> VOL -> Vol Real
    real_gdm_cliente: dict = field(default_factory=dict)  # rota -> pv -> faturado nos agrupadores do GDM
    todos_status: dict = field(default_factory=dict)    # rota -> VOL -> soma sem filtro de status (Real antigo)
    por_status: dict = field(default_factory=dict)      # status como veio -> [linhas, volume, conta no Vol Real]


def carregar_volume_real(cons: Consulta, anomes: str, gcs_originais: list[str], rota: str | None) -> VolumeMes:
    """Vol Real por rota x cliente x macro: só NF com status em M.STATUS_NF_REAL (comparado por normalizar).

    Agregado no servidor por rota x cliente x agrupador x status (sem dia), uma consulta por gerência.
    O status entra no $select (e não no $filter) para a comparação não depender da grafia exata.
    """
    obj = M.OBJ_META
    sel = _colunas(cons, obj, [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.NF_STATUS, CM.VOL_MES])
    filtro = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, M.AGRUPADORES_VOL_REAL),
               M.FILTRO_PEDIDOS_ONLINE, eq(CM.ROTA, rota) if rota else None)
    linhas = [l for ls in cons.em_paralelo(_por_gerencia(obj, sel, filtro, gcs_originais, rota)).values() for l in ls]
    vm = VolumeMes()
    for l in linhas:
        r, pv, ag = _rota(l.get(CM.ROTA)), inteiro(l.get(CM.CLIENTE)), l.get(CM.AGRUPADOR)
        vol, status = numero(l.get(CM.VOL_MES)), l.get(CM.NF_STATUS)
        conta = M.status_nf_real(status)
        # Desempenho GDM: mesmo filtro de NF_STATUS, somando os agrupadores do GDM (só nesse quadrinho)
        if r and pv is not None and conta and M.agrupador_gdm(ag):
            g = vm.real_gdm_cliente.setdefault(r, {})
            g[pv] = g.get(pv, 0.0) + vol
        k = M.indicador_volume(ag)
        if not r or not k:
            continue
        if k in M.INDICADORES_VOLUME:   # estatística por status e "Real atual" só dos 5 macros (conferência)
            st = vm.por_status.setdefault(limpar(status), [0, 0.0, conta])
            st[0] += 1
            st[1] += vol
            tot = vm.todos_status.setdefault(r, {})
            tot[k] = tot.get(k, 0.0) + vol
        if not conta:
            continue
        rr = vm.real.setdefault(r, {})
        rr[k] = rr.get(k, 0.0) + vol
        if pv is not None:
            rc = vm.real_cliente.setdefault(r, {}).setdefault(pv, {})
            rc[k] = rc.get(k, 0.0) + vol
    fora = {s: round(v[1], 1) for s, v in vm.por_status.items() if not v[2]}
    log.info("Vol Real: %d linhas, %d rotas; status fora do Vol Real: %s", len(linhas), len(vm.real), fora or "nenhum")
    if linhas and not vm.real:
        log.error("Nenhum NF_STATUS bateu com %s (vieram: %s). Ajuste M.STATUS_NF_REAL.",
                  M.STATUS_NF_REAL, sorted(vm.por_status))
    return vm


def ultimo_dia(d: date) -> date:
    """Último dia do mês de `d`."""
    return (date(d.year, d.month, 28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def literal_data(cons: Consulta, d: date) -> str:
    """Literal OData de DATA_MOVIMENTO para `d`, pelo tipo do $metadata.

    Edm.Date -> 2026-10-17; Edm.DateTime* -> 2026-10-17T00:00:00Z; texto -> '2026-10-17' ou '20261017'
    (o formato do texto sai de uma linha de amostra, consultada uma vez por execução).
    """
    tipo = cons.tipo(M.OBJ_META, CM.DATA) if hasattr(cons, "tipo") else None
    if tipo and "String" not in tipo:
        return f"{d.isoformat()}T00:00:00Z" if "DateTime" in tipo else d.isoformat()
    formato = getattr(cons, "_formato_data", None)
    if formato is None:
        amostra = cons.linhas(M.OBJ_META, [CM.DATA, CM.VOL_MES],
                              e(eq(CM.ANOMES, d.strftime("%Y%m")), eq(CM.AGRUPADOR, M.AGRUPADORES_VOLUME["VOL REFRIGERANTES"])),
                              top=1)
        bruto = limpar(amostra[0].get(CM.DATA)) if amostra else ""
        formato = "%Y%m%d" if len(bruto) == 8 and bruto.isdigit() else "%Y-%m-%d"
        cons._formato_data = formato
    return "'" + d.strftime(formato) + "'"


def filtro_restante(cons: Consulta, hoje: date) -> str:
    """DATA_MOVIMENTO de hoje (inclusive) até o último dia do mês de hoje."""
    return f"{CM.DATA} ge {literal_data(cons, hoje)} and {CM.DATA} le {literal_data(cons, ultimo_dia(hoje))}"


def filtro_hoje(cons: Consulta, hoje: date) -> str:
    return f"{CM.DATA} eq {literal_data(cons, hoje)}"


def _por_rota(cons: Consulta, medida: str, anomes: str, gcs_originais: list[str], rota: str | None,
              filtro_extra: str | None = None, col_rota: str = CM.ROTA) -> dict:
    """{rota: {VOL: medida}} agregado no servidor por rota x agrupador (sem dia e sem cliente).

    col_rota: CD_ROTA_Clien (rota atual do cliente, padrão) ou CD_ROTA_Chave_Meta_SAP (rota da meta).
    Se a consulta inteira falhar (ex.: HTTP 500 do objeto analítico), repete dividindo por gerência.
    """
    obj = M.OBJ_META
    sel = _colunas(cons, obj, [col_rota, CM.AGRUPADOR, medida])
    filtro = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, M.AGRUPADORES_VOLUME_CONSULTA), filtro_extra,
               eq(col_rota, rota) if rota else None)
    try:
        linhas = cons.linhas(obj, sel, filtro)
    except Exception as erro:   # noqa: BLE001
        if rota or not gcs_originais:
            raise
        log.warning("%s: consulta inteira falhou (%s); repetindo por gerência.", medida, erro)
        partes = _por_gerencia(obj, sel, filtro, gcs_originais, rota)
        linhas = [l for ls in cons.em_paralelo(partes).values() for l in ls]
    out: dict = defaultdict(dict)
    for l in linhas:
        r, k = _rota(l.get(col_rota)), M.indicador_volume(l.get(CM.AGRUPADOR))
        if r and k and l.get(medida) not in (None, ""):
            out[r][k] = out[r].get(k, 0.0) + numero(l.get(medida))
    return dict(out)


def _por_rota_dia(cons: Consulta, medida: str, anomes: str, rota: str | None) -> list[tuple[str, str, date | None, float]]:
    """(rota, VOL, DATA_MOVIMENTO, medida) por rota x macro x dia. Lenta (~150 s): só plano B do Neg Restante."""
    obj = M.OBJ_META
    sel = _colunas(cons, obj, [CM.ROTA, CM.AGRUPADOR, CM.DATA, medida])
    filtro = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, M.AGRUPADORES_VOLUME_CONSULTA),
               eq(CM.ROTA, rota) if rota else None)
    out = []
    for l in cons.linhas(obj, sel, filtro):
        r, k = _rota(l.get(CM.ROTA)), M.indicador_volume(l.get(CM.AGRUPADOR))
        if r and k and l.get(medida) not in (None, ""):
            out.append((r, k, data(l.get(CM.DATA)), numero(l.get(medida))))
    return out


def meta_neg_e_restante(linhas: list[tuple[str, str, date | None, float]], hoje: date) -> tuple[dict, dict]:
    """Meta NEG do mês e Neg Restante (META_NEG de hoje, inclusive, até o fim do mês) a partir das linhas por dia."""
    meta: dict = defaultdict(dict)
    restante: dict = defaultdict(dict)
    sem_data = 0
    for r, k, d, v in linhas:
        meta[r][k] = meta[r].get(k, 0.0) + v
        restante[r].setdefault(k, 0.0)
        if d is None:
            sem_data += 1
        elif d >= hoje:
            restante[r][k] += v
    if sem_data:
        log.warning("META_NEG: %d linhas sem DATA_MOVIMENTO legível ficaram fora do Neg Restante.", sem_data)
    return dict(meta), dict(restante)


def carregar_meta_neg(cons: Consulta, anomes: str, gcs_originais: list[str], rota: str | None, hoje: date,
                      com_restante: bool = True, col_rota: str = CM.ROTA) -> tuple[dict, dict | None]:
    """Soma de META_NEG do mês e da parte restante (DATA_MOVIMENTO de hoje ao fim do mês) por rota x macro.

    Duas consultas em paralelo, sem a data no groupby. Se o filtro de data for recusado, o restante
    sai da consulta por dia (plano B, lento; só pela rota do cliente). com_restante=False (fechamento): só o mês.
    """
    if not com_restante:
        return _por_rota(cons, CM.META_NEG, anomes, gcs_originais, rota, col_rota=col_rota), None
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_mes = ex.submit(_por_rota, cons, CM.META_NEG, anomes, gcs_originais, rota, None, col_rota)
        try:
            restante = _por_rota(cons, CM.META_NEG, anomes, gcs_originais, rota, filtro_restante(cons, hoje), col_rota)
        except Exception as erro:   # noqa: BLE001
            if col_rota != CM.ROTA:
                raise
            log.warning("META_NEG com filtro de DATA_MOVIMENTO falhou (%s); Neg Restante pela consulta por dia.", erro)
            restante = meta_neg_e_restante(_por_rota_dia(cons, CM.META_NEG, anomes, rota), hoje)[1]
        mes = f_mes.result()
    log.info("Meta NEG por %s: %d rotas", col_rota, len(mes))
    return mes, restante


ROTA_META, ROTA_CLIENTE = "rota_meta", "rota_cliente"


def carregar_curva_neg(cons: Consulta, anomes: str, gcs_originais: list[str], rota: str | None, hoje: date,
                       com_restante: bool = True) -> tuple[dict, dict | None, str]:
    """Curva da META_NEG (mês e restante) por rota: pela rota da META (CD_ROTA_Chave_Meta_SAP), como o SAC.

    Cliente transferido leva a META_NEG para a rota atual dele (CD_ROTA_Clien), então a rota da meta é a
    preferida. As duas consultas rodam juntas; se a da rota da meta falhar ou vier sem rota, vale a da
    rota do cliente (regra anterior, sempre escalonada). Devolve (mês, restante, ROTA_META | ROTA_CLIENTE).
    """
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_meta = ex.submit(carregar_meta_neg, cons, anomes, gcs_originais, rota, hoje, com_restante, CM.META_ROTA)
        f_cli = ex.submit(carregar_meta_neg, cons, anomes, gcs_originais, rota, hoje, com_restante, CM.ROTA)
        try:
            mes, rest = f_meta.result()
            if any(v for ks in mes.values() for v in ks.values()):
                return mes, rest, ROTA_META
            log.warning("META_NEG por %s veio sem rota: usando a rota do cliente (%s).", CM.META_ROTA, CM.ROTA)
        except Exception as erro:   # noqa: BLE001
            log.warning("META_NEG por %s falhou (%s): usando a rota do cliente (%s).", CM.META_ROTA, erro, CM.ROTA)
        mes, rest = f_cli.result()
        return mes, rest, ROTA_CLIENTE


def carregar_meta_dia(cons: Consulta, anomes: str, gcs_originais: list[str], rota: str | None, hoje: date) -> dict | None:
    """META_RECUPERAVEL_ROTA com DATA_MOVIMENTO = hoje no $filter, por rota x macro (sem linha = 0).

    None (metaDia = null no payload) se a medida não existir ou se a consulta falhar inteira e por gerência.
    """
    if CM.META_RECUPERAVEL not in set(cons.colunas(M.OBJ_META)):
        log.error("%s não existe no $metadata de %s: meta do dia fica null.", CM.META_RECUPERAVEL, M.OBJ_META)
        return None
    try:
        return _por_rota(cons, CM.META_RECUPERAVEL, anomes, gcs_originais, rota, filtro_hoje(cons, hoje))
    except Exception as erro:   # noqa: BLE001
        log.error("Consulta de %s falhou (%s): meta do dia fica null.", CM.META_RECUPERAVEL, erro)
        return None


def carregar_metas(cons: Consulta, anomes: str, rota: str | None):
    """Metas por rota x agrupador: cobertura {rota: {ind: meta}} e META_VOLUME {rota: {VOL: meta}}.

    META_VOLUME é a meta de volume da rota (denominador do volume, como no SAC).
    """
    obj = M.OBJ_META
    sel = _colunas(cons, obj, [CM.META_ROTA, CM.META_AGRUPADOR, CM.META_COBERTURA, CM.META_VOLUME], [CM.META_NEG])
    f_rota = eq(CM.META_ROTA, rota) if rota else None
    linhas = cons.linhas(obj, sel, e(eq(CM.META_ANOMES, anomes),
                                     ou(CM.META_AGRUPADOR, M.AGRUPADORES_ORIGEM + list(M.AGRUPADORES_VOLUME_EXTRA.values())),
                                     f_rota))
    metas: dict = defaultdict(dict)
    metas_vol: dict = defaultdict(dict)
    for l in linhas:
        r = _rota(l.get(CM.META_ROTA))
        if not r:
            continue
        ag = l.get(CM.META_AGRUPADOR)
        k_cob, k_vol = M.indicador_cobertura(ag), M.indicador_volume(ag)
        if k_cob:
            usa_neg = k_cob in M.INDICADORES_NOVOS_NEG and M.META_NOVOS_NEG_DE_META_NEG
            fonte = l.get(CM.META_NEG) if usa_neg else l.get(CM.META_COBERTURA)
            if fonte not in (None, ""):
                metas[r][k_cob] = max(metas[r].get(k_cob, 0.0), numero(fonte))
        if k_vol and l.get(CM.META_VOLUME) not in (None, ""):
            metas_vol[r][k_vol] = max(metas_vol[r].get(k_vol, 0.0), numero(l.get(CM.META_VOLUME)))
    log.info("Metas: cobertura em %d rotas, META_VOLUME em %d rotas", len(metas), len(metas_vol))
    return metas, dict(metas_vol)


# ------------------------------------------------------------------ fechamento do mês
def metas_por_gerencia(cons: Consulta, anomes: str, gc_da_rota: dict[str, str]) -> dict[str, tuple[float, float]]:
    """(META_VOLUME, META_COBERTURA) do mês por gerência de origem ('G1', ..., 'IT_MO').

    A meta vem por rota (lado Chave_Meta_SAP) e a gerência sai da base de clientes (gc_da_rota).
    """
    obj = M.OBJ_META
    sel = _colunas(cons, obj, [CM.META_ROTA, CM.META_VOLUME, CM.META_COBERTURA])
    linhas = cons.linhas(obj, sel, e(eq(CM.META_ANOMES, anomes), ou(CM.META_AGRUPADOR, M.AGRUPADORES_ORIGEM)))
    por_gc: dict[str, list[float]] = {}
    for l in linhas:
        gc = gc_da_rota.get(_rota(l.get(CM.META_ROTA)))
        if gc:
            t = por_gc.setdefault(M.gc_origem(gc), [0.0, 0.0])
            t[0] += numero(l.get(CM.META_VOLUME))
            t[1] += numero(l.get(CM.META_COBERTURA))
    return {g: (v, c) for g, (v, c) in por_gc.items()}


def todas_com_meta(por_gc: dict[str, tuple[float, float]], gerencias: list[str]) -> bool:
    """Critério de virada: toda gerência com META_VOLUME > 0 e META_COBERTURA > 0."""
    return all(por_gc.get(g, (0.0, 0.0))[0] > 0 and por_gc.get(g, (0.0, 0.0))[1] > 0 for g in gerencias)


def gerencias_origem(gc_da_rota: dict[str, str]) -> list[str]:
    """Gerências exigidas na virada: as de M.GC_ORIGEM presentes na base de clientes
    (todas no dia a dia; com --rota, só a da rota consultada)."""
    presentes = {M.gc_origem(g) for g in gc_da_rota.values()}
    return [g for g in (M.codigo_gc(x) for x in M.GC_ORIGEM) if g in presentes]


def fechamento_pelo_payload(p: dict | None, hoje: date) -> str | None:
    """Rodada só-online: o payload publicado decide; se ele é de outro mês, é o rótulo do fechamento."""
    if p and p.get("MES_LABEL") and p["MES_LABEL"] != calmod.rotulo_mes(hoje):
        return p["MES_LABEL"]
    return None


# ------------------------------------------------------------------ comodato / Venda Zero
def _distribuir(total: float, pesos: dict[str, int]) -> dict[str, int]:
    """Divide `total` inteiro entre as chaves proporcionalmente aos pesos (maiores restos)."""
    soma = sum(pesos.values())
    if not soma or total is None:
        return {k: 0 for k in pesos}
    alvo = int(round(total))
    brutos = {k: alvo * p / soma for k, p in pesos.items()}
    base = {k: int(v) for k, v in brutos.items()}
    sobra = alvo - sum(base.values())
    for k in sorted(brutos, key=lambda k: (brutos[k] - base[k], pesos[k]), reverse=True)[:sobra]:
        base[k] += 1
    return base


def carregar_comodato(cons: Consulta, anomes: str, rota: str | None, gc_da_rota: dict[str, str]):
    obj = M.OBJ_COMODATO
    sel = _colunas(cons, obj, [CO.ROTA, CO.CLIENTE, CO.NOME, CO.DIA_VISITA, CO.VISITA_HOJE, CO.EQUIPAMENTO,
                               CO.GIRO, CO.META_EQPTO, CO.VOLUME])
    linhas = cons.linhas(obj, sel, e(M.FILTRO_COMODATO, ou(CO.GC, M.GC_ORIGEM), eq(CO.ROTA, rota) if rota else None))
    zerados: dict = {}
    vistos: set = set()
    ativos: dict = defaultdict(lambda: defaultdict(int))
    # Desempenho GDM: (rota, pv) -> [soma META_EQPTO, nº de geladeiras, situações das geladeiras]
    por_cliente: dict = {}
    for l in linhas:
        r, pv = _rota(l.get(CO.ROTA)), inteiro(l.get(CO.CLIENTE))
        equip = limpar(l.get(CO.EQUIPAMENTO))
        if not r or pv is None or (r, equip) in vistos:
            continue
        vistos.add((r, equip))
        cli = por_cliente.setdefault((r, pv), [0.0, 0, set()])
        cli[0] += numero(l.get(CO.META_EQPTO))
        cli[1] += 1
        cli[2].add(M.SITUACAO_GIRO.get(normalizar(l.get(CO.GIRO))))
        if normalizar(l.get(CO.GIRO)) in M.GIRO_ZERO:
            item = zerados.setdefault((r, pv), Equipamento(
                pv=pv, nome=titulo(l.get(CO.NOME)), dia="" if _vazio(l.get(CO.DIA_VISITA)) else _formatar_dias(l.get(CO.DIA_VISITA)),
                hoje=M.eh_sim(l.get(CO.VISITA_HOJE)), tipo=M.TIPO_EQUIPAMENTO_EXIBICAO, vdz=0,
                meta_comodato=0.0, volume=0.0))
            item.vdz += 1
            item.meta_comodato += numero(l.get(CO.META_EQPTO))
            item.volume = max(item.volume, numero(l.get(CO.VOLUME)))
        else:
            ativos[r][pv] += 1
    vendazero: dict = defaultdict(list)
    for (r, _), item in zerados.items():
        vendazero[r].append(item)

    # meta de Venda Zero: por gerência, distribuída pelas rotas na proporção dos equipamentos
    sel_m = _colunas(cons, obj, [CO.META_GC, CO.META_VZ_GC, CO.MEDIDA_AUX])
    metas_gc: dict[str, float] = {}
    for l in cons.linhas(obj, sel_m, eq(CO.META_ANOMES, anomes)):
        if l.get(CO.META_VZ_GC) not in (None, ""):
            metas_gc[M.codigo_gc(l.get(CO.META_GC))] = numero(l.get(CO.META_VZ_GC))
    equip_rota = defaultdict(int)
    for r, cli in ativos.items():
        equip_rota[r] += sum(cli.values())
    for r, itens in vendazero.items():
        equip_rota[r] += sum(i.vdz for i in itens)
    vz_meta: dict[str, float] = {}
    if not rota:
        por_gc: dict = defaultdict(dict)
        for r, gc in gc_da_rota.items():
            if gc in metas_gc and equip_rota.get(r):   # rota sem geladeira: Venda Zero indisponível
                por_gc[gc][r] = equip_rota[r]
        for gc, pesos in por_gc.items():
            vz_meta.update(_distribuir(metas_gc[gc], pesos))
    else:   # sondagem de uma rota: não há como ratear sem as demais rotas da gerência
        log.warning("Meta de Venda Zero não é calculada com --rota (é rateada entre as rotas da gerência).")
    log.info("Comodato: %d clientes com Venda Zero em %d rotas; meta de VZ em %d gerências",
             len(zerados), len(vendazero), len(metas_gc))
    return dict(vendazero), {r: dict(v) for r, v in ativos.items()}, vz_meta, por_cliente


def situacao_cliente(situacoes: set) -> str | None:
    """Pior situação entre as geladeiras do cliente (Zero > Baixo > < 30 dias > Ok); None se nenhuma conhecida."""
    return next((s for s in M.ORDEM_SITUACAO if s in situacoes), None)


def comodato_cliente(por_cliente: dict, real_gdm: dict, excluir: set[str]) -> dict:
    """{rota: {pv: [meta GDM, faturado GDM, situação, nº de geladeiras]}} (rotas em `excluir` ficam fora)."""
    out: dict = defaultdict(dict)
    desconhecidos = 0
    for (r, pv), (meta, n, situacoes) in por_cliente.items():
        if r in excluir:
            continue
        situacao = situacao_cliente(situacoes)
        desconhecidos += situacao is None
        out[r][pv] = [meta, real_gdm.get(r, {}).get(pv, 0.0), situacao, n]
    if desconhecidos:
        log.warning("Comodato: %d clientes com GIRO_STATUS_MES_ATUAL desconhecido (sem tag e quadrinho sem cor).",
                    desconhecidos)
    return dict(out)


# ------------------------------------------------------------------ tudo junto
def rotas_neutraliza(clientes: list[Cliente]) -> set[str]:
    """Rotas Neutraliza (M.NEUTRALIZA_ROTAS) presentes na base de clientes."""
    return {c.rota for c in clientes if c.rota in M.NEUTRALIZA_ROTAS}


def rotas_virtuais(clientes: list[Cliente]) -> set[str]:
    """Rotas virtuais (M.VIRTUAIS_ROTAS) presentes na base de clientes."""
    return {c.rota for c in clientes if c.rota in M.VIRTUAIS_ROTAS}


def decidir_fechamento(cons: Consulta, hoje: date, linhas_cal: list[dict], gc_da_rota: dict[str, str]) -> Calendario | None:
    """Calendário fechado do mês anterior se hoje está no período de fechamento; None se não está."""
    dia_util = calmod.dia_util_hoje(linhas_cal, hoje)
    if dia_util <= 1:
        motivo, metas_ok = f"dia útil {dia_util} (até o fim do 1º dia útil)", False
    else:
        por_gc = metas_por_gerencia(cons, hoje.strftime("%Y%m"), gc_da_rota)
        gerencias = gerencias_origem(gc_da_rota)
        metas_ok = todas_com_meta(por_gc, gerencias)
        faltam = [g for g in gerencias if not todas_com_meta(por_gc, [g])]
        motivo = f"gerências sem META_VOLUME/META_COBERTURA de {hoje:%m/%Y}: {', '.join(faltam)}"
    if not calmod.em_fechamento(dia_util, metas_ok):
        return None
    ref = calmod.mes_anterior(hoje)
    cal = calmod.fechado(hoje, ref, calmod.total_dias_uteis(linhas_cal, ref))
    log.warning("Fechamento do mês: painel em %s (%s).", cal.mes_label, motivo)
    return cal


def carregar(cons: Consulta, agora: datetime, rota: str | None = None, so_online: bool = False,
             fechamento: str | None = None) -> Fontes:
    """`fechamento` (manual) só sobrepõe o rótulo da tag do online; o período é detectado sozinho."""
    hoje = agora.date()
    anomes_hoje = hoje.strftime("%Y%m")
    online = Online(atualizado_em=agora, fechamento_mes=fechamento)

    if so_online:
        segmento = carregar_vendas(cons, anomes_hoje, list(M.GC_ORIGEM), rota, online)[-1]
        for d in (online.clientes, online.qualquer, online.volume, online.volume_cliente, online.gdm_cliente):
            for r in [r for r in d if not M.rota_do_painel(r)]:
                del d[r]
        return Fontes(cal=calmod.calcular_local(hoje), clientes=[], cobertos={}, compraram={}, metas={},
                      volume={}, volume_cliente={}, online=online, segmento_venda=segmento)

    cal, linhas_cal = carregar_calendario(cons, hoje)
    clientes, gcs = carregar_clientes(cons, rota)
    rotas_painel = {c.rota for c in clientes}
    gc_da_rota = {c.rota: c.gc for c in clientes}
    cal = decidir_fechamento(cons, hoje, linhas_cal, gc_da_rota) or cal
    anomes = cal.anomes
    if cal.fechamento:
        online.fechamento_mes = fechamento or cal.mes_label
        log.warning("Fechamento do mês: Venda Zero indisponível (o giro do comodato já é do mês novo).")

    def vendas():
        if not cal.fechamento:
            return carregar_vendas(cons, anomes, gcs, rota, online)
        # payload do mês anterior; o online (pedidos de hoje) vem do mês atual
        cob, comp, mcli, seg = carregar_vendas(cons, anomes, gcs, rota, Online(atualizado_em=agora))
        seg_hoje = carregar_vendas(cons, anomes_hoje, gcs, rota, online, so_pedidos_hoje=True)[-1]
        return cob, comp, mcli, {**seg_hoje, **seg}

    # Neutraliza e virtuais nunca entram na Venda Zero: fora da lista, das geladeiras ativas e do rateio da meta.
    # A tag de geladeira e o Desempenho GDM (busca de cliente) valem para a Neutraliza; a virtual não aparece.
    virtuais = rotas_virtuais(clientes)
    fora_vz = rotas_neutraliza(clientes) | virtuais

    def comodato():
        if cal.fechamento:   # fechamento: Venda Zero, tag de geladeira e Desempenho GDM indisponíveis
            return None, {}, {}, {}
        try:
            vz, atv, vz_meta, por_cli = carregar_comodato(cons, anomes, rota,
                                                          {r: g for r, g in gc_da_rota.items() if r not in fora_vz})
            return ({r: v for r, v in vz.items() if r not in fora_vz},
                    {r: v for r, v in atv.items() if r not in fora_vz}, vz_meta, por_cli)
        except Exception as erro:   # noqa: BLE001
            log.warning("Comodato indisponível (%s); Venda Zero ficará indisponível nesta execução.", erro)
            return None, {}, {}, {}

    # todas as consultas do mês rodam ao mesmo tempo (vendas e Vol Real ainda se dividem por gerência)
    with ThreadPoolExecutor(max_workers=6) as ex:
        f_vendas = ex.submit(vendas)
        f_vm = ex.submit(carregar_volume_real, cons, anomes, gcs, rota)
        f_metas = ex.submit(carregar_metas, cons, anomes, rota)
        f_neg = ex.submit(carregar_curva_neg, cons, anomes, gcs, rota, hoje, not cal.fechamento)
        f_dia = None if cal.fechamento else ex.submit(carregar_meta_dia, cons, anomes, gcs, rota, hoje)
        f_com = ex.submit(comodato)
        cobertos, compraram, meta_cli, segmento = f_vendas.result()
        vm = f_vm.result()
        metas, metas_vol = f_metas.result()
        neg_mes, neg_rest, fonte_neg = f_neg.result()
        meta_dia = f_dia.result() if f_dia else None
        vendazero, ativos, vz_meta, por_cli_comodato = f_com.result()

    # Meta = META_VOLUME da rota; Neg Restante = META_NEG restante pela rota da meta (direto se o mês bate com a
    # META_VOLUME em 1%; senão, escalonado) ou, sem a rota da meta, a curva pela rota do cliente escalonada
    dias_restantes = cal.total_dias_uteis - cal.dia_ontem   # dias úteis de hoje (inclusive) ao fim do mês
    volume: dict = defaultdict(dict)
    casos: dict[str, list[str]] = defaultdict(list)
    for r in sorted(rotas_painel):
        for k in M.INDICADORES_VOLUME_TODOS:
            if not M.volume_extra_da_gc(k, gc_da_rota.get(r, "")):
                continue
            nm, real = neg_mes.get(r, {}).get(k), vm.real.get(r, {}).get(k)
            meta, rest, caso = modelo.meta_e_restante(metas_vol.get(r, {}).get(k), nm,
                                                      (neg_rest or {}).get(r, {}).get(k, 0.0),
                                                      dias_restantes, cal.total_dias_uteis,
                                                      direto=fonte_neg == ROTA_META)
            if meta is None and real is None:
                continue
            if caso in (modelo.SEM_CURVA, modelo.SEM_META_ROTA) or (caso == modelo.CURVA and fonte_neg == ROTA_META):
                casos[caso].append(f"{r}/{M.LABELS.get(k) or M.VOLUME_EXTRA[k]['label']}")
            volume[r][k] = VolumeRota(
                meta=meta, real=real or 0.0, meta_neg_clientes=nm,
                neg_restante=None if cal.fechamento else rest,
                meta_dia_hoje=None if meta_dia is None else meta_dia.get(r, {}).get(k, 0.0))
    avisos = []
    if fonte_neg == ROTA_CLIENTE:
        avisos.append(f"META_NEG por {CM.META_ROTA} indisponível: Neg Restante escalonado pela curva da rota do cliente")
    elif casos[modelo.CURVA] and not cal.fechamento:
        avisos.append("Neg Restante escalonado (META_NEG da rota da meta difere mais de 1% da META_VOLUME) em: "
                      + ", ".join(casos[modelo.CURVA]))
    if casos[modelo.SEM_CURVA]:
        avisos.append("Neg Restante por dias úteis (META_VOLUME sem curva de META_NEG) em: "
                      + ", ".join(casos[modelo.SEM_CURVA]))
    if casos[modelo.SEM_META_ROTA]:
        avisos.append("meta = soma de META_NEG (sem META_VOLUME da rota) em: " + ", ".join(casos[modelo.SEM_META_ROTA]))
    # volume extra (Del Valle Frut): gerência sem META_VOLUME nem META_NEG fica sem o card (indicador indisponível)
    for k in M.INDICADORES_VOLUME_EXTRA:
        for gc in M.VOLUME_EXTRA[k]["gcs"]:
            rotas_gc = [r for r in rotas_painel if gc_da_rota.get(r) == gc]
            if rotas_gc and not any(volume.get(r, {}).get(k) and volume[r][k].meta is not None for r in rotas_gc):
                avisos.append(f"{M.VOLUME_EXTRA[k]['label']}: {gc} sem meta (META_VOLUME e META_NEG de "
                              f"'{M.AGRUPADORES_VOLUME_EXTRA[k]}' zeradas ou ausentes): o card não aparece")
    for a in avisos:
        log.warning(a)
    # barra por cliente: (Meta NEG do cliente, Vol Real do cliente) onde o cliente tem meta
    vol_cli = {r: {pv: {k: (m, vm.real_cliente.get(r, {}).get(pv, {}).get(k, 0.0)) for k, m in ks.items()}
                   for pv, ks in por_pv.items()}
               for r, por_pv in meta_cli.items()}

    def so_painel(d: dict) -> dict:
        return {r: v for r, v in d.items() if r in rotas_painel}

    # a rota "online" também se restringe às rotas do painel
    online.clientes = so_painel(online.clientes)
    online.qualquer = so_painel(online.qualquer)
    online.volume = so_painel(online.volume)
    online.volume_cliente = so_painel(online.volume_cliente)
    online.gdm_cliente = so_painel(online.gdm_cliente)
    return Fontes(cal=cal, clientes=clientes, cobertos={r: dict(v) for r, v in so_painel(cobertos).items()},
                  compraram=so_painel(compraram), metas=so_painel(dict(metas)), volume=dict(volume),
                  volume_cliente=so_painel(vol_cli), online=online,
                  vendazero=so_painel(vendazero) if vendazero is not None else None,
                  vz_meta=vz_meta, comodato_ativos=so_painel(ativos), segmento_venda=segmento, avisos=avisos,
                  comodato_cliente=so_painel(comodato_cliente(por_cli_comodato, vm.real_gdm_cliente, virtuais)))
