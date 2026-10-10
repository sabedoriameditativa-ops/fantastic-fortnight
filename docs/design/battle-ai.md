# Proposta de Design — Battle AI & Simulation

Lens: simulação determinística + IA de batalha. Tudo abaixo é opinativo; onde há escolha, digo por quê e o que arrisca.

---

## 0. Decisões-chave (resumo para o lead)

| Tema | Decisão | Por quê |
|---|---|---|
| Timestep | 20 tps, `dt = 0.05 s`, inteiro `tick` | Simples, barato, 10 snapshots/s cabem em 1 a cada 2 ticks |
| Movimento | "Carro com deriva": heading limitado por `turnRate`, thrust só para frente, arrasto lateral | Dá peso a naves grandes (arco de armas importa), ainda é barato e determinístico |
| Hit resolution | Rolagem **no disparo** (pré-rolada), projétil só "entrega" o resultado no impacto | Zero re-rolagens, projéteis podem ser interceptados (PD) sem alterar RNG order |
| Dano | Escudo → casco; multiplicador por tipo × classe de tamanho; armadura plana no casco; `tracking vs signature` para pequeno-vs-grande | Dois eixos de counter sem tabela gigante |
| IA por nave | **Utility scoring** (sem behavior tree) com perfis por papel; `decide()` a cada N ticks escalonado | Fácil de dar ruído/atraso por dificuldade; BT é overkill para batalha automática |
| Coordenação | `teamThink()` a cada 10 ticks: alocação gulosa de foco com teto de "overkill" + côncava inicial + leash | Evita 40 naves em 1 alvo e evita trickle |
| Dificuldade | Só afeta **frotas de bot**; frotas humanas sempre no nível máximo | Em multiplayer, todo mundo joga com a mesma IA — justo |
| RNG | `mulberry32` seedado, um stream, ordem fixa por `id`; sem `Math.random`, sem `Date.now` | Determinismo testável: mesmo seed ⇒ mesmo hash |
| Snapshot | Binário (`DataView`), 10/s, 9 bytes/nave; eventos em JSON | 500 naves em JSON = ~175 KB/s por cliente; binário = ~45 KB/s |
| Anti-empate | Aos 4:00 "morte súbita" (kiting/cloak desligados, regen zero); aos 5:00 vence maior valor restante | Kiters vs lentos empatam para sempre sem isso |

---

## 1. Modelo de simulação

### 1.1 Unidades, coordenadas, mapa

- Unidade de distância: `u` (1 u ≈ 1 px no zoom 1). Tempo em ticks (`TPS = 20`).
- Eixos: `x` → direita, `y` → baixo (canvas). Ângulos em radianos, `0 = +x`, positivo = horário.
- Mapa: `W = 3000 + 500·P`, `H = 0.75·W`, onde `P` = jogadores por lado (1..6). 1v1 ⇒ 3500×2625; 6v6 ⇒ 6000×4500.
- Spawn: time A no retângulo `x ∈ [0.06W, 0.18W]`, time B em `[0.82W, 0.94W]`, centrados verticalmente. Time B é espelhado (`x' = W − x`, heading `π − h`) — mirror match é literalmente espelhado.
- Bordas: força de retorno suave começando a 100 u da borda; clamp duro na borda.

### 1.2 Entidades

```js
// Ship (struct-of-arrays opcional depois; v1 = array de objetos em ordem de id)
{ id, team, owner, classId, role, sizeClass,     // sizeClass: 0=S 1=M 2=L 3=XL
  x, y, vx, vy, heading, radius, mass,
  hp, hpMax, shield, shieldMax, armor, shieldRegen, lastDamagedTick,
  weapons: [{ def, cooldownUntil }],
  abilities: [{ def, readyAt, activeUntil, pendingCastAt }],
  status: { stunnedUntil, cloakedUntil, bubbleUntil, rallyUntil, boostUntil },
  ai: { targetId, targetSince, assignedId, intent, retreating, thinkOffset },
  targetedBy: 0, allocDps: 0, alive: true }

// Projectile
{ id, kind, team, srcId, dstId, x, y, vx, vy, speed, turnRate, hitRolled, dmg, dmgType, aoe, ttl, hp: 1 }
```

Limites: ≤ 40 naves compradas por jogador, ≤ 700 naves vivas no total (drones param de spawnar no cap), ≤ 400 projéteis vivos (pool; disparo adicional vira hitscan se pool cheio — cosmético apenas).

### 1.3 Movimento

Por nave: `maxSpeed`, `accel`, `turnRate` (rad/s), `lateralDrag = 4.0`.

A IA produz um **intent de movimento** `(desiredDir, desiredSpeed)` (unit vector + 0..maxSpeed). O atuador roda **todo tick**:

```js
function steer(s, dt) {
  const want = intentToDesired(s);          // dir + speed, já com separação e leash somados
  const dAng = angleDiff(atan2(want.y, want.x), s.heading);   // (-π, π]
  s.heading = wrap(s.heading + clamp(dAng, -s.turnRate*dt, s.turnRate*dt));
  const fx = cos(s.heading), fy = sin(s.heading);
  // quanto mais fora de alinhamento, menos acelera (vira antes de acelerar)
  const align = max(0, cos(dAng));
  const targetSpeed = want.speed * (align > 0.3 ? align : 0) * speedMult(s);  // boosts/stuns
  const fwdSpeed = s.vx*fx + s.vy*fy;
  const dv = clamp(targetSpeed - fwdSpeed, -s.accel*dt, s.accel*dt);
  s.vx += fx*dv; s.vy += fy*dv;
  // arrasto lateral (mata deriva)
  const lat = s.vx*(-fy) + s.vy*fx;
  const k = min(1, s.lateralDrag*dt);
  s.vx -= (-fy)*lat*k; s.vy -= fx*lat*k;
  s.x += s.vx*dt; s.y += s.vy*dt;
}
```

**Separação (anti-stack)** — somada ao intent antes de `steer()`, usando o spatial hash:

```
for j in neighbors(s, R = s.radius*3 + 40):
  d = dist; sep = s.radius + j.radius + 12
  if d < sep*1.6:
    w = (1 - d/(sep*1.6))^2 * (j.mass / (s.mass + j.mass))   // leve cede ao pesado
    push += (s.pos - j.pos)/d * w * SEP_GAIN(=1.4)
want.dir = normalize(want.dir * 1.0 + push)           // push pode dominar quando colado
```

**Correção dura de sobreposição** (após integrar): se `d < s.radius + j.radius`, empurrar ambos ao longo da normal proporcionalmente a `mass_other/(mass_i+mass_j)`. Uma passada por tick basta (duas passadas se houver mais de 400 naves vivas é desnecessário; aceitar sobreposições residuais de 1–2 u).

**Evasão por velocidade** (faz kiting/orbit valer a pena): `evasion = evasionBase · (|v| / maxSpeed)`, com `evasionBase` por classe (Interceptador 0.35, Bombardeiro 0.25, M 0.15, L 0.05, XL 0).

### 1.4 Armas

```js
WeaponDef { name, dmg, dmgType /* kinetic|energy|explosive|emp */, cooldown /* ticks */,
            range, arc /* meio-ângulo rad; π = torre 360° */, tracking /* signature ideal, u */,
            accuracy /* 0..1 base */, projectile: null | { speed, homing: bool, turnRate, aoe },
            burst: 1, minRange: 0, targetsProjectiles: false }
```

