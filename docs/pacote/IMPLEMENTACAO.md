# Desempenho de Rotas — Implementação da visão executiva e do novo layout

Pacote preparado em 21/10/2026 a partir do diagnóstico e do mockup aprovados. Base de código conferida:
commit `04e373f` (merge da PR #21, 21/10/2026). Mockup de referência montado com os dados de 20/10/2026 18:58.

## Como usar este pacote

1. Abra o chat onde você atualiza o acompanhamento (com acesso ao repositório).
2. Descompacte o **`pacote_implementacao_desempenho_rotas.zip`** (entregue junto com este documento). Dentro dele estão
   este arquivo, a pasta `assets/` (logos e fonte) e a pasta `referencia/` (mockup). Envie ao outro chat o zip inteiro
   ou, se ele não aceitar zip, este arquivo + os 6 arquivos de `assets/` (e, se aceitar HTML,
   `referencia/mockup_aba_executiva.html`). A lista completa está na seção 9.
3. Cole o bloco **"Prompt para o outro chat"** abaixo como primeira mensagem.
4. Peça uma etapa por vez (seção 6). Cada etapa termina numa PR para você revisar; nada entra na `main` sem o seu ok,
   porque o push na `main` publica o site.

---

## Prompt para o outro chat

> Você vai implementar no repositório `AcompanamentosRota/Desempenho_Rotas` a evolução aprovada do painel: aba
> **Executiva**, **painel lateral no PC**, **cabeçalho das abas**, **cards com faixa lateral**, **gavetas com barra de
> dias**, **entrada com logos** e **números em Source Serif 4**. A especificação completa está no arquivo
> `IMPLEMENTACAO.md` que enviei; o arquivo `referencia/mockup_aba_executiva.html` é a referência visual e de
> comportamento (abra no navegador; os números são de 20/10/2026).
>
> Regras:
> 1. Antes de qualquer alteração, leia `CLAUDE.md` e `README.md` inteiros e siga as regras deles. Se algo deste pacote
>    conflitar com uma regra do `CLAUDE.md`, pare e me pergunte.
> 2. **A regra do site publicado predomina.** Nenhuma fórmula comercial muda. Os números novos saem de
>    `NUCLEO.agrega` / `agrega()` e das estruturas que já existem; não recalcule por fora.
> 3. O mockup foi escrito com estruturas próprias (dados por rota achatados). **Não copie o JavaScript dele**: use-o só
>    como referência de layout, textos, interações e números esperados.
> 4. Trabalhe por etapas (seção 6). Uma branch e uma PR por etapa, com testes. **Não faça merge na `main` nem publique
>    sem a minha autorização explícita.**
> 5. Respeite: Inter e Source Serif 4 **locais** (nunca CDN nem Google Fonts); escala de fontes só por variáveis de
>    `:root` / escopo; **gaveta (`.drw`) com a aparência do commit 0a59eb4** (só conteúdo novo, nenhum estilo novo);
>    cabeçalho no celular ≤ 221 px até o fim das abas (Parte M); fórmulas espelhadas entre `modelo.py` e `nucleo.js`.
> 6. Ao fim de cada etapa: rode `python -m unittest discover -s tests -t .` (backend) e `node --test
>    frontend/tests/front.test.js`, confira os números da seção 7, verifique em 1440 px e 390 px e me entregue um resumo
>    do que mudou, dos testes rodados e do que falta.
> 7. Se uma regra comercial estiver ambígua, não escolha: pergunte (as pendências conhecidas estão na seção 8).
>
> Comece pela leitura do repositório e me confirme o plano da **Etapa 1** antes de codar.

---

## 1. Decisões aprovadas (não rediscutir)

| Tema | Decisão |
|---|---|
| Fonte da verdade | A regra do site publicado predomina em qualquer conflito. |
| Projeção | **Tendência do SAC** (Real até ontem + Neg Restante), a mesma do card. Projeção linear descartada. |
| Necessidade diária | Só a **meta do dia do SAP** (`META_RECUPERAVEL_ROTA`, `metaDia`). Nada de déficit ÷ dias restantes. |
| Real | Volume Real = **até ontem**. |
| Prioridade entre unidades | **Contra a tendência** (Meta − Tendência). |
| Mês anterior | Comparar com onde estávamos no **mesmo dia útil** do calendário de vendas no mês anterior. Depende de consulta nova (Etapa 8). |
| Meta 0 | Rotas com meta 0 **continuam somando o Real** (clientes movimentados). |
| Fonte tipográfica | **Inter** no texto + **Source Serif 4** nos números grandes, algarismos alinhados e de largura fixa (`lining-nums tabular-nums`). |
| Aba Executiva | Nome "Executiva". Visível para **Diretoria, Gerência e Supervisão**; **não** para Rota. |
| Card de ritmo do Volume | Rótulo **"Categorias na tendência"** (mesma regra, só o nome). |
| Cards de indicador | **Fundo rosa/verde como hoje** + **faixa lateral** de 5 px na cor do status. Fontes ~12% menores. |
| Base e Sem compra | Cards **só nas visões Supervisão e Rota** (Diretoria e Gerência têm a Executiva). |
| Layout no PC | Cabeçalho vira **painel lateral** (recolhível); conteúdo na largura da tela. Celular mantém a estrutura atual. |
| Executiva — retirados | "Fechamento do mês", "Onde agir", "Execução do dia" e mapa de calor **não entram**. |

---

## 2. Layout geral

### 2.1 PC (≥ 1000 px): painel lateral

- O `header.topo` + `nav.barra` viram uma coluna fixa à esquerda (272 px; recolhida = 76 px, só ícones), fundo
  `--preto`. Sem duplicar HTML: envolver os dois num `<aside class="lado">` que no celular é `display:contents`
  (mantém a `.barra` sticky como hoje) e no PC é `position:fixed`; no PC, `.topo`, `.barra` e os `.hd` internos
  viram `display:contents` e a ordem sai por `order`.
- Ordem no painel: botão ☰ (recolher) → marca → "Desempenho de Rotas" → mês + etiqueta de atualização + escopo →
  **Filtro** (selects empilhados, largura total) → **Painéis** (abas na vertical, com ícone; ativa em `--vermelho`)
  → caixa de ritmo (a de hoje) → no rodapé, **↻ Atualizar o painel** e **Entrada** (os botões de `.topoBtns`) →
  créditos (`CONFIG.CREDITOS`).
- Recolhido: só ícones (☰, abas, ↻, casa), com `title` para o nome. Estado pode ficar em `localStorage`
  (try/catch), como conveniência.
- Conteúdo: `body{padding-left:var(--lado)}`; `.wrap` sem `max-width`, padding lateral `clamp(20px, 2.4vw, 40px)`.
  Gaveta (`.drw`) passa a começar em `left: var(--lado)` — **só a posição**, nenhum estilo interno.
- Ícones: SVG inline 20×20 com `stroke: currentColor` (ver os do mockup: Executiva, Volume, ICS GC, Novos Negócios,
  Todos a Bordo, casa, ↻).

### 2.2 Celular (< 1000 px): topo compacto

- Topo: **"Desempenho de Rotas"** + botões ↻ e casa; linha 2: **mês** e a etiqueta de atualização **compacta**
  (só "● 20/10 18:58"; o texto "Última atualização em" fica no `title`); linha 3, sempre visível:
  **"Dia útil 12/21 (57%) · ritmo hoje 62%"** = `DIA_ONTEM/TOTAL_DIAS_UTEIS (PACE_ONTEM_PCT%) · ritmo hoje
  round(DIA_HOJE/TOTAL*100)%`.
- Sai do topo no celular: a linha da marca, a caixa de ritmo de duas linhas e o "· Diretoria" (o escopo está no
  filtro logo abaixo). Respeitar o limite da Parte M (≤ 221 px até o fim das abas).
- Etiqueta do dia no cabeçalho do conteúdo (ver 3.1): no celular mostra **"Terça-feira · Sem. 3"** + ícone "i".

### 2.3 Fontes

- Adicionar `assets/fonts/source-serif-4-latin-wght-normal.woff2` (pacote `@fontsource-variable/source-serif-4`
  5.3.0, OFL em `assets/fonts/OFL-source-serif-4.txt`) com `@font-face` local, `font-display: swap`,
  `font-weight: 200 900`, mesmo `unicode-range` latin da Inter.
- Nova variável `--serif: 'Source Serif 4', Georgia, 'Times New Roman', serif`, aplicada **só** aos números grandes:
  `.ind .big`, `.obox b`, `.card .n`, KPIs da Executiva (`.kn`), % dos medidores (`.gPct`).
- `font-variant-numeric: lining-nums tabular-nums` em todo número (evita os algarismos "dançando" no celular).
- `encaixa()` já remede no `loadingdone`; incluir os elementos novos com `data-fit` (o % dos cards já tem).

---

## 3. Abas de indicadores (Volume, ICS GC, Novos Negócios, Todos a Bordo)

### 3.1 Cabeçalho da aba

- Linha de título: **nome da aba** (h2) à esquerda e **etiqueta do dia** à direita
  ("Dia útil 13 de 21 · Semana 3" no PC; "Terça-feira · Sem. 3" no celular), com ícone "i". **Sem subtítulo.**
- A etiqueta abre a **caixa de comentário** (3.6) com: "Terça-feira · dia útil 13 de 21" / "Real até ontem: dia útil
  12/21 (57%)" / "Para entrar no ritmo hoje: 62%" / "Semana N°3 (ímpar)" / "Dias úteis pela frente, com hoje: 9".

### 3.2 Linha de resumo

- **Card de ritmo** (formato dos cards brancos da Executiva: rótulo, ícone, número `x / n`, legenda), mesma regra de
  hoje: Volume = "Categorias na tendência"; ICS GC/Novos Negócios = "Ritmo de coberturas"; Todos a Bordo = "x / n
  itens em 100%" **com a linha "Status" atual** (`itensEm100`/`linhaStatus`). Cor: verde/vermelho como hoje.
- **"Puxa a média"**: mesmo `piorSv()` de hoje, no formato de quadro de destaque (ícone "!", título "Gerência/
  Supervisão que mais puxa a média para baixo", nome em vermelho + "x de n indicadores no ritmo"). Todos a Bordo e
  Rota continuam sem ele.
- **Busca de clientes** (a de hoje, sem mudar a lógica): no PC, terceira coluna da linha (260 px | 1fr | 1.1fr); no
  celular, linha inteira abaixo. A ficha do cliente abre logo abaixo da linha.
- **Visões Supervisão e Rota**: acima da linha, os cards **Base total de clientes** (legenda "visitas hoje N") e
  **Sem compra X%** (legenda "sem compra hoje N"), no mesmo formato. Na **Rota** (sem "puxa a média") o card de ritmo
  entra na mesma linha: **três cards lado a lado**, como no painel de hoje.

### 3.3 Filtro rápido dos cards

- Chips **"Todos N · Abaixo N · No ritmo N"** acima da grade. Só mostra/oculta (`.ind` com classe extra); **ordem e
  cores não mudam**. Card `.off` só aparece em "Todos". Reinicia em "Todos" ao trocar de aba.

### 3.4 Cards

- **Fundo rosa/verde como hoje** (regra inalterada) + **faixa lateral**: `border-left: 5px solid` `--ruim` (abaixo) /
  `--verde` (ok); padding esquerdo compensado. `.off` sem faixa.
- **Fontes ~12% menores**, só nos cards, por variáveis no escopo `.ind` (ex.: `.ind{--fs-card:…; --fs-ind:…;
  --fs-valor:…; --fs-legenda:…}`), sem tamanho solto. Referência do mockup: título 15 px, Meta/Real/Diferença 11,5 px,
  % até 25 px, "no ritmo/faltam" 12,5 px, oportunidades 11 px, número do Online 19 px, rótulo do Online 9,5 px.
  Ajustar `--h-card-*` se as alturas mínimas ficarem sobrando.
- Grade no PC: `repeat(auto-fill, minmax(340px, 1fr))` (3 colunas em 1440 px).

### 3.5 Gavetas com barra de dias

- **Volume**: a lista de clientes da cascata (`listaVolume`) ganha a barra de dias (`chipsHtml`, `DIAS_CHIP`), padrão
  **"Todos"**, mesma regra das coberturas (`Hoje` = `c[4]===1`; dia = `DIAS[c[3]].includes(chip)`).
- **Card Base** → gaveta com barra de dias, padrão **"Hoje"**: "Hoje" = a lista "Visitas de hoje" atual
  (`CLIENTES_HOJE`, riscado com venda online); outros dias = clientes da base com visita no dia; "Todos" = a base.
  Título: "Visitas de hoje" em Hoje, "Clientes da base" nos demais.
- **Card Sem compra** → gaveta com barra de dias, padrão **"Hoje"**: "Hoje" = `SEM_COMPRA_HOJE` (como hoje); outros
  dias e "Todos" = **`SEM_COMPRA_MES`** (chave nova, Etapa 1) filtrado pelo dia de visita. Título "Sem compra hoje" /
  "Sem compra". Riscado + "Venda Online" para quem está em `onlineIds(r)` (QUALQUER).
- Nada de estilo novo dentro da `.drw` (Parte N).

### 3.6 Caixa de comentário (componente)

- Um `div.dica` único (`position:fixed`, fundo `--carvao`, texto branco 12 px, raio 9 px, sombra) com `role=tooltip`.
- PC: aparece no `pointermove` (tipo `mouse`) acompanhando o cursor; some no `pointerleave`. Teclado: no `focus`.
  Toque: abre/fecha no toque; toque fora fecha; rolar a página fecha. Use `pointerdown` para saber o tipo de
  ponteiro — no celular o navegador dispara um "mousemove" simulado antes do clique.
- A linha/elemento com a dica ganha a classe **`emFoco`** (fundo `#ececef`). **Não use `foco`**: conflita com os
  quadros "Foco do fechamento".
- Valores em verde (`.g`) e vermelho (`.v`) com tons claros para fundo escuro.

---

## 4. Aba Executiva

Primeira aba da barra. Abre por padrão para Diretoria, Gerência e Supervisão (ver pendência 8.3). Tudo recalcula pelo
filtro (Diretoria → gerências; gerência → supervisões + linha Neutraliza; supervisão → rotas), com os mesmos grupos da
cascata (`svsVisiveis`, Neutraliza, virtuais/EV fora das listas de unidades e dentro dos totais).

### 4.1 Cabeçalho e resumo

- Título **"Resumo executivo"** + etiqueta do dia (3.1). Sem subtítulo.
- 4 KPIs (cards brancos, ícone em quadrado cinza, número em Source Serif 4, sem fundo colorido):
  - **Base total de clientes** — `tot.baseTotal`; legenda "Clientes na base". Toque → gaveta Base (3.5).
  - **Sem compra** — `tot.semCompra`; legenda "X% da base · sem compra no mês". Toque → gaveta Sem compra.
  - **Visitas hoje** — Σ `VISITAS_DIA.geral`; legenda "Clientes com visita agendada hoje". Toque → gaveta Base.
  - **Categorias na tendência** — `x / 5` (volume com tendência ≥ 100, mesma regra do card), número verde/vermelho;
    legenda "Coberturas no ritmo: a / b" (ICS GC + Novos Negócios no ritmo).
- 2 quadros de destaque (ícone cinza):
  - **Foco do fechamento** (categoria em análise): "Refrigerantes está em **91%** de tendência; faltam **616.893**
    para a meta. A gerência **GC.AT** concentra **62%** dessa falta (416.990)." — falta = Meta − Tendência; maior
    falta entre as unidades **fora da tendência** (`pctTendencia < 100`); % = falta da unidade ÷ soma das faltas
    positivas dessas unidades. Se a categoria estiver na tendência: "… está em X% de tendência: no caminho da meta."
  - **Meta do dia (SAP)**: "Refrigerantes: online de hoje **367.615** contra meta do dia de **330.997** (111%). 9 de
    16 gerências já alcançaram a meta do dia." — online = Σ `ONLINE.volume`; meta do dia = `metaDia` agregado;
    "alcançou" = `metaBatida(metaDia)` ou online ≥ metaDia. Sem meta do dia: "sem meta do dia do SAP neste escopo".

### 4.2 Categorias (medidores)

- 5 cartões (5 colunas no PC, 3 em ≥ 700 px, 2 no celular). Clicar seleciona a **categoria em análise** (borda preta).
- Meia-lua SVG (`path` com `pathLength=100` e `stroke-dasharray`): preenchimento = **Real ÷ Meta** (limitado a
  100%), na cor da categoria com `stroke-opacity: .55`; trilha `#ececef`. Cores:
  Refrigerantes `#e8231e`, Cervejas `#1fc93a`, Still `#e2ec12`, Água Mineral `#4f86e8`, Dest+Art+Cnd `#9b6bdb`.
- No centro: `pctReal` + "real". Abaixo: **Meta | Real**, **Tendência** (valor) e etiqueta de desvio
  **↓/↑ X,XX%** = |Tendência ÷ Meta − 1| com 2 casas (rosa/vermelho se negativo, menta/verde se ≥ 0).
- Linha cinza: "meta do dia N · online N" (ou "meta do dia batida" / "meta do dia —").

### 4.3 Tendência x Meta por gerência/supervisão/rota

- Seletor de categoria (chips) só no celular; no PC as 5 categorias lado a lado (≥ 1200 px: 5 colunas fixas).
- Barras divergentes por unidade: desvio = **Tendência ÷ Meta − 1** (valor exato, 1 casa na tela), ordem
  decrescente, verde à direita / vermelho à esquerda, escala própria de cada categoria (máx |desvio|, mínimo 10%).
- Linha de total no meio da ordenação, destacada: **"BAND"** na Diretoria; com filtro, o código da própria unidade
  (`GC.AT`, `SV.AP.1`).
- Hover/toque: linha em `emFoco` + caixa de comentário: "Refrigerantes · GC.UR / Meta 145.000 / Real 86.146 (59%) /
  Tendência 166.659 / Desvio +14,94%".
- Unidades sem meta na categoria ficam fora daquela categoria.

### 4.4 Sem compra por unidade | Agenda de hoje (lado a lado no PC)

- **Sem compra**: barra (vermelho 50% de opacidade) = `semCompra ÷ baseTotal`; à direita **só o %** (1 casa);
  ordem decrescente; linha de total (BAND/unidade) destacada no meio. Dica: "483 sem compra de 1.818 clientes na base
  / Compraram no mês: 1.335".
- **Agenda de hoje**: barra 100% empilhada sobre os **agendados de hoje** (`VISITAS_DIA.geral`):
  vermelho 50% = **restam** (sem compra no mês e sem pedido online hoje), verde 50% = sem compra no mês **mas pediu
  online hoje**, cinza = **já compraram no mês**. À direita **só "restam N"**. Ordem: restam decrescente.
  - sem compra hoje = |`SEM_COMPRA_HOJE[r]`|; pediram hoje = |`SEM_COMPRA_HOJE[r]` ∩ `ONLINE.clientes[r].QUALQUER`|;
    restam = sem compra hoje − pediram hoje; já compraram = agendados − sem compra hoje.
  - Dica: "723 clientes agendados hoje / Já compraram no mês: 575 / Sem compra no mês: 148 / Pediram online hoje: 33 /
    Restam: 115".
  - Legenda abaixo: "sem compra no mês e sem pedido hoje (restam) · sem compra no mês, mas pediu online hoje · já
    comprou no mês".
- Virtuais e EV* fora (como as listas de clientes).

### 4.5 Coberturas por unidade (bloco inteiro)

- Tabela: linhas = total (BAND/unidade) + unidades; colunas em três grupos: **ICS GC** (os 9 de `COV_GRUPO.ICS_GC`),
  **Novos Negócios** (`COV_GRUPO.NOVOS_NEG`) e **Todos a Bordo 3.0** (Status + os 5 itens de `GROUPS.INCENTIVO`).
- Célula = **% real do mês** (`agrega().ind[k].pct`): vermelho e negrito abaixo de `PACE_ONTEM_PCT`; verde e negrito
  ≥ 100%; demais em `--txt`; "—" sem meta. **Todos a Bordo segue a regra atual da aba** (cards do ICS só nas rotas com
  meta do item, `rotasInc`/`temMetaInc`; sem meta = "—"); coluna **Status** = "x/n" itens em 100% (`itensEm100`),
  verde só com x = n.
- Cabeçalho organizado: `table-layout: fixed`, colunas iguais, primeira coluna 70 px fixa (sticky no celular),
  `min-width` ~1100 px com rolagem horizontal dentro do bloco; rótulos curtos centralizados e alinhados pela base
  (CCTM 2L Pet, KS TT, Refri Sab. Zero, Cerv. 600ml Ret., Cervejas, Eisen­bahn [hífen opcional], Kapo, Powerade,
  Artd KO | Campari, Dreher, Perfetti TT, Artd KO, Aperol | Status, Cervejas, Heineken, Eisenb. 600ml, Heinek. 600ml,
  Cerv. 600ml Ret.); nome completo no `title`. Nome do grupo centralizado com linha preta de 2 px embaixo e um vão
  entre grupos.
- Hover na linha: fundo `#ececef` (inclusive na célula fixa).

### 4.6 Evolução contra o mês anterior

- Só entra quando houver o dado (Etapa 8). Até lá o bloco **não aparece** (sugestão: `CONFIG.EVOLUCAO_ATIVA=false`).

### 4.7 Fechamento do mês (`P.FECHAMENTO`)

- Proposta (confirmar, 8.2): medidores e barras usam **% realizado** (Real ÷ Meta − 1) no lugar da tendência, com o
  título "Realizado x Meta"; "Meta do dia" e "Agenda de hoje" ficam ocultos (não há online/agenda do mês fechado).

---

## 5. Tela de entrada

- Substituir a linha `.entMarca` (elmo pequeno + texto) por **duas logos lado a lado**, separadas por uma **linha
  vermelha fina** (1,5 px, `--vermelho`, altura ≈ 64 px), acima de "Desempenho de Rotas":
  - esquerda: **Coca-Cola Bandeirantes** (altura 62 px; 52 px em ≤ 380 px);
  - direita: **elmo** (40 px; 34 px em ≤ 380 px) com **"COMERCIAL" / "BANDEIRANTES"** embaixo: duas linhas
    centralizadas, caixa alta, Inter 800, 9,5 px, `line-height 1.08`, `letter-spacing .015em`.
- Arquivos (pasta `assets/logos/` deste pacote → `frontend/assets/`):
  - fundo preto (padrão): `coca-bandeirantes-fundo-escuro.png` ("BANDEIRANTES" em branco) + `elmo-branco.png`, texto
    branco;
  - fundo branco (`.entrada.branca`): `coca-bandeirantes-fundo-claro.png` (original) + `elmo-preto.png`, texto preto.
- `alt="Coca-Cola Bandeirantes"` na logo; o elmo é decorativo (`alt=""`) e o bloco tem `aria-label="Comercial
  Bandeirantes"`.
- Perfis: igual a hoje. Ao entrar, Diretoria/Gerência/Supervisão abrem na Executiva; Rota abre no Volume e não vê a
  aba Executiva.

---

## 6. Etapas (uma PR por etapa)

| # | Etapa | Arquivos principais | Aceite |
|---|---|---|---|
| 1 | **Back-end: `SEM_COMPRA_MES`** — no laço de `montar_payload` (onde já existe `comprou`), `sem_compra_mes[r] = sorted(pvs_roster - comprou)`; `None` sem dado. Chave nova opcional **no fim** do payload (`por_ordem`), fora da validação obrigatória. | `backend/gerador/payload.py`, `backend/tests/test_payload.py`, README/CLAUDE.md | Teste: \|lista\| = `semCompra` da rota em todas as rotas; `SEM_COMPRA_HOJE` ⊂ `SEM_COMPRA_MES`; payload antigo sem a chave não quebra o front. |
| 2 | **Fonte e cards**: Source Serif 4 local + `--serif`; números `lining tabular`; faixa lateral; fontes ~12% menores por escopo `.ind`; grade 3 colunas no PC. | `frontend/css/app.css`, `frontend/assets/fonts/` | Parte M ok (ajustar o que for regra nova); nenhum estouro em 360/390 px; cores dos cards iguais. |
| 3 | **Layout**: painel lateral no PC (recolhível) + topo compacto no celular. | `index.html`, `app.css`, `app.js` (render do topo) | 1440 px e 390 px sem rolagem lateral; topo ≤ 221 px; gaveta abre à direita do painel; ↻ e casa funcionam. |
| 4 | **Cabeçalho das abas**: título + etiqueta do dia com dica; card de ritmo + puxa + busca; chips de filtro; Base/Sem compra só em SV/Rota; rótulo "Categorias na tendência". | `app.js`, `app.css`, `index.html` | Números iguais aos de hoje; filtro não muda ordem/cores; Rota com 3 cards na linha. |
| 5 | **Aba Executiva** (seção 4) + componente de dica. | `app.js` (seção nova), `app.css`, `index.html` | Conferências da seção 7; hover/toque/teclado; Executiva oculta na Rota. |
| 6 | **Gavetas com barra de dias** (Volume, Base, Sem compra). | `app.js` | Padrões (Todos/Hoje/Hoje); contagens batem com os cards; sem estilo novo na `.drw` (Parte N). |
| 7 | **Entrada com logos**. | `index.html`, `app.css`, `frontend/assets/` | Dois temas; 360/390/1440 px; sem distorção das imagens. |
| 8 | **(Pendente) Evolução vs mês anterior**: consulta M−1 até a data do mesmo dia útil (Real e Meta), chave nova opcional, bloco na Executiva. | `fontes.py`, `payload.py`, `app.js` | Só depois de validar a consulta e o custo (hoje ~84 s por execução). |

Testes novos (Playwright, `front.test.js`): Executiva (totais = cards das abas; ordem das barras; rótulo BAND/GC/SV;
dica no hover e no toque; Executiva oculta no perfil Rota), cabeçalho das abas (filtro de cards; 3 cards na Rota),
gavetas com barra de dias (padrões e contagens), painel lateral (recolher; sem rolagem lateral em 1000/1440 px),
entrada (imagens certas em cada tema). Atualizar a documentação (README "Visual"/CLAUDE.md) a cada etapa.

---

## 7. Conferências de números

Invariantes (valem em qualquer dia):

- Executiva × abas: KPIs Base/Sem compra/Visitas = cards Base/Sem compra/visitas de hoje com o mesmo filtro; desvio do
  total na Tendência x Meta = Tendência ÷ Meta − 1 do card de Volume; % da linha total da tabela de coberturas = % dos
  cards do ICS GC / Novos Negócios / Todos a Bordo; Status = "x / n itens em 100%" da aba.
- Agenda: soma das linhas = total; "sem compra hoje" do total = itens da gaveta Sem compra (em "Hoje"); restam =
  sem compra hoje − pediram online hoje.
- Tendência x Meta deve bater com a tela do SAC "Tendência x NEG" (mesmo critério).
- Sem compra: Σ por unidade = total; % = sem compra ÷ base.

Valores do mockup (dados de 20/10/2026 18:58, Diretoria) para conferir com o payload daquela data:

| Item | Valor |
|---|---|
| Base / Sem compra / Visitas | 29.223 / 5.138 (17,6%) / 6.461 |
| Categorias na tendência | 1 / 5 (só Still); coberturas no ritmo 14 / 14 |
| Desvio Tendência x Meta (BAND) | Refri −8,73%, Cervejas −6,34%, Still +6,32%, Água −7,99%, Dest+Art+Cnd −19,67% |
| Desvio Refri GC.UR / GC.AT | +14,94% / −15,65% (iguais à tela do SAC) |
| Foco do fechamento (Refri) | 91%; falta 616.893; GC.AT 62% (416.990) |
| Meta do dia Refri | online 367.615 × meta 330.997 (111%); 9 de 16 gerências |
| Agenda (BAND) | 6.461 agendados; 5.181 já compraram; 1.280 sem compra; 550 pediram online; **restam 730** |
| Sem compra maior % | GC.RV 26,6% (483 de 1.818) |

(Os dados mudam a cada 15 min; use esses valores só com o payload de 20/10 ou como ordem de grandeza.)

---

## 8. Pendências para confirmar durante a implementação

1. **Cor do desvio no limite**: GC.GU em Refrigerantes tinha desvio −0,33% (vermelho no SAC), mas o painel arredonda
   a tendência para 100% e pinta de verde. O mockup segue o **sinal exato** (como o SAC). Confirmar.
2. **Executiva no fechamento do mês** (4.7): confirmar a proposta.
3. **Aba inicial**: Diretoria/Gerência/Supervisão abrem na Executiva (como no mockup)? Hoje o painel abre no ICS GC.
4. **Mês anterior** (Etapa 8): definir a consulta e validar o custo antes de implementar.
5. **Gaveta Sem compra fora do "Hoje"** depende da Etapa 1 publicada; até lá, mostrar só "Hoje".

---

## 9. Conteúdo do pacote

```
IMPLEMENTACAO.md                         este documento
referencia/mockup_aba_executiva.html     mockup navegável (dados de 20/10/2026; nomes omitidos)
assets/logos/coca-bandeirantes-fundo-escuro.png   560×251, "BANDEIRANTES" em branco, fundo transparente
assets/logos/coca-bandeirantes-fundo-claro.png    560×251, cores originais, fundo transparente
assets/logos/elmo-branco.png             140×263, fundo transparente
assets/logos/elmo-preto.png              140×263, fundo transparente
assets/fonts/source-serif-4-latin-wght-normal.woff2   @fontsource-variable/source-serif-4 5.3.0 (50 KB)
assets/fonts/OFL-source-serif-4.txt      licença SIL OFL 1.1
```

Observações sobre o mockup: foi montado sobre o visual de 20/10 (antes do "ajuste visual" com Inter local e da nova
aba Todos a Bordo). Onde o mockup e o código atual divergirem em algo que **não** está nas decisões da seção 1, vale o
código atual. Exemplos: no mockup a aba Todos a Bordo ainda usa o EF e tem card Status — **ignorar**, vale a regra
atual (cards do ICS + linha Status); a gaveta segue a aparência do 0a59eb4.
