@echo off
setlocal
title Frota Estelar
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e execute este arquivo de novo.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
for /f "tokens=1 delims=." %%a in ('node -v') do set NODE_V=%%a
set NODE_V=%NODE_V:v=%
if %NODE_V% LSS 18 (
  echo.
  echo  Sua versao do Node.js e muito antiga. Instale a versao LTS em https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\ws" (
  echo  Instalando dependencias (apenas o pacote ws, rapido)...
  set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo  Falha ao instalar dependencias. Verifique sua conexao e tente de novo.
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=3000
echo.
echo  Frota Estelar rodando em http://localhost:%PORT%
echo  Para jogar em rede local, os outros abrem http://SEU-IP:%PORT%
echo  Feche esta janela para encerrar o servidor.
echo.
start "" "http://localhost:%PORT%"
node server\index.js
pause
