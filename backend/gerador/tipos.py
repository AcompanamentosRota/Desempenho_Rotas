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
    mes_label: str         # "Outubro/26" (mês de referência do payload)
    # Fechamento do mês: o payload mostra o mês anterior (ref) já fechado, sem tendência nem meta do dia
    fechamento: bool = False
    ref: date | None = None    # 1º dia do mês de referência; None = mês de hoje
    # data do último dia útil fechado (o dia útil DIA_ONTEM do mês de referência); None = nenhum ou desconhecida
    data_ontem: date | None = None

    @property
    def pace_ontem_pct(self) -> int:
        return round(self.dia_ontem / self.total_dias_uteis * 100) if self.total_dias_uteis else 0

    @property
    def anomes(self) -> str:
        """ANOMES_REF do mês de referência (o anterior durante o fechamento)."""
        return (self.ref or self.hoje).strftime("%Y%m")


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
    """Volume de um grupo (VOL ...) em uma rota (critério do SAC).

    Tendência = real + neg_restante; % tendência = tendência / meta (meta da rota).
    """
    meta: float | None             # META_VOLUME da rota (modelo.meta_e_restante); None = indicador indisponível
    real: float = 0.0              # Vol Real: faturado no mês com NF_STATUS em M.STATUS_NF_REAL
    neg_restante: float | None = None      # meta x fração restante da curva META_NEG; None no fechamento
    meta_dia_hoje: float | None = None     # META_RECUPERAVEL_ROTA de hoje; None = medida não veio
    meta_neg_clientes: float | None = None  # soma de META_NEG do mês: só conferência (não entra em conta)


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
    # rota -> pv -> VOL -> volume hoje (somado ao Real da barra por cliente no front, fora do fechamento)
    volume_cliente: dict[str, dict[int, dict[str, float]]] = field(default_factory=dict)
    # rota -> pv -> volume de hoje nos agrupadores do Desempenho GDM (somado ao faturado no front)
    gdm_cliente: dict[str, dict[int, float]] = field(default_factory=dict)
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
    # rota -> pv -> VOL -> (Meta NEG, Vol Real) do mês
    volume_cliente: dict[str, dict[int, dict[str, tuple[float, float]]]]
    online: Online
    # Venda Zero (None = fonte indisponível nesta execução)
    vendazero: dict[str, list[Equipamento]] | None = None
    vz_meta: dict[str, float] = field(default_factory=dict)
    comodato_ativos: dict[str, dict[int, int]] = field(default_factory=dict)
    # pv -> segmento na fonte de vendas (KS TT de cliente transferido ou desativado, fora do roster da rota)
    segmento_venda: dict[int, str] = field(default_factory=dict)
    # avisos da montagem (ex.: rota x macro sem curva de META_NEG), somados aos da validação no gerar.py
    avisos: list[str] = field(default_factory=list)
    # Desempenho GDM e tag de geladeira: rota -> pv -> [meta, faturado GDM, situação, nº de geladeiras]
    comodato_cliente: dict[str, dict[int, list]] = field(default_factory=dict)
    # rota oculta com o Real dos clientes em rotas EV* (M.rota_eventuais) -> gerência; o volume dela está em `volume`
    eventuais: dict[str, str] = field(default_factory=dict)
    # mês anterior no mesmo dia útil (mes_anterior.Dados; None = sem a chave MES_ANTERIOR nesta rodada)
    mes_anterior: object | None = None
    # segundos medidos na carga (mes_anterior_s, mes_anterior_espera_s): log e workflow "Conferir tendência"
    tempos: dict[str, float] = field(default_factory=dict)
