"""
calendario.py — Escalares de calendário do payload (dia útil, ritmo, semana).

Fonte principal: AM_BND_MTR_CALENDARIO_DATA_ATUAL (NO_DIAS_UTEIS_MES, NO_DIA_UTIL).
Se a view falhar, calcula os dias úteis localmente (seg-sex menos feriados nacionais).

Regras (conferidas com o histórico do payload.json):
  - SEMANA_NUM conta a partir da 1ª segunda-feira do mês (5/10/26 = semana 1,
    13/10/26 = semana 2, 28/9/26 = semana 4). Dias antes dela pertencem à última
    semana do mês anterior.
  - SEMANA_TIPO = "par" quando SEMANA_NUM é par, senão "ímpar".
  - DIA_ONTEM = dias úteis já fechados; PACE_ONTEM_PCT = round(DIA_ONTEM / TOTAL * 100).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .tipos import Calendario

FUSO = ZoneInfo("America/Sao_Paulo")
MESES = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
         "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
DIAS_SEMANA = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira",
               "Sexta-feira", "Sábado", "Domingo"]


def agora() -> datetime:
    """Data e hora de Brasília, sem fuso (é o formato do updatedAt do online.json)."""
    return datetime.now(FUSO).replace(tzinfo=None, microsecond=0)


def _pascoa(ano: int) -> date:
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = (h + l - 7 * m + 114) % 31 + 1
    return date(ano, mes, dia)


def feriados_nacionais(ano: int) -> set[date]:
    """Feriados nacionais (fixos + Carnaval, Sexta-feira Santa e Corpus Christi)."""
    p = _pascoa(ano)
    fixos = [(1, 1), (4, 21), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15), (11, 20), (12, 25)]
    moveis = [p - timedelta(days=48), p - timedelta(days=47), p - timedelta(days=2), p + timedelta(days=60)]
    return {date(ano, m, d) for m, d in fixos} | set(moveis)


def dias_uteis_do_mes(ano: int, mes: int, feriados: set[date] | None = None) -> list[date]:
    feriados = feriados_nacionais(ano) if feriados is None else feriados
    d = date(ano, mes, 1)
    dias = []
    while d.month == mes:
        if d.weekday() < 5 and d not in feriados:
            dias.append(d)
        d += timedelta(days=1)
    return dias


def _primeira_segunda(ano: int, mes: int) -> date:
    d = date(ano, mes, 1)
    return d + timedelta(days=(7 - d.weekday()) % 7)


def semana_do_mes(d: date) -> int:
    seg = _primeira_segunda(d.year, d.month)
    if d < seg:
        anterior = date(d.year, d.month, 1) - timedelta(days=1)
        return semana_do_mes(anterior)
    return (d - seg).days // 7 + 1


def montar(hoje: date, total_dias_uteis: int, dia_util_hoje: int, eh_dia_util: bool = True) -> Calendario:
    """Monta o Calendario a partir do total de dias úteis e do nº do dia útil de hoje.

    Em dia não útil (sábado, domingo, feriado), NO_DIA_UTIL costuma repetir o último
    dia útil: nesse caso todos os dias até ele estão fechados.
    """
    dia_ontem = dia_util_hoje - 1 if eh_dia_util else dia_util_hoje
    dia_ontem = max(0, min(dia_ontem, total_dias_uteis))
    semana = semana_do_mes(hoje)
    return Calendario(
        hoje=hoje,
        total_dias_uteis=total_dias_uteis,
        dia_hoje=max(1, min(dia_util_hoje, total_dias_uteis)),
        dia_ontem=dia_ontem,
        semana_num=semana,
        semana_tipo="par" if semana % 2 == 0 else "ímpar",
        dia_semana=DIAS_SEMANA[hoje.weekday()],
        mes_label=f"{MESES[hoje.month]}/{hoje:%y}",
    )


def calcular_local(hoje: date) -> Calendario:
    """Plano B sem o Datasphere: seg-sex menos feriados nacionais."""
    uteis = dias_uteis_do_mes(hoje.year, hoje.month)
    feitos = [d for d in uteis if d <= hoje]
    if not feitos:   # antes do 1º dia útil do mês: nada fechado ainda
        return montar(hoje, len(uteis), 1, eh_dia_util=True)
    return montar(hoje, len(uteis), len(feitos), eh_dia_util=hoje in uteis)


def do_datasphere(linhas: list[dict], hoje: date) -> Calendario | None:
    """Usa as linhas de AM_BND_MTR_CALENDARIO_DATA_ATUAL (DATA, NO_DIAS_UTEIS_MES, NO_DIA_UTIL).

    Devolve None se não houver linha do mês de hoje (o chamador cai no cálculo local).
    """
    from .mapeamento import ColCalendario as C

    def data_de(linha: dict) -> date | None:
        valor = str(linha.get(C.DATA) or "")[:10]
        try:
            return date.fromisoformat(valor)
        except ValueError:
            return None

    do_mes = [(data_de(l), l) for l in linhas]
    do_mes = [(d, l) for d, l in do_mes if d and d.year == hoje.year and d.month == hoje.month and d <= hoje]
    if not do_mes:
        return None
    d, linha = max(do_mes, key=lambda x: x[0])
    total = int(float(linha.get(C.DIAS_UTEIS_MES) or 0))
    dia = int(float(linha.get(C.DIA_UTIL) or 0))
    if total <= 0 or dia <= 0:
        return None
    return montar(hoje, total, dia, eh_dia_util=(d == hoje and hoje.weekday() < 5))
