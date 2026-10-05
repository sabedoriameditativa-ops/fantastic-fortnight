#!/usr/bin/env bash
# Frota Estelar — inicia o servidor e abre o jogo no navegador (macOS / Linux).
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js não encontrado. Instale a versão LTS em https://nodejs.org e execute de novo."
  echo
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  Sua versão do Node.js ($(node -v)) é muito antiga. Instale a versão LTS em https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules/ws ]; then
  echo "  Instalando dependências (apenas o pacote ws, rápido)..."
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --no-audit --no-fund
fi

PORT="${PORT:-3000}"
export PORT
echo
echo "  Frota Estelar rodando em http://localhost:$PORT"
echo "  Para jogar em rede local, os outros abrem http://SEU-IP:$PORT"
echo "  Pressione Ctrl+C para encerrar o servidor."
echo

if [ -z "$NO_BROWSER" ]; then export FE_OPEN_BROWSER=1; fi
exec node server/index.js
