"""
tipos.py — Formato intermediário (normalizado) entre o Datasphere e os JSONs do painel.

fontes.py preenche estas estruturas a partir das consultas OData; payload.py e
online.py só leem daqui. Isso permite testar a montagem dos JSONs sem rede.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass(frozen=True)
class Calendario:
    hoje: date
    total_dias_uteis: int
    dia_hoje: int          # nº do dia útil de hoje (1..total)
    dia_ontem: int         # dias úteis já fechados (0 no 1º dia útil)
    semana_num: int
    semana_tipo: str       # "par" | "ímpar"
    dia_semana: str        # "Terça-feira"
    mes_label: str         # "Outubro/26"

    @property
    def pace_ontem_pct(self) -> int:
        return round(self.dia_ontem / self.total_dias_uteis * 100) if self.total_dias_uteis else 0

    @property
    def anomes(self) -> str:
        return self.hoje.strftime("%Y%m")


@dataclass(frozen=True)
class Cliente:
    pv: int
    nome: str
    rota: str
    gc: str
    sv: str
    nome_sv: str
    consultor: str
    segmento: str
    dia_visita: str
    visita_hoje: bool
    rede: str = ""         # nome da rede (Key Account); "" = sem rede


@dataclass
class VolumeRota:
    """Volume de um grupo (VOL ...) em uma rota."""
    meta: float | None             # meta do mês (None = sem meta -> indicador indisponível)
    real: float = 0.0              # faturado no mês até ontem
    meta_acum_ontem: float | None = None   # meta acumulada até ontem; None = projeção linear por dias úteis
    meta_dia_hoje: float | None = None     # meta de hoje (META_DIA); None = (meta - real) / dias restantes


@dataclass
class Equipamento:
    """Uma linha de Venda Zero: cliente x tipo de equipamento com giro zero no mês."""
    pv: int
    nome: str
    dia: str
    hoje: bool
    tipo: str
    vdz: int                # nº de equipamentos zerados
    meta_comodato: float
    volume: float


@dataclass
class Online:
    atualizado_em: datetime
    clientes: dict[str, dict[str, set[int]]] = field(default_factory=dict)   # rota -> indicador -> pv
    qualquer: dict[str, set[int]] = field(default_factory=dict)              # rota -> pv com qualquer compra hoje
    volume: dict[str, dict[str, float]] = field(default_factory=dict)        # rota -> VOL -> volume hoje
    fechamento_mes: str | None = None


@dataclass
class Fontes:
    cal: Calendario
    clientes: list[Cliente]
    # rota -> indicador de cobertura -> pv que compraram no mês
    cobertos: dict[str, dict[str, set[int]]]
    # rota -> pv que compraram qualquer produto no mês (rota ausente = sem dado de venda)
    compraram: dict[str, set[int]]
    # rota -> indicador de cobertura -> meta (nº de clientes); ausente = indisponível
    metas: dict[str, dict[str, float]]
    # rota -> VOL -> VolumeRota
    volume: dict[str, dict[str, VolumeRota]]
    # rota -> pv -> VOL -> (meta, real) do mês
    volume_cliente: dict[str, dict[int, dict[str, tuple[float, float]]]]
    online: Online
    # Venda Zero (None = fonte indisponível nesta execução)
    vendazero: dict[str, list[Equipamento]] | None = None
    vz_meta: dict[str, float] = field(default_factory=dict)
    comodato_ativos: dict[str, dict[int, int]] = field(default_factory=dict)
    # pv -> segmento na fonte de vendas (KS TT de cliente transferido ou desativado, fora do roster da rota)
    segmento_venda: dict[int, str] = field(default_factory=dict)
