# Frota Estelar com um duplo clique

Baixe **FrotaEstelar.exe** nos arquivos da
[pré-versão Windows](https://github.com/sabedoriameditativa-ops/fantastic-fortnight/releases/tag/frota-estelar-v0.2.0-preview.1).

O pacote Windows é um único **FrotaEstelar.exe**, com o Node e as dependências do
jogo incluídos. O jogador não precisa instalar Node, npm ou Go, executar um `.bat`
ou usar as instruções do ambiente de nuvem.

## Para jogar

1. Guarde `FrotaEstelar.exe` em uma pasta do computador ou na Área de Trabalho.
2. Dê um duplo clique. Uma pequena janela abre o navegador padrão quando o jogo
   está pronto.
3. Use **Abrir jogo** para voltar ao navegador e **Encerrar** para fechar o servidor.

Fechar a pequena janela também encerra o jogo. Fechar somente a aba do navegador
mantém o servidor disponível. Um segundo duplo clique reutiliza a instância aberta.
Não aparece a janela preta do terminal. O destino é Windows 10/11 de 64 bits
(x64), com um navegador moderno configurado como padrão.

Na primeira abertura, o executável extrai os arquivos para
`%LOCALAPPDATA%\FrotaEstelar\runtime`. Nas seguintes, reutiliza o conteúdo
verificado. Não há instalação de pacotes, download de Node ou necessidade de
permissão de administrador durante a execução. Fontes, naves e sons ficam locais.

O jogo abre em `http://localhost:3000`, preservando a origem usada pelo antigo
`iniciar.bat`. Se outro programa ou uma instância antiga ocupar essa porta, o
aplicativo informa o conflito; feche essa instância e abra o executável novamente.
O launcher não encerra programas desconhecidos nem troca silenciosamente de porta.

Esta distribuição abre um servidor restrito ao próprio computador. O modo
individual, os bots e as salas entre abas locais funcionam nesse servidor. Para
hospedar partidas para outros computadores na rede, continua disponível o servidor
descrito no [README](../README.md), com as mesmas regras multiplayer.

## Progresso e atualizações

Perfis e histórico ficam em `%LOCALAPPDATA%\FrotaEstelar\data`. Substituir o `.exe`
por uma versão nova não apaga essa pasta. A biblioteca de frotas e as preferências
continuam no navegador. Use o mesmo navegador e preserve seus cookies e dados
de `localhost:3000` para manter a identidade e o progresso local.

O executável não transfere automaticamente o banco de outro computador ou de uma
instalação antiga. Se você já usava a versão com SQLite pelo código-fonte, encerre
ambas as versões e copie o diretório inteiro `frota-estelar-data` para a nova pasta
`data` **antes da primeira abertura**, preservando também os cookies do navegador.
Não sobrescreva um banco com progresso novo; guarde uma cópia de segurança de ambos
se já tiver usado as duas versões. Nenhum progresso da nuvem está incluído no `.exe`.

Para backup, encerre o aplicativo e copie a pasta `data` inteira. Consulte
[PROFILES.md](PROFILES.md) para as limitações de identidade por cookie.
Os registros de falha ficam em `%LOCALAPPDATA%\FrotaEstelar\logs\launcher.log`.

## Gerar novamente — somente para desenvolvimento

Requisitos para quem produz o pacote: Node >=24, Go >=1.24 e `curl`, com acesso
HTTPS a `nodejs.org`. Eles não são requisitos do jogador. Não é necessário instalar
Electron ou um navegador adicional.

```bash
npm ci
npm run build:windows
```

Se `go` não for o compilador correto no PATH, indique `GO_BINARY`. No ambiente de
nuvem preparado:

```bash
GO_BINARY=/workspace/.cache/frota-desktop/go/bin/go \
FE_BUILD_CACHE=/workspace/.cache/frota-desktop npm run build:windows
```

O resultado fica em `dist/FrotaEstelar.exe`, acompanhado por um arquivo SHA-256 e
um manifesto de build. `FE_BUILD_OUT` escolhe outra pasta de saída. O build usa
Node 24.19.0 oficial para Windows x64, valida seu SHA-256 fixado e compila o launcher
Go como aplicação gráfica. O cache evita baixar o runtime novamente. A distribuição
inclui as licenças do Node, Go, ws e das fontes; não inclui perfis, bancos, testes,
credenciais ou dependências de desenvolvimento.

O build não publica GitHub Releases nem envia o executável a serviços externos.

## Validação e limites desta entrega

Os testes Node verificam o processo de inicialização, dados em caminhos com espaços
e acentos, perfil após reinício, assets/Worker, verificação de partida, porta ocupada
e encerramento. Os testes Go verificam extração, integridade, cache e validação do
protocolo. O build verifica que o binário gerado é um PE x64 com subsistema gráfico.

Nesta entrega, **403 testes Node passaram**, sem falhas ou testes ignorados. Também
passaram 11 testes Go com detector de concorrência, compilação cruzada e `go vet`.
O teste adicional do ZIP real extraiu 118 arquivos, verificou o SHA-256 do Node,
reutilizou o cache e reparou uma cópia corrompida, sem alterar os dados do perfil.
As fontes locais foram verificadas no Chromium com toda a rede externa bloqueada:
menu e batalha abriram sem solicitações externas ou erros.

O executável tem aproximadamente 39 MB (37,5 MiB), e os arquivos extraídos ocupam
cerca de 94 MB. Reserve espaço adicional para dados, logs e versões futuras.

Para repetir a verificação do conteúdo empacotado:

```bash
FE_BUILD_PAYLOAD_OUT=/tmp/frota-payload.zip npm run build:windows
cd desktop/launcher
FE_LAUNCHER_TEST_PAYLOAD=/tmp/frota-payload.zip go test -run TestRealDistributionPayload -v
cd ../..
CHROMIUM_PATH=/usr/bin/chromium node tools/verify-desktop-package.js /tmp/frota-payload.zip
```

O último teste usa o Node da máquina de teste para servir os arquivos do pacote,
cria um perfil e inicia uma batalha no Chromium. Ele não executa o Node Windows.

A máquina de desenvolvimento desta tarefa é Linux, sem Windows, Wine ou VM Windows.
O workflow `.github/workflows/windows-preview.yml` faz uma validação separada em
um runner Windows antes de publicar os arquivos: inicia o `.exe`, verifica a janela,
o Node embarcado, recursos HTTP, perfil após reinício e encerramento. O resultado
é anexado como `Windows-smoke.json`; o manifesto identifica o commit e o workflow.
Os testes locais Linux, sozinhos, não demonstram essa execução no Windows.

Não houve avaliação manual de gameplay em computadores Windows físicos. A associação
automática do navegador e a experiência em diferentes dispositivos exigem verificação
adicional. O executável não tem assinatura digital Authenticode; o Windows pode
identificá-lo como aplicativo de editor desconhecido.

`install_script` e `start_skill` são instruções do ambiente de desenvolvimento na
nuvem. Elas não são usadas pelo executável nem são necessárias para jogar.
