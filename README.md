# Frota Estelar

**Frota Estelar** é um jogo de estratégia espacial com batalhas automáticas
(*auto-battler*) que roda direto no navegador. Você escolhe uma facção, monta uma
frota dentro de um orçamento de pontos e, quando todos estão prontos, as frotas
lutam sozinhas: cada nave escolhe alvos, se posiciona e usa habilidades por conta
própria. Você assiste, acelera o tempo e aprende o que funciona.

- **Um jogador**: 15 níveis com chefes e níveis infinitos depois, 4 dificuldades,
  formatos de 1v1 até 6v6 com aliados controlados pelo computador.
- **Multijogador**: salas com código de 4 letras, de 1v1 até 6v6, bots preenchem as
  vagas vazias, chat, revanche, reconexão automática.
- **Sem dependências de build**: JavaScript moderno (ES modules), Canvas 2D e Web Audio.
  Toda a arte e todo o som são gerados por código; não há arquivos de mídia.

## Testar agora (3 passos)

1. **Instale o Node.js** (versão LTS) em <https://nodejs.org> — só uma vez.
2. **Baixe o jogo**: no GitHub clique em *Code → Download ZIP* e descompacte, ou
   `git clone https://github.com/sabedoriameditativa-ops/fantastic-fortnight.git`.
3. **Abra o jogo**: dê dois cliques em `iniciar.bat` (Windows) ou rode `./iniciar.sh`
   (macOS/Linux). O script instala a única dependência (`ws`), inicia o servidor e abre
   `http://localhost:3000` no navegador. Para encerrar, feche a janela (ou Ctrl+C).
   No macOS/Linux, se o arquivo perdeu a permissão de execução (ZIP), use `bash iniciar.sh`.

Se o navegador mostrar "não consigo chegar a esta página", o servidor não está rodando:
olhe a janela preta do script (ela fica aberta e mostra o motivo). Caminho manual no
Windows: abra a pasta do jogo, clique na barra de endereço do Explorador, digite `cmd` e
Enter; na janela que abre rode `node server\index.js` e depois acesse `http://localhost:3000`.

Para jogar com amigos na mesma rede, eles abrem `http://SEU-IP:3000` (o IP do computador
que rodou o script; veja com `ipconfig` no Windows ou `ifconfig`/`ip a` no macOS/Linux) e
entram com o código da sala. Pela internet é preciso liberar a porta 3000 no roteador ou
usar um túnel (por exemplo `ngrok http 3000`).

Dica: `npm install --omit=dev` instala só o necessário para jogar; o `npm install` completo
também traz o Playwright (usado pelos testes ponta a ponta), que é bem maior.

## Facções

| Facção | Raça | Casco | Estilo | Passiva |
|---|---|---|---|---|
| **Confederação Terrana** | Humanos | Blindado | Blindagem, mísseis e disciplina. Equilibrada; escudos apenas nas naves-capitais. | *Coordenação de Fogo*: alvos atacados por 3 ou mais naves terranas sofrem +10% de dano cinético. |
| **Enxame Vorrax** | Insetoides | Orgânico | Cascos vivos que se regeneram. Sem escudos, sem recuo, sem fim. | *Fome*: uma nave Vorrax que destrói um inimigo recupera parte do casco máximo. |
| **Ascendência Lúmen** | Seres de energia | Cristalino | Escudos de luz, cascos de cristal. Feixes precisos e saltos de fase. | *Fase*: ao perder o escudo, a nave fica intocável por 1 s (uma vez a cada 20 s). |
| **Nexo Ferrix** | Coletivo de máquinas | Nanitos | Nanitos que se reconstroem, canhões magnéticos e pulsos EMP. Fria eficiência. | *Rede Neural*: +10% de precisão contra naves minúsculas e pequenas. |

Cada facção tem 8 naves (minúscula → nave-mãe), cada uma com uma habilidade
própria, e 3 predefinições de frota prontas para usar. Os tipos de dano importam:
lasers derretem escudos e cascos orgânicos; cinéticos e torpedos castigam blindagem
e cristal; plasma e bioácido corroem nanitos; pulsos iônicos apagam escudos e
interrompem a regeneração. A **Galeria de naves** dentro do jogo mostra a ficha
completa de cada nave, arma e habilidade.

## Instalação e execução

