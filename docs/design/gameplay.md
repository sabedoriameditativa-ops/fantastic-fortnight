# Design Proposal — Gameplay Depth & Balance
**Lens:** ship roster, counter web, fleet-building, victory rules, single-player ladder/difficulty, balancing methodology.
All numbers are a tuned-by-reasoning first pass; Section 7 defines the sim harness that must confirm/adjust them. Every mechanic below is expressed so it can live in the shared deterministic engine (pure data, seeded RNG, 20 ticks/s = `DT = 0.05 s`).

---

## 0. Core combat model (the few rules everything hangs on)

Keep the rule set tiny and orthogonal; depth comes from combinations, not from a big type-matrix.

| Mechanic | Rule | Why |
|---|---|---|
| **World units** | `u`. Map 1800 u wide; height = `max(1000, 300·teamSize + 200)`. Speeds in u/s, ranges in u. | Fits a 16:9 canvas at ~0.6 px/u for 1v1; renderer scales. |
| **Signature (`sig`)** | Each ship has a size `sig` (1 = interceptor … 12 = Mothership). | Single scalar drives "accuracy vs small targets". |
| **Hit roll** | `P(hit) = clamp(target.sig / weapon.sigRes, 0.05, 1.0)` rolled with the seeded RNG. Hitscan: rolled at fire. Projectile: rolled at impact (so dodge/evasive counts and shots can fizzle if target dies in flight). | One formula gives the whole big-guns-miss-small-ships web. |
| **Shield** | Absorbs damage first, no armor applied. Regenerates `regen` HP/s only after **4.0 s** without taking damage. | Rewards focus fire and alpha; punishes trickle damage. |
| **Armor** | Hull damage per hit = `max(dmg × 0.25, dmg − armor)`. | Flat reduction makes pea-shooters useless vs capitals *after* the shield drops; 25 % floor avoids immunity. |
| **Projectiles** | Missiles/torpedoes are `interceptable`; a Point-Defense (PD) turret in range gets one intercept attempt per cooldown with chance `pdIntercept`. Projectiles homing on a dead target fizzle. | Creates the Corvette/PD counter to Bombers/Cruiser missiles and a real "overkill" cost. |
| **Damage aura / buffs** | Stack additively per source type, multiplicatively across types. | Predictable, easy to tune. |
| **Visibility** | Global except cloaked ships (`Fantasma`), which are untargetable unless inside an enemy `detectRadius` or within 1 s after firing. | Only one stealth rule. |
| **Sudden death** | From **t = 120 s**: all damage ×(1 + 0.2 × floor((t−120)/15)), shield regen disabled. Hard stop at **180 s**. | Guarantees match length 60–150 s typical. |
| **Collisions** | No damage; soft separation steering only (radius ∝ sig). | Avoid physics rabbit-holes; determinism-friendly. |

`EHP = hull + shield` (used in cost-efficiency checks and tiebreaks). Reference ratios the roster is built on: **~20 EHP per point, ~0.5–0.7 raw DPS per point**, so a 200-pt fleet (≈4 000 EHP, ≈120 DPS) with ~50 % effective accuracy/positioning dies in ~70–120 s.

---

## 1. Ship roster (12 classes)

### 1.1 Stat table

| # | Name (pt-BR / EN) | Role | Cost | Hull | Shield / regen | Armor | Speed | Turn °/s | sig | Cap/player |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Interceptador** / Interceptor | Swarm, flanker | 4 | 40 | 20 / 4 | 0 | 220 | 360 | 1 | 16 |
| 2 | **Caça** / Fighter | Swarm, generalist | 6 | 70 | 30 / 5 | 0 | 170 | 270 | 1.5 | 12 |
| 3 | **Bombardeiro** / Bomber | Anti-capital | 10 | 90 | 40 / 4 | 1 | 130 | 150 | 2 | 8 |
| 4 | **Fantasma** / Phantom | Stealth assassin (backline) | 15 | 120 | 60 / 6 | 1 | 160 | 200 | 2 | 4 |
| 5 | **Corveta** / Corvette | Anti-swarm, point defense | 12 | 180 | 80 / 6 | 2 | 120 | 120 | 3 | 6 |
| 6 | **Fragata** / Frigate | Line ship, shield support | 18 | 300 | 150 / 8 | 3 | 100 | 90 | 4 | 5 |
| 7 | **Reparadora** / Tender (Repair ship) | Healer | 22 | 320 | 200 / 10 | 3 | 95 | 80 | 5 | 3 |
| 8 | **Destróier** / Destroyer | Long-range sniper | 26 | 380 | 180 / 8 | 3 | 90 | 70 | 5 | 4 |
| 9 | **Cruzador** / Cruiser | Heavy line / missiles | 34 | 550 | 300 / 10 | 5 | 80 | 60 | 6 | 3 |
| 10 | **Porta-naves** / Carrier | Drone platform | 42 | 700 | 300 / 8 | 6 | 60 | 40 | 8 | 2 |
| 11 | **Encouraçado** / Battleship | Capital brawler | 58 | 1200 | 500 / 12 | 8 | 55 | 35 | 9 | 2 |
| 12 | **Nave-Mãe** / Mothership | Flagship, aura, EMP | 90 | 2200 | 900 / 15 | 10 | 40 | 25 | 12 | 1 |
| – | *Drone* (not purchasable) | spawned by 10/12 | 0 | 25 | 0 | 0 | 200 | 400 | 0.8 | 8 per Carrier, 4 per Mothership |

