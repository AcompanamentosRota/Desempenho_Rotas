"""
mapeamento.py — TODAS as tabelas fixas e nomes de colunas usados pelo gerador.

Este é o único arquivo que precisa ser ajustado quando o modelo do Datasphere
mudar (nome de coluna, grafia de um agrupador, novo segmento...). Os valores
abaixo foram conferidos em 13/10/2026 com scripts/descobrir.py contra os dados
reais e contra o painel publicado (rota 111: metas de cobertura e de volume,
meta do dia, meta por cliente e Venda Zero idênticas).

Regra importante: SEGS e DIAS são tabelas de ÍNDICE (o front guarda o número da
posição em cada cliente). Nunca reordene; valores novos são acrescentados no fim
automaticamente em tempo de execução.
"""
from __future__ import annotations

import re

from .texto import normalizar

# ---------------------------------------------------------------------------
# Objetos (views) do space DW_BND_COM_SAP
# ---------------------------------------------------------------------------
OBJ_META = "AM_FAT_BND_ANALISE_META"          # "Análise Metas v2" (fonte principal; vem de DATASPHERE_ASSET)
OBJ_BASE_CLIENTE = "AM_BND_BASE_CLIENTE"      # "Base Clientes": roster, visita do dia, GC/SV/vendedor, rede
OBJ_COMODATO = "AM_FAT_BND_COMODATO"          # "Análise Comodato": geladeiras, giro zero (Venda Zero)
OBJ_CALENDARIO = "AM_BND_MTR_CALENDARIO_DATA_ATUAL"  # dias úteis do mês


class ColMeta:
    """Colunas do AM_FAT_BND_ANALISE_META."""
    ANOMES = "ANOMES_REF"
    ROTA = "CD_ROTA_Clien"
    GC = "DS_GC_AGRUPADA_ATUAL_Clien"
    CLIENTE = "CD_CLIENTE"
    SEGMENTO = "DS_SEGMENTO_Clien"                   # segmento na venda: vale também para quem saiu da base
    AGRUPADOR = "DS_AGRUPADOR_Agrupador_Prod"        # 'Cctm 2l Pet', 'Ks Tt', 'Refrigerantes'... (748 valores)
    AGRUPADOR_VOLUME = "DS_AGRUPADOR_Agrupador_Prod"  # os 5 grupos de volume estão na mesma coluna
    DATA = "DATA_MOVIMENTO"
    FONTE = "FONTE"                                  # 'Basis', 'WF Online', 'Meta NEG'
    SITUACAO_PEDIDO = "SITUACAO_Pedido"              # 'Inc. e Exp.', 'Cancelado', 'Reprovado', 'Meta NEG'
    # medidas (FONTE 'Basis' = faturado no mês; FONTE 'WF Online' = pedidos de hoje)
    COB_MES = "FX_COBERTURA_REALIZADO"               # cliente comprou o agrupador no mês (>0)
    COB_ONLINE = "FX_COBERTURA_WF_ONLINE"            # cliente comprou o agrupador hoje
    COB_ONLINE_GERAL = "FX_COBERTURA_WF_ONLINE_GERAL"  # cliente comprou qualquer coisa hoje
    VOL_MES = "FX_VOL_PADRAO_FAT"                    # volume padrão faturado no mês
    VOL_ONLINE = "FX_VOL_PADRAO_WF_ONLINE"           # volume padrão de hoje
    # chave de meta (lado "Chave_Meta_SAP" do modelo)
    META_ANOMES = "ANOMES_REF_Chave_Meta_SAP"
    META_ROTA = "CD_ROTA_Chave_Meta_SAP"
    META_AGRUPADOR = "AGRUPADOR_PRODU_Chave_Meta_SAP"
    META_COBERTURA = "META_COBERTURA_Chave_Meta_SAP"   # meta de cobertura (nº de clientes), ICS e Novos Negócios
    META_VOLUME = "META_VOLUME_Chave_Meta_SAP"         # meta de volume do mês
    META_NEG = "META_NEG"                              # meta de volume distribuída (por cliente e por dia):
    #                                                    denominador do volume em todos os níveis (critério do SAC)
    META_DIA = "META_DIA"                              # meta do dia ANTIGA: o gerador não usa (só a conferência)
    META_RECUPERAVEL = "META_RECUPERAVEL_ROTA"         # meta do dia do volume (DATA_MOVIMENTO = hoje)
    NF_STATUS = "NF_STATUS_Nota_Fiscal"                # Vol Real só com os status de M.STATUS_NF_REAL
    CALENDARIO = "CALENDARIO"
    # meta de volume por cliente (barra de status por cliente na aba Volume): META_NEG por cliente x agrupador
    META_VOLUME_CLIENTE = "META_NEG"


