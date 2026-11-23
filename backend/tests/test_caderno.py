"""
Caderno de Vendas, Frente 2 (19/11/2026): as chaves opcionais PRE_VENDA e MES_ANT_CHEIO do payload
(gerador/caderno.py), a validação delas e a seção E14 do conferir_tendencia.py.

Decisões da Karen de 19/11/2026: a pré-venda é do último dia útil FECHADO, que é o DATA_ONTEM do próprio payload
(nunca o relógio da máquina nem "hoje - 1"); o volume dela vai pela rota da META e a cobertura pela rota em que a
venda foi faturada; a pré-venda de cobertura é "quem COMPROU o item naquele dia", não "quem entrou na cobertura
naquele dia"; o mês anterior INTEIRO é um valor novo, a mais — a chave MES_ANTERIOR não muda.

Cenário: o sintético dos testes de front (códigos e nomes fictícios) com o dia 09/10/2026 e setembro/26 respondidos
por um Datasphere simulado (ConsultaE10). Nenhum nome ou código de cliente real.
"""
import contextlib
import copy
import io
import math
import sys
import time
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock

from gerador import caderno, fontes
from gerador import mapeamento as M
from gerador.payload import montar_payload
from gerador.saida import serializar
from gerador.validacao import CHAVES_PAYLOAD, validar_payload
from tests.test_fontes import ConsultaFalsa
from tests.test_mes_anterior import ConsultaE10, ct

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "frontend" / "tests"))
import sintetico  # noqa: E402

CM = M.ColMeta
OUT, SET = "202610", "202609"
DIA = "2026-10-09"                                     # DATA_ONTEM do sintético em 13/10/2026 (7º dia útil)
AGORA = datetime(2026, 10, 13, 10, 30)
REFRI, CERV, DVF = "VOL REFRIGERANTES", "VOL CERVEJAS", "VOL DEL VALLE FRUT"
NORMAL, OUTRA, NEUTRALIZA, VIRTUAL, OCULTA = "G111", "G112", "151", "A42", "SL-EV"


def _nf(anomes, dia, rota, vol, ag="Refrigerantes", status="Acertado", gc="Gc. G1", gcc=None, meta_rota=None):
    """Linha de NF (volume). `meta_rota` = CD_ROTA_Chave_Meta_SAP ('--' = venda sem chave de meta)."""
    return {CM.ANOMES: anomes, CM.DATA: dia, CM.ROTA: rota, CM.CLIENTE: "0000000001", CM.AGRUPADOR: ag,
            CM.NF_STATUS: status, CM.VOL_MES: vol, CM.GC: gc, CM.GC_COMERCIAL: gcc,
            CM.META_ROTA: rota if meta_rota is None else meta_rota}


def _cb(anomes, dia, rota, pv, ag="Cctm 2l Pet", cob=1, gc="Gc. G1", gcc=None, seg="Boteco", status="Acertado"):
    """Linha de cobertura (FX_COBERTURA_REALIZADO por rota x cliente x agrupador)."""
    return {CM.ANOMES: anomes, CM.DATA: dia, CM.ROTA: rota, CM.CLIENTE: f"{pv:010d}", CM.AGRUPADOR: ag,
            CM.COB_MES: cob, CM.GC: gc, CM.GC_COMERCIAL: gcc, CM.SEGMENTO: seg, CM.NF_STATUS: status}


