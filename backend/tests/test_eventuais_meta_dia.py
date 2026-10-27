"""
Decisões de 20/10/2026 (seção E7 do conferir_tendencia.py contra a tela do SAC):
- clientes que estão hoje em rotas EV*: o Real de volume deles entra no total da gerência comercial do cliente
  (M.ColMeta.GC_COMERCIAL), numa rota oculta por gerência (M.rota_eventuais), sem meta, sem clientes e fora da
  Venda Zero e do online (a cobertura deles entrou em 26/10/2026: test_canceladas_ev_cobertura.py);
- meta do dia (META_RECUPERAVEL_ROTA) pela rota da meta (CD_ROTA_Chave_Meta_SAP); sem a dimensão, pela rota do
  cliente (regra anterior); sem as duas, null.
Decisão de 27/10/2026 (Flash de Vendas do SAC): no Real das rotas EV*, só as vendas com rota da meta; as sem chave de
meta ('Venda A Consumidor Final', '--') ficam fora, como o SAC.
"""
import copy
import sys
import unittest
from datetime import datetime
from pathlib import Path

from gerador import fontes, modelo
from gerador import mapeamento as M
from gerador.payload import montar_payload
from gerador.validacao import validar_payload
from tests.test_fontes import CM, DADOS, ConsultaFalsa, _dia, _vr

REF = "VOL REFRIGERANTES"
AGORA = datetime(2026, 10, 13, 10, 30)


def _ev(vol, gc_comercial, ag="Refrigerantes", status="Acertado", rota="EV1", meta_rota="111"):
    l = _vr(1300001, ag, status, vol, rota=rota)
    if gc_comercial is not None:
        l[CM.GC_COMERCIAL] = gc_comercial
    l[CM.META_ROTA] = meta_rota
    return l


def _dados_ev():
    d = copy.deepcopy(DADOS)
    d["vol_real"] = DADOS["vol_real"] + [
        _ev(12.0, "Gc. G1"), _ev(2.0, "Gc. G1", ag="Cervejas"),
        _ev(100.0, "Gc. G1", status="Cancelada"),        # fora do Vol Real, como qualquer NF cancelada
        _ev(5.0, "Gc. Ap"),                              # AP sem rotas no painel: fica fora (log)
        _ev(3.0, None),                                  # sem a gerência comercial: fica fora (log)
        _ev(7.0, "Gc. G1", ag="Del Valle Frut"),         # Del Valle Frut só na G2: fora na G1
        _ev(40.0, "Gc. G1", rota="EVF", meta_rota="--"),  # sem chave de meta (consumidor final): fora, como o SAC
    ]
    # meta do dia de um cliente que está numa rota EV*, com a meta da 111: entra na 111 (pela rota da meta)
    d["meta_dia"] = DADOS["meta_dia"] + [dict(_dia("Refrigerantes", "2026-10-13", CM.META_RECUPERAVEL, 4.0, rota="EV1"),
                                              **{CM.META_ROTA: "111"})]
    return d


