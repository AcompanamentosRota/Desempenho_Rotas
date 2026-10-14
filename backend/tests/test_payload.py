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

import json
import unittest
from datetime import date
from pathlib import Path

from gerador import mapeamento as M
from gerador.online import montar_online
from gerador.payload import montar_payload
from gerador.saida import serializar
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


if __name__ == "__main__":
    unittest.main()
