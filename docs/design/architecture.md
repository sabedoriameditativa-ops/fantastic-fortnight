# Proposta de design — Arquitetura, Netcode e Fluxo de UI

Jogo de trabalho: **"Frota Automática"** (nome interno `fleetwars`; o título pt-BR fica a cargo do lead). Tudo abaixo respeita as decisões fixas: ES modules vanilla, Node 22 + `ws`, Canvas 2D, simulação determinística a 20 ticks/s, servidor autoritativo no multijogador.

---

## 0. Decisões-chave desta proposta (resumo opinativo)

| # | Decisão | Por quê |
|---|---|---|
| D1 | A simulação é um módulo **puro** (`createBattle / stepBattle / makeSnapshot`) sem timers, sem DOM, sem `Date`. Quem "dá o relógio" é um *runner* (local ou servidor). | Mesmo código em Node e browser; testável com `node:test`; portável para Web Worker depois sem mudar nada. |
| D2 | O renderer consome uma interface única `BattleFeed` (snapshots + eventos + resultado). `LocalRunner` e `NetClient` implementam a mesma interface. | Renderer agnóstico de origem (exigência). |
| D3 | Projéteis **não vão no snapshot**. Vão como evento `fire` e o cliente anima um projétil "visual" até o alvo; o evento `hit` dispara o flash. Lasers são `beam` instantâneos. | Corta ~50% da banda em 6v6; projéteis no sim são homing, então o visual nunca "erra" de forma perceptível. |
| D4 | Snapshots: JSON compacto (arrays, inteiros quantizados), 10 Hz, **serializado uma vez por sala** e enviado a todos; `permessage-deflate` ligado. Binário fica como v2. | JSON é depurável, e com deflate fica em ~30 KB/s por cliente no pior caso. |
| D5 | Como a batalha é 100% automática, **desconexão durante a batalha não aborta nada**: a frota já foi entregue. Só no lobby a desconexão importa (vaga segura 60 s, depois vira "vazia"). | Simplifica drasticamente a reconexão. |
| D6 | Menus/HUD em **DOM (HTML/CSS)**; o canvas é só a arena. | Texto pt-BR, acessibilidade, layout responsivo "de graça". Canvas para texto é dor. |
| D7 | Loop local com acumulador e **catch-up limitado** (máx. 8 ticks por frame); pausa em `document.hidden`. No multi, o cliente descarta o buffer e "pula" para o último snapshot ao voltar do background. | Resolve throttling de abas em segundo plano. |
| D8 | Bots constroem frota **no início da contagem regressiva** (não ao serem adicionados), para que o nível *difícil* possa contra-escolher a composição inimiga já enviada. | Diferencia dificuldades sem tocar na IA de batalha. |

---

## 1. Layout do repositório e interfaces

```
fleetwars/
├── package.json
├── README.md
├── shared/                      # código isomórfico (Node + browser), zero deps
│   ├── constants.js             # TICK_RATE=20, TICK_MS=50, WORLD, limites de frota
│   ├── rng.js                   # PRNG determinístico (mulberry32) + helpers
│   ├── catalog.js               # catálogo de classes de naves + habilidades (dados)
│   ├── fleet.js                 # validação de frota, custo, presets, autocompletar
│   ├── botFleet.js              # construtor de frota dos bots por dificuldade
│   ├── protocol.js              # constantes de tipos de mensagem + validadores de payload
│   └── sim/
│       ├── battle.js            # createBattle / stepBattle / makeSnapshot / getResult
│       ├── spatial.js           # grade espacial (hash grid) p/ consultas de vizinhos
│       ├── ai.js                # seleção de alvo, movimento, decisão de habilidades
│       ├── abilities.js         # registro de habilidades (cooldown, canUse, apply)
│       ├── weapons.js           # disparo, projéteis homing, beams, dano
│       ├── events.js            # construtores/códigos dos eventos compactos
│       └── stats.js             # acumuladores por jogador (dano, abates, etc.)
├── server/
│   ├── index.js                 # bootstrap: http estático + WebSocketServer
│   ├── static.js                # servidor de arquivos (mime, cache, index fallback)
│   ├── lobby.js                 # registro de salas, códigos, roteamento de mensagens
│   ├── room.js                  # máquina de estados da sala (lobby→countdown→battle→results)
│   ├── match.js                 # MatchRunner: loop de ticks, broadcast de frames
│   ├── session.js               # sessão por socket, tokens, reconexão, rate limit
│   └── log.js                   # logger mínimo
├── client/
│   ├── index.html               # único HTML; <div id="app"> + <canvas id="arena">
│   ├── styles.css
│   ├── app.js                   # roteador de telas, estado global do cliente
│   ├── i18n.js                  # strings pt-BR centralizadas (objeto T)
│   ├── screens/
│   │   ├── menu.js              # Um jogador / Multijogador / Como jogar
│   │   ├── howto.js
│   │   ├── spSetup.js           # nível, dificuldade, tamanho dos times
│   │   ├── fleetBuilder.js      # cards do catálogo, orçamento, presets
│   │   ├── lobby.js             # grade de vagas, pronto, código da sala
│   │   ├── battle.js            # monta canvas + HUD; liga BattleFeed ao renderer
│   │   └── results.js
│   ├── battle/
│   │   ├── feed.js              # @typedef BattleFeed + createEmitter
│   │   ├── localRunner.js       # roda shared/sim no browser (SP) → BattleFeed
│   │   ├── netClient.js         # WebSocket → BattleFeed (+ lobby API)
│   │   ├── interpolator.js      # buffer de snapshots, render-time, lerp
│   │   ├── renderer.js          # Canvas 2D: câmera, sprites, efeitos
│   │   ├── sprites.js           # Path2D por classe, cores por time
│   │   ├── effects.js           # partículas, projéteis visuais, beams, anéis
│   │   ├── camera.js            # fit-to-fleets, letterbox, HiDPI
│   │   └── hud.js               # barras de HP dos times, log de eventos, velocidade
│   └── util/dom.js              # h(), el(), on() helpers
├── tools/
│   └── simulate.js              # CLI headless: frota A vs B, N seeds, win rate
└── test/
    ├── unit/*.test.js           # node:test
    └── e2e/*.e2e.js             # Playwright
```

### 1.1 `shared/constants.js`

```js
export const TICK_RATE = 20;            // ticks por segundo
export const TICK_MS = 1000 / TICK_RATE; // 50
export const SNAPSHOT_EVERY = 2;        // 1 frame de rede a cada 2 ticks = 10 Hz
export const WORLD = { w: 2400, h: 1350 }; // 16:9, unidades do mundo
export const MAX_TICKS = TICK_RATE * 180;  // 3 min; depois decide por HP restante
export const FLEET = { budget: 1000, maxShips: 20, minShips: 1 };
export const TEAM_SIZES = [1, 2, 3, 4, 5, 6];
export const DIFFICULTIES = ['facil', 'medio', 'dificil'];
export const POS_SCALE = 10;           // posições quantizadas em décimos de unidade
export const ANGLE_SCALE = 256 / (2 * Math.PI); // ângulo em 0..255
export const HP_SCALE = 1000;          // hp e escudo como fração 0..1000
```

