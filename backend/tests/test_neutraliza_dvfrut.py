"""
Parte B: Neutraliza (SV.G1.5/151, SV.G2.5/251, SV.IT.3/I31, SV.MO.3/M31) fica nos totais da gerência e fora
da Venda Zero; Del Valle Frut só na G2, com as regras de volume e nunca somado aos 5 macros. Nomes fictícios.
"""
import copy
import unittest
from datetime import datetime

from gerador import fontes, modelo
from gerador import mapeamento as M
from gerador.online import montar_online
from gerador.payload import montar_payload
from gerador.validacao import validar_payload
from tests.test_fontes import CB, CM, CO, DADOS, ConsultaFalsa, _cliente, _dia, _equip, _meta, _venda, _vr

DV = "VOL DEL VALLE FRUT"


def _cli(pv, rota, gc, sv, seg="Boteco"):
    return dict(_cliente(pv, rota, f"CLIENTE {pv}", seg, "Seg", True, sv=sv), **{CB.GC: gc})


def _em(linha, rota, gc="Gc. G1", col_rota=CM.ROTA):
    return dict(linha, **{col_rota: rota, "_gc": gc})


class TestNeutraliza(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        d = copy.deepcopy(DADOS)
        d[M.OBJ_BASE_CLIENTE] = DADOS[M.OBJ_BASE_CLIENTE] + [_cli(2001, "151", "Gc. G1", "Sv. G1.5")]
        d["comodato"] = DADOS["comodato"] + [_em(_equip(2001, "X", "SEG", True, "E9", "Giro Zero", 30, 0), "151",
                                                 col_rota=CO.ROTA),
                                             _em(_equip(2001, "X", "SEG", True, "E8", "Giro Ok", 30, 9), "151",
                                                 col_rota=CO.ROTA)]
        d["meta_vz"] = [{CO.META_GC: "Gc. G1", CO.META_VZ_GC: "10", CO.MEDIDA_AUX: 1}]
        d["vol_real"] = DADOS["vol_real"] + [_em(_vr(2001, "Refrigerantes", "Acertado", 7.0), "151")]
        d["metas"] = DADOS["metas"] + [_meta("Refrigerantes", vol="50", rota="151"), _meta("Cctm 2l Pet", cob="2", rota="151")]
        cls.f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0))
        cls.p = montar_payload(cls.f)

    def test_lista_unica_no_payload(self):
        self.assertEqual(self.p["NEUTRALIZA"], ["SV.G1.5", "SV.G2.5", "SV.IT.3", "SV.MO.3"])
        self.assertEqual(self.p["OCULTAS"], ["SV.G3.3"])
        self.assertEqual(self.p["GC_SEM_OCULTAS"], ["AT"])

    def test_151_fora_da_venda_zero(self):
        self.assertEqual(fontes.rotas_neutraliza(self.f.clientes), {"151"})
        d151 = self.p["DATA"]["G1"]["SV.G1.5"]["151"]
        self.assertTrue(d151["indicators"]["VENDAZERO"]["unavailable"])
        self.assertNotIn("151", self.p["VENDAZERO_CLIENTES"])
        self.assertNotIn("151", self.p["COMODATO_ATIVOS"])
        # a meta de VZ da gerência (10) fica toda com as rotas que não são Neutraliza
        self.assertEqual(self.p["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]["VENDAZERO"]["meta"], 10)

    def test_151_no_total_da_gerencia(self):
        d151 = self.p["DATA"]["G1"]["SV.G1.5"]["151"]["indicators"]
        self.assertEqual((d151["VOL REFRIGERANTES"]["meta"], d151["VOL REFRIGERANTES"]["real"]), (50.0, 7.0))
        self.assertEqual(d151["CCTM 2L PET"]["meta"], 2)
        gc = [d["indicators"]["VOL REFRIGERANTES"] for svs in self.p["DATA"]["G1"].values() for d in svs.values()]
        self.assertEqual(modelo.agrega_volume(gc)["meta"], 170.0)       # 120 (111) + 50 (151)
        sv = [d["indicators"]["VOL REFRIGERANTES"] for d in self.p["DATA"]["G1"]["SV.G1.1"].values()]
        self.assertEqual(modelo.agrega_volume(sv)["meta"], 120.0)

    def test_valida(self):
        self.assertEqual(validar_payload(self.p)[0], [])


def _dados_dv():
    d = copy.deepcopy(DADOS)
    d[M.OBJ_BASE_CLIENTE] = DADOS[M.OBJ_BASE_CLIENTE] + [_cli(3001, "211", "Gc. G2", "Sv. G2.1")]
    d["vendas"] = DADOS["vendas"] + [
        _em(_venda(3001, "DV Frut", vol=6.0, vol_on=4.0, meta_cli=12.0), "211", "Gc. G2"),
        _em(_venda(3001, "Refrigerantes", vol=10.0, vol_on=1.0, meta_cli=30.0), "211", "Gc. G2"),
        _em(_venda(1015300, "DV Frut", vol_on=9.0, meta_cli=5.0), "111"),               # DV na G1: ignorado
    ]
    d["vol_real"] = DADOS["vol_real"] + [_em(_vr(3001, "DV Frut", "Acertado", 6.0), "211", "Gc. G2"),
                                         _em(_vr(3001, "Refrigerantes", "Acertado", 10.0), "211", "Gc. G2"),
                                         _em(_vr(1015300, "DV Frut", "Acertado", 99.0), "111")]
    # a G2 precisa de META_COBERTURA no mês (senão o painel fica em fechamento, regra do main)
    d["metas"] = DADOS["metas"] + [_meta("DV Frut", vol="20", rota="211"), _meta("Refrigerantes", vol="40", rota="211"),
                                   _meta("DV Frut", vol="77", rota="111")] + [
        _meta(v, cob="4", rota="211") for v in M.AGRUPADORES_COBERTURA.values()]
    d["meta_neg"] = DADOS["meta_neg"] + [_em(_dia("DV Frut", "2026-10-01", CM.META_NEG, 15.0), "211", "Gc. G2"),
                                         _em(_dia("DV Frut", "2026-10-20", CM.META_NEG, 5.0), "211", "Gc. G2")]
    return d


class TestDelValleFrut(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.f = fontes.carregar(ConsultaFalsa(_dados_dv()), datetime(2026, 10, 13, 9, 0))
        cls.p = montar_payload(cls.f)
        cls.o = montar_online(cls.f.online)

    def test_so_na_g2_com_as_regras_de_volume(self):
        ind = self.p["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"]
        dv = ind[DV]
        # meta da rota 20; curva da META_NEG pela rota do cliente (fake sem rota da meta): 20 x 5/20 = 5
        self.assertEqual((dv["meta"], dv["real"], dv["negRestante"], dv["tendencia"], dv["pctTendencia"]),
                         (20.0, 6.0, 5.0, 11.0, 55))
        self.assertEqual(list(ind)[-1], DV)
        self.assertNotIn(DV, self.p["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"])
        self.assertNotIn(DV, self.p["GROUPS"]["VOLUME"])
        self.assertNotIn(DV, self.p["COV_GRUPO"]["VOLUME"])
        self.assertEqual(self.p["VOLUME_EXTRA"][DV], {"label": "Del Valle Frut", "gcs": ["G2"]})

    def test_nunca_somado_aos_macros(self):
        ind = self.p["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"]
        self.assertEqual((ind["VOL REFRIGERANTES"]["meta"], ind["VOL REFRIGERANTES"]["real"]), (40.0, 10.0))
        self.assertEqual(self.p["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]["VOL REFRIGERANTES"]["real"], 13.0)
        from gerador.validacao import _volume_real
        self.assertEqual(_volume_real({"211": self.p["DATA"]["G2"]["SV.G2.1"]["211"]}), 10.0)

    def test_barra_por_cliente_com_6_blocos_so_na_g2(self):
        self.assertEqual(self.p["VOLUME_CLIENTE"]["211"]["3001"], [[30.0, 10.0, 33, 1], None, None, None, None,
                                                                   [12.0, 6.0, 50, 1]])
        self.assertEqual(len(self.p["VOLUME_CLIENTE"]["111"]["1015300"]), 5)

    def test_online_e_fechamento(self):
        self.assertEqual(self.o["volume"]["211"], {"VOL REFRIGERANTES": 1.0, DV: 4.0})
        self.assertEqual(self.o["volumeCliente"]["211"]["3001"], {"VOL REFRIGERANTES": 1.0, DV: 4.0})
        d = _dados_dv()
        d = {**d, M.OBJ_CALENDARIO: [], "vendas": {"202610": d["vendas"]}, "vol_real": {"202610": d["vol_real"]},
             "meta_neg": {"202610": d["meta_neg"]}, "meta_dia": {}, "metas": {"202610": d["metas"]}}
        p = montar_payload(fontes.carregar(ConsultaFalsa(d), datetime(2026, 11, 3, 9, 0)))
        dv = p["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"][DV]
        self.assertEqual((dv["meta"], dv["real"], dv["tendencia"], dv["metaDia"], dv["onPace"]), (20.0, 6.0, None, None, False))

    def test_validacao_aceita_o_extra_no_fim(self):
        self.assertEqual(validar_payload(self.p)[0], [])
        ruim = copy.deepcopy(self.p)
        ind = ruim["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"]
        ruim["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"] = {DV: ind.pop(DV), **ind}
        self.assertTrue(any("indicadores fora do padrão" in e for e in validar_payload(ruim)[0]))

    def test_consulta_de_vendas_com_os_extras_e_compras_so_dos_17(self):
        self.assertEqual(len(M.AGRUPADORES_CONSULTA_VENDAS), 20)
        # cliente 3001 só comprou Refrigerantes e DV: conta como comprou (Refrigerantes é do painel)
        self.assertEqual(self.p["DATA"]["G2"]["SV.G2.1"]["211"]["compraram"], 1)
        d = _dados_dv()
        d["vendas"] = [l for l in d["vendas"] if not (l[CM.ROTA] == "211" and l[CM.AGRUPADOR] == "Refrigerantes")]
        d["vol_real"] = [l for l in d["vol_real"] if l[CM.ROTA] != "211" or l[CM.AGRUPADOR] == "DV Frut"]
        f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0))
        self.assertNotIn("211", f.compraram)                      # só DV Frut não é compra do painel
        self.assertNotIn("211", f.online.qualquer)


if __name__ == "__main__":
    unittest.main()
