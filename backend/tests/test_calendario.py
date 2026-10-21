import unittest
from datetime import date

from gerador import calendario as c


class TestCalendario(unittest.TestCase):
    # valores conferidos no histórico do payload.json publicado à mão
    CASOS = {
        date(2026, 10, 13): (21, 8, 7, 33, 2, "par", "Terça-feira", "Outubro/26"),
        date(2026, 10, 5): (21, 3, 2, 10, 1, "ímpar", "Segunda-feira", "Outubro/26"),
        date(2026, 10, 9): (21, 7, 6, 29, 1, "ímpar", "Sexta-feira", "Outubro/26"),
        date(2026, 9, 28): (21, 19, 18, 86, 4, "par", "Segunda-feira", "Setembro/26"),
        date(2026, 9, 30): (21, 21, 20, 95, 4, "par", "Quarta-feira", "Setembro/26"),
    }

    def test_calculo_local_bate_com_o_historico(self):
        for d, esperado in self.CASOS.items():
            k = c.calcular_local(d)
            obtido = (k.total_dias_uteis, k.dia_hoje, k.dia_ontem, k.pace_ontem_pct, k.semana_num,
                      k.semana_tipo, k.dia_semana, k.mes_label)
            self.assertEqual(obtido, esperado, d)

    def test_dias_antes_da_primeira_segunda_sao_da_semana_anterior(self):
        self.assertEqual(c.semana_do_mes(date(2026, 10, 1)), c.semana_do_mes(date(2026, 9, 30)))

    def test_fim_de_semana_nao_avanca_dia_util(self):
        sab = c.calcular_local(date(2026, 10, 10))
        self.assertEqual((sab.dia_hoje, sab.dia_ontem), (7, 7))

    def test_antes_do_primeiro_dia_util(self):
        k = c.calcular_local(date(2026, 11, 1))   # domingo
        self.assertEqual((k.dia_hoje, k.dia_ontem), (1, 0))

    def test_feriados(self):
        f = c.feriados_nacionais(2026)
        self.assertIn(date(2026, 10, 12), f)
        self.assertIn(date(2026, 4, 3), f)      # sexta-feira santa
        self.assertIn(date(2026, 6, 4), f)      # corpus christi

    def test_do_datasphere(self):
        linhas = [{"DATA": "2026-10-13", "NO_DIAS_UTEIS_MES": "21", "NO_DIA_UTIL": "8"}]
        k = c.do_datasphere(linhas, date(2026, 10, 13))
        self.assertEqual((k.total_dias_uteis, k.dia_hoje, k.dia_ontem, k.pace_ontem_pct), (21, 8, 7, 33))
        self.assertIsNone(c.do_datasphere([{"DATA": "2026-09-30", "NO_DIAS_UTEIS_MES": 21, "NO_DIA_UTIL": 21}],
                                          date(2026, 10, 13)))


class TestDataOntem(unittest.TestCase):
    """DATA_ONTEM / DIA_ONTEM_NOME: data do último dia útil fechado (o dia útil DIA_ONTEM do mês de referência)."""

    def test_segunda_feira_aponta_a_sexta(self):
        k = c.calcular_local(date(2026, 10, 19))
        self.assertEqual((k.dia_ontem, k.data_ontem, c.nome_dia(k.data_ontem)), (11, date(2026, 10, 16), "sexta-feira"))

    def test_dia_apos_feriado(self):
        k = c.calcular_local(date(2026, 10, 13))         # 12/10 é feriado: o último fechado é a sexta 09/10
        self.assertEqual((k.dia_ontem, k.data_ontem), (7, date(2026, 10, 9)))
        self.assertEqual(c.nome_dia(k.data_ontem), "sexta-feira")

    def test_fim_de_semana_e_meio_da_semana(self):
        self.assertEqual(c.calcular_local(date(2026, 10, 10)).data_ontem, date(2026, 10, 9))    # sábado
        k = c.calcular_local(date(2026, 10, 21))
        self.assertEqual((k.data_ontem, c.nome_dia(k.data_ontem)), (date(2026, 10, 20), "terça-feira"))

    def test_antes_do_primeiro_dia_util_sem_data(self):
        k = c.calcular_local(date(2026, 11, 1))
        self.assertEqual((k.dia_ontem, k.data_ontem, c.nome_dia(k.data_ontem)), (0, None, None))

    def test_virada_do_mes_usa_o_mes_de_referencia(self):
        k = c.fechado(date(2026, 11, 3), date(2026, 10, 1), 21)
        self.assertEqual((k.dia_ontem, k.data_ontem, c.nome_dia(k.data_ontem)), (21, date(2026, 10, 30), "sexta-feira"))
        # calendário do Datasphere do mês de referência: o dia útil 21 de outubro
        linhas = [{"DATA": f"2026-10-{d:02d}", "NO_DIAS_UTEIS_MES": 21, "NO_DIA_UTIL": n}
                  for d, n in ((29, 20), (30, 21), (31, 21))]
        self.assertEqual(c.com_data_ontem(k, linhas).data_ontem, date(2026, 10, 30))

    def test_do_datasphere(self):
        # feriado (12/10) e fim de semana repetem o nº do último dia útil: vale o dia de semana mais antigo
        linhas = [{"DATA": f"2026-10-{d:02d}", "NO_DIAS_UTEIS_MES": 21, "NO_DIA_UTIL": n}
                  for d, n in ((8, 6), (9, 7), (10, 7), (11, 7), (12, 7), (13, 8))]
        k = c.do_datasphere(linhas, date(2026, 10, 13))
        self.assertEqual((k.dia_ontem, k.data_ontem), (7, date(2026, 10, 9)))
        # só a linha de hoje (sem a do dia útil fechado): fica a do cálculo local
        k = c.do_datasphere([linhas[-1]], date(2026, 10, 13))
        self.assertEqual(k.data_ontem, date(2026, 10, 9))
        # o calendário do Datasphere manda quando a linha existe (ex.: feriado municipal no dia 09)
        linhas2 = [{"DATA": "2026-10-08", "NO_DIAS_UTEIS_MES": 20, "NO_DIA_UTIL": 6},
                   {"DATA": "2026-10-09", "NO_DIAS_UTEIS_MES": 20, "NO_DIA_UTIL": 6},
                   {"DATA": "2026-10-13", "NO_DIAS_UTEIS_MES": 20, "NO_DIA_UTIL": 7}]
        self.assertEqual(c.do_datasphere(linhas2, date(2026, 10, 13)).data_ontem, date(2026, 10, 8))


if __name__ == "__main__":
    unittest.main()
