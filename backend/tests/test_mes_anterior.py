"""
Seção E10 do conferir_tendencia.py (descoberta da Etapa 8, "Evolução contra o mês anterior"): o mesmo dia útil no mês
anterior pelo calendário (bordas: mês anterior com menos dias úteis, início do mês, fechamento, virada do ano, feriado
regional do Datasphere), as agregações (como o card: Vol Real, metas, cobertura com o KS TT), o veredito do filtro de
DATA_MOVIMENTO, o peso da chave proposta e o relatório sem nomes nem códigos de clientes. Datasphere simulado, com
códigos e nomes fictícios.
"""
import contextlib
import importlib.util
import io
import re
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from gerador import calendario as calmod
from gerador import mapeamento as M
from gerador.texto import data
from gerador.tipos import Cliente
from tests.test_fontes import DADOS, ConsultaFalsa, _todas

CM, CC = M.ColMeta, M.ColCalendario

_spec = importlib.util.spec_from_file_location(
    "conferir_tendencia", Path(__file__).resolve().parents[1] / "scripts" / "conferir_tendencia.py")
ct = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ct)


def _cal_linhas(ano, mes, nao_uteis=()):
    """Linhas do calendário do Datasphere de um mês: NO_DIA_UTIL repete o último dia útil no fim de semana e feriado."""
    uteis = [d for d in calmod.dias_uteis_do_mes(ano, mes) if d not in nao_uteis]
    linhas, n, d = [], 0, date(ano, mes, 1)
    while d.month == mes:
        n += d in uteis
        linhas.append({CC.DATA: d.isoformat(), CC.DIAS_UTEIS_MES: len(uteis), CC.DIA_UTIL: n, CC.DIAS_RESTANTES: 0})
        d += timedelta(days=1)
    return linhas


# ---------------------------------------------------------------- calendário: o mesmo dia útil no mês anterior
class TestCorteMesAnterior(unittest.TestCase):
    def test_normal_inclui_o_fim_de_semana_depois_do_dia_util(self):
        # 21/10/2026 (quarta): dia útil 14 de 21, DIA_ONTEM 13 (20/10); em set/26 o 13º dia útil é sexta 18/09
        c = ct.corte_mes_anterior(calmod.calcular_local(date(2026, 10, 21)), [])
        self.assertEqual((c.ref, c.anterior, c.n, c.total_ref, c.total_ant, c.n_ant),
                         (date(2026, 10, 1), date(2026, 9, 1), 13, 21, 21, 13))
        self.assertEqual((c.data_n, c.corte), (date(2026, 9, 18), date(2026, 9, 20)))   # sábado e domingo entram
        self.assertEqual((c.caso, c.limitado, c.n_proporcional, c.fonte), (ct.CASO_NORMAL, False, 13, ct.FONTE_LOCAL))

    def test_calendario_do_datasphere_manda(self):
        # feriado regional em 08/09 (só no Datasphere): o 13º dia útil de setembro vira segunda 21/09
        linhas = _cal_linhas(2026, 9, {date(2026, 9, 8)}) + _cal_linhas(2026, 10)
        cal = calmod.do_datasphere(linhas, date(2026, 10, 21))
        c = ct.corte_mes_anterior(cal, linhas)
        self.assertEqual((c.fonte, c.total_ant, c.data_n, c.corte, c.data_ref),
                         (ct.FONTE_DATASPHERE, 20, date(2026, 9, 21), date(2026, 9, 21), date(2026, 10, 20)))
        self.assertEqual(c.n_proporcional, 12)                                    # 13 / 21 x 20 = 12,4
        # sem as linhas de setembro: cálculo local (sem o feriado regional)
        c = ct.corte_mes_anterior(cal, _cal_linhas(2026, 10))
        self.assertEqual((c.fonte, c.data_n, c.corte), (ct.FONTE_LOCAL, date(2026, 9, 18), date(2026, 9, 20)))

    def test_calendario_incompleto_cai_no_calculo_local(self):
        linhas = [l for l in _cal_linhas(2026, 9) if l[CC.DIA_UTIL] != 5]          # some o 5º dia útil
        datas, fonte = ct.dias_uteis_do_mes(linhas, date(2026, 9, 1))
        self.assertEqual((fonte, len(datas)), (ct.FONTE_LOCAL, 21))

    def test_mes_anterior_com_menos_dias_uteis(self):
        # 31/03/2026: DIA_ONTEM 21 de 22; fev/26 tem 18 dias úteis (Carnaval 16 e 17/02): vale fevereiro inteiro
        c = ct.corte_mes_anterior(calmod.calcular_local(date(2026, 3, 31)), [])
        self.assertEqual((c.n, c.total_ref, c.total_ant, c.n_ant), (21, 22, 18, 18))
        self.assertEqual((c.data_n, c.corte), (date(2026, 2, 27), date(2026, 2, 28)))
        self.assertEqual((c.caso, c.limitado, c.n_proporcional), (ct.CASO_LIMITADO, True, 17))   # 21 / 22 x 18 = 17,2

    def test_inicio_do_mes_sem_dia_util_fechado(self):
        c = ct.corte_mes_anterior(calmod.calcular_local(date(2026, 10, 1)), [])
        self.assertEqual((c.n, c.n_ant, c.data_n, c.corte, c.caso), (0, 0, None, None, ct.CASO_SEM_DIA))

    def test_fechamento(self):
        # 03/11/2026 em fechamento: outubro fechado (21 dias úteis) contra setembro (21): setembro inteiro
        c = ct.corte_mes_anterior(calmod.fechado(date(2026, 11, 3), date(2026, 10, 1), 21), [])
        self.assertEqual((c.ref, c.anterior, c.n, c.n_ant, c.corte, c.caso),
                         (date(2026, 10, 1), date(2026, 9, 1), 21, 21, date(2026, 9, 30), ct.CASO_FECHAMENTO))
        # fevereiro fechado (18) contra janeiro (21): o 18º dia útil de janeiro; os 3 últimos ficam fora
        c = ct.corte_mes_anterior(calmod.fechado(date(2026, 3, 2), date(2026, 2, 1), 18), [])
        self.assertEqual((c.anterior, c.total_ant, c.n_ant, c.data_n, c.corte, c.limitado),
                         (date(2026, 1, 1), 21, 18, date(2026, 1, 27), date(2026, 1, 27), False))

    def test_virada_do_ano(self):
        c = ct.corte_mes_anterior(calmod.calcular_local(date(2027, 1, 20)), [])
        self.assertEqual((c.anterior, c.n, c.total_ant, c.data_n, c.corte),
                         (date(2026, 12, 1), 12, 22, date(2026, 12, 16), date(2026, 12, 16)))

    def test_corte_do_dia(self):
        datas = calmod.dias_uteis_do_mes(2026, 9)
        self.assertIsNone(ct.corte_do_dia(datas, 0, date(2026, 9, 1)))
        self.assertEqual(ct.corte_do_dia(datas, 4, date(2026, 9, 1)), date(2026, 9, 7))   # sexta 04 + fim de semana + 07/09
        self.assertEqual(ct.corte_do_dia(datas, 21, date(2026, 9, 1)), date(2026, 9, 30))