### 1.2 `shared/rng.js`

```js
/** mulberry32: 32-bit, rápido, idêntico em Node e browser (só usa | >>> * Math.imul). */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,                               // [0,1)
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    chance(p) { return next() < p; },
    fork() { return createRng(Math.floor(next() * 0xFFFFFFFF)); }, // sub-stream
  };
}
export function hashString(s) { /* FNV-1a 32 → uint32, para seeds a partir de código de sala */ }
```

Regra: **toda** aleatoriedade do sim passa pelo `rng` do `BattleState`. Nunca `Math.random` dentro de `shared/sim`.

### 1.3 `shared/catalog.js` (formato; os números são da lente de balanceamento)

```js
/**
 * @typedef {Object} ShipClass
 * @property {string} id            'interceptor' | 'caca' | 'corveta' | 'fragata' | 'cruzador' | 'encouracado' | 'nave_mae' | 'suporte' ...
 * @property {string} name          nome pt-BR p/ UI ("Interceptador")
 * @property {string} desc          descrição curta pt-BR
 * @property {number} cost          pontos
 * @property {number} maxPerFleet   limite por frota (ex.: nave-mãe = 1)
 * @property {number} hp
 * @property {number} shield        0 se não tem
 * @property {number} shieldRegen   por segundo, fora de combate
 * @property {number} speed         unidades/s
 * @property {number} turnRate      rad/s
 * @property {number} radius        raio de colisão/desenho
 * @property {number} size          1..5 (afeta sprite e targeting)
 * @property {Weapon[]} weapons
 * @property {string[]} abilities   ids de abilities.js
 * @property {number} priority      peso base como alvo (naves grandes atraem mais fogo)
 */
/**
 * @typedef {Object} Weapon
 * @property {'projectile'|'beam'|'missile'} kind
 * @property {number} damage
 * @property {number} range
 * @property {number} cooldown     segundos
 * @property {number} [speed]      projétil: unidades/s
 * @property {number} [splash]     míssil: raio
 * @property {number} [vsSmall]    multiplicador vs size<=2 (ex.: 0.3 p/ canhão pesado)
 * @property {number} [vsLarge]    multiplicador vs size>=4
 */
export const CATALOG = Object.freeze({ /* id → ShipClass */ });
export const CATALOG_LIST = Object.values(CATALOG);
export function getClass(id) {}
```

### 1.4 `shared/fleet.js`

```js
/** @typedef {{ cls: string, count: number }} FleetEntry */
/** @typedef {FleetEntry[]} Fleet */

export function fleetCost(fleet) → number
export function fleetShipCount(fleet) → number
/**
 * @returns {{ ok: true, fleet: Fleet } | { ok: false, code: string, msg: string }}
 * Normaliza (mescla entradas repetidas, remove count<=0) e valida:
 *  - cada cls existe no catálogo               → 'FLEET_UNKNOWN_CLASS'
 *  - count inteiro 1..maxPerFleet              → 'FLEET_CLASS_LIMIT'
 *  - custo total <= budget                     → 'FLEET_OVER_BUDGET'
 *  - total de naves em [minShips, maxShips]    → 'FLEET_SHIP_COUNT'
 */
export function validateFleet(fleet, budget = FLEET.budget) {}

export const PRESETS = {
  enxame:      { name: 'Enxame',      build: (budget) => Fleet },
  encouracado: { name: 'Encouraçado', build: (budget) => Fleet },
  equilibrado: { name: 'Equilibrado', build: (budget) => Fleet },
};
/** Preenche o orçamento restante com naves baratas/úteis, respeitando limites. */
export function autoComplete(fleet, budget, rng) → Fleet
```

Mensagens pt-BR correspondentes aos códigos ficam em `client/i18n.js` (o servidor envia **código**; o cliente traduz).

### 1.5 `shared/botFleet.js`

```js
/**
 * @param {Object} o
 * @param {number} o.budget
 * @param {'facil'|'medio'|'dificil'} o.difficulty
 * @param {import('./rng.js').Rng} o.rng
 * @param {Fleet[]} [o.enemyFleets]   frotas inimigas já enviadas (p/ 'dificil')
 * @param {number} [o.level]          SP: 1..10, muda composição permitida
 * @returns {Fleet}
 */
export function buildBotFleet(o) {}
```
- `facil`: escolhe classes aleatórias, desperdiça 10–25% do orçamento, nunca compra nave-mãe.
- `medio`: sorteia um dos `PRESETS` e aplica `autoComplete`.
- `dificil`: lê `enemyFleets`, calcula fração de naves pequenas/grandes do inimigo e escolhe contra-composição (muitas pequenas → compra anti-enxame; muitas grandes → caças/mísseis), usa 100% do orçamento.

### 1.6 `shared/sim/battle.js` — a interface central

```js
/**
 * @typedef {Object} BattlePlayer
 * @property {string} id         estável durante a partida ('p1'…, 'bot_a3')
 * @property {string} name
 * @property {0|1} team
 * @property {boolean} isBot
 * @property {Fleet} fleet       já validada
 *
 * @typedef {Object} BattleConfig
 * @property {number} seed       uint32
 * @property {BattlePlayer[]} players
 * @property {number} [maxTicks] default MAX_TICKS
 *
 * @typedef {Object} ShipInit   // enviado uma vez em battle_start
 * @property {number} id        inteiro sequencial a partir de 1
 * @property {string} cls
 * @property {string} owner     BattlePlayer.id
 * @property {0|1} team
 * @property {number} x
 * @property {number} y
 * @property {number} a         rad
 *
 * @typedef {Object} Snapshot
 * @property {number} t         tick
 * @property {number[][]} s     por nave viva: [id, x*10, y*10, a(0..255), hp(0..1000), sh(0..1000), flags]
 *                              flags bit0=shieldUp bit1=emp'd bit2=boosting bit3=healing bit4=firing
 *
 * @typedef {Array} SimEvent   // arrays compactos; primeiro elemento é o código
 *  [1, srcId, tgtId, weaponIdx]           FIRE   (projétil visual src→tgt)
 *  [2, srcId, tgtId, weaponIdx]           BEAM   (laser instantâneo)
 *  [3, tgtId, amount, kind]               HIT    kind 0=hull 1=shield; amount em hp inteiro
 *  [4, shipId, killerOwnerIdx]            DIE
 *  [5, shipId, abilityCode, tgtIdOrZero]  ABILITY (code: 1 shield,2 emp,3 heal,4 boost,5 missileSalvo,...)
 *  [6, x*10, y*10, radius]                SPLASH (explosão de míssil)
 *
 * @typedef {Object} BattleResult
 * @property {0|1|-1} winner       -1 = empate
 * @property {'elimination'|'timeout'} reason
 * @property {number} ticks
 * @property {Object<string, PlayerStats>} players  por BattlePlayer.id
 *
 * @typedef {Object} PlayerStats
 * @property {number} damageDealt
 * @property {number} damageTaken
 * @property {number} kills
 * @property {number} shipsTotal
 * @property {number} shipsLost
 * @property {{cls:string, hp:number}[]} survivors
 */

export function createBattle(config) → BattleState      // posiciona frotas, zera stats
export function getInitialShips(state) → ShipInit[]
export function stepBattle(state) → SimEvent[]          // avança exatamente 1 tick
export function makeSnapshot(state) → Snapshot
export function getResult(state) → BattleResult | null  // null enquanto não acabou
export function runToEnd(config, { onTick } = {}) → BattleResult   // usado por simulate.js e testes
```

