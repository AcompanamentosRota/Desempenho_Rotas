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
  - `META_DIA` junto com outras colunas leva ~130 s; sozinha (só agrupadores de volume) ~2 s. Por isso são duas consultas.
  - `META_DIA` sem `CALENDARIO` = meta do dia publicada; por `CALENDARIO` não é curva de meta (não usar para tendência).
  - Meta de volume por cliente = `META_NEG` por `CD_CLIENTE` × `DS_AGRUPADOR_Agrupador_Prod`.
  - Venda Zero: `Concluído(Contrato)` + `AGRUPADOR_EQPTO = 'Total Ko'` + Fountain + `Giro Zero`, deduplicando por
    `CD_EQUIPAMENTO_Equipame`. A meta só existe por gerência; o gerador rateia pelas rotas pela quantidade de geladeiras.
- **Decisões aceitas** (diferem do arquivo antigo, montado à mão): tendência de volume linear por dias úteis
  (a fórmula antiga não está no modelo); visitas de hoje pelo campo `VISITA_HOJE` do SAP.
- **Semana**: `SEMANA_NUM` conta a partir da 1ª segunda-feira do mês; dias antes dela são da última semana do mês anterior.
- O gerador só grava quando o conteúdo muda (JSON compacto e determinístico) e não grava nada se `validacao.py` reprovar.
- `backend/tests/dados/*_ref.json` é uma amostra congelada do payload manual (16 rotas): não regenerar a partir de `frontend/data`.

## GitHub e segurança

- Repo `karenoliveiragyn2-stack/desempenho` (conta pessoal, público). Operar com a conta **LuanAlves2** (tem push, não admin);
  `GH_TOKEN=$(gh auth token --user LuanAlves2) gh ...`. Secrets, Variables e a fonte do Pages só a dona do repo altera.
- Commits feitos com `GITHUB_TOKEN` não disparam workflows: `atualizar-dados.yml` chama `deploy-pages.yml` via `workflow_call`.
- Nunca versionar `backend/.env`. Antes de commitar, verificar que nenhum arquivo contém o client ID/secret.
- Pendências em 13/10/2026: publicar a branch `reestrutura-front-back`; dona do repo cadastrar Secrets/Variables e
  trocar Pages para "GitHub Actions"; parar uploads manuais na raiz; rotacionar o secret do OAuth Client.
