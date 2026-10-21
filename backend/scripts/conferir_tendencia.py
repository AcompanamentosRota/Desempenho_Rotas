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
  4. aceite contra a tela do SAC (Refrigerantes) da data do relatório, lida de conferencia/sac/refri_AAAA-MM-DD.csv
     (sem o arquivo do dia: "sem tela do SAC para esta data");
  5. investigação: META_VOLUME por DATA_MOVIMENTO tem curva diária?
  6. sobreposição online x faturado de hoje (clientes e volume em WF Online e em NF de hoje, por status);
  7. META_VOLUME e META_COBERTURA por gerência no mês atual e no próximo (critério de virada);
  8. colunas do comodato que podem indicar giro do mês anterior (GIRO, MES, ANT): só nomes e contagens;
  9. tempo de cada consulta, total e antes x depois;
  E1-E6. 16 gerências, Gc. At, agrupadores novos (Del Valle Frut, Sucos, Ades, Powerade) e E3b Del Valle Frut na
     G2 (meta e real por rota), Desempenho GDM, E5 rotas Neutraliza e virtuais (por rota: gerência, supervisão,
     clientes, Meta e Real de Refrigerantes, aparece/oculta) e E5b rota 551, tamanho dos JSONs (este no workflow);
  E7. diferenças contra a tela do SAC por gerência (Refrigerantes; só com o CSV do dia): qual gerência do modelo de
     vendas reproduz o SAC, reconciliação (painel x SAC x contribuições x resíduo), contribuições por rota com a
     causa, deslocamentos entre gerências e uma linha de resumo por gerência. Só relata: nada muda no gerador.
  E8. descoberta do incentivo Todos a Bordo 3.0 (cobertura de cervejas, mês atual): agrupadores com HEINEKEN,
     EISENBAHN, CERVEJ ou 600, os 5 itens da campanha, meta por gerência e rota (FULL x BARRACUDA pela meta de
     Heineken), online de hoje, realizado e uma proposta de mapeamento. Só relata.
  E9. SEM_COMPRA_MES do payload que o gerar.py gravou (workflow: `--e9 PAYLOAD`, sem rede, acrescentada ao relatório):
     por gerência, soma dos tamanhos das listas x soma de semCompra, rotas com divergência, SEM_COMPRA_HOJE contido,
     tamanho que a chave acrescenta e tempo. Só contagens e códigos de rota.
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
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import NamedTuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gerador import calendario as calmod  # noqa: E402
from gerador import fontes, modelo  # noqa: E402
from gerador import mapeamento as M  # noqa: E402
from gerador.consulta import Consulta, e, eq, ou  # noqa: E402
from gerador.payload import _mais_comum  # noqa: E402
from gerador.texto import data, inteiro, limpar, normalizar, numero  # noqa: E402
from gerador.tipos import Online  # noqa: E402

CM, CO, CB = M.ColMeta, M.ColComodato, M.ColBase
VOL = M.INDICADORES_VOLUME
ROTAS_FIXAS = ["111", "211", "311"]
# rotas da conferência de 18/10 (514, 535, M21 e M24 puxavam a diferença da tendência em AP e MO)
AMOSTRA_ROTA_META = ["111", "211", "311", "511", "514", "535", "I11", "M11", "M21", "M22", "M24"]
# Tela do SAC (Refrigerantes) por dia: conferencia/sac/refri_AAAA-MM-DD.csv (README: como adicionar)
PASTA_SAC = Path(__file__).resolve().parents[1] / "conferencia" / "sac"
COLUNAS_SAC = ["GC", "Real", "Meta", "Tendencia", "MetaDia"]
K_REFRI = "VOL REFRIGERANTES"
# tolerâncias do aceite: Real ±0,1%; Meta exata (inteiros); Tendência ±0,2%; % ±0,1 p.p.; Meta do dia ±1%
TOL_REAL, TOL_TEND, TOL_PCT, TOL_META_DIA = 0.001, 0.002, 0.1, 0.01
# E7: colunas do modelo de vendas que só a conferência lê (as do painel ficam em mapeamento.py).
# Só códigos: gerência ('Gc. An'), supervisão ('Sv. G1. 1') e rota; nunca nomes nem clientes.
COL_GC_COMERCIAL = CM.GC_COMERCIAL                     # gerência comercial do cliente (o gerador usa)
COL_SV_CLIENTE = "DS_SUPERVISOR_ATUAL_Clien"           # código da supervisão atual do cliente
COL_GC_COMERCIAL_META = "DS_GERENCIA_COM_Chave_Meta_SAP"
COL_GC_AGRUPADA_META = "DS_GC_AGRUPADA__Chave_Meta_SAP"
COL_SV_META = "DS_SUPERVISAO_Chave_Meta_SAP"
E7_MAX_LINHAS = 12   # contribuições por gerência e medida (as demais vão somadas numa linha)
# causas das diferenças (E7b)
CAUSA_EV = "fora do painel: EV*"
CAUSA_BALCAO = "fora do painel: SV.BL.*"
CAUSA_INVALIDA = "fora do painel: INVALIDO / G*E / G*F / APE"
CAUSA_SEM_CLIENTE = "sem cliente corrente e ativo"
CAUSA_NEUTRALIZA = "Neutraliza (entra no total)"
CAUSA_VIRTUAL = "virtual (entra no total)"
CAUSA_EVENTUAIS = "clientes em rotas EV* (rota oculta, entra no total)"
CAUSA_OUTRA_GC = "gerência do modelo ≠ gerência do painel (rota atribuída a outra gerência)"
CAUSA_ROTA_META = "rota da meta ≠ rota do cliente"
ROTA_INVALIDA = re.compile(r"^(INVALIDO|G[A-Z0-9]{1,2}[EF]|APE)$")
_SV_SIGLA = re.compile(r"^SV\.(?:BL\.)?([A-Z0-9]+)(?:\.\d+)?$")
_CODIGO = re.compile(r"^[A-Z0-9][A-Z0-9_.-]{0,11}$")
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

    def h3(self, t: str):
        self.linhas += ["", f"### {t}", ""]
        print(f"\n-- {t}")

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


def _cx(v: float | None) -> str | None:
    """Caixas inteiras (sem o '-0' de valores pequenos negativos)."""
    return None if v is None else _n(_inteiro(v) or 0.0, 0)


def _pct(v: float | None, meta: float | None) -> str | None:
    return None if v is None or not meta else f"{round(v / meta * 100)}%"


def _pct2(v: float | None, meta: float | None) -> str | None:
    return None if v is None or not meta else f"{v / meta * 100:.2f}%".replace(".", ",")


def _gc_painel(gc_da_rota: dict[str, str], rota: str) -> str | None:
    return gc_da_rota.get(rota)


def _sinal(v: float | None, casas: int = 2, sufixo: str = "") -> str | None:
    """'+0,04%' / '-0,11' (zero arredondado sai '+0,00', nunca '-0,00')."""
    return None if v is None else f"{round(v, casas) or 0.0:+.{casas}f}{sufixo}".replace(".", ",")


def _inteiro(v: float) -> int:
    """Inteiro arredondado (meio para cima), como as telas mostram: a Meta é comparada assim, nunca em float."""
    return int(Decimal(repr(float(v))).quantize(Decimal(1), rounding=ROUND_HALF_UP))


# ------------------------------------------------------------------ tela do SAC (CSV por dia)
class ErroTelaSac(ValueError):
    """CSV da tela do SAC fora do formato (cabeçalho, nº de colunas, gerência ou número)."""


def _numero_sac(txt: str, onde: str) -> float | None:
    """'141599', '141.599' ou '13647,5' -> float; vazio -> None (sem o dado na tela)."""
    t = txt.strip().replace(" ", "")
    if not t:
        return None
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", t):   # separador de milhar
        t = t.replace(".", "")
    try:
        return float(t.replace(",", "."))
    except ValueError:
        raise ErroTelaSac(f"{onde}: {txt.strip()!r} não é número") from None


def ler_tela_sac(caminho: Path) -> tuple[str, dict[str, dict[str, float | None]]]:
    """(comentário, {sigla: {Real, Meta, Tendencia, MetaDia}}) do CSV da tela do SAC.

    Separador ';'; linhas vazias e as que começam com '#' são ignoradas (a 1ª de comentário diz a fonte e o
    horário); o cabeçalho tem de ser GC;Real;Meta;Tendencia;MetaDia (sem diferença de acento ou maiúsculas).
    Valor vazio = a tela não tem o dado (a célula não é comparada).
    """
    bruto = caminho.read_bytes()
    try:
        texto = bruto.decode("utf-8-sig")
    except UnicodeDecodeError:   # salvo pelo Excel em ANSI
        texto = bruto.decode("cp1252")
    comentario, cabecalho, dados = "", False, {}
    for n, linha in enumerate(texto.splitlines(), 1):
        linha = linha.strip()
        if not linha or linha.startswith("#"):
            comentario = comentario or linha.lstrip("#").strip()
            continue
        campos = [c.strip() for c in linha.split(";")]
        onde = f"{caminho.name}, linha {n}"
        if not cabecalho:
            if [normalizar(c) for c in campos] != [normalizar(c) for c in COLUNAS_SAC]:
                raise ErroTelaSac(f"{onde}: o cabeçalho tem de ser {';'.join(COLUNAS_SAC)} (veio: {linha})")
            cabecalho = True
            continue
        if len(campos) != len(COLUNAS_SAC):
            raise ErroTelaSac(f"{onde}: {len(campos)} colunas; o esperado são {len(COLUNAS_SAC)} "
                              f"({';'.join(COLUNAS_SAC)})")
        gc = M.codigo_gc(campos[0])
        if gc not in M.GC_NOMES:
            raise ErroTelaSac(f"{onde}: gerência {campos[0]!r} não é uma das siglas do painel ({' '.join(M.GC_NOMES)})")
        if gc in dados:
            raise ErroTelaSac(f"{onde}: gerência {gc} repetida")
        dados[gc] = {c: _numero_sac(v, f"{onde}, {c}") for c, v in zip(COLUNAS_SAC[1:], campos[1:])}
    if not cabecalho:
        raise ErroTelaSac(f"{caminho.name}: sem o cabeçalho {';'.join(COLUNAS_SAC)}")
    if not dados:
        raise ErroTelaSac(f"{caminho.name}: nenhuma gerência")
    return comentario, dados


def arquivo_sac(hoje: date, pasta: Path = PASTA_SAC) -> Path:
    return pasta / f"refri_{hoje:%Y-%m-%d}.csv"


def comparar_sac(api: dict[str, tuple], sac: dict[str, dict]) -> tuple[list[list], bool]:
    """Linhas da seção 4 (gerências do CSV, na ordem do painel, e o total) e se tudo bateu.

    api: gc -> (Real, Meta, Tendência, Meta do dia | None). Cada comparação tem a sua coluna OK/DIVERGE;
    sem o valor no CSV, a célula não é comparada (vazia).
    """
    linhas, tudo_ok = [], True
    gcs = [g for g in M.GC_NOMES if g in sac]

    def soma(valores):
        return None if any(v is None for v in valores) else sum(valores)

    def linha(rotulo, a, s):
        real, meta, tend, dia = a if a else (None,) * 4
        s_real, s_meta, s_tend, s_dia = (s[c] for c in COLUNAS_SAC[1:])
        pct = tend / meta * 100 if tend is not None and meta else None
        s_pct = s_tend / s_meta * 100 if s_tend is not None and s_meta else None

        def marca(sv, av, ok):
            nonlocal tudo_ok
            if sv is None:
                return ""
            bate = av is not None and ok(av, sv)
            tudo_ok &= bate
            return "OK" if bate else "**DIVERGE**"

        def rel(av, sv):
            return None if av is None or sv is None or not sv else (av - sv) / sv * 100

        return [rotulo, _n(real, 0), _n(s_real, 0), None if real is None or s_real is None else _cx(real - s_real),
                marca(s_real, real, lambda x, y: abs(x - y) <= TOL_REAL * abs(y)),
                _n(meta, 0), _n(s_meta, 0), marca(s_meta, meta, lambda x, y: _inteiro(x) == _inteiro(y)),
                _n(tend, 0), _n(s_tend, 0), _sinal(rel(tend, s_tend), sufixo="%"),
                marca(s_tend, tend, lambda x, y: abs(x - y) <= TOL_TEND * abs(y)),
                _pct2(pct, 100), _pct2(s_pct, 100), _sinal(None if pct is None or s_pct is None else pct - s_pct),
                marca(s_pct, pct, lambda x, y: abs(x - y) <= TOL_PCT),
                _n(dia, 0), _n(s_dia, 0), _sinal(rel(dia, s_dia), sufixo="%"),
                marca(s_dia, dia, lambda x, y: abs(x - y) <= TOL_META_DIA * abs(y))]

    for gc in gcs:
        linhas.append(linha(gc, api.get(gc), sac[gc]))
    tot_api = None if any(g not in api for g in gcs) else tuple(soma([api[g][i] for g in gcs]) for i in range(4))
    tot_sac = {c: soma([sac[g][c] for g in gcs]) for c in COLUNAS_SAC[1:]}
    rotulo = "**TOTAL BAND**" if len(gcs) == len(M.GC_NOMES) else f"**TOTAL ({len(gcs)} gerências)**"
    linhas.append(linha(rotulo, tot_api, tot_sac))
    return linhas, tudo_ok


