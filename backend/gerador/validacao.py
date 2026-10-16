"""
validacao.py — Confere os JSONs antes de publicar.

Se algo estiver errado (consulta vazia, mapeamento quebrado, queda brusca de
clientes/rotas), o gerador NÃO grava e termina com erro: o site continua com a
última versão boa e o GitHub Actions marca a execução como falha (e-mail de aviso).
"""
from __future__ import annotations

import re

from . import mapeamento as M

CHAVES_PAYLOAD = ["MES_LABEL", "TOTAL_DIAS_UTEIS", "DIA_ONTEM", "DIA_HOJE", "PACE_ONTEM_PCT", "SEMANA_NUM",
                  "SEMANA_TIPO", "DIA_SEMANA", "GC_ATIVAS", "NOME_SUPERVISOR", "DATA", "LABELS", "GROUPS",
                  "COV_GRUPO", "LABELS_CURTO", "SEGS", "DIAS", "CLIENT_ROSTER", "CLIENTES_HOJE",
                  "OPORTUNIDADES_DIA", "VISITAS_DIA", "COBERTOS", "SEM_COMPRA_HOJE", "VENDAZERO_CLIENTES",
                  "COMODATO_ATIVOS", "REVERTIDO_HOJE", "OPORTUNIDADE_HOJE", "VOLUME_CLIENTE", "REDES_CLIENTE",
                  "FONTES"]

# limites de queda em relação à versão publicada (mesmo mês)
MIN_ROTAS = 0.8
MIN_CLIENTES = 0.7
MIN_INDICADORES_DISPONIVEIS = 0.5


def _rotas(p: dict) -> dict:
    return {r: d for svs in p.get("DATA", {}).values() for rotas in svs.values() for r, d in rotas.items()}


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
        if list(d["indicators"]) != M.ORDEM_INDICADORES:
            erros.append(f"rota {r}: indicadores fora do padrão")
            break

    cob = [d["indicators"][k] for d in rotas.values() for k in M.INDICADORES_COBERTURA]
    disp = sum(1 for b in cob if not b["unavailable"]) / max(1, len(cob))
    if disp < MIN_INDICADORES_DISPONIVEIS:
        erros.append(f"só {disp:.0%} dos indicadores de cobertura têm meta (mapeamento de agrupador/meta?)")
    vol = [d["indicators"][k] for d in rotas.values() for k in M.INDICADORES_VOLUME]
    if vol and all(b["unavailable"] for b in vol):
        erros.append("nenhuma rota com meta de volume (mapeamento de volume?)")
    if all(not v for v in novo["COBERTOS"].values()):
        erros.append("nenhum cliente coberto no mês (medida de cobertura?)")
    if not novo["FONTES"].get("vendazero"):
        avisos.append("Venda Zero indisponível nesta execução (fonte de comodato falhou)")
    if sum(novo["VISITAS_DIA"]["geral"].values()) == 0:
        avisos.append("nenhuma visita agendada hoje (fim de semana/feriado ou VISITA_HOJE mudou?)")

    if anterior and anterior.get("MES_LABEL") == novo["MES_LABEL"]:
        rotas_ant = _rotas(anterior)
        base_ant = sum(d.get("baseTotal", 0) for d in rotas_ant.values())
        if rotas_ant and len(rotas) < MIN_ROTAS * len(rotas_ant):
            erros.append(f"rotas caíram de {len(rotas_ant)} para {len(rotas)}")
        if base_ant and base < MIN_CLIENTES * base_ant:
            erros.append(f"clientes na base caíram de {base_ant} para {base}")
        sumiram = sorted(set(rotas_ant) - set(rotas))
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