Regras de disparo (todo tick, por arma, só para o alvo atual da nave — exceção: PD escolhe o projétil/inimigo mais próximo dentro do alcance):

1. `tick >= cooldownUntil`, alvo vivo, não-cloaked, `minRange ≤ d ≤ range`, `|angleDiff(bearingToTarget, heading)| ≤ arc`.
2. Para projéteis lineares (railgun, morteiro): mira em **posição predita** `t.pos + t.vel · (d / speed)`; se o ângulo até ela estiver fora do arco, não dispara.
3. **Rolagem de acerto no disparo**:

```
sizeFactor = clamp((t.radius / w.tracking) ^ 0.7, 0.25, 1.0)      // arma "lenta" sofre contra nave pequena
rangeFactor = d <= 0.8*range ? 1 : 1 - 0.5*(d - 0.8*range)/(0.2*range)   // 1.0 → 0.5 na borda
p = clamp(w.accuracy * sizeFactor * rangeFactor * (1 - t.evasion), 0.05, 0.98)
hit = rng.next() < p
```

4. Hitscan: aplica dano **enfileirado** no mesmo tick; emite `shot` + `hit`/`miss`. Projétil: cria entidade com `hitRolled = hit`; emite `proj`.
5. `cooldownUntil = tick + w.cooldown`. Múltiplas torres = múltiplos `WeaponDef` com offsets de cooldown iniciais (`id*7 % cooldown`) para não disparar sincronizado (visual e também reduz picos de dano).

**Projéteis** (avançam todo tick):
- Homing (torpedo, míssil): gira em direção ao `dst` com `turnRate`; ao ficar a `< dst.radius + 8` → impacto. Se `dst` morreu: continua reto até `ttl`. Interceptável por PD (`hp = 1`).
- Linear (railgun): voa reto até a posição predita; ao chegar (ou passar por qualquer nave inimiga com `d < radius`), impacto se `hitRolled`; senão "miss" visual e some.
- Balístico (morteiro): "aterrissa" no ponto predito após `d/speed` s; dano em área `aoe` em todos os inimigos no raio (o `hitRolled` só vale para o alvo primário; AoE em terceiros sempre acerta com `dmg · (1 − d/aoe)` — barato e legível).
- Impacto AoE emite um `hit` por nave atingida.

### 1.5 Dano

Tipos × alvo:

| Tipo | vs Escudo | vs Casco S | M | L | XL | Extra |
|---|---|---|---|---|---|---|
| kinetic | 0.6 | 1.0 | 1.0 | 1.1 | 1.2 | ignora 0 de armadura |
| energy | 1.3 | 0.8 | 0.8 | 0.8 | 0.8 | — |
| explosive | 0.9 | 0.6 | 0.9 | 1.3 | 1.5 | AoE opcional |
| emp | 2.0 | 0.1 | 0.1 | 0.1 | 0.1 | aplica `stun` (ver habilidade) |

```
applyDamage(t, raw, type, srcId):
  toShield = min(t.shield, raw * MULT[type].shield)
  t.shield -= toShield
  leftover = raw - toShield / MULT[type].shield          // porção crua que vazou
  if leftover > 0:
    hullRaw = leftover * MULT[type].hull[t.sizeClass]
    hull = max(hullRaw * 0.25, hullRaw - t.armor)          // armadura plana, piso 25%
    t.hp -= hull
  t.lastDamagedTick = tick
  emit hit(t.id, round(toShield + hull), type, toShieldFlag)
  if t.hp <= 0: queueDeath(t, srcId)
```

Regen de escudo: `shieldRegen/s` só se `tick − lastDamagedTick ≥ 60` (3 s). Casco não regenera (exceto Nave de Apoio). Morte súbita zera regen.

Dano é **enfileirado** durante o tick e aplicado na fase `applyDamage` — ordem por `(srcId, seq)`. Isso faz "fogo simultâneo" real (duas naves podem se matar no mesmo tick) e dá ordem determinística independente do loop que gerou.

### 1.6 Particionamento espacial

Spatial hash uniforme, `CELL = 256 u` (≈ alcance médio), reconstruído a cada tick (500 naves ⇒ <0.1 ms):

```js
cells = Array(cols*rows) de arrays reutilizados (length = 0 em vez de realocar)
insert: cells[cy*cols+cx].push(id)   // iteração em ordem de id ⇒ cada célula fica ordenada por id
queryCircle(x, y, r, out): varre células do AABB em ordem (cy, cx) crescente, filtra por d² ≤ r²
```

Resultados são determinísticos porque a ordem de inserção é a ordem de id e as células são varridas em ordem fixa. Projéteis vão num segundo hash (só para PD e colisão de railgun). Naves cloaked ficam no hash mas são filtradas por `targetable()`.

---

## 2. IA por nave

### 2.1 Arquitetura

Utility-based em duas camadas:

- **`decide(ship)`** — roda a cada `thinkInterval` ticks (offset `id % thinkInterval` para espalhar carga). Produz `intent`: `{ targetId, moveMode, anchorX, anchorY, desiredRange, casts[] }`.
- **Atuador** — roda todo tick e é só aritmética: converte `intent` + separação + leash em `(desiredDir, desiredSpeed)`; dispara armas no alvo do intent.

Perfis de papel (`role`): `diver`, `kiter`, `brawler`, `escort`, `anchor`, `drone`. Cada classe tem um papel e um vetor de pesos de scoring.

### 2.2 Percepção (barata)

```
candidates = queryCircle(me, me.sensorRange = max(maxRange*1.5, 600)) ∩ inimigos ∩ targetable
            ∪ { me.assignedId (do teamThink), me.targetId }        // sempre considerados
            limitado aos 16 mais próximos + os dois acima
se candidates vazio: candidates = [ inimigo vivo mais próximo via varredura O(n) ]   // "nunca ocioso"
alliesNear = queryCircle(me, 400) ∩ aliados
incoming2s = expectedIncoming(me)   // ver 2.5
```

`targetedBy` e `allocDps` são recomputados a cada tick em O(n) a partir dos intents atuais (zerar, depois `ships[s.ai.targetId].targetedBy++`, `allocDps += s.dpsVs(target)`).

### 2.3 Seleção de alvo

```
scoreTarget(me, t):
  d          = dist(me, t)
  rangeFit   = d <= me.maxRange ? 1 : max(0, 1 - (d - me.maxRange) / me.maxRange)
  dmgMult    = effMult(me.mainWeapon, t)              // tipo×tamanho×sizeFactor, ~0.2..1.6
  killTime   = ehp(t) / max(1, me.dpsVs(t))           // ehp = hp/avgHullMult + shield/shieldMult
  killability= clamp(1 - killTime/20, 0, 1)
  value      = t.cost / 100
  threatRaw  = t.dpsVs(me) / max(1, me.hp + me.shield)
  threat     = threatRaw * (t.ai.targetId == me.id ? 2 : alliesNear.has(t.ai.targetId) ? 1 : 0.5)
  overkill   = clamp((t.allocDps * 3 - ehp(t)) / ehp(t), 0, 1)    // 3 s de dano já alocado > ehp?
  focus      = (min(t.targetedBy, 4) / 4) * (1 - overkill)
  teamPri    = (t.id == me.ai.assignedId) ? 1 : 0
  protect    = (me.role == escort && t.ai.targetId == me.ai.protecteeId) ? 1 : 0
  sticky     = (t.id == me.ai.targetId) ? 0.15 : 0
  bias       = ROLE_BIAS[me.role][t.sizeClass] + (t.role == escort|anchor && me.role == diver ? 0.5 : 0)

  return W.range*rangeFit + W.dmg*dmgMult + W.kill*killability + W.value*value
       + W.threat*threat + W.focus*focus + W.team*teamPri + W.protect*protect + sticky + bias
```