class ColBase:
    """Colunas do AM_BND_BASE_CLIENTE."""
    ROTA = "CD_ROTA"
    CLIENTE = "CD_CLIENTE"
    NOME = "NM_NOME_FANTASIA"
    SEGMENTO = "DS_SEGMENTO"
    DIA_VISITA = "DIA_VIS"
    VISITA_HOJE = "VISITA_HOJE"
    GC = "DS_GC_AGRUPADA_ATUAL"
    SUPERVISOR = "DS_SUPERVISOR_ATUAL"
    NOME_SUPERVISOR = "DS_NOME_SUPERVISOR_ATUAL"
    VENDEDOR = "DS_VENDEDOR_ATUAL"
    REDE = "OM01_KEYACCNUM"
    REDE_NOME = "OM01_KEYACCNUM_T"
    STATUS = "STATUS_CLIENTE"
    QUANTIDADE = "QUANTIDADE"   # medida (o modo analítico exige ao menos uma)


class ColComodato:
    """Colunas do AM_FAT_BND_COMODATO."""
    ROTA = "CD_ROTA_Clien"
    GC = "DS_GC_AGRUPADA_ATUAL_Clien"
    CLIENTE = "CD_CLIENTE_Clien"
    NOME = "NM_NOME_FANTASIA_Clien"
    DIA_VISITA = "DIA_VIS_Clien"
    VISITA_HOJE = "VISITA_HOJE_Clien"
    EQUIPAMENTO = "CD_EQUIPAMENTO_Equipame"
    TIPO = "TIPO_QUIPAMENTO_Equipame"
    AGRUPADOR = "AGRUPADOR_EQPTO"
    GIRO = "GIRO_STATUS_MES_ATUAL"
    STATUS = "STATUS_COMODATO"
    META_EQPTO = "META_EQPTO"
    VOLUME = "VL_PADRAO"
    # meta de Venda Zero: só existe por gerência; o gerador distribui pelas rotas
    META_GC = "GC_ATUAL_META_COMODATO"               # 'Gc. G1'...
    META_ANOMES = "ANOMES_REF_Gerncia_Comerc"
    META_VZ_GC = "META_COMODATO_VDZ_Gerncia_Comerc"  # G1 = 115 em out/26
    MEDIDA_AUX = "FX_QTD_CLIENTE"


class ColCalendario:
    DATA = "DATA"
    DIAS_UTEIS_MES = "NO_DIAS_UTEIS_MES"
    DIA_UTIL = "NO_DIA_UTIL"
    DIAS_RESTANTES = "NO_DIAS_UTEIS_RESTANTES"


# ---------------------------------------------------------------------------
# Filtros
# ---------------------------------------------------------------------------
# Gerências que o painel mostra (valor original de DS_GC_AGRUPADA_ATUAL). As agrupadas (It_Mo, Pa_Di, Ur_Ri,
# Gu_Po) são separadas pelo prefixo do supervisor (Sv. Pa. 3 -> SV.PA.3 -> PA), como IT e MO.
GC_ORIGEM = ["Gc. G1", "Gc. G2", "Gc. G3", "Gc. Ap", "Gc. It_Mo",
             # A CONFIRMAR (descoberta): grafias vistas no comodato, ainda não conferidas na base de clientes
             "Gc. At", "Gc. An", "Gc. Sl", "Gc. Rv", "Gc. Pa_Di", "Gc. Ur_Ri", "Gc. Gu_Po"]
