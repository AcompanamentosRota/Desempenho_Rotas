"""scripts/conferir_tendencia.py contra o Datasphere simulado: todas as etapas rodam, o relatório não
traz nome nem código de cliente, o aceite contra a tela do SAC (conferencia/sac/*.csv) de 17/10/2026 (G1 e AP)
passa e a seção E7 explica as diferenças contra o SAC por rota."""
import contextlib
import copy
import importlib.util
import io
import tempfile
import unittest
from datetime import date
from pathlib import Path

from gerador import mapeamento as M
from tests.test_fontes import CB, CC, CM, DADOS, ConsultaFalsa, _cliente, _dia, _meta, _vr

_spec = importlib.util.spec_from_file_location(
    "conferir_tendencia", Path(__file__).resolve().parents[1] / "scripts" / "conferir_tendencia.py")
conferir_tendencia = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(conferir_tendencia)


class TestConferir(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dados = copy.deepcopy(DADOS)
        for l in dados["vendas"] + dados["vol_real"]:
            l[CM.DATA] = "2026-10-13"          # NF de hoje para medir a sobreposição com o online
        cls.cons = ConsultaFalsa(dados)
        cls.rel, _ = conferir_tendencia.conferir(cls.cons, date(2026, 10, 13))
        cls.txt = cls.rel.texto("teste")

    def test_todas_as_etapas(self):
        self.assertNotIn("ERRO", self.txt)
        for t in ["1. NF_STATUS", "2. META_RECUPERAVEL_ROTA", "3. Volume", "4. Aceite", "5. Investigação",
                  "6. Sobreposição", "7. Metas", "8. Comodato", "9. Tempo"]:
            self.assertIn(t, self.txt)
        self.assertIn("Modo: **normal**", self.txt)
        self.assertIn("'Cancelada'", self.txt)
        self.assertIn("DATA_MOVIMENTO eq 2026-10-13", self.txt)
        self.assertIn("| G1 | Refrigerantes | 2 | 2 | 'Acertado' | 1 | 2,5 | 6,0 |", self.txt)
        # sem conferencia/sac/refri_2026-10-13.csv: sem aceite e sem a seção E7
        self.assertIn("sem tela do SAC para esta data", self.txt)
        self.assertNotIn("E7.", self.txt)

    def test_volume_novo_ao_lado_do_anterior(self):
        # Meta 120 (META_VOLUME), fração 0,3, Neg Rest. 36, Tend. 49 | anterior: NEG 100, rest. 30, tend. 43
        self.assertIn("| **G1** | Refrigerantes | 63,0 | 13,0 | 120,0 | 0,3000 | 36,0 | 49,0 | 40,83% | 100,0 | 30,0 "
                      "| 43,0 | 43,00% |", self.txt)

    def test_meta_do_dia_por_rota_e_por_cliente(self):
        self.assertIn("| rota 111 | Refrigerantes | 5,0 | 5,0 | 5,0 | 1 | não |", self.txt)
        dia = [c for c in self.cons.chamadas if CM.META_RECUPERAVEL in c[1]]
        self.assertTrue(dia and all(CM.DATA not in c[1] for c in dia))

    def test_privacidade(self):
        for v in ["1007382", "1011537", "1015300", "1200000", "PIRATAS", "Piratas", "DUTRA", "Dutra",
                  "Giro Zero", "WARLEY", "Warley Rodrigues", "MARCOS", "Marcos Neves"]:
            self.assertNotIn(v, self.txt)
        self.assertIn("`GIRO_STATUS_MES_ATUAL`: 2 valores distintos", self.txt)
        self.assertNotIn("NM_NOME_FANTASIA", self.txt)

    def test_tempos_antes_e_depois(self):
        self.assertIn("| gerar.py completo | 189 s |", self.txt)


def _dados_17_10():
    """G1 (rota 111) e AP (rota A11) reproduzindo o SAC de 17/10/2026 em Refrigerantes.

    A META_NEG dos clientes é menor que a meta da rota (parte não distribuída); a curva diária da META_NEG
    é tal que meta da rota x fração restante = Tendência do SAC - Real.
    """
    def ap(c):
        return dict(c, **{CB.GC: "Gc. Ap", CB.SUPERVISOR: "Sv. Ap. 1"})

    def curva(rota, meta_rota, neg_mes, real, tend, gc):
        rest = neg_mes * (tend - real) / meta_rota
        return [dict(_dia("Refrigerantes", "2026-10-01", CM.META_NEG, neg_mes - rest, rota), _gc=gc),
                dict(_dia("Refrigerantes", "2026-10-20", CM.META_NEG, rest, rota), _gc=gc)]

    d = copy.deepcopy(DADOS)
    d[M.OBJ_BASE_CLIENTE] = [_cliente(1, "111", "A", "Boteco", "Seg", True),
                                                ap(_cliente(2, "A11", "B", "Boteco", "Seg", True))]
    d["vendas"] = []
    d["vol_real"] = [_vr(1, "Refrigerantes", "Acertado", 125590.0),
                     _vr(2, "Refrigerantes", "Em Aberto", 121040.0, rota="A11", gc="Gc. Ap")]
    d["metas"] = [_meta("Refrigerantes", cob="10", vol="490003"), _meta("Refrigerantes", cob="10", vol="398000", rota="A11")]
    d["meta_neg"] = (curva("111", 490003.0, 480000.0, 125590.0, 406863.0, "Gc. G1")
                     + curva("A11", 398000.0, 391716.5, 121040.0, 347170.0, "Gc. Ap"))
    d["meta_dia"] = []
    return d


PASTA_SAC = conferir_tendencia.PASTA_SAC
# ok da seção 4 (marcas OK/DIVERGE por célula): Real, Meta, Tendência, %, Meta do dia
MARCAS = [4, 7, 11, 15, 19]


class TestAceiteSac(unittest.TestCase):
    """Seção 4 com a tela do SAC lida de conferencia/sac/refri_AAAA-MM-DD.csv (17 e 18/10 migrados do script)."""

    def test_g1_e_ap_batem_em_17_10(self):
        rel, _ = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 17))
        txt = rel.texto("aceite")
        self.assertNotIn("ERRO", txt)
        self.assertIn("Tela do SAC: `refri_2026-10-17.csv`", txt)
        # sem MetaDia no CSV de 17/10: a meta do dia não é comparada (célula vazia)
        self.assertIn("| G1 | 125.590 | 125.590 | 0 | OK | 490.003 | 490.003 | OK | 406.863 | 406.863 | +0,00% | OK "
                      "| 83,03% | 83,03% | +0,00 | OK | 0 | — | — |  |", txt)
        self.assertIn("| AP | 121.040 | 121.040 | 0 | OK | 398.000 | 398.000 | OK | 347.170 | 347.170 | +0,00% | OK "
                      "| 87,23% | 87,23% | +0,00 | OK |", txt)
        self.assertIn("| G2 | — | 159.417 | — | **DIVERGE** |", txt)      # as outras gerências não estão no fixture
        self.assertIn("| **TOTAL (6 gerências)** | — | 638.051 |", txt)
        self.assertIn("Resultado: **DIVERGE**", txt)
        self.assertLess(txt.index("| AP |"), txt.index("| G1 |"))      # ordem do painel (GC_NOMES)

    def test_aceite_tambem_em_18_10(self):
        txt = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 18))[0].texto("aceite")
        self.assertIn("Tela do SAC: `refri_2026-10-18.csv`", txt)
        self.assertIn("| AP | 121.040 | 121.040 | 0 | OK | 398.000 | 398.000 | OK | 347.170 | 347.170 |", txt)

    def test_sem_tela_do_sac_para_a_data(self):
        txt = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 19))[0].texto("aceite")
        self.assertNotIn("ERRO", txt)
        self.assertIn("sem tela do SAC para esta data", txt)
        self.assertIn("`conferencia/sac/refri_2026-10-19.csv`", txt)
        self.assertNotIn("| OK |", txt)
        self.assertNotIn("E7.", txt)

    def test_data_simulada_usa_o_csv_da_data(self):
        rel, _ = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 17), simulado=True)
        txt = rel.texto("aceite")
        self.assertIn("Data simulada (--hoje)", txt)
        self.assertIn("| G1 | 125.590 | 125.590 | 0 | OK |", txt)

    def test_csv_invalido_da_erro_claro(self):
        with tempfile.TemporaryDirectory() as pasta:
            (Path(pasta) / "refri_2026-10-17.csv").write_text("GC;Real;Meta;Tendencia\nG1;1;2;3\n", encoding="utf-8")
            txt = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 17),
                                              pasta_sac=Path(pasta))[0].texto("aceite")
        self.assertIn("**ERRO em aceite:** `ErroTelaSac: refri_2026-10-17.csv, linha 1: o cabeçalho tem de ser "
                      "GC;Real;Meta;Tendencia;MetaDia", txt)
        self.assertNotIn("E7.", txt)


def _sac(real=None, meta=None, tend=None, dia=None):
    return {"Real": real, "Meta": meta, "Tendencia": tend, "MetaDia": dia}


