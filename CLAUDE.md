# CLAUDE.md — Desempenho de Rotas (Comercial Bandeirantes)

Painel estático (GitHub Pages) + gerador Python que lê o SAP Datasphere via OData.
Visão geral, variáveis de ambiente e passo a passo para humanos: `README.md`.

## Estrutura e comandos

- `frontend/`: site publicado. JS clássico (sem build, sem módulos ES): `config.js` → `app.js` → `resumo.js` → `main.js`,
  todos com `defer` e compartilhando globais (`P`, `DATA`, `sel`, `RS`...). Dados em `frontend/data/` (gerados, não editar à mão).
- `backend/`: `odata/` (cópia do kit `C:\Users\luan.arantes\Documents\Teste_ODATA`, sem pandas), `gerador/`, `scripts/`, `tests/`.
- Testes (sem rede, stdlib `unittest`): `cd backend && python -m unittest discover -s tests -t .`
- Gerar dados: `cd backend && python scripts/gerar.py --forcar` (fora de 07:00-18:59 BRT só roda com `--forcar`).
  `--rota 111` grava em `backend/saida/rota_111/`; `--saida DIR` muda o destino.
- Conferir mapeamento contra a fonte: `python scripts/descobrir.py` → `backend/saida/descoberta/relatorio.md`.
- Conferir tendência/fechamento com dados reais: workflow manual "Conferir tendência" (`conferir-tendencia.yml`,
  input `hoje` opcional) → artifact com `relatorio_tendencia.md` + `payload.json`/`online.json` (sem commit).
  `gerar.py --hoje AAAA-MM-DD --saida DIR` simula a data (o cron não usa).
  Local: `python scripts/conferir_tendencia.py --saida DIR` (DIR fora do repo; nunca `frontend/data`).