# siglas do painel que cada gerência de origem pode ter (código de codigo_gc -> siglas dos supervisores)
GC_SIGLAS_ORIGEM = {
    "G1": ["G1"], "G2": ["G2"], "G3": ["G3"], "AP": ["AP"], "IT_MO": ["IT", "MO"],
    # A CONFIRMAR (descoberta): prefixo dos supervisores das gerências novas
    "AT": ["AT"], "AN": ["AN"], "SL": ["SL"], "RV": ["RV"],
    "PA_DI": ["PA", "DI"], "UR_RI": ["UR", "RI"], "GU_PO": ["GU", "PO"],
}
# Base de clientes guarda o histórico: só a versão corrente de clientes ativos
FILTRO_BASE_CLIENTE = "FL_CORRENTE eq 'S' and STATUS_CLIENTE eq 'Ativo'"
# Supervisões que não entram no painel (balcão) e rotas eventuais
SV_IGNORAR_PREFIXOS = ("SV.BL.",)
ROTAS_IGNORAR_PREFIXOS = ("EV",)
# Pedidos de hoje (WF Online): só a situação 'Inc. e Exp.' conta (fora 'Cancelado' e 'Reprovado').
# As linhas Basis (faturado) e Meta NEG (meta por cliente) vêm da mesma consulta e não são filtradas.
FILTRO_PEDIDOS_ONLINE = f"({ColMeta.FONTE} ne 'WF Online' or {ColMeta.SITUACAO_PEDIDO} eq 'Inc. e Exp.')"
# Venda Zero = geladeiras Coca-Cola (Total Ko) em contrato vigente com giro zero no mês
FILTRO_COMODATO = ("STATUS_COMODATO eq 'Concluído(Contrato)' and AGRUPADOR_EQPTO eq 'Total Ko' "
                   "and TIPO_QUIPAMENTO_Equipame eq 'Foutain - Equip. de Mercado'")
TIPO_EQUIPAMENTO_EXIBICAO = "Geladeira"
# Vol Real do volume (critério do SAC): FX_VOL_PADRAO_FAT do mês só com estes NF_STATUS_Nota_Fiscal.
# Comparação por normalizar() (sem acento e caixa); grafia exata: relatório do conferir_tendencia.py.
STATUS_NF_REAL = ["Acertado", "Meta Neg", "Em Aberto"]
GIRO_ZERO = {"GIRO ZERO"}   # valores de GIRO_STATUS_MES_ATUAL que contam como Venda Zero
# Situação da geladeira do cliente (tag e quadrinho "Desempenho GDM"): GIRO_STATUS_MES_ATUAL normalizado -> código
# do payload. A CONFIRMAR (descoberta): grafia de 'Baixo Giro' e '< 30 Dias'. Outro valor ('--'...) = desconhecido.
SITUACAO_GIRO = {"GIRO ZERO": "zero", "BAIXO GIRO": "baixo", "< 30 DIAS": "30d", "GIRO OK": "ok"}
# cliente com mais de uma geladeira: vale a pior situação
ORDEM_SITUACAO = ["zero", "baixo", "30d", "ok"]
VALORES_SIM = {"S", "SIM", "1", "X", "TRUE", "Y", "YES"}
# Meta de Novos Negócios (Campari, Dreher, Perfetti, Aperol) vem de META_COBERTURA, como o ICS
META_NOVOS_NEG_DE_META_NEG = False

# ---------------------------------------------------------------------------
# Estrutura do painel (copiada do payload.json que já estava publicado)
# ---------------------------------------------------------------------------
# Regiões e ordem das 16 gerências no painel (GC_ATIVAS e REGIOES vão para o payload)
REGIOES = {
    "Matriz": ["G1", "G2", "G3", "AT", "AP"],
    "Sul": ["AN", "SL", "RV", "MO", "IT"],
    "Norte": ["RI", "UR", "GU", "PO", "PA", "DI"],
}
# ordem das chaves no payload (DATA, GC_ATIVAS): as 6 de antes primeiro, para não mudar o que já era publicado;
# a ordem de exibição por região é a de REGIOES (o front ordena por ela)
GC_ATIVAS = ["G1", "G2", "G3", "AP", "IT", "MO"]
GC_ATIVAS += [g for siglas in REGIOES.values() for g in siglas if g not in GC_ATIVAS]