class TestTolerancias(unittest.TestCase):
    def setUp(self):
        self.sac = conferir_tendencia.ler_tela_sac(PASTA_SAC / "refri_2026-10-20.csv")[1]
        self.api = {g: (v["Real"], v["Meta"], v["Tendencia"], v["MetaDia"]) for g, v in self.sac.items()}

    def _marcas(self, api, gc="G2"):
        linhas, ok = conferir_tendencia.comparar_sac(api, self.sac)
        return [next(l for l in linhas if l[0] == gc)[i] for i in MARCAS], ok

    def test_tudo_igual_bate(self):
        linhas, ok = conferir_tendencia.comparar_sac(self.api, self.sac)
        self.assertTrue(ok)
        self.assertEqual(len(linhas), 17)
        self.assertEqual(linhas[-1][0], "**TOTAL BAND**")
        self.assertEqual(linhas[-1][2], "2.556.089")          # Real das 16 gerências na tela de 20/10
        self.assertEqual([linhas[-1][i] for i in MARCAS], ["OK"] * 5)

    def test_cada_tolerancia(self):
        r, m, t, d = self.api["G2"]
        casos = {
            0: [(r * 1.0009, m, t, d), (r * 1.0011, m, t, d)],          # Real ±0,1%
            2: [(r, m, t * 1.0019, d), (r, m, t * 1.0021, d)],          # Tendência ±0,2%
            4: [(r, m, t, d * 1.0099), (r, m, t, d * 1.0101)],          # Meta do dia ±1%
        }
        for i, (dentro, fora) in casos.items():
            self.assertEqual(self._marcas(dict(self.api, G2=dentro))[0][i], "OK", i)
            marcas, ok = self._marcas(dict(self.api, G2=fora))
            self.assertEqual(marcas[i], "**DIVERGE**", i)
            self.assertFalse(ok)

    def test_percentual_em_pontos(self):
        r, m, t, d = self.api["G2"]
        # % = Tendência / Meta; 0,1 p.p. de 533.000 = 533 cx de tendência (0,11% da tendência: dentro dos 0,2%)
        self.assertEqual(self._marcas(dict(self.api, G2=(r, m, t + 532, d)))[0][3], "OK")
        marcas, ok = self._marcas(dict(self.api, G2=(r, m, t + 534, d)))
        self.assertEqual(marcas[2:4], ["OK", "**DIVERGE**"])
        self.assertFalse(ok)

    def test_meta_exata_em_inteiros(self):
        m = self.api["G2"][1]                 # 533.000
        for meta, esperado in [(m + 0.4999, "OK"), (m - 0.5, "OK"), (m + 1e-9, "OK"), (m + 0.5, "**DIVERGE**"),
                               (m - 0.5001, "**DIVERGE**"), (m + 1, "**DIVERGE**")]:
            r, _, t, d = self.api["G2"]
            self.assertEqual(self._marcas(dict(self.api, G2=(r, meta, t, d)))[0][1], esperado, meta)
        self.assertEqual(conferir_tendencia._inteiro(490002.5), 490003)     # meio para cima (não o do Python)
        self.assertEqual(round(490002.5), 490002)                            # o round() do Python daria isto

    def test_diferenca_pequena_sem_menos_zero(self):
        r, m, t, d = self.api["AT"]
        linhas, _ = conferir_tendencia.comparar_sac(dict(self.api, AT=(r - 0.3, m, t - 0.001, d)), self.sac)
        at = next(l for l in linhas if l[0] == "AT")
        self.assertEqual([at[3], at[10], at[14]], ["0", "+0,00%", "+0,00"])
        self.assertEqual(conferir_tendencia._sinal(-0.106), "-0,11")

    def test_celula_sem_valor_no_csv_nao_e_comparada(self):
        sac = dict(self.sac, G2=_sac(207649, 533000, 499609, None))
        linhas, ok = conferir_tendencia.comparar_sac(dict(self.api, G2=self.api["G2"][:3] + (1.0,)), sac)
        self.assertTrue(ok)
        g2 = next(l for l in linhas if l[0] == "G2")
        self.assertEqual(g2[16:20], ["1", None, None, ""])
        self.assertEqual(linhas[-1][17:20], [None, None, ""])     # total da meta do dia: não comparado

    def test_gerencia_sem_dado_na_api(self):
        api = {g: v for g, v in self.api.items() if g != "PO"}
        linhas, ok = conferir_tendencia.comparar_sac(api, self.sac)
        self.assertFalse(ok)
        self.assertEqual([next(l for l in linhas if l[0] == "PO")[i] for i in MARCAS], ["**DIVERGE**"] * 5)


class TestTelaSac(unittest.TestCase):
    def _le(self, texto: str, encoding="utf-8"):
        with tempfile.TemporaryDirectory() as pasta:
            caminho = Path(pasta) / "refri_2026-10-20.csv"
            caminho.write_bytes(texto.encode(encoding))
            return conferir_tendencia.ler_tela_sac(caminho)

    def test_comentario_linha_vazia_e_valores(self):
        comentario, dados = self._le("# Tela do SAC, 20/10 ~09h\n\n# outro comentário\nGC;Real;Meta;Tendencia;MetaDia\n"
                                     "\nAP;157107;398000;367864;18505\n  # no meio\nGc. G1 ; 166.237 ;490003;;13647,5\n\n")
        self.assertEqual(comentario, "Tela do SAC, 20/10 ~09h")
        self.assertEqual(dados["AP"], _sac(157107.0, 398000.0, 367864.0, 18505.0))
        self.assertEqual(dados["G1"], _sac(166237.0, 490003.0, None, 13647.5))

    def test_cabecalho_sem_acento_e_maiusculas_e_ansi(self):
        _, dados = self._le("# Tendência do SAC\ngc;REAL;meta;Tendência;metadia\nAP;1;2;3;4\n", "cp1252")
        self.assertEqual(dados["AP"], _sac(1.0, 2.0, 3.0, 4.0))

    def test_colunas_erradas(self):
        for texto, msg in [
            ("GC;Real;Meta;Tendencia\nAP;1;2;3\n", "linha 1: o cabeçalho tem de ser GC;Real;Meta;Tendencia;MetaDia"),
            ("# x\nGC,Real,Meta,Tendencia,MetaDia\n", "linha 2: o cabeçalho tem de ser"),
            ("GC;Meta;Real;Tendencia;MetaDia\n", "o cabeçalho tem de ser"),
            ("GC;Real;Meta;Tendencia;MetaDia\nAP;1;2;3\n", "linha 2: 4 colunas; o esperado são 5"),
            ("GC;Real;Meta;Tendencia;MetaDia\nAP;1;2;3;4;5\n", "linha 2: 6 colunas"),
            ("GC;Real;Meta;Tendencia;MetaDia\nXX;1;2;3;4\n", "gerência 'XX' não é uma das siglas"),
            ("GC;Real;Meta;Tendencia;MetaDia\nAP;1;2;3;4\nAP;1;2;3;4\n", "linha 3: gerência AP repetida"),
            ("GC;Real;Meta;Tendencia;MetaDia\nAP;1;dois;3;4\n", "linha 2, Meta: 'dois' não é número"),
            ("# só comentário\n\n", "sem o cabeçalho"),
            ("GC;Real;Meta;Tendencia;MetaDia\n", "nenhuma gerência"),
        ]:
            with self.assertRaises(conferir_tendencia.ErroTelaSac, msg=texto) as ctx:
                self._le(texto)
            self.assertIn(msg, str(ctx.exception), texto)

    def test_arquivos_do_repositorio(self):
        """20/10 com as 16 gerências e a meta do dia; 17 e 18/10 = os 6 valores do aceite antigo, sem a meta do dia."""
        coment, dia20 = conferir_tendencia.ler_tela_sac(PASTA_SAC / "refri_2026-10-20.csv")
        self.assertIn("20/10/2026", coment)
        self.assertEqual(set(dia20), set(M.GC_NOMES))
        self.assertEqual(dia20["AP"], _sac(157107, 398000, 367864, 18505))
        self.assertEqual(dia20["PO"]["MetaDia"], 7109)
        antigo = {"G1": (125590, 490003, 406863, 83.03), "G2": (159417, 533000, 474058, 88.94),
                  "G3": (85913, 218997, 212972, 97.25), "AP": (121040, 398000, 347170, 87.23),
                  "IT": (72513, 195619, 186159, 95.16), "MO": (73578, 184381, 176522, 95.74)}
        for dia in ("17", "18"):
            _, dados = conferir_tendencia.ler_tela_sac(PASTA_SAC / f"refri_2026-10-{dia}.csv")
            self.assertEqual(set(dados), set(antigo))
            for g, (r, m, t, pct) in antigo.items():
                self.assertEqual(dados[g], _sac(r, m, t, None))
                self.assertAlmostEqual(t / m * 100, pct, delta=0.005)     # o % antigo sai de Tendência / Meta
        self.assertFalse(hasattr(conferir_tendencia, "SAC_17_10"))       # a tabela fixa saiu do script


if __name__ == "__main__":
    unittest.main()


