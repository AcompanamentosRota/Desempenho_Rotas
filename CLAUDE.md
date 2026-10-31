# CLAUDE.md — Desempenho de Rotas (Comercial Bandeirantes)

Painel estático (GitHub Pages) + gerador Python que lê o SAP Datasphere via OData.
Visão geral, variáveis de ambiente e passo a passo para humanos: `README.md`.

## Estrutura e comandos

- `frontend/`: site publicado. JS clássico (sem build, sem módulos ES): `config.js` → `nucleo.js` → `app.js` → `resumo.js` → `ritmo.js` → `main.js`,
  todos com `defer` e compartilhando globais (`P`, `DATA`, `sel`, `RS`, `RT`, `NUCLEO`...). Dados em `frontend/data/` (gerados, não editar à mão).
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
- E9 do conferir (`SEM_COMPRA_MES`): roda DEPOIS do gerar.py, sobre o payload.json que ele gravou
  (`conferir_tendencia.py --saida DIR --e9 DIR/payload.json [--e9-duracao S]`, sem rede, acrescentada ao relatório; o
  workflow "Conferir tendência" já chama). Por gerência: Σ tamanho das listas x Σ `semCompra`, rotas com divergência,
  `SEM_COMPRA_HOJE` contido, KB que a chave acrescenta (limite de atenção 8 MB) e tempo. Só contagens e códigos de rota.
- E10 do conferir (sempre, antes da seção 9; descoberta da Etapa 8, "Evolução contra o mês anterior"; `mes_anterior`):
  o mesmo dia útil no mês anterior ao de referência (`corte_mes_anterior`, desde a Etapa 8b em
  `backend/gerador/mes_anterior.py` com `consulta_volume`/`real_por_rota`/`meta_volume_por_rota`/`filtro_ate`; o
  conferir importa de lá: N = DIA_ONTEM limitado ao total do anterior; no fechamento, o anterior INTEIRO; data pelo
  calendário do Datasphere, sem as linhas do mês anterior pelo cálculo local; corte inclusive = véspera do dia útil N+1,
  com os dias não úteis logo depois do N). Até o corte (`DATA_MOVIMENTO le`,
  só no `$filter`): Vol Real (5 macros, status do Vol Real; por rota do cliente e da meta), META_NEG e cobertura (rota x
  cliente e só rota x agrupador; sem NF cancelada, `M.FILTRO_SEM_NF_CANCELADA`, como o gerador e a E8e desde
  26/10/2026), cada filtro conferido contra o mês inteiro e a curva diária BAND, com linhas e tempo.
  Amostra `E10_AMOSTRA` (G1 AP IT) + BAND e Refrigerantes por gerência, como o card (rota oculta das EV* com meta 0 nos
  macros com Real; cobertura só nas rotas com meta; KS TT). Custo no gerador (~64 s hoje) e peso da chave
  `MES_ANTERIOR` (com e sem coberturas), riscos (`DS_GERENCIA_COM_Chave_Meta_SAP` por mês;
  `CD_ROTA_Clien` = rota ATUAL do cliente) e as 7 decisões da Karen. Só relata; grava `e10_mes_anterior.json` (`ARQ_E10`,
  `resumo_e10`: corte, Vol Real da consulta direta por rota, EV* por gerência, curva até o corte, E10d) ao lado do
  relatório, para a E11. Como ler: README, "Mês anterior no mesmo dia útil"; testes: `test_mes_anterior.py` (Datasphere
  simulado `ConsultaE10`).
- E11 do conferir (`MES_ANTERIOR` do payload gerado; como a E9, depois do gerar.py, sem rede:
  `conferir_tendencia.py --saida DIR --e11 DIR/payload.json [--e9-duracao S] [--e11-tempo S] [--e11-espera S]`; o
  workflow chama no passo "E9 e E11" com `mes_anterior_s`/`mes_anterior_espera_s` do `GITHUB_OUTPUT` do gerar.py): Real de
  cada macro na chave x consulta direta da E10 (o que fica fora: sem indicador, EV* sem rota oculta, fora do painel;
  resíduo) x curva diária; Refrigerantes por gerência x E10d (chave e Real de hoje do payload); tamanho; tempo; rotas
  (null, EV*, total); caso (normal, limitado, fechamento). Só contagens e códigos de rota. Testes:
  `test_mes_anterior_payload.py` (o sintético do front + setembro/26 pelo `ConsultaE10`).
- Front local: `cd frontend && python -m http.server 8765`.
- **Versão do código e aviso de versão nova** (README, "Versão do código e aviso de versão nova"): versão = hash de 12
  caracteres de `frontend/` sem `frontend/data/**` (`.github/scripts/versao-front.sh`; nunca o SHA do commit: com só os
  dados mudando, a versão não muda e o aviso não aparece). O `deploy-pages.yml` (push e `workflow_call`, mesmo passo)
  roda `versao-front.sh --gravar frontend` antes do upload: grava `versao.json` e troca `<meta name="versao"
  content="dev">` do index.html (nada commitado; local e testes = "dev" = aviso desligado, sem pedir o versao.json).
  Front (`app.js`, seção "versão nova do código"; `aoVoltar` em main.js): `confereVersao` (no-store + `?t=`; falha/404
  = silêncio) em todo `puxaOnline`, no `visibilitychange` visível e no `pageshow`; ao voltar também o online já e o
  payload se `P._versao` tiver mais de `PAYLOAD_POLL_MS` (uma vez só se os dois eventos vierem juntos). Faixa `#aviso`
  acima do `.topo` (no fluxo; no PC, no alto do conteúdo, à direita do painel lateral; escondida com `body.na-entrada`;
  `.branca` pelo fundo da entrada): "Depois" adia aquela
  versão até a 1ª verificação após `CONFIG.VERSAO_ADIA_MS` (30 min). `#btnRecarga` (↻, "Atualizar o painel", em
  `.topoBtns` com a casa, sempre visível; no PC no rodapé do painel lateral) e "Atualizar" = `atualizaPainel`: fetch `cache:'reload'` da própria URL, CSS,
  JS, manifest, versao.json e os dois JSONs; falha = "Sem conexão. Tente de novo." sem reload; sucesso = `location.reload()`;
  nunca apaga `localStorage`. Testes: Partes P (script) e Q (`abreVersao`) do front.test.js.
- Testes de front (Chromium headless + dado sintético gerado pelo próprio back-end): `node --test frontend/tests/front.test.js`
  (precisa de Python com as dependências do back-end e do pacote `playwright`; sem ele os testes são pulados; o CI não roda).
  O teste chama `python3` (no Windows, ponha um `python3.exe` do venv no PATH) e acha o `playwright` por `NODE_PATH`.
  `abre(nome, {entrar})` entra pela tela de entrada clicando na caixa de seleção (`entra()`: 'gc' = primeira gerência
  com dados, 'dir' = Diretoria, ou {perfil, gc, sv, rota}, com gc = sigla ou grupo 'IT+MO'; a sigla de uma gerência
  agrupada escolhe o grupo); `vaiPara()` = casa + `entra()`; relógio simulado por `antes: p => p.clock...`.
  Desde a Etapa 5 o painel abre na Executiva (Rota: Volume) a cada entrada: `abre(nome, {aba})`, `entra(page, e, aba)` e
  `vaiPara(page, e, aba)` vão para `aba` depois de entrar (padrão 'ICS_GC', a aba inicial de antes, de onde os testes
  antigos partem; `null` = fica na aba inicial do perfil); a Parte L passa 'INCENTIVO'. `esperaCarga` aceita os cards
  ou a Executiva desenhada (`#exGauges`).
  Variantes do payload montadas no próprio teste: 'grupo' (IT+MO com a virtual I32 e a eventual MO-EV), 'evcob'
  (o 'inc' com cobertura na SL-EV e uma AP-EV só com Heineken; Parte B), 'semdados'
  (G3 e PA sem dados), 'semsv', 'antigo', 'inc'/'incfech' (cenários da aba Todos a Bordo, `montaIncentivo`), 'seminc'
  (payload sem o grupo INCENTIVO), 'semscm' (payload sem SEM_COMPRA_MES; Parte S), 'grande' (16 gerências, a DI
  copiada da PA, e números de 6-7 dígitos; PDF do Resumo, `montaGrande`), 'exec' (o 'inc' com clientes sem compra no
  mês, `montaSemCompra`: o sintético compra tudo; Parte W) e 'dias'/'diasscm' (o 'exec' com dias de visita "Seg - Qui",
  "Ter" e "Qua - Sex" por rota, `montaDias`; o 2º sem SEM_COMPRA_MES; Parte X e o cenário "barra de dias" da Parte N) e
  'vol5'/'vol5fech' (o 'exec'/'incfech' com os 5 macros de volume com dado, `montaVolume5`, + `montaMesAnterior`; Parte AA) e 'sab'/'dom'/'fer'/'semdsem'/'util0' (o 'vol5' com a meta do dia 0 em todas as rotas e
  DIA_ONTEM = DIA_HOJE, DIA_SEMANA Sábado/Domingo/Quarta-feira/sem a chave; 'util0' = dia útil; Parte AL). PDF real (Parte O) só com os pacotes npm `html2canvas@1.4.1` e `jspdf@2.5.1` achados por
  `require.resolve` (local, `NODE_PATH` ou global); sem eles, pulado. `abre(nome, {troca})` troca o conteúdo de um arquivo servido (ex.: config.js;
  a Parte N serve o CSS e o app.js do 0a59eb4 assim).