# ---------------------------------------------------------------- agregações puras
class TestAgregacoes(unittest.TestCase):
    def test_volume_pela_rota_da_meta_ignora_venda_sem_chave(self):
        linhas = [_nf(OUT, DIA, NORMAL, 10), _nf(OUT, DIA, NORMAL, 5, status="Cancelada"),
                  _nf(OUT, DIA, "EV1", 7, meta_rota=NORMAL),          # a meta é da G111: conta lá
                  _nf(OUT, DIA, "EV2", 3, meta_rota="--", gcc="Gc. Ap"),   # sem chave de meta: fora (como o SAC)
                  _nf(OUT, DIA, "EV5", 4, meta_rota="EV5", gcc="Gc. Ap"),  # rota da meta EV*: vai para a oculta
                  _nf(OUT, DIA, NORMAL, 2, ag="Del Valle Frut")]
        por_rota, ev = caderno.real_por_rota(linhas, CM.META_ROTA)
        self.assertEqual(por_rota[NORMAL], {REFRI: 17.0, DVF: 2.0})     # 10 + 7; a cancelada fica fora
        self.assertEqual(ev, {"AP": {REFRI: 4.0}})
        self.assertNotIn("EV2", por_rota)

    def test_volume_pela_rota_do_cliente_e_a_regra_da_mes_anterior(self):
        linhas = [_nf(SET, "2026-09-02", NORMAL, 10),
                  _nf(SET, "2026-09-02", "EV1", 7, gcc="Gc. Sl", meta_rota=NORMAL),
                  _nf(SET, "2026-09-02", "EV2", 3, gcc="Gc. Sl", meta_rota="--")]
        por_rota, ev = caderno.real_por_rota(linhas, CM.ROTA)
        self.assertEqual(por_rota[NORMAL], {REFRI: 10.0})
        self.assertEqual(por_rota["EV1"], {REFRI: 7.0})                 # fica na rota EV*, que some do payload
        self.assertEqual(ev, {"SL": {REFRI: 7.0}})                      # a EV2 (sem chave de meta) não entra

    def test_cobertura_conta_por_rota_da_venda_e_junta_as_ev(self):
        linhas = [_cb(OUT, DIA, NORMAL, 1), _cb(OUT, DIA, NORMAL, 1, ag="Cervejas"),
                  _cb(OUT, DIA, NORMAL, 2, cob=0),                      # não comprou o item no dia
                  _cb(OUT, DIA, "EV1", 9, gcc="Gc. Sl", seg="Lanchonete"),
                  _cb(OUT, DIA, "EV1", 8, gcc="--")]                    # sem gerência comercial do painel: fora
        cob, ev, segs = caderno.cobertos_por_rota(linhas)
        self.assertEqual(cob[NORMAL], {"CCTM 2L PET": {1}, "CERVEJAS": {1}})
        self.assertEqual(ev, {"SL": {"CCTM 2L PET": {9}}})
        self.assertEqual(segs[9], "Lanchonete")

    def test_os_itens_e_agrupadores_do_caderno(self):
        self.assertEqual(M.INDICADORES_CADERNO_VOL, M.INDICADORES_VOLUME + ["VOL DEL VALLE FRUT"])
        self.assertEqual(len(M.INDICADORES_CADERNO_COB), 16)
        self.assertEqual(M.INDICADORES_CADERNO_COB[-3:], M.INDICADORES_INCENTIVO)
        self.assertEqual(M.AGRUPADORES_CADERNO_COB[-3:], ["Heineken", "Eisenbahn - 600ml", "Heineken - 600ml"])


# ---------------------------------------------------------------- as chaves
def _dados(vol=None, cob=None, vol_ev=None, cob_ev=None, segs=None, erro_pre=None, erro_cheio=None):
    pre = caderno.Bloco(erro=erro_pre) if erro_pre else caderno.Bloco(vol or {}, vol_ev or {}, cob or {},
                                                                      cob_ev or {}, segs or {})
    cheio = caderno.Bloco(erro=erro_cheio) if erro_cheio else caderno.Bloco(dict(vol or {}), dict(vol_ev or {}),
                                                                           dict(cob or {}), dict(cob_ev or {}),
                                                                           dict(segs or {}))
    return caderno.Dados(date(2026, 10, 9), date(2026, 9, 1), 21, pre, cheio)


def _sem_filtro(_r, por_ind, _segs):
    return {k: set(v) for k, v in por_ind.items()}


TUDO = set(M.INDICADORES_CADERNO_VOL) | set(M.INDICADORES_CADERNO_COB)