class TestRotaClienteXRotaMeta(unittest.TestCase):
    def test_secao_3b(self):
        from tests.test_tendencia_fechamento import _dados_rota_meta
        txt = conferir_tendencia.conferir(ConsultaFalsa(_dados_rota_meta()), date(2026, 10, 13))[0].texto("3b")
        self.assertNotIn("ERRO", txt)
        self.assertIn("3b. Curva da META_NEG", txt)
        # (a) pela rota do cliente: 80 no mês, 30 restante; (b) pela rota da meta: 120 e 45; META_VOLUME 120;
        # atual = 13 + 120 x 30/80 = 58; (b) direto = 13 + 45 = 58; (b) escalonado = 13 + 120 x 45/120 = 58
        self.assertIn("| rota 111 | Refrigerantes | 80,0 | 30,0 | 120,0 | 45,0 | 120,0 | 13,0 | 58,0 |", txt)
        self.assertIn("| rota 514 | Refrigerantes | fora da base de clientes |", txt)
        self.assertIn("| G1 | Refrigerantes | rota do cliente fora do painel | 1 | 40,0 |", txt)
        self.assertIn("curva da META_NEG pela **rota da meta**", txt)


class TestSecoesE(unittest.TestCase):
    """E1-E5 com o cenário sintético do front (15 gerências, Neutraliza, At, DV Frut, Sucos, comodato)."""

    @classmethod
    def setUpClass(cls):
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "frontend" / "tests"))
        import sintetico
        d = sintetico.dados(False)
        d[M.OBJ_BASE_CLIENTE] += [dict(d[M.OBJ_BASE_CLIENTE][0], **{CB.ROTA: "EV9"}),
                                  dict(d[M.OBJ_BASE_CLIENTE][0], **{CB.GC: "Gc. At", CB.SUPERVISOR: "Sv. Bl. At"})]
        cls.txt = conferir_tendencia.conferir(ConsultaFalsa(d), date(2026, 10, 13))[0].texto("E")

    def test_secoes(self):
        self.assertNotIn("ERRO", self.txt)
        for t in ["E1. Gerências nos 3 modelos", "E2. Gc. At", "E3. Agrupadores novos", "E4. Desempenho GDM",
                  "E5. Rotas Neutraliza e virtuais"]:
            self.assertIn(t, self.txt)
        self.assertIn("| AM_BND_BASE_CLIENTE | 'Gc. Pa_Di' | PA, DI | sim |", self.txt)
        self.assertIn("| AT | Atacados | 3 | 7 |", self.txt)
        self.assertIn("| sem vendedor | SV.AT.3 | AT31 |", self.txt)
        self.assertIn("| Neutraliza | SV.AT.3 | 431 |", self.txt)
        self.assertIn("| normal | SV.AT.1 | 411 |", self.txt)
        self.assertIn("`Del Valle Frut` encontrado; `Sucos` encontrado", self.txt)
        # E5 por rota: Meta e Real de Refrigerantes (sintético, G1: meta 1000, real 150 + 300 + 450)
        self.assertIn("| 151 | Neutraliza | G1 | SV.G1.5 | 3 | 1.000,0 | 900,0 |", self.txt)
        self.assertIn("| aparece (linha Neutraliza) |", self.txt)
        self.assertIn("| A42 | virtual | AN | SV.AN.4 | 3 |", self.txt)
        self.assertIn("| oculta (só no total) |", self.txt)
        self.assertIn("| 551 | Neutraliza | — | — | 0 | — | — | — | **fora da base de clientes** (não aparece) |", self.txt)
        self.assertIn("| cliente 20 |", self.txt)
        self.assertNotIn("| cliente 21 |", self.txt)

    def test_sem_pessoas_nem_clientes(self):
        for v in ["CLIENTE TESTE", "SUPERVISOR G1", "CONSULTOR", "ROTA SEM VENDEDOR", "REDE TESTE", "0000010"]:
            self.assertNotIn(v, self.txt)

    def test_del_valle_frut_por_rota_da_g2(self):
        self.assertIn("E3b. Del Valle Frut na G2: meta e real por rota", self.txt)
        # sintético: META_VOLUME 80 e META_NEG 50 + 30 por rota da G2; Vol Real 8 por cliente (3 clientes)
        self.assertIn("| G211 | G2 | normal | 80,0 | 80,0 | 80,0 | 24,0 | 30% |", self.txt)
        self.assertIn("| 251 | G2 | Neutraliza | 80,0 | 80,0 | 80,0 | 24,0 | 30% |", self.txt)
        self.assertIn("Card de Del Valle Frut: **aparece**", self.txt)

    def test_rota_551(self):
        self.assertIn("E5b. Rota 551", self.txt)
        self.assertIn("| clientes correntes e ativos (o que o painel lê) | 0 |", self.txt)
        self.assertIn("a 551 **não aparece** porque não tem cliente corrente e ativo na base de clientes (nenhuma versão)",
                      self.txt)


class TestSecoesSemMetaDv(unittest.TestCase):
    def test_sem_meta_o_card_nao_aparece(self):
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "frontend" / "tests"))
        import sintetico
        txt = conferir_tendencia.conferir(ConsultaFalsa(sintetico.dados(False, sem_meta_dv=True)),
                                          date(2026, 10, 13))[0].texto("E3b")
        self.assertNotIn("ERRO", txt)
        self.assertIn("| G211 | G2 | normal | — | — | — | 24,0 | — |", txt)
        self.assertIn("**Sem meta de `Del Valle Frut`: o card não aparece**", txt)


class TestRota551NaBase(unittest.TestCase):
    """Se a 551 voltar à base de clientes (corrente e ativa), aparece como Neutraliza na gerência dela."""

    def test_volta_como_neutraliza(self):
        d = copy.deepcopy(DADOS)
        d[M.OBJ_BASE_CLIENTE] = DADOS[M.OBJ_BASE_CLIENTE] + [
            dict(_cliente(5501, "551", "X", "Boteco", "Seg", True, sv="Sv. At. 3"), **{CB.GC: "Gc. At"})]
        txt = conferir_tendencia.conferir(ConsultaFalsa(d), date(2026, 10, 13))[0].texto("551")
        self.assertNotIn("ERRO", txt)
        self.assertIn("| clientes correntes e ativos (o que o painel lê) | 1 |", txt)
        self.assertIn("a 551 tem 1 clientes correntes na AT e entra como **Neutraliza** na gerência AT", txt)
        self.assertIn("| 551 | Neutraliza | AT | SV.AT.3 | 1 |", txt)
        self.assertNotIn("5501", txt)


# ---------------------------------------------------------------- E7: diferenças contra o SAC, por rota
ct = conferir_tendencia
COL_GC, COL_SV, COL_GC_META = CM.GC_COMERCIAL, ct.COL_SV_CLIENTE, ct.COL_GC_COMERCIAL_META


class ConsultaE7(ConsultaFalsa):
    """Datasphere simulado com as colunas de supervisão e de gerência da meta que só a E7 lê
    (sem as da gerência agrupada da meta: a 4ª candidata fica fora)."""

    def colunas(self, objeto):
        extra = [COL_SV, COL_GC_META] if objeto == M.OBJ_META else []
        return list(super().colunas(objeto)) + extra


class ConsultaSemGc(ConsultaFalsa):
    """Sem nenhuma coluna de gerência do modelo de vendas no $metadata (nem a comercial do cliente)."""

    def colunas(self, objeto):
        return [c for c in super().colunas(objeto) if c != CM.GC_COMERCIAL]


def _p(gc_rota=None, sv_rota=None, base=None, gc_base=None):
    return ct.Painel(gc_rota or {}, sv_rota or {}, base or {}, gc_base or {})


def _l(rota, gc, valor, rota_meta="", cod=None, sv=None, no_escopo=True, gc_comercial=None):
    return ct.Linha(rota, rota_meta, gc if gc in M.GC_NOMES else None, cod or gc, sv, no_escopo, valor, gc_comercial)