- Conferência da Executiva com DADO REAL (sob demanda, fora do CI): `PAYLOAD_REAL=/tmp/real/payload.json
  ONLINE_REAL=/tmp/real/online.json node --test frontend/tests/conferencia_real.test.js` (os JSONs = `git show
  origin/main:frontend/data/...` copiados FORA do repo; sem as variáveis, pula). Diretoria, cada gerência, cada grupo no
  Total e uma supervisão; invariantes em `frontend/tests/executiva_invariantes.js` (as mesmas da Parte W); imprime uma
  tabela-resumo só de totais e códigos. Gavetas com barra de dias (Etapa 6): Diretoria, G1, G2, AP, IT+MO e uma
  supervisão (cada chip x recontagem e x cards, `frontend/tests/gavetas_invariantes.js`, as mesmas da Parte X) e cada
  unidade dessas gerências (Hoje e Todos x cards); sem rolagem lateral nem erro em 360/390/1000/1440 px nos dois fundos.
  Evolução contra o mês anterior (Etapa 8c; barras pareadas): Diretoria, cada gerência, cada grupo no Total e uma supervisão, em
  1440 e 390 px, com as categorias abertas (`frontend/tests/evolucao_invariantes.js`, as mesmas da Parte Z; pula sem
  `MES_ANTERIOR`); e o antes x depois contra o front do `7674ca2` (main antes do redesenho) com o mesmo payload: Executiva
  sem o `#exEvo`, cabeçalho e cards das 4 abas, cascata e Resumo iguais (HTML).
  Ajuste de rótulos: Diretoria, G1, IT+MO, a 1ª supervisão e a 1ª rota da G2, em 1440 e 390 px nos dois fundos, e o antes x
  depois contra o front do `20728ac` com o mesmo payload (`frontend/tests/rotulos_invariantes.js`, as mesmas da Parte AA).
  Gaveta "Categoria por unidade": Diretoria, cada gerência, cada grupo no Total e uma supervisão, nas 5 categorias
  (`frontend/tests/categoria_invariantes.js`, as mesmas da Parte AC; tabela por escopo e categoria); 360/390/1000/1440 px nos
  dois fundos sem corte nem rolagem lateral; e o antes x depois contra o front do `ec60a88` com o mesmo payload (Executiva,
  abas, cascata, Base, Sem compra e Resumo iguais).
  Tabela da categoria e escopo do nível acima (Etapa 6 do pacote v3): Gerência em BAND = Diretoria "Todas" (cada opção da
  entrada) e Supervisão em GC = Gerência (a 1ª supervisão de cada gerência), `#exec` com o mesmo HTML; a tabela (invariantes
  da Parte AC, `categoria_invariantes.js`) no escopo de cima; Volume no acesso; 360/390/1000/1440 px nos dois fundos; antes x
  depois contra `7e88b8a` (`REF_PRE_ESC`: Executiva no escopo do acesso, cabeçalho fixo sem o `#exEsc`, cards, cascata e Resumo).
  Cascata com Dif (Real + Online) (Etapa 3 do pacote v3): Diretoria, uma gerência (filtro), IT+MO e uma supervisão em 1440 e
  390 px, invariantes (a)-(e) e (g) em `frontend/tests/cascata_invariantes.js` (as mesmas da Parte AG), ordenação, (f) card da
  Gerência G1 = Dif da linha GC.G1 da Diretoria; 360/390/1000/1440 px nos dois fundos; antes x depois contra `515b1e9`.
  Botão "Clientes" (Etapa 4 do pacote v3): Diretoria, a 1ª gerência, uma supervisão e uma rota, nas 4 abas e cada agrupador
  (`frontend/tests/clientes_invariantes.js`, as mesmas da Parte AH; config.js servido com `semLimite`, pois `CONFIG` é
  congelado); 360/390/1000/1440 px; antes x depois contra `9364d62` (`REF_PRE_CLI`).
  "Abrir por" e busca da Executiva (Etapa 5 do pacote v3): Diretoria, cada gerência, cada grupo no Total e uma supervisão em
  1440 e 390 px (`frontend/tests/dimensoes_invariantes.js`, as mesmas da Parte AI; tabela do % da meta oficial por escopo e
  categoria); (a) modo padrão contra `0f6fbfe` (`REF_PRE_ABRIR`) com o mesmo payload; 360/390/1000/1440 px em cada modo.
  Resumo, bloco Todos a Bordo: Diretoria, cada gerência, cada grupo no Total e uma supervisão, em 1440 e 390 px
  (`frontend/tests/resumo_tab_invariantes.js`, as mesmas da Parte AF; tabela por escopo com bloco / card / online de cada item);
  e o antes x depois contra o front do `9f82f15` com o mesmo payload (Resumo sem o bloco, Executiva, cards e cascata iguais).
  "Faltam" do medidor com o online (30/10/2026): a conta, o online (= `.gDia` = caixa Online do card) e o Faltam do total da
  gaveta em `confereExecutiva` (Diretoria, cada gerência, cada grupo, uma supervisão; tabela Meta | Real | Online | faltam
  antigo | novo); antes x depois contra `1af3c6d` (`REF_PRE_FALTA`: só a `.gFalta` muda; gavetas da categoria, abas, cascata e
  Resumo iguais); 360/390/1000/1440 px nos dois fundos sem rolagem lateral nem `.gFalta` cortada.
- Nesta máquina o Python do sistema não tem `python-dotenv`/`pytest`; use
  `C:\Users\luan.arantes\Documents\Teste_ODATA\.venv\Scripts\python.exe` para rodar o back-end.
  Chamadas de rede exigem desabilitar o sandbox.

## Regras que não são óbvias