Pesos por papel:

| Papel | range | dmg | kill | value | threat | focus | team | protect |
|---|---|---|---|---|---|---|---|---|
| diver | 0.8 | 1.0 | 0.9 | 0.6 | 0.3 | 0.4 | 0.6 | 0 |
| kiter | 1.2 | 0.8 | 0.7 | 0.4 | 0.9 | 0.6 | 0.8 | 0 |
| brawler | 1.2 | 0.8 | 0.8 | 0.5 | 0.7 | 0.8 | 1.0 | 0 |
| escort | 1.0 | 0.6 | 0.6 | 0.2 | 1.0 | 0.4 | 0.4 | 1.2 |
| anchor | 1.3 | 0.9 | 0.6 | 0.7 | 0.6 | 0.8 | 1.0 | 0 |

`ROLE_BIAS`: bombardeiro +0.8 vs L/XL, −0.5 vs S; interceptador +0.5 vs S/M; destróier +0.4 vs L/XL; artilharia +0.6 vs L/XL; PD/corveta +0.6 vs S.

**Histerese de retarget**: trocar só se `best > current·(1 + hyst) + 0.05`, com `hyst = 0.25`, **ou** se o alvo atual morreu/cloakou/saiu de `1.5·maxRange`, **ou** se `tick − targetSince ≥ 40` (2 s mínimo de compromisso, para não ficar oscilando entre dois alvos equivalentes).

### 2.4 Posicionamento por papel

Saída: `moveMode ∈ {approach, hold, kite, orbit, escortSlot, retreat, formation, idleAdvance}` + ponto/raio. Atuador:

```
intentToDesired(s):
  t = ship(s.ai.targetId); d = dist
  switch s.ai.intent.moveMode:
    approach:  dir = toward(t), speed = max
    hold:      dir = toward(t) (só para virar); speed = d > R*0.7 ? max : 0     // brawler
               torre (arco ≥ 180°): recua a 0.6*max se d < 0.45*R até passar de 0.6*R (banda morta; o heading é a memória)
               anchor: holdAt = max(0.7*R, 0.85*alcance da arma principal); avança a 0.6*max rumo ao centroide inimigo
                       só enquanto estiver atrás do terço da frente da linha (T.frontDist + 60) ou sem linha
    kite:      lo = 0.75*R, hi = 0.95*R   (banda morta: recua abaixo de lo até passar de 0.85*R)
               arma fixa (arco < 180°): só recua de ameaça que consegue deixar para trás pagando a volta para atirar
                       ((speed − t.speed)*cooldown > t.speed*2*(180° − arco)/turnRate); com a arma pronta e inimigo
                       ao alcance fora do arco, vira para ele e atira (se a volta custar ≤ 0.5*cooldown)
               if d < lo: dir = normalize(away(t) + tangent(t)*0.6), speed = max
               elif d > hi: dir = toward(t), speed = max
               else: torre → dir = tangent(t), speed = 0.6*max                    // mantém evasão
                     arma fixa com arco ≥ 80° → espiral 10° dentro do arco (alvo fica no arco)
                     arma mais estreita → parada, de frente para o alvo
    orbit:     dir = normalize(tangent(t) + toward(t)*(d > 0.6*R ? 0.8 : -0.3)), speed = max   // diver
    escortSlot: a = ship(protecteeId); enemyDir = normalize(enemyCentroid - a.pos)
               slot = a.pos - enemyDir*(a.radius + s.radius + 50) + perp(enemyDir)*slotOffset(s)
               dir = toward(slot), speed = min(max, dist(slot)*2)                 // chega e para
               perto do slot, arma fixa pronta com inimigo ao alcance → vira para ele e atira
    backline:  ponto = centroideInimigo + eixo*(T.frontDist + 250)               // 250 u atrás do terço da frente da linha
               se o inimigo mais próximo está além de 0.9*alcance e o carrier o supera em alcance → puxa ≤ 125 u na direção dele
               banda morta de 40 u; ameaça a 200 u → foge
    retreat:   dir = toward(safePoint), speed = max
               arma fixa pronta com inimigo ao alcance fora do arco → vira para ele e atira (volta ≤ 0.5*cooldown)
    formation: dir = toward(formationSlot), speed = min(max, groupSpeed)
    idleAdvance: dir = toward(enemyCentroid), speed = 0.5*max
  // tangent(t) = perpendicular escolhida por paridade de id (metade orbita horário, metade anti-horário → menos colisão)
  // leash: if s.role != diver && dist(s, teamAnchor) > leash: dir = normalize(dir + toward(anchor)*0.8)
  // bordas: + força de retorno
  // + separação (1.3)
```

Mapeamento classe → modo padrão quando engajado: Interceptador/Bombardeiro/Caçador → `orbit`; Fragata/Artilharia/Porta-naves → `kite`; Destróier/Cruzador/Corveta → `hold`; Apoio → `escortSlot`; Nave-mãe → `hold` com `speed ≤ 0.5·max`.

`safePoint` para retreat: posição do aliado de Apoio mais próximo, senão `teamAnchor.pos + (teamAnchor.pos − enemyCentroid)·200`, senão o próprio spawn.

**Retreat** (não para `anchor`, não em Fácil, não em morte súbita, nunca para unidades geradas (cost 0) nem naves tiny de custo < 20 — são descartáveis; larvas com menos de 50 % de casco e inimigo a 250 u mergulham no mais próximo em vez de fugir):
- entra se `hp/hpMax < RETREAT_AT[role]` (diver 0.35, kiter 0.4, brawler 0.25, escort 0.45) **e** há aliado num raio de 600 **e** (a nave regenera casco **ou** `shield < 0.3·shieldMax` — casco sem regeneração só tem o escudo para recuperar; com escudo cheio não há o que recuperar);
- sai se `hp/hpMax > RETREAT_AT + 0.2` (com regeneração) ou `shield ≥ 0.6·shieldMax` (sem), ou nenhum aliado vivo num raio de 600 (sozinho = luta), ou pelo teto de 10 s;
- **toda** saída inicia um cooldown de 15 s sem novo retreat (sem isso uma nave cuja condição de saída já vale no próximo think — escudo cheio, casco baixo — pisca entre retreat e luta a 5 Hz).
- Durante retreat a nave continua atirando em quem estiver no arco (não muda alvo, só move); arma fixa pronta com inimigo ao alcance fora do arco → vira para ele e atira se a volta custar ≤ 0.5·cooldown.

### 2.5 Dano esperado (`expectedIncoming`)