# ---------------------------------------------------------------- agregações (sem rede)
def _vr(rota, ag, vol, status="Acertado", gcc=None):
    return {CM.ROTA: rota, CM.AGRUPADOR: ag, CM.NF_STATUS: status, CM.VOL_MES: vol, CM.GC_COMERCIAL: gcc}


def _cb(rota, pv, ag, cob=1, vol=0.0, seg=None):
    return {CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: ag, CM.COB_MES: cob, CM.VOL_MES: vol, CM.SEGMENTO: seg}


class TestAgregacoes(unittest.TestCase):
    def test_real_por_rota_com_status_e_eventuais(self):
        real, ev = ct.real_por_rota([
            _vr("111", "Refrigerantes", 10), _vr("111", "Refrigerantes", 5, "Cancelada"), _vr("111", "Cctm 2l Pet", 3),
            _vr("111", "Agua Mineral", 2, "Meta Neg"), _vr("EV1", "Refrigerantes", 7, gcc="Gc. Ap"),
            _vr("EV2", "Refrigerantes", 1, gcc="--"), _vr("", "Refrigerantes", 9)])
        self.assertEqual(real, {"111": {"VOL REFRIGERANTES": 10.0, "VOL AGUA MINERAL": 2.0},
                                "EV1": {"VOL REFRIGERANTES": 7.0}, "EV2": {"VOL REFRIGERANTES": 1.0}})
        self.assertEqual(ev, {"AP": {"VOL REFRIGERANTES": 7.0}})                  # EV2 sem gerência do painel

    def test_meta_e_volume_por_gerencia_como_o_card(self):
        gc_rota = {"111": "G1", "112": "G1", "113": "G1", "G1-EV": "G1", "A11": "AP"}
        metas_vol = {"111": {"VOL REFRIGERANTES": 100.0}, "A11": {"VOL REFRIGERANTES": 50.0}}
        neg = {"112": {"VOL REFRIGERANTES": 30.0}}
        real = {"111": {"VOL REFRIGERANTES": 40.0}, "113": {"VOL REFRIGERANTES": 9.0}, "G1-EV": {"VOL REFRIGERANTES": 2.0},
                "A11": {"VOL REFRIGERANTES": 20.0}, "Z99": {"VOL REFRIGERANTES": 99.0}}
        meta = ct.meta_volume_por_rota(metas_vol, neg, gc_rota, real)
        self.assertEqual(meta["111"]["VOL REFRIGERANTES"], 100.0)
        self.assertEqual(meta["112"]["VOL REFRIGERANTES"], 30.0)                  # sem META_VOLUME: a META_NEG
        self.assertIsNone(meta["113"]["VOL REFRIGERANTES"])                       # sem nenhuma: indisponível
        # rota oculta das EV*: meta 0 só nos macros com Real (como o gerador)
        self.assertEqual(meta["G1-EV"], {k: 0.0 if k == "VOL REFRIGERANTES" else None for k in M.INDICADORES_VOLUME})
        por_gc = ct.volume_por_gc(real, meta, gc_rota)
        self.assertEqual(por_gc["G1"]["VOL REFRIGERANTES"], [42.0, 130.0, 3])    # 113 (sem meta) e Z99 (fora) não somam
        self.assertEqual(por_gc["G1"]["VOL STILL"], [0.0, 0.0, 0])                # nenhuma rota com o indicador
        band = ct.com_band(por_gc, M.INDICADORES_VOLUME, [0.0, 0.0, 0])["BAND"]
        self.assertEqual(band["VOL REFRIGERANTES"], [62.0, 180.0, 4])
        self.assertEqual(ct._soma_vol(real, {"111", "A11"}), 60.0)
        self.assertIsNone(ct._soma_vol(None))

    def test_cobertura_com_ks_tt_e_so_rotas_com_meta(self):
        seg_base = {("111", 1): "Boteco", ("111", 2): "Mercearia"}
        linhas = [_cb("111", 1, "Ks Tt"), _cb("111", 2, "Ks Tt"),                 # base: Boteco sim, Mercearia não
                  _cb("111", 3, "Ks Tt", seg="Lanchonete"), _cb("111", 4, "Ks Tt", seg="Distribuidor"),  # fora da base
                  _cb("111", 1, "Cctm 2l Pet"), _cb("111", 2, "Cctm 2l Pet", cob=0, vol=4.0), _cb("111", 1, "Cctm 2l Pet"),
                  _cb("112", 5, "Kapo"), _cb("112", 6, "Refrigerantes"), _cb("112", 7, "Heineken")]
        cob = ct.cobertura_por_rota(linhas, seg_base)
        self.assertEqual(cob, {"111": {"KS TT": {1, 3}, "CCTM 2L PET": {1}}, "112": {"KAPO": {5}}})
        self.assertEqual(ct.cobertura_por_rota(linhas, seg_base, CM.VOL_MES), {"111": {"CCTM 2L PET": {2}}})
        metas = {"111": {"KS TT": 4.0, "CCTM 2L PET": 0.0}, "112": {}}
        por_gc = ct.cobertura_por_gc(cob, metas, {"111": "G1", "112": "G1"})
        self.assertEqual(por_gc["G1"]["KS TT"], [2, 4.0, 1])
        self.assertEqual(por_gc["G1"]["CCTM 2L PET"], [1, 0.0, 1])                # meta 0 conta (indicador existe)
        self.assertEqual(por_gc["G1"]["KAPO"], [0, 0.0, 0])                       # 112 sem meta: fora da soma
        self.assertEqual(ct.clientes_na_amostra(cob, {"111"}), 3)

    def test_cobertura_somada_no_servidor_sem_cliente(self):
        sem_cli = ct.cobertura_sem_cliente([{CM.ROTA: "111", CM.AGRUPADOR: "Cctm 2l Pet", CM.COB_MES: 2},
                                            {CM.ROTA: "111", CM.AGRUPADOR: "Kapo", CM.COB_MES: 1},
                                            {CM.ROTA: "111", CM.AGRUPADOR: "Ks Tt", CM.COB_MES: 9},
                                            {CM.ROTA: "211", CM.AGRUPADOR: "Kapo", CM.COB_MES: 4}])
        cob = {"111": {"CCTM 2L PET": {1, 2}, "KAPO": {1, 2}, "KS TT": {1}}}
        self.assertEqual(ct.compara_sem_cliente(sem_cli, cob, {"111"}), (1, 2))     # KS TT e a rota 211 fora

    def test_veredito_do_filtro_de_data(self):
        self.assertEqual(ct.aceita_filtro(80.0, 100.0, 80.0), "sim (bate com a curva diária)")
        self.assertEqual(ct.aceita_filtro(80.0, 100.0), "sim (menor que o mês inteiro)")
        self.assertEqual(ct.aceita_filtro(100.0, 100.0, 80.0), "**não**: igual ao mês inteiro (filtro ignorado?)")
        self.assertEqual(ct.aceita_filtro(100.0, 100.0, None, True), "sim (corte = fim do mês)")
        self.assertEqual(ct.aceita_filtro(0.0, 100.0), "**não**: veio vazio")
        self.assertEqual(ct.aceita_filtro(70.0, 100.0, 80.0), "**a conferir**: difere da curva diária")
        self.assertEqual(ct.aceita_filtro(120.0, 100.0), "**a conferir**: maior que o mês inteiro")
        self.assertEqual(ct.aceita_filtro(None, 100.0), "**erro** na consulta com o filtro")
        self.assertEqual(ct.aceita_filtro(1.0, None), "sem comparação (a consulta sem o filtro falhou)")
        self.assertEqual(ct.aceita_filtro(0.0, 0.0), "sem dado no mês")

    def test_rotas_que_mudaram_de_gerencia(self):
        gc_ant = ct.gc_da_meta([{CM.META_ROTA: "A12", ct.COL_GC_COMERCIAL_META: "Gc. G1"},
                                {CM.META_ROTA: "A12", ct.COL_GC_COMERCIAL_META: "Gc. G1"},
                                {CM.META_ROTA: "A12", ct.COL_GC_COMERCIAL_META: "Gc. Ap"},
                                {CM.META_ROTA: "111", ct.COL_GC_COMERCIAL_META: "Gc. G1"},
                                {CM.META_ROTA: "Z99", ct.COL_GC_COMERCIAL_META: "Gc. Me"},       # fora das 16
                                {CM.META_ROTA: "X10", ct.COL_GC_COMERCIAL_META: "Gc. Sl"}])
        self.assertEqual(gc_ant, {"A12": "G1", "111": "G1", "X10": "SL"})         # a mais comum na rota
        self.assertEqual(ct.rotas_que_mudaram(gc_ant, {"X10": "RV"}, {"A12": "AP", "111": "G1"}),
                         [("A12", "G1", None, "AP"), ("X10", "SL", "RV", None)])

    def test_amostra(self):
        self.assertEqual(ct.amostra_gcs(["AN", "AP", "G1", "G2", "IT"]), ["G1", "AP", "IT"])
        self.assertEqual(ct.amostra_gcs(["AN", "G1", "G2"]), ["G1", "AN", "G2"])     # falta AP e IT: as próximas
        self.assertEqual(ct.amostra_gcs(["MO"]), ["MO"])

    def test_chave_proposta_e_peso(self):
        c = ct.corte_mes_anterior(calmod.calcular_local(date(2026, 10, 21)), [])
        gc_rota = {"112": "G1", "111": "G1", "113": "G1"}
        meta = ct.meta_volume_por_rota({"111": {"VOL REFRIGERANTES": 100.0}}, {}, gc_rota)
        real = {"111": {"VOL REFRIGERANTES": 40.04}}
        chave = ct.chave_mes_anterior(c, gc_rota, real, meta, {"111": {"KAPO": {1, 2}}}, {"111": {"KAPO": 5.0}})
        self.assertEqual({k: chave[k] for k in ("MES_LABEL", "DIA_UTIL", "TOTAL_DIAS_UTEIS", "DATA_CORTE")},
                         {"MES_LABEL": "Setembro/26", "DIA_UTIL": 13, "TOTAL_DIAS_UTEIS": 21, "DATA_CORTE": "2026-09-20"})
        self.assertEqual(chave["IND"], M.INDICADORES_VOLUME + M.INDICADORES_COBERTURA)
        self.assertEqual(list(chave["ROTAS"]), ["111"])                           # rotas sem nenhum indicador ficam fora
        vals = chave["ROTAS"]["111"]
        self.assertEqual(vals[0], [40.0, 100.0])
        self.assertEqual(vals[1:5], [None] * 4)
        self.assertEqual(vals[len(M.INDICADORES_VOLUME) + M.INDICADORES_COBERTURA.index("KAPO")], [2, 5])
        so_vol = ct.chave_mes_anterior(c, gc_rota, real, meta, None, None)
        self.assertEqual((so_vol["IND"], so_vol["ROTAS"]), (M.INDICADORES_VOLUME, {"111": [[40.0, 100.0]] + [None] * 4}))
        self.assertEqual(ct.peso_chave(so_vol), len(',"MES_ANTERIOR":') + len(
            '{"MES_LABEL":"Setembro/26","DIA_UTIL":13,"TOTAL_DIAS_UTEIS":21,"DATA_CORTE":"2026-09-20",'
            '"IND":["VOL REFRIGERANTES","VOL CERVEJAS","VOL STILL","VOL AGUA MINERAL","VOL DEST+ART+CND"],'
            '"ROTAS":{"111":[[40.0,100.0],null,null,null,null]}}'))


