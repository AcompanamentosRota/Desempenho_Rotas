"""
modelo.py — Contas de cada indicador (funções puras, sem rede).

As fórmulas reproduzem exatamente o payload.json que era publicado à mão
(conferido em todas as 98 rotas de out/26). O front refaz as mesmas contas ao
somar rotas, então qualquer mudança aqui precisa ser espelhada em frontend/js/app.js.

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
def volume_indisponivel() -> dict:
    return {"meta": None, "real": None, "dif": None, "metaDia": None, "pctTendencia": None,
            "onPace": None, "unavailable": True}


def tendencia(v: VolumeRota, cal: Calendario) -> float:
    """Projeção do mês.

    Com meta acumulada até ontem: real / meta acumulada x meta do mês.
    Sem ela (padrão do gerador, o modelo não traz a curva diária por rota):
    projeção linear pelos dias úteis fechados, real / DIA_ONTEM x TOTAL_DIAS_UTEIS.
    """
    if v.meta_acum_ontem is not None:
        # sem meta acumulada (meta zero até ontem) a projeção é o próprio realizado
        return v.real / v.meta_acum_ontem * (v.meta or 0) if v.meta_acum_ontem else v.real
    if cal.dia_ontem:
        return v.real / cal.dia_ontem * cal.total_dias_uteis
    return v.real


def meta_dia(v: VolumeRota, cal: Calendario) -> float:
    if v.meta_dia_hoje is not None:
        return v.meta_dia_hoje
    restantes = cal.total_dias_uteis - cal.dia_ontem
    return ((v.meta or 0) - v.real) / restantes if restantes > 0 else 0.0


def indicador_volume(v: VolumeRota | None, cal: Calendario, sem_dado_hoje: bool = False) -> dict:
    if v is None or v.meta is None:
        return volume_indisponivel()
    tend = tendencia(v, cal)
    pct_t = round(tend / v.meta * 100) if v.meta else None
    return {
        "meta": _r1(v.meta), "real": _r1(v.real), "dif": _r1(v.real - v.meta),
        "metaDia": _r1(meta_dia(v, cal)), "tendencia": _r1(tend), "pctTendencia": pct_t,
        "onPace": pct_t is not None and pct_t >= 100, "unavailable": False,
        "semDadoHoje": sem_dado_hoje,
    }


def bloco_volume_cliente(meta: float | None, real: float, pace_pct: int) -> list | None:
    """[meta, real, pct, status] da barra por cliente; status 0 fora do ritmo, 1 no ritmo, 2 meta batida.

    None = cliente sem meta neste grupo (o tile mostra "sem meta"); meta zero gera pct 0.
    """
    if meta is None:
        return None
    pct = round(real / meta * 100) if meta else 0
    status = 2 if pct >= 100 else (1 if pct >= pace_pct else 0)
    return [_r1(meta), _r1(real), pct, status]