```
expectedIncoming(me, horizon = 2 s):
  sum = 0
  for e in enemiesTargetingMe (mantido pelo recompute por tick: lista invertida por alvo):
    if dist(e, me) <= e.maxRange*1.1: sum += e.dpsVs(me) * horizon
  for p in projectiles where p.dstId == me.id && p.hitRolled: sum += p.dmg * MULT[p.type].hull[me.size]
  return sum
```

`dpsVs(e, t)` é pré-computado por par (classe, classe) numa tabela 12×12 no init (`dmg/cooldown · mult · accuracy · sizeFactor`), então é lookup.

### 2.6 Políticas de habilidade (gatilhos explícitos)

Avaliadas em `decide()`, em ordem; cada `AbilityDef` tem `trigger(ctx) → utility (0 = não)`; casta se `utility ≥ 1` e `ready` (dificuldade adiciona `abilityDelay` e `miscastProb` — ver §3.4). Cast é agendado (`pendingCastAt = tick + delay`) e executado na fase de habilidades; se o alvo/condição sumir até lá, cancela (sem gastar cooldown).

| Habilidade (classe) | Gatilho concreto | Efeito |
|---|---|---|
| **Pós-combustão** (Interceptador, Caçador) CD 12 s, dura 3 s | (a) `moveMode == approach|orbit` e `d > R` e `d < 3R` → chega rápido; (b) `retreating` e `incoming2s > 0.3·hp`; (c) `targetedBy ≥ 3` | `speed ×1.8`, `evasion +0.15` |
| **Salva de torpedos** (Bombardeiro) CD 15 s | alvo com `size ≥ L`, em alcance, `shield/shieldMax < 0.3` **ou** `overkill(t) < 0.5 && ehp(t) > 400`; se ≥ 2 bombardeiros no mesmo alvo, o de menor id dispara primeiro e os outros esperam 10 ticks (concentra salva sem sobreposição de cooldown) | 3 torpedos extras (dmg 90 cada) |
| **Pulso EMP** (Fragata) CD 20 s, raio 250 | `count(inimigos em 250 u) ≥ 3` **ou** `1 inimigo size ≥ L em 250 u com shield/shieldMax > 0.5` **ou** `≥ 2 inimigos atirando em aliado com hp < 0.3` | dano `emp 150` a todos no raio; `stun 1.5 s` em S/M, `0.75 s` em L, `0` em XL (XL só perde escudo) |
| **Rajada antiaérea** (Corveta) CD 10 s, raio 300 | `count(projéteis inimigos homing em 300 u) ≥ 3` **ou** `count(inimigos size S em 220 u) ≥ 3` | destrói todos os projéteis no raio; `dmg explosive 25` em todas as naves S/M no raio |
| **Sobrecarga** (Destróier) CD 18 s | próximo tiro (railgun) com `dmg ×2.5`; gatilho: alvo `size ≥ L` **ou** `dmg·2.5·mult ≥ hp_restante+shield do alvo` (kill garantido se acertar) **e** `p(hit) ≥ 0.6` **e** cooldown da arma ≤ 5 ticks | buff de 1 tiro |
| **Bolha de escudo** (Cruzador) CD 30 s, dura 5 s, raio 300 | `Σ expectedIncoming(aliado em 300 u) ≥ 0.15·Σ hpMax desses aliados` **ou** `≥ 3 aliados no raio com targetedBy ≥ 1` **ou** `Nave-mãe aliada no raio com shield < 0.3` | aliados no raio: dano recebido `×0.5`; emite `cast` com `tx,ty` |
| **Nano-reparo** (Apoio) CD 2 s, alcance 350 | alvo = aliado com menor `hp/hpMax` entre os `< 0.6`, desempate por `cost` maior; se ninguém `< 0.6`, aliado com `shield < 0.5` e `cost` maior (aura já faz regen) ; nunca o próprio salvo se `hp < 0.3` e ninguém mais < 0.5 | cura `+40 hp` instantânea (ou `+60 shield`); feixe visível 0.5 s. Esta é efetivamente a "arma" da nave de apoio |
| **Camuflagem** (Caçador) CD 25 s, dura até 8 s ou até atacar | (a) `targetedBy ≥ 2` **ou** `hp < 0.4`; (b) **ofensivo**: `d(alvo) > 1.3R` e alvo é `escort|kiter|anchor` (cruzar a linha de frente invisível). Decloak automático: ao disparar ou quando `d(alvo) ≤ R·0.9` em (b) | não-alvejável (inimigos retargetam), `speed ×1.2`, 1º tiro após decloak `×1.5` |
| **Lançar drones** (Porta-naves) CD 8 s | `drones vivos < 6` e (engajado **ou** `tick > 100`) e total de entidades < cap | spawna 3 drones (`role drone`: orbit no alvo do porta-naves; `ttl 40 s`) |
| **Barragem** (Artilharia) CD 20 s | cluster inimigo: `≥ 4 inimigos em 150 u` do ponto = média ponderada por cost dos inimigos em alcance (ver `densestPoint`), ponto dentro de `[minRange, range]` | 5 morteiros em sequência (1 por 4 ticks) no ponto predito `cluster.pos + cluster.vel·tempoDeVoo` |
| **Ataque orbital** (Nave-mãe) CD 45 s, raio 180 | `densestPoint` com `≥ 4 inimigos` ou `Σcost ≥ 120` em 180 u, dentro de 800 u | após 1.5 s (telegrafado por evento `cast`), `dmg explosive 300` no raio com queda linear |
| **Comando** (Nave-mãe) CD 40 s, dura 6 s, raio 500 | `≥ 50 % do valor da frota aliada em 500 u` **e** (`Σ allocDps alvos ≥ 0.3·Σ ehp inimigos no alcance` **ou** `≥ 4 aliados engajados`) | aliados no raio `dmg ×1.2`, `cooldown ×0.85` |

`densestPoint(enemies, r)`: para cada inimigo candidato (até 24 mais próximos), conta `Σcost` dos inimigos em `r` dele; o melhor centro vira o ponto; `cluster.vel` = média dos `vel`. O(k²) com k ≤ 24 — ok a cada think.

Habilidades curativas/defensivas ganham `utility` proporcional ao déficit, para que o perfil de dificuldade possa adicionar ruído de forma coerente (ex.: Fácil casta Bolha com `incoming` 0.15 ± 0.5·hpMax ⇒ muitas vezes no momento errado).

---

## 3. Coordenação de time

### 3.1 `teamThink()` — a cada 10 ticks (times escalonados: A em `tick % 10 == 0`, B em `== 5`)

