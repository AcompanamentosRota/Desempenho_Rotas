"""
Chave MES_ANTERIOR do payload (Etapa 8b, só Volume; gerador/mes_anterior.py) e a seção E11 do conferir_tendencia.py.
Decisões da Karen de 21/10/2026: dia útil limitado ao total do mês anterior; fechamento x fechamento (o anterior
inteiro); Real pela rota atual do cliente, as EV* na rota oculta "{GC}-EV"; meta do mês anterior inteiro (META_VOLUME
da rota da meta; sem ela, META_NEG); só os 5 macros. Cenário: o sintético dos testes de front (códigos e nomes fictícios)
com setembro/26 respondido por um Datasphere simulado (ConsultaE10).
"""
import contextlib
import copy
import io
import json
import math
import sys
import tempfile
import time
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock

from gerador import calendario as calmod
from gerador import fontes
from gerador import mapeamento as M
from gerador import mes_anterior as MA
from gerador.payload import montar_payload
from gerador.saida import serializar
from gerador.validacao import CHAVES_PAYLOAD, validar_payload
from tests.test_fontes import ConsultaFalsa
from tests.test_mes_anterior import ConsultaE10, ct

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "frontend" / "tests"))
import sintetico  # noqa: E402

CM = M.ColMeta
SET = "202609"
REFRI, CERV, STILL = "VOL REFRIGERANTES", "VOL CERVEJAS", "VOL STILL"
NORMAL, SEM_META, SO_NEG = "G111", "G112", "G121"      # G1: META_VOLUME; sem meta em setembro; só META_NEG
NEUTRALIZA, VIRTUAL, OCULTA = "151", "A42", "SL-EV"


def _nf(dia, rota, vol, ag="Refrigerantes", status="Acertado", gcc=None, gc="Gc. G1"):
    return {CM.ANOMES: SET, CM.DATA: dia, CM.ROTA: rota, CM.CLIENTE: "0000000001", CM.AGRUPADOR: ag, CM.NF_STATUS: status,
            CM.VOL_MES: vol, CM.GC: gc, CM.GC_COMERCIAL: gcc, CM.META_ROTA: rota}


def _neg(rota, ag, valor, dia="2026-09-01"):
    return {CM.ANOMES: SET, CM.DATA: dia, CM.ROTA: rota, CM.META_ROTA: rota, CM.AGRUPADOR: ag, CM.META_NEG: valor,
            CM.GC: "Gc. G1"}


def _mt(rota, ag, vol):
    return {CM.META_ANOMES: SET, CM.META_ROTA: rota, CM.META_AGRUPADOR: ag, CM.META_VOLUME: vol}


# setembro/26: corte de 13/10 = 10/09 (7º dia útil; 07/09 é feriado); de 03/11 (fechamento de outubro) = 30/09
FATOS = [
    _nf("2026-09-02", NORMAL, 100), _nf("2026-09-10", NORMAL, 20.04),
    _nf("2026-09-11", NORMAL, 50),                                    # depois do corte de 13/10 (entra no fechamento)
    _nf("2026-09-03", NORMAL, 30, status="Cancelada"),                # fora do Vol Real
    _nf("2026-09-03", NORMAL, 7, ag="Cervejas"),
    _nf("2026-09-03", NORMAL, 4, ag="Del Valle Frut"),                # fora (decisão 6)
    _nf("2026-09-04", SEM_META, 77),                                  # rota sem meta em setembro: o Real não entra
    _nf("2026-09-04", SO_NEG, 12),
    _nf("2026-09-08", NEUTRALIZA, 9), _nf("2026-09-08", VIRTUAL, 6, gc="Gc. An"),
    _nf("2026-09-09", "EV1", 15, gcc="Gc. Sl", gc="Gc. Sl"),          # cliente em rota EV*: SL-EV
    _nf("2026-09-09", "EV2", 3, gcc="Gc. Di", gc="Gc. Pa_Di"),        # DI sem rota oculta hoje: fora
    _nf("2026-09-09", "Z99", 5),                                      # fora do painel
    _neg(NORMAL, "Refrigerantes", 900), _neg(SO_NEG, "Refrigerantes", 40), _neg(SO_NEG, "Refrigerantes", 10, "2026-09-25"),
    _neg(NORMAL, "Cervejas", 30), _neg(NEUTRALIZA, "Refrigerantes", 60),
]
METAS = [_mt(NORMAL, "Refrigerantes", 1000), _mt(VIRTUAL, "Refrigerantes", 50),
         _mt("A19", "Refrigerantes", 30)]                             # rota que não existe hoje: fora


