# Desempenho de Rotas · Comercial Bandeirantes

Painel de desempenho por rota (resumo Executivo, Volume, ICS GC, Novos Negócios, Todos a Bordo e Venda Zero) das 16
gerências, publicado no GitHub Pages e alimentado automaticamente pelo **SAP Datasphere** via OData.

```
desempenho/
├── frontend/                 site estático (GitHub Pages)
│   ├── index.html
│   ├── css/app.css
│   ├── js/config.js          URLs dos dados, intervalos, aviso de versão, placa ATENÇÃO, aba Todos a Bordo, linha Status, entrada (grupos, virada), CDN
│   ├── js/nucleo.js          agregação pura dos cards (sem DOM nem online; usada pelo painel e pelo Painel de Ritmo)
│   ├── js/app.js             painel (entrada por seleção, filtros, aba Executiva, cards, cascata, busca, Desempenho GDM)
│   ├── js/resumo.js          "Resumo de vendas" + PDF
│   ├── js/ritmo.js           "Painel de ritmo": PDF matinal só com dados reais
│   ├── js/main.js            carga e atualização periódica dos JSONs
│   ├── assets/ (ícones, logos da entrada; fonts/ = Inter local + OFL), manifest.webmanifest
│   ├── tests/                testes de front (Chromium headless, dado sintético; conferência da Executiva e das gavetas com dado real sob demanda)
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
│   ├── deploy-pages.yml      publica frontend/ no Pages (com a versão do código: scripts/versao-front.sh)
│   ├── conferir-tendencia.yml  manual: relatório da tendência/fechamento, E9 e E10 (artifact, sem commit)
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
   (com ETag, só baixa quando mudou). Ao voltar para a aba ou reabrir o app da tela inicial, o online é
   buscado na hora e o payload também, se o último tiver mais de 15 min (no iPhone os temporizadores param
   com o app fechado).

### Versão do código e aviso de versão nova

Quem deixa o painel aberto (ou instalado na tela inicial do celular, onde não dá para puxar a tela para
atualizar) vê quando há versão nova do **código** e atualiza com um toque.

- **Versão** = hash curto (12 caracteres) do conteúdo de `frontend/` **sem `frontend/data/**`**
  (`.github/scripts/versao-front.sh`: arquivos em ordem `LC_ALL=C`, `sha256sum` de cada um com o caminho relativo,
  `sha256sum` da lista). Não é o SHA do commit: a atualização automática de dados faz commit a cada 15 min, mas
  **mudança só de dados não muda a versão e não dispara o aviso**.
- O `deploy-pages.yml` (push em `frontend/**` e `workflow_call` do "Atualizar dados", o mesmo passo) roda
  `versao-front.sh --gravar frontend` antes de enviar o artefato do Pages: grava `frontend/versao.json`
  (`{"versao": "<hash>", "gerado": "<UTC ISO>"}`) e troca o marcador do `index.html`
  (`<meta name="versao" content="dev">`) pelo hash. Nada disso é commitado; em desenvolvimento e nos testes fica
  `"dev"`, e com `"dev"` o aviso fica desligado (nem pede o `versao.json`).
- O painel confere o `versao.json` (sem cache: `cache: 'no-store'` e `?t=` para furar o CDN) a cada atualização do
  online (5 min), ao voltar para a aba/app e no `pageshow`. Falha de rede ou 404: silêncio.
- Versão do servidor diferente da do painel: faixa discreta **acima do cabeçalho** (no PC, no alto do conteúdo, à
  direita do painel lateral), "Nova versão disponível" +
  **Atualizar** + **Depois**. "Depois" esconde a faixa daquela versão até a 1ª verificação 30 min depois
  (`CONFIG.VERSAO_ADIA_MS`); volta se a versão continuar diferente (outra versão nova aparece já). A faixa não
  aparece na tela de entrada (a checagem roda em segundo plano e ela aparece ao abrir o painel) e segue o fundo da
  entrada (preto ou branco).
- **Ícone ↻** no canto do cabeçalho (no PC, no rodapé do painel lateral), ao lado da casa, sempre visível ("Atualizar o painel"): mesma ação do
  "Atualizar" da faixa. A ação mostra "Atualizando…", baixa de novo sem o cache do navegador (`cache: 'reload'`) a
  página, CSS, JS, manifest, `versao.json` e os dois JSONs de dados e só então recarrega; se algum falhar, mostra
  "Sem conexão. Tente de novo." e não recarrega. Nenhuma chave do `localStorage` é apagada: o acesso guardado
  (`drotas_sessao`) e o fundo da entrada (`drotas_entrada`) ficam, e o painel reabre no mesmo perfil e contexto.

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
  (It_Mo, Pa_Di, Ur_Ri, Gu_Po) são separadas pelo código do supervisor. O Real de volume dos clientes que estão
  numa rota EV* entra no total da gerência deles (ver "Clientes em rotas eventuais" abaixo).
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

> **Controle de acesso interno: a entrada só organiza o que cada perfil vê, sem usuário; só a Diretoria pede senha.
> NÃO é segurança — os dados estão em frontend/data/*.json e qualquer um com o endereço lê tudo. O acesso fica
> guardado no aparelho até a virada do dia (05:00, horário de Brasília) ou até clicar na casa.**

O painel abre na **entrada**, com quatro botões (o sol/lua troca só o fundo da entrada, preto ou branco, e o
aparelho guarda a escolha em `drotas_entrada`). Gerência, Supervisão e Rota abrem uma **caixa de seleção** (nada é
digitado; fecha no ×, no ESC ou clicando fora; a lista rola dentro da caixa; funciona no celular).

**Senha da Diretoria** (desde 22/10/2026): o botão DIRETORIA abre a mesma caixa com um campo **Senha** e o botão
**Entrar** (foco no campo; Enter confirma; ESC, ×, clique fora e "← Voltar" fecham). Valem **duas senhas**, sem
diferenciar maiúsculas de minúsculas e ignorando espaços nas pontas. Senha errada, vazia ou só com espaços: "Senha
incorreta", o campo é limpo e o foco volta nele (continua na entrada). As senhas **não ficam no repositório**: em
`frontend/js/config.js` há só os hashes (`CONFIG.DIRETORIA_SENHAS_HASH`), SHA-256 em hex minúsculo de `drotas:` + a
senha sem espaços nas pontas e em MAIÚSCULAS (UTF-8; `hashSenha` em `app.js`, com `crypto.subtle`). Para trocar uma
senha, calcule o hash dela da mesma forma e troque a linha (ex.: no console do navegador, com o painel aberto,
`await hashSenha('nova senha')`). Sem `crypto.subtle` (página aberta por um endereço não seguro, sem https) aparece
"Abra o painel pelo endereço seguro (https)" e a Diretoria não abre. **Não é segurança**: só organiza quem abre a
visão Diretoria; os dados continuam públicos em `frontend/data/*.json`. Os testes usam senhas fictícias
(`frontend/tests/senha_teste.js`), servindo o `config.js` com os hashes delas.

**Nome de quem entra na Diretoria** (desde 29/10/2026): `CONFIG.DIRETORIA_NOMES` liga cada hash de
`DIRETORIA_SENHAS_HASH` a um nome (mapa hash → nome; a senha nunca aparece em texto). `confereSenha` usa o hash que já
calculou para achar o nome e o cabeçalho mostra **"Diretoria · Nome"** no `#sub` (painel lateral do PC e topo do celular;
no celular, sem a gerência escolhida no seletor, que continua logo abaixo). Hash sem nome no mapa: só "Diretoria", como
antes (no celular o escopo some, como antes). O acesso guardado (`drotas_sessao`) leva só o nome (`quem`), nunca a senha
nem o hash; um nome guardado que não está no mapa não aparece. Recarregar no mesmo dia mantém o nome; a casa e a virada
das 05:00 apagam. Para trocar a senha de alguém, troque o hash nas duas chaves. Os testes servem um `DIRETORIA_NOMES` com
nomes fictícios para os hashes das senhas de teste (`trocaNomes`/`NOMES_TESTE` em `senha_teste.js`; padrão: nenhum nome).

**Logos** (desde 21/10/2026, Etapa 7): acima de "Desempenho de Rotas", a logo Coca-Cola Bandeirantes e o elmo com
"COMERCIAL / BANDEIRANTES" embaixo, lado a lado, separados por uma linha vermelha fina. No fundo preto (padrão) vão a
logo com "BANDEIRANTES" em branco, o elmo branco e o texto branco; no fundo branco, a logo original, o elmo preto e o
texto preto. O sol/lua troca as duas imagens e a cor do texto junto com o fundo. Telas de até 380 px usam as imagens um
pouco menores (logo 52 px de altura e elmo 34 px; nas demais, 62 e 40 px). Arquivos em `frontend/assets/`
(`coca-bandeirantes-fundo-escuro.png`, `coca-bandeirantes-fundo-claro.png`, `elmo-branco.png`, `elmo-preto.png`; no
tamanho original, 560x251 e 140x263 px, otimizados: ~95 KB os quatro, eram ~220 KB). Leitores de tela: "Coca-Cola
Bandeirantes" (logo) e "Comercial Bandeirantes" (elmo e texto).

**Escopo do nível acima na Executiva** (Etapa 6 do pacote v3, 30/10/2026): a entrada não muda (a Gerência escolhe a
gerência e entra nela; a Supervisão escolhe a gerência e a supervisão e entra travada nela). Só dentro da aba Executiva há
um botão de escopo no cabeçalho fixo: a Gerência alterna **"GC.<dela> | BAND"** (grupo: "GC.IT + GC.MO | BAND"; BAND = todas
as gerências com dados, a mesma visão da Diretoria "Todas") e a Supervisão, **"SV.<dela> | GC.<dela>"** (o total da gerência
dela, a mesma visão do perfil Gerência). As outras abas, o Resumo, o Painel de Ritmo, o acesso guardado e a validação do
acesso continuam no acesso; com o nível de cima marcado, o filtro de supervisão/rota do painel lateral não altera a
Executiva. Cada entrada (e reabrir a página) começa no escopo do acesso. Diretoria e Rota não têm o botão.

**Aba inicial** (desde a Etapa 5): ao entrar (e ao reabrir pelo acesso guardado), Diretoria, Gerência e Supervisão abrem na
aba **Executiva** (visão executiva; o botão leva o nome do perfil: **Diretoria**, **Gerencial** ou **Supervisão**); a
Rota, que não tem a Executiva, abre no **Volume**.

| Perfil | Escolhe | Abre |
|---|---|---|
| DIRETORIA | nada; digita a senha | a visão Diretoria de hoje, em "Todas as gerências" |
| GERÊNCIA | a gerência (ou o grupo) | a visão Gerência com a gerência travada (sem seletor de gerência); supervisão e rota livres. No grupo: o total das duas e o seletor Total / uma delas |
| SUPERVISÃO | a gerência (ou o grupo) e depois a supervisão | gerência e supervisão travadas; só o filtro das rotas dela; cascata card → rotas → clientes |
| ROTA | a gerência (ou o grupo) e depois a rota | gerência, supervisão e rota travadas, sem filtros e sem Resumo; cascata card → clientes |

- **Gerências na caixa** (12 opções, na ordem do painel): GC.AN, GC.AP, GC.AT, GC.G1, GC.G2, GC.G3,
  **GC.PA + GC.DI**, GC.RV, GC.SL, **GC.GU + GC.PO**, **GC.IT + GC.MO** e **GC.UR + GC.RI**, com o nome da praça
  ("GC.G1 · Goiânia 01", "GC.IT + GC.MO · Itumbiara + Morrinhos"). Os grupos são os pares que o Datasphere junta
  numa gerência só (Pa_Di, Gu_Po, It_Mo, Ur_Ri; `CONFIG.GC_GRUPOS` em `frontend/js/config.js`) e ficam na posição
  da primeira gerência do par. Gerência sem dados aparece desabilitada; o grupo fica habilitado se uma das duas
  tiver dados.
- **Gerências liberadas** (desde 27/10/2026, por enquanto): por Gerência, Supervisão e Rota só abrem **GC.G1, GC.G2,
  GC.G3, GC.AP e GC.IT + GC.MO**. As demais continuam na caixa, desabilitadas, com "· em breve" (no lugar de "· sem
  dados"), e um acesso guardado delas volta para a entrada com "O acesso anterior não está mais disponível". A
  Diretoria continua vendo todas. A lista é `CONFIG.GC_LIBERADAS` em `frontend/js/config.js`: para liberar outra
  gerência, acrescente a sigla (num grupo, as duas: `'PA', 'DI'`); `null` libera todas.
- **Grupo na Gerência**: abre com o **Total** das duas gerências (cards, cascata e listas somam as rotas das duas,
  com as Neutraliza, virtuais e eventuais de cada uma; uma linha "Neutraliza" só, com as das duas; o "puxa a média"
  compara as supervisões das duas). O seletor do cabeçalho tem três opções, "Total (GC.IT + GC.MO)", "GC.IT ·
  Itumbiara" e "GC.MO · Morrinhos": escolher uma gerência filtra todas as telas para ela (os filtros de supervisão e
  rota ficam dentro da escolha). Cabeçalho: "Gerência · GC.IT + GC.MO · Itumbiara + Morrinhos" (ou a gerência
  escolhida). Resumo de vendas: no Total, as duas gerências lado a lado (como o da Diretoria); com uma, o dela.
- **Supervisão e Rota** em duas etapas: escolhida a gerência (ou o grupo), a caixa lista as supervisões ("SV.G2.1 ·
  Nome") ou as rotas ("Rota 211 · Consultor") que aparecem no painel dela (no grupo, as das duas, primeiro as de uma
  gerência e depois as da outra; supervisões pelo número, rotas em ordem natural), com "← Gerências" para voltar.
  Não aparecem a SV.G3.3, a linha "Neutraliza", supervisões só de rotas Neutraliza/virtuais, rotas virtuais (A42,
  A43, A44, R32) nem as rotas ocultas das eventuais ('-EV'); as rotas Neutraliza aparecem (como no painel).
- O cabeçalho mostra o contexto (ex.: "Supervisão · GC.G2 · Goiânia 02 · SV.G2.1 · Nome"). O "puxa a média" e o
  Resumo seguem a lógica da visão Gerência (na Supervisão, a rota que mais puxa a média e o Resumo da supervisão;
  na Rota, sem os dois).
- **Acesso guardado** (`localStorage` `drotas_sessao`: perfil, gerência, supervisão, rota, o dia e a versão `v: 2`;
  nada de nomes, senha, hash ou token; no grupo, a gerência é a chave do grupo, ex.: `IT+MO`): recarregar a página
  reabre o mesmo perfil e contexto (Diretoria em "Todas as gerências", sem pedir a senha de novo no mesmo dia de
  trabalho; grupo no Total; os outros filtros e a cascata voltam ao padrão), sem piscar a entrada. Acesso de
  Diretoria guardado antes da senha (sem `v`) é descartado: a entrada aparece com "Digite a senha para entrar na
  Diretoria". Os de Gerência, Supervisão e Rota guardados antes continuam valendo. A **casa** vermelha apaga o acesso e volta para a entrada (é a única forma manual
  de voltar). Sem armazenamento no aparelho, a entrada aparece a cada visita.
- **Virada diária**: o acesso vale para o "dia de trabalho", que vira às **05:00 de Brasília** (independente do
  fuso do aparelho; `CONFIG.SESSAO_VIRADA_HORA`). Acesso de outro dia (ou sem o dia) volta para a entrada com
  "Acesso reiniciado, entre novamente"; com o painel aberto, isso é conferido ao voltar para a aba e a cada
  atualização do online (não reinicia por inatividade). Acesso que não vale mais pelas regras da caixa (gerência
  ou grupo sem dados, supervisão ou rota que saiu do painel, rota virtual ou '-EV') volta para a entrada com
  "O acesso anterior não está mais disponível".
- **Links do Resumo** (`?resumo=...`, também do grupo: `gc=IT%2BMO`) abrem o Resumo direto, sem passar pela
  entrada e sem mexer no acesso guardado; ao fechar o Resumo, o painel segue como numa visita nova (o acesso
  guardado ou a entrada).

### Telas

- **Gerência**: filtros de supervisão e rota (a gerência é a da entrada; num grupo, também o seletor Total / uma
  das duas).
- **Diretoria**: filtro "Todas as gerências" (cards com o total das 16) ou uma gerência (cards só dela; a cascata
  começa nas supervisões, com a linha "Neutraliza" e a nota das virtuais). Volta para "Todas" ao reabrir a Diretoria.
- **Cascata**: clicar num card abre gerências → supervisões → rotas → clientes, a partir do nível do filtro,
  com botões para subir um nível. **Na Diretoria** ("Todas as gerências"), tocar numa gerência abre direto a lista de
  clientes dela (GC > Clientes), em todas as abas, com a barra de dias e o limite das listas (`CONFIG.LIMITE_LISTA`); no
  Todos a Bordo, só as rotas com meta do item; virtuais e ocultas fora, como sempre. As supervisões de uma gerência continuam
  na Diretoria com a gerência no filtro; Gerência, Supervisão e Rota têm a cascata completa.
  Linha da cascata (desde a Etapa 3 do pacote v3; todas as abas menos a Venda Zero, que continua como antes): **Nome |
  Meta · Real | % | Dif (Real + Online) | Online · meta do dia**. % = o de sempre (volume: tendência; no fechamento, o
  realizado; coberturas: Real ÷ Meta), verde/vermelho pelo ritmo, como a faixa lateral; no celular, com "tendência" /
  "realizado" / "real da meta" embaixo. Dif = Real + online de hoje − Meta (volume: o faturado até ontem + o volume online;
  coberturas: clientes DISTINTOS no Real ou no online, quem já está coberto e comprou hoje conta uma vez), verde se >= 0,
  vermelho se < 0, e embaixo "x% da meta com online"; sem online: "—" e "sem online" (no fechamento, "sem online no
  fechamento"). Online · meta do dia: a caixa de sempre. **Selo "✓ META BATIDA"** (fundo verde-claro, faixa verde) quando
  Real + online >= Meta (Meta > 0); no fechamento (e sem online), Real >= Meta. A caixa do Online continua com o "Meta
  batida!" de sempre (abaixo). **Ordem padrão fixa, pelo código** (também no fechamento): gerências na ordem acima;
  supervisões e rotas em ordem crescente natural (SV.G1.2 antes de SV.G1.10; 111, 112...; A11, A12...; I11...), com a
  linha "Neutraliza" sempre por último; num grupo, as supervisões de uma gerência e depois as da outra (SV.UR.1, SV.UR.2,
  SV.RI.1...). Rotas virtuais e '-EV' nunca aparecem em lista. Reordenar é opção do usuário: no PC (>= 1000 px) o
  cabeçalho de colunas (caixa alta pequena: nível | Meta · Real | % tendência ou % real da meta | Dif (Real + Online) |
  Online · meta do dia) tem %, Dif e Online clicáveis (maior para o menor; 2º clique inverte; seta ↓/↑ em vermelho no
  ativo; o título da 1ª coluna volta ao código); no celular, chips "Ordenar: Código · % · Dif · Online". "Neutraliza" e
  grupos sem dados ficam no fim em qualquer ordem; a ordem vale enquanto a gaveta estiver aberta (descer e voltar mantém) e
  volta ao código ao abrir de novo. Venda Zero: sem cabeçalho e sem ordenação.
  Na lista de clientes de volume: **Cliente | Meta | Real | Online | Dif. Abs | %** (Real = só o faturado do mês; Online
  = volume online de hoje do cliente, verde com valor, "—" no fechamento; Dif. Abs = (Real + Online) − Meta e % = (Real +
  Online) ÷ Meta, como antes), do mais negativo para o mais positivo, com a barra de dias de visita (abre em "Todos"; ver
  "Gavetas com barra de dias"); no celular, nome e "segmento · rota" em cima e os 5 números embaixo, alinhados ao
  cabeçalho. Listas de cobertura e de Venda Zero como antes.
- **Cards** (Volume e coberturas, também os do Todos a Bordo, só com as rotas com meta do item): Meta, Real e
  **"Diferença" = (Real + online de hoje) − Meta** (pedido da Karen, 29/10/2026; a mesma conta da Dif da cascata, `realOnline`
  em app.js: volume = faturado até ontem + volume online; coberturas = clientes distintos no Real ou no online), verde se >= 0
  e vermelho se < 0, com o estilo de sempre. No fechamento e sem online, a Diferença é Real − Meta, como antes; a Venda Zero
  não muda. O % do card, o "faltam", as oportunidades e a caixa do Online não mudam (o % continua só com o Real).
- **"Meta batida!"**: no card e nas linhas da cascata (gerência, supervisão, rota e "Neutraliza"), o rótulo da caixa
  do Online vira "Meta batida!" e a caixa fica verde quando, no nível (números já somados):
  - **volume** (os 5 agrupadores e Del Valle Frut): a meta do dia é zero ou negativa;
  - **coberturas** (ICS GC e Novos Negócios): o Real do mês já alcançou a Meta do mês (Real >= Meta, com meta).
    A "meta do dia" da cobertura (o que falta hoje ou a fatia do mês) nunca fica abaixo de 1 quando há meta, por
    isso a regra é pela meta do mês.

  O número do online continua aparecendo e somando; nenhum valor muda (meta do dia, metas e totais iguais aos do
  SAC). Fora disso, como antes (volume: verde se o online alcança a meta do dia; cobertura: "no ritmo" ou "meta do
  dia X"); sem meta do dia, meta 0, Venda Zero e fechamento do mês: como antes. O Resumo de vendas não muda.
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
- **Clientes em rotas eventuais (EV*)** (desde 20/10/2026, como o SAC): a rota EV continua fora do painel, mas o
  Real de volume (os 5 grupos; Del Valle Frut só na G2) dos clientes que estão nela entra no total da gerência
  comercial do cliente (`DS_GERENCIA_COMERCIAL_AT_Clien`), numa rota oculta por gerência (ex.: `AP-EV`), sem meta,
  sem clientes e fora da Venda Zero e do online. A tendência da gerência sobe o mesmo valor (sem Neg Restante). Desde
  27/10/2026, só as vendas com chave de meta (rota da meta preenchida), como o Flash de Vendas do SAC: as vendas sem
  meta nessas rotas (quase todas "Venda A Consumidor Final", como a venda a funcionário da EVF na G3) ficam fora do
  volume; o log do gerador lista o que saiu por gerência e rota ("Vol Real de rotas EV* sem rota da meta"). Desde
  26/10/2026 os **clientes cobertos** deles também entram no Real da gerência e da Diretoria no ICS GC, em Novos
  Negócios e no Todos a Bordo (meta igual, então o % sobe; no Todos a Bordo, só onde a gerência tem rota com meta do
  item). Na cascata, ao abrir as supervisões, uma nota mostra o valor: "Inclui clientes de rotas eventuais (EV*):
  Real 149" (linhas + notas = card), no volume e nas coberturas. Supervisões e rotas não mudam.
- **Notas fiscais canceladas não contam** (desde 26/10/2026): a cobertura do mês (todos os indicadores) e as compras do
  mês (Base, Sem compra e as listas de sem compra) ignoram as notas com status "Cancelada". O Real de volume já não as
  contava. Cliente que só tem nota cancelada no mês passa a aparecer como "sem compra". Na medição de 26/10, a cobertura
  da BAND caiu de 2 a 6 pontos por item e o Sem compra subiu de 3.691 para 4.065 clientes.
- Supervisão que só tem rotas Neutraliza ou virtuais (SV.G1.5, SV.AN.4...) não aparece; a que mistura soma só
  as rotas normais. SV.G3.3 continua oculta. Na gerência **AT** nenhuma supervisão é oculta (a 431 vai para a
  linha "Neutraliza"; a 411 é rota normal).
- **Aba Todos a Bordo** (campanha "Todos a Bordo 3.0", cobertura de cervejas; chave interna `INCENTIVO`;
  `CONFIG.INCENTIVO_ATIVO = false` esconde a aba, e payload sem o grupo `INCENTIVO` também): ao lado de Novos Negócios,
  em todas as visões e perfis. Itens, na ordem: Cervejas, Heineken, Eisenbahn - 600ml, Heineken - 600ml e Cervejas
  600ml Retornável (Cervejas e Cervejas 600ml Retornável são os mesmos do ICS; os outros três só existem aqui, com as
  chaves `INC HEINEKEN`, `INC EISENBAHN 600ML` e `INC HEINEKEN 600ML`, e não entram no ICS, nos Novos Negócios, no
  Resumo nem no "ritmo de coberturas").
  - Regras de dado do ICS: meta de cobertura por rota; Real = clientes distintos com cobertura no mês; online =
    clientes com compra hoje. Rota sem meta do item fica fora de todas as somas e listas dele (as rotas BARRACUDA não
    têm meta de Heineken). Neutraliza e virtuais entram no total da gerência, como nas coberturas; os clientes de rotas
    eventuais (EV*) também, junto das rotas com meta do item.
  - **Os cinco cards são os do ICS GC** (mesma função, mesmas métricas): Meta, Real e Diferença; % = Real / Meta, verde
    pela régua do ritmo (% >= o % do dia útil de ontem); "faltam X hoje" / "no ritmo"; oportunidades do dia; caixa do
    Online com a meta do dia do ICS ("meta do dia X" / "no ritmo" / "Meta batida!"). Escopo sem nenhuma rota com meta do
    item: **"Exclusivo portfólio Full"** (Heineken e Heineken - 600ml) ou **"Sem meta"** (os outros). Escopo misto
    (ex.: G2, SV.G2.1): só as rotas com meta. A aba começa direto nos cinco cards (não há mais card de Status).
  - Card do topo: **"x / n itens em 100%"** (n = itens com meta no escopo; x = os com Real >= Meta) e, embaixo, a
    linha menor **"Status"**: "-" enquanto algum desses itens não está em 100%; "✓" verde quando todos estão. Sem item
    com meta no escopo: "0 / 0", sem a linha. Sem "puxa a média" nesta aba.
  - Cascatas: as do ICS (gerências → supervisões → rotas → clientes que faltam comprar, com os chips de dia de
    visita), só com os grupos e rotas com meta do item ("· n com meta" no grupo misto); a linha "Neutraliza" e a nota
    das virtuais como no ICS. Linhas + nota = card.
  - Fechamento do mês: igual ao ICS (Meta e Real do mês anterior); o Status usa só o Real.
- **Linha "Status" em Novos Negócios**: o card do topo "Ritmo de coberturas x / y" (contagem e texto iguais) ganha a
  mesma linha "Status": "-" até todos os itens de Novos Negócios com meta no escopo terem Real >= Meta, então "✓" verde.
  O ICS GC e o Volume não têm a linha. `CONFIG.STATUS_INCLUI_ONLINE` (padrão `false`): com `true`, um item conta como
  100% também quando os clientes distintos no Real ou no online de hoje alcançam a Meta (quem já está no Real e comprou
  de novo hoje conta uma vez); no fechamento, só o Real. Vale para Todos a Bordo e Novos Negócios.
- **Del Valle Frut** (agrupador "Del Valle Frut"): card de volume só na G2 (inclusive por supervisor e rota), com
  as mesmas regras de volume e nunca somado aos 5 agrupadores; fora do Resumo e da Diretoria. Sem META_VOLUME
  nem META_NEG do agrupador na G2, o card não aparece e o gerador avisa no log.
- **Desempenho GDM** (busca de cliente, aba Volume): Real = faturado do mês + online de hoje em Refrigerantes,
  Água Mineral, Sucos, Ades e Powerade; Meta = META_EQPTO das geladeiras Total Ko. Tag e cor pela situação da
  geladeira (GIRO_STATUS_MES_ATUAL): Giro Zero = vermelho "Venda Zero · x geladeira(s)"; Baixo Giro = amarelo;
  Giro Ok = preto/verde; < 30 dias = cinza, quadrinho pela venda do mês. Rede soma as lojas com geladeira.
- **Resumo de vendas**: segue o filtro; na Diretoria com "Todas as gerências", as 16 lado a lado em faixas de 8;
  com uma gerência no filtro, o resumo dela (gerência + supervisões); num grupo no Total, o total e as duas
  gerências lado a lado; no perfil Supervisão, o da supervisão (e
  das rotas dela); no perfil Rota, sem o botão. A placa ATENÇÃO existe, mas está desligada
  (`CONFIG.LIMIAR_ATENCAO = null`). A folha do Resumo (tela e PDF) **não tem assinatura**: acaba no último bloco.
  Blocos escolhidos nos botões "Volume", "ICS GC", "Novos Neg." e "Todos a Bordo" (os mesmos na barra do painel e no
  Resumo aberto; pelo menos um ligado).
- **Bloco "Todos a Bordo 3.0" do Resumo** (29/10/2026; opcional, **desmarcado por padrão**): botão "Todos a Bordo"
  (`data-rsb="tab"`) depois de "Novos Neg.", só quando a aba Todos a Bordo existe (payload com `GROUPS.INCENTIVO` e
  `CONFIG.INCENTIVO_ATIVO`; sem ela, o botão some e o bloco nunca é desenhado, nem por link). Uma linha por item de
  `GROUPS.INCENTIVO`, na ordem e com o rótulo da aba (Cervejas, Heineken, Eisenbahn - 600ml, Heineken - 600ml, Cervejas
  600ml Retornável), as **mesmas colunas do bloco ICS GC** e a mesma célula (Faltam ou Meta dia, Online e "% do mês"), com a
  linha "No ritmo" no fim. **Decisão da Karen (29/10/2026): a conta é a do ICS GC no Resumo**: % do mês = clientes
  distintos no Real ou no online de hoje (`COBERTOS` ∪ online, sem contar em dobro) / Meta, cada item **só nas rotas da
  coluna com meta dele** (as do card da aba, `rotasInc`: com meta > 0 e, junto delas, a rota oculta das EV* com cliente
  coberto). Por isso o % do bloco pode passar o do card da aba (o card é Real / Meta, sem o online), como já acontece no
  ICS GC; Meta, Real e o Online do total são os do card. Coluna sem nenhuma rota com meta do item: "—" (nunca 0%); com o
  dado real de 29/10, Heineken e Heineken - 600ml ficam "—" em AP, AT, G3, PA, DI e GU, e AN, G1 e G2 mostram só as rotas
  com meta (A37, 111, 211-214), como o card. Fechamento: a mesma regra das coberturas do ICS no fechamento. No PDF o
  bloco é um átomo (Diretoria com Volume + ICS GC + Todos a Bordo = 3 páginas) e no link `?resumo=` entra como `tab`
  (`?resumo=vol,ics,tab&gc=G2`); link antigo sem `tab` abre como antes. Sem o bloco marcado, o Resumo é o mesmo de antes.
- **Painel de Ritmo em PDF** (botão "Painel de ritmo", ao lado de "Gerar resumo de vendas"; relatório MATINAL): exporta
  direto um PDF com páginas 16:9 (1280x720) **só com dados reais** do `payload.json` (Real fechado até o último dia
  útil + metas); nada do online de hoje nem dos revertidos/oportunidades de hoje. **Escopo pelo filtro**: Diretoria em
  "Todas as gerências" = as 16 (cada gerência: a página do GC e as das supervisões, em ordem; pede confirmação
  "Exportar N páginas?"); uma gerência (filtro da Diretoria ou perfil Gerência) = GC + supervisões; grupo no Total = as
  duas gerências (com uma escolhida, só ela); supervisão no filtro ou perfil Supervisão = só a página dela; perfil
  Rota: sem o botão; fechamento do mês: botão desabilitado ("Indisponível durante o fechamento"). Cada página: título
  ("Painel de Ritmo — SV.G1.1 · Nome" ou "— GC.G1 · Goiânia 01"), subtítulo com o mês, "dados reais até sexta-feira 16/10
  (dia útil 11/21, 52%)" (payload com `DATA_ONTEM`/`DIA_ONTEM_NOME`; antigo: "até o dia útil N/T") e "faltas miram
  <hoje> (dia N/T, %)", a linha vermelha "Puxando a média pra baixo" (a rota, ou no GC a supervisão, com menos
  coberturas no ritmo, pela quantidade e não pela proporção: 7/8 vem antes de 8/10; com o mesmo número no ritmo, a
  que tem mais itens fora do ritmo (8/10 antes de 8/8); persistindo o empate, o menor código; sem a linha quando todas
  as colunas estão com todos os itens no ritmo) e dois blocos com colunas = o nível + rotas (ou supervisões):
  **Volume — tendência do mês** ("na tendência x / 5": % tendência, verde a partir de 100, e "Meta dia X" ou "Meta
  batida!") e **Coberturas — ICS GC** ("no ritmo x / 10": % do mês, verde no ritmo de ontem, "Meta dia N" ou "faltam
  N" como a caixa dos cards, ou "Meta batida!" quando o Real do mês já alcançou a Meta; Venda Zero com "reverter N": o
  pendente do mês N em destaque, com a palavra "reverter" embaixo e sem percentual, ▲ verde com 0 e ▼ vermelho acima
  disso). Supervisor ou consultor "ROTA SEM VENDEDOR" (ou sem nome) aparece como "Sem vendedor" (ex.: "Rota 226 /
  Sem vendedor", "Painel de Ritmo — SV.PA.4 · Sem vendedor"). Neutraliza, virtuais, '-EV' e SV.G3.3
  não viram coluna (os números delas ficam no total do GC). Sem assinatura. 7 colunas ou mais: modo compacto. O
  PDF é gerado no navegador página a página (progresso no botão "Gerando 12/64"); sem conexão para as bibliotecas,
  o botão avisa "Sem conexão para gerar o PDF". Arquivo `Painel_Ritmo_<BAND|G1|IT+MO|SV.G1.1>_AAAAMMDD.pdf`, baixado
  ou compartilhado como o do Resumo. Tamanho típico: ~165 KB por página (uma gerência com 2 supervisões ≈ 0,5 MB).
- **PDF do Resumo**: sempre a tabela do PC, em páginas deitadas (16:9) na largura da folha. A quebra é só entre
  blocos (Volume, ICS GC, Novos Negócios) e o cabeçalho (com a placa ATENÇÃO, quando houver) **nunca fica sozinho**:
  vai sempre junto do 1º bloco; se os dois não couberem numa página, a 1ª página fica mais alta (o mesmo vale para
  qualquer bloco mais alto que a página). Diretoria com Volume + ICS GC = 2 páginas (3 com Novos Negócios). A divisão
  é a função pura `RS.paginas(atomos, H0, altTotal)` (`resumo.js`). Números grandes (até 7 dígitos, ex.: 2.665.000):
  no PDF as caixas têm tamanhos fixos (os da tela de PC de 1000-1599 px, iguais em qualquer aparelho) e menos folga;
  o número que ainda não couber tem a fonte reduzida só no PDF (`encaixa()`, mínimo 10 px) e, se nem assim couber, o
  PDF fica mais largo. A tela do Resumo (celular e PC) não muda.
- Rodapé (do painel, fora do Resumo): "Karen Oliveira - Inteligência de Mercado".

Testes do front: `node --test frontend/tests/front.test.js` (Chromium headless com `playwright`; usa dado
sintético gerado pelo próprio back-end em `frontend/tests/sintetico.py`; a virada diária é testada com o relógio
simulado do Playwright, com o navegador em UTC e em America/Sao_Paulo). A Parte M confere o visual em 1280 e
390 px: Inter carregada, sem rolagem lateral, nenhum texto cortado, alturas por tipo, cabeçalho do celular,
regra do vermelho, contraste AA e Resumo/PDF sem estouro. A Parte N abre cada nível da cascata no front atual e no
do commit `0a59eb4` (CSS e app.js de antes do ajuste visual, via `git show`; sem o histórico, é pulada) e compara o
estilo computado elemento a elemento: só a família pode mudar (fora o que a Etapa 3 do pacote v3 trocou com autorização:
a linha nova da cascata, o cabeçalho/chips de ordenação e a lista de clientes de volume, tudo em classes `.v3`, ficam fora;
a caixa do Online da linha nova é comparada com a de antes; no PC, com a cascata aberta, o padding do cabeçalho e do corpo
da gaveta e a margem automática; e, na Diretoria, só o 1º nível). A Parte O confere o Resumo e o PDF: sem assinatura,
paginação (`RS.paginas`, também sem navegador), cenário `grande` (16 gerências e números de 6-7 dígitos, e o pior
caso com 2.665.000 em todas as caixas) sem célula cortada nem caixas sobrepostas no PDF, e a tela do Resumo igual à
do CSS do commit `2d5419a` em 390, 800, 1280 e 1700 px. Com os pacotes npm `html2canvas@1.4.1` e `jspdf@2.5.1`
instalados (local, `NODE_PATH` ou global; o hash é o mesmo do SRI do `config.js`), gera também o PDF de verdade e
confere o nº de páginas e que nenhuma fica em branco; sem eles, esse teste é pulado (os outros simulam as bibliotecas).
A Parte P confere o script da versão (sem navegador, precisa de `bash` e `sha256sum`): numa cópia de `frontend/`, o
mesmo hash duas vezes, igual com só `data/` mudado, diferente com um `.js` mudado, e o `--gravar`. A Parte Q confere o
aviso de versão nova com o `versao.json` interceptado: versão igual, diferente, "Depois" (30 min no relógio simulado),
"Atualizar" (cache reload, reload e `localStorage` intacto), sem conexão, meta `"dev"`, 404, checagens (online,
`visibilitychange`, `pageshow`), "tela inicial" simulada, 390/1000/1280 px e os dois fundos. A Parte R confere o Painel
de Ritmo: `montaRitmo` sem navegador (vm com ONLINE e os campos de hoje lançando erro), escopo pelo filtro, colunas
(sem Neutraliza/virtuais/-EV/SV.G3.3, que ficam no total), células e "Puxando a média", subtítulo com e sem
`DIA_ONTEM_NOME`, botão (1280/390 px, Rota, fechamento), PDF simulado (páginas, progresso, confirmação, nome, sem
conexão), desenho de 9 colunas sem texto cortado e, com as bibliotecas npm, o PDF real (páginas, 1280x720, tamanho).
A Parte S abre o painel com e sem `SEM_COMPRA_MES` (Diretoria, Gerência, Supervisão e Rota) e confere que as telas
(cards, listas, cascata, gavetas Base e Sem compra, Resumo) são as mesmas e que não há erro; desde a Etapa 6, a gaveta Sem
compra tem a barra de dias só com a chave (sem ela, só o "Hoje"), e fora da barra continua igual. A Parte T confere a fonte
dos números e os cards: Source Serif 4 local carregada (`document.fonts.check`, pedido só a `assets/fonts`, licença,
`@font-face` com `swap`, pesos 200-900 e o unicode-range da Inter) e usada só em `.ind .big`, `.obox b` e `.card .n` (nas
abas de indicadores; o `.gPct` dos medidores da Executiva é conferido na Parte W)
(estilo computado; o resto da tela, a entrada, a gaveta, o Resumo, o PDF do Resumo e o Painel de Ritmo em Inter),
algarismos `lining-nums tabular-nums`, fundo dos cards igual ao do CSS da main antes da Etapa 2 (commit `2744537`),
faixa lateral na cor do status (sem faixa no card indisponível), escala dos cards, 3 colunas em 1440 px e nenhum texto
cortado em 360 e 390 px.
A Parte U confere o layout (Etapa 3): painel lateral em 1000 e 1440 px (fixo, 272 px, itens na ordem, abas verticais
com ícone e `title`, ativa em vermelho, créditos, conteúdo à direita e sem rolagem lateral nas quatro abas), recolher e
expandir (76 px, só ícones, gaveta acompanhando, `drotas_lado` guardado e sem armazenamento sem erro), foco por teclado,
escopo igual ao filtro em todos os perfis (também o grupo no Total) em 390 e 1440 px, topo compacto em 360 e 390 px
(<= 221 px), ↻ (recarrega no mesmo acesso e painel) e casa nos dois layouts e a faixa de versão nova livre nos dois
fundos.
A Parte V confere o cabeçalho das abas (Etapa 4): em 7 cenários (Diretoria, Gerência, grupo, filtro "Neutraliza", uma
supervisão no filtro, Supervisão e Rota) e nas quatro abas, os números do cabeçalho (card de ritmo "x / n", rótulo,
legenda e Status, "puxa a média" com nome e "x de n", Base, Sem compra, visitas e sem compra hoje), os cards e a ficha
da busca iguais aos do front de antes da Etapa 4 (index.html, CSS e app.js do commit `a70a2c3` via `git show`; sem o
histórico, esse teste é pulado; só o rótulo do Volume muda); a linha de resumo em 1440 e 390 px (260 px | 1fr | 1,1fr,
busca embaixo no celular, Base e Sem compra só com supervisão ou rota, três cards na Rota, Status no Todos a Bordo, ficha
abaixo da linha); a etiqueta do dia e a caixa de comentário (mouse acompanhando o cursor, teclado com Shift+Tab e ESC,
toque com abrir/fechar, toque fora e rolagem; um único `div.dica`, `emFoco`, cores; fechamento sem "dias pela frente");
o filtro rápido (contagens, só mostra/oculta sem mudar ordem nem cores, `.off` só em "Todos", chip vazio desabilitado,
volta para "Todos" ao trocar de aba); e o cabeçalho sem texto cortado nem rolagem lateral em 360 e 1000 px. Na Etapa 4,
as Partes M, N, S, T e U passaram a abrir as gavetas Base e Sem compra pelo clique do próprio card (`abreCardTopo`; na
Diretoria e na Gerência os cards ficam ocultos, mas a gaveta é a mesma) e a medir os cards do topo dentro de `#abaTopo`
(mesma altura na mesma linha); o "puxa a média" é lido por `puxaTxt` ("título: nome").
A Parte Y confere a entrada com logos (Etapa 7): em cada fundo, as duas imagens certas (arquivo, carregadas, as do
outro fundo ocultas), `alt`/`aria-label`, o sol/lua trocando as duas imagens e a cor do texto, o fundo guardado já
abrindo com as imagens dele e os PNG no tamanho original; em 360, 390 e 1440 px, nos dois fundos: alturas (62/40 px;
52/34 px em <= 380 px), proporção sem distorção, logo | linha | elmo alinhados e centralizados acima do título, a linha
(1,5 x 64 px, `--vermelho`), o texto (duas linhas, Inter 800, 9,5 px, line-height 1.08, .015em, centralizado embaixo do
elmo), contraste AA, nada fora da tela nem cortado e sem rolagem lateral; e a entrada funcionando como antes nos dois
fundos (Diretoria, Gerência, grupo, Supervisão e Rota; acesso guardado, recarregar, casa; aba inicial Executiva, Volume na
Rota).
A Parte W confere a aba Executiva (Etapa 5), com o cenário `exec` (o do Todos a Bordo com clientes sem compra no mês,
`montaSemCompra`; o sintético compra tudo): aba inicial de Diretoria, Gerência, grupo e Supervisão (também ao recarregar e
ao entrar de novo), sem a aba na Rota e com uma rota no filtro; unidades = grupos da cascata (Diretoria, uma gerência,
grupo no Total, supervisão, "Neutraliza"), total BAND ou o código, virtuais/EV* fora das listas e dentro dos totais; as
invariantes da seção 7 (KPIs = cards das abas, desvio do total = Tendência / Meta - 1 do card de Volume, % da linha de total
da tabela = cards do ICS GC, Novos Negócios e Todos a Bordo, Status, somas e "restam" de Sem compra e Agenda, gaveta Sem
compra), também no fechamento; ordem, lado e escala das barras e o sinal exato (−0,03% vermelho com o card verde em 100%);
caixa de comentário (mouse, teclado e toque); categoria em análise (medidor, chip, teclado, textos dos quadros com números
conhecidos); fechamento ("Realizado x Meta", sem Meta do dia e Agenda); Evolução oculta; layout em 1440, 1000, 390 e 360 px
(sem texto cortado nem rolagem lateral, colunas, tabela rolando dentro do bloco com a 1ª coluna presa, fontes, contraste,
cabeçalho do celular <= 221 px); e, contra o front da main antes da etapa (commit `321b0ea` via `git show`), cabeçalho,
cards, cascata, gavetas, Resumo e Painel de Ritmo iguais. Desde a Etapa 5, `abre()`/`entra()`/`vaiPara()` levam o painel
para a aba `aba` depois de entrar (padrão ICS GC, a aba inicial de antes, de onde os testes anteriores partem; `null` = fica
na aba inicial do perfil); a Parte L passa `'INCENTIVO'` ao entrar de novo (antes a aba ficava a mesma).
A Parte X confere as gavetas com barra de dias (Etapa 6), com o cenário `dias` (o `exec` com dias de visita variados,
`montaDias`: "Seg - Qui", "Ter" e "Qua - Sex"; e `diasscm`, o mesmo sem `SEM_COMPRA_MES`): padrões ("Todos" no Volume,
"Hoje" na Base e no Sem compra, pelos cards e pelos KPIs da Executiva), títulos por chip e a volta ao padrão ao reabrir; a
lista de volume filtrada por dia na mesma ordem; em 8 escopos (Diretoria, Gerência, "Neutraliza", G3 com a oculta, grupo no
Total e uma gerência dele, Supervisão e Rota), cada chip contra a recontagem do payload e do online, riscado e "Venda
Online", o cliente de dois dias em cada dia dele e uma vez no "Todos", e as contagens contra os cards (a diferença só pela
SV.G3.3); o "Todos" do Sem compra contra o `semCompra` de cada rota, supervisão e gerência (G2 e IT+MO); payload sem
`SEM_COMPRA_MES`; fechamento; o limite das listas (com `LIMITE_LISTA` trocado para 5); 360, 390, 1000 e 1440 px nos dois
fundos (sem rolagem lateral nem texto cortado); e, contra a main antes da etapa (commit `aceacc4` via `git show`),
cabeçalho, cards, cascata, Executiva, Resumo, Painel de Ritmo e as gavetas (sem a barra) iguais. Na Etapa 6, a Parte N
passou a conferir também a barra nova (lista de volume, Base e Sem compra; o front do `0a59eb4` não tinha barra ali): fora
dela a marcação é a de lá, e a marcação inteira do atual é posta na gaveta do `0a59eb4` para comparar o estilo de cada
elemento, barra inclusive, com o CSS de lá; e os "antes x depois" das Partes S e W comparam as gavetas sem a barra.
As invariantes ficam em `frontend/tests/executiva_invariantes.js` e `frontend/tests/gavetas_invariantes.js`, usadas também
pela **conferência com dado real** (`frontend/tests/conferencia_real.test.js`, só roda com `PAYLOAD_REAL` e `ONLINE_REAL`
apontando para os JSONs, uma cópia fora do repositório; sem elas, é pulada): Executiva na Diretoria, em cada gerência com
dados, em cada grupo no Total e numa supervisão; gavetas na Diretoria, G1, G2, AP, IT+MO e numa supervisão (cada chip) e,
em cada unidade dessas gerências (gerência, supervisões, "Neutraliza" e rotas), o "Hoje" e o "Todos" contra os cards; sem
rolagem lateral nem erro no console em 360, 390, 1000 e 1440 px nos dois fundos. Imprime tabelas-resumo só de totais e
códigos.

A **Parte AA** confere o ajuste de rótulos (cenários `vol5`/`vol5fech`: os 5 macros de volume com dado, `montaVolume5`):
o card "Novos Negócios" com a 2ª linha "Dest+Art+Cnd" (menor, mais clara, contraste >= 4,5:1, no rosa e no verde) em
Diretoria, Gerência, grupo, Supervisão e Rota, em 1440 e 390 px, e os outros cards sem ela, com a mesma altura; nenhum
"Dest+Art+Cnd" visível (texto, `title`, `aria-label`, dicas) fora dessa linha em nenhuma aba, na visão executiva, na gaveta,
no Resumo e no Painel de Ritmo (modelo e páginas desenhadas); o nome da aba por perfil (Diretoria, Gerencial, Supervisão;
Rota sem a aba), no painel lateral, no recolhido e no celular; contra a main antes do ajuste (`20728ac` via `git show`),
cards, cabeçalho, visão executiva, gavetas e Resumo iguais fora o nome novo, a 2ª linha e o nome da aba, e o rodapé, o
crédito e as legendas menores (até 1 px, ~10%) com contraste AA, com a letra da gaveta igual. As invariantes ficam em
`frontend/tests/rotulos_invariantes.js`, usadas também pela conferência com dado real (bloco "Ajuste de rótulos": 1440 e
390 px, nos dois fundos, e o antes x depois com o mesmo payload real). Os "antes x depois" de etapas anteriores (Partes V,
R, W e X) comparam com o nome antigo trocado pelo novo e sem a 2ª linha (`igualRotulo`).
Na conferência com dado real, os antes x depois contra fronts anteriores a 26/10/2026 (`20728ac`, `7674ca2`, `ec60a88`)
servem aos dois fronts o mesmo payload sem os itens do Todos a Bordo nas rotas ocultas das EV* (esses fronts ainda não somavam
a oculta das EV* no Todos a Bordo, decisão de 26/10); o `desfazAE` tira só a linha "faltam X para a meta" do medidor (o
"faltam" do quadro Foco já existia). No desvio por unidade da Executiva, a coluna do valor cresce quando o texto não cabe (ex.:
a rota 151, Neutraliza da G1, tem META_VOLUME de 0,1 cx na fonte e desvio de "+28.715.800,0%" em 29/10/2026): só aquela linha
fica com a barra mais curta, sem rolagem lateral no celular.

A **Parte AC** confere a gaveta "Categoria por unidade" da visão executiva, em tabela desde a Etapa 6 do pacote v3 (cenários
`vol5`/`vol5fech`, `exec` e `grupo`): tocar em "Refrigerantes" abre "Refrigerantes por gerência" com o total no topo e uma
linha por gerência com meta, do maior para o menor % real (uma gerência sem meta fica fora); totais = card de Volume; cores
pela regra (verde, âmbar, vermelho); gerência → supervisões com a "Neutraliza" por último (mesmo com o maior %), virtuais e
EV* fora da lista e dentro do total; grupo no Total, uma gerência do grupo, supervisão → rotas e "Neutraliza" no filtro;
Faltam "N" e "+X", Real = Meta ("+0") e a tendência de 99,6% (= 100%, âmbar); categoria sem meta (ou meta 0) não abre; fechar
(ESC, ×, fora) mantém a categoria e devolve o foco ao medidor; Enter e Espaço abrem; os chips do celular só escolhem;
fechamento (7 colunas, sem âmbar nem Tendência, "Online hoje", "Realizado ÷ Meta", legenda de 2 cores, selo pelo Real);
rótulo "Novos Negócios"; perfil Rota sem a Executiva; caixa de comentário (mouse, teclado pelos títulos e linhas, toque,
rolar fecha); em 360, 390, 800, 1000 e 1440 px nos dois fundos: as colunas à vista (8; 5 abaixo de 700 px), a faixa de 4 px,
o total (fundo, 11 px, negrito), zebra e hover, fontes, o selo só "✓" no celular, nada cortado nem rolagem lateral e o
cabeçalho da gaveta igual ao da cascata; e, contra a main antes da gaveta (`ec60a88` via `git show`), Executiva, cabeçalho e
cards das abas, cascata, gavetas Base e Sem compra e Resumo iguais (HTML). As invariantes ficam em
`frontend/tests/categoria_invariantes.js` ((a) total = medidor (Meta, Real, %, online) = card de Volume = soma das rotas;
(b) Σ Meta, Real, Online e Tendência das linhas + unidades sem meta + rotas fora = total; (c) ordem e só as unidades com meta;
(d) status, faixa e cores recontados das rotas, selo ⇔ Real + Online ≥ Meta; (e) Faltam, Online e Tendência; (f)
"Neutraliza" por último; (g) a ordem pelos 4 títulos, com o total fixo), usadas também pela conferência com dado real (bloco "Gaveta Categoria por unidade":
Diretoria, cada gerência, cada grupo no Total e uma supervisão, nas 5 categorias; 360, 390, 1000 e 1440 px nos dois fundos; e
o antes x depois com o mesmo payload real).
A **Parte AF** confere o bloco "Todos a Bordo 3.0" do Resumo (cenários `inc`, `incfech` e `seminc`): botão nos dois grupos
depois de "Novos Neg.", desmarcado, ausente sem a aba (`seminc` e `INCENTIVO_ATIVO = false`, também com `tab` no link); o
bloco com os 5 itens, as colunas do ICS GC e "No ritmo"; cada célula pela regra (rotas com meta do item, Real ∪ Online
distintos) e o total contra os cards da aba (Diretoria, G2, G3, IT+MO no Total e SV.IT.1); "—" nas gerências sem meta de
Heineken; as células de Cervejas e Cervejas 600ml Retornável iguais às do ICS GC num escopo com meta em todas as rotas
(também no fechamento); link `?resumo=` com e sem `tab`; PDF simulado (o bloco é um átomo) e, com as bibliotecas npm, o PDF
real (2 → 3 páginas na Diretoria); os 4 botões sem corte em 360, 390, 1000 e 1440 px. As invariantes ficam em
`frontend/tests/resumo_tab_invariantes.js`, usadas também pela conferência com dado real (bloco "Resumo de vendas: bloco
Todos a Bordo 3.0": Diretoria, cada gerência, cada grupo no Total e uma supervisão, em 1440 e 390 px; e o antes x depois
contra a main antes do bloco, `9f82f15`: Resumo sem o bloco, Executiva, cards e cascata iguais).
A **Parte AG** confere a cascata com Dif (Real + Online), o selo e a Diferença dos cards (Etapa 3 do pacote v3): a Diferença
dos cards de Volume e coberturas (= `realOnline` − Meta, recontado do payload e do online; cor; 3 linhas; alturas iguais), Real
− Meta na Venda Zero, no fechamento (`incfech`) e sem online, e a do Todos a Bordo só com as rotas com meta; a cascata com as 5 colunas, o cabeçalho só >= 1000 px e os chips só < 1000 px (1440, 1000, 390 e 360 px, colunas do
cabeçalho alinhadas às linhas, sem texto cortado nem rolagem lateral); ordem padrão = código, % / Dif / Online decrescente
e invertido com "Neutraliza" no fim, o foco de volta no título, a ordem mantida ao descer e voltar e o código ao reabrir;
o selo num caso forçado (cobertura com Real 1 + 2 clientes novos online = Meta) e sem selo com o cliente coberto comprando
de novo (Real + caixa do Online >= Meta, mas clientes distintos < Meta), também no volume; o fechamento (% realizado, "sem
online no fechamento", lista com Online "—"); a Diretoria abrindo a lista de clientes da gerência em todas as abas, a
Executiva (`unidadesExec`) com as supervisões e a cascata completa na Gerência e na Supervisão; a lista de clientes
(colunas, Real = faturado, Dif = Real + Online − Meta, duas linhas no celular alinhadas ao cabeçalho); e o antes x depois
contra a main antes da etapa (`515b1e9`): Executiva, Resumo e Venda Zero idênticos, cards e cada nível da cascata iguais
depois de desfeito só o que a etapa trocou (`desfazCasc`, também usado pelos antes x depois antigos das Partes V, W, X, Z,
AA e AC e da conferência com dado real). As invariantes (a)-(g) ficam em `frontend/tests/cascata_invariantes.js`, usadas
também pela conferência com dado real (bloco "Cascata com Dif (Real + Online)": Diretoria, uma gerência, o grupo IT+MO e
uma supervisão em 1440 e 390 px, com a ordenação e a (f) card x linha da Diretoria; 360/390/1000/1440 px nos dois fundos;
antes x depois contra `515b1e9`).

A **Parte AH** confere o botão "Clientes" por agrupador (Etapa 4 do pacote v3): o botão nas 4 abas, antes da etiqueta do
dia, fora da Executiva e no perfil Rota, com o estilo pedido; um botão por agrupador (os cards que abrem a cascata; Del Valle
Frut na G2, Venda Zero no ICS GC), título e subtítulo; a lista do botão = a cascata percorrida inteira (mesmos clientes, ordem
e números, na Diretoria, numa gerência, numa supervisão, numa rota, no grupo IT+MO, no fechamento e com uma gerência no
filtro da Diretoria), só rotas com o agrupador (Todos a Bordo: a Heineken da G2 só na G211); busca por PV (1 linha), por
parte do nome, sem acento e sem caixa, "Ninguém neste filtro."; busca além do limite (`LIMITE_LISTA` trocado para 4: o
último cliente da lista inteira pelo PV e o "+ N" só com os que casam); busca e dia mantidos ao trocar de agrupador e de dia;
360, 390, 1000 e 1440 px sem rolagem lateral nem corte. A conferência compara as listas inteiras, então o config.js é servido
com `LIMITE_LISTA` alto (`semLimite`; `CONFIG` é congelado). As invariantes ficam em `frontend/tests/clientes_invariantes.js`,
usadas também pela conferência com dado real (bloco "Botão Clientes": Diretoria, a 1ª gerência com dados, uma supervisão e
uma rota dela, nas 4 abas e em cada agrupador, com a tabela de contagens; 360/390/1000/1440 px; antes x depois contra a main
`9364d62` com o mesmo payload: Executiva, cabeçalho sem o botão, cards, cascata até a lista de clientes, Base, Sem compra e
Resumo idênticos). Os antes x depois contra fronts antigos tiram o botão do cabeçalho antes de comparar (`TELA_ABA`,
`TEXTOS_TELA_PAGINA` e a Parte AC).

A **Parte AI** confere a Executiva com o cabeçalho fixo, o "Abrir por" e a busca (Etapa 5 do pacote v3), na variante 'dim'
(Meta NEG e Real por cliente nos 5 macros e 18 Key Accounts fictícias, `montaDim`): o cabeçalho visível depois de rolar (no
alto no PC; logo abaixo da barra no celular, também depois de redimensionar e trocar o filtro), sem conteúdo por trás, numa
linha no PC e em duas no celular, com a lupa abrindo o campo numa linha própria; a Parte M continua (≤ 221 px); cada botão
troca os três lugares com as invariantes (b)-(f) (Diretoria, uma gerência no filtro, G3, IT+MO e uma supervisão), ≤ 15 por
categoria e as notas; a Marca só na Diretoria, com o aviso; (a) o modo padrão idêntico à main antes da etapa (`0f6fbfe`), com o
mesmo payload, também depois de passar pelos modos; a busca por nome, PV e Key Account (até 12, etiqueta, sem as ocultas, só o
filtro) e a ficha do cliente e da KA (cartões sem tendência, "sem Meta NEG" cinza, quadrinhos, classes só de conteúdo); 360,
390, 1000 e 1440 px sem rolagem lateral nem corte, com os nomes de 96/118 px. As invariantes ficam em
`frontend/tests/dimensoes_invariantes.js`, usadas também pela conferência com dado real (bloco "Abrir por": Diretoria, cada
gerência, cada grupo no Total e uma supervisão em 1440 e 390 px, com a tabela do % da meta oficial; o antes x depois contra
`0f6fbfe`; 360/390/1000/1440 px em cada modo, na gaveta e na ficha).
A **Parte AJ** confere a tabela e o escopo do nível acima na Executiva (Etapa 6 do pacote v3): Gerência G1 com "GC.G1 | BAND"
(e o grupo com "GC.IT + GC.MO | BAND"): BAND = a Diretoria "Todas" (`#exec` e gaveta da categoria com o mesmo HTML), "Abrir
por" pela gerência, nome da aba "Gerencial", as invariantes da tabela no escopo de cima; as 4 abas de indicadores, o Resumo, o
Painel de Ritmo e o acesso guardado iguais aos do acesso; o filtro lateral não altera a Executiva em BAND; nova entrada e
reabrir a página voltam ao escopo do acesso. Supervisão SV.G2.1 com "SV.G2.1 | GC.G2": GC = o perfil Gerência G2 (o mesmo para
SV.MO.1 → GC.MO, a gerência dela, não o grupo); Diretoria e Rota sem o botão. Selo num caso forçado (Real 90% + Online 15%:
selo e fundo verde-claro, status âmbar), Online verde/vermelho pela meta do dia, ordem por Online e Faltam com o total fixo;
360, 390, 1000 e 1440 px nos dois fundos: o botão na linha do título com o traço (PC) ou numa linha própria (celular), sem
rolagem lateral, também na gaveta em BAND.

```bash
git show origin/main:frontend/data/payload.json > /tmp/real/payload.json
git show origin/main:frontend/data/online.json > /tmp/real/online.json
PAYLOAD_REAL=/tmp/real/payload.json ONLINE_REAL=/tmp/real/online.json node --test frontend/tests/conferencia_real.test.js
```

### Layout (painel lateral no PC, topo compacto no celular)

- **PC (a partir de 1000 px)**: o cabeçalho e a barra de filtros/abas viram um **painel lateral fixo à esquerda**
  (245 px; 231 px em telas até 820 px de altura; era 272 px até a Etapa 7 do pacote v3), preto: botão ☰ (recolher), marca, "Desempenho de Rotas", mês + etiqueta de atualização + escopo (o perfil e
  o filtro, numa linha própria), **Filtro** (seletores empilhados), **Painéis** (abas na vertical com ícone; a ativa em
  vermelho), a caixa do ritmo de hoje, no rodapé **↻ Atualizar** e **Entrada** (casa) e os créditos. O conteúdo ocupa
  o resto da largura da tela; a cascata (gaveta) abre à direita do painel, com a mesma aparência de sempre.
- **Sem rolagem no painel** (Etapa 7 do pacote v3): em 1920x1080, 1440x900, 1366x768 e 1280x720 todos os itens cabem
  (menu, título, mês/atualização/escopo, Filtro, abas, caixa de ritmo, Atualizar, Entrada e créditos), aberto ou recolhido,
  em qualquer perfil (o grupo IT+MO, com três seletores, é o mais alto: sobram ~47 px em 1280x720). Ver "Visual", "PC mais
  compacto".
- **Recolher**: o ☰ deixa só os ícones (☰, abas, ↻ e casa; o nome aparece ao passar o mouse; 68 px, 64 px em tela baixa). O aparelho guarda a
  escolha (`drotas_lado`); sem armazenamento, vale só na visita. A faixa de versão nova fica no alto do conteúdo, à
  direita do painel, aberto ou recolhido.
- **Celular (abaixo de 1000 px)**: topo compacto, com a barra de filtros e abas presa no alto como antes: título com ↻
  e casa; mês e a etiqueta curta ("● 21/10 08:01"; o texto inteiro, como "Última atualização em …", fica no `title`);
  "Dia útil 13/21 (62%) · ritmo hoje 67%" (dia útil do Real até ontem e o % do ritmo; o ritmo de hoje = dia de hoje ÷
  dias úteis). O escopo sai do topo só na Diretoria (o seletor logo abaixo mostra); nos perfis com o filtro travado
  (Gerência, Supervisão, Rota) ele continua, para o contexto não sumir. Com a Executiva, as cinco abas não cabem numa
  linha em 360-640 px: a faixa das abas rola de lado (como a dos seletores) e a aba ativa fica sempre à vista.

### Aba Executiva: visão executiva (aba Diretoria, Gerencial ou Supervisão)

A chave interna continua `EXEC`; o nome visível segue o perfil (`CONFIG.ABA_EXEC_NOME`, `nomeAbaExec()` em app.js):
**Diretoria** no perfil Diretoria, **Gerencial** no perfil Gerência (inclusive nos grupos de gerências) e **Supervisão** no
perfil Supervisão; o perfil Rota não tem a aba. O nome vale no botão da aba (barra do celular e painel lateral do PC), no
`title`/`aria-label` (o painel recolhido mostra só o ícone) e no título da aba (`#abTit`). Sem acesso guardado (link do
Resumo), pelo modo do filtro.

Desde a Etapa 5 (21/10/2026), a primeira aba da barra e a aba inicial de Diretoria, Gerência e Supervisão. A Rota não tem a
Executiva (abre no Volume); com uma rota escolhida no filtro, a aba some e o painel vai para o Volume (volta a aparecer ao
tirar a rota). Tudo segue o filtro, com os mesmos grupos da cascata: Diretoria → gerências (as com dados); uma gerência →
supervisões + a linha "Neutraliza"; grupo no Total (ex.: GC.IT + GC.MO) → as supervisões das duas, com o total do grupo;
uma supervisão → rotas; "Neutraliza" no filtro → as rotas Neutraliza. Rotas virtuais e clientes em rotas eventuais (EV*)
ficam fora das listas de unidades e dentro dos totais. Linha de total: **BAND** na Diretoria; com filtro, o código (GC.AT,
GC.IT+MO, SV.AP.1, Neutraliza). Nenhum número é recalculado por fora: tudo sai da mesma agregação dos cards.

- **Cabeçalho fixo** (Etapa 5 do pacote v3, 30/10/2026): o nome da aba (Diretoria, Gerencial ou Supervisão; até o ajuste de
  rótulos, "Resumo executivo"), o botão de **escopo** (Gerência e Supervisão; abaixo), os botões **"Abrir por"**, a **busca**
  e a etiqueta do dia (a das abas, com a caixa de comentário). Fica preso no alto durante a rolagem (sticky), com o fundo da página e uma sombra discreta embaixo, cobrindo a
  largura do conteúdo (nada aparece por trás). **PC**: no alto da área de conteúdo, numa linha (título · botões · busca ·
  etiqueta; se faltar espaço, os botões rolam de lado). **Celular**: logo abaixo da barra preta (seletores e abas), pela altura
  real dela (medida pelo app.js em `--barra-h`, de novo no resize e quando a barra muda de tamanho); linha 1 = título · lupa ·
  etiqueta; linha 2 = os botões, com rolagem lateral; tocar na lupa abre o campo numa linha própria (tocar de novo fecha). A
  medida do cabeçalho do celular (até o fim das abas, ≤ 221 px) não muda: o cabeçalho da Executiva fica abaixo dela. Nas
  outras abas o cabeçalho é o de sempre (o bloco novo só entra na Executiva). Sem filtro rápido.
- **Escopo do nível acima** (Etapa 6 do pacote v3, 30/10/2026; só Gerência e Supervisão): dois botões colados antes do "Abrir
  por", separados dele por um traço vertical no PC; no celular, numa linha própria entre o título e o "Abrir por". Gerência:
  **GC.G1 | BAND** (o marcado com `aria-pressed="true"`; o `title` traz o nome inteiro); Supervisão: **SV.G2.1 | GC.G2**. Com o
  nível de cima marcado, a Executiva inteira (KPIs, quadros, medidores, Tendência x Meta, Sem compra, Agenda, Coberturas,
  Evolução, gaveta da categoria, "Abrir por" e busca) é a da Diretoria "Todas" (BAND; sem o botão Marca, que é só da
  Diretoria) ou a do perfil Gerência da mesma gerência (GC): o mesmo HTML. Nas outras abas o painel continua só na gerência
  ou supervisão do acesso; o filtro lateral de supervisão/rota não altera a Executiva enquanto o nível de cima estiver
  marcado (vale de novo ao voltar). O escopo marcado fica ao trocar de aba e voltar; cada nova entrada (e reabrir a página)
  começa no escopo do acesso. O nome da aba continua "Gerencial"/"Supervisão". Implementação: `escopoAcima`
  (`aplicaAcesso` zera), `acimaAtivo()` (aba Executiva e perfil Gerência/Supervisão), lido só por `rotasAtuais` e
  `ctxInicial`; `pintaEscopo` desenha o botão (`#exEsc`, `.exTraco`, `#abaTopo.comEsc` no celular).
- **"Abrir por"** (botões no cabeçalho; o marcado tem `aria-pressed="true"`): **[nível do filtro]** (Gerência na Diretoria,
  Supervisão numa gerência ou grupo, Rota numa supervisão) · **Canal** · **Marca** (só na Diretoria) · **Clientes** · **Key
  Accounts**. Padrão = o nível do filtro, exatamente a tela de antes. Cada entrada pela tela inicial volta ao padrão. Vale em
  três lugares: o bloco **Tendência x Meta**, a **gaveta da categoria** (tocar num medidor) e o **detalhe da Evolução**
  (clicar numa categoria). Sem compra, Agenda e Coberturas (e os KPIs, quadros e medidores) continuam sempre por unidade.
  - **Canal** = segmento do cliente (o da base de clientes). **Clientes** = os 15 maiores em volume (Real até ontem) de cada
    categoria, entre os que têm Meta NEG; nome do cadastro, com "PV · segmento · rota". **Key Accounts** = as redes da base
    (`REDES_CLIENTE`), somando as lojas dela no filtro atual; as 15 maiores em volume por categoria, com "N lojas". A regra dos
    15 maiores fica numa nota abaixo do quadro (não no botão).
  - **Números**: Meta = soma da **Meta NEG** dos clientes (a meta distribuída por cliente), Real = soma do Real deles. Linha de
    total = a soma de **todos** os clientes do filtro (a mesma nos três modos; = Σ dos canais), com a nota "Meta = soma da Meta
    NEG dos clientes (X% da meta oficial em Refrigerantes)": a meta oficial é a do medidor (META_VOLUME), maior porque parte
    dela não está distribuída por cliente (em 29/10/2026, na Diretoria: Refrigerantes 98,2%, Cervejas 95,8%, Still 97,0%, Água
    Mineral 95,1%, Novos Negócios 98,5%).
  - **Sem tendência** por canal, cliente ou Key Account (não existe a Meta NEG restante por cliente; nada é estimado): o bloco
    vira **"Realizado x Meta NEG por canal"** (desvio = Real ÷ Meta NEG − 1, barras divergentes como as de sempre, nome com 96
    px no canal e 118 px no cliente/KA, com reticências), a tendência aparece como "—" na caixa de comentário e a nota diz
    "Tendência por canal depende de dado novo". A gaveta da categoria mostra a mesma tabela do nível (abaixo), com "Meta NEG",
    a Tendência "—" (verde com Real ≥ Meta NEG, vermelho abaixo), o Online = Σ do online de hoje dos clientes da linha (sem
    cor: não há meta do dia por cliente) e a mesma nota. No detalhe da Evolução, só o mês atual
    (Real ÷ Meta NEG), com "O mês anterior por canal depende de dado novo" (sem estimar o anterior).
  - **Quem entra** (decisões da Karen, 30/10/2026): as rotas do filtro sem as virtuais e as EV* (que não têm clientes). A
    supervisão oculta (SV.G3.3) entra no total e no Canal, como no total da gerência, mas fica fora das listas: Clientes, Key
    Accounts e a busca (como as listas de clientes). Neutraliza entra em tudo.
  - **Marca**: o botão aparece só na Diretoria e, ao tocar, mostra o aviso "Marca: depende da descoberta no Datasphere" (sem
    números) no lugar das barras, da gaveta e do detalhe da Evolução.
  - Depende de dado novo: **D1** tendência por cliente (Meta NEG restante por cliente), **D2** mês anterior por cliente e
    **D4** marca.
- **Busca** (no cabeçalho fixo; campo arredondado com a lupa no PC, só a lupa no celular): cliente (nome do cadastro ou PV) e
  Key Account dentro do filtro atual (sem as virtuais, as EV* e a SV.G3.3), sem acento e sem diferença de maiúsculas; até 12
  sugestões (no máximo 4 Key Accounts antes dos clientes), a Key Account com a etiqueta **KEY ACCOUNT**. Escolher abre a
  **ficha na gaveta**: título = o nome; subtítulo "PV · segmento · rota · visita · Key Account" (cliente; sem a Key Account
  quando ele não tem) ou "Key Account · N lojas no filtro atual". **Volume do mês**: um cartão por categoria com Meta NEG e Real
  (soma das lojas na Key Account), sem a barra de tendência; categoria sem Meta NEG = cartão com faixa cinza e "sem Meta NEG".
  **ICS GC** e **Novos Negócios**: os quadrinhos da busca das abas (real / sem compra / não elegível = KS TT fora dos 4
  segmentos; na Key Account, "x/y lojas").
- **4 KPIs** (cards brancos, número em Source Serif 4): **Base total de clientes**, **Sem compra** ("X% da base · sem compra
  no mês"), **Visitas hoje** e **Categorias na tendência** ("x / 5", verde ou vermelho pela mesma regra do card do Volume, e
  "Coberturas no ritmo: a / b" = os cards de ritmo do ICS GC e de Novos Negócios somados). Os números são os dos cards Base,
  Sem compra e "visitas hoje" com o mesmo filtro. Base e Visitas abrem a gaveta Base; Sem compra, a gaveta Sem compra (as
  mesmas dos cards, com a barra de dias, abrindo no "Hoje": "Visitas de hoje" e "Sem compra hoje"; ver "Gavetas com barra
  de dias").
- **Foco do fechamento** (categoria em análise): "Refrigerantes está em 92% de tendência; faltam 553.417 para a meta. A
  gerência GC.AT concentra 63% dessa falta (403.372)." Falta = Meta − Tendência; a maior falta entre as unidades fora da
  tendência (% de tendência abaixo de 100), em % da soma das faltas delas. Na tendência: "… no caminho da meta".
- **Meta do dia (SAP)**: online de hoje contra a meta do dia (a mesma do card) e quantas unidades já alcançaram (meta do
  dia batida ou online >= meta do dia, a regra da caixa Online). Sem meta do dia: "sem meta do dia do SAP neste escopo".
- **Categorias**: um medidor (meia-lua) por categoria de volume (Refrigerantes, Cervejas, Still, Água Mineral,
  Novos Negócios; Del Valle Frut fica fora), preenchido com Real ÷ Meta (até 100%) na cor da categoria; no centro o % real;
  "faltam X para a meta" (X = Meta − (Real + online de hoje) do próprio medidor, como a Diferença dos cards e o Faltam da
  gaveta da categoria, em vermelho e negrito; com Real + online ≥ Meta, "meta batida · +X", X = Real + online − Meta, em
  verde; sem online (fechamento, com o Real do mês fechado, ou sem online.json), Meta − Real; sem a linha no medidor sem meta;
  correção de 30/10/2026, decisão da Karen: o % grande e o arco continuam Real ÷ Meta, sem o online); Meta | Real;
  Tendência e o desvio **↓/↑ X,XX%** = |Tendência ÷ Meta − 1| (rosa abaixo de 0, verde a partir de 0, pelo
  valor exato, como o SAC: −0,03% é vermelho mesmo com o card do Volume verde em 100%); "meta do dia N · online N" (ou
  "meta do dia batida" / "meta do dia —"). Tocar num medidor escolhe a **categoria em análise** (borda preta), que muda os
  dois quadros acima, e abre a gaveta da categoria por unidade (abaixo). Sem meta no escopo: "sem meta neste escopo" (o
  medidor não é clicável e não abre a gaveta).
- **Categoria por unidade** (gaveta; desde 22/10/2026; em **tabela** desde a Etapa 6 do pacote v3, 30/10/2026): tocar num
  medidor (ou Enter/Espaço com o foco nele) abre a gaveta **"Refrigerantes por gerência"** (ou "por supervisão", "por rota":
  o nível abaixo do escopo, como na cascata: Diretoria (ou Gerência em BAND) → gerências; gerência (ou Supervisão em GC) →
  supervisões e a linha "Neutraliza"; grupo no Total → as supervisões das duas gerências; supervisão → rotas; "Neutraliza"
  no filtro → as rotas dela; com "Abrir por" canal, cliente ou Key Account, as linhas do modo). O nome da categoria é o
  central ("Novos Negócios", sem a 2ª linha do card). Fechar (ESC, ×, tocar fora) mantém a categoria em análise; os chips do
  celular só escolhem a categoria, sem abrir a gaveta. A Rota não tem a Executiva.
  - Colunas: **#** | **Gerência/Supervisão/Rota** (ou Canal, Cliente, Key Account) | **Meta** | **Real** | **% Real** |
    **Online** | **Faltam** | **Tendência**. Sem barras e sem Desvio: só os números, os mesmos de antes (`agrega()`,
    `statusCat`), mais o Online. No fechamento do mês, sem a coluna Tendência e com o título **"Online hoje"** (7 colunas).
  - Unidade: só o código (GC.UR, SV.G2.1, Rota 111; canal, cliente e Key Account com o nome) e, ao lado, "N supervisões /
    rotas / clientes"; o `title` da linha traz o nome inteiro. % Real = o `pctReal` do card, na cor do status. **Online** =
    volume online de hoje (unidade: o mesmo da caixa Online do card, `onlineVol`; canal/cliente/KA: Σ de
    `ONLINE.volumeCliente` dos clientes): verde com a meta do dia batida ou online ≥ meta do dia, vermelho abaixo, sem cor
    sem meta do dia (e em canal/cliente/KA). **Faltam** = Meta − (Real + Online) em vermelho, a mesma conta da Diferença dos cards
    (pedido da Karen, 30/10/2026); com Real + Online ≥ Meta, "+X" (Real + Online − Meta) em verde; no fechamento e sem online,
    pelo Real (Meta − Real). **Tendência** = o % de tendência do card (`pctTendencia`), no tom escuro do status; "—" sem tendência
    (canal/cliente/KA).
  - **Linha de total no topo**, logo abaixo do cabeçalho e fixa ao reordenar: o código (BAND, GC.G2, GC.IT + GC.MO, SV.G2.1,
    Neutraliza), fundo cinza mais escuro (`--ct-tot` #e3e3e8), negrito e fonte um pouco menor (11 px, `--ct-fs-tot`).
  - **Status** (regra de sempre, `statusCat`), numa faixa de 4 px na lateral esquerda da linha: **verde** "meta batida" = Real
    ≥ Meta; **âmbar** "na tendência" = % de tendência ≥ 100 (o número e a regra do card de Volume, não o ritmo linear: pelo
    ritmo linear a GC.PA em Refrigerantes, 51% real e 104% de tendência em 20/10, ficaria vermelha, contra o card);
    **vermelho** = o resto. No limite vale o número do card: 99,6% de tendência aparece como 100% e fica âmbar.
    **Fechamento**: só verde ou vermelho. Linhas zebradas leves, o hover um tom acima.
  - **Selo "✓ META BATIDA"** (o da cascata, Etapa 3) logo depois do código quando **Real + Online ≥ Meta** (no fechamento,
    Real ≥ Meta), com o fundo verde-claro na linha; no celular só o "✓". O status (faixa) continua pelo Real.
  - **Ordem**: padrão % Real decrescente (Real ÷ Meta exato); os títulos **% Real**, **Online**, **Faltam** e **Tendência**
    reordenam (1º clique decrescente, 2º inverte; seta ↓/↑; o título ativo em `--vermelho2`); a "Neutraliza" sempre por
    último. Unidade sem meta na categoria fica fora; o Real (e o Online) dela continua no total, como o das rotas virtuais e das
    eventuais (EV*), que nunca têm linha.
  - Subtítulo: "Real até ontem ÷ Meta · cor pela tendência do SAC · 16 gerências · ordenado por % da meta" (ou "online",
    "faltam", "tendência"); no fechamento, "Realizado ÷ Meta · cor pelo realizado · …"; por canal/cliente/KA, "Real até ontem
    ÷ Meta NEG · sem tendência · …". Rodapé: a legenda das três cores e "Clique em % Real, Online, Faltam ou Tendência para
    reordenar".
  - Passar o mouse, focar pelo teclado (Tab passa pelos títulos que ordenam e depois de linha em linha) ou tocar numa linha
    abre a caixa de comentário: Meta / Real até ontem (X%) / Online (· meta do dia) / Tendência (Y%); no toque, rolar a lista
    fecha a caixa.
  - **Celular** (< 700 px): sem as colunas #, Meta e Real; o nome sem o "N supervisões"; um valor fora do comum (ex.: o % de
    uma meta de 0,1 cx) quebra dentro da célula; sem rolagem lateral em 360 px. A gaveta mantém a aparência de sempre
    (moldura, cabeçalho, ×); a tabela é conteúdo novo (classes `.ct*` dentro do `.cuGav`), em Inter, com a escala própria
    (12 px; cabeçalho 10 px; variáveis `--ct-*`) e algarismos alinhados. O cartão `cartaoCat` continua só na ficha da busca.
- **Tendência x Meta por gerência / supervisão / rota**: barras divergentes do desvio Tendência ÷ Meta − 1 (1 casa), da
  maior para a menor, com a linha de total no meio da ordenação; verde à direita, vermelho à esquerda; escala de cada
  categoria pela maior barra (mínimo 10%). Unidade sem meta na categoria fica fora dela. No PC as 5 categorias lado a lado
  (a partir de 1200 px; entre 1000 e 1199 px, em duas linhas); no celular, uma por vez, escolhida pelos chips. Passar o
  mouse, focar pelo teclado ou tocar numa linha abre a caixa de comentário ("Refrigerantes · GC.UR / Meta / Real (%) /
  Tendência / Desvio +14,94%").
- **Sem compra por unidade**: barra = sem compra ÷ base, só o % (1 casa), do maior para o menor; caixa: "483 sem compra de
  1.818 clientes na base / Compraram no mês: 1.335".
- **Agenda de hoje por unidade**: barra 100% sobre os agendados de hoje: vermelho = **restam** (sem compra no mês e sem
  pedido online hoje), verde = sem compra no mês mas pediu online hoje, cinza = já comprou no mês; à direita "restam N",
  da maior sobra para a menor. Como nas listas de clientes, ficam fora as virtuais, as EV*, a SV.G3.3 (oculta) e as rotas
  sem venda no mês (sem dado de compra): o "sem compra hoje" do total é exatamente a gaveta "Sem compra hoje" (e os que
  pediram online são os riscados dela). Por isso os agendados da Agenda podem ser um pouco menos que o KPI Visitas hoje.
- **Coberturas por unidade**: tabela com o % real do mês de cada item (o mesmo % dos cards): **ICS GC** (os 9 itens),
  **Novos Negócios** (5) e **Todos a Bordo 3.0** (Status "x/n" itens em 100% e os 5 itens, só nas rotas com meta do item,
  como na aba). Vermelho e negrito abaixo do ritmo (o % do dia útil de ontem), verde a partir de 100%, "—" sem meta.
  Linhas zebradas (branco e `--zebra` #f6f6f8, também na 1ª coluna presa); a linha de total (BAND ou a unidade do filtro)
  com fundo `--zebra-tot` #e4e4e8 e negrito; passar o mouse escurece a linha um tom acima (o painel só tem fundo claro: os
  dois fundos, preto e branco, são só da entrada).
  Colunas iguais, a 1ª (70 px) presa; com menos de ~1520 px de tela (painel lateral aberto) a tabela rola de lado dentro
  do bloco. O nome inteiro de cada item fica no `title` do cabeçalho.
- **Fechamento do mês**: medidores e barras pelo **realizado** (Real ÷ Meta − 1, "Realizado x Meta"); sem os quadros/blocos
  "Meta do dia" e "Agenda de hoje" (não há online nem agenda do mês fechado). O Foco do fechamento usa o realizado
  ("Refrigerantes fechou o mês em 95% da meta; faltaram …").
- **Evolução contra o mês anterior** (Etapa 8c, 22/10/2026; **barras pareadas** desde o ajuste do mesmo dia; **só Volume**):
  o último bloco, depois de "Coberturas por …".
  Compara onde estamos com onde estávamos **no mesmo dia útil do mês anterior**, pela chave `MES_ANTERIOR` do payload
  (ver "Chave `MES_ANTERIOR`"). Aparece com `CONFIG.EVOLUCAO_ATIVA = true` **e** a chave no payload; sem ela (payload
  antigo, ou a consulta do mês anterior falhou ou passou de 60 s na rodada) o bloco fica oculto, sem erro. A Rota não tem
  (não tem a Executiva).
  - Subtítulo: "% real até ontem: Outubro/26 (dia útil 14 de 21) contra Setembro/26 no mesmo dia útil (até 21/09)."
    (`MES_LABEL`, `DIA_ONTEM` e `TOTAL_DIAS_UTEIS` do payload; `MES_ANTERIOR.MES_LABEL` e `DATA_CORTE` em dd/mm; nada fixo).
    Mês anterior com menos dias úteis que o `DIA_ONTEM` (vale ele inteiro, decisão 1): "… contra Setembro/26 inteiro (21
    dias úteis, até 30/09)." No fechamento: "% real: Setembro/26 (fechado) contra Agosto/26 (fechado)."
  - **Uma linha por categoria** (os 5 macros, na ordem de sempre, com o nome central: "Novos Negócios", sem a 2ª linha do
    card), no **total do escopo**: BAND na Diretoria; com filtro, o total da gerência, do grupo no Total ou da supervisão (o
    mesmo total dos outros blocos, com as rotas ocultas, virtuais, "{GC}-EV" e Neutraliza dentro). Mês anterior = soma dos
    pares `[Real até o corte, Meta]` das rotas (`NUCLEO.mesAnterior`; item null = a rota fica fora); % anterior = Real ÷ Meta;
    % atual = o % real do medidor (Real até ontem ÷ Meta do mês, sem arredondar); **Δ p.p.** = % atual − % anterior;
    **Δ Real** = Real atual ÷ Real anterior − 1 (só na caixa de comentário).
  - Cada linha tem **duas barras hachuradas** empilhadas sobre trilhas de 0 a 100% da meta: **em cima, em vermelho escuro**
    (`--ruim`; até 29/10/2026 era sólida), o mês de referência; **embaixo, em cinza**, o mês anterior no mesmo dia útil. Nas
    linhas por unidade (barra fina) a hachura é um pouco mais densa (passo de 3 px em vez de 4). Uma marca preta no fim da trilha
    indica 100% da meta; acima de 100% a barra enche até o fim e o número mostra o valor (ex.: 112,0%).
  - À direita, alinhados com as barras: o % do mês de referência (1 casa, negrito, Source Serif 4) e, embaixo, o do mês
    anterior (cinza; "—" sem meta anterior); ao lado, numa coluna estreita, o **Δ** em p.p. com 1 casa: **▲ verde** quando
    subiu, **▼ vermelho** quando caiu, **cinza sem seta** com 0,0 exato e "—" cinza sem dado (o sinal vem do valor exato, não
    do texto arredondado). Abaixo de 700 px o nome da categoria fica numa linha própria e o Δ desce para baixo dos valores.
  - Legenda: quadrado hachurado em vermelho escuro = o mês de referência ("Outubro/26 até 21/10"), hachurado = o mês anterior no mesmo dia útil
    ("Setembro/26 no mesmo dia útil (até 21/09)"), a marca de 100% e a regra do Δ.
  - **Detalhe por clique**: clicar numa categoria (ou Enter/Espaço com o foco nela; a seta gira e `aria-expanded` muda) abre
    logo abaixo, na própria página (não na gaveta), as unidades do escopo no mesmo desenho, menor: Diretoria → as
    gerências; gerência ou grupo no Total → as supervisões (com a linha "Neutraliza") das gerências; supervisão → as rotas.
    Ordem: Δ decrescente; unidade sem meta anterior (ou sem meta no mês) na categoria: "—", no fim. Clicar de novo recolhe;
    várias categorias podem ficar abertas. Trocar o filtro ou o perfil (e cada entrada pela tela inicial) recolhe tudo; a
    atualização do online e do payload não.
  - Caixa de comentário (mouse, teclado e toque; na categoria e em cada unidade): "Refrigerantes · BAND / Setembro/26 até
    21/09: Real 2.795.812 (47,1% da meta 5.933.000) / Outubro/26: Real 2.910.283 (41,2% da meta 7.065.000) / Δ −5,9 p.p. ·
    Real +4,1%". No toque, tocar na categoria abre as unidades e mostra a caixa; o 2º toque recolhe e fecha.
  - Decisões da Karen (21/10/2026), as mesmas da chave: (1) mês anterior com menos dias úteis que o N de hoje = ele
    inteiro; (2) **fechamento x fechamento**: com o painel em fechamento, o mês fechado contra o anterior a ele INTEIRO
    (corte = o último dia dele), com as metas dele; (3) Real do mês anterior pela rota ATUAL do cliente, na gerência de
    hoje, e o das EV* na rota oculta "{GC}-EV"; (4) % = Real até o corte ÷ meta do mês anterior inteiro (META_VOLUME da
    rota da meta; sem ela, META_NEG), Δ p.p. e Δ Real como acima; (5) só Volume, coberturas fora; (6) fora também Todos a
    Bordo, Del Valle Frut, Imperdoáveis e Venda Zero; (7) KS TT pelo segmento de hoje só quando as coberturas entrarem.
  - Conferência com dado real: `conferencia_real.test.js` (invariantes em `frontend/tests/evolucao_invariantes.js`, com as
    categorias abertas: Real e Meta de cada linha = medidor; % e Δ; Σ unidades + rotas fora = total; "—"; largura das
    barras) e o antes x depois contra a main de antes do redesenho, com o mesmo payload (as outras telas iguais).
- **Layout**: KPIs em 4 colunas no PC e 2 no celular; os dois quadros lado a lado no PC; medidores 5 por linha a partir de
  1200 px, 3 entre 700 e 1199 px e 2 no celular; Sem compra e Agenda lado a lado no PC.

### Cabeçalho das abas (Volume, ICS GC, Novos Negócios, Todos a Bordo)

Desde a Etapa 4 (21/10/2026), o alto de cada aba é organizado assim (os números são os mesmos de antes):

- **Cabeçalho travado no PC** (Etapa 7 do pacote v3): a partir de 1000 px a linha do título (nome da aba, botão "Clientes" e
  etiqueta do dia) fica presa no alto ao rolar, com o fundo da página e uma sombra discreta, como a da Executiva; o resto
  (Base, Sem compra, linha de resumo, ficha da busca, filtro rápido) rola normalmente. Para isso a `section#abaTopo` fica sem
  caixa no PC fora da Executiva (`display: contents`): ela continua o landmark "região" com o nome da aba (`aria-labelledby=
  "abTit"`; conferido na árvore de acessibilidade do Chromium) e a ordem visual e de leitura não muda. No celular nada muda
  (o cabeçalho rola com a página).
- **Título e etiqueta do dia**: o nome da aba e, à direita, a etiqueta "Dia útil 14 de 21 · Semana 3" (no celular,
  "Quarta-feira · Sem. 3") com um "i". Passando o mouse (ou com o foco do teclado, ou tocando no celular), abre uma caixa
  de comentário com o dia da semana e o dia útil, "Real até ontem: dia útil 13/21 (62%)", "Para entrar no ritmo hoje:
  67%", "Semana N°3 (ímpar)" e "Dias úteis pela frente, com hoje: 8" (no fechamento do mês, sem esta última linha). A
  caixa some ao tirar o mouse, no ESC, tocando de novo, tocando fora ou rolando a página. Sem subtítulo.
- **Linha de resumo**: o **card de ritmo** (card branco: rótulo, ícone, "x / n", legenda), com a mesma regra e as mesmas
  cores de antes: no Volume, "Categorias na tendência" (era "Ritmo de coberturas"; só o nome mudou); no ICS GC e em Novos
  Negócios, "Ritmo de coberturas"; no Todos a Bordo, "Itens em 100%" com a linha "Status". Ao lado, o **"puxa a média"**
  (a mesma escolha de antes) num quadro de destaque: ícone "!", "Gerência / Supervisão / Rota que mais puxa a média para
  baixo", o nome em vermelho e "x de n indicadores no ritmo" (antes, "na meta"); sem ele no Todos a Bordo e na Rota. Por
  último, a **busca de clientes** (a mesma), com o rótulo "Busca por cliente" (pequeno, caixa alta, cinza de apoio) acima
  do campo e o placeholder "Digite nome, código ou rede". No PC a linha é 260 px | 1fr | 1,1fr; no celular, a busca fica na linha de
  baixo. A ficha do cliente abre logo abaixo da linha. (No PC, desde a Etapa 7 do pacote v3: 234 px | 1fr | 1,1fr; 221 px
  em telas até 820 px de altura.)
- **Base total de clientes** ("visitas hoje N") e **Sem compra X%** ("sem compra hoje N"), no mesmo formato, só com uma
  supervisão (ou "Neutraliza") ou uma rota no filtro (perfis Supervisão e Rota, ou a Gerência com uma supervisão/rota
  escolhida): ficam acima da linha de resumo. Na Diretoria e na Gerência eles saem das abas (a aba Executiva traz esses
  números). Sem o "puxa a média" (a Rota sempre), o card de ritmo vai para a linha deles: **três cards
  lado a lado**, e a busca fica sozinha na linha de baixo. Os dois cards abrem as gavetas com barra de dias (abaixo).
- **Filtro rápido dos cards**: acima da grade, "Todos N · Abaixo N · No ritmo N". Só mostra ou oculta os cards (a ordem e
  as cores não mudam); o card indisponível só aparece em "Todos"; um filtro sem card fica desabilitado; volta para
  "Todos" ao trocar de aba (e quando o filtro escolhido fica sem card numa atualização).

### Gavetas com barra de dias (Volume, Base e Sem compra)

Desde a Etapa 6 (21/10/2026), três listas de clientes ganharam a mesma barra de dias de visita das listas de cobertura
("Hoje · Seg · Ter · Qua · Qui · Sex · Todos"), com a mesma regra e a mesma aparência (nenhum estilo novo na gaveta):

- **"Hoje"** = quem tem visita hoje (o campo de visita de hoje do SAP, que respeita a semana par/ímpar); **um dia** = quem
  tem esse dia no dia de visita: o cliente com mais de um dia ("Seg - Qui", "Ter - Sex"...) aparece em **cada um** dos dias
  dele (na Seg e na Qui) e uma vez só no "Todos"; **"Todos"** = todos.
- **Volume** (lista de clientes da cascata, o último nível): abre em **"Todos"** (a lista de antes: Meta, Real, Dif. Abs e
  %, do mais negativo para o mais positivo); os chips só filtram, a ordem fica.
- **Base** (card Base total de clientes; na Executiva, os KPIs Base e Visitas hoje): abre em **"Hoje"** = a lista "Visitas de
  hoje" de sempre (riscado + "Venda Online" para quem já pediu online hoje). Um dia = os clientes da base com visita no dia;
  "Todos" = a base. Título "Visitas de hoje" no Hoje e "Clientes da base" nos outros.
- **Sem compra** (card Sem compra; na Executiva, o KPI Sem compra): abre em **"Hoje"** = a lista "Sem compra hoje" de
  sempre (agendados de hoje sem compra no mês). Um dia e "Todos" = os clientes da base **sem compra no mês**
  (`SEM_COMPRA_MES`) com visita no dia / todos. Título "Sem compra hoje" no Hoje e "Sem compra" nos outros; riscado +
  "Venda Online" para quem pediu online hoje. Payload sem `SEM_COMPRA_MES` (o de antes da Etapa 1): só o "Hoje", sem a
  barra.
- **Números**: o "Hoje" da Base é o "visitas hoje" do card Base; o "Hoje" do Sem compra, o "sem compra hoje" do card; o
  "Todos" do Sem compra, o Sem compra do card (o `semCompra` das rotas); o "Todos" da Base, a Base total. Como nas listas
  de clientes de sempre, as rotas virtuais, as das eventuais (EV*) e a supervisão oculta (SV.G3.3) ficam fora das listas,
  mas a SV.G3.3 está nos cards: na G3 e na Diretoria a lista fica abaixo do card exatamente pelos clientes dela (21/10:
  295 na base, 63 visitas hoje e 23 sem compra). Quando alguma rota do filtro não tem venda no mês, o card mostra "sem
  venda do dia" no lugar do "sem compra hoje" e a lista traz as rotas com dado.
- O "Hoje" vem inteiro, como antes. Nos outros dias e no "Todos" (a base da Diretoria tem ~29 mil clientes) a lista mostra
  os primeiros 400 (`CONFIG.LIMITE_LISTA`, o das listas da cascata) e "+ N clientes — filtre por rota para ver todos."; o
  subtítulo traz sempre o total ("1.327 clientes na base", "182 de 1.327 clientes da base · nenhum faturamento no mês").
- Cada vez que a gaveta abre, a barra volta ao padrão.

### Botão "Clientes" por agrupador, com busca (Volume, ICS GC, Novos Negócios, Todos a Bordo)

Desde a Etapa 4 do pacote v3 (30/10/2026; só front), o cabeçalho das 4 abas tem, antes da etiqueta do dia, o botão
**Clientes** (arredondado, ícone de pessoas, borda cinza, fundo branco; borda preta no hover). Não aparece na aba Executiva
(Diretoria, Gerencial, Supervisão); no perfil Rota aparece (a lista da rota). Ele abre a gaveta **"Clientes · <agrupador>"**
com a lista de clientes do filtro atual:

- **A lista é a mesma do último nível da cascata** (as mesmas funções e regras; os cards e a cascata não mudam): Volume =
  Cliente | Meta | Real | Online | Dif. Abs | %, pela Dif. Abs (barra de dias em "Todos"); ICS GC, Novos Negócios e Todos a
  Bordo = só quem ainda não comprou o item, pelo nome, com a barra de dias em "Hoje" e o riscado "Venda Online"; Venda Zero
  = os equipamentos, pelas geladeiras.
- **Um botão por agrupador** no alto (o mesmo estilo dos chips de dia), na ordem dos cards: os que abrem a cascata (o
  indicador disponível no filtro). Volume = os 5 macros (e o Del Valle Frut onde o card dele aparece: na G2, fora da
  Diretoria); ICS GC = os itens e a Venda Zero; Novos Negócios = os itens; Todos a Bordo = os itens com rota com meta no
  filtro. Subtítulo: "<aba> · " + o resumo do card (ex.: "Volume · Meta 7.065.000 · Real 5.319.114 · tendência 93%").
- **Rotas**: as do filtro sem as virtuais, as das eventuais (EV*) e a supervisão oculta (SV.G3.3), como nas listas de
  sempre, e **só as que têm o agrupador disponível** (decisão da Karen de 30/10/2026); no Todos a Bordo, só as com meta do
  item. Na Gerência, na Supervisão e na Rota, é exatamente o que a cascata mostra (ela não entra em rota "indisponível"); na
  Diretoria a cascata abre a gerência direto nos clientes e mostra também os das rotas sem o agrupador (em 29/10/2026, por
  exemplo, 95 clientes de KS TT, 194 de Artd KO e 440 de Perfetti TT), que ficam fora do botão.
- **Busca** ("Buscar cliente (nome ou PV)", acima dos botões): filtra enquanto digita, sem acento e sem diferença de
  maiúsculas, pelo nome ou pelo PV (contém). Procura na lista inteira, antes do limite de 400 linhas: o aviso "+ N clientes
  — filtre por rota para ver todos." conta só os que casam; sem resultado, "Ninguém neste filtro.". A busca e o dia
  escolhido continuam ao trocar de agrupador ou de dia; ao reabrir a gaveta, tudo volta ao padrão. Nenhum PV está em mais
  de uma rota do roster (29/10/2026: 0 de 29.289), então a busca por um PV inteiro dá 1 linha (um PV mais curto pode estar
  contido em outro).
- O card "Busca por cliente" da aba e a ficha do cliente não mudam. Na gaveta, só o campo de busca é estilo novo
  (`.cliBusca`, com a escala no próprio escopo); os botões e as listas são os de sempre.
- Testes: Parte AH do `front.test.js` e a conferência com dado real (invariantes em `frontend/tests/clientes_invariantes.js`:
  lista do botão = a cascata percorrida inteira, só rotas com o agrupador, busca = a lista filtrada; e o antes x depois contra
  a main `9364d62` com o mesmo payload).

### Rótulo "Novos Negócios" do macro de volume Dest+Art+Cnd

O macro de volume `VOL DEST+ART+CND` (no payload e no back-end, rótulo "Dest+Art+Cnd"; nada muda lá) aparece no painel como
**Novos Negócios**. O rótulo fica num lugar só, `config.js`: `CONFIG.ROTULO_VOLUME_NOVOS` ("Novos Negócios"),
`CONFIG.ROTULO_VOLUME_SUB` ("Dest+Art+Cnd") e `rotuloFront(k, rotulo)`, que troca o nome desse macro e devolve o rótulo de
quem chama nos demais (usada pelo `rotuloInd` do app.js, pelo resumo.js e pelo ritmo.js). Onde aparece:

- **Card da aba Volume** (Diretoria, Gerência, grupos, Supervisão e Rota): "Novos Negócios" e, embaixo, "Dest+Art+Cnd" numa
  2ª linha menor e mais clara (`.ind .tsub`: `--fs-card-sub` 11 px, `--fw-card-sub` 400, `--txt-apoio`, ~5,7:1 no rosa e
  no verde claro). Só esse card tem a linha; para a grade não deformar, a lista que tem esse card dá a todos os cards de
  volume a altura mínima `--h-card-vol` + a linha (os cards de volume continuam iguais entre si).
- **Só o nome** ("Novos Negócios", sem a 2ª linha): visão executiva (medidores, Tendência x Meta, chips, Foco do fechamento,
  Meta do dia, Evolução, dicas), título da gaveta (só o texto; nenhum estilo novo), ficha da busca, Resumo de vendas e PDF,
  Painel de Ritmo.
- Não confundir com a **aba/grupo de coberturas Novos Negócios** (`NOVOS_NEG`: Campari, Dreher, Perfetti TT, Artd KO,
  Aperol), que não muda.

### Visual (fonte, escala e cores)

- **Fonte**: Inter variável servida pelo próprio site, sem CDN nem Google Fonts:
  `frontend/assets/fonts/inter-latin-wght-normal.woff2` (48 KB, carregado com `preload`) e
  `inter-latin-ext-wght-normal.woff2` (85 KB, só baixado se a página usar um caractere fora do latin), do pacote
  `@fontsource-variable/inter` 5.3.0, com a licença em `frontend/assets/fonts/OFL.txt` (SIL Open Font License 1.1).
  `@font-face` com `font-display: swap`; fallback `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`.
  Como a fonte chega depois do 1º desenho, `encaixa()` mede de novo quando ela carrega, e o PDF do Resumo espera
  `document.fonts.ready` antes da captura. Para trocar a versão: copiar os dois `*-wght-normal.woff2` e o LICENSE do
  pacote para `assets/fonts/` (os nomes ficam iguais).
- **Números grandes em Source Serif 4** (desde a Etapa 2): `frontend/assets/fonts/source-serif-4-latin-wght-normal.woff2`
  (50 KB, só o subset latin, mesmo `unicode-range` da Inter; `@fontsource-variable/source-serif-4` 5.3.0, licença em
  `OFL-source-serif-4.txt`), `@font-face` local com `font-display: swap` e pesos 200-900, sem `preload` (só é baixada
  quando a tela principal desenha um número). Variável `--serif` (`'Source Serif 4', Georgia, 'Times New Roman', serif`)
  aplicada SÓ ao % dos cards (`.ind .big`; a seta ▲▼ fica na Inter), ao número da caixa Online (`.obox b`), aos
  números dos cards do topo e dos KPIs da Executiva (`.card .n`) e ao % no centro dos medidores da Executiva (`.gPct`; o
  "real" embaixo fica na Inter). A gaveta, o Resumo, o PDF do Resumo, o Painel de Ritmo, a entrada e os textos
  continuam em Inter. Os números da tela principal (cards, cards do topo, cabeçalho, busca, rodapé) usam
  `font-variant-numeric: lining-nums tabular-nums` (algarismos alinhados e de largura fixa); a gaveta, o Resumo e o
  Painel de Ritmo ficam como estavam. Os números dos cards do topo também encaixam (`data-fit`, mínimo 16 px; se nem
  assim couber, quebram como antes).
- **Escala tipográfica** (variáveis em `:root` do `app.css`; o celular, até 640 px, redefine; a partir de 1000 px o painel
  lateral e o conteúdo usam ~90%/~85% destes valores desde a Etapa 7 do pacote v3: ver "PC mais compacto" abaixo; a coluna
  "PC" é a de antes, que continua valendo na gaveta, no Resumo, na entrada e em 641-999 px):

  | Nível | PC | Celular | Peso | Onde |
  |---|---|---|---|---|
  | `--fs-titulo` | 30 px | 24 px | 700 | cabeçalho, entrada, título do Resumo |
  | `--fs-card` | 19 px | 18 px | 600 | título do card e da caixa de seleção |
  | `--fs-ind` | 30 px | 28 px | 700 | o % dos cards; números dos cards do topo |
  | `--fs-valor` | 15 px | 14 px | 500 | Meta e Real dos cards, opções |
  | `--fs-legenda` | 12,5 px | 12 px | 400 | legendas, hora de atualização, seletores e abas |
  | `--fs-nota` | 11,5 px | 11 px | 400 | rodapé da página (rotas · mês · dias úteis, clientes que compraram, Online, Fonte) e crédito |
  | `--fs-nota-mini` | 9,5 px | 9,5 px | 400 | legendas abaixo dos blocos da visão executiva e crédito do painel lateral |

  As duas `--fs-nota*` (ajuste de rótulos) deixam as notas ~1 px menores (eram `--fs-legenda`, `--fs-ex-mini` e
  `--fs-lado-sec`), com as mesmas cores (AA: rodapé 5,9:1, crédito 4,8:1, painel lateral 7,3:1). A gaveta (`.drw`, inclusive
  as notas de rotas virtuais e eventuais), o Resumo, os PDFs e o Painel de Ritmo não usam.

  Os cards de indicador (`.ind`) redefinem a escala no próprio escopo, ~12% menor e igual no PC e no celular:
  título 15 px (`--fs-card`; a 2ª linha do card Novos Negócios 11 px, `--fs-card-sub`), Meta/Real/Diferença 11,5 px (`--fs-valor`), % até 25 px (`--fs-ind`), oportunidades
  11 px (`--fs-legenda`), "no ritmo"/"faltam" 12,5 px (`--fs-acao`), número do Online até 19 px (`--fs-online`) e
  rótulos do Online 9,5 px (`--fs-online-rot`).
  O % dos cards e o número do Online partem da escala e só diminuem se não couberem (`data-fit=""` + `encaixa()`). As tabelas do
  Resumo mantêm os tamanhos próprios das caixas (`.rs-k`), que se ajustam ao número de colunas (16 gerências na
  Diretoria, PDF). Alturas mínimas por tipo: `--h-card-vol`, `--h-card-cob` (cobertura e Todos a Bordo; 136 px no PC
  e 134 px no celular, a altura natural dos cards com a escala menor), `--h-kpi`,
  cards da mesma linha da grade ficam com a mesma altura. O indicador de ritmo (caixa Online) dos cards tem tamanho,
  raio e peso fixos (`--ritmo-*`).
  A aba Executiva tem a própria escala, também em `:root` e igual no PC e no celular (`--fs-ex-*`): título dos blocos 16
  px, título dos medidores 13 px, % do medidor 20 px, Meta/Real 13,5 px (encaixa até 9 px), tendência 15 px, desvio 12 px,
  linhas das barras 11,5 px, células da tabela 12 px, rótulos pequenos 10,5 px (as legendas abaixo dos blocos, 9,5 px:
  `--fs-nota-mini`) e cabeçalho da tabela 10 px.
- **PC mais compacto** (Etapa 7 do pacote v3, 30/10/2026): a partir de 1000 px a tela fica ~90% do tamanho de antes e, em
  telas baixas (até 820 px de altura, ex.: 1366x768 e 1280x720), ~85%, para o painel lateral não rolar e caber mais
  informação. Só por variáveis de tamanho (nunca `zoom` nem `transform: scale`), em dois blocos `@media` no fim das regras de
  tela do `app.css` (`(min-width:1000px)` e `(min-width:1000px) and (max-height:820px)`). As letras e os espaçamentos ficam no
  escopo `.lado` (painel lateral) e `.wrap` (conteúdo: cabeçalho das abas, cards do topo, linha de resumo, busca, cards de
  indicador, filtro rápido, KPIs e blocos da Executiva, barra do Resumo de vendas e rodapé); alturas mínimas, caixa Online e
  largura do painel em `:root`. A gaveta (`.drw`), a tela do Resumo e o PDF, o Painel de Ritmo, a entrada, a faixa de versão
  nova e a caixa de comentário ficam fora dessas caixas e não mudam; abaixo de 1000 px nada muda. Os números, textos, cores e
  a ordem são os mesmos; os `data-fit` continuam encaixando o % e o Online. Valores (antes → 90% → 85%):

  | Variável | Antes | PC | PC baixo |
  |---|---|---|---|
  | `--fs-titulo` / `--fs-card` / `--fs-ind` | 30 / 19 / 30 | 27 / 17 / 27 | 25,5 / 16 / 25,5 |
  | `--fs-valor` / `--fs-legenda` | 15 / 12,5 | 13,5 / 11,5 | 13 / 10,5 |
  | `--fs-nota` / `--fs-nota-mini` | 11,5 / 9,5 | 10,5 / 8,5 | 10 / 8 |
  | `--fs-lado-tit` / `--fs-lado-aba` / `--fs-lado-sec` | 22 / 14 / 10,5 | 20 / 12,5 / 9,5 | 18,5 / 12 / 9 |
  | `--fs-busca-rot` / campo da busca | 10,5 / 16 | 9,5 / 14,5 | 9 / 13,5 |
  | `--fs-ex-bloco` / `-gtit` / `-gpct` / `-valor` / `-tend` | 16 / 13 / 20 / 13,5 / 15 | 14,5 / 11,5 / 18 / 12 / 13,5 | 13,5 / 11 / 17 / 11,5 / 13 |
  | `--fs-ex-pill` / `-rot` / `-cel` / `-mini` / `-th` / `-busca` | 12 / 11,5 / 12 / 10,5 / 10 / 13 | 11 / 10,5 / 11 / 9,5 / 9 / 12 | 10 / 10 / 10 / 9 / 8,5 / 11 |
  | cards `.ind`: `--fs-card` / `--fs-valor` / `--fs-ind` / `--fs-legenda` | 15 / 11,5 / 25 / 11 | 13,5 / 10,5 / 22,5 / 10 | 13 / 10 / 21 / 9,5 |
  | cards `.ind`: `--fs-acao` / `--fs-online` / `--fs-online-rot` / `--fs-card-sub` / `--pad-esq` | 12,5 / 19 / 9,5 / 11 / 15 | 11,5 / 17 / 8,5 / 10 / 13,5 | 10,5 / 16 / 8 / 9,5 / 13 |
  | `--h-card-vol` = `--h-card-cob` / `--h-kpi` | 136 / 124 | 122 / 112 | 116 / 105 |
  | linha "Status" do card do topo (`.card .st`, `--fs-st`) | 10 | 9 | 8,5 |
  | `--ritmo-h` / `--ritmo-w` / `--ritmo-raio` | 62 / 84 / 10 | 56 / 76 / 9 | 53 / 71 / 8,5 |
  | `--lado-aberto` / `--lado-recolhido` | 272 / 76 | 245 / 68 | 231 / 64 |
  | coluna do card de ritmo (`--abres-col`) / mínimo da grade (`--lista-min`) | 260 / 340 | 234 / 340 | 221 / 310 |

  Espaçamentos novos (só no PC, mesma proporção): `--lado-pad`, `--lado-gap`, `--lado-menu`, `--lado-tab-pad`, `--lado-ico`,
  `--lado-btn-h` e afins no painel; `--aba-mt`, `--abcab-*`, `--cards-gap`, `--card-pad`, `--ki`, `--foco-pad`, `--busca-pad`,
  `--chip-pad`, `--lista-gap`, `--ind-*`, `--obox-pad` no conteúdo; `--exfoco-pad`, `--bloco-pad`, `--gauges-gap`, `--gcard-pad`,
  `--gsvg`, `--gpct-mt`, `--divs-gap`, `--exab-*` na Executiva. O mínimo da grade dos cards fica em 340 px no PC comum: com
  menos (306-330 px), em 1680-1920 px a grade ganhava uma coluna e o % de números de 7 dígitos cortava (conferido com o payload
  real e o sintético "grande"); em tela baixa (letra ~85%), 310 px cabem e 1280x720 passa a ter 3 colunas (eram 2).
  Testes: Parte AK do `front.test.js`.
- **Cascata (gaveta que abre no card)**: mantém a aparência de antes do ajuste visual (commit `0a59eb4`), fora o que a Karen
  autorizou na Etapa 3 do pacote v3 (só classes novas, abaixo), em todos os
  níveis (gerências, supervisões, rotas, clientes, Visitas de hoje, Sem compra, Venda Zero): tamanhos, pesos,
  espaçamentos, colunas, alturas, bordas e cores de antes, e os cinzas antigos (`--cinza`, `--cinza-escuro`
  redefinidos em `.drw`). A única diferença é a fonte: Inter, herdada do body (o % da linha de grupo era serifado). A
  barra de dias que entrou na lista de volume e nas gavetas Base e Sem compra (Etapa 6) é a mesma das listas de cobertura,
  com o mesmo estilo.
  A escala tipográfica, as alturas mínimas e a regra do vermelho NÃO valem dentro dela. Em 390 px o nome do cliente
  na lista de volume (`.cCli .nm`, coluna estreita) corta com reticências, como antes. A gaveta "Categoria por unidade" da
  visão executiva é conteúdo novo dentro dela, só com classes novas (`.cu…`, escala e cores próprias); nada do que está
  acima muda. **Etapa 3 do pacote v3 (autorizada)**: a linha da cascata de todas as abas menos a Venda Zero (`.cLin.v3`, com
  `.cNomeL`, `.cSelo`, `.cPct`, `.cDif`; fundo `--bat-bg` #eef8f2 e borda `--bat-borda` #cfe9db com o selo), o cabeçalho de
  colunas (`.cOrd`, PC) e os chips "Ordenar:" (`.cOrdCh`, celular) e a lista de clientes de volume com Online
  (`.cCab.v3`/`.cCli.v3`); no PC (>= 1000 px), com a cascata aberta (`#drw[data-casc]`; não na Venda Zero), a gaveta tem
  `max-width: 860px` (centralizada à direita do painel lateral), menos padding no cabeçalho e no corpo e as linhas em
  colunas fixas (`--casc-cols`: as do mockup, `minmax(190px,260px) 140px 92px 170px 140px`, com mínimos menores para caber a
  1000 px, quando a gaveta tem 728 px). A caixa do Online (`.cOn`), as linhas sem dados (`.cLin.off`), a nota das
  virtuais, o botão de voltar, a barra de dias, as listas de cobertura e de Venda Zero e as gavetas Base, Sem compra e
  "Categoria por unidade" não mudam.
- **Cards de indicador**: grade `repeat(auto-fill, minmax(var(--lista-min), 1fr))` a partir de 1000 px (340 px; 310 px em
  tela baixa: 3 colunas em 1366-1536 px e em 1280x720, 4 em 1920 px, 2 em 1000-1280 px com mais de 820 px de altura); no
  celular, uma coluna. Faixa lateral de 5 px (`border-left`) na cor do status: `--ruim` abaixo,
  `--verde` no ritmo; o padding esquerdo desconta a faixa (o conteúdo começa onde começava) e o card indisponível
  (`.off`) não tem faixa.
- **Cores**: o fundo rosa (abaixo do ritmo/tendência) e o verde claro (no ritmo) dos cards são premissa (não mudaram
  com a faixa). O **vermelho**
  fica só para o % abaixo, o déficit ("Diferença" negativa e "faltam", classe `acao falta`) e os alertas ("puxa a
  média", avisos e erros). Meta, Real, rótulos e textos de apoio ("abaixo da tendência", "oportunidades do dia",
  "meta do dia", legendas) usam `--txt`/`--txt-apoio` (fora da cascata), com contraste AA (4,5:1) nos fundos claros e escuros. O verde
  do ritmo não muda. Divisórias: espaço (gap) e, onde separa, linha de 1 px de baixa opacidade (`--linha-suave`).
- **Cabeçalho no celular** (até 640 px): mesma informação, mais baixo (em 390 px, 213 px até o fim das abas, eram
  295 px): bloco de datas sem caixa em até 2 linhas, seletores e abas numa linha; a barra continua sticky.

## Volume: tendência pelo critério do SAC

Por rota × macro de volume (Refrigerantes, Cervejas, Still, Água Mineral, Novos Negócios = Dest+Art+Cnd):

| Campo | Conta |
|---|---|
| Meta | `META_VOLUME_Chave_Meta_SAP`: a meta da rota (o SAC mostra ela no campo "Meta NEG") |
| Vol Real | `FX_VOL_PADRAO_FAT` do mês com `NF_STATUS_Nota_Fiscal` em Acertado, Meta Neg ou Em Aberto |
| Neg Restante | `META_NEG` de hoje até o fim do mês pela rota da meta (`CD_ROTA_Chave_Meta_SAP`), direto quando a `META_NEG` do mês fica a até 1% da Meta; senão Meta × (restante ÷ mês) |
| Tendência | Vol Real + Neg Restante |
| % Tendência | Tendência ÷ Meta; verde a partir de 100% |
| Dif | Vol Real − Meta |
| Meta do dia | `META_RECUPERAVEL_ROTA` pela rota da meta (`CD_ROTA_Chave_Meta_SAP`, como o SAC) com `DATA_MOVIMENTO` = hoje (sem a medida, fica "—") |

A rota da meta é a mesma que o SAC usa: pela rota atual do cliente, quem foi transferido levaria a curva
para outra rota. Se a consulta pela rota da meta não funcionar, o gerador volta à curva pela rota do cliente
(sempre escalonada) e avisa. Casos-limite: rota com META_VOLUME mas sem META_NEG usa os dias úteis restantes (contando hoje) no lugar da
curva; rota sem META_VOLUME usa a soma de META_NEG como meta; sem nenhuma das duas, o indicador fica
indisponível, a não ser que a rota tenha Real na categoria (diferente de zero com 1 casa): aí, desde 27/10/2026, entra com meta 0 e tendência = Real,
para o Real somar no total da gerência como no SAC (ex.: R31 Cervejas, T07; só os 5 grupos, Del Valle Frut não). Cada caso aparece nos avisos da execução, assim como a meta da rota não distribuída nos
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
  (entra no total)`, `clientes em rotas EV* (rota oculta, entra no total)`, `gerência do modelo ≠ gerência do painel
  (rota atribuída a outra gerência)`, `rota da meta ≠ rota do cliente` ou `outra: ...`. Sinal: − = só o SAC conta
  naquela gerência; + = só o painel. A E7 imita o painel: clientes em EV* na rota oculta da gerência comercial (só a
  venda com rota da meta; a sem rota da meta aparece como `fora do painel: EV*`, "venda sem rota da meta") e meta do
  dia pela rota da meta.
- **E7c**: rotas do painel que o modelo põe em outra gerência e rotas fora do painel com clientes de outra gerência
  (ex.: a EV1 é da G1 na base, mas o cliente é da G2 no modelo), com uma linha sobre o par G2/G3.
- **E7d**: uma linha por gerência: "explicado por: <causa> (<valor> cx)" e o resíduo.
- Só códigos de rota, supervisão e gerência: nunca nomes nem códigos de clientes.
- Em 20/10/2026 a E7 explicou tudo (resíduo ≤ 1 cx): o SAC soma pela gerência comercial do cliente
  (`DS_GERENCIA_COMERCIAL_AT_Clien`) e inclui os clientes que estão em rotas EV*; o painel não incluía (Real −407 cx
  nas 16; meta do dia −1.071 cx, que é de rotas do painel mas estava em clientes das EV*). No mesmo dia o painel passou
  a somar o Real desses clientes na rota oculta da gerência e a meta do dia pela rota da meta; a E7 imita essas regras.
- Em 27/10/2026, contra o Flash de Vendas, o SAC bateu (≤ 0,5 cx nas 16 gerências x 5 macros) somando pela gerência
  da meta (`DS_GERENCIA_COM_Chave_Meta_SAP`): a venda em rota EV* sem rota da meta não entra. O painel passou a deixá-la
  fora no mesmo dia (Refri −442, Água −1.478, Still −117, DAC −49, Cerv −27 cx na BAND).

### Descoberta do incentivo Todos a Bordo 3.0 (seção E8)

(Desde a aba Todos a Bordo (chamada "Incentivo" até 21/10/2026), os 5 itens estão no gerador: a E8 passa a mostrar "sim" na consulta e a chave INC de cada um.
Na conferência de 20/10/2026 a meta do payload bateu com a E8c nos 5 itens: Cervejas 15.992 em 213 rotas, Heineken
6.273 em 81, Eisenbahn - 600ml 460 em 182, Heineken - 600ml 2.871 em 81, Cervejas 600ml Retornável 4.732 em 182.)

Campanha de cobertura de cervejas (itens: Cervejas, Heineken, Eisenbahn 600ml, Heineken 600ml e Cervejas 600ml
Retornável). A E8 sai sempre no relatório, para o mês de hoje, e **só relata** o que existe no Datasphere antes da aba
Todos a Bordo; nada muda no painel. Gerência = a da rota no painel; `fora` = rota fora do painel (EV*, balcão...).

- **E8a**: todos os agrupadores (da venda, `DS_AGRUPADOR_Agrupador_Prod`, e da meta, `AGRUPADOR_PRODU_Chave_Meta_SAP`)
  com HEINEKEN, EISENBAHN, CERVEJ ou 600 (sem acento e sem diferenciar caixa; o "600" traz também os refrigerantes
  600ml): linhas (rota x cliente), clientes com cobertura realizada > 0, soma da meta de cobertura (o maior valor por
  rota, como o gerador) e rotas com meta > 0, no total e por gerência.
- **E8b**: qual agrupador corresponde a cada item (venda e meta) ou "não encontrado", e os "parecidos" (outros
  agrupadores que começam igual, ex.: "Heineken - 600ml Vr"). Se Eisenbahn 600ml ou Heineken 600ml não existirem na
  venda, lista as colunas de produto do `$metadata` (AGRUPADOR, MARCA, FAMILIA, EMBALAGEM, PRODUTO, SKU; só texto, sem
  as de cliente) com os valores que têm HEINEKEN ou EISENBAHN (até 20) e se aceitam agregação no servidor.
- **E8c**: por item, a meta na BAND e por gerência, rotas do painel com e sem meta; para os itens Heineken, o
  portfólio (definição da Karen, 20/10/2026): **BARRACUDA** = filial com CD da Heineken, sem meta de Heineken. Rota com
  meta = **FULL**, sem meta = BARRACUDA; supervisão e gerência com as duas ficam com a classificação da **maioria das
  rotas** (ex.: SV.G2.1, 4 de 7 rotas com meta = FULL); empate fica sem informação ("—"). Só contam as rotas
  normais (Neutraliza e virtuais ficam fora; nas listas, marcadas (N) e (V)). Por gerência: portfólio, rotas normais
  com · sem meta, supervisões por portfólio, as rotas com meta (gerência mista) e as sem meta (até 40); depois, a tabela
  das supervisões mistas, a divisão das gerências e as supervisões com portfólio diferente do da gerência. As rotas
  T<nn> (T07, T29...) sem meta contam como BARRACUDA; uma linha diz o que mudaria sem elas (observação do dado).
- **E8d**: clientes com compra no WF Online de hoje ('Inc. e Exp.') por item e gerência, se a consulta de vendas do
  gerador já traz o agrupador e se ele já vira indicador; para o que não vira, o que faltaria.
- **E8e**: clientes distintos com cobertura realizada > 0, sem as notas fiscais canceladas (como o painel), por item e
  gerência.
- **E8f**: proposta de mapeamento: item → agrupador → chave interna sugerida (INC ...) → tem meta? → tem online? →
  observações.

### Sem compra no mês (`SEM_COMPRA_MES`, seção E9)

Chave do `payload.json` (desde 21/10/2026; Etapa 1 da visão executiva): por rota, os PVs dos clientes da base da rota
que **não compraram no mês** (nenhuma compra ou cobertura nos 17 agrupadores do painel), em ordem crescente; `null` na
rota sem venda no mês (sem dado), como o `semCompra`. É o mesmo cálculo do card "Sem compra" (base − compraram): o
tamanho da lista é sempre o `semCompra` da rota, e a lista "Sem compra hoje" (`SEM_COMPRA_HOJE`, os agendados de hoje
sem compra no mês) está sempre contida nela. Mesmas rotas e ordem do `SEM_COMPRA_HOJE` (Neutraliza, virtuais e as rotas
ocultas das EV* seguem a mesma regra; o painel as esconde como hoje). No fechamento do mês, é do mês fechado.

- Opcional e a última chave do payload antes da `MES_ANTERIOR` (opcional, Etapa 8b): payload sem ela (o publicado antes
  desta versão) continua abrindo igual. A
  validação não reprova por ela; só **avisa** se o tamanho de alguma lista for diferente do `semCompra` ou se o "Sem
  compra hoje" de alguma rota não estiver dentro dela.
- Peso: no payload real de 21/10/2026 (4.631 clientes sem compra em 231 rotas), +39 KB (6,60 → 6,63 MB); no pior caso
  (começo do mês, a base inteira sem compra, ~29 mil clientes) cerca de +0,24 MB, abaixo do limite de atenção de 8 MB.
- Desde a Etapa 6 a lista alimenta a gaveta "Sem compra" fora do "Hoje" (os dias da barra e o "Todos"; ver "Gavetas com
  barra de dias"). Sem a chave, a gaveta fica só no "Hoje".

**Seção E9** do relatório "Conferir tendência": roda **depois** do `gerar.py`, sobre o `payload.json` que ele gravou
(no workflow, o passo "E9"; local: `python scripts/conferir_tendencia.py --saida DIR --e9 DIR/payload.json`, sem rede,
acrescenta a seção ao `relatorio_tendencia.md` da pasta). Por gerência e no TOTAL BAND: rotas, rotas com lista, soma
dos tamanhos das listas × soma de `semCompra`, rotas com divergência (com os códigos), soma do "Sem compra hoje" e rotas
em que ele não está contido; quanto a chave acrescenta ao payload (KB e %) e o tempo (serializar, a seção e o
`gerar.py` completo). Só contagens e códigos de rota: nunca nomes nem códigos de clientes. Sem o payload (o `gerar.py`
reprovou) ou com um payload sem a chave, a seção diz isso.

### Mês anterior no mesmo dia útil (seção E10)

Descoberta da Etapa 8 da visão executiva (o bloco "Evolução contra o mês anterior" da aba Executiva, ainda oculto). A
pergunta: dá para comparar onde estamos com onde estávamos no **mesmo dia útil do mês anterior** (calendário de vendas)?
Quanto custa? A E10 sai sempre no relatório do "Conferir tendência" (antes da seção 9) e **só relata**. Só nomes de
colunas, contagens, totais por gerência e códigos de rota. Desde a Etapa 8b o corte, a consulta do Vol Real com corte e
a meta por rota estão em `backend/gerador/mes_anterior.py` (a E10 importa de lá) e o gerador grava a chave
`MES_ANTERIOR` (seção seguinte); a E10 grava também `e10_mes_anterior.json` ao lado do relatório, que a E11 usa.

Para rodar com o dado real: **Actions → Conferir tendência → Run workflow**, com a branch em "Use workflow from" (o
input `hoje` simula outra data, ex.: um dia de fechamento). Local (precisa do `backend/.env`):
`python scripts/conferir_tendencia.py --saida DIR`. A E10 está no `relatorio_tendencia.md` do artifact.

- **E10a. Calendário.** "Mesmo dia útil" = o nº de dias úteis já fechados no mês de referência (`DIA_ONTEM`; no
  fechamento, o total do mês fechado), limitado ao total de dias úteis do mês anterior. A data vem do calendário do
  Datasphere (o 1º dia de semana com aquele `NO_DIA_UTIL`, que considera os feriados regionais); sem as linhas do mês
  anterior, do cálculo local (só feriados nacionais), e a linha diz qual valeu. O **corte** (inclusive) vai até a véspera
  do dia útil seguinte: entram o sábado, o domingo e o feriado logo depois do dia útil N, como o Real do mês de
  referência traz as NF desses dias. Exemplo: em 21/10/2026 o 13º dia útil fechado é 20/10; em setembro o 13º é sexta
  18/09 e o corte vai até domingo 20/09. Bordas: mês anterior com menos dias úteis = ele inteiro; sem dia útil fechado =
  nada a comparar (na prática o painel já está em fechamento); fechamento = o mês fechado contra o anterior no mesmo dia
  útil (desde a decisão de 21/10/2026: contra o anterior **inteiro**). A tabela de variantes mostra o dia proporcional
  (N ÷ dias do mês × dias do anterior) e o mês anterior inteiro.
- **E10b. Consultas.** Cada consulta como o gerador faria (agregada no servidor), com as linhas devolvidas, os segundos
  e o resultado. A pergunta principal é se o filtro `DATA_MOVIMENTO <= corte` funciona em cada medida:
  - Vol Real (`FX_VOL_PADRAO_FAT`, os 5 macros e os status do Vol Real), com e sem o corte, conferido com a curva diária
    do mês anterior (BAND por dia);
  - o mesmo pela rota da meta;
  - META_NEG do mês e até o corte;
  - cobertura (`FX_COBERTURA_REALIZADO`, sem as notas fiscais canceladas, como o painel) por rota x cliente até o
    corte (todas as gerências) e no mês inteiro (amostra), e também só por rota x agrupador (se a medida já contar
    clientes no servidor, a consulta fica pequena);
  - a gerência da chave de meta por rota nos dois meses.

  Resultados possíveis: "sim (bate com a curva diária)", "sim (menor que o mês inteiro)", "**não**: igual ao mês inteiro
  (filtro ignorado?)", "**não**: veio vazio", "**a conferir**" e "**erro**". A seção diz também quanto do Real do mês de
  referência tem `DATA_MOVIMENTO` >= hoje: se houver, o Real do painel não é só "até ontem".
- **E10c. Amostra** (G1, AP e IT, `E10_AMOSTRA`; faltando dado, as próximas do painel; e a BAND). Por macro de volume:
  - mês anterior: Real até o corte, Meta (META_VOLUME; sem ela, a META_NEG), % = Real ÷ Meta, e META_NEG até o corte
    com Real ÷ META_NEG (o ritmo);
  - mês de referência: Real (o Vol Real do painel), Meta e %;
  - Δ p.p. e Δ Real.

  Nas coberturas (os 13 itens do ICS GC e dos Novos Negócios): Real até o corte, Meta, %, o Real do mês anterior inteiro
  e o mês de referência. As contas são as do card: só as rotas com o indicador; a rota oculta dos clientes em EV* entra
  com meta 0; KS TT só nos segmentos elegíveis.
- **E10d.** Refrigerantes em todas as gerências e na BAND.
- **E10e. Custo.**
  - Tempo: o que o gerador precisaria (Real até o corte, metas e META_NEG do mês anterior; cobertura até o corte), com o
    nº de consultas, as linhas, a soma e o maior tempo. O `gerar.py` leva hoje ~64 s; com as consultas novas em
    paralelo, o acréscimo fica perto da maior delas; em série, a soma.
  - Peso: a chave proposta `MES_ANTERIOR` (opcional e a última do payload, fora da validação obrigatória) traz o
    calendário do corte e, por rota, [Real até o corte, Meta] de cada item (null sem o indicador). A E10 mede o peso com
    e sem as coberturas, somado ao payload publicado do checkout, e avisa acima de 8 MB. Desde a Etapa 8b a chave existe
    (só Volume; seção seguinte).
- **E10f. Riscos e dúvidas.**
  - Rotas que mudaram de gerência (gerência da meta, `DS_GERENCIA_COM_Chave_Meta_SAP`, no mês anterior x hoje).
  - Rotas com meta no mês anterior que saíram do painel, e rotas do painel sem meta no mês anterior (o card não soma o
    Real delas).
  - Real fora do painel (EV* e outras).
  - Real pela rota do cliente x pela rota da meta, por gerência. `CD_ROTA_Clien` é a rota ATUAL do cliente: pela rota
    do cliente, o mês anterior sai com a estrutura de hoje.
  - As sete decisões da Karen (21/10/2026), que a chave `MES_ANTERIOR` segue (seção seguinte).

### Chave `MES_ANTERIOR` (mês anterior no mesmo dia útil, só Volume; seção E11)

Etapa 8b (21/10/2026): o gerador grava no fim do `payload.json` onde estávamos **no mesmo dia útil do mês anterior**, para
o bloco "Evolução contra o mês anterior" da aba Executiva (lido pelo front desde a Etapa 8c; ver "Aba Executiva").
Código em `backend/gerador/mes_anterior.py`; nomes e constantes em `mapeamento.py` (`CHAVE_MES_ANTERIOR`,
`INDICADORES_MES_ANTERIOR`, `MES_ANTERIOR_LIMITE_S`).

```json
"MES_ANTERIOR": {"MES_LABEL": "Setembro/26", "DIA_UTIL": 13, "TOTAL_DIAS_UTEIS": 21, "DATA_CORTE": "2026-09-20",
  "FECHADO": false, "IND": ["VOL REFRIGERANTES", "VOL CERVEJAS", "VOL STILL", "VOL AGUA MINERAL", "VOL DEST+ART+CND"],
  "ROTAS": {"111": [[real_ate_o_corte, meta_do_mes_anterior], null, ...]}}
```

Decisões da Karen (21/10/2026):

1. **Dia útil**: N = `DIA_ONTEM` (dias úteis fechados), limitado ao total do mês anterior (com menos dias úteis, vale ele
   inteiro). O corte (inclusive) vai até a véspera do dia útil N+1 (entram o sábado, o domingo e o feriado logo depois
   do dia útil N), pelo calendário do Datasphere; sem as linhas do mês anterior, pelo cálculo local. Ex.: em 21/10/2026
   (DIA_ONTEM 13) o corte é 20/09 (13º dia útil = sexta 18/09).
2. **Fechamento x fechamento**: com o painel em fechamento (o mês de referência é o fechado), o mês anterior a ele entra
   **inteiro**: `DATA_CORTE` = o último dia dele, `DIA_UTIL` = `TOTAL_DIAS_UTEIS` dele, `FECHADO: true`, com as metas dele.
3. **Estrutura**: Real pela rota ATUAL do cliente (`CD_ROTA_Clien`), na gerência de hoje; o Real das rotas EV* vai para a
   rota oculta "{GC}-EV" da gerência comercial, como o Real do mês de referência.
4. **Base do %**: Real até o corte ÷ meta do mês anterior **inteiro** (META_VOLUME da rota da meta; sem ela, META_NEG do
   mês), o mesmo "% real" dos medidores da Executiva. Δ p.p. = % do mês de referência − % do anterior; Δ Real = Real de
   hoje ÷ Real do anterior até o corte − 1 (contas do front, no bloco da Executiva).
5. **Só Volume**: os 5 macros (`IND`). Coberturas fora nesta rodada.
6. Ficam fora: Todos a Bordo (chaves INC), Del Valle Frut, Imperdoáveis e Venda Zero.
7. KS TT do mês anterior pelo segmento de hoje: só quando as coberturas entrarem.

Regras da chave:
- `ROTAS` tem todas as rotas do payload de hoje, na ordem dele (Neutraliza, virtuais e as ocultas "{GC}-EV" inclusive).
  Por rota, um par `[Real até o corte, Meta]` por item de `IND` (1 casa), ou `null` onde a rota não tem o indicador no
  mês anterior (sem META_VOLUME, META_NEG nem Real). Sem as metas mas com Real, `[Real, 0]` (desde 27/10/2026, como no
  card). A rota oculta "{GC}-EV" tem meta 0 nos macros com Real. Rota do mês anterior que não existe hoje fica fora (a E10 mediu 0 casos); Real de EV* de uma
  gerência sem a rota oculta hoje também (vai para o log).
- Consultas (agregadas no servidor, `DATA_MOVIMENTO` só no `$filter`): Vol Real até o corte por rota do cliente x
  agrupador x NF_STATUS (os status do Vol Real; com a gerência comercial para as EV*), META_VOLUME por rota da meta e
  META_NEG do mês inteiro por rota da meta. Rodam em threads daemon junto com as consultas do mês
  (`fontes.carregar`); se alguma falhar ou o conjunto passar de **60 s**, a chave fica fora, vai um aviso para o log e a
  rodada segue (nada disto reprova nem segura a publicação). Real negativo ou valor não finito: a chave também fica fora
  (aviso).
- **Sem dia útil fechado** (`DIA_ONTEM = 0`, fora do fechamento): sem corte e sem a chave.
- **Validação** (`validacao._mes_anterior`, nenhuma chave obrigatória nova): aviso se a chave faltar com `DIA_ONTEM > 0`
  (também no fechamento), se o Real BAND do mês anterior for 0 ou se alguma meta vier negativa; erro só para NaN/inf ou
  Real negativo na chave (o gerador já a tira nesses casos).
- Peso: a E10 estimou +19 KB (~250 rotas); tempo do `gerar.py` meta < 120 s (a E10 estimou +14 s em série; em paralelo,
  perto da maior consulta nova). O `gerar.py` grava `mes_anterior_s` e `mes_anterior_espera_s` no `GITHUB_OUTPUT`.

**Seção E11** do "Conferir tendência" (como a E9: depois do `gerar.py`, sobre o payload que ele gravou; no workflow, o
passo "E9 e E11"; local: `python scripts/conferir_tendencia.py --saida DIR --e11 DIR/payload.json [--e9-duracao S]
[--e11-tempo S] [--e11-espera S]`, sem rede, com o `e10_mes_anterior.json` que a E10 gravou na mesma pasta):
- **E11a** Real de cada macro na chave (todas as rotas) x a consulta direta com o filtro de data (todas as linhas por
  rota do cliente), com o que fica fora da chave (rotas sem o indicador, EV* fora da rota oculta, rotas fora do painel)
  e o resíduo; e a consulta direta dos 5 macros x a curva diária até o corte;
- **E11b/c** Refrigerantes por gerência: chave x E10d (Real e Meta do mês anterior) e Real de hoje do payload x E10d,
  com %, Δ p.p. e Δ Real;
- **E11d** tamanho da chave e do payload (limite de atenção 8 MB); **E11e** tempo das consultas do mês anterior, a espera
  depois das do mês e o `gerar.py` completo (meta < 120 s);
- **E11f** rotas: no payload x na chave, todas null, com algum null, as ocultas das EV*; **E11g** o caso (normal, mês
  limitado ou fechamento).
Só totais, contagens e códigos de rota e gerência: nunca nomes nem códigos de clientes.

Depois do merge: rodar **"Atualizar dados"** uma vez para o payload publicado trazer a chave.

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
- A entrada com perfis (Diretoria, Gerência, Supervisão e Rota, por seleção, sem usuário; a senha da Diretoria só
  com os hashes em `config.js`) é só organização interna, não protege os dados:
  quem tiver o endereço de `frontend/data/*.json` lê tudo.