`BattleState` é um objeto plano (sem classes) com `tick, rng, ships: Map<id, Ship>, projectiles: [], grid, stats, players, aliveByTeam: [n0, n1]`. Internamente `stepBattle` faz, nesta ordem: (1) rebuild da grade espacial, (2) `ai.decide(ship)` para cada nave (alvo + vetor desejado + habilidade), (3) integração de movimento, (4) `weapons.update` (cooldowns, spawn de projéteis, avanço/colisão), (5) `abilities.update` (durações/cooldowns), (6) regen de escudo, (7) remoção de mortos + eventos, (8) checagem de fim.

Fim de batalha: `aliveByTeam[t] === 0` → `elimination`; `tick >= maxTicks` → `timeout`, vencedor = time com maior `Σ hp+shield atual / Σ hp+shield inicial`; diferença < 0.02 → empate.

**Determinismo:** iterar `ships` sempre na ordem de inserção (Map garante); jamais iterar objetos cujas chaves possam variar; ordenar candidatos a alvo por `(score desc, id asc)` para desempate estável; nada de `Date.now()` dentro do sim.

### 1.7 `shared/sim/abilities.js`

```js
/**
 * @typedef {Object} AbilityDef
 * @property {string} id
 * @property {number} code         inteiro p/ evento compacto
 * @property {number} cooldown     s
 * @property {number} [duration]   s
 * @property {(ship, state) => boolean} canUse      condições "inteligentes" (ex.: escudo só se hp<60% e ≥2 inimigos no alcance)
 * @property {(ship, state) => Ship|null} [pickTarget]
 * @property {(ship, target, state, events) => void} apply
 */
export const ABILITIES = { shield_burst, emp_pulse, repair_beam, afterburner, missile_salvo, decoy, focus_fire /* nave-mãe: buff de dano aliado */ };
```

### 1.8 `shared/protocol.js`

```js
export const C2S = { HELLO:'hello', CREATE_ROOM:'create_room', JOIN_ROOM:'join_room', LEAVE_ROOM:'leave_room',
  SET_TEAM_SIZE:'set_team_size', PICK_SLOT:'pick_slot', ADD_BOT:'add_bot', REMOVE_BOT:'remove_bot',
  SET_FLEET:'set_fleet', READY:'ready', START:'start', REMATCH:'rematch', CHAT:'chat', PING:'ping' };
export const S2C = { WELCOME:'welcome', ERROR:'error', ROOM:'room', LEFT:'left', COUNTDOWN:'countdown',
  BATTLE_START:'battle_start', FRAME:'f', BATTLE_END:'battle_end', CHAT:'chat', PONG:'pong' };
export function validateName(s) → string|null          // trim, 1..16 chars, sem controle
export function isRoomCode(s) → boolean                 // /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/
export const ERR = { /* códigos listados na seção 2.5 */ };
```

### 1.9 Servidor

```js
// server/session.js
/** @typedef {{ id:string, token:string, name:string, ws:WebSocket|null, roomCode:string|null,
 *              lastSeen:number, bucket:{tokens:number, ts:number} }} Session */
export function createSession(ws, name) → Session
export function resumeSession(token, ws) → Session|null   // dentro de 60 s após queda

// server/room.js
/**
 * @typedef {Object} Slot
 * @property {'empty'|'human'|'bot'} kind
 * @property {string} [playerId]
 * @property {string} [name]
 * @property {'facil'|'medio'|'dificil'} [difficulty]
 * @property {boolean} ready
 * @property {boolean} hasFleet
 * @property {boolean} connected
 *
 * @typedef {Object} RoomState   // o que vai para o cliente
 * @property {string} code
 * @property {string} hostId
 * @property {number} teamSize
 * @property {'lobby'|'countdown'|'battle'|'results'} phase
 * @property {Slot[][]} slots       [team0[], team1[]]
 * @property {number} budget
 * @property {{ id:string, name:string, team:number, slot:number }[]} spectators   (entrou mas não pegou vaga)
 */
export function createRoom(hostSession, teamSize) → Room
Room.prototype: setTeamSize(size), pickSlot(session, team, slot), addBot(team, slot, difficulty),
  removeBot(team, slot), setFleet(session, fleet), setReady(session, flag), start(session),
  rematch(session), onDisconnect(session), onReconnect(session), toState() → RoomState

// server/match.js
export function startMatch(room, config, broadcast) → { stop() }
```

`MatchRunner` (loop drift-corrected, não `setInterval` puro):

```js
function startMatch(room, config, broadcast) {
  const state = createBattle(config);
  broadcast({ t: 'battle_start', seed: config.seed, players: config.players.map(p => ({id:p.id,name:p.name,team:p.team,isBot:p.isBot})), ships: getInitialShips(state) });
  let nextAt = performance.now() + TICK_MS, pending = [];
  const timer = setInterval(() => {
    const now = performance.now();
    let n = 0;
    while (now >= nextAt && n++ < 8) {          // catch-up limitado
      pending.push(...stepBattle(state));
      nextAt += TICK_MS;
      if (state.tick % SNAPSHOT_EVERY === 0) {
        const msg = JSON.stringify({ t: 'f', k: state.tick, s: makeSnapshot(state).s, e: pending }); // UMA string p/ todos
        pending = [];
        broadcast(msg);
      }
      const result = getResult(state);
      if (result) { clearInterval(timer); broadcast({ t: 'battle_end', result }); room.onBattleEnd(result); return; }
    }
    if (n >= 8) nextAt = now;                   // servidor sobrecarregado: dropa tempo, não acumula
  }, 10);                                        // granularidade 10 ms; o relógio real é nextAt
  return { stop: () => clearInterval(timer) };
}
```

### 1.10 Cliente — a interface `BattleFeed`

```js
// client/battle/feed.js
/**
 * @typedef {Object} BattleFeed
 * @property {(cb:(info:BattleStartInfo)=>void)=>void} onStart
 * @property {(cb:(frame:{k:number, s:number[][], e:SimEvent[], at:number})=>void)=>void} onFrame  // at = performance.now() de chegada
 * @property {(cb:(result:BattleResult)=>void)=>void} onEnd
 * @property {(cb:(status:'ok'|'reconnecting'|'lost')=>void)=>void} onStatus
 * @property {() => void} dispose
 * @property {{ setSpeed?:(x:1|2|4)=>void, pause?:(b:boolean)=>void }} controls  // só LocalRunner implementa
 * @property {boolean} isLocal
 *
 * @typedef {{ players: {id,name,team,isBot}[], ships: ShipInit[], seed:number }} BattleStartInfo
 */
```

`LocalRunner` (`client/battle/localRunner.js`):