class ComSetembro(ConsultaFalsa):
    """O sintético (mês de hoje) + setembro/26 pelo ConsultaE10; `falha`, `atraso` e as chamadas de setembro."""

    def __init__(self, dados, falha=False, atraso=0.0, fatos=FATOS, metas=METAS):
        super().__init__(dados)
        self.setembro = ConsultaE10(fatos, metas)
        self.falha_set, self.atraso = falha, atraso
        self.chamadas_set = []

    def linhas(self, objeto, select, filtro=None, top=None, orderby=None):
        if objeto == M.OBJ_META and f"'{SET}'" in (filtro or "") and top is None:
            self.chamadas_set.append((tuple(select), filtro))
            if self.atraso:
                time.sleep(self.atraso)
            if self.falha_set:
                raise RuntimeError("HTTP 500 (simulado)")
            return self.setembro.linhas(objeto, select, filtro, top, orderby)
        return super().linhas(objeto, select, filtro, top, orderby)


def _carrega(cons, agora=datetime(2026, 10, 13, 10, 30)):
    with contextlib.redirect_stderr(io.StringIO()):
        f = fontes.carregar(cons, agora)
        return f, montar_payload(f)


def _rotas(p):
    return [r for svs in p["DATA"].values() for rotas in svs.values() for r in rotas]


