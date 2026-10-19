"""
payload.py — Monta o payload.json (base do mês) a partir das Fontes normalizadas.

O formato é exatamente o que o front lê (frontend/js/main.js -> aplicaPayload):
mesmas chaves, mesma ordem, mesmos índices de SEGS/DIAS e mesmas fórmulas
(modelo.py). Não grava nada: devolve um dict pronto para saida.gravar().

Cobertura (COBERTOS e o real de cada indicador) conta para a rota da venda, mesmo de cliente
transferido ou desativado; no KS TT, só PVs dos segmentos elegíveis (M.SEGMENTOS_KS_TT).
O online.json segue a mesma regra (online_ks_tt).

Volume (critério do SAC, modelo.indicador_volume): meta = Meta NEG, real = Vol Real, tendência =
Vol Real + Neg Restante. No fechamento do mês (FECHAMENTO = true) todo o payload é do mês anterior:
sem tendência e sem meta do dia, Venda Zero indisponível.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import replace

from . import mapeamento as M
from . import modelo
from .texto import limpar, normalizar
from .tipos import Cliente, Fontes, Online


class TabelaIndice:
    """SEGS / DIAS: lista cujo índice vai dentro de cada cliente. Só cresce no fim."""

    def __init__(self, inicial: list[str]):
        self.valores = list(inicial)
        self._pos = {normalizar(v): i for i, v in enumerate(self.valores)}

    def indice(self, valor: str) -> int:
        chave = normalizar(valor)
        if chave not in self._pos:
            self._pos[chave] = len(self.valores)
            self.valores.append(limpar(valor))
        return self._pos[chave]


def _mais_comum(valores: list[str]) -> str:
    valores = [v for v in valores if v]
    return Counter(valores).most_common(1)[0][0] if valores else ""


def _ordem_gc(gcs: set[str]) -> list[str]:
    fixas = [g for g in M.GC_ATIVAS if g in gcs]
    return fixas + sorted(gcs - set(fixas))


def _indices_ks_tt(segs: list[str]) -> set[int]:
    return {i for i, s in enumerate(segs) if normalizar(s) in M.SEGMENTOS_KS_TT}


def _filtra_ks_tt(por_ind: dict[str, set[int]], seg_roster: dict[int, int], ks_tt: set[int],
                  segmento_venda: dict[int, str]) -> dict[str, set[int]]:
    """KS TT só com PVs dos segmentos elegíveis; os demais indicadores passam inteiros. A meta não passa por aqui.

    O segmento é o da base (roster da rota: índice de SEGS); para quem saiu dela, o da venda.
    """
    def elegivel(pv: int) -> bool:
        if pv in seg_roster:
            return seg_roster[pv] in ks_tt
        return normalizar(segmento_venda.get(pv)) in M.SEGMENTOS_KS_TT

    return {k: {pv for pv in pvs if elegivel(pv)} if k == "KS TT" else set(pvs) for k, pvs in por_ind.items()}


def online_ks_tt(o: Online, p: dict | None, segmento_venda: dict[int, str]) -> Online:
    """Online por indicador com a mesma regra do COBERTOS, pelo roster do payload `p`
    (sem payload, vale só o segmento da venda).

    QUALQUER (revertido do Venda Zero, sem compra hoje) continua com todo PV que comprou hoje.
    """
    ks_tt = _indices_ks_tt(p["SEGS"]) if p else set()
    clientes, qualquer = {}, dict(o.qualquer)
    for r, por_ind in o.clientes.items():
        seg_roster = {c[0]: c[2] for c in p["CLIENT_ROSTER"].get(r, [])} if p else {}
        clientes[r] = _filtra_ks_tt(por_ind, seg_roster, ks_tt, segmento_venda)
        qualquer[r] = set(o.qualquer.get(r, set())).union(*por_ind.values())
    return replace(o, clientes=clientes, qualquer=qualquer)


def montar_payload(f: Fontes) -> dict:
    cal = f.cal
    segs, dias = TabelaIndice(M.SEGS_INICIAL), TabelaIndice(M.DIAS_INICIAL)

    # ---- clientes por rota (sem duplicar PV) e árvore GC > SV > rota
    por_rota: dict[str, dict[int, Cliente]] = defaultdict(dict)
    for c in f.clientes:
        por_rota[c.rota].setdefault(c.pv, c)
    rotas = sorted(por_rota)

    info_rota = {}
    nomes_sv: dict[str, list[str]] = defaultdict(list)
    for r in rotas:
        cs = list(por_rota[r].values())
        gc = _mais_comum([c.gc for c in cs])
        sv = _mais_comum([c.sv for c in cs])
        info_rota[r] = (gc, sv, _mais_comum([c.consultor for c in cs]))
        nomes_sv[sv] += [c.nome_sv for c in cs]

    arvore: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for r in rotas:
        gc, sv, _ = info_rota[r]
        arvore[gc][sv].append(r)
    ordem_gc = _ordem_gc(set(arvore))

    roster, clientes_hoje, visitas_geral = {}, {}, {}
    for r in rotas:
        cs = sorted(por_rota[r].values(), key=lambda c: c.pv)
        roster[r] = [[c.pv, c.nome, segs.indice(c.segmento), dias.indice(c.dia_visita), 1 if c.visita_hoje else 0]
                     for c in cs]
        clientes_hoje[r] = [linha for linha in roster[r] if linha[4] == 1]
        visitas_geral[r] = len(clientes_hoje[r])

    ks_tt = _indices_ks_tt(segs.valores)

    # ---- Venda Zero (revertido = cliente com venda online hoje)
    vz_ativo = f.vendazero is not None
    vendazero_clientes, revertido_hoje, oportunidade_hoje = {}, {}, {}
    for r in rotas:
        qualquer = f.online.qualquer.get(r, set()) | set().union(*f.online.clientes.get(r, {}).values())
        lista = []
        for e in sorted((f.vendazero or {}).get(r, []), key=lambda e: (e.pv, e.tipo)):
            lista.append({
                "pv": e.pv, "nome": e.nome, "dia": e.dia, "hoje": 1 if e.hoje else 0, "tipo": e.tipo,
                "vdz": e.vdz, "metaComodato": modelo._r1(e.meta_comodato), "volume": modelo._r1(e.volume),
                "dif": modelo._r1(e.meta_comodato - e.volume), "revertido": e.pv in qualquer,
            })
        if lista:
            vendazero_clientes[r] = lista
        revertido_hoje[r] = sum(e["vdz"] for e in lista if e["revertido"])
        oportunidade_hoje[r] = sum(e["vdz"] for e in lista if e["hoje"] == 1 and not e["revertido"])

    # ---- nós por rota
    data: dict = {}
    cobertos_out, oportunidades, sem_compra_hoje, visitas_sem = {}, {}, {}, {}
    volume_cliente, redes_out, comodato_out, comodato_cliente = {}, {}, {}, {}
    for gc in ordem_gc:
        data[gc] = {}
        for sv in sorted(arvore[gc]):
            data[gc][sv] = {}
            for r in sorted(arvore[gc][sv]):
                lista_roster = roster[r]
                pvs_roster = {c[0] for c in lista_roster}
                cob = _filtra_ks_tt(f.cobertos.get(r, {}), {c[0]: c[2] for c in lista_roster}, ks_tt,
                                    f.segmento_venda)

                # compras do mês (rota sem nenhuma venda no mês = sem dado)
                if r in f.compraram:
                    comprou = f.compraram[r] & pvs_roster
                    n_comp = len(comprou)
                    sch = [c[0] for c in clientes_hoje[r] if c[0] not in comprou]
                    sem_compra_hoje[r], visitas_sem[r] = sch, len(sch)
                else:
                    n_comp = None
                    sem_compra_hoje[r], visitas_sem[r] = None, None

                ind = {}
                metas_rota = f.metas.get(r, {})
                for k in M.INDICADORES_COBERTURA:
                    ind[k] = modelo.indicador_cobertura(metas_rota.get(k), len(cob.get(k, ())), cal,
                                                        rota_tem_meta=bool(metas_rota))
                ind["IMPERDOAVEIS"] = modelo.cobertura_indisponivel()
                vz_lista = vendazero_clientes.get(r, [])
                ind["VENDAZERO"] = modelo.indicador_vendazero(
                    f.vz_meta.get(r) if vz_ativo else None, sum(e["vdz"] for e in vz_lista),
                    revertido_hoje[r], oportunidade_hoje[r])
                vol_online = f.online.volume.get(r)
                # volume extra (Del Valle Frut): só quando a montagem trouxe o dado (gerências de M.VOLUME_EXTRA)
                ks_vol = M.INDICADORES_VOLUME + [k for k in M.INDICADORES_VOLUME_EXTRA if k in f.volume.get(r, {})]
                for k in ks_vol:
                    v = f.volume.get(r, {}).get(k)
                    sem_dado = bool(v is not None and v.meta is not None and round(v.real, 1) == 0
                                    and vol_online is not None and k not in vol_online)
                    ind[k] = modelo.indicador_volume(v, cal, sem_dado)

                data[gc][sv][r] = {
                    "consultor": info_rota[r][2],
                    "baseTotal": len(lista_roster),
                    "baseKsTt": sum(1 for c in lista_roster if c[2] in ks_tt),
                    "compraram": n_comp,
                    "semCompra": None if n_comp is None else len(lista_roster) - n_comp,
                    "indicators": ind,
                }

                cobertos_out[r] = {k: sorted(cob[k]) for k in M.INDICADORES_COBERTURA if cob.get(k)}
                op = {}
                for k in M.INDICADORES_COBERTURA:
                    ja = cob.get(k, set())
                    op[k] = sum(1 for c in clientes_hoje[r]
                                if c[0] not in ja and (k != "KS TT" or c[2] in ks_tt))
                oportunidades[r] = op

                vc = f.volume_cliente.get(r, {})
                volume_cliente[r] = {
                    str(c[0]): [modelo.bloco_volume_cliente(*vc[c[0]][k], cal.pace_ontem_pct)
                                if c[0] in vc and k in vc[c[0]] else None
                                for k in ks_vol]
                    for c in lista_roster
                }

                redes: dict[str, list[int]] = defaultdict(list)
                for cl in sorted(por_rota[r].values(), key=lambda c: c.pv):
                    if cl.rede:
                        redes[cl.rede].append(cl.pv)
                redes_out[r] = {nome: {"nome": nome, "clientes": pvs} for nome, pvs in sorted(redes.items())}

                ativos = f.comodato_ativos.get(r)
                if ativos:
                    comodato_out[r] = {str(pv): n for pv, n in sorted(ativos.items())}
                # Desempenho GDM e tag de geladeira: só clientes do roster (os que a busca encontra)
                cc = {str(pv): [modelo._r1(m), modelo._r1(real), sit, n]
                      for pv, (m, real, sit, n) in sorted(f.comodato_cliente.get(r, {}).items()) if pv in pvs_roster}
                if cc:
                    comodato_cliente[r] = cc

    fontes = dict(M.FONTES_PADRAO)
    fontes["vendazero"] = vz_ativo
    rotas_ord = [r for gc in data for sv in data[gc] for r in data[gc][sv]]

    def por_ordem(d: dict) -> dict:
        return {r: d[r] for r in rotas_ord if r in d}

    return {
        "MES_LABEL": cal.mes_label,
        "TOTAL_DIAS_UTEIS": cal.total_dias_uteis,
        "DIA_ONTEM": cal.dia_ontem,
        "DIA_HOJE": cal.dia_hoje,
        "PACE_ONTEM_PCT": cal.pace_ontem_pct,
        "SEMANA_NUM": cal.semana_num,
        "SEMANA_TIPO": cal.semana_tipo,
        "DIA_SEMANA": cal.dia_semana,
        "GC_ATIVAS": ordem_gc,
        "NOME_SUPERVISOR": {sv: _mais_comum(nomes_sv[sv]) for gc in data for sv in data[gc]},
        "DATA": data,
        "LABELS": M.LABELS,
        "GROUPS": M.GROUPS,
        "COV_GRUPO": M.COV_GRUPO,
        "LABELS_CURTO": M.LABELS_CURTO,
        "SEGS": segs.valores,
        "DIAS": dias.valores,
        "CLIENT_ROSTER": por_ordem(roster),
        "CLIENTES_HOJE": por_ordem(clientes_hoje),
        "OPORTUNIDADES_DIA": por_ordem(oportunidades),
        "VISITAS_DIA": {"geral": por_ordem(visitas_geral), "semCompra": por_ordem(visitas_sem)},
        "COBERTOS": por_ordem(cobertos_out),
        "SEM_COMPRA_HOJE": por_ordem(sem_compra_hoje),
        "VENDAZERO_CLIENTES": por_ordem(vendazero_clientes),
        "COMODATO_ATIVOS": por_ordem(comodato_out),
        "REVERTIDO_HOJE": por_ordem(revertido_hoje),
        "OPORTUNIDADE_HOJE": por_ordem(oportunidade_hoje),
        "VOLUME_CLIENTE": por_ordem(volume_cliente),
        "REDES_CLIENTE": por_ordem(redes_out),
        "FONTES": fontes,
        "FECHAMENTO": cal.fechamento,
        "GC_NOMES": M.GC_NOMES,
        "NEUTRALIZA_ROTAS": M.NEUTRALIZA_ROTAS,
        "VIRTUAIS_ROTAS": M.VIRTUAIS_ROTAS,
        "OCULTAS": M.OCULTAS,
        "GC_SEM_OCULTAS": M.GC_SEM_OCULTAS,
        "VOLUME_EXTRA": M.VOLUME_EXTRA,
        "COMODATO_CLIENTE": por_ordem(comodato_cliente),
    }
