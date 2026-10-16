"""
fontes.carregar() com um Datasphere simulado: confere a normalização das linhas OData
(códigos, agrupadores, filtros, online, comodato) e a montagem final, sem rede.
Os valores de texto imitam o que a fonte devolve de verdade ('Gc. G1', 'Sv. G1.1', 'Cctm 2l Pet').
"""
import unittest
from datetime import datetime

from gerador import fontes
from gerador import mapeamento as M
from gerador.online import montar_online
from gerador.payload import montar_payload
from gerador.validacao import validar_online, validar_payload

CM, CB, CO, CC = M.ColMeta, M.ColBase, M.ColComodato, M.ColCalendario


def _todas(classe):
    return [v for k, v in vars(classe).items() if not k.startswith("_") and isinstance(v, str)]


class ConsultaFalsa:
    def __init__(self, dados: dict):
        self.dados = dados
        self.chamadas = []

    def colunas(self, objeto):
        return {M.OBJ_META: _todas(CM), M.OBJ_BASE_CLIENTE: _todas(CB),
                M.OBJ_COMODATO: _todas(CO), M.OBJ_CALENDARIO: _todas(CC)}[objeto]

    def linhas(self, objeto, select, filtro=None, top=None, orderby=None):
        self.chamadas.append((objeto, tuple(select), filtro))
        if objeto == M.OBJ_META:
            if CM.META_COBERTURA in select or CM.META_DIA in select:
                return self.dados["metas"]
            linhas = self.dados["vendas"]
            if filtro and f"{CM.GC} eq " in filtro:
                gc = filtro.split(f"{CM.GC} eq '")[1].split("'")[0]
                linhas = [l for l in linhas if l["_gc"] == gc]
            return [{k: v for k, v in l.items() if k in select} for l in linhas]
        if objeto == M.OBJ_COMODATO:
            return self.dados["meta_vz"] if CO.META_VZ_GC in select else self.dados["comodato"]
        return self.dados[objeto]

    def em_paralelo(self, tarefas):
        return {n: self.linhas(*a) for n, a in tarefas.items()}


def _cliente(pv, rota, nome, seg, dia, hoje, rede="", sv="Sv. G1.1"):
    return {CB.ROTA: rota, CB.CLIENTE: f"{pv:010d}", CB.NOME: nome, CB.SEGMENTO: seg, CB.DIA_VISITA: dia,
            CB.VISITA_HOJE: "S" if hoje else "N", CB.GC: "Gc. G1", CB.SUPERVISOR: sv,
            CB.NOME_SUPERVISOR: "Warley Rodrigues Da Mota", CB.VENDEDOR: "Marcos Neves", CB.QUANTIDADE: 1,
            CB.REDE_NOME: rede}


def _venda(pv, ag, cob=0, on=0, vol=0.0, vol_on=0.0, meta_cli=None, seg=None):
    l = {CM.ROTA: "111", CM.CLIENTE: str(pv), CM.AGRUPADOR: ag, CM.COB_MES: cob, CM.COB_ONLINE: on,
         CM.COB_ONLINE_GERAL: 1 if (on or vol_on) else 0, CM.VOL_MES: vol, CM.VOL_ONLINE: vol_on, "_gc": "Gc. G1"}
    if meta_cli is not None:
        l[CM.META_VOLUME_CLIENTE] = meta_cli
    if seg is not None:
        l[CM.SEGMENTO] = seg
    return l


def _meta(ag, cob=None, vol=None, dia=0.0, rota="111"):
    return {CM.META_ROTA: rota, CM.META_AGRUPADOR: ag, CM.META_COBERTURA: cob, CM.META_VOLUME: vol, CM.META_DIA: dia}


def _equip(pv, nome, dia, hoje, equip, giro, meta, vol):
    return {CO.ROTA: "111", CO.CLIENTE: str(pv), CO.NOME: nome, CO.DIA_VISITA: dia, CO.VISITA_HOJE: "S" if hoje else "N",
            CO.EQUIPAMENTO: equip, CO.GIRO: giro, CO.META_EQPTO: meta, CO.VOLUME: vol}