# ---------------------------------------------------------------- Datasphere simulado da E10
class ConsultaE10:
    """Modelo de vendas simulado: fatos (NF, cobertura, META_NEG) e metas, com os filtros de ANOMES, agrupador,
    gerência e DATA_MOVIMENTO, agregados pelas dimensões do $select (medida None quando nenhuma linha tem valor).
    ignora_data: medidas que ignoram o filtro de data (medida mensal); falha(select, filtro): HTTP 500."""

    MEDIDAS = {CM.VOL_MES, CM.COB_MES, CM.META_NEG, CM.META_VOLUME, CM.META_COBERTURA}
    OPS = {"ge": lambda a, b: a >= b, "le": lambda a, b: a <= b, "lt": lambda a, b: a < b, "eq": lambda a, b: a == b}

    def __init__(self, fatos, metas, ignora_data=(), falha=None, sem_gc_meta=False):
        self.fatos, self.metas, self.ignora_data, self.falha = fatos, metas, set(ignora_data), falha
        self.sem_gc_meta = sem_gc_meta
        self.chamadas, self.tempos = [], []

    def colunas(self, objeto):
        return _todas(CM) + ([] if self.sem_gc_meta else [ct.COL_GC_COMERCIAL_META])

    def tipo(self, objeto, coluna):
        return "Edm.Date" if coluna == CM.DATA else None

    def linhas(self, objeto, select, filtro=None, top=None, orderby=None):
        self.chamadas.append((objeto, tuple(select), filtro))
        if self.falha and self.falha(select, filtro):
            raise RuntimeError("HTTP 500 (simulado)")
        f = filtro or ""
        de_meta = any(c in select for c in (CM.META_COBERTURA, CM.META_VOLUME, ct.COL_GC_COMERCIAL_META))
        anomes = re.search(r"\bANOMES_REF eq '(\d{6})'", f)
        anomes_meta = re.search(rf"{CM.META_ANOMES} eq '(\d{{6}})'", f)
        ags = re.findall(rf"{CM.AGRUPADOR} eq '([^']*)'", f)
        mags = re.findall(rf"{CM.META_AGRUPADOR} eq '([^']*)'", f)
        gc = re.search(rf"{CM.GC} eq '([^']*)'", f)
        medidas = [c for c in select if c in self.MEDIDAS]
        datas = [] if set(medidas) & self.ignora_data else re.findall(rf"{CM.DATA} (ge|le|lt|eq) ([0-9-]+)", f)
        out = {}
        for l in self.metas if de_meta else self.fatos:
            if (anomes and l.get(CM.ANOMES) != anomes.group(1) or anomes_meta and l.get(CM.META_ANOMES) != anomes_meta.group(1)
                    or ags and l.get(CM.AGRUPADOR) not in ags or mags and l.get(CM.META_AGRUPADOR) not in mags
                    or gc and l.get(CM.GC) != gc.group(1)
                    or not all(data(l.get(CM.DATA)) and self.OPS[op](data(l.get(CM.DATA)), date.fromisoformat(v))
                               for op, v in datas)
                    or all(l.get(m) in (None, "") for m in medidas)):
                continue
            dims = tuple(l.get(c) for c in select if c not in self.MEDIDAS)
            a = out.setdefault(dims, {**{c: l.get(c) for c in select if c not in self.MEDIDAS}, **{m: None for m in medidas}})
            for m in medidas:
                if l.get(m) not in (None, ""):
                    a[m] = (a[m] or 0.0) + float(l[m])
        res = list(out.values())
        self.tempos.append((objeto, ", ".join(select), len(res), 0.0))
        return res[:top] if top else res

    def em_paralelo(self, tarefas):
        return {n: self.linhas(*a) for n, a in tarefas.items()}


