"""
Tendência de volume pelo critério do SAC e modo fechamento do mês (sem rede).

Meta = META_VOLUME da rota; Neg Restante = Meta x (META_NEG de hoje ao fim do mês / META_NEG do mês);
Tendência = Vol Real (NF Acertado / Meta Neg / Em Aberto) + Neg Restante; % = Tendência / Meta em todos os
níveis; meta do dia = META_RECUPERAVEL_ROTA de hoje (DATA_MOVIMENTO só no $filter).
Fechamento: do dia 1 até o fim do 1º dia útil e, depois, enquanto alguma gerência não tiver as metas
do mês, o payload mostra o mês anterior fechado (sem tendência, sem meta do dia, sem Venda Zero).
"""
import copy
import unittest
from datetime import date, datetime

from gerador import calendario as calmod
from gerador import fontes, modelo
from gerador import mapeamento as M
from gerador.online import montar_online
from gerador.payload import montar_payload
from gerador.tipos import Calendario, Cliente, Fontes, Online, VolumeRota
from gerador.validacao import validar_payload
from tests.test_fontes import CM, DADOS, ConsultaFalsa, _dia, _meta, _venda, _vr

CAL = Calendario(hoje=date(2026, 10, 13), total_dias_uteis=21, dia_hoje=8, dia_ontem=7, semana_num=2,
                 semana_tipo="par", dia_semana="Terça-feira", mes_label="Outubro/26")
CAL_FECHADO = calmod.fechado(date(2026, 11, 3), date(2026, 10, 1), 21)


class TestTendenciaSac(unittest.TestCase):
    def test_rota(self):
        b = modelo.indicador_volume(VolumeRota(meta=120.0, real=13.0, neg_restante=36.0, meta_dia_hoje=5.0,
                                               meta_neg_clientes=100.0), CAL)
        self.assertEqual((b["meta"], b["real"], b["dif"], b["negRestante"], b["tendencia"], b["pctTendencia"],
                          b["onPace"], b["metaDia"], b["metaNegClientes"]),
                         (120.0, 13.0, -107.0, 36.0, 49.0, 41, False, 5.0, 100.0))
        self.assertNotIn("metaRota", b)
        b = modelo.indicador_volume(VolumeRota(meta=100.0, real=60.0, neg_restante=40.0, meta_dia_hoje=0.0), CAL)
        self.assertEqual((b["tendencia"], b["pctTendencia"], b["onPace"]), (100.0, 100, True))
        self.assertIsNone(b["metaNegClientes"])

    def test_sem_meta_fica_indisponivel(self):
        self.assertTrue(modelo.indicador_volume(VolumeRota(meta=None, real=5.0, meta_neg_clientes=0.0), CAL)["unavailable"])

    def test_meta_do_dia_ausente_fica_null(self):
        b = modelo.indicador_volume(VolumeRota(meta=100.0, real=10.0, neg_restante=5.0, meta_dia_hoje=None), CAL)
        self.assertIsNone(b["metaDia"])

    def test_status_nf_com_grafia_variada(self):
        for s in ["Acertado", "ACERTADO", " acertado ", "Em Aberto", "EM  ABERTO", "Ém Abérto", "Meta Neg", "META NEG"]:
            self.assertTrue(M.status_nf_real(s), s)
        for s in ["Cancelada", "Devolvida", "", None, "Acertada"]:
            self.assertFalse(M.status_nf_real(s), s)

    def test_neg_restante_por_dia_plano_b(self):
        hoje = date(2026, 10, 13)
        linhas = [("111", "VOL STILL", date(2026, 10, 12), 30.0), ("111", "VOL STILL", hoje, 20.0),
                  ("111", "VOL STILL", date(2026, 10, 31), 10.0), ("112", "VOL STILL", None, 7.0)]
        meta, restante = fontes.meta_neg_e_restante(linhas, hoje)
        self.assertEqual(meta, {"111": {"VOL STILL": 60.0}, "112": {"VOL STILL": 7.0}})
        self.assertEqual(restante, {"111": {"VOL STILL": 30.0}, "112": {"VOL STILL": 0.0}})