- Tela do SAC por dia: `backend/conferencia/sac/refri_AAAA-MM-DD.csv` (`;`, `GC;Real;Meta;Tendencia;MetaDia`, 1ª linha
  `#` = fonte e horário; formato no README). Lida pela seção 4 (aceite, OK/DIVERGE por célula; sem o arquivo: "sem
  tela do SAC para esta data") e pela E7 (diferenças por rota contra o SAC, só com o CSV do dia). Nada fixo no script.
  A E7 imita o gerador (rota oculta das EV*, meta do dia pela rota da meta) e só relata; as colunas que só ela lê
  (supervisão e gerência da meta) ficam como `COL_*` no próprio script.
  Achado de 20/10/2026 (E7 com dado real): o SAC soma Real e meta do dia de Refrigerantes pela gerência comercial do
  cliente no modelo de vendas (`M.ColMeta.GC_COMERCIAL`; resíduo ≤ 1 cx nas 16), sem excluir rotas. A diferença era
  toda de clientes hoje em rotas EV* (Real −407 cx; meta do dia −1.071 cx, com a meta numa rota do painel). Decisão da
  Karen no mesmo dia: o Real das EV* entra na rota oculta da gerência e a meta do dia vai pela rota da meta (abaixo).
  O par G2/G3 (−71/−71) não era transferência entre elas (EV1 → G2; EVF/EV5/EV1 → G3).
- E8 do conferir (sempre, mês de hoje): descoberta do incentivo "Todos a Bordo 3.0" (cobertura de cervejas; itens em
  `ITENS_INCENTIVO` do script, com a chave interna sugerida `INC ...`). Só relata, antes da aba "Todos a Bordo": agrupadores
  com HEINEKEN/EISENBAHN/CERVEJ/600 (venda e meta), item → agrupador por `chave_texto` (sem acento, caixa, espaço ou
  pontuação), meta por gerência/rota com FULL x BARRACUDA pela meta de Heineken (`portfolio`/`divisao_portfolio`, só
  nas rotas normais: sem Neutraliza e virtuais; e o que mudaria sem as rotas T<nn>, `ROTA_T`), online de hoje e
  realizado. Definição da Karen (20/10/2026): BARRACUDA = filial com CD da Heineken; rota com meta de Heineken = FULL,
  sem = BARRACUDA; supervisão e gerência mistas ficam com a da maioria das rotas (SV.G2.1: 4 de 7 = FULL); empate
  fica sem informação (`portfolio` → None; "—" na tabela, fora das listas e das comparações). Supervisão = a do painel
  (`sv_rota_painel`, regra do payload). `META_COBERTURA` não é somada pelo servidor (vem uma linha por valor): a E8 usa
  o maior por rota, como `fontes.carregar_metas`. Como ler: README, "Descoberta do incentivo".
  Achado de 20/10/2026 (E8 com dado real): os 5 itens existem como agrupador na venda e na meta ('Cervejas', 'Heineken',
  'Eisenbahn - 600ml', 'Heineken - 600ml', 'Cervejas 600ml Retornavel'; há também variantes '... - 600ml Vr' só na
  venda). Desde a aba Todos a Bordo, Heineken, Eisenbahn - 600ml e Heineken - 600ml estão no gerador (chaves INC; abaixo). Sem meta de
  Heineken em nenhuma rota normal: AP, AT, G3, PA, DI, GU; com meta só em A37 (AN), 111 (G1) e 211-214 (G2); nas
  demais, todas as rotas normais têm meta, exceto R11, I19, C28 e as rotas T<nn>. Pela maioria (Heineken e Heineken
  600ml iguais): BARRACUDA AN AP AT G1 G2 G3 PA DI GU; FULL RV SL PO IT MO UR RI; única supervisão diferente da
  gerência: SV.G2.1 (FULL); sem empates; sem as T<nn>, nada muda.
- Front local: `cd frontend && python -m http.server 8765`.
- Testes de front (Chromium headless + dado sintético gerado pelo próprio back-end): `node --test frontend/tests/front.test.js`
  (precisa de Python com as dependências do back-end e do pacote `playwright`; sem ele os testes são pulados; o CI não roda).
  O teste chama `python3` (no Windows, ponha um `python3.exe` do venv no PATH) e acha o `playwright` por `NODE_PATH`.
  `abre(nome, {entrar})` entra pela tela de entrada clicando na caixa de seleção (`entra()`: 'gc' = primeira gerência
  com dados, 'dir' = Diretoria, ou {perfil, gc, sv, rota}, com gc = sigla ou grupo 'IT+MO'; a sigla de uma gerência
  agrupada escolhe o grupo); `vaiPara()` = casa + `entra()`; relógio simulado por `antes: p => p.clock...`.
  Variantes do payload montadas no próprio teste: 'grupo' (IT+MO com a virtual I32 e a eventual MO-EV), 'semdados'
  (G3 e PA sem dados), 'semsv', 'antigo', 'inc'/'incfech' (cenários da aba Todos a Bordo, `montaIncentivo`) e 'seminc'
  (payload sem o grupo INCENTIVO). `abre(nome, {troca})` troca o conteúdo de um arquivo servido (ex.: config.js).
- Nesta máquina o Python do sistema não tem `python-dotenv`/`pytest`; use
  `C:\Users\luan.arantes\Documents\Teste_ODATA\.venv\Scripts\python.exe` para rodar o back-end.
  Chamadas de rede exigem desabilitar o sandbox.

## Regras que não são óbvias

- **Contrato com o front**: `payload.json`/`online.json` têm o formato exato que `frontend/js/main.js` e `app.js` leem.
  `SEGS` e `DIAS` são tabelas de índice (cada cliente guarda a posição): só acrescentar no fim.
  `EVENTUAIS_ROTAS` (rotas ocultas dos clientes em EV*) é chave obrigatória desde 20/10/2026.
  Fórmulas em `backend/gerador/modelo.py` espelham `agrega()` em `app.js`; mudou um, mude o outro.
- **Todo nome de coluna, filtro e agrupador fica em `backend/gerador/mapeamento.py`.** Valores conferidos em 13/10/2026:
  - Base de clientes guarda histórico: filtrar `FL_CORRENTE eq 'S' and STATUS_CLIENTE eq 'Ativo'`.
  - Gerências do painel na fonte (`M.GC_ORIGEM`): `Gc. G1/G2/G3/Ap/It_Mo` conferidas; `Gc. At/An/Sl/Rv/Pa_Di/Ur_Ri/Gu_Po`
    A CONFIRMAR (vistas no comodato). As agrupadas (It_Mo, Pa_Di, Ur_Ri, Gu_Po) são separadas pelo prefixo do supervisor
    (`Sv. Pa. 3` → `SV.PA.3` → `PA`; `M.GC_SIGLAS_ORIGEM`); prefixo fora da gerência entra e vai para o log.
    16 siglas com o nome da praça em `M.GC_NOMES` (fonte única, no payload em `GC_NOMES`), na ordem do painel:
    AN AP AT G1 G2 G3 PA DI RV SL GU PO IT MO UR RI. `GC_ATIVAS` (payload) = as com dados, nessa ordem (é também a de
    `DATA`); o front lista as 16 por `GC_NOMES` (sem dados = desabilitada) e rotula "GC.G1 · Goiânia 01" (`rotuloGc`).
    Não há mais regiões: payload antigo com `REGIOES` é ignorado (sem `GC_NOMES`: ordem do `GC_ATIVAS`, só o código).
    Supervisores vêm com espaço (`Sv. G3. 1`). Ignorar `Sv. Bl.*` (balcão), rotas `EV*` e supervisor fora de
    `SV.<sigla>.<n>` (também na At); as ignoradas são contadas por gerência e motivo no log.
  - Agrupadores têm grafia própria (`Cctm 2l Pet`, `Ks Tt`...). `Cervejas` é cobertura E volume.
    `Destilados` é outro agrupador já contido em `Dest+Art+Cnd`: nunca somar.
  - A consulta de vendas SEMPRE filtra os agrupadores (sem filtro vira cliente × 748 agrupadores): os 17 do painel +
    Del Valle Frut, Sucos e Ades (`M.AGRUPADORES_CONSULTA_VENDAS`). Compras do mês, cobertura e "qualquer compra hoje"
    (Revertido da VZ) continuam só com os 17 (`M.agrupador_do_painel`).
  - Pedidos de hoje (`FONTE = 'WF Online'`) só contam com `SITUACAO_Pedido = 'Inc. e Exp.'` (fora Cancelado/Reprovado).
    Basis e Meta NEG vêm na mesma consulta: o filtro é `(FONTE ne 'WF Online' or SITUACAO_Pedido eq 'Inc. e Exp.')`,
    nunca `SITUACAO_Pedido eq 'Inc. e Exp.'` puro (sumiria a meta por cliente, que tem situação 'Meta NEG').
  - `META_DIA` (meta do dia antiga) não é mais usada pelo gerador; só o `conferir_tendencia.py` a lê para comparar.
  - Meta de volume por cliente = `META_NEG` por `CD_CLIENTE` × `DS_AGRUPADOR_Agrupador_Prod`.
  - Venda Zero: `Concluído(Contrato)` + `AGRUPADOR_EQPTO = 'Total Ko'` + Fountain + `Giro Zero`, deduplicando por
    `CD_EQUIPAMENTO_Equipame`. A meta só existe por gerência; o gerador rateia pelas rotas pela quantidade de geladeiras.
- **KS TT: Real e Online filtrados pelos 4 segmentos; meta sem filtro** (`M.SEGMENTOS_KS_TT`).
  A cobertura de todos os indicadores conta para a rota da venda, mesmo de cliente transferido ou desativado
  (sem filtro de roster). Segmento: o da base (roster da rota); para quem saiu dela, `DS_SEGMENTO_Clien` da venda.
  O filtro fica em `payload.py` (`_filtra_ks_tt`, `online_ks_tt`), então o front recebe tudo pronto. O `QUALQUER`
  do online não é filtrado. `validacao.py` reprova KS TT com cliente da base de segmento não elegível; real > `baseKsTt`
  só gera aviso (clientes que saíram da rota).
- **Tendência de volume = critério do SAC** (`modelo.meta_e_restante` + `indicador_volume`, espelhada em
  `agrega()` do app.js e `soma()` do resumo.js), por rota × macro de volume:
  Meta = `META_VOLUME_Chave_Meta_SAP` da rota (é o que o SAC mostra como "Meta NEG"; a soma de `META_NEG` dos
  clientes é menor porque parte da meta não está distribuída — vai no payload só como `metaNegClientes`);
  Vol Real = `FX_VOL_PADRAO_FAT` do mês com `NF_STATUS_Nota_Fiscal` em `M.STATUS_NF_REAL` (via `normalizar`);
  Neg Restante = `META_NEG` de hoje ao fim do mês agrupada pela **rota da meta** (`CD_ROTA_Chave_Meta_SAP`, como o
  SAC; pela rota atual do cliente, `CD_ROTA_Clien`, cliente transferido leva a curva para a rota errada — AP e MO
  divergiam em 18/10), direto quando a `META_NEG` do mês dessa rota fica a até 1% da Meta; acima disso, escalonado
  (Meta × restante / mês) e a rota vai para o aviso. Se a consulta pela rota da meta falhar ou vier sem rota, volta
  à curva pela rota do cliente, sempre escalonada (`fontes.carregar_curva_neg`); Tendência = Vol Real + Neg Restante; % = Tendência / Meta, verde com % >= 100; Dif = Vol Real − Meta.
  Casos-limite (aviso por rota × macro): META_VOLUME sem META_NEG → Neg Restante = Meta × dias úteis restantes
  (com hoje) / dias úteis do mês; sem META_VOLUME → Meta e restante = somas de META_NEG; nenhuma → indisponível.
  Meta do dia = `META_RECUPERAVEL_ROTA` por **rota da meta** (`CD_ROTA_Chave_Meta_SAP`, como o SAC; decisão de
  20/10/2026: pela rota do cliente, a meta de cliente em rota EV* sumia, AP −783 e PO −137) × agrupador com
  `DATA_MOVIMENTO` = hoje (se der HTTP 500, repete por gerência; se falhar ou vier sem rota, pela rota do cliente,
  com aviso no log; se falhar também, `metaDia = null`, nunca outra conta). Supervisão e gerência somam as rotas e recalculam
  o %. `validacao.py` informa por gerência a meta não distribuída (META_VOLUME − soma META_NEG), sem reprovar.
  **`DATA_MOVIMENTO` só no `$filter`, nunca no groupby**: por rota × agrupador × dia são ~25 mil linhas e ~150 s
  por medida (17/10); `META_NEG` do mês e restante são duas consultas por rota × agrupador. Literal de data pelo
  tipo do `$metadata` (`fontes.literal_data`). Todas as consultas do mês rodam em paralelo (meta: gerar.py < 60 s).
- **Barra por cliente (aba Volume)**: payload traz [Meta NEG, Vol Real] do cliente; o front soma o volume online de
  hoje do cliente (`online.json` → `volumeCliente`, também na rodada só-online) e recalcula % e status (mesma regra
  de cor; `modelo.bloco_cliente_com_online`). Só na barra: Real de rota/SV/GC e tendência ficam só com o faturado;
  no Resumo de Vendas o online fica na coluna própria. No fechamento o online não é somado.
- **Fechamento do mês (automático)**: do dia 1 até o fim do 1º dia útil de M e, depois, enquanto alguma gerência
  (de `M.GC_ORIGEM`, presentes na base) não tiver `META_VOLUME` > 0 e `META_COBERTURA` > 0 para M (meta por rota →
  gerência pela base de clientes). Dia útil pelo calendário do Datasphere (`NO_DIA_UTIL`), senão cálculo local.
  Nesse período TODO o payload é de M−1 (`cal.anomes`), com `FECHAMENTO: true`, calendário fechado
  (DIA_ONTEM = DIA_HOJE = TOTAL, PACE 100), volume sem tendência/meta do dia (% realizado = Vol Real / META_VOLUME), Venda Zero indisponível
  (comodato nem é consultado). O online continua sendo o de hoje (consulta extra só `FONTE = 'WF Online'` em M) e
  ganha `fechamentoMes` = rótulo de M−1; na rodada só-online o rótulo sai do payload publicado. O input manual
  `fechamento` do workflow só sobrepõe o rótulo da tag. `validacao.py` compara quedas (rotas, clientes, volume real)
  só com o payload publicado do mesmo `MES_LABEL`; na virada, só avisa.
- **Neutraliza e virtuais são POR ROTA** (`M.NEUTRALIZA_ROTAS`, `M.VIRTUAIS_ROTAS`; listas únicas, no payload
  `NEUTRALIZA_ROTAS`/`VIRTUAIS_ROTAS`, o front lê de lá; `CONFIG.SV_EXCLUIDOS` só para payload antigo). Valem em qualquer
  gerência, inclusive na AT. A supervisão no front soma só as rotas normais dela (`rotasNormais`) e só aparece se tiver
  alguma (`svsVisiveis`); o total da gerência e da Diretoria soma tudo (`rotasDe(gc,'')`).
  Neutraliza: no total; linha "Neutraliza" no fim das supervisões da cascata (`ctxNeutraliza`, rotas e clientes dentro)
  e opção "Neutraliza" no filtro de supervisão (`SV_NEUTRA`; o Resumo e o link dele viram a gerência); clientes na busca,
  na base e nas listas; fora do Resumo, do "puxa a média" e da Venda Zero (card escondido se o filtro só tem Neutraliza;
  sem linha na cascata da VZ). Virtuais: só no total (Volume/ICS/NN), ocultas em tudo o mais (sem cliente na base);
  na cascata, só uma nota no fim das supervisões com Meta e Real delas (`notaVirtuais`; linhas + nota = card).
  As duas fora da Venda Zero no back-end (lista, geladeiras ativas e rateio da meta); `COMODATO_CLIENTE` (tag/GDM) só
  sem as virtuais. A 551 não tem versão corrente na base (FL_CORRENTE = 'S'; só histórico Ap/At até 03/2026), nem venda
  ou meta em out/26: fica na lista e entra sozinha se voltar. Ocultas (`M.OCULTAS`: SV.G3.3): fora do "puxa a média" e
  das listas de clientes; na AT (`M.GC_SEM_OCULTAS`) nenhuma supervisão é oculta (nem "sem vendedor").
- **Clientes em rotas EV*** (decisão de 20/10/2026, como o SAC): a rota EV continua fora do painel, mas o Vol Real de
  volume (5 macros; Del Valle Frut só na G2) dos clientes que estão nela entra no total da **gerência comercial do
  cliente** (`M.ColMeta.GC_COMERCIAL`, coluna opcional da consulta do Vol Real; `VolumeMes.eventuais`), numa rota oculta
  por gerência (`M.rota_eventuais`: `AP-EV`) e supervisão própria (`M.sv_eventuais`: `SV.AP.EV`, nunca aparece).
  Só nas gerências com rotas no painel (`fontes.volume_eventuais`; o resto e cliente sem gerência comercial vão para o
  log). Meta 0, sem Neg Restante (tendência = Real), meta do dia 0, sem clientes; fora de cobertura, Venda Zero e
  online. Payload: em `VIRTUAIS_ROTAS` (o front esconde como virtual, também o front antigo em cache) e em
  `EVENTUAIS_ROTAS` (chave nova, obrigatória na validação); na cascata, nota "Inclui clientes de rotas eventuais (EV*):
  Real X" (`notaVirtuais`). A validação não conta essas rotas na disponibilidade de cobertura nem nas quedas de rotas.
  Outras rotas fora do painel (SV.BL.*, APE...) continuam fora (em 20/10 não tinham diferença contra o SAC).
- **Del Valle Frut** (`M.VOLUME_EXTRA`: `VOL DEL VALLE FRUT`, agrupador oficial "Del Valle Frut", conferido em 19/10/2026
  nas 18 rotas da G2; "Dv Frut" tem os mesmos números mas não é o oficial; só G2): todas as regras de volume; fora de
  `GROUPS`/`COV_GRUPO`/`INDICADORES_VOLUME` (nunca somado aos 5 macros; fora do Resumo, da Diretoria, do ritmo de
  coberturas e do "puxa a média"); nó do indicador e 6º bloco do `VOLUME_CLIENTE` só nas rotas com o dado. Sem
  META_VOLUME nem META_NEG na G2: indicador indisponível (sem card) e aviso no log. Rótulo do extra: `VOLUME_EXTRA[k]
  ['label']` (não está em `M.LABELS`).
- **Online na janela de recarga** (`online.manter_publicado`): dia útil, 07:00-18:45, consulta sem nenhum cliente online
  e `online.json` publicado do mesmo dia com dados -> o publicado fica (não grava o vazio), aviso no log, e o payload da
  rodada calcula os revertidos com o online publicado (`online.do_publicado`). Fora disso, grava como sempre.
- **Desempenho GDM e tag de geladeira** (busca de cliente): payload `COMODATO_CLIENTE {rota:{pv:[meta, faturado GDM,
  situação, nº geladeiras]}}` + online `gdmCliente`. Meta = `META_EQPTO` das geladeiras Total Ko; faturado = Vol Real
  (mesmo NF_STATUS) em Refrigerantes, Água Mineral, Sucos, Ades, Powerade (`M.AGRUPADORES_GDM`, única soma entre
  agrupadores permitida); situação = pior `GIRO_STATUS_MES_ATUAL` (`M.SITUACAO_GIRO`, 'Baixo Giro'/'< 30 Dias' A CONFIRMAR).
  Cores: Zero vermelho, Baixo sempre amarelo, Ok verde, < 30 dias e rede pela venda. Fechamento: sem tag nem quadrinho.
- **Validação por gerência**: gerência sem rotas, metas ou Real = aviso; quedas (rotas, clientes, volume real) só contra
  a mesma gerência publicada (gerência nova não é comparada).
- **Entrada com perfis, por seleção** (controle de acesso INTERNO, não é segurança: os dados estão em
  `frontend/data/*.json`; aviso no README e em `config.js`; nada de usuário, senha ou campo de texto): DIRETORIA entra
  direto ("Todas as gerências"); GERÊNCIA, SUPERVISÃO e ROTA abrem a caixa de seleção (`#entCaixa`: `abreCaixa` /
  `pintaCaixa`, diálogo com foco, Tab preso, setas, ESC, × e clique fora). 1ª etapa (`opcoesGc`): as 16 na ordem de
  `GC_NOMES`/`GC_ATIVAS` com os grupos de `CONFIG.GC_GRUPOS` (PA+DI, GU+PO, IT+MO, UR+RI, os pares que o Datasphere
  junta) numa opção só, na posição do 1º membro; sem dados = desabilitada (grupo: se nenhuma das duas tiver). 2ª etapa
  (Supervisão e Rota): `svsDaEntrada`/`rotasDaEntrada` da gerência (no grupo, das duas, por gerência), só o que
  aparece no painel (`svNoPainel`: sem SV.G3.3 nem "Neutraliza"; `rotaNoPainel`: Neutraliza sim, virtual e '-EV' não).
  Grupo = "gerência" com a chave 'IT+MO': `membrosGc`/`ehGrupo`/`temDados`, e `rotasDe`, `svsDe`, `svsVisiveis`,
  `rotasNeutraliza`, `ctxGerencia`, `ctxNeutraliza`, `notaVirtuais`, `rotuloGc` aceitam a chave (rotas das duas; uma
  linha "Neutraliza"). Na Gerência de um grupo, `sel.gc` = chave (Total) ou uma das duas; `fgc` só com "Total (GC.IT +
  GC.MO)" e as duas (`grupoDoFiltro`); Resumo do Total = total + as duas lado a lado (`colunas()` em resumo.js).
  `validaAcesso` (caixa, reabertura e payload novo): Gerência = uma opção da caixa com dados (`opcaoValida`; a MO
  sozinha não vale); Supervisão/Rota = gerência (ou grupo) com dados e sv/rota no painel de uma delas, devolvendo a
  gerência da sv/rota. Os perfis Gerência, Supervisão e Rota usam o modo 'gc' com parte do filtro travada (`ACESSO`;
  `montaFiltros` esconde os selects; Rota sem Resumo). Acesso em `localStorage 'drotas_sessao'` {perfil, gc, sv, rota,
  dia} (no grupo, gc = 'IT+MO'; Supervisão/Rota guardam a gerência delas): `entradaOuAcesso()` ao carregar (atrás da
  tela `#carga`, para não piscar a entrada; grupo reabre no Total) e ao fechar um Resumo aberto por link; `dia` = dia
  de trabalho em America/Sao_Paulo com virada às `CONFIG.SESSAO_VIRADA_HORA` (5h), conferido também em `puxaOnline` e
  no `visibilitychange` (`confereDia`); payload novo revalida (`confereAcesso`; no grupo, a escolha do seletor fica
  enquanto tiver dados). A casa apaga o acesso. Link `?resumo=` (também `gc=IT%2BMO`) não lê nem grava o acesso.
  Sol/lua só no fundo da entrada (`'drotas_entrada'`, à parte).
