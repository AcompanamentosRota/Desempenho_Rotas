"""
Decisões de 26/10/2026 (medição com dado real no mesmo dia):
- nota fiscal cancelada não é venda: fora da cobertura do mês e das compras do mês ("sem compra"), pelo $filter da
  consulta de vendas (M.FILTRO_SEM_NF_CANCELADA); o Vol Real já ficava só com M.STATUS_NF_REAL;
- a cobertura dos clientes que estão em rotas EV* entra no total da gerência comercial do cliente
  (M.ColMeta.GC_COMERCIAL), na rota oculta da gerência (M.rota_eventuais), com meta 0, no ICS GC, em Novos Negócios
  e no Todos a Bordo (item sem cliente coberto: indisponível);
- online (pedidos de hoje, FONTE 'WF Online'): conta o pedido em qualquer situação ('Inc. e Exp.', 'Cancelado',
  'Reprovado'); antes só 'Inc. e Exp.'.
"""
import copy
import unittest
from datetime import datetime

from gerador import fontes
from gerador import mapeamento as M
from gerador.payload import montar_payload
from gerador.validacao import validar_payload
from tests.test_fontes import CM, DADOS, ConsultaFalsa, _venda

AGORA = datetime(2026, 10, 13, 10, 30)
CCTM = "CCTM 2L PET"


def _cancelada(l):
    return dict(l, **{CM.NF_STATUS: "Cancelada"})


def _ev(pv, ag, gc_comercial, rota="EV1", seg=None):
    l = dict(_venda(pv, ag, cob=1, seg=seg), **{CM.ROTA: rota})
    if gc_comercial is not None:
        l[CM.GC_COMERCIAL] = gc_comercial
    return l


def _no(p, r="111", gc="G1", sv="SV.G1.1"):
    return p["DATA"][gc][sv][r]


