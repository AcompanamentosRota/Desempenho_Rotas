"""
validacao.py — Confere os JSONs antes de publicar.

Se algo estiver errado (consulta vazia, mapeamento quebrado, queda brusca de
clientes/rotas), o gerador NÃO grava e termina com erro: o site continua com a
última versão boa e o GitHub Actions marca a execução como falha (e-mail de aviso).

Gerência de M.GC_ATIVAS sem rotas, sem metas ou sem Real gera só aviso (uma gerência nova não para o
painel). As quedas são medidas por gerência, só para as que já estavam na versão publicada.
"""
from __future__ import annotations

import math
import re

from . import mapeamento as M
from .texto import normalizar

CHAVES_PAYLOAD = ["MES_LABEL", "TOTAL_DIAS_UTEIS", "DIA_ONTEM", "DIA_HOJE", "PACE_ONTEM_PCT", "SEMANA_NUM",
                  "SEMANA_TIPO", "DIA_SEMANA", "GC_ATIVAS", "NOME_SUPERVISOR", "DATA", "LABELS", "GROUPS",
                  "COV_GRUPO", "LABELS_CURTO", "SEGS", "DIAS", "CLIENT_ROSTER", "CLIENTES_HOJE",
                  "OPORTUNIDADES_DIA", "VISITAS_DIA", "COBERTOS", "SEM_COMPRA_HOJE", "VENDAZERO_CLIENTES",
                  "COMODATO_ATIVOS", "REVERTIDO_HOJE", "OPORTUNIDADE_HOJE", "VOLUME_CLIENTE", "REDES_CLIENTE",
                  "FONTES", "FECHAMENTO", "GC_NOMES", "NEUTRALIZA_ROTAS", "VIRTUAIS_ROTAS", "EVENTUAIS_ROTAS", "OCULTAS",
                  "VOLUME_EXTRA", "COMODATO_CLIENTE"]

# limites de queda em relação à versão publicada do MESMO mês de referência (MES_LABEL);
# na virada (fechamento -> mês novo, ou mês anterior -> fechamento) a queda só gera aviso
MIN_ROTAS = 0.8
MIN_CLIENTES = 0.7
MIN_VOLUME = 0.7
MIN_INDICADORES_DISPONIVEIS = 0.5


def _rotas(p: dict) -> dict:
    return {r: d for svs in p.get("DATA", {}).values() for rotas in svs.values() for r, d in rotas.items()}


def _rotas_por_gc(p: dict) -> dict[str, dict]:
    return {gc: {r: d for rotas in svs.values() for r, d in rotas.items()} for gc, svs in p.get("DATA", {}).items()}


def _tem_meta(rotas: dict) -> bool:
    return any(not (d.get("indicators", {}).get(k) or {"unavailable": True}).get("unavailable", True)
               for d in rotas.values() for k in M.INDICADORES_COBERTURA + M.INDICADORES_VOLUME)


def _gerencias(novo: dict) -> list[str]:
    """Avisos de gerência sem rotas, sem metas ou sem Real (gerência nova não reprova)."""
    avisos = []
    por_gc = _rotas_por_gc(novo)
    for gc in M.GC_ATIVAS:
        rotas = por_gc.get(gc)
        if not rotas:
            avisos.append(f"{gc}: gerência sem rotas na base de clientes")
            continue
        if not _tem_meta(rotas):
            avisos.append(f"{gc}: gerência sem metas (cobertura e volume)")
        if not _volume_real(rotas) and not any((novo["COBERTOS"].get(r) or {}) for r in rotas):
            avisos.append(f"{gc}: gerência sem Real no mês (volume e cobertura)")
    return avisos


def _incentivo(p: dict) -> list[str]:
    """Aba Incentivo: aviso só para o item sem meta em NENHUMA rota da BAND. Gerência sem meta do item (BARRACUDA não
    tem meta de Heineken) não é erro nem aviso."""
    rotas = _rotas(p)
    return [f"Incentivo: {M.LABELS.get(k, k)} sem meta em nenhuma rota da BAND (o item fica \"Sem meta\" em todo o painel)"
            for k in M.GROUPS["INCENTIVO"]
            if not any(not b.get("unavailable", True) and (b.get("meta") or 0) > 0
                       for b in ((d.get("indicators") or {}).get(k) or {"unavailable": True} for d in rotas.values()))]


TOL_NEG_HOJE = 0.1   # caixas: negHoje e negRestante saem com 1 casa cada


