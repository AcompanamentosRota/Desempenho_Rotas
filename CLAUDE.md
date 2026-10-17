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
- Nesta máquina o Python do sistema não tem `python-dotenv`/`pytest`; use
  `C:\Users\luan.arantes\Documents\Teste_ODATA\.venv\Scripts\python.exe` para rodar o back-end.
  Chamadas de rede exigem desabilitar o sandbox.

## Regras que não são óbvias

- **Contrato com o front**: `payload.json`/`online.json` têm o formato exato que `frontend/js/main.js` e `app.js` leem.
  `SEGS` e `DIAS` são tabelas de índice (cada cliente guarda a posição): só acrescentar no fim.
  Fórmulas em `backend/gerador/modelo.py` espelham `agrega()` em `app.js`; mudou um, mude o outro.
- **Todo nome de coluna, filtro e agrupador fica em `backend/gerador/mapeamento.py`.** Valores conferidos em 13/10/2026:
  - Base de clientes guarda histórico: filtrar `FL_CORRENTE eq 'S' and STATUS_CLIENTE eq 'Ativo'`.
  - Gerências do painel na fonte: `Gc. G1/G2/G3/Ap/It_Mo`. IT e MO vêm juntas; o código sai do supervisor
    (`Sv. It. 1` → `SV.IT.1` → `IT`). Supervisores vêm com espaço (`Sv. G3. 1`). Ignorar `Sv. Bl.*` (balcão) e rotas `EV*`.
  - Agrupadores têm grafia própria (`Cctm 2l Pet`, `Ks Tt`...). `Cervejas` é cobertura E volume.
    `Destilados` é outro agrupador já contido em `Dest+Art+Cnd`: nunca somar.
  - A consulta de vendas SEMPRE filtra os 17 agrupadores (sem filtro vira cliente × 748 agrupadores).
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
- **Tendência de volume = critério do SAC** (`modelo.indicador_volume`, espelhada em `agrega()` do app.js e
  `soma()` do resumo.js), por rota × macro de volume:
  Vol Real = `FX_VOL_PADRAO_FAT` do mês com `NF_STATUS_Nota_Fiscal` em `M.STATUS_NF_REAL` (comparado com
  `normalizar`, a grafia exata vem do relatório da conferência); Neg Restante = `META_NEG` com `DATA_MOVIMENTO`
  de hoje (inclusive) ao fim do mês; Tendência = Vol Real + Neg Restante; % = Tendência / Meta NEG (soma de
  `META_NEG` do mês), verde com % >= 100; Dif = Vol Real − Meta NEG; meta do dia = `META_RECUPERAVEL_ROTA` de hoje
  (sem a medida: `metaDia = null`, nunca outra conta). Meta NEG é o denominador em todos os níveis; supervisão e
  gerência somam as rotas e recalculam o %. `META_VOLUME` vai só como `metaRota` (conferência). Sem Meta NEG na
  rota × macro, o indicador fica indisponível. Consultas agregadas no servidor: Vol Real por rota × cliente ×
  agrupador × status (sem dia); `META_NEG`/`META_RECUPERAVEL_ROTA` por rota × agrupador × `DATA_MOVIMENTO`.
- **Barra por cliente (aba Volume)**: payload traz [Meta NEG, Vol Real] do cliente; o front soma o volume online de
  hoje do cliente (`online.json` → `volumeCliente`, também na rodada só-online) e recalcula % e status (mesma regra
  de cor; `modelo.bloco_cliente_com_online`). Só na barra: Real de rota/SV/GC e tendência ficam só com o faturado;
  no Resumo de Vendas o online fica na coluna própria. No fechamento o online não é somado.
- **Fechamento do mês (automático)**: do dia 1 até o fim do 1º dia útil de M e, depois, enquanto alguma gerência
  (de `M.GC_ORIGEM`, presentes na base) não tiver `META_VOLUME` > 0 e `META_COBERTURA` > 0 para M (meta por rota →
  gerência pela base de clientes). Dia útil pelo calendário do Datasphere (`NO_DIA_UTIL`), senão cálculo local.
  Nesse período TODO o payload é de M−1 (`cal.anomes`), com `FECHAMENTO: true`, calendário fechado
  (DIA_ONTEM = DIA_HOJE = TOTAL, PACE 100), volume sem tendência/meta do dia (% realizado), Venda Zero indisponível
  (comodato nem é consultado). O online continua sendo o de hoje (consulta extra só `FONTE = 'WF Online'` em M) e
  ganha `fechamentoMes` = rótulo de M−1; na rodada só-online o rótulo sai do payload publicado. O input manual
  `fechamento` do workflow só sobrepõe o rótulo da tag. `validacao.py` compara quedas (rotas, clientes, volume real)
  só com o payload publicado do mesmo `MES_LABEL`; na virada, só avisa.
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
