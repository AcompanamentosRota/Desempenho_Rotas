"""
SEM_COMPRA_MES (Etapa 1): clientes do roster sem compra no mês, por rota = roster - comprou (o mesmo `comprou` do
semCompra e do SEM_COMPRA_HOJE). Chave opcional no fim do payload, fora das obrigatórias da validação; a validação só
avisa (tamanho ≠ semCompra, SEM_COMPRA_HOJE fora). Seção E9 do conferir_tendencia.py. Cenário do sintético dos testes
de front (nomes e códigos fictícios), com clientes sem compra no mês, uma rota sem nenhuma venda (sem dado) e as rotas
Neutraliza, virtuais e a oculta das EV* (SL-EV).
"""
import contextlib
import copy
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from gerador import fontes
from gerador import mapeamento as M
from gerador.payload import montar_payload
from gerador.saida import serializar
from gerador.validacao import CHAVES_PAYLOAD, validar_payload
from tests.test_fontes import CM, ConsultaFalsa

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "frontend" / "tests"))
import sintetico  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "conferir_tendencia", Path(__file__).resolve().parents[1] / "scripts" / "conferir_tendencia.py")
conferir_tendencia = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(conferir_tendencia)

ROTA_SEM_VENDA = "G312"        # nenhuma linha na fonte de vendas: sem dado (None)
NEUTRALIZA = "151"             # todos sem compra no mês
VIRTUAL = "A42"


def _sem_compra(pv: int, rota: str) -> bool:
    return pv % 4 == 0 or rota == NEUTRALIZA


def _dados(fechamento: bool) -> dict:
    """Sintético com clientes sem compra no mês (compra e cobertura do mês zeradas; o online de hoje fica)."""
    d = copy.deepcopy(sintetico.dados(fechamento))
    meses = d["vendas"].values() if isinstance(d["vendas"], dict) else [d["vendas"]]
    for i, linhas in enumerate(meses):
        if fechamento and i > 0:
            continue        # 202611: só os pedidos de hoje (o online), não é compra do mês fechado
        linhas[:] = [l for l in linhas if l[CM.ROTA] != ROTA_SEM_VENDA]
        for l in linhas:
            if _sem_compra(int(l[CM.CLIENTE]), l[CM.ROTA]):
                l[CM.COB_MES], l[CM.VOL_MES] = 0, 0
    return d


def _payload(fechamento: bool = False) -> dict:
    agora = datetime(2026, 11, 3, 10, 30) if fechamento else datetime(2026, 10, 13, 10, 30)
    return montar_payload(fontes.carregar(ConsultaFalsa(_dados(fechamento)), agora))


def _rotas(p: dict) -> dict:
    return {r: d for svs in p["DATA"].values() for rotas in svs.values() for r, d in rotas.items()}


