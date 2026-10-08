# Frota Estelar

**Frota Estelar** é um jogo de estratégia espacial com batalhas automáticas
(*auto-battler*) que roda direto no navegador. Você escolhe uma facção, monta uma
frota dentro de um orçamento de pontos e, quando todos estão prontos, as frotas
lutam sozinhas: cada nave escolhe alvos, se posiciona e usa habilidades por conta
própria. Você assiste, acelera o tempo e aprende o que funciona.

**[Jogar agora no navegador](https://sabedoriameditativa-ops.github.io/fantastic-fortnight/)** —
demonstração gratuita para um jogador, sem instalação. A campanha, as frotas e as
preferências ficam salvas nesse navegador. Multiplayer e progressão verificada
exigem servidor. Consulte [recursos, publicação e limites da versão web](docs/WEB.md).

## Multiplayer na nuvem e melhorias da versão 0.3

O jogo inclui uma configuração de **servidor gratuito de testes no Render**:
consulte [publicação multiplayer, persistência e limites](docs/CLOUD.md). Ela serve
o jogo e as salas no mesmo endereço HTTPS. A criação da conta e do serviço no
provedor ainda é necessária; o link do GitHub Pages acima continua individual.
No plano gratuito, os perfis do servidor são temporários e as partidas terminam
quando a instância reinicia. Uma instalação com volume durável preserva o SQLite.

Em **Opções**, experimente as trilhas **Aventura estelar**, **Órbita arcade** e
**Nebulosa**, os perfis de mixagem e o rádio em português, inglês ou espanhol.
O botão **Testar fala** apresenta cada facção. A voz usa o sintetizador local
compatível do dispositivo; sem essa voz, o jogo mantém as legendas. Os menus
continuam em português. As escolhas anteriores de volume são preservadas.

Os cenários, materiais das naves, projéteis e escudos receberam mais detalhes,
mantendo opções de qualidade baixa e redução de efeitos. O controle manual
preserva toques rápidos entre atualizações e mostra o nome e a recarga da habilidade.

Hoje há **cinco facções**: quatro originais e o **Concílio Astral**, sem outras
facções ocultas. Veja as [recomendações para diversão, expansão e monetização](docs/ROADMAP.md).

## Recursos do jogo

- **Um jogador**: 15 níveis com chefes e níveis infinitos depois, 4 dificuldades,
  formatos de 1v1 até 6v6 com aliados controlados pelo computador.
- **Multijogador**: salas com código de 4 letras, de 1v1 até 6v6, bots preenchem as
  vagas vazias, chat, revanche, reconexão automática.
- **Preparação e progressão**: biblioteca de frotas, formações, prioridades táticas,
  objetivos de campanha e perfil persistente no servidor, com histórico e desbloqueios.
- **Piloto opcional**: uma nave especial por comandante; o restante da frota continua
  automático. O modo totalmente automático permanece disponível.
- **Sem dependências de build**: JavaScript moderno (ES modules), Canvas 2D e Web Audio.
  Toda a arte e todo o som são gerados por código; não há arquivos de mídia.

## Abrir no Windows com um duplo clique

O pacote **FrotaEstelar.exe** já inclui o Node e abre o jogo no navegador, sem
terminal ou instalação de dependências. Guarde o executável no computador e dê
um duplo clique; use **Encerrar** na pequena janela para fechar o servidor.
Consulte [Windows: uso, geração do pacote e limites de validação](docs/WINDOWS.md).
Baixe o executável nos arquivos da [pré-versão Windows](https://github.com/sabedoriameditativa-ops/fantastic-fortnight/releases/tag/frota-estelar-v0.2.0-preview.1).
O ZIP do código-fonte não inclui o `.exe`; ao gerar o pacote localmente, o arquivo
fica em `dist/FrotaEstelar.exe`.

## Executar pelo código-fonte (3 passos)

1. **Instale o Node.js 24 ou superior** em <https://nodejs.org> — só uma vez.
2. **Baixe o jogo**: no GitHub clique em *Code → Download ZIP* e descompacte, ou
   `git clone https://github.com/sabedoriameditativa-ops/fantastic-fortnight.git`.
3. **Abra o jogo**: dê dois cliques em `iniciar.bat` (Windows) ou rode `./iniciar.sh`
   (macOS/Linux). O script instala a única dependência (`ws`), inicia o servidor e abre
   `http://localhost:3000` no navegador. Para encerrar, feche a janela (ou Ctrl+C).
   No macOS/Linux, se o arquivo perdeu a permissão de execução (ZIP), use `bash iniciar.sh`.

**Windows 11 com "Controle de Aplicativo Inteligente"**: o Smart App Control pode
bloquear scripts baixados e executáveis sem assinatura reconhecida. Nesse caso,
use a [demonstração no navegador](https://sabedoriameditativa-ops.github.io/fantastic-fortnight/).
Consulte [assinatura e limitações do pacote Windows](docs/WINDOWS.md).

Se o navegador mostrar "não consigo chegar a esta página", o servidor não está rodando:
olhe a janela preta do script (ela fica aberta e mostra o motivo). Caminho manual no
Windows: abra a pasta do jogo, clique na barra de endereço do Explorador, digite `cmd` e
Enter; na janela que abre rode `node server\index.js` e depois acesse `http://localhost:3000`.

Para jogar com amigos na mesma rede, eles abrem `http://SEU-IP:3000` (o IP do computador
que rodou o script; veja com `ipconfig` no Windows ou `ifconfig`/`ip a` no macOS/Linux) e
entram com o código da sala. Para acesso pela internet, configure um proxy ou túnel
HTTPS e inicie o servidor com `FE_COOKIE_SECURE=1`, preservando o domínio público no
cabeçalho `Host`. Os perfis persistentes dependem da proteção do cookie de acesso.

Dica: `npm install --omit=dev` instala só o necessário para jogar; o `npm install` completo
também traz o Playwright (usado pelos testes ponta a ponta), que é bem maior.

## Facções

| Facção | Raça | Casco | Estilo | Passiva |
|---|---|---|---|---|
| **Confederação Terrana** | Humanos | Blindado | Blindagem, mísseis e disciplina. Equilibrada; escudos apenas nas naves-capitais. | *Coordenação de Fogo*: alvos atacados por 3 ou mais naves terranas sofrem +10% de dano cinético. |
| **Enxame Vorrax** | Insetoides | Orgânico | Cascos vivos que se regeneram. Sem escudos, sem recuo, sem fim. | *Fome*: uma nave Vorrax que destrói um inimigo recupera parte do casco máximo. |
| **Ascendência Lúmen** | Seres de energia | Cristalino | Escudos de luz, cascos de cristal. Feixes precisos e saltos de fase. | *Fase*: ao perder o escudo, a nave fica intocável por 1 s (uma vez a cada 20 s). |
| **Nexo Ferrix** | Coletivo de máquinas | Nanitos | Nanitos que se reconstroem, canhões magnéticos e pulsos EMP. Fria eficiência. | *Rede Neural*: +10% de precisão contra naves minúsculas e pequenas. |
| **Concílio Astral** | Navegantes gravitacionais | Cristalino | Controle de área, contenção e escoltas; vulnerável à pressão cinética. | Resistência parcial a deslocamentos gravitacionais. |

As quatro facções originais mantêm suas 8 naves (minúscula → nave-mãe), cada uma
com uma habilidade própria, e 3 predefinições. O Concílio Astral acrescenta
Lanceta, Guardião e Arconte. Há também uma nave especial pilotável por facção:
40 classes ao todo, sendo 35 de frota e 5 especiais. Os tipos de dano importam:
lasers derretem escudos e cascos orgânicos; cinéticos e torpedos castigam blindagem
e cristal; plasma e bioácido corroem nanitos; pulsos iônicos apagam escudos e
interrompem a regeneração. A **Galeria de naves** dentro do jogo mostra a ficha
completa de cada nave, arma e habilidade.

## Instalação e execução

Requisitos: **Node.js 24 ou superior**, inclusive para o SQLite nativo usado pelos
perfis. A única dependência de runtime instalada pelo npm é o pacote `ws`
(WebSocket); o Playwright, usado só pelos testes ponta a ponta, é uma dependência
de desenvolvimento.

```bash
npm ci
npm start            # servidor em http://localhost:3000
```

Abra `http://localhost:3000` no navegador (Chrome, Edge, Firefox ou Safari recentes).

Variáveis de ambiente úteis:

| Variável | Efeito |
|---|---|
| `PORT` | porta do servidor (padrão `3000`) |
| `HOST` | interface de rede (padrão: todas) |
| `MAX_ROOMS` | limite de salas simultâneas |
| `FE_MAX_TICKS`, `FE_TICK_MS`, `FE_COUNTDOWN_MS` | encurtam batalhas/contagem (usado pelos testes) |
| `FE_DATA_DIR` | diretório persistente do SQLite; padrão: `frota-estelar-data` ao lado do checkout |
| `FE_PROGRESSION_POLICY` | objeto JSON com ajustes da política de pontos e inatividade |
| `FE_COOKIE_SECURE` | use `1` quando o servidor estiver atrás de um proxy HTTPS |
| `CHROMIUM_PATH` | executável Chromium alternativo para os testes de navegador |

`GET /health` responde `{ ok, rooms, uptime, sessions }`.

O perfil pertence a este servidor e ao cookie privado deste navegador. Não há
login global nem sincronização entre dispositivos. Faça backup do diretório de
dados para preservar perfis. Consulte [Perfis e progressão](docs/PROFILES.md)
para limites, perda gradual por inatividade, migração e verificação de resultados.

## Como jogar

### Um jogador

1. Digite seu nome no menu e escolha **Um jogador**.
2. Escolha o **nível**, a **dificuldade do inimigo** e o **formato** (1v1 a 6v6). Em
   formatos maiores seus aliados são bots com a dificuldade que você escolher.
3. **Monte a frota**: escolha a facção, clique nos cartões para comprar naves (ou use
   uma predefinição e *Autocompletar*). O orçamento é sempre **1.500 pontos**;
   há limites por classe de tamanho (1 nave-mãe, 2 capitais, 4 grandes, 12 médias,
   24 pequenas, 24 minúsculas — 32 para Vorrax) e no máximo 40 naves.
4. **Confirmar e lutar**. A tela de resultados oferece *Jogar de novo* (mesma frota,
   nova semente), *Próximo nível*, *Editar frota* e *Menu*.

No construtor, salve modelos nomeados na biblioteca, duplique, compare e reutilize
suas composições. Escolha formação, posição inicial e prioridade dos alvos antes
de confirmar. O tutorial está em **Como jogar**, e o relatório final ajuda a
interpretar as perdas, o dano e o valor restante da frota.

A campanha inclui eliminação, escolta, defesa, sobrevivência e ondas. A dificuldade
controla a inteligência dos bots; o ajuste de recursos é separado e aparece no
orçamento da missão. Personalidades variadas mudam as composições e a tática.

Você também pode abrir uma batalha direta pela URL:
`?autotest=1&level=3&difficulty=dificil&faction=vorrax&speed=4&seed=42`
(`?seed=` fixa a semente de qualquer batalha de um jogador; `?debug=1` expõe
`window.__fe` no console).
Partidas com semente explícita são treino e não concedem pontos verificados.

### Multijogador (salas com código)

1. Escolha **Multijogador** → **Criar sala** (formato e orçamento) ou **Entrar** com
   um código de 4 letras. O link `http://host:porta/?sala=CODIGO` entra direto na sala.
2. Cada jogador escolhe uma vaga, monta a frota (ela fica oculta dos outros até a
   batalha começar) e marca **Pronto**. O anfitrião pode adicionar bots por vaga,
   mudar formato/orçamento/dificuldade dos bots e marcar *Preencher vagas vazias com bots*.
3. **Iniciar batalha**: contagem de 5 s (os bots montam suas frotas agora, e nas
   dificuldades altas eles reagem às frotas humanas), depois o servidor simula e
   transmite a batalha a 10 Hz para todos.
4. Ao final, **Revanche**: quando todos os humanos votam, a sala volta ao saguão com
   as frotas mantidas.

Quem cair durante a batalha é reconectado automaticamente (a sessão vale por
60 s); se o anfitrião sair, o próximo jogador assume.

Cada comandante pode indicar seu papel de vanguarda, apoio ou ataque. Os papéis
comunicam a intenção ao time e não concedem bônus. O modo de pilotos é uma opção
da sala: reserva 200 pontos por comandante para a nave especial, inclusive bots.
Cada humano precisa da licença da facção para participar nesse modo. Em 6v6 são
dois times com seis comandantes cada, misturando humanos e bots.

### Jogar em rede local (LAN)

Rode `npm start` em um computador e descubra o IP dele na rede (`ipconfig` no
Windows, `ip addr`/`ifconfig` no Linux/macOS). Os outros jogadores abrem
`http://IP_DO_HOST:3000` (por exemplo `http://192.168.0.10:3000`) e entram pelo
código da sala ou pelo link `http://192.168.0.10:3000/?sala=CODIGO`. Libere a porta
no firewall do host se necessário. Pela internet, use HTTPS conforme descrito acima;
a página, a API de perfil e o WebSocket devem compartilhar a mesma origem.

### Dificuldades e níveis

As dificuldades mudam a inteligência dos bots. Recursos são um ajuste independente:

| | Fácil | Normal | Difícil | Especialista |
|---|---|---|---|---|
| Reação / precisão da IA | lenta, erra alvos e habilidades | média | rápida | perfeita |
| Foco de fogo, recuo, formação | não | sim | sim | sim |
| Como monta a frota | aleatória, gasta 60–85% | predefinição | **contra-ataque** à sua frota | **contra-ataque** |
| Recursos extras pela dificuldade | nenhum | nenhum | nenhum | nenhum |

Os valores exatos ficam em `shared/aiProfiles.js`. Jogadores humanos sempre têm
a IA de nave no nível *Especialista* — a dificuldade só afeta os bots.

Os 15 níveis formam uma campanha: **1–3** Confederação Terrana (orçamento inimigo
50–70% do seu), **4–6** Enxame Vorrax (chefe: Rainha-Guerreira no 6), **7–9**
Ascendência Lúmen (chefe: Catedral no 9), **10–12** Nexo Ferrix (chefe: Mente
Primária no 12), **13–15** facção aleatória com frotas de contra-ataque e orçamento
120–150% (no 15 o inimigo traz uma nave-mãe quando sua facção tem essa classe). A partir do **16** os níveis
são infinitos e o orçamento inimigo cresce 10% por nível. O progresso (maior nível
concluído por dificuldade) fica salvo no navegador.

Os objetivos e reforços variam por missão. Em missões com ondas, o orçamento
informado inclui a frota inicial e os reforços, sem multiplicadores ocultos de
dificuldade.

### Regras da batalha

- Vence quem destruir todas as naves **compradas** do inimigo (unidades geradas por
  habilidades não contam).
- **Morte súbita aos 150 s**: regeneração passiva, reparo, recarga de escudos, curas
  contínuas e a cura por abate desligam (curas instantâneas de habilidades ainda
  funcionam), recuo acaba e o dano cresce 20% a cada 15 s.
- **Limite de 240 s**: vence quem tiver mais valor de frota restante (custo × vida
  restante); empate dentro de 2% é decidido pelo dano causado.

### Controles

| Tecla / ação | Efeito |
|---|---|
| `Espaço` | começar / pausar (um jogador) |
| `1`, `2`, `4` | velocidade ×1, ×2, ×4 (um jogador; no multijogador o tempo é do servidor) |
| `N` | mostrar/ocultar nomes das naves |
| `G` | grade da arena |
| `C` | voltar à câmera automática |
| `Esc` | sair da batalha |
| arrastar / roda do mouse | mover e aproximar a câmera (câmera livre) |
| clique numa nave | seguir a nave; clique de novo ou duplo clique para voltar à câmera automática |

Em **Opções** você ajusta volumes (geral, música, efeitos, interface), mudo, movimento
reduzido, qualidade dos efeitos, nomes e grade padrão, seu nome, e pode zerar o progresso.

Com uma nave especial na frota, **P** alterna piloto manual/automático, as **setas**
movem, **F** ou o botão esquerdo do mouse disparam, e **E** usa a habilidade. O mouse
aponta para o cenário. Remapeie essas teclas em **Opções**. O controle retorna à IA
ao perder foco, pausar ou desconectar; a morte da nave especial não encerra a batalha
enquanto o restante da frota sobreviver. Os tiros especiais usam colisão direcional;
as armas guiadas da frota continuam seguindo suas regras próprias.

As opções também incluem redução de efeitos, alto contraste e rádio de batalha por
facção, com frequência, legendas e volume. Voz sintetizada é opcional e usa apenas
uma voz portuguesa instalada no dispositivo; sem essa voz, as legendas continuam
funcionando. Não há serviço pago ou download de vozes.

## Testes, simulações e ferramentas de balanceamento

```bash
npm test                     # testes unitários (node:test, test/**/*.test.js)
npm run e2e                  # ponta a ponta no Chromium (Playwright): sobe o servidor
                             # numa porta livre e joga partidas reais pelo navegador
npm run e2e:ui               # regressões de câmera, teclado, chat e HUD
npm run e2e:features         # biblioteca, perfil, campanha, piloto e opções
npm run simulate -- --help   # simulador headless (frota × frota, matrizes, dificuldade)
```

Os testes ponta a ponta precisam do Chromium do Playwright. `npm install` instala o
pacote `playwright`; baixe o navegador uma vez com:

```bash
npx playwright install chromium
```

No ambiente de nuvem preparado, o download do Chromium do Playwright não foi
concluído; as tentativas receberam uma recusa da política de rede. Use o Chromium
já instalado, sem alterar os testes:

```bash
CHROMIUM_PATH=/usr/bin/chromium npm run e2e
CHROMIUM_PATH=/usr/bin/chromium npm run e2e:ui
CHROMIUM_PATH=/usr/bin/chromium npm run e2e:features
```

Os testes de navegador usam dados de perfil temporários. Execute testes de
desempenho e de navegador separadamente para evitar concorrência pela CPU.

(O runner aceita a pasta dos navegadores geridos pelo Playwright via
`PLAYWRIGHT_BROWSERS_PATH`; `CHROMIUM_PATH` seleciona um executável do sistema.
Se o Playwright não puder ser importado, `npm run e2e` imprime o comando acima.)
O simulador valida seus argumentos (`--ai` precisa ser um perfil de
`shared/aiProfiles.js`; `--seeds`, `--budget` e `--maxTicks` são inteiros positivos)
e sai com código 2 em caso de erro de uso.

Exemplos do simulador (`tools/simulate.js`):

```bash
node tools/simulate.js --a ter_linha --b vor_garras --seeds 50          # predefinição × predefinição
node tools/simulate.js --a ter_falcao:6,ter_orion:3 --b lum_coro --seeds 20 --ai dificil
node tools/simulate.js --matrix --seeds 20        # todas as predefinições × todas (taxa de vitória)
node tools/simulate.js --factions --seeds 20      # facção × facção, agregando predefinições
node tools/simulate.js --difficulty --seeds 30    # cada dificuldade contra uma frota "normal"
node tools/simulate.js --a ter_linha --b fer_ferro --dump 7 --out /tmp/dump   # eventos de uma semente
```

Os critérios de aceitação de balanceamento (espelhos 50% ± 10, matriz de facções
dentro de 35–65%, ritmo mediano 60–160 s, dificuldade monotônica, etc.) estão em
`docs/SPEC.md` §8. Outras ferramentas: `tools/ui-shots.js` (percorre todas as telas e
tira capturas), `tools/render-shots.js` (vitrine das 40 classes de naves e quadros de batalha),
`tools/audio-check.js` (verifica o áudio num Chromium real ou renderiza todas as
receitas offline).

Para reproduzir a amostra da facção Astral, execute
`node tools/balance.js --seeds=8 --budget=1500`. Para medir uma batalha 6v6 real
no navegador, use `CHROMIUM_PATH=/usr/bin/chromium node tools/benchmark-browser.js`.
O segundo comando grava métricas e captura em uma pasta temporária, sem impor
uma meta de FPS. Resultados e limites da validação estão em
[Entrega e validação](docs/EVOLUCAO.md).

## Arquitetura (resumo)

```
shared/      código isomórfico (Node + navegador), sem dependências:
             catalog.js (facções, naves, armas, habilidades, predefinições), fleet.js (validação),
             botFleet.js (frotas dos bots), levels.js, aiProfiles.js, protocol.js, rng.js e
             sim/ — a simulação determinística (20 ticks/s): movimento, armas, dano,
             habilidades, IA das naves, estatísticas e resultado.
server/      HTTP estático + WebSocket (ws): sessões com reconexão por token, saguão,
             máquina de estados da sala (saguão → contagem → batalha → resultados) e o
             executor da partida, que simula e transmite quadros a 10 Hz.
client/      SPA sem framework: roteador de telas, construtor de frota, saguão, tela de
             batalha com renderizador Canvas 2D (sprites procedurais, partículas, câmera),
             HUD, cliente de rede, executor local (Web Worker) e motor de áudio (Web Audio).
tools/       simulador headless e utilitários de captura/validação.
test/        testes unitários; test-e2e/ testes ponta a ponta.
docs/        ARCHITECTURE.md (contratos entre módulos), SPEC.md (regras) e propostas de design.
```

A simulação é **determinística**: a mesma configuração, semente e sequência de
comandos de piloto nos mesmos ticks produzem a mesma
batalha, tick a tick, no servidor e no navegador. No modo um jogador ela roda num
Web Worker; no multijogador roda no servidor (autoritativo) e os clientes apenas
interpolam os quadros recebidos. Renderizador e áudio consomem o mesmo formato de
quadro nos dois casos.

## Créditos

Toda a arte (naves, efeitos, fundo, interface) e todo o áudio (efeitos sonoros e
trilha generativa) são **procedurais**, gerados em tempo de execução por código —
o projeto não contém nem baixa nenhum arquivo de mídia. A única dependência de
runtime é o pacote `ws`. As fontes Orbitron e Exo 2 são distribuídas localmente
sob a licença SIL Open Font License; os textos completos e a proveniência estão
em `client/fonts`. Textos da interface em português do Brasil.

## Distribuição e direitos das novas versões

As novas contribuições a partir de `0.2.0-preview.2` reservam direitos a
**Pedro Tiago Corrêa Faria**, com permissão para avaliação pessoal da demonstração
oficial. Consulte [LICENSE.txt](LICENSE.txt).

As versões anteriores declaravam MIT; esta alteração não revoga permissões
anteriores nem modifica as licenças de terceiros. Os avisos preservados estão em
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Antes da exploração comercial,
convém revisar juridicamente o histórico de licenças e a titularidade.

A demonstração pelo navegador é preparada com `npm run build:web` e validada
com `npm run e2e:static`. Consulte [WEB.md](docs/WEB.md) para os recursos locais,
persistência e limites de hospedagem.
