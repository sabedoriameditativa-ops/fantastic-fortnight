# Jogar pelo navegador

Esta versão é uma demonstração gratuita para partidas individuais. O navegador
executa a simulação, gráficos, sons e controles; não é necessário instalar Node
ou executar um aplicativo Windows.

O nome do comandante, as frotas, as preferências e o progresso da campanha ficam
no armazenamento local do navegador, associado ao endereço do site. Use o mesmo
navegador e preserve os dados desse site. Dados de `localhost:3000` ou do
executável não são transferidos automaticamente para esse endereço.

## Disponibilidade dos recursos

Campanha local, bots, formações, piloto, biblioteca de frotas, códice e opções
funcionam na demonstração. Ela não inclui servidor WebSocket ou SQLite:
multiplayer, pontos verificados, histórico do servidor e desbloqueios online
exigem a versão com servidor. A tela Progresso local explica essa diferença.

## Preparar e verificar

```bash
npm ci
npm run build:web
CHROMIUM_PATH=/usr/bin/chromium npm run e2e:static
```

`dist/web` contém somente os arquivos públicos necessários ao jogo e seus avisos
de licença. O build ajusta os imports do código compartilhado, incluindo o Worker,
para que o site funcione em um subdiretório como `/fantastic-fortnight/`.
Ele não inclui servidor, bancos, dependências Node, credenciais ou arquivos de teste.

O teste usa um servidor estático sob esse prefixo, inicia uma partida real no
navegador e verifica a persistência local e a ausência de tentativas de conexão
com APIs ou WebSockets. Uma publicação pública também precisa ser verificada
separadamente após o deploy.

## Hospedagem

O workflow `web-preview.yml` prepara, testa e publica o artefato usando GitHub
Pages. A habilitação inicial de Pages exige permissão administrativa específica
do repositório. Em Settings > Pages, a origem deve ser **GitHub Actions**.
Habilitar esse serviço não altera a branch `main`.

Esta publicação é uma demonstração gratuita, com partidas locais no navegador.
Os [limites do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
restringem comércio eletrônico e hospedagem de negócios e serviços comerciais.
A hospedagem deve ser reavaliada antes de oferecer vendas, assinaturas ou outros
serviços comerciais.

## Direitos e acesso ao código

Os avisos das novas contribuições identificam **Pedro Tiago Corrêa Faria**.
Consulte [LICENSE.txt](../LICENSE.txt) e
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

O navegador recebe o JavaScript necessário para executar o jogo; os avisos de
licença regulam permissões de uso, mas não tornam esse código secreto. As versões
anteriores que declaravam MIT e as licenças de terceiros devem ser respeitadas.
Antes da exploração comercial, é recomendável uma revisão jurídica da titularidade,
do histórico de licenças e das condições de distribuição. Esta alteração não garante
exclusividade sobre o código anteriormente disponibilizado.
