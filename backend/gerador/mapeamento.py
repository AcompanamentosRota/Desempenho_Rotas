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
    GC_COMERCIAL = "DS_GERENCIA_COMERCIAL_AT_Clien"  # gerência comercial atual do cliente, não agrupada ('Gc. It'):
    #                                                  o SAC soma por ela (Real dos clientes em rotas EV*)
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
    META_RECUPERAVEL = "META_RECUPERAVEL_ROTA"         # meta do dia do volume (DATA_MOVIMENTO = hoje), pela
    #                                                    rota da meta (META_ROTA), como o SAC
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
# As 16 gerências na ordem do painel (seletores, Diretoria, cascata, Resumo), com o nome da praça.
# ÚNICA fonte: vão para o payload em GC_NOMES (todas, nesta ordem: o front lista as 16, mesmo as sem dados) e
# GC_ATIVAS (as que têm dados, nesta ordem; é também a ordem de DATA). Rótulo no front: "GC.G1 · Goiânia 01".
GC_NOMES = {
    "AN": "Anápolis", "AP": "Aparecida", "AT": "Atacados", "G1": "Goiânia 01", "G2": "Goiânia 02",
    "G3": "Goiânia 03", "PA": "Palmas", "DI": "Dianópolis", "RV": "Rio Verde", "SL": "São Luís",
    "GU": "Gurupi", "PO": "Porangatu", "IT": "Itumbiara", "MO": "Morrinhos", "UR": "Uruaçu", "RI": "Rialma",
}
GC_ATIVAS = list(GC_NOMES)

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
    "INC HEINEKEN": "Heineken",
    "INC EISENBAHN 600ML": "Eisenbahn - 600ml",
    "INC HEINEKEN 600ML": "Heineken - 600ml",
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
    "INC HEINEKEN": "Heineken",
    "INC EISENBAHN 600ML": "Eisenbahn - 600ml",
    "INC HEINEKEN 600ML": "Heineken - 600ml",
}
# Campanha "Todos a Bordo 3.0" (aba Incentivo, cobertura de cervejas): os 5 itens na ordem da aba. CERVEJAS e
# CERVEJAS 600ML RETORNAVEL são os indicadores do ICS (continuam lá, como ARTD KO está em ICS e Novos Negócios);
# as 3 chaves INC são só da aba: fora de ICS_GC, NOVOS_NEG, COV_GRUPO e de tudo que conta ou lista o ICS e os
# Novos Negócios. Mesmas regras de dado do ICS (meta por rota, Real = clientes distintos com cobertura > 0,
# online = clientes com compra hoje), sem filtro de segmento; rota sem meta do item (as BARRACUDA não têm meta
# de Heineken) = indicador indisponível, com meta e real null.
INDICADORES_INCENTIVO = ["INC HEINEKEN", "INC EISENBAHN 600ML", "INC HEINEKEN 600ML"]
GROUPS = {
    "ICS_GC": ["CCTM 2L PET", "KS TT", "REFRI SABORES ZERO", "CERVEJAS 600ML RETORNAVEL", "CERVEJAS",
               "EISENBAHN", "KAPO", "POWERADE", "ARTD KO", "IMPERDOAVEIS", "VENDAZERO"],
    "NOVOS_NEG": ["CAMPARI", "DREHER", "PERFETTI TT", "ARTD KO", "APEROL"],
    "VOLUME": ["VOL REFRIGERANTES", "VOL CERVEJAS", "VOL STILL", "VOL AGUA MINERAL", "VOL DEST+ART+CND"],
    "INCENTIVO": ["CERVEJAS", "INC HEINEKEN", "INC EISENBAHN 600ML", "INC HEINEKEN 600ML", "CERVEJAS 600ML RETORNAVEL"],
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
# ordem do nó "indicators": os do ICS/NN, Imperdoáveis, Venda Zero, os 5 macros, as 3 chaves INC do incentivo e,
# no fim, o volume extra só nas rotas que têm o dado (VOLUME_EXTRA)
ORDEM_INDICADORES = INDICADORES_COBERTURA + ["IMPERDOAVEIS", "VENDAZERO"] + INDICADORES_VOLUME + INDICADORES_INCENTIVO

# Volume de uma gerência só (aba Volume): segue todas as regras de volume, mas NUNCA entra nas somas dos
# 5 macros (INDICADORES_VOLUME), no Resumo, na Diretoria, no "ritmo de coberturas" nem no "puxa a média";
# fica fora de GROUPS/COV_GRUPO. O nó do indicador (e o 6º bloco do VOLUME_CLIENTE) só existe nas rotas
# das gerências listadas e quando há dado. Vai para o payload em VOLUME_EXTRA.
VOLUME_EXTRA = {"VOL DEL VALLE FRUT": {"label": "Del Valle Frut", "gcs": ["G2"]}}
INDICADORES_VOLUME_EXTRA = list(VOLUME_EXTRA)
INDICADORES_VOLUME_TODOS = INDICADORES_VOLUME + INDICADORES_VOLUME_EXTRA

# Mês anterior no mesmo dia útil (chave opcional MES_ANTERIOR, a última do payload; gerador/mes_anterior.py). Decisões
# da Karen de 21/10/2026: só os 5 macros de volume (sem coberturas, Todos a Bordo, Del Valle Frut, Imperdoáveis e
# Venda Zero); Real até o corte pela rota ATUAL do cliente (ColMeta.ROTA), as EV* na rota oculta da gerência
# comercial; meta = a do mês anterior inteiro (META_VOLUME da rota da meta; sem ela, META_NEG). As consultas rodam
# junto com as do mês; passou de MES_ANTERIOR_LIMITE_S ou falhou: a chave fica fora (aviso) e a rodada segue.
CHAVE_MES_ANTERIOR = "MES_ANTERIOR"
INDICADORES_MES_ANTERIOR = list(INDICADORES_VOLUME)
MES_ANTERIOR_LIMITE_S = 60

# Rotas Neutraliza e virtuais: listas POR ROTA (valem em qualquer gerência, inclusive na AT, e independem da
# supervisão). ÚNICA fonte: vão para o payload (NEUTRALIZA_ROTAS, VIRTUAIS_ROTAS) e o front lê de lá.
# Neutraliza: Meta e Real de Volume, ICS GC e Novos Negócios no total da gerência; na tela, uma linha "Neutraliza"
# por gerência (cascata e filtro de supervisão) com as rotas e os clientes dentro; fora do Resumo de Vendas, do
# "puxa a média" e da Venda Zero. A 551 não tem cliente corrente na base (só histórico na Ap/At): fica na lista
# para entrar como Neutraliza se voltar.
NEUTRALIZA_ROTAS = ["A41", "431", "251", "I31", "M31", "C31", "R31", "S31", "U31", "151", "O21", "551"]
# Virtuais: ocultas em todo o painel (cascata, listas, filtro, busca, Resumo); só no total da gerência
# (Volume, ICS GC, NN); fora da Venda Zero
VIRTUAIS_ROTAS = ["A42", "A43", "A44", "R32"]
# Clientes que estão hoje numa rota eventual (EV*): a rota fica fora do painel, mas o Real de volume deles entra no
# total da gerência, como no SAC (conferido em 20/10/2026, seção E7 do conferir_tendencia.py): uma rota oculta por
# gerência (rota_eventuais), na gerência comercial do cliente (ColMeta.GC_COMERCIAL), numa supervisão própria
# (sv_eventuais). Sem meta (as rotas EV não têm META_VOLUME nem META_NEG) e sem clientes; fora de cobertura, Venda
# Zero e online. No payload vão em VIRTUAIS_ROTAS (ocultas como as virtuais) e em EVENTUAIS_ROTAS (nota própria).


def rota_eventual(rota: str) -> bool:
    """Rota eventual da base/vendas ('EV5', 'EVD'): fora do painel."""
    return bool(rota) and rota.upper().startswith(ROTAS_IGNORAR_PREFIXOS)


def rota_eventuais(gc: str) -> str:
    """Rota oculta com o Real dos clientes em rotas EV* da gerência ('AP' -> 'AP-EV'; nenhuma rota real tem '-')."""
    return f"{gc}-EV"


def sv_eventuais(gc: str) -> str:
    """Supervisão da rota oculta ('AP' -> 'SV.AP.EV'; fora do padrão SV.<sigla>.<n>, nunca aparece)."""
    return f"SV.{gc}.EV"
# Supervisões ocultas: fora do "puxa a média" e das listas de clientes (payload OCULTAS)
OCULTAS = ["SV.G3.3"]
# Gerências em que nenhuma supervisão é oculta (nem as de OCULTAS, nem "sem vendedor"); as listas por rota valem
GC_SEM_OCULTAS = ["AT"]

# Segmentos elegíveis ao KS TT (mesma regra do front: KSTT_SEG)
SEGMENTOS_KS_TT = {"LANCHONETE", "RESTAURANTE", "BOTECO", "PADARIAS"}

# ---------------------------------------------------------------------------
# Agrupador do Datasphere -> chave do painel (comparação sem acento/maiúsculas).
# Os valores exatos (como vêm da fonte) entram no $filter da consulta de vendas.
# Atenção: 'Cervejas' é ao mesmo tempo indicador de cobertura e grupo de volume, e
# 'Destilados' é outro agrupador (já contido em 'Dest+Art+Cnd'): não somar.
# ---------------------------------------------------------------------------
# Incentivo "Todos a Bordo 3.0": agrupadores exatos do Datasphere (venda e meta; seção E8 de 20/10/2026). O casamento
# é por igualdade depois de normalizar() (sem acento e caixa), nunca por pedaço: 'Heineken - 330ml', 'Heineken Zero',
# 'Heineken - 600ml Vr', 'Eisenbahn - 600ml Vr' e 'Cervejas 600ml Retornavel C/ Sol Ow' NÃO entram.
AGRUPADORES_INCENTIVO = {
    "INC HEINEKEN": "Heineken", "INC EISENBAHN 600ML": "Eisenbahn - 600ml", "INC HEINEKEN 600ML": "Heineken - 600ml",
}
AGRUPADORES_COBERTURA = {
    "CCTM 2L PET": "Cctm 2l Pet", "KS TT": "Ks Tt", "REFRI SABORES ZERO": "Refri Sabores Zero",
    "CERVEJAS 600ML RETORNAVEL": "Cervejas 600ml Retornavel", "CERVEJAS": "Cervejas", "EISENBAHN": "Eisenbahn",
    "KAPO": "Kapo", "POWERADE": "Powerade", "ARTD KO": "Artd Ko", "CAMPARI": "Campari", "DREHER": "Dreher",
    "PERFETTI TT": "Perfetti Tt", "APEROL": "Aperol",
    **AGRUPADORES_INCENTIVO,
}
AGRUPADORES_VOLUME = {
    "VOL REFRIGERANTES": "Refrigerantes", "VOL CERVEJAS": "Cervejas", "VOL STILL": "Still",
    "VOL AGUA MINERAL": "Agua Mineral", "VOL DEST+ART+CND": "Dest+Art+Cnd",
}
# os 17 agrupadores do painel (compras do mês, cobertura do ICS/NN, "qualquer compra hoje", virada do mês): sem os
# do incentivo, que não mudam a base, o "sem compra" nem os revertidos da Venda Zero
AGRUPADORES_ORIGEM = sorted({v for k, v in AGRUPADORES_COBERTURA.items() if k not in AGRUPADORES_INCENTIVO}
                            | set(AGRUPADORES_VOLUME.values()))
# volume extra (VOLUME_EXTRA). Agrupador oficial "Del Valle Frut" (conferido em 19/10/2026: META_VOLUME e META_NEG
# nas rotas da G2; "Dv Frut" traz os mesmos números, mas não é o oficial)
AGRUPADORES_VOLUME_EXTRA = {"VOL DEL VALLE FRUT": "Del Valle Frut"}
# consultas de volume (Vol Real, META_NEG, meta do dia, META_VOLUME): os 5 macros + os extras
AGRUPADORES_VOLUME_CONSULTA = list(AGRUPADORES_VOLUME.values()) + list(AGRUPADORES_VOLUME_EXTRA.values())

# Desempenho GDM (busca de cliente, aba Volume): volume dos agrupadores abaixo, somados SÓ nesse quadrinho.
# A CONFIRMAR (descoberta): grafia de Sucos e Ades
AGRUPADORES_GDM = ["Refrigerantes", "Agua Mineral", "Sucos", "Ades", "Powerade"]

# Consulta de vendas: os 17 agrupadores do painel + os extras de volume e do GDM + os 3 do incentivo (cobertura do
# mês e online de hoje das chaves INC). Compras do mês, cobertura e "comprou qualquer coisa hoje" continuam só com
# os 17 (AGRUPADORES_ORIGEM).
AGRUPADORES_CONSULTA_VENDAS = sorted(set(AGRUPADORES_ORIGEM) | set(AGRUPADORES_VOLUME_EXTRA.values())
                                     | set(AGRUPADORES_GDM) | set(AGRUPADORES_INCENTIVO.values()))
# Consulta de metas (carregar_metas): os 17 + os extras de volume, como antes. Os 3 do incentivo vão numa consulta
# à parte, só com rota, agrupador e META_COBERTURA (AGRUPADORES_METAS_INCENTIVO): na mesma consulta, com META_VOLUME e
# META_NEG, o Datasphere devolve HTTP 500 depois de ~150 s (20/10/2026; a separada leva ~9 s, como na seção E8).
AGRUPADORES_CONSULTA_METAS = AGRUPADORES_ORIGEM + list(AGRUPADORES_VOLUME_EXTRA.values())
AGRUPADORES_METAS_INCENTIVO = list(AGRUPADORES_INCENTIVO.values())
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