```
teamThink(T):
  ours = alive(T); theirs = alive(enemy(T))
  T.centroid = média ponderada por cost(ours);  E.centroid idem
  T.anchor = Nave-mãe viva ? ela : Porta-naves/Cruzador de maior cost ? ele : centroid virtual
  T.engaged = exists (s in ours, e in theirs): dist(s,e) <= s.maxRange*1.1
  T.phase = !T.engaged && tick < 1200 ? 'advance' : 'engage'   // 60 s para engajar; depois 'engage' força idleAdvance

  // ---- alocação de foco (gulosa, com teto de overkill) ----
  for e in theirs: e.allocDps = 0
  order = ours sorted by (ROLE_PRIORITY[role], -maxRange, id)   // long range primeiro: artillery, destroyer, cruiser, anchor, kiter, brawler, diver, escort, drone
  for s in order:
    cands = 8 inimigos mais próximos de s dentro de s.maxRange*1.3 (hash), ∪ top-3 globais por value/ehp se cands vazio
    best = argmax over cands of
       (e.cost / ehp(e)) * effMult(s, e) * proximity(s, e)      // proximity = 1 - clamp(d/(1.3R), 0, 0.8)
       * (saturado(e) ? 0.3 : 1.0)                              // saturado = e.allocDps*2 ≥ ehp(e): já tem dano para matar em 2 s
       * (e.ai.targetId é aliado nosso com hp < 0.4 ? 1.5 : 1)   // defende quem está sendo focado
    // limite de foco por valor: um candidato saturado só é escolhido se NENHUM candidato não-saturado existe
    // (o dano "transborda" para o próximo alvo em vez de 8-10 naves empilharem num casco de 36 ehp)
    s.ai.assignedId = best.id;  best.allocDps += s.dpsVs(best)
  T.focusTargets = top-3 de theirs por allocDps/ehp
  // frente da linha: T.frontDist = distância ao centroide inimigo da nave no primeiro terço das naves de linha
  // (compradas, não diver/carrier/anchor) ordenadas da mais próxima; carriers ficam atrás dela e o anchor não a ultrapassa

  // ---- proteção ----
  for cada escort s: s.ai.protecteeId = aliado de maior cost em 500 u (Nave-mãe > Porta-naves > Cruzador > Artilharia), senão T.anchor
  for cada support s: s.ai.protecteeId = nave média+ da linha (brawler/kiter/escort/striker) mais perto do centroide da linha,
                      buscada no time inteiro — nunca outro support nem uma tiny (dois Véus escoltando um ao outro derivam
                      para longe da batalha); sem ela, o aliado não-support de maior cost em 500 u; senão T.anchor
  // ---- leash ----
  T.leash = T.phase == 'advance' ? 350 : 900
  T.groupSpeed = min maxSpeed entre brawlers/anchor vivos (fase advance)
```

A alocação é uma **sugestão** (`teamPri` no scoring individual). Uma nave ameaçada ou com um kill fácil na frente ainda desvia. Em "Difícil" o peso `W.team` sobe; em "Fácil" `teamPri` é 0 (sem foco).

### 3.2 Formação inicial (côncava)

Na fase `deploy` (antes do play) as naves são posicionadas por slot determinístico; na fase `advance` elas mantêm os slots relativos ao `anchor` e avançam a `groupSpeed`:

```
slots(T):
  front  = [cruiser, destroyer, corvette]  → arco de raio Rf = 300 + 15·n_front, ângulos espalhados em ±60° em torno da direção ao inimigo, ordenados por id
  flank  = [interceptor, bomber, hunter]   → dois grupos a ±80°..±110°, raio Rf+100 (metade de cada lado por paridade de id)
  mid    = [frigate, artillery]            → arco Rf − 200, ±40°
  rear   = [support, carrier]              → Rf − 350, ±25°
  anchor = mothership                      → centro (Rf − 450); se não houver, o centro é virtual
```

Transição `advance → engage`: quando `T.engaged`. Divers soltam imediatamente (orbit/approach); brawlers/kiters ficam em `formation` até **ter alvo dentro de 1.1·R** ou até 3 s após o primeiro engajamento (evita a linha ficar parada enquanto só os divers lutam). Após 60 s sem engajamento (ex.: dois times kiters), `phase = engage` força `idleAdvance`.

### 3.3 Cadência e anti-jitter

- `thinkInterval` por dificuldade (abaixo); decisões escalonadas por `id % interval`.
- Histerese 25 % + compromisso mínimo 2 s (§2.3).
- `teamThink` só muda `assignedId` se o novo alvo render ≥ 1.3× o score do atual (mesma ideia).
- Modo de movimento tem histerese própria: `kite` troca entre faixas `lo/hi` com banda morta (0.75R–0.95R), `retreat` com +0.2 para sair.
- Tangente de órbita fixa por paridade de id (não alterna).

### 3.4 Dificuldade (só para frotas de bot)

| Knob | Fácil | Normal | Difícil | Insano |
|---|---|---|---|---|
| `thinkInterval` (ticks) | 16 | 8 | 5 | 4 |
| `scoreNoise σ` (somado a cada score) | 0.6 | 0.25 | 0.08 | 0 |
| `randomTargetProb` por think | 0.30 | 0.10 | 0 | 0 |
| `abilityDelay` (ticks após gatilho) | 20 | 8 | 2 | 0 |
| `abilityMiscastProb` (ignora gatilho verdadeiro) | 0.30 | 0.10 | 0 | 0 |
| `abilityNoise` (nos limiares, fração) | ±0.5 | ±0.2 | ±0.05 | 0 |
| `W.team` (foco) | 0 | 0.5× | 1× | 1× |
| retreat | off | on | on | on |
| formação / leash | off (trickle: `idleAdvance` desde o tick 0) | leash 1200 | leash 900 | leash 900 |
| kiting | off (kiters viram `hold`) | on | on | on + predição de posição em `kite` |
| expectedIncoming | só `targetedBy·avgDps` | completo | completo | completo |
| bot de montagem de frota | aleatório dentro do orçamento | composição balanceada fixa | counter-pick contra classes do oponente visíveis | counter-pick |

Ruído: `noise = σ · (u1 + u2 + u3 − 1.5) · 2` (soma de uniformes ≈ gaussiana; sem `log/cos` ⇒ barato e sem dependência de `Math` transcendentais). Humanos em multiplayer: perfil "Difícil" fixo (ou "Insano"; escolher um e documentar — recomendo **Difícil**, e manter Insano como teto para bots). Não dar bônus de stats ao Insano; só IA melhor (justo e testável).

---

## 4. Determinismo e desempenho

### 4.1 Regras de determinismo

1. RNG: `mulberry32(seed)` (ou `xoshiro128**`), **um único stream** em `state.rng`; nunca `Math.random`; a ordem de consumo é fixa pela ordem de fases e pela iteração por `id` crescente. Qualquer sub-sistema novo que precise de RNG consome do mesmo stream na sua fase.
2. Sem `Date.now`, `performance.now`, `setTimeout` dentro do engine. Tempo = `state.tick`.
3. Iteração: arrays em ordem de `id`; `Map`/`Set` só se a inserção for em ordem determinística (ids crescentes). Nenhuma iteração sobre `Object.keys` de chaves não-numéricas que dependam de ordem de construção fora do engine.
4. Mortes aplicadas em fase própria; ids nunca reutilizados; novos ids (drones, projéteis) de um contador em `state`.
5. Floats: `+ − × ÷ sqrt` são IEEE-754 bit-exatos entre engines. `Math.sin/cos/atan2` **não são garantidos** cross-engine (V8 vs JSC/SpiderMonkey). Como servidor (Node/V8) e cliente (Chromium/V8) rodam V8, e em multiplayer o cliente nem simula, aceito `Math.*` na v1. **Risco**: replays/ hash entre engines diferentes. Mitigação pronta: `mathfast.js` com tabela de 4096 entradas para sin/cos e `atan2` por aproximação polinomial — trocar depois sem mexer no engine.
6. `hashState(state)`: FNV-1a 32-bit sobre `Float64Array` com `[tick, ...por nave em ordem de id: x, y, vx, vy, heading, hp, shield]` lida como bytes via `Uint8Array`. Bit-exato, não quantizado.
7. O engine é um módulo puro: `createBattle(config, seed) → state`; `step(state) → { events }`; `snapshot(state) → ArrayBuffer`. Zero importações de DOM ou Node.