EHP/pt: Interceptor 15, Fighter 17, Bomber 13, Phantom 12, Corvette 22, Frigate 25, Tender 24, Destroyer 21.5, Cruiser 25, Carrier 24, Battleship 29, Mothership 34. Capitals are intentionally the most EHP-efficient; they pay for it with armor-irrelevant torpedoes, low speed/turn and being huge targets (`sig`).

### 1.2 Weapons

`cd` = cooldown s; `DPS` = dmg/cd × turrets (before hit chance/armor). `HS` = hitscan, `PJ` = projectile (speed u/s), `INT` = interceptable by PD.

| Ship | Weapon(s) | Type | Dmg | cd | Range | sigRes | Raw DPS | Notes |
|---|---|---|---|---|---|---|---|---|
| Interceptor | Laser de pulso ×1 | HS | 5 | 0.5 | 120 | 1 | 10 | Hits anything; armor floor neuters it vs capitals (5 vs armor 8 → 1.25). |
| Fighter | Canhão automático ×1 | HS | 7 | 0.5 | 150 | 1.5 | 14 | |
| Bomber | Torpedo ×1 | PJ 160, INT, homing | 90 | 6.0 | 300 | 6 | 15 | 17 % vs Interceptor, 100 % vs sig ≥ 6. |
| Phantom | Lança de plasma ×1 | HS | 45 | 3.0 | 140 | 3 | 15 | **×2 damage on first shot after decloak** (ambush). |
| Corvette | Canhão flak ×1 | HS AoE r=30 | 8 | 1.0 | 180 | 1 | 8 per target | Hits every enemy (incl. drones) within 30 u of the aim point. |
| Corvette | PD ×2 | — | — | 0.5 | 100 | — | — | `pdIntercept = 0.7` per attempt vs INT projectiles; also shoots drones (dmg 4, sigRes 1) when no projectiles. |
| Frigate | Torre laser ×2 | HS | 10 | 0.8 | 220 | 2.5 | 25 | |
| Tender | Feixe de reparo ×1 | beam | heals 25 hull/s | — | 160 | — | — | Targets most valuable (cost×missing-HP) ally in range. No weapon. |
| Destroyer | Canhão de trilho ×1 | HS | 90 | 3.0 | **420** | 6 | 30 | Longest range in game; kites. |
| Destroyer | PD ×1 | — | 4 | 0.5 | 100 | 1 | 8 | weak self-defense |
| Cruiser | Torre média ×2 | HS | 14 | 1.0 | 260 | 3 | 28 | |
| Cruiser | Lançador de mísseis ×1 | PJ 220, INT, homing | 40 | 4.0 | 350 | 4 | 10 | |
| Carrier | PD ×2 | — | 4 | 0.5 | 120 | 1 | 16 | `detectRadius = 150` (sees Phantoms). |
| Carrier | Drones | spawn | 1 drone / 4 s up to 8 | — | — | — | ≈ 8 × 6 = 48 | Drone: laser dmg 3, cd 0.5, range 100, sigRes 1; die with carrier. |
| Battleship | Torre pesada ×4 | HS | 30 | 1.5 | 320 | 6 | 80 | 33 % vs Bomber, 17 % vs Interceptor. |
| Battleship | PD ×2 | — | 4 | 0.5 | 120 | 1 | 16 | prioritises projectiles over drones/small. |
| Mothership | Torre média ×6 | HS | 14 | 1.0 | 280 | 3 | 84 | |
| Mothership | PD ×4 | — | 4 | 0.5 | 140 | 1 | 32 | `detectRadius = 200` |
| Mothership | Drones | spawn | 1 / 5 s up to 4 | — | — | — | ≈ 24 | |
| Mothership | **Aura de comando** | passive | +10 % damage, +2 armor to allies within 250 u | — | — | — | — | Does not stack with a second Mothership on the same team (teams of 2+ may have several; cap by *player*). |

### 1.3 Signature abilities

The engine executes abilities; AI decides *when* using the trigger listed (the `conditional` policy). `onCooldown` policy fires as soon as any legal target exists.

