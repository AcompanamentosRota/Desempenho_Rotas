"""
Aba Incentivo ("Todos a Bordo 3.0", cobertura de cervejas): as 3 chaves INC (Heineken, Eisenbahn - 600ml, Heineken -
600ml) entram pelo mesmo caminho da cobertura do ICS (consulta de vendas, metas e online por indicador), por
igualdade exata do agrupador, fora do ICS e dos Novos Negócios; rota sem meta do item = indisponível (meta e real
null) e sem Real/online no payload e no online.json. Nomes e códigos fictícios.
"""
import copy
import re
import unittest
from datetime import datetime

from gerador import fontes
from gerador import mapeamento as M
from gerador.online import montar_online
from gerador.payload import montar_payload, online_ks_tt
from gerador.validacao import validar_payload
from tests.test_fontes import CB, CM, CO, DADOS, ConsultaFalsa, _cliente, _equip, _meta, _venda, _vr

INC = ["INC HEINEKEN", "INC EISENBAHN 600ML", "INC HEINEKEN 600ML"]
ICS_ANTES = ["CCTM 2L PET", "KS TT", "REFRI SABORES ZERO", "CERVEJAS 600ML RETORNAVEL", "CERVEJAS", "EISENBAHN",
             "KAPO", "POWERADE", "ARTD KO"]
NN_ANTES = ["CAMPARI", "DREHER", "PERFETTI TT", "ARTD KO", "APEROL"]


class ConsultaFiltrada(ConsultaFalsa):
    """Como o servidor, aplica o filtro de agrupador nas consultas de meta (o Datasphere simulado devolve todas)."""

    def linhas(self, objeto, select, filtro=None, top=None, orderby=None):
        linhas = super().linhas(objeto, select, filtro, top, orderby)
        if objeto == M.OBJ_META and CM.META_COBERTURA in select:
            ags = set(re.findall(rf"{CM.META_AGRUPADOR} eq '([^']*)'", filtro or ""))
            linhas = [l for l in linhas if not ags or l.get(CM.META_AGRUPADOR) in ags]
        return linhas


def _cli(pv, rota, gc, sv):
    return dict(_cliente(pv, rota, f"CLIENTE {pv}", "Boteco", "Seg", True, sv=sv), **{CB.GC: gc})


def _v(pv, ag, rota, gc="Gc. G2", **kw):
    return dict(_venda(pv, ag, **kw), **{CM.ROTA: rota, "_gc": gc})