CAB_SAC = ["GC", "Real API", "Real SAC", "dif", "", "Meta API", "Meta SAC", "", "Tendência API", "SAC", "dif %", "",
           "% API", "% SAC", "dif p.p.", "", "Meta dia API", "SAC", "dif %", ""]


def rotas_do_painel(clientes) -> tuple[dict[str, str], dict[str, str]]:
    """(rota -> gerência, rota -> supervisão) pela regra do payload (a mais comum entre os clientes da rota)."""
    por_rota = defaultdict(dict)
    for c in clientes:
        por_rota[c.rota].setdefault(c.pv, c)
    gc = {r: _mais_comum([c.gc for c in cs.values()]) for r, cs in por_rota.items()}
    sv = {r: _mais_comum([c.sv for c in cs.values()]) for r, cs in por_rota.items()}
    return gc, sv


# ------------------------------------------------------------------ E7: diferenças contra o SAC, por rota
def _codigo(valor: object) -> str | None:
    """Código para o relatório (rota, gerência, supervisão): só letras, números, '.', '_' e '-', sem espaço;
    '--'/vazio -> None. Qualquer outra coisa vira 'outro' (nunca imprime texto livre que possa ser nome)."""
    t = normalizar(valor).replace(" ", "")
    if t in ("", "--", "#"):
        return None
    return t if _CODIGO.match(t) else "outro"


def _sigla_gc(valor: object) -> str | None:
    """'Gc. An' -> 'AN'; só as 16 siglas do painel ('Gc. Me', '--' e as agrupadas -> None)."""
    g = M.codigo_gc(valor)
    return g if g in M.GC_NOMES else None


def _sigla_agrupada(gc: object, sv: object) -> str | None:
    """Gerência agrupada + prefixo da supervisão, como o painel separa ('Gc. Pa_Di' + 'Sv. Bl. Di' -> 'DI')."""
    g = M.codigo_gc(gc)
    if g in M.GC_NOMES:
        return g
    m = _SV_SIGLA.match(M.codigo_sv(sv))
    return m.group(1) if m and m.group(1) in M.GC_SIGLAS_ORIGEM.get(g, []) else None


# gerência do modelo de vendas: candidatas testadas contra a tela do SAC (a que reproduz melhor é usada na E7)
CANDIDATAS_GC = [
    (f"`{COL_GC_COMERCIAL}` (gerência comercial atual do cliente)", [COL_GC_COMERCIAL],
     lambda l: _sigla_gc(l.get(COL_GC_COMERCIAL)), lambda l: l.get(COL_GC_COMERCIAL)),
    (f"`{CM.GC}` + prefixo de `{COL_SV_CLIENTE}` (como o painel separa as agrupadas)", [CM.GC, COL_SV_CLIENTE],
     lambda l: _sigla_agrupada(l.get(CM.GC), l.get(COL_SV_CLIENTE)), lambda l: l.get(CM.GC)),
    (f"`{COL_GC_COMERCIAL_META}` (gerência da meta)", [COL_GC_COMERCIAL_META],
     lambda l: _sigla_gc(l.get(COL_GC_COMERCIAL_META)), lambda l: l.get(COL_GC_COMERCIAL_META)),
    (f"`{COL_GC_AGRUPADA_META}` + prefixo de `{COL_SV_META}` (gerência agrupada da meta)",
     [COL_GC_AGRUPADA_META, COL_SV_META],
     lambda l: _sigla_agrupada(l.get(COL_GC_AGRUPADA_META), l.get(COL_SV_META)), lambda l: l.get(COL_GC_AGRUPADA_META)),
]


class Linha(NamedTuple):
    """Uma linha do modelo de vendas (Refrigerantes) já normalizada para a E7."""
    rota: str               # rota do cliente (CD_ROTA_Clien)
    rota_meta: str          # rota da meta (CD_ROTA_Chave_Meta_SAP); '' sem rota
    gc_modelo: str | None   # gerência do modelo (uma das 16 siglas) ou None
    cod_modelo: str | None  # a mesma gerência como código ('ME'), para a descrição
    sv: str | None          # supervisão do cliente no modelo (código)
    no_escopo: bool         # a consulta do painel pega a linha (gerência agrupada do cliente é do painel)
    valor: float
    gc_comercial: str | None = None   # gerência comercial do cliente: o painel soma por ela os clientes em EV*


class Painel(NamedTuple):
    """O que o painel publica, por rota, e a base de clientes sem os filtros do painel (para as causas)."""
    gc_rota: dict           # rota do painel -> gerência (regra do payload), com as rotas ocultas das EV*
    sv_rota: dict           # rota do painel -> supervisão
    base: dict              # rota da base (corrente e ativo, sem os filtros do painel) -> {supervisões}
    gc_base: dict           # rota da base -> sigla da gerência na base (None se não for uma das 16)


def tipo_rota(rota: str, p: Painel) -> str | None:
    """Neutraliza, virtual, rota oculta das EV* ou supervisão oculta (todas entram no total da gerência do painel)."""
    if rota in M.NEUTRALIZA_ROTAS:
        return CAUSA_NEUTRALIZA
    if rota in M.VIRTUAIS_ROTAS:
        return CAUSA_VIRTUAL
    if p.gc_rota.get(rota) and rota == M.rota_eventuais(p.gc_rota[rota]):
        return CAUSA_EVENTUAIS
    sv = p.sv_rota.get(rota)
    if sv in M.OCULTAS and p.gc_rota.get(rota) not in M.GC_SEM_OCULTAS:
        return f"oculta: {sv}"
    return None


def causa_fora_do_painel(rota: str, p: Painel) -> str:
    """Por que a rota não está no painel (a ordem decide quando há mais de um motivo)."""
    if not rota:
        return "outra: venda sem rota do cliente"
    if not M.rota_do_painel(rota):
        return CAUSA_EV
    svs = p.base.get(rota, set())
    if ROTA_INVALIDA.match(rota) or any("INVALIDO" in s for s in svs):
        return CAUSA_INVALIDA
    if rota not in p.base:
        return CAUSA_SEM_CLIENTE
    if any(s.startswith(M.SV_IGNORAR_PREFIXOS) for s in svs):
        return CAUSA_BALCAO
    if not any(M.sv_do_painel(s) for s in svs):
        return ("outra: supervisão fora do padrão SV.<sigla>.<n> ("
                + ", ".join(sorted(_codigo(s) or "—" for s in svs)) + ")")
    return "outra: rota fora do painel"


class Contribuicoes(NamedTuple):
    por_gc: dict            # gc -> {(rota do cliente, rota da meta, causa, detalhe): cx}; cx = painel - SAC
    deslocamentos: dict     # (rota, gc no painel, gc no modelo) -> cx (rota do painel em outra gerência no modelo)
    fora_outra_gc: dict     # (rota fora do painel, gc da rota na base, gc no modelo) -> cx
    hipoteses: dict         # cx: 'a' fora do painel, 'd' rota da meta ≠ rota do cliente (painel - SAC); 'b' deslocado


def rota_no_painel(l: Linha, p: Painel, por_rota_meta: bool) -> tuple[str, str | None]:
    """(rota em que o gerador conta a linha, gerência dela; None se o painel não conta).

    Real: rota do cliente, no escopo da consulta (gerência agrupada do cliente do painel); cliente em rota EV*: a
    rota oculta da gerência comercial dele. Meta do dia: rota da meta, sem filtro de gerência.
    """
    if por_rota_meta:
        return l.rota_meta, (p.gc_rota.get(l.rota_meta) if l.rota_meta else None)
    if not l.no_escopo:
        return l.rota, None
    if l.rota in p.gc_rota:
        return l.rota, p.gc_rota[l.rota]
    if M.rota_eventual(l.rota) and l.gc_comercial and p.gc_rota.get(M.rota_eventuais(l.gc_comercial)):
        return M.rota_eventuais(l.gc_comercial), l.gc_comercial
    return l.rota, None


def contribuicoes(linhas: list[Linha], p: Painel, por_rota_meta: bool) -> Contribuicoes:
    """Linhas que o painel e o modelo do SAC contam em gerências diferentes, com a causa.

    O painel conta a linha na gerência da rota em que o gerador a põe (rota_no_painel); o SAC, na gerência do
    modelo. Linha contada só pelo SAC entra com sinal negativo na gerência do modelo; só pelo painel, positivo na
    gerência do painel; assim, soma das contribuições = painel - modelo.
    """
    def c(r):
        return _codigo(r) or "—"

    por_gc = defaultdict(lambda: defaultdict(float))
    desloc, fora_gc, hip = defaultdict(float), defaultdict(float), defaultdict(float)
    for l in linhas:
        if not l.valor:
            continue
        rp, gp = rota_no_painel(l, p, por_rota_meta)
        gm = l.gc_modelo
        rm = l.rota_meta if l.rota_meta != l.rota else ""
        if gp is not None and gp == gm:
            continue
        if gm:   # o SAC conta na gerência do modelo e o painel não
            if gp:
                causa, det = CAUSA_OUTRA_GC, f"rota {c(rp)} na {gp} no painel"
            elif por_rota_meta:
                if not l.rota_meta:
                    causa, det = "outra: meta do dia sem rota da meta", f"cliente na rota {c(l.rota)}"
                else:
                    fora = causa_fora_do_painel(l.rota_meta, p)
                    hip["a"] -= l.valor
                    if rm and p.gc_rota.get(l.rota) == gm:   # pela rota do cliente (regra anterior) contaria
                        hip["d"] -= l.valor
                        causa = CAUSA_ROTA_META
                        det = f"rota da meta {c(rm)} ({fora}); cliente na rota {c(l.rota)} da {gm} no painel"
                    else:
                        causa, det = fora, (f"cliente na rota {c(l.rota)}" if rm else "")
            elif l.rota in p.gc_rota:
                causa = "outra: gerência agrupada do cliente fora das do painel"
                det = f"rota {c(l.rota)} da {p.gc_rota[l.rota]} no painel"
            else:
                causa = causa_fora_do_painel(l.rota, p)
                hip["a"] -= l.valor
                meta_no_painel = bool(rm) and p.gc_rota.get(rm) == gm
                if meta_no_painel:
                    hip["d"] -= l.valor
                gb = p.gc_base.get(l.rota)
                if gb and gb != gm:
                    fora_gc[(l.rota, gb, gm)] -= l.valor
                fora_oculta = ("" if not M.rota_eventual(l.rota) else
                               f"a {l.gc_comercial} não tem rota oculta das EV*" if l.gc_comercial else
                               "cliente sem gerência comercial do painel (fora da rota oculta)")
                det = "; ".join(x for x in [
                    fora_oculta,
                    f"supervisão no modelo {l.sv}" if l.sv else "",
                    f"rota da {gb} na base" if gb and gb != gm else "",
                    f"rota da meta {c(rm)}" + (" (no painel)" if meta_no_painel else "") if rm else ""] if x)
            por_gc[gm][(l.rota, l.rota_meta, causa, det)] -= l.valor
        if gp:   # o painel conta na gerência dele e o SAC não
            tipo = tipo_rota(rp, p)
            if gm:
                causa = CAUSA_OUTRA_GC
                det = "; ".join(x for x in [f"gerência do modelo {gm}",
                                            f"rota {c(rp)} no painel" if rp != l.rota and not por_rota_meta else "",
                                            tipo or ""] if x)
                desloc[(rp, gp, gm)] += l.valor
                hip["b"] += l.valor
            else:
                causa = tipo or f"outra: gerência do modelo fora das 16 ({l.cod_modelo or '—'})"
                det = f"gerência do modelo {l.cod_modelo or '—'}"
            por_gc[gp][(l.rota, l.rota_meta, causa, det)] += l.valor
    return Contribuicoes({g: dict(v) for g, v in por_gc.items()}, dict(desloc), dict(fora_gc), dict(hip))


def reconciliar(painel: float | None, sac: float | None, contrib: dict) -> tuple[float | None, float, float | None]:
    """(diferença painel - SAC, soma das contribuições, resíduo = diferença - contribuições)."""
    soma = sum(contrib.values())
    if painel is None or sac is None:
        return None, soma, None
    dif = painel - sac
    return dif, soma, dif - soma


def resumo_causas(contrib: dict) -> list[tuple[str, float]]:
    """Contribuições somadas por causa, da maior para a menor (valor absoluto)."""
    por = defaultdict(float)
    for (_, _, causa, _), v in contrib.items():
        por[causa] += v
    return sorted(((c, v) for c, v in por.items() if round(v) != 0 or abs(v) >= 0.5), key=lambda cv: -abs(cv[1]))