| Ship | Ability (pt-BR / EN) | Effect | Dur | CD | AI trigger (conditional policy) |
|---|---|---|---|---|---|
| Interceptor | **Pós-combustor** / Afterburner | +80 % speed, +50 % turn | 3 s | 12 s | (a) assigned target > 200 u away, or (b) shield = 0 and hull < 50 % → use while disengaging. |
| Fighter | **Manobra Evasiva** / Evasive maneuvers | Incoming `P(hit)` ×0.5 | 3 s | 15 s | Shield = 0 **and** ≥ 1 enemy currently targeting me. |
| Bomber | **Salva Dupla** / Double salvo | Next shot launches 2 torpedoes (no extra cd) | one shot | 20 s | Target `sig ≥ 6` and (target shield ≤ 25 % or target is the team focus). Always at first shot of the battle. |
| Phantom | **Ocultação** / Cloak | Starts cloaked; reveals on firing; re-cloaks after 6 s with no firing *and* no damage taken. Cloaked: untargetable unless within an enemy `detectRadius`. | — | 6 s re-cloak | Not a cast; the AI's job is **target choice** while cloaked: approach Tender > Carrier > Bomber > Destroyer, open fire only within 140 u for the ambush ×2. |
| Corvette | **Rajada de Flak** / Flak burst | Flak cd 1.0 → 0.33 | 3 s | 18 s | ≥ 3 enemies with `sig ≤ 2` (or ≥ 4 drones) within 180 u. |
| Frigate | **Projetor de Escudo** / Shield projector | +120 temporary shield (decays after duration) to all allies within 150 u | 6 s | 25 s | ≥ 2 allies (or 1 ally with cost ≥ 34) within radius with shield < 40 %. |
| Tender | **Nanoenxame** / Nanite swarm | Heals 60 hull instantly + 10 hull/s to all allies within 180 u | 5 s | 30 s | Σ missing hull of allies within radius > 300. |
| Destroyer | **Tiro Perfurante** / Piercing shot | Next railgun shot: ignores shield and armor, +50 % dmg (135 to hull) | one shot | 20 s | Target has `sig ≥ 5` and shield > 50 % of max, **or** target hull ≤ 135 (guaranteed kill). |
| Cruiser | **Salva de Mísseis** / Missile barrage | Fires 6 missiles (dmg 25 each, INT) at up to 6 *distinct* targets in 350 u | — | 25 s | ≥ 3 enemies in range; prefers targets without PD cover (no enemy Corvette within 100 u of them). |
| Carrier | **Lançamento de Emergência** / Emergency launch | Instantly spawns 6 drones (temporary cap 12) | — | 40 s | At `t = 3 s`, then whenever active drones ≤ 2 and an enemy is within 400 u. |
| Battleship | **Canhão Principal** / Spinal cannon | 1.5 s charge (ship must keep facing within 10°), then 400 dmg HS, range 450, sigRes 8 | — | 30 s | Enemy with `sig ≥ 6` whose shield ≤ 30 % or hull ≤ 400 (kill shot), within 450 u and inside front 60° cone. |
| Mothership | **Pulso Eletromagnético** / EMP pulse | Enemies within 300 u: shield set to 0, shield regen locked 6 s; ships with `sig ≤ 2` and drones stunned (no move/fire) 2 s | — | 45 s | ≥ 4 enemy ships within 300 u, **or** an enemy with cost ≥ 42 within 300 u with shield > 50 %. |

### 1.4 Counter web

Three macro-categories: **Enxame** (swarm: Interceptor, Fighter, drones), **Linha** (line: Corvette, Frigate, Destroyer, Cruiser), **Capital** (Carrier, Battleship, Mothership) plus two **specialists** (Bomber = anti-capital, Phantom = anti-support) and one **support** (Tender).

```
   Enxame  ──beats──▶  Bomber, Destroyer, Tender, Phantom(once revealed)
   Corvette ─beats──▶  Enxame, drones, missiles/torpedoes (PD)
   Frigate / Cruiser ─beats──▶ Corvette, Bomber, Phantom
   Destroyer ─beats──▶ Frigate, Cruiser, Corvette, all Capitals (outranges everything)
   Bomber ─beats──▶  Cruiser, Carrier, Battleship, Mothership
   Carrier ─beats──▶ Enxame (drones), Phantom (detect)
   Battleship ─beats──▶ Enxame (PD + armor), Frigate, Cruiser, Corvette
   Phantom ─beats──▶ Tender, Bomber, Destroyer, Carrier-without-escort
   Tender  = multiplier for Linha/Capital; dies to Enxame/Phantom
   Mothership = anchor; EMP wrecks Enxame + shield-heavy fleets; dies to Bomber+Destroyer focus
```

Intended **class-vs-class win rates at equal points** (target matrix used by the balance harness, row = attacker; `C` = counter 70–90 %, `c` = soft 60–70 %, `=` 40–60 %, `x` = countered):

| row \ col | Int | Fig | Bom | Pha | Cor | Fri | Ten* | Des | Cru | Car | BS | MS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Interceptor | = | x | C | c | x | = | C | C | = | x | x | x |
| Fighter | c | = | C | c | x | = | C | c | = | x | x | x |
| Bomber | x | x | = | x | x | x | C | = | C | C | C | C |
| Phantom | x | x | C | = | x | x | C | C | = | x | = | = |
| Corvette | C | C | C | C | = | x | C | x | x | = | x | x |
| Frigate | = | = | C | C | C | = | C | x | x | = | x | x |
| Destroyer | x | x | = | x | C | C | C | = | C | C | C | c |
| Cruiser | = | = | x | = | C | C | C | x | = | = | x | x |
| Carrier | C | C | x | C | = | = | C | x | = | = | x | x |
| Battleship | C | C | x | = | C | C | C | x | C | C | = | x |
| Mothership | C | C | x | = | C | C | C | c | C | C | C | = |

