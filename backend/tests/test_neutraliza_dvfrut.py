"""
Parte B: rotas Neutraliza e virtuais (listas por rota, em qualquer gerência) ficam nos totais da gerência e fora
da Venda Zero; a tag de geladeira e o Desempenho GDM valem para a Neutraliza (a virtual não aparece); a 411 é
normal. Del Valle Frut só na G2, com as regras de volume e nunca somado aos 5 macros. Nomes fictícios.
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


def _gel(pv, rota, equip, giro, vol=0):
    return _em(_equip(pv, "X", "SEG", True, equip, giro, 30, vol), rota, col_rota=CO.ROTA)


class TestNeutraliza(unittest.TestCase):
    """151 (G1, supervisão própria), A41 (AN, com as virtuais A42/A43 na mesma supervisão) e 431 (AT, numa
    supervisão com a normal 432) são Neutraliza; 411 (AT) é normal."""

    @classmethod
    def setUpClass(cls):
        d = copy.deepcopy(DADOS)
        d[M.OBJ_BASE_CLIENTE] = DADOS[M.OBJ_BASE_CLIENTE] + [
            _cli(2001, "151", "Gc. G1", "Sv. G1.5"), _cli(2002, "A41", "Gc. An", "Sv. An. 4"),
            _cli(2003, "A42", "Gc. An", "Sv. An. 4"), _cli(2004, "A43", "Gc. An", "Sv. An. 4"),
            _cli(2005, "431", "Gc. At", "Sv. At. 3"), _cli(2006, "432", "Gc. At", "Sv. At. 3"),
            _cli(2007, "411", "Gc. At", "Sv. At. 1")]
        d["comodato"] = DADOS["comodato"] + [
            _gel(2001, "151", "E9", "Giro Zero"), _gel(2001, "151", "E8", "Giro Ok", 9),
            _gel(2002, "A41", "E10", "Giro Zero"), _gel(2003, "A42", "E11", "Giro Zero"),
            _gel(2005, "431", "E12", "Giro Zero"), _gel(2006, "432", "E13", "Giro Zero"),
            _gel(2007, "411", "E14", "Giro Zero"), _gel(2007, "411", "E15", "Giro Ok", 9)]
        d["meta_vz"] = [{CO.META_GC: "Gc. G1", CO.META_VZ_GC: "10", CO.MEDIDA_AUX: 1},
                        {CO.META_GC: "Gc. An", CO.META_VZ_GC: "3", CO.MEDIDA_AUX: 1},
                        {CO.META_GC: "Gc. At", CO.META_VZ_GC: "6", CO.MEDIDA_AUX: 1}]
        d["vol_real"] = DADOS["vol_real"] + [_vr(2001, "Refrigerantes", "Acertado", 7.0, rota="151"),
                                             _vr(2003, "Refrigerantes", "Acertado", 5.0, rota="A42", gc="Gc. An")]
        # toda gerência com META_VOLUME e META_COBERTURA no mês (senão o painel fica em fechamento, regra do main)
        d["metas"] = DADOS["metas"] + [
            _meta("Refrigerantes", vol="50", rota="151"), _meta("Cctm 2l Pet", cob="2", rota="151"),
            _meta("Refrigerantes", vol="30", rota="A42"), _meta("Cctm 2l Pet", cob="1", rota="A42"),
            _meta("Refrigerantes", vol="20", rota="A41"), _meta("Cctm 2l Pet", cob="2", rota="A43"),
            _meta("Refrigerantes", vol="40", rota="411"), _meta("Cctm 2l Pet", cob="2", rota="431")]
        # os demais indicadores de cobertura com meta (a validação exige metade disponível)
        d["metas"] += [_meta(v, cob="2", rota=r) for r in ("151", "A41", "A42", "A43", "431", "432", "411")
                       for k, v in M.AGRUPADORES_COBERTURA.items() if k != "CCTM 2L PET"]
        cls.f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0))
        cls.p = montar_payload(cls.f)

    def _ind(self, gc, sv, rota):
        return self.p["DATA"][gc][sv][rota]["indicators"]

    def test_listas_por_rota_no_payload(self):
        self.assertEqual(self.p["NEUTRALIZA_ROTAS"], ["A41", "431", "251", "I31", "M31", "C31", "R31", "S31", "U31",
                                                      "151", "O21", "551"])
        self.assertEqual(self.p["VIRTUAIS_ROTAS"], ["A42", "A43", "A44", "R32"])
        self.assertNotIn("NEUTRALIZA", self.p)
        self.assertEqual(self.p["OCULTAS"], ["SV.G3.3"])
        self.assertEqual(self.p["GC_SEM_OCULTAS"], ["AT"])
        self.assertEqual(fontes.rotas_neutraliza(self.f.clientes), {"151", "A41", "431"})
        self.assertEqual(fontes.rotas_virtuais(self.f.clientes), {"A42", "A43"})

    def test_neutraliza_e_virtuais_fora_da_venda_zero(self):
        for gc, sv, r in [("G1", "SV.G1.5", "151"), ("AN", "SV.AN.4", "A41"), ("AN", "SV.AN.4", "A42"),
                          ("AT", "SV.AT.3", "431")]:
            self.assertTrue(self._ind(gc, sv, r)["VENDAZERO"]["unavailable"], r)
            self.assertNotIn(r, self.p["VENDAZERO_CLIENTES"])
            self.assertNotIn(r, self.p["COMODATO_ATIVOS"])
            self.assertEqual(self.p["REVERTIDO_HOJE"][r], 0)
        # a meta de VZ da gerência fica toda com as rotas normais (G1: 111; AT: 432 e 411, pelas geladeiras)
        self.assertEqual(self._ind("G1", "SV.G1.1", "111")["VENDAZERO"]["meta"], 10)
        self.assertEqual((self._ind("AT", "SV.AT.3", "432")["VENDAZERO"]["meta"],
                          self._ind("AT", "SV.AT.1", "411")["VENDAZERO"]["meta"]), (2, 4))
        # AN só tem Neutraliza e virtuais: a meta não tem para onde ir
        self.assertNotIn("A41", self.f.vz_meta)

    def test_411_e_normal(self):
        self.assertNotIn("411", M.NEUTRALIZA_ROTAS + M.VIRTUAIS_ROTAS)
        self.assertEqual([e["pv"] for e in self.p["VENDAZERO_CLIENTES"]["411"]], [2007])
        self.assertEqual(self.p["COMODATO_ATIVOS"]["411"], {"2007": 1})

    def test_tag_e_gdm_da_neutraliza_sim_da_virtual_nao(self):
        self.assertEqual(self.p["COMODATO_CLIENTE"]["151"]["2001"], [60.0, 7.0, "zero", 2])
        self.assertEqual(self.p["COMODATO_CLIENTE"]["431"]["2005"], [30.0, 0.0, "zero", 1])
        self.assertNotIn("A42", self.p["COMODATO_CLIENTE"])

    def test_virtuais_no_total_da_gerencia(self):
        an = [d["indicators"]["VOL REFRIGERANTES"] for svs in self.p["DATA"]["AN"].values() for d in svs.values()]
        self.assertEqual((modelo.agrega_volume(an)["meta"], modelo.agrega_volume(an)["real"]), (50.0, 5.0))   # A41 + A42
        cob = [d["indicators"]["CCTM 2L PET"] for svs in self.p["DATA"]["AN"].values() for d in svs.values()]
        self.assertEqual(sum(b["meta"] for b in cob if not b["unavailable"]), 3)                 # A42 + A43

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
        _em(_venda(3001, "Del Valle Frut", vol=6.0, vol_on=4.0, meta_cli=12.0), "211", "Gc. G2"),
        _em(_venda(3001, "Refrigerantes", vol=10.0, vol_on=1.0, meta_cli=30.0), "211", "Gc. G2"),
        _em(_venda(1015300, "Del Valle Frut", vol_on=9.0, meta_cli=5.0), "111"),               # DV na G1: ignorado
    ]
    d["vol_real"] = DADOS["vol_real"] + [_em(_vr(3001, "Del Valle Frut", "Acertado", 6.0), "211", "Gc. G2"),
                                         _em(_vr(3001, "Refrigerantes", "Acertado", 10.0), "211", "Gc. G2"),
                                         _em(_vr(1015300, "Del Valle Frut", "Acertado", 99.0), "111")]
    # a G2 precisa de META_COBERTURA no mês (senão o painel fica em fechamento, regra do main)
    d["metas"] = DADOS["metas"] + [_meta("Del Valle Frut", vol="20", rota="211"), _meta("Refrigerantes", vol="40", rota="211"),
                                   _meta("Del Valle Frut", vol="77", rota="111")] + [
        _meta(v, cob="4", rota="211") for v in M.AGRUPADORES_COBERTURA.values()]
    d["meta_neg"] = DADOS["meta_neg"] + [_em(_dia("Del Valle Frut", "2026-10-01", CM.META_NEG, 15.0), "211", "Gc. G2"),
                                         _em(_dia("Del Valle Frut", "2026-10-20", CM.META_NEG, 5.0), "211", "Gc. G2")]
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

    def test_agrupador_oficial(self):
        self.assertEqual(M.AGRUPADORES_VOLUME_EXTRA[DV], "Del Valle Frut")
        self.assertIn("Del Valle Frut", M.AGRUPADORES_CONSULTA_VENDAS)
        self.assertNotIn("DV Frut", M.AGRUPADORES_CONSULTA_VENDAS)
        self.assertEqual(M.indicador_volume("DEL VALLE FRUT"), DV)
        self.assertIsNone(M.indicador_volume("Dv Frut"))           # mesmos números na fonte, mas não é o oficial
        self.assertFalse([a for a in self.f.avisos if a.startswith("Del Valle Frut")])

    def test_sem_meta_sem_card_e_com_aviso(self):
        d = _dados_dv()
        d["metas"] = [l for l in d["metas"] if l[CM.META_AGRUPADOR] != "Del Valle Frut"]
        d["meta_neg"] = [l for l in d["meta_neg"] if l[CM.AGRUPADOR] != "Del Valle Frut"]
        f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0))
        p = montar_payload(f)
        # indicador indisponível: o front não mostra o card (nem na gerência, nem na rota)
        self.assertTrue(p["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"][DV]["unavailable"])
        self.assertIn("Del Valle Frut: G2 sem meta (META_VOLUME e META_NEG de 'Del Valle Frut' zeradas ou ausentes): "
                      "o card não aparece", f.avisos)
        self.assertEqual(validar_payload(p)[0], [])

    def test_aviso_de_curva_escalonada_com_o_rotulo_do_extra(self):
        # META_NEG pela rota da meta (como no Datasphere) e META_VOLUME da 211 a mais de 1% dela: Neg Restante
        # escalonado e a rota vai para o aviso (com o rótulo de VOLUME_EXTRA, que não está em LABELS)
        d = _dados_dv()
        d["meta_neg"] = [dict(l, **{CM.META_ROTA: l[CM.ROTA]}) for l in d["meta_neg"]]
        d["metas"] = [l for l in d["metas"] if (l[CM.META_AGRUPADOR], l[CM.META_ROTA]) != ("Del Valle Frut", "211")]
        d["metas"].append(_meta("Del Valle Frut", vol="30", rota="211"))
        f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0))
        self.assertTrue(any(a.startswith("Neg Restante escalonado") and "211/Del Valle Frut" in a for a in f.avisos),
                        f.avisos)
        dv = montar_payload(f)["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"][DV]
        self.assertEqual((dv["meta"], dv["negRestante"]), (30.0, 7.5))      # 30 x 5/20

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
        # os 17 + Del Valle Frut, Sucos e Ades + os 3 do incentivo (aba Incentivo)
        self.assertEqual(len(M.AGRUPADORES_CONSULTA_VENDAS), 20 + len(M.AGRUPADORES_INCENTIVO))
        # cliente 3001 só comprou Refrigerantes e DV: conta como comprou (Refrigerantes é do painel)
        self.assertEqual(self.p["DATA"]["G2"]["SV.G2.1"]["211"]["compraram"], 1)
        d = _dados_dv()
        d["vendas"] = [l for l in d["vendas"] if not (l[CM.ROTA] == "211" and l[CM.AGRUPADOR] == "Refrigerantes")]
        d["vol_real"] = [l for l in d["vol_real"] if l[CM.ROTA] != "211" or l[CM.AGRUPADOR] == "Del Valle Frut"]
        f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0))
        self.assertNotIn("211", f.compraram)                      # só DV Frut não é compra do painel
        self.assertNotIn("211", f.online.qualquer)


if __name__ == "__main__":
    unittest.main()
