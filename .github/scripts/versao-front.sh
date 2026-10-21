#!/usr/bin/env bash
# Versão do CÓDIGO do site: hash curto (12 caracteres) do conteúdo de frontend/, sem frontend/data/** (os JSONs gerados
# a cada 15 min) e sem o próprio versao.json. Mudança só de dados não muda a versão (e não dispara o aviso de versão
# nova no painel). Determinístico: lista ordenada em LC_ALL=C, caminhos relativos à pasta (uma cópia dá o mesmo hash).
#
#   versao-front.sh DIR            imprime a versão
#   versao-front.sh --gravar DIR   calcula, grava DIR/versao.json e troca o marcador do DIR/index.html
#                                  (<meta name="versao" content="dev">); usado pelo deploy-pages.yml antes do upload
# Testado na Parte P de frontend/tests/front.test.js.
set -euo pipefail

gravar=0
if [ "${1:-}" = "--gravar" ]; then gravar=1; shift; fi
dir="${1:?uso: versao-front.sh [--gravar] DIR}"
cd "$dir"

versao=$(find . -type f ! -path './data/*' ! -path './versao.json' -print0 \
  | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)

if [ "$gravar" = 1 ]; then
  grep -q '<meta name="versao" content="dev">' index.html \
    || { echo 'index.html sem o marcador <meta name="versao" content="dev">' >&2; exit 1; }
  sed -i "s|<meta name=\"versao\" content=\"dev\">|<meta name=\"versao\" content=\"$versao\">|" index.html
  printf '{"versao":"%s","gerado":"%s"}\n' "$versao" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > versao.json
fi
echo "$versao"