class TestChaveNoPayload(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cons = ComSetembro(sintetico.dados(False))
        cls.f, cls.p = _carrega(cls.cons)
        cls.ma = cls.p["MES_ANTERIOR"]

    def test_corte_normal_e_formato(self):
        self.assertEqual({k: v for k, v in self.ma.items() if k != "ROTAS"},
                         {"MES_LABEL": "Setembro/26", "DIA_UTIL": 7, "TOTAL_DIAS_UTEIS": 21, "DATA_CORTE": "2026-09-10",
                          "FECHADO": False, "IND": ["VOL REFRIGERANTES", "VOL CERVEJAS", "VOL STILL",
                                                    "VOL AGUA MINERAL", "VOL DEST+ART+CND"]})
        self.assertEqual(self.ma["IND"], M.INDICADORES_VOLUME)
        self.assertEqual(self.p["DIA_ONTEM"], 7)

    def test_a_ultima_chave_e_opcional(self):
        self.assertEqual(list(self.p)[-1], "MES_ANTERIOR")
        self.assertEqual(list(self.p)[-2], "SEM_COMPRA_MES")
        self.assertNotIn("MES_ANTERIOR", CHAVES_PAYLOAD)

    def test_todas_as_rotas_do_payload_na_ordem(self):
        self.assertEqual(list(self.ma["ROTAS"]), _rotas(self.p))
        for r in (NEUTRALIZA, VIRTUAL, OCULTA):
            self.assertIn(r, self.ma["ROTAS"])
        self.assertNotIn("A19", self.ma["ROTAS"])                     # do mês anterior, não existe hoje
        self.assertNotIn("Z99", self.ma["ROTAS"])
        self.assertTrue(all(len(v) == 5 for v in self.ma["ROTAS"].values()))

    def test_real_ate_o_corte_e_meta_do_mes_inteiro(self):
        # 100 + 20,04 (até 10/09); sem a cancelada, o depois do corte e o Del Valle Frut; meta = a META_VOLUME
        self.assertEqual(self.ma["ROTAS"][NORMAL][0], [120.0, 1000.0])
        self.assertEqual(self.ma["ROTAS"][NORMAL][1], [7.0, 30.0])     # Cervejas sem META_VOLUME: a META_NEG
        self.assertEqual(self.ma["ROTAS"][SO_NEG][0], [12.0, 50.0])    # META_NEG do mês INTEIRO (40 + 10 depois do corte)
        self.assertEqual(self.ma["ROTAS"][NORMAL][2:], [None, None, None])
        self.assertEqual(self.ma["ROTAS"][NEUTRALIZA][0], [9.0, 60.0])
        self.assertEqual(self.ma["ROTAS"][VIRTUAL][0], [6.0, 50.0])

    def test_rota_sem_meta_com_real_entra_com_meta_zero(self):
        # 27/10/2026, como o card: sem META_VOLUME nem META_NEG, mas com Real -> [Real, 0]
        self.assertEqual(self.ma["ROTAS"][SEM_META], [[77.0, 0.0], None, None, None, None])
        band = sum(par[0] for vs in self.ma["ROTAS"].values() for par in vs if par)
        self.assertEqual(round(band, 1), 120.0 + 7 + 12 + 9 + 6 + 15 + 77)   # sem o EV2 e o Z99

    def test_rota_oculta_das_ev(self):
        self.assertEqual(self.p["EVENTUAIS_ROTAS"], [OCULTA])
        self.assertEqual(self.ma["ROTAS"][OCULTA], [[15.0, 0.0], None, None, None, None])   # meta 0, só soma o Real

    def test_consultas_com_o_corte_so_no_filtro(self):
        vol = [c for c in self.cons.chamadas_set if CM.NF_STATUS in c[0]]
        self.assertEqual(len(vol), 1)
        self.assertIn("DATA_MOVIMENTO le 2026-09-10", vol[0][1])
        self.assertEqual(vol[0][0][0], CM.ROTA)                           # rota ATUAL do cliente
        self.assertTrue(all(CM.DATA not in c[0] for c in self.cons.chamadas_set))
        metas = [c for c in self.cons.chamadas_set if CM.META_NEG in c[0] or CM.META_VOLUME in c[0]]
        self.assertEqual(len(metas), 2)
        self.assertTrue(all(CM.DATA not in c[1] for c in metas))          # metas do mês inteiro
        self.assertTrue(all("Del Valle" not in f and "Heineken" not in f for _, f in self.cons.chamadas_set))

    def test_tempos_e_validacao(self):
        self.assertIn("mes_anterior_s", self.f.tempos)
        self.assertIn("mes_anterior_espera_s", self.f.tempos)
        erros, avisos = validar_payload(self.p)
        self.assertEqual(erros, [])
        self.assertFalse([a for a in avisos if "MES_ANTERIOR" in a], avisos)

    def test_tamanho(self):
        b = len(serializar({"MES_ANTERIOR": self.ma})) - 1
        self.assertLess(b, 20_000)
        # pior caso realista: 250 rotas com os 5 pares de 7 dígitos (o payload de 21/10 tem 247 rotas)
        grande = dict(self.ma, ROTAS={f"R{i:03d}": [[1234567.8, 2345678.9]] * 5 for i in range(250)})
        self.assertLess(len(serializar({"MES_ANTERIOR": grande})), 40_000)

    def test_resto_do_payload_igual_ao_de_sem_a_chave(self):
        f, p = _carrega(ComSetembro(sintetico.dados(False), falha=True))
        self.assertNotIn("MES_ANTERIOR", p)
        self.assertEqual(serializar({k: v for k, v in self.p.items() if k != "MES_ANTERIOR"}), serializar(p))


class TestFalhaETempo(unittest.TestCase):
    def test_falha_de_consulta_omite_a_chave_e_segue(self):
        f, p = _carrega(ComSetembro(sintetico.dados(False), falha=True))
        self.assertNotIn("MES_ANTERIOR", p)
        self.assertTrue(any(a.startswith("MES_ANTERIOR fora do payload: consulta de Setembro/26 falhou") for a in f.avisos),
                        f.avisos)
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])                                       # nunca reprova a rodada
        self.assertTrue(any("MES_ANTERIOR ausente" in a for a in avisos), avisos)

    def test_passou_do_limite_omite_a_chave_sem_esperar(self):
        cons = ComSetembro(sintetico.dados(False), atraso=3.0)
        inicio = time.monotonic()
        with mock.patch.object(M, "MES_ANTERIOR_LIMITE_S", 0.3):
            f, p = _carrega(cons)
        self.assertLess(time.monotonic() - inicio, 2.5)                  # não esperou a consulta lenta
        self.assertNotIn("MES_ANTERIOR", p)
        self.assertTrue(any(a.startswith("MES_ANTERIOR fora do payload: as consultas de Setembro/26 passaram de")
                            for a in f.avisos), f.avisos)
        self.assertEqual(validar_payload(p)[0], [])

    def test_threads_daemon(self):
        # uma consulta presa não segura o fim do processo (ThreadPoolExecutor seguraria)
        evento = __import__("threading").Event()

        class Presa(ComSetembro):
            def linhas(self, objeto, select, filtro=None, top=None, orderby=None):
                if f"'{SET}'" in (filtro or "") and top is None:
                    evento.wait(5)
                return super().linhas(objeto, select, filtro, top, orderby)
        c = MA.Carga(Presa(sintetico.dados(False)), MA.corte_mes_anterior(calmod.calcular_local(date(2026, 10, 13)), []),
                     ["Gc. G1"], None, limite_s=0.05)
        dados, aviso = c.resultado()
        self.assertIsNone(dados)
        self.assertIn("passaram de", aviso)
        self.assertTrue(c._thread.daemon)
        evento.set()


