"""
Todos a Bordo com o Real como o ICS GC (PN-50, 11/11/2026): no incentivo, meta AUSENTE (rota sem linha de meta do item
na fonte) continua indisponível; meta 0 (linha com META_COBERTURA 0) grava meta 0 e o Real, como os itens do ICS, e a
rota entra nos COBERTOS, nas oportunidades do dia e no online do item. A rota oculta das EV* não muda (só soma o item
na gerência com alguma rota com meta > 0). E a seção E13 do conferir_tendencia.py sobre um payload montado à mão.
Nomes e códigos fictícios.
"""
import copy
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from gerador import fontes
from gerador import mapeamento as M
from gerador.online import montar_online
from gerador.payload import montar_payload, online_ks_tt
from gerador.validacao import validar_payload
from tests.test_fontes import CM, DADOS, ConsultaFalsa, _meta, _venda
from tests.test_incentivo import ConsultaFiltrada, _dados

AGORA = datetime(2026, 10, 13, 9, 0)
HEI, HEI6 = "INC HEINEKEN", "INC HEINEKEN 600ML"

_spec = importlib.util.spec_from_file_location(
    "conferir_tendencia_e13", Path(__file__).resolve().parents[1] / "scripts" / "conferir_tendencia.py")
ct = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ct)


def _ev(pv, ag, gc_comercial="Gc. G1", rota="EV1"):
    return dict(_venda(pv, ag, cob=1), **{CM.ROTA: rota, CM.GC_COMERCIAL: gc_comercial})


def _no(p, gc, sv, r):
    return p["DATA"][gc][sv][r]["indicators"]


class TestMetaZeroNoGerador(unittest.TestCase):
    """Cenário do test_incentivo: G1 com a 111 (Heineken meta 0, 1 cliente coberto) e a 151 (Heineken meta 3, 1 cliente);
    Heineken - 600ml sem linha de meta em rota nenhuma, com uma venda na 211."""

    @classmethod
    def setUpClass(cls):
        d = _dados()
        d["vendas"] = d["vendas"] + [_venda(3002, "Heineken - 600ml", cob=1, on=1) | {CM.ROTA: "211", "_gc": "Gc. G2"}]
        cls.f = fontes.carregar(ConsultaFiltrada(d), AGORA)
        cls.p = montar_payload(cls.f)
        cls.o = montar_online(online_ks_tt(cls.f.online, cls.p, cls.f.segmento_venda))

    def test_meta_zero_grava_meta_0_e_o_real(self):
        b = _no(self.p, "G1", "SV.G1.1", "111")[HEI]
        self.assertEqual((b["meta"], b["real"], b["pct"], b["unavailable"]), (0, 1, None, False))

    def test_sem_linha_de_meta_continua_indisponivel(self):
        for gc, svs in self.p["DATA"].items():
            for rotas in svs.values():
                for r, d in rotas.items():
                    self.assertTrue(d["indicators"][HEI6]["unavailable"], r)
                    self.assertIsNone(d["indicators"][HEI6]["real"], r)
                    self.assertNotIn(HEI6, self.p["COBERTOS"].get(r, {}), r)
                    self.assertNotIn(HEI6, self.p["OPORTUNIDADES_DIA"].get(r, {}), r)
                    self.assertNotIn(HEI6, self.o["rotas"].get(r, {}), r)

    def test_total_da_gerencia_soma_meta_zero_e_meta_positiva(self):
        # como o front soma o escopo com rota com meta > 0: todas as rotas com o item disponível
        bs = [d["indicators"][HEI] for svs in self.p["DATA"]["G1"].values() for d in svs.values()
              if not d["indicators"][HEI]["unavailable"]]
        self.assertEqual((sum(b["meta"] for b in bs), sum(b["real"] for b in bs)), (3, 2))
        self.assertTrue(any(b["meta"] > 0 for b in bs))

    def test_cobertos_oportunidades_e_online_da_rota_com_meta_zero(self):
        self.assertEqual(self.p["COBERTOS"]["111"][HEI], [1007382])
        self.assertIn(HEI, self.p["OPORTUNIDADES_DIA"]["111"])
        self.assertEqual(self.o["clientes"]["111"][HEI], [1007382])

    def test_validacao(self):
        self.assertEqual(validar_payload(self.p)[0], [])