class TestRealDasEventuais(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with unittest.TestCase().assertLogs("gerador.fontes", "INFO") as log:
            cls.f = fontes.carregar(ConsultaFalsa(_dados_ev()), AGORA)
        cls.log = "\n".join(log.output)
        cls.p = montar_payload(cls.f)

    def test_rota_oculta_por_gerencia_comercial(self):
        self.assertEqual(self.f.eventuais, {"G1-EV": "G1"})
        v = self.f.volume["G1-EV"]
        self.assertEqual(set(v), {REF, "VOL CERVEJAS"})                  # Del Valle Frut só na G2
        self.assertEqual((v[REF].meta, v[REF].real, v[REF].neg_restante, v[REF].meta_dia_hoje), (0.0, 12.0, 0.0, 0.0))
        self.assertEqual(v["VOL CERVEJAS"].real, 2.0)
        self.assertIn("Real de clientes em rotas EV* da AP fica fora: gerência sem rotas no painel", self.log)
        self.assertIn("sem gerência comercial do painel", self.log)

    def test_venda_sem_rota_da_meta_fica_fora(self):
        # os 40 da EVF (sem chave de meta) não entram na G1-EV, mas o Real da EVF continua na fonte (fora do painel)
        self.assertEqual(self.f.volume["G1-EV"][REF].real, 12.0)
        self.assertIn("Vol Real de rotas EV* sem rota da meta (fica fora, como o SAC): {'G1 EVF': {'Refrigerantes': 40.0}}",
                      self.log)

    def test_sem_a_coluna_da_rota_da_meta_entra_tudo(self):
        class SemMetaRota(ConsultaFalsa):
            def colunas(self, objeto):
                return [c for c in super().colunas(objeto) if c != CM.META_ROTA]
        with self.assertLogs("gerador.fontes", "WARNING") as log:
            vm = fontes.carregar_volume_real(SemMetaRota(_dados_ev()), "202610", [], None)
        self.assertEqual(vm.eventuais["G1"][REF], 52.0)                 # 12 + 40 (regra anterior)
        self.assertIn("o Real das rotas EV* entra inteiro", "\n".join(log.output))

    def test_no_payload_como_virtual(self):
        p = self.p
        self.assertEqual(list(p["DATA"]["G1"]), ["SV.G1.1", "SV.G1.EV"])
        no = p["DATA"]["G1"]["SV.G1.EV"]["G1-EV"]
        self.assertEqual((no["baseTotal"], no["baseKsTt"], no["compraram"], no["consultor"]), (0, 0, None, ""))
        self.assertTrue(all(no["indicators"][k]["unavailable"] for k in M.INDICADORES_COBERTURA + ["VENDAZERO"]))
        ref = no["indicators"][REF]
        self.assertEqual([ref[c] for c in ("meta", "real", "dif", "tendencia", "pctTendencia", "metaDia")],
                         [0, 12.0, 12.0, 12.0, None, 0.0])
        self.assertTrue(no["indicators"]["VOL STILL"]["unavailable"])
        self.assertEqual(p["VIRTUAIS_ROTAS"], M.VIRTUAIS_ROTAS + ["G1-EV"])
        self.assertEqual(p["EVENTUAIS_ROTAS"], ["G1-EV"])
        self.assertEqual(p["CLIENT_ROSTER"]["G1-EV"], [])
        self.assertEqual(p["NOME_SUPERVISOR"]["SV.G1.EV"], "")
        self.assertEqual(validar_payload(p)[0], [])

    def test_total_da_gerencia_soma_a_rota_oculta(self):
        blocos = [d["indicators"][REF] for svs in self.p["DATA"]["G1"].values() for d in svs.values()]
        tot = modelo.agrega_volume(blocos)
        so_111 = self.p["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"][REF]
        self.assertAlmostEqual(tot["real"], so_111["real"] + 12.0)
        self.assertAlmostEqual(tot["tendencia"], so_111["tendencia"] + 12.0)
        self.assertEqual(tot["meta"], so_111["meta"])

    def test_meta_do_dia_pela_rota_da_meta(self):
        # 5 da própria 111 + 4 do cliente que está na EV1 com a meta da 111 (pela rota do cliente, iam para a EV1)
        self.assertEqual(self.f.volume["111"][REF].meta_dia_hoje, 9.0)

    def test_sem_a_coluna_da_gerencia_comercial_nao_ha_rota_oculta(self):
        class SemGc(ConsultaFalsa):
            def colunas(self, objeto):
                return [c for c in super().colunas(objeto) if c != CM.GC_COMERCIAL]
        f = fontes.carregar(SemGc(_dados_ev()), AGORA)
        self.assertEqual(f.eventuais, {})
        self.assertNotIn("G1-EV", f.volume)
        self.assertEqual(montar_payload(f)["EVENTUAIS_ROTAS"], [])


class TestMetaDoDiaPlanoB(unittest.TestCase):
    def test_sem_rota_da_meta_usa_a_rota_do_cliente(self):
        d = copy.deepcopy(DADOS)
        d["meta_dia"] = [_dia("Refrigerantes", "2026-10-13", CM.META_RECUPERAVEL, 5.0)]     # sem CD_ROTA_Chave_Meta_SAP
        with self.assertLogs("gerador.fontes", "WARNING") as log:
            f = fontes.carregar(ConsultaFalsa(d), AGORA)
        self.assertEqual(f.volume["111"][REF].meta_dia_hoje, 5.0)
        self.assertIn("veio sem rota: meta do dia pela rota do cliente", "\n".join(log.output))

    def test_rota_da_meta_falha_usa_a_rota_do_cliente(self):
        def falha(sel, filtro):
            return CM.META_RECUPERAVEL in sel and CM.META_ROTA in sel
        f = fontes.carregar(ConsultaFalsa(copy.deepcopy(_dados_ev()), falha=falha), AGORA)
        self.assertEqual(f.volume["111"][REF].meta_dia_hoje, 5.0)       # a da EV1 volta a ficar fora

    def test_as_duas_falham_meta_do_dia_null(self):
        def falha(sel, filtro):
            return CM.META_RECUPERAVEL in sel
        f = fontes.carregar(ConsultaFalsa(copy.deepcopy(_dados_ev()), falha=falha), AGORA)
        self.assertIsNone(f.volume["111"][REF].meta_dia_hoje)
        self.assertIsNone(f.volume["G1-EV"][REF].meta_dia_hoje)

    def test_sem_meta_hoje_fica_zero(self):
        d = copy.deepcopy(DADOS)
        d["meta_dia"] = []
        f = fontes.carregar(ConsultaFalsa(d), AGORA)
        self.assertEqual(f.volume["111"][REF].meta_dia_hoje, 0.0)


class TestValidacao(unittest.TestCase):
    def test_rota_oculta_que_sai_nao_e_aviso_nem_queda(self):
        d = copy.deepcopy(DADOS)
        d["vol_real"] = DADOS["vol_real"] + [_ev(1.0, "Gc. G1")]
        anterior = montar_payload(fontes.carregar(ConsultaFalsa(d), AGORA))
        self.assertEqual(anterior["EVENTUAIS_ROTAS"], ["G1-EV"])
        novo = montar_payload(fontes.carregar(ConsultaFalsa(copy.deepcopy(DADOS)), AGORA))
        erros, avisos = validar_payload(novo, anterior)
        self.assertEqual(erros, [])                                     # G1: 1 rota normal antes e depois
        self.assertFalse([a for a in avisos if "rotas que saíram" in a])

    def test_payload_sem_a_chave_nova_reprova(self):
        p = montar_payload(fontes.carregar(ConsultaFalsa(_dados_ev()), AGORA))
        del p["EVENTUAIS_ROTAS"]
        self.assertIn("EVENTUAIS_ROTAS", validar_payload(p)[0][0])


class TestSintetico(unittest.TestCase):
    """O cenário dos testes de front: rota oculta SL-EV na SL (a da DI fica fora: DI sem dados), também no fechamento."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "frontend" / "tests"))
        import sintetico
        cls.normal = montar_payload(fontes.carregar(ConsultaFalsa(sintetico.dados(False)), datetime(2026, 10, 13, 10, 30)))
        cls.fech = montar_payload(fontes.carregar(ConsultaFalsa(sintetico.dados(True)), datetime(2026, 11, 3, 10, 30)))

    def test_normal_e_fechamento(self):
        for p in (self.normal, self.fech):
            self.assertEqual(p["EVENTUAIS_ROTAS"], ["SL-EV"])
            self.assertNotIn("DI", p["DATA"])
            ref = p["DATA"]["SL"]["SV.SL.EV"]["SL-EV"]["indicators"][REF]
            self.assertEqual((ref["meta"], ref["real"]), (0, 120.0))
            self.assertEqual(validar_payload(p)[0], [])
        self.assertEqual(self.normal["DATA"]["SL"]["SV.SL.EV"]["SL-EV"]["indicators"][REF]["tendencia"], 120.0)
        fech = self.fech["DATA"]["SL"]["SV.SL.EV"]["SL-EV"]["indicators"][REF]
        self.assertEqual((fech["tendencia"], fech["metaDia"]), (None, None))
        self.assertTrue(self.fech["FECHAMENTO"])


if __name__ == "__main__":
    unittest.main()
