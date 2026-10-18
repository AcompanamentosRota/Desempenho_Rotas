"""
conferir_tendencia.py — Confere com os dados reais a tendência de volume do SAC e o modo fechamento.

Roda no workflow manual "Conferir tendência" (.github/workflows/conferir-tendencia.yml), sem commit:

    python scripts/conferir_tendencia.py                    # hoje
    python scripts/conferir_tendencia.py --hoje 2026-11-03  # simula a data (fechamento do mês)

Gera saida/conferencia/relatorio_tendencia.md (só totais e nomes de colunas: sem nomes de pessoas nem
nomes ou códigos de clientes) com:
  1. valores de NF_STATUS_Nota_Fiscal no mês (linhas e soma de FX_VOL_PADRAO_FAT) e quais entram no Vol Real;
  2. META_RECUPERAVEL_ROTA de hoje: (a) por rota, como o gerador; (b) soma e (c) máximo por rota x cliente;
  3. por gerência e rotas de amostra, por macro: Meta (META_VOLUME), fração restante da META_NEG, Neg Restante,
     Tendência e % novos, ao lado da versão anterior (soma de META_NEG), da linear antiga e da META_DIA antiga;
  4. aceite contra o SAC (Refrigerantes, 17/10/2026; só sem --hoje e nessa data);
  5. investigação: META_VOLUME por DATA_MOVIMENTO tem curva diária?
  6. sobreposição online x faturado de hoje (clientes e volume em WF Online e em NF de hoje, por status);
  7. META_VOLUME e META_COBERTURA por gerência no mês atual e no próximo (critério de virada);
  8. colunas do comodato que podem indicar giro do mês anterior (GIRO, MES, ANT): só nomes e contagens;
  9. tempo de cada consulta, total e antes x depois.
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
from gerador import fontes, modelo  # noqa: E402
from gerador import mapeamento as M  # noqa: E402
from gerador.consulta import Consulta, e, eq, ou  # noqa: E402
from gerador.texto import data, inteiro, limpar, normalizar, numero  # noqa: E402
from gerador.tipos import Online  # noqa: E402

CM, CO = M.ColMeta, M.ColComodato
VOL = M.INDICADORES_VOLUME
ROTAS_FIXAS = ["111", "211", "311"]
# rotas da conferência de 18/10 (514, 535, M21 e M24 puxavam a diferença da tendência em AP e MO)
AMOSTRA_ROTA_META = ["111", "211", "311", "511", "514", "535", "I11", "M11", "M21", "M22", "M24"]
# Aceite (Refrigerantes) com os valores do SAC de 17/10/2026: gc -> (Real, Meta, Tendência, % Tendência)
DATAS_ACEITE = (date(2026, 10, 17), date(2026, 10, 18))   # fim de semana: sem faturamento novo
SAC_17_10 = {
    "G1": (125590, 490003, 406863, 83.03),
    "G2": (159417, 533000, 474058, 88.94),
    "G3": (85913, 218997, 212972, 97.25),
    "AP": (121040, 398000, 347170, 87.23),
    "IT": (72513, 195619, 186159, 95.16),
    "MO": (73578, 184381, 176522, 95.74),
}
# colunas do comodato que não podem ir para o relatório (identificam cliente)
COLUNAS_PROIBIDAS = re.compile(r"CLIENTE|(^|_)(NOME|NM|CD)(_|$)|FANTASIA|CNPJ|CPF|ENDERECO|EQUIPAMENTO|"
                               r"VENDEDOR|SUPERVISOR|CONSULTOR|GERENTE", re.I)
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


def _pct2(v: float | None, meta: float | None) -> str | None:
    return None if v is None or not meta else f"{v / meta * 100:.2f}%".replace(".", ",")


def _gc_painel(gc_da_rota: dict[str, str], rota: str) -> str | None:
    return gc_da_rota.get(rota)


def aceite_sac(por_gc: dict[str, tuple[float, float, float]], vale: bool) -> tuple[list[list], bool]:
    """Linhas da tabela de aceite (Refrigerantes) e se tudo bateu. por_gc: gc -> (real, meta, tendência)."""
    linhas, tudo_ok = [], True

    def marca(ok: bool) -> str:
        return ("OK" if ok else "**DIVERGE**") if vale else ""

    for gc, (s_real, s_meta, s_tend, s_pct) in SAC_17_10.items():
        if gc not in por_gc:
            linhas.append([gc, None, _n(s_real, 0), marca(False), None, _n(s_meta, 0), "", None, _n(s_tend, 0), "",
                           None, f"{s_pct:.2f}%".replace(".", ","), ""])
            tudo_ok = False
            continue
        real, meta, tend = por_gc[gc]
        pct = tend / meta * 100 if meta else 0.0
        oks = [abs(real - s_real) <= 0.001 * s_real, abs(meta - s_meta) < 0.5,
               abs(tend - s_tend) <= 0.002 * s_tend, abs(pct - s_pct) <= 0.1]
        tudo_ok &= all(oks)
        linhas.append([gc, _n(real, 0), _n(s_real, 0), marca(oks[0]), _n(meta, 0), _n(s_meta, 0), marca(oks[1]),
                       _n(tend, 0), _n(s_tend, 0), marca(oks[2]), f"{pct:.2f}%".replace(".", ","),
                       f"{s_pct:.2f}%".replace(".", ","), marca(oks[3])])
    return linhas, tudo_ok


def conferir(cons: Consulta, hoje: date, rotas_extra: list[str] | None = None,
             simulado: bool = False) -> tuple[Relatorio, float]:
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
    rel.h("2. META_RECUPERAVEL_ROTA (meta do dia)")
    amostra = list(ROTAS_FIXAS) + list(rotas_extra or [])
    for gc in ("AP", "IT", "MO"):
        primeira = next((r for r in estado["rotas"] if gc_da_rota[r] == gc), None)
        if primeira:
            amostra.append(primeira)
    amostra = [r for r in dict.fromkeys(amostra)]

    def recuperavel():
        existe = CM.META_RECUPERAVEL in set(cons.colunas(M.OBJ_META))
        rel.p(f"`{CM.META_RECUPERAVEL}` no $metadata de {M.OBJ_META}: **{'sim' if existe else 'NÃO'}**")
        if not existe:
            return
        # (a) como o gerador: DATA_MOVIMENTO = hoje no $filter, agrupado por rota x macro
        dia = fontes.carregar_meta_dia(cons, anomes_hoje, gcs, None, hoje)
        if dia is None:
            rel.p("**(a) falhou também por gerência: o gerador publica metaDia = null.**")
            return
        estado["meta_dia"] = dia
        por_gc = defaultdict(lambda: defaultdict(float))
        for r, ks in dia.items():
            gc = _gc_painel(gc_da_rota, r)
            if gc:
                for k, v in ks.items():
                    por_gc[gc][k] += v
        rel.p(f"(a) soma por gerência, {fontes.filtro_hoje(cons, hoje)} (rotas do painel):")
        rel.tabela(["gerência"] + [M.LABELS[k] for k in VOL] + ["total"],
                   [[g] + [_n(por_gc[g].get(k, 0.0)) for k in VOL] + [_n(sum(por_gc[g].values()))]
                    for g in M.GC_ATIVAS if g in por_gc])
        # (b) e (c): a mesma medida por rota x cliente, para ver se o valor da rota se repete em cada cliente
        sel = [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.META_RECUPERAVEL]
        filtro = e(eq(CM.ANOMES, anomes_hoje), ou(CM.AGRUPADOR, list(M.AGRUPADORES_VOLUME.values())),
                   fontes.filtro_hoje(cons, hoje), ou(CM.ROTA, [r for r in amostra if r in gc_da_rota]))
        lin = [l for ls in cons.em_paralelo(fontes._por_gerencia(M.OBJ_META, sel, filtro, gcs, None)).values()
               for l in ls]
        soma, maximo, n = defaultdict(float), defaultdict(float), defaultdict(int)
        for l in lin:
            r, k, v = fontes._rota(l.get(CM.ROTA)), M.indicador_volume(l.get(CM.AGRUPADOR)), numero(l.get(CM.META_RECUPERAVEL))
            if r and k:
                soma[(r, k)] += v
                maximo[(r, k)] = max(maximo[(r, k)], v)
                n[(r, k)] += v > 0
        linhas = []
        for r in amostra:
            if r not in gc_da_rota:
                continue
            for k in VOL:
                a = dia.get(r, {}).get(k, 0.0)
                rep = n[(r, k)] > 1 and a > 0 and abs(maximo[(r, k)] - a) <= 0.005 * a
                linhas.append([f"rota {r}", M.LABELS[k], _n(a), _n(soma[(r, k)]), _n(maximo[(r, k)]), n[(r, k)],
                               "**sim**" if rep else "não"])
        rel.p("\n(a) por rota (o gerador usa esta) x (b) soma por rota x cliente x (c) máximo por rota x cliente e nº de "
              "clientes com valor > 0. 'Repetido' = o máximo de um cliente já é o valor da rota.")
        rel.tabela(["rota", "macro", "(a) por rota", "(b) soma rota x cliente", "(c) máx. por cliente",
                    "clientes > 0", "repetido?"], linhas)
    etapa("META_RECUPERAVEL_ROTA", recuperavel)

    # 3. comparação ----------------------------------------------------------------
    rel.h(f"3. Volume: painel atual x critério do SAC ({anomes})")

    def comparacao():
        vm = estado.get("vm") or fontes.carregar_volume_real(cons, anomes, gcs, None)
        # curva do gerador (rota da meta, se existir) e, para comparação, a soma pela rota do cliente
        curva_mes, curva_rest, fonte = fontes.carregar_curva_neg(cons, anomes, gcs, None, hoje)
        neg_mes, neg_rest = fontes.carregar_meta_neg(cons, anomes, gcs, None, hoje)
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
        restantes = cal.total_dias_uteis - cal.dia_ontem
        # meta e Neg Restante de cada rota pela regra do gerador (modelo.meta_e_restante)
        calc = {}
        for r in estado["rotas"]:
            for k in VOL:
                calc[(r, k)] = modelo.meta_e_restante(metas_vol.get(r, {}).get(k), curva_mes.get(r, {}).get(k),
                                                      (curva_rest or {}).get(r, {}).get(k, 0.0), restantes,
                                                      cal.total_dias_uteis, direto=fonte == fontes.ROTA_META)
        estado.update(calc=calc, vm=vm, metas_vol=metas_vol, neg_a=(neg_mes, neg_rest), fonte_neg=fonte)

        def valores(rotas: list[str], k: str) -> list:
            def s(d):
                return sum(d.get(r, {}).get(k, 0.0) for r in rotas)
            real_ant, real, nm, nr = s(vm.todos_status), s(vm.real), s(neg_mes), s(neg_rest)
            cm, cr = s(curva_mes), s(curva_rest or {})
            mvol, mdia_ant = s(metas_vol), s(antiga)
            meta = sum(calc[(r, k)][0] or 0.0 for r in rotas)
            rest = sum(calc[(r, k)][1] or 0.0 for r in rotas)
            tend, tend_neg = real + rest, real + nr
            linear = real_ant / cal.dia_ontem * cal.total_dias_uteis if cal.dia_ontem else real_ant
            return [_n(real_ant), _n(real), _n(meta), None if not cm else f"{cr / cm:.4f}".replace(".", ","),
                    _n(rest), _n(tend), _pct2(tend, meta), _n(nm), _n(nr), _n(tend_neg), _pct2(tend_neg, nm),
                    _n(mvol), _n(linear), _n(mdia_ant), None if nova is None else _n(s(nova))]

        cab = ["", "macro", "Real atual", "Vol Real", "Meta (META_VOLUME)", "fração restante", "Neg Rest. novo",
               "Tend. nova", "% novo", "META_NEG (rota cliente)", "Neg Rest. (NEG)", "Tend. (NEG)", "% (NEG)",
               "META_VOLUME bruta", "Tend. linear antiga", "META_DIA antiga", "Meta do dia"]
        linhas = []
        for gc in M.GC_ATIVAS:
            rotas = [r for r in estado["rotas"] if gc_da_rota[r] == gc]
            if rotas:
                linhas += [[f"**{gc}**", M.LABELS[k]] + valores(rotas, k) for k in VOL]
        for r in amostra:
            if r in gc_da_rota:
                linhas += [[f"rota {r} ({gc_da_rota[r]})", M.LABELS[k]] + valores([r], k) for k in VOL]
            else:
                linhas.append([f"rota {r}", "não está na base de clientes"] + [None] * (len(cab) - 2))
        rel.p("Real atual = FX_VOL_PADRAO_FAT do mês com todos os status (painel antigo). Vol Real = só os status do SAC. "
              f"**Novo** (o gerador publica; curva da META_NEG pela **{'rota da meta' if fonte == fontes.ROTA_META else 'rota do cliente'}**): "
              "Meta = META_VOLUME da rota; fração restante = META_NEG de hoje ao fim do mês / META_NEG do mês; "
              "Neg Rest. novo = restante direto (rota da meta, mês a até 1% da META_VOLUME) ou Meta x fração "
              "(casos-limite: modelo.meta_e_restante); Tendência = "
              "Vol Real + Neg Rest.; % sobre a Meta. **Versão anterior** (soma de META_NEG dos clientes) ao lado. "
              f"Linear antiga = Real atual / {cal.dia_ontem} x {cal.total_dias_uteis}. "
              "Gerência = soma das rotas do painel (Neutraliza incluída).")
        rel.tabela(cab, linhas)
    etapa("comparação", comparacao)

    # 3b. rota do cliente x rota da meta ---------------------------------------------------
    rel.h("3b. Curva da META_NEG: rota do cliente x rota da meta (Refrigerantes e Água Mineral)")

    def rota_cliente_x_meta():
        neg_a_mes, neg_a_rest = estado["neg_a"]
        metas_vol, calc, vm = estado["metas_vol"], estado["calc"], estado["vm"]
        try:
            neg_b_mes, neg_b_rest = fontes.carregar_meta_neg(cons, anomes, gcs, None, hoje, col_rota=CM.META_ROTA)
            if not any(v for ks in neg_b_mes.values() for v in ks.values()):
                rel.p(f"META_NEG por `{CM.META_ROTA}` veio sem rota: a medida não aceita essa dimensão.")
                neg_b_mes = neg_b_rest = None
        except Exception as erro:  # noqa: BLE001
            rel.p(f"META_NEG por `{CM.META_ROTA}` falhou: `{erro}`")
            neg_b_mes = neg_b_rest = None
        cal = estado["cal"]
        restantes = cal.total_dias_uteis - cal.dia_ontem

        def linha(rot: str, rotas: list[str], k: str) -> list:
            def s(d):
                return sum((d or {}).get(r, {}).get(k, 0.0) for r in rotas)
            mv, real = s(metas_vol), s(vm.real)
            esc_a = esc_b = 0.0
            for r in rotas:
                m_r = metas_vol.get(r, {}).get(k)
                esc_a += modelo.meta_e_restante(m_r, neg_a_mes.get(r, {}).get(k), neg_a_rest.get(r, {}).get(k, 0.0),
                                                restantes, cal.total_dias_uteis)[1] or 0.0
                if neg_b_mes is not None:
                    esc_b += modelo.meta_e_restante(m_r, neg_b_mes.get(r, {}).get(k), neg_b_rest.get(r, {}).get(k, 0.0),
                                                    restantes, cal.total_dias_uteis)[1] or 0.0
            ger = sum((calc.get((r, k)) or (0, 0, 0))[1] or 0.0 for r in rotas)
            tb = None if neg_b_mes is None else real + s(neg_b_rest)
            tbe = None if neg_b_mes is None else real + esc_b
            return [rot, M.LABELS[k], _n(s(neg_a_mes)), _n(s(neg_a_rest)),
                    None if neg_b_mes is None else _n(s(neg_b_mes)), None if neg_b_mes is None else _n(s(neg_b_rest)),
                    _n(mv), _n(real), _n(real + esc_a), _pct2(real + esc_a, mv), _n(tb), _pct2(tb, mv),
                    _n(tbe), _pct2(tbe, mv), _n(real + ger), _pct2(real + ger, mv)]

        linhas = []
        for k in ("VOL REFRIGERANTES", "VOL AGUA MINERAL"):
            for gc in M.GC_ATIVAS:
                rotas = [r for r in estado["rotas"] if gc_da_rota[r] == gc]
                if rotas:
                    linhas.append(linha(f"**{gc}**", rotas, k))
            for r in AMOSTRA_ROTA_META:
                linhas.append(linha(f"rota {r}", [r], k) if r in gc_da_rota else
                              [f"rota {r}", M.LABELS[k], "fora da base de clientes"] + [None] * 13)
        rel.p("(a) META_NEG agrupada pela rota atual do cliente (CD_ROTA_Clien); (b) pela rota da meta "
              "(CD_ROTA_Chave_Meta_SAP); (c) META_VOLUME. Tendências: atual = Real + Meta x fração de (a); "
              "(b) direto = Real + restante de (b); (b) escalonado = Real + Meta x fração de (b); gerador = regra "
              "publicada (b direto até 1% de diferença, senão escalonado). % sobre a META_VOLUME.")
        rel.tabela(["", "macro", "(a) mês", "(a) restante", "(b) mês", "(b) restante", "(c) META_VOLUME", "Real",
                    "Tend. atual", "%", "Tend. (b) direto", "%", "Tend. (b) escalonado", "%", "Tend. gerador", "%"],
                   linhas)

        # clientes cuja rota atual difere da rota da meta (sem códigos: só contagens e volume)
        sel = [CM.ROTA, CM.META_ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.META_NEG]
        lin = cons.linhas(M.OBJ_META, sel, e(eq(CM.ANOMES, anomes),
                                             ou(CM.AGRUPADOR, [M.AGRUPADORES_VOLUME["VOL REFRIGERANTES"],
                                                               M.AGRUPADORES_VOLUME["VOL AGUA MINERAL"]])))
        grupos = defaultdict(lambda: [set(), 0.0])
        for l in lin:
            rc, rm = fontes._rota(l.get(CM.ROTA)), fontes._rota(l.get(CM.META_ROTA))
            k, v = M.indicador_volume(l.get(CM.AGRUPADOR)), numero(l.get(CM.META_NEG))
            if not k or not v:
                continue
            if not rm:
                tipo, gc = "sem rota da meta", gc_da_rota.get(rc, "fora do painel")
            elif rm not in gc_da_rota:
                continue
            elif rc not in gc_da_rota:
                tipo, gc = "rota do cliente fora do painel", gc_da_rota[rm]
            elif rc != rm:
                tipo, gc = "rota do cliente diferente (transferido)", gc_da_rota[rm]
            else:
                continue
            g = grupos[(gc, M.LABELS[k], tipo)]
            g[0].add(inteiro(l.get(CM.CLIENTE)))
            g[1] += v
        rel.p("\nLinhas de META_NEG cuja rota do cliente difere da rota da meta (rota da meta no painel), por "
              "gerência da rota da meta:")
        rel.tabela(["gerência", "macro", "situação", "clientes", "META_NEG do mês"],
                   [[gc, mac, t, len(g[0]), _n(g[1])] for (gc, mac, t), g in sorted(grupos.items())]
                   or [["—", "—", "nenhuma", 0, None]])
    etapa("rota do cliente x rota da meta", rota_cliente_x_meta)

    # 4. aceite contra o SAC ------------------------------------------------------------
    rel.h("4. Aceite contra o SAC (Refrigerantes, 17-18/10/2026)")

    def aceite():
        calc, vm = estado["calc"], estado["vm"]
        k = "VOL REFRIGERANTES"
        por_gc = {}
        for gc in SAC_17_10:
            rotas = [r for r in estado["rotas"] if gc_da_rota[r] == gc]
            if rotas:
                real = sum(vm.real.get(r, {}).get(k, 0.0) for r in rotas)
                meta = sum(calc[(r, k)][0] or 0.0 for r in rotas)
                por_gc[gc] = (real, meta, real + sum(calc[(r, k)][1] or 0.0 for r in rotas))
        vale = not simulado and hoje in DATAS_ACEITE
        if not vale:
            rel.p("Aceite só vale para hoje = 17/10/2026 ou 18/10/2026 sem simular a data; aqui só a comparação.")
        rel.p("Tolerância: Real ±0,1% (G3 pode divergir pela SV.G3.3, fora do painel); Meta exata; "
              "Tendência ±0,2%; % ±0,1 p.p.")
        linhas, ok_total = aceite_sac(por_gc, vale)
        rel.tabela(["GC", "Real API", "Real SAC", "", "Meta API", "Meta SAC", "", "Tend. API", "Tend. SAC", "",
                    "% API", "% SAC", ""], linhas)
        if vale:
            rel.p(f"\nResultado: **{'OK' if ok_total else 'DIVERGE'}**")
    etapa("aceite", aceite)

    # 5. curva da meta da rota ------------------------------------------------------------
    rel.h("5. Investigação: META_VOLUME por DATA_MOVIMENTO (curva diária da meta da rota?)")

    def curva_rota():
        sel = [CM.META_ROTA, CM.META_AGRUPADOR, CM.DATA, CM.META_VOLUME]
        lin = cons.linhas(M.OBJ_META, sel, e(eq(CM.META_ANOMES, anomes),
                                             ou(CM.META_AGRUPADOR, list(M.AGRUPADORES_VOLUME.values()))))
        _, metas_vol = fontes.carregar_metas(cons, anomes, None)
        por = defaultdict(list)
        for l in lin:
            r, k = fontes._rota(l.get(CM.META_ROTA)), M.indicador_volume(l.get(CM.META_AGRUPADOR))
            if r and k:
                por[(r, k)].append((data(l.get(CM.DATA)), numero(l.get(CM.META_VOLUME))))
        tipos = defaultdict(int)
        curva = {}
        for (r, k), vals in por.items():
            meta = metas_vol.get(r, {}).get(k, 0.0)
            datas = [d for d, _ in vals if d]
            soma, maior = sum(v for _, v in vals), max((v for _, v in vals), default=0.0)
            if len(datas) <= 1:
                t = "sem data (um valor só)"
            elif meta and abs(soma - meta) <= 0.01 * meta:
                t = "distribuída por dia (soma = meta)"
                curva[(r, k)] = sum(v for d, v in vals if d and d >= hoje)
            elif meta and abs(maior - meta) <= 0.01 * meta:
                t = "repetida em cada dia (= meta)"
            else:
                t = "outra"
            tipos[t] += 1
        rel.p(f"{len(lin)} linhas (rota x macro x dia). Classificação por rota x macro: "
              + (", ".join(f"{t}: {n}" for t, n in sorted(tipos.items())) or "nenhuma linha"))
        if not curva:
            rel.p("Sem curva diária utilizável na META_VOLUME: o Neg Restante segue escalonado pela curva da META_NEG.")
            return
        calc = estado.get("calc", {})
        linhas = []
        grupos = [(f"**{gc}**", [r for r in estado["rotas"] if gc_da_rota[r] == gc]) for gc in M.GC_ATIVAS]
        grupos += [(f"rota {r}", [r]) for r in amostra if r in gc_da_rota]
        for rot, rotas in grupos:
            for k in VOL:
                if not any((r, k) in curva for r in rotas):
                    continue
                esc = sum((calc.get((r, k)) or (0, 0, 0))[1] or 0.0 for r in rotas)
                linhas.append([rot, M.LABELS[k], _n(esc), _n(sum(curva.get((r, k), 0.0) for r in rotas))])
        rel.tabela(["", "macro", "Neg Restante escalonado (gerador)", "Neg Restante pela curva da META_VOLUME"], linhas)
    etapa("curva da meta da rota", curva_rota)

    # 6. sobreposição online x faturado de hoje -------------------------------------
    rel.h(f"6. Sobreposição online x faturado em {hoje:%d/%m/%Y}")

    def sobreposicao():
        online = Online(atualizado_em=datetime.combine(hoje, datetime.min.time()))
        fontes.carregar_vendas(cons, anomes_hoje, gcs, None, online, so_pedidos_hoje=True)
        sel = [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.NF_STATUS, CM.VOL_MES]
        filtro = e(eq(CM.ANOMES, anomes_hoje), ou(CM.AGRUPADOR, list(M.AGRUPADORES_VOLUME.values())),
                   fontes.filtro_hoje(cons, hoje))
        nf = [l for ls in cons.em_paralelo(fontes._por_gerencia(M.OBJ_META, sel, filtro, gcs, None)).values()
              for l in ls]
        rel.p(f"Filtro usado: `{fontes.filtro_hoje(cons, hoje)}` · {len(nf)} linhas de NF hoje "
              "(rota x cliente x macro x status)")
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

    # 7. metas por gerência ------------------------------------------------------------
    rel.h("7. Metas por gerência (critério de virada do fechamento)")

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

    # 8. comodato ------------------------------------------------------------------------
    rel.h("8. Comodato: colunas que podem indicar o giro do mês anterior")

    def comodato():
        cols = [c for c in cons.colunas(M.OBJ_COMODATO) if COLUNAS_GIRO.search(c) and not COLUNAS_PROIBIDAS.search(c)]
        rel.p(f"{len(cols)} colunas com GIRO, MES ou ANT no nome (sem as que identificam cliente/equipamento).")
        for c in cols:
            try:
                lin = cons.linhas(M.OBJ_COMODATO, [c, CO.MEDIDA_AUX], M.FILTRO_COMODATO, top=5000)
            except Exception as erro:  # noqa: BLE001
                rel.p(f"- `{c}`: erro `{erro}`")
                continue
            # privacidade: só o nome da coluna e contagens (nunca os valores)
            distintos = {limpar(l.get(c)) for l in lin}
            rel.p(f"- `{c}`: {len(distintos)} valores distintos em {len(lin)} linhas"
                  + (" (limite de 5000 linhas atingido)" if len(lin) >= 5000 else ""))
    etapa("comodato", comodato)

    # 9. tempos --------------------------------------------------------------------------
    total = time.monotonic() - inicio
    rel.h("9. Tempo das consultas")
    tempos = getattr(cons, "tempos", [])
    rel.tabela(["objeto", "colunas", "linhas", "segundos"],
               [[o, s[:90] + ("…" if len(s) > 90 else ""), n, f"{t:.1f}"] for o, s, n, t in tempos])
    rel.p(f"\nSoma das consultas: {sum(t for *_, t in tempos):.0f} s (várias rodam em paralelo) · "
          f"tempo total do relatório: {total:.0f} s")

    def medido(sel: tuple) -> str:
        ts = [t for o, cols, _, t in tempos if o == M.OBJ_META and cols == ", ".join(sel)]
        return " + ".join(f"{t:.1f} s" for t in ts) or "—"
    rel.p("\nAntes (17/10, consultas por DATA_MOVIMENTO) x agora (data só no $filter):")
    rel.tabela(["consulta", "antes", "agora"], [
        ["META_NEG (mês e restante)", "~150 s, ~24.570 linhas (por dia)",
         medido((CM.ROTA, CM.AGRUPADOR, CM.META_NEG))],
        ["META_RECUPERAVEL_ROTA (hoje)", "~150 s por dia; no gerar.py HTTP 500",
         medido((CM.ROTA, CM.AGRUPADOR, CM.META_RECUPERAVEL))],
        ["gerar.py completo", "189 s", "seção 10 (medido pelo workflow)"],
    ])
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
    rel, _ = conferir(cons, hoje, [r.strip().upper() for r in args.rotas.split(",") if r.strip()],
                      simulado=bool(args.hoje))
    args.saida.mkdir(parents=True, exist_ok=True)
    destino = args.saida / "relatorio_tendencia.md"
    destino.write_text(rel.texto(f"Conferência da tendência de volume e do fechamento · {hoje:%d/%m/%Y} "
                                 f"(gerado {calmod.agora():%d/%m/%Y %H:%M})"), encoding="utf-8")
    print(f"\nRelatório: {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