def _dados():
    """111 (G1): Heineken com meta 0 (sem meta) e Eisenbahn - 600ml com meta; 211 (G2): Heineken com meta; 151
    (Neutraliza) e A42 (virtual): Heineken com meta; Heineken - 600ml sem meta em rota nenhuma. Vendas com as
    variantes que NÃO entram ('Heineken - 330ml', 'Heineken Zero', '... Vr', 'C/ Sol Ow')."""
    d = copy.deepcopy(DADOS)
    d[M.OBJ_BASE_CLIENTE] = DADOS[M.OBJ_BASE_CLIENTE] + [
        _cli(3001, "211", "Gc. G2", "Sv. G2. 1"), _cli(3002, "211", "Gc. G2", "Sv. G2. 1"),
        _cli(3003, "211", "Gc. G2", "Sv. G2. 1"), _cli(3004, "211", "Gc. G2", "Sv. G2. 1"),
        _cli(3005, "211", "Gc. G2", "Sv. G2. 1"),
        _cli(2001, "151", "Gc. G1", "Sv. G1.5"), _cli(2003, "A42", "Gc. An", "Sv. An. 4"),
        _cli(2004, "A11", "Gc. An", "Sv. An. 1")]
    d["vendas"] = DADOS["vendas"] + [
        _v(1007382, "Heineken", "111", "Gc. G1", cob=1, on=1),          # 111 sem meta de Heineken: não entra
        _v(1011537, "Eisenbahn - 600ml", "111", "Gc. G1", cob=1, on=1),
        _v(1015300, "Eisenbahn - 600ml Vr", "111", "Gc. G1", cob=1, on=1),
        _v(3001, "Heineken", "211", cob=1, on=1),                       # só Heineken hoje: não é "qualquer compra"
        _v(3002, "Heineken - 330ml", "211", cob=1),
        _v(3003, "Heineken Zero", "211", cob=1, on=1),
        _v(3004, "HEINEKEN - 600ML VR", "211", cob=1),
        _v(3004, "Cervejas 600ml Retornavel C/ Sol Ow", "211", cob=1),
        _v(3005, "Refrigerantes", "211", vol=5.0),
        _v(3005, "heineken", "211", cob=1),                             # mesma grafia sem caixa: entra
        _v(2001, "Heineken", "151", "Gc. G1", cob=1),
        _v(2003, "Heineken", "A42", "Gc. An", cob=1),
    ]
    # metas: as de DADOS sem as do incentivo + as do cenário
    d["metas"] = [l for l in DADOS["metas"] if l[CM.META_AGRUPADOR] not in M.AGRUPADORES_INCENTIVO.values()] + [
        _meta("Heineken", cob="0", rota="111"), _meta("Eisenbahn - 600ml", cob="2", rota="111"),
        _meta("Heineken", cob="3", rota="211"), _meta("Heineken", cob="3", rota="151"),
        _meta("Heineken", cob="3", rota="A42"),
        _meta("Refrigerantes", vol="50", rota="211"), _meta("Refrigerantes", vol="50", rota="A11")]
    # ICS/NN com meta na 211 e na A11 (a validação exige metade da cobertura disponível); 151 e A42 só com Heineken
    d["metas"] += [_meta(v, cob="2", rota=r) for r in ("211", "A11") for k, v in M.AGRUPADORES_COBERTURA.items()
                   if k not in INC]
    d["comodato"] = DADOS["comodato"] + [dict(_equip(3001, "X", "SEG", True, "E31", "Giro Zero", 30, 0),
                                              **{CO.ROTA: "211"})]
    d["meta_vz"] = DADOS["meta_vz"] + [{CO.META_GC: "Gc. G2", CO.META_VZ_GC: "1", CO.MEDIDA_AUX: 1}]
    # clientes numa rota eventual da G1: rota oculta G1-EV, que não tem cobertura
    d["vol_real"] = DADOS["vol_real"] + [dict(_vr(9001, "Refrigerantes", "Acertado", 8.0, rota="EV1"),
                                              **{CM.GC_COMERCIAL: "Gc. G1"})]
    return d


