# Desempenho de Rotas · Comercial Bandeirantes

Painel de desempenho por rota (ICS GC, Novos Negócios, Volume e Venda Zero) das 16 gerências,
publicado no GitHub Pages e alimentado automaticamente pelo **SAP Datasphere** via OData.

```
desempenho/
├── frontend/                 site estático (GitHub Pages)
│   ├── index.html
│   ├── css/app.css
│   ├── js/config.js          URLs dos dados, intervalos, placa ATENÇÃO, entrada (usuário, virada), CDN (com SRI)
│   ├── js/app.js             painel (entrada com perfis, filtros, cards, cascata, busca, Desempenho GDM)
│   ├── js/resumo.js          "Resumo de vendas" + PDF
│   ├── js/main.js            carga e atualização periódica dos JSONs
│   ├── assets/, manifest.webmanifest
│   ├── tests/                testes de front (Chromium headless, dado sintético)
│   └── data/payload.json, data/online.json   ← gerados pelo back-end
├── backend/                  gerador Python (roda no GitHub Actions)
│   ├── odata/                cliente OData (copiado do kit Teste_ODATA)
│   ├── gerador/              consulta, normalização, fórmulas, montagem, validação
│   ├── scripts/gerar.py      gera os JSONs
│   ├── scripts/descobrir.py  confere o mapeamento contra os dados reais
│   ├── scripts/conferir_tendencia.py  confere tendência do SAC e fechamento com os dados reais
│   ├── conferencia/sac/      tela do SAC de cada dia (refri_AAAA-MM-DD.csv) para o aceite e a seção E7
│   └── tests/                testes sem rede (unittest)
├── .github/workflows/
│   ├── atualizar-dados.yml   cron 15 min, seg-sex, 07h-18h45 (Brasília)
│   ├── deploy-pages.yml      publica frontend/ no Pages
│   ├── conferir-tendencia.yml  manual: relatório da tendência/fechamento (artifact, sem commit)
│   └── testes.yml            testes do back-end
└── index.html                redireciona links antigos para frontend/
```

## Como funciona

1. O workflow **Atualizar dados** roda a cada 15 minutos em dias úteis.
2. `backend/scripts/gerar.py` pede um token OAuth (client credentials), consulta o
   Datasphere (`DW_BND_COM_SAP`), monta `payload.json` e `online.json` e **valida**
   o resultado.
3. Se os dados mudaram, o workflow faz commit em `frontend/data/` e publica o site.
   Se a validação reprovar, nada é gravado, o site continua com a última versão boa e
   a execução aparece como falha no GitHub (com o log anexado).
4. O navegador revalida o `online.json` a cada 5 min e o `payload.json` a cada 15 min
   (com ETag, só baixa quando mudou).

Fontes no Datasphere (nomes de colunas em `backend/gerador/mapeamento.py`):

| Modelo | Uso |
|---|---|
| `AM_FAT_BND_ANALISE_META` | cobertura do mês, vendas de hoje (online), volume, metas |
| `AM_BND_BASE_CLIENTE` | clientes por rota, visita de hoje, GC/supervisor/vendedor, rede |
| `AM_FAT_BND_COMODATO` | Venda Zero (equipamentos com giro zero) e equipamentos ativos |
| `AM_BND_MTR_CALENDARIO_DATA_ATUAL` | dias úteis do mês |

## Variáveis de ambiente

Os mesmos nomes valem para os dois ambientes.

| Variável | Local (`backend/.env`) | GitHub Actions |
|---|---|---|
| `DATASPHERE_TENANT_URL` | sim | Variable |
| `DATASPHERE_TOKEN_URL` | sim | Variable |
| `DATASPHERE_CLIENT_ID` | sim | **Secret** |
| `DATASPHERE_CLIENT_SECRET` | sim | **Secret** |
| `DATASPHERE_SPACE` | `DW_BND_COM_SAP` | Variable |
| `DATASPHERE_ASSET` | `AM_FAT_BND_ANALISE_META` | Variable |
| `SAIDA_DIR`, `JANELA_EXECUCAO`, `ODATA_TIMEOUT`, `ODATA_MAX_WORKERS` | opcionais | definidos no workflow |

Local: `copy backend\.env.example backend\.env` e preencha. O `.env` está no `.gitignore`.

Nuvem (uma vez). Em repositório de conta pessoal só a **dona do repositório** acessa
Settings, Secrets e Pages; colaboradores com escrita não conseguem:

```bash
gh secret set DATASPHERE_CLIENT_ID
gh secret set DATASPHERE_CLIENT_SECRET
gh variable set DATASPHERE_TENANT_URL --body "https://refrescosbandeirantes.us10.hcs.cloud.sap"
gh variable set DATASPHERE_TOKEN_URL  --body "https://refrescosbandeirantes.authentication.us10.hana.ondemand.com/oauth/token"
gh variable set DATASPHERE_SPACE      --body "DW_BND_COM_SAP"
gh variable set DATASPHERE_ASSET      --body "AM_FAT_BND_ANALISE_META"
```

Depois: **Settings → Pages → Source: GitHub Actions**.

## Rodar localmente

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt
python scripts/descobrir.py                 # confere mapeamento (relatório em saida/descoberta/)
python scripts/gerar.py --rota 111 --forcar # gera só a rota 111 em saida/rota_111/
python scripts/gerar.py --forcar            # gera tudo em ../frontend/data
python -m unittest discover -s tests -t .   # testes (sem rede)

cd ../frontend && python -m http.server 8000   # abre http://localhost:8000
```

Opções úteis do `gerar.py`: `--so-online`, `--saida DIR`, `--hoje AAAA-MM-DD` (simula a data, ex.: o
fechamento do mês; o cron não usa), `--fechamento "Setembro/26"` (só sobrepõe o rótulo da tag),
`--gravar-cache DIR` e `--replay DIR` (reprocessa respostas salvas, sem rede).

## Regras conferidas com os dados reais (13/10/2026)

- **Base de clientes**: versão corrente (`FL_CORRENTE = 'S'`) de clientes `Ativo` das gerências
  G1, G2, G3, AP e IT_MO (conferidas) e At, An, Sl, Rv, Pa_Di, Ur_Ri e Gu_Po (a confirmar). Supervisões de
  balcão (`Sv. Bl.`) e rotas eventuais (`EV*`) ficam fora, também na At. As gerências que vêm juntas na fonte
  (It_Mo, Pa_Di, Ur_Ri, Gu_Po) são separadas pelo código do supervisor.
- **Cobertura**: cliente com `FX_COBERTURA_REALIZADO > 0` no agrupador (13 agrupadores do painel).
- **Online**: medidas `*_WF_ONLINE` (pedidos de hoje). Em dia útil, das 07:00 às 18:45, se a consulta vier sem
  nenhum cliente online (o Datasphere em recarga: 0 às 09:28 de 19/10/2026, 199 rotas às 10:13) e o
  `online.json` publicado for do mesmo dia e tiver dados, ele fica (o vazio não é gravado) e o log avisa.
- **Metas**: `META_COBERTURA_Chave_Meta_SAP` (ICS e Novos Negócios), `META_VOLUME_Chave_Meta_SAP` (meta
  de volume da rota), `META_NEG` (curva diária e meta por cliente da barra de volume) e
  `META_RECUPERAVEL_ROTA` (meta do dia do volume).
- **Venda Zero**: geladeiras `Total Ko` / Fountain em `Concluído(Contrato)` com `Giro Zero`
  (rota 111: os mesmos 67 equipamentos do painel antigo).

## Gerências e telas

16 gerências, nesta ordem em todo o painel: GC.AN · Anápolis, GC.AP · Aparecida, GC.AT · Atacados, GC.G1 · Goiânia 01,
GC.G2 · Goiânia 02, GC.G3 · Goiânia 03, GC.PA · Palmas, GC.DI · Dianópolis, GC.RV · Rio Verde, GC.SL · São Luís,
GC.GU · Gurupi, GC.PO · Porangatu, GC.IT · Itumbiara, GC.MO · Morrinhos, GC.UR · Uruaçu e GC.RI · Rialma (lista e
nomes em `backend/gerador/mapeamento.py`, `GC_NOMES`, enviados no payload). Não há visão por região.

### Entrada com perfis

> **Controle de acesso interno: organiza o que cada perfil vê; NÃO é segurança — os dados estão em
> frontend/data/*.json. A Gerência entra pela sigla ou pelo nome da filial. O acesso fica guardado no aparelho
> até a virada do dia (05:00, horário de Brasília) ou até clicar na casa.**

O painel abre na **entrada**, com quatro botões (o sol/lua troca só o fundo da entrada, preto ou branco, e o
aparelho guarda a escolha em `drotas_entrada`):

| Perfil | Pede | Abre |
|---|---|---|
| DIRETORIA | Usuário `DICOM` (sem senha; maiúsculas, minúsculas e espaços não importam) | a visão Diretoria |
| GERÊNCIA | Gerência | a visão Gerência com a gerência travada (sem seletor de gerência); supervisão e rota livres |
| SUPERVISÃO | Gerência + número da supervisão (G2 e 1 → SV.G2.1) | gerência e supervisão travadas; só o filtro das rotas dela; cascata card → rotas → clientes |
| ROTA | Gerência + código da rota (G2 e 211, I11, M21) | gerência, supervisão e rota travadas, sem filtros e sem Resumo; cascata card → clientes |

- **Gerência** (campo de texto, sem lista): a sigla (G2, AT, IT...) ou o nome da filial (Goiânia 02, Itumbiara,
  Rio Verde...), de `GC_NOMES`. A comparação ignora acentos, maiúsculas, espaços, pontos, o prefixo "GC" e zeros
  à esquerda ("GC.G2", "goiania 2" e "Goiânia 02" são a G2), mas tem de ser exata: "goiania" sozinho não é
  nenhuma. Gerência sem dados no painel não entra.
- **Supervisão** só vale se aparece no painel (não vale a SV.G3.3 nem a linha "Neutraliza"). **Rota** vale se
  aparece no painel da gerência, inclusive rota Neutraliza; rota virtual (A42, A43, A44, R32) ou de outra gerência
  não vale. Em todos os casos, a mensagem de erro aparece e a tela fica na entrada.
- O cabeçalho mostra o contexto (ex.: "Supervisão · GC.G2 · Goiânia 02 · SV.G2.1 · Nome"). O "puxa a média" e o
  Resumo seguem a lógica da visão Gerência (na Supervisão, a rota que mais puxa a média e o Resumo da supervisão;
  na Rota, sem os dois).
- **Acesso guardado** (`localStorage` `drotas_sessao`: perfil, gerência, supervisão, rota e o dia; nada de nomes,
  senha ou token): recarregar a página reabre o mesmo perfil e contexto (Diretoria em "Todas as gerências"; os
  outros filtros e a cascata voltam ao padrão), sem piscar a entrada. A **casa** vermelha apaga o acesso e volta
  para a entrada (é a única forma manual de voltar). Sem armazenamento no aparelho, a entrada aparece a cada visita.
- **Virada diária**: o acesso vale para o "dia de trabalho", que vira às **05:00 de Brasília** (independente do
  fuso do aparelho; `CONFIG.SESSAO_VIRADA_HORA`). Acesso de outro dia (ou sem o dia) volta para a entrada com
  "Acesso reiniciado, entre novamente"; com o painel aberto, isso é conferido ao voltar para a aba e a cada
  atualização do online (não reinicia por inatividade). Acesso que não vale mais no payload (gerência sem dados,
  supervisão ou rota que saiu) volta para a entrada com "O acesso anterior não está mais disponível".
- **Links do Resumo** (`?resumo=...`) abrem o Resumo direto, sem passar pela entrada e sem mexer no acesso
  guardado; ao fechar o Resumo, o painel segue como numa visita nova (o acesso guardado ou a entrada).

### Telas

- **Gerência**: filtros de supervisão e rota (a gerência é a do login).
- **Diretoria**: filtro "Todas as gerências" (cards com o total das 16) ou uma gerência (cards só dela; a cascata
  começa nas supervisões, com a linha "Neutraliza" e a nota das virtuais). Volta para "Todas" ao reabrir a Diretoria.
- **Cascata**: clicar num card abre gerências → supervisões → rotas → clientes, a partir do nível do filtro,
  com botões para subir um nível. Cada linha mostra Meta e Real, Online e meta do dia (verde quando o online
  bate a meta do dia) e a tendência (no fechamento do mês, o % realizado). **Ordem fixa, pelo código** (também no
  fechamento): gerências na ordem acima; supervisões e rotas em ordem crescente natural (SV.G1.2 antes de SV.G1.10;
  111, 112...; A11, A12...; I11...), com a linha "Neutraliza" sempre por último. Na lista de clientes de volume:
  Meta, Real (faturado + online de hoje), diferença e %, do mais negativo para o mais positivo; listas de cobertura
  e de Venda Zero como antes.
- **Rotas Neutraliza** (por rota, em qualquer gerência: A41, 431, 251, I31, M31, C31, R31, S31, U31, 151, O21 e
  551): Meta e Real de Volume, ICS GC e Novos Negócios entram no total da gerência (e da Diretoria). Na cascata,
  ao abrir as supervisões de uma gerência, a última linha é **"Neutraliza"** (todas as rotas Neutraliza da
  gerência juntas: Meta, Real, Online, meta do dia e tendência, com o nº de rotas); dentro dela, as rotas e,
  dentro de cada rota, os clientes. O filtro de supervisão tem a opção "Neutraliza" (cards só dessas rotas).
  Os clientes delas aparecem na busca (tag de geladeira e Desempenho GDM). Ficam fora das supervisões, do
  Resumo de vendas (nenhuma coluna; os números seguem no total da gerência), do "puxa a média" e da Venda Zero
  (card, listas, contagens e revertidos). A 551 não tem cliente corrente na base (só histórico na Ap/At) e
  por isso não aparece; se voltar, entra como Neutraliza.
- **Rotas virtuais** (A42, A43, A44, R32): ocultas em todo o painel (cascata, listas, filtros, busca e Resumo);
  Volume, ICS GC e Novos Negócios só no total da gerência; fora da Venda Zero. Para a conta fechar, a cascata
  traz no fim das supervisões uma nota discreta só com os números delas (ex.: "Inclui rotas virtuais: Meta 56.453 ·
  Real 11.733"), sem rotas nem clientes: linhas + nota = card.
- Supervisão que só tem rotas Neutraliza ou virtuais (SV.G1.5, SV.AN.4...) não aparece; a que mistura soma só
  as rotas normais. SV.G3.3 continua oculta. Na gerência **AT** nenhuma supervisão é oculta (a 431 vai para a
  linha "Neutraliza"; a 411 é rota normal).
- **Del Valle Frut** (agrupador "Del Valle Frut"): card de volume só na G2 (inclusive por supervisor e rota), com
  as mesmas regras de volume e nunca somado aos 5 agrupadores; fora do Resumo e da Diretoria. Sem META_VOLUME
  nem META_NEG do agrupador na G2, o card não aparece e o gerador avisa no log.
- **Desempenho GDM** (busca de cliente, aba Volume): Real = faturado do mês + online de hoje em Refrigerantes,
  Água Mineral, Sucos, Ades e Powerade; Meta = META_EQPTO das geladeiras Total Ko. Tag e cor pela situação da
  geladeira (GIRO_STATUS_MES_ATUAL): Giro Zero = vermelho "Venda Zero · x geladeira(s)"; Baixo Giro = amarelo;
  Giro Ok = preto/verde; < 30 dias = cinza, quadrinho pela venda do mês. Rede soma as lojas com geladeira.
- **Resumo de vendas**: segue o filtro; na Diretoria com "Todas as gerências", as 16 lado a lado em faixas de 8;
  com uma gerência no filtro, o resumo dela (gerência + supervisões); no perfil Supervisão, o da supervisão (e
  das rotas dela); no perfil Rota, sem o botão. A placa ATENÇÃO existe, mas está desligada
  (`CONFIG.LIMIAR_ATENCAO = null`).
- Rodapé: "Karen Oliveira - Inteligência de Mercado".

Testes do front: `node --test frontend/tests/front.test.js` (Chromium headless com `playwright`; usa dado
sintético gerado pelo próprio back-end em `frontend/tests/sintetico.py`; a virada diária é testada com o relógio
simulado do Playwright, com o navegador em UTC e em America/Sao_Paulo).

## Volume: tendência pelo critério do SAC

Por rota × macro de volume (Refrigerantes, Cervejas, Still, Água Mineral, Dest+Art+Cnd):

| Campo | Conta |
|---|---|
| Meta | `META_VOLUME_Chave_Meta_SAP`: a meta da rota (o SAC mostra ela no campo "Meta NEG") |
| Vol Real | `FX_VOL_PADRAO_FAT` do mês com `NF_STATUS_Nota_Fiscal` em Acertado, Meta Neg ou Em Aberto |
| Neg Restante | `META_NEG` de hoje até o fim do mês pela rota da meta (`CD_ROTA_Chave_Meta_SAP`), direto quando a `META_NEG` do mês fica a até 1% da Meta; senão Meta × (restante ÷ mês) |
| Tendência | Vol Real + Neg Restante |
| % Tendência | Tendência ÷ Meta; verde a partir de 100% |
| Dif | Vol Real − Meta |
| Meta do dia | `META_RECUPERAVEL_ROTA` por rota com `DATA_MOVIMENTO` = hoje (sem a medida, fica "—") |

A rota da meta é a mesma que o SAC usa: pela rota atual do cliente, quem foi transferido levaria a curva
para outra rota. Se a consulta pela rota da meta não funcionar, o gerador volta à curva pela rota do cliente
(sempre escalonada) e avisa. Casos-limite: rota com META_VOLUME mas sem META_NEG usa os dias úteis restantes (contando hoje) no lugar da
curva; rota sem META_VOLUME usa a soma de META_NEG como meta; sem nenhuma das duas, o indicador fica
indisponível. Cada caso aparece nos avisos da execução, assim como a meta da rota não distribuída nos
clientes, por gerência (META_VOLUME − soma de META_NEG).

Supervisão e gerência somam as rotas e recalculam o % (rotas Neutraliza e virtuais entram no total da
gerência, nunca na supervisão; as Neutraliza têm a linha "Neutraliza"). O volume online de hoje não entra na tendência: fica no quadro Online
e na coluna própria do Resumo de vendas. A **barra por cliente** (busca, aba Volume) é a exceção:
Real do cliente = Vol Real do cliente + volume online de hoje do cliente (`online.json` → `volumeCliente`),
sobre a META_NEG do cliente, com a mesma regra de cor (vermelho abaixo do ritmo do mês, amarelo até 100%,
verde a partir de 100%).

## Fechamento do mês (automático)

Do dia 1 do mês até o fim do 1º dia útil — e, a partir do 2º dia útil, enquanto alguma gerência ainda não
tiver `META_VOLUME` e `META_COBERTURA` do mês novo — o painel mostra o **mês anterior fechado**:
coberturas, volume (Meta da rota, Real, Dif e % realizado, sem tendência nem meta do dia) e listas do mês anterior,
calendário completo (dia útil = total, ritmo 100%), Venda Zero indisponível e a tag âmbar
"Fechamento Mês/AA". O quadro Online e os acompanhamentos que seguem o online (revertidos, sem compra hoje) usam os pedidos de
hoje. O 1º/2º dia útil vem do calendário do Datasphere (ou do cálculo local, se ele falhar). O input
`fechamento` do workflow só troca o rótulo da tag e não é necessário no dia a dia.

Para conferir com os dados reais (sem publicar nada): **Actions → Conferir tendência → Run workflow**
(opcional: `hoje` = 2026-11-01, 2026-11-03...). O artifact traz `relatorio_tendencia.md` (só totais e códigos de
rota/supervisão) e o `payload.json`/`online.json` que o gerador publicaria naquela data.

### Conferência contra a tela do SAC (seção 4 e E7)

**Como adicionar a tela do dia.** Copie os números da tela do SAC "Acompanhamento de Vendas - Refrigerantes" para
`backend/conferencia/sac/refri_AAAA-MM-DD.csv` (a data do relatório: a de hoje ou o input `hoje` do workflow) e
faça commit no branch que vai rodar o workflow. Formato (separador `;`):

```
# Tela do SAC "Acompanhamento de Vendas - Refrigerantes", 20/10/2026 ~09h (sigla da gerência)
GC;Real;Meta;Tendencia;MetaDia
AN;141599;400000;366114;13647
AP;157107;398000;367864;18505
```

- A primeira linha que começa com `#` diz a fonte e o horário (aparece no relatório); linhas vazias e outras com `#`
  são ignoradas. O cabeçalho é exatamente `GC;Real;Meta;Tendencia;MetaDia` (acento e maiúsculas tanto faz).