class TestOcultaDasEventuaisNaoMuda(unittest.TestCase):
    """G1 só com linha de Heineken de meta 0 (nenhuma rota com meta > 0): a 111 grava meta 0 e o Real, mas a oculta
    das EV* continua sem o item (inc_da_gc pede meta > 0), como antes da PN-50."""

    def test_oculta_sem_o_item_na_gerencia_so_com_meta_zero(self):
        d = copy.deepcopy(DADOS)
        d["metas"] = [l for l in d["metas"] if l[CM.META_AGRUPADOR] != "Heineken"] + [_meta("Heineken", cob="0")]
        d["vendas"] = DADOS["vendas"] + [_venda(1007382, "Heineken", cob=1), _ev(1300001, "Heineken"),
                                         _ev(1300001, "Cctm 2l Pet")]
        p = montar_payload(fontes.carregar(ConsultaFalsa(d), AGORA))
        ev = _no(p, "G1", "SV.G1.EV", "G1-EV")
        self.assertTrue(ev[HEI]["unavailable"])
        self.assertNotIn(HEI, p["COBERTOS"]["G1-EV"])
        self.assertEqual((ev["CCTM 2L PET"]["real"], ev["CCTM 2L PET"]["unavailable"]), (1, False))   # o ICS continua
        b = _no(p, "G1", "SV.G1.1", "111")[HEI]
        self.assertEqual((b["meta"], b["real"], b["unavailable"]), (0, 1, False))
        # E13: a G1 não tem o item (nenhuma rota com meta > 0); a rota de meta 0 com Real aparece na atenção
        c = ct.conta_incentivo(p)
        self.assertFalse(c["itens"][("G1", HEI)]["tem"])
        self.assertEqual(c["itens"][("G1", HEI)]["zero_sem_item"], ["111"])

    def test_oculta_com_o_item_na_gerencia_com_meta_positiva(self):
        d = copy.deepcopy(DADOS)
        d["metas"] = [l for l in d["metas"] if l[CM.META_AGRUPADOR] != "Heineken"] + [_meta("Heineken", cob="4")]
        d["vendas"] = DADOS["vendas"] + [_ev(1300001, "Heineken")]
        p = montar_payload(fontes.carregar(ConsultaFalsa(d), AGORA))
        ev = _no(p, "G1", "SV.G1.EV", "G1-EV")[HEI]
        self.assertEqual((ev["meta"], ev["real"], ev["unavailable"]), (0, 1, False))


def _b(meta, real):
    if meta is None:
        return {"meta": None, "real": None, "pct": None, "onPace": None, "gap": None, "unavailable": True}
    return {"meta": meta, "real": real, "pct": None, "onPace": False, "gap": 0, "unavailable": False}


def _payload_mao():
    """XA: R1 (meta 10, Real 4), R2 (meta 0, Real 3), R3 (sem linha), XA-EV (oculta, Real 1).
    XB (BARRACUDA): R4 sem linha, R5 meta 0 com Real 2. CERVEJAS (do ICS): meta em R1 e R4; R2 e R5 meta 0 com Real."""
    ind = {
        "R1": {"INC HEINEKEN": _b(10, 4), "CERVEJAS": _b(8, 5)},
        "R2": {"INC HEINEKEN": _b(0, 3), "CERVEJAS": _b(0, 1)},
        "R3": {"INC HEINEKEN": _b(None, None), "CERVEJAS": _b(None, None)},
        "XA-EV": {"INC HEINEKEN": _b(0, 1), "CERVEJAS": _b(0, 2)},
        "R4": {"INC HEINEKEN": _b(None, None), "CERVEJAS": _b(6, 2)},
        "R5": {"INC HEINEKEN": _b(0, 2), "CERVEJAS": _b(0, 1)},
    }
    no = lambda r: {"indicators": ind[r]}  # noqa: E731
    return {
        "GC_ATIVAS": ["XA", "XB"],
        "GROUPS": {"INCENTIVO": ["CERVEJAS", "INC HEINEKEN"]},
        "EVENTUAIS_ROTAS": ["XA-EV"],
        "DATA": {"XA": {"SV.XA.1": {"R1": no("R1"), "R2": no("R2"), "R3": no("R3")}, "SV.XA.EV": {"XA-EV": no("XA-EV")}},
                 "XB": {"SV.XB.1": {"R4": no("R4"), "R5": no("R5")}}},
        "MES_LABEL": "Outubro/26",
    }


