"""
Ida e volta com os arquivos que o painel já publicava (amostra em tests/dados):
reconstrói as fontes a partir do payload/online e confere se a montagem gera o mesmo conteúdo.

Diferenças toleradas (são do arquivo antigo, não da montagem):
  - percentuais recalculados a partir de valores já arredondados (pctTendencia e pct por cliente ±1);
  - I31/M31 (sem vendedor): tendência de volume com realizado zero, que não tem como ser reproduzida;
  - 19 equipamentos de Venda Zero cujo "revertido" foi calculado com um online.json mais antigo que o
    publicado, e rotas de IT/MO cuja oportunidade incluía os já revertidos.
"""
from __future__ import annotations

import copy
import json
import unittest
from datetime import date, datetime
from pathlib import Path

from gerador import mapeamento as M
from gerador.online import montar_online
from gerador.payload import montar_payload, online_ks_tt
from gerador.saida import serializar
from gerador.tipos import Calendario, Cliente, Equipamento, Fontes, Online
from gerador.validacao import validar_payload
from tests.reverso import fontes_de, online_de

# amostra congelada (16 rotas) do payload/online publicados à mão em 13/10/2026 14:10
DADOS = Path(__file__).resolve().parent / "dados"
HOJE = date(2026, 10, 13)


def _carregar():
    p = json.loads((DADOS / "payload_ref.json").read_text(encoding="utf-8"))
    o = json.loads((DADOS / "online_ref.json").read_text(encoding="utf-8"))
    return p, o