class TestChaves(unittest.TestCase):
    def test_forma_e_ordem(self):
        d = _dados(vol={NORMAL: {REFRI: 12.34}}, cob={NORMAL: {"CCTM 2L PET": {1, 2}}})
        pre, cheio, avisos = caderno.chaves(d, [NORMAL], {}, {NORMAL: TUDO}, _sem_filtro)
        self.assertEqual(avisos, [])
        self.assertEqual(list(pre), ["DATA", "IND_VOL", "IND_COB", "ROTAS"])
        self.assertEqual(list(cheio), ["MES_LABEL", "TOTAL_DIAS_UTEIS", "IND_VOL", "IND_COB", "ROTAS"])
        self.assertEqual(pre["DATA"], "2026-10-09")
        self.assertEqual((cheio["MES_LABEL"], cheio["TOTAL_DIAS_UTEIS"]), ("Setembro/26", 21))
        self.assertEqual(pre["IND_VOL"], M.INDICADORES_CADERNO_VOL)
        self.assertEqual(pre["IND_COB"], M.INDICADORES_CADERNO_COB)
        self.assertEqual(pre["ROTAS"][NORMAL]["v"][0], 12.3)            # 1 casa, como o Vol Real
        self.assertEqual(pre["ROTAS"][NORMAL]["c"][0], 2)               # clientes distintos
        self.assertEqual(pre["ROTAS"][NORMAL]["v"][1:], [0.0] * 5)      # sem venda no dia = 0, não null

    def test_null_onde_a_rota_nao_tem_o_indicador(self):
        d = _dados(vol={NORMAL: {REFRI: 5.0, CERV: 9.0}}, cob={NORMAL: {"CCTM 2L PET": {1}}})
        pre, _, _ = caderno.chaves(d, [NORMAL], {}, {NORMAL: {REFRI, "CCTM 2L PET"}}, _sem_filtro)
        v, c = pre["ROTAS"][NORMAL]["v"], pre["ROTAS"][NORMAL]["c"]
        self.assertEqual(v[0], 5.0)
        self.assertTrue(all(x is None for x in v[1:]))                  # Cervejas indisponível: null, não 9,0
        self.assertEqual(c[0], 1)
        self.assertTrue(all(x is None for x in c[1:]))

    def test_todas_as_rotas_do_payload_na_ordem_e_a_oculta_das_ev(self):
        rotas = [NORMAL, NEUTRALIZA, VIRTUAL, OCULTA]
        d = _dados(vol={NORMAL: {REFRI: 1.0}}, vol_ev={"SL": {REFRI: 8.0}},
                   cob_ev={"SL": {"CCTM 2L PET": {4, 5}}})
        pre, _, _ = caderno.chaves(d, rotas, {OCULTA: "SL"}, {r: TUDO for r in rotas}, _sem_filtro)
        self.assertEqual(list(pre["ROTAS"]), rotas)
        self.assertEqual(pre["ROTAS"][OCULTA]["v"][0], 8.0)             # o Real das EV* da gerência comercial
        self.assertEqual(pre["ROTAS"][OCULTA]["c"][0], 2)
        self.assertEqual(pre["ROTAS"][NEUTRALIZA]["v"][0], 0.0)

    def test_ks_tt_passa_pelo_filtro_de_segmento(self):
        d = _dados(cob={NORMAL: {"KS TT": {1, 2}, "CERVEJAS": {1, 2}}}, segs={1: "Boteco", 2: "Super"})

        def filtra(r, por_ind, segs):
            from gerador.texto import normalizar
            return {k: {pv for pv in pvs if normalizar(segs.get(pv)) in M.SEGMENTOS_KS_TT} if k == "KS TT" else set(pvs)
                    for k, pvs in por_ind.items()}

        pre, _, _ = caderno.chaves(d, [NORMAL], {}, {NORMAL: TUDO}, filtra)
        i_ks = M.INDICADORES_CADERNO_COB.index("KS TT")
        i_cerv = M.INDICADORES_CADERNO_COB.index("CERVEJAS")
        self.assertEqual(pre["ROTAS"][NORMAL]["c"][i_ks], 1)            # só o Boteco
        self.assertEqual(pre["ROTAS"][NORMAL]["c"][i_cerv], 2)

    def test_bloco_com_erro_so_derruba_a_chave_dele(self):
        d = _dados(vol={NORMAL: {REFRI: 1.0}}, erro_pre="consulta de volume falhou (RuntimeError: HTTP 500)")
        pre, cheio, avisos = caderno.chaves(d, [NORMAL], {}, {NORMAL: TUDO}, _sem_filtro)
        self.assertIsNone(pre)
        self.assertIsNotNone(cheio)
        self.assertEqual(len(avisos), 1)
        self.assertTrue(avisos[0].startswith(f"{M.CHAVE_PRE_VENDA} fora do payload:"), avisos)

    def test_valor_negativo_ou_nao_finito_tira_a_chave(self):
        for valor in (-3.0, float("nan"), float("inf")):
            d = _dados(vol={NORMAL: {REFRI: valor}})
            pre, _, avisos = caderno.chaves(d, [NORMAL], {}, {NORMAL: TUDO}, _sem_filtro)
            self.assertIsNone(pre, valor)
            self.assertTrue(any("negativo ou inválido" in a for a in avisos), avisos)


