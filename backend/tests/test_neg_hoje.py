"""
Neg de hoje (negHoje) por rota x macro de volume (sem rede, dados sintéticos).

negHoje = a parte da Neg Restante (META_NEG de hoje ao fim do mês, critério do SAC) planejada para hoje, na mesma base
(rota da meta, ou a rota do cliente no plano B da curva) e na mesma escala do caso de modelo.meta_e_restante:
direto = bruto; curva = Meta x bruto / META_NEG do mês; sem_curva = Meta / dias úteis do mês; sem_meta_rota = bruto;
sem_meta e rota oculta das EV* = 0; dia não útil, sem linha de hoje, consulta que falhou e fechamento = null.
Só informado: nenhum outro número do payload muda. O espelho em frontend/js/nucleo.js (NUCLEO.agrega) soma igual.
"""
import copy
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from gerador import fontes, modelo
from gerador.payload import montar_payload
from gerador.tipos import Calendario, VolumeRota
from gerador.validacao import validar_payload
from tests.test_eventuais_meta_dia import _ev
from tests.test_fontes import CM, DADOS, ConsultaFalsa, _dia, _meta
from tests.test_tendencia_fechamento import CAL, CAL_FECHADO

AGORA = datetime(2026, 10, 13, 9, 0)     # terça, dia útil 8 de 21 (DIA_ONTEM 7): 14 dias úteis pela frente, com hoje
REF, CERV, STILL, AGUA, DAC = ("VOL REFRIGERANTES", "VOL CERVEJAS", "VOL STILL", "VOL AGUA MINERAL",
                               "VOL DEST+ART+CND")
FRONT = Path(__file__).resolve().parents[2] / "frontend"


def _neg(ag, dia, v, rota_cli="111", rota_meta="111"):
    return dict(_dia(ag, dia, CM.META_NEG, v, rota_cli), **{CM.META_ROTA: rota_meta})


def _dados():
    """Rota 111 (G1) com um caso por macro, META_NEG pela rota da meta com linhas de hoje (13/10):
    Refrigerantes  direto:        META_VOLUME 120; META_NEG do mês 120 (5 de um cliente hoje na 999); restante 45; hoje 15
    Still          curva:         META_VOLUME 50; META_NEG do mês 40; restante 10; hoje 4 -> 50 x 4/40 = 5
    Água Mineral   sem_curva:     META_VOLUME 210, sem META_NEG: restante 210 x 14/21 = 140; hoje 210/21 = 10
    Dest+Art+Cnd   sem_meta_rota: sem META_VOLUME; META_NEG do mês 10; restante 10; hoje 3
    Cervejas       sem_meta:      Real 4 sem meta nenhuma (meta 0, Neg Restante 0): hoje 0
    G1-EV          rota oculta das EV* (Real de um cliente em EV1 com rota da meta): hoje 0"""
    d = copy.deepcopy(DADOS)
    d["meta_neg"] = [
        _neg("Refrigerantes", "2026-10-01", 50.0), _neg("Refrigerantes", "2026-10-13", 10.0),
        _neg("Refrigerantes", "2026-10-20", 20.0),
        _neg("Refrigerantes", "2026-10-02", 25.0, "999"), _neg("Refrigerantes", "2026-10-13", 5.0, "999"),
        _neg("Refrigerantes", "2026-10-21", 10.0, "999"),
        _neg("Still", "2026-10-01", 30.0), _neg("Still", "2026-10-13", 4.0), _neg("Still", "2026-10-20", 6.0),
        _neg("Dest+Art+Cnd", "2026-10-13", 3.0), _neg("Dest+Art+Cnd", "2026-10-26", 7.0),
        _neg("Refrigerantes", "2026-10-13", 9.0, "888", "888"),       # rota fora do painel
    ]
    d["metas"] = DADOS["metas"] + [_meta("Still", vol="50"), _meta("Agua Mineral", vol="210")]
    d["vol_real"] = DADOS["vol_real"] + [_ev(12.0, "Gc. G1")]
    return d