### 4.2 Orçamento de CPU (alvo: ≤ 8 ms/tick com 600 entidades em Node, ≤ 15 ms no browser)

| Fase | Custo | Nota |
|---|---|---|
| rebuild hash | O(n) | arrays reutilizados |
| `targetedBy`/`allocDps` | O(n) | — |
| `teamThink` | O(n · 8) a cada 10 ticks | — |
| `decide` | O(n/interval · (16 cands + habilidades)) | com interval 5 ⇒ ~120 decides/tick |
| steer + separação | O(n · k), k ≈ 6–12 vizinhos | hash com `CELL 256` |
| overlap fix | O(n · k) | 1 passada |
| armas | O(n · w) com w ≤ 4 | só o alvo atual; PD faz 1 query de raio 200 |
| projéteis | O(p) + PD queries | pool, cap 400 |
| dano/mortes | O(hits) | fila |

Tabelas pré-computadas no init: `dpsVs[classA][classB]`, `effMult[weapon][class]`. Sem alocação por tick nas hot paths (reutilizar arrays de query via `out` param).

Single-player: rodar o engine num **Web Worker** (mesmo módulo) com `postMessage` de snapshot/eventos — mantém o render a 60 fps mesmo em 6v6 e, de bônus, o cliente consome os dados **exatamente** pela mesma interface que no multiplayer (`SnapshotSource`). Se Worker complicar a v1, main thread com acumulador é aceitável (sim ≤ 15 ms a cada 50 ms).

### 4.3 Saída: snapshots + eventos

**Snapshot binário** (a cada 2 ticks = 10/s; keyframe completo a cada 40 ticks para quem entra atrasado — na v1 sem late join, todo snapshot já é "completo" para naves vivas, então keyframe = mesmo formato + lista de mortos acumulada):

```
header: u32 tick | u16 nShips | u16 nProj
por nave (10 bytes): u16 id | i16 x·2 | i16 y·2 | u8 heading(0..255 = 0..2π) | u8 hp% | u8 shield% | u8 flags
   flags bits: 0 cloaked, 1 stunned, 2 bubble, 3 rally, 4 boost, 5 retreating, 6 overcharged, 7 reserved
por projétil (8 bytes): u16 id | i16 x·2 | i16 y·2 | u8 heading | u8 kind
```

600 naves + 200 projéteis ≈ 7.6 KB × 10/s = 76 KB/s por cliente; com `permessage-deflate` cai para ~30–40 KB/s. Precisão 0.5 u é invisível.

**Eventos** (JSON, batch por snapshot, arrays posicionais):

```
["shot",  tick, srcId, dstId, weaponIdx, hit(0|1)]        // hitscan: traçador + spark/miss
["proj",  tick, projId, srcId, dstId, kind]               // nasce projétil (posição vem no snapshot)
["pend",  tick, projId, outcome(0 miss|1 hit|2 shotdown)] // projétil termina
["hit",   tick, dstId, amount, type, toShield(0|1)]       // número flutuante; cor por tipo
["aoe",   tick, x, y, radius, type]                       // explosão visual (barragem, orbital, flak)
["heal",  tick, srcId, dstId, amount]
["die",   tick, id, killerId]
["cast",  tick, srcId, abilityId, targetId|-1, x, y]      // telegrafos (orbital usa x,y + delay)
["spawn", tick, id, team, classId, x, y, heading, ownerId]
["status",tick, id, flagsAdded, flagsRemoved]             // redundante com flags do snapshot; útil para SFX
["phase", tick, team, 'advance'|'engage'|'suddenDeath']
["end",   tick, winnerTeam(-1 empate), reason('wipe'|'timeout'), remainingValue[2]]
```

Cliente: buffer de 2 snapshots (~200 ms de atraso), lerp em `x, y`, lerp angular em `heading`, eventos disparados quando o tempo de render cruza o `tick` do evento. Mortes: a nave some do snapshot ⇒ cliente mantém o último estado e toca a explosão no evento `die`.

Interface comum: `SnapshotSource { onSnapshot(buf), onEvents(arr), start(), stop() }` com `LocalSource` (Worker/engine in-process) e `WsSource`.

---

## 5. Pseudo-código

### 5.1 Loop principal

```js
export function step(state) {
  const ev = state.events; ev.length = 0;
  state.tick++;
  const { tick, ships, rng } = state;

  rebuildHash(state);                          // naves e projéteis vivos
  recomputeTargeting(state);                   // targetedBy, allocDps, listas "quem mira em mim"

  if (tick % 10 === 0) teamThink(state, 0);
  if (tick % 10 === 5) teamThink(state, 1);
  if (tick === SUDDEN_DEATH_TICK) enterSuddenDeath(state, ev);

  for (const s of ships) if (s.alive && !isStunned(s) && (tick + s.ai.thinkOffset) % s.ai.thinkInterval === 0)
    decide(state, s);                          // consome rng (ruído/dificuldade) em ordem de id

  for (const s of ships) if (s.alive) {
    tickStatus(s, tick);                       // expira buffs/cloak/stun
    executePendingCasts(state, s, ev);         // casts agendados cujo delay venceu (re-valida gatilho)
  }

  for (const s of ships) if (s.alive) { computeDesired(state, s); steer(s, DT); }
  resolveOverlaps(state);
  clampToArena(state);

  for (const s of ships) if (s.alive && !isStunned(s)) fireWeapons(state, s, ev);   // rng: rolagens de acerto
  advanceProjectiles(state, ev);               // impactos → fila de dano
  applyDamageQueue(state, ev);                 // ordenada; mortes enfileiradas
  regenAndAuras(state);                        // escudo, aura do Apoio
  processDeaths(state, ev);                    // alive=false, drones órfãos ttl, eventos "die"
  checkVictory(state, ev);                     // wipe / timeout

  return ev;
}
```

### 5.2 `decide()`

