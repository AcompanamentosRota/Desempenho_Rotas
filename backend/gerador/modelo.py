"""
modelo.py — Contas de cada indicador (funções puras, sem rede).

As fórmulas de cobertura reproduzem o payload.json que era publicado à mão (conferido em
todas as 98 rotas de out/26); as de volume seguem o critério do SAC. O front refaz as mesmas
contas ao somar rotas, então qualquer mudança aqui precisa ser espelhada em frontend/js/app.js
(agrega) e frontend/js/resumo.js (soma).

Arredondamento: Python round() (meio para o par), igual ao gerador antigo.
Percentuais usam os valores brutos; meta/real de volume saem com 1 casa.
"""
from __future__ import annotations

import math

from .tipos import Calendario, VolumeRota


def _num(v: float) -> int | float:
    """Inteiro quando não tem casa decimal (metas de cobertura são contagens)."""
    return int(v) if float(v).is_integer() else v


def _r1(v: float) -> float:
    r = round(v, 1)
    return 0.0 if r == 0 else r   # evita "-0.0" quando o valor arredonda para zero


# ------------------------------------------------------------------ cobertura
def cobertura_indisponivel() -> dict:
    return {"meta": None, "real": None, "pct": None, "onPace": None, "gap": None, "unavailable": True}


def indicador_cobertura(meta: float | None, real: int, cal: Calendario, rota_tem_meta: bool = True) -> dict:
    """Nº de clientes que compraram o agrupador no mês contra a meta de cobertura.

    Sem meta o indicador fica indisponível; se a rota tem meta em outros indicadores,
    o realizado continua informado (mesmo formato do arquivo antigo).
    """
    if meta is None:
        base = cobertura_indisponivel()
        if rota_tem_meta:
            base["real"] = real
        return base
    pct = round(real / meta * 100) if meta else None
    gap = max(0, math.ceil(meta * cal.dia_hoje / cal.total_dias_uteis) - real)
    return {
        "meta": _num(meta), "real": real, "pct": pct,
        "onPace": pct is not None and pct >= cal.pace_ontem_pct,
        "gap": gap, "unavailable": False,
    }


# ------------------------------------------------------------------ venda zero
def indicador_vendazero(meta: float | None, real: int, revertido_hoje: int, oportunidade_hoje: int) -> dict:
    """Venda Zero é invertido: quanto MENOS equipamento zerado, melhor (no ritmo se real <= meta)."""
    if meta is None:
        base = cobertura_indisponivel()
    else:
        pct = round(real / meta * 100) if meta else None
        base = {
            "meta": _num(meta), "real": real, "pct": pct,
            "onPace": pct is not None and pct <= 100,
            "gap": max(0, math.ceil(real - meta)), "unavailable": False,
        }
    base["revertidoHoje"] = revertido_hoje
    base["oportunidadeHoje"] = oportunidade_hoje
    return base


# ------------------------------------------------------------------ volume
# Critério do SAC (por rota x macro de volume):
#   Meta        = META_VOLUME da rota (o SAC mostra a meta da rota no campo "Meta NEG")
#   Neg Restante= Meta x (META_NEG de hoje ao fim do mês / META_NEG do mês): curva dos clientes na meta da rota
#   Tendência   = Vol Real + Neg Restante; % Tendência = Tendência / Meta; no ritmo (verde) com % >= 100
#   Dif         = Vol Real - Meta; Meta do dia = META_RECUPERAVEL_ROTA de hoje
# Supervisão e gerência somam as rotas e recalculam o % (agrega_volume = agrega() do app.js).
# No fechamento do mês: sem tendência e sem meta do dia; no ritmo com % realizado (Real / Meta) >= 100.
CURVA, SEM_CURVA, SEM_META_ROTA = "curva", "sem_curva", "sem_meta_rota"


def meta_e_restante(meta_rota: float | None, neg_mes: float | None, neg_restante: float | None,
                    dias_restantes: int, dias_mes: int) -> tuple[float | None, float | None, str | None]:
    """(meta, Neg Restante, caso) de uma rota x macro.

    curva         META_VOLUME > 0 e META_NEG do mês > 0: Meta x restante / mês da META_NEG
    sem_curva     META_VOLUME > 0 e META_NEG do mês = 0: Meta x dias úteis restantes (com hoje) / dias úteis
    sem_meta_rota META_VOLUME ausente ou 0 e META_NEG > 0: meta e restante = somas de META_NEG
    None          as duas zeradas: indicador indisponível
    """
    if meta_rota and meta_rota > 0:
        if neg_mes and neg_mes > 0:
            return meta_rota, meta_rota * (neg_restante or 0.0) / neg_mes, CURVA
        return meta_rota, (meta_rota * dias_restantes / dias_mes if dias_mes else 0.0), SEM_CURVA
    if neg_mes and neg_mes > 0:
        return neg_mes, neg_restante or 0.0, SEM_META_ROTA
    return None, None, None