GC_ORIGEM = {"G1": "Gc. G1", "AP": "Gc. Ap", "IT": "Gc. It_Mo", "MO": "Gc. It_Mo", "Z": "Gc. G1"}


def _nf(anomes, dia, rota, pv, vol, ag="Refrigerantes", meta_rota=None, status="Acertado", gc=None, gcc=None):
    return {CM.ANOMES: anomes, CM.DATA: dia, CM.ROTA: rota, CM.CLIENTE: f"{pv:010d}", CM.AGRUPADOR: ag,
            CM.NF_STATUS: status, CM.VOL_MES: vol, CM.GC: gc or GC_ORIGEM[_gc(rota)], CM.GC_COMERCIAL: gcc,
            CM.META_ROTA: meta_rota or rota}


def _cob(anomes, dia, rota, pv, ag, seg=None):
    return {CM.ANOMES: anomes, CM.DATA: dia, CM.ROTA: rota, CM.CLIENTE: f"{pv:010d}", CM.AGRUPADOR: ag,
            CM.NF_STATUS: "Acertado", CM.COB_MES: 1, CM.VOL_MES: 2.0, CM.GC: GC_ORIGEM[_gc(rota)], CM.SEGMENTO: seg,
            CM.META_ROTA: rota}


def _neg(anomes, dia, rota, valor):
    return {CM.ANOMES: anomes, CM.DATA: dia, CM.ROTA: rota, CM.META_ROTA: rota, CM.AGRUPADOR: "Refrigerantes",
            CM.META_NEG: valor, CM.GC: GC_ORIGEM[_gc(rota)]}