# ---------------------------------------------------------------- consultas (Datasphere simulado)
FATOS = [
    # outubro: o dia da pré-venda (09/10) e um dia antes, que não pode entrar
    _nf(OUT, DIA, NORMAL, 100), _nf(OUT, "2026-10-08", NORMAL, 999),
    _nf(OUT, DIA, NORMAL, 7, ag="Cervejas"), _nf(OUT, DIA, NORMAL, 4, ag="Del Valle Frut"),
    _nf(OUT, DIA, NORMAL, 50, status="Cancelada"),
    _cb(OUT, DIA, NORMAL, 1), _cb(OUT, "2026-10-08", NORMAL, 2),
    _cb(OUT, DIA, NORMAL, 3, ag="Heineken"),
    # setembro inteiro
    _nf(SET, "2026-09-02", NORMAL, 10), _nf(SET, "2026-09-25", NORMAL, 20),
    _cb(SET, "2026-09-02", NORMAL, 1), _cb(SET, "2026-09-25", NORMAL, 4),
]


class TestConsultas(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cons = ConsultaE10(FATOS, [])

    def test_pre_venda_de_volume_so_do_dia_e_pela_rota_da_meta(self):
        linhas = caderno.consulta_volume(self.cons, OUT, ["Gc. G1"], CM.META_ROTA, date(2026, 10, 9))
        por_rota, _ = caderno.real_por_rota(linhas, CM.META_ROTA)
        self.assertEqual(por_rota[NORMAL], {REFRI: 100.0, CERV: 7.0, DVF: 4.0})   # sem o dia 08 e sem a cancelada
        sel, filtro = self.cons.chamadas[-1][1], self.cons.chamadas[-1][2]
        self.assertNotIn(CM.DATA, sel)                                 # a data SÓ no $filter, nunca no groupby
        self.assertIn("DATA_MOVIMENTO eq 2026-10-09", filtro)
        self.assertEqual(sel[0], CM.META_ROTA)
        self.assertIn("'Del Valle Frut'", filtro)

    def test_pre_venda_de_cobertura_sem_nf_cancelada_e_com_os_16_itens(self):
        linhas = caderno.consulta_cobertura(self.cons, OUT, ["Gc. G1"], date(2026, 10, 9))
        cob, _, _ = caderno.cobertos_por_rota(linhas)
        self.assertEqual(cob[NORMAL], {"CCTM 2L PET": {1}, "INC HEINEKEN": {3}})
        filtro = self.cons.chamadas[-1][2]
        self.assertIn(M.FILTRO_SEM_NF_CANCELADA, filtro)
        self.assertIn("'Heineken'", filtro)
        self.assertIn("DATA_MOVIMENTO eq 2026-10-09", filtro)
        self.assertNotIn(CM.DATA, self.cons.chamadas[-1][1])

    def test_mes_anterior_inteiro_nao_tem_filtro_de_data(self):
        linhas = caderno.consulta_volume(self.cons, SET, ["Gc. G1"], CM.ROTA)
        por_rota, _ = caderno.real_por_rota(linhas, CM.ROTA)
        self.assertEqual(por_rota[NORMAL][REFRI], 30.0)                # 10 + 20: o mês inteiro, sem corte
        self.assertNotIn("DATA_MOVIMENTO", self.cons.chamadas[-1][2])
        cob, _, _ = caderno.cobertos_por_rota(caderno.consulta_cobertura(self.cons, SET, ["Gc. G1"]))
        self.assertEqual(cob[NORMAL]["CCTM 2L PET"], {1, 4})
        self.assertNotIn("DATA_MOVIMENTO", self.cons.chamadas[-1][2])


# ---------------------------------------------------------------- payload completo (sintético + simulado)
# no payload completo, a cobertura do dia tem de ser subconjunto da do mês (é o que a validação exige): a linha de
# Heineken acima só existe no simulado, então fica fora do cenário do payload
FATOS_PAYLOAD = [l for l in FATOS if l.get(CM.AGRUPADOR) != "Heineken"]


class ComCaderno(ConsultaFalsa):
    """O sintético (mês de hoje) + o dia da pré-venda e setembro/26 pelo ConsultaE10."""

    def __init__(self, dados, fatos=FATOS_PAYLOAD, falha_dia=False, falha_set=False, atraso=0.0):
        super().__init__(dados)
        self.simulado = ConsultaE10(fatos, [])
        self.falha_dia, self.falha_set, self.atraso = falha_dia, falha_set, atraso
        self.chamadas_cad = []

    def _do_caderno(self, select, filtro):
        f = filtro or ""
        if CM.META_RECUPERAVEL in select or CM.META_NEG in select or CM.META_COBERTURA in select:
            return None                                  # meta do dia, Neg de hoje e metas: do sintético
        if f"'{SET}'" in f:
            return "set"
        if f"{CM.DATA} eq " in f and (CM.NF_STATUS in select or CM.COB_MES in select):
            return "dia"
        return None

    def linhas(self, objeto, select, filtro=None, top=None, orderby=None):
        qual = self._do_caderno(select, filtro) if objeto == M.OBJ_META and top is None else None
        if qual is None:
            return super().linhas(objeto, select, filtro, top, orderby)
        self.chamadas_cad.append((qual, tuple(select), filtro))
        if self.atraso:
            time.sleep(self.atraso)
        if (qual == "dia" and self.falha_dia) or (qual == "set" and self.falha_set):
            raise RuntimeError("HTTP 500 (simulado)")
        return self.simulado.linhas(objeto, select, filtro, top, orderby)


def _carrega(cons, agora=AGORA):
    with contextlib.redirect_stderr(io.StringIO()):
        f = fontes.carregar(cons, agora)
        return f, montar_payload(f)


class TestChavesNoPayload(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cons = ComCaderno(sintetico.dados(False))
        cls.f, cls.p = _carrega(cls.cons)

    def test_as_duas_ultimas_chaves_sao_opcionais(self):
        self.assertEqual(list(self.p)[-2:], [M.CHAVE_PRE_VENDA, M.CHAVE_MES_ANT_CHEIO])
        self.assertEqual(list(self.p)[-3], M.CHAVE_MES_ANTERIOR)
        for k in (M.CHAVE_PRE_VENDA, M.CHAVE_MES_ANT_CHEIO):
            self.assertNotIn(k, CHAVES_PAYLOAD)

    def test_a_data_da_pre_venda_e_a_do_payload(self):
        self.assertEqual(self.p[M.CHAVE_PRE_VENDA]["DATA"], self.p["DATA_ONTEM"])
        self.assertEqual(self.p["DATA_ONTEM"], DIA)                     # último dia útil FECHADO, não "hoje - 1"
        self.assertNotEqual(self.p[M.CHAVE_PRE_VENDA]["DATA"], "2026-10-12")

    def test_mesmas_rotas_do_payload_na_ordem(self):
        rotas = [r for svs in self.p["DATA"].values() for rs in svs.values() for r in rs]
        for k in (M.CHAVE_PRE_VENDA, M.CHAVE_MES_ANT_CHEIO):
            self.assertEqual(list(self.p[k]["ROTAS"]), rotas)
            tamanhos = {(len(v["v"]), len(v["c"])) for v in self.p[k]["ROTAS"].values()}
            self.assertEqual(tamanhos, {(6, 16)})

    def test_valores_do_dia_e_do_mes_anterior_inteiro(self):
        pre, cheio = self.p[M.CHAVE_PRE_VENDA]["ROTAS"][NORMAL], self.p[M.CHAVE_MES_ANT_CHEIO]["ROTAS"][NORMAL]
        self.assertEqual(pre["v"][0], 100.0)                            # só o dia 09/10, sem a NF cancelada
        self.assertEqual(pre["c"][0], 1)                                # quem comprou CCTM 2L Pet NO DIA
        self.assertEqual(cheio["v"][0], 30.0)                           # setembro inteiro (10 + 20)
        self.assertEqual(cheio["c"][0], 2)
        self.assertEqual(self.p[M.CHAVE_MES_ANT_CHEIO]["MES_LABEL"], "Setembro/26")

    def test_a_chave_mes_anterior_nao_mudou(self):
        """O mês anterior INTEIRO é um valor novo, a mais: a MES_ANTERIOR continua até o corte."""
        ma = self.p[M.CHAVE_MES_ANTERIOR]
        self.assertEqual(ma["IND"], M.INDICADORES_VOLUME)
        self.assertEqual(ma["DATA_CORTE"], "2026-09-10")
        self.assertLessEqual(ma["ROTAS"][NORMAL][0][0], self.p[M.CHAVE_MES_ANT_CHEIO]["ROTAS"][NORMAL]["v"][0])

    def test_tempos_e_validacao(self):
        self.assertIn("caderno_s", self.f.tempos)
        self.assertIn("caderno_espera_s", self.f.tempos)
        erros, avisos = validar_payload(self.p)
        self.assertEqual(erros, [])
        self.assertFalse([a for a in avisos if "PRE_VENDA" in a or "MES_ANT_CHEIO" in a], avisos)

    def test_tamanho(self):
        for k in (M.CHAVE_PRE_VENDA, M.CHAVE_MES_ANT_CHEIO):
            self.assertLess(len(serializar({k: self.p[k]})), 100_000)
        # pior caso realista: 250 rotas com os 6 volumes de 7 dígitos e as 16 coberturas de 3
        grande = dict(self.p[M.CHAVE_PRE_VENDA],
                      ROTAS={f"R{i:03d}": {"v": [1234567.8] * 6, "c": [999] * 16} for i in range(250)})
        self.assertLess(len(serializar({M.CHAVE_PRE_VENDA: grande})), 300_000)

    def test_consultas_do_caderno(self):
        dia = [c for c in self.cons.chamadas_cad if c[0] == "dia"]
        setembro = [c for c in self.cons.chamadas_cad if c[0] == "set"]
        # 1 consulta de volume (inteira) + 1 de cobertura por gerência de origem (como fontes.carregar_vendas)
        self.assertGreaterEqual(len(dia), 2)
        self.assertEqual(len([c for c in dia if CM.NF_STATUS in c[1]]), 1)
        self.assertTrue(all("DATA_MOVIMENTO eq 2026-10-09" in c[2] for c in dia))
        self.assertTrue(all(CM.DATA not in c[1] for c in self.cons.chamadas_cad))
        self.assertTrue(any(c[1][0] == CM.META_ROTA for c in dia))      # volume pela rota da meta
        self.assertTrue(any(c[1][0] == CM.ROTA and CM.COB_MES in c[1] for c in dia))   # cobertura pela rota da venda
        self.assertTrue(all("DATA_MOVIMENTO" not in c[2] for c in setembro if CM.COB_MES in c[1]))


class TestFalhaETempo(unittest.TestCase):
    def test_falha_do_dia_so_tira_a_pre_venda(self):
        f, p = _carrega(ComCaderno(sintetico.dados(False), falha_dia=True))
        self.assertNotIn(M.CHAVE_PRE_VENDA, p)
        self.assertIn(M.CHAVE_MES_ANT_CHEIO, p)
        self.assertTrue(any(a.startswith(f"{M.CHAVE_PRE_VENDA} fora do payload:") for a in f.avisos), f.avisos)
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])                                     # nunca reprova a rodada
        self.assertTrue(any(f"{M.CHAVE_PRE_VENDA} ausente" in a for a in avisos), avisos)

    def test_falha_do_mes_anterior_so_tira_o_mes_cheio(self):
        f, p = _carrega(ComCaderno(sintetico.dados(False), falha_set=True))
        self.assertIn(M.CHAVE_PRE_VENDA, p)
        self.assertNotIn(M.CHAVE_MES_ANT_CHEIO, p)
        self.assertEqual(validar_payload(p)[0], [])

    def test_passou_do_limite_tira_as_duas_sem_esperar(self):
        cons = ComCaderno(sintetico.dados(False), atraso=3.0)
        inicio = time.monotonic()
        with mock.patch.object(M, "CADERNO_LIMITE_S", 0.3), mock.patch.object(M, "MES_ANTERIOR_LIMITE_S", 0.3):
            f, p = _carrega(cons)
        self.assertLess(time.monotonic() - inicio, 2.5)                 # não esperou as consultas lentas
        self.assertNotIn(M.CHAVE_PRE_VENDA, p)
        self.assertNotIn(M.CHAVE_MES_ANT_CHEIO, p)
        self.assertTrue(any("passaram de" in a and "Caderno" in a for a in f.avisos), f.avisos)
        self.assertEqual(validar_payload(p)[0], [])

    def test_threads_daemon(self):
        """Uma consulta presa não segura o fim do processo (ThreadPoolExecutor seguraria)."""
        carga = caderno.Carga(ComCaderno(sintetico.dados(False), atraso=5.0), date(2026, 10, 9), OUT,
                              date(2026, 9, 1), 21, ["Gc. G1"], None, limite_s=0.2)
        dados, avisos = carga.resultado()
        self.assertIsNone(dados)
        self.assertTrue(avisos)
        self.assertTrue(all(t.daemon for t in __import__("threading").enumerate() if t.name.startswith("caderno")))