class TestSemCompraMes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.normal = _payload()
        cls.fech = _payload(fechamento=True)
        cls.payloads = (cls.normal, cls.fech)

    def test_lista_e_o_roster_menos_quem_comprou(self):
        for p in self.payloads:
            scm, algum = p["SEM_COMPRA_MES"], False
            for r, lista in scm.items():
                if lista is None:
                    continue
                roster = [c[0] for c in p["CLIENT_ROSTER"][r]]
                self.assertEqual(lista, sorted(pv for pv in roster if _sem_compra(pv, r)), r)
                self.assertEqual(lista, sorted(lista), r)
                algum = algum or bool(lista)
            self.assertTrue(algum, "o cenário tem clientes sem compra no mês")

    def test_tamanho_igual_ao_semcompra_em_todas_as_rotas(self):
        for p in self.payloads:
            for r, d in _rotas(p).items():
                lista = p["SEM_COMPRA_MES"].get(r)
                self.assertEqual(None if lista is None else len(lista), d["semCompra"], r)

    def test_sem_compra_hoje_contido(self):
        for p in self.payloads:
            n_hoje = 0
            for r, hoje in p["SEM_COMPRA_HOJE"].items():
                self.assertEqual(hoje is None, p["SEM_COMPRA_MES"][r] is None, r)
                self.assertLessEqual(set(hoje or []), set(p["SEM_COMPRA_MES"][r] or []), r)
                n_hoje += len(hoje or [])
            self.assertGreater(n_hoje, 0)

    def test_mesmas_rotas_e_ordem_do_sem_compra_hoje(self):
        # Neutraliza, virtuais e a rota oculta das EV* seguem a regra das listas de clientes que já existem
        for p in self.payloads:
            self.assertEqual(list(p["SEM_COMPRA_MES"]), list(p["SEM_COMPRA_HOJE"]))
            self.assertEqual(list(p["SEM_COMPRA_MES"]), list(_rotas(p)))
        p = self.normal
        self.assertEqual(p["SEM_COMPRA_MES"][NEUTRALIZA], [c[0] for c in p["CLIENT_ROSTER"][NEUTRALIZA]])
        self.assertIn(NEUTRALIZA, p["NEUTRALIZA_ROTAS"])
        self.assertIn(VIRTUAL, p["VIRTUAIS_ROTAS"])
        self.assertEqual(p["SEM_COMPRA_MES"][VIRTUAL] is None, p["SEM_COMPRA_HOJE"][VIRTUAL] is None)
        self.assertEqual(p["EVENTUAIS_ROTAS"], ["SL-EV"])
        self.assertIsNone(p["SEM_COMPRA_MES"]["SL-EV"])           # sem clientes nem vendas: sem dado, como o hoje
        self.assertIsNone(p["SEM_COMPRA_HOJE"]["SL-EV"])

    def test_rota_sem_dado_e_none(self):
        for p in self.payloads:
            self.assertIsNone(p["SEM_COMPRA_MES"][ROTA_SEM_VENDA])
            self.assertIsNone(_rotas(p)[ROTA_SEM_VENDA]["semCompra"])

    def test_chave_no_fim_e_opcional(self):
        for p in self.payloads:
            self.assertEqual(list(p)[-1], "SEM_COMPRA_MES")
        self.assertNotIn("SEM_COMPRA_MES", CHAVES_PAYLOAD)

    def test_validacao_sem_erro_nem_aviso(self):
        for p in self.payloads:
            erros, avisos = validar_payload(p)
            self.assertEqual(erros, [])
            self.assertFalse([a for a in avisos if "SEM_COMPRA" in a], avisos)

    def test_payload_antigo_sem_a_chave(self):
        p = {k: v for k, v in self.normal.items() if k != "SEM_COMPRA_MES"}
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertFalse([a for a in avisos if "SEM_COMPRA" in a])

    def test_validacao_avisa_tamanho_diferente(self):
        p = copy.deepcopy(self.normal)
        r = next(r for r, l in p["SEM_COMPRA_MES"].items() if l)
        p["SEM_COMPRA_MES"][r] = p["SEM_COMPRA_MES"][r][1:] + [999999901, 999999902]
        p["SEM_COMPRA_MES"][ROTA_SEM_VENDA] = []           # semCompra None e lista vazia: também diverge
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        msg = [a for a in avisos if a.startswith("SEM_COMPRA_MES com tamanho diferente")]
        self.assertEqual(len(msg), 1)
        self.assertIn("2 rota(s)", msg[0])
        self.assertIn(ROTA_SEM_VENDA, msg[0])

    def test_validacao_avisa_sem_compra_hoje_fora(self):
        p = copy.deepcopy(self.normal)
        r = next(r for r, l in p["SEM_COMPRA_HOJE"].items() if l)
        tira = p["SEM_COMPRA_HOJE"][r][0]
        p["SEM_COMPRA_MES"][r] = [pv for pv in p["SEM_COMPRA_MES"][r] if pv != tira] + [999999901]
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertEqual([a for a in avisos if "SEM_COMPRA" in a],
                         [f"SEM_COMPRA_HOJE fora do SEM_COMPRA_MES em 1 rota(s): {r}"])

    def test_serializacao_estavel(self):
        self.assertEqual(serializar(self.normal), serializar(_payload()))