- **Aba Todos a Bordo ("Todos a Bordo 3.0", cobertura de cervejas; chave interna INCENTIVO, era "Incentivo" até
  21/10/2026)**: `M.GROUPS['INCENTIVO']` = CERVEJAS, INC HEINEKEN,
  INC EISENBAHN 600ML, INC HEINEKEN 600ML, CERVEJAS 600ML RETORNAVEL (CERVEJAS e CERVEJAS 600ML RETORNAVEL são os do ICS,
  como ARTD KO está no ICS e nos NN). As 3 chaves INC (`M.AGRUPADORES_INCENTIVO`: 'Heineken', 'Eisenbahn - 600ml',
  'Heineken - 600ml', igualdade exata após `normalizar`; '... Vr', '330ml', 'Zero', 'C/ Sol Ow' não entram) estão em
  `AGRUPADORES_COBERTURA` e em `AGRUPADORES_CONSULTA_VENDAS`, mas FORA de `AGRUPADORES_ORIGEM` (os 17: compras do mês,
  "qualquer compra hoje"/revertido da VZ, virada do mês), de ICS_GC/NOVOS_NEG/COV_GRUPO/`INDICADORES_COBERTURA` e do
  "rota tem meta" do ICS (`payload`: `tem_meta_cob`). Meta delas numa consulta À PARTE (`fontes.carregar_metas_incentivo`,
  só rota, agrupador e META_COBERTURA; `M.AGRUPADORES_METAS_INCENTIVO`): na consulta de metas de sempre (com META_VOLUME e
  META_NEG) o Datasphere dá HTTP 500 depois de ~150 s (20/10/2026); se só ela falhar, os itens ficam sem meta e o resto
  segue. Rota sem meta (ou meta 0) = `cobertura_indisponivel()` (meta e real null); COBERTOS, OPORTUNIDADES_DIA e
  online.json (`online_ks_tt` pelo payload) só nas rotas com meta; QUALQUER sem o incentivo (`payload.sem_incentivo`).
  No nó, as 3 chaves INC vêm depois dos 5 macros (`M.ORDEM_INDICADORES`) e o volume extra continua no fim.
  `validacao._incentivo`: aviso só para item sem meta em nenhuma rota da BAND (gerência BARRACUDA não avisa).
  Front (`app.js`, seção "aba Todos a Bordo"; só o texto exibido mudou, chaves INCENTIVO/INC*/INCENTIVO_ATIVO iguais):
  os 5 cards SÃO os do ICS GC (`cardIncItem` = `linha(k, agrega(rs).ind[k], rs)` com `rs = rotasInc(k, rotas)`, só as
  rotas com meta, `temMetaInc`; `agrega()` soma também as chaves de `GROUPS.INCENTIVO`, mesma conta das coberturas):
  % = Real/Meta com a régua do ritmo, "faltam X hoje", oportunidades, caixa Online e "Meta batida!" do ICS; sem EF nem
  "real + hoje". Sem meta no escopo: "Exclusivo portfólio Full" (INC HEINEKEN/INC HEINEKEN 600ML) ou "Sem meta".
  Cascata = a do ICS com `CASC.inc` (`abreIncentivo` → `pintaCascata`, `metricas`/`notaVirtuais(k, gc, inc)` só nas
  rotas com meta; grupos sem meta fora; "· n com meta"). Não há card "Status" (removido em 21/10/2026). Card do topo
  "x / n itens em 100%" + linha "Status" (`itensEm100`/`linhaStatus`, `#stRitmo`): "-" com x < n, "✓" verde com
  x = n > 0, sem a linha com n = 0; item em 100% = Real >= Meta; `CONFIG.STATUS_INCLUI_ONLINE` (false) = também pela
  união Real ou online de hoje (`realMaisOnline`; nunca no fechamento). A mesma linha em Novos Negócios (contagem e
  texto do "ritmo de coberturas" iguais); ICS GC e Volume sem ela. `CONFIG.INCENTIVO_ATIVO` e `GROUPS.INCENTIVO` no
  payload decidem se a aba aparece.
  Conferido em 20/10/2026 (`gerar.py --saida` fora do repo): meta e nº de rotas com meta iguais à E8c nos 5 itens
  (15.992/213, 6.273/81, 460/182, 2.871/81, 4.732/182); payload 6,54 MB; gerar.py 84 s.
