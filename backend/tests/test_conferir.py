"""scripts/conferir_tendencia.py contra o Datasphere simulado: todas as etapas rodam, o relatório não
traz nome nem código de cliente, e o aceite contra o SAC de 17/10/2026 (G1 e AP) passa."""
import copy
import importlib.util
import unittest
from datetime import date
from pathlib import Path

from gerador import mapeamento as M
from tests.test_fontes import CB, CM, DADOS, ConsultaFalsa, _cliente, _dia, _meta, _vr

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
        self.assertIn("Aceite só vale para hoje = 17/10/2026", self.txt)

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


class TestAceiteSac(unittest.TestCase):
    def test_g1_e_ap_batem_em_17_10(self):
        rel, _ = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 17))
        txt = rel.texto("aceite")
        self.assertNotIn("ERRO", txt)
        self.assertIn("| G1 | 125.590 | 125.590 | OK | 490.003 | 490.003 | OK | 406.863 | 406.863 | OK | 83,03% | 83,03% | OK |",
                      txt)
        self.assertIn("| AP | 121.040 | 121.040 | OK | 398.000 | 398.000 | OK | 347.170 | 347.170 | OK | 87,23% | 87,23% | OK |",
                      txt)
        self.assertIn("Resultado: **DIVERGE**", txt)          # as outras gerências não estão no fixture

    def test_aceite_tambem_em_18_10(self):
        txt = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 18))[0].texto("aceite")
        self.assertIn("| AP | 121.040 | 121.040 | OK | 398.000 | 398.000 | OK | 347.170 | 347.170 | OK |", txt)
        txt = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 19))[0].texto("aceite")
        self.assertIn("Aceite só vale", txt)
        self.assertNotIn("| OK |", txt)

    def test_data_simulada_nao_faz_aceite(self):
        rel, _ = conferir_tendencia.conferir(ConsultaFalsa(_dados_17_10()), date(2026, 10, 17), simulado=True)
        txt = rel.texto("aceite")
        self.assertIn("Aceite só vale", txt)
        self.assertNotIn("| OK |", txt)

    def test_tolerancias(self):
        sac = conferir_tendencia.SAC_17_10
        base = {g: (r, m, t) for g, (r, m, t, _) in sac.items()}
        linhas, ok = conferir_tendencia.aceite_sac(base, True)
        self.assertTrue(ok)
        r, m, t = base["G2"]
        for errado in [(r * 1.002, m, t), (r, m + 1, t), (r, m, t * 1.003)]:
            linhas, ok = conferir_tendencia.aceite_sac(dict(base, G2=errado), True)
            self.assertFalse(ok, errado)
            self.assertIn("**DIVERGE**", next(l for l in linhas if l[0] == "G2"))
        _, ok = conferir_tendencia.aceite_sac(dict(base, G2=(r * 1.0009, m, t * 1.001)), True)
        self.assertTrue(ok)


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
        self.assertIn("| AT | Matriz | 3 | 7 |", self.txt)
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