```js
export function createLocalRunner(config) → BattleFeed
// internamente:
//   requestAnimationFrame loop; acc += (now - last) * speed; while (acc >= TICK_MS && n < 8*speed) { events.push(...stepBattle(state)); acc -= TICK_MS; if (tick % 2 === 0) emitFrame(); }
//   document.visibilitychange → pause; ao voltar, last = now (sem catch-up)
//   emite frames exatamente no mesmo formato que o servidor (k, s, e) — o renderer não vê diferença
```

`NetClient` (`client/battle/netClient.js`):

```js
export function createNetClient(url) → NetClient
/**
 * @typedef {Object} NetClient
 * @property {(name:string)=>Promise<{playerId:string}>} connect     // envia hello (com token salvo em sessionStorage, se houver)
 * @property {(teamSize:number)=>Promise<RoomState>} createRoom
 * @property {(code:string)=>Promise<RoomState>} joinRoom
 * @property {(...)=>Promise<void>} setTeamSize | pickSlot | addBot | removeBot | setFleet | setReady | start | rematch | chat | leave
 * @property {(cb:(room:RoomState)=>void)=>void} onRoom
 * @property {(cb:(c:{seconds:number, startAt:number})=>void)=>void} onCountdown
 * @property {(cb:(e:{code:string, msg:string})=>void)=>void} onError
 * @property {() => BattleFeed} feed      // mesma instância reutilizada por partida/revanche
 */
```
Requisições C2S carregam `rid` (inteiro crescente); o servidor responde `{t:'ack', rid}` ou `{t:'error', rid, code, msg}` para resolver/rejeitar a Promise. Estados (`room`) chegam por push, sempre completos (sem deltas de lobby — é pequeno).

`Interpolator` (`client/battle/interpolator.js`):

```js
export function createInterpolator({ delayMs = 150, maxBuffer = 20 })
  .push(frame)                     // guarda {k, s(Map id→entry), at}
  .sample(nowMs) → { ships: Map<id, {x,y,a,hp,sh,flags}>, tick:number }  // interpola entre os dois frames que cercam (now - delay)
  .reset()                         // após visibilitychange/reconexão: descarta tudo
```
Render time `rt = now - delayMs`. Encontra frames `A (at ≤ rt) ≤ B`; `u = (rt - A.at)/(B.at - A.at)`; `x = lerp`, ângulo via menor arco; hp/sh pegam de `B` (sem interpolar barras). Se não há `B` (atraso), extrapola no máximo 100 ms com velocidade do último par, depois congela. Em modo local, `delayMs = 100` (os frames chegam regulares a 10 Hz; interpolar suaviza 10 Hz → 60 fps).

`Renderer` (`client/battle/renderer.js`):

```js
export function createRenderer(canvas, { start: BattleStartInfo, myTeam?: 0|1 }) → Renderer
Renderer.onFrame(frame)     // repassa ao interpolator e processa frame.e em effects (spawn de projéteis/beams/flashes)
Renderer.draw(nowMs)        // chamado por rAF do screen; usa interpolator.sample
Renderer.resize()
Renderer.dispose()
```

`client/app.js`:

```js
const screens = { menu, howto, spSetup, fleetBuilder, lobby, battle, results };
export function go(name, props) { current?.unmount(); current = screens[name].mount(root, props, go); }
// estado compartilhado mínimo: { playerName, net: NetClient|null, lastFleet: Fleet, spConfig }
```

---

## 2. Protocolo WebSocket

Transporte: `ws` com `perMessageDeflate: { threshold: 512 }`. Mensagens JSON, campo `t` = tipo. C2S inclui `rid` opcional.

### 2.1 Handshake e sessão

| Dir | Mensagem | Campos | Notas |
|---|---|---|---|
| C→S | `hello` | `name`, `token?` | Com `token` válido (≤60 s de queda) **retoma** a sessão: servidor reenvia `welcome` + `room` (ou `battle_start` + último frame se em batalha). |
| S→C | `welcome` | `playerId`, `token`, `serverTime`, `version` | `version` do protocolo; cliente recusa se diferente. |
| C→S | `ping` | `c` (client ms) | a cada 5 s |
| S→C | `pong` | `c`, `s` | p/ estimar offset e mostrar latência |

### 2.2 Salas

| Dir | Mensagem | Campos | Validação / efeito |
|---|---|---|---|
| C→S | `create_room` | `teamSize` (1–6) | Cria sala com código de 4 letras (alfabeto sem I/O/0/1), host = criador, que entra em `team 0, slot 0`. |
| C→S | `join_room` | `code` | `ROOM_NOT_FOUND`, `ROOM_FULL` (12 humanos+bots ocupando tudo e sem vaga), `ROOM_IN_BATTLE` (entra como espectador — permitido, recebe frames). Entrante vai para a primeira vaga vazia do time com menos humanos; se nenhuma, vira espectador. |
| C→S | `leave_room` | — | Vaga vira `empty`; se era host, host = humano conectado mais antigo; sala sem humanos é destruída. |
| C→S | `set_team_size` | `teamSize` | Só host, só `phase=lobby`. Reduzir remove vagas excedentes (humanos nelas viram espectadores, bots somem). |
| C→S | `pick_slot` | `team`, `slot` | `SLOT_TAKEN`; `slot < teamSize`. Troca de vaga zera `ready`, mantém frota. |
| C→S | `add_bot` | `team`, `slot`, `difficulty` | Só host; vaga deve estar `empty`. Bot aparece `ready:true, hasFleet:true` (a frota é gerada no countdown). Nome gerado: `Bot Alfa`, `Bot Bravo`, … |
| C→S | `remove_bot` | `team`, `slot` | Só host. |
| C→S | `set_fleet` | `fleet: FleetEntry[]` | Roda `validateFleet(fleet, room.budget)`; erro vem com código da seção 1.4. Guarda **versão normalizada**. Zera `ready` (mudou a frota, confirma de novo). |
| C→S | `ready` | `ready: boolean` | `FLEET_MISSING` se `ready=true` sem frota válida. |
| C→S | `start` | — | Só host. Condições: todas as vagas de **ambos** os times preenchidas (humano ou bot), todos humanos `ready` e conectados; senão `NOT_ALL_READY` com `missing: [{team,slot,reason}]`. **Opcional** (recomendo): vagas vazias no `start` são auto-preenchidas com bot `medio` se host enviar `fillBots:true`. |
| S→C | `room` | `RoomState` completo | Push a cada mudança, a todos na sala (inclusive espectadores). Frotas dos outros **não** são enviadas (só `hasFleet`) — evita contra-pick humano no lobby; revelação acontece no `battle_start`. |
| S→C | `left` | `reason: 'kicked'|'room_closed'|'left'` | Cliente volta ao menu multijogador. |
| C→S | `chat` | `text` (≤200) | Broadcast `chat {from, name, text, ts}`; rate 1/s. |

### 2.3 Countdown e batalha