def _mt(anomes, rota, ag, vol=None, cob=None, gc=None):
    return {CM.META_ANOMES: anomes, CM.META_ROTA: rota, CM.META_AGRUPADOR: ag, CM.META_VOLUME: vol,
            CM.META_COBERTURA: cob, ct.COL_GC_COMERCIAL_META: gc}


def _gc(rota):
    return {"1": "G1", "A": "AP", "E": "AP", "I": "IT", "M": "MO", "Z": "Z"}[rota[0]]


SET, OUT = "202609", "202610"
FATOS = [
    # setembro (corte 20/09): Refrigerantes
    _nf(SET, "2026-09-10", "111", 9100001, 100),
    _nf(SET, "2026-09-25", "111", 9100001, 50),                                   # depois do corte
    _nf(SET, "2026-09-19", "111", 9100002, 30, meta_rota="A11"),                  # sábado (entra); meta na A11
    _nf(SET, "2026-09-15", "111", 9100003, 20, status="Cancelada"),               # fora do Vol Real
    _nf(SET, "2026-09-08", "112", 9100004, 40),
    _nf(SET, "2026-09-14", "A11", 9200001, 70),
    _nf(SET, "2026-09-21", "A12", 9200002, 10),                                   # depois do corte
    _nf(SET, "2026-09-02", "EV1", 9200003, 15, meta_rota="A11", gcc="Gc. Ap"),   # cliente em rota EV*: AP-EV
    _nf(SET, "2026-09-03", "I11", 9300001, 60),
    _nf(SET, "2026-09-04", "I12", 9300002, 25, meta_rota="I11"),                  # rota nova (sem meta em setembro)
    _nf(SET, "2026-09-09", "M11", 9400001, 35),
    _nf(SET, "2026-09-11", "Z99", 9500001, 5),                                    # fora do painel
    _nf(SET, "2026-09-10", "111", 9100001, 8, ag="Cervejas"),
    # setembro: cobertura
    _cob(SET, "2026-09-10", "111", 9100001, "Cctm 2l Pet"),
    _cob(SET, "2026-09-25", "111", 9100002, "Cctm 2l Pet"),                       # depois do corte
    _cob(SET, "2026-09-10", "111", 9100001, "Ks Tt"),                             # Boteco na base: entra
    _cob(SET, "2026-09-10", "111", 9100005, "Ks Tt", seg="Distribuidor"),         # fora da base, segmento da venda: fora
    _cob(SET, "2026-09-14", "A11", 9200001, "Cctm 2l Pet"),
    _cob(SET, "2026-09-03", "I11", 9300001, "Kapo"),
    # setembro: META_NEG pela rota da meta (mês 390; até o corte 330)
    _neg(SET, "2026-09-01", "111", 60), _neg(SET, "2026-09-25", "111", 60), _neg(SET, "2026-09-01", "112", 50),
    _neg(SET, "2026-09-10", "A11", 100), _neg(SET, "2026-09-10", "I11", 80), _neg(SET, "2026-09-01", "M11", 40),
    # outubro (o mês de referência, até agora)
    _nf(OUT, "2026-10-05", "111", 9100001, 120), _nf(OUT, "2026-10-21", "111", 9100001, 10),   # NF de hoje
    _nf(OUT, "2026-10-06", "112", 9100004, 30), _nf(OUT, "2026-10-07", "A11", 9200001, 90),
    _nf(OUT, "2026-10-02", "EV1", 9200003, 12, meta_rota="A11", gcc="Gc. Ap"),
    _nf(OUT, "2026-10-08", "I11", 9300001, 50), _nf(OUT, "2026-10-09", "M11", 9400001, 40),
    _cob(OUT, "2026-10-05", "111", 9100001, "Cctm 2l Pet"), _cob(OUT, "2026-10-05", "111", 9100001, "Ks Tt"),
    _cob(OUT, "2026-10-07", "A11", 9200001, "Cctm 2l Pet"), _cob(OUT, "2026-10-08", "I11", 9300001, "Kapo"),
    _neg(OUT, "2026-10-01", "111", 220),
]
METAS = [
    _mt(SET, "111", "Refrigerantes", 200, gc="Gc. G1"), _mt(SET, "112", "Refrigerantes", 100, gc="Gc. G1"),
    _mt(SET, "A11", "Refrigerantes", 150, gc="Gc. Ap"), _mt(SET, "A12", "Refrigerantes", 50, gc="Gc. G1"),   # mudou
    _mt(SET, "I11", "Refrigerantes", 120, gc="Gc. It"), _mt(SET, "M11", "Refrigerantes", 90, gc="Gc. Mo"),
    _mt(SET, "A19", "Refrigerantes", 30, gc="Gc. Ap"),                            # rota que saiu do painel
    _mt(SET, "111", "Cctm 2l Pet", cob=4), _mt(SET, "111", "Ks Tt", cob=2), _mt(SET, "A11", "Cctm 2l Pet", cob=3),
    _mt(SET, "I11", "Kapo", cob=2),
    _mt(OUT, "111", "Refrigerantes", 220, gc="Gc. G1"), _mt(OUT, "112", "Refrigerantes", 110, gc="Gc. G1"),
    _mt(OUT, "A11", "Refrigerantes", 160, gc="Gc. Ap"), _mt(OUT, "A12", "Refrigerantes", 60, gc="Gc. Ap"),
    _mt(OUT, "I11", "Refrigerantes", 130, gc="Gc. It"), _mt(OUT, "I12", "Refrigerantes", 40, gc="Gc. It"),
    _mt(OUT, "M11", "Refrigerantes", 100, gc="Gc. Mo"),
    _mt(OUT, "111", "Cctm 2l Pet", cob=5), _mt(OUT, "111", "Ks Tt", cob=2), _mt(OUT, "A11", "Cctm 2l Pet", cob=3),
    _mt(OUT, "I11", "Kapo", cob=2),
]
GC_ROTA = {"111": "G1", "112": "G1", "151": "G1", "A11": "AP", "A12": "AP", "I11": "IT", "I12": "IT", "M11": "MO"}
NOMES = ["Bar Ficticio Um", "Mercado Ficticio Dois", "Supervisor Ficticio", "Consultor Ficticio"]