```js
function decide(state, me) {
  const P = state.profiles[me.owner];                  // knobs de dificuldade
  const T = state.teams[me.team];
  const cands = gatherCandidates(state, me);           // §2.2 (nunca vazio enquanto há inimigo vivo)
  const incoming = expectedIncoming(state, me, 2);

  // --- alvo ---
  let cur = ship(me.ai.targetId), curScore = -Infinity;
  if (cur && targetable(cur) && dist(me, cur) <= 1.5*me.maxRange) curScore = scoreTarget(me, cur, T) + noise(P, state.rng);
  let best = cur, bestScore = curScore;
  for (const e of cands) {
    if (e === cur) continue;
    const sc = scoreTarget(me, e, T) + noise(P, state.rng);
    if (sc > bestScore) { best = e; bestScore = sc; }
  }
  const committed = cur && state.tick - me.ai.targetSince < 40 && curScore > -Infinity;
  const switchOk = !cur || curScore === -Infinity || (!committed && bestScore > curScore * 1.25 + 0.05);
  if (P.randomTargetProb > 0 && state.rng.next() < P.randomTargetProb) { best = cands[(state.rng.next()*cands.length)|0]; }
  if (switchOk && best !== cur) { me.ai.targetId = best.id; me.ai.targetSince = state.tick; }
  const t = ship(me.ai.targetId);

  // --- retreat (com histerese) ---
  if (P.retreat && me.role !== 'anchor' && !state.suddenDeath) {
    const frac = me.hp / me.hpMax, th = RETREAT_AT[me.role];
    if (!me.ai.retreating && frac < th && (T.hasSupport || me.shield < 0.2*me.shieldMax) && alliesWithin(me, 600) > 0) me.ai.retreating = true;
    else if (me.ai.retreating && (frac > th + 0.2 || me.shield > 0.6*me.shieldMax || alliesWithin(me, 600) === 0)) me.ai.retreating = false;
  }

  // --- modo de movimento ---
  const I = me.ai.intent;
  if (me.ai.retreating)               { I.moveMode = 'retreat'; I.point = safePoint(state, me); }
  else if (T.phase === 'advance' && P.formation && me.role !== 'diver') { I.moveMode = 'formation'; I.point = formationSlot(T, me); }
  else if (!t)                        { I.moveMode = 'idleAdvance'; }
  else switch (me.role) {
    case 'diver':   I.moveMode = dist(me,t) > me.maxRange ? 'approach' : 'orbit'; break;
    case 'kiter':   I.moveMode = P.kiting ? 'kite' : 'hold'; break;
    case 'brawler': I.moveMode = 'hold'; break;
    case 'escort':  I.moveMode = ship(me.ai.protecteeId) ? 'escortSlot' : 'hold'; break;
    case 'anchor':  I.moveMode = 'hold'; I.speedCap = 0.5; break;
    case 'drone':   I.moveMode = 'orbit'; break;
  }

  // --- habilidades ---
  for (const ab of me.abilities) {
    if (state.tick < ab.readyAt || ab.pendingCastAt) continue;
    const u = ab.def.trigger({ state, me, t, T, incoming, cands, P });   // 0 = não; ≥1 = sim
    if (u >= 1 && state.rng.next() >= P.abilityMiscastProb)
      ab.pendingCastAt = state.tick + P.abilityDelay;                   // 0 ⇒ casta ainda neste tick
  }
}
```

### 5.3 Exemplo de `trigger` (Bolha de escudo)

```js
trigger({ state, me, T, P }) {
  const allies = queryAllies(state, me, 300);
  let inc = 0, hpSum = 0, underFire = 0, motherLow = false;
  for (const a of allies) { inc += expectedIncoming(state, a, 2); hpSum += a.hpMax; if (a.targetedBy) underFire++; if (a.role==='anchor' && a.shield < 0.3*a.shieldMax) motherLow = true; }
  const th = 0.15 * (1 + P.abilityNoise * (state.rng.next()*2 - 1));
  return Math.max(inc / (hpSum * th), underFire / 3, motherLow ? 1 : 0);
}
```

---

## 6. Roster (11 classes + drone)

Orçamento: **500 pts por jogador**, máx. 1 Nave-mãe por jogador, máx. 40 naves. Nomes de exibição em pt-BR; `classId` em inglês.

| classId | Nome | Custo | Tam | HP | Esc | Arm | Vel | Acel | Giro | Raio | Papel | Arma principal (dmg / cd ticks / alcance / arco / tracking / acc) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| interceptor | Interceptador | 10 | S | 60 | 30 | 0 | 320 | 400 | 4.0 | 6 | diver | Canhão auto: kinetic 8 / 4 / 220 / 30° / 6 / 0.80 |
| bomber | Bombardeiro | 14 | S | 80 | 40 | 2 | 240 | 300 | 3.0 | 7 | diver | Torpedo: explosive 90 / 80 / 350 / 45° / 20 / 0.90, homing 180 u/s |
| corvette | Corveta | 18 | M | 180 | 120 | 4 | 200 | 200 | 2.5 | 10 | escort | Flak: explosive 12 (aoe 40) / 6 / 260 / 180° / 7 / 0.75 + PD (mira projéteis) |
| frigate | Fragata | 22 | M | 160 | 200 | 2 | 220 | 220 | 2.5 | 10 | kiter | Laser de pulso: energy 22 / 10 / 420 / 60° / 10 / 0.85 |
| hunter | Caçador furtivo | 40 | M | 200 | 100 | 4 | 260 | 300 | 3.0 | 9 | diver | Canhão de rajada: kinetic 45 / 20 / 260 / 40° / 10 / 0.90 |
| support | Nave de Apoio | 30 | M | 220 | 220 | 4 | 180 | 180 | 2.0 | 11 | escort | Nano-reparo (cura, §2.6) + aura: aliados em 250 u regen escudo ×1.5 |
| destroyer | Destróier | 40 | L | 500 | 300 | 10 | 140 | 120 | 1.2 | 16 | brawler | Railgun: kinetic 110 / 50 / 700 / 20° / 16 / 0.85, linear 900 u/s |
| artillery | Artilharia | 45 | L | 380 | 200 | 8 | 110 | 100 | 1.0 | 16 | kiter | Morteiro: explosive 70 (aoe 80) / 60 / 900 (mín 250) / 360° / 20 / 0.70 |
| cruiser | Cruzador | 70 | L | 900 | 600 | 14 | 120 | 100 | 1.0 | 20 | brawler | 2× Torre pesada: energy 40 / 15 / 520 / 360° / 14 / 0.85; 2× PD kinetic 6 / 3 / 200 / 360° / 5 / 0.70 |
| carrier | Porta-naves | 100 | XL | 1200 | 800 | 16 | 90 | 60 | 0.6 | 28 | kiter | 2× PD; drones (abaixo) |
| mothership | Nave-mãe | 220 | XL | 3000 | 2000 | 25 | 70 | 40 | 0.4 | 40 | anchor | 2× Feixe: energy 120 / 30 / 650 / 360° / 24 / 0.90; 4× PD |
| drone | Drone | — | S | 40 | 0 | 0 | 300 | 400 | 4.0 | 5 | drone | kinetic 6 / 4 / 180 / 60° / 6 / 0.75; ttl 40 s |

Regen de escudo/s: S 6, M 10, L 15, XL 25. Sensor: `max(1.5·R, 600)`.

Como cada habilidade faz a IA interessante (resumo do §2.6):
- **Interceptador**: Pós-combustão para mergulhar/escapar; viés para caçar Apoio e kiters atrás da linha (a linha de frente precisa de Corvetas/PD).
- **Bombardeiro**: torpedos interceptáveis ⇒ Corveta/Flak contra-ataca; a salva coordena entre bombardeiros (menor id primeiro).
- **Fragata**: EMP decide entre "vários pequenos" vs "um grande com escudo cheio" — stun abre janela para Destróier/Bombardeiro.
- **Corveta**: reativa (projéteis/pequenos no raio) e posicionamento de escolta ⇒ naturalmente protege capitais.
- **Destróier**: Sobrecarga só quando `p(hit)` alta e alvo grande/kill garantido — IA de "finalização".
- **Cruzador**: Bolha por dano esperado — exige o `expectedIncoming`, que também alimenta retreat e cloak.
- **Apoio**: cura por prioridade (menor hp, maior valor) e escolta o mais valioso ⇒ alvo prioritário dos divers (loop de counters).
- **Caçador**: cloak defensivo e ofensivo (atravessa a linha invisível e abre no alvo mole).
- **Porta-naves**: produção contínua; drones usam o alvo do porta-naves (foco gratuito).
- **Artilharia**: `densestPoint` + predição ⇒ pune formações apertadas (contra-incentivo ao leash curto).
- **Nave-mãe**: Orbital telegrafado 1.5 s (divers rápidos escapam, lentos não) e Comando quando a frota está junta — recompensa coesão.