- **Front**: Diretoria: filtro "Todas as gerências" ou uma delas (`sel.dgc`, separado do `sel.gc` da Gerência; volta
  para "Todas" ao reabrir a Diretoria). Cards abrem a cascata única (`abreIndicador` → `pintaCascata`): gerências →
  supervisões → rotas → clientes; com uma gerência no filtro da Diretoria, começa nas supervisões dela
  (`ctxGerencia`), como na Gerência. Linhas com os números de `agrega()` (nada recalculado), em **ordem fixa pelo
  código** (`gruposDo`; também no fechamento): gerências na ordem de `GC_NOMES`/`GC_ATIVAS`, supervisões e rotas em
  ordem natural (`ordemNatural`: SV.G1.2 antes de SV.G1.10; `svsEmOrdem`: num grupo, gerência -> número),
  "Neutraliza" por último; virtuais e '-EV' nunca em lista (`ehVirtual` inclui `EVENTUAIS_ROTAS`); clientes de
  volume pela Dif. Abs. **"Meta batida!"** (em `caixaOnline` e `linhaGrupo`) troca o rótulo da caixa do Online e a
  deixa verde: volume (`metaBatida`) com a meta do dia do nível, já somada, <= 0 (resíduo de decimais conta como 0);
  coberturas ICS GC/Novos Negócios (`coberturaBatida`, pedido da Karen em 20/10/2026) com Real >= Meta do mês do nível
  (Meta > 0; a "meta do dia" da cobertura, gap ou fatia, nunca chega a 0 com meta). O número do online e todos os
  valores seguem iguais; metaDia > 0/null, meta 0, Venda Zero, fechamento e o Resumo de vendas como antes.
  Resumo segue o filtro (Diretoria "Todas": as 16 em faixas de 8; uma gerência: gerência + supervisões; grupo no
  Total: total + as duas; sem seletor próprio); placa ATENÇÃO só com `CONFIG.LIMIAR_ATENCAO` (null = desligada). Del Valle Frut continua fora
  da Diretoria, mesmo com uma gerência. Rodapé: "Karen Oliveira - Inteligência de Mercado".