def _cliente(pv, rota, seg="Boteco"):
    return Cliente(pv=pv, nome=NOMES[0], rota=rota, gc=GC_ROTA[rota], sv=f"SV.{GC_ROTA[rota]}.1", nome_sv=NOMES[2],
                   consultor=NOMES[3], segmento=seg, dia_visita="Seg", visita_hoje=True)


def _estado(cal=None):
    linhas = _cal_linhas(2026, 9) + _cal_linhas(2026, 10)
    return {"cal_ref": cal or calmod.do_datasphere(linhas, date(2026, 10, 21)), "linhas_cal": linhas,
            "gcs": ["Gc. G1", "Gc. Ap", "Gc. It_Mo"], "gc_rota_painel": dict(GC_ROTA), "gc_da_rota": dict(GC_ROTA),
            "clientes": [_cliente(9100001, "111"), _cliente(9100002, "111", "Mercearia"), _cliente(9100004, "112"),
                         _cliente(9200001, "A11"), _cliente(9300001, "I11"), _cliente(9400001, "M11")]}


def _e10(cons, estado=None, hoje=date(2026, 10, 21), payload_base=None):
    rel = ct.Relatorio()
    estado = estado or _estado()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        ct.mes_anterior(rel, cons, estado, estado["cal_ref"].anomes, hoje, payload_base)
    return "\n".join(rel.linhas)


def _linha(txt, inicio):
    return next((l for l in txt.splitlines() if l.startswith(inicio)), None)