# ---------------------------------------------------------------- validação
def _payload_com(p, chave, rota, campo, i, valor):
    novo = copy.deepcopy(p)
    novo[chave]["ROTAS"][rota][campo][i] = valor
    return novo


class TestValidacao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = _carrega(ComCaderno(sintetico.dados(False)))[1]

    def test_sem_as_chaves_so_avisa(self):
        p = {k: v for k, v in self.p.items() if k not in (M.CHAVE_PRE_VENDA, M.CHAVE_MES_ANT_CHEIO)}
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertEqual(len([a for a in avisos if "ausente" in a and ("PRE_VENDA" in a or "MES_ANT_CHEIO" in a)]), 2)

    def test_valor_nao_finito_ou_negativo_e_erro(self):
        for valor, texto in ((float("nan"), "não finito"), (-1.0, "negativo")):
            p = _payload_com(self.p, M.CHAVE_PRE_VENDA, NORMAL, "v", 0, valor)
            erros, _ = validar_payload(p)
            self.assertTrue(any(texto in e and M.CHAVE_PRE_VENDA in e for e in erros), (valor, erros))

    def test_volume_do_dia_maior_que_o_mes_avisa(self):
        p = copy.deepcopy(self.p)
        for r in p[M.CHAVE_PRE_VENDA]["ROTAS"]:
            if p[M.CHAVE_PRE_VENDA]["ROTAS"][r]["v"][0] is not None:
                p[M.CHAVE_PRE_VENDA]["ROTAS"][r]["v"][0] = 9_000_000.0
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertTrue(any("volume do dia maior que o Vol Real do mês" in a for a in avisos), avisos)

    def test_cobertura_do_dia_maior_que_a_do_mes_avisa(self):
        p = _payload_com(self.p, M.CHAVE_PRE_VENDA, NORMAL, "c", 0, 9999)
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertTrue(any("cobertura do dia maior que a do mês" in a for a in avisos), avisos)

    def test_volume_zerado_na_band_avisa(self):
        p = copy.deepcopy(self.p)
        for r, vals in p[M.CHAVE_MES_ANT_CHEIO]["ROTAS"].items():
            vals["v"] = [None if x is None else 0.0 for x in vals["v"]]
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertTrue(any(f"{M.CHAVE_MES_ANT_CHEIO}: volume da BAND = 0" in a for a in avisos), avisos)

    def test_payload_sem_nan_no_json(self):
        bruto = serializar(self.p)
        self.assertNotIn(b"NaN", bruto)
        self.assertTrue(all(math.isfinite(x) for v in self.p[M.CHAVE_PRE_VENDA]["ROTAS"].values()
                            for x in v["v"] + v["c"] if x is not None))