def _ind(p, rota="111"):
    for svs in p["DATA"].values():
        for rotas in svs.values():
            if rota in rotas:
                return rotas[rota]["indicators"]
    raise KeyError(rota)


def _sem_neg_hoje(p):
    """O payload sem o campo novo (para comparar o resto)."""
    p = copy.deepcopy(p)
    for svs in p["DATA"].values():
        for rotas in svs.values():
            for d in rotas.values():
                for b in d["indicators"].values():
                    b.pop("negHoje", None)
    return p


class TestModelo(unittest.TestCase):
    def test_cada_caso(self):
        self.assertEqual(modelo.neg_hoje(modelo.DIRETO, 120.0, 120.0, 15.0, 21), 15.0)
        self.assertEqual(modelo.neg_hoje(modelo.CURVA, 50.0, 40.0, 4.0, 21), 5.0)          # o fator do restante
        self.assertEqual(modelo.neg_hoje(modelo.SEM_CURVA, 210.0, None, 0.0, 21), 10.0)    # Meta / dias úteis
        self.assertEqual(modelo.neg_hoje(modelo.SEM_CURVA, 210.0, 0.0, 7.0, 21), 10.0)     # bruto não entra
        self.assertEqual(modelo.neg_hoje(modelo.SEM_META_ROTA, 10.0, 10.0, 3.0, 21), 3.0)
        self.assertEqual(modelo.neg_hoje(modelo.SEM_META, 0.0, None, 0.0, 21), 0.0)
        # sem o dado de hoje (dia não útil, falha, fechamento) ou indicador indisponível: null em qualquer caso
        for caso in (modelo.DIRETO, modelo.CURVA, modelo.SEM_CURVA, modelo.SEM_META_ROTA, modelo.SEM_META):
            self.assertIsNone(modelo.neg_hoje(caso, 100.0, 100.0, None, 21), caso)
        self.assertIsNone(modelo.neg_hoje(None, None, None, 5.0, 21))

    def test_mesma_escala_da_neg_restante(self):
        # negHoje / negRestante = bruto de hoje / restante bruto nos casos com curva; 0 <= negHoje <= negRestante
        for mv, nm, rest, hoje, direto in [(120.0, 120.0, 45.0, 15.0, True), (50.0, 40.0, 10.0, 4.0, True),
                                           (100.0, 100.5, 40.0, 8.0, False), (220.0, 0.0, 0.0, 0.0, True),
                                           (None, 80.0, 20.0, 6.0, True)]:
            meta, nr, caso = modelo.meta_e_restante(mv, nm, rest, 14, 21, direto=direto)
            nh = modelo.neg_hoje(caso, meta, nm, hoje, 21)
            self.assertTrue(0 <= nh <= nr, (caso, nh, nr))
            if caso != modelo.SEM_CURVA:
                self.assertAlmostEqual(nh * rest, nr * hoje)
        # sem_curva no último dia útil (1 dia pela frente, com hoje): negHoje = negRestante
        meta, nr, caso = modelo.meta_e_restante(210.0, None, None, 1, 21)
        self.assertAlmostEqual(modelo.neg_hoje(caso, meta, None, 0.0, 21), nr)

    def test_indicador(self):
        b = modelo.indicador_volume(VolumeRota(meta=50.0, real=10.0, neg_restante=12.5, neg_hoje=5.04), CAL)
        self.assertEqual((b["negRestante"], b["negHoje"], b["tendencia"]), (12.5, 5.0, 22.5))
        self.assertIsNone(modelo.indicador_volume(VolumeRota(meta=50.0, real=10.0, neg_restante=12.5), CAL)["negHoje"])
        fech = modelo.indicador_volume(VolumeRota(meta=50.0, real=10.0, neg_hoje=5.0), CAL_FECHADO)
        self.assertIsNone(fech["negHoje"])
        self.assertNotIn("negHoje", modelo.volume_indisponivel())

    def test_agrega(self):
        def bloco(nh, rest=20.0):
            return modelo.indicador_volume(VolumeRota(meta=100.0, real=10.0, neg_restante=rest, neg_hoje=nh), CAL)
        self.assertEqual(modelo.agrega_volume([bloco(5.0), bloco(2.5), None, {"unavailable": True}])["negHoje"], 7.5)
        self.assertEqual(modelo.agrega_volume([bloco(5.0), bloco(None)])["negHoje"], 5.0)
        self.assertIsNone(modelo.agrega_volume([bloco(None), bloco(None)])["negHoje"])
        antigo = [{k: v for k, v in bloco(5.0).items() if k != "negHoje"}]           # payload antigo, sem o campo
        a = modelo.agrega_volume(antigo)
        self.assertIsNone(a["negHoje"])
        self.assertEqual((a["negRestante"], a["tendencia"]), (20.0, 30.0))
        fech = [modelo.indicador_volume(VolumeRota(meta=100.0, real=98.0), CAL_FECHADO)]
        self.assertIsNone(modelo.agrega_volume(fech, fechamento=True)["negHoje"])

    def test_calendario(self):
        self.assertTrue(CAL.hoje_util)
        self.assertFalse(CAL_FECHADO.hoje_util)
        sabado = Calendario(hoje=date(2026, 10, 17), total_dias_uteis=21, dia_hoje=11, dia_ontem=11, semana_num=2,
                            semana_tipo="par", dia_semana="Sábado", mes_label="Outubro/26")
        self.assertFalse(sabado.hoje_util)


