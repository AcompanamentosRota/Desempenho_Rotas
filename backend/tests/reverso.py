"""
reverso.py — Reconstrói as Fontes normalizadas a partir de um payload.json + online.json já publicados.

Serve para testar payload.py/online.py sem rede: se montar_payload(reverso(p)) == p,
a montagem reproduz fielmente o formato e as fórmulas do arquivo que o painel já usava.
"""
from __future__ import annotations

from datetime import date, datetime

from gerador import mapeamento as M
from gerador.tipos import Calendario, Cliente, Equipamento, Fontes, Online, VolumeRota


def online_de(o: dict) -> Online:
    clientes, qualquer = {}, {}
    for r, por_ind in o.get("clientes", {}).items():
        clientes[r] = {k: set(v) for k, v in por_ind.items() if k != "QUALQUER"}
        qualquer[r] = set(por_ind.get("QUALQUER", []))
    return Online(
        atualizado_em=datetime.fromisoformat(o["updatedAt"]),
        clientes=clientes, qualquer=qualquer,
        volume={r: dict(v) for r, v in o.get("volume", {}).items()},
        fechamento_mes=o.get("fechamentoMes"),
    )


def fontes_de(p: dict, o: dict, hoje: date) -> Fontes:
    cal = Calendario(hoje=hoje, total_dias_uteis=p["TOTAL_DIAS_UTEIS"], dia_hoje=p["DIA_HOJE"],
                     dia_ontem=p["DIA_ONTEM"], semana_num=p["SEMANA_NUM"], semana_tipo=p["SEMANA_TIPO"],
                     dia_semana=p["DIA_SEMANA"], mes_label=p["MES_LABEL"])
    rede_de = {(r, pv): nome for r, g in p["REDES_CLIENTE"].items() for nome, x in (g or {}).items()
               for pv in x["clientes"]}
    clientes, cobertos, compraram, metas, volume, volume_cliente = [], {}, {}, {}, {}, {}
    vendazero, vz_meta, ativos = {}, {}, {}
    for gc, svs in p["DATA"].items():
        for sv, rotas in svs.items():
            for r, d in rotas.items():
                roster = p["CLIENT_ROSTER"][r]
                for c in roster:
                    clientes.append(Cliente(
                        pv=c[0], nome=c[1], rota=r, gc=gc, sv=sv, nome_sv=p["NOME_SUPERVISOR"][sv],
                        consultor=d["consultor"], segmento=p["SEGS"][c[2]], dia_visita=p["DIAS"][c[3]],
                        visita_hoje=c[4] == 1, rede=rede_de.get((r, c[0]), "")))
                cobertos[r] = {k: set(v) for k, v in (p["COBERTOS"].get(r) or {}).items()}
                if d["compraram"] is not None:
                    sem_hoje = set(p["SEM_COMPRA_HOJE"][r] or [])
                    hoje_pvs = {c[0] for c in p["CLIENTES_HOJE"][r]}
                    comprou = hoje_pvs - sem_hoje
                    resto = [c[0] for c in roster if c[0] not in hoje_pvs]
                    comprou |= set(resto[: d["compraram"] - len(comprou)])
                    compraram[r] = comprou
                metas[r] = {k: d["indicators"][k]["meta"] for k in M.INDICADORES_COBERTURA
                            if not d["indicators"][k]["unavailable"]}
                volume[r] = {}
                for k in M.INDICADORES_VOLUME:
                    b = d["indicators"][k]
                    if b["unavailable"]:
                        continue
                    # tendência do SAC = real + Neg Restante: o restante sai da tendência publicada
                    restante = None if b.get("tendencia") is None else b["tendencia"] - b["real"]
                    volume[r][k] = VolumeRota(meta=b["meta"], real=b["real"], neg_restante=restante,
                                              meta_dia_hoje=b["metaDia"], meta_rota=b.get("metaRota"))
                volume_cliente[r] = {
                    int(pv): {k: (bl[0], bl[1]) for k, bl in zip(M.INDICADORES_VOLUME, blocos) if bl is not None}
                    for pv, blocos in p["VOLUME_CLIENTE"][r].items()
                }
                vendazero[r] = [Equipamento(pv=e["pv"], nome=e["nome"], dia=e["dia"], hoje=e["hoje"] == 1,
                                            tipo=e["tipo"], vdz=e["vdz"], meta_comodato=e["metaComodato"],
                                            volume=e["volume"])
                                for e in (p["VENDAZERO_CLIENTES"].get(r) or [])]
                if not d["indicators"]["VENDAZERO"]["unavailable"]:
                    vz_meta[r] = d["indicators"]["VENDAZERO"]["meta"]
                ativos[r] = {int(pv): n for pv, n in (p["COMODATO_ATIVOS"].get(r) or {}).items()}
    return Fontes(cal=cal, clientes=clientes, cobertos=cobertos, compraram=compraram, metas=metas,
                  volume=volume, volume_cliente=volume_cliente, online=online_de(o),
                  vendazero=vendazero, vz_meta=vz_meta, comodato_ativos=ativos)