def _neg_hoje(p: dict) -> list[str]:
    """negHoje (Neg de hoje, chave opcional do volume): aviso por rota x macro fora de 0 <= negHoje <= negRestante
    (com a tolerância do arredondamento de 1 casa); nunca reprova. Sem o campo (payload antigo) ou null: nada a conferir."""
    fora = []
    for r, d in _rotas(p).items():
        for k in M.INDICADORES_VOLUME_TODOS:
            b = (d.get("indicators") or {}).get(k) or {}
            nh, rest = b.get("negHoje"), b.get("negRestante")
            if b.get("unavailable") or nh is None:
                continue
            if nh < -TOL_NEG_HOJE or (rest is not None and nh > rest + TOL_NEG_HOJE):
                fora.append(f"{r}/{M.LABELS.get(k) or M.VOLUME_EXTRA[k]['label']} ({nh:,.1f} x {rest if rest is None else f'{rest:,.1f}'})")
    if not fora:
        return []
    return [f"negHoje fora de 0..negRestante em {len(fora)} rota(s) x macro (negHoje x negRestante): "
            + ", ".join(fora[:20]) + (" …" if len(fora) > 20 else "")]


def _sem_compra_mes(p: dict) -> list[str]:
    """SEM_COMPRA_MES (chave opcional): aviso, nunca erro, se o tamanho da lista da rota for diferente de semCompra ou
    se o SEM_COMPRA_HOJE da rota não estiver contido nela. Payload sem a chave: nada."""
    scm = p.get("SEM_COMPRA_MES")
    if scm is None:
        return []
    tamanho, fora = [], []
    for r, d in _rotas(p).items():
        lista = scm.get(r)
        if (None if lista is None else len(lista)) != d.get("semCompra"):
            tamanho.append(r)
        hoje = (p.get("SEM_COMPRA_HOJE") or {}).get(r) or []
        if hoje and not set(hoje) <= set(lista or []):
            fora.append(r)
    avisos = []
    if tamanho:
        avisos.append(f"SEM_COMPRA_MES com tamanho diferente de semCompra em {len(tamanho)} rota(s): "
                      f"{', '.join(tamanho[:20])}")
    if fora:
        avisos.append(f"SEM_COMPRA_HOJE fora do SEM_COMPRA_MES em {len(fora)} rota(s): {', '.join(fora[:20])}")
    return avisos


def _mes_anterior(p: dict) -> tuple[list[str], list[str]]:
    """MES_ANTERIOR (chave opcional, só Volume): (erros, avisos). Aviso se faltar com dia útil fechado (DIA_ONTEM > 0),
    se o Real BAND do mês anterior for 0 ou se alguma meta vier negativa; erro só para NaN/inf ou Real negativo (o
    gerador já tira a chave nesses casos, então o erro só pega um payload montado por fora). Nenhuma chave obrigatória."""
    ma = p.get(M.CHAVE_MES_ANTERIOR)
    if ma is None:
        return [], ([f"{M.CHAVE_MES_ANTERIOR} ausente (consulta do mês anterior falhou ou passou do limite?): a "
                     "Executiva fica sem a comparação"] if (p.get("DIA_ONTEM") or 0) > 0 else [])
    erros, ruins, negativos, metas_neg, real = [], [], [], [], 0.0
    for r, vals in (ma.get("ROTAS") or {}).items():
        for par in vals or []:
            if par is None:
                continue
            v, m = par
            for x in (v, m):
                if x is not None and (not isinstance(x, (int, float)) or not math.isfinite(x)):
                    ruins.append(r)
            if isinstance(v, (int, float)) and math.isfinite(v):
                real += v
                if v < 0:
                    negativos.append(r)
            if isinstance(m, (int, float)) and math.isfinite(m) and m < 0:
                metas_neg.append(r)
    if ruins:
        erros.append(f"{M.CHAVE_MES_ANTERIOR} com valor não finito (NaN/inf) em: {', '.join(sorted(set(ruins))[:20])}")
    if negativos:
        erros.append(f"{M.CHAVE_MES_ANTERIOR} com Real negativo em: {', '.join(sorted(set(negativos))[:20])}")
    avisos = []
    if not ruins and real == 0:
        avisos.append(f"{M.CHAVE_MES_ANTERIOR}: Real BAND de {ma.get('MES_LABEL')} até {ma.get('DATA_CORTE')} = 0 "
                      "(filtro de DATA_MOVIMENTO ou NF_STATUS?)")
    if metas_neg:
        avisos.append(f"{M.CHAVE_MES_ANTERIOR}: meta negativa em {len(set(metas_neg))} rota(s): "
                      f"{', '.join(sorted(set(metas_neg))[:20])}")
    return erros, avisos