class TestMapeamento(unittest.TestCase):
    def test_chaves_por_igualdade_exata(self):
        for ag, k in [("Heineken", "INC HEINEKEN"), ("HEINEKEN", "INC HEINEKEN"), (" heineken ", "INC HEINEKEN"),
                      ("Eisenbahn - 600ml", "INC EISENBAHN 600ML"), ("EISENBAHN - 600ML", "INC EISENBAHN 600ML"),
                      ("Heineken - 600ml", "INC HEINEKEN 600ML"), ("Cervejas", "CERVEJAS"),
                      ("Cervejas 600ml Retornavel", "CERVEJAS 600ML RETORNAVEL")]:
            self.assertEqual(M.indicador_cobertura(ag), k, ag)
        for ag in ["Heineken - 330ml", "Heineken Zero", "Heineken - 600ml Vr", "HEINEKEN - 600ML VR",
                   "Eisenbahn - 600ml Vr", "Cervejas 600ml Retornavel C/ Sol Ow", "Heineken 600ml", "Eisenbahn 600ml"]:
            self.assertIsNone(M.indicador_cobertura(ag), ag)

    def test_consultas_trazem_os_3_agrupadores(self):
        for v in ["Heineken", "Eisenbahn - 600ml", "Heineken - 600ml"]:
            self.assertIn(v, M.AGRUPADORES_CONSULTA_VENDAS)
            self.assertIn(v, M.AGRUPADORES_METAS_INCENTIVO)
            self.assertNotIn(v, M.AGRUPADORES_CONSULTA_METAS)       # a consulta de metas de antes não muda
        cons = ConsultaFalsa(_dados())
        fontes.carregar(cons, datetime(2026, 10, 13, 9, 0))
        filtro_vendas = [f for o, s, f in cons.chamadas if o == M.OBJ_META and CM.COB_MES in s][0]
        metas = [(s, f) for o, s, f in cons.chamadas if o == M.OBJ_META and CM.META_COBERTURA in s
                 and CM.META_AGRUPADOR in s]
        principal = [f for s, f in metas if CM.META_VOLUME in s]
        incentivo = [(s, f) for s, f in metas if CM.META_VOLUME not in s]
        self.assertEqual(len(principal), 1)
        self.assertEqual([s for s, _ in incentivo], [(CM.META_ROTA, CM.META_AGRUPADOR, CM.META_COBERTURA)])
        for v in ["'Heineken'", "'Eisenbahn - 600ml'", "'Heineken - 600ml'"]:
            self.assertIn(v, filtro_vendas)
            self.assertIn(v, incentivo[0][1])
            self.assertNotIn(v, principal[0])
        self.assertNotIn("Heineken - 330ml", filtro_vendas)

    def test_falha_so_na_meta_do_incentivo_nao_derruba_o_painel(self):
        falha = lambda select, filtro: CM.META_COBERTURA in select and CM.META_VOLUME not in select  # noqa: E731
        f = fontes.carregar(ConsultaFiltrada(_dados(), falha=falha), datetime(2026, 10, 13, 9, 0))
        p = montar_payload(f)
        rotas = [d for svs in p["DATA"].values() for rs in svs.values() for d in rs.values()]
        self.assertTrue(all(d["indicators"][k]["unavailable"] for d in rotas for k in INC))
        self.assertFalse(p["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"]["CCTM 2L PET"]["unavailable"])
        self.assertEqual(validar_payload(p)[0], [])

    def test_fora_do_ics_e_dos_novos_negocios(self):
        self.assertEqual(M.GROUPS["INCENTIVO"], ["CERVEJAS", "INC HEINEKEN", "INC EISENBAHN 600ML", "INC HEINEKEN 600ML",
                                                 "CERVEJAS 600ML RETORNAVEL"])
        self.assertEqual(M.COV_GRUPO["ICS_GC"], ICS_ANTES)
        self.assertEqual(M.COV_GRUPO["NOVOS_NEG"], NN_ANTES)
        self.assertEqual(M.INDICADORES_COBERTURA, list(dict.fromkeys(ICS_ANTES + NN_ANTES)))
        self.assertNotIn("INCENTIVO", M.COV_GRUPO)
        for k in INC:
            self.assertNotIn(k, M.GROUPS["ICS_GC"] + M.GROUPS["NOVOS_NEG"])
        self.assertEqual({M.LABELS[k] for k in M.GROUPS["INCENTIVO"]},
                         {"Cervejas", "Heineken", "Eisenbahn - 600ml", "Heineken - 600ml", "Cervejas 600ml Retornável"})
        self.assertEqual([M.LABELS_CURTO[k] for k in INC], ["Heineken", "Eisenbahn - 600ml", "Heineken - 600ml"])
        # os 17 agrupadores do painel (compras do mês, "qualquer compra hoje", virada do mês) não mudam
        self.assertEqual(len(M.AGRUPADORES_ORIGEM), 17)
        self.assertFalse(any(M.agrupador_do_painel(v) for v in M.AGRUPADORES_INCENTIVO.values()))


