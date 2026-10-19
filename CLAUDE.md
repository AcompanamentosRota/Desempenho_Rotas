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
- Front local: `cd frontend && python -m http.server 8765`.
- Testes de front (Chromium headless + dado sintético gerado pelo próprio back-end): `node --test frontend/tests/front.test.js`
  (precisa de Python com as dependências do back-end e do pacote `playwright`; sem ele os testes são pulados; o CI não roda).
  O teste chama `python3` (no Windows, ponha um `python3.exe` do venv no PATH) e acha o `playwright` por `NODE_PATH`.
- Nesta máquina o Python do sistema não tem `python-dotenv`/`pytest`; use
  `C:\Users\luan.arantes\Documents\Teste_ODATA\.venv\Scripts\python.exe` para rodar o back-end.
  Chamadas de rede exigem desabilitar o sandbox.

## Regras que não são óbvias

- **Contrato com o front**: `payload.json`/`online.json` têm o formato exato que `frontend/js/main.js` e `app.js` leem.
  `SEGS` e `DIAS` são tabelas de índice (cada cliente guarda a posição): só acrescentar no fim.
  Fórmulas em `backend/gerador/modelo.py` espelham `agrega()` em `app.js`; mudou um, mude o outro.
- **Todo nome de coluna, filtro e agrupador fica em `backend/gerador/mapeamento.py`.** Valores conferidos em 13/10/2026:
  - Base de clientes guarda histórico: filtrar `FL_CORRENTE eq 'S' and STATUS_CLIENTE eq 'Ativo'`.
  - Gerências do painel na fonte (`M.GC_ORIGEM`): `Gc. G1/G2/G3/Ap/It_Mo` conferidas; `Gc. At/An/Sl/Rv/Pa_Di/Ur_Ri/Gu_Po`
    A CONFIRMAR (vistas no comodato). As agrupadas (It_Mo, Pa_Di, Ur_Ri, Gu_Po) são separadas pelo prefixo do supervisor
    (`Sv. Pa. 3` → `SV.PA.3` → `PA`; `M.GC_SIGLAS_ORIGEM`); prefixo fora da gerência entra e vai para o log.
    16 siglas em 3 regiões (`M.REGIOES`: Matriz G1 G2 G3 AT AP · Sul AN SL RV MO IT · Norte RI UR GU PO PA DI), no payload
    em `REGIOES`; `GC_ATIVAS` mantém as 6 antigas primeiro (o front ordena por região).
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
  Meta do dia = `META_RECUPERAVEL_ROTA` por rota × agrupador com `DATA_MOVIMENTO` = hoje (se der HTTP 500, repete
  por gerência; se falhar, `metaDia = null`, nunca outra conta). Supervisão e gerência somam as rotas e recalculam
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
- **Front**: abre na entrada (DIRETORIA / GERÊNCIA; sol/lua só no fundo da entrada, `localStorage 'drotas_entrada'`).
  Diretoria = todas as gerências (ou uma região). Cards abrem a cascata única (`abreIndicador` → `pintaCascata`):
  gerências → supervisões → rotas → clientes, linhas com os números de `agrega()` (nada recalculado). Resumo: Diretoria
  em faixas de 8 gerências, seletor de uma gerência; placa ATENÇÃO só com `CONFIG.LIMIAR_ATENCAO` (null = desligada).
  Rodapé: "Karen Oliveira - Inteligência de Mercado".
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