# ---------------------------------------------------------------- seção E14 do relatório
class TestE14NoRelatorio(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cons = ComCaderno(sintetico.dados(False))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            rel, _ = ct.conferir(cons, date(2026, 10, 13), payload_base=None)
        cls.txt = rel.texto("teste")
        cls.e14 = cls.txt[cls.txt.index("## E14."):]

    def test_a_secao_sai_sem_erro(self):
        self.assertIn("## E14. Pré-venda do último dia útil fechado", self.txt)
        for t in ("E14a.", "E14b.", "E14c.", "E14d.", "E14e."):
            self.assertIn(t, self.e14)
        self.assertNotIn("**ERRO em E14", self.txt)

    def test_explica_as_duas_armadilhas(self):
        self.assertIn("nunca o relógio da máquina", self.e14)
        self.assertIn("naquele dia", self.e14)
        self.assertIn("rota da meta", self.e14)

    def test_o_del_valle_frut_nao_sai_zerado(self):
        """A E14a soma os 6 indicadores de volume: `soma_por_gc` só conhece os 5 macros e zerava o Del Valle Frut."""
        por_rota = {NORMAL: {REFRI: 10.0, DVF: 4.0}, "fora": {DVF: 99.0}}
        soma = ct.soma_vol_gc(por_rota, {NORMAL: "G1"}, M.INDICADORES_CADERNO_VOL)
        self.assertEqual(soma, {"G1": {REFRI: 10.0, DVF: 4.0}})         # a rota fora do painel não entra
        band = ct.com_band_num(soma, ["G1"], M.INDICADORES_CADERNO_VOL)
        self.assertEqual(band["BAND"][DVF], 4.0)
        self.assertEqual(band["G1"]["VOL STILL"], 0.0)                  # sem dado = 0, não KeyError

    def test_sem_nome_nem_codigo_de_cliente(self):
        base = sintetico.dados(False)[M.OBJ_BASE_CLIENTE]
        nomes = {str(l[M.ColBase.NOME]).upper() for l in base if l.get(M.ColBase.NOME)}
        pvs = {str(int(l[M.ColBase.CLIENTE])) for l in base if l.get(M.ColBase.CLIENTE)}
        self.assertTrue(nomes and pvs)
        alto = self.e14.upper()
        self.assertFalse([n for n in nomes if n in alto])
        self.assertFalse([pv for pv in pvs if len(pv) >= 5 and pv in self.e14])


if __name__ == "__main__":
    unittest.main()
