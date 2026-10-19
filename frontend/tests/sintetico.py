"""
sintetico.py — payload.json e online.json SINTÉTICOS para os testes de front (nomes e códigos fictícios).

Os arquivos passam pelo gerador de verdade: fontes.carregar() com o Datasphere simulado dos testes do
back-end (tests.test_fontes.ConsultaFalsa) -> montar_payload() / montar_online(). Assim o formato é
exatamente o do main (negRestante, metaDia, FECHAMENTO, COMODATO_CLIENTE, gdmCliente, Del Valle Frut...).

    python frontend/tests/sintetico.py SAIDA            # dia útil normal (13/10/2026)
    python frontend/tests/sintetico.py SAIDA --fechamento   # fechamento do mês (03/11/2026)
    python frontend/tests/sintetico.py SAIDA --sem-meta-dv  # dia útil normal sem meta de Del Valle Frut

Cenário: 15 gerências com 2 supervisões x 2 rotas x 3 clientes (a DI fica sem dados, para aparecer
desabilitada). Rotas Neutraliza em supervisão própria (SV.G1.5/151, SV.G2.5/251, SV.IT.3/I31, SV.MO.3/M31) e
misturadas com rotas normais (SV.AT.3/431, SV.PO.2/O21) ou virtuais (SV.AN.4/A41 com as virtuais A42-A44,
SV.RV.3/R31 com a virtual R32); oculta SV.G3.3/331; na AT a 411 é normal (SV.AT.1) e a SV.AT.3 é
"sem vendedor". Del Valle Frut só nas rotas da G2.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))

from gerador import fontes  # noqa: E402
from gerador import mapeamento as M  # noqa: E402
from gerador.online import montar_online  # noqa: E402
from gerador.payload import montar_payload, online_ks_tt  # noqa: E402
from gerador.saida import serializar  # noqa: E402
from tests.test_fontes import CB, CC, CM, CO, ConsultaFalsa  # noqa: E402

SEM_DADOS = {"DI"}
# ordem em que o cenário é montado (PVs e valores dependem dela); fixa, independente da ordem de exibição (M.GC_NOMES)
GERENCIAS = ["G1", "G2", "G3", "AP", "IT", "MO", "AT", "AN", "SL", "RV", "RI", "UR", "GU", "PO", "PA", "DI"]
assert sorted(GERENCIAS) == sorted(M.GC_ATIVAS)
GIROS = ["Giro Zero", "Baixo Giro", "Giro Ok", "< 30 Dias", "Giro Ok", "--"]
SEGMENTOS = ["Boteco", "Mercearia", "Lanchonete", "Super", "Padarias", "Restaurante"]


def _origem(sigla: str) -> str:
    codigo = M.gc_origem(sigla)
    return next(g for g in M.GC_ORIGEM if M.codigo_gc(g) == codigo)


def _supervisoes(sigla: str) -> list[tuple[str, str, str]]:
    """(código SV.<sigla>.<n>, valor na fonte, nome) das supervisões da gerência."""
    n = [1, 2]
    if sigla in ("G1", "G2"):
        n.append(5)            # Neutraliza SV.G1.5 / SV.G2.5
    if sigla in ("IT", "MO", "G3", "AT", "RV"):
        n.append(3)            # Neutraliza SV.IT.3 / SV.MO.3, oculta SV.G3.3, AT "sem vendedor", RV R31 + R32
    if sigla == "AN":
        n.append(4)            # A41 (Neutraliza) + A42-A44 (virtuais)
    out = []
    for i in n:
        nome = "ROTA SEM VENDEDOR" if (sigla, i) == ("AT", 3) else f"SUPERVISOR {sigla} {i}"
        out.append((f"SV.{sigla}.{i}", f"Sv. {sigla.title()}. {i}", nome))
    return out


def _rotas(sigla: str, i: int) -> list[str]:
    especiais = {("G1", 5): ["151"], ("G2", 5): ["251"], ("IT", 3): ["I31"], ("MO", 3): ["M31"], ("G3", 3): ["331"],
                 ("AT", 1): ["411", "AT12"], ("AT", 3): ["AT31", "AT32", "431"], ("AN", 4): ["A41", "A42", "A43", "A44"],
                 ("RV", 3): ["R31", "R32"], ("PO", 2): ["PO21", "PO22", "O21"]}
    return especiais.get((sigla, i), [f"{sigla}{i}{j}" for j in (1, 2)])


def dados(fechamento: bool, sem_meta_dv: bool = False) -> dict:
    base, vendas, vol_real, metas, meta_neg, meta_dia, comodato, meta_vz = [], [], [], [], [], [], [], []
    pv = 10000
    for gi, sigla in enumerate(GERENCIAS):
        if sigla in SEM_DADOS:
            continue
        origem = _origem(sigla)
        meta_vz.append({CO.META_GC: origem, CO.META_VZ_GC: "6", CO.MEDIDA_AUX: 1})
        for sv, sv_fonte, nome_sv in _supervisoes(sigla):
            for ri, rota in enumerate(_rotas(sigla, int(sv.rsplit(".", 1)[1]))):
                fator = 1 + (gi % 5) * 0.1 + ri * 0.05
                for k, (ag, vol) in enumerate([("Refrigerantes", 1000), ("Agua Mineral", 300)]):
                    metas.append({CM.META_ROTA: rota, CM.META_AGRUPADOR: ag, CM.META_VOLUME: str(round(vol * fator)),
                                  CM.META_COBERTURA: None})
                    for dia, parte in (("2026-10-02", 0.6), ("2026-10-20", 0.4)):
                        meta_neg.append({CM.ROTA: rota, CM.META_ROTA: rota, CM.AGRUPADOR: ag, CM.DATA: dia,
                                         CM.META_NEG: round(vol * fator * parte, 1), "_gc": origem})
                    meta_dia.append({CM.ROTA: rota, CM.AGRUPADOR: ag, CM.DATA: "2026-10-13",
                                     CM.META_RECUPERAVEL: round(vol * fator / 21, 1), "_gc": origem})
                if sigla == "G2" and not sem_meta_dv:
                    metas.append({CM.META_ROTA: rota, CM.META_AGRUPADOR: "Del Valle Frut", CM.META_VOLUME: "80",
                                  CM.META_COBERTURA: None})
                    meta_neg += [{CM.ROTA: rota, CM.META_ROTA: rota, CM.AGRUPADOR: "Del Valle Frut", CM.DATA: d,
                                  CM.META_NEG: v, "_gc": origem} for d, v in (("2026-10-02", 50.0), ("2026-10-20", 30.0))]
                for ag in M.AGRUPADORES_COBERTURA.values():
                    metas.append({CM.META_ROTA: rota, CM.META_AGRUPADOR: ag, CM.META_VOLUME: None, CM.META_COBERTURA: "2"})
                for c in range(3):
                    pv += 1
                    hoje = c != 2
                    base.append({CB.ROTA: rota, CB.CLIENTE: f"{pv:010d}", CB.NOME: f"CLIENTE TESTE {pv}",
                                 CB.SEGMENTO: SEGMENTOS[(pv + gi) % len(SEGMENTOS)], CB.DIA_VISITA: "Seg - Qui",
                                 CB.VISITA_HOJE: "S" if hoje else "N", CB.GC: origem, CB.SUPERVISOR: sv_fonte,
                                 CB.NOME_SUPERVISOR: nome_sv, CB.VENDEDOR: f"CONSULTOR {rota}", CB.QUANTIDADE: 1,
                                 CB.REDE_NOME: "REDE TESTE" if c == 0 else ""})
                    vol = 300.0 * fator * (c + 1) / 2
                    vendas.append({CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: "Refrigerantes", CM.COB_MES: 0,
                                   CM.COB_ONLINE: 0, CM.COB_ONLINE_GERAL: 1 if c == 0 else 0, CM.VOL_MES: vol,
                                   CM.VOL_ONLINE: 20.0 if c == 0 else 0.0, CM.META_VOLUME_CLIENTE: 280.0 * fator,
                                   "_gc": origem})
                    vendas.append({CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: "Cctm 2l Pet", CM.COB_MES: 1 if c else 0,
                                   CM.COB_ONLINE: 1 if c == 0 else 0, CM.VOL_MES: 0, "_gc": origem})
                    vendas.append({CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: "Sucos", CM.VOL_MES: 5.0,
                                   CM.VOL_ONLINE: 3.0 if c == 1 else 0.0, "_gc": origem})
                    vol_real.append({CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: "Refrigerantes",
                                     CM.NF_STATUS: "Acertado", CM.VOL_MES: vol, "_gc": origem})
                    vol_real.append({CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: "Agua Mineral",
                                     CM.NF_STATUS: "Em Aberto", CM.VOL_MES: vol / 4, "_gc": origem})
                    vol_real.append({CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: "Sucos",
                                     CM.NF_STATUS: "Acertado", CM.VOL_MES: 5.0, "_gc": origem})
                    if sigla == "G2":
                        vendas.append({CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: "Del Valle Frut", CM.VOL_MES: 8.0,
                                       CM.VOL_ONLINE: 2.0 if c == 0 else 0.0, CM.META_VOLUME_CLIENTE: 25.0,
                                       "_gc": origem})
                        vol_real.append({CM.ROTA: rota, CM.CLIENTE: str(pv), CM.AGRUPADOR: "Del Valle Frut",
                                         CM.NF_STATUS: "Acertado", CM.VOL_MES: 8.0, "_gc": origem})
                    giro = GIROS[pv % len(GIROS)]
                    for e in range(0 if pv % 7 == 0 else 1 + (pv % 2)):     # pv múltiplo de 7: sem geladeira
                        comodato.append({CO.ROTA: rota, CO.CLIENTE: str(pv), CO.NOME: f"CLIENTE TESTE {pv}",
                                         CO.DIA_VISITA: "SEG", CO.VISITA_HOJE: "S" if hoje else "N",
                                         CO.EQUIPAMENTO: f"EQ{pv}{e}", CO.GIRO: giro, CO.META_EQPTO: 40.0,
                                         CO.VOLUME: 0.0 if giro == "Giro Zero" else 30.0})
    d = {M.OBJ_BASE_CLIENTE: base, "comodato": comodato, "meta_vz": meta_vz}
    if not fechamento:
        d[M.OBJ_CALENDARIO] = [{CC.DATA: "2026-10-13", CC.DIAS_UTEIS_MES: 21, CC.DIA_UTIL: 8, CC.DIAS_RESTANTES: 13}]
        d.update(vendas=vendas, vol_real=vol_real, metas=metas, meta_neg=meta_neg, meta_dia=meta_dia)
    else:
        hoje_on = [dict(l) for l in vendas if l.get(CM.VOL_ONLINE) or l.get(CM.COB_ONLINE)]
        d[M.OBJ_CALENDARIO] = []
        d.update(vendas={"202610": vendas, "202611": hoje_on}, vol_real={"202610": vol_real},
                 metas={"202610": metas}, meta_neg={"202610": meta_neg}, meta_dia={})
    return d


def gerar(saida: Path, fechamento: bool = False, sem_meta_dv: bool = False) -> tuple[dict, dict]:
    agora = datetime(2026, 11, 3, 10, 30) if fechamento else datetime(2026, 10, 13, 10, 30)
    f = fontes.carregar(ConsultaFalsa(dados(fechamento, sem_meta_dv)), agora)
    p = montar_payload(f)
    o = montar_online(online_ks_tt(f.online, p, f.segmento_venda))
    saida.mkdir(parents=True, exist_ok=True)
    (saida / "payload.json").write_bytes(serializar(p))
    (saida / "online.json").write_bytes(serializar(o))
    return p, o


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.ERROR)
    gerar(Path(sys.argv[1]), "--fechamento" in sys.argv[2:], "--sem-meta-dv" in sys.argv[2:])
