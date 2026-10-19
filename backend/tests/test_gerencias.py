"""
16 gerências (Parte A): siglas e regiões, gerências agrupadas separadas pelo prefixo do supervisor,
linhas ignoradas contadas por motivo, Gc. At sem exclusões próprias e validação por gerência
(gerência nova/vazia = aviso; queda só contra a mesma gerência publicada). Nomes fictícios.
"""
import copy
import unittest
from datetime import datetime

from gerador import fontes
from gerador import mapeamento as M
from gerador.payload import montar_payload
from gerador.validacao import validar_payload
from tests.test_fontes import CB, DADOS, ConsultaFalsa, _cliente


def _cli(pv, rota, gc, sv, hoje=False):
    return dict(_cliente(pv, rota, f"CLIENTE {pv}", "Boteco", "Seg", hoje, sv=sv), **{CB.GC: gc})


class TestSiglas(unittest.TestCase):
    def test_16_gerencias_na_ordem_com_nomes(self):
        self.assertEqual(M.GC_NOMES, {
            "AN": "Anápolis", "AP": "Aparecida", "AT": "Atacados", "G1": "Goiânia 01", "G2": "Goiânia 02",
            "G3": "Goiânia 03", "PA": "Palmas", "DI": "Dianópolis", "RV": "Rio Verde", "SL": "São Luís",
            "GU": "Gurupi", "PO": "Porangatu", "IT": "Itumbiara", "MO": "Morrinhos", "UR": "Uruaçu", "RI": "Rialma"})
        self.assertEqual(M.GC_ATIVAS, ["AN", "AP", "AT", "G1", "G2", "G3", "PA", "DI", "RV", "SL", "GU", "PO", "IT",
                                       "MO", "UR", "RI"])
        self.assertEqual(list(M.GC_NOMES), M.GC_ATIVAS)          # a ordem das chaves é a ordem do painel
        self.assertFalse(hasattr(M, "REGIOES"))

    def test_origens_e_siglas(self):
        self.assertEqual(len(M.GC_ORIGEM), 12)
        for origem in M.GC_ORIGEM:
            self.assertIn(M.codigo_gc(origem), M.GC_SIGLAS_ORIGEM, origem)
        siglas = [s for ss in M.GC_SIGLAS_ORIGEM.values() for s in ss]
        self.assertEqual(sorted(siglas), sorted(M.GC_ATIVAS))     # toda sigla tem uma origem e só uma

    def test_agrupadas_pelo_prefixo_do_supervisor(self):
        casos = {"Sv. Pa. 3": "PA", "Sv. Di. 1": "DI", "Sv. Ur. 2": "UR", "Sv. Ri.1": "RI", "Sv. Gu. 4": "GU",
                 "Sv. Po. 1": "PO", "Sv. It. 1": "IT", "Sv. Mo. 3": "MO", "Sv. At. 2": "AT", "Sv. G3. 1": "G3"}
        for valor, sigla in casos.items():
            self.assertEqual(M.gc_do_sv(M.codigo_sv(valor)), sigla, valor)
        self.assertEqual([M.gc_origem(s) for s in ("PA", "DI", "UR", "RI", "GU", "PO", "IT", "MO", "AN")],
                         ["PA_DI", "PA_DI", "UR_RI", "UR_RI", "GU_PO", "GU_PO", "IT_MO", "IT_MO", "AN"])
        self.assertTrue(M.sigla_esperada("Gc. Pa_Di", "DI"))
        self.assertFalse(M.sigla_esperada("Gc. Ur_Ri", "GU"))


BASE = [
    _cli(1, "111", "Gc. G1", "Sv. G1.1", True),
    _cli(2, "P31", "Gc. Pa_Di", "Sv. Pa. 3"),
    _cli(3, "D11", "Gc. Pa_Di", "Sv. Di. 1"),
    _cli(4, "T21", "Gc. At", "Sv. At. 2"),
    _cli(5, "T25", "Gc. At", "Sv. At. 5"),            # na At nada é oculto: entra como qualquer supervisão
    _cli(6, "R11", "Gc. Ur_Ri", "Sv. Gu. 1"),         # prefixo de outra gerência: entra, mas é avisado
    _cli(7, "EV1", "Gc. At", "Sv. At. 1"),            # rota eventual: filtro global vale na At
    _cli(8, "T22", "Gc. At", "Sv. Bl. At"),           # balcão: filtro global vale na At
    _cli(9, "T23", "Gc. At", "INVALIDO"),             # supervisor fora do padrão
]