class TestCalendario(unittest.TestCase):
    def test_mes_anterior_com_menos_dias_uteis(self):
        # 31/03/2026: DIA_ONTEM 21; fevereiro tem 18 dias úteis: ele inteiro
        c = MA.corte_mes_anterior(calmod.calcular_local(date(2026, 3, 31)), [])
        self.assertEqual((c.n, c.n_ant, c.total_ant, c.corte, c.limitado, c.fechado),
                         (21, 18, 18, date(2026, 2, 28), True, False))
        d = MA.Dados(c, {NORMAL: {REFRI: 10.0}}, {}, {NORMAL: {REFRI: 100.0}}, {})
        ch, aviso = MA.chave(d, [NORMAL], {})
        self.assertIsNone(aviso)
        self.assertEqual((ch["DIA_UTIL"], ch["TOTAL_DIAS_UTEIS"], ch["DATA_CORTE"], ch["MES_LABEL"], ch["FECHADO"]),
                         (18, 18, "2026-02-28", "Fevereiro/26", False))

    def test_fechamento_mes_anterior_inteiro(self):
        # fevereiro fechado (18 dias úteis) contra janeiro (21): janeiro inteiro
        c = MA.corte_mes_anterior(calmod.fechado(date(2026, 3, 2), date(2026, 2, 1), 18), [])
        self.assertEqual((c.anterior, c.n_ant, c.total_ant, c.corte, c.fechado, c.caso),
                         (date(2026, 1, 1), 21, 21, date(2026, 1, 31), True, MA.CASO_FECHAMENTO))

    def test_sem_dia_util_fechado_sem_chave(self):
        cal = calmod.calcular_local(date(2026, 10, 1))
        self.assertEqual(cal.dia_ontem, 0)
        cons = ComSetembro(sintetico.dados(False))
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertIsNone(MA.iniciar(cons, cal, [], ["Gc. G1"]))
        self.assertEqual(cons.chamadas_set, [])                         # nenhuma consulta do mês anterior