class TestSecaoE10(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cons = ConsultaE10(FATOS, METAS)
        cls.txt = _e10(cls.cons)

    def test_calendario(self):
        self.assertIn("dias úteis de Setembro/26 pelo **Datasphere**. Caso de hoje: **normal**.", self.txt)
        self.assertIn("| data do dia útil | 20/10/2026 (terça-feira) | 18/09/2026 (sexta-feira) |", self.txt)
        self.assertIn("| data de corte (inclusive) | o mês até agora (Vol Real do painel) | 20/09/2026 (domingo) |", self.txt)
        self.assertIn("| proporcional (13 / 21 x 21) | 13 |", self.txt)

    def test_consultas_e_filtro_de_data(self):
        self.assertIn("Corte: `DATA_MOVIMENTO le 2026-09-20`", self.txt)
        self.assertIn("| Vol Real Setembro/26 até 20/09, por rota do cliente | `FX_VOL_PADRAO_FAT` | sim | "
                      "sim (bate com a curva diária) |", self.txt)
        self.assertIn("| Vol Real Setembro/26, mês inteiro (confere o filtro) | `FX_VOL_PADRAO_FAT` | não | "
                      "= curva diária do mês |", self.txt)
        self.assertIn("sim (total 388 x 388 pela rota do cliente)", self.txt)
        self.assertIn("| META_NEG Setembro/26 até 20/09, por rota da meta | `META_NEG` | sim | "
                      "sim (menor que o mês inteiro) |", self.txt)
        self.assertIn("sim (menor que o mês inteiro); amostra: 4 x 5 clientes x item no mês", self.txt)
        self.assertIn("= nº de clientes em 3 de 3 rota x item (sem o KS TT)", self.txt)
        self.assertIn("Vol Real até o corte 388 de 448 no mês (87%); a consulta com o filtro deu 388.", self.txt)
        self.assertIn("Vol Real de Outubro/26 com `DATA_MOVIMENTO` >= hoje: 10 de 352 (o Real do painel não é só", self.txt)
        self.assertIn("**igual ao nº de clientes** em todas as rotas x item da amostra", self.txt)
        # o corte só no $filter (nunca DATA_MOVIMENTO no groupby das consultas por rota)
        com_corte = [ch for ch in self.cons.chamadas if "DATA_MOVIMENTO le 2026-09-20" in (ch[2] or "")]
        self.assertTrue(com_corte and all(CM.DATA not in ch[1] for ch in com_corte))
        self.assertTrue(all("ANOMES_REF eq '202609'" in ch[2] or "ANOMES_REF_Chave_Meta_SAP eq '202609'" in ch[2]
                            for ch in com_corte))
        # linhas devolvidas e tempo em cada consulta
        self.assertRegex(self.txt, r"\| Vol Real Setembro/26 até 20/09, por rota do cliente \|[^\n]*\| \d+ \| 0\.0 \| volume \|")

    def test_amostra_volume(self):
        self.assertIn("### E10c. Amostra: G1, AP, IT e BAND (Setembro/26 até 20/09 x Outubro/26)", self.txt)
        # G1: 111 (100 + 30 do sábado; sem a cancelada e o depois do corte) + 112 (40) sobre 200 + 100
        self.assertIn("| G1 | Refrigerantes | 170 | 300 | 56,67% | 110 | 154,55% | 160 | 330 | 48,48% | -8,2 | -5,9% |",
                      self.txt)
        # AP: A11 70 + a rota oculta dos clientes em EV* (15); meta 150 + 50 + 0
        self.assertIn("| AP | Refrigerantes | 85 | 200 | 42,50% | 100 | 85,00% | 102 | 220 | 46,36% | +3,9 | +20,0% |",
                      self.txt)
        # IT: a I12 não tinha meta em setembro (o card não soma); em outubro tem meta e nenhuma venda
        self.assertIn("| IT | Refrigerantes | 60 | 120 | 50,00% | 80 | 75,00% | 50 | 170 | 29,41% | -20,6 | -16,7% |",
                      self.txt)
        self.assertIn("| BAND | Refrigerantes | 350 | 710 | 49,30% | 330 | 106,06% | 352 | 820 | 42,93% | -6,4 | +0,6% |",
                      self.txt)
        self.assertIn("| G1 | Still | — | — | — | — | — | — | — | — | — | — |", self.txt)
        self.assertIn("| AP | Cervejas | — | — | — | — | — | — | — | — | — | — |", self.txt)   # a rota oculta só no Refri

    def test_amostra_cobertura(self):
        self.assertIn("| G1 | CCTM 2L Pet | 1 | 4 | 25,00% | 2 | 1 | 5 | 20,00% | -5,0 |", self.txt)
        self.assertIn("| G1 | KS TT | 1 | 2 | 50,00% | 1 | 1 | 2 | 50,00% | +0,0 |", self.txt)
        self.assertIn("| AP | CCTM 2L Pet | 1 | 3 | 33,33% | 1 | 1 | 3 | 33,33% | +0,0 |", self.txt)
        self.assertIn("| IT | Kapo | 1 | 2 | 50,00% | 1 | 1 | 2 | 50,00% | +0,0 |", self.txt)
        self.assertIn("| IT | Campari | — | — | — | — | — | — | — | — |", self.txt)

    def test_refrigerantes_por_gerencia(self):
        self.assertIn("| MO | 35 | 90 | 38,89% | 40 | 100 | 40,00% | +1,1 | +14,3% |", self.txt)
        self.assertIn("| BAND | 350 | 710 | 49,30% | 352 | 820 | 42,93% | -6,4 | +0,6% |", self.txt)

    def test_custo_e_payload(self):
        self.assertIn("O gerador precisaria de 4 grupos de consultas", self.txt)
        self.assertIn("gerar.py hoje: ~64 s", self.txt)
        self.assertIn('`{"MES_LABEL": "Setembro/26", "DIA_UTIL": 13, "TOTAL_DIAS_UTEIS": 21, "DATA_CORTE": "2026-09-20"',
                      self.txt)
        self.assertRegex(self.txt, r"\| 5 macros \+ 13 coberturas \| 7 \| \d+,\d KB \| sem o payload publicado para comparar \|")
        self.assertRegex(self.txt, r"\| só os 5 macros \| 7 \| \d+,\d KB \|")
        self.assertIn("Payload publicado (`frontend/data/payload.json` do checkout): não encontrado.", self.txt)

    def test_peso_contra_o_limite_de_8_mb(self):
        with tempfile.TemporaryDirectory() as pasta:
            base = Path(pasta) / "payload.json"
            with base.open("wb") as f:
                f.truncate(6_600_000)
            txt = _e10(ConsultaE10(FATOS, METAS), payload_base=base)
            self.assertIn("Payload publicado (`frontend/data/payload.json` do checkout): 6,60 MB.", txt)
            self.assertRegex(txt, r"\| 5 macros \+ 13 coberturas \| 7 \| [\d,]+ KB \| 6,60 MB \|")
            self.assertNotIn("acima do limite", txt)
            with base.open("wb") as f:
                f.truncate(7_999_800)
            txt = _e10(ConsultaE10(FATOS, METAS), payload_base=base)
            self.assertIn("8,00 MB **(acima do limite de atenção de 8 MB)**", txt)

    def test_riscos(self):
        self.assertIn("**Rotas que mudaram de gerência** (gerência da meta, `DS_GERENCIA_COM_Chave_Meta_SAP`, em "
                      "Setembro/26 x hoje): 1: A12 G1 → AP.", self.txt)
        self.assertIn("**Rotas com meta de volume em Setembro/26 fora do painel de hoje**: 1 (A19); META_VOLUME de "
                      "Refrigerantes delas: 30", self.txt)
        self.assertIn("**Rotas do painel sem meta de volume em Setembro/26** (novas?): 2 (151, I12); Real de Setembro/26 "
                      "até o corte nelas (Refrigerantes): 25", self.txt)
        self.assertIn("rotas EV* 15 (5 macros; entram na rota oculta da gerência comercial, como no gerador: 15); outras "
                      "rotas 5 (Z99).", self.txt)
        self.assertIn("| G1 | 170 | 140 | -30 |", self.txt)                      # cliente da 111 com a meta na A11
        self.assertIn("| AP | 85 | 115 | 30 |", self.txt)
        self.assertNotIn("| IT | 85 |", self.txt)                                # I12 -> I11: mesma gerência
        for n in range(1, 8):
            self.assertIn(f"\n{n}. ", self.txt)

    def test_sem_nomes_nem_codigos_de_clientes(self):
        for v in ["9100001", "9200003", "9500001", "910000"] + NOMES + ["Boteco", "Distribuidor", "Mercearia"]:
            self.assertNotIn(v, self.txt)
        self.assertNotIn("None", self.txt)


class TestSecaoE10Casos(unittest.TestCase):
    def test_cobertura_que_ignora_o_corte(self):
        txt = _e10(ConsultaE10(FATOS, METAS, ignora_data={CM.COB_MES}))
        self.assertIn("**não**: igual ao mês inteiro (filtro ignorado?); amostra: 5 x 5 clientes x item no mês", txt)
        self.assertIn("sim (bate com a curva diária)", txt)                      # o volume continua com o corte

    def test_consulta_com_erro_nao_derruba_a_secao(self):
        def falha(sel, f):
            return CM.NF_STATUS in sel and f"{CM.DATA} le" in (f or "")
        txt = _e10(ConsultaE10(FATOS, METAS, falha=falha))
        self.assertEqual(txt.count("**erro**: `RuntimeError: HTTP 500 (simulado)`"), 2)   # por rota do cliente e da meta
        self.assertIn("| G1 | Refrigerantes | — | — | — | 110 | — | 160 | 330 | 48,48% | — | — |", txt)
        self.assertIn("### E10f.", txt)

    def test_sem_a_gerencia_da_meta(self):
        txt = _e10(ConsultaE10(FATOS, METAS, sem_gc_meta=True))
        self.assertIn("| gerência da meta por rota, Setembro/26 | `DS_GERENCIA_COM_Chave_Meta_SAP` | não | coluna fora do "
                      "$metadata |", txt)
        self.assertIn("fora do $metadata (ou a consulta falhou): sem a gerência da meta por mês.", txt)

    def test_fechamento(self):
        linhas = _cal_linhas(2026, 9) + _cal_linhas(2026, 10)
        cal = calmod.com_data_ontem(calmod.fechado(date(2026, 11, 3), date(2026, 10, 1), 21), linhas)
        cons = ConsultaE10(FATOS, METAS)
        txt = _e10(cons, _estado(cal), hoje=date(2026, 11, 3))
        self.assertIn("Mês de referência Outubro/26 (202610, fechado) contra Setembro/26 (202609)", txt)
        self.assertIn("Caso de hoje: **fechamento (o mês fechado contra o anterior a ele)**.", txt)
        self.assertIn("| data de corte (inclusive) | o mês até agora (Vol Real do painel) | 30/09/2026 (quarta-feira) |", txt)
        self.assertIn("| G1 | Refrigerantes | 220 | 300 | 73,33% |", txt)            # setembro inteiro: 100 + 50 + 30 + 40
        self.assertNotIn(">= hoje", txt)                                          # nada de NF de hoje no mês fechado
        self.assertTrue(any("DATA_MOVIMENTO le 2026-09-30" in (ch[2] or "") for ch in cons.chamadas))

    def test_sem_dia_util_fechado(self):
        linhas = _cal_linhas(2026, 9) + _cal_linhas(2026, 10)
        cons = ConsultaE10(FATOS, METAS)
        txt = _e10(cons, _estado(calmod.do_datasphere(linhas, date(2026, 10, 1))), hoje=date(2026, 10, 1))
        self.assertIn("Caso de hoje: **sem dia útil fechado**.", txt)
        self.assertIn("**Sem dia útil fechado em Outubro/26**: nada a comparar", txt)
        self.assertFalse(any("202609" in (ch[2] or "") for ch in cons.chamadas))
        self.assertNotIn("E10b.", txt)


class TestE10NoRelatorio(unittest.TestCase):
    def test_aparece_sem_erro_no_relatorio_completo(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            txt = ct.conferir(ConsultaFalsa(DADOS), date(2026, 10, 13), payload_base=None)[0].texto("E10")
        self.assertNotIn("ERRO", txt)
        for t in ["## E10. Mês anterior no mesmo dia útil", "E10a.", "E10b.", "E10c.", "E10d.", "E10e.", "E10f."]:
            self.assertIn(t, txt)
        self.assertLess(txt.index("## E8."), txt.index("## E10."))
        self.assertLess(txt.index("## E10."), txt.index("## 9."))
        self.assertIn("dias úteis de Setembro/26 pelo **cálculo local", txt)      # o calendário simulado só tem outubro
        for v in ["1007382", "1011537", "Piratas", "WARLEY", "Marcos Neves"]:
            self.assertNotIn(v, txt)


if __name__ == "__main__":
    unittest.main()