DADOS = {
    M.OBJ_CALENDARIO: [{CC.DATA: "2026-10-13", CC.DIAS_UTEIS_MES: 21, CC.DIA_UTIL: 8, CC.DIAS_RESTANTES: 13}],
    M.OBJ_BASE_CLIENTE: [
        _cliente(1007382, "111", "Piratas Bar", "Boteco", "Qua", False, "Smart Anicuns"),
        _cliente(1011537, "111", "Bar E Merc Dutra", "Mercearia", "Ter", True),
        _cliente(1015300, "111", "Merc N S Aparecida", "Lanchonete", "Seg-Qui", True, "Smart Anicuns"),
        _cliente(1015301, "111", "Novo", "Distribuidor", "--", False),
        _cliente(1099999, "EV1", "Eventual", "Boteco", "Seg", True, sv="Sv. Bl. G1"),
        _cliente(1099998, "112", "Balcao", "Boteco", "Seg", True, sv="Sv. Bl. G1"),
    ],
    "vendas": [
        _venda(1007382, "Cctm 2l Pet", cob=1),
        _venda(1011537, "Ks Tt", cob=1, on=1),
        _venda(1015300, "Refrigerantes", vol=10.0, vol_on=2.5, meta_cli=20.0),
        _venda(1015300, "Cervejas 600ml Retornavel", cob=1),
        _venda(1015300, "Cervejas", cob=1, vol=4.0),
        _venda(1200000, "Ks Tt", cob=1, seg=" Padarias "),     # saiu da base da rota (transferido/desativado)
        _venda(1200001, "Ks Tt", cob=1, seg="Super"),
    ],
    "metas": [
        _meta("Cctm 2l Pet", cob="3", dia=0.4),
        _meta("Ks Tt", cob="2"),
        _meta("Refrigerantes", vol="100.0", dia=5.0),
        _meta("Refrigerantes", vol="1", rota="999"),     # rota fora do painel
    ] + [_meta(v, cob="4") for k, v in M.AGRUPADORES_COBERTURA.items()
         if k not in ("CCTM 2L PET", "KS TT", "CERVEJAS 600ML RETORNAVEL")],
    "comodato": [
        _equip(1007382, "PIRATAS BAR", "QUA", False, "E1", "Giro Zero", 35, 0),
        _equip(1007382, "PIRATAS BAR", "QUA", False, "E1", "Giro Zero", 35, 0),   # linha repetida: conta 1 vez
        _equip(1011537, "BAR E MERC DUTRA", "TER", True, "E2", "Giro Zero", 25, 0),
        _equip(1015300, "X", "SEG", True, "E3", "Giro Ok", 25, 30),
    ],
    "meta_vz": [{CO.META_GC: "Gc. G1", CO.META_VZ_GC: "1", CO.MEDIDA_AUX: 1}],
}


