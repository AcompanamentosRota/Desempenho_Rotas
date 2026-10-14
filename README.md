# Desempenho de Rotas · Comercial Bandeirantes

Painel de desempenho por rota (ICS GC, Novos Negócios, Volume e Venda Zero),
publicado no GitHub Pages e alimentado automaticamente pelo **SAP Datasphere** via OData.

```
desempenho/
├── frontend/                 site estático (GitHub Pages)
│   ├── index.html
│   ├── css/app.css
│   ├── js/config.js          URLs dos dados, intervalos, supervisões excluídas, CDN (com SRI)
│   ├── js/app.js             painel (filtros, cards, indicadores, drawer, busca)
│   ├── js/resumo.js          "Resumo de vendas" + PDF
│   ├── js/main.js            carga e atualização periódica dos JSONs
│   ├── assets/, manifest.webmanifest
│   └── data/payload.json, data/online.json   ← gerados pelo back-end
├── backend/                  gerador Python (roda no GitHub Actions)
│   ├── odata/                cliente OData (copiado do kit Teste_ODATA)
│   ├── gerador/              consulta, normalização, fórmulas, montagem, validação
│   ├── scripts/gerar.py      gera os JSONs
│   ├── scripts/descobrir.py  confere o mapeamento contra os dados reais
│   └── tests/                testes sem rede (unittest)
├── .github/workflows/
│   ├── atualizar-dados.yml   cron 15 min, seg-sex, 07h-18h45 (Brasília)
│   ├── deploy-pages.yml      publica frontend/ no Pages
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

Opções úteis do `gerar.py`: `--so-online`, `--fechamento "Setembro/26"`,
`--gravar-cache DIR` e `--replay DIR` (reprocessa respostas salvas, sem rede).

## Regras conferidas com os dados reais (13/10/2026)

- **Base de clientes**: versão corrente (`FL_CORRENTE = 'S'`) de clientes `Ativo` das gerências
  G1, G2, G3, AP e IT_MO. Supervisões de balcão (`Sv. Bl.`) e rotas eventuais (`EV*`) ficam fora.
  IT e MO vêm juntas na fonte e são separadas pelo código do supervisor.
- **Cobertura**: cliente com `FX_COBERTURA_REALIZADO > 0` no agrupador (13 agrupadores do painel).
- **Online**: medidas `*_WF_ONLINE` (pedidos de hoje).
- **Metas**: `META_COBERTURA_Chave_Meta_SAP` (ICS e Novos Negócios), `META_VOLUME_Chave_Meta_SAP`
  (volume), `META_DIA` (meta do dia) e `META_NEG` por cliente (barra de volume por cliente).
  Na rota 111 todas bateram com o painel antigo.
- **Venda Zero**: geladeiras `Total Ko` / Fountain em `Concluído(Contrato)` com `Giro Zero`
  (rota 111: os mesmos 67 equipamentos do painel antigo).

Diferenças em relação ao arquivo que era montado à mão:

- **Tendência de volume**: o modelo não traz a curva diária por rota, então a projeção é linear
  (realizado até ontem ÷ dias úteis fechados × dias úteis do mês). O arquivo antigo usava outro
  cálculo e mostrava percentuais maiores.
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