def linha_modelo(l: dict, candidata, gcs_painel: set[str] | None, valor: float) -> Linha:
    """Linha OData -> Linha (gcs_painel None: a coluna da gerência agrupada não existe; tudo no escopo)."""
    _, _, sigla, bruto = candidata
    rm = fontes._rota(l.get(CM.META_ROTA))
    return Linha(rota=fontes._rota(l.get(CM.ROTA)), rota_meta="" if rm in ("--", "#") else rm,
                 gc_modelo=sigla(l), cod_modelo=_codigo(M.codigo_gc(bruto(l))),
                 sv=_codigo(M.codigo_sv(l.get(COL_SV_CLIENTE))),
                 no_escopo=gcs_painel is None or limpar(l.get(CM.GC)) in gcs_painel, valor=valor,
                 gc_comercial=_sigla_gc(l.get(CM.GC_COMERCIAL)))


def painel_e7(gc_rota: dict, sv_rota: dict, linhas_base: list[dict]) -> Painel:
    """Rotas do painel (as do payload, com as rotas ocultas das EV*) e a base de clientes corrente e ativa sem os
    filtros do painel."""
    sv_rota = dict(sv_rota, **{r: M.sv_eventuais(g) for r, g in gc_rota.items() if r == M.rota_eventuais(g)})
    base, gcs = defaultdict(set), defaultdict(list)
    for l in linhas_base:
        r = fontes._rota(l.get(CB.ROTA))
        if not r:
            continue
        sv = M.codigo_sv(l.get(CB.SUPERVISOR))
        base[r].add(sv)
        m = _SV_SIGLA.match(sv)
        gcs[r].append(m.group(1) if m and m.group(1) in M.GC_NOMES else _sigla_gc(l.get(CB.GC)))
    gc_base = {r: _mais_comum([g for g in gs if g]) or None for r, gs in gcs.items()}
    return Painel(dict(gc_rota), sv_rota, dict(base), gc_base)


def consultas_e7(cons: Consulta, anomes: str, anomes_hoje: str, hoje: date, com_dia: bool) -> tuple[dict, set]:
    """Modelo de vendas SEM filtros de escopo (nenhuma gerência, rota ou base), só Refrigerantes, agregado no
    servidor por gerência x supervisão x rota do cliente x rota da meta (+ NF_STATUS no Real), e a base de
    clientes corrente e ativa sem os filtros do painel. Colunas que não existirem no $metadata ficam fora."""
    existentes = set(cons.colunas(M.OBJ_META))
    opcionais = [CM.GC, COL_SV_CLIENTE, CM.META_ROTA, COL_GC_COMERCIAL, COL_GC_COMERCIAL_META, COL_GC_AGRUPADA_META,
                 COL_SV_META]
    dims = [CM.ROTA, CM.AGRUPADOR] + [c for c in opcionais if c in existentes]
    refri = eq(CM.AGRUPADOR, M.AGRUPADORES_VOLUME[K_REFRI])
    tarefas = {
        "real": (M.OBJ_META, dims + [CM.NF_STATUS, CM.VOL_MES], e(eq(CM.ANOMES, anomes), refri, M.FILTRO_PEDIDOS_ONLINE)),
        "base": (M.OBJ_BASE_CLIENTE, [CB.ROTA, CB.GC, CB.SUPERVISOR, CB.QUANTIDADE], M.FILTRO_BASE_CLIENTE),
    }
    if com_dia:
        tarefas["dia"] = (M.OBJ_META, dims + [CM.META_RECUPERAVEL],
                          e(eq(CM.ANOMES, anomes_hoje), refri, fontes.filtro_hoje(cons, hoje)))
    return cons.em_paralelo(tarefas), existentes


def _tabela_contrib(rel: Relatorio, contrib: dict, por_rota_meta: bool):
    """As E7_MAX_LINHAS maiores contribuições (valor absoluto) e o total das demais."""
    itens = sorted(((k, v) for k, v in contrib.items() if abs(v) >= 0.05), key=lambda kv: (-abs(kv[1]), kv[0]))
    if not itens:
        rel.p("nenhuma contribuição encontrada")
        return
    linhas = []
    for (rc, rm, causa, det), v in itens[:E7_MAX_LINHAS]:
        rotas = [_codigo(rm) or "—", _codigo(rc) or "—"] if por_rota_meta else [_codigo(rc) or "—", _codigo(rm) or "—"]
        linhas.append(rotas + [causa, det or None, _n(v, 1)])
    resto = itens[E7_MAX_LINHAS:]
    if resto:
        linhas.append([f"demais ({len(resto)})", "", "", "", _n(sum(v for _, v in resto), 1)])
    cab = ["rota da meta", "rota do cliente"] if por_rota_meta else ["rota do cliente", "rota da meta"]
    rel.tabela(cab + ["causa", "detalhe", "cx (painel − SAC)"], linhas)


def _explicado(dif: float | None, contrib: dict, residuo: float | None) -> str:
    if dif is None:
        return "sem o dado na tela do SAC"
    causas = resumo_causas(contrib)
    txt = (f"{_cx(dif)} cx: explicado por: " + "; ".join(f"{c} ({_cx(v)} cx)" for c, v in causas)
           if causas else f"{_cx(dif)} cx: nenhuma contribuição encontrada")
    if residuo is not None and abs(residuo) >= 1:
        return txt + f" · **resíduo {_cx(residuo)} cx sem causa encontrada**"
    return txt + f" · resíduo {_cx(residuo) if residuo is not None else '—'} cx"


def incluir_eventuais(estado: dict, vm: fontes.VolumeMes) -> None:
    """Como o payload: a rota oculta de cada gerência, com o Real dos clientes em rotas EV*, entra nas rotas do
    painel (gerência, lista de rotas e Vol Real), para todas as seções somarem como o gerador."""
    ev = fontes.volume_eventuais(vm, estado["gc_da_rota"])
    for r, (gc, ks) in ev.items():
        vm.real[r] = dict(ks)
        estado["gc_da_rota"][r] = gc
        estado["gc_rota_painel"][r] = gc
    estado["rotas"] = sorted(estado["gc_da_rota"])
    estado["eventuais"] = {r: gc for r, (gc, _) in ev.items()}


def diferencas_sac(rel: Relatorio, cons: Consulta, estado: dict, anomes: str, anomes_hoje: str, hoje: date):
    """Seção E7: explica, rota a rota, a diferença entre o painel e a tela do SAC (Real e Meta do dia)."""
    nome, comentario, sac = estado["sac"]
    dia_painel = estado.get("meta_dia") if anomes == anomes_hoje else None
    tem_dia_sac = any(v["MetaDia"] is not None for v in sac.values())
    com_dia = tem_dia_sac and dia_painel is not None
    rel.p(f"Tela do SAC: `{nome}`" + (f" ({comentario})" if comentario else "") + ". Diferença = painel − SAC "
          "(negativa: o SAC soma mais). Painel = o da seção 4 (as funções do gerador, por rota, na gerência da rota "
          "no painel: Real pela rota do cliente, com os clientes em rotas EV* na rota oculta da gerência comercial "
          "deles; meta do dia pela rota da meta). Modelo de vendas consultado **sem filtros de escopo** (nenhuma "
          "gerência, rota ou base de clientes), só Refrigerantes, agregado no servidor por gerência x supervisão x "
          "rota do cliente "
          f"(`{CM.ROTA}`) x rota da meta (`{CM.META_ROTA}`): Real = `{CM.VOL_MES}` do mês com os NF_STATUS do Vol "
          f"Real; Meta do dia = `{CM.META_RECUPERAVEL}` com DATA_MOVIMENTO = hoje. Contribuição = o que só o painel "
          "conta na gerência (+) ou só o SAC (−); resíduo = diferença − contribuições (perto de 0 = explicado). "
          "**Só relata: esta seção não muda o gerador.**")
    if not com_dia:
        rel.p("Meta do dia fora desta seção: " + ("a tela do SAC não traz MetaDia." if not tem_dia_sac else
                                                  "o painel não tem a meta do dia (fechamento ou consulta falhou)."))
    linhas, existentes = consultas_e7(cons, anomes, anomes_hoje, hoje, com_dia)
    candidatas = [c for c in CANDIDATAS_GC if all(col in existentes for col in c[1])]
    if not candidatas:
        rel.p("Nenhuma coluna de gerência do modelo de vendas no $metadata ("
              + ", ".join(f"`{col}`" for c in CANDIDATAS_GC for col in c[1]) + "): a E7 não pode ser calculada.")
        return
    medidas = [("real", "Real", [(l, numero(l.get(CM.VOL_MES))) for l in linhas["real"]
                                 if M.status_nf_real(l.get(CM.NF_STATUS)) and M.indicador_volume(l.get(CM.AGRUPADOR)) == K_REFRI],
                False)]
    if com_dia:
        medidas.append(("dia", "MetaDia", [(l, numero(l.get(CM.META_RECUPERAVEL))) for l in linhas["dia"]
                                           if M.indicador_volume(l.get(CM.AGRUPADOR)) == K_REFRI], True))
    vm = estado.get("vm") or fontes.carregar_volume_real(cons, anomes, estado["gcs"], None)
    if "eventuais" not in estado:
        incluir_eventuais(estado, vm)
    p = painel_e7(estado["gc_rota_painel"], rotas_do_painel(estado["clientes"])[1], linhas["base"])
    painel = {"real": defaultdict(float), "dia": defaultdict(float)}
    # Neutraliza, virtuais, rotas ocultas das EV* e ocultas no total do painel: por gerência (hipótese c) e por tipo
    tipos = {"real": defaultdict(float), "dia": defaultdict(float)}
    por_tipo = {"real": defaultdict(float), "dia": defaultdict(float)}
    for r, g in p.gc_rota.items():
        v_dia = (dia_painel or {}).get(r, {}).get(K_REFRI, 0.0)
        tipo = tipo_rota(r, p)
        for m, v in (("real", vm.real.get(r, {}).get(K_REFRI, 0.0)), ("dia", v_dia)):
            painel[m][g] += v
            if tipo:
                tipos[m][g] += v
                por_tipo[m][tipo] += v
    gcs_painel = set(estado["gcs"]) if CM.GC in existentes else None

    # qual gerência do modelo reproduz a tela do SAC (Σ |modelo − SAC| nas gerências do CSV)
    pontos = {}
    for m, campo, lin, _ in medidas:
        for i, cand in enumerate(candidatas):
            agg = defaultdict(float)
            for l, v in lin:
                g = cand[2](l)
                if g:
                    agg[g] += v
            pontos[(m, i)] = sum(abs(agg.get(g, 0.0) - s[campo]) for g, s in sac.items() if s[campo] is not None)
    escolhida = {m: min(range(len(candidatas)), key=lambda i: (pontos[(m, i)], i)) for m, *_ in medidas}
    rel.p(f"\nGerência do modelo que reproduz a tela do SAC (Σ |modelo − SAC| nas {len(sac)} gerências do CSV; "
          "a menor é usada abaixo):")
    rel.tabela(["gerência do modelo de vendas", "Real", "Meta do dia"],
               [[cand[0]] + [(f"**{_cx(pontos[(m, i)])} (usada)**" if escolhida[m] == i else _cx(pontos[(m, i)]))
                             if (m, i) in pontos else None for m in ("real", "dia")]
                for i, cand in enumerate(candidatas)])

    # escopo do painel: o Real vem das consultas por gerência agrupada do cliente; a meta do dia, sem filtro de gerência
    res = {m: contribuicoes([linha_modelo(l, candidatas[escolhida[m]], gcs_painel if m == "real" else None, v)
                             for l, v in lin], p, rota_meta)
           for m, _, lin, rota_meta in medidas}
    rec = {}
    for m, campo, *_ in medidas:
        for g, s in sac.items():
            rec[(m, g)] = reconciliar(painel[m][g] if g in set(p.gc_rota.values()) else None, s[campo],
                                      res[m].por_gc.get(g, {}))
    com_dif = [g for g in M.GC_NOMES if g in sac and any(
        rec[(m, g)][0] is not None and (_inteiro(painel[m][g]) != _inteiro(sac[g][campo])) for m, campo, *_ in medidas)]

    # hipóteses, somando as gerências do CSV
    def soma_hip(m, chave):
        return res[m].hipoteses.get(chave, 0.0) if m in res else None

    rel.p("\n**Hipóteses** (somando as gerências; cx = painel − SAC):")
    for m, campo, _, _ in medidas:
        tot = defaultdict(float)
        for g in sac:
            for (_, _, causa, _), v in res[m].por_gc.get(g, {}).items():
                tot[causa] += v
        rotulo = "Real" if m == "real" else "Meta do dia"
        rel.p(f"- {rotulo}, por causa: " + ("; ".join(f"{c_} ({_cx(v)} cx)" for c_, v in
                                                   sorted(tot.items(), key=lambda cv: -abs(cv[1])) if abs(v) >= 0.5)
                                         or "nenhuma"))
    for letra, texto in [
        ("a", "(a) rotas fora do painel que o SAC soma (SV.BL.*, INVALIDO/G*E/G*F/APE, sem cliente corrente e ativo e "
              "outras; os clientes das EV* entram pela rota oculta da gerência, ver (c))"),
        ("b", "(b) rota do painel atribuída a outra gerência no modelo (total deslocado; sai de uma, entra na outra)"),
        ("d", "(d) rota da meta ≠ rota do cliente (Real: cliente fora do painel com a meta numa rota do painel; meta "
              "do dia: meta numa rota fora do painel de cliente que está no painel)")]:
        rel.p(f"- {texto}: Real {_cx(soma_hip('real', letra))} cx"
              + (f" · Meta do dia {_cx(soma_hip('dia', letra))} cx" if com_dia else ""))
    fora_b = sum(abs(v) for r_ in res.values() for v in r_.fora_outra_gc.values())
    rel.p(f"- (b) clientes de rotas fora do painel cuja gerência no modelo difere da gerência da rota na base: "
          f"{_cx(fora_b)} cx (Real e Meta do dia; ver E7c).")
    veredito = defaultdict(int)
    for m, campo, *_ in medidas:
        for g, a in tipos[m].items():
            residuo = rec.get((m, g), (None, 0, None))[2]
            if abs(a) < 1 or residuo is None:
                continue
            veredito["o SAC também soma (resíduo < 1 cx)" if abs(residuo) < 1 else
                      "compatível com o SAC sem elas (resíduo = o valor delas)" if abs(residuo - a) < 1 else
                      "inconclusivo"] += 1

    def tipos_txt(m):
        return "; ".join(f"{t} {_cx(v)} cx" for t, v in sorted(por_tipo[m].items())) or "nenhuma"
    rel.p("- (c) Neutraliza, virtuais, rotas ocultas das EV* e supervisões ocultas entram no total do painel. Real: "
          + tipos_txt("real")
          + (". Meta do dia: " + tipos_txt("dia") if com_dia else "")
          + ". Gerência x medida com essas rotas: "
          + ("; ".join(f"{k}: {v}" for k, v in sorted(veredito.items())) or "nenhuma") + ".")

    # E7a. reconciliação
    rel.h3("E7a. Reconciliação por gerência (só as que têm diferença)")
    if not com_dif:
        rel.p("Nenhuma gerência com diferença contra a tela do SAC.")
    cab = ["GC", "Real painel", "Real SAC", "dif", "contribuições", "resíduo"]
    if com_dia:
        cab += ["Meta dia painel", "Meta dia SAC", "dif", "contribuições", "resíduo"]

    def bloco(m, g):
        if m not in res:
            return []
        dif, soma_c, residuo = rec[(m, g)]
        return [_cx(painel[m][g]) if dif is not None else None, _cx(sac[g]["Real" if m == "real" else "MetaDia"]),
                _cx(dif), _cx(soma_c), _cx(residuo)]

    linhas_a = [[g] + bloco("real", g) + (bloco("dia", g) if com_dia else []) for g in com_dif]
    tot = ["**todas as gerências do CSV**"]
    for m, campo, *_ in medidas:
        vals = [rec[(m, g)] for g in sac if rec[(m, g)][0] is not None]
        tot += [_cx(sum(painel[m][g] for g in sac if rec[(m, g)][0] is not None)),
                _cx(sum(sac[g][campo] for g in sac if rec[(m, g)][0] is not None)),
                _cx(sum(v[0] for v in vals)), _cx(sum(v[1] for v in vals)), _cx(sum(v[2] for v in vals))]
    rel.tabela(cab, linhas_a + [tot])

    # E7b. contribuições por rota
    rel.h3(f"E7b. Contribuições por rota (as {E7_MAX_LINHAS} maiores por gerência; códigos de rota e supervisão)")
    for g in com_dif:
        for m, campo, _, rota_meta in medidas:
            dif, soma_c, residuo = rec[(m, g)]
            if dif is None or (_inteiro(painel[m][g]) == _inteiro(sac[g][campo]) and not res[m].por_gc.get(g)):
                continue
            rel.p(f"\n**{g} · {'Real' if m == 'real' else 'Meta do dia'}** (dif {_cx(dif)} cx; contribuições "
                  f"{_cx(soma_c)}; resíduo {_cx(residuo)})")
            _tabela_contrib(rel, res[m].por_gc.get(g, {}), rota_meta)

    # E7c. deslocamentos entre gerências
    rel.h3("E7c. Deslocamentos entre gerências")
    desloc = defaultdict(lambda: [0.0, 0.0])
    for i, m in enumerate(("real", "dia")):
        for k, v in (res[m].deslocamentos.items() if m in res else ()):
            desloc[k][i] += v
    rel.p("Rotas do painel que o modelo de vendas atribui a outra gerência (o painel soma na gerência da rota; o "
          "SAC, na do modelo):")
    rel.tabela(["rota", "gerência no painel", "gerência no modelo", "Real (cx)", "Meta do dia (cx)"],
               [[_codigo(r) or "—", gp, gm, _n(v[0], 1), _n(v[1], 1) if com_dia else None]
                for (r, gp, gm), v in sorted(desloc.items(), key=lambda kv: -abs(kv[1][0]) - abs(kv[1][1]))]
               or [["nenhuma", "—", "—", None, None]])
    fora = defaultdict(lambda: [0.0, 0.0])
    for i, m in enumerate(("real", "dia")):
        for k, v in (res[m].fora_outra_gc.items() if m in res else ()):
            fora[k][i] += v
    rel.p("\nRotas fora do painel com clientes de outra gerência no modelo (a rota é de uma gerência na base; o SAC "
          "soma o cliente na gerência do modelo):")
    rel.tabela(["rota (fora do painel)", "gerência na base", "gerência no modelo", "causa", "Real (cx)",
                "Meta do dia (cx)"],
               [[_codigo(r) or "—", gb, gm, causa_fora_do_painel(r, p), _n(v[0], 1), _n(v[1], 1) if com_dia else None]
                for (r, gb, gm), v in sorted(fora.items(), key=lambda kv: -abs(kv[1][0]) - abs(kv[1][1]))]
               or [["nenhuma", "—", "—", "—", None, None]])
    entre = [sum(v[i] for (_, gp, gm), v in desloc.items() if {gp, gm} == {"G2", "G3"}) for i in (0, 1)]
    par = []
    for g in ("G2", "G3"):
        if ("real", g) in rec and rec[("real", g)][0] is not None:
            par.append(f"{g} Real {_explicado(rec[('real', g)][0], res['real'].por_gc.get(g, {}), rec[('real', g)][2])}")
    rel.p(f"\nPar G2/G3: deslocamento direto entre as duas = Real {_cx(entre[0])} cx"
          + (f", Meta do dia {_cx(entre[1])} cx" if com_dia else "") + ". " + " | ".join(par))

    # E7d. resumo
    rel.h3("E7d. Resumo por gerência")
    if not com_dif:
        rel.p("Nenhuma gerência com diferença.")
    for g in com_dif:
        partes = [f"{'Real' if m == 'real' else 'Meta do dia'} "
                  + _explicado(rec[(m, g)][0], res[m].por_gc.get(g, {}), rec[(m, g)][2]) for m, *_ in medidas]
        rel.p(f"- **{g}** · " + " · ".join(partes))