class TestConferirE13(unittest.TestCase):
    def setUp(self):
        self.antes = ct.E13_ITENS
        ct.E13_ITENS = ["CERVEJAS", "INC HEINEKEN"]

    def tearDown(self):
        ct.E13_ITENS = self.antes

    def test_conta_por_gerencia_e_band(self):
        on = {"rotas": {"R2": {"INC HEINEKEN": 2}, "R1": {"INC HEINEKEN": 5}}}
        c = ct.conta_incentivo(_payload_mao(), on)
        xa = c["itens"][("XA", "INC HEINEKEN")]
        self.assertEqual((xa["tem"], xa["meta"], xa["real_antes"], xa["real"]), (True, 10, 5, 8))
        self.assertEqual((xa["rotas_disp"], xa["rotas_meta"], xa["zero"], xa["real_zero"]), (3, 1, ["R2"], 3))
        self.assertEqual((xa["online_zero"], xa["rotas_online_zero"]), (2, 1))
        xb = c["itens"][("XB", "INC HEINEKEN")]                       # BARRACUDA: sem o item, sem soma
        self.assertEqual((xb["tem"], xb["real"], xb["zero_sem_item"]), (False, 0, ["R5"]))
        band = c["itens"][("BAND", "INC HEINEKEN")]
        # a BAND tem o item: soma também a R5 da XB (por isso a E13 avisa a diferença contra as gerências)
        self.assertEqual((band["real_antes"], band["real"], band["soma_gcs"]), (5, 10, 8))
        # item do ICS: Real do Todos a Bordo = Real do ICS (todas as rotas disponíveis) nos escopos com o item
        for g in ("XA", "XB", "BAND"):
            a = c["itens"][(g, "CERVEJAS")]
            self.assertTrue(a["tem"], g)
            self.assertEqual(a["real"], a["real_disp"], g)

    def test_secao_so_com_codigos_de_rota_e_gerencia(self):
        rel = ct.Relatorio()
        ct.secao_incentivo_payload(rel, _payload_mao(), None)
        txt = "\n".join(rel.linhas)
        self.assertIn("| XA | sim | 10 | 5 | 8 | 50% | 80% | 3 | 1 | 1 | 3 | — | R2 |", txt)
        self.assertIn("| XB | sem item |", txt)
        self.assertIn("Gerências sem o item (nenhuma rota com meta > 0): 1 (XB).", txt)
        self.assertIn("**Atenção**: gerência sem o item com rota de meta 0 e Real > 0", txt)
        self.assertIn("BAND: Real depois 10 x Σ das gerências 8 (**diferença 2**", txt)
        self.assertIn("igual em todos os escopos com o item.", txt)

    def test_sem_incentivo_e_sem_payload(self):
        rel = ct.Relatorio()
        p = _payload_mao()
        del p["GROUPS"]["INCENTIVO"]
        ct.secao_incentivo_payload(rel, p)
        ct.secao_incentivo_payload(rel, None)
        self.assertIn("payload sem GROUPS.INCENTIVO (aba Todos a Bordo desligada): E13 sem dados.", rel.linhas)
        self.assertTrue(any("E13 sem dados" in l and "não gerado" in l for l in rel.linhas))

    def test_main_e13_insere_antes_da_secao_9(self):
        with tempfile.TemporaryDirectory() as d:
            pasta = Path(d)
            (pasta / "payload.json").write_text(json.dumps(_payload_mao()), encoding="utf-8")
            (pasta / "online.json").write_text(json.dumps({"rotas": {"R2": {"INC HEINEKEN": 1}}}), encoding="utf-8")
            (pasta / "relatorio_tendencia.md").write_text("# R\n\n## 8. Comodato\n\nx\n\n## 9. Tempo das consultas\n\ny\n",
                                                          encoding="utf-8")
            ct.main_e13(pasta / "payload.json", pasta)
            txt = (pasta / "relatorio_tendencia.md").read_text(encoding="utf-8")
        self.assertLess(txt.index("## 8. Comodato"), txt.index("## E13."))
        self.assertLess(txt.index("## E13."), txt.index("## 9. Tempo das consultas"))
        self.assertIn("1 em 1 rota(s)", txt)


class TestIncentivoDoGeradorNaE13(unittest.TestCase):
    def test_payload_do_gerador(self):
        p = montar_payload(fontes.carregar(ConsultaFiltrada(_dados()), AGORA))
        c = ct.conta_incentivo(p)
        g1 = c["itens"][("G1", HEI)]
        self.assertEqual((g1["tem"], g1["meta"], g1["real_antes"], g1["real"], g1["zero"]), (True, 3, 1, 2, ["111"]))
        for k in ct.E13_ICS:
            self.assertIn(k, M.INDICADORES_COBERTURA)


if __name__ == "__main__":
    unittest.main()