class TestCausas(unittest.TestCase):
    P = _p(gc_rota={"111": "G1", "151": "G1", "311": "G3", "A42": "AN", "T99": "AT", "AP-EV": "AP"},
           sv_rota={"111": "SV.G1.1", "151": "SV.G1.5", "311": "SV.G3.3", "A42": "SV.AN.4", "T99": "SV.G3.3",
                    "AP-EV": "SV.AP.EV"},
           base={"EV5": {"SV.BL.AP"}, "GAP": {"SV.BL.AP"}, "APE": {"SV.BL.AP"}, "EXT": {"SV.ME"},
                 "R1X": {"INVALIDO"}, "111": {"SV.G1.1"}})

    def test_fora_do_painel(self):
        for rota, causa in [("EV5", ct.CAUSA_EV), ("EV9", ct.CAUSA_EV), ("INVALIDO", ct.CAUSA_INVALIDA),
                            ("G1E", ct.CAUSA_INVALIDA), ("G2F", ct.CAUSA_INVALIDA), ("APE", ct.CAUSA_INVALIDA),
                            ("R1X", ct.CAUSA_INVALIDA), ("GAP", ct.CAUSA_BALCAO), ("X99", ct.CAUSA_SEM_CLIENTE),
                            ("G22", ct.CAUSA_SEM_CLIENTE),     # rota da GU (G + 2 dígitos) não é G*E/G*F
                            ("EXT", "outra: supervisão fora do padrão SV.<sigla>.<n> (SV.ME)"),
                            ("", "outra: venda sem rota do cliente")]:
            self.assertEqual(ct.causa_fora_do_painel(rota, self.P), causa, rota)

    def test_tipo_da_rota(self):
        self.assertEqual(ct.tipo_rota("151", self.P), ct.CAUSA_NEUTRALIZA)
        self.assertEqual(ct.tipo_rota("A42", self.P), ct.CAUSA_VIRTUAL)
        self.assertEqual(ct.tipo_rota("AP-EV", self.P), ct.CAUSA_EVENTUAIS)
        self.assertEqual(ct.tipo_rota("311", self.P), "oculta: SV.G3.3")
        self.assertIsNone(ct.tipo_rota("111", self.P))
        self.assertIsNone(ct.tipo_rota("T99", self.P))       # na AT nenhuma supervisão é oculta

    def test_rota_em_que_o_painel_conta(self):
        p = self.P
        self.assertEqual(ct.rota_no_painel(_l("111", "G1", 1), p, False), ("111", "G1"))
        self.assertEqual(ct.rota_no_painel(_l("111", "G1", 1, no_escopo=False), p, False), ("111", None))
        # cliente em rota EV*: na rota oculta da gerência comercial dele (se a gerência tem a rota oculta), só a venda
        # com rota da meta (27/10/2026, como o SAC)
        self.assertEqual(ct.rota_no_painel(_l("EV5", "AP", 1, "A11", gc_comercial="AP"), p, False), ("AP-EV", "AP"))
        self.assertEqual(ct.rota_no_painel(_l("EV5", "AP", 1, gc_comercial="AP"), p, False), ("EV5", None))
        self.assertEqual(ct.rota_no_painel(_l("EV5", "G3", 1, "311", gc_comercial="G3"), p, False), ("EV5", None))
        self.assertEqual(ct.rota_no_painel(_l("EV5", "AP", 1), p, False), ("EV5", None))
        self.assertEqual(ct.rota_no_painel(_l("GAP", "AP", 1, gc_comercial="AP"), p, False), ("GAP", None))
        # meta do dia: pela rota da meta, sem escopo
        self.assertEqual(ct.rota_no_painel(_l("EV5", "AP", 1, "151", no_escopo=False), p, True), ("151", "G1"))
        self.assertEqual(ct.rota_no_painel(_l("111", "G1", 1, ""), p, True), ("", None))

    def test_contribuicoes_do_real(self):
        linhas = [_l("111", "G1", 100), _l("111", "G2", 30, sv="SV.G2.1"),             # rota atribuída a outra gerência
                  _l("EV5", "AP", 50, "535", sv="SV.BL.AP", gc_comercial="AP"),        # na rota oculta da AP: bate
                  _l("EV5", "G3", 9, "EV5", gc_comercial="G3"),                       # a G3 não tem rota oculta
                  _l("EV6", "G1", 7, "A11", gc_comercial="AP"),                       # rota oculta da AP, modelo G1
                  _l("GAP", "AP", 7), _l("APE", "AP", 3), _l("X99", "AP", 2),
                  _l("151", None, 4, cod="ME"), _l("A42", None, 8, cod="ME"), _l("311", None, 6, cod="ME"),
                  _l("111", "G1", 5, no_escopo=False), _l("EV5", None, 9, cod="ME")]  # ninguém conta a última
        p = self.P._replace(gc_rota=dict(self.P.gc_rota, **{"535": "AP"}), gc_base={"EV5": "AP"})
        r = ct.contribuicoes(linhas, p, por_rota_meta=False)
        c = {g: {(k[0], k[2]): round(v, 6) for k, v in d.items()} for g, d in r.por_gc.items()}
        self.assertEqual(c["G1"], {("111", ct.CAUSA_OUTRA_GC): 30, ("151", ct.CAUSA_NEUTRALIZA): 4,
                                   ("111", "outra: gerência agrupada do cliente fora das do painel"): -5,
                                   ("EV6", ct.CAUSA_OUTRA_GC): -7})
        self.assertEqual(c["G2"], {("111", ct.CAUSA_OUTRA_GC): -30})
        self.assertEqual(c["AP"], {("GAP", ct.CAUSA_BALCAO): -7, ("APE", ct.CAUSA_INVALIDA): -3,
                                   ("X99", ct.CAUSA_SEM_CLIENTE): -2, ("EV6", ct.CAUSA_OUTRA_GC): 7})
        self.assertEqual(c["AN"], {("A42", ct.CAUSA_VIRTUAL): 8})
        self.assertEqual(c["G3"], {("311", "oculta: SV.G3.3"): 6, ("EV5", ct.CAUSA_EV): -9})
        self.assertEqual(r.deslocamentos, {("111", "G1", "G2"): 30, ("AP-EV", "AP", "G1"): 7})
        self.assertEqual(r.fora_outra_gc, {("EV5", "AP", "G3"): -9})
        self.assertEqual(r.hipoteses, {"a": -21, "b": 37})
        det = {k[0]: k[3] for g in ("G3", "AP") for k in r.por_gc[g]}
        self.assertEqual(det["EV5"], "a G3 não tem rota oculta das EV*; rota da AP na base")
        self.assertIn("rota AP-EV no painel; clientes em rotas EV* (rota oculta, entra no total)", det["EV6"])

    def test_venda_em_rota_ev_sem_rota_da_meta(self):
        # o painel não soma na rota oculta; pela gerência comercial o modelo soma (contribuição), pela da meta não
        r = ct.contribuicoes([_l("EVF", "AP", 5, gc_comercial="AP"),
                              _l("EVF", None, 3, cod="--", gc_comercial="AP")], self.P, por_rota_meta=False)
        self.assertEqual(r.por_gc, {"AP": {("EVF", "", ct.CAUSA_EV, "venda sem rota da meta (fora da rota oculta)"): -5}})

    def test_contribuicoes_da_meta_do_dia_pela_rota_da_meta(self):
        p = _p(gc_rota={"A11": "AP", "112": "G1", "211": "G2", "111": "G1", "151": "G1"},
               base={"EV5": {"SV.BL.AP"}})
        linhas = [_l("EV5", "AP", 15, "A11"),           # cliente na EV5 com a meta da A11: o painel conta na A11
                  _l("112", "G2", 5, "211"),            # meta da 211 (G2), cliente da G2 no modelo: bate
                  _l("112", "G1", 4, "211"),            # meta da 211 (G2), cliente da G1 no modelo
                  _l("A11", "AP", 6, "EV7"),            # meta numa rota fora do painel, cliente na A11
                  _l("111", "G1", 2),                   # sem rota da meta
                  _l("111", "G1", 3, "151")]            # outra rota da mesma gerência: bate
        r = ct.contribuicoes(linhas, p, por_rota_meta=True)
        self.assertEqual(r.por_gc["AP"], {("A11", "EV7", ct.CAUSA_ROTA_META,
                                           "rota da meta EV7 (fora do painel: EV*); cliente na rota A11 da AP no painel"): -6})
        self.assertEqual(r.por_gc["G2"], {("112", "211", ct.CAUSA_OUTRA_GC, "gerência do modelo G1"): 4})
        self.assertEqual(r.por_gc["G1"], {("112", "211", ct.CAUSA_OUTRA_GC, "rota 211 na G2 no painel"): -4,
                                          ("111", "", "outra: meta do dia sem rota da meta", "cliente na rota 111"): -2})
        self.assertEqual(r.deslocamentos, {("211", "G2", "G1"): 4})
        self.assertEqual(r.hipoteses, {"a": -6, "d": -6, "b": 4})

    def test_reconciliacao_e_residuo(self):
        contrib = {("EV5", "", ct.CAUSA_EV, ""): -12.0, ("GAP", "", ct.CAUSA_BALCAO, ""): -3.0}
        self.assertEqual(ct.reconciliar(100.0, 120.0, contrib), (-20.0, -15.0, -5.0))
        self.assertEqual(ct.reconciliar(None, 120.0, contrib), (None, -15.0, None))
        self.assertEqual(ct.resumo_causas(contrib), [(ct.CAUSA_EV, -12.0), (ct.CAUSA_BALCAO, -3.0)])
        self.assertIn("**resíduo -5 cx sem causa encontrada**", ct._explicado(-20.0, contrib, -5.0))
        self.assertEqual(ct._explicado(-15.4, contrib, -0.4),
                         "-15 cx: explicado por: fora do painel: EV* (-12 cx); fora do painel: SV.BL.* (-3 cx) · resíduo 0 cx")

    def test_so_as_12_maiores_e_o_total_das_demais(self):
        rel = ct.Relatorio()
        contrib = {(f"EV{i}", "", ct.CAUSA_EV, ""): -float(i) for i in range(1, 16)}
        with contextlib.redirect_stdout(io.StringIO()):
            ct._tabela_contrib(rel, contrib, False)
        txt = "\n".join(rel.linhas)
        self.assertIn("| EV15 | — | fora do painel: EV* | — | -15,0 |", txt)
        self.assertIn("| EV4 |", txt)
        self.assertNotIn("| EV3 |", txt)
        self.assertIn("| demais (3) |  |  |  | -6,0 |", txt)