class TestPayloadIncentivo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.f = fontes.carregar(ConsultaFiltrada(_dados()), datetime(2026, 10, 13, 9, 0))
        cls.p = montar_payload(cls.f)
        cls.o = montar_online(online_ks_tt(cls.f.online, cls.p, cls.f.segmento_venda))

    def _ind(self, gc, sv, r):
        return self.p["DATA"][gc][sv][r]["indicators"]

    def test_rota_sem_meta_indisponivel_com_meta_e_real_null(self):
        ind = self._ind("G1", "SV.G1.1", "111")
        for k in ["INC HEINEKEN", "INC HEINEKEN 600ML"]:      # meta 0 e sem linha de meta
            self.assertEqual(ind[k], {"meta": None, "real": None, "pct": None, "onPace": None, "gap": None,
                                      "unavailable": True}, k)
        self.assertEqual((ind["INC EISENBAHN 600ML"]["meta"], ind["INC EISENBAHN 600ML"]["real"],
                          ind["INC EISENBAHN 600ML"]["unavailable"]), (2, 1, False))   # a variante 'Vr' não conta

    def test_real_so_do_agrupador_exato_e_regras_do_ics(self):
        b = self._ind("G2", "SV.G2.1", "211")["INC HEINEKEN"]
        # 3001 'Heineken' e 3005 'heineken'; fora: 330ml, Zero, 600ml Vr
        self.assertEqual((b["meta"], b["real"], b["pct"], b["unavailable"]), (3, 2, 67, False))
        self.assertEqual(self.p["COBERTOS"]["211"]["INC HEINEKEN"], [3001, 3005])
        self.assertNotIn("CERVEJAS 600ML RETORNAVEL", self.p["COBERTOS"]["211"])   # 'C/ Sol Ow' não entra
        self.assertEqual(self.p["OPORTUNIDADES_DIA"]["211"]["INC HEINEKEN"], 3)    # 3002, 3003 e 3004 (visita hoje)

    def test_real_e_online_so_de_rotas_com_meta(self):
        self.assertNotIn("INC HEINEKEN", self.p["COBERTOS"]["111"])                # comprou, mas a 111 não tem meta
        self.assertNotIn("INC HEINEKEN", self.p["OPORTUNIDADES_DIA"]["111"])
        self.assertEqual(self.p["COBERTOS"]["111"]["INC EISENBAHN 600ML"], [1011537])
        self.assertNotIn("INC HEINEKEN", self.o["rotas"]["111"])
        self.assertNotIn("INC HEINEKEN", self.o["clientes"]["111"])
        self.assertEqual(self.o["rotas"]["111"]["INC EISENBAHN 600ML"], 1)
        self.assertEqual(self.o["rotas"]["211"], {"INC HEINEKEN": 1})
        self.assertEqual(self.o["clientes"]["211"]["INC HEINEKEN"], [3001])

    def test_compras_qualquer_e_venda_zero_sem_o_incentivo(self):
        # 3001 só comprou Heineken (mês e hoje): não conta como compra do mês nem como "qualquer compra hoje"
        no = self.p["DATA"]["G2"]["SV.G2.1"]["211"]
        self.assertEqual(no["compraram"], 1)                                       # só o 3005 (Refrigerantes)
        self.assertNotIn(3001, self.o["clientes"]["211"].get("QUALQUER", []))
        self.assertNotIn(3003, self.o["clientes"]["211"].get("QUALQUER", []))      # Heineken Zero
        vz = self.p["VENDAZERO_CLIENTES"]["211"]
        self.assertEqual([(e["pv"], e["revertido"]) for e in vz], [(3001, False)])
        self.assertEqual(self.p["REVERTIDO_HOJE"]["211"], 0)

    def test_neutraliza_virtual_e_eventuais(self):
        self.assertEqual((self._ind("G1", "SV.G1.5", "151")["INC HEINEKEN"]["real"],
                          self._ind("AN", "SV.AN.4", "A42")["INC HEINEKEN"]["real"]), (1, 1))
        self.assertIn("G1-EV", self.p["EVENTUAIS_ROTAS"])
        ev = self._ind("G1", "SV.G1.EV", "G1-EV")
        self.assertTrue(all(ev[k]["unavailable"] for k in INC))
        self.assertFalse(any(k in self.p["COBERTOS"].get("G1-EV", {}) for k in INC))

    def test_ordem_do_no_e_validacao(self):
        for gc, svs in self.p["DATA"].items():
            for rotas in svs.values():
                for r, d in rotas.items():
                    self.assertEqual(list(d["indicators"])[:len(M.ORDEM_INDICADORES)], M.ORDEM_INDICADORES, r)
        self.assertEqual(M.ORDEM_INDICADORES[-3:], INC)
        erros, avisos = validar_payload(self.p)
        self.assertEqual(erros, [])
        # Heineken - 600ml sem meta em nenhuma rota da BAND: aviso; Heineken (com meta só em parte) e gerência sem
        # meta do item (BARRACUDA): sem aviso
        self.assertIn('Incentivo: Heineken - 600ml sem meta em nenhuma rota da BAND (o item fica "Sem meta" em todo o '
                      'painel)', avisos)
        self.assertFalse([a for a in avisos if a.startswith("Incentivo: Heineken sem meta")])
        self.assertFalse([a for a in avisos if "Heineken" in a and not a.startswith("Incentivo: Heineken - 600ml")])
        self.assertFalse([a for a in avisos if a.startswith("Incentivo: Cervejas")])

    def test_ics_igual_com_e_sem_o_incentivo(self):
        # o mesmo cenário sem nenhuma linha do incentivo: ICS, NN, Volume, compras e online fora as chaves INC iguais
        d = _dados()
        d["vendas"] = [l for l in d["vendas"] if not M.indicador_cobertura(l[CM.AGRUPADOR]) in INC]
        d["metas"] = [l for l in d["metas"] if l[CM.META_AGRUPADOR] not in M.AGRUPADORES_INCENTIVO.values()]
        f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0))
        p = montar_payload(f)
        o = montar_online(online_ks_tt(f.online, p, f.segmento_venda))
        sem = lambda dd: {k: v for k, v in dd.items() if k not in INC}   # noqa: E731
        for gc, svs in p["DATA"].items():
            for sv, rotas in svs.items():
                for r, no in rotas.items():
                    com = self.p["DATA"][gc][sv][r]
                    self.assertEqual(sem(com["indicators"]), sem(no["indicators"]), r)
                    self.assertEqual({k: v for k, v in com.items() if k != "indicators"},
                                     {k: v for k, v in no.items() if k != "indicators"}, r)
        for chave in ["COBERTOS", "OPORTUNIDADES_DIA"]:
            self.assertEqual({r: sem(v) for r, v in self.p[chave].items()}, p[chave], chave)
        for chave in ["SEM_COMPRA_HOJE", "VISITAS_DIA", "VENDAZERO_CLIENTES", "REVERTIDO_HOJE", "OPORTUNIDADE_HOJE",
                      "COV_GRUPO"]:
            self.assertEqual(self.p[chave], p[chave], chave)
        self.assertEqual({r: sem(v) for r, v in self.o["rotas"].items() if sem(v)}, o["rotas"])
        self.assertEqual({r: sem(v) for r, v in self.o["clientes"].items() if sem(v)}, o["clientes"])