LABELS = {
    "CCTM 2L PET": "CCTM 2L Pet",
    "KS TT": "KS TT",
    "REFRI SABORES ZERO": "Refri Sabores Zero",
    "POWERADE": "Powerade",
    "KAPO": "Kapo",
    "CERVEJAS": "Cervejas",
    "CERVEJAS 600ML RETORNAVEL": "Cervejas 600ml Retornável",
    "EISENBAHN": "Eisenbahn",
    "DREHER": "Dreher",
    "CAMPARI": "Campari",
    "ARTD KO": "Artd KO",
    "PERFETTI TT": "Perfetti TT",
    "APEROL": "Aperol",
    "IMPERDOAVEIS": "Imperdoáveis",
    "VENDAZERO": "Venda Zero",
    "VOL AGUA MINERAL": "Água Mineral",
    "VOL CERVEJAS": "Cervejas",
    "VOL DEST+ART+CND": "Dest+Art+Cnd",
    "VOL REFRIGERANTES": "Refrigerantes",
    "VOL STILL": "Still",
}
LABELS_CURTO = {
    "CCTM 2L PET": "CCTM 2L Pet",
    "KS TT": "KS TT",
    "REFRI SABORES ZERO": "Refri Sabores Zero",
    "POWERADE": "Powerade",
    "KAPO": "Kapo",
    "CERVEJAS": "Cervejas",
    "CERVEJAS 600ML RETORNAVEL": "Cerv. 600ml Retorn.",
    "EISENBAHN": "Eisenbahn",
    "CAMPARI": "Campari",
    "DREHER": "Dreher",
    "PERFETTI TT": "Perfetti TT",
    "ARTD KO": "Artd KO",
    "APEROL": "Aperol",
}
GROUPS = {
    "ICS_GC": ["CCTM 2L PET", "KS TT", "REFRI SABORES ZERO", "CERVEJAS 600ML RETORNAVEL", "CERVEJAS",
               "EISENBAHN", "KAPO", "POWERADE", "ARTD KO", "IMPERDOAVEIS", "VENDAZERO"],
    "NOVOS_NEG": ["CAMPARI", "DREHER", "PERFETTI TT", "ARTD KO", "APEROL"],
    "VOLUME": ["VOL REFRIGERANTES", "VOL CERVEJAS", "VOL STILL", "VOL AGUA MINERAL", "VOL DEST+ART+CND"],
}
COV_GRUPO = {
    "ICS_GC": [k for k in GROUPS["ICS_GC"] if k not in ("IMPERDOAVEIS", "VENDAZERO")],
    "NOVOS_NEG": list(GROUPS["NOVOS_NEG"]),
    "VOLUME": list(GROUPS["VOLUME"]),
}
SEGS_INICIAL = ["Lanchonete", "Boteco", "Mercearia", "As 1-4", "Outros Canais", "Super", "Restaurante",
                "Padarias", "Adegas", "Lj. Conveniências", "Atacado Grossista", "Hiper", "Cash & Carry"]
DIAS_INICIAL = ["Seg", "Qua", "Qui", "Ter", "Seg - Qui", "Sex", "Ter - Qui", "Ter - Sex", "Seg - Qua", "",
                "Seg - Ter - Qua - Qui - Sex", "Ter - Qua - Qui", "Qua - Sex", "Seg - Sex", "Qua - Qui",
                "Seg - Ter - Qua - Qui - Sex - Sab", "Seg - Qua - Qui", "Seg - Qua - Sex", "Qui - Sex",
                "Seg - Ter - Qui"]
FONTES_PADRAO = {"venda": True, "online": True, "real": "venda", "imperdoaveis": False, "vendazero": True}

# Indicadores de cobertura (nº de clientes que compraram o agrupador): ordem do nó "indicators"
INDICADORES_COBERTURA = list(dict.fromkeys(COV_GRUPO["ICS_GC"] + COV_GRUPO["NOVOS_NEG"]))
INDICADORES_NOVOS_NEG = set(GROUPS["NOVOS_NEG"]) - set(COV_GRUPO["ICS_GC"])
INDICADORES_VOLUME = list(GROUPS["VOLUME"])
ORDEM_INDICADORES = INDICADORES_COBERTURA + ["IMPERDOAVEIS", "VENDAZERO"] + INDICADORES_VOLUME

# Volume de uma gerência só (aba Volume): segue todas as regras de volume, mas NUNCA entra nas somas dos
# 5 macros (INDICADORES_VOLUME), no Resumo, na Diretoria, no "ritmo de coberturas" nem no "puxa a média";
# fica fora de GROUPS/COV_GRUPO. O nó do indicador (e o 6º bloco do VOLUME_CLIENTE) só existe nas rotas
# das gerências listadas e quando há dado. Vai para o payload em VOLUME_EXTRA.
VOLUME_EXTRA = {"VOL DEL VALLE FRUT": {"label": "Del Valle Frut", "gcs": ["G2"]}}
INDICADORES_VOLUME_EXTRA = list(VOLUME_EXTRA)
INDICADORES_VOLUME_TODOS = INDICADORES_VOLUME + INDICADORES_VOLUME_EXTRA