def _dados_e7():
    """Painel e modelo de vendas sintéticos (20/10/2026) com uma diferença de cada causa; o CSV do SAC é o
    modelo pela gerência comercial do cliente, com 10 cx a mais na AP (resíduo)."""
    def cli(pv, rota, gc, sv):
        return dict(_cliente(pv, rota, "CLIENTE SECRETO", "Boteco", "Seg", True, sv=sv), **{CB.GC: gc})

    def vr(rota, gc_agr, gc_mod, vol, meta="--", sv="Sv. G1. 1", status="Acertado", gc_meta=None):
        return {CM.ROTA: rota, CM.CLIENTE: "7770999", CM.AGRUPADOR: "Refrigerantes", CM.NF_STATUS: status,
                CM.VOL_MES: vol, "_gc": gc_agr, CM.GC: gc_agr, COL_GC: gc_mod, COL_SV: sv, CM.META_ROTA: meta,
                COL_GC_META: gc_meta or gc_mod}

    def md(rota, gc_mod, valor, meta, dia="2026-10-20"):
        return {CM.ROTA: rota, CM.AGRUPADOR: "Refrigerantes", CM.DATA: dia, CM.META_RECUPERAVEL: valor,
                CM.META_ROTA: meta, CM.GC: "Gc. G1", COL_GC: gc_mod, COL_SV: "Sv. G1. 1", COL_GC_META: gc_mod}

    d = copy.deepcopy(DADOS)
    d[M.OBJ_CALENDARIO] = [{CC.DATA: "2026-10-20", CC.DIAS_UTEIS_MES: 22, CC.DIA_UTIL: 14, CC.DIAS_RESTANTES: 9}]
    d[M.OBJ_BASE_CLIENTE] = [
        cli(7770001, "111", "Gc. G1", "Sv. G1. 1"), cli(7770002, "112", "Gc. G1", "Sv. G1. 2"),
        cli(7770003, "A11", "Gc. Ap", "Sv. Ap. 1"), cli(7770004, "EV5", "Gc. Ap", "Sv. Bl. Ap"),
        cli(7770005, "GAP", "Gc. Ap", "Sv. Bl. Ap"), cli(7770006, "APE", "Gc. Ap", "Sv. Bl. Ap"),
        cli(7770007, "311", "Gc. G3", "Sv. G3. 3"), cli(7770008, "151", "Gc. G1", "Sv. G1. 5"),
        cli(7770009, "A42", "Gc. An", "Sv. An. 4"), cli(7770010, "EXT", "--", "Sv. Me"),
        cli(7770011, "211", "Gc. G2", "Sv. G2. 1")]
    d["vol_real"] = [
        vr("111", "Gc. G1", "Gc. G1", 100.0, "111"),
        vr("112", "Gc. G1", "Gc. G2", 30.0, "112", gc_meta="Gc. G1"),     # cliente transferido: G1 -> G2
        vr("A11", "Gc. Ap", "Gc. Ap", 200.0, "A11"),
        vr("EV5", "Gc. Ap", "Gc. Ap", 50.0, "A11", sv="Sv. Bl. Ap", gc_meta="Gc. G1"),   # rota oculta da AP
        vr("GAP", "Gc. Ap", "Gc. Ap", 7.0), vr("APE", "Gc. Ap", "Gc. Ap", 3.0),
        vr("G2F", "Gc. G2", "Gc. G2", 4.0), vr("X99", "Gc. Ap", "Gc. Ap", 2.0),
        vr("EXT", "--", "Gc. G1", 6.0, sv="Sv. Me"),
        vr("311", "Gc. G3", "Gc. G3", 40.0, "311"), vr("311", "Gc. G3", "Gc. Me", 6.0, "311"),
        vr("151", "Gc. G1", "Gc. Me", 4.0, "151"), vr("A42", "Gc. An", "Gc. Me", 8.0, "A42"),
        vr("111", "Gc. G1", "Gc. G1", 999.0, "111", status="Cancelada"),
        vr("111", "--", "Gc. G1", 5.0, "111"),                              # fora do escopo da consulta do painel
        vr("EV5", "Gc. Ap", "Gc. G3", 9.0, "311", sv="Sv. G3. 2"),          # rota da AP na base, cliente da G3
        vr("211", "Gc. G2", "Gc. G2", 70.0, "211"),
    ]
    d["meta_dia"] = [md("111", "Gc. G1", 20.0, "111"), md("EV5", "Gc. Ap", 15.0, "A11"),
                     md("112", "Gc. G2", 5.0, "211"), md("111", "Gc. G1", 3.0, "151"),
                     md("A11", "Gc. Ap", 10.0, "A11"), md("211", "Gc. G2", 12.0, "211"),
                     md("112", "Gc. G1", 4.0, "211"),                       # meta da 211 (G2), cliente da G1
                     md("A11", "Gc. Ap", 6.0, "EV7"),                       # meta numa rota fora do painel
                     md("111", "Gc. G1", 99.0, "111", dia="2026-10-21")]
    d["metas"] = d["metas"] + [_meta("Refrigerantes", cob="10", vol="100", rota=r) for r in ("A11", "211", "311", "A42")]
    return d


TELA_E7 = ("# Tela sintética do SAC, 20/10/2026 10h\nGC;Real;Meta;Tendencia;MetaDia\n"
           "G1;111;120;150;27\nG2;104;100;100;17\nAP;272;100;300;31\nG3;49;100;100;0\nAN;0;100;100;0\n")


