"""
conferir_tendencia.py — Confere com os dados reais a tendência de volume do SAC e o modo fechamento.

Roda no workflow manual "Conferir tendência" (.github/workflows/conferir-tendencia.yml), sem commit:

    python scripts/conferir_tendencia.py                    # hoje
    python scripts/conferir_tendencia.py --hoje 2026-11-03  # simula a data (fechamento do mês)

Gera saida/conferencia/relatorio_tendencia.md (só totais: sem nomes nem códigos de clientes) com:
  1. valores de NF_STATUS_Nota_Fiscal no mês (linhas e soma de FX_VOL_PADRAO_FAT) e quais entram no Vol Real;
  2. META_RECUPERAVEL_ROTA: existe? soma por gerência para hoje;
  3. por gerência e rotas de amostra, por macro: Real atual, Vol Real novo, Neg Restante, Meta NEG,
     META_VOLUME, Tendência, % Tendência, tendência linear antiga, META_DIA antiga e meta do dia nova;
  4. sobreposição online x faturado de hoje (clientes e volume em WF Online e em NF de hoje, por status);
  5. META_VOLUME e META_COBERTURA por gerência no mês atual e no próximo (critério de virada);
  6. colunas do comodato que podem indicar giro do mês anterior (GIRO, MES, ANT) com valores distintos;
  7. tempo de cada consulta e tempo total.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import traceback
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gerador import calendario as calmod  # noqa: E402
from gerador import fontes  # noqa: E402
from gerador import mapeamento as M  # noqa: E402
from gerador.consulta import Consulta, e, eq, ou  # noqa: E402
from gerador.texto import data, inteiro, limpar, normalizar, numero  # noqa: E402
from gerador.tipos import Online  # noqa: E402

CM, CO = M.ColMeta, M.ColComodato
VOL = M.INDICADORES_VOLUME
ROTAS_FIXAS = ["111", "211", "311"]
# colunas do comodato que não podem ir para o relatório (identificam cliente)
COLUNAS_PROIBIDAS = re.compile(r"CLIENTE|(^|_)(NOME|NM|CD)(_|$)|FANTASIA|CNPJ|CPF|ENDERECO|EQUIPAMENTO", re.I)
COLUNAS_GIRO = re.compile(r"GIRO|MES|(^|_)ANT", re.I)


class ConsultaCronometrada(Consulta):
    """Consulta com memória (a mesma consulta não vai duas vezes ao Datasphere) e tempo de cada uma."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.tempos: list[tuple[str, str, int, float]] = []
        self._memo: dict[str, list[dict]] = {}
        self._trava = threading.Lock()

    def linhas(self, objeto, select, filtro=None, top=None, orderby=None):
        chave = json.dumps([objeto, list(dict.fromkeys(select)), filtro, top, orderby])
        with self._trava:
            if chave in self._memo:
                return self._memo[chave]
        inicio = time.monotonic()
        linhas = super().linhas(objeto, select, filtro, top, orderby)
        with self._trava:
            self.tempos.append((objeto, ", ".join(select), len(linhas), time.monotonic() - inicio))
            self._memo[chave] = linhas
        return linhas


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
            self.p("| " + " | ".join("—" if x is None else str(x) for x in l) + " |")

    def texto(self, titulo: str) -> str:
        return f"# {titulo}\n" + "\n".join(self.linhas) + "\n"


def _n(v: float | None, casas: int = 1) -> str | None:
    if v is None:
        return None
    return f"{v:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _pct(v: float | None, meta: float | None) -> str | None:
    return None if v is None or not meta else f"{round(v / meta * 100)}%"


def _gc_painel(gc_da_rota: dict[str, str], rota: str) -> str | None:
    return gc_da_rota.get(rota)


def _literal_data(tipo: str | None, bruto: object) -> str:
    """Literal OData de DATA_MOVIMENTO conforme o tipo do $metadata e o formato devolvido pela fonte."""
    texto = limpar(bruto)
    if tipo and "String" not in tipo:
        return f"{texto[:10]}T00:00:00Z" if "DateTime" in tipo else texto[:10]
    return "'" + texto.replace("'", "''") + "'"