class TestFechamentoEValidacao(unittest.TestCase):
    def test_fechamento_mes_anterior_e_online_de_hoje(self):
        d = _dados()
        hoje_on = [dict(l) for l in d["vendas"] if l.get(CM.COB_ONLINE)]
        d = {**d, "vendas": {"202610": d["vendas"], "202611": hoje_on}, "vol_real": {"202610": d["vol_real"]},
             "meta_neg": {"202610": d["meta_neg"]}, "meta_dia": {}, "metas": {"202610": d["metas"]},
             M.OBJ_CALENDARIO: []}
        f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 11, 3, 9, 0))
        p = montar_payload(f)
        o = montar_online(online_ks_tt(f.online, p, f.segmento_venda))
        self.assertTrue(p["FECHAMENTO"])
        b = p["DATA"]["G2"]["SV.G2.1"]["211"]["indicators"]["INC HEINEKEN"]
        self.assertEqual((b["meta"], b["real"], b["unavailable"]), (3, 2, False))   # mês anterior
        self.assertEqual(o["rotas"]["211"], {"INC HEINEKEN": 1})                     # online de hoje
        self.assertEqual(validar_payload(p)[0], [])

    def test_sem_meta_em_toda_a_band_avisa_cada_item(self):
        d = _dados()
        d["metas"] = [l for l in d["metas"] if l[CM.META_AGRUPADOR] not in M.AGRUPADORES_INCENTIVO.values()]
        p = montar_payload(fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0)))
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertEqual([a.split(" sem meta")[0] for a in avisos if a.startswith("Incentivo:")],
                         ["Incentivo: Heineken", "Incentivo: Eisenbahn - 600ml", "Incentivo: Heineken - 600ml"])


if __name__ == "__main__":
    unittest.main()