class TestSecaoE7(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as pasta:
            (Path(pasta) / "refri_2026-10-20.csv").write_text(TELA_E7, encoding="utf-8")
            cls.cons = ConsultaE7(_dados_e7())
            cls.txt = ct.conferir(cls.cons, date(2026, 10, 20), pasta_sac=Path(pasta))[0].texto("E7")
        cls.e7 = cls.txt[cls.txt.index("## E7."):cls.txt.index("## E10.")]   # E7 e E8 (a E10 lista códigos de rota)

    def test_aparece_sem_erro(self):
        self.assertNotIn("ERRO", self.txt)
        self.assertIn("Modo: **normal**", self.txt)
        for t in ["E7a. Reconciliação", "E7b. Contribuições por rota", "E7c. Deslocamentos", "E7d. Resumo"]:
            self.assertIn(t, self.e7)

    def test_consulta_sem_filtros_de_escopo(self):
        e7 = [c for c in self.cons.chamadas if COL_SV in c[1]]          # só a E7 lê a supervisão do modelo
        self.assertEqual(len(e7), 2)                                    # Real e meta do dia
        for _, sel, filtro in e7:
            self.assertNotIn(f"{CM.GC} eq", filtro)
            self.assertNotIn(f"{CM.ROTA} eq", filtro)
            self.assertNotIn(CM.CLIENTE, sel)
            self.assertIn(f"{CM.AGRUPADOR} eq 'Refrigerantes'", filtro)
        self.assertTrue(any(c[0] == M.OBJ_BASE_CLIENTE and c[1] == (CB.ROTA, CB.GC, CB.SUPERVISOR, CB.QUANTIDADE)
                            and c[2] == M.FILTRO_BASE_CLIENTE for c in self.cons.chamadas))

    def test_gerencia_do_modelo_que_reproduz_o_sac(self):
        self.assertIn(f"| `{COL_GC}` (gerência comercial atual do cliente) | **10 (usada)** | **0 (usada)** |", self.e7)
        self.assertIn(f"| `{COL_GC_META}` (gerência da meta) |", self.e7)
        self.assertNotIn(ct.COL_GC_AGRUPADA_META, self.e7)             # coluna fora do $metadata: candidata fora

    def test_secao_4_com_a_rota_oculta_e_a_meta_do_dia_pela_rota_da_meta(self):
        # Real da AP = A11 200 + rota oculta das EV* 50; meta do dia da AP = A11 15 + 10 (a de cliente na EV5 entra)
        self.assertIn("| AP | 250 | 272 | -22 | **DIVERGE** |", self.txt)
        self.assertIn("| 25 | 31 | -19,35% | **DIVERGE** |", self.txt)
        self.assertIn("Clientes em rotas EV* (rota oculta da gerência comercial, como o payload), Vol Real de "
                      "Refrigerantes: AP 50; G3 9", self.txt)

    def test_reconciliacao(self):
        # painel: G1 111+112+151 = 134; G2 211 = 70; AP A11 + AP-EV = 250; G3 311 + G3-EV = 55; AN A42 = 8
        # meta do dia pela rota da meta: G1 111+151 = 23; G2 211 = 21; AP A11 = 25
        self.assertIn("| G1 | 134 | 111 | 23 | 23 | 0 | 23 | 27 | -4 | -4 | 0 |", self.e7)
        self.assertIn("| AP | 250 | 272 | -22 | -12 | -10 | 25 | 31 | -6 | -6 | 0 |", self.e7)
        self.assertIn("| G2 | 70 | 104 | -34 | -34 | 0 | 21 | 17 | 4 | 4 | 0 |", self.e7)
        self.assertIn("| G3 | 55 | 49 | 6 | 6 | 0 |", self.e7)
        self.assertIn("| AN | 8 | 0 | 8 | 8 | 0 |", self.e7)
        self.assertIn("| **todas as gerências do CSV** | 517 | 536 | -19 | -9 | -10 | 69 | 75 | -6 | -6 | 0 |", self.e7)

    def test_contribuicoes_por_rota_com_a_causa(self):
        for linha in [
            "| GAP | — | fora do painel: SV.BL.* | supervisão no modelo SV.G1.1 | -7,0 |",
            "| APE | — | fora do painel: INVALIDO / G*E / G*F / APE |",
            "| G2F | — | fora do painel: INVALIDO / G*E / G*F / APE |",
            "| X99 | — | sem cliente corrente e ativo |",
            "| EXT | — | outra: supervisão fora do padrão SV.<sigla>.<n> (SV.ME) |",
            "| 112 | 112 | gerência do modelo ≠ gerência do painel (rota atribuída a outra gerência) | gerência do modelo G2 | 30,0 |",
            "| 112 | 112 | gerência do modelo ≠ gerência do painel (rota atribuída a outra gerência) | rota 112 na G1 no painel | -30,0 |",
            "| 151 | 151 | Neutraliza (entra no total) | gerência do modelo ME | 4,0 |",
            "| A42 | A42 | virtual (entra no total) | gerência do modelo ME | 8,0 |",
            "| 311 | 311 | oculta: SV.G3.3 | gerência do modelo ME | 6,0 |",
            "| 111 | 111 | outra: gerência agrupada do cliente fora das do painel | rota 111 da G1 no painel | -5,0 |",
            # meta do dia pela rota da meta (1ª coluna)
            "| 211 | 112 | gerência do modelo ≠ gerência do painel (rota atribuída a outra gerência) | rota 211 na G2 no painel | -4,0 |",
            "| 211 | 112 | gerência do modelo ≠ gerência do painel (rota atribuída a outra gerência) | gerência do modelo G1 | 4,0 |",
            "| EV7 | A11 | rota da meta ≠ rota do cliente | rota da meta EV7 (fora do painel: EV*); cliente na rota A11 da AP no "
            "painel | -6,0 |",
        ]:
            self.assertIn(linha, self.e7)
        self.assertNotIn("| EV5 |", self.e7)          # clientes das EV* agora entram pela rota oculta da gerência
        self.assertNotIn("999", self.e7)               # NF cancelada fica fora (como no Vol Real)
        self.assertNotIn("99,0", self.e7)              # meta do dia de outro dia fica fora

    def test_deslocamentos_e_par_g2_g3(self):
        self.assertIn("| 112 | G1 | G2 | 30,0 | 0,0 |", self.e7)
        self.assertIn("| 211 | G2 | G1 | 0,0 | 4,0 |", self.e7)
        self.assertIn("| nenhuma | — | — | — | — | — |", self.e7)   # nenhum cliente de EV* fica fora
        self.assertIn("Par G2/G3: deslocamento direto entre as duas = Real 0 cx, Meta do dia 0 cx.", self.e7)

    def test_resumo_por_gerencia(self):
        self.assertIn("- **AP** · Real -22 cx: explicado por: fora do painel: SV.BL.* (-7 cx); fora do painel: INVALIDO / "
                      "G*E / G*F / APE (-3 cx); sem cliente corrente e ativo (-2 cx) · **resíduo -10 cx sem causa "
                      "encontrada** · Meta do dia -6 cx: explicado por: rota da meta ≠ rota do cliente (-6 cx) · resíduo 0 cx",
                      self.e7)
        self.assertIn("- **G3** · Real 6 cx: explicado por: oculta: SV.G3.3 (6 cx) · resíduo 0 cx", self.e7)
        self.assertNotIn("- **RV**", self.e7)                           # fora do CSV

    def test_hipoteses(self):
        self.assertIn("(b) rota do painel atribuída a outra gerência no modelo (total deslocado; sai de uma, entra na "
                      "outra): Real 30 cx · Meta do dia 4 cx", self.e7)
        self.assertIn("(d) rota da meta ≠ rota do cliente (Real: cliente fora do painel com a meta numa rota do painel; "
                      "meta do dia: meta numa rota fora do painel de cliente que está no painel): Real 0 cx · Meta do "
                      "dia -6 cx", self.e7)
        self.assertIn("(c) Neutraliza, virtuais, rotas ocultas das EV* e supervisões ocultas entram no total do painel. "
                      "Real: Neutraliza (entra no total) 4 cx; clientes em rotas EV* (rota oculta, entra no total) 59 cx; "
                      "oculta: SV.G3.3 46 cx; virtual (entra no total) 8 cx.", self.e7)

    def test_sem_nomes_nem_codigos_de_clientes(self):
        for v in ["CLIENTE SECRETO", "Secreto", "7770", "Warley", "WARLEY", "Marcos", "MARCOS", "1007382", "1015300"]:
            self.assertNotIn(v, self.txt)


class TestSecaoE7SemColunas(unittest.TestCase):
    def test_sem_colunas_de_gerencia_do_modelo(self):
        with tempfile.TemporaryDirectory() as pasta:
            (Path(pasta) / "refri_2026-10-20.csv").write_text(TELA_E7, encoding="utf-8")
            txt = ct.conferir(ConsultaSemGc(_dados_e7()), date(2026, 10, 20), pasta_sac=Path(pasta))[0].texto("E7")
        self.assertNotIn("ERRO", txt)
        self.assertIn("E7. Diferenças contra o SAC", txt)
        self.assertIn("a E7 não pode ser calculada", txt)
        self.assertIn("| AP | 200 | 272 |", txt)      # sem a gerência comercial, a rota oculta das EV* não existe


# ---------------------------------------------------------------- E8: descoberta do incentivo Todos a Bordo 3.0
from tests.test_fontes import _todas  # noqa: E402

GC_ROTA_E8 = {"111": "G1", "112": "G1", "211": "G2", "212": "G2", "213": "G2", "221": "G2", "222": "G2",
              "A11": "AP", "A12": "AP", "C11": "AN", "C12": "AN",
              "R11": "RV", "R31": "RV", "T39": "RV", "G1-EV": "G1"}     # R31 Neutraliza; T39 rota T<nn>
SV_ROTA_E8 = {"111": "SV.G1.1", "112": "SV.G1.1", "211": "SV.G2.1", "212": "SV.G2.1", "213": "SV.G2.1",
              "221": "SV.G2.2", "222": "SV.G2.2", "A11": "SV.AP.1", "A12": "SV.AP.1", "C11": "SV.AN.1", "C12": "SV.AN.2",
              "R11": "SV.RV.1", "R31": "SV.RV.1", "T39": "SV.RV.1"}


def _cob(rota, pv, ag, cob, gc):
    return {CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: ag, CM.COB_MES: cob, CM.GC: gc}


class ConsultaE8:
    """Datasphere simulado para a E8: venda (cobertura), metas por rota, online e colunas de produto."""

    COB = [_cob("111", 8880001, "Cervejas", 1, "Gc. G1"), _cob("111", 8880002, "Cervejas", 0, "Gc. G1"),
           _cob("112", 8880003, "Cervejas", 1, "Gc. G1"), _cob("C11", 8880004, "Heineken", 1, "Gc. An"),
           _cob("C11", 8880004, "Heineken - 600ml", 1, "Gc. An"), _cob("C12", 8880005, "Heineken", 2, "Gc. An"),
           _cob("A11", 8880006, "Cervejas 600ml Retornavel", 1, "Gc. Ap"), _cob("A11", 8880006, "Eisenbahn", 1, "Gc. Ap"),
           _cob("Z99", 8880007, "Cervejas", 1, "Gc. G1"),                      # rota fora do painel
           _cob("211", 8880008, "Coca-Cola - 600ml", 1, "Gc. G2"),             # entra pelo "600"
           _cob("211", 8880008, "Cervejas Descartável", 1, "Gc. G2"),          # acento: entra pelo "CERVEJ"
           _cob("211", 8880009, "HEINEKEN - 600ML VR", 1, "Gc. G2"),           # caixa alta: parecido do Heineken 600
           _cob("111", 8880001, "Refrigerantes", 1, "Gc. G1"),                 # sem os termos: fora da E8
           dict(_cob("C11", 8880010, "Heineken", 1, "Gc. An"), **{CM.NF_STATUS: "Cancelada"})]   # NF cancelada: fora
    METAS = [("111", "Cervejas", 10), ("112", "Cervejas", 5), ("C11", "Heineken", 8), ("C11", "Heineken", 3),
             ("C11", "Heineken - 600ml", 3), ("R11", "Heineken", 6), ("R11", "Heineken - 600ml", 2),
             ("A11", "Cervejas 600ml Retornavel", 4), ("A12", "Cervejas 600ml Retornavel", 0),
             ("Z99", "Heineken", 7), ("211", "Heineken", 2), ("212", "Heineken", 1), ("111", "Ks Tt", 9)]
    ONLINE = [{CM.ROTA: "C11", CM.CLIENTE: "8880004", CM.AGRUPADOR: "Heineken", CM.COB_ONLINE: 1, CM.GC: "Gc. An"},
              {CM.ROTA: "111", CM.CLIENTE: "8880001", CM.AGRUPADOR: "Cervejas", CM.COB_ONLINE: 1, CM.GC: "Gc. G1"},
              {CM.ROTA: "112", CM.CLIENTE: "8880003", CM.AGRUPADOR: "Cervejas", CM.COB_ONLINE: 0, CM.GC: "Gc. G1"}]
    COLUNAS = {"DS_MARCA_Produto": ["Heineken", "Eisenbahn", "Amstel"], "DS_EMBALAGEM_Produto": ["600ml", "Lata"],
               "DS_PRODUTO_Produto": [f"HEINEKEN LN {i}ML" for i in range(25)], "SKU_QUEBRA": [],
               "VL_PESO_Produto": [], "AGRUPADOR_SEGMENTO_CLIEN_Clien": ["HEINEKEN CLIENTE"]}

    def __init__(self, sem_600=False):
        self.chamadas = []
        self.cob = [l for l in self.COB if not (sem_600 and "600" in l[CM.AGRUPADOR] and "Heineken" in l[CM.AGRUPADOR])]
        self.metas = [m for m in self.METAS if not (sem_600 and m[1] == "Heineken - 600ml")]

    def colunas(self, objeto):
        return _todas(CM) + list(self.COLUNAS)

    def tipo(self, objeto, coluna):
        return "Edm.Decimal" if coluna.startswith("VL_") else "Edm.String"

    @staticmethod
    def _da_gc(linhas, filtro):
        if filtro and f"{CM.GC} eq '" in filtro:
            gc = filtro.split(f"{CM.GC} eq '")[1].split("'")[0]
            return [l for l in linhas if l[CM.GC] == gc]
        return linhas

    def linhas(self, objeto, select, filtro=None, top=None, orderby=None):
        self.chamadas.append((objeto, tuple(select), filtro))
        sel = tuple(select)
        if sel == (CM.AGRUPADOR, CM.COB_MES):
            return [{CM.AGRUPADOR: v, CM.COB_MES: 1} for v in sorted({l[CM.AGRUPADOR] for l in self.cob})]
        if sel == (CM.META_AGRUPADOR, CM.META_COBERTURA):
            return [{CM.META_AGRUPADOR: a, CM.META_COBERTURA: m} for _, a, m in self.metas]
        if sel == (CM.META_ROTA, CM.META_AGRUPADOR, CM.META_COBERTURA):
            return [{CM.META_ROTA: r, CM.META_AGRUPADOR: a, CM.META_COBERTURA: m} for r, a, m in self.metas
                    if f"'{a}'" in filtro]
        if CM.COB_MES in sel and CM.CLIENTE in sel:
            canc = M.FILTRO_SEM_NF_CANCELADA in filtro
            return [l for l in self._da_gc(self.cob, filtro) if f"'{l[CM.AGRUPADOR]}'" in filtro
                    and not (canc and l.get(CM.NF_STATUS) == "Cancelada")]
        if CM.COB_ONLINE in sel:
            assert "FONTE eq 'WF Online'" in filtro and "SITUACAO_Pedido eq 'Inc. e Exp.'" in filtro
            return [l for l in self._da_gc(self.ONLINE, filtro) if f"'{l[CM.AGRUPADOR]}'" in filtro]
        if sel[0] == "SKU_QUEBRA":
            raise RuntimeError("HTTP 500 (simulado)")
        if sel[0] in self.COLUNAS:
            return [{sel[0]: v, CM.COB_MES: 1} for v in self.COLUNAS[sel[0]]]
        return []

    def em_paralelo(self, tarefas):
        return {n: self.linhas(*a) for n, a in tarefas.items()}


def _e8(cons):
    rel = ct.Relatorio()
    estado = {"gc_rota_painel": dict(GC_ROTA_E8), "sv_rota_painel": dict(SV_ROTA_E8),
              "gcs": ["Gc. G1", "Gc. G2", "Gc. Ap", "Gc. An", "Gc. Rv"]}
    with contextlib.redirect_stdout(io.StringIO()):
        ct.descoberta_incentivo(rel, cons, estado, "202610")
    return "\n".join(rel.linhas)


class TestE8Funcoes(unittest.TestCase):
    def test_filtro_por_texto_sem_acento_e_caixa(self):
        self.assertEqual(ct.chave_texto("Cervejas 600ml Retornável"), "CERVEJAS600MLRETORNAVEL")
        self.assertEqual(ct.chave_texto(" heineken - 600 ML "), "HEINEKEN600ML")
        for v in ["cervejá", "CERVEJAS", "Heineken Zero", "eisenbahn est", "Coca-Cola - 600ml", "Cc 600 - Imp"]:
            self.assertTrue(ct.contem_termo(v), v)
        for v in ["Refrigerantes", "Ks Tt", "Amstel - 350ml", "", None]:
            self.assertFalse(ct.contem_termo(v), v)
        self.assertTrue(ct.contem_termo("Hnk + Eisenbahn", ct.E8_TERMOS_MARCA))
        self.assertFalse(ct.contem_termo("Cervejas 600ml", ct.E8_TERMOS_MARCA))

    def test_mapeamento_dos_itens(self):
        venda = ["Cervejas", "Cervejas 600ml Retornavel", "Cervejas Premium", "Heineken", "HEINEKEN - 600ML VR",
                 "Heineken Zero", "Eisenbahn"]
        m = ct.mapear_itens(venda, ["Cervejas", "Heineken", "Heineken - 600ml"])
        self.assertEqual(m["Cervejas"], {"venda": "Cervejas", "meta": "Cervejas", "parecidos": ["Cervejas Premium"]})
        self.assertEqual(m["Heineken"]["parecidos"], ["HEINEKEN - 600ML VR", "Heineken Zero"])   # sem os outros itens
        self.assertEqual(m["Heineken 600ml"], {"venda": None, "meta": "Heineken - 600ml", "parecidos": ["HEINEKEN - 600ML VR"]})
        self.assertEqual(m["Eisenbahn 600ml"], {"venda": None, "meta": None, "parecidos": []})     # Eisenbahn não vale
        self.assertEqual(m["Cervejas 600ml Retornável"]["venda"], "Cervejas 600ml Retornavel")

    def test_agregacao_por_gerencia(self):
        # as linhas como a consulta devolve (o $filter já tira as NF canceladas)
        cob = [l for l in ConsultaE8.COB if l.get(CM.NF_STATUS) != "Cancelada"]
        cli = ct.clientes_por_gc(cob, CM.AGRUPADOR, CM.COB_MES, GC_ROTA_E8)
        self.assertEqual({k: len(v) for k, v in cli.items() if k[0] == "Cervejas"},
                         {("Cervejas", "G1"): 2, ("Cervejas", ct.FORA): 1})        # cobertura 0 não conta
        self.assertEqual(len(cli[("Heineken", "AN")]), 2)
        metas = ct.meta_por_rota([{CM.META_ROTA: r, CM.META_AGRUPADOR: a, CM.META_COBERTURA: m}
                                  for r, a, m in ConsultaE8.METAS])
        self.assertEqual(metas[("Heineken", "C11")], 8)                            # o maior valor da rota
        mgc = ct.meta_por_gc(metas, GC_ROTA_E8)
        self.assertEqual(mgc[("Heineken", "AN")], [8.0, 1])
        self.assertEqual(mgc[("Heineken", ct.FORA)], [7.0, 1])
        self.assertEqual(mgc[("Cervejas", "G1")], [15.0, 2])
        self.assertEqual(mgc[("Cervejas 600ml Retornavel", "AP")], [4.0, 1])                 # A12 com meta 0 não conta

    def test_com_e_sem_meta_e_portfolio(self):
        metas = {("Heineken", "C11"): 8.0, ("Heineken", "R11"): 6.0, ("Heineken", "111"): 0.0}
        rotas = ct.rotas_por_gc(GC_ROTA_E8)
        self.assertEqual(rotas["G1"], ["111", "112"])                              # sem a rota oculta das EV*
        cs = ct.com_sem_meta(metas, "Heineken", rotas)
        self.assertEqual(cs["AN"], (["C11"], ["C12"]))
        self.assertEqual(cs["G1"], ([], ["111", "112"]))
        self.assertEqual(cs["RV"], (["R11"], ["R31", "T39"]))
        self.assertFalse(ct.rota_normal("R31") or ct.rota_normal("A42"))
        self.assertEqual(ct.divisao_portfolio(*cs["RV"], SV_ROTA_E8),                # a Neutraliza não conta
                         (None, {"SV.RV.1": (None, ["R11"], ["T39"])}))           # empate: sem informação
        self.assertEqual(ct.divisao_portfolio(*cs["G1"], {})[1], {"—": ("BARRACUDA", [], ["111", "112"])})

    def test_portfolio_pela_maioria_das_rotas(self):
        # exemplo da Karen (20/10/2026): SV.G2.1 com 4 das 7 rotas com meta de Heineken é FULL
        self.assertEqual(ct.portfolio(["211", "212", "213", "214"], ["215", "216", "217"]), "FULL")
        self.assertEqual(ct.portfolio(["A37"], [f"A3{i}" for i in range(1, 7)]), "BARRACUDA")
        self.assertEqual(ct.portfolio(["R11"], []), "FULL")
        self.assertEqual(ct.portfolio([], ["111"]), "BARRACUDA")
        self.assertIsNone(ct.portfolio(["C11"], ["C12"]))                         # empate fica sem informação
        self.assertEqual(ct.portfolio([], []), "sem rotas")
        sv = {f"21{i}": "SV.G2.1" for i in range(1, 8)} | {f"22{i}": "SV.G2.2" for i in range(1, 7)}
        g, svs = ct.divisao_portfolio(["211", "212", "213", "214"], ["215", "216", "217"] + [f"22{i}" for i in range(1, 7)], sv)
        self.assertEqual((g, {s: x[0] for s, x in svs.items()}), ("BARRACUDA", {"SV.G2.1": "FULL", "SV.G2.2": "BARRACUDA"}))
        self.assertEqual(ct.grupos_txt({"AN": "BARRACUDA", "RV": "FULL", "AP": "BARRACUDA", "IT": None}),
                         "BARRACUDA: AN, AP; FULL: RV")
        por_sv = {"SV.AN.1": ("AN", "FULL"), "SV.G2.1": ("G2", "FULL"), "SV.G2.2": ("G2", None), "SV.G2.3": ("G2", "BARRACUDA")}
        self.assertEqual(ct.diferentes_da_gc(por_sv, {"AN": None, "G2": "BARRACUDA"}), [("SV.G2.1", "FULL", "G2")])


class TestSecaoE8(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cons = ConsultaE8()
        cls.txt = _e8(cls.cons)

    def test_e8a_agrupadores(self):
        self.assertIn("| 'Cervejas' | sim | sim | 4 | 3 | 15 | 2 |", self.txt)        # 4 linhas: uma com cobertura 0
        self.assertIn("| 'Heineken' | sim | sim | 2 | 2 | 24 | 5 |", self.txt)        # 8 (C11) + 6 (R11) + 3 (G2) + 7 (fora)
        self.assertIn("| 'Coca-Cola - 600ml' | sim | não | 1 | 1 | — | — |", self.txt)
        self.assertIn("| 'Cervejas Descartável' | sim | não |", self.txt)
        self.assertNotIn("Refrigerantes", self.txt)
        self.assertNotIn("Ks Tt", self.txt)
        # por gerência, na ordem do painel (AN AP G1 G2 RV)
        self.assertIn("| agrupador | AN | AP | G1 | G2 | RV | fora |", self.txt)
        self.assertIn("| 'Cervejas' | 0 | 0 | 2 | 0 | 0 | 1 |", self.txt)
        self.assertIn("| 'Heineken' | 8 · 1 | — | — | 3 · 2 | 6 · 1 | 7 · 1 |", self.txt)

    def test_e8b_itens_e_colunas(self):
        self.assertIn("| Heineken 600ml | 'Heineken - 600ml' | 'Heineken - 600ml' | encontrado | 'HEINEKEN - 600ML VR' |",
                      self.txt)
        self.assertIn("| Eisenbahn 600ml | — | — | **não encontrado** | — |", self.txt)
        self.assertIn("Eisenbahn 600ml sem agrupador na venda", self.txt)
        self.assertIn("| `DS_MARCA_Produto` | sim | 'Eisenbahn', 'Heineken' |", self.txt)
        self.assertIn("| `DS_EMBALAGEM_Produto` | sim | nenhum |", self.txt)
        self.assertIn("| `SKU_QUEBRA` | **não** (RuntimeError) |", self.txt)
        self.assertIn("(+5)", self.txt)                                             # até 20 valores por coluna
        self.assertNotIn("VL_PESO_Produto", self.txt)                               # só colunas de texto
        self.assertNotIn("CLIEN_Clien", self.txt)                                   # colunas de cliente ficam fora

    def test_e8c_meta_com_e_sem_e_divisao(self):
        self.assertIn("**Heineken** (`Heineken`): meta na BAND 24", self.txt)
        self.assertIn("| G1 | 0 | 0 | 2 | BARRACUDA | 0 · 2 | BARRACUDA: SV.G1.1 | — | 111, 112 |", self.txt)
        self.assertIn("| AN | 8 | 1 | 1 | — | 1 · 1 | BARRACUDA: SV.AN.2; FULL: SV.AN.1 | C11 | C12 |", self.txt)  # empate
        self.assertIn("| G2 | 3 | 2 | 3 | BARRACUDA | 2 · 3 | BARRACUDA: SV.G2.2; FULL: SV.G2.1 | 211, 212 | 213, 221, 222 |",
                      self.txt)
        self.assertIn("| RV | 6 | 1 | 2 | — | 1 · 1 | — | R11 | R31 (N), T39 |", self.txt)  # sem a Neutraliza: empate
        self.assertIn("| fora | 7 | 1 | — | — | — | — | — | — |", self.txt)
        # supervisões mistas: a classificação vem da maioria (SV.G2.1: 2 de 3 com meta)
        self.assertIn("| SV.G2.1 | G2 | 2 | 1 | FULL | 211, 212 | 213 |", self.txt)
        self.assertIn("| SV.RV.1 | RV | 1 | 1 | — | R11 | T39 |", self.txt)
        self.assertNotIn("| SV.AN.1 | AN |", self.txt)                              # só com meta: não é mista
        self.assertIn("Divisão FULL x BARRACUDA pela meta de Heineken (maioria das rotas normais): BARRACUDA: AP, G1, G2.",
                      self.txt)
        self.assertIn("Supervisões com portfólio diferente do da gerência: SV.G2.1 FULL (G2 BARRACUDA).", self.txt)
        self.assertIn("Observação do dado: as rotas T<nn> (T39) estão sem meta de Heineken em 1 gerências e contam como "
                      "BARRACUDA; sem elas, muda: RV sem informação → FULL, SV.RV.1 sem informação → FULL.", self.txt)
        self.assertNotIn("None", self.txt)
        self.assertIn("| AP | 4 | 1 | 1 |", self.txt)                              # Cervejas 600ml: A12 com meta 0

    def test_e8d_online(self):
        # desde a aba Incentivo, a Heineken está na consulta de vendas e vira o indicador INC HEINEKEN
        self.assertIn("| Heineken | 'Heineken' | sim | INC HEINEKEN | 1 | 0 | 0 | 0 | 0 | 0 | 1 |", self.txt)
        self.assertIn("| Cervejas | 'Cervejas' | sim | CERVEJAS | 0 | 0 | 1 | 0 | 0 | 0 | 1 |", self.txt)
        self.assertNotIn("- Heineken (`Heineken`): faltaria", self.txt)
        self.assertNotIn("- Cervejas (`Cervejas`): faltaria", self.txt)

    def test_e8e_e_e8f(self):
        # AN: 8880004 e 8880005; o 8880010 só tem NF cancelada (fora, como no gerador)
        self.assertIn("| Heineken | 'Heineken' | 2 | 0 | 0 | 0 | 0 | 0 | 2 |", self.txt)
        cob = [f for _, sel, f in self.cons.chamadas if CM.COB_MES in sel and CM.CLIENTE in sel]
        self.assertTrue(cob and all(M.FILTRO_SEM_NF_CANCELADA in f for f in cob))
        self.assertIn("| Heineken | 'Heineken' | INC HEINEKEN | sim (5 rotas) | sim (1 clientes hoje) | já é o indicador "
                      "INC HEINEKEN do painel; também existe: "
                      "'HEINEKEN - 600ML VR'; portfólio (maioria das rotas normais) BARRACUDA: AP, G1, G2 "
                      "(supervisões diferentes da gerência: SV.G2.1 FULL) |", self.txt)
        self.assertIn("| Eisenbahn 600ml | **não encontrado** | INC EISENBAHN 600ML | não | não | sem agrupador na venda |",
                      self.txt)
        self.assertIn("| Cervejas | 'Cervejas' | INC CERVEJAS | sim (2 rotas) | sim (1 clientes hoje) | já é o indicador "
                      "CERVEJAS do painel; também existe: 'Cervejas Descartável' |", self.txt)

    def test_sem_nomes_nem_codigos_de_clientes(self):
        self.assertNotIn("888000", self.txt)
        self.assertNotIn("HEINEKEN CLIENTE", self.txt)

    def test_heineken_600_ausente_tambem_busca_nas_colunas(self):
        txt = _e8(ConsultaE8(sem_600=True))
        self.assertIn("Eisenbahn 600ml e Heineken 600ml sem agrupador na venda", txt)
        self.assertIn("| Heineken 600ml | — | — | **não encontrado** |", txt)
        self.assertIn("**Heineken 600ml**: sem agrupador na meta.", txt)


class TestE8NoRelatorio(unittest.TestCase):
    def test_aparece_sem_erro_no_relatorio_completo(self):
        with contextlib.redirect_stdout(io.StringIO()):
            txt = conferir_tendencia.conferir(ConsultaFalsa(DADOS), date(2026, 10, 13))[0].texto("E8")
        self.assertNotIn("ERRO", txt)
        for t in ["## E8. Descoberta do incentivo Todos a Bordo 3.0", "E8a.", "E8b.", "E8c.", "E8d.", "E8e.", "E8f."]:
            self.assertIn(t, txt)
        self.assertLess(txt.index("## E8."), txt.index("## 9."))
