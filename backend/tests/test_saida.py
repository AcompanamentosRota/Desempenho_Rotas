import tempfile
import unittest
from pathlib import Path

from gerador import saida


class TestSaida(unittest.TestCase):
    def test_grava_so_quando_muda(self):
        with tempfile.TemporaryDirectory() as d:
            arq = Path(d) / "x" / "online.json"
            self.assertTrue(saida.gravar(arq, {"a": 1, "b": "ç"}))
            self.assertFalse(saida.gravar(arq, {"a": 1, "b": "ç"}))
            self.assertTrue(saida.gravar(arq, {"a": 2, "b": "ç"}))
            self.assertEqual(arq.read_text(encoding="utf-8"), '{"a":2,"b":"ç"}')
            self.assertFalse(arq.with_suffix(".json.tmp").exists())

    def test_rejeita_nan(self):
        with self.assertRaises(ValueError):
            saida.serializar({"x": float("nan")})


if __name__ == "__main__":
    unittest.main()