@unittest.skipUnless((DADOS / "payload_ref.json").exists(), "payload de referência ausente")
class TestIdaEVolta(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p, cls.o = _carregar()
        cls.g = montar_payload(fontes_de(cls.p, cls.o, HOJE))

    def test_chaves_e_constantes(self):
        self.assertEqual(list(self.g), list(self.p))
        for k in ["MES_LABEL", "TOTAL_DIAS_UTEIS", "DIA_ONTEM", "DIA_HOJE", "PACE_ONTEM_PCT", "SEMANA_NUM",
                  "SEMANA_TIPO", "DIA_SEMANA", "GC_ATIVAS", "NOME_SUPERVISOR", "LABELS", "GROUPS", "COV_GRUPO",
                  "LABELS_CURTO", "SEGS", "DIAS", "FONTES"]:
            self.assertEqual(self.g[k], self.p[k], k)

    def test_arvore_e_ordem(self):
        self.assertEqual({gc: {sv: list(r) for sv, r in s.items()} for gc, s in self.g["DATA"].items()},
                         {gc: {sv: list(r) for sv, r in s.items()} for gc, s in self.p["DATA"].items()})

    def test_listas_de_clientes(self):
        for k in ["CLIENT_ROSTER", "CLIENTES_HOJE", "OPORTUNIDADES_DIA", "VISITAS_DIA", "COBERTOS",
                  "SEM_COMPRA_HOJE", "COMODATO_ATIVOS"]:
            self.assertEqual(self.g[k], self.p[k], k)

    def test_redes(self):
        self.assertEqual(self.g["REDES_CLIENTE"], self.p["REDES_CLIENTE"])

    def test_indicadores(self):
        difs = []
        for gc, svs in self.p["DATA"].items():
            for sv, rotas in svs.items():
                for r, d in rotas.items():
                    gd = self.g["DATA"][gc][sv][r]
                    for campo in ["consultor", "baseTotal", "baseKsTt", "compraram", "semCompra"]:
                        self.assertEqual(gd[campo], d[campo], (r, campo))
                    self.assertEqual(list(gd["indicators"]), M.ORDEM_INDICADORES)
                    for k, b in d["indicators"].items():
                        gb = gd["indicators"][k]
                        if k in M.INDICADORES_VOLUME and not b["unavailable"] and b["real"] == 0 and b["tendencia"]:
                            # I31/M31 (rotas "Neutraliza", sem vendedor): o arquivo antigo trazia tendência
                            # sem nenhum realizado; o gerador novo projeta a partir do realizado (= 0).
                            self.assertEqual(gb["tendencia"], 0.0, (r, k))
                        elif k in M.INDICADORES_VOLUME and not b["unavailable"]:
                            for campo in ["meta", "real", "metaDia", "tendencia", "unavailable", "semDadoHoje"]:
                                self.assertAlmostEqual(gb[campo], b[campo], places=6, msg=(r, k, campo))
                            self.assertLessEqual(abs(gb["dif"] - b["dif"]), 0.1001, (r, k))
                            if b["pctTendencia"] is None:
                                self.assertIsNone(gb["pctTendencia"], (r, k))
                            else:
                                self.assertLessEqual(abs(gb["pctTendencia"] - b["pctTendencia"]), 1, (r, k))
                        elif k == "VENDAZERO":
                            iguais = {c: gb[c] == b[c] for c in b}
                            if not all(iguais.values()):
                                difs.append((r, [c for c, ok in iguais.items() if not ok]))
                        else:
                            self.assertEqual(gb, b, (r, k))
        # só revertido/oportunidade podem divergir (19 equipamentos com o online defasado no arquivo antigo)
        for r, campos in difs:
            self.assertLessEqual(set(campos), {"revertidoHoje", "oportunidadeHoje"}, r)
        self.assertLessEqual(len(difs), 30)

    def test_vendazero_clientes(self):
        divergentes = 0
        for r, lista in self.p["VENDAZERO_CLIENTES"].items():
            gl = self.g["VENDAZERO_CLIENTES"][r]
            self.assertEqual(len(gl), len(lista), r)
            for a, b in zip(gl, lista):
                self.assertEqual({k: v for k, v in a.items() if k != "revertido"},
                                 {k: v for k, v in b.items() if k != "revertido"}, r)
                divergentes += a["revertido"] != b["revertido"]
        self.assertLessEqual(divergentes, 19)

    def test_volume_cliente(self):
        fora = 0
        for r, clientes in self.p["VOLUME_CLIENTE"].items():
            self.assertEqual(list(self.g["VOLUME_CLIENTE"][r]), list(clientes), r)
            for pv, blocos in clientes.items():
                for a, b in zip(self.g["VOLUME_CLIENTE"][r][pv], blocos):
                    if b is None:
                        self.assertIsNone(a)
                        continue
                    self.assertEqual(a[:2], b[:2], (r, pv))
                    fora += a[2:] != b[2:]
        # pct do arquivo antigo foi calculado com meta/real sem arredondar; aqui só temos 1 casa
        self.assertLess(fora, 0.25 * sum(len(c) * 5 for c in self.p["VOLUME_CLIENTE"].values()))

    def test_estavel_e_menor(self):
        a = serializar(self.g)
        b = serializar(montar_payload(fontes_de(self.p, self.o, HOJE)))
        self.assertEqual(a, b)
        self.assertLess(len(a), len(json.dumps(self.p, ensure_ascii=False)))   # formato antigo, com espaços


@unittest.skipUnless((DADOS / "online_ref.json").exists(), "online de referência ausente")
class TestOnline(unittest.TestCase):
    def test_ida_e_volta(self):
        _, o = _carregar()
        g = montar_online(online_de(o))
        self.assertEqual(g["updatedAt"], o["updatedAt"])
        self.assertEqual(g["rotas"], o["rotas"])
        self.assertEqual(g["clientes"], o["clientes"])
        self.assertEqual(set(g["volume"]), set(o["volume"]))
        for r, v in o["volume"].items():
            for k, x in v.items():
                self.assertAlmostEqual(g["volume"][r][k], x, places=3)


class TestSegmentoKsTt(unittest.TestCase):
    """KS TT só nos 4 segmentos; cobertura conta para a rota da venda mesmo fora do roster; meta sem filtro.

    Rota 111 (base): PV 1 Boteco e PV 3 Lanchonete (elegíveis), PV 2 Mercearia (não elegível; na venda
    aparece como Boteco, mas vale a base). Saíram da base da rota (transferidos/desativados):
    PV 999 Padarias, PV 998 Super e PV 997 sem segmento conhecido.
    """

    @classmethod
    def setUpClass(cls):
        cal = Calendario(hoje=date(2026, 10, 16), total_dias_uteis=22, dia_hoje=12, dia_ontem=11, semana_num=3,
                         semana_tipo="ímpar", dia_semana="Sexta-feira", mes_label="Outubro/26")

        def cli(pv, seg, hoje):
            return Cliente(pv=pv, nome=f"CLIENTE {pv}", rota="111", gc="G1", sv="SV.G1.1", nome_sv="SUP",
                           consultor="VEND", segmento=seg, dia_visita="Sex", visita_hoje=hoje)

        cls.seg_venda = {1: "Boteco", 2: "Boteco", 3: "Lanchonete", 998: "Super", 999: "Padarias"}
        cls.online = Online(atualizado_em=datetime(2026, 10, 16, 10, 0),
                            clientes={"111": {"KS TT": {2, 3, 997, 998, 999}, "CCTM 2L PET": {2, 999}}},
                            qualquer={"111": {2, 3, 997, 998, 999}})
        cls.f = Fontes(
            cal=cal, clientes=[cli(1, "Boteco", True), cli(2, "Mercearia", True), cli(3, "Lanchonete", False)],
            cobertos={"111": {"KS TT": {1, 2, 997, 998, 999}, "CCTM 2L PET": {1, 2, 997, 998, 999}}},
            compraram={"111": {1, 2, 997, 998, 999}},
            metas={"111": {"KS TT": 10.0, "CCTM 2L PET": 5.0}},
            volume={}, volume_cliente={}, online=cls.online,
            vendazero={"111": [Equipamento(pv=2, nome="Cliente 2", dia="Sex", hoje=True, tipo="Geladeira", vdz=1,
                                           meta_comodato=10.0, volume=0.0)]},
            vz_meta={"111": 1.0}, segmento_venda=cls.seg_venda)
        cls.p = montar_payload(cls.f)
        cls.d = cls.p["DATA"]["G1"]["SV.G1.1"]["111"]
        cls.o = montar_online(online_ks_tt(cls.online, cls.p, cls.seg_venda))

    def test_ks_tt_real_so_segmentos_elegiveis(self):
        self.assertEqual(self.d["baseKsTt"], 2)
        self.assertEqual(self.p["COBERTOS"]["111"]["KS TT"], [1, 999])
        self.assertEqual(self.d["indicators"]["KS TT"]["real"], 2)

    def test_ks_tt_online_so_segmentos_elegiveis(self):
        self.assertEqual(self.o["clientes"]["111"]["KS TT"], [3, 999])
        self.assertEqual(self.o["rotas"]["111"]["KS TT"], 2)

    def test_fora_do_roster_conta_na_rota_da_venda(self):
        self.assertEqual(self.p["COBERTOS"]["111"]["CCTM 2L PET"], [1, 2, 997, 998, 999])
        self.assertEqual(self.d["indicators"]["CCTM 2L PET"]["real"], 5)
        self.assertEqual(self.o["clientes"]["111"]["CCTM 2L PET"], [2, 999])
        self.assertEqual(self.o["rotas"]["111"]["CCTM 2L PET"], 2)

    def test_meta_ks_tt_inalterada(self):
        self.assertEqual(self.d["indicators"]["KS TT"]["meta"], 10)
        self.assertEqual(self.d["indicators"]["CCTM 2L PET"]["meta"], 5)

    def test_qualquer_e_venda_zero_inalterados(self):
        self.assertEqual(self.o["clientes"]["111"]["QUALQUER"], [2, 3, 997, 998, 999])
        self.assertEqual(self.o["clientes"]["111"]["QUALQUER"], montar_online(self.online)["clientes"]["111"]["QUALQUER"])
        self.assertTrue(self.p["VENDAZERO_CLIENTES"]["111"][0]["revertido"])

    def test_filtro_idempotente(self):
        duas = online_ks_tt(online_ks_tt(self.online, self.p, self.seg_venda), self.p, self.seg_venda)
        self.assertEqual(montar_online(duas), self.o)

    def test_online_sem_payload_usa_segmento_da_venda(self):
        o = montar_online(online_ks_tt(self.online, None, self.seg_venda))
        self.assertEqual(o["clientes"]["111"]["KS TT"], [2, 3, 999])

    def test_validacao_ks_tt(self):
        erros, avisos = validar_payload(self.p)
        self.assertFalse([e for e in erros + avisos if "KS TT" in e], erros + avisos)
        # cliente da base com segmento não elegível no KS TT: reprova
        ruim = copy.deepcopy(self.p)
        ruim["COBERTOS"]["111"]["KS TT"] = [1, 2]
        erros, _ = validar_payload(ruim)
        self.assertTrue(any("KS TT" in e and "111" in e for e in erros), erros)
        # real acima da base elegível (clientes que saíram da rota): só avisa
        acima = copy.deepcopy(self.p)
        acima["DATA"]["G1"]["SV.G1.1"]["111"]["indicators"]["KS TT"]["real"] = 3
        erros, avisos = validar_payload(acima)
        self.assertFalse([e for e in erros if "KS TT" in e], erros)
        self.assertTrue(any("KS TT" in a and "111" in a for a in avisos), avisos)


if __name__ == "__main__":
    unittest.main()