- **Decisões aceitas** (diferem do arquivo antigo, montado à mão): visitas de hoje pelo campo `VISITA_HOJE` do SAP.
- **Semana**: `SEMANA_NUM` conta a partir da 1ª segunda-feira do mês; dias antes dela são da última semana do mês anterior.
- O gerador só grava quando o conteúdo muda (JSON compacto e determinístico) e não grava nada se `validacao.py` reprovar.
- `backend/tests/dados/*_ref.json` é uma amostra congelada do payload manual (16 rotas): não regenerar a partir de `frontend/data`.

## GitHub e segurança

- Repo `AcompanamentosRota/Desempenho_Rotas` (conta pessoal, público; remote `rotas`). Operar com a conta **LuanAlves2**
  (tem push, não admin); `GH_TOKEN=$(gh auth token --user LuanAlves2) gh ...`, também para `git push`.
  Secrets, Variables e a fonte do Pages só o dono do repo altera.
- Repo anterior: `karenoliveiragyn2-stack/desempenho` (remote `upstream`; `origin` é o fork LuanAlves2/desempenho).
  Lá o Pages já está em "GitHub Actions" e os dados se atualizam sozinhos (PRs #1-#3 aceitos até 15/10/2026).
- Commits feitos com `GITHUB_TOKEN` não disparam workflows: `atualizar-dados.yml` chama `deploy-pages.yml` via `workflow_call`.
- Nunca versionar `backend/.env`. Antes de commitar, verificar que nenhum arquivo contém o client ID/secret.
- Push que mexe em `.github/workflows/` exige o escopo `workflow` no token do `gh` (LuanAlves2 já tem).
- Pendências em 16/10/2026: PR `importa-desempenho` → `main` em `AcompanamentosRota/Desempenho_Rotas` aberto
  (o `main` de lá só tinha o envio manual de 09/10, sem histórico em comum; o branch une os dois com `merge -s ours`).
  Antes do merge o dono precisa cadastrar Secrets/Variables e trocar Pages para "GitHub Actions". Depois do merge:
  rodar "Atualizar dados" manualmente uma vez, conferir o site e parar uploads manuais na raiz. Com o novo no ar,
  desligar o "Atualizar dados" do repo anterior para não consultar o Datasphere em dobro.