- `GC` = sigla do painel (AN, AP, ..., RI; "GC.AN" também vale). Números inteiros, com ou sem ponto de milhar
  (`141.599`), vírgula decimal se houver. Coluna sem o dado na tela: deixe vazia (ex.: `G1;125590;490003;406863;`)
  e essa célula não é comparada.
- Arquivo fora do formato (cabeçalho, nº de colunas, sigla desconhecida ou repetida, texto no lugar de número) dá
  um erro claro na seção 4 e a E7 não aparece. Sem o arquivo do dia, a seção 4 diz "sem tela do SAC para esta data".

**Seção 4 (aceite).** Por gerência do CSV, na ordem do painel, e o total (**TOTAL BAND** com as 16): Real, Meta,
Tendência, % e Meta do dia da API (as funções do gerador) contra o SAC, com OK/DIVERGE em cada comparação. Tolerâncias:
Real ±0,1%; Meta exata (inteiros arredondados); Tendência ±0,2%; % ±0,1 p.p.; Meta do dia ±1%.

**Seção E7 (diferenças contra o SAC, Refrigerantes; só com o CSV do dia).** Só relata, não muda o gerador:
- Diferença = **painel − SAC** (negativa: o SAC soma mais). O modelo de vendas é lido **sem filtros de escopo** (sem
  gerência, rota ou base de clientes): Real = `FX_VOL_PADRAO_FAT` do mês com os status do Vol Real; Meta do dia =
  `META_RECUPERAVEL_ROTA` de hoje.