# ------------------------------------------------------------------ E8: descoberta do incentivo Todos a Bordo 3.0
# Campanha de cobertura de cervejas (mês atual). Só relata o que existe no Datasphere; nada muda no gerador.
E8_TERMOS = ("HEINEKEN", "EISENBAHN", "CERVEJ", "600")
E8_TERMOS_MARCA = ("HEINEKEN", "EISENBAHN")
E8_COLUNAS = re.compile(r"AGRUPADOR|MARCA|FAMILIA|EMBALAGEM|PRODUTO|SKU", re.I)
E8_MAX_VALORES, E8_MAX_ROTAS, E8_MAX_PARECIDOS, E8_MAX_COM = 20, 40, 10, 10
ROTA_T = re.compile(r"^T\d+$")   # rotas T07, T29...: sem meta de Heineken em quase todas as gerências (20/10)
FORA = "fora"   # coluna das rotas fora do painel
# itens da campanha: (nome, chave interna sugerida, agrupador sem acento/caixa/espaços/pontuação)
ITENS_INCENTIVO = [
    ("Cervejas", "INC CERVEJAS", "CERVEJAS"),
    ("Heineken", "INC HEINEKEN", "HEINEKEN"),
    ("Eisenbahn 600ml", "INC EISENBAHN 600ML", "EISENBAHN600ML"),
    ("Heineken 600ml", "INC HEINEKEN 600ML", "HEINEKEN600ML"),
    ("Cervejas 600ml Retornável", "INC CERVEJAS 600ML RET", "CERVEJAS600MLRETORNAVEL"),
]


def chave_texto(valor: object) -> str:
    """'Cervejas 600ml Retornável' -> 'CERVEJAS600MLRETORNAVEL' (sem acento, caixa, espaço ou pontuação)."""
    return re.sub(r"[^A-Z0-9]", "", normalizar(valor))


def contem_termo(valor: object, termos=E8_TERMOS) -> bool:
    """O valor contém algum dos termos (comparação sem acento e sem diferenciar caixa)?"""
    chave = chave_texto(valor)
    return any(chave_texto(t) in chave for t in termos)


def mapear_itens(venda: list[str], meta: list[str]) -> dict[str, dict]:
    """Item da campanha -> {venda, meta: agrupador exato ou None; parecidos: outros que começam igual}."""
    out = {}
    chaves = {c for _, _, c in ITENS_INCENTIVO}   # parecidos não repetem os outros itens
    for nome, _, chave in ITENS_INCENTIVO:
        def exato(valores):
            return next((v for v in valores if chave_texto(v) == chave), None)
        parecidos = sorted({v for v in list(venda) + list(meta)
                            if chave_texto(v).startswith(chave) and chave_texto(v) not in chaves}, key=chave_texto)
        out[nome] = {"venda": exato(venda), "meta": exato(meta), "parecidos": parecidos[:E8_MAX_PARECIDOS]}
    return out


def rotas_por_gc(gc_rota: dict[str, str]) -> dict[str, list[str]]:
    """Rotas do painel por gerência, sem as rotas ocultas dos clientes em EV* (não têm meta nem cobertura)."""
    out = defaultdict(list)
    for r, g in gc_rota.items():
        if r != M.rota_eventuais(g):
            out[g].append(r)
    return {g: sorted(rs, key=_ordem_rota) for g, rs in out.items()}


def _ordem_rota(r: str):
    """Ordem natural (111, 112, A11...), como o front."""
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", r)]


def clientes_por_gc(linhas: list[dict], col_valor: str, col_medida: str, gc_rota: dict[str, str]) -> dict:
    """{(valor, gerência ou FORA): {clientes com medida > 0}} pela rota do cliente."""
    out = defaultdict(set)
    for l in linhas:
        if numero(l.get(col_medida)) > 0:
            r = fontes._rota(l.get(CM.ROTA))
            out[(limpar(l.get(col_valor)), gc_rota.get(r, FORA))].add(limpar(l.get(CM.CLIENTE)))
    return dict(out)


def meta_por_rota(linhas: list[dict]) -> dict[tuple[str, str], float]:
    """{(agrupador, rota da meta): meta de cobertura}; o maior valor da rota, como o gerador (carregar_metas)."""
    out: dict = {}
    for l in linhas:
        r, v = fontes._rota(l.get(CM.META_ROTA)), limpar(l.get(CM.META_AGRUPADOR))
        if r and l.get(CM.META_COBERTURA) not in (None, ""):
            out[(v, r)] = max(out.get((v, r), 0.0), numero(l.get(CM.META_COBERTURA)))
    return out


def meta_por_gc(metas: dict, gc_rota: dict[str, str]) -> dict[tuple[str, str], list]:
    """{(agrupador, gerência ou FORA): [soma da meta, nº de rotas com meta > 0]}."""
    out = defaultdict(lambda: [0.0, 0])
    for (v, r), m in metas.items():
        if m > 0:
            t = out[(v, gc_rota.get(r, FORA))]
            t[0] += m
            t[1] += 1
    return dict(out)


def com_sem_meta(metas: dict, valor: str, rotas: dict[str, list[str]]) -> dict[str, tuple[list[str], list[str]]]:
    """{gerência: (rotas do painel com meta > 0 do agrupador, rotas sem)}."""
    return {g: ([r for r in rs if metas.get((valor, r), 0.0) > 0], [r for r in rs if metas.get((valor, r), 0.0) <= 0])
            for g, rs in rotas.items()}


def rota_normal(rota: str) -> bool:
    """Nem Neutraliza nem virtual (as duas ficam fora da divisão FULL x BARRACUDA)."""
    return rota not in M.NEUTRALIZA_ROTAS and rota not in M.VIRTUAIS_ROTAS


def portfolio(com: list[str], sem: list[str]) -> str | None:
    """Portfólio pela meta de Heineken (definição da Karen, 20/10/2026; BARRACUDA = filial com CD da Heineken):
    rota com meta = FULL, sem = BARRACUDA; supervisão ou gerência com as duas fica com a da maioria das rotas
    (SV.G2.1: 4 de 7 com meta = FULL). Empate fica sem informação (None)."""
    if not com and not sem:
        return "sem rotas"
    return "FULL" if len(com) > len(sem) else "BARRACUDA" if len(sem) > len(com) else None


