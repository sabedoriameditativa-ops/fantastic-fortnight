@echo off
title Frota Estelar
cd /d "%~dp0"
echo.
echo  ==== Frota Estelar ====
echo  Pasta: %cd%
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode

echo  Node.js encontrado:
node --version
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto oldnode

if exist "node_modules\ws\package.json" goto run
echo.
echo  Instalando a dependencia (pacote ws)...
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 goto npmfail
if not exist "node_modules\ws\package.json" goto npmfail

:run
if "%PORT%"=="" set PORT=3000
set FE_OPEN_BROWSER=1
echo.
echo  Iniciando o servidor em http://localhost:%PORT%
echo  O navegador abre sozinho. Em rede local, os outros usam http://SEU-IP:%PORT%
echo  Deixe esta janela aberta enquanto joga. Para encerrar: feche a janela.
echo.
node server\index.js
echo.
echo  O servidor foi encerrado.
goto end

:nonode
echo  Node.js nao foi encontrado neste computador.
echo  Instale a versao LTS em https://nodejs.org (marque a opcao de adicionar ao PATH),
echo  feche e abra esta janela de novo.
goto end

:oldnode
echo  Sua versao do Node.js e muito antiga. Instale a versao LTS em https://nodejs.org
goto end

:npmfail
echo  Falha ao instalar a dependencia. Verifique a conexao com a internet e tente de novo.
echo  Alternativa: abra um Prompt de Comando nesta pasta e rode:  npm install --omit=dev
goto end

:end
echo.
echo  (Se algo deu errado, tire uma foto desta janela.)
pause
