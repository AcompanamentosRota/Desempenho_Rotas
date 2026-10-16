"""
descobrir.py — Confere o mapeamento (gerador/mapeamento.py) contra os dados REAIS do Datasphere.

Rode antes de ligar a atualização automática e sempre que o modelo mudar:

    python scripts/descobrir.py                 # tudo, sondando a rota 111
    python scripts/descobrir.py --rota 211

O que faz (relatório em saida/descoberta/relatorio.md + JSONs com os valores):
  1. Colunas: toda coluna usada no mapeamento existe no $metadata de cada modelo?
  2. Valores distintos das dimensões-chave (agrupadores, GC, supervisor, segmento,
     dia de visita, VISITA_HOJE, giro do comodato, calendário...) com totais das medidas.
  3. Cruza com o painel publicado (frontend/data): agrupador -> indicador, GC/SV,
     segmentos, dias de visita, nº de clientes.
  4. Sonda uma rota de ponta a ponta: gera o nó da rota com o gerador e mostra lado a
     lado com o que está publicado (meta, real, %, volume, Venda Zero, online).
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gerador import calendario, fontes  # noqa: E402
from gerador import mapeamento as M  # noqa: E402
from gerador.consulta import Consulta, eq  # noqa: E402
from gerador.online import montar_online  # noqa: E402
from gerador.payload import montar_payload  # noqa: E402
from gerador.texto import normalizar  # noqa: E402
from odata.config import PASTA_SAIDA, carregar_config  # noqa: E402
from odata.log import configurar_log  # noqa: E402

CM, CB, CO, CC = M.ColMeta, M.ColBase, M.ColComodato, M.ColCalendario
PASTA = PASTA_SAIDA / "descoberta"
REF = Path(__file__).resolve().parents[2] / "frontend" / "data"


def _cols(classe) -> list[str]:
    return sorted({v for k, v in vars(classe).items() if not k.startswith("_") and isinstance(v, str)})


class Relatorio:
    def __init__(self):
        self.linhas: list[str] = []

    def h(self, t: str):
        self.linhas += ["", f"## {t}", ""]
        print(f"\n== {t}")

    def p(self, t: str = ""):
        self.linhas.append(t)
        print(t)

    def tabela(self, cab: list[str], linhas: list[list]):
        self.p("| " + " | ".join(cab) + " |")
        self.p("|" + "---|" * len(cab))
        for l in linhas:
            self.p("| " + " | ".join("" if x is None else str(x) for x in l) + " |")

    def salvar(self):
        PASTA.mkdir(parents=True, exist_ok=True)
        (PASTA / "relatorio.md").write_text("# Descoberta do mapeamento\n" + "\n".join(self.linhas), encoding="utf-8")


def distintos(cons: Consulta, objeto: str, dim: str, medidas: list[str], filtro: str | None, top: int = 3000):
    existentes = set(cons.colunas(objeto))
    meds = [m for m in medidas if m in existentes]
    if dim not in existentes:
        return None
    linhas = cons.linhas(objeto, [dim] + meds, filtro, top=top)
    agg: dict = {}
    for l in linhas:
        v = l.get(dim)
        a = agg.setdefault(v, [0] + [0.0] * len(meds))
        a[0] += 1
        for i, m in enumerate(meds):
            try:
                a[i + 1] += float(l.get(m) or 0)
            except (TypeError, ValueError):
                pass
    return meds, sorted(agg.items(), key=lambda x: str(x[0]))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rota", default="111", help="rota usada na sondagem (padrão 111)")
    ap.add_argument("--anomes", help="AAAAMM (padrão: mês atual)")
    args = ap.parse_args()
    log = configurar_log("descobrir")
    cfg = carregar_config()
    M.OBJ_META = cfg.objeto
    cons = Consulta(cfg)
    agora = calendario.agora()
    anomes = args.anomes or agora.strftime("%Y%m")
    rel = Relatorio()
    rel.p(f"Gerado em {agora:%d/%m/%Y %H:%M} · tenant {cfg.tenant_url} · space {cfg.space} · mês {anomes}")
    ref_p = json.loads((REF / "payload.json").read_text(encoding="utf-8")) if (REF / "payload.json").exists() else None
    ref_o = json.loads((REF / "online.json").read_text(encoding="utf-8")) if (REF / "online.json").exists() else None
    dump: dict = {}

    def etapa(nome, fn):
        try:
            fn()
        except Exception as erro:  # noqa: BLE001
            rel.p(f"**ERRO em {nome}:** `{erro}`")
            log.debug(traceback.format_exc())

    # 1. colunas ---------------------------------------------------------------
    def colunas():
        rel.h("1. Colunas do mapeamento x $metadata")
        for obj, classe in [(M.OBJ_META, CM), (M.OBJ_BASE_CLIENTE, CB), (M.OBJ_COMODATO, CO), (M.OBJ_CALENDARIO, CC)]:
            try:
                existentes = set(cons.colunas(obj))
            except Exception as erro:  # noqa: BLE001
                rel.p(f"- `{obj}`: **não acessível** ({erro})")
                continue
            faltam = [c for c in _cols(classe) if c not in existentes]
            rel.p(f"- `{obj}`: {len(existentes)} colunas; " +
                  (f"**faltando: {', '.join(faltam)}**" if faltam else "todas as colunas do mapeamento existem"))
    etapa("colunas", colunas)

    # 2. distintos -------------------------------------------------------------
    med_meta = [CM.COB_MES, CM.COB_ONLINE, CM.VOL_MES, CM.VOL_ONLINE]
    alvos = [
        (M.OBJ_META, CM.AGRUPADOR, med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, "AGRUPADOR_PRODUTO_Produto", med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, "_AGRUPADOR_PRODUTO_P", med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, "DS_GRUPO_ESPECIE_Produto", med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, "DS_AGRUPADOR_Agrupador_Segm", med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, CM.META_AGRUPADOR, [CM.META_NEG, CM.META_DIA], eq(CM.META_ANOMES, anomes)),
        (M.OBJ_META, "IDENT_FAT_META_SAP", med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, "IDENT_FAT_META_NEG", med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, CM.FONTE, med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, CM.SITUACAO_PEDIDO, med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, "COB_HOJE_Info_Meta_SAP", med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_META, CM.CALENDARIO, [CM.META_DIA, CM.VOL_MES], eq(CM.ANOMES, anomes)),
        (M.OBJ_META, CM.GC, med_meta, eq(CM.ANOMES, anomes)),
        (M.OBJ_BASE_CLIENTE, CB.GC, [CB.QUANTIDADE], M.FILTRO_BASE_CLIENTE),
        (M.OBJ_BASE_CLIENTE, CB.SUPERVISOR, [CB.QUANTIDADE], M.FILTRO_BASE_CLIENTE),
        (M.OBJ_BASE_CLIENTE, CB.NOME_SUPERVISOR, [CB.QUANTIDADE], M.FILTRO_BASE_CLIENTE),
        (M.OBJ_BASE_CLIENTE, CB.SEGMENTO, [CB.QUANTIDADE], M.FILTRO_BASE_CLIENTE),
        (M.OBJ_BASE_CLIENTE, CB.DIA_VISITA, [CB.QUANTIDADE], M.FILTRO_BASE_CLIENTE),
        (M.OBJ_BASE_CLIENTE, CB.VISITA_HOJE, [CB.QUANTIDADE], M.FILTRO_BASE_CLIENTE),
        (M.OBJ_BASE_CLIENTE, CB.STATUS, [CB.QUANTIDADE], None),
        (M.OBJ_BASE_CLIENTE, "PERIODICIDADE", [CB.QUANTIDADE], M.FILTRO_BASE_CLIENTE),
        (M.OBJ_COMODATO, CO.GIRO, [CO.META_EQPTO, CO.VOLUME], M.FILTRO_COMODATO),
        (M.OBJ_COMODATO, CO.STATUS, [CO.META_EQPTO], None),
        (M.OBJ_COMODATO, CO.TIPO, [CO.META_EQPTO], M.FILTRO_COMODATO),
        (M.OBJ_COMODATO, "AGRUPADOR_EQPTO", [CO.META_EQPTO], M.FILTRO_COMODATO),
    ]

    def dists():
        rel.h("2. Valores distintos")
        for obj, dim, meds, filtro in alvos:
            try:
                r = distintos(cons, obj, dim, meds, filtro)
            except Exception as erro:  # noqa: BLE001
                rel.p(f"- `{obj}.{dim}`: erro `{erro}`")
                continue
            if r is None:
                rel.p(f"- `{obj}.{dim}`: coluna não existe")
                continue
            meds_ok, valores = r
            dump[f"{obj}.{dim}"] = [[v] + a for v, a in valores]
            extra = ""
            if dim in (CM.AGRUPADOR, CM.META_AGRUPADOR, "AGRUPADOR_PRODUTO_Produto", "_AGRUPADOR_PRODUTO_P",
                       "DS_GRUPO_ESPECIE_Produto"):
                extra = "mapeia para"
            rel.p(f"\n### `{obj}.{dim}` ({len(valores)} valores)\n")
            cab = ["valor", "linhas"] + meds_ok + ([extra] if extra else [])
            linhas = []
            for v, a in valores[:200]:
                lin = [repr(v), a[0]] + [round(x, 1) for x in a[1:]]
                if extra:
                    lin.append(" / ".join(x for x in (M.indicador_cobertura(v), M.indicador_volume(v)) if x) or "—")
                linhas.append(lin)
            rel.tabela(cab, linhas)
    etapa("distintos", dists)

    # 3. cruzamentos -----------------------------------------------------------
    def cruzar():
        rel.h("3. Cruzamento com o painel publicado")
        if not ref_p:
            rel.p("Sem frontend/data/payload.json para comparar.")
            return
        ag = {normalizar(x[0]) for x in dump.get(f"{M.OBJ_META}.{CM.AGRUPADOR}", [])}
        agm = {normalizar(x[0]) for x in dump.get(f"{M.OBJ_META}.{CM.META_AGRUPADOR}", [])}
        linhas = []
        for k in M.INDICADORES_COBERTURA + M.INDICADORES_VOLUME:
            apel = M.APELIDOS_COBERTURA.get(k) or M.APELIDOS_VOLUME.get(k)
            na_venda = [a for a in apel if normalizar(a) in ag]
            na_meta = [a for a in apel if normalizar(a) in agm]
            linhas.append([k, ", ".join(na_venda) or "**NÃO ENCONTRADO**", ", ".join(na_meta) or "**NÃO ENCONTRADO**"])
        rel.p("Indicador do painel x agrupador encontrado na venda e na meta:")
        rel.tabela(["indicador", f"{CM.AGRUPADOR}", f"{CM.META_AGRUPADOR}"], linhas)

        gcs = [x[0] for x in dump.get(f"{M.OBJ_BASE_CLIENTE}.{CB.GC}", [])]
        rel.p("\nGC na base -> código: " + ", ".join(f"{g!r}->{M.codigo_gc(g)}" for g in gcs))
        rel.p(f"GC_ATIVAS do painel: {ref_p['GC_ATIVAS']}")
        svs = {M.codigo_sv(x[0]) for x in dump.get(f"{M.OBJ_BASE_CLIENTE}.{CB.SUPERVISOR}", [])}
        ref_svs = set(ref_p["NOME_SUPERVISOR"])
        rel.p(f"Supervisores: {len(svs & ref_svs)} em comum; só na fonte: {sorted(svs - ref_svs)[:15]}; "
              f"só no painel: {sorted(ref_svs - svs)}")
        segs = {normalizar(x[0]) for x in dump.get(f"{M.OBJ_BASE_CLIENTE}.{CB.SEGMENTO}", [])}
        rel.p(f"Segmentos fora da tabela SEGS: {sorted(segs - {normalizar(s) for s in ref_p['SEGS']})}")
        dias = {normalizar(fontes._formatar_dias(x[0])) for x in dump.get(f"{M.OBJ_BASE_CLIENTE}.{CB.DIA_VISITA}", [])}
        rel.p(f"Dias de visita fora da tabela DIAS: {sorted(dias - {normalizar(d) for d in ref_p['DIAS']})}")
        vh = dump.get(f"{M.OBJ_BASE_CLIENTE}.{CB.VISITA_HOJE}", [])
        rel.p(f"VISITA_HOJE: {[(v[0], v[1], M.eh_sim(v[0])) for v in vh]} (valor, linhas, conta como sim)")
        giro = dump.get(f"{M.OBJ_COMODATO}.{CO.GIRO}", [])
        rel.p(f"Giro do comodato: {[(g[0], g[1], normalizar(g[0]) in M.GIRO_ZERO or 'ZERO' in normalizar(g[0])) for g in giro]} "
              f"(valor, linhas, conta como Venda Zero)")
        base_ref = sum(len(v) for v in ref_p["CLIENT_ROSTER"].values())
        status = dump.get(f"{M.OBJ_BASE_CLIENTE}.{CB.STATUS}", [])
        rel.p(f"Clientes no painel publicado: {base_ref}. Status na base: {[(s[0], s[1]) for s in status]}")
    etapa("cruzamento", cruzar)

    # 4. sonda uma rota --------------------------------------------------------
    def sonda():
        r = args.rota
        rel.h(f"4. Sondagem da rota {r} (gerador x publicado)")
        f = fontes.carregar(cons, agora, rota=r)
        novo = montar_payload(f)
        on = montar_online(f.online)
        (PASTA / f"rota_{r}_payload.json").parent.mkdir(parents=True, exist_ok=True)
        (PASTA / f"rota_{r}_payload.json").write_text(json.dumps(novo, ensure_ascii=False, indent=1), encoding="utf-8")
        (PASTA / f"rota_{r}_online.json").write_text(json.dumps(on, ensure_ascii=False, indent=1), encoding="utf-8")
        nn = next((d for svs in novo["DATA"].values() for rs in svs.values() for rr, d in rs.items() if rr == r), None)
        rn = next((d for svs in (ref_p or {}).get("DATA", {}).values() for rs in svs.values()
                   for rr, d in rs.items() if rr == r), None)
        if not nn:
            rel.p(f"Rota {r} não veio na base de clientes.")
            return
        rel.p(f"Calendário: dia útil {novo['DIA_HOJE']}/{novo['TOTAL_DIAS_UTEIS']}, ontem {novo['DIA_ONTEM']}, "
              f"semana {novo['SEMANA_NUM']} ({novo['SEMANA_TIPO']}) · publicado: "
              + (f"{ref_p['DIA_HOJE']}/{ref_p['TOTAL_DIAS_UTEIS']}, semana {ref_p['SEMANA_NUM']}" if ref_p else "—"))
        campos = ["consultor", "baseTotal", "baseKsTt", "compraram", "semCompra"]
        rel.tabela(["campo", "gerador", "publicado"], [[c, nn[c], (rn or {}).get(c)] for c in campos])
        linhas = []
        for k in M.ORDEM_INDICADORES:
            a, b = nn["indicators"][k], (rn or {}).get("indicators", {}).get(k, {})
            if k in M.INDICADORES_VOLUME:
                fmt = lambda x: "indisp." if x.get("unavailable") else f"meta {x.get('meta')} real {x.get('real')} tend {x.get('tendencia')} dia {x.get('metaDia')}"
            else:
                fmt = lambda x: "indisp." if x.get("unavailable") else f"meta {x.get('meta')} real {x.get('real')} ({x.get('pct')}%)"
            linhas.append([k, fmt(a), fmt(b) if b else "—"])
        rel.tabela(["indicador", "gerador", "publicado"], linhas)
        rel.p(f"\nVisitas hoje: {novo['VISITAS_DIA']['geral'].get(r)} · Venda Zero: "
              f"{len(novo['VENDAZERO_CLIENTES'].get(r, []))} linhas · redes: {len(novo['REDES_CLIENTE'].get(r, {}))}")
        if ref_o:
            ro = ref_o["rotas"].get(r, {})
            rel.p(f"Online gerador: {on['rotas'].get(r, {})} · volume {on['volume'].get(r, {})}")
            rel.p(f"Online publicado ({ref_o['updatedAt']}): {ro} · volume {ref_o['volume'].get(r, {})}")
    etapa("sondagem", sonda)

    PASTA.mkdir(parents=True, exist_ok=True)
    (PASTA / "distintos.json").write_text(json.dumps(dump, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    rel.salvar()
    print(f"\nRelatório: {PASTA / 'relatorio.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