def _volume_real(rotas: dict) -> float:
    return sum((d.get("indicators", {}).get(k) or {}).get("real") or 0 for d in rotas.values() for k in M.INDICADORES_VOLUME)


def _meta_nao_distribuida(p: dict) -> dict[str, dict[str, float]]:
    """Por gerência e macro: meta da rota - soma de META_NEG dos clientes (só informativo)."""
    out: dict[str, dict[str, float]] = {}
    for gc, svs in p.get("DATA", {}).items():
        difs = {}
        for k in M.INDICADORES_VOLUME:
            blocos = [d["indicators"].get(k) or {} for rotas in svs.values() for d in rotas.values()]
            blocos = [b for b in blocos if not b.get("unavailable") and b.get("meta") is not None]
            dif = sum(b["meta"] - (b.get("metaNegClientes") or 0) for b in blocos)
            if abs(dif) >= 0.5:
                difs[k] = dif
        if difs:
            out[gc] = difs
    return out


def validar_payload(novo: dict, anterior: dict | None = None) -> tuple[list[str], list[str]]:
    erros, avisos = [], []
    faltando = [k for k in CHAVES_PAYLOAD if k not in novo]
    if faltando:
        return [f"payload sem as chaves: {', '.join(faltando)}"], avisos

    rotas = _rotas(novo)
    if not rotas:
        return ["payload sem nenhuma rota (base de clientes vazia?)"], avisos
    if not (1 <= novo["DIA_HOJE"] <= novo["TOTAL_DIAS_UTEIS"]):
        erros.append(f"DIA_HOJE {novo['DIA_HOJE']} fora de 1..{novo['TOTAL_DIAS_UTEIS']}")

    base = sum(d["baseTotal"] for d in rotas.values())
    if base == 0:
        erros.append("nenhum cliente na base")
    for r, d in rotas.items():
        ks = list(d["indicators"])
        extras = ks[len(M.ORDEM_INDICADORES):]
        if ks[:len(M.ORDEM_INDICADORES)] != M.ORDEM_INDICADORES or extras != [k for k in M.INDICADORES_VOLUME_EXTRA
                                                                               if k in extras]:
            erros.append(f"rota {r}: indicadores fora do padrão")
            break
    ks_tt = {i for i, s in enumerate(novo["SEGS"]) if normalizar(s) in M.SEGMENTOS_KS_TT}
    # rotas ocultas dos clientes em rotas EV*: sem base de clientes (o KS TT delas vem pelo segmento da venda)
    eventuais = set(novo.get("EVENTUAIS_ROTAS") or [])
    ks_fora_seg, ks_acima = [], []
    for r, d in rotas.items():
        seg = {c[0]: c[2] for c in novo["CLIENT_ROSTER"].get(r, [])}
        if any(pv in seg and seg[pv] not in ks_tt for pv in (novo["COBERTOS"].get(r) or {}).get("KS TT", [])):
            ks_fora_seg.append(r)
        real = (d["indicators"].get("KS TT") or {}).get("real")
        if real is not None and real > d["baseKsTt"] and r not in eventuais:
            ks_acima.append(r)
    if ks_fora_seg:
        erros.append(f"KS TT contando cliente de segmento não elegível em {len(ks_fora_seg)} rota(s): "
                     f"{', '.join(ks_fora_seg[:20])}")
    if ks_acima:
        avisos.append(f"KS TT com real acima da base elegível (clientes que saíram da rota) em: {', '.join(ks_acima[:20])}")

    # disponibilidade só nas gerências com alguma meta (as sem meta já viram aviso em _gerencias); as rotas ocultas
    # dos clientes em rotas EV* não têm meta de cobertura (só o Real, nos itens com cliente coberto) e ficam fora
    com_meta = {r: d for g in _rotas_por_gc(novo).values() if _tem_meta(g) for r, d in g.items()
                if r not in eventuais} or rotas
    cob = [d["indicators"][k] for d in com_meta.values() for k in M.INDICADORES_COBERTURA]
    disp = sum(1 for b in cob if not b["unavailable"]) / max(1, len(cob))
    if disp < MIN_INDICADORES_DISPONIVEIS:
        erros.append(f"só {disp:.0%} dos indicadores de cobertura têm meta (mapeamento de agrupador/meta?)")
    vol = [d["indicators"][k] for d in rotas.values() for k in M.INDICADORES_VOLUME]
    if vol and all(b["unavailable"] for b in vol):
        erros.append("nenhuma rota com meta de volume (mapeamento de volume?)")
    if all(not v for v in novo["COBERTOS"].values()):
        erros.append("nenhum cliente coberto no mês (medida de cobertura?)")
    if novo["FECHAMENTO"]:
        avisos.append(f"fechamento do mês: painel em {novo['MES_LABEL']}, sem tendência, meta do dia e Venda Zero")
    elif not novo["FONTES"].get("vendazero"):
        avisos.append("Venda Zero indisponível nesta execução (fonte de comodato falhou)")
    nao_distribuida = _meta_nao_distribuida(novo)
    for gc, difs in nao_distribuida.items():
        avisos.append(f"{gc}: meta da rota não distribuída nos clientes (META_VOLUME - soma META_NEG): "
                      + "; ".join(f"{M.LABELS[k]} {v:,.1f}" for k, v in difs.items()))
    if not novo["FECHAMENTO"] and vol and all(b.get("metaDia") is None for b in vol if not b["unavailable"]):
        avisos.append("meta do dia do volume indisponível (META_RECUPERAVEL_ROTA não veio): metaDia = null")
    avisos += _gerencias(novo)
    avisos += _incentivo(novo)
    avisos += _sem_compra_mes(novo)
    avisos += _neg_hoje(novo)
    e_ma, a_ma = _mes_anterior(novo)
    erros += e_ma
    avisos += a_ma
    if sum(novo["VISITAS_DIA"]["geral"].values()) == 0:
        avisos.append("nenhuma visita agendada hoje (fim de semana/feriado ou VISITA_HOJE mudou?)")

    if anterior:
        rotas_ant = _rotas(anterior)
        por_gc, por_gc_ant = _rotas_por_gc(novo), _rotas_por_gc(anterior)
        quedas = []
        # por gerência; gerência que não estava na versão publicada (nova) não é comparada
        for gc, ant in por_gc_ant.items():
            nov = por_gc.get(gc, {})
            base_ant = sum(d.get("baseTotal", 0) for d in ant.values())
            base_gc = sum(d.get("baseTotal", 0) for d in nov.values())
            vol_ant, vol_novo = _volume_real(ant), _volume_real(nov)
            # nº de rotas sem as rotas ocultas dos clientes em rotas EV* (aparecem e somem com esse Real)
            n_ant = len(set(ant) - set(anterior.get("EVENTUAIS_ROTAS") or []))
            n_novo = len(set(nov) - eventuais)
            if n_ant and n_novo < MIN_ROTAS * n_ant:
                quedas.append(f"{gc}: rotas caíram de {n_ant} para {n_novo}")
            if base_ant and base_gc < MIN_CLIENTES * base_ant:
                quedas.append(f"{gc}: clientes na base caíram de {base_ant} para {base_gc}")
            if vol_ant > 0 and vol_novo < MIN_VOLUME * vol_ant:
                quedas.append(f"{gc}: volume real caiu de {vol_ant:.0f} para {vol_novo:.0f} (NF_STATUS / STATUS_NF_REAL?)")
        if anterior.get("MES_LABEL") == novo["MES_LABEL"]:
            erros += quedas
        else:   # virada do mês de referência: só avisa
            avisos += [f"virada {anterior.get('MES_LABEL')} -> {novo['MES_LABEL']}: {q}" for q in quedas]
        # a rota oculta dos clientes em rotas EV* some quando a gerência fica sem esse Real: não é aviso
        sumiram = sorted(set(rotas_ant) - set(rotas) - set(anterior.get("EVENTUAIS_ROTAS") or []))
        if sumiram:
            avisos.append(f"rotas que saíram: {', '.join(sumiram[:20])}")
    return erros, avisos


def validar_online(novo: dict) -> tuple[list[str], list[str]]:
    erros, avisos = [], []
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", str(novo.get("updatedAt", ""))):
        erros.append(f"updatedAt inválido: {novo.get('updatedAt')!r}")
    for k in ("rotas", "clientes", "volume"):
        if not isinstance(novo.get(k), dict):
            erros.append(f"online.{k} ausente")
    if not erros and not novo["clientes"] and not novo["volume"]:
        avisos.append("nenhuma venda online hoje até agora")
    return erros, avisos
