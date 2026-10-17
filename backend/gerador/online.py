"""
online.py — Monta o online.json (vendas do dia) a partir de Online.

Formato lido pelo front (puxaOnline em frontend/js/app.js):
    updatedAt : "2026-10-13T14:04:07" (horário de Brasília, sem fuso)
    rotas     : {rota: {indicador: nº de clientes com compra hoje}}      (só > 0)
    clientes  : {rota: {indicador: [pv...], "QUALQUER": [pv...]}}       (só listas não vazias)
    volume    : {rota: {"VOL ...": volume de hoje}}
    volumeCliente: {rota: {pv: {"VOL ...": volume de hoje}}}  (somado ao Real da barra por cliente no front,
                   fora do fechamento do mês)
    fechamentoMes (opcional): "Setembro/26" durante o fechamento do mês (automático) ou pelo --fechamento
"""
from __future__ import annotations

from . import mapeamento as M
from .tipos import Online


def montar_online(o: Online) -> dict:
    rotas_out, clientes_out, volume_out, volume_cli_out = {}, {}, {}, {}
    todas = sorted(set(o.clientes) | set(o.qualquer) | set(o.volume) | set(o.volume_cliente))
    for r in todas:
        por_ind = o.clientes.get(r, {})
        contagem = {k: len(por_ind[k]) for k in M.INDICADORES_COBERTURA if por_ind.get(k)}
        if contagem:
            rotas_out[r] = contagem
        listas = {k: sorted(por_ind[k]) for k in M.INDICADORES_COBERTURA if por_ind.get(k)}
        qualquer = set(o.qualquer.get(r, set())).union(*por_ind.values()) if por_ind else set(o.qualquer.get(r, set()))
        if qualquer:
            listas["QUALQUER"] = sorted(qualquer)
        if listas:
            clientes_out[r] = listas
        vol = {k: round(o.volume[r][k], 4) for k in M.INDICADORES_VOLUME if k in o.volume.get(r, {})}
        if vol:
            volume_out[r] = vol
        por_cli = {}
        for pv, ks in sorted(o.volume_cliente.get(r, {}).items()):
            v = {k: round(ks[k], 4) for k in M.INDICADORES_VOLUME if round(ks.get(k, 0.0), 4)}
            if v:
                por_cli[str(pv)] = v
        if por_cli:
            volume_cli_out[r] = por_cli

    saida = {
        "updatedAt": o.atualizado_em.strftime("%Y-%m-%dT%H:%M:%S"),
        "rotas": rotas_out,
        "clientes": clientes_out,
        "volume": volume_out,
        "volumeCliente": volume_cli_out,
    }
    if o.fechamento_mes:
        saida["fechamentoMes"] = o.fechamento_mes
    return saida