class TestNotaCancelada(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        d = copy.deepcopy(DADOS)
        d["vendas"] = DADOS["vendas"] + [
            _cancelada(_venda(1011537, "Cctm 2l Pet", cob=1)),               # só cancelada no item: fora do item
            _cancelada(_venda(1015301, "Cervejas", cob=1, vol=3.0)),         # só cancelada no mês: sem compra
            _cancelada(_venda(1015300, "Cervejas", cob=1, vol=9.0)),         # tem outra NF do item: continua
        ]
        cls.cons = ConsultaFalsa(d)
        cls.f = fontes.carregar(cls.cons, AGORA)
        cls.p = montar_payload(cls.f)

    def test_filtro_na_consulta_de_vendas(self):
        vendas = [filtro for _, sel, filtro in self.cons.chamadas if CM.COB_MES in sel]
        self.assertTrue(vendas)
        self.assertTrue(all(M.FILTRO_SEM_NF_CANCELADA in filtro for filtro in vendas))
        # no $filter, nunca no $select (a consulta não cresce)
        self.assertFalse([sel for _, sel, _ in self.cons.chamadas if CM.COB_MES in sel and CM.NF_STATUS in sel])

    def test_cobertura_sem_as_canceladas(self):
        self.assertEqual(self.f.cobertos["111"][CCTM], {1007382})
        self.assertEqual(self.f.cobertos["111"]["CERVEJAS"], {1015300})
        ind = _no(self.p)["indicators"]
        self.assertEqual((ind[CCTM]["real"], ind["CERVEJAS"]["real"]), (1, 1))
        self.assertEqual(self.p["COBERTOS"]["111"][CCTM], [1007382])

    def test_sem_compra_com_so_nota_cancelada(self):
        self.assertNotIn(1015301, self.f.compraram["111"])
        no = _no(self.p)
        self.assertEqual((no["compraram"], no["semCompra"]), (3, 1))
        self.assertEqual(self.p["SEM_COMPRA_MES"]["111"], [1015301])

    def test_online_e_vol_real_iguais(self):
        self.assertIn(1011537, self.f.online.clientes["111"]["KS TT"])
        self.assertEqual(self.f.volume["111"]["VOL REFRIGERANTES"].real, 13.0)      # Cancelada já ficava fora
        self.assertEqual(validar_payload(self.p)[0], [])


class TestCoberturaDasEventuais(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        d = copy.deepcopy(DADOS)
        d["vendas"] = DADOS["vendas"] + [
            _ev(1300001, "Cctm 2l Pet", "Gc. G1"),
            _ev(1300001, "Heineken", "Gc. G1"),                          # Todos a Bordo (INC HEINEKEN)
            _ev(1300002, "Ks Tt", "Gc. G1", seg="Boteco"),               # KS TT pelo segmento da venda
            _ev(1300003, "Ks Tt", "Gc. G1", seg="Super"),                # segmento não elegível: fora do KS TT
            _ev(1300004, "Campari", "Gc. G1", rota="EV5"),               # outra rota EV* da mesma gerência
            _cancelada(_ev(1300007, "Cctm 2l Pet", "Gc. G1")),           # cancelada: fora
            _ev(1300005, "Cctm 2l Pet", "Gc. Ap"),                       # AP sem rotas no painel: fora (log)
            _ev(1300006, "Cctm 2l Pet", None),                           # sem a gerência comercial: fora (log)
        ]
        cls.d = d
        with unittest.TestCase().assertLogs("gerador.fontes", "WARNING") as log:
            cls.f = fontes.carregar(ConsultaFalsa(d), AGORA)
        cls.log = "\n".join(log.output)
        cls.p = montar_payload(cls.f)

    def test_rota_oculta_pela_gerencia_comercial(self):
        self.assertEqual(self.f.eventuais, {"G1-EV": "G1"})             # sem Vol Real de EV*: criada pela cobertura
        self.assertEqual(self.f.cobertos["G1-EV"], {CCTM: {1300001}, "INC HEINEKEN": {1300001},
                                                    "KS TT": {1300002, 1300003}, "CAMPARI": {1300004}})
        self.assertNotIn("EV1", self.f.cobertos)
        self.assertIn("Cobertura de clientes em rotas EV* da AP fica fora: gerência sem rotas no painel", self.log)
        self.assertIn("Cobertura de clientes em rotas EV* sem gerência comercial do painel", self.log)

    def test_no_payload_com_meta_zero(self):
        p = self.p
        ind = _no(p, "G1-EV", sv="SV.G1.EV")["indicators"]
        for k in (CCTM, "KS TT", "CAMPARI", "INC HEINEKEN"):
            self.assertEqual({c: ind[k][c] for c in ("meta", "real", "pct", "gap", "unavailable")},
                             {"meta": 0, "real": 1, "pct": None, "gap": 0, "unavailable": False}, k)
        self.assertTrue(ind["KAPO"]["unavailable"])                     # item sem cliente coberto
        self.assertTrue(ind["INC EISENBAHN 600ML"]["unavailable"])
        self.assertTrue(ind["VENDAZERO"]["unavailable"])
        self.assertEqual(p["COBERTOS"]["G1-EV"], {CCTM: [1300001], "KS TT": [1300002], "CAMPARI": [1300004],
                                                  "INC HEINEKEN": [1300001]})
        self.assertEqual(p["EVENTUAIS_ROTAS"], ["G1-EV"])
        self.assertIn("G1-EV", p["VIRTUAIS_ROTAS"])
        self.assertEqual(p["CLIENT_ROSTER"]["G1-EV"], [])

    def test_total_da_gerencia_soma_o_real(self):
        nos = [d for svs in self.p["DATA"]["G1"].values() for d in svs.values()]
        disp = [d["indicators"][CCTM] for d in nos if not d["indicators"][CCTM]["unavailable"]]
        self.assertEqual(sum(b["real"] for b in disp), _no(self.p)["indicators"][CCTM]["real"] + 1)
        self.assertEqual(sum(b["meta"] for b in disp), _no(self.p)["indicators"][CCTM]["meta"])

    def test_validacao_sem_aviso_do_ks_tt_da_oculta(self):
        erros, avisos = validar_payload(self.p)
        self.assertEqual(erros, [])
        self.assertFalse([a for a in avisos if "KS TT com real acima" in a and "G1-EV" in a])

    def test_todos_a_bordo_so_na_gerencia_com_meta_do_item(self):
        # G1 sem meta de Heineken (como as BARRACUDA): o cliente EV* que comprou Heineken não soma no item
        d = copy.deepcopy(self.d)
        d["metas"] = [l for l in d["metas"] if l[CM.META_AGRUPADOR] != "Heineken"]
        with self.assertLogs("gerador.fontes", "WARNING"):
            p = montar_payload(fontes.carregar(ConsultaFalsa(d), AGORA))
        ind = _no(p, "G1-EV", sv="SV.G1.EV")["indicators"]
        self.assertTrue(ind["INC HEINEKEN"]["unavailable"])
        self.assertTrue(_no(p)["indicators"]["INC HEINEKEN"]["unavailable"])
        self.assertEqual(ind[CCTM]["real"], 1)                          # o ICS continua
        self.assertNotIn("INC HEINEKEN", p["COBERTOS"]["G1-EV"])

    def test_sem_a_coluna_da_gerencia_comercial_fica_fora(self):
        class SemGc(ConsultaFalsa):
            def colunas(self, objeto):
                return [c for c in super().colunas(objeto) if c != CM.GC_COMERCIAL]
        with self.assertLogs("gerador.fontes", "WARNING") as log:
            f = fontes.carregar(SemGc(copy.deepcopy(self.d)), AGORA)
        self.assertEqual(f.eventuais, {})
        self.assertIn(f"{CM.GC_COMERCIAL} fora do $metadata", "\n".join(log.output))


class TestOnlineEmQualquerSituacao(unittest.TestCase):
    def test_pedido_cancelado_ou_reprovado_conta_no_online(self):
        def _on(pv, ag, situacao, **kw):
            return dict(_venda(pv, ag, **kw), **{CM.FONTE: "WF Online", CM.SITUACAO_PEDIDO: situacao,
                                                 CM.NF_STATUS: "WF Online"})   # o online sempre vem com esse status
        d = copy.deepcopy(DADOS)
        d["vendas"] = DADOS["vendas"] + [
            _on(1007382, "Refrigerantes", "Cancelado", vol_on=7.0),
            _on(1015301, "Cctm 2l Pet", "Reprovado", on=1),
            _on(1015300, "Refrigerantes", "Inc. e Exp.", vol_on=1.0),
        ]
        cons = ConsultaFalsa(d)
        o = fontes.carregar(cons, AGORA).online
        self.assertIn(1007382, o.qualquer["111"])                       # cancelado: compra hoje
        self.assertIn(1015301, o.clientes["111"][CCTM])                 # reprovado: conta no item
        self.assertEqual(o.volume["111"]["VOL REFRIGERANTES"], 2.5 + 1.25 + 7.0 + 1.0)
        self.assertFalse([c for c in cons.chamadas if CM.SITUACAO_PEDIDO in (c[2] or "")])


if __name__ == "__main__":
    unittest.main()
