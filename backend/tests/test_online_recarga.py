"""
Janela de recarga do Datasphere (19/10/2026: 0 vendas online às 09:28 e 199 rotas às 10:13): em dia útil, das
07:00 às 18:45, consulta sem nenhum cliente online não substitui o online.json publicado do mesmo dia (com dados);
o payload da rodada calcula os revertidos da Venda Zero com o online mantido. Fora disso, tudo como antes.
"""
import contextlib
import copy
import importlib.util
import io
import json
import logging
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from gerador import mapeamento as M
from gerador.online import do_publicado, manter_publicado, sem_vendas
from gerador.saida import serializar
from gerador.tipos import Online
from tests.test_fontes import CM, DADOS, ConsultaFalsa

_spec = importlib.util.spec_from_file_location("gerar", Path(__file__).resolve().parents[1] / "scripts" / "gerar.py")
gerar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gerar)

PUBLICADO = {"updatedAt": "2026-10-19T09:17:02", "rotas": {"111": {"KS TT": 1}},
             "clientes": {"111": {"KS TT": [1011537], "QUALQUER": [1011537, 1015300]}},
             "volume": {"111": {"VOL REFRIGERANTES": 3.75}}, "volumeCliente": {}, "gdmCliente": {}}
SEG_0928 = datetime(2026, 10, 19, 9, 28)          # segunda-feira


def _vazio():
    return Online(atualizado_em=SEG_0928)


class TestManterPublicado(unittest.TestCase):
    def test_vazio_em_dia_util_mantem_o_publicado_do_mesmo_dia(self):
        self.assertTrue(sem_vendas(_vazio()))
        self.assertEqual(manter_publicado(_vazio(), PUBLICADO, SEG_0928),
                         "consulta online sem nenhum cliente às 09:28 (Datasphere em recarga?): mantido o online.json "
                         "publicado às 09:17")

    def test_limites_da_janela(self):
        for h, m, mantem in [(7, 0, True), (18, 45, True), (6, 59, False), (18, 46, False)]:
            agora = datetime(2026, 10, 19, h, m)
            self.assertEqual(manter_publicado(_vazio(), PUBLICADO, agora) is not None, mantem, agora)

    def test_fora_disso_grava_o_novo(self):
        com_venda = Online(atualizado_em=SEG_0928, qualquer={"111": {1015300}})
        self.assertIsNone(manter_publicado(com_venda, PUBLICADO, SEG_0928))                       # veio venda
        self.assertIsNone(manter_publicado(_vazio(), PUBLICADO, datetime(2026, 10, 17, 9, 28)))   # sábado
        feriado = dict(PUBLICADO, updatedAt="2026-11-02T09:00:00")                                # Finados
        self.assertIsNone(manter_publicado(_vazio(), feriado, datetime(2026, 11, 2, 9, 28)))
        ontem = dict(PUBLICADO, updatedAt="2026-10-16T18:40:00")
        self.assertIsNone(manter_publicado(_vazio(), ontem, SEG_0928))                            # outro dia
        self.assertIsNone(manter_publicado(_vazio(), dict(PUBLICADO, clientes={}, volume={}), SEG_0928))
        self.assertIsNone(manter_publicado(_vazio(), None, SEG_0928))                             # nada publicado

    def test_online_do_publicado(self):
        o = do_publicado(PUBLICADO, _vazio())
        self.assertEqual(o.clientes, {"111": {"KS TT": {1011537}}})
        self.assertEqual(o.qualquer, {"111": {1011537, 1015300}})
        self.assertEqual(o.volume, {"111": {"VOL REFRIGERANTES": 3.75}})
        self.assertEqual(o.atualizado_em, SEG_0928)


def _sem_online():
    """Fixture dos testes de fontes (13/10/2026, terça) com a consulta online vazia (Datasphere em recarga)."""
    d = copy.deepcopy(DADOS)
    for l in d["vendas"]:
        l.update({CM.COB_ONLINE: 0, CM.COB_ONLINE_GERAL: 0, CM.VOL_ONLINE: 0.0})
    return d


class TestGerar(unittest.TestCase):
    """gerar.main com o Datasphere simulado: online.json publicado às 09:17 e consulta vazia às 09:28."""

    def _rodar(self, pasta: Path, agora: datetime, *extra: str) -> tuple[int, list[str]]:
        cfg = SimpleNamespace(objeto=M.OBJ_META, space="TESTE", pasta_dados=pasta)
        log = logging.getLogger("gerar.teste")
        with mock.patch.object(gerar, "carregar_config", return_value=cfg), \
                mock.patch.object(gerar, "Consulta", return_value=ConsultaFalsa(_sem_online())), \
                mock.patch.object(gerar, "configurar_log", return_value=log), \
                mock.patch.object(gerar.calendario, "agora", return_value=agora), \
                mock.patch("sys.argv", ["gerar.py", "--saida", str(pasta), "--forcar", *extra]), \
                contextlib.redirect_stdout(io.StringIO()), \
                self.assertLogs("gerar.teste", "INFO") as logs:
            codigo = gerar.main()
        return codigo, logs.output

    def _publicar(self, pasta: Path, updated: str) -> bytes:
        dados = serializar(dict(PUBLICADO, updatedAt=updated, clientes={"111": {"QUALQUER": [1011537]}}))
        (pasta / "online.json").write_bytes(dados)
        return dados

    def test_mantem_o_publicado_e_o_payload_usa_o_online_dele(self):
        with tempfile.TemporaryDirectory() as d:
            pasta = Path(d)
            antes = self._publicar(pasta, "2026-10-13T09:17:02")
            codigo, logs = self._rodar(pasta, datetime(2026, 10, 13, 9, 28))
            self.assertEqual(codigo, 0)
            self.assertEqual((pasta / "online.json").read_bytes(), antes, "o vazio não é gravado")
            self.assertTrue(any("mantido o online.json publicado às 09:17" in m for m in logs), logs)
            p = json.loads((pasta / "payload.json").read_text(encoding="utf-8"))
            # Venda Zero da 111: geladeiras zeradas de 1007382 e 1011537; 1011537 comprou hoje no online mantido
            self.assertEqual(p["REVERTIDO_HOJE"]["111"], 1)
            self.assertEqual([e["revertido"] for e in p["VENDAZERO_CLIENTES"]["111"]], [False, True])

    def test_so_online_tambem_mantem(self):
        with tempfile.TemporaryDirectory() as d:
            pasta = Path(d)
            antes = self._publicar(pasta, "2026-10-13T09:17:02")
            codigo, logs = self._rodar(pasta, datetime(2026, 10, 13, 9, 28), "--so-online")
            self.assertEqual((codigo, (pasta / "online.json").read_bytes()), (0, antes))
            self.assertFalse((pasta / "payload.json").exists())
            self.assertTrue(any("mantido o online.json" in m for m in logs), logs)

    def test_publicado_de_outro_dia_grava_o_vazio(self):
        with tempfile.TemporaryDirectory() as d:
            pasta = Path(d)
            self._publicar(pasta, "2026-10-12T18:40:00")
            codigo, logs = self._rodar(pasta, datetime(2026, 10, 13, 9, 28))
            o = json.loads((pasta / "online.json").read_text(encoding="utf-8"))
            self.assertEqual((codigo, o["updatedAt"], o["clientes"]), (0, "2026-10-13T09:28:00", {}))
            self.assertFalse(any("mantido o online.json" in m for m in logs))
            p = json.loads((pasta / "payload.json").read_text(encoding="utf-8"))
            self.assertEqual(p["REVERTIDO_HOJE"]["111"], 0)


if __name__ == "__main__":
    unittest.main()
