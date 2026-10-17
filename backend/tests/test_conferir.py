"""scripts/conferir_tendencia.py contra o Datasphere simulado: todas as etapas rodam e o relatório não
traz nome nem código de cliente."""
import copy
import importlib.util
import unittest
from datetime import date
from pathlib import Path

from tests.test_fontes import CM, DADOS, ConsultaFalsa

_spec = importlib.util.spec_from_file_location(
    "conferir_tendencia", Path(__file__).resolve().parents[1] / "scripts" / "conferir_tendencia.py")
conferir_tendencia = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(conferir_tendencia)


class TestConferir(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dados = copy.deepcopy(DADOS)
        for l in dados["vendas"]:
            l[CM.DATA] = "2026-10-13"          # NF de hoje para medir a sobreposição com o online
        cls.rel, _ = conferir_tendencia.conferir(ConsultaFalsa(dados), date(2026, 10, 13))
        cls.txt = cls.rel.texto("teste")

    def test_todas_as_etapas(self):
        self.assertNotIn("ERRO", self.txt)
        for t in ["1. NF_STATUS", "2. META_RECUPERAVEL_ROTA", "3. Volume", "4. Sobreposição", "5. Metas",
                  "6. Comodato", "7. Tempo"]:
            self.assertIn(t, self.txt)
        self.assertIn("Modo: **normal**", self.txt)
        self.assertIn("'Cancelada'", self.txt)
        self.assertIn("DATA_MOVIMENTO eq '2026-10-13'", self.txt)
        self.assertIn("| G1 | Refrigerantes | 2 | 2 | 'Acertado' | 1 | 2,5 | 6,0 |", self.txt)
        self.assertIn("`GIRO_STATUS_MES_ATUAL`", self.txt)
        self.assertIn("`ANOMES_REF_Gerncia_Comerc`", self.txt)
        self.assertNotIn("NM_NOME_FANTASIA", self.txt)

    def test_sem_cliente_no_relatorio(self):
        for pv in ["1007382", "1011537", "1015300", "1200000", "PIRATAS", "Piratas", "DUTRA", "Dutra"]:
            self.assertNotIn(pv, self.txt)

    def test_literal_de_data(self):
        f = conferir_tendencia._literal_data
        self.assertEqual(f("Edm.Date", "2026-10-13"), "2026-10-13")
        self.assertEqual(f("Edm.DateTimeOffset", "2026-10-13T00:00:00Z"), "2026-10-13T00:00:00Z")
        self.assertEqual(f("Edm.String", "20261013"), "'20261013'")
        self.assertEqual(f(None, "2026-10-13"), "'2026-10-13'")


if __name__ == "__main__":
    unittest.main()