- A primeira tabela testa qual coluna de gerência do modelo reproduz a tela (soma de |modelo − SAC| nas gerências do
  CSV); a menor é usada no resto da seção. Depois vem um resumo das hipóteses: (a) rotas que o SAC soma e o painel
  exclui, (b) rota atribuída a outra gerência, (c) Neutraliza, virtuais e supervisões ocultas (entram no total do
  painel; se o SAC também as soma, o resíduo fica perto de zero), (d) rota da meta ≠ rota do cliente.
- **E7a**: por gerência com diferença, painel, SAC, diferença, soma das contribuições e **resíduo** (diferença −
  contribuições). Resíduo perto de 0 = explicado; resíduo grande = há outra causa (ou a tela foi copiada em outro
  horário).
- **E7b**: as 12 maiores contribuições por gerência (e o total das demais), por rota do cliente no Real e por rota
  da meta na meta do dia, com a causa: `fora do painel: EV*`, `fora do painel: SV.BL.*`, `fora do painel: INVALIDO /
  G*E / G*F / APE`, `sem cliente corrente e ativo`, `oculta: SV.G3.3`, `Neutraliza (entra no total)`, `virtual
  (entra no total)`, `gerência do modelo ≠ gerência do painel (rota atribuída a outra gerência)`, `rota da meta ≠ rota
  do cliente` ou `outra: ...`. Sinal: − = só o SAC conta naquela gerência; + = só o painel.