| Dir | Mensagem | Campos |
|---|---|---|
| S→C | `countdown` | `seconds: 5`, `startAt: serverTime+5000` — fase vira `countdown`; durante ela nada mais é aceito (exceto `leave`/`chat`). Aqui o servidor chama `buildBotFleet` para cada bot, com `enemyFleets` = frotas humanas do outro time. Se um humano sair durante o countdown → cancela, `room` volta a `lobby`, erro `COUNTDOWN_ABORTED` a todos. |
| S→C | `battle_start` | `seed`, `players: [{id,name,team,isBot,fleet}]` (agora com frotas reveladas), `ships: ShipInit[]`, `tickRate: 20`, `snapshotEvery: 2` |
| S→C | `f` | `k` (tick), `s` (Snapshot.s), `e` (eventos dos últimos 2 ticks) — 10 Hz |
| S→C | `battle_end` | `result: BattleResult` — fase `results`. |
| C→S | `rematch` | — | Marca o jogador como "quer revanche". `room` mostra `rematchVotes`. Quando **todos os humanos** votarem (ou host forçar com `start`), fase volta a `lobby` com frotas mantidas e `ready=false`. Times/vagas preservados; host pode trocar lados com `pick_slot`. |

Formato de `f` (exemplo real, 3 naves vivas):
```json
{"t":"f","k":240,"s":[[1,12034,6710,64,1000,820,1],[2,11890,6650,70,430,0,16],[7,13100,6900,192,1000,1000,0]],"e":[[1,2,7,0],[3,7,38,1],[5,1,1,0]]}
```

### 2.4 Desconexão e reconexão (regras)

| Situação | Comportamento |
|---|---|
| Humano cai no **lobby** | Vaga marcada `connected:false` por 60 s (UI: "desconectado…"). `ready` zera. Se era host, host migra na hora. Após 60 s: vaga `empty`. |
| Humano cai no **countdown** | Cancela countdown (ver acima). |
| Humano cai na **batalha** | **Nada muda no sim.** A sessão fica resgatável por 60 s; se reconectar, recebe `battle_start` (com `ships` do estado **atual**, não inicial — ver abaixo) + frames seguintes. Se não voltar até `battle_end`, sua vaga vira `bot medio` para a revanche, com a mesma frota. |
| Humano cai nos **resultados** | Igual lobby. |
| Todos os humanos de uma sala caem | Batalha continua até acabar (custo pequeno), depois sala destruída 60 s após. |
| Servidor reinicia | Salas perdidas; cliente mostra "Conexão perdida" com botão voltar ao menu. Sem persistência (v1). |

Reconexão em batalha: o servidor guarda `getInitialShips(state)` do começo e, para reentrada, envia `battle_start` com `ships` = lista inicial **mais** `dead: [ids]` e o frame corrente; o cliente marca os mortos como já destruídos (sem explosão) e segue. Token em `sessionStorage` (por aba), `hello{token}` automático na reabertura do socket com backoff 0.5 s → 1 → 2 → 4 (máx. 5 tentativas), estado `reconnecting` no HUD.

### 2.5 Códigos de erro (servidor envia `code`; cliente traduz)

| `code` | pt-BR |
|---|---|
| `BAD_MESSAGE` | Mensagem inválida. |
| `BAD_NAME` | Nome inválido (1 a 16 caracteres). |
| `VERSION_MISMATCH` | Versão do jogo desatualizada. Recarregue a página. |
| `RATE_LIMITED` | Muitas ações em pouco tempo. |
| `ROOM_NOT_FOUND` | Sala não encontrada. |
| `ROOM_FULL` | A sala está cheia. |
| `ROOM_IN_BATTLE` | A batalha já começou; você entrou como espectador. |
| `NOT_HOST` | Só o anfitrião pode fazer isso. |
| `WRONG_PHASE` | Ação não permitida agora. |
| `BAD_TEAM_SIZE` | Tamanho de time inválido (1 a 6). |
| `SLOT_TAKEN` | Esta vaga já está ocupada. |
| `SLOT_INVALID` | Vaga inválida. |
| `FLEET_UNKNOWN_CLASS` | Classe de nave desconhecida. |
| `FLEET_CLASS_LIMIT` | Limite de naves desta classe excedido. |
| `FLEET_OVER_BUDGET` | A frota ultrapassa o orçamento. |
| `FLEET_SHIP_COUNT` | A frota precisa ter entre 1 e 20 naves. |
| `FLEET_MISSING` | Monte sua frota antes de ficar pronto. |
| `NOT_ALL_READY` | Nem todos estão prontos. (+ lista) |
| `COUNTDOWN_ABORTED` | Um jogador saiu; contagem cancelada. |

Regras gerais de validação no servidor: mensagem ≤ 8 KB; JSON parse em try/catch; `t` precisa estar em `C2S`; token bucket **20 msg/s, burst 40** por socket (excedeu → `RATE_LIMITED`, 3 vezes em 10 s → fecha o socket); todo campo numérico passa por `Number.isInteger` + faixa; strings `typeof === 'string'` + `length`; nunca confiar em `playerId` vindo do cliente (vem da sessão do socket).

### 2.6 Máquina de estados da sala

```
lobby ──start(host, tudo pronto)──▶ countdown(5s) ──▶ battle ──getResult!=null──▶ results
  ▲                                     │ humano sai                                 │ rematch (todos) / start(host)
  └─────────────────────────────────────┘◀───────────────────────────────────────────┘
```

---

## 3. Fluxo de UI (pt-BR)

Todas as telas são DOM dentro de `#app`; o `<canvas id="arena">` existe só na tela Batalha. Strings centralizadas em `client/i18n.js` (`T.menu.single = 'Um jogador'`).

### 3.1 Menu principal
- Título do jogo, subtítulo "Monte sua frota. Deixe a batalha com a IA."
- Botões: **Um jogador** · **Multijogador** · **Como jogar**.
- Campo "Seu nome" (persistido em `localStorage`), usado em SP (nome do jogador) e MP.

### 3.2 Um jogador — Configuração (`spSetup`)
- **Nível**: 1–10 (botões). Efeito: orçamento do inimigo = `1000 × (0.8 + 0.06·nível)` (nível 10 → 1380) e classes liberadas para bots (nave-mãe só a partir do nível 5). Níveis vencidos ficam marcados (localStorage).
- **Dificuldade**: Fácil / Médio / Difícil (afeta `buildBotFleet` e, se a lente de IA quiser, um multiplicador de "esperteza"/reação).
- **Formato**: 1x1 · 2x2 · 3x3 · 4x4 · 5x5 · 6x6. Em ≥2x2, os aliados são bots ("Seus aliados: 2 bots · Médio"); mostramos a grade de vagas igual ao lobby, só leitura.
- Botão **Montar frota →** leva ao `fleetBuilder` com `{mode:'sp'}`.