class TestFontes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cons = ConsultaFalsa(_dados())
        cls.f = fontes.carregar(cls.cons, AGORA)
        cls.p = montar_payload(cls.f)

    def test_casos(self):
        ind = _ind(self.p)
        got = {k: (ind[k]["meta"], ind[k]["negRestante"], ind[k]["negHoje"]) for k in (REF, STILL, AGUA, DAC, CERV)}
        self.assertEqual(got, {REF: (120.0, 45.0, 15.0),         # direto: inclui o cliente hoje na 999
                               STILL: (50.0, 12.5, 5.0),         # curva: 50 x 4/40
                               AGUA: (210.0, 140.0, 10.0),       # sem_curva: 210 / 21
                               DAC: (10.0, 10.0, 3.0),           # sem_meta_rota
                               CERV: (0.0, 0.0, 0.0)})           # sem_meta
        ev = _ind(self.p, "G1-EV")[REF]
        self.assertEqual((ev["meta"], ev["real"], ev["negRestante"], ev["negHoje"]), (0, 12.0, 0.0, 0.0))

    def test_consulta(self):
        hoje = [c for c in self.cons.chamadas if CM.META_NEG in c[1] and c[2] and "DATA_MOVIMENTO eq" in c[2]]
        self.assertEqual(len(hoje), 1)                                  # pela rota da meta (a curva ficou nela)
        self.assertEqual(hoje[0][1], (CM.META_ROTA, CM.AGRUPADOR, CM.META_NEG))   # data só no $filter
        self.assertIn("DATA_MOVIMENTO eq 2026-10-13", hoje[0][2])
        self.assertIn("neg_hoje_s", self.f.tempos)

    def test_validacao_sem_aviso(self):
        erros, avisos = validar_payload(self.p)
        self.assertEqual(erros, [])
        self.assertFalse([a for a in avisos if "negHoje" in a], avisos)

    def test_nenhum_outro_numero_muda(self):
        # a mesma fonte sem a consulta de hoje (falha): só o campo novo muda (null em todas as rotas)
        def falha(sel, filtro):
            return CM.META_NEG in sel and "DATA_MOVIMENTO eq" in (filtro or "")
        f = fontes.carregar(ConsultaFalsa(_dados(), falha=falha), AGORA)
        p = montar_payload(f)
        for r in ("111", "G1-EV"):
            self.assertTrue(all(b.get("negHoje") is None for b in _ind(p, r).values()))
        self.assertTrue(any("META_NEG de hoje indisponível" in a for a in f.avisos), f.avisos)
        self.assertEqual(json.dumps(_sem_neg_hoje(p), sort_keys=True), json.dumps(_sem_neg_hoje(self.p), sort_keys=True))

    def test_http_500_repete_por_gerencia(self):
        def falha(sel, filtro):
            return CM.META_NEG in sel and "DATA_MOVIMENTO eq" in (filtro or "") and f"{CM.GC} eq" not in filtro
        cons = ConsultaFalsa(_dados(), falha=falha)
        ind = _ind(montar_payload(fontes.carregar(cons, AGORA)))
        self.assertEqual((ind[REF]["negHoje"], ind[STILL]["negHoje"]), (15.0, 5.0))
        self.assertTrue(any(f"{CM.GC} eq" in (c[2] or "") and "DATA_MOVIMENTO eq" in c[2] for c in cons.chamadas))

    def test_curva_pela_rota_do_cliente(self):
        # rota da meta indisponível: a curva e a Neg de hoje vão juntas para a rota do cliente (sempre escalonada)
        cons = ConsultaFalsa(_dados(), falha=lambda sel, f: tuple(sel) == (CM.META_ROTA, CM.AGRUPADOR, CM.META_NEG))
        f = fontes.carregar(cons, AGORA)
        ind = _ind(montar_payload(f))
        # Refrigerantes pela rota do cliente: mês 80, restante 30, hoje 10 -> 120 x 30/80 = 45 e 120 x 10/80 = 15
        self.assertEqual((ind[REF]["negRestante"], ind[REF]["negHoje"], ind[REF]["metaNegClientes"]), (45.0, 15.0, 80.0))
        hoje = [c for c in cons.chamadas if CM.META_NEG in c[1] and "DATA_MOVIMENTO eq" in (c[2] or "")]
        self.assertEqual({c[1][0] for c in hoje}, {CM.META_ROTA, CM.ROTA})   # a da rota da meta falhou (e por gerência)

    def test_sem_linha_de_hoje(self):
        d = _dados()
        d["meta_neg"] = [l for l in d["meta_neg"] if l[CM.DATA] != "2026-10-13"]
        f = fontes.carregar(ConsultaFalsa(d), AGORA)
        ind = _ind(montar_payload(f))
        self.assertTrue(all(ind[k]["negHoje"] is None for k in (REF, STILL, AGUA, DAC, CERV)))
        self.assertTrue(any("META_NEG de hoje indisponível" in a for a in f.avisos), f.avisos)

    def test_dia_nao_util(self):
        cons = ConsultaFalsa(_dados())
        p = montar_payload(fontes.carregar(cons, datetime(2026, 10, 17, 9, 0)))     # sábado
        self.assertTrue(all(b.get("negHoje") is None for b in _ind(p).values()))
        self.assertFalse([c for c in cons.chamadas if CM.META_NEG in c[1] and "DATA_MOVIMENTO eq" in (c[2] or "")])

    def test_fechamento(self):
        d = _dados()
        d = {**d, "vendas": {"202610": d["vendas"]}, "vol_real": {"202610": d["vol_real"]},
             "meta_neg": {"202610": d["meta_neg"]}, "meta_dia": {}, "metas": {"202610": d["metas"]}}
        d[fontes.M.OBJ_CALENDARIO] = []
        cons = ConsultaFalsa(d)
        p = montar_payload(fontes.carregar(cons, datetime(2026, 11, 3, 9, 0)))
        self.assertTrue(p["FECHAMENTO"])
        self.assertTrue(all(b.get("negHoje") is None for b in _ind(p).values()))
        self.assertFalse([c for c in cons.chamadas if CM.META_NEG in c[1] and "DATA_MOVIMENTO eq" in (c[2] or "")])


