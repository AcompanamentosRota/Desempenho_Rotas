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
  cliente e só rota x agrupador), cada filtro conferido contra o mês inteiro e a curva diária BAND, com linhas e tempo.
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
  Variantes do payload montadas no próprio teste: 'grupo' (IT+MO com a virtual I32 e a eventual MO-EV), 'semdados'
  (G3 e PA sem dados), 'semsv', 'antigo', 'inc'/'incfech' (cenários da aba Todos a Bordo, `montaIncentivo`), 'seminc'
  (payload sem o grupo INCENTIVO), 'semscm' (payload sem SEM_COMPRA_MES; Parte S), 'grande' (16 gerências, a DI
  copiada da PA, e números de 6-7 dígitos; PDF do Resumo, `montaGrande`), 'exec' (o 'inc' com clientes sem compra no
  mês, `montaSemCompra`: o sintético compra tudo; Parte W) e 'dias'/'diasscm' (o 'exec' com dias de visita "Seg - Qui",
  "Ter" e "Qua - Sex" por rota, `montaDias`; o 2º sem SEM_COMPRA_MES; Parte X e o cenário "barra de dias" da Parte N) e
  'vol5'/'vol5fech' (o 'exec'/'incfech' com os 5 macros de volume com dado, `montaVolume5`, + `montaMesAnterior`; Parte AA). PDF real (Parte O) só com os pacotes npm `html2canvas@1.4.1` e `jspdf@2.5.1` achados por
  `require.resolve` (local, `NODE_PATH` ou global); sem eles, pulado. `abre(nome, {troca})` troca o conteúdo de um arquivo servido (ex.: config.js;
  a Parte N serve o CSS e o app.js do 0a59eb4 assim).
