# Desempenho de Rotas · Comercial Bandeirantes

Painel de desempenho por rota (ICS GC, Novos Negócios, Volume e Venda Zero) das 16 gerências,
publicado no GitHub Pages e alimentado automaticamente pelo **SAP Datasphere** via OData.

```
desempenho/
├── frontend/                 site estático (GitHub Pages)
│   ├── index.html
│   ├── css/app.css
│   ├── js/config.js          URLs dos dados, intervalos, regiões, placa ATENÇÃO, CDN (com SRI)
│   ├── js/app.js             painel (entrada, filtros, cards, cascata, busca, Desempenho GDM)
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

## Gerências, regiões e telas

16 gerências em 3 regiões: **Matriz** G1, G2, G3, AT, AP · **Sul** AN, SL, RV, MO, IT · **Norte** RI, UR, GU,
PO, PA, DI (lista em `backend/gerador/mapeamento.py`, enviada no payload). O painel abre na **entrada**
(DIRETORIA ou GERÊNCIA; o botão sol/lua troca só o fundo da entrada, preto ou branco, e o aparelho guarda a
escolha). A casa vermelha do topo volta para a entrada.

- **Gerência**: filtros de gerência (as sem dados aparecem desabilitadas), supervisão e rota.
- **Diretoria**: total das 16 gerências (ou de uma região) nos cards.
- **Cascata**: clicar num card abre gerências → supervisões → rotas → clientes, a partir do nível do filtro,
  com botões para subir um nível. Cada linha mostra Meta e Real, Online e meta do dia (verde quando o online
  bate a meta do dia) e a tendência, da maior para a menor (no fechamento do mês, o % realizado). Na lista de
  clientes de volume: Meta, Real (faturado + online de hoje), diferença e %, do mais negativo para o mais positivo.
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
- **Resumo de vendas**: segue o filtro; na Diretoria, gerências lado a lado em faixas de 8 e seletor para gerar o
  resumo de uma gerência sem mudar o painel. A placa ATENÇÃO existe, mas está desligada
  (`CONFIG.LIMIAR_ATENCAO = null`).
- Rodapé: "Karen Oliveira - Inteligência de Mercado".

Testes do front: `node --test frontend/tests/front.test.js` (Chromium headless com `playwright`; usa dado
sintético gerado pelo próprio back-end em `frontend/tests/sintetico.py`).

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
(opcional: `hoje` = 2026-11-01, 2026-11-03...). O artifact traz `relatorio_tendencia.md` (só totais) e o
`payload.json`/`online.json` que o gerador publicaria naquela data.

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