### 3.3 Montar frota (`fleetBuilder`) — usada em SP e MP
- **Barra de orçamento** no topo: `Orçamento: 780 / 1000 pts` + barra de progresso que fica vermelha se >100%; contador `Naves: 12 / 20`.
- **Grade de cards** (um por classe): nome, silhueta desenhada em mini-canvas (reutiliza `sprites.js`), custo, chips de stats (Casco, Escudo, Velocidade, Dano/s, Alcance), ícones das habilidades com tooltip ("Pulso EMP: desativa naves inimigas próximas por 2 s"), botões **−  [n]  +**, "máx. 1" quando aplicável.
- **Presets**: `Enxame` · `Encouraçado` · `Equilibrado` · **Auto-completar** (preenche o resto do orçamento) · **Limpar**.
- **Resumo da frota** à direita: lista `3× Fragata`, custo, estimativa simples "Poder de fogo / Resistência" (soma de dano/s e hp — só informativo).
- Rodapé: **Voltar** · **Confirmar frota** (desabilitado se inválida; mostra o motivo, ex.: "Frota ultrapassa o orçamento").
  - SP: Confirmar → cria `config` (seed aleatória ou da URL `?seed=`), bots constroem frotas via `buildBotFleet`, vai para Batalha.
  - MP: Confirmar → `set_fleet`; volta ao Lobby com "Frota enviada ✓".

### 3.4 Multijogador — Entrada e Lobby
- Tela de entrada: "Criar sala" (seletor 1x1…6x6) · "Entrar com código" (input de 4 letras, maiúsculas automáticas). Erros em toast vermelho.
- **Lobby**:
  - Cabeçalho: `Sala **KX7P**` com botão **Copiar código** e **Copiar link** (`?sala=KX7P`, o app abre direto no join), seletor de formato (só host), latência "42 ms".
  - **Grade de vagas**: duas colunas "Time Azul" / "Time Vermelho", `teamSize` linhas. Cada vaga: vazia ("Vaga livre — clique para entrar" / host vê "+ Bot ▾ Fácil/Médio/Difícil"), humano (nome, ✓ frota, ● pronto / ○ aguardando, ⚠ desconectado, coroa no host), bot (nome, dificuldade, botão × para host).
  - Painel "Sua frota": resumo + botão **Montar / Editar frota**; botão **Pronto** (toggle, desativado sem frota).
  - Host: botão **Iniciar** com checkbox "Preencher vagas vazias com bots (Médio)". Tooltip quando desabilitado lista quem falta.
  - Chat simples (opcional) na lateral; espectadores listados abaixo.
  - Countdown: overlay central "A batalha começa em 5…" com frotas reveladas em miniatura.

### 3.5 Batalha (`battle`)
- Canvas ocupa a área central, letterbox 16:9; HUD em DOM sobreposto:
  - Topo: barra de HP do **Time Azul** (esquerda) e **Time Vermelho** (direita), com `naves vivas / total` e percentual de HP agregado; cronômetro `01:23 / 03:00`.
  - Canto esquerdo (SP): **velocidade x1 · x2 · x4** e **Pausar**; MP: indicador "AO VIVO" + latência; estado "Reconectando…" quando necessário.
  - Canto direito: **Registro de eventos** (últimos 6, fade-out): "Fragata de Pedro destruiu Caça de Bot Alfa", "Nave-mãe de Ana ativou Escudo", em cores do time.
  - Botão "Ver nomes" (toggle de rótulos acima das naves, desligado por padrão em 6x6).
- Fim: overlay "Vitória do Time Azul!" / "Empate" por 2 s, depois tela de resultados.

### 3.6 Resultados (`results`)
- Vencedor em destaque + motivo ("Eliminação" / "Tempo esgotado — mais HP restante").
- Tabela por jogador (ordenada por time): Nome · Naves (sobreviventes/total) · Dano causado · Dano recebido · Abates. Linha do próprio jogador destacada.
- Naves sobreviventes desenhadas em miniatura por jogador.
- Botões: SP → **Jogar de novo (mesma frota)** · **Próximo nível** (se venceu) · **Editar frota** · **Menu**. MP → **Revanche** (mostra "2/4 querem revanche") · **Sair da sala**.

### 3.7 Como jogar
Texto curto com 4 passos ilustrados (mini-canvas): orçamento, classes (pequenas rápidas × grandes resistentes), habilidades automáticas, formato dos times. Tabela do catálogo gerada a partir de `CATALOG_LIST`.

---

## 4. Plano de renderização (Canvas 2D)

### 4.1 Câmera, letterbox e HiDPI (`camera.js`)
- Canvas CSS: `width:100%; height:100%` do container 16:9 calculado por CSS (`aspect-ratio: 16/9; max-height: calc(100vh - hud)`).
- `resize()`: `dpr = min(devicePixelRatio, 2)`; `canvas.width = cssW*dpr`; `ctx.setTransform(dpr,0,0,dpr,0,0)`.
- Transformação mundo→tela: `scale = min(cssW/viewW, cssH/viewH)`; `ox = (cssW - viewW*scale)/2` (letterbox automático).
- **Fit-to-fleets**: a cada 250 ms calcula bounding box das naves vivas (+ margem 150 u), limita à `WORLD`, mantém proporção 16:9; alvo `{cx, cy, viewW}`; a câmera atual converge com `lerp(cur, target, 1 - 0.9^dtFrames)` → suave. Zoom mínimo = mundo inteiro; zoom máximo = `viewW ≥ 800` para não "colar" demais. Quando restam poucas naves a câmera aproxima naturalmente (clímax de graça).
- Fundo: estrelas pré-renderizadas num `OffscreenCanvas`/canvas oculto 2400×1350 uma vez (300 pontos com brilho variável), desenhado com `drawImage` sob a transformação da câmera + leve parallax (0.5×).

### 4.2 Sprites procedurais (`sprites.js`)
- Uma `Path2D` por classe, desenhada em coordenadas unitárias apontando para +X, escalada por `radius`:
  - interceptador: triângulo fino; caça: seta com asas; corveta: losango; fragata: hexágono alongado; cruzador: retângulo com proa; encouraçado: octógono largo com "torres" (círculos); nave-mãe: elipse grande com anel; suporte: cruz/círculo.
- Cores: `TEAM_COLORS = [{fill:'#3b82f6', edge:'#bfdbfe'}, {fill:'#ef4444', edge:'#fecaca'}]`. A nave do próprio jogador recebe contorno mais claro (`myTeam`).
- Desenho: `translate(x,y); rotate(a); fill(path); stroke(path)`; se `size ≥ 4` adiciona um pequeno "cockpit". Barra de HP só se `hp < 1000` (mini-retângulo 2 px acima), escudo como arco fino azul-claro ao redor quando `sh > 0`.
- Flags: bit1 (EMP) → desenha "chiado" (traços aleatórios) e cor dessaturada; bit2 (boost) → trail mais longo e brilhante; bit0 (shield up) → bolha.
- Cache: para 6x6 com 240 naves, `Path2D` + `fill/stroke` é ~0.02 ms/nave → ~5 ms/frame no pior caso; aceitável. Se precisar, pré-rasterizar cada classe×time×2 em sprite sheet por nível de zoom (otimização v2).

### 4.3 Trails
- Ring buffer de 8 posições por nave (preenchido a cada frame de render com a posição interpolada). Desenha polyline com alpha decrescente e `lineWidth = radius*0.3`. Sem trail quando a nave está parada (distância < 0.5).