class TestFechamento(unittest.TestCase):
    def test_fechamento_x_fechamento(self):
        cons = ComSetembro(sintetico.dados(True))
        f, p = _carrega(cons, datetime(2026, 11, 3, 10, 30))
        self.assertTrue(p["FECHAMENTO"])
        self.assertEqual(p["MES_LABEL"], "Outubro/26")
        ma = p["MES_ANTERIOR"]
        self.assertEqual({k: ma[k] for k in ("MES_LABEL", "DIA_UTIL", "TOTAL_DIAS_UTEIS", "DATA_CORTE", "FECHADO")},
                         {"MES_LABEL": "Setembro/26", "DIA_UTIL": 21, "TOTAL_DIAS_UTEIS": 21, "DATA_CORTE": "2026-09-30",
                          "FECHADO": True})
        self.assertEqual(ma["ROTAS"][NORMAL][0], [170.0, 1000.0])       # setembro inteiro: + 50 de 11/09
        self.assertTrue(any("DATA_MOVIMENTO le 2026-09-30" in c[1] for c in cons.chamadas_set))
        self.assertEqual(validar_payload(p)[0], [])


class TestChavePura(unittest.TestCase):
    def setUp(self):
        self.c = MA.corte_mes_anterior(calmod.calcular_local(date(2026, 10, 21)), [])

    def test_real_negativo_ou_invalido_tira_a_chave(self):
        for v in (-5.0, float("nan"), float("inf")):
            d = MA.Dados(self.c, {NORMAL: {REFRI: v}}, {}, {NORMAL: {REFRI: 100.0}}, {})
            ch, aviso = MA.chave(d, [NORMAL], {})
            self.assertIsNone(ch)
            self.assertIn(f"{NORMAL}/Refrigerantes", aviso)

    def test_ev_sem_gerencia_de_hoje_fica_fora(self):
        d = MA.Dados(self.c, {}, {"SL": {REFRI: 4.0, CERV: 0.0}, "DI": {REFRI: 3.0}}, {}, {})
        ch, _ = MA.chave(d, [NORMAL, "SL-EV"], {"SL-EV": "SL"})
        self.assertEqual(ch["ROTAS"], {NORMAL: [None] * 5, "SL-EV": [[4.0, 0.0], None, None, None, None]})

    def test_meta_zero_conta_como_indicador(self):
        d = MA.Dados(self.c, {NORMAL: {REFRI: 8.0}}, {}, {}, {NORMAL: {REFRI: 0.0, STILL: 2.0}})
        ch, _ = MA.chave(d, [NORMAL], {})
        self.assertEqual(ch["ROTAS"][NORMAL][0], [8.0, 0.0])               # metas zeradas, com Real: meta 0 (27/10)
        self.assertEqual(ch["ROTAS"][NORMAL][2], [0.0, 2.0])
        sem_real = MA.chave(MA.Dados(self.c, {}, {}, {}, {NORMAL: {REFRI: 0.0}}), [NORMAL], {})[0]
        self.assertIsNone(sem_real["ROTAS"][NORMAL][0])                    # metas zeradas e sem Real: indisponível


class TestValidacao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = _carrega(ComSetembro(sintetico.dados(False)))[1]

    def _com(self, rotas=None, **extra):
        p = copy.deepcopy(self.p)
        if rotas is not None:
            p["MES_ANTERIOR"]["ROTAS"] = rotas
        p.update(extra)
        return validar_payload(p)

    def test_ausente_com_dia_util_fechado_avisa(self):
        p = {k: v for k, v in self.p.items() if k != "MES_ANTERIOR"}
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertTrue(any("MES_ANTERIOR ausente" in a for a in avisos))
        self.assertFalse([a for a in validar_payload(dict(p, DIA_ONTEM=0))[1] if "MES_ANTERIOR" in a])

    def test_real_band_zero_avisa(self):
        erros, avisos = self._com({NORMAL: [[0.0, 10.0], None, None, None, None]})
        self.assertEqual(erros, [])
        self.assertTrue(any("Real BAND de Setembro/26 até 2026-09-10 = 0" in a for a in avisos), avisos)

    def test_meta_negativa_avisa(self):
        erros, avisos = self._com({NORMAL: [[5.0, -10.0], None, None, None, None]})
        self.assertEqual(erros, [])
        self.assertTrue(any("meta negativa em 1 rota(s): G111" in a for a in avisos), avisos)

    def test_nan_inf_e_real_negativo_sao_erro(self):
        for v in (math.nan, math.inf):
            erros, _ = self._com({NORMAL: [[v, 10.0], None, None, None, None]})
            self.assertTrue(any("não finito" in e and NORMAL in e for e in erros), erros)
        erros, _ = self._com({NORMAL: [[-1.0, 10.0], None, None, None, None]})
        self.assertTrue(any("Real negativo em: G111" in e for e in erros), erros)

    def test_payload_antigo_sem_a_chave(self):
        p = {k: v for k, v in self.p.items() if k != "MES_ANTERIOR"}
        self.assertEqual(validar_payload(p)[0], [])