class TestSecaoE9(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = _payload()

    def _texto(self, p, duracao=None):
        rel = conferir_tendencia.Relatorio()
        with contextlib.redirect_stdout(io.StringIO()):
            conferir_tendencia.secao_sem_compra_mes(rel, p, duracao)
        return "\n".join(rel.linhas)

    def test_contagens_por_gerencia(self):
        c = conferir_tendencia.conta_sem_compra_mes(self.p)
        self.assertEqual(c["ordem"], self.p["GC_ATIVAS"])
        rotas = _rotas(self.p)
        self.assertEqual(c["total"]["rotas"], len(rotas))
        self.assertEqual(c["total"]["lista"], sum(d["semCompra"] or 0 for d in rotas.values()))
        self.assertEqual(c["total"]["lista"], c["total"]["semCompra"])
        self.assertEqual((c["total"]["diverge"], c["total"]["fora"]), ([], []))
        g1 = c["por_gc"]["G1"]
        self.assertEqual(g1["lista"], sum(len(self.p["SEM_COMPRA_MES"][r] or []) for r in self.p["DATA"]["G1"]["SV.G1.1"])
                         + sum(len(self.p["SEM_COMPRA_MES"][r] or []) for sv in ("SV.G1.2", "SV.G1.5")
                               for r in self.p["DATA"]["G1"][sv]))
        self.assertEqual(c["por_gc"]["G3"]["com_lista"], c["por_gc"]["G3"]["rotas"] - 1)   # G312 sem dado

    def test_relatorio(self):
        txt = self._texto(self.p, 91)
        n = sum(len(v or []) for v in self.p["SEM_COMPRA_MES"].values())
        self.assertIn("| TOTAL BAND |", txt)
        self.assertIn(f"| {conferir_tendencia._n(n, 0)} | {conferir_tendencia._n(n, 0)} | 0 | 0 |", txt)
        self.assertIn("Tamanho da lista = semCompra em todas as rotas (sem divergência).", txt)
        self.assertIn("SEM_COMPRA_HOJE contido no SEM_COMPRA_MES em todas as rotas.", txt)
        self.assertIn("a chave acrescenta", txt)
        self.assertIn("(limite de atenção: 8 MB)", txt)
        self.assertIn("gerar.py completo 91 s", txt)
        for gc in self.p["GC_ATIVAS"]:
            self.assertIn(f"| {gc} |", txt)

    def test_divergencias_com_codigos_de_rota(self):
        p = copy.deepcopy(self.p)
        r1 = next(r for r, l in p["SEM_COMPRA_MES"].items() if l)
        p["SEM_COMPRA_MES"][r1] = p["SEM_COMPRA_MES"][r1] + [999999901]                  # tamanho diferente
        r2 = next(r for r, l in p["SEM_COMPRA_HOJE"].items() if l and r != r1)
        tira = p["SEM_COMPRA_HOJE"][r2][0]
        p["SEM_COMPRA_MES"][r2] = [pv for pv in p["SEM_COMPRA_MES"][r2] if pv != tira] + [999999902]  # mesmo tamanho
        txt = self._texto(p)
        self.assertIn(f"**Divergência** (tamanho da lista ≠ semCompra) em 1 rota(s): {r1}", txt)
        self.assertIn(f"**SEM_COMPRA_HOJE fora do SEM_COMPRA_MES** em 1 rota(s): {r2}", txt)
        self.assertIn("ver a seção 10", txt)

    def test_sem_nomes_nem_codigos_de_clientes(self):
        txt = self._texto(self.p, 91)
        for r, lista in self.p["CLIENT_ROSTER"].items():
            for c in lista:
                self.assertNotIn(str(c[0]), txt)
                self.assertNotIn(c[1], txt)
        for nome in filter(None, self.p["NOME_SUPERVISOR"].values()):
            self.assertNotIn(nome, txt)
        self.assertNotIn("CONSULTOR", txt)

    def test_sem_payload_ou_sem_a_chave(self):
        self.assertIn("payload.json não gerado", self._texto(None))
        antigo = {k: v for k, v in self.p.items() if k != "SEM_COMPRA_MES"}
        self.assertIn("sem a chave SEM_COMPRA_MES", self._texto(antigo))

    def test_fechamento(self):
        txt = self._texto(_payload(fechamento=True))
        self.assertIn("Fechamento do mês: as listas são de Outubro/26", txt)
        self.assertIn("Tamanho da lista = semCompra em todas as rotas", txt)

    def test_peso(self):
        com, sem, *_ = conferir_tendencia.peso_sem_compra_mes(self.p)
        self.assertEqual(com - sem, len(serializar({"SEM_COMPRA_MES": self.p["SEM_COMPRA_MES"]})) - len(b"{}") + 1)

    def test_linha_de_comando_acrescenta_ao_relatorio(self):
        with tempfile.TemporaryDirectory() as tmp:
            pasta = Path(tmp)
            (pasta / "payload.json").write_bytes(serializar(self.p))
            (pasta / "relatorio_tendencia.md").write_text("# relatório\n\n## 10. gerar.py completo\n", encoding="utf-8")
            argv = sys.argv
            sys.argv = ["conferir_tendencia.py", "--saida", str(pasta), "--e9", str(pasta / "payload.json"),
                        "--e9-duracao", "88"]
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(conferir_tendencia.main(), 0)
            finally:
                sys.argv = argv
            txt = (pasta / "relatorio_tendencia.md").read_text(encoding="utf-8")
            self.assertTrue(txt.startswith("# relatório\n\n## 10. gerar.py completo\n"))
            self.assertIn("## E9. SEM_COMPRA_MES", txt)
            self.assertIn("gerar.py completo 88 s", txt)
            # sem o payload (gerar.py reprovou): a seção diz isso
            (pasta / "payload.json").unlink()
            sys.argv = ["conferir_tendencia.py", "--saida", str(pasta), "--e9", str(pasta / "payload.json")]
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    conferir_tendencia.main()
            finally:
                sys.argv = argv
            self.assertIn("payload.json não gerado", (pasta / "relatorio_tendencia.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