# Supervisões Neutraliza (rotas 151, 251, I31, M31): sem card, coluna ou linha em lugar nenhum; Meta e Real
# de Volume, ICS GC e Novos Negócios entram só no total da gerência; Venda Zero nunca.
# ÚNICA fonte da lista: vai para o payload (NEUTRALIZA) e o front lê de lá.
NEUTRALIZA = ["SV.G1.5", "SV.G2.5", "SV.IT.3", "SV.MO.3"]
# Supervisões ocultas: fora do "puxa a média" e das listas de clientes (payload OCULTAS)
OCULTAS = ["SV.G3.3"]
# Gerências em que nada é oculto (nem Neutraliza, nem ocultas, nem "sem vendedor")
GC_SEM_OCULTAS = ["AT"]

# Segmentos elegíveis ao KS TT (mesma regra do front: KSTT_SEG)
SEGMENTOS_KS_TT = {"LANCHONETE", "RESTAURANTE", "BOTECO", "PADARIAS"}

# ---------------------------------------------------------------------------
# Agrupador do Datasphere -> chave do painel (comparação sem acento/maiúsculas).
# Os valores exatos (como vêm da fonte) entram no $filter da consulta de vendas.
# Atenção: 'Cervejas' é ao mesmo tempo indicador de cobertura e grupo de volume, e
# 'Destilados' é outro agrupador (já contido em 'Dest+Art+Cnd'): não somar.
# ---------------------------------------------------------------------------
AGRUPADORES_COBERTURA = {
    "CCTM 2L PET": "Cctm 2l Pet", "KS TT": "Ks Tt", "REFRI SABORES ZERO": "Refri Sabores Zero",
    "CERVEJAS 600ML RETORNAVEL": "Cervejas 600ml Retornavel", "CERVEJAS": "Cervejas", "EISENBAHN": "Eisenbahn",
    "KAPO": "Kapo", "POWERADE": "Powerade", "ARTD KO": "Artd Ko", "CAMPARI": "Campari", "DREHER": "Dreher",
    "PERFETTI TT": "Perfetti Tt", "APEROL": "Aperol",
}
AGRUPADORES_VOLUME = {
    "VOL REFRIGERANTES": "Refrigerantes", "VOL CERVEJAS": "Cervejas", "VOL STILL": "Still",
    "VOL AGUA MINERAL": "Agua Mineral", "VOL DEST+ART+CND": "Dest+Art+Cnd",
}
AGRUPADORES_ORIGEM = sorted(set(AGRUPADORES_COBERTURA.values()) | set(AGRUPADORES_VOLUME.values()))
# volume extra (VOLUME_EXTRA). A CONFIRMAR (descoberta): grafia do agrupador
AGRUPADORES_VOLUME_EXTRA = {"VOL DEL VALLE FRUT": "DV Frut"}
# consultas de volume (Vol Real, META_NEG, meta do dia, META_VOLUME): os 5 macros + os extras
AGRUPADORES_VOLUME_CONSULTA = list(AGRUPADORES_VOLUME.values()) + list(AGRUPADORES_VOLUME_EXTRA.values())

# Desempenho GDM (busca de cliente, aba Volume): volume dos agrupadores abaixo, somados SÓ nesse quadrinho.
# A CONFIRMAR (descoberta): grafia de Sucos e Ades
AGRUPADORES_GDM = ["Refrigerantes", "Agua Mineral", "Sucos", "Ades", "Powerade"]

# Consulta de vendas: os 17 agrupadores do painel + os extras de volume e do GDM. Compras do mês, cobertura e
# "comprou qualquer coisa hoje" continuam só com os 17 (AGRUPADORES_ORIGEM).
AGRUPADORES_CONSULTA_VENDAS = sorted(set(AGRUPADORES_ORIGEM) | set(AGRUPADORES_VOLUME_EXTRA.values())
                                     | set(AGRUPADORES_GDM))
# Vol Real: macros de volume + extras + GDM (o GDM usa o mesmo filtro de NF_STATUS)
AGRUPADORES_VOL_REAL = sorted(set(AGRUPADORES_VOLUME_CONSULTA) | set(AGRUPADORES_GDM))

