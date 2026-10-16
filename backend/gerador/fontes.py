"""
fontes.py — Consulta o Datasphere e normaliza as linhas em tipos.Fontes.

Consultas (todas analíticas, space DW_BND_COM_SAP; nomes e filtros em mapeamento.py):

  calendario  AM_BND_MTR_CALENDARIO_DATA_ATUAL  dias úteis do mês / dia útil de hoje
  base        AM_BND_BASE_CLIENTE               versão corrente dos clientes ativos das gerências do
                                                painel: rota, visita de hoje, supervisor, vendedor, rede
  vendas      AM_FAT_BND_ANALISE_META           rota x cliente x agrupador (só os 17 agrupadores do painel;
                                                uma consulta por gerência, em paralelo): cobertura do mês,
                                                compras e volume de hoje (online, só pedidos 'Inc. e Exp.'),
                                                volume e meta por cliente, segmento do cliente
  metas       AM_FAT_BND_ANALISE_META           rota x agrupador da meta: meta de cobertura, de volume
                                                e meta do dia
  comodato    AM_FAT_BND_COMODATO               geladeiras Total Ko em contrato: giro zero (Venda Zero)
                                                e ativas; meta de Venda Zero por gerência

Falha no comodato não derruba a execução (Venda Zero fica indisponível).
Falha nas demais interrompe sem gravar nada.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import date, datetime

from . import calendario as calmod
from . import mapeamento as M
from .consulta import Consulta, e, eq, ou
from .mapeamento import ColBase as B, ColCalendario as CC, ColComodato as CO, ColMeta as CM
from .texto import inteiro, limpar, normalizar, numero, titulo
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
def carregar_calendario(cons: Consulta, hoje: date) -> Calendario:
    try:
        linhas = cons.linhas(M.OBJ_CALENDARIO, [CC.DATA, CC.DIAS_UTEIS_MES, CC.DIA_UTIL, CC.DIAS_RESTANTES])
        cal = calmod.do_datasphere(linhas, hoje)
        if cal:
            return cal
        log.warning("Calendário do Datasphere sem linha para %s; usando cálculo local.", hoje)
    except Exception as erro:   # noqa: BLE001 - qualquer falha cai no plano B
        log.warning("Calendário do Datasphere indisponível (%s); usando cálculo local.", erro)
    return calmod.calcular_local(hoje)


# ------------------------------------------------------------------ base de clientes
def carregar_clientes(cons: Consulta, rota: str | None = None) -> tuple[list[Cliente], list[str]]:
    """Clientes do painel + valores originais de GC presentes (dividem a consulta de vendas)."""
    sel = _colunas(cons, M.OBJ_BASE_CLIENTE,
                   [B.ROTA, B.CLIENTE, B.NOME, B.SEGMENTO, B.DIA_VISITA, B.VISITA_HOJE, B.GC, B.SUPERVISOR,
                    B.NOME_SUPERVISOR, B.VENDEDOR, B.QUANTIDADE],
                   [B.REDE_NOME])
    filtro = e(M.FILTRO_BASE_CLIENTE, ou(B.GC, M.GC_ORIGEM), eq(B.ROTA, rota) if rota else None)
    linhas = cons.linhas(M.OBJ_BASE_CLIENTE, sel, filtro)
    clientes, gcs, ignorados = [], set(), 0
    for l in linhas:
        pv, r, sv = inteiro(l.get(B.CLIENTE)), _rota(l.get(B.ROTA)), M.codigo_sv(l.get(B.SUPERVISOR))
        if pv is None or not M.rota_do_painel(r) or not M.sv_do_painel(sv):
            ignorados += 1
            continue
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
    return clientes, sorted(g for g in gcs if g)


# ------------------------------------------------------------------ vendas do mês + online
def carregar_vendas(cons: Consulta, anomes: str, gcs_originais: list[str], rota: str | None, online: Online):
    obj = M.OBJ_META
    sel = _colunas(cons, obj, [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.COB_MES, CM.VOL_MES],
                   [CM.COB_ONLINE, CM.COB_ONLINE_GERAL, CM.VOL_ONLINE, CM.META_VOLUME_CLIENTE, CM.SEGMENTO])
    _colunas(cons, obj, [CM.FONTE, CM.SITUACAO_PEDIDO])   # só confere: entram no $filter, não no $select
    base = e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, M.AGRUPADORES_ORIGEM), M.FILTRO_PEDIDOS_ONLINE,
             eq(CM.ROTA, rota) if rota else None)
    if rota or not gcs_originais:
        partes = {"todas": (obj, sel, base)}
    else:   # uma consulta por gerência, em paralelo (cada uma bem menor que a consulta inteira)
        partes = {g: (obj, sel, e(base, eq(CM.GC, g))) for g in gcs_originais}
    linhas = [l for ls in cons.em_paralelo(partes).values() for l in ls]

    cobertos: dict = defaultdict(lambda: defaultdict(set))
    compraram: dict = defaultdict(set)
    vol_real: dict = defaultdict(lambda: defaultdict(float))
    vol_cli: dict = defaultdict(lambda: defaultdict(dict))
    segmento: dict[int, str] = {}
    for l in linhas:
        r, pv = _rota(l.get(CM.ROTA)), inteiro(l.get(CM.CLIENTE))
        if not r or pv is None:
            continue
        compraram[r]   # rota presente na fonte de vendas (mesmo sem compra)
        if not _vazio(l.get(CM.SEGMENTO)):
            segmento[pv] = limpar(l.get(CM.SEGMENTO))
        ag = l.get(CM.AGRUPADOR)
        k_cob, k_vol = M.indicador_cobertura(ag), M.indicador_volume(ag)
        cob_mes, vol_mes = numero(l.get(CM.COB_MES)), numero(l.get(CM.VOL_MES))
        cob_on, cob_on_g = numero(l.get(CM.COB_ONLINE)), numero(l.get(CM.COB_ONLINE_GERAL))
        vol_on = numero(l.get(CM.VOL_ONLINE))
        if cob_mes > 0 or vol_mes > 0:
            compraram[r].add(pv)
        if k_cob and cob_mes > 0:
            cobertos[r][k_cob].add(pv)
        if k_cob and cob_on > 0:
            online.clientes.setdefault(r, {}).setdefault(k_cob, set()).add(pv)
        if cob_on > 0 or cob_on_g > 0 or vol_on > 0:
            online.qualquer.setdefault(r, set()).add(pv)
        if k_vol:
            vol_real[r][k_vol] += vol_mes
            if vol_on:
                online.volume.setdefault(r, {}).setdefault(k_vol, 0.0)
                online.volume[r][k_vol] += vol_on
            meta_c = l.get(CM.META_VOLUME_CLIENTE)
            atual = vol_cli[r][pv].get(k_vol)
            if meta_c not in (None, "") or atual:
                m0, r0 = atual or (0.0, 0.0)
                vol_cli[r][pv][k_vol] = (m0 + numero(meta_c), r0 + vol_mes)
    log.info("Vendas: %d linhas, %d rotas, %d com venda online hoje", len(linhas), len(compraram), len(online.qualquer))
    return cobertos, compraram, vol_real, vol_cli, segmento


# ------------------------------------------------------------------ metas
def carregar_metas(cons: Consulta, anomes: str, rota: str | None):
    """Metas por rota x agrupador: cobertura {rota: {ind: meta}} e volume {rota: {VOL: (meta, meta_dia)}}.

    META_DIA é uma medida calculada cara: junto com as outras colunas a consulta leva ~130 s,
    sozinha e só com os 5 agrupadores de volume leva ~2 s. Por isso são duas consultas em paralelo.
    """
    obj = M.OBJ_META
    sel = _colunas(cons, obj, [CM.META_ROTA, CM.META_AGRUPADOR, CM.META_COBERTURA, CM.META_VOLUME], [CM.META_NEG])
    sel_dia = _colunas(cons, obj, [CM.META_ROTA, CM.META_AGRUPADOR, CM.META_DIA])
    f_rota = eq(CM.META_ROTA, rota) if rota else None
    res = cons.em_paralelo({
        "metas": (obj, sel, e(eq(CM.META_ANOMES, anomes), ou(CM.META_AGRUPADOR, M.AGRUPADORES_ORIGEM), f_rota)),
        "meta_dia": (obj, sel_dia, e(eq(CM.META_ANOMES, anomes),
                                     ou(CM.META_AGRUPADOR, list(M.AGRUPADORES_VOLUME.values())), f_rota)),
    })
    metas: dict = defaultdict(dict)
    metas_vol: dict = defaultdict(dict)
    for l in res["metas"]:
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
    meta_dia: dict = defaultdict(lambda: defaultdict(float))
    for l in res["meta_dia"]:
        r, k_vol = _rota(l.get(CM.META_ROTA)), M.indicador_volume(l.get(CM.META_AGRUPADOR))
        if r and k_vol:
            meta_dia[r][k_vol] += numero(l.get(CM.META_DIA))
    volume = {r: {k: (m, meta_dia.get(r, {}).get(k, 0.0)) for k, m in ks.items()} for r, ks in metas_vol.items()}
    log.info("Metas: cobertura em %d rotas, volume em %d rotas", len(metas), len(volume))
    return metas, volume


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
    for l in linhas:
        r, pv = _rota(l.get(CO.ROTA)), inteiro(l.get(CO.CLIENTE))
        equip = limpar(l.get(CO.EQUIPAMENTO))
        if not r or pv is None or (r, equip) in vistos:
            continue
        vistos.add((r, equip))
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
    return dict(vendazero), {r: dict(v) for r, v in ativos.items()}, vz_meta


# ------------------------------------------------------------------ tudo junto
def carregar(cons: Consulta, agora: datetime, rota: str | None = None, so_online: bool = False,
             fechamento: str | None = None) -> Fontes:
    hoje = agora.date()
    anomes = hoje.strftime("%Y%m")
    online = Online(atualizado_em=agora, fechamento_mes=fechamento)

    if so_online:
        segmento = carregar_vendas(cons, anomes, list(M.GC_ORIGEM), rota, online)[-1]
        for d in (online.clientes, online.qualquer, online.volume):
            for r in [r for r in d if not M.rota_do_painel(r)]:
                del d[r]
        return Fontes(cal=calmod.calcular_local(hoje), clientes=[], cobertos={}, compraram={}, metas={},
                      volume={}, volume_cliente={}, online=online, segmento_venda=segmento)

    cal = carregar_calendario(cons, hoje)
    clientes, gcs = carregar_clientes(cons, rota)
    rotas_painel = {c.rota for c in clientes}
    cobertos, compraram, vol_real, vol_cli, segmento = carregar_vendas(cons, anomes, gcs, rota, online)
    metas, metas_vol = carregar_metas(cons, anomes, rota)

    volume: dict = defaultdict(dict)
    for r in rotas_painel:
        for k in M.INDICADORES_VOLUME:
            meta, meta_dia = metas_vol.get(r, {}).get(k, (None, None))
            if meta is None and k not in vol_real.get(r, {}):
                continue
            volume[r][k] = VolumeRota(meta=meta, real=vol_real.get(r, {}).get(k, 0.0), meta_dia_hoje=meta_dia)

    gc_da_rota = {c.rota: c.gc for c in clientes}
    vendazero, ativos, vz_meta = None, {}, {}
    try:
        vendazero, ativos, vz_meta = carregar_comodato(cons, anomes, rota, gc_da_rota)
    except Exception as erro:   # noqa: BLE001
        log.warning("Comodato indisponível (%s); Venda Zero ficará indisponível nesta execução.", erro)

    def so_painel(d: dict) -> dict:
        return {r: v for r, v in d.items() if r in rotas_painel}

    # a rota "online" também se restringe às rotas do painel
    online.clientes = so_painel(online.clientes)
    online.qualquer = so_painel(online.qualquer)
    online.volume = so_painel(online.volume)
    return Fontes(cal=cal, clientes=clientes, cobertos={r: dict(v) for r, v in so_painel(cobertos).items()},
                  compraram=so_painel(compraram), metas=so_painel(dict(metas)), volume=dict(volume),
                  volume_cliente={r: dict(v) for r, v in so_painel(vol_cli).items()}, online=online,
                  vendazero=so_painel(vendazero) if vendazero is not None else None,
                  vz_meta=vz_meta, comodato_ativos=so_painel(ativos), segmento_venda=segmento)