- Conferência da Executiva com DADO REAL (sob demanda, fora do CI): `PAYLOAD_REAL=/tmp/real/payload.json
  ONLINE_REAL=/tmp/real/online.json node --test frontend/tests/conferencia_real.test.js` (os JSONs = `git show
  origin/main:frontend/data/...` copiados FORA do repo; sem as variáveis, pula). Diretoria, cada gerência, cada grupo no
  Total e uma supervisão; invariantes em `frontend/tests/executiva_invariantes.js` (as mesmas da Parte W); imprime uma
  tabela-resumo só de totais e códigos. Gavetas com barra de dias (Etapa 6): Diretoria, G1, G2, AP, IT+MO e uma
  supervisão (cada chip x recontagem e x cards, `frontend/tests/gavetas_invariantes.js`, as mesmas da Parte X) e cada
  unidade dessas gerências (Hoje e Todos x cards); sem rolagem lateral nem erro em 360/390/1000/1440 px nos dois fundos.
  Evolução contra o mês anterior (Etapa 8c): Diretoria, cada gerência, cada grupo no Total e uma supervisão, em 1440 e 390 px
  (`frontend/tests/evolucao_invariantes.js`, as mesmas da Parte Z; pula sem `MES_ANTERIOR`).
  Ajuste de rótulos: Diretoria, G1, IT+MO, a 1ª supervisão e a 1ª rota da G2, em 1440 e 390 px nos dois fundos, e o antes x
  depois contra o front do `20728ac` com o mesmo payload (`frontend/tests/rotulos_invariantes.js`, as mesmas da Parte AA).
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
  da Diretoria, mesmo com uma gerência. Rodapé do painel: "Karen Oliveira - Inteligência de Mercado" (`CONFIG.CREDITOS`);
  a folha do Resumo NÃO tem assinatura (sem `.rs-rod`, na tela e no PDF; desde 21/10/2026).
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
  `--serif` SÓ em `.ind .big` (a `.seta` fica em `--sans`), `.obox b`, `.card .n` (também os KPIs da Executiva) e `.gPct`
  (% dos medidores da Executiva; o `small` "real" em `--sans`); nunca na
  gaveta, no Resumo, nos PDFs, no Painel de Ritmo nem na entrada. `lining-nums tabular-nums` em `.abaTopo, .card, .ind, .topo,
  .puxa, .cli, .rodape` (fora da gaveta: a Parte N compara `font-variant-numeric`). `.card .n` com `data-fit` (mín. 16,
  `data-fit-quebra`; `encaixa()` também em `.cards`); `numObox` com `data-fit=""` (parte do `--fs-online`).
  Cards `.ind`: fundo rosa/verde de sempre + faixa `border-left` 5 px `--ruim`/`--verde` (`.off` sem faixa; padding
  esquerdo = `--pad-esq` − `--faixa`); escala própria no escopo `.ind` (~12% menor, igual no PC e no celular):
  `--fs-card` 15, `--fs-valor` 11,5, `--fs-ind` 25, `--fs-legenda` 11, `--fs-acao` 12,5, `--fs-online` 19,
  `--fs-online-rot` 9,5; `--h-card-*` 136 (PC) / 134 (celular). Grade da `.lista` no PC: `repeat(auto-fill,
  minmax(340px, 1fr))` (3 colunas em 1440 px). Testes: Parte T. Escala só por variáveis de `:root` (`--fs-titulo/card/ind/valor/legenda`, celular até
  640 px; a Executiva tem `--fs-ex-*` em `:root`): não pôr tamanho de letra solto fora dela (exceções: caixas `.rs-k` do Resumo/PDF e a página `.rt-*` do Painel de Ritmo). `%` de cards e linhas
  de grupo com `data-fit=""` (parte da escala, só reduz se não couber). Vermelho só no % abaixo, na Diferença
  negativa, no "faltam" (`.acao.falta`) e em alertas; Meta/Real/apoio em `--txt`/`--txt-apoio` (AA 4,5:1); rosa e verde
  claro dos cards e o verde do ritmo não mudam. Alturas mínimas por tipo (`--h-*`, card de volume com classe `vol`).
  Cabeçalho em 390 px <= 221 px até o fim das abas (Parte M dos testes; era 295).
  **Layout (Etapa 3, 21/10/2026; README, "Layout")**: `header.topo` + `nav.barra` dentro de `<aside class="lado">`
  (sem duplicar HTML). PC (>= 1000 px): o aside é o painel lateral fixo (`--lado`: 272 px, `body.recolhido` 76 px, só
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
  no EXEC o `#abaTopo` fica só com `.abCab` (`.abaTopo.exec`, título = nome da aba pelo perfil; era "Resumo executivo") e `#lista` vazio e `hidden`
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
  (`.dupla.so1`). Evolução: ver abaixo (Etapa 8c). Dica = `ativaDica` em todo `[data-dica]` do `#exec` (linhas
  `.dRow`/`.hRow` com `tabindex=0`; fecha a aberta ao redesenhar). Celular: as 5 abas rolam de lado (`.tabs`
  overflow-x, `mostraAbaAtiva`); só a coluna `.dv.sel` com os chips. Medidores 5 colunas >= 1200 px, 3 >= 700, 2;
  tabela `min-width` 1140 px (rola dentro do bloco, 1ª coluna sticky). Escala `--fs-ex-*`. Testes: Parte W.
  **Evolução contra o mês anterior (Etapa 8c, 22/10/2026; README, "Aba Executiva"; só Volume)**: `section#exEvo` (último
  `.bloco` do `#exec`, `hidden` sem `evolucaoAtiva()` = `CONFIG.EVOLUCAO_ATIVA` (true) e `P.MES_ANTERIOR`; payload sem a
  chave = oculto, sem erro). `pintaEvolucao(us, tot, k)`: as mesmas unidades e total da Tendência x Meta; anterior =
  `NUCLEO.mesAnterior(P, rotas)` (soma simples dos pares de `MES_ANTERIOR.ROTAS` por item de `IND`; null = rota fora; o
  `modelo.py` não agrega essa chave, nada a espelhar); % atual = Real/Meta do `agrega()` (exato); Δ p.p. = % atual −
  % anterior; Δ Real = Real atual / Real anterior − 1 (só na dica). Linhas `.dRow` dentro de `.divs.ev#exEvDivs` (as
  classes da Tendência x Meta; coluna do valor 54/52 px, cabe "−1.234,5"; `.dVal.zero/.nd` cinza; `.legenda` com "Δ em
  pontos percentuais (p.p.)" e as cores: na linha só o número, `fmtDpp`; na dica com "p.p.", `fmtPP`), `data-dpp/pct/pct-ant/real/meta/
  real-ant/meta-ant`; ordem decrescente do Δ com o total no meio, cor pelo sinal exato (0 = cinza "0,0 p.p."), escala pela
  maior barra (mín. 10 p.p.), "0,0" com 0; sem meta anterior ou atual = "—" no fim. Chips `#exEvChips` no celular (`escolheCat`, a mesma
  `catExec`). Subtítulo `#exSEvo`: "Setembro/26 até 20/09 (dia útil 13 de 21) x Outubro/26 até 20/10 (dia útil 13 de 21). % = Real ÷
  meta do mês." (`MES_ANTERIOR.DIA_UTIL`/`TOTAL_DIAS_UTEIS` x `DATA_ONTEM` dd/mm e `DIA_ONTEM`/`TOTAL_DIAS_UTEIS`, o último dia útil
  fechado, o do Real; sem `DATA_ONTEM`, sem a data); fechamento x fechamento:
  "Agosto/26 (fechado) x Setembro/26 (fechado)" (decisão 2 da Karen; as 7 decisões no README). Inter (sem `--serif`).
  Testes: Parte Z (variantes 'evo', 'evogrupo', 'evogrande', 'evofech' com `montaMesAnterior`; 'semevo' = 'exec' sem a
  chave; o sintético do back-end já traz uma MES_ANTERIOR, que `montaMesAnterior` substitui) e `conferencia_real.test.js`
  (invariantes (a)-(e) em `frontend/tests/evolucao_invariantes.js`).
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