class TestValidacao(unittest.TestCase):
    def setUp(self):
        self.p = montar_payload(fontes.carregar(ConsultaFalsa(_dados()), AGORA))

    def test_acima_do_restante_ou_negativo_avisa(self):
        ind = _ind(self.p)
        ind[REF]["negHoje"] = ind[REF]["negRestante"] + 0.2
        ind[STILL]["negHoje"] = -1.0
        ind[AGUA]["negHoje"] = ind[AGUA]["negRestante"] + 0.1                # tolerância do arredondamento
        erros, avisos = validar_payload(self.p)
        self.assertEqual(erros, [])
        av = [a for a in avisos if a.startswith("negHoje fora")]
        self.assertEqual(len(av), 1, avisos)
        self.assertIn("2 rota(s)", av[0])
        self.assertIn("111/Refrigerantes", av[0])
        self.assertIn("111/Still", av[0])
        self.assertNotIn("Água", av[0])

    def test_payload_antigo_sem_o_campo(self):
        p = _sem_neg_hoje(self.p)
        erros, avisos = validar_payload(p)
        self.assertEqual(erros, [])
        self.assertFalse([a for a in avisos if "negHoje" in a])


@unittest.skipUnless(shutil.which("node"), "node não instalado")
class TestEspelhoNucleo(unittest.TestCase):
    """NUCLEO.agrega (frontend/js/nucleo.js) soma o volume das rotas igual a modelo.agrega_volume, negHoje inclusive."""

    JS = r"""
const fs = require('fs'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf-8') + '\n;globalThis.NUCLEO = NUCLEO;', ctx);
const {P, grupos} = JSON.parse(fs.readFileSync(0, 'utf-8'));
const nodo = {};
Object.values(P.DATA).forEach(svs => Object.values(svs).forEach(rs => Object.assign(nodo, rs)));
const out = grupos.map(rs => ctx.NUCLEO.agrega(P, rs, r => nodo[r]).ind);
process.stdout.write(JSON.stringify(out));
"""

    def _compara(self, p):
        rotas = {r: d for svs in p["DATA"].values() for rs in svs.values() for r, d in rs.items()}
        grupos = [sorted(rotas), ["111"], ["G1-EV"], ["111", "G1-EV"]]
        res = subprocess.run(["node", "-e", self.JS, str(FRONT / "js" / "nucleo.js")],
                             input=json.dumps({"P": p, "grupos": grupos}), capture_output=True, text=True, check=True)
        js = json.loads(res.stdout)
        ks = p["GROUPS"]["VOLUME"] + list(p.get("VOLUME_EXTRA") or {})
        for g, ind in zip(grupos, js):
            for k in ks:
                py = modelo.agrega_volume([rotas[r]["indicators"].get(k) for r in g], fechamento=p["FECHAMENTO"])
                if py.get("unavailable"):
                    self.assertTrue(ind[k]["unavailable"], (g, k))
                    continue
                for campo in ("meta", "real", "tendencia", "negRestante", "negHoje", "metaDia", "pctTendencia"):
                    a, b = py[campo], ind[k].get(campo)
                    if a is None or b is None:
                        self.assertEqual(a, b, (g, k, campo))
                    else:
                        self.assertAlmostEqual(a, b, places=6, msg=(g, k, campo))

    def test_com_neg_hoje(self):
        p = montar_payload(fontes.carregar(ConsultaFalsa(_dados()), AGORA))
        self._compara(p)
        self.assertEqual(modelo.agrega_volume([_ind(p)[REF], _ind(p, "G1-EV")[REF]])["negHoje"], 15.0)

    def test_payload_antigo_e_sem_dado(self):
        p = montar_payload(fontes.carregar(ConsultaFalsa(_dados()), AGORA))
        self._compara(_sem_neg_hoje(p))
        d = _dados()
        d["meta_neg"] = [l for l in d["meta_neg"] if l[CM.DATA] != "2026-10-13"]
        self._compara(montar_payload(fontes.carregar(ConsultaFalsa(d), AGORA)))