Balanceamento: os números acima são **ponto de partida**; a ferramenta de balanceamento é o harness headless (§7) rodando a matriz classe×classe por custo igual e a composição-vs-composição por 200 seeds. Esperar 2–3 rodadas de ajuste.

---

## 7. Testes

### 7.1 Unitários (`node:test`, engine puro)

- `rng`: mesma seed ⇒ mesma sequência de 10k valores; distribuição em [0,1) (média ≈ 0.5 ± 0.01).
- `angleDiff/wrap`: casos nas bordas ±π.
- `steer`: nave com `turnRate 1 rad/s` não gira mais de `0.05 rad` por tick; nunca excede `maxSpeed` (+ boost); parada completa com `desiredSpeed 0` em `≤ maxSpeed/accel` s.
- `separation`: 50 naves no mesmo ponto ⇒ após 100 ticks nenhuma sobreposição > 2 u; nenhuma sai da arena.
- `spatialHash.queryCircle` ≡ força bruta para 1000 pontos aleatórios × 50 queries (mesmo conjunto, mesma ordem por id).
- `hitChance`: tabela de casos (tracking 20 vs raio 6 ⇒ `sizeFactor = 0.25` clamp; na borda do alcance ⇒ ×0.5; evasion 0.35 a `maxSpeed`).
- `applyDamage`: energy 100 em escudo 50 ⇒ escudo 0 e vazamento `(100 − 50/1.3)·0.8 − armor`; kinetic vs armadura ≥ dano ⇒ piso 25 %; emp em XL não stuna.
- Projétil homing com `turnRate` alto sempre impacta alvo parado; `pend` com `outcome 2` quando Flak destrói; railgun pré-rolado `miss` nunca aplica dano mesmo cruzando o alvo.
- `scoreTarget`: (a) alvo em alcance > fora; (b) `overkill = 1` zera `focus`; (c) bomber prefere XL a S com tudo igual; (d) histerese: score 1.2× não troca, 1.3× troca; (e) compromisso 2 s.
- Cada `trigger` isolado com cenários montados à mão (ex.: EMP com 2 inimigos ⇒ 0, com 3 ⇒ ≥ 1; Bolha com `incoming` 14 % ⇒ < 1, 16 % ⇒ ≥ 1; Nano-reparo escolhe menor hp% e desempata por custo; Camuflagem com `targetedBy 2` ⇒ casta).
- `teamThink`: 10 destróieres vs 1 fragata + 1 cruzador ⇒ no máximo `ceil(ehp/ (3·dps))` alocados à fragata, resto no cruzador.
- Codec de snapshot: `encode(decode(buf))` bit-idêntico; heading round-trip erro ≤ 2π/256.

### 7.2 Headless (simulação completa, Node)

- **Determinismo**: mesma config + seed ⇒ `hashState` idêntico no tick 100, 1000 e final; também idêntico se `step()` for chamado em dois processos (sem estado global). Seeds diferentes ⇒ hashes diferentes.
- **Mirror match**: composição fixa espelhada, 200 seeds, cada dificuldade: taxa de vitória do time A em `50 % ± 7 %` (binomial 2σ); desempenho simétrico mesmo com spawn espelhado (se falhar, há viés de ordem de iteração — ex.: time A sempre decide primeiro ⇒ corrigir alternando ordem por tick ou aceitar como "viés de iniciativa" documentado).
- **Nunca ocioso**: a cada tick com inimigos vivos, toda nave viva não-stunada tem `targetId` válido **ou** `moveMode ∈ {approach, idleAdvance, formation, retreat}`; e `|v| > 0` ou está em alcance do alvo. Contador de "ticks ociosos" = 0.
- **Habilidades castadas**: em 1v1 500 pts com uma de cada classe, cada `abilityId` aparece em ≥ 1 evento `cast` em ≥ 90 % das seeds (Orbital pode não disparar se batalha curta — checar ≥ 60 %).
- **Terminação**: 100 % das batalhas terminam até `6000` ticks (5 min) com `end`; nenhuma excede o cap.
- **Dificuldade monotônica**: mesma frota, Insano vs Fácil ≥ 85 % vitórias; Difícil vs Normal ≥ 65 %; Normal vs Fácil ≥ 65 % (200 seeds cada).
- **Counters existem**: 10 Bombardeiros (140) vs 2 Destróieres (80) + 2 Fragatas (44) ≈ custo igual ⇒ resultado dentro de 30–70 % (nenhuma classe inútil); matriz 12×12 custo-igual: nenhuma célula fora de 15–85 % (sinal de balance; é um teste "soft", rodado como script de relatório, não como gate de CI).
- **Perf**: 6v6 com 600 entidades, 2000 ticks em Node 22 ⇒ média `≤ 8 ms/tick` (p99 ≤ 20 ms); zero alocações crescentes (heap após warmup estável ± 10 %).
- **Invariantes por tick** (modo debug): `hp ≤ hpMax`, `shield ∈ [0, shieldMax]`, posições dentro da arena, `targetedBy` = recontagem, ids únicos, `rng` consumido só dentro de `step`.
- **Snapshot/eventos**: toda nave que morre tem exatamente um `die`; todo `proj` tem um `pend`; eventos com `tick` não-decrescente; ids em eventos existem no snapshot anterior ou num `spawn`.

### 7.3 E2E (Playwright)

- Carregar `index.html`, montar frota via UI, clicar Jogar, esperar `end` ⇒ tela de resultado em pt-BR; sem erros no console.
- Dois contextos de browser num lobby 1v1 contra o servidor `ws`: ambos recebem o mesmo `tick` final e o mesmo vencedor (determinismo observável do servidor).

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Balanceamento consome tempo | Harness de matriz + relatório; números iniciais acima são plausíveis mas não calibrados |
| Empates por kiting/cloak | Morte súbita aos 4:00 (kite→hold, cloak impossível, regen 0), timeout 5:00 por valor restante |
| Clumping/"bola" de naves em capitais | Separação com peso por massa + órbita por paridade de id + `slotOffset` na escolta |
| Trickle de divers morrendo sozinhos | Formação até engajamento; divers só soltam quando `T.engaged` (não antes) |
| `Math.sin/cos` cross-engine | Irrelevante na v1 (servidor autoritativo; SP roda num engine só); `mathfast.js` plugável depois |
| Projéteis + PD explodem CPU | Pool 400, PD faz 1 query de raio; demais armas hitscan |
| Bandwidth em 6v6 | Snapshot binário 10 bytes/nave + deflate; eventos agregados por snapshot; opcional 8/s se precisar |
| Viés de iniciativa (time A decide antes) | Escalonar `teamThink` (0/5) e verificar no mirror test; se houver viés, alternar ordem de `decide` por paridade de tick |
| Drones ilimitados | Cap global 700 entidades + ttl 40 s + máx. 6 por porta-naves |
| Jitter de alvo/modo | Histerese 25 %, compromisso 2 s, bandas mortas em kite/retreat |