class TestFontes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cons = ConsultaFalsa(DADOS)
        cls.f = fontes.carregar(cls.cons, datetime(2026, 10, 13, 14, 4, 7))
        cls.p = montar_payload(cls.f)
        cls.o = montar_online(cls.f.online)

    def test_clientes_normalizados(self):
        self.assertEqual(list(self.p["CLIENT_ROSTER"]), ["111"])     # balcão (Sv. Bl.) e rota EV ficam fora
        roster = self.p["CLIENT_ROSTER"]["111"]
        self.assertEqual([c[0] for c in roster], [1007382, 1011537, 1015300, 1015301])
        self.assertEqual(roster[0][1], "PIRATAS BAR")
        self.assertEqual(self.p["DIAS"][roster[2][3]], "Seg - Qui")
        self.assertEqual(self.p["DIAS"][roster[3][3]], "")
        self.assertEqual(self.p["SEGS"][roster[0][2]], "Boteco")
        self.assertEqual(self.p["SEGS"][-1], "Distribuidor")          # segmento novo vai para o fim
        self.assertEqual([c[0] for c in self.p["CLIENTES_HOJE"]["111"]], [1011537, 1015300])
        self.assertEqual(self.p["REDES_CLIENTE"]["111"]["SMART ANICUNS"]["clientes"], [1007382, 1015300])
        self.assertEqual(self.p["NOME_SUPERVISOR"], {"SV.G1.1": "WARLEY RODRIGUES DA MOTA"})
        self.assertEqual(self.p["GC_ATIVAS"], ["G1"])
        self.assertEqual(self.p["DATA"]["G1"]["SV.G1.1"]["111"]["consultor"], "MARCOS NEVES")

    def test_indicadores(self):
        d = self.p["DATA"]["G1"]["SV.G1.1"]["111"]
        self.assertEqual(d["baseTotal"], 4)
        self.assertEqual(d["baseKsTt"], 2)                 # boteco + lanchonete
        self.assertEqual(d["compraram"], 3)
        cctm = d["indicators"]["CCTM 2L PET"]
        self.assertEqual((cctm["meta"], cctm["real"], cctm["pct"]), (3, 1, 33))
        self.assertEqual(d["indicators"]["CERVEJAS 600ML RETORNAVEL"]["real"], 1)
        self.assertTrue(d["indicators"]["CERVEJAS 600ML RETORNAVEL"]["unavailable"])  # sem meta
        self.assertEqual(d["indicators"]["CERVEJAS"]["real"], 1)           # 'Cervejas' também é cobertura
        vol = d["indicators"]["VOL REFRIGERANTES"]
        # projeção linear: 10 / 7 dias úteis fechados x 21; meta do dia = META_DIA
        self.assertEqual((vol["meta"], vol["real"], vol["metaDia"], vol["tendencia"]), (100.0, 10.0, 5.0, 30.0))
        self.assertTrue(d["indicators"]["VOL CERVEJAS"]["unavailable"])     # venda sem meta
        vz = d["indicators"]["VENDAZERO"]
        self.assertEqual((vz["meta"], vz["real"], vz["revertidoHoje"], vz["oportunidadeHoje"]), (1, 2, 1, 0))

    def test_ks_tt_pelo_segmento(self):
        # Mercearia da base fica fora; quem saiu da base conta na rota da venda pelo segmento da venda
        self.assertEqual(self.f.segmento_venda, {1200000: "Padarias", 1200001: "Super"})
        self.assertEqual(self.p["COBERTOS"]["111"]["KS TT"], [1200000])
        self.assertEqual(self.p["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]["KS TT"]["real"], 1)

    def test_online(self):
        self.assertEqual(self.o["updatedAt"], "2026-10-13T14:04:07")
        self.assertEqual(self.o["rotas"], {"111": {"KS TT": 1}})
        self.assertEqual(self.o["clientes"]["111"]["QUALQUER"], [1011537, 1015300])
        self.assertEqual(self.o["volume"], {"111": {"VOL REFRIGERANTES": 2.5}})

    def test_volume_cliente_e_comodato(self):
        vc = self.p["VOLUME_CLIENTE"]["111"]
        self.assertEqual(vc["1015300"][0], [20.0, 10.0, 50, 1])
        self.assertIsNone(vc["1007382"][0])
        self.assertEqual(self.p["COMODATO_ATIVOS"]["111"], {"1015300": 1})
        vz = self.p["VENDAZERO_CLIENTES"]["111"]
        self.assertEqual([(e["nome"], e["vdz"], e["tipo"]) for e in vz],
                         [("Piratas Bar", 1, "Geladeira"), ("Bar E Merc Dutra", 1, "Geladeira")])

    def test_filtros_das_consultas(self):
        base = [c for c in self.cons.chamadas if c[0] == M.OBJ_BASE_CLIENTE][0][2]
        self.assertIn("FL_CORRENTE eq 'S'", base)
        self.assertIn("DS_GC_AGRUPADA_ATUAL eq 'Gc. It_Mo'", base)
        vendas = [c for c in self.cons.chamadas if c[0] == M.OBJ_META and CM.COB_MES in c[1]]
        self.assertTrue(all("ANOMES_REF eq '202610'" in c[2] for c in vendas))
        self.assertTrue(any(f"{CM.GC} eq 'Gc. G1'" in c[2] for c in vendas))
        self.assertIn("DS_AGRUPADOR_Agrupador_Prod eq 'Cctm 2l Pet'", vendas[0][2])
        # pedidos de hoje: só 'Inc. e Exp.'; Basis e Meta NEG passam sem filtro
        self.assertTrue(all("(FONTE ne 'WF Online' or SITUACAO_Pedido eq 'Inc. e Exp.')" in c[2] for c in vendas))
        self.assertNotIn("Destilados", vendas[0][2])
        comodato = [c for c in self.cons.chamadas if c[0] == M.OBJ_COMODATO][0][2]
        self.assertIn("Concluído(Contrato)", comodato)

    def test_valida(self):
        self.assertEqual(validar_online(self.o)[0], [])
        erros, _ = validar_payload(self.p)
        self.assertEqual(erros, [])

    def test_validacao_barra_mapeamento_quebrado(self):
        dados = dict(DADOS, metas=DADOS["metas"][:2])
        p = montar_payload(fontes.carregar(ConsultaFalsa(dados), datetime(2026, 10, 13, 14, 0)))
        erros, _ = validar_payload(p)
        self.assertTrue(any("têm meta" in e for e in erros))

    def test_validacao_barra_queda(self):
        anterior = {"MES_LABEL": self.p["MES_LABEL"], "DATA": {"G1": {"SV": {
            str(i): {"baseTotal": 100} for i in range(10)}}}}
        erros, _ = validar_payload(self.p, anterior)
        self.assertTrue(any("caíram" in e for e in erros))

    def test_distribuir_meta(self):
        self.assertEqual(fontes._distribuir(115, {"a": 269, "b": 257, "c": 0}), {"a": 59, "b": 56, "c": 0})
        self.assertEqual(sum(fontes._distribuir(10, {"a": 1, "b": 1, "c": 1}).values()), 10)


if __name__ == "__main__":
    unittest.main()