- **E7c**: rotas do painel que o modelo põe em outra gerência e rotas fora do painel com clientes de outra gerência
  (ex.: a EV1 é da G1 na base, mas o cliente é da G2 no modelo), com uma linha sobre o par G2/G3.
- **E7d**: uma linha por gerência: "explicado por: <causa> (<valor> cx)" e o resíduo.
- Só códigos de rota, supervisão e gerência: nunca nomes nem códigos de clientes.
- Em 20/10/2026 a E7 explicou tudo (resíduo ≤ 1 cx): o SAC soma pela gerência comercial do cliente
  (`DS_GERENCIA_COMERCIAL_AT_Clien`) e inclui os clientes que estão em rotas EV*; o painel não (Real −407 cx nas 16;
  meta do dia −1.071 cx, que é de rotas do painel mas está em clientes das EV*). Nada mudou no painel por isso.

Diferenças em relação ao arquivo que era montado à mão:
- **Visitas de hoje**: vêm do campo `VISITA_HOJE` do SAP e incluem clientes com mais de um dia de
  visita (ex.: "Ter - Sex"); o arquivo antigo só contava quem tinha exatamente o dia de hoje.
- **Meta de Venda Zero**: o Datasphere só tem a meta por gerência; o gerador reparte entre as
  rotas na proporção das geladeiras (diferença de até ±1 por rota em relação ao arquivo antigo).
- **Metas da G3** e a rota nova **151** (SV.G1.5) refletem o que está hoje no Datasphere.

## Quando o modelo do Datasphere mudar

1. Rode `python scripts/descobrir.py` e abra `backend/saida/descoberta/relatorio.md`.
2. Ajuste nomes de coluna, apelidos de agrupador ou filtros em `backend/gerador/mapeamento.py`.
3. Rode os testes e `gerar.py --rota 111 --forcar` para comparar com o painel.

## Segurança

- Nunca versione `backend/.env`. As credenciais ficam só em Secrets no GitHub.
- O secret do OAuth Client circulou em texto: peça a rotação no Datasphere e
  atualize o Secret `DATASPHERE_CLIENT_SECRET`.
- O repositório é público: `payload.json` contém nomes e códigos de clientes.
- A entrada com perfis (DICOM, gerência, supervisão, rota) é só organização interna, não protege os dados:
  quem tiver o endereço de `frontend/data/*.json` lê tudo.
