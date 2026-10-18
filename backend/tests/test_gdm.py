"""
Parte C: Desempenho GDM e tag de geladeira (COMODATO_CLIENTE no payload, gdmCliente no online.json).

Meta = soma de META_EQPTO das geladeiras Total Ko do cliente; faturado GDM = Vol Real (mesmo filtro de
NF_STATUS) em Refrigerantes, Água Mineral, Sucos, Ades e Powerade; situação = pior GIRO_STATUS_MES_ATUAL
das geladeiras. Nomes fictícios.
"""
import copy
import unittest
from datetime import datetime

from gerador import fontes
from gerador import mapeamento as M
from gerador.online import montar_online
from gerador.payload import montar_payload
from tests.test_fontes import CM, CO, DADOS, ConsultaFalsa, _equip, _venda, _vr
from tests.test_neutraliza_dvfrut import _cli, _em
from tests.test_tendencia_fechamento import _dados_fechamento


def _dados():
    d = copy.deepcopy(DADOS)
    d["comodato"] = DADOS["comodato"] + [
        _equip(1011537, "B", "TER", True, "E4", "Baixo Giro", 20, 5),            # + E2 (Giro Zero) -> zero
        _equip(1015300, "C", "SEG", True, "E5", "< 30 Dias", 10, 0),             # + E3 (Giro Ok) -> 30d
        _equip(1015301, "D", "SEG", False, "E6", "--", 15, 0),                   # desconhecido
        _equip(1015301, "D", "SEG", False, "E7", "Giro Ok", 15, 0),
    ]
    d[M.OBJ_BASE_CLIENTE] = DADOS[M.OBJ_BASE_CLIENTE] + [_cli(1015302, "111", "Gc. G1", "Sv. G1.1"),
                                                         _cli(2001, "151", "Gc. G1", "Sv. G1.5")]
    d["comodato"] += [_equip(1015302, "E", "SEG", False, "E8", "--", 12, 0),
                      _em(_equip(2001, "N", "SEG", True, "E9", "Giro Ok", 30, 9), "151", col_rota=CO.ROTA)]
    # GDM: Refrigerantes já está no fixture (6 + 4 nos status do SAC; 50 'Cancelada' fica fora) + Sucos e Powerade;
    # Cervejas não é GDM
    d["vol_real"] = DADOS["vol_real"] + [_vr(1015300, "Sucos", "Acertado", 2.0), _vr(1015300, "Powerade", "Cancelada", 9.0),
                                         _vr(1011537, "Ades", "Em Aberto", 3.0)]
    d["vendas"] = DADOS["vendas"] + [_venda(1011537, "Sucos", vol_on=1.5), _venda(1015300, "Powerade", on=1, vol_on=0.5)]
    return d


class TestSituacao(unittest.TestCase):
    def test_pior_situacao(self):
        self.assertEqual(fontes.situacao_cliente({"ok", "zero"}), "zero")
        self.assertEqual(fontes.situacao_cliente({"ok", "baixo", "30d"}), "baixo")
        self.assertEqual(fontes.situacao_cliente({"ok", "30d"}), "30d")
        self.assertEqual(fontes.situacao_cliente({"ok"}), "ok")
        self.assertEqual(fontes.situacao_cliente({None, "ok"}), "ok")
        self.assertIsNone(fontes.situacao_cliente({None}))

    def test_grafias(self):
        self.assertEqual({M.SITUACAO_GIRO.get(fontes.normalizar(v)) for v in
                          ["Giro Zero", "BAIXO GIRO", "< 30 Dias", "giro ok"]}, {"zero", "baixo", "30d", "ok"})
        self.assertIsNone(M.SITUACAO_GIRO.get(fontes.normalizar("--")))


class TestComodatoCliente(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with unittest.TestCase().assertLogs("gerador.fontes", "WARNING") as cls.logs:
            cls.f = fontes.carregar(ConsultaFalsa(_dados()), datetime(2026, 10, 13, 9, 0))
        cls.p = montar_payload(cls.f)
        cls.o = montar_online(cls.f.online)
        cls.cc = cls.p["COMODATO_CLIENTE"]["111"]

    def test_situacoes_meta_e_geladeiras(self):
        # E1 aparece duas vezes na fonte (conta uma); Refrigerantes 6 + 4, Sucos 2; Powerade 'Cancelada' fica fora
        self.assertEqual(self.cc["1007382"], [35.0, 0.0, "zero", 1])
        self.assertEqual(self.cc["1011537"], [45.0, 3.0, "zero", 2])
        self.assertEqual(self.cc["1015300"], [35.0, 12.0, "30d", 2])
        self.assertEqual(self.cc["1015301"], [30.0, 0.0, "ok", 2])
        self.assertEqual(self.cc["1015302"], [12.0, 0.0, None, 1])          # status desconhecido

    def test_desconhecido_vai_para_o_log(self):
        self.assertTrue(any("desconhecido" in m for m in self.logs.output), self.logs.output)

    def test_sem_geladeira_e_neutraliza_ficam_fora(self):
        self.assertEqual(set(self.cc), {"1007382", "1011537", "1015300", "1015301", "1015302"})
        self.assertNotIn("151", self.p["COMODATO_CLIENTE"])

    def test_online_gdm(self):
        # 1011537: Refrigerantes 1,25 (fixture base) + Sucos 1,5; 1015300: Refrigerantes 2,5 + Powerade 0,5
        self.assertEqual(self.o["gdmCliente"], {"111": {"1011537": 2.75, "1015300": 3.0}})

    def test_so_online_tambem_gera(self):
        f = fontes.carregar(ConsultaFalsa(_dados()), datetime(2026, 10, 13, 9, 0), so_online=True)
        self.assertEqual(montar_online(f.online)["gdmCliente"], {"111": {"1011537": 2.75, "1015300": 3.0}})

    def test_fechamento_sem_tag_nem_quadrinho(self):
        p = montar_payload(fontes.carregar(ConsultaFalsa(_dados_fechamento()), datetime(2026, 11, 3, 9, 0)))
        self.assertEqual(p["COMODATO_CLIENTE"], {})


if __name__ == "__main__":
    unittest.main()