### 4.4 Projéteis, beams e impactos (`effects.js`) — dirigidos por eventos
- `FIRE [1, src, tgt, w]`: cria `VisualProjectile {x,y (pos atual de src), tgt, speed (do catálogo da arma), kind, ttl: range/speed + 0.3s}`; a cada frame move em direção à **posição interpolada atual** do alvo (homing visual). Ao chegar (`dist < tgt.radius`) ou expirar, some. Se o alvo morreu, continua reto por 0.2 s e some. Mísseis: mais lentos, com trail de fumaça (partículas).
- `BEAM [2, src, tgt, w]`: linha de `src` a `tgt` por 120 ms, largura 2 → 0, cor do time, mais um brilho no ponto de impacto.
- `HIT [3, tgt, amount, kind]`: flash branco na nave por 80 ms (`globalCompositeOperation='lighter'`); se `kind=1` (escudo), flash azul em arco; número de dano flutuante opcional (desligado em 6x6).
- `DIE [4, id]`: explosão proporcional ao `size`: 12–40 partículas (velocidade radial, ttl 0.4–1.0 s), anel de choque expandindo, e para `size≥4` um segundo estouro 150 ms depois. A nave some do snapshot naturalmente.
- `ABILITY [5, id, code, tgt]`: `1` escudo → bolha azul expandindo até 1.6·radius que persiste enquanto flag bit0 estiver ligada; `2` EMP → anel roxo expandindo até o raio do EMP em 400 ms; `3` reparo → beam verde pulsante src→tgt por 1 s; `4` boost → chama maior; `5` salva de mísseis → N projéteis visuais em leque; `6` isca → "fantasma" semitransparente.
- `SPLASH [6, x, y, r]`: círculo laranja expandindo até `r` em 300 ms.
- Estruturas: arrays planos com reuso (pool simples) para evitar GC; limite de 2000 partículas (descarta as mais antigas).

### 4.5 Ordem de desenho por frame
```
clear → fundo (estrelas) → trails → beams → naves (mortas não existem) → projéteis → partículas/anéis → overlays (rótulos, barras)
```
HUD é DOM, atualizado a 10 Hz (a cada frame de rede) e não a cada rAF.

### 4.6 Interpolação
Descrita em 1.10. `delayMs = 150` em rede (1,5 intervalos de snapshot; tolera 1 frame perdido), `100` local. Eventos são aplicados **quando o frame que os contém vira o frame "B"** do interpolador (ou seja, atrasados pelo mesmo `delayMs`), para que o flash coincida com o projétil chegando. Na prática: `effects.schedule(event, frame.at + delayMs)`.

### 4.7 Desempenho-alvo
60 fps com 240 naves + 300 projéteis visuais + 1000 partículas em notebook integrado: ~8 ms/frame de draw. Medimos com `performance.now()` e, se a média passar de 14 ms por 2 s, o renderer entra em "modo leve" automaticamente (sem trails, menos partículas, barras só < 50%).

---

## 5. Plano de desenvolvimento e testes

### 5.1 `package.json`
```json
{
  "name": "fleetwars", "type": "module", "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "test": "node --test test/unit/",
    "test:watch": "node --test --watch test/unit/",
    "e2e": "node --test test/e2e/",
    "simulate": "node tools/simulate.js",
    "balance": "node tools/simulate.js --matrix --seeds 200"
  },
  "dependencies": { "ws": "^8.18.0" },
  "devDependencies": { "playwright": "^1.4x" }
}
```
Variáveis: `PORT` (default 8080), `HOST`, `MAX_ROOMS` (default 50), `LOG_LEVEL`.

### 5.2 Testes unitários (`node:test`)
| Arquivo | O que garante |
|---|---|
| `rng.test.js` | mesma seed → mesma sequência; `int/pick` dentro das faixas; `fork` independente. |
| `catalog.test.js` | todo `ShipClass` tem campos obrigatórios, custos > 0, habilidades existem no registro. |
| `fleet.test.js` | `validateFleet`: todos os códigos de erro; presets cabem no orçamento; `autoComplete` nunca estoura. |
| `botFleet.test.js` | cada dificuldade gera frota válida para 1000 seeds; `dificil` gasta ≥ 98% do orçamento; `facil` nunca compra nave-mãe. |
| `sim.determinism.test.js` | `runToEnd(config)` duas vezes → resultados e sequência de eventos **byte-idênticos** (JSON.stringify); também snapshot no tick 500 idêntico. |
| `sim.termination.test.js` | toda batalha termina em ≤ `maxTicks`; 1 nave vs 0 naves termina no tick 1; 6x6 com frotas máximas termina < 3600 ticks em ≥ 95% das seeds (senão: balanceamento/timeout). |
| `sim.invariants.test.js` | após cada tick: hp ∈ [0, max], naves sempre dentro de `WORLD` (ou clamp), `aliveByTeam` bate com a contagem, stats: `Σ damageDealt == Σ damageTaken`. |
| `sim.abilities.test.js` | cada habilidade: dispara quando `canUse`, respeita cooldown, gera evento com o código certo. |
| `snapshot.test.js` | `makeSnapshot` quantiza corretamente; tamanho serializado por nave ≤ 32 bytes. |
| `protocol.test.js` | `validateName`, `isRoomCode`, rejeição de payloads malformados. |
| `room.test.js` | máquina de estados com sessões fake: pick/add bot/ready/start/erros/countdown abort/desconexão 60 s/host migration/rematch. |
| `server.ws.test.js` | sobe servidor em porta 0, dois clientes `ws` reais: criam/entram sala, enviam frotas, `start`, recebem `battle_start`, ≥ 1 `f`, `battle_end`. Timeout 30 s com `maxTicks` reduzido via config de teste. |

### 5.3 `tools/simulate.js`
```
node tools/simulate.js --a enxame --b encouracado --seeds 100 [--budget 1000] [--verbose]
node tools/simulate.js --a "caca:6,fragata:2" --b "cruzador:3" --seeds 50
node tools/simulate.js --matrix --seeds 200        # todos os presets × presets, imprime tabela de win rate
node tools/simulate.js --bots facil,dificil --seeds 100 --teams 3   # 3x3 só de bots
```
Saída:
```
A (enxame) vs B (encouracado) — 100 seeds
  A vence: 54%   B vence: 43%   empate: 3%   média de ticks: 1840 (92 s)   timeouts: 2
  HP restante médio do vencedor: 31%
```
Flags `--json` para scripts de CI e `--dump seed` para gravar `events.jsonl` de uma partida (útil para debugar a IA). O `--matrix` é o instrumento de balanceamento: meta inicial = nenhum par preset×preset acima de 65/35.

