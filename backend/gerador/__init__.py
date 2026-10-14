"""
Pacote "gerador": transforma os dados do SAP Datasphere (OData) nos dois
arquivos que o painel lê:

    payload.json  -> base do mês (metas, clientes, cobertos, volume, venda zero, redes)
    online.json   -> vendas do dia (atualizado a cada execução)

Fluxo (scripts/gerar.py):
    fontes.py  : consulta o Datasphere e normaliza as linhas (tipos.py)
    payload.py : monta o payload.json a partir das fontes normalizadas
    online.py  : monta o online.json
    validacao.py: confere a estrutura antes de publicar
    saida.py   : grava de forma atômica e só quando o conteúdo mudou
"""