Requisitos: **Node.js 22 ou superior** (`npm test` usa o descobridor de testes por
glob e os *loader hooks* do Node 22). A única dependência de runtime é o pacote `ws`
(WebSocket); o Playwright, usado só pelos testes ponta a ponta, é uma dependência
de desenvolvimento.

```bash
npm install
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

`GET /health` responde `{ ok, rooms, uptime, sessions }`.

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

Você também pode abrir uma batalha direta pela URL:
`?autotest=1&level=3&difficulty=dificil&faction=vorrax&speed=4&seed=42`
(`?seed=` fixa a semente de qualquer batalha de um jogador; `?debug=1` expõe
`window.__fe` no console).

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

### Jogar em rede local (LAN)

Rode `npm start` em um computador e descubra o IP dele na rede (`ipconfig` no
Windows, `ip addr`/`ifconfig` no Linux/macOS). Os outros jogadores abrem
`http://IP_DO_HOST:3000` (por exemplo `http://192.168.0.10:3000`) e entram pelo
código da sala ou pelo link `http://192.168.0.10:3000/?sala=CODIGO`. Libere a porta
no firewall do host se necessário. Para jogar pela internet, exponha a mesma porta
(ou use um túnel) — o servidor é único e autoritativo, não há configuração extra.

### Dificuldades e níveis

As dificuldades mudam os bots (e, no modo um jogador, o orçamento inimigo):

| | Fácil | Normal | Difícil | Especialista |
|---|---|---|---|---|
| Reação / precisão da IA | lenta, erra alvos e habilidades | média | rápida | perfeita |
| Foco de fogo, recuo, formação | não | sim | sim | sim |
| Como monta a frota | aleatória, gasta 60–85% | predefinição | **contra-ataque** à sua frota | **contra-ataque** |
| Orçamento inimigo (× do nível) | menor | igual | maior | ainda maior |

Os valores exatos ficam em `shared/aiProfiles.js`. Jogadores humanos sempre têm
a IA de nave no nível *Especialista* — a dificuldade só afeta os bots.

Os 15 níveis formam uma campanha: **1–3** Confederação Terrana (orçamento inimigo
50–70% do seu), **4–6** Enxame Vorrax (chefe: Rainha-Guerreira no 6), **7–9**
Ascendência Lúmen (chefe: Catedral no 9), **10–12** Nexo Ferrix (chefe: Mente
Primária no 12), **13–15** facção aleatória com frotas de contra-ataque e orçamento
120–150% (no 15 o inimigo sempre traz uma nave-mãe). A partir do **16** os níveis
são infinitos e o orçamento inimigo cresce 10% por nível. O progresso (maior nível
concluído por dificuldade) fica salvo no navegador.

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

## Testes, simulações e ferramentas de balanceamento

```bash
npm test                     # testes unitários (node:test, test/**/*.test.js)
npm run e2e                  # ponta a ponta no Chromium (Playwright): sobe o servidor
                             # numa porta livre e joga partidas reais pelo navegador
npm run simulate -- --help   # simulador headless (frota × frota, matrizes, dificuldade)
```

Os testes ponta a ponta precisam do Chromium do Playwright. `npm install` instala o
pacote `playwright`; baixe o navegador uma vez com:

```bash
npx playwright install chromium
```

(O runner também aceita um Chromium já instalado via `PLAYWRIGHT_BROWSERS_PATH`.
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
tira capturas), `tools/render-shots.js` (vitrine das 32 naves e quadros de batalha),
`tools/audio-check.js` (verifica o áudio num Chromium real ou renderiza todas as
receitas offline).

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

A simulação é **determinística**: a mesma configuração e semente produzem a mesma
batalha, tick a tick, no servidor e no navegador. No modo um jogador ela roda num
Web Worker; no multijogador roda no servidor (autoritativo) e os clientes apenas
interpolam os quadros recebidos. Renderizador e áudio consomem o mesmo formato de
quadro nos dois casos.

## Créditos

Toda a arte (naves, efeitos, fundo, interface) e todo o áudio (efeitos sonoros e
trilha generativa) são **procedurais**, gerados em tempo de execução por código —
o projeto não contém nem baixa nenhum arquivo de mídia. A única dependência de
runtime é o pacote `ws`. Textos da interface em português do Brasil.

Licença: MIT.