_spec = importlib.util.spec_from_file_location(
    "conferir_tendencia_e12", Path(__file__).resolve().parents[1] / "scripts" / "conferir_tendencia.py")
ct = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ct)


class TestConferirE12(unittest.TestCase):
    """E12: a parte com rede (caso exato de cada rota x macro) e a do payload (--e12), que batem entre si."""

    @classmethod
    def setUpClass(cls):
        cls.rel, _ = ct.conferir(ConsultaFalsa(_dados()), date(2026, 10, 13))
        cls.txt = cls.rel.texto("E12")

    def test_parte_com_rede(self):
        self.assertIn("E12. Neg de hoje (negHoje) por gerência e macro", self.txt)
        self.assertNotIn("ERRO em E12", self.txt)
        # gerência | macro | Σ negHoje | Σ negRestante | % | DIRETO CURVA SEM_CURVA SEM_META_ROTA SEM_META EV* null | violações
        for linha in ["| G1 | Refrigerantes | 15,0 | 45,0 | 33,33% | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |",
                      "| G1 | Still | 5,0 | 12,5 | 40,00% | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |",
                      "| G1 | Água Mineral | 10,0 | 140,0 | 7,14% | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |",
                      "| G1 | Dest+Art+Cnd | 3,0 | 10,0 | 30,00% | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |",
                      "| G1 | Cervejas | 0,0 | 0,0 | — | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |",
                      "| **BAND** | Refrigerantes | 15,0 | 45,0 |"]:
            self.assertIn(linha, self.txt)
        self.assertIn("Sem violações", self.txt)
        self.assertEqual(self.rel.anexos[ct.ARQ_E12]["GC"]["G1|VOL STILL"], [5.0, 12.5])
        for v in ["1007382", "1015300", "1300001", "Piratas", "Warley"]:
            self.assertNotIn(v, self.txt)

    def test_parte_do_payload(self):
        with tempfile.TemporaryDirectory() as d:
            pasta = Path(d)
            p = montar_payload(fontes.carregar(ConsultaFalsa(_dados()), AGORA))
            ind = _ind(p)
            ind[STILL]["negHoje"] = 20.0                                   # acima do restante (12,5)
            (pasta / "payload.json").write_text(json.dumps(p), encoding="utf-8")
            (pasta / ct.ARQ_E12).write_text(json.dumps(self.rel.anexos[ct.ARQ_E12]), encoding="utf-8")
            ct.main_e12(pasta / "payload.json", pasta, 0.4, 70.0)
            txt = (pasta / "relatorio_tendencia.md").read_text(encoding="utf-8")
        self.assertIn("| G1 | Refrigerantes | 15,0 | 45,0 | 33,33% | 2 | 0 | 0 |", txt)
        self.assertIn("**Violações** (negHoje < 0 ou > negRestante, tolerância 0.1 cx) em 1 rota(s) x macro: 111/Still", txt)
        self.assertIn("**2 diferença(s)**", txt)                         # G1 e BAND Still contra a parte com rede
        self.assertIn("sem negHoje", txt)
        self.assertIn("consulta da META_NEG de hoje 0.4 s", txt)

    def test_payload_antigo(self):
        p = _sem_neg_hoje(montar_payload(fontes.carregar(ConsultaFalsa(_dados()), AGORA)))
        rel = ct.Relatorio()
        ct.secao_neg_hoje_payload(rel, p)
        txt = "\n".join(rel.linhas)
        self.assertIn("Nenhuma rota com negHoje", txt)
        self.assertIn("o campo acrescenta 0.0 KB", txt)


if __name__ == "__main__":
    unittest.main()