def divisao_portfolio(com: list[str], sem: list[str], sv_rota: dict[str, str]) -> tuple[str | None, dict[str, tuple]]:
    """(portfólio da gerência, {supervisão: (portfólio, rotas com meta, rotas sem)}), só com as rotas normais;
    supervisões em ordem natural, rota sem supervisão no painel em '—'."""
    com, sem = [r for r in com if rota_normal(r)], [r for r in sem if rota_normal(r)]
    por_sv = defaultdict(lambda: ([], []))
    for i, rs in enumerate((com, sem)):
        for r in rs:
            por_sv[_codigo(sv_rota.get(r)) or "—"][i].append(r)
    return portfolio(com, sem), {s: (portfolio(*por_sv[s]),) + por_sv[s] for s in sorted(por_sv, key=_ordem_rota)}


def grupos_txt(por: dict[str, str | None], sep: str = "; ") -> str:
    """{gerência ou supervisão: portfólio} -> 'BARRACUDA: AP, G1; FULL: RV' (na ordem de entrada; empate fica fora)."""
    grupos = defaultdict(list)
    for k, t in por.items():
        if t:
            grupos[t].append(k)
    return sep.join(f"{t}: {', '.join(ks)}" for t, ks in sorted(grupos.items()))


def diferentes_da_gc(por_sv: dict[str, tuple], por_gc: dict[str, str | None]) -> list[tuple[str, str, str]]:
    """[(supervisão, portfólio, gerência)] das supervisões com portfólio diferente do da gerência (empate fica fora)."""
    return [(s, t, g) for s, (g, t) in por_sv.items() if t and por_gc[g] and t != por_gc[g]]


def _gcs_com_dados(gc_rota: dict[str, str]) -> list[str]:
    presentes = set(gc_rota.values())
    return [g for g in M.GC_NOMES if g in presentes]


def descoberta_incentivo(rel: Relatorio, cons: Consulta, estado: dict, anomes: str):
    """Seção E8: o que o Datasphere tem para a aba "Incentivo" (Todos a Bordo 3.0) no mês `anomes`."""
    gc_rota, gcs = estado["gc_rota_painel"], estado["gcs"]
    rotas = rotas_por_gc(gc_rota)
    colunas_gc = _gcs_com_dados(gc_rota)
    rel.p(f"Mês {anomes}, `{M.OBJ_META}`. Itens: " + "; ".join(n for n, *_ in ITENS_INCENTIVO) + ". Agrupador da venda "
          f"`{CM.AGRUPADOR}` (o de M.AGRUPADORES_COBERTURA), da meta `{CM.META_AGRUPADOR}`; cobertura realizada "
          f"`{CM.COB_MES}` > 0; meta `{CM.META_COBERTURA}` (o maior valor por rota, como o gerador). Gerência = a da rota "
          f"no painel; '{FORA}' = rota fora do painel. Só nomes de agrupador e de coluna, contagens e códigos de rota.")

    # E8a. agrupadores com os termos da campanha
    venda = sorted({limpar(l.get(CM.AGRUPADOR)) for l in cons.linhas(M.OBJ_META, [CM.AGRUPADOR, CM.COB_MES],
                                                                       eq(CM.ANOMES, anomes))
                    if contem_termo(l.get(CM.AGRUPADOR))}, key=chave_texto)
    meta = sorted({limpar(l.get(CM.META_AGRUPADOR)) for l in cons.linhas(M.OBJ_META, [CM.META_AGRUPADOR, CM.META_COBERTURA],
                                                                           eq(CM.META_ANOMES, anomes))
                   if contem_termo(l.get(CM.META_AGRUPADOR))}, key=chave_texto)
    cob = [l for ls in cons.em_paralelo(fontes._por_gerencia(
        M.OBJ_META, [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.COB_MES],
        e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, venda)), gcs, None)).values() for l in ls] if venda else []
    metas = meta_por_rota(cons.linhas(M.OBJ_META, [CM.META_ROTA, CM.META_AGRUPADOR, CM.META_COBERTURA],
                                      e(eq(CM.META_ANOMES, anomes), ou(CM.META_AGRUPADOR, meta)))) if meta else {}
    cli = clientes_por_gc(cob, CM.AGRUPADOR, CM.COB_MES, gc_rota)
    mgc = meta_por_gc(metas, gc_rota)
    n_linhas = defaultdict(int)
    for l in cob:
        n_linhas[limpar(l.get(CM.AGRUPADOR))] += 1

    def clientes(v, gcs_=None):
        return len(set().union(*[s for (vv, g), s in cli.items() if vv == v and (gcs_ is None or g in gcs_)] or [set()]))

    rel.h3("E8a. Agrupadores com HEINEKEN, EISENBAHN, CERVEJ ou 600 (sem acento e sem diferenciar caixa)")
    todos = sorted(set(venda) | set(meta), key=chave_texto)
    rel.p(f"{len(venda)} agrupadores na venda e {len(meta)} na meta. Linhas = rota x cliente (agregado no servidor, uma "
          "consulta por gerência, como o gerador).")
    rel.tabela(["agrupador (como veio)", "na venda", "na meta", "linhas", "clientes com cobertura > 0",
                "META_COBERTURA (soma)", "rotas com meta > 0"],
               [[repr(v), "sim" if v in venda else "não", "sim" if v in meta else "não", n_linhas.get(v, 0),
                 clientes(v) if v in venda else None,
                 _n(sum(t[0] for (vv, _), t in mgc.items() if vv == v), 0) if v in meta else None,
                 sum(t[1] for (vv, _), t in mgc.items() if vv == v) if v in meta else None] for v in todos] or [["nenhum"] + [None] * 6])
    rel.p("\nClientes com cobertura > 0, por gerência:")
    rel.tabela(["agrupador"] + colunas_gc + [FORA],
               [[repr(v)] + [len(cli.get((v, g), ())) for g in colunas_gc + [FORA]] for v in venda] or [["nenhum"]])
    rel.p("\nMeta de cobertura por gerência (soma · rotas com meta > 0):")
    rel.tabela(["agrupador"] + colunas_gc + [FORA],
               [[repr(v)] + [(f"{_n(mgc[(v, g)][0], 0)} · {mgc[(v, g)][1]}" if (v, g) in mgc else "—")
                             for g in colunas_gc + [FORA]] for v in meta] or [["nenhum"]])

    # E8b. os 5 itens
    rel.h3("E8b. Os 5 itens da campanha nos agrupadores")
    mapa = mapear_itens(venda, meta)

    def situacao(m):
        return ("encontrado" if m["venda"] and m["meta"] else "só na venda" if m["venda"] else "só na meta"
                if m["meta"] else "**não encontrado**")
    rel.tabela(["item", "agrupador na venda", "agrupador na meta", "situação", "parecidos (outros agrupadores)"],
               [[n, repr(m["venda"]) if m["venda"] else None, repr(m["meta"]) if m["meta"] else None, situacao(m),
                 ", ".join(repr(p) for p in m["parecidos"]) or None] for n, m in mapa.items()])
    faltam = [n for n in ("Eisenbahn 600ml", "Heineken 600ml") if not mapa[n]["venda"]]
    if faltam:
        rel.p(f"\n{' e '.join(faltam)} sem agrupador na venda: colunas do $metadata com AGRUPADOR, MARCA, FAMILIA, "
              "EMBALAGEM, PRODUTO ou SKU (texto; sem as que identificam cliente) e os valores com HEINEKEN ou EISENBAHN "
              f"(até {E8_MAX_VALORES} por coluna):")
        linhas = []
        for col in sorted(set(cons.colunas(M.OBJ_META))):
            if not E8_COLUNAS.search(col) or COLUNAS_PROIBIDAS.search(col) or "CLIEN" in col.upper():
                continue
            tipo = cons.tipo(M.OBJ_META, col) if hasattr(cons, "tipo") else None
            if tipo and "String" not in tipo:
                continue
            try:
                vals = sorted({limpar(l.get(col)) for l in cons.linhas(M.OBJ_META, [col, CM.COB_MES], eq(CM.ANOMES, anomes))
                               if contem_termo(l.get(col), E8_TERMOS_MARCA)}, key=chave_texto)
            except Exception as erro:   # noqa: BLE001
                linhas.append([f"`{col}`", f"**não** ({type(erro).__name__})", None])
                continue
            mais = f" (+{len(vals) - E8_MAX_VALORES})" if len(vals) > E8_MAX_VALORES else ""
            linhas.append([f"`{col}`", "sim", (", ".join(repr(v) for v in vals[:E8_MAX_VALORES]) + mais) or "nenhum"])
        rel.tabela(["coluna", "aceita agregação no servidor", "valores com HEINEKEN ou EISENBAHN"],
                   linhas or [["nenhuma", None, None]])

    # E8c. meta por item
    rel.h3("E8c. Meta de cobertura por item (rotas do painel com e sem meta)")
    rel.p("Portfólio pela meta dos itens Heineken (definição de 20/10/2026: BARRACUDA = filial com CD da Heineken): rota "
          "com meta = FULL, sem meta = BARRACUDA; supervisão e gerência com as duas ficam com a classificação da maioria "
          "das rotas (ex.: SV.G2.1 com 4 de 7 rotas com meta = FULL); empate fica sem informação (—). Só as rotas normais "
          "contam (Neutraliza e virtuais ficam fora; nas listas, marcadas (N) e (V)).")
    sv_rota = estado.get("sv_rota_painel", {})
    divisao, divisao_sv, mudam_sem_t, rotas_t = {}, {}, {}, defaultdict(set)

    def marca(r):
        return (_codigo(r) or "—") + (" (N)" if r in M.NEUTRALIZA_ROTAS else " (V)" if r in M.VIRTUAIS_ROTAS else "")

    def lista(rs, n):
        return (", ".join(marca(r) for r in rs[:n]) + (f" (+{len(rs) - n})" if len(rs) > n else "")) or None

    for nome, _, _ in ITENS_INCENTIVO:
        v = mapa[nome]["meta"]
        if not v:
            rel.p(f"\n**{nome}**: sem agrupador na meta.")
            continue
        cs = com_sem_meta(metas, v, rotas)
        heineken = "HEINEKEN" in chave_texto(nome)
        soma = sum(m for (vv, _), m in metas.items() if vv == v and m > 0)
        rel.p(f"\n**{nome}** (`{v}`): meta na BAND {_n(soma, 0)}")
        cab = ["gerência", "soma da meta", "rotas com meta", "rotas sem meta"]
        if heineken:
            cab += ["portfólio (maioria das rotas normais)", "rotas normais com · sem meta", "supervisões (maioria)",
                    f"rotas com meta (gerência mista, até {E8_MAX_COM})", f"rotas sem meta (até {E8_MAX_ROTAS})"]
        linhas, mistas = [], []
        for g in colunas_gc:
            com, sem = cs.get(g, ([], []))
            linha = [g, _n(mgc.get((v, g), [0.0])[0], 0), len(com), len(sem)]
            if heineken:
                t, svs = divisao_portfolio(com, sem, sv_rota)
                divisao.setdefault(nome, {})[g] = t
                divisao_sv.setdefault(nome, {}).update({s: (g, x[0]) for s, x in svs.items()})
                n_com, n_sem = sum(len(x[1]) for x in svs.values()), sum(len(x[2]) for x in svs.values())
                # leitura sem as rotas T<nn> sem meta (observação do dado de 20/10)
                t_sem, svs_sem = divisao_portfolio(com, [r for r in sem if not ROTA_T.match(r)], sv_rota)
                rotas_t[nome] |= {r for r in sem if rota_normal(r) and ROTA_T.match(r)}
                mudam_sem_t.setdefault(nome, []).extend(
                    [f"{k} {a or 'sem informação'} → {b or 'sem informação'}"
                     for k, a, b in [(g, t, t_sem)] + [(s, x[0], svs_sem.get(s, ("sem rotas",))[0])
                                                       for s, x in svs.items()] if a != b])
                mistas += [[s, g, len(c), len(sm), x, lista(c, E8_MAX_COM), lista(sm, E8_MAX_COM)]
                           for s, (x, c, sm) in svs.items() if c and sm]
                linha += [t, f"{n_com} · {n_sem}", grupos_txt({s: x[0] for s, x in svs.items()}) or None,
                          lista(com, E8_MAX_COM) if n_com and n_sem else None, lista(sem, E8_MAX_ROTAS)]
            linhas.append(linha)
        if (v, FORA) in mgc:
            linhas.append([FORA, _n(mgc[(v, FORA)][0], 0), mgc[(v, FORA)][1], None] + ([None] * 5 if heineken else []))
        rel.tabela(cab, linhas)
        if heineken:
            rel.p(f"\nSupervisões com rotas normais com e sem meta de {nome} (portfólio pela maioria):")
            rel.tabela(["supervisão", "gerência", "com meta", "sem meta", "portfólio",
                        f"rotas com meta (até {E8_MAX_COM})", f"rotas sem meta (até {E8_MAX_COM})"],
                       mistas or [["nenhuma"] + [None] * 6])

    for nome, por_gc in divisao.items():
        rel.p(f"\nDivisão FULL x BARRACUDA pela meta de {nome} (maioria das rotas normais): "
              f"{grupos_txt(por_gc) or 'sem informação'}.")
        difs = [f"{s} {t} ({g} {por_gc[g]})" for s, t, g in diferentes_da_gc(divisao_sv[nome], por_gc)]
        rel.p(f"Supervisões com portfólio diferente do da gerência: {', '.join(difs) or 'nenhuma'}.")
        if rotas_t[nome]:
            ts = sorted(rotas_t[nome], key=_ordem_rota)
            rel.p(f"Observação do dado: as rotas T<nn> ({', '.join(_codigo(r) or '—' for r in ts)}) estão sem meta de "
                  f"{nome} em {len({gc_rota[r] for r in ts})} gerências e contam como BARRACUDA; sem elas, "
                  + (f"muda: {', '.join(mudam_sem_t[nome])}." if mudam_sem_t[nome] else "nenhuma classificação muda."))

    # E8d. online de hoje
    rel.h3("E8d. Online de hoje (WF Online, 'Inc. e Exp.') por item")
    achados = {n: m["venda"] for n, m in mapa.items() if m["venda"]}
    on = [l for ls in cons.em_paralelo(fontes._por_gerencia(
        M.OBJ_META, [CM.ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.COB_ONLINE],
        e(eq(CM.ANOMES, anomes), ou(CM.AGRUPADOR, list(achados.values())), M.FILTRO_PEDIDOS_ONLINE,
          eq(CM.FONTE, "WF Online")), gcs, None)).values() for l in ls] if achados else []
    cli_on = clientes_por_gc(on, CM.AGRUPADOR, CM.COB_ONLINE, gc_rota)
    na_consulta = {normalizar(a) for a in M.AGRUPADORES_CONSULTA_VENDAS}
    rel.p(f"Clientes com `{CM.COB_ONLINE}` > 0 hoje. A consulta de vendas do gerador filtra "
          "M.AGRUPADORES_CONSULTA_VENDAS e só vira online por indicador o agrupador de M.AGRUPADORES_COBERTURA.")
    rel.tabela(["item", "agrupador", "a consulta do gerador traz?", "vira indicador no gerador?"] + colunas_gc
               + [FORA, "BAND"],
               [[n, repr(v), "sim" if normalizar(v) in na_consulta else "**não**",
                 M.indicador_cobertura(v) or "**não**"]
                + [len(cli_on.get((v, g), ())) for g in colunas_gc + [FORA]]
                + [len(set().union(*[s for (vv, _), s in cli_on.items() if vv == v] or [set()]))]
                for n, v in achados.items()] or [["nenhum item encontrado"] + [None] * (len(colunas_gc) + 5)])
    for n, v in achados.items():
        if M.indicador_cobertura(v):
            continue
        rel.p(f"- {n} (`{v}`): faltaria entrar em M.AGRUPADORES_COBERTURA com uma chave (ex.: "
              f"{next(c for nn, c, _ in ITENS_INCENTIVO if nn == n)}); isso o leva à consulta de vendas (cobertura do "
              "mês e online de hoje), à de metas (carregar_metas) e ao online por indicador; depois, a chave numa aba "
              "ou grupo de exibição (hoje GROUPS/COV_GRUPO não têm aba de incentivo). Rota sem meta fica com o "
              "indicador indisponível (regra atual de indicador_cobertura).")

    # E8e. realizado
    rel.h3("E8e. Clientes distintos com cobertura realizada > 0, por item e gerência")
    rel.tabela(["item", "agrupador"] + colunas_gc + [FORA, "BAND"],
               [[n, repr(v)] + [len(cli.get((v, g), ())) for g in colunas_gc + [FORA]] + [clientes(v)]
                for n, v in achados.items()] or [["nenhum item encontrado"] + [None] * (len(colunas_gc) + 3)])

    # E8f. proposta
    rel.h3("E8f. Proposta de mapeamento para a aba Incentivo")
    linhas = []
    for nome, chave, _ in ITENS_INCENTIVO:
        m = mapa[nome]
        v = m["venda"] or m["meta"]
        n_meta = sum(1 for (vv, _), x in metas.items() if vv == m["meta"] and x > 0) if m["meta"] else 0
        n_on = len(set().union(*[s for (vv, _), s in cli_on.items() if vv == m["venda"]] or [set()])) if m["venda"] else 0
        obs = []
        if m["venda"] and M.indicador_cobertura(m["venda"]):
            obs.append(f"já é o indicador {M.indicador_cobertura(m['venda'])} do painel")
        if m["venda"] and m["meta"] and m["venda"] != m["meta"]:
            obs.append(f"grafia diferente na meta ({m['meta']!r})")
        if not m["venda"] or not m["meta"]:
            obs.append("sem agrupador na " + ("venda" if not m["venda"] else "meta"))
        if m["parecidos"]:
            obs.append("também existe: " + ", ".join(repr(p) for p in m["parecidos"][:3]))
        if nome in divisao:
            difs = [f"{s} {t}" for s, t, _ in diferentes_da_gc(divisao_sv[nome], divisao[nome])]
            obs.append("portfólio (maioria das rotas normais) " + grupos_txt(divisao[nome], " / ")
                       + (f" (supervisões diferentes da gerência: {', '.join(difs)})" if difs else ""))
        linhas.append([nome, repr(v) if v else "**não encontrado**", chave,
                       f"sim ({n_meta} rotas)" if n_meta else "não",
                       f"sim ({n_on} clientes hoje)" if n_on else ("não hoje" if m["venda"] else "não"),
                       "; ".join(obs) or None])
    rel.tabela(["item", "agrupador no Datasphere", "chave interna sugerida", "tem meta?", "tem online?", "observações"],
               linhas)