### 5.4 E2E com Playwright (`test/e2e/multiplayer.e2e.js`, via `node:test`)
```js
test('dois jogadores jogam uma partida 1x1 até o fim', async () => {
  const server = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: '0', MAX_TICKS_OVERRIDE: '400' } });
  const port = await waitForPortLine(server);           // servidor imprime "listening 12345"
  const browser = await chromium.launch();
  const [a, b] = await Promise.all([browser.newContext(), browser.newContext()]);
  const pa = await a.newPage(), pb = await b.newPage();
  await pa.goto(`http://localhost:${port}/`);
  await pa.fill('[data-test=name]', 'Ana'); await pa.click('text=Multijogador');
  await pa.selectOption('[data-test=team-size]', '1'); await pa.click('text=Criar sala');
  const code = await pa.textContent('[data-test=room-code]');
  await pb.goto(`http://localhost:${port}/?sala=${code}`); await pb.fill('[data-test=name]', 'Bia'); await pb.click('text=Entrar');
  for (const p of [pa, pb]) { await p.click('text=Montar frota'); await p.click('text=Equilibrado'); await p.click('text=Confirmar frota'); await p.click('text=Pronto'); }
  await pa.click('text=Iniciar');
  await expect(pa.locator('[data-test=result-winner]')).toBeVisible({ timeout: 60_000 });
  await expect(pb.locator('[data-test=result-winner]')).toBeVisible();
  const [wa, wb] = await Promise.all([pa.textContent('[data-test=result-winner]'), pb.textContent('[data-test=result-winner]')]);
  assert.equal(wa, wb);
  assert.equal(await pa.evaluate(() => window.__fw.canvasErrors), 0);   // hook de debug exposto só com ?debug
});
test('um jogador: nível 1 fácil 1x1 termina', …)  // usa ?seed=1 e velocidade x4
```
Atributos `data-test` em todos os controles. Expor `window.__fw` (estado do app + contadores) quando `?debug=1`.

### 5.5 Ordem de implementação sugerida (marcos)
1. `shared/` completo + `simulate.js` + testes de determinismo (jogável "no terminal").
2. Cliente SP: fleetBuilder → LocalRunner → renderer → results.
3. Servidor + NetClient + lobby → MP 1x1.
4. Bots em vagas, 6x6, reconexão, revanche.
5. Polimento visual, modo leve, balanceamento via `--matrix`.

---

## 6. Riscos e mitigações

### 6.1 Banda de snapshots em 6x6
Pior caso: 12 jogadores × 20 naves = **240 naves**. Entrada JSON `[123,12345,6789,200,1000,1000,5]` ≈ 32 bytes → **7,7 KB por frame**; a 10 Hz = **77 KB/s por cliente** antes de compressão; eventos somam ~10–20% em picos. Com `permessage-deflate` (muita repetição numérica) espera-se 3–4× → **~25 KB/s por cliente**, ~300 KB/s de saída por sala de 12 (+ espectadores). Em 4G/ADSL fraco isso é limítrofe.
Mitigações, em ordem de aplicação:
1. Já embutido: projéteis fora do snapshot; serialização única por sala; mortos saem do array.
2. **Delta de campos**: `hp/sh/flags` só quando mudam — entrada vira `[id,x,y,a]` (≈18 B) na maioria dos frames; frame-chave completo a cada 2 s para quem acabou de (re)conectar. Reduz ~45%.
3. Reduzir para 8 Hz quando `ships > 150` (cliente interpola igual; `delayMs` sobe para 190).
4. v2: frame binário (`Uint8Array`: id u16, x u16, y u16, a u8, hp u8 (0..255), sh u8, flags u8 = **9 B/nave** → 2,2 KB/frame, 22 KB/s sem deflate).

### 6.2 CPU do servidor com várias partidas
Estimativa por tick com 240 naves: grade espacial O(n) + consultas de vizinhos ~O(n·k) + projéteis ~300 → **~0,8–1,5 ms**; 20 ticks/s ≈ 20–30 ms/s = **2–3% de um core por sala**, mais ~0,5 ms × 10 Hz de `JSON.stringify`. Em um core: ~20 salas 6x6 simultâneas confortáveis; `MAX_ROOMS=50` com salas menores. Mitigações: catch-up limitado e "drop de tempo" no `MatchRunner` (a batalha desacelera em vez de o processo travar); medir `tickMs` e expor em `/health`; v2: `worker_threads` com pool (N = cores − 1), cada worker roda salas e devolve strings prontas de frame via `postMessage` — possível sem mudar o sim por ser puro.

### 6.3 Determinismo de ponto flutuante
`+ − × ÷ sqrt` são IEEE-754 e idênticos em qualquer engine; `Math.sin/cos/atan2/exp` **podem diferir** entre V8/JSC/SpiderMonkey e versões (implementações diferentes de libm). Por isso:
- Multijogador é **servidor-autoritativo**: só o servidor calcula; clientes nunca simulam, só interpolam o que recebem → divergência impossível por construção.
- Single-player: um único processo simula; `seed` reproduz a mesma batalha no **mesmo** browser (bom para "jogar de novo" e para bug reports com seed).
- `simulate.js` e testes rodam em Node: reprodutíveis entre máquinas com mesma versão de Node (fixar `engines` e usar `.nvmrc`).
- Para blindar ainda mais (opcional, barato): o sim só usa `atan2/sin/cos` em `ai.js` para direção desejada; podemos substituir por tabela de 256 ângulos (`ANGLE_SCALE`) e `Math.atan2` por aproximação polinomial própria — aí fica 100% portável. Recomendo deixar como tarefa v2 só se aparecer um caso real (replays entre máquinas).

### 6.4 Throttling de timers em abas em segundo plano
Browsers reduzem `setTimeout`/rAF a 1 Hz (ou param rAF) em abas ocultas; Chrome chega a 1 vez/min após 5 min.
- SP (`LocalRunner`): pausa automática em `visibilitychange` ("Pausado — a batalha continua quando você voltar"); ao voltar, não há catch-up explosivo. Mesmo visível, `n ≤ 8·speed` ticks por frame.
- MP (`NetClient`): o servidor não para. O socket continua recebendo (mensagens não são throttled, só timers), mas o rAF para; ao voltar, `interpolator.reset()` e o cliente pula para o frame mais recente, com `effects.clear()`; a HUD mostra "Você voltou — batalha em andamento". Pings a cada 5 s com `setTimeout` podem atrasar; o servidor só considera "caído" o socket após 30 s sem `ping` **ou** erro do socket (não só ausência de ping).
- Servidor Node não sofre throttling; o `MatchRunner` usa `performance.now()` e `nextAt` para corrigir deriva do `setInterval(10)`.

### 6.5 Outros riscos
- **Batalhas que não terminam** (duas naves de suporte se curando): `maxTicks` + decisão por HP resolve; `sim.termination.test` vigia; a lente de IA deve impedir que suporte seja a única nave viva "fugindo" (ex.: naves sem armas avançam quando são as últimas).
- **Contra-pick por timing no lobby**: frotas dos outros ficam ocultas até `battle_start`; bots `dificil` veem as humanas (é a vantagem deles, documentada em "Como jogar").
- **Abuso**: salas limitadas por IP (5), nomes sanitizados na UI com `textContent` (nunca `innerHTML`), chat com rate limit; sem persistência, então nenhum dado sensível.
- **GC/jank no cliente** com arrays de eventos a 10 Hz: pools em `effects.js`, e o `Map` do interpolador é reaproveitado (atualiza entradas em vez de recriar).
- **Escopo de v1**: sem matchmaking público, sem contas, sem replays persistidos — todos possíveis depois graças ao sim puro + eventos (um replay é só `seed + players`, 1 KB).