APELIDOS_COBERTURA: dict[str, list[str]] = {k: [v] for k, v in AGRUPADORES_COBERTURA.items()}
APELIDOS_VOLUME: dict[str, list[str]] = {k: [v] for k, v in
                                         {**AGRUPADORES_VOLUME, **AGRUPADORES_VOLUME_EXTRA}.items()}


def _indice(apelidos: dict[str, list[str]]) -> dict[str, str]:
    return {normalizar(a): chave for chave, lista in apelidos.items() for a in lista}


INDICE_COBERTURA = _indice(APELIDOS_COBERTURA)
INDICE_VOLUME = _indice(APELIDOS_VOLUME)


def indicador_cobertura(agrupador: object) -> str | None:
    return INDICE_COBERTURA.get(normalizar(agrupador))


def indicador_volume(agrupador: object) -> str | None:
    """Chave de volume (os 5 macros ou um extra, ex.: 'VOL DEL VALLE FRUT')."""
    return INDICE_VOLUME.get(normalizar(agrupador))


_INDICE_ORIGEM = {normalizar(a) for a in AGRUPADORES_ORIGEM}
_INDICE_GDM = {normalizar(a) for a in AGRUPADORES_GDM}


def agrupador_do_painel(agrupador: object) -> bool:
    """Um dos 17 agrupadores originais (compras do mês, cobertura, "qualquer compra hoje")."""
    return normalizar(agrupador) in _INDICE_ORIGEM


def agrupador_gdm(agrupador: object) -> bool:
    return normalizar(agrupador) in _INDICE_GDM


def volume_extra_da_gc(k: str, gc: str) -> bool:
    """O volume extra `k` existe na gerência `gc`? (os 5 macros existem em todas)."""
    return k not in VOLUME_EXTRA or gc in VOLUME_EXTRA[k]["gcs"]


# ---------------------------------------------------------------------------
# GC e supervisor: o painel usa códigos curtos ('G1', 'SV.G1.1').
# Fonte: 'Gc. G1', 'Sv. G1.1', 'Sv. G3. 1' (com espaço), 'Sv. It. 1'.
# ---------------------------------------------------------------------------
_SV = re.compile(r"^SV\.([A-Z0-9]+)\.(\d+)$")


def codigo_sv(valor: object) -> str:
    """'Sv. G3. 1' -> 'SV.G3.1'."""
    return normalizar(valor).replace(" ", "")


def sv_do_painel(sv: str) -> bool:
    return bool(_SV.match(sv)) and not sv.startswith(SV_IGNORAR_PREFIXOS)


def gc_do_sv(sv: str) -> str:
    """'SV.IT.1' -> 'IT' (separa IT e MO, que vêm juntas na gerência de origem)."""
    m = _SV.match(sv)
    return m.group(1) if m else ""


def codigo_gc(valor: object) -> str:
    """'Gc. G1' -> 'G1'; 'Gc. It_Mo' -> 'IT_MO'."""
    chave = normalizar(valor).replace(" ", "")
    return chave[3:] if chave.startswith("GC.") else chave


def rota_do_painel(rota: str) -> bool:
    return bool(rota) and not rota.upper().startswith(ROTAS_IGNORAR_PREFIXOS)


def status_nf_real(valor: object) -> bool:
    return normalizar(valor) in {normalizar(s) for s in STATUS_NF_REAL}


_ORIGEM_DA_SIGLA = {sigla: origem for origem, siglas in GC_SIGLAS_ORIGEM.items() for sigla in siglas}


def gc_origem(gc: str) -> str:
    """Sigla do painel -> gerência de origem: 'IT'/'MO' -> 'IT_MO', 'PA' -> 'PA_DI', 'G1' -> 'G1'."""
    return _ORIGEM_DA_SIGLA.get(gc, gc)


def sigla_esperada(gc_original: object, sigla: str) -> bool:
    """O prefixo do supervisor é uma das siglas da gerência de origem? ('Gc. Pa_Di', 'PA' -> True)."""
    return sigla in GC_SIGLAS_ORIGEM.get(codigo_gc(gc_original), [codigo_gc(gc_original)])


def eh_sim(valor: object) -> bool:
    return normalizar(valor) in VALORES_SIM