- **Contrato com o front**: `payload.json`/`online.json` têm o formato exato que `frontend/js/main.js` e `app.js` leem.
  `SEGS` e `DIAS` são tabelas de índice (cada cliente guarda a posição): só acrescentar no fim.
  `EVENTUAIS_ROTAS` (rotas ocultas dos clientes em EV*) é chave obrigatória desde 20/10/2026.
  Fórmulas em `backend/gerador/modelo.py` espelham `NUCLEO.agrega` em `nucleo.js` (o `agrega()` do app.js só o chama com os
  campos de hoje); mudou um, mude o outro. `nucleo.js` é puro (payload por parâmetro, sem DOM nem ONLINE) e só expõe
  `NUCLEO` (o app.js do 0a59eb4, servido na Parte N, declara `INVERTED`, `titulo`, `ordemNatural`: não redeclarar).
  `DATA_ONTEM` (AAAA-MM-DD do último dia útil fechado, o dia útil DIA_ONTEM do mês de referência: calendário do
  Datasphere, 1º dia de semana com NO_DIA_UTIL = DIA_ONTEM; sem a linha, o último dia útil local antes de hoje) e
  `DIA_ONTEM_NOME` ("sexta-feira") são chaves novas opcionais no fim do payload (null se não houver; fora da validação).
  `SEM_COMPRA_MES` (Etapa 1 do pacote da Executiva, 21/10/2026): `{rota: [PVs]}` = clientes do roster sem compra no mês
  (`sorted(pvs_roster - comprou)`, o mesmo `comprou` do `semCompra` e do `SEM_COMPRA_HOJE`; no fechamento, do mês
  fechado), `None` na rota sem dado; mesmas rotas e ordem do `SEM_COMPRA_HOJE` (`por_ordem`; Neutraliza, virtuais e as
  ocultas das EV* como ele; o front esconde). Chave opcional, a última antes da `MES_ANTERIOR`, fora de `CHAVES_PAYLOAD`;
  `validacao._sem_compra_mes` só AVISA (tamanho ≠ `semCompra` ou `SEM_COMPRA_HOJE` fora). O front lê `P.SEM_COMPRA_MES`
  só na gaveta Sem compra fora do "Hoje" (Etapa 6, `abreSemCompra`); payload sem ela (antigo) = gaveta só no "Hoje", sem a
  barra (Partes S e X dos testes).
  Peso no payload real de 21/10 (4.631 clientes em 231 rotas): +39 KB (6,60 → 6,63 MB); pior caso (base inteira, ~29 mil)
  ~+0,24 MB.
  `MES_ANTERIOR` (Etapa 8b, 21/10/2026; `gerador/mes_anterior.py`, README "Chave MES_ANTERIOR"): o mês anterior no mesmo
  dia útil, SÓ Volume (decisões da Karen de 21/10: dia útil = DIA_ONTEM limitado ao total do anterior; fechamento x
  fechamento = o anterior INTEIRO, `FECHADO: true`; Real pela rota ATUAL do cliente na gerência de hoje, EV* na rota
  oculta "{GC}-EV" com meta 0; meta = a do mês anterior inteiro, META_VOLUME da rota da meta, sem ela META_NEG; só os 5
  macros: sem coberturas, INC, Del Valle Frut, Imperdoáveis e Venda Zero). `{MES_LABEL, DIA_UTIL, TOTAL_DIAS_UTEIS,
  DATA_CORTE, FECHADO, IND, ROTAS: {rota: [[real, meta] | null x 5]}}`, todas as rotas do payload na ordem dele; null =
  sem o indicador no mês anterior (o Real não entra). Chave opcional, a ÚLTIMA do payload, fora de `CHAVES_PAYLOAD`;
  DIA_ONTEM = 0 = sem a chave. Consultas em threads DAEMON (`mes_anterior.Carga`, nunca ThreadPoolExecutor: ele segura o
  fim do processo) junto com as do mês; falha, > `M.MES_ANTERIOR_LIMITE_S` (60 s), Real negativo ou não finito = chave
  fora + aviso, nunca reprova. `validacao._mes_anterior`: aviso (ausente com DIA_ONTEM > 0, Real BAND 0, meta negativa),
  erro só NaN/inf ou Real negativo. O front lê desde a Etapa 8c (bloco "Evolução contra o mês anterior" da Executiva).
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
  - **NF cancelada não é venda** (decisão de 26/10/2026): a consulta de vendas tem `M.FILTRO_SEM_NF_CANCELADA`
    (`NF_STATUS_Nota_Fiscal ne 'Cancelada' or ... eq null`) no `$filter`: fora da cobertura do mês (todos os
    indicadores) e das compras do mês (Base/Sem compra, `SEM_COMPRA_MES`). Toda linha tem status ('Acertado', 'Em
    Aberto', 'Cancelada', 'Meta NEG', 'WF Online'): online e meta por cliente continuam. Nunca o status no `$select`
    dessa consulta (+66% de linhas, 29 → 53 s em 26/10). O Vol Real já ficava só com `M.STATUS_NF_REAL`. Medição de
    26/10/2026 (dia útil 17): as 19.473 linhas canceladas tinham cobertura > 0; sem elas, de −2 a −6 pontos por item na
    BAND (4.113 clientes a menos no ICS GC + NN) e Sem compra 3.691 → 4.065.
  - `META_DIA` (meta do dia antiga) não é mais usada pelo gerador; só o `conferir_tendencia.py` a lê para comparar.
  - Meta de volume por cliente = `META_NEG` por `CD_CLIENTE` × `DS_AGRUPADOR_Agrupador_Prod`.
  - Venda Zero: `Concluído(Contrato)` + `AGRUPADOR_EQPTO = 'Total Ko'` + Fountain + `Giro Zero`, deduplicando por
    `CD_EQUIPAMENTO_Equipame`. A meta só existe por gerência; o gerador rateia pelas rotas pela quantidade de geladeiras.
- **KS TT: Real e Online filtrados pelos 4 segmentos; meta sem filtro** (`M.SEGMENTOS_KS_TT`).
  A cobertura de todos os indicadores conta para a rota da venda, mesmo de cliente transferido ou desativado
  (sem filtro de roster). Segmento: o da base (roster da rota); para quem saiu dela, `DS_SEGMENTO_Clien` da venda.
  O filtro fica em `payload.py` (`_filtra_ks_tt`, `online_ks_tt`), então o front recebe tudo pronto. O `QUALQUER`
  do online não é filtrado. `validacao.py` reprova KS TT com cliente da base de segmento não elegível; real > `baseKsTt`
  só gera aviso (clientes que saíram da rota; nunca nas rotas ocultas das EV*, que não têm base).
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
  (com hoje) / dias úteis do mês; sem META_VOLUME → Meta e restante = somas de META_NEG; nenhuma → indisponível,
  exceto com Real ≠ 0 (1 casa) nos 5 macros (decisão de 27/10/2026, como o SAC soma): meta 0, Neg Restante 0, tendência = Real
  (`modelo.SEM_META`, aviso "Real sem META_VOLUME nem META_NEG"; também no `MES_ANTERIOR`: [Real, 0]). Em 27/10: R31
  (Neutraliza RV) Cervejas 605 cx, T07 (G3) DAC 3,2 e Cerv 0,3. No front, o card da rota sozinha mostra Meta 0 e "—".
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
  log). Meta 0, sem Neg Restante (tendência = Real), meta do dia 0, sem clientes; fora da Venda Zero e do online.
  **Só as vendas com rota da meta** (decisão de 27/10/2026, Flash de Vendas do SAC): venda em rota EV* com
  `CD_ROTA_Chave_Meta_SAP` '--'/vazia (sem chave de meta; quase só `DS_COD_OPER_Nota_Fiscal` = 'Venda A Consumidor
  Final', ex.: EVF = venda a funcionário da G3) fica fora do Real, como o SAC (`fontes.sem_rota_da_meta`; `META_ROTA`
  opcional na consulta do Vol Real e no `mes_anterior.consulta_volume`; sem a coluna, entra tudo com aviso; log "Vol Real
  de rotas EV* sem rota da meta" por gerência e rota). Rotas normais não mudam: todas as vendas delas têm chave (27/10).
  Medição de 27/10: o SAC bate somando por `DS_GERENCIA_COM_Chave_Meta_SAP` (= esta regra; |dif| ≤ 0,5 cx nas 16 x 5
  macros); saíram Refri 442, Cerv 27, Água 1.478, Still 117, DAC 49 cx (G3 124/15/627/66/45; AN 176/4/420; SL Água
  264; DI 63/0/24); ficam só AP EV5 e G2 EV1 (com chave de meta). A cobertura das EV* (abaixo) não mudou.
  **Cobertura** (decisão de 26/10/2026): os clientes cobertos deles também entram, na mesma rota oculta, no ICS GC, em
  Novos Negócios e no Todos a Bordo (`carregar_vendas` lê `GC_COMERCIAL`, coluna opcional, e junta em
  `cobertos[M.rota_eventuais(gc)]`; `carregar` cria a rota oculta também sem Vol Real; `modelo.cobertura_eventuais`:
  meta 0 e o Real nos itens com cliente coberto, os demais indisponíveis; KS TT pelo segmento da venda). Todos a Bordo:
  o gerador só preenche o item na oculta da gerência que tem rota com meta dele (`payload.inc_da_gc`: nas BARRACUDA a
  Heineken dos clientes EV* fica fora, e a Diretoria fecha com as linhas das gerências) e o front a soma só junto das
  rotas com meta do item (`rotasInc`; escopo sem meta continua "Sem meta"/"Exclusivo portfólio Full"). Medição de
  26/10: +168 clientes no ICS GC + NN da BAND (G3 +84, IT +23); Heineken +21, Heineken 600ml +11. Payload: em
  `VIRTUAIS_ROTAS` (o front esconde como virtual, também o front antigo em cache) e em `EVENTUAIS_ROTAS` (chave nova,
  obrigatória na validação); na cascata, nota "Inclui clientes de rotas eventuais (EV*): Real X" (`notaVirtuais`, também
  nas coberturas). A validação não conta essas rotas na disponibilidade de cobertura nem nas quedas de rotas.
  Outras rotas fora do painel (SV.BL.*, APE...) continuam fora (em 20/10 não tinham diferença contra o SAC).
  Neutraliza já entrava inteira no total da gerência e da Diretoria (volume e cobertura; conferido em 26/10).
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
  `frontend/data/*.json`; aviso no README e em `config.js`; nada de usuário; senha só na Diretoria): DIRETORIA abre a
  mesma caixa (`pintaSenha`: campo `#entSenha` type=password, "Entrar", "← Voltar" fecha, `#entSenhaMsg` role=alert;
  `confereSenha`) e entra em "Todas as gerências" com uma das DUAS senhas; GERÊNCIA, SUPERVISÃO e ROTA abrem a caixa de seleção (`#entCaixa`: `abreCaixa` /
  `pintaCaixa`, diálogo com foco, Tab preso, setas, ESC, × e clique fora). 1ª etapa (`opcoesGc`): as 16 na ordem de
  `GC_NOMES`/`GC_ATIVAS` com os grupos de `CONFIG.GC_GRUPOS` (PA+DI, GU+PO, IT+MO, UR+RI, os pares que o Datasphere
  junta) numa opção só, na posição do 1º membro; sem dados = desabilitada (grupo: se nenhuma das duas tiver).
  **Gerências liberadas** (pedido da Karen, 27/10/2026, "por enquanto"): `CONFIG.GC_LIBERADAS` = G1 G2 G3 AP IT MO
  (`gcLiberada`: grupo só com as duas na lista; null = todas); fora dela, desabilitada com "· em breve" (antes do
  "· sem dados") e `validaAcesso` recusa (acesso guardado volta para a entrada). A Diretoria (`fgc`) vê todas. Os
  testes servem o config.js com todas liberadas (`trocaLiberadas` em senha_teste.js; `abre(nome, {liberadas})`:
  'config' = a lista real; Parte AD). 2ª etapa
  (Supervisão e Rota): `svsDaEntrada`/`rotasDaEntrada` da gerência (no grupo, das duas, por gerência), só o que
  aparece no painel (`svNoPainel`: sem SV.G3.3 nem "Neutraliza"; `rotaNoPainel`: Neutraliza sim, virtual e '-EV' não).
  Grupo = "gerência" com a chave 'IT+MO': `membrosGc`/`ehGrupo`/`temDados`, e `rotasDe`, `svsDe`, `svsVisiveis`,
  `rotasNeutraliza`, `ctxGerencia`, `ctxNeutraliza`, `notaVirtuais`, `rotuloGc` aceitam a chave (rotas das duas; uma
  linha "Neutraliza"). Na Gerência de um grupo, `sel.gc` = chave (Total) ou uma das duas; `fgc` só com "Total (GC.IT +
  GC.MO)" e as duas (`grupoDoFiltro`); Resumo do Total = total + as duas lado a lado (`colunas()` em resumo.js).
  `validaAcesso` (caixa, reabertura e payload novo): Gerência = uma opção da caixa liberada e com dados (`opcaoValida`; a
  MO sozinha não vale); Supervisão/Rota = gerência (ou grupo) liberada, com dados e sv/rota no painel de uma delas, devolvendo a
  gerência da sv/rota. Os perfis Gerência, Supervisão e Rota usam o modo 'gc' com parte do filtro travada (`ACESSO`;
  `montaFiltros` esconde os selects; Rota sem Resumo). Acesso em `localStorage 'drotas_sessao'` {perfil, gc, sv, rota,
  dia} (no grupo, gc = 'IT+MO'; Supervisão/Rota guardam a gerência delas): `entradaOuAcesso()` ao carregar (atrás da
  tela `#carga`, para não piscar a entrada; grupo reabre no Total) e ao fechar um Resumo aberto por link; `dia` = dia
  de trabalho em America/Sao_Paulo com virada às `CONFIG.SESSAO_VIRADA_HORA` (5h), conferido também em `puxaOnline` e
  no `visibilitychange` (`confereDia`); payload novo revalida (`confereAcesso`; no grupo, a escolha do seletor fica
  enquanto tiver dados). A casa apaga o acesso. Link `?resumo=` (também `gc=IT%2BMO`) não lê nem grava o acesso.
  Sol/lua só no fundo da entrada (`'drotas_entrada'`, à parte).
  Dentro da aba Executiva, Gerência e Supervisão têm o botão de escopo do nível acima (BAND / GC; Etapa 6 do pacote v3, ver
  "Escopo do nível acima" abaixo): nunca muda a entrada, o `sel`, a sessão guardada nem a validação.
  **Senha da Diretoria (22/10/2026; README, "Senha da Diretoria")**: AS SENHAS NUNCA FICAM EM TEXTO NO REPOSITÓRIO
  (código, testes, documentos, commits, PR). `CONFIG.DIRETORIA_SENHAS_HASH` = só os 2 hashes: SHA-256 hex minúsculo de
  "drotas:" + senha com trim e `toUpperCase()`, UTF-8 (`normalizaSenha`/`hashSenha`, `crypto.subtle` + `TextEncoder`).
  Errada/vazia/só espaços: "Senha incorreta", campo limpo, foco nele. Sem `crypto.subtle` (`temCripto`): "Abra o painel
  pelo endereço seguro (https)", não entra. Sessão com `v: SESSAO_VERSAO` (2; `gravaSessao`); `entradaOuAcesso`
  descarta Diretoria sem `v: 2` com "Digite a senha para entrar na Diretoria" (`MSG_ENTRADA.senha`); Gerência,
  Supervisão e Rota antigas valem. Recarregar no mesmo dia não pede a senha; casa e virada das 05:00 pedem. Testes:
  senhas FICTÍCIAS em `frontend/tests/senha_teste.js` (`trocaHash` troca os hashes no config.js servido, em `abre()` dos
  dois arquivos de teste; `digitaSenha` no `entra()`; front antigo sem senha passa direto); Parte AB.
  **Nome na Diretoria (29/10/2026)**: `CONFIG.DIRETORIA_NOMES` = mapa hash → nome (os mesmos hashes; nunca a senha).
  `confereSenha` acha o nome pelo hash já calculado → `entraCom({perfil:'dir', quem})`; `validaAcesso` devolve `quem` só se
  for um nome do mapa (`nomeDiretoria`); `gravaSessao` guarda `quem` (só o nome). `#sub`: "Diretoria · nome" (a gerência do
  seletor em `.subDgc`); `#sub.comQuem`: no celular o escopo aparece ("Diretoria · nome", sem `.subDgc`); sem nome, como
  antes. Testes: `trocaNomes`/`NOMES_TESTE` (nomes fictícios; `abre(nome, {nomes})`, padrão {} = nenhum nome); Parte AE.
  **Logos da entrada (Etapa 7, 21/10/2026; no lugar da linha `.entMarca`)**: `.entLogos` acima do `#entTit` = logo
  Coca-Cola Bandeirantes (`.entCoca`, 62 px; 52 px em <= 380 px; `alt="Coca-Cola Bandeirantes"`) | `.entSep` (1,5 x 64 px,
  `--vermelho`, `aria-hidden`) | `.entElmo` (`role="img"` + `aria-label="Comercial Bandeirantes"`: elmo 40/34 px com
  `alt=""` e `.entElmoTxt` "COMERCIAL"/"BANDEIRANTES", Inter 800, `--fs-ent-marca` 9,5 px, line-height 1.08, .015em;
  `#fff` no fundo preto, `--preto` no branco). Cada imagem tem as duas versões no HTML com `data-tema="preta"|"branca"`
  (o valor de `temaEntrada()`) e o CSS esconde a do outro fundo: o sol/lua troca as imagens sem JavaScript novo (nunca
  trocar `src` nem usar `filter` nas logos). PNG em `frontend/assets/` (do pacote, mesmas dimensões: 560x251 e 140x263;
  coca em paleta de 256 cores, elmo sem perda). Aba inicial (Etapa 5): Executiva para Diretoria, Gerência e Supervisão;
  Volume para a Rota (`aplicaAcesso` → `marcaAba`, a cada entrada e ao reabrir o acesso guardado; payload novo não
  muda a aba). Testes: Parte Y.
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
  rotas com meta, `temMetaInc`, e junto delas a oculta das EV* com cliente coberto; `agrega()` soma também as chaves
  de `GROUPS.INCENTIVO`, mesma conta das coberturas):
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
  **"Sem meta do dia" em dia não útil (31/10/2026, decisão da Karen; README, "Sem meta do dia em dia não útil"; só front)**:
  meta do dia <= 0 em dia ÚTIL = "Meta batida!"; em dia NÃO útil (`semDiaUtil()` = `!P.FECHAMENTO && P.DIA_HOJE ===
  P.DIA_ONTEM`: o calendário só iguala os dois com `eh_dia_util=False`, `calendario.montar`; o SAP não tem o dia e a meta do
  dia vem 0) o volume mostra `rotuloSemMetaDia()` ("sem meta do dia · sábado|domingo|feriado" por `diaNaoUtil()` sobre o
  `DIA_SEMANA` sem acento; sem ele, "sem meta do dia"; `rotuloSemMetaDia(true)` = forma curta) com a cor NEUTRA (`nd`) em cinco
  lugares, só com metaDia não nula: caixa Online do card (`caixaOnline`) e da cascata (`meioLinha`), `.gDia` do medidor
  ("… · online X"), `linhaCtHtml` (Online sem cor, tooltip "· sem meta do dia") e `textoMetaDia` ("hoje não é dia útil
  (sábado); não há meta do dia. Online de hoje: X."). `metaBatida`/`coberturaBatida` não mudam; nenhum número muda.
  Testes: Parte AL (variantes 'sab', 'dom', 'fer', 'semdsem', 'util0'; `semdia_teste.js`), as invariantes de executiva/
  cascata/categoria e, com dado real, o bloco "Sem meta do dia" do `conferencia_real.test.js` (payload de sábado `1f72a2b`:
  (a) e (b) contra `97a19db`, `REF_PRE_SEMDIA`; payload de dia útil `efb4f3a`: (c) idêntico).
  **Cascata com Dif (Real + Online) e cards com Real + online (Etapa 3 do pacote v3, 29/10/2026; README, "Cascata" e
  "Cards"; só front)**: `realOnline(k, rotas, b, onl)` é a conta ÚNICA (cards, cascata, selo): volume = `b.real` + online de
  hoje (`onl` já somado ou `onlineVol`); coberturas = `realMaisOnline` (clientes distintos no Real ou no online); null no
  fechamento, sem ONLINE, na Venda Zero e indisponível. Card (`linha()` → `linhaDif`): a
  "Diferença" é (Real + online de hoje) − Meta (pedido da Karen, 29/10/2026; antes havia uma 4ª linha "Real + online ±X", que
  saiu); com online o div leva `data-meta/real/ro` exatos (+ `data-vol` no volume); sem online (fechamento, sem ONLINE) = Real −
  Meta com o HTML de antes; a Venda Zero tem a linha própria de sempre. `difMostrada`/`sinal` só na Dif da cascata. Cascata (`linhaGrupo` → `linhaCascata` fora da VZ; a VZ fica com a linha de antes; `meioLinha` = a caixa do
  Online de sempre): Nome (+ `.cSelo` "✓ Meta batida", maiúsculas pelo CSS) | Meta · Real | % (`.cPct`: o `dir` de sempre,
  cor pelo `onPace`; "tendência"/"realizado"/"real da meta" só no celular) | Dif (`.cDif`: Real + online − Meta, "x% da meta
  com online"; "—" "sem online" / "sem online no fechamento") | Online · meta do dia; `data-onl/ro/dif/bat` exatos. Selo
  (`linhaBatida`, decisão B): Meta > 0 e (realOnline, ou Real sem ele) >= Meta. Ordem: padrão = `gruposDo` (código);
  `CASC.ord` {col: ''|'pct'|'dif'|'onl', dir}, `ordenaGrupos` (valores, depois sem valor, depois "Neutraliza"/sem dados, na
  ordem do código), `ordemCascata` (cabeçalho `.cOrd` >= 1000 px; chips `.cOrdCh` < 1000), vale enquanto a gaveta estiver
  aberta (novo `CASC` ao abrir). Diretoria: `gruposDo(ctx, k, true)` (só `pintaCascata`) dá à gerência o filho `{nivel:'cli',
  chave:g, gc:g, rotas, nome}` (GC > Clientes, em todas as abas); `unidadesExec` chama sem o 3º parâmetro (Executiva com as
  supervisões). Lista de clientes de volume: Cliente | Meta | Real (`VOLUME_CLIENTE[r][pv][i][1]`, só o faturado) | Online
  (`volCliOnline`, "—" no fechamento) | Dif. Abs | % (de `blocoVolCliente`, como antes). Testes: Parte AG
  (`cascata_invariantes.js`, também na conferência com dado real; antes x depois contra `515b1e9`, `REF_PRE_CASC`); os
  antes x depois antigos desfazem o que a etapa trocou com `desfazCasc` (Diferença do card de volta a Real − Meta pelos `data-*`, cascata/lista de
  antes; nos textos, `CABECALHO` e `TEXTOS_TELA_PAGINA` fazem o mesmo) e, na
  Diretoria, conferem só o 1º nível da cascata; testes que abriam as supervisões pela linha da gerência na Diretoria usam
  o filtro de gerência (`supervisoesNaDiretoria`).
  Resumo segue o filtro (Diretoria "Todas": as 16 em faixas de 8; uma gerência: gerência + supervisões; grupo no
  Total: total + as duas; sem seletor próprio); placa ATENÇÃO só com `CONFIG.LIMIAR_ATENCAO` (null = desligada). Del Valle Frut continua fora
  da Diretoria, mesmo com uma gerência. Rodapé do painel: "Karen Oliveira - Inteligência de Mercado" (`CONFIG.CREDITOS`);
  a folha do Resumo NÃO tem assinatura (sem `.rs-rod`, na tela e no PDF; desde 21/10/2026).
  **Bloco "Todos a Bordo 3.0" do Resumo (29/10/2026; README, "Bloco Todos a Bordo 3.0 do Resumo")**: `blocos.tab` (padrão
  false), botão `[data-rsb="tab"]` nos dois `.rsChips` depois de "Novos Neg." (`hidden` no HTML; `botoes()` no início de
  `RS.pinta` mostra só com `incentivoAtivo()` e desliga o bloco sem a aba; `ligado(k)` = marcado e, no `tab`, com a aba: conta
  no "pelo menos um bloco" e no link). `soma()` ganhou `s.t[k]` = a conta do ICS (`somaCob`: Meta, Real, Online, |COBERTOS ∪
  online|) só em `rotasInc(k, rotas)` da coluna; `tabela(linhas, todas, comVz, foco0, {dado:'t', rot:rotuloInd, cols})` com as
  colunas do bloco ICS (`ics[fi].cols`); célula = `celInd` (sem rota com meta: "—"). DECISÃO DA KAREN (29/10/2026): o % é o do
  ICS no Resumo, (Real ∪ Online) / Meta, NÃO o do card da aba (Real / Meta): a invariante é Meta/Real/Online do total = card e
  % = card só quando o online não traz cliente novo. `.rs-bloco[data-bloco="tab"]` (último bloco; nome com quebra de linha:
  `td.rs-nome{white-space:normal}`, senão "Cervejas 600ml Retornável" estoura os 150 px e o `encaixaPdf` alarga o PDF);
  `RS.colunas` exposto (só leitura, testes). `.rsChips` = uma coluna por botão (`grid-auto-flow:column`; `button[hidden]`
  some); no PC (>= 1000 px) os botões têm pelo menos a largura do texto (antes, a 1000 px, ficavam com ~12 px) e, com a
  `.rsBox` (container) até 1060 px de conteúdo (ex.: 1000 e 1280 px), rótulo + botões na 1ª linha e "Gerar resumo" + "Painel de
  ritmo" juntos na 2ª (a Parte R exige os dois lado a lado); a 1440 px, uma linha como antes.
  Link `?resumo=...,tab`. Testes: Parte AF (`resumo_tab_invariantes.js`, também em `conferencia_real.test.js`, com o antes x
  depois contra o `9f82f15`, `FRONT_PRE_TAB`).
  **Painel de Ritmo em PDF** (`ritmo.js`; botão `#btnRitmo` na barra do Resumo, ao lado do "Gerar resumo de vendas"):
  SÓ DADOS REAIS (payload; nunca ONLINE nem REVERTIDO_HOJE/OPORTUNIDADE_HOJE/SEM_COMPRA_HOJE/revertidoHoje/
  oportunidadeHoje/semDadoHoje). `montaRitmo(P, escopo)` é pura (Parte R a roda em vm com getters que lançam);
  `RT.escopoRitmo()` lê o filtro: Diretoria "Todas" = {tipo:'band'} (GC + SVs de cada gerência, ordem de GC_ATIVAS,
  `confirm("Exportar N páginas?")`); gerência/grupo (Total = as duas; uma delas = só ela) = {tipo:'gc'}; supervisão no
  filtro ou perfil Supervisão = {tipo:'sv'} (filtro "Neutraliza" = a gerência); perfil Rota = null (barra oculta).
  Colunas: o nível (NUCLEO.agrega das rotas, como os cards: no GC todas as rotas, com Neutraliza/virtuais/-EV/ocultas)
  + SVs visíveis sem as ocultas (página do GC) ou rotas normais (página da SV). Volume pela tendência (>= 100) e meta do
  dia ("Meta batida!" com <= 0); coberturas pelo `onPace` (PACE_ONTEM) com `NUCLEO.metaDiaCobertura` ("Meta dia N" /
  "faltam N", a conta da caixa dos cards; "Meta batida!" com Real >= Meta do mês); Venda Zero pelo `gap`: o N é o valor principal (seta + N, "reverter" embaixo, sem
  percentual; ▲ verde com 0, ▼ vermelho com N > 0; na SV/GC, o gap da agregação dos cards). Nome de coluna/título:
  primeiro nome capitalizado; "ROTA SEM VENDEDOR" (qualquer caixa) ou vazio = "Sem vendedor" (supervisor e consultor). "Puxando a média": coluna com menos
  coberturas no ritmo (pela QUANTIDADE x do "x / n", nunca pela proporção: 7/8 aponta antes de 8/10; empate no x: mais itens fora do ritmo,
  n - x, depois o menor código; sem linha se nenhuma coluna tem cobertura ou se todas têm x = n; travado na Parte R;
  caso real: SV.PA.1 com P11 8/8, P12 8/10, P15 8/10 aponta a P12). Página 1280x720,
  html2canvas escala 1.5, JPEG 0.85, uma por vez fora da tela (`.rt-palco`), progresso no botão ("Gerando i/n");
  bibliotecas e entrega por `RS.carregaScript`/`RS.salvaPdf`; arquivo `Painel_Ritmo_<BAND|G1|IT+MO|SV.G1.1>_AAAAMMDD.pdf`.
  Fechamento: botão desabilitado ("Indisponível durante o fechamento"). ~165 KB por página.
  **PDF do Resumo**: páginas = `RS.paginas(atomos, H0, altTotal)` (função pura; átomos = [cabeçalho, blocos...]
  medidos no clone do html2canvas). O cabeçalho (`.rs-cab` + `.rs-atencao`) nunca fica sozinho: é um átomo só com o
  1º `.rs-bloco` (do topo do cabeçalho à base do bloco); átomo mais alto que a página = página mais alta. Diretoria
  com Volume + ICS GC = 2 páginas (3 com Novos Negócios). Números no PDF: regras `#rsFolha.rs-pdf` no fim do
  `app.css` fixam os tamanhos (os da tela de 1000-1599 px, em qualquer aparelho) com menos folga; `encaixaPdf`
  (resumo.js) encaixa a fonte do número (`encaixa()`, mínimo 10 px) e, se ainda faltar, alarga W; `limpaPdf` desfaz.
  Nada disso muda a tela do Resumo (Parte O dos testes compara com o CSS do 2d5419a).
- **Rótulos (ajuste de 22/10/2026; README, "Rótulo Novos Negócios" e "Aba Executiva")**: só front; chaves internas, payload
  e back-end iguais. (1) O macro `VOL DEST+ART+CND` aparece como `CONFIG.ROTULO_VOLUME_NOVOS` ("Novos Negócios") em tudo:
  `rotuloFront(k, rotulo)` em config.js (único ponto; `rotuloInd` do app.js, `nome`/tabela de volume do resumo.js e `NOMES`
  do ritmo.js chamam). `CONFIG.ROTULO_VOLUME_SUB` ("Dest+Art+Cnd") só como 2ª linha `.tsub` do card da aba Volume (`linha()`,
  `CHAVE_VOLUME_NOVOS`; também no card indisponível), `--fs-card-sub` 11 px / `--fw-card-sub` 400 no escopo `.ind`,
  `--txt-apoio`; `.lista:has(.ind .tsub) .ind.vol` soma a linha à `--h-card-vol` (cards de volume iguais entre si). Fora do
  card, só o nome (Executiva, gaveta só o texto do `#dTit`, ficha da busca, Resumo/PDF, Painel de Ritmo). A aba/grupo de
  coberturas "Novos Negócios" (`NOVOS_NEG`) não muda. (2) Aba `EXEC` com o nome do perfil: `CONFIG.ABA_EXEC_NOME`
  {dir: 'Diretoria', gc: 'Gerencial' (grupo também), sv: 'Supervisão'}, `nomeAbaExec()` (sem `ACESSO`, pelo `sel.modo`);
  `render()` põe no `<span>`, `title` e `aria-label` do botão; `#abTit` = `title` da aba ativa (no EXEC também). (3) Notas
  menores: `--fs-nota` (11,5 px PC / 11 px celular; `.rodape` e `.creditos`) e `--fs-nota-mini` (9,5 px; `.legenda` da
  Executiva e `.ladoCred`), mesmas cores; nunca na gaveta, no Resumo, nos PDFs nem no Painel de Ritmo. Testes: Parte AA
  (`rotulos_invariantes.js`); os "antes x depois" antigos (Partes V, R, W, X) comparam com `igualRotulo` (nome antigo →
  novo, sem a 2ª linha); o `FRONT_ETAPA4` (config.js antigo com resumo.js/ritmo.js atuais) ganha um `rotuloFront` com o rótulo
  de antes.
- **Visual** (README, "Visual"): fonte Inter variável LOCAL em `frontend/assets/fonts/` (latin + latin-ext do
  `@fontsource-variable/inter` 5.3.0, licença `OFL.txt`; nunca CDN nem Google Fonts), `font-display: swap`, fallback
  `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`; `encaixa()` remede no `loadingdone` das fontes e o PDF
  espera `document.fonts.ready`. Números grandes em Source Serif 4 LOCAL (Etapa 2, 21/10/2026;
  `source-serif-4-latin-wght-normal.woff2`, 50 KB, `OFL-source-serif-4.txt`, mesmo unicode-range da Inter, sem preload):
  `--serif` SÓ em `.ind .big` (a `.seta` fica em `--sans`), `.obox b`, `.card .n` (também os KPIs da Executiva), `.gPct`
  (% dos medidores da Executiva; o `small` "real" em `--sans`) e `.evPA` (% do mês de referência na Evolução); nunca na
  gaveta, no Resumo, nos PDFs, no Painel de Ritmo nem na entrada. `lining-nums tabular-nums` em `.abaTopo, .card, .ind, .topo,
  .puxa, .cli, .rodape` (fora da gaveta: a Parte N compara `font-variant-numeric`). `.card .n` com `data-fit` (mín. 16,
  `data-fit-quebra`; `encaixa()` também em `.cards`); `numObox` com `data-fit=""` (parte do `--fs-online`).
  Cards `.ind`: fundo rosa/verde de sempre + faixa `border-left` 5 px `--ruim`/`--verde` (`.off` sem faixa; padding
  esquerdo = `--pad-esq` − `--faixa`); escala própria no escopo `.ind` (~12% menor, igual no PC e no celular):
  `--fs-card` 15, `--fs-valor` 11,5, `--fs-ind` 25, `--fs-legenda` 11, `--fs-acao` 12,5, `--fs-online` 19,
  `--fs-online-rot` 9,5; `--h-card-*` 136 (PC) / 134 (celular). Grade da `.lista` no PC: `repeat(auto-fill,
  minmax(340px, 1fr))` (3 colunas em 1440 px). Testes: Parte T. Escala só por variáveis de `:root` (`--fs-titulo/card/ind/valor/legenda`, celular até
  640 px; a Executiva tem `--fs-ex-*` em `:root`; a gaveta Categoria por unidade, `--cu-fs-*` no escopo `.cuGav`): não pôr tamanho de letra solto fora dela (exceções: caixas `.rs-k` do Resumo/PDF e a página `.rt-*` do Painel de Ritmo). `%` de cards e linhas
  de grupo com `data-fit=""` (parte da escala, só reduz se não couber). Vermelho só no % abaixo, na Diferença
  negativa, no "faltam" (`.acao.falta`) e em alertas; Meta/Real/apoio em `--txt`/`--txt-apoio` (AA 4,5:1); rosa e verde
  claro dos cards e o verde do ritmo não mudam. Alturas mínimas por tipo (`--h-*`, card de volume com classe `vol`).
  Cabeçalho em 390 px <= 221 px até o fim das abas (Parte M dos testes; era 295).
  **Layout (Etapa 3, 21/10/2026; README, "Layout")**: `header.topo` + `nav.barra` dentro de `<aside class="lado">`
  (sem duplicar HTML). PC (>= 1000 px): o aside é o painel lateral fixo (`--lado`: 245 px, `body.recolhido` 68 px desde a
  Etapa 7 do pacote v3, 231/64 em tela baixa; eram 272/76; só
  ícones com `title`; `#ladoMenu` recolhe; estado em `localStorage 'drotas_lado'` 'recolhido'/'aberto', try/catch, só
  conveniência); `.topo`, `.barra` e os `.hd` com `display:contents` e a ordem por `order` (menu, marca, título,
  `#sub` com o escopo numa linha `.subEsc`, Filtro, selects empilhados, Painéis = abas verticais com SVG `.ico`, ativa
  em `--vermelho`, `#ritmo` = caixa de hoje, `.topoBtns` (↻ "Atualizar" e casa "Entrada", `.rotBtn`), `#ladoCred` =
  `CONFIG.CREDITOS`); `body{padding-left:var(--lado)}`, `.wrap` sem max-width; gaveta só com `left:var(--lado)` (a
  Parte N dá o mesmo `left` ao front do 0a59eb4 e compara o resto). Celular (< 1000 px): aside `display:contents` (a
  barra continua sticky), topo compacto: título + ↻ e casa; `#sub` = mês + etiqueta curta (`.tCurto` "dd/mm hh:mm"; o
  texto inteiro `.tLongo` no PC e no `title`); escopo `.subEsc` oculto só na Diretoria (`#sub.dir`: o seletor
  mostra); nos perfis travados ele fica; `#ritmo .ritCurto` "Dia útil x/n (p%) · ritmo hoje h%" (`.ritLongo` = as duas
  linhas do PC); sem a linha da marca. Escala do painel: `--fs-lado-tit/aba/sec` em `:root`. Testes: Parte U.
  **PC mais compacto e cabeçalho das abas travado (Etapa 7 do pacote v3, 30/10/2026; README, "Visual" e "Layout"; só CSS)**:
  dois blocos no fim das regras de tela do `app.css`: `@media (min-width:1000px)` = ~90% e `(min-width:1000px) and
  (max-height:820px)` = ~85% (1366x768, 1280x720); SÓ variáveis (nunca `zoom`/`transform`). Letras e espaçamentos no escopo
  `.lado, .wrap` (e `.wrap .ind`), NUNCA em `:root` (a gaveta, o Resumo/PDF, o Ritmo, a entrada, `#aviso` e `.dica` ficam fora
  dessas caixas e não mudam: Parte N intacta); em `:root` só `--h-*`, `--ritmo-*` e `--lado-aberto/recolhido` (a gaveta usa
  `--lado` só no `left`). Um 3º bloco `@media (min-width:1000px)` aplica as variáveis novas de espaçamento (`--lado-pad/gap/menu/
  tab-pad/ico/ico-w/btn-h/sel-py/ritmo-pad/sec-mt/cred-pt`, `--aba-mt/mb`, `--abcab-mb/pt/pb`, `--cards-gap`, `--card-pad`, `--ki`,
  `--ki-pos`, `--abres-col`, `--foco-pad/fi`, `--busca-pad`, `--fs-busca-in`, `--chip-pad`, `--lista-min/gap`, `--ind-pt/pb/gap/
  row-mt`, `--obox-pad`, `--exfoco-pad`, `--bloco-pad`, `--gauges-gap`, `--gcard-pad`, `--gsvg`, `--gpct-mt`, `--divs-gap`,
  `--exab-pt/pb`); abaixo de 1000 px as regras de antes ficam byte a byte (Parte AK compara os estilos computados em 360/390/999
  px com o CSS do `b83a341`, `REF_PRE_PC`). Antes → PC → PC baixo (px):

  | Variável | Antes | PC | PC baixo |
  |---|---|---|---|
  | `--fs-titulo` / `--fs-card` / `--fs-ind` | 30 / 19 / 30 | 27 / 17 / 27 | 25,5 / 16 / 25,5 |
  | `--fs-valor` / `--fs-legenda` / `--fs-nota` / `--fs-nota-mini` | 15 / 12,5 / 11,5 / 9,5 | 13,5 / 11,5 / 10,5 / 8,5 | 13 / 10,5 / 10 / 8 |
  | `--fs-lado-tit` / `-aba` / `-sec`; `--fs-busca-rot` | 22 / 14 / 10,5; 10,5 | 20 / 12,5 / 9,5; 9,5 | 18,5 / 12 / 9; 9 |
  | `--fs-ex-bloco/gtit/gpct/valor/tend` | 16/13/20/13,5/15 | 14,5/11,5/18/12/13,5 | 13,5/11/17/11,5/13 |
  | `--fs-ex-pill/rot/cel/mini/th/busca` | 12/11,5/12/10,5/10/13 | 11/10,5/11/9,5/9/12 | 10/10/10/9/8,5/11 |
  | `.ind`: `--fs-card/valor/ind/legenda/acao/online/online-rot/card-sub`, `--pad-esq` | 15/11,5/25/11/12,5/19/9,5/11, 15 | 13,5/10,5/22,5/10/11,5/17/8,5/10, 13,5 | 13/10/21/9,5/10,5/16/8/9,5, 13 |
  | `--h-card-vol` = `--h-card-cob` / `--h-kpi` | 136 / 124 | 122 / 112 | 116 / 105 |
  | `.card .st` (`--fs-st`, linha "Status") | 10 | 9 | 8,5 |
  | `--ritmo-h/w/raio` | 62/84/10 | 56/76/9 | 53/71/8,5 |
  | `--lado-aberto` / `--lado-recolhido` | 272 / 76 | 245 / 68 | 231 / 64 |
  | `--abres-col` / `--lista-min` | 260 / 340 | 234 / 340 | 221 / 310 |

  `--lista-min` fica 340 no PC comum (306-330 cortava o % de 7 dígitos em 1680-1920 px, com uma coluna a mais). Painel lateral
  sem rolagem em 1920x1080/1440x900/1366x768/1280x720, aberto e recolhido, em todos os perfis (folga mínima: grupo IT+MO em
  1280x720, ~47 px). Cabeçalho travado: no PC, fora da Executiva, `.abaTopo:not(.exec){display:contents}` e a `.abCab` sticky
  `top:0` (z 30, `--papel`, a sombra da Executiva, margem negativa `--ex-gut` = padding da `.wrap`; o espaço de antes vira
  padding + margem: `--aba-mt`/`--abcab-pt`/`--abcab-pb`/`--abcab-mb`; o `#abFil` leva o `--aba-mb`). A section continua o
  landmark "região" com o nome da aba (Chromium mantém o nó com `display:contents`; a Parte AK confere na árvore de
  acessibilidade) e a ordem não muda; sem caixa no PC, `geometria()` da Parte V usa a largura do `#abRes`. Executiva: a
  section inteira sticky, como antes. Testes atualizados só nos tamanhos (Parte T `ESCALA_IND`: 15/11,5/25/12,5/11/19/9,5 e
  padding 15 → 13,5/10,5/22,5/11,5/10/17/8,5 e 13,5 a 1440x900; Parte U `LADO_ABERTO/RECOLHIDO` 272/76 → 245/68; Parte V
  card de ritmo 260 → 234; Parte AA 2ª linha do card 11 → 10 no PC; Parte AE `.gFalta` 10,5 → 9,5 no PC; Parte AH `--fs-legenda`
  lido no escopo do botão); nos antes x depois contra fronts antigos no PC (Partes AG e AI) `semTam` tira só o `style="font-size"`
  que o `encaixa()` grava; na conferência com dado real, o `abre()` acrescenta ao CSS de todo front antigo (`troca`) o trecho do
  app.css entre "PC mais compacto" e "fim do PC mais compacto" (`ESCALA_PC_CSS`; não tirar esses dois comentários), para os
  dois fronts terem os mesmos tamanhos e o HTML continuar comparado inteiro. No front.test.js, o mesmo trecho
  (`ESCALA_PC_CSS`, `comEscalaPc`) vai no CSS dos fronts antigos dos antes x depois de HTML das Partes X (`FRONT_ETAPA5`), Z
  (`FRONT_PRE_EVO`) e AC (`FRONT_PRE_CAT`), e o teste das notas menores da Parte AA serve o app.css atual sem ele
  (`semEscalaPc`: mede só a redução da AA); antes disso esses 4 falhavam desde a Etapa 7. Novos na Parte AK.
  **Cabeçalho das abas (Etapa 4, 21/10/2026; README, "Cabeçalho das abas")**: `section#abaTopo` no lugar do `.topoGrid`:
  `.abCab` (h2 `#abTit` = `title` da aba ativa; `button#pilDia` = etiqueta do dia, `pintaEtiquetaDia`: `.pdL` "Dia útil
  DIA_HOJE de T · Semana N" no PC, `.pdC` "DIA_SEMANA · Sem. N" abaixo de 1000 px, `.pdI` "i"; `data-dica` com o dia,
  DIA_ONTEM/T (PACE_ONTEM_PCT), ritmo hoje, semana e "dias úteis pela frente, com hoje" = T − DIA_HOJE + 1, esta fora no
  fechamento), `.cards#abBase` (cBase, cSem) e `.abRes#abRes` (cRitmo | `#puxa` | `.busca`), `#cli` (ficha, fora da busca,
  logo abaixo) e `.fchips#abFil`. Os ids e números de sempre (`nBase`, `xBase`, `lSem`, `nSem`, `xSem` "sem compra hoje N",
  `nRitmo` = `x<small> / n</small>` com o className 'n ok|no', `lRitmo`, `xRitmo`, `stRitmo`); cards brancos `.card.kpi`
  (`.l` rótulo, `.ki` ícone, `.n` número, `.x` legenda; `--borda-card`, `--sombra-card`). Volume: rótulo "Categorias na
  tendência" (mesma regra). `linhaResumo()`: Base e Sem compra só com `sel.sv` (também "Neutraliza") ou `sel.rota` no modo
  'gc' (a Diretoria e a Gerência sem eles; a gaveta continua, os KPIs da Executiva a abrem); sem "puxa a média"
  (`#puxa` vazio: Rota, Todos a Bordo, todos no ritmo) o cRitmo vai para o `#abBase` (`.tres`, três cards; `.abRes.soBusca`),
  sem a Base e sem o puxa `.abRes.semPuxa`. PC: 260px | 1fr | 1.1fr; celular: `clamp(120px,38%,200px) 1fr` e a busca
  na linha de baixo. "Puxa a média" = mesmo `piorSv()`, saída `quadroPuxa(quem, p)`: `.foco.puxa` (quadro de destaque,
  `.fi` "!", `h3.t` "<Nível> que mais puxa a média para baixo", `p.s` `<b class="no">nome</b> · x de n indicadores no
  ritmo`; antes "na meta"). Filtro rápido `filtraCards()` (estado `filtroCards`, zerado em `marcaAba` ao trocar de aba;
  `.ind.filtrado` = `display:none`; chip sem card desabilitado e o escolhido sem card volta para 'todos'; `encaixa` de
  novo ao trocar). **Caixa de comentário** (reutilizar na Executiva): `ativaDica(el)` (uma vez por elemento, `WeakSet`),
  `mostraDica`/`escondeDica`, um `div.dica#dica` (role=tooltip, criado na 1ª vez, `--fs-dica` 12 px, `--carvao`, raio 9,
  `.v`/`.g` claros); mouse = `pointermove`/`pointerleave` com pointerType 'mouse' (acompanha o cursor), teclado = focus/blur
  e ESC, toque/caneta = click alterna, `pointerdown` fora e `scroll` fecham; o tipo vem do `pointerdown` (`_ponteiro`).
  Elemento aberto ganha `emFoco` (nunca `foco`: é a classe do quadro de destaque) e `aria-describedby="dica"`. Testes:
  Parte V (compara com o front do `a70a2c3` via `git show`); helpers `abreCardTopo` (gaveta Base/Sem pelo `click()` do
  elemento, também oculto), `puxaTxt` ("título: nome") e `abre(..., {toque: true})` (hasTouch, `page.tap`).
  **Aba Executiva (Etapa 5, 21/10/2026; README, "Aba Executiva")**: `.tab[data-g="EXEC"]` (primeira da barra; `aba` começa
  em 'EXEC'), `section#exec` (KPIs `.card.kpi` `#exBase/#exSem/#exVis/#exCat`, quadros `.foco` `#exFoco`/`#exDia`, blocos
  `.bloco`: `#exGauges`, `#exChips` + `#exDivs`, `.dupla` com `#exSemc` e `#exAg`/`#exAgenda`, `table#exCob` em `.rolaX`);
  no EXEC o `#abaTopo` fica só com `.abCab` (`.abaTopo.exec`, título = nome da aba pelo perfil; era "Resumo executivo") e, desde a Etapa 5 do pacote v3, sticky com o `#exFer` ("Abrir por" e busca; abaixo) e `#lista` vazio e `hidden`
  (`linhaResumo`/`filtraCards` não rodam; `buscaCliente` sai cedo). `temExecutiva()` = sem rota no filtro (modo 'gc'): com
  rota (perfil Rota) a aba some e `render` vai ao Volume. `pintaExecutiva(rotas, {ind, tot}, visitas)`: unidades =
  `gruposDo(ctxInicial(), null)` sem `off` (`unidadesExec`, cada uma com `agrega()` próprio; `cod` = nome sem " · ...");
  total = o `agrega()` do render (`totalExec`: 'BAND' / 'GC.AT' / 'GC.IT+MO' / 'SV.AP.1' / 'Neutraliza'). Categoria em
  análise `catExec` (GROUPS.VOLUME; padrão a 1ª; `escolheCat` re-renderiza e devolve o foco). Desvio `desvioVol` =
  tendência/meta − 1 exato (fechamento: real/meta − 1), cor pelo sinal (≠ card, que arredonda); Foco = falta Meta −
  Tendência nas unidades com `pctTendencia` < 100; Meta do dia: online `onlineVol` x `metaDia`, alcançou = `metaBatida` ou
  online >= metaDia. KPIs = os números dos cards (Categorias = `ritmoGrupo(ind,'VOLUME')`, a regra do card: ok com
  x*2 >= n; Coberturas = ICS GC + Novos Negócios). Agenda (`agendaDe`): como as listas de clientes (sem virtuais/EV*,
  sem ocultas `ehOculta`) e só rotas com `SEM_COMPRA_HOJE` não nulo; pediram = SEM_COMPRA_HOJE ∩ `onlineIds(r)`
  (QUALQUER); total = gaveta Sem compra (riscados = pediram). Tabela: `agrega().ind[k].pct` (ICS/NN), Todos a Bordo por
  `rotasInc` + `itensEm100`; células com `data-g` (o mesmo item está em dois grupos: ARTD KO; CERVEJAS e CERVEJAS 600ML
  RETORNAVEL no INCENTIVO só com as rotas com meta). Fechamento: "Realizado x Meta", `#exDia` e `#exAg` hidden
  (`.dupla.so1`). Evolução: ver abaixo (Etapa 8c).
  Ajustes visuais (29/10/2026; Parte AE): `#exCob` zebrado (`tbody tr:nth-child(even)` = `--zebra` #f6f6f8, também o `th.un`
  sticky; `tr.tot` = `--zebra-tot` #e4e4e8 e negrito; hover #ececef / total #d9d9de; o painel não tem tema escuro: os dois
  fundos são só da entrada); medidor com `.gFalta` entre `.gPct` e `.gMR` ("faltam X para a meta", X = `fmt0(meta − base)`,
  `--vermelho2`; base >= Meta: `.gFalta.ok` "meta batida · +X", `--verdeE`; `--fs-ex-mini`, 700; sem a linha no `.off`) e
  `data-meta`/`data-real` exatos no `.gCard`. **Correção de 30/10/2026 (decisão da Karen)**: base = Real + online de hoje (X =
  Meta − (Real + online)), como a Diferença dos cards e o Faltam da gaveta da categoria (`pintaMedidores`: `onl` = `onlineVol(rotas, c)` uma vez
  por cartão, null no fechamento e sem ONLINE, reaproveitado na `.gDia`; `realOnline(c, rotas, b, onl)`; null = Meta − Real);
  `data-online` no `.gCard` (vazio sem online); o `.gPct` e o arco continuam Real ÷ Meta, sem o online. Testes: Parte AE
  ("medidor: ... Meta - (Real + online)"), `executiva_invariantes.js` (recontagem pelo online.json, = `.gDia`, = caixa Online do
  card de Volume, = Faltam da linha de total da gaveta) e, com dado real, o antes x depois contra `1af3c6d` (`REF_PRE_FALTA`); os
  antes x depois que comparam o `#exec` inteiro com fronts antigos normalizam só a `.gFalta` e o `data-online` (`desfazFalta`,
  executiva_invariantes.js; o `desfazAE` também tira o `data-online`); rótulo `label.buscaRot` "Busca por cliente" (`--fs-busca-rot`, caixa alta,
  `--txt-apoio`) acima do `#q`, placeholder "Digite nome, código ou rede". Os "antes x depois" contra fronts antigos
  desfazem isso no atual com `desfazAE` (rotulos_invariantes.js; `igualRotulo`, `igualSemFalta`; em texto, só o "faltam X para
  a meta" do medidor: o "; faltam X para a meta." do quadro Foco já existia e fica). Na conferência com dado real, os antes x
  depois contra fronts de antes de 26/10 (`20728ac`, `7674ca2`, `ec60a88`) servem aos dois fronts o payload sem os itens do
  Todos a Bordo nas rotas ocultas das EV* (`SEM_INC_EV`; esses fronts não somam a oculta no `rotasInc`). Desvio por unidade
  (`.dRow`): coluna do valor `minmax(50px, max-content)` (46 px no PC): um valor longo (ex.: rota 151, Neutraliza G1, com
  META_VOLUME de 0,1 cx na fonte e "+28.715.800,0%" em 29/10/2026) alarga só a linha dele e a barra cede, sem rolagem lateral
  (antes, 404 px de largura na Executiva da G1 a 390 px). Dica = `ativaDica` em todo `[data-dica]` do `#exec` (linhas
  `.dRow`/`.hRow` com `tabindex=0`; fecha a aberta ao redesenhar). Celular: as 5 abas rolam de lado (`.tabs`
  overflow-x, `mostraAbaAtiva`); só a coluna `.dv.sel` com os chips. Medidores 5 colunas >= 1200 px, 3 >= 700, 2;
  tabela `min-width` 1140 px (rola dentro do bloco, 1ª coluna sticky). Escala `--fs-ex-*`. Testes: Parte W.
  **Evolução contra o mês anterior (Etapa 8c, 22/10/2026; barras pareadas desde o ajuste do mesmo dia; README, "Aba
  Executiva"; só Volume)**: `section#exEvo` (último `.bloco` do `#exec`, `hidden` sem `evolucaoAtiva()` =
  `CONFIG.EVOLUCAO_ATIVA` (true) e `P.MES_ANTERIOR`; payload sem a chave = oculto, sem erro). `pintaEvolucao(us, tot, niv)`:
  as mesmas unidades e total da Tendência x Meta; anterior = `NUCLEO.mesAnterior(P, rotas)` (soma simples dos pares de
  `MES_ANTERIOR.ROTAS` por item de `IND`; null = rota fora; o `modelo.py` não agrega essa chave, nada a espelhar); `evoDe`:
  % atual = Real/Meta do `agrega()` (exato), % anterior = Real/Meta anterior, Δ p.p. = % atual − % anterior, Δ Real = Real
  atual / Real anterior − 1 (só na dica). `#exEvLinhas`: uma `.evLin.cat` por categoria (`GROUPS.VOLUME`, `rotuloInd`;
  `role=button`, `aria-expanded`/`aria-controls`, `clicavel` → `abreEvo`, que só troca `hidden`) e logo depois a
  `.evDet#exEvDet<i>` (`hidden` fechada) com uma `.evLin.un` por unidade (Δ decrescente, "—" no fim). Linha = `.evNome`
  (`svg.evSeta` só na categoria, gira aberta) | `.evBarras` (duas `.evTr`: `i.atu` hachurada `--ruim` (sólida até
  29/10/2026; a legenda `.lg.evAtu` também), `i.ant` hachurada `--cinza-claro`; nas `.evLin.un` passo de 3 px em vez de 4; largura = mín(100, %); `::after` = marca preta de 100%) | `.evVal` (`b.evPA` % atual em `--serif`,
  `.evPB` % anterior em `--txt-apoio`; 1 casa; "—") | `.evD` (`.evDN` "▲ +x,x" / "▼ −x,x" / "0,0" / "—" e `small` "p.p.";
  `pos` `--verdeE`, `neg` `--vermelho2`, `zero`/`nd` `--txt-apoio`; sinal exato, `fmtDpp`; na dica `fmtPP`). Atributos
  `data-k/u/dpp/pct/pct-ant/real/meta/real-ant/meta-ant` e `data-dica` (`ativaDica`). Estado `evoAberto` {chave, ks}:
  `chaveEvo()` = perfil + filtro; outra chave ou `aplicaAcesso` recolhe; o render do online/payload e `escolheCat`
  mantêm. Grade: abaixo de 700 px o nome numa linha e o Δ embaixo dos valores (área "d d"); a partir de 700 px
  `150px | 1fr | 72px | 84px`, com "p.p." embaixo do Δ. Subtítulo `#exSEvo`: "% real até ontem: Outubro/26 (dia útil 14 de
  21) contra Setembro/26 no mesmo dia útil (até 21/09)." (`DIA_ONTEM`/`TOTAL_DIAS_UTEIS`, `MES_ANTERIOR.MES_LABEL`,
  `DATA_CORTE` dd/mm); limitado (`DIA_UTIL` < `DIA_ONTEM`, decisão 1): "… contra Setembro/26 inteiro (21 dias úteis, até
  30/09)."; fechamento x fechamento (decisão 2; as 7 decisões no README): "% real: Setembro/26 (fechado) contra Agosto/26
  (fechado)." Legenda `#exEvLeg` (`.lg.evAtu`/`.evAnt`/`.evCem`, a regra do Δ e "Clique ou toque numa categoria para abrir
  por <nível>"). Os chips `#exEvChips` e as colunas divergentes `.divs.ev` saíram (com o CSS deles). Testes: Parte Z
  (variantes 'evo', 'evogrupo', 'evogrande', 'evofech' e 'vol5' com `montaMesAnterior`; 'semevo' = 'exec' sem a chave; o
  sintético do back-end já traz uma MES_ANTERIOR, que `montaMesAnterior` substitui; antes x depois contra o front do
  `7674ca2`, `FRONT_PRE_EVO`) e `conferencia_real.test.js` (invariantes (a)-(f) em `frontend/tests/evolucao_invariantes.js`,
  com as categorias abertas, e o mesmo antes x depois com o payload real). `TEXTOS_TELA_PAGINA` (antes x depois da Parte AA)
  deixa o `#exEvo` fora.
  **Gaveta "Categoria por unidade" (22/10/2026; README, "Aba Executiva"; só front; em TABELA desde a Etapa 6 do pacote v3,
  30/10/2026)**: clique/Enter/Espaço no medidor (`pintaMedidores`) = `escolheCat(k)` + `abreCategoria(k)`; os chips do celular só
  escolhem; sem `comMeta` no escopo o medidor é `.off` (sem role/tabindex/clique) e a função também sai cedo; fechar não mexe em
  `catExec`. Unidades = `unidadesExec(ctxInicial())` (com `filho`), total = `agrega(rotasAtuais())`; unidade sem meta fora.
  Tabela `.ctTab` (classes novas `.ct*` dentro do `.cuGav`; `CT` = estado {k, tit, sub, nivel, linhas, tot, fech, dim, col, dir};
  `linhaCt`, `ordenaCt`, `linhaCtHtml`, `pintaTabCat`, `abreTabCat`): # | unidade | Meta | Real | % Real | Online | Faltam |
  Tendência (fechamento: sem a Tendência, "Online hoje", 7 colunas); sem barras nem Desvio. Unidade = só o código (`u.cod`;
  canal/cliente/KA com o nome) + `.ctInfo` ("N supervisões" de `infoCat`), `title` com o nome inteiro. Online = `onlineVol(rotas,
  k)` (unidade) ou Σ `volCliOnline` dos clientes (`dimDados` ganhou `onl` nas linhas e no total; `cliNeg` guarda `o`); cor
  `.ctOnl.ok/.no` só com meta do dia (`metaBatida` ou online >= metaDia), nunca em canal/cliente/KA. Faltam = Meta − (Real +
  Online) (`roCt`, `data-ro`; a Diferença dos cards, pedido da Karen de 30/10/2026; fechamento/sem ONLINE: Meta − Real) `fmt0`
  (`.ctFalt.no`) ou "+X" (`.ok`); a ordem por Faltam usa o mesmo valor. Tendência = `pctTendencia` em `--cu-esc` ("—" sem). Status `statusCat` (decisões de
  22/10: 'bat' Real >= Meta; 'tend' `pctTendencia` ARREDONDADO >= 100, fora do fechamento; 'abx') → classe `ST_CAT` na `tr`
  (faixa `inset` de `--ct-faixa` 4 px na 1ª célula visível, `.ctN` no PC, `.ctU` < 700 px; % Real em `--cu-cor`). Selo
  `.cSelo.ctSelo` ("✓" + `.ctSeloT` " Meta batida", só o "✓" < 700 px) e `tr.ctBat` (`--bat-bg`) com `linhaBatida(x, Real +
  Online)` (fechamento ou sem ONLINE: Real >= Meta); o status continua pelo Real. Total = 1ª linha do `tbody` (`.ctTot`,
  `--ct-tot` #e3e3e8, `--ct-fs-tot` 11 px, 700; código `totalExec(...).cod`, grupo "GC.IT + GC.MO"), fixa ao reordenar. Ordem
  padrão % Real (Real/Meta exato) decrescente; `.ctOrd[data-col]` pct/onl/falt/tend (1º clique −1, 2º inverte; seta ↓/↑;
  `.on` em `--vermelho2`; `aria-sort`); sem valor no fim; "Neutraliza" sempre por último; numeração `.ctN` segue a ordem.
  Subtítulo "… · N <nível> · ordenado por <% da meta|online|faltam|tendência>" (`CT_ORD`). Rodapé `.cuLeg` + `.ctRod`
  ("Clique em % Real, Online, Faltam ou Tendência para reordenar."). Zebra `--ct-zebra` #f7f7f9 (nth-child(even) do tbody),
  hover/`emFoco` `--ct-hover` #ececef. Dica (`ativaDica` em cada `tr`): Meta / Real até ontem (X%) / Online (· meta do dia) /
  Tendência (Y%). < 700 px: sem `.ctN`, `.ctMeta`, `.ctReal`, `.ctInfo`, `.ctSeloT`; células do corpo com
  `overflow-wrap:anywhere` (o % da meta de 0,1 cx da rota 151 quebra em vez de rolar). Canal/cliente/KA (`abreCategoriaDim`): a
  mesma tabela com "Meta NEG", tendência "—", Online sem cor, a `.cuNota`. `cartaoCat` (cartões `.cu*`) continua SÓ na ficha
  da busca (Etapa 5). Testes: Parte AC (`categoria_invariantes.js`: (a)-(g), também na conferência com dado real; antes x
  depois contra o `ec60a88`, `FRONT_PRE_CAT`) e Parte AJ.
  **Escopo do nível acima na Executiva (Etapa 6 do pacote v3, 30/10/2026; README, "Entrada com perfis" e "Aba Executiva"; só
  front)**: a entrada NÃO muda. `escopoAcima` (false; `aplicaAcesso` zera: cada entrada e reabrir começam no acesso),
  `temEscopoAcima()` (perfil Gerência ou Supervisão), `acimaAtivo()` (+ `aba===EXEC`). Lido SÓ por `rotasAtuais` (Gerência →
  `gcsComDados()` inteiras; Supervisão → `rotasDe(ACESSO.gc,'')`) e `ctxInicial` (Gerência → {nivel:'gc', nome:'Diretoria'};
  Supervisão → `ctxGerencia(ACESSO.gc)`, a gerência dela, não o grupo); `chaveEvo` ganha 'acima'. Resumo e Painel de Ritmo
  leem `sel` (não mudam); sessão guardada e `validaAcesso` também não. `pintaEscopo` (em `cabExec(true)`): `#exEsc.exEsc`
  (role=group, dois `.fchip[data-esc="0|1"]` colados, `aria-pressed`, `title` com o nome inteiro) + `span.exTraco` antes do
  `#exAbrir`; Gerência "GC.G1 | BAND" (grupo "GC.IT + GC.MO | BAND"), Supervisão "SV.G2.1 | GC.G2"; Diretoria/Rota: `hidden`.
  Celular: `#abaTopo.comEsc` põe o `#exEsc` numa linha própria (grid "tit lupa dia" / "esc" / "abr"; sem o traço); `cabExec(false)`
  tira o `comEsc` (o cabeçalho das outras abas fica byte a byte). Com o nível de cima, o "Abrir por" segue o nível ("Gerência"),
  sem a Marca (só `sel.modo==='dir'`); o filtro lateral não altera a Executiva. O nome da aba continua o do perfil. Testes:
  Parte AJ (BAND = Diretoria "Todas" e GC = Gerência pelo HTML do `#exec` e da gaveta; abas, Resumo, Ritmo e sessão no acesso).
  **Botão "Clientes" por agrupador, com busca (Etapa 4 do pacote v3, 30/10/2026; README, "Botão Clientes"; só front)**:
  `button#btnClientes.abCli` no `.abCab`, antes do `#pilDia` (ícone de pessoas, `--fs-legenda`, borda `--linha`, hover
  `--preto`; `.abCli[hidden]` = none); `render()` esconde na Executiva e sem agrupador (`agrupadoresCli()`). `abreClientes` →
  `abre()` com `.cliBusca` (`#cliQ` type=search, lupa; classe NOVA na gaveta, `--cb-fs` 13 px / 16 px <= 640 px), `#cliKs`
  (`.chips`/`.dchip` com `data-k`, um por agrupador) e `#dLista`; `pintaClientes` troca título "Clientes · rótulo", subtítulo
  "<title da aba> · resumoInd(k, agrega(rs).ind[k])" (rs = `rotasInc` no Todos a Bordo) e a lista. Agrupadores = `cardsDaAba`
  (helper tirado do `render`, mesma regra dos cards: Imperdoáveis/Venda Zero da Neutraliza/Del Valle Frut fora da Diretoria)
  sem os indisponíveis; Todos a Bordo = itens com `rotasInc`. Rotas = `rotasListas()` com `temItemCli(k, r)` (indicador da rota
  disponível; Todos a Bordo `temMetaInc`): DECISÃO DA KAREN (30/10/2026) = "só rotas com o item"; a cascata da Diretoria
  (GC > Clientes) mostra também as rotas sem o item, a da Gerência/Supervisão não. As listas são as da cascata:
  `listaVolume(k, rotas, op)`, `listaVendaZero(rotas, op)`, `listaCobertura(k, rotas, op)` com `op` opcional {chip, q, aoDia}
  (sem `op`, a cascata, byte a byte como antes): dia de partida, busca (`buscaCasa(q)`: `semAcento` do nome ou PV contém, ANTES
  do `LIMITE_LISTA`; "+ N" conta só os que casam) e quem guarda o dia (`aoDia`). Estado `CLI` {k, q, chip}: busca e dia seguem
  ao trocar de agrupador/dia; `abreClientes` zera. Venda Zero busca por `e.nome`/`e.pv`. Testes: Parte AH (+ conferencia_real).
  No payload real de 29/10: 0 PVs em mais de uma rota; 343 clientes com nome repetido na mesma rota (a conferência desempata o
  PV do volume pelo Real).
  **Cabeçalho fixo, "Abrir por" e busca da Executiva (Etapa 5 do pacote v3, 30/10/2026; README, "Aba Executiva"; só front)**:
  `cabExec(on)` (no `render`) põe o `div#exFer.exFer` (`#exAbrir.exAbrir` com os `.fchip[data-ab]` + `.exBusca`: `#exLupa`,
  `.exCampo` com `#exQ` e `#exSug.sugestoes`) no `.abCab` antes do `#pilDia` SÓ na Executiva e o tira nas outras abas (o
  cabeçalho delas fica byte a byte o de antes). `.abaTopo.exec` sticky (`top: var(--barra-h)`; PC 0), fundo `--papel`, sombra,
  margem negativa `--ex-gut`; `medeBarra()` grava `--barra-h` (altura da `.barra` sticky; 0 no PC, `display:contents`) no
  render, no resize e por `ResizeObserver`. Celular: `.abCab` em grade "tit lupa dia" / "abr abr abr" (`.exFer`/`.exBusca`
  `display:contents`); a lupa põe `.buscaAberta` no `#abaTopo` (campo na linha 2). A Parte M (até o fim da `.barra`) não muda.
  "Abrir por": `abrirPor` ('nivel' | 'canal' | 'marca' | 'cli' | 'ka'; `aplicaAcesso` volta a 'nivel'), `modoAbrir()` (marca só
  com `sel.modo==='dir'`), `pintaAbrir()` (1º botão = `NIVEL_EXEC[ctxInicial().nivel]`; `aria-pressed`). Modo 'nivel' = o desenho
  de sempre (`pintaDesvios`, `abreCategoria`, detalhe da Evolução; HTML idêntico ao da main, Parte AI (a)). Outros modos:
  `pintaDesviosDim` (título "Realizado x Meta NEG por canal", desvio = Real ÷ Meta NEG − 1, `.divs.abDim` + `.abCanal` (nome 96
  px) / `.abLista` (118 px), `.dvNota` "Meta = soma da Meta NEG dos clientes (X% da meta oficial em <categoria>)" com
  `data-oficial`/`data-meta-neg` no `.dv`, `.exNota` com a regra dos 15 e "Tendência por <canal> depende de dado novo"; linhas
  com `data-tend=""`), `abreCategoriaDim` (os cartões `cartaoCat(..., {semTend:true})`: como no fechamento, sem `.cuB2`, "Meta
  NEG", status bat/abx; `.cuNota`) e `evoDim` (só o mês atual, `x.semAnt`, `.evNota`). Marca: `AVISO_MARCA` (`.exAviso`) nos três.
  Dados: `dimDados(ab, k)` = {linhas, tot, oficial}: total = todos os clientes de `rotasVisiveis()` com bloco (`cliNeg`,
  `VOLUME_CLIENTE[r][pv][i]` = [Meta NEG, Real]); Canal = por `SEGS[c[2]]` no mesmo universo (canais com Meta NEG > 0; Σ = total);
  Clientes e Key Accounts (`gruposRede`) de `rotasListas()` (sem as ocultas), os `TOP_DIM` (15) maiores em Real com Meta NEG > 0
  (desempate: Meta, nome). DECISÕES DA KAREN (30/10/2026): ocultas (SV.G3.3) no total e no Canal, fora das listas (Clientes, KA e
  busca); total = todos os clientes. NADA de tendência estimada (D1 Meta NEG restante por cliente, D2 mês anterior por cliente e
  D4 marca dependem de dado novo). Busca: `sugereEx` (`semAcento`; KAs e clientes de `rotasListas()`, 4 KAs antes dos clientes,
  até `MAX_SUG_EX` 12; `.sugItem` + `.tagRedeSug` "Key Account") → `abreFichaEx` (`abre()`: `.fxFicha` com `.fxSec`, `cartaoCat`
  por categoria com `semTend` ou o cartão `.cuSemNeg` (faixa `--linha-forte`, "sem Meta NEG"), `tileCobCli`/`tileCobKa` nos
  `.grid13.fxCob`); `kaDoCliente`. Classes novas: `.exFer .exAbrir .exAbRot .exBusca .exLupa .exCampo .sugVazio .abDim .abCanal
  .abLista .dvNota .exNota .evNota .exAviso .cuNota .cuSemNeg .fxFicha .fxSec .fxCob`; escala `--fs-ex-busca` (13/16 px),
  `--fx-fs-sec`, `--ex-gut`. Testes: Parte AI (`dimensoes_invariantes.js`, também na conferência com dado real). Payload real de
  29/10: Meta NEG somada = 98,2/95,8/97,0/95,1/98,5% da meta oficial na Diretoria; 290 KAs (107 em mais de uma rota), nenhuma loja
  em duas.
  **Gavetas com barra de dias (Etapa 6, 21/10/2026; README, "Gavetas com barra de dias")**: o `chipsHtml`/`DIAS_CHIP` das
  coberturas e a regra única `noDia(c, chip)` (Todos; Hoje = `c[4]===1`; dia = `DIAS[c[3]].includes(chip)`: "Seg - Qui"
  aparece na Seg e na Qui; `listaCobertura` usa a mesma). `listaVolume`: barra em `#dLista` acima do `.cCab`, padrão
  'Todos' (a lista de antes; o template das linhas é o mesmo, byte a byte), "Ninguém neste filtro." com o dia vazio.
  `gavetaDias(pinta)` (barra direto no `#dCorpo`, padrão 'Hoje'; cada chip troca `dTit`, `dSub` e a lista; ao reabrir,
  o padrão) com `abreBase` (card `#cBase`, KPIs `#exBase`/`#exVis`; Hoje = `listaClientes` = CLIENTES_HOJE, "Visitas de
  hoje"; dia/Todos = `doRoster` do CLIENT_ROSTER, "Clientes da base") e `abreSemCompra` (card `#cSem`, KPI `#exSem`; Hoje
  = SEM_COMPRA_HOJE, "Sem compra hoje"; dia/Todos = `P.SEM_COMPRA_MES` pelo dia, "Sem compra"; sem a chave: só o Hoje com
  `abre()`, sem barra; sem `FONTES.venda`: o aviso de sempre). Riscado + "Venda Online" = `onlineIds(r)` (QUALQUER) via
  `itemHtml`; em nome (`porNome`); `rotasListas` (sem virtuais/EV* nem ocultas: na G3/Diretoria a lista fica abaixo do card
  exatamente pela SV.G3.3). `itensGaveta`: Hoje inteiro (como antes); dia/Todos com `CONFIG.LIMITE_LISTA` + "+ N clientes —
  filtre por rota para ver todos."; subtítulo com o total. Nenhum CSS novo. Testes: Parte X (+ conferencia_real).
  **Cascata (gaveta, `.drw` e tudo dentro) = aparência do commit 0a59eb4, só com a Inter** (o ajuste visual foi
  reprovado ali): bloco "drawer" do `app.css` copiado do 0a59eb4 (sem a serifa do `.cLin .cDir b`), cinzas antigos
  redefinidos em `.drw` (`--cinza`, `--cinza-escuro`), sem `var(--fs-*)`, alturas mínimas, `data-fit` nem `encaixa()`
  na gaveta. Não aplicar a escala/cores novas ali; se a Inter apertar uma célula, só `letter-spacing` (até -0.02em).
  Conteúdo NOVO dentro da gaveta (a "Categoria por unidade" da Executiva) só com classes novas (`.cu*`, escala e cores
  próprias); o cromo (moldura, cabeçalho, ×) é o de sempre (a Parte AC compara com o da cascata).
  EXCEÇÃO AUTORIZADA pela Karen (Etapa 3 do pacote v3, 29/10/2026; só isto): linha da cascata de todas as abas menos a
  Venda Zero (`.cLin.v3`), cabeçalho de colunas `.cOrd` (PC) / chips `.cOrdCh` (celular), selo `.cSelo` + fundo `.bat`
  (`--bat-bg`/`--bat-borda` no escopo `.drw`), lista de clientes de volume `.cCab.v3`/`.cCli.v3` e, no PC (>= 1000 px), com
  `#drw[data-casc]` (posto por `abreIndicador`/`abreIncentivo`, nunca na Venda Zero; `abre()` tira), `max-width: 860px` e
  menos padding no `.drwCab`/`.corpo`. A Parte N tira da comparação o que está dentro de `.v3` (no front de lá, as `.cLin`
  não-off, `.cCab` e `.cCli`), compara a caixa `.cMeio > *` da linha nova com a de antes, ignora no PC só esses paddings, a
  margem automática da `.drw` e o `grid-template-columns` (em px) da `.cLin.off`, e confere na Diretoria só o 1º nível.
  A Parte N dos testes compara a gaveta com o front do 0a59eb4 (`git show`) elemento a elemento. Onde o atual tem a barra
  de dias e o 0a59eb4 não (lista de volume, Base, Sem compra; Etapa 6): a marcação fora da barra = a de lá (no estado que
  ele tem) e o `#dCorpo` do atual é posto na gaveta do 0a59eb4 (nós dele devolvidos depois) para comparar o estilo de cada
  elemento, barra inclusive, com o CSS de lá; o teste exige que isso rode nas 3 listas (`espelhos`).
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