class TestE11(unittest.TestCase):
    """E11 do conferir: a chave do payload contra o resumo da E10 (os dois do mesmo Datasphere simulado)."""

    @classmethod
    def setUpClass(cls):
        cls.p = _carrega(ComSetembro(sintetico.dados(False)))[1]
        ma = cls.p["MES_ANTERIOR"]
        c = MA.corte_mes_anterior(calmod.calcular_local(date(2026, 10, 13)), [])
        vol = MA.consulta_volume(ConsultaE10(FATOS, METAS), SET, [], c.corte)
        ev = MA.real_por_rota(vol)[1]
        gc_rota = ct._rotas_gc(cls.p)
        real = dict(MA.real_por_rota(vol)[0])
        for r, gc in ((r, g) for r, g in gc_rota.items() if r.endswith("-EV")):
            real[r] = ev.get(gc, {})
        meta = MA.meta_volume_por_rota({r: {k: (pv or [0, 0])[1] for k, pv in zip(ma["IND"], vs) if pv}
                                        for r, vs in ma["ROTAS"].items()}, {}, gc_rota, real)
        tot = ct.com_band(ct.volume_por_gc(real, meta, gc_rota), M.INDICADORES_VOLUME, [0.0, 0.0, 0])
        hoje = ct.com_band({g: {M.INDICADORES_VOLUME[0]: t} for g, t in ct.real_hoje_gc(cls.p, ct.K_REFRI).items()
                            if g != "BAND"}, [ct.K_REFRI], [0.0, 0.0, 0])
        cls.ref = ct.resumo_e10(c, vol, ev, 120.04 + 7 + 77 + 12 + 9 + 6 + 15 + 3 + 5, tot, hoje,
                                [g for g in M.GC_NOMES if g in set(gc_rota.values())])

    def _txt(self, payload, ref=None, tempos=None, duracao=None):
        rel = ct.Relatorio()
        ct.secao_mes_anterior_payload(rel, payload, ref, tempos, duracao)
        return "\n".join(rel.linhas)

    def test_reconcilia_com_a_consulta_direta_e_a_curva(self):
        txt = self._txt(self.p, self.ref, {"mes_anterior_s": 12.3, "mes_anterior_espera_s": 0.0}, 70)
        self.assertIn("**Bate**", txt)
        # a rota sem meta (77) entra na chave com meta 0 (27/10/2026): "rotas sem o indicador" fica 0
        self.assertIn("| Refrigerantes | 239,0 | 247,0 | 224,0 | 15,0 | 0,0 | 3,0 | 5,0 | 0,0 | 0,0 |", txt)
        self.assertIn("curva diária até o corte 254: **igual**.", txt)
        self.assertIn("Chave e payload iguais à E10d em todas as gerências.", txt)
        self.assertIn("Consultas do mês anterior (em paralelo com as do mês): 12.3 s (limite 60 s)", txt)
        self.assertIn("gerar.py completo: 70 s (meta: abaixo de 120 s)", txt)
        self.assertIn("**normal: dia útil 7 de Setembro/26**.", txt)
        self.assertIn("| ocultas das EV* (Real das rotas EV*) | 1 (SL-EV) |", txt)
        self.assertIn("| do payload fora da chave | 0 |", txt)
        self.assertIn("Gerências com Real de rotas EV* em Setembro/26 sem a rota oculta hoje (fica fora da chave): DI.", txt)
        self.assertRegex(txt, r"Chave \d+,?\d* KB|Chave \d+\.\d KB")

    def test_difere_da_e10d(self):
        ref = copy.deepcopy(self.ref)
        ref["REFRI_GC"]["G1"]["ant"][0] += 50
        self.assertIn("**1 diferença(s)** contra a E10d", self._txt(self.p, ref))

    def test_sem_a_chave_ou_sem_payload(self):
        p = {k: v for k, v in self.p.items() if k != "MES_ANTERIOR"}
        self.assertIn("consulta do mês anterior falhou ou passou do limite", self._txt(p))
        self.assertIn("sem dia útil fechado (DIA_ONTEM = 0)", self._txt(dict(p, DIA_ONTEM=0)))
        self.assertIn("payload.json não gerado", self._txt(None))
        txt = self._txt(self.p)                                           # sem o resumo da E10
        self.assertIn("Sem o resumo da E10", txt)

    def test_casos_limitado_e_fechamento(self):
        p = copy.deepcopy(self.p)
        p["MES_ANTERIOR"].update(DIA_UTIL=18, TOTAL_DIAS_UTEIS=18)
        p["DIA_ONTEM"] = 21
        self.assertIn("**mês limitado: DIA_ONTEM 21 > 18 dias úteis", self._txt(p))
        p["MES_ANTERIOR"]["FECHADO"] = True
        self.assertIn("**fechamento:", self._txt(p))

    def test_cli_grava_ao_lado_do_relatorio_sem_clientes(self):
        with tempfile.TemporaryDirectory() as pasta:
            pasta = Path(pasta)
            (pasta / "payload.json").write_text(json.dumps(self.p), encoding="utf-8")
            (pasta / ct.ARQ_E10).write_text(json.dumps(self.ref), encoding="utf-8")
            ct.main_e11(pasta / "payload.json", pasta, {"mes_anterior_s": 1.0}, 50.0)
            txt = (pasta / "relatorio_tendencia.md").read_text(encoding="utf-8")
        self.assertIn("## E11. MES_ANTERIOR do payload gerado", txt)
        for t in ("E11a.", "E11b/c.", "E11d.", "E11e.", "E11f.", "E11g."):
            self.assertIn(t, txt)
        nomes = {c[1] for rs in self.p["CLIENT_ROSTER"].values() for c in rs}
        pvs = {str(c[0]) for rs in self.p["CLIENT_ROSTER"].values() for c in rs}
        self.assertFalse([n for n in nomes if n and n in txt])
        self.assertFalse([pv for pv in pvs if f" {pv} " in txt or f"({pv})" in txt])
        self.assertNotIn("None", txt)

    def test_e10_grava_o_resumo(self):
        rel = ct.Relatorio()
        from tests.test_mes_anterior import FATOS as F10, METAS as M10, _estado
        estado = _estado()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            ct.mes_anterior(rel, ConsultaE10(F10, M10), estado, estado["cal_ref"].anomes, date(2026, 10, 21), None)
        r = rel.anexos[ct.ARQ_E10]
        self.assertEqual((r["DATA_CORTE"], r["DIA_UTIL"], r["MES_LABEL"]), ("2026-09-20", 13, "Setembro/26"))
        self.assertEqual(r["REFRI_GC"]["BAND"]["ant"], [375.0, 710.0])    # = E10d (a I12, sem meta, com meta 0)
        self.assertEqual(r["EV"], {"AP": {"VOL REFRIGERANTES": 15.0}})
        self.assertEqual(r["CURVA_ATE_CORTE"], 388.0)
        for pv in ("9100001", "9200003", "910000"):                         # nenhum código de cliente
            self.assertNotIn(pv, json.dumps(r))


if __name__ == "__main__":
    unittest.main()