class TestBaseDeClientes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.est = {}
        cls.clientes, cls.gcs = fontes.carregar_clientes(ConsultaFalsa(dict(DADOS, **{M.OBJ_BASE_CLIENTE: BASE})),
                                                         estatisticas=cls.est)

    def test_siglas_das_rotas(self):
        self.assertEqual({c.rota: c.gc for c in self.clientes},
                         {"111": "G1", "P31": "PA", "D11": "DI", "T21": "AT", "T25": "AT", "R11": "GU"})

    def test_nada_sai_em_silencio(self):
        self.assertEqual(self.est["ignoradas"], {"Gc. At": {"rota vazia ou eventual (EV*)": 1,
                                                            "supervisor de balcão (SV.BL.*)": 1,
                                                            "supervisor fora do padrão SV.<sigla>.<n>": 1}})
        self.assertEqual(self.est["fora_padrao"], {"Gc. Ur_Ri": ["SV.GU.1"]})

    def test_origens_dividem_as_consultas(self):
        self.assertEqual(self.gcs, ["Gc. At", "Gc. G1", "Gc. Pa_Di", "Gc. Ur_Ri"])


class TestValidacaoPorGerencia(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        d = copy.deepcopy(DADOS)
        d[M.OBJ_BASE_CLIENTE] = DADOS[M.OBJ_BASE_CLIENTE] + [_cli(2, "P31", "Gc. Pa_Di", "Sv. Pa. 3")]
        cls.p = montar_payload(fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0)))

    def test_gc_nomes_e_ordem_no_payload_sem_regioes(self):
        self.assertEqual(self.p["GC_NOMES"], M.GC_NOMES)
        self.assertEqual(list(self.p["GC_NOMES"]), M.GC_ATIVAS)
        self.assertNotIn("REGIOES", self.p)
        self.assertEqual(self.p["GC_ATIVAS"], ["G1", "PA"])            # só as com dados, na ordem de GC_NOMES
        self.assertEqual(list(self.p["DATA"]), ["G1", "PA"])
        sem = {k: v for k, v in self.p.items() if k != "GC_NOMES"}
        self.assertEqual(validar_payload(sem)[0], ["payload sem as chaves: GC_NOMES"])
        antigo = dict(self.p, REGIOES={"Matriz": ["G1"]})               # chave de payload antigo: só ignorada
        self.assertEqual(validar_payload(antigo)[0], [])

    def test_gerencia_nova_sem_metas_e_sem_real_so_avisa(self):
        erros, avisos = validar_payload(self.p)
        self.assertEqual(erros, [])
        self.assertIn("PA: gerência sem metas (cobertura e volume)", avisos)
        self.assertIn("PA: gerência sem Real no mês (volume e cobertura)", avisos)
        self.assertIn("RV: gerência sem rotas na base de clientes", avisos)
        self.assertFalse([a for a in avisos if a.startswith("G1: gerência")])

    def test_queda_por_gerencia_e_gerencia_nova_nao_compara(self):
        def ant(gcs):
            return {"MES_LABEL": self.p["MES_LABEL"], "DATA": {
                gc: {"SV": {f"{gc}{i}": {"baseTotal": 1, "indicators": {}} for i in range(n)}} for gc, n in gcs.items()}}
        # publicado só com a G1: a PA é nova e não é comparada
        erros, _ = validar_payload(self.p, ant({"G1": 1}))
        self.assertEqual(erros, [])
        # a G2 estava publicada e sumiu: reprova pela G2
        erros, _ = validar_payload(self.p, ant({"G1": 1, "G2": 5}))
        self.assertEqual(erros, ["G2: rotas caíram de 5 para 0", "G2: clientes na base caíram de 5 para 0"])


if __name__ == "__main__":
    unittest.main()