# ------------------------------------------------------------------ E9: SEM_COMPRA_MES (do payload gerado)
# Roda depois do gerar.py, sobre o payload.json que ele gravou (workflow: --e9 PAYLOAD). Só contagens e códigos de
# rota e gerência: nunca nomes nem códigos de clientes.
E9_MAX_ROTAS = 40           # rotas listadas por motivo (as demais só contadas)
LIMITE_PAYLOAD_MB = 8.0     # limite de atenção do payload (E6)


def conta_sem_compra_mes(payload: dict) -> dict:
    """Por gerência (ordem do GC_ATIVAS) e no total: rotas, rotas com lista, soma dos tamanhos de SEM_COMPRA_MES, soma de
    semCompra, rotas com tamanho diferente de semCompra e rotas com SEM_COMPRA_HOJE fora do SEM_COMPRA_MES.
    Todas as rotas do DATA (Neutraliza, virtuais e as ocultas das EV* também: as listas seguem as do SEM_COMPRA_HOJE)."""
    scm = payload.get("SEM_COMPRA_MES") or {}
    sch = payload.get("SEM_COMPRA_HOJE") or {}
    por_gc: dict[str, dict] = {}
    for gc, svs in (payload.get("DATA") or {}).items():
        g = por_gc.setdefault(gc, {"rotas": 0, "com_lista": 0, "lista": 0, "semCompra": 0, "hoje": 0,
                                   "diverge": [], "fora": []})
        for rotas in svs.values():
            for r, d in rotas.items():
                lista, hoje, n = scm.get(r), sch.get(r) or [], d.get("semCompra")
                g["rotas"] += 1
                g["com_lista"] += lista is not None
                g["lista"] += len(lista or [])
                g["semCompra"] += n or 0
                g["hoje"] += len(hoje)
                if (None if lista is None else len(lista)) != n:
                    g["diverge"].append(r)
                if not set(hoje) <= set(lista or []):
                    g["fora"].append(r)
    ordem = [gc for gc in payload.get("GC_ATIVAS") or [] if gc in por_gc] + sorted(set(por_gc) - set(payload.get("GC_ATIVAS") or []))
    total = {"rotas": 0, "com_lista": 0, "lista": 0, "semCompra": 0, "hoje": 0, "diverge": [], "fora": []}
    for gc in ordem:
        for k, v in por_gc[gc].items():
            total[k] += v
    return {"ordem": ordem, "por_gc": por_gc, "total": total}


def peso_sem_compra_mes(payload: dict) -> tuple[int, int, float, float]:
    """(bytes do payload, bytes sem a chave SEM_COMPRA_MES, segundos para serializar com e sem a chave)."""
    from gerador.saida import serializar
    sem = {k: v for k, v in payload.items() if k != "SEM_COMPRA_MES"}
    t0 = time.monotonic()
    com_b = len(serializar(payload))
    t1 = time.monotonic()
    sem_b = len(serializar(sem))
    t2 = time.monotonic()
    return com_b, sem_b, t1 - t0, t2 - t1


def secao_sem_compra_mes(rel: Relatorio, payload: dict | None, duracao_gerar: float | None = None) -> None:
    """Seção E9: SEM_COMPRA_MES (clientes do roster sem compra no mês) do payload que o gerar.py gravou."""
    inicio = time.monotonic()
    if payload is None:
        rel.p("payload.json não gerado (o gerar.py falhou ou reprovou na validação): E9 sem dados.")
        return
    if "SEM_COMPRA_MES" not in payload:
        rel.p("payload.json sem a chave SEM_COMPRA_MES (gerado por uma versão anterior do gerador?).")
        return
    if payload.get("FECHAMENTO"):
        rel.p(f"Fechamento do mês: as listas são de {payload.get('MES_LABEL')} (mês fechado), como semCompra.")
    c = conta_sem_compra_mes(payload)

    def linha(nome, g):
        return [nome, g["rotas"], g["com_lista"], _n(g["lista"], 0), _n(g["semCompra"], 0),
                _n(g["lista"] - g["semCompra"], 0), len(g["diverge"]), _n(g["hoje"], 0), len(g["fora"])]
    rel.p("Por gerência (todas as rotas do payload, inclusive Neutraliza, virtuais e as ocultas das EV*):")
    rel.tabela(["gerência", "rotas", "rotas com lista", "Σ tamanho das listas", "Σ semCompra", "diferença",
                "rotas com divergência", "Σ SEM_COMPRA_HOJE", "rotas com SEM_COMPRA_HOJE fora"],
               [linha(gc, c["por_gc"][gc]) for gc in c["ordem"]] + [linha("TOTAL BAND", c["total"])])
    t = c["total"]
    if t["diverge"]:
        rel.p(f"\n**Divergência** (tamanho da lista ≠ semCompra) em {len(t['diverge'])} rota(s): "
              + ", ".join(t["diverge"][:E9_MAX_ROTAS]) + (" …" if len(t["diverge"]) > E9_MAX_ROTAS else ""))
    else:
        rel.p("\nTamanho da lista = semCompra em todas as rotas (sem divergência).")
    if t["fora"]:
        rel.p(f"**SEM_COMPRA_HOJE fora do SEM_COMPRA_MES** em {len(t['fora'])} rota(s): "
              + ", ".join(t["fora"][:E9_MAX_ROTAS]) + (" …" if len(t["fora"]) > E9_MAX_ROTAS else ""))
    else:
        rel.p("SEM_COMPRA_HOJE contido no SEM_COMPRA_MES em todas as rotas.")
    com_b, sem_b, t_com, t_sem = peso_sem_compra_mes(payload)
    rel.p(f"\nTamanho: payload {com_b / 1e6:.2f} MB; sem a chave {sem_b / 1e6:.2f} MB; a chave acrescenta "
          f"{(com_b - sem_b) / 1e3:.1f} KB ({(com_b - sem_b) / max(1, sem_b) * 100:.2f}%)"
          + (f". **Acima do limite de atenção de {LIMITE_PAYLOAD_MB:.0f} MB.**" if com_b / 1e6 > LIMITE_PAYLOAD_MB
             else f" (limite de atenção: {LIMITE_PAYLOAD_MB:.0f} MB)."))
    rel.p(f"Tempo: serializar o payload {t_com * 1000:.0f} ms com a chave e {t_sem * 1000:.0f} ms sem; esta seção "
          f"{(time.monotonic() - inicio) * 1000:.0f} ms"
          + (f"; gerar.py completo {duracao_gerar:.0f} s (antes da chave: 84 s em 20/10/2026)." if duracao_gerar
             else "; gerar.py completo: ver a seção 10."))


