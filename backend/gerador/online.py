"""
online.py — Monta o online.json (vendas do dia) a partir de Online.

Formato lido pelo front (puxaOnline em frontend/js/app.js):
    updatedAt : "2026-10-13T14:04:07" (horário de Brasília, sem fuso)
    rotas     : {rota: {indicador: nº de clientes com compra hoje}}      (só > 0; inclui as chaves INC do incentivo
                nas rotas com meta do item)
    clientes  : {rota: {indicador: [pv...], "QUALQUER": [pv...]}}       (só listas não vazias; QUALQUER sem o
                incentivo, como sempre só com os 17 agrupadores do painel)
    volume    : {rota: {"VOL ...": volume de hoje}}
    volumeCliente: {rota: {pv: {"VOL ...": volume de hoje}}}  (somado ao Real da barra por cliente no front,
                   fora do fechamento do mês)
    gdmCliente: {rota: {pv: volume de hoje nos agrupadores do Desempenho GDM}}  (somado ao faturado GDM no front)
    fechamentoMes (opcional): "Setembro/26" durante o fechamento do mês (automático) ou pelo --fechamento

Janela de recarga do Datasphere: em dia útil, das 07:00 às 18:45, uma consulta pode voltar sem nenhuma venda
online (19/10/2026: 0 às 09:28 e 199 rotas às 10:13). Se o online.json publicado é do mesmo dia e tem dados,
ele fica (manter_publicado) e o payload da rodada usa o online dele (do_publicado).
"""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, time

from . import calendario
from . import mapeamento as M
from .tipos import Online

JANELA_RECARGA = (time(7, 0), time(18, 45))


def montar_online(o: Online) -> dict:
    rotas_out, clientes_out, volume_out, volume_cli_out, gdm_out = {}, {}, {}, {}, {}
    todas = sorted(set(o.clientes) | set(o.qualquer) | set(o.volume) | set(o.volume_cliente) | set(o.gdm_cliente))
    # cobertura (ICS/NN) e as chaves INC do incentivo (que chegam aqui só nas rotas com meta do item: online_ks_tt)
    ks_cob = M.INDICADORES_COBERTURA + M.INDICADORES_INCENTIVO
    for r in todas:
        por_ind = o.clientes.get(r, {})
        contagem = {k: len(por_ind[k]) for k in ks_cob if por_ind.get(k)}
        if contagem:
            rotas_out[r] = contagem
        listas = {k: sorted(por_ind[k]) for k in ks_cob if por_ind.get(k)}
        # QUALQUER (revertido da Venda Zero, sem compra hoje): só os 17 agrupadores do painel, sem o incentivo
        sem_inc = [v for k, v in por_ind.items() if k not in M.INDICADORES_INCENTIVO]
        qualquer = set(o.qualquer.get(r, set())).union(*sem_inc)
        if qualquer:
            listas["QUALQUER"] = sorted(qualquer)
        if listas:
            clientes_out[r] = listas
        vol = {k: round(o.volume[r][k], 4) for k in M.INDICADORES_VOLUME_TODOS if k in o.volume.get(r, {})}
        if vol:
            volume_out[r] = vol
        por_cli = {}
        for pv, ks in sorted(o.volume_cliente.get(r, {}).items()):
            v = {k: round(ks[k], 4) for k in M.INDICADORES_VOLUME_TODOS if round(ks.get(k, 0.0), 4)}
            if v:
                por_cli[str(pv)] = v
        if por_cli:
            volume_cli_out[r] = por_cli
        gdm = {str(pv): round(v, 4) for pv, v in sorted(o.gdm_cliente.get(r, {}).items()) if round(v, 4)}
        if gdm:
            gdm_out[r] = gdm

    saida = {
        "updatedAt": o.atualizado_em.strftime("%Y-%m-%dT%H:%M:%S"),
        "rotas": rotas_out,
        "clientes": clientes_out,
        "volume": volume_out,
        "volumeCliente": volume_cli_out,
        "gdmCliente": gdm_out,
    }
    if o.fechamento_mes:
        saida["fechamentoMes"] = o.fechamento_mes
    return saida


def sem_vendas(o: Online) -> bool:
    """Consulta sem nenhum cliente online (nem volume) em rota nenhuma."""
    return not any(o.clientes.values()) and not any(o.qualquer.values()) and not any(o.volume.values())


def manter_publicado(novo: Online, publicado: dict | None, agora: datetime) -> str | None:
    """Aviso quando o online.json publicado deve ficar no lugar do `novo`; None = grava o novo (como sempre).

    Fica o publicado só se a consulta veio sem nenhum cliente online, em dia útil, das 07:00 às 18:45, e o
    publicado é do mesmo dia e tem dados.
    """
    if not sem_vendas(novo) or not publicado or not (publicado.get("clientes") or publicado.get("volume")):
        return None
    ini, fim = JANELA_RECARGA
    if not calendario.eh_dia_util(agora.date()) or not ini <= agora.time() <= fim:
        return None
    publicado_em = str(publicado.get("updatedAt", ""))
    if publicado_em[:10] != agora.date().isoformat():
        return None
    return (f"consulta online sem nenhum cliente às {agora:%H:%M} (Datasphere em recarga?): mantido o online.json "
            f"publicado às {publicado_em[11:16]}")


def do_publicado(o: dict, atual: Online) -> Online:
    """Online por rota (clientes por indicador, QUALQUER e volume) do online.json publicado: o payload da mesma
    rodada calcula os revertidos da Venda Zero com o online mantido."""
    por_rota = o.get("clientes", {})
    clientes = {r: {k: set(v) for k, v in listas.items() if k != "QUALQUER"} for r, listas in por_rota.items()}
    qualquer = {r: set(listas.get("QUALQUER", [])) for r, listas in por_rota.items()}
    volume = {r: dict(v) for r, v in o.get("volume", {}).items()}
    return replace(atual, clientes=clientes, qualquer=qualquer, volume=volume)