def volume_indisponivel() -> dict:
    return {"meta": None, "real": None, "dif": None, "metaDia": None, "pctTendencia": None,
            "onPace": None, "unavailable": True}


def _pct(valor: float, meta: float | None) -> int | None:
    return round(valor / meta * 100) if meta else None


def _r1_ou_none(v: float | None) -> float | None:
    return None if v is None else _r1(v)


def tendencia(v: VolumeRota) -> float:
    return v.real + (v.neg_restante or 0.0)


def indicador_volume(v: VolumeRota | None, cal: Calendario, sem_dado_hoje: bool = False) -> dict:
    if v is None or v.meta is None:
        return volume_indisponivel()
    base = {"meta": _r1(v.meta), "real": _r1(v.real), "dif": _r1(v.real - v.meta)}
    if cal.fechamento:
        pct_real = _pct(v.real, v.meta)
        return {**base, "metaDia": None, "tendencia": None, "pctTendencia": None,
                "onPace": pct_real is not None and pct_real >= 100, "unavailable": False,
                "semDadoHoje": False, "negRestante": None, "metaNegClientes": _r1_ou_none(v.meta_neg_clientes)}
    tend = tendencia(v)
    pct_t = _pct(tend, v.meta)
    return {**base, "metaDia": _r1_ou_none(v.meta_dia_hoje), "tendencia": _r1(tend), "pctTendencia": pct_t,
            "onPace": pct_t is not None and pct_t >= 100, "unavailable": False, "semDadoHoje": sem_dado_hoje,
            "negRestante": _r1(v.neg_restante or 0.0), "metaNegClientes": _r1_ou_none(v.meta_neg_clientes)}


def agrega_volume(blocos: list[dict | None], fechamento: bool = False) -> dict:
    """Soma os blocos de volume de várias rotas (supervisão, gerência) e recalcula o %, como agrega() no app.js."""
    disp = [b for b in blocos if b and not b.get("unavailable")]
    if not disp:
        return {"unavailable": True}

    def soma(campo: str) -> float:
        return sum(b.get(campo) or 0 for b in disp)

    meta, real = soma("meta"), soma("real")
    dias = [b["metaDia"] for b in disp if b.get("metaDia") is not None]
    out = {"meta": meta, "real": real, "dif": real - meta, "metaDia": sum(dias) if dias else None}
    if fechamento:
        pct = _pct(real, meta)
        return {**out, "tendencia": None, "negRestante": None, "pctTendencia": None,
                "onPace": pct is not None and pct >= 100, "unavailable": False}
    tend = soma("tendencia")
    pct_t = _pct(tend, meta)
    return {**out, "tendencia": tend, "negRestante": soma("negRestante"), "pctTendencia": pct_t,
            "onPace": pct_t is not None and pct_t >= 100, "unavailable": False}


def bloco_volume_cliente(meta: float | None, real: float, pace_pct: int) -> list | None:
    """[meta, real, pct, status] da barra por cliente; status 0 fora do ritmo, 1 no ritmo, 2 meta batida.

    None = cliente sem meta neste grupo (o tile mostra "sem meta"); meta zero gera pct 0.
    """
    if meta is None:
        return None
    pct = round(real / meta * 100) if meta else 0
    status = 2 if pct >= 100 else (1 if pct >= pace_pct else 0)
    return [_r1(meta), _r1(real), pct, status]


def bloco_cliente_com_online(bloco: list | None, vol_online: float, pace_pct: int, fechamento: bool) -> list | None:
    """Barra por cliente como o front mostra (blocoVolCliente no app.js): Real = Vol Real + volume online
    de hoje do cliente, fora do fechamento do mês; % e status recalculados pela regra de bloco_volume_cliente."""
    if bloco is None or fechamento or not vol_online:
        return bloco
    return bloco_volume_cliente(bloco[0], bloco[1] + vol_online, pace_pct)