\*Tender is tested as "Tender + reference escort" vs "same escort + equal points of X" (see §7).

Sanity arithmetic (hand check, no abilities):
- *Destroyer (26) vs 6 Interceptors (24):* swarm does 6×10 = 60 DPS to the 180 shield (3 s), then hull 5−3 = 2 per hit → 24 DPS → 380 hull in 16 s. Destroyer railgun 17 % hit → one kill per ~18 s, PD 8 DPS → one per 7.5 s; combined ≈ 1 kill per 5.5 s → loses after killing ~3. **Swarm wins** ✔.
- *Battleship (58) vs 14 Interceptors (56):* shield 500 falls in ~4 s; hull takes 1.25/hit → 35 DPS → 34 s. BS kills one interceptor every ~1.9 s (turrets 17 % + 2 PD) → swarm DPS collapses, **BS wins** ✔ (armor + PD is the capital's swarm answer).
- *Battleship (58) vs 6 Bombers (60):* opening Double Salvo = 12 torpedoes = 1 080 → shield gone + 580 hull. Remaining 620 hull at (90−8)×6/6 s = 82 DPS ≈ 8 s; BS kills a bomber every ~5 s (33 % hit, PD busy shooting torpedoes at 70 %, i.e. ~2 of 6 torpedoes per volley intercepted). **Bombers win ~65 %** ✔; adding one Corvette (12) next to the BS flips it — composition matters.
- *Corvette (12) vs 3 Interceptors (12):* flak hits all three when clustered → all dead ≈ 8 s; interceptors need ≈ 13 s. **Corvette wins ~65–70 %**, lower if swarm AI keeps 35 u spacing (it will try; see §6.3) ✔.

---

## 2. Fleet building

### 2.1 Budget

| Context | Budget per player |
|---|---|
| Multiplayer default ("Padrão") | **200** |
| Multiplayer options | "Escaramuça" 120 · "Padrão" 200 · "Guerra Total" 300 (host picks; same for all) |
| Single-player | Level-defined (§4), Mothership unlocks at level 8 |

Budget is **per player, flat across team sizes** (a 6v6 is 1 200 pts per side). Reason: everyone brings their own fleet; a 1v1 and a 6v6 player have identical building decisions. The map grows in height (300 u lane per player) so density stays constant.

Hard limits (protect performance and prevent degenerate spam):
- Max **32 purchased ships per player** (drones excluded). Worst case 6v6: 384 purchased + ≤ 120 drones per side ⇒ ~1 000 entities — fine for a spatial-hash engine at 20 Hz; flag for the Playwright perf test.
- Min 1 ship; **unspent points are allowed** but the UI warns ("Você tem X pontos sobrando").
- Per-class caps from §1.1 (Mothership 1, Battleship 2, Carrier 2, …). Caps are **per player**, so a 3-player team can field 3 Motherships (aura doesn't stack).
- Bots filling empty slots use the same budget and the same builders as the single-player AI (§4.3) at the room's difficulty.

### 2.2 Validation (shared module, used by client UI, server and SP)

```js
validateFleet(fleet, rules) -> { ok, errors[] }
  totalCost <= rules.budget
  count(ships) <= 32
  for each class: count <= CATALOG[class].cap
  every class in rules.allowedClasses   // SP unlock gating
```

### 2.3 Deployment layout

Teams spawn on opposite sides, Team A facing +x, Team B facing −x (mirror by `x → W − x`). Each player owns a horizontal **lane** of height 300 u, lanes stacked and centered vertically. Inside the lane, ships are placed in **columns by size class**, back to front:

| Column | x offset from own edge | Classes | Spacing in y |
|---|---|---|---|
| 0 Rear | 90 | Carrier, Tender | even spread |
| 1 Capital | 160 | Mothership, Battleship | even spread |
| 2 Heavy line | 240 | Cruiser, Destroyer | even spread |
| 3 Line | 310 | Frigate, Corvette | even spread |
| 4 Screen | 380 | Bomber, Phantom (Phantom starts at lane edge ±y, flanking) | even spread |
| 5 Vanguard | 440 | Fighter, Interceptor | 2 rows if > 8 ships, 35 u spacing |

Ordering within a column is by ship id (deterministic). The initial distance between vanguards is ≈ 920 u, capitals ≈ 1 480 u ⇒ swarm contact at ~2.5 s, capital contact at ~12 s. Out-of-bounds: soft push-back force toward the map.

### 2.4 Example 200-pt archetypes (also the AI's template set)

| Template (pt-BR) | Composition | Cost | Idea |
|---|---|---|---|
| **Enxame** | 16 Interceptor, 12 Fighter, 2 Corvette | 160 (+ 1 Frigate + 1 Corvette → 190) | overwhelm, flank backline |
| **Linha de Batalha** | 1 Battleship, 2 Frigate, 2 Corvette, 1 Tender, 2 Fighter | 58+36+24+22+12 = 152 → + 2 Destroyer = 204 → swap a Destroyer for 2 Fighters = 190 | balanced, the "reference fleet" |
| **Artilharia** | 4 Destroyer, 2 Frigate, 1 Tender, 4 Fighter | 104+36+22+24 = 186 (+2 Int = 194) | kite at 420 u |
| **Carga de Torpedos** | 8 Bomber, 2 Corvette, 1 Frigate, 1 Tender, 6 Fighter | 80+24+18+22+36 = 180 (+ 5 Int = 200) | anti-capital |
| **Frota-Mãe** | 1 Mothership, 2 Corvette, 1 Frigate, 1 Tender, 4 Fighter, 4 Int | 90+24+18+22+24+16 = 194 | anchor + aura |
| **Porta-naves** | 2 Carrier, 1 Tender, 2 Frigate, 2 Corvette, 1 Phantom | 84+22+36+24+15 = 181 (+3 Int = 193) | drone attrition |
| **Caçadores** | 4 Phantom, 3 Destroyer, 2 Fighter, 1 Corvette | 60+78+12+12 = 162 (+ 2 Frigate = 198) | backline assassination |

---

## 3. Victory, time limit, tiebreak

- **Win:** every enemy *purchased* ship destroyed (drones don't count). Both sides wiped on the same tick ⇒ draw.
- **Clock:** sudden death at 120 s (§0), hard stop at **180 s**.
- **Tiebreak at 180 s:** `V_team = Σ_i cost_i × (hull_i + shield_i) / (maxHull_i + maxShield_i)` over surviving ships. Higher `V` wins. If `|V_A − V_B| ≤ 0.05 × max(V_A, V_B)` → second key: total damage dealt; if still within 5 % → draw.
- **Match length target:** median 70–120 s, p95 < 160 s (checked in §7).
- Battle result event: `{ winner, reason: 'elimination'|'tiebreak'|'draw', t, stats per player (damage dealt/received, kills, value lost) }` — the post-battle screen uses it and it is also what the balance harness aggregates.

---

## 4. Single-player

### 4.1 Levels ladder (15 levels)

Budgets are *base*; the difficulty multiplier (§4.2) scales the **enemy** budget only. "Unlocks" are what the player may buy from that level on (ships unlock when the level is first *reached*, so you can always answer the new threat). The enemy builder is given its own allowed list so new enemy classes appear one level *before* the player gets them (teaching by contact).

| Lv | Name (pt-BR) | Player budget | Enemy budget | Player unlocks (cumulative) | Enemy fleet | Special rule |
|---|---|---|---|---|---|---|
| 1 | Primeiro Contato | 40 | 32 | Int, Fig | 5 Int, 2 Fig | tutorial tips overlay |
| 2 | Patrulha | 60 | 55 | + Corvette | 6 Fig, 1 Cor, 3 Int | — |
| 3 | Escolta | 80 | 80 | + Frigate | 2 Fri, 2 Cor, 4 Int | — |
| 4 | Bloqueio | 100 | 100 | + Bomber | 1 Fri, 4 Bom, 1 Cor, 6 Int | enemy introduces torpedoes |
| 5 | **Chefe: Destróier Renegado** | 110 | 100 | + Destroyer | 2 Des, 1 Fri, 1 Cor, 4 Fig | enemy Destroyers have +25 % hull |
| 6 | Cinturão de Asteroides | 120 | 125 | + Tender | 1 Cru… no: 2 Des, 1 Ten, 2 Cor, 6 Fig | — |
| 7 | Emboscada | 130 | 135 | + Phantom | 3 Pha, 1 Ten, 2 Fri, 1 Cor, 4 Int | enemy Phantoms start 300 u closer |
| 8 | Linha de Frente | 150 | 150 | + Cruiser | 2 Cru, 2 Fri, 1 Ten, 1 Cor, 4 Fig | — |
| 9 | Ninho de Drones | 160 | 165 | + Carrier | 2 Car, 1 Fri, 2 Cor, 1 Ten, 4 Int | — |
| 10 | **Chefe: Encouraçado** | 170 | 170 | + Battleship | 1 BS, 2 Cor, 1 Ten, 2 Fri, 4 Fig | enemy BS Spinal cannon cd 20 s |
| 11 | Frota Mista | 180 | 185 | — | counter-pick (§4.3) | — |
| 12 | Cerco | 190 | 200 | + Mothership | 1 MS, 2 Cor, 1 Ten, 1 Fri, 6 Fig | — |
| 13 | Guerra de Atrito | 200 | 215 | — | counter-pick, 2 enemy bots (1v2!) each 110 | first 1-vs-many |
| 14 | Armada | 200 | 230 | — | optimizer (§4.3) | — |
| 15 | **Chefe: Nave-Mãe Suprema** | 200 | 250 | — | 1 MS + optimizer for the rest | enemy MS +30 % EHP, EMP cd 30 s |
| ∞ | Modo Infinito (after 15) | 200 | 200 + 10·(n−15) | all | optimizer | endless, leaderboard by level |

Enemy "builder" per level is a hand-authored list for 1–10 (fixed, so levels feel designed) and algorithmic from 11 on. Three stars per level: win / win with ≥ 50 % value remaining / win in under 60 s or without losing a capital or mothership (as shipped: SPEC §4.1, `client/util/progress.js`).

### 4.2 Difficulty selector — exact knobs

All knobs live in one `AIProfile` object attached per **team** inside the deterministic sim (so replays/multiplayer bots are reproducible). Human fleets **always** get `EXPERT` ship-AI: the user asked for ships to fight "as intelligently as possible"; difficulty only handicaps the computer.

```js
AIProfile = {
  budgetMul,        // enemy budget multiplier
  builder,          // 'random' | 'template' | 'counter' | 'optimizer'
  reactionTicks,    // how often a ship re-evaluates target/behavior
  targeting,        // 'nearest' | 'score'
  focusFire,        // share team focus target
  overkillAvoid,    // subtract incoming damage ledger
  abilityPolicy,    // 'never' | 'onCooldown' | 'conditional'
  abilityDelayTicks,// extra latency before a ready ability is used
  kiting,           // ranged ships hold distance
  retreat,          // damaged ships fall back to Tender / rear
  spacing,          // swarm keeps anti-flak spacing
  aimNoise          // extra miss chance added to P(hit) (0..0.3)
}
```

| Knob | Fácil | Normal | Difícil | Especialista |
|---|---|---|---|---|
| `budgetMul` | 0.80 | 1.00 | 1.15 | 1.30 |
| `builder` | random (valid, no Mothership) | template (random archetype) | counter-pick vs player's fleet | optimizer (sim-based) |
| `reactionTicks` | 20 (1.0 s) | 10 (0.5 s) | 5 (0.25 s) | 2 (0.1 s) |
| `targeting` | nearest | score | score | score |
| `focusFire` | off | on (max 6 ships per focus) | on | on + alpha-sync (ranged hold fire ≤ 0.5 s to volley) |
| `overkillAvoid` | off | off | on | on |
| `abilityPolicy` | onCooldown with 50 % chance to skip each check | onCooldown | conditional | conditional |
| `abilityDelayTicks` | 20 | 10 | 4 | 0 |
| `kiting` | off | on (Destroyer only) | on | on |
| `retreat` | off | off | on (hull < 35 %, Tender alive) | on |
| `spacing` | off | on | on | on |
| `aimNoise` | 0.15 | 0.05 | 0 | 0 |

Why these: Easy must *feel* beatable with a sloppy fleet (small budget, wasted shots, no focus). Normal is "fair fight with a decent fleet". Hard sees your fleet (in SP the computer builds **after** you confirm) and picks counters. Expert additionally searches, and its ships are exactly as smart as yours — only the budget is unfair, and the UI says so ("+30 % de orçamento inimigo").

### 4.3 Enemy fleet builders

- **random:** repeat `pick uniform among affordable allowed classes under caps` until nothing fits or 32 ships.
- **template:** pick a §2.4 archetype, scale: buy the template's ships in order, repeating the list until budget exhausted; if the budget is smaller than the template, buy in priority order (capitals first) and skip what doesn't fit.
- **counter:** compute the player's point share per category `s = {swarm, bomber, line, capital, support, stealth}`; for each template `T` compute `score(T) = Σ_c s_c × M[T][c]` with the hand-authored matrix

| M | swarm | bomber | line | capital | support | stealth |
|---|---|---|---|---|---|---|
| Enxame | 0 | +1 | +0.5 | −1 | +1 | +0.5 |
| Linha de Batalha | +0.5 | 0 | 0 | 0 | 0 | 0 |
| Artilharia | −1 | +0.5 | +1 | +1 | 0 | −0.5 |
| Carga de Torpedos | −1 | 0 | 0 | +1.5 | 0 | −0.5 |
| Frota-Mãe | +1 | −1 | +0.5 | 0 | 0 | +0.5 |
| Porta-naves | +1 | −0.5 | 0 | −0.5 | 0 | +1 |
| Caçadores | −0.5 | +1 | 0 | +0.5 | +1.5 | 0 |

  pick argmax (ties by seeded RNG), then scale like `template`.
- **optimizer:** start from the `counter` result; hill-climb 12 iterations: each iteration proposes 6 mutations (swap one ship for another affordable class, add/remove), evaluates each with **3 seeded headless battles vs the player's fleet** (same engine, `maxTicks = 3600`), keeps the best by `(winrate, mean V_remaining)`. Budget: 12×6×3 = 216 sims; at ~10× real-time headless ≈ 200 × 0.1 s ... **risk:** could be ~20–60 s in the browser. Mitigate: run in a Web Worker with a progress bar ("Inimigo planejando…"), cap wall-clock at 8 s and return best-so-far; precompute nothing. Also use it offline (§7) to find dominant strategies.

---

## 5. Multiplayer specifics that affect balance

- Room: host picks team size (1–6 per side), budget preset, bot difficulty for empty slots. Fleet-building phase is **simultaneous and blind** (humans can't see the enemy fleet) with a 120 s timer; players lock in ("Pronto"); unlocked players at timeout get their current (validated) fleet, or a `template` fleet if empty.
- Bots in multiplayer never use `counter`/`optimizer` (blind phase must be fair) — they use `template` at the chosen difficulty's ship-AI knobs.
- Side bias: Team A always on the left; the harness (§7.1) must show ≤ 2 % side advantage. If the mirrored layout shows bias, the fix is to randomize side by seed, not to tweak stats.

---

## 6. Ship AI (what "as intelligently as possible" means in code)

All of this is in the shared engine so the server and single-player produce identical results. Decisions run every `reactionTicks` per ship (staggered by `shipId % reactionTicks` to spread CPU).

### 6.1 Target selection (score-based)

```
for each enemy t visible to me and within (range + 1.5·mySpeed·5):
  pHit     = clamp(t.sig / w.sigRes, 0.05, 1)
  dmgEff   = t.shield > 0 ? w.dmg : max(w.dmg·0.25, w.dmg − t.armor)
  ehpLeft  = t.hull + t.shield − incoming[t]            // damage ledger of shots/projectiles in flight + 1 s of allies' DPS already on t
  if ehpLeft <= 0 and overkillAvoid: continue
  killEff  = pHit · dmgEff / max(ehpLeft, 1)            // damage per shot as fraction of what's left
  value    = t.cost / max(ehpLeft, 1)                   // points destroyed per EHP
  threat   = dpsOf(t vs me) / myEHP + roleBonus         // roleBonus: Tender +0.3, Carrier +0.2 for swarm/Phantom; Bomber +0.3 for Corvette; sig≥6 +0.3 for Bomber/Destroyer
  focus    = (t == teamFocus[myTeam] and focusFire) ? 0.3 : 0
  tte      = max(0, dist − w.range) / mySpeed            // seconds to get in range
  score    = 2·killEff + 1·value·100 + 1·threat + focus − 0.15·tte
hysteresis: switch only if best.score > current.score · 1.25
teamFocus = enemy with highest Σ(value) among ships already targeted by ≥ 2 allies, recomputed every 1 s
```

Role-specific targeting overrides: Corvette prefers `sig ≤ 2` and drones, and its PD always prefers projectiles; Bomber/Destroyer ignore `sig ≤ 2` unless nothing else is in range; Phantom uses the backline priority (Tender > Carrier > Bomber > Destroyer > any) and never fires outside 140 u while cloaked; Battleship Spinal cannon uses its own trigger.

### 6.2 Movement behaviors (per role)

| Behavior | Ships | Rule |
|---|---|---|
| `brawl` | Interceptor, Fighter, Corvette, Frigate, Cruiser, Battleship, Mothership | move to `0.8·range` of target; strafe orbit if faster than target (orbit at 0.7·range, tangential). |
| `kite` | Destroyer, Bomber, Cruiser (vs faster targets) | hold `0.9·range`; if nearest threat closes within `0.6·range` and is faster, back away along the away vector at full speed while still firing (turrets fire independent of heading; railgun needs ±30° facing). |
| `screen` | Corvette (when a capital exists) | stay within 120 u of the highest-cost ally; engage anything that comes within 180 u. |
| `backline` | Tender, Carrier | stay 200 u behind the friendly centroid along the enemy direction; flee from any enemy within 150 u (except when retreating would leave the map). |
| `stalk` | Phantom | while cloaked go wide (±200 u lateral), approach priority target from behind, decloak at 140 u. |
| `retreat` | any with `retreat` on | hull < 35 % and Tender alive → move toward Tender until hull > 60 %, then rejoin. |
| `orbit` | drones | orbit assigned target at 80 u; return within 300 u of carrier if no enemy. |

Steering: desired velocity = behavior + separation (`sig`-scaled radius, weight 1.0) + cohesion toward team centroid (weight `spacing ? 0.1 : 0`) + bounds. Turn rate clamps heading change; speed ramps 0→max in 0.5 s. Swarm spacing target 35 u (just above flak radius 30).

### 6.3 Ability usage

The `conditional` triggers in §1.3 are evaluated at every decision tick; `abilityDelayTicks` adds latency. Expert additionally does **alpha-sync**: Destroyers/Battleships on the same focus target delay up to 10 ticks so Piercing/Spinal shots land after the shield breaker volley.

---

## 7. Balancing methodology (headless harness)

`npm run balance` → runs the engine headless under `node:test` (fast suite) and a separate `scripts/balance.mjs` (long suite, writes a JSON + markdown report). All runs use `maxTicks = 3600` (180 s) and `EXPERT` ship-AI on both sides unless stated.

### 7.1 Determinism & side bias (gating tests, run in CI)
- Same seed + same fleets ⇒ identical `hash(finalState)` and identical event stream, across Node and Chromium (Playwright runs the sim in the browser and compares the hash). **Threshold: 100 % equal.**
- Every archetype vs itself, 200 seeds, swapped sides: left-side win rate **50 % ± 4 %**, draws **< 5 %**.

### 7.2 Match length
- All 7×7 archetype pairings × 50 seeds: median duration 70–120 s, p95 < 160 s, tiebreak share < 10 %. If a pairing stalls (kite vs slow), tune sudden-death ramp or Destroyer speed before touching damage.

### 7.3 Class-vs-class matrix
- For each ordered pair (X, Y): fleet of `floor(180/cost_X)` X (caps lifted for this test) vs same for Y, 50 seeds, both deployments mirrored. Compare to the §1.4 target matrix:
  - `C` cells: 70–90 %; `c`: 60–70 %; `=`: 40–60 %; `x`: mirror of the above.
  - Any cell off by > 10 pp ⇒ flag. Row/column mean win rate per class must be in **[38 %, 62 %]** (no universally dominant/useless class).
- Tender test: `ref escort (1 Fri + 1 Cor + 4 Fig = 54) + k·Tender` vs `ref escort + equal points of X`.

### 7.4 Cost-efficiency vs reference fleet
- Each class X: `Linha de Batalha` (reference, 190) vs `reference minus the cheapest ships worth ≥ cost_X, plus X` ... simpler and more robust: `reference` vs `reference with 36 pts replaced by X-equivalents` — win rate must stay **35–65 %**. Also "add-one marginal value": `F + X` vs `F + Y` for every pair with |cost_X − cost_Y| ≤ 2.
- **Auto-tuner suggestion** (reported, not auto-applied): `cost' = round(cost × (1 + 0.5·(wr − 0.5)))`, iterate until all classes within band; then re-run §7.3 because costs changed ship counts.

### 7.5 Ability ablation
- For each class, archetype containing it with abilities **disabled** vs the same with abilities enabled (mirror), 100 seeds: win rate of enabled side **55–70 %**. < 55 % = ability irrelevant (buff or redesign); > 70 % = ability carries the class (cost or cooldown up).

### 7.6 Composition dominance search
- Run the §4.3 `optimizer` from 20 random seeds against each archetype for 40 iterations offline; collect the best fleets. If the same composition (within 10 % point share per category) wins > 65 % against **every** archetype ⇒ dominant strategy; fix the counter that should beat it (first suspect: swarm/flak and armor floor).

### 7.7 Difficulty validation
- "Reference human" = `template` builder with Normal knobs. Target win rates of the **enemy** against it: Fácil 20–30 %, Normal 45–55 %, Difícil 65–75 %, Especialista 80–90 %. Also run levels 1–15 with a "lazy player" (random builder) and a "good player" (counter builder): lazy should clear levels 1–4 on Normal, good should clear 1–12 and struggle at 13–15.

### 7.8 Performance
- 6v6, 1 200 pts per side, Expert AI: headless ≥ 10× real-time in Node (≤ 18 s for a 180 s battle), browser single-player ≥ 3× real-time on a mid laptop. Server tick budget < 25 ms at 20 Hz.

---

## 8. Risks & opinions

1. **Swarm vs everything.** The `sig/sigRes` model plus 25 % armor floor is the whole anti-swarm story. If §7.6 finds Enxame dominant, first levers: flak radius 30→40, PD dmg 4→5, armor floor 0.25→0.2. Don't add a damage-type matrix.
2. **Kiting stalemates** (Artilharia vs Frota-Mãe). Sudden death handles the clock; perception is the problem — the renderer should show the "Morte Súbita" banner and the damage multiplier.
3. **Expert optimizer time** in the browser. Cap at 8 s wall clock in a Worker; it is still deterministic given the seed because the iteration count is also recorded in the battle setup (store `iterationsCompleted` so replays reproduce).
4. **Phantom** is the only class with a bespoke rule (cloak). If scope slips, cut it — nothing else depends on it (Corvette/Carrier `detectRadius` just goes unused). Keep it if possible: it is the only direct threat to Tenders/Carriers besides swarm, which gives Hard/Expert its scariest counter-pick.
5. **Focus fire on the Mothership** makes the Frota-Mãe archetype binary (either the escort stops the bombers or the 90-pt ship evaporates). EMP + 10 armor + Tender should hold ~90 s; verify with §7.3 row "MS vs Bomber" ≈ 25–30 %, not 10 %.
6. **Overkill ledger** is the single most important AI feature for perceived intelligence (ships don't all shoot a dying target). It must be in the engine from day one, not retrofitted.
7. **Numbers are a first pass.** Treat §1 as initial `catalog.js` values and §7.3/7.4 bands as the acceptance criteria; expect 2–3 tuning rounds of ±10–20 % on cost/hull/dmg before the roster settles.