def conferir(cons: Consulta, hoje: date, rotas_extra: list[str] | None = None) -> tuple[Relatorio, float]:
    inicio = time.monotonic()
    rel = Relatorio()
    estado: dict = {}

    def etapa(nome, fn):
        try:
            fn()
        except Exception as erro:  # noqa: BLE001
            rel.p(f"**ERRO em {nome}:** `{type(erro).__name__}: {erro}`")
            print(traceback.format_exc(), file=sys.stderr)

    anomes_hoje = hoje.strftime("%Y%m")
    prox = (date(hoje.year, hoje.month, 28) + timedelta(days=4)).replace(day=1)

    # 0. contexto ----------------------------------------------------------------
    def contexto():
        cal, linhas_cal = fontes.carregar_calendario(cons, hoje)
        clientes, gcs = fontes.carregar_clientes(cons)
        gc_da_rota = {c.rota: c.gc for c in clientes}
        fech = fontes.decidir_fechamento(cons, hoje, linhas_cal, gc_da_rota)
        estado.update(cal=cal, cal_ref=fech or cal, gcs=gcs, gc_da_rota=gc_da_rota,
                      rotas=sorted(gc_da_rota), dia_util=calmod.dia_util_hoje(linhas_cal, hoje))
        rel.p(f"Hoje: {hoje:%d/%m/%Y} ({calmod.DIAS_SEMANA[hoje.weekday()]}) · dia útil {estado['dia_util']} de "
              f"{cal.total_dias_uteis} · calendário: {'Datasphere' if calmod.do_datasphere(linhas_cal, hoje) else 'cálculo local'}")
        rel.p(f"Modo: **{'FECHAMENTO de ' + fech.mes_label if fech else 'normal'}** · mês de referência do payload "
              f"{(fech or cal).anomes} · {len(clientes)} clientes em {len(gc_da_rota)} rotas")
        rel.p(f"Status que entram no Vol Real (M.STATUS_NF_REAL): {M.STATUS_NF_REAL}")
    etapa("contexto", contexto)
    if "cal" not in estado:
        return rel, time.monotonic() - inicio
    gc_da_rota, gcs = estado["gc_da_rota"], estado["gcs"]
    anomes = estado["cal_ref"].anomes

    # 1. NF_STATUS ----------------------------------------------------------------
    rel.h(f"1. NF_STATUS_Nota_Fiscal em {anomes}")

    def status():
        vm = fontes.carregar_volume_real(cons, anomes, gcs, None)
        estado["vm"] = vm
        todos = defaultdict(float)
        for l in cons.linhas(M.OBJ_META, [CM.NF_STATUS, CM.VOL_MES], eq(CM.ANOMES, anomes)):
            todos[limpar(l.get(CM.NF_STATUS))] += numero(l.get(CM.VOL_MES))
        nomes = sorted(set(vm.por_status) | set(todos), key=lambda s: normalizar(s))
        linhas = [[repr(s), vm.por_status.get(s, [0])[0], _n(vm.por_status.get(s, [0, 0.0])[1]), _n(todos.get(s)),
                   "sim" if M.status_nf_real(s) else "não"] for s in nomes]
        rel.p("Linhas = rota x cliente x macro de volume (agregado no servidor). Volume dos 5 macros e de todos "
              "os agrupadores do modelo.")
        rel.tabela(["status (como veio)", "linhas", "FX_VOL_PADRAO_FAT (5 macros)", "FX_VOL_PADRAO_FAT (tudo)",
                    "entra no Vol Real"], linhas)
        if not vm.real:
            rel.p("\n**Nenhum status bateu com M.STATUS_NF_REAL: ajuste a grafia em gerador/mapeamento.py.**")
    etapa("NF_STATUS", status)

    def por_dia():
        lin = cons.linhas(M.OBJ_META, [CM.DATA, CM.VOL_MES],
                          e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, list(M.AGRUPADORES_VOLUME.values()))))
        estado["datas_brutas"] = [l.get(CM.DATA) for l in lin]
        fora = [(l.get(CM.DATA), numero(l.get(CM.VOL_MES))) for l in lin
                if (d := data(l.get(CM.DATA))) is None or d.strftime("%Y%m") != anomes]
        rel.p(f"\nDATA_MOVIMENTO em {anomes}: {len(lin)} datas distintas; tipo no $metadata: "
              f"`{cons.tipo(M.OBJ_META, CM.DATA) if hasattr(cons, 'tipo') else '?'}`; exemplo: "
              f"`{estado['datas_brutas'][0] if lin else '—'}`. Datas fora do mês (ou ilegíveis): "
              + (", ".join(f"{d!r} ({_n(v)})" for d, v in fora[:10]) or "nenhuma"))
    etapa("datas", por_dia)

    # 2. META_RECUPERAVEL_ROTA -----------------------------------------------------
    rel.h("2. META_RECUPERAVEL_ROTA (meta do dia nova)")

    def recuperavel():
        existe = CM.META_RECUPERAVEL in set(cons.colunas(M.OBJ_META))
        rel.p(f"`{CM.META_RECUPERAVEL}` no $metadata de {M.OBJ_META}: **{'sim' if existe else 'NÃO'}**")
        if not existe:
            return
        dia = fontes.meta_do_dia(fontes._por_rota_dia(cons, CM.META_RECUPERAVEL, anomes_hoje, None), hoje)
        estado["meta_dia"] = dia
        por_gc = defaultdict(lambda: defaultdict(float))
        for r, ks in dia.items():
            gc = _gc_painel(gc_da_rota, r)
            if gc:
                for k, v in ks.items():
                    por_gc[gc][k] += v
        rel.p(f"Soma por gerência, DATA_MOVIMENTO = {hoje:%d/%m/%Y} (rotas do painel):")
        rel.tabela(["gerência"] + [M.LABELS[k] for k in VOL] + ["total"],
                   [[g] + [_n(por_gc[g].get(k, 0.0)) for k in VOL] + [_n(sum(por_gc[g].values()))]
                    for g in M.GC_ATIVAS if g in por_gc])
    etapa("META_RECUPERAVEL_ROTA", recuperavel)

    # 3. comparação ----------------------------------------------------------------
    rel.h(f"3. Volume: painel atual x critério do SAC ({anomes})")

    def comparacao():
        vm = estado.get("vm") or fontes.carregar_volume_real(cons, anomes, gcs, None)
        meta_neg, restante = fontes.carregar_meta_neg(cons, anomes, None, hoje)
        _, metas_vol = fontes.carregar_metas(cons, anomes, None)
        sel_dia = [CM.META_ROTA, CM.META_AGRUPADOR, CM.META_DIA]
        antiga = defaultdict(lambda: defaultdict(float))
        for l in cons.linhas(M.OBJ_META, sel_dia, e(eq(CM.META_ANOMES, anomes),
                                                     ou(CM.META_AGRUPADOR, list(M.AGRUPADORES_VOLUME.values())))):
            r, k = fontes._rota(l.get(CM.META_ROTA)), M.indicador_volume(l.get(CM.META_AGRUPADOR))
            if r and k:
                antiga[r][k] += numero(l.get(CM.META_DIA))
        nova = estado.get("meta_dia") if anomes == anomes_hoje else None
        cal = estado["cal"]

        def valores(rotas: list[str], k: str) -> list:
            def s(d):
                return sum(d.get(r, {}).get(k, 0.0) for r in rotas)
            real_ant, real, rest, mneg = s(vm.todos_status), s(vm.real), s(restante), s(meta_neg)
            mvol, mdia_ant = s(metas_vol), s(antiga)
            tend = real + rest
            linear = real_ant / cal.dia_ontem * cal.total_dias_uteis if cal.dia_ontem else real_ant
            return [_n(real_ant), _n(real), _n(rest), _n(mneg), _n(mvol), _n(tend), _pct(tend, mneg),
                    _n(linear), _pct(linear, mvol), _n(mdia_ant), None if nova is None else _n(s(nova))]

        cab = ["", "macro", "Real atual", "Vol Real novo", "Neg Restante", "Meta NEG", "META_VOLUME", "Tendência",
               "% Tend. (NEG)", "Tend. linear antiga", "% antigo (META_VOLUME)", "META_DIA antiga", "Meta do dia nova"]
        amostra = list(ROTAS_FIXAS) + list(rotas_extra or [])
        for gc in ("AP", "IT", "MO"):
            primeira = next((r for r in estado["rotas"] if gc_da_rota[r] == gc), None)
            if primeira:
                amostra.append(primeira)
        linhas = []
        for gc in M.GC_ATIVAS:
            rotas = [r for r in estado["rotas"] if gc_da_rota[r] == gc]
            if rotas:
                linhas += [[f"**{gc}**", M.LABELS[k]] + valores(rotas, k) for k in VOL]
        for r in dict.fromkeys(amostra):
            if r in gc_da_rota:
                linhas += [[f"rota {r} ({gc_da_rota[r]})", M.LABELS[k]] + valores([r], k) for k in VOL]
            else:
                linhas.append([f"rota {r}", "não está na base de clientes"] + [None] * (len(cab) - 2))
        rel.p("Real atual = FX_VOL_PADRAO_FAT do mês com todos os status (como o painel publica hoje). "
              "Vol Real novo = só os status do SAC. Tendência = Vol Real + Neg Restante (META_NEG de hoje ao fim "
              f"do mês); % sobre a Meta NEG. Linear antiga = Real atual / {cal.dia_ontem} x {cal.total_dias_uteis} "
              "dias úteis, sobre META_VOLUME. Gerência = soma das rotas do painel (Neutraliza incluída).")
        rel.tabela(cab, linhas)
    etapa("comparação", comparacao)

    # 4. sobreposição online x faturado de hoje -------------------------------------
    rel.h(f"4. Sobreposição online x faturado em {hoje:%d/%m/%Y}")

    def sobreposicao():
        online = Online(atualizado_em=datetime.combine(hoje, datetime.min.time()))
        fontes.carregar_vendas(cons, anomes_hoje, gcs, None, online, so_pedidos_hoje=True)
        brutas = estado.get("datas_brutas") if anomes == anomes_hoje else None
        if brutas is None:
            brutas = [l.get(CM.DATA) for l in cons.linhas(
                M.OBJ_META, [CM.DATA, CM.VOL_MES],
                e(eq(CM.ANOMES, anomes_hoje), ou(CM.AGRUPADOR, list(M.AGRUPADORES_VOLUME.values()))))]
        bruto = next((b for b in brutas if data(b) == hoje), None)
        if bruto is None:
            rel.p("Nenhuma NF com DATA_MOVIMENTO = hoje nos macros de volume: não há sobreposição a medir.")
            nf = []
        else:
            literal = _literal_data(cons.tipo(M.OBJ_META, CM.DATA) if hasattr(cons, "tipo") else None, bruto)
            sel = [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.NF_STATUS, CM.VOL_MES]
            filtro = e(eq(CM.ANOMES, anomes_hoje), ou(CM.AGRUPADOR, list(M.AGRUPADORES_VOLUME.values())),
                       f"{CM.DATA} eq {literal}")
            nf = [l for ls in cons.em_paralelo(fontes._por_gerencia(M.OBJ_META, sel, filtro, gcs, None)).values()
                  for l in ls]
            rel.p(f"Filtro usado: `{CM.DATA} eq {literal}` · {len(nf)} linhas de NF hoje (rota x cliente x macro x status)")
        on = online.volume_cliente
        # (gc, macro, status) -> [clientes em ambos, vol online desses, vol NF desses]
        ambos = defaultdict(lambda: [0, 0.0, 0.0])
        n_nf = defaultdict(set)
        for l in nf:
            r, k = fontes._rota(l.get(CM.ROTA)), M.indicador_volume(l.get(CM.AGRUPADOR))
            pv = inteiro(l.get(CM.CLIENTE))
            gc, vol = _gc_painel(gc_da_rota, r), numero(l.get(CM.VOL_MES))
            if not gc or not k or pv is None or not vol:
                continue
            st = limpar(l.get(CM.NF_STATUS))
            n_nf[(gc, k)].add(pv)
            v_on = on.get(r, {}).get(pv, {}).get(k, 0.0)
            if v_on:
                a = ambos[(gc, k, st)]
                a[0] += 1
                a[1] += v_on
                a[2] += vol
        n_on = defaultdict(int)
        for r, por_pv in on.items():
            gc = _gc_painel(gc_da_rota, r)
            for ks in por_pv.values():
                for k, v in ks.items():
                    if gc and v:
                        n_on[(gc, k)] += 1
        linhas = []
        for gc in M.GC_ATIVAS:
            for k in VOL:
                sts = sorted({s for g, kk, s in ambos if g == gc and kk == k})
                base = [gc, M.LABELS[k], n_on.get((gc, k), 0), len(n_nf.get((gc, k), ()))]
                if not sts:
                    if base[2] or base[3]:
                        linhas.append(base + ["—", 0, None, None])
                    continue
                for s in sts:
                    a = ambos[(gc, k, s)]
                    linhas.append(base + [repr(s), a[0], _n(a[1]), _n(a[2])])
        rel.p("Clientes com volume no WF Online de hoje ('Inc. e Exp.') e também em NF com DATA_MOVIMENTO = hoje. "
              "Se houver muitos, somar o online ao Real da barra por cliente conta o mesmo pedido duas vezes.")
        rel.tabela(["gerência", "macro", "clientes online", "clientes NF hoje", "status NF", "clientes em ambos",
                    "vol online desses", "vol NF desses"], linhas)
    etapa("sobreposição", sobreposicao)

    # 5. metas por gerência ------------------------------------------------------------
    rel.h("5. Metas por gerência (critério de virada do fechamento)")

    def metas_gc():
        gerencias = fontes.gerencias_origem(gc_da_rota)
        for ref in (hoje, prox):
            am = ref.strftime("%Y%m")
            por_gc = fontes.metas_por_gerencia(cons, am, gc_da_rota)
            rel.p(f"\nANOMES {am}: virada liberada = **{'sim' if fontes.todas_com_meta(por_gc, gerencias) else 'não'}**")
            rel.tabela(["gerência", "META_VOLUME", "META_COBERTURA", "ok"],
                       [[g, _n(por_gc.get(g, (0, 0))[0]), _n(por_gc.get(g, (0, 0))[1], 0),
                         "sim" if fontes.todas_com_meta(por_gc, [g]) else "não"] for g in gerencias])
    etapa("metas por gerência", metas_gc)

    # 6. comodato ------------------------------------------------------------------------
    rel.h("6. Comodato: colunas que podem indicar o giro do mês anterior")

    def comodato():
        cols = [c for c in cons.colunas(M.OBJ_COMODATO) if COLUNAS_GIRO.search(c) and not COLUNAS_PROIBIDAS.search(c)]
        rel.p(f"{len(cols)} colunas com GIRO, MES ou ANT no nome (sem as que identificam cliente/equipamento).")
        for c in cols:
            try:
                lin = cons.linhas(M.OBJ_COMODATO, [c, CO.MEDIDA_AUX], M.FILTRO_COMODATO, top=5000)
            except Exception as erro:  # noqa: BLE001
                rel.p(f"- `{c}`: erro `{erro}`")
                continue
            cont = defaultdict(float)
            for l in lin:
                cont[limpar(l.get(c))] += numero(l.get(CO.MEDIDA_AUX))
            vals = sorted(cont.items(), key=lambda x: -x[1])[:25]
            rel.p(f"- `{c}` ({len(cont)} valores; {CO.MEDIDA_AUX} por valor): "
                  + ", ".join(f"{v!r}: {_n(q, 0)}" for v, q in vals))
    etapa("comodato", comodato)

    # 7. tempos --------------------------------------------------------------------------
    total = time.monotonic() - inicio
    rel.h("7. Tempo das consultas")
    tempos = getattr(cons, "tempos", [])
    rel.tabela(["objeto", "colunas", "linhas", "segundos"],
               [[o, s[:90] + ("…" if len(s) > 90 else ""), n, f"{t:.1f}"] for o, s, n, t in tempos])
    rel.p(f"\nSoma das consultas: {sum(t for *_, t in tempos):.0f} s (várias rodam em paralelo) · "
          f"tempo total do relatório: {total:.0f} s")
    return rel, total


def main() -> int:
    from odata.config import PASTA_SAIDA, carregar_config
    from odata.log import configurar_log

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hoje", help="simula a data (AAAA-MM-DD)")
    ap.add_argument("--saida", type=Path, default=PASTA_SAIDA / "conferencia", help="pasta do relatório")
    ap.add_argument("--rotas", default="", help="rotas extras de amostra, separadas por vírgula")
    args = ap.parse_args()
    configurar_log("conferir")
    cfg = carregar_config()
    M.OBJ_META = cfg.objeto
    hoje = date.fromisoformat(args.hoje) if args.hoje else calmod.agora().date()
    cons = ConsultaCronometrada(cfg)
    rel, _ = conferir(cons, hoje, [r.strip().upper() for r in args.rotas.split(",") if r.strip()])
    args.saida.mkdir(parents=True, exist_ok=True)
    destino = args.saida / "relatorio_tendencia.md"
    destino.write_text(rel.texto(f"Conferência da tendência de volume e do fechamento · {hoje:%d/%m/%Y} "
                                 f"(gerado {calmod.agora():%d/%m/%Y %H:%M})"), encoding="utf-8")
    print(f"\nRelatório: {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