def conferir(cons: Consulta, hoje: date, rotas_extra: list[str] | None = None,
             simulado: bool = False, pasta_sac: Path = PASTA_SAC) -> tuple[Relatorio, float]:
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
        est_base: dict = {}
        clientes, gcs = fontes.carregar_clientes(cons, estatisticas=est_base)
        gc_da_rota = {c.rota: c.gc for c in clientes}
        gc_rota_painel, sv_rota_painel = rotas_do_painel(clientes)
        estado.update(clientes=clientes, est_base=est_base, gc_rota_painel=gc_rota_painel, sv_rota_painel=sv_rota_painel)
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
        incluir_eventuais(estado, vm)
        if estado["eventuais"]:
            rel.p("Clientes em rotas EV* (rota oculta da gerência comercial, como o payload), Vol Real de Refrigerantes: "
                  + "; ".join(f"{gc} {_n(vm.real[r].get(K_REFRI, 0.0), 0)}"
                              for r, gc in sorted(estado["eventuais"].items(), key=lambda rg: list(M.GC_NOMES).index(rg[1])))
                  + "\n")
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
        rel.p(f"(a) soma por gerência, {fontes.filtro_hoje(cons, hoje)}, pela rota da meta (rotas do painel):")
        rel.tabela(["gerência"] + [M.LABELS[k] for k in VOL] + ["total"],
                   [[g] + [_n(por_gc[g].get(k, 0.0)) for k in VOL] + [_n(sum(por_gc[g].values()))]
                    for g in M.GC_ATIVAS if g in por_gc])
        # (b) e (c): a mesma medida por rota x cliente, para ver se o valor da rota se repete em cada cliente
        sel = [CM.META_ROTA, CM.CLIENTE, CM.AGRUPADOR, CM.META_RECUPERAVEL]   # pela rota da meta, como o gerador
        filtro = e(eq(CM.ANOMES, anomes_hoje), ou(CM.AGRUPADOR, list(M.AGRUPADORES_VOLUME.values())),
                   fontes.filtro_hoje(cons, hoje), ou(CM.META_ROTA, [r for r in amostra if r in gc_da_rota]))
        lin = [l for ls in cons.em_paralelo(fontes._por_gerencia(M.OBJ_META, sel, filtro, gcs, None)).values()
               for l in ls]
        soma, maximo, n = defaultdict(float), defaultdict(float), defaultdict(int)
        for l in lin:
            r, k, v = fontes._rota(l.get(CM.META_ROTA)), M.indicador_volume(l.get(CM.AGRUPADOR)), numero(l.get(CM.META_RECUPERAVEL))
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
        rel.p("\n(a) por rota da meta (o gerador usa esta) x (b) soma por rota da meta x cliente x (c) máximo por rota "
              "da meta x cliente e nº de clientes com valor > 0. 'Repetido' = o máximo de um cliente já é o valor da rota.")
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
        estado.update(calc=calc, vm=vm, metas_vol=metas_vol, neg_a=(neg_mes, neg_rest), fonte_neg=fonte,
                      curva=(curva_mes, curva_rest))

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

    # 4. aceite contra a tela do SAC (CSV do dia) -------------------------------------------
    rel.h(f"4. Aceite contra a tela do SAC (Refrigerantes, {hoje:%d/%m/%Y})")

    def aceite():
        caminho = arquivo_sac(hoje, pasta_sac)
        if not caminho.exists():
            rel.p(f"sem tela do SAC para esta data (para conferir, salve `conferencia/sac/{caminho.name}`: "
                  "ver o README).")
            return
        comentario, sac = ler_tela_sac(caminho)
        estado["sac"] = (caminho.name, comentario, sac)
        calc, vm, gc_rota = estado["calc"], estado["vm"], estado["gc_rota_painel"]
        dia = estado.get("meta_dia") if anomes == anomes_hoje else None
        api = {}
        for gc in sac:
            rotas = [r for r in estado["rotas"] if gc_rota.get(r) == gc]
            if rotas:
                real = sum(vm.real.get(r, {}).get(K_REFRI, 0.0) for r in rotas)
                meta = sum(calc[(r, K_REFRI)][0] or 0.0 for r in rotas)
                api[gc] = (real, meta, real + sum(calc[(r, K_REFRI)][1] or 0.0 for r in rotas),
                           None if dia is None else sum(dia.get(r, {}).get(K_REFRI, 0.0) for r in rotas))
        rel.p(f"Tela do SAC: `{caminho.name}`" + (f" ({comentario})" if comentario else "") + ". API = as mesmas "
              "funções do gerador (o que o payload publica); gerência = a da rota no painel.")
        if simulado:
            rel.p("Data simulada (--hoje): a API traz os dados de agora no Datasphere; diferença no Real é esperada.")
        rel.p("Tolerância: Real ±0,1%; Meta exata (inteiros arredondados); Tendência ±0,2%; % ±0,1 p.p.; "
              "Meta do dia ±1%. Célula sem valor no CSV não é comparada. Diferenças por rota: seção E7.")
        linhas, ok_total = comparar_sac(api, sac)
        rel.tabela(CAB_SAC, linhas)
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

    # E1-E5. 16 gerências, At, agrupadores novos, GDM, Neutraliza (só contagens e códigos de SV/rota) ----
    rel.h("E1. Gerências nos 3 modelos")

    def gerencias():
        CB = M.ColBase
        modelos = [(M.OBJ_BASE_CLIENTE, CB.GC, CB.QUANTIDADE, M.FILTRO_BASE_CLIENTE),
                   (M.OBJ_META, CM.GC, CM.VOL_MES, eq(CM.ANOMES, anomes)),
                   (M.OBJ_COMODATO, CO.GC, CO.MEDIDA_AUX, M.FILTRO_COMODATO)]
        linhas = []
        for obj, col, med, filtro in modelos:
            try:
                vals = {limpar(l.get(col)) for l in cons.linhas(obj, [col, med], filtro)}
            except Exception as erro:  # noqa: BLE001
                linhas.append([obj, f"erro: {erro}", None, None])
                continue
            for v in sorted(vals):
                cod = M.codigo_gc(v)
                linhas.append([obj, repr(v), ", ".join(M.GC_SIGLAS_ORIGEM.get(cod, [])) or "**não mapeada**",
                               "sim" if v in M.GC_ORIGEM else "não"])
        rel.tabela(["modelo", "gerência (como veio)", "siglas no painel", "em M.GC_ORIGEM"], linhas)
        por = defaultdict(lambda: [set(), set(), 0])
        for c in estado["clientes"]:
            por[c.gc][0].add(c.sv)
            por[c.gc][1].add(c.rota)
            por[c.gc][2] += 1
        rel.p("\nNo painel (base de clientes já filtrada), por sigla:")
        rel.tabela(["sigla", "nome", "supervisões", "rotas", "clientes"],
                   [[g, M.GC_NOMES.get(g, "**fora de M.GC_NOMES**"),
                     len(por[g][0]), len(por[g][1]), por[g][2]] for g in M.GC_ATIVAS + sorted(set(por) - set(M.GC_ATIVAS))])
        est = estado["est_base"]
        rel.p("\nLinhas ignoradas da base de clientes, por gerência e motivo:")
        rel.tabela(["gerência", "motivo", "linhas"],
                   [[o, m, n] for o, ms in sorted(est.get("ignoradas", {}).items()) for m, n in sorted(ms.items())]
                   or [["—", "nenhuma", 0]])
        rel.p("\nSupervisores com prefixo fora das siglas da gerência (entram pelo prefixo): "
              + ("; ".join(f"{o}: {', '.join(v)}" for o, v in sorted(est.get("fora_padrao", {}).items())) or "nenhum"))
    etapa("E1 gerências", gerencias)

    rel.h("E2. Gc. At: supervisões e rotas por tipo")

    def atacados():
        CB = M.ColBase
        sel_at = [CB.ROTA, CB.SUPERVISOR, CB.NOME_SUPERVISOR, CB.QUANTIDADE]
        lin = cons.linhas(M.OBJ_BASE_CLIENTE, sel_at, e(M.FILTRO_BASE_CLIENTE, eq(CB.GC, "Gc. At")))
        grupos = defaultdict(float)
        for l in lin:
            r, sv = fontes._rota(l.get(CB.ROTA)), M.codigo_sv(l.get(CB.SUPERVISOR))
            # o nome do supervisor só classifica ("sem vendedor"); nunca vai para o relatório
            tipo = ("rota eventual (EV*)" if not M.rota_do_painel(r) else "balcão (SV.BL.*)"
                    if sv.startswith(M.SV_IGNORAR_PREFIXOS) else "fora do padrão" if not M.sv_do_painel(sv)
                    else "Neutraliza" if r in M.NEUTRALIZA_ROTAS else "virtual" if r in M.VIRTUAIS_ROTAS
                    else "sem vendedor" if "SEM VENDEDOR" in normalizar(l.get(CB.NOME_SUPERVISOR)) else "normal")
            grupos[(tipo, sv, r)] += numero(l.get(CB.QUANTIDADE))
        rel.p("Na At nenhuma supervisão é oculta; as listas por rota (Neutraliza e virtuais) valem; EV*, SV.BL.* e "
              "supervisor fora do padrão continuam fora (filtros globais).")
        rel.tabela(["tipo", "supervisão", "rota", "clientes"],
                   [[t, sv, r, int(n)] for (t, sv, r), n in sorted(grupos.items())] or [["—", "—", "—", 0]])
    etapa("E2 Gc. At", atacados)

    rel.h("E3. Agrupadores novos (FRUT, SUCO, ADES, POWER)")

    def agrupadores():
        lin = cons.linhas(M.OBJ_META, [CM.AGRUPADOR, CM.VOL_MES], eq(CM.ANOMES, anomes))
        alvo = re.compile(r"FRUT|SUCO|ADES|POWER")
        vals = defaultdict(float)
        for l in lin:
            if alvo.search(normalizar(l.get(CM.AGRUPADOR))):
                vals[limpar(l.get(CM.AGRUPADOR))] += numero(l.get(CM.VOL_MES))
        rel.tabela(["agrupador (como veio)", "FX_VOL_PADRAO_FAT no mês"], [[repr(v), _n(t)] for v, t in sorted(vals.items())]
                   or [["nenhum", None]])
        achados = {normalizar(v) for v in vals}
        esperados = list(M.AGRUPADORES_VOLUME_EXTRA.values()) + [a for a in M.AGRUPADORES_GDM if a not in
                                                                  M.AGRUPADORES_VOLUME.values()]
        rel.p("\nConfere a grafia em mapeamento.py: " + "; ".join(
            f"`{a}` {'encontrado' if normalizar(a) in achados else '**NÃO encontrado**'}" for a in esperados))
    etapa("E3 agrupadores", agrupadores)

    k_extra = M.INDICADORES_VOLUME_EXTRA[0]
    rel.h(f"E3b. {M.VOLUME_EXTRA[k_extra]['label']} na {', '.join(M.VOLUME_EXTRA[k_extra]['gcs'])}: meta e real por rota")

    def del_valle():
        k, ag = k_extra, M.AGRUPADORES_VOLUME_EXTRA[k_extra]
        vm = estado.get("vm") or fontes.carregar_volume_real(cons, anomes, gcs, None)
        metas_vol = estado.get("metas_vol") or fontes.carregar_metas(cons, anomes, None)[1]
        if "curva" in estado:
            (neg_mes, neg_rest), fonte = estado["curva"], estado["fonte_neg"]
        else:
            neg_mes, neg_rest, fonte = fontes.carregar_curva_neg(cons, anomes, gcs, None, hoje)
        direto = fonte == fontes.ROTA_META
        cal = estado["cal"]
        restantes = cal.total_dias_uteis - cal.dia_ontem
        linhas, metas, reais = [], [], []
        for gc in M.VOLUME_EXTRA[k]["gcs"]:
            for r in [r for r in estado["rotas"] if gc_da_rota[r] == gc]:
                mv, nm = metas_vol.get(r, {}).get(k), neg_mes.get(r, {}).get(k)
                meta = modelo.meta_e_restante(mv, nm, (neg_rest or {}).get(r, {}).get(k, 0.0), restantes,
                                              cal.total_dias_uteis, direto=direto)[0]
                real = vm.real.get(r, {}).get(k)
                metas.append(meta)
                reais.append(real or 0.0)
                tipo = ("Neutraliza" if r in M.NEUTRALIZA_ROTAS else "virtual" if r in M.VIRTUAIS_ROTAS else "normal")
                linhas.append([r, gc, tipo, _n(mv), _n(nm), _n(meta), _n(real), _pct(real, meta)])
        meta_tot = sum(m for m in metas if m is not None)
        linhas.append(["**total**", "", "", None, None, _n(meta_tot), _n(sum(reais)), _pct(sum(reais), meta_tot)])
        rel.p(f"Agrupador `{ag}` (M.AGRUPADORES_VOLUME_EXTRA). META_VOLUME pela rota da meta; META_NEG do mês pela "
              "rota da meta (a curva do gerador); Meta = a do gerador (META_VOLUME; sem ela, a META_NEG); Vol Real com "
              "os status do SAC.")
        rel.tabela(["rota", "gerência", "tipo", "META_VOLUME", "META_NEG do mês", "Meta (gerador)", "Vol Real", "% real"],
                   linhas)
        if any(m is not None for m in metas):
            rel.p(f"\nCard de {M.VOLUME_EXTRA[k]['label']}: **aparece** (rotas com meta: "
                  f"{sum(m is not None for m in metas)} de {len(metas)}).")
        else:
            rel.p(f"\n**Sem meta de `{ag}`: o card não aparece** (o gerar.py avisa no log).")
    etapa("E3b Del Valle Frut", del_valle)

    rel.h("E4. Desempenho GDM: amostra de 20 clientes com geladeira Total Ko (sem identificação)")

    def gdm():
        vz, atv, vz_meta, por_cli = fontes.carregar_comodato(cons, anomes, None, gc_da_rota)
        vm = estado.get("vm") or fontes.carregar_volume_real(cons, anomes, gcs, None)
        # VL_PADRAO por cliente (mesma consulta do comodato, já em memória)
        sel_co = fontes._colunas(cons, M.OBJ_COMODATO, [CO.ROTA, CO.CLIENTE, CO.NOME, CO.DIA_VISITA, CO.VISITA_HOJE,
                                                        CO.EQUIPAMENTO, CO.GIRO, CO.META_EQPTO, CO.VOLUME])
        vl, giros, vistos = defaultdict(list), defaultdict(int), set()
        for l in cons.linhas(M.OBJ_COMODATO, sel_co, e(M.FILTRO_COMODATO, ou(CO.GC, M.GC_ORIGEM))):
            r, pv, eq_ = fontes._rota(l.get(CO.ROTA)), inteiro(l.get(CO.CLIENTE)), limpar(l.get(CO.EQUIPAMENTO))
            if not r or pv is None or (r, eq_) in vistos:
                continue
            vistos.add((r, eq_))
            vl[(r, pv)].append(numero(l.get(CO.VOLUME)))
            giros[limpar(l.get(CO.GIRO))] += 1
        amostra = sorted(k_ for k_ in por_cli if k_[0] in gc_da_rota)[:20]
        linhas = []
        for i, (r, pv) in enumerate(amostra, 1):
            meta, n, sits = por_cli[(r, pv)]
            real = vm.real_gdm_cliente.get(r, {}).get(pv, 0.0)
            vls = vl.get((r, pv), [0.0])
            linhas.append([f"cliente {i}", gc_da_rota[r], n, fontes.situacao_cliente(sits) or "desconhecida", _n(meta),
                           _n(sum(vls)), _n(max(vls)), _n(real), _pct(real, meta)])
        rel.p("Faturado GDM = Vol Real (status do SAC) em Refrigerantes, Água Mineral, Sucos, Ades e Powerade. "
              "Compare as unidades: GDM x VL_PADRAO x META_EQPTO.")
        rel.tabela(["", "gerência", "geladeiras", "situação", "META_EQPTO", "VL_PADRAO (soma)", "VL_PADRAO (máx.)",
                    "faturado GDM", "% GDM"], linhas or [["—"] + [None] * 8])
        # situação pelo código do mapeamento; só o texto que NÃO bateu com M.SITUACAO_GIRO aparece (para corrigir grafia)
        por_cod, sem_mapa = defaultdict(int), defaultdict(int)
        for g, n in giros.items():
            cod = M.SITUACAO_GIRO.get(normalizar(g))
            if cod:
                por_cod[cod] += n
            else:
                sem_mapa[g] += n
        rel.p("\nGeladeiras por situação (M.SITUACAO_GIRO): " + "; ".join(f"{c}: {por_cod.get(c, 0)}" for c in M.ORDEM_SITUACAO)
              + " · sem correspondência: " + ("; ".join(f"{g!r}: {n}" for g, n in sorted(sem_mapa.items())) or "nenhuma"))
        dist = defaultdict(int)
        mistos = 0
        for meta, n, sits in por_cli.values():
            dist["3 ou mais" if n >= 3 else str(n)] += 1
            mistos += len({s_ for s_ in sits if s_}) > 1
        rel.p("Geladeiras por cliente: " + "; ".join(f"{k_}: {v} clientes" for k_, v in sorted(dist.items()))
              + f" · clientes com situações diferentes entre as geladeiras: {mistos}")
    etapa("E4 GDM", gdm)

    rel.h("E5. Rotas Neutraliza e virtuais")

    def neutraliza():
        por_rota = defaultdict(lambda: [defaultdict(int), defaultdict(int), set()])   # rota -> [gc, sv, PVs]
        for c in estado["clientes"]:
            if c.rota in M.NEUTRALIZA_ROTAS or c.rota in M.VIRTUAIS_ROTAS:
                p = por_rota[c.rota]
                p[0][c.gc] += 1
                p[1][c.sv] += 1
                p[2].add(c.pv)
        vz = fontes.carregar_comodato(cons, anomes, None, gc_da_rota)[0]
        vm = estado.get("vm") or fontes.carregar_volume_real(cons, anomes, gcs, None)
        metas_vol = estado.get("metas_vol") or fontes.carregar_metas(cons, anomes, None)[1]
        k = "VOL REFRIGERANTES"
        linhas = []
        for tipo, rotas in (("Neutraliza", M.NEUTRALIZA_ROTAS), ("virtual", M.VIRTUAIS_ROTAS)):
            for r in rotas:
                if r not in por_rota:
                    linhas.append([r, tipo, None, None, 0, None, None, None, "**fora da base de clientes** (não aparece)"])
                    continue
                gc_, sv_, pvs = por_rota[r]
                # meta como o gerador (META_VOLUME da rota; sem ela, soma de META_NEG)
                meta = (estado.get("calc", {}).get((r, k)) or (metas_vol.get(r, {}).get(k),))[0]
                linhas.append([r, tipo, max(gc_, key=gc_.get), max(sv_, key=sv_.get), len(pvs), _n(meta),
                               _n(vm.real.get(r, {}).get(k)), sum(e_.vdz for e_ in (vz or {}).get(r, [])),
                               "aparece (linha Neutraliza)" if tipo == "Neutraliza" else "oculta (só no total)"])
        rel.p("Listas por rota (M.NEUTRALIZA_ROTAS, M.VIRTUAIS_ROTAS). Neutraliza: no total da gerência (Meta/Real de "
              "Volume, ICS e NN) e numa linha \"Neutraliza\" da cascata e do filtro de supervisão; fora do Resumo, do "
              "\"puxa a média\" e da Venda Zero. Virtuais: ocultas em todo o painel, só no total da gerência; fora "
              "da Venda Zero. Meta e Real de Refrigerantes do mês de referência; geladeiras zeradas que ficam fora "
              "da Venda Zero.")
        rel.tabela(["rota", "tipo", "gerência", "supervisão", "clientes", "Meta Refrigerantes", "Real Refrigerantes",
                    "geladeiras zeradas (fora da VZ)", "no painel"], linhas)
    etapa("E5 Neutraliza e virtuais", neutraliza)

    rel.h("E5b. Rota 551 (Neutraliza que não aparece no payload)")

    def rota_551(r: str = "551"):
        CB = M.ColBase
        corrente = {c.pv for c in estado["clientes"] if c.rota == r}
        # todas as versões da base (sem o filtro de corrente/ativo): só gerência, supervisão, status e datas
        sel_b = fontes._colunas(cons, M.OBJ_BASE_CLIENTE, [CB.ROTA, CB.GC, CB.SUPERVISOR, CB.STATUS, CB.QUANTIDADE],
                                ["FL_CORRENTE", "DATA_FINAL"])
        versoes = defaultdict(lambda: [0.0, ""])
        for l in cons.linhas(M.OBJ_BASE_CLIENTE, sel_b, eq(CB.ROTA, r)):
            if fontes._rota(l.get(CB.ROTA)) != r:
                continue
            v = versoes[(limpar(l.get(CB.GC)), M.codigo_sv(l.get(CB.SUPERVISOR)), limpar(l.get(CB.STATUS)),
                         limpar(l.get("FL_CORRENTE")) or "—")]
            v[0] += numero(l.get(CB.QUANTIDADE))
            v[1] = max(v[1], limpar(l.get("DATA_FINAL"))[:10])
        # Análise Meta no mês de referência: venda pela rota do cliente, metas e META_NEG pela rota da meta
        vendas = [l for l in cons.linhas(M.OBJ_META, [CM.ROTA, CM.CLIENTE, CM.VOL_MES],
                                         e(eq(CM.ANOMES, anomes), eq(CM.ROTA, r))) if fontes._rota(l.get(CM.ROTA)) == r]
        metas = [l for l in cons.linhas(M.OBJ_META, [CM.META_ROTA, CM.META_VOLUME, CM.META_COBERTURA],
                                        e(eq(CM.META_ANOMES, anomes), eq(CM.META_ROTA, r)))
                 if fontes._rota(l.get(CM.META_ROTA)) == r]
        neg = [l for l in cons.linhas(M.OBJ_META, [CM.META_ROTA, CM.META_NEG], e(eq(CM.ANOMES, anomes), eq(CM.META_ROTA, r)))
               if fontes._rota(l.get(CM.META_ROTA)) == r]
        por_cli = fontes.carregar_comodato(cons, anomes, None, gc_da_rota)[3]
        geladeiras = sum(v[1] for (rr, _), v in por_cli.items() if rr == r)
        meta_vol = sum(numero(l.get(CM.META_VOLUME)) for l in metas)
        meta_cob = sum(numero(l.get(CM.META_COBERTURA)) for l in metas)
        meta_neg = sum(numero(l.get(CM.META_NEG)) for l in neg)
        rel.tabela(["base de clientes", "valor"], [
            ["clientes correntes e ativos (o que o painel lê)", len(corrente)],
            ["versões no histórico (todas as situações)", int(sum(v[0] for v in versoes.values()))],
            [f"clientes com venda no mês ({anomes}, rota do cliente)", len({l.get(CM.CLIENTE) for l in vendas})],
            ["FX_VOL_PADRAO_FAT no mês (todos os agrupadores)", _n(sum(numero(l.get(CM.VOL_MES)) for l in vendas))],
            ["META_VOLUME da rota (soma dos agrupadores)", _n(meta_vol)],
            ["META_COBERTURA da rota (soma dos agrupadores)", _n(meta_cob, 0)],
            ["META_NEG do mês (rota da meta)", _n(meta_neg)],
            ["geladeiras Total Ko em contrato", geladeiras]])
        rel.p("\nVersões da rota na base de clientes (sem o filtro FL_CORRENTE = 'S' e Ativo):")
        rel.tabela(["gerência", "supervisão", "situação", "FL_CORRENTE", "linhas", "último DATA_FINAL"],
                   [[*k_, int(v[0]), v[1] or None] for k_, v in sorted(versoes.items(), key=lambda kv: kv[1][1])]
                   or [["—", "—", "—", "—", 0, None]])
        if corrente:
            gc_ = gc_da_rota[r]
            rel.p(f"\nResultado: a {r} tem {len(corrente)} clientes correntes na {gc_} e entra como **Neutraliza** "
                  f"na gerência {gc_}.")
        else:
            ultima = max(versoes.items(), key=lambda kv: kv[1][1], default=None)
            rel.p(f"\nResultado: a {r} **não aparece** porque não tem cliente corrente e ativo na base de clientes"
                  + (f" (última versão: {ultima[0][0]} / {ultima[0][1]}, {ultima[0][2]}, até {ultima[1][1]})" if ultima else
                     " (nenhuma versão)")
                  + ("; também não tem venda nem meta no mês" if not vendas and not (meta_vol or meta_cob or meta_neg)
                     else "; **tem venda ou meta no mês: conferir a base de clientes**")
                  + ". Fica em M.NEUTRALIZA_ROTAS: se voltar à base, entra como Neutraliza na gerência a que pertencer.")
    etapa("E5b rota 551", rota_551)

    # E7. diferenças contra a tela do SAC, por gerência e rota (só com o CSV do dia) ----------------------
    if "sac" in estado:
        rel.h("E7. Diferenças contra o SAC, por gerência (Refrigerantes)")
        etapa("E7 diferenças contra o SAC", lambda: diferencas_sac(rel, cons, estado, anomes, anomes_hoje, hoje))

    # E8. descoberta do incentivo Todos a Bordo 3.0 (cobertura de cervejas, mês atual) ---------------------------
    rel.h("E8. Descoberta do incentivo Todos a Bordo 3.0")
    etapa("E8 incentivo", lambda: descoberta_incentivo(rel, cons, estado, anomes_hoje))

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
    ap.add_argument("--e9", type=Path, metavar="PAYLOAD",
                    help="só a seção E9 (SEM_COMPRA_MES) deste payload.json, acrescentada ao relatório (sem rede)")
    ap.add_argument("--e9-duracao", type=float, help="segundos do gerar.py completo (para a E9)")
    args = ap.parse_args()
    if args.e9:
        return main_e9(args.e9, args.saida, args.e9_duracao)
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


def main_e9(caminho: Path, pasta: Path, duracao: float | None) -> int:
    """Acrescenta a seção E9 ao relatório da pasta (o workflow roda depois do gerar.py)."""
    payload = json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else None
    rel = Relatorio()
    rel.h("E9. SEM_COMPRA_MES (clientes sem compra no mês, do payload gerado)")
    secao_sem_compra_mes(rel, payload, duracao)
    pasta.mkdir(parents=True, exist_ok=True)
    with (pasta / "relatorio_tendencia.md").open("a", encoding="utf-8") as arq:
        arq.write("\n".join(rel.linhas) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