class TestMetaDaRota(unittest.TestCase):
    """Meta = META_VOLUME; Neg Restante = curva da META_NEG dos clientes aplicada à meta da rota."""

    def test_curva_dos_clientes_na_meta_da_rota(self):
        # AP / Refrigerantes em 17/10: meta da rota 398.000, META_NEG dos clientes 391.716,5
        meta, rest, caso = modelo.meta_e_restante(398000.0, 391716.5, 0.5 * 391716.5, 9, 22)
        self.assertEqual((meta, rest, caso), (398000.0, 199000.0, modelo.CURVA))

    def test_sem_curva_usa_dias_uteis_com_hoje(self):
        # 22 dias úteis, 13 já fechados: restam 9 contando hoje
        meta, rest, caso = modelo.meta_e_restante(220.0, 0.0, 0.0, 9, 22)
        self.assertEqual((meta, rest, caso), (220.0, 90.0, modelo.SEM_CURVA))
        self.assertEqual(modelo.meta_e_restante(220.0, None, None, 9, 22)[2], modelo.SEM_CURVA)

    def test_sem_meta_da_rota_usa_meta_neg(self):
        self.assertEqual(modelo.meta_e_restante(None, 80.0, 20.0, 9, 22), (80.0, 20.0, modelo.SEM_META_ROTA))
        self.assertEqual(modelo.meta_e_restante(0.0, 80.0, 20.0, 9, 22), (80.0, 20.0, modelo.SEM_META_ROTA))

    def test_as_duas_zeradas_indisponivel(self):
        self.assertEqual(modelo.meta_e_restante(0.0, 0.0, 0.0, 9, 22), (None, None, None))
        self.assertEqual(modelo.meta_e_restante(None, None, None, 9, 22), (None, None, None))

    def test_dif_e_percentual_sobre_a_meta_da_rota(self):
        meta, rest, _ = modelo.meta_e_restante(490003.0, 480000.0, 480000.0 * 281273 / 490003, 9, 22)
        b = modelo.indicador_volume(VolumeRota(meta=meta, real=125590.0, neg_restante=rest,
                                               meta_neg_clientes=480000.0), CAL)
        self.assertEqual((b["meta"], b["dif"], b["tendencia"], b["pctTendencia"], b["metaNegClientes"]),
                         (490003.0, -364413.0, 406863.0, 83, 480000.0))

    def test_casos_limite_na_montagem_e_no_aviso(self):
        d = copy.deepcopy(DADOS)
        d["metas"] = DADOS["metas"] + [_meta("Still", vol="44")]                 # sem curva
        d["meta_neg"] = DADOS["meta_neg"] + [_dia("Agua Mineral", "2026-10-01", CM.META_NEG, 8.0),
                                             _dia("Agua Mineral", "2026-10-20", CM.META_NEG, 2.0)]   # sem meta da rota
        d["vol_real"] = DADOS["vol_real"] + [_vr(1015300, "Dest+Art+Cnd", "Acertado", 0.04)]       # resíduo de decimais
        f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 13, 9, 0))
        ind = montar_payload(f)["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]
        # 21 dias úteis, 7 fechados: restam 14 contando hoje -> 44 x 14/21
        self.assertEqual((ind["VOL STILL"]["meta"], ind["VOL STILL"]["negRestante"]), (44.0, 29.3))
        self.assertIsNone(ind["VOL STILL"]["metaNegClientes"])
        self.assertEqual((ind["VOL AGUA MINERAL"]["meta"], ind["VOL AGUA MINERAL"]["negRestante"]), (10.0, 2.0))
        self.assertTrue(ind["VOL DEST+ART+CND"]["unavailable"])                 # sem metas, Real 0,04 arredonda p/ 0
        # sem nenhuma das metas, com Real (4): meta 0 e tendência = Real (27/10/2026, como o SAC soma)
        self.assertEqual([ind["VOL CERVEJAS"][c] for c in ("unavailable", "meta", "real", "tendencia")],
                         [False, 0.0, 4.0, 4.0])
        self.assertTrue(any(a.startswith("Real sem META_VOLUME nem META_NEG") and "111/Cervejas" in a
                            for a in f.avisos), f.avisos)
        self.assertTrue(any("dias úteis" in a and "111/Still" in a for a in f.avisos), f.avisos)
        self.assertTrue(any("sem META_VOLUME" in a and "111/Água Mineral" in a for a in f.avisos), f.avisos)

    def test_aviso_de_meta_nao_distribuida_por_gerencia(self):
        p = montar_payload(fontes.carregar(ConsultaFalsa(DADOS), datetime(2026, 10, 13, 9, 0)))
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertTrue(any(a.startswith("G1: meta da rota não distribuída") and "Refrigerantes 20.0" in a
                            for a in avisos), avisos)


def _dados_rota_meta():
    """META_NEG com a rota da meta (CD_ROTA_Chave_Meta_SAP). Um cliente transferido para a rota 999 (fora do
    painel) continua com a META_NEG na rota da meta 111. Refrigerantes: META_VOLUME 120 e META_NEG do mês pela
    rota da meta 120 (direto); Still: META_VOLUME 50 e META_NEG 40 (diverge > 1%: escalonado)."""
    d = copy.deepcopy(DADOS)

    def neg(ag, dia, v, rota_cli="111"):
        return dict(_dia(ag, dia, CM.META_NEG, v, rota_cli), **{CM.META_ROTA: "111"})

    d["meta_neg"] = [neg("Refrigerantes", "2026-10-01", 50.0), neg("Refrigerantes", "2026-10-20", 30.0),
                     neg("Refrigerantes", "2026-10-02", 25.0, "999"), neg("Refrigerantes", "2026-10-21", 15.0, "999"),
                     neg("Still", "2026-10-01", 30.0), neg("Still", "2026-10-20", 10.0)]
    d["metas"] = DADOS["metas"] + [_meta("Still", vol="50")]
    return d


class TestNegRestantePelaRotaDaMeta(unittest.TestCase):
    def test_regra_direto_ate_1_por_cento(self):
        self.assertEqual(modelo.meta_e_restante(100.0, 100.5, 40.0, 9, 22, direto=True), (100.0, 40.0, modelo.DIRETO))
        self.assertEqual(modelo.meta_e_restante(100.0, 99.0, 40.0, 9, 22, direto=True)[2], modelo.DIRETO)
        meta, rest, caso = modelo.meta_e_restante(100.0, 101.5, 40.0, 9, 22, direto=True)
        self.assertEqual((meta, round(rest, 4), caso), (100.0, round(100 * 40 / 101.5, 4), modelo.CURVA))
        # sem a rota da meta: sempre escalonado (regra anterior)
        self.assertEqual(modelo.meta_e_restante(100.0, 100.5, 40.0, 9, 22)[2], modelo.CURVA)
        # casos-limite não mudam
        self.assertEqual(modelo.meta_e_restante(220.0, 0.0, 0.0, 9, 22, direto=True), (220.0, 90.0, modelo.SEM_CURVA))
        self.assertEqual(modelo.meta_e_restante(None, 80.0, 20.0, 9, 22, direto=True), (80.0, 20.0, modelo.SEM_META_ROTA))

    def test_montagem_pela_rota_da_meta(self):
        cons = ConsultaFalsa(_dados_rota_meta())
        f = fontes.carregar(cons, datetime(2026, 10, 13, 9, 0))
        ind = montar_payload(f)["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]
        r = ind["VOL REFRIGERANTES"]
        # restante pela rota da meta (30 + 15, inclui o cliente transferido), sem escalonar: 120 bate com 120
        self.assertEqual((r["meta"], r["negRestante"], r["tendencia"], r["metaNegClientes"]), (120.0, 45.0, 58.0, 120.0))
        st = ind["VOL STILL"]
        self.assertEqual((st["meta"], st["negRestante"], st["metaNegClientes"]), (50.0, 12.5, 40.0))   # 50 x 10/40
        self.assertTrue(any("escalonado" in a and "111/Still" in a and "Refrigerantes" not in a for a in f.avisos),
                        f.avisos)
        # as do mês de referência (a META_NEG de setembro, da chave MES_ANTERIOR, tem o mesmo $select)
        neg = [c for c in cons.chamadas if c[1] == (CM.META_ROTA, CM.AGRUPADOR, CM.META_NEG) and "'202610'" in c[2]]
        self.assertEqual(sorted(CM.DATA in c[2] for c in neg), [False, True, True])   # mês, restante e hoje (negHoje)

    def test_sem_rota_da_meta_mantem_o_escalonado_pela_rota_do_cliente(self):
        cons = ConsultaFalsa(_dados_rota_meta(), falha=lambda sel, f: tuple(sel) == (CM.META_ROTA, CM.AGRUPADOR, CM.META_NEG))
        f = fontes.carregar(cons, datetime(2026, 10, 13, 9, 0))
        r = montar_payload(f)["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]["VOL REFRIGERANTES"]
        # pela rota do cliente só entram 50 + 30 = 80 no mês e 30 no restante: 120 x 30/80
        self.assertEqual((r["negRestante"], r["metaNegClientes"]), (45.0, 80.0))
        self.assertTrue(any("indisponível" in a and CM.META_ROTA in a for a in f.avisos), f.avisos)

    def test_fechamento_so_o_mes_pela_rota_da_meta(self):
        d = _dados_rota_meta()
        d = {**d, M.OBJ_CALENDARIO: [], "vendas": {"202610": d["vendas"]}, "vol_real": {"202610": d["vol_real"]},
             "meta_neg": {"202610": d["meta_neg"]}, "meta_dia": {}, "metas": {"202610": d["metas"]}}
        cons = ConsultaFalsa(d)
        v = montar_payload(fontes.carregar(cons, datetime(2026, 11, 3, 9, 0)))["DATA"]["G1"]["SV.G1.1"]["111"]
        r = v["indicators"]["VOL REFRIGERANTES"]
        self.assertEqual((r["meta"], r["negRestante"], r["tendencia"], r["metaNegClientes"]), (120.0, None, None, 120.0))
        self.assertFalse([c for c in cons.chamadas if CM.META_NEG in c[1] and CM.DATA in (c[2] or "")])


class TestFiltrosDeData(unittest.TestCase):
    def _cons(self, tipo="Edm.Date", amostra="2026-10-01"):
        return ConsultaFalsa({"vendas": [dict(_venda(1, "Refrigerantes"), **{CM.DATA: amostra})]}, tipo_data=tipo)

    def test_hoje_ate_o_ultimo_dia(self):
        c = self._cons()
        self.assertEqual(fontes.filtro_restante(c, date(2026, 10, 13)),
                         "DATA_MOVIMENTO ge 2026-10-13 and DATA_MOVIMENTO le 2026-10-31")
        self.assertEqual(fontes.filtro_hoje(c, date(2026, 10, 13)), "DATA_MOVIMENTO eq 2026-10-13")

    def test_ultimo_dia_do_mes(self):
        self.assertEqual(fontes.filtro_restante(self._cons(), date(2026, 10, 31)),
                         "DATA_MOVIMENTO ge 2026-10-31 and DATA_MOVIMENTO le 2026-10-31")
        self.assertEqual(fontes.ultimo_dia(date(2026, 2, 3)), date(2026, 2, 28))

    def test_dia_nao_util(self):
        # sábado: o restante começa no próprio sábado (sem META_NEG nele, não muda a soma)
        self.assertEqual(fontes.filtro_restante(self._cons(), date(2026, 10, 17)),
                         "DATA_MOVIMENTO ge 2026-10-17 and DATA_MOVIMENTO le 2026-10-31")
        d = copy.deepcopy(DADOS)
        f = fontes.carregar(ConsultaFalsa(d), datetime(2026, 10, 17, 9, 0))
        v = montar_payload(f)["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]["VOL REFRIGERANTES"]
        self.assertEqual((v["negRestante"], v["metaDia"]), (12.0, 0.0))      # 120 x 10/100; sábado sem meta do dia

    def test_virada_de_ano(self):
        self.assertEqual(fontes.filtro_restante(self._cons(), date(2026, 12, 15)),
                         "DATA_MOVIMENTO ge 2026-12-15 and DATA_MOVIMENTO le 2026-12-31")

    def test_tipos_de_coluna(self):
        self.assertEqual(fontes.filtro_hoje(self._cons("Edm.DateTimeOffset"), date(2026, 10, 13)),
                         "DATA_MOVIMENTO eq 2026-10-13T00:00:00Z")
        self.assertEqual(fontes.filtro_hoje(self._cons("Edm.String", "20261001"), date(2026, 10, 13)),
                         "DATA_MOVIMENTO eq '20261013'")
        self.assertEqual(fontes.filtro_hoje(self._cons(None, "2026-10-01"), date(2026, 10, 13)),
                         "DATA_MOVIMENTO eq '2026-10-13'")

    def test_restante_cai_na_consulta_por_dia_se_o_filtro_falhar(self):
        cons = ConsultaFalsa(DADOS, falha=lambda sel, f: CM.META_NEG in sel and " ge " in (f or ""))
        v = montar_payload(fontes.carregar(cons, datetime(2026, 10, 13, 9, 0)))["DATA"]["G1"]["SV.G1.1"]["111"]
        self.assertEqual(v["indicators"]["VOL REFRIGERANTES"]["negRestante"], 36.0)
        self.assertTrue(any(CM.DATA in c[1] for c in cons.chamadas))


class TestMetaDoDiaPorGerencia(unittest.TestCase):
    def test_repete_por_gerencia_quando_a_consulta_inteira_falha(self):
        cons = ConsultaFalsa(DADOS, falha=lambda sel, f: CM.META_RECUPERAVEL in sel and CM.GC not in (f or ""))
        v = montar_payload(fontes.carregar(cons, datetime(2026, 10, 13, 9, 0)))["DATA"]["G1"]["SV.G1.1"]["111"]
        self.assertEqual(v["indicators"]["VOL REFRIGERANTES"]["metaDia"], 5.0)
        dia = [c for c in cons.chamadas if CM.META_RECUPERAVEL in c[1]]
        self.assertTrue(any(f"{CM.GC} eq 'Gc. G1'" in c[2] for c in dia))

    def test_se_tudo_falha_fica_null_com_aviso(self):
        cons = ConsultaFalsa(DADOS, falha=lambda sel, f: CM.META_RECUPERAVEL in sel)
        p = montar_payload(fontes.carregar(cons, datetime(2026, 10, 13, 9, 0)))
        self.assertIsNone(p["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]["VOL REFRIGERANTES"]["metaDia"])
        self.assertTrue(any("meta do dia" in a for a in validar_payload(p)[1]))


class TestAgregacao(unittest.TestCase):
    """Supervisão e gerência somam as rotas e recalculam o %; Neutraliza (SV.G2.5) só entra na gerência."""

    @classmethod
    def setUpClass(cls):
        def cli(pv, rota, sv):
            return Cliente(pv=pv, nome=f"C{pv}", rota=rota, gc="G2", sv=sv, nome_sv="SUP", consultor="V",
                           segmento="Boteco", dia_visita="Seg", visita_hoje=False)

        k = "VOL REFRIGERANTES"
        cls.f = Fontes(
            cal=CAL, clientes=[cli(1, "211", "SV.G2.1"), cli(2, "212", "SV.G2.1"), cli(3, "251", "SV.G2.5")],
            cobertos={}, compraram={}, metas={},
            volume={"211": {k: VolumeRota(meta=100.0, real=40.0, neg_restante=50.0, meta_dia_hoje=6.0)},
                    "212": {k: VolumeRota(meta=300.0, real=90.0, neg_restante=180.0, meta_dia_hoje=14.0)},
                    "251": {k: VolumeRota(meta=50.0, real=0.0, neg_restante=60.0, meta_dia_hoje=3.0)}},
            volume_cliente={}, online=Online(atualizado_em=datetime(2026, 10, 13, 10, 0)))
        cls.p = montar_payload(cls.f)
        cls.k = k

    def _blocos(self, sv=None):
        return [d["indicators"][self.k] for s, rs in self.p["DATA"]["G2"].items() if sv in (None, s)
                for d in rs.values()]

    def test_supervisao(self):
        a = modelo.agrega_volume(self._blocos("SV.G2.1"))
        # (40 + 50) + (90 + 180) = 360 sobre 400 = 90% (não é a média dos % das rotas: 90% e 90%)
        self.assertEqual((a["meta"], a["real"], a["tendencia"], a["negRestante"], a["metaDia"], a["pctTendencia"]),
                         (400.0, 130.0, 360.0, 230.0, 20.0, 90))
        self.assertFalse(a["onPace"])

    def test_neutraliza_so_na_gerencia(self):
        self.assertEqual(list(self.p["DATA"]["G2"]), ["SV.G2.1", "SV.G2.5"])
        a = modelo.agrega_volume(self._blocos())
        self.assertEqual((a["meta"], a["real"], a["tendencia"], a["metaDia"], a["pctTendencia"]),
                         (450.0, 130.0, 420.0, 23.0, 93))

    def test_meta_do_dia_null_em_todas(self):
        blocos = [dict(b, metaDia=None) for b in self._blocos()]
        self.assertIsNone(modelo.agrega_volume(blocos)["metaDia"])

    def test_fechamento_usa_percentual_realizado(self):
        blocos = [modelo.indicador_volume(VolumeRota(meta=100.0, real=104.0), CAL_FECHADO),
                  modelo.indicador_volume(VolumeRota(meta=100.0, real=98.0), CAL_FECHADO)]
        self.assertEqual([b["onPace"] for b in blocos], [True, False])
        a = modelo.agrega_volume(blocos, fechamento=True)
        self.assertEqual((a["real"], a["tendencia"], a["pctTendencia"], a["metaDia"], a["onPace"]),
                         (202.0, None, None, None, True))


class TestBarraPorCliente(unittest.TestCase):
    """Real do cliente = Vol Real + online de hoje (fora do fechamento); a regra de cor não muda."""

    def test_online_somado(self):
        bloco = modelo.bloco_volume_cliente(20.0, 5.0, 33)        # 25% -> fora do ritmo
        self.assertEqual(bloco, [20.0, 5.0, 25, 0])
        self.assertEqual(modelo.bloco_cliente_com_online(bloco, 2.0, 33, False), [20.0, 7.0, 35, 1])
        self.assertEqual(modelo.bloco_cliente_com_online(bloco, 15.0, 33, False), [20.0, 20.0, 100, 2])

    def test_sem_online_ou_sem_meta(self):
        bloco = [20.0, 5.0, 25, 0]
        self.assertEqual(modelo.bloco_cliente_com_online(bloco, 0.0, 33, False), bloco)
        self.assertIsNone(modelo.bloco_cliente_com_online(None, 3.0, 33, False))

    def test_fechamento_nao_soma_online(self):
        bloco = [20.0, 19.0, 95, 0]
        self.assertEqual(modelo.bloco_cliente_com_online(bloco, 5.0, 100, True), bloco)


# --------------------------------------------------------------------- período de fechamento
def _cal_ds(*linhas):
    return [{"DATA": d, "NO_DIAS_UTEIS_MES": t, "NO_DIA_UTIL": n, "NO_DIAS_UTEIS_RESTANTES": 0} for d, t, n in linhas]


def _metas_nov(*rotas, cob="5"):
    return [_meta("Refrigerantes", cob=cob, vol="100", rota=r) for r in rotas]


class TestPeriodoFechamento(unittest.TestCase):
    GC = {"111": "G1", "211": "G2", "I11": "IT", "M11": "MO"}

    def _decide(self, hoje, metas=(), cal_linhas=()):
        cons = ConsultaFalsa({"metas": {"202611": list(metas)}, M.OBJ_CALENDARIO: list(cal_linhas)})
        return fontes.decidir_fechamento(cons, hoje, list(cal_linhas), self.GC), cons

    def test_dia_1_no_domingo(self):
        cal, cons = self._decide(date(2026, 11, 1), _metas_nov("111", "211", "I11"))
        self.assertTrue(cal.fechamento)
        self.assertEqual((cal.mes_label, cal.anomes, cal.total_dias_uteis, cal.dia_hoje, cal.dia_ontem,
                          cal.pace_ontem_pct, cal.dia_semana), ("Outubro/26", "202610", 21, 21, 21, 100, "Domingo"))
        self.assertFalse(cons.chamadas)          # antes do 1º dia útil nem consulta as metas

    def test_primeiro_dia_util_apos_feriado(self):
        # 02/11/26 (segunda) é Finados: o 1º dia útil é 03/11 e o 2º, 04/11
        tudo = _metas_nov("111", "211", "I11")
        self.assertEqual(calmod.dia_util_hoje([], date(2026, 11, 2)), 0)
        self.assertTrue(self._decide(date(2026, 11, 2), tudo)[0].fechamento)
        self.assertTrue(self._decide(date(2026, 11, 3), tudo)[0].fechamento)
        self.assertIsNone(self._decide(date(2026, 11, 4), tudo)[0])

    def test_metas_so_de_parte_das_gerencias(self):
        cal, _ = self._decide(date(2026, 11, 4), _metas_nov("111", "211"))      # falta IT_MO
        self.assertTrue(cal.fechamento)
        cal, _ = self._decide(date(2026, 11, 4), _metas_nov("111", "211", "M11"))  # MO cobre IT_MO
        self.assertIsNone(cal)
        cal, _ = self._decide(date(2026, 11, 4), _metas_nov("111", "211", "I11", cob="0"))   # sem META_COBERTURA
        self.assertTrue(cal.fechamento)

    def test_segundo_dia_util_sem_metas(self):
        cal, _ = self._decide(date(2026, 11, 4))
        self.assertTrue(cal.fechamento)
        cal, _ = self._decide(date(2026, 11, 10))    # segue em fechamento depois do 2º dia útil
        self.assertTrue(cal.fechamento)

    def test_calendario_do_datasphere(self):
        linhas = _cal_ds(("2026-10-30", 21, 21), ("2026-11-03", 19, 1), ("2026-11-04", 19, 2))
        self.assertEqual(calmod.dia_util_hoje(linhas, date(2026, 11, 3)), 1)
        self.assertEqual(calmod.dia_util_hoje(linhas, date(2026, 11, 4)), 2)
        self.assertEqual(calmod.total_dias_uteis(linhas, date(2026, 10, 1)), 21)
        self.assertTrue(self._decide(date(2026, 11, 3), _metas_nov("111", "211", "I11"), linhas)[0].fechamento)
        self.assertIsNone(self._decide(date(2026, 11, 4), _metas_nov("111", "211", "I11"), linhas)[0])

    def test_regra(self):
        self.assertTrue(calmod.em_fechamento(0, True))
        self.assertTrue(calmod.em_fechamento(1, True))
        self.assertTrue(calmod.em_fechamento(2, False))
        self.assertFalse(calmod.em_fechamento(2, True))

    def test_so_online_segue_o_payload_publicado(self):
        self.assertEqual(fontes.fechamento_pelo_payload({"MES_LABEL": "Outubro/26"}, date(2026, 11, 3)), "Outubro/26")
        self.assertIsNone(fontes.fechamento_pelo_payload({"MES_LABEL": "Novembro/26"}, date(2026, 11, 5)))
        self.assertIsNone(fontes.fechamento_pelo_payload(None, date(2026, 11, 5)))


# --------------------------------------------------------------------- payload em fechamento
def _dados_fechamento():
    """Outubro (mês anterior) completo + pedidos de hoje (03/11) no mês novo, sem metas de novembro."""
    d = copy.deepcopy(DADOS)
    d[M.OBJ_CALENDARIO] = []
    d["vendas"] = {"202610": DADOS["vendas"],
                   "202611": [_venda(1007382, "Refrigerantes", on=0, vol_on=8.0),
                              _venda(1011537, "Ks Tt", on=1)]}
    d["vol_real"] = {"202610": DADOS["vol_real"], "202611": [_vr(1015300, "Refrigerantes", "Em Aberto", 99.0)]}
    d["meta_neg"] = {"202610": DADOS["meta_neg"]}
    d["meta_dia"] = {"202610": DADOS["meta_dia"]}
    d["metas"] = {"202610": DADOS["metas"]}
    return d


class TestPayloadFechamento(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cons = ConsultaFalsa(_dados_fechamento())
        cls.f = fontes.carregar(cls.cons, datetime(2026, 11, 3, 9, 30))
        cls.p = montar_payload(cls.f)
        cls.o = montar_online(cls.f.online)
        cls.d = cls.p["DATA"]["G1"]["SV.G1.1"]["111"]

    def test_calendario_do_mes_anterior(self):
        self.assertTrue(self.p["FECHAMENTO"])
        self.assertEqual((self.p["MES_LABEL"], self.p["TOTAL_DIAS_UTEIS"], self.p["DIA_ONTEM"], self.p["DIA_HOJE"],
                          self.p["PACE_ONTEM_PCT"], self.p["DIA_SEMANA"]),
                         ("Outubro/26", 21, 21, 21, 100, "Terça-feira"))
        # último dia útil fechado: o do mês de referência (30/10/2026, sexta)
        self.assertEqual((self.p["DATA_ONTEM"], self.p["DIA_ONTEM_NOME"]), ("2026-10-30", "sexta-feira"))

    def test_volume_sem_tendencia_nem_meta_do_dia(self):
        v = self.d["indicators"]["VOL REFRIGERANTES"]
        # % realizado sobre a meta da rota (META_VOLUME de outubro): 13 / 120
        self.assertEqual((v["meta"], v["real"], v["dif"], v["tendencia"], v["pctTendencia"], v["metaDia"],
                          v["negRestante"], v["onPace"], v["unavailable"], v["metaNegClientes"]),
                         (120.0, 13.0, -107.0, None, None, None, None, False, False, 100.0))
        self.assertFalse([c for c in self.cons.chamadas if CM.META_NEG in c[1] and CM.DATA in (c[2] or "")])

    def test_cobertura_do_mes_anterior(self):
        cctm = self.d["indicators"]["CCTM 2L PET"]
        self.assertEqual((cctm["meta"], cctm["real"], cctm["gap"]), (3, 1, 2))   # gap = meta - real (mês fechado)

    def test_venda_zero_indisponivel(self):
        self.assertTrue(self.d["indicators"]["VENDAZERO"]["unavailable"])
        self.assertFalse(self.p["FONTES"]["vendazero"])
        self.assertFalse([c for c in self.cons.chamadas if c[0] == M.OBJ_COMODATO])

    def test_online_de_hoje_com_fechamento_mes(self):
        self.assertEqual(self.o["fechamentoMes"], "Outubro/26")
        self.assertEqual(self.o["rotas"], {"111": {"KS TT": 1}})
        self.assertEqual(self.o["volume"], {"111": {"VOL REFRIGERANTES": 8.0}})
        self.assertEqual(self.o["volumeCliente"], {"111": {"1007382": {"VOL REFRIGERANTES": 8.0}}})

    def test_barra_por_cliente_so_do_mes_anterior(self):
        self.assertEqual(self.p["VOLUME_CLIENTE"]["111"]["1015300"][0], [20.0, 10.0, 50, 0])   # ritmo = 100%

    def test_consultas(self):
        meta = [c for c in self.cons.chamadas if c[0] == M.OBJ_META]
        hoje = [c for c in meta if "'202611'" in c[2]]
        # mês novo: só os pedidos WF Online de hoje (no 1º dia útil nem consulta as metas das gerências)
        self.assertEqual(len(hoje), 1)
        self.assertIn("FONTE eq 'WF Online'", hoje[0][2])
        self.assertFalse([c for c in meta if CM.META_RECUPERAVEL in c[1]])

    def test_validacao(self):
        erros, avisos = validar_payload(self.p)
        self.assertEqual(erros, [])
        self.assertTrue(any("fechamento do mês" in a for a in avisos), avisos)

    def test_tag_manual_sobrepoe_o_rotulo(self):
        f = fontes.carregar(ConsultaFalsa(_dados_fechamento()), datetime(2026, 11, 3, 9, 30), fechamento="Out/26")
        self.assertEqual(montar_online(f.online)["fechamentoMes"], "Out/26")
        f = fontes.carregar(ConsultaFalsa(DADOS), datetime(2026, 10, 13, 9, 30), fechamento="Setembro/26")
        self.assertEqual(montar_online(f.online)["fechamentoMes"], "Setembro/26")
        self.assertFalse(f.cal.fechamento)        # no dia a dia, a tag manual não muda o mês do payload


class TestMetaDoDiaAusente(unittest.TestCase):
    def test_sem_a_coluna_meta_dia_fica_null(self):
        class SemRecuperavel(ConsultaFalsa):
            def colunas(self, objeto):
                return [c for c in super().colunas(objeto) if c != CM.META_RECUPERAVEL]

        p = montar_payload(fontes.carregar(SemRecuperavel(DADOS), datetime(2026, 10, 13, 9, 0)))
        v = p["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]["VOL REFRIGERANTES"]
        self.assertIsNone(v["metaDia"])
        self.assertEqual(v["tendencia"], 49.0)
        _, avisos = validar_payload(p)
        self.assertTrue(any("meta do dia" in a for a in avisos), avisos)


class TestValidacaoVirada(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = montar_payload(fontes.carregar(ConsultaFalsa(DADOS), datetime(2026, 10, 13, 9, 0)))

    def _anterior(self, label, n_rotas=10, real=1000.0):
        ind = {k: {"real": real} for k in M.INDICADORES_VOLUME}
        return {"MES_LABEL": label, "DATA": {"G1": {"SV": {str(i): {"baseTotal": 100, "indicators": ind}
                                                           for i in range(n_rotas)}}}}

    def test_mesmo_mes_reprova_queda(self):
        erros, _ = validar_payload(self.p, self._anterior("Outubro/26"))
        self.assertTrue(any("rotas caíram" in e for e in erros), erros)
        self.assertTrue(any("volume real caiu" in e for e in erros), erros)

    def test_virada_so_avisa(self):
        erros, avisos = validar_payload(self.p, self._anterior("Setembro/26"))
        self.assertEqual(erros, [])
        self.assertTrue(any("virada Setembro/26 -> Outubro/26" in a and "volume" in a for a in avisos), avisos)


if __name__ == "__main__":
    unittest.main()
