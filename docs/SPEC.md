# Frota Estelar — Game Specification

Auto-battler space strategy game: each player picks a faction, builds a fleet
within a point budget, and when everybody is ready the fleets fight automatically
using the ships' own AI (targeting, positioning, abilities). Modes: single-player
vs. the computer (levels + difficulties, 1v1 up to 6v6 with bot allies) and online
multiplayer (rooms, 1v1 up to 6v6, bots fill empty slots).

The data (ships, weapons, abilities, presets) lives in `shared/catalog.js`; the
numbers below reference it. Long-form design rationale: `docs/design/*.md`.

## 1. Rules

- **Budget**: Escaramuça 800, Padrão 1500 (default), Guerra Total 2500 points per
  player, same for everybody in a match. Unspent points are allowed (UI warns).
- **Caps per player**: mothership 1, capital 2, large 4, medium 12, small 24, tiny 24
  (Vorrax tiny 32); total purchased ships ≤ 40, ≥ 1.
- **Factions**: a fleet contains ships of one faction only.
- **Deployment**: team 0 on the left facing +x, team 1 on the right facing −x
  (mirrored). Each player owns a horizontal lane (arena height / players per side,
  min 300 u); lanes are stacked and centered. Within a lane, ships are placed in
  columns by size class from the rear: mothership, capital, large, medium, small,
  tiny (vanguard). Columns are 70 u apart starting at `SPAWN_X_FRACTION·W`; ships
  within a column are spread evenly in y (min spacing radius×2.5), two rows if
  needed. Order within a column is deterministic (catalog order, then count).
- **Victory**: all enemy *purchased* ships destroyed (spawned units don't count).
  Both wiped in the same tick → draw.
- **Sudden death** at 150 s: passive regeneration, nanite repair and shield regen off;
  heal-over-time effects and kill-heals (Vorrax *Fome*) off; instant ability heals still
  work (bounded by their cooldowns). Kiting and retreat disabled, damage ×(1 + 0.2 per
  15 s elapsed since 150 s). Event `['phase','suddenDeath']`.
- **Hard stop** at 240 s: winner = higher remaining value
  `V = Σ cost × (hp+shield)/(maxHp+maxShield)` over surviving purchased ships; if
  within 2% → tiebreak by total damage dealt; still within 2% → draw.
- **Arena**: `worldSize(playersPerSide)` from constants (2800×1575 for 1v1 up to
  4000×2250 for 6v6). Soft push-back force within 100 u of the edge, hard clamp at the edge.

## 2. Combat model

### 2.1 Time, movement
- 20 ticks/s (`DT = 0.05`). Positions in u, speeds in u/s, turn in deg/s (convert to rad).
- "Car with lateral drag" steering: heading changes at most `turnRate·DT` per tick toward
  the desired direction; forward speed accelerates by `accel·DT` toward the desired speed
  scaled by alignment (`max(0, cos(angleDiff))`, zero when > ~72° off); lateral velocity is
  damped (`lateralDrag = 4/s`). Ships never exceed `speed × speedMul` (buffs).
- Separation: for neighbors within `r_i + r_j + 12`, push away weighted by `(1 − d/sep)²`
  and mass ratio (light yields to heavy); after integration, one pass of hard overlap
  correction. No collision damage.
- Spatial hash with 200 u cells rebuilt every tick; queries iterate cells in fixed order so results are deterministic.

### 2.2 Weapons and hit resolution
- Each weapon fires at the ship's current target when: cooldown elapsed, target alive and
  targetable, `d ≤ range` (× rangeMul buffs), bearing within `arc`, and target size ≥
  `minTargetClass`. Weapons with `pd: true` prefer enemy interceptable projectiles within
  range (claim by lowest ship id; each attempt destroys the projectile with
  `pdInterceptChance`), then enemies.
- **Hit roll at fire time**: `p = ACCURACY[type][targetSize] + mods`, mods: Ferrix +0.10 vs
  tiny/small, −0.05 if target speed > 150 u/s, range factor (linear from 1.0 at 80% range to
  0.6 at max range), evasion buffs; clamp [0.05, 0.98]. Contact weapons always hit.
  `hit = rng.next() < p`.
- `speed = 0` → hitscan: damage applied this tick, event `shot`. Else a projectile is
  created with `hitRolled`, travels at `speed` toward the target's current position each
  tick (all projectiles track their target visually/mechanically; a miss flies to an offset
  point and fizzles), impacts when within `target.radius + 6`. Events `proj` then `pend`.
- **Interceptable** projectiles (missile, torpedo) can be destroyed by PD/flak
  (`pend` outcome 2). `countermeasures` makes the next N incoming interceptables miss.
- **AoE**: on impact, every enemy within `aoe` of the impact point takes damage scaled
  linearly from 1.0 (center) to `aoeEdgeFalloff` (edge); the primary target takes full
  damage only if `hitRolled`. Event `aoe`.
- **Chain** (Catedral): on hit, up to `chain.targets` additional enemies within `chain.radius`
  of the target take `chain.damage` (events `shot` for each with hit=1).
- **Charge** weapons (Luz Primordial): `charge` event, the ship must keep the target within
  arc for `charge` seconds (flag CASTING), then fires as hitscan.
- **Piercing shot** (Ariete ability): the next railgun shot hits every enemy within a
  `coneDeg` cone up to `maxTargets`, in distance order.
- Contact weapons (`contact: true`, Carrapato mandibles) measure range edge-to-edge (`d − r_src − r_target ≤ range`).
- A rolled miss never damages the primary target: AoE splash on a miss excludes it and the fizzle point lies outside the splash radius.
- Multiple turrets (salvo > 1) fire all shots in the same tick; cooldown offsets at battle
  start (`(id·7) mod cooldownTicks`) avoid synchronized volleys.

### 2.3 Damage
```
raw = damage × srcDamageMul (buffs, auras, Terran coordination +10% kinetic if ≥3 Terran attackers on target, sudden death ramp)
if target.shield > 0:
  s = raw × DAMAGE_MULT[type].shield; absorbed = min(shield, s); shield -= absorbed; shieldDelayTimer = shield.delay
  raw = (s − absorbed) / DAMAGE_MULT[type].shield          # overflow continues to hull
  if shield hit 0 → 'sbreak' event, Lúmen 'phase' passive check
hull = raw × DAMAGE_MULT[type][hullType]
if type !== 'railgun': hull = max(hull × armorFloor, hull − (dr + tempDr))
hull = max(minHullDamage, hull) if raw > 0
hp -= hull; lastHullHitTick = tick; dot applied if weapon.dot (ticks each 0.5 s, ignore DR); ion → disrupt
```
- Damage is queued during the tick and applied in `(srcId, sequence)` order; deaths are
  processed in a dedicated phase (two ships can kill each other in the same tick).
- **Regen** (per tick, skipped while disrupted or in sudden death): shields regen after
  `delay` seconds without shield damage; organic hulls regen always; nanite hulls repair
  after 2 s without hull damage (`COMBAT.naniteRepairDelay`).
- **Disrupt** (ion hits, EMP abilities, acid cloud for shields only): halts regen/repair for
  the stated duration; 2 s immunity after it expires (except for ability-sourced disrupts
  which always apply but also grant the immunity afterwards).
- **Passives**: Terran *Coordenação de Fogo*; Vorrax *Fome* (killer heals 5% max hp; only kills of purchased ships count; off in sudden death);
  Lúmen *Fase* (first shield break → UNTARGETABLE 1 s, once per 20 s; projectiles in
  flight still hit); Ferrix *Rede Neural* (+0.10 accuracy vs tiny/small).

### 2.4 Spawned units
Abilities with `spawn` create ships of a purchasable class with `cost 0`, `lifetime`,
`source = caster id`, placed around the caster. They count toward neither fleet caps nor
victory; `maxAlive` per source ship; a dead source spawns no more. Global cap 800 live
ships: spawns beyond it are skipped.

## 3. Ship AI

All of this runs inside the simulation (identical on server and client). Each ship
`decide()`s every `thinkInterval` ticks (staggered by its team-local slot, `slot % interval`, so
mirrored fleets think in the same order on both sides); the actuator runs
every tick. Terminology from `docs/design/battle-ai.md` §2–3.

### 3.1 Roles → default movement when engaged
| role | ships | movement | notes |
|---|---|---|---|
| diver | tiny ships, Zangão, Carrapato | `orbit` target at 0.6·range (tangent by id parity) | ignore formation once engaged; prefer support/carrier/kiter targets behind the line |
| brawler | Falcão, Órion, Hércules, Mandíbula, Rainha, Ressonante, Serafim, Disruptor, Bastião | `hold` at 0.7·range | |
| kiter | Cuspidor, Prisma, Harmônico, Sentinela, Aríete, Catedral | `kite` band 0.75–0.95·range | backs away from faster threats while firing |
| striker | Lança | `approach` to 0.8·range, fire, then `kite` | uses stealth to close |
| escort | Ártemis | `escortSlot` 60 u in front of the most valuable ally | engages anything within 1.2·range |
| support | Véu | `escortSlot` behind the most valuable ally | targets by ability |
| carrier | Atlas, Matriz, Fabricador, Núcleo | `backline`: 250 u behind the team centroid toward own side; flee threats within 200 u | |
| anchor | motherships | `hold`, speed ≤ 0.6·max, advances slowly with the team | |

Other modes: `formation` (advance phase: keep slot relative to the team anchor, move at
the group speed = slowest non-diver alive ship), `retreat` (to nearest support/carrier or
rear point; hull < threshold by role: diver 0.35, kiter 0.4, brawler 0.25, escort/support 0.45;
exit at +0.2 or when alone; a retreat ended by the 10 s cap starts a 15 s cooldown before another; hulls that cannot regenerate exit when shield ≥ 60% of cap), `idleAdvance` (no target: move toward enemy centroid at 0.5·max).

Phases: `advance` until first contact (any ship within 1.1·range of an enemy) or 45 s,
then `engage` (`['phase','engage']`).

### 3.2 Target selection (per ship, utility scoring)
```
candidates = enemies within max(1.5·maxRange, 600) (≤ 16 nearest) ∪ {assignedId, currentTarget}; never empty while enemies live (fallback: nearest enemy)
score(t) = W.range·rangeFit + W.dmg·dmgMult + W.kill·killability + W.value·(t.cost/100) + W.threat·threat
         + W.focus·focus·(1−overkill) + W.team·(t == assigned) + protect + sticky(0.15) + roleBias
dmgMult   = type×hull/shield multiplier × accuracy vs size   (precomputed per (weapon,class) at init)
killability = clamp(1 − ehp(t)/(3·myDpsVs(t)·…), 0, 1)      (how fast can I kill it)
threat    = t.dpsVs(me)/myEhp × (t targets me ? 2 : t targets nearby ally ? 1 : 0.5)
overkill  = clamp((t.allocDps·3 − ehp(t))/ehp(t), 0, 1)       (damage already allocated by the team)
roleBias  = per role vs size class (divers +vs small/support ships; torpedo/railgun ships + vs large; flak + vs tiny; Carrapato + vs medium+; Disruptor + shield>50%)
switch target only if best > current·1.25 + 0.05, or current invalid, or committed ≥ 2 s
```
Weights per role as in `docs/design/battle-ai.md` §2.3. Weapons with `minTargetClass` or
`pd` select their own sub-targets each tick (PD: nearest interceptable projectile, then
nearest enemy).

### 3.3 Team coordination (`teamThink`, every 10 ticks, both teams on the same tick)
- Team centroid (cost-weighted), anchor (mothership → highest-cost capital → virtual), phase.
- Greedy focus allocation: iterate own ships by (long-range first, then id), assign each the
  best enemy by `(cost/ehp) × dmgMult × proximity × (allocDps·3 < ehp ? 1 : 0.3) × (enemy is
  targeting a low-hp ally ? 1.5 : 1)`; `allocDps` accumulates. Assignment is a suggestion
  (`W.team`), not an order.
- Protectees for escorts/supports: highest-cost ally within 500 u.
- Leash: non-divers stay within 350 u (advance) / 900 u (engage) of the anchor.

### 3.4 Expected incoming damage
`expectedIncoming(me, 2 s)` = Σ dps of enemies targeting me within 1.1·their range × 2 +
damage of projectiles in flight toward me. Used by retreat, shields, teleports, cloak.

### 3.5 Ability triggers (evaluated in `decide()`, cast when ready and utility ≥ 1)
| ability | trigger |
|---|---|
| afterburner | target farther than range+100 and < 3·range, or retreating with incoming > 30% hp, or targeted by ≥ 3 |
| countermeasures | ≥ 1 interceptable projectile homing on self |
| stealth_strike | enemy large+ within 700 and torpedo ready within 2 s; stays untargetable until it fires |
| flak_curtain | ≥ 3 enemy interceptables in flight toward allies within 300, or ≥ 6 enemy tiny within 320 |
| barrage_fire | ≥ 2 enemy medium+ within 520 or enemy capital+ in range |
| reactive_armor | hull < 60% or targeted by ≥ 3 |
| launch_squadron | ready and (tick < 60 or enemy within 1000) |
| siege_protocol | ≥ 50% of allied surviving cost within 600 and ≥ 3 enemies within 700 |
| bile_burst | passive: on death (and when hull < 20% the larva dives into the nearest enemy and detonates) |
| frenzy | an allied Vorrax died within 150 u in the last 10 ticks |
| acid_cloud | ≥ 2 enemies within a 100 u circle inside range (densest point) |
| leech | enemy medium+ within 150 u; detaches if host dies/teleports (0.5 s stun) |
| spawn_brood / fabricate_drones / endless_swarm | ready and enemy within 900 (1200 for Colmeia) and under maxAlive |
| molt | hull < 40% |
| war_pheromone | ≥ 4 allies within 500 and ≥ 1 enemy within 600 |
| blink | shield = 0 and hull < 100% → away from nearest threat; else target farther than range+60 → toward target; 2 s no re-evaluate after jump |
| shield_overload | shield < 20% of cap |
| mantle | ally medium+ within 300 with shield < 30% (prefer highest cost) |
| prismatic_focus | enemy large+ within 520 |
| dissonant_pulse | ≥ 3 enemies within 220 or enemy capital+ within 220 |
| phase_jump | defensive: shield < 25% and ≥ 2 enemies within 300 → away from enemy centroid; offensive: shield > 80%, no enemy within 480, enemy capital+ within 900 → toward it |
| aurora | ≥ 3 allies within 400 with shield < 50% |
| singularity | ≥ 4 enemies or ≥ 2 medium+ within a 250 u circle inside 800 u |
| overclock | ≥ 3 other Vetores targeting my target |
| turret_mode | no enemy within 250 and an enemy within 1.5·range |
| emp_pulse | enemy with shield > 50% within 150 or enemy organic medium+ within 150 |
| reactive_nanites | hull < 35% |
| piercing_shot | ≥ 2 enemies inside a 15° cone within range |
| reconstruction | ≥ 3 allies within 400 with hull < 60% |
| emp_storm | ≥ 5 enemies within 400 or enemy mothership within 400 |

Teleport destinations are clamped inside the arena and pushed out of other hulls.
Effects of the same ability id refresh (longest duration wins) instead of stacking; different abilities still combine.

### 3.6 Difficulty profiles (bots only; humans always get `especialista` knobs)
| knob | facil | normal | dificil | especialista |
|---|---|---|---|---|
| thinkInterval (ticks) | 16 | 8 | 5 | 4 |
| scoreNoise σ | 0.6 | 0.25 | 0.12 | 0 |
| randomTargetProb | 0.3 | 0.1 | 0.03 | 0 |
| abilityDelayTicks | 20 | 8 | 2 | 0 |
| abilityMiscastProb | 0.3 | 0.1 | 0.05 | 0 |
| abilityNoise (threshold jitter) | 0.5 | 0.2 | 0.05 | 0 |
| teamWeight (focus fire) | 0 | 0.5 | 1 | 1 |
| overkillAvoid | off | off | on | on |
| retreat / formation / kiting | off | on | on | on |
| budgetMul (enemy budget) | 0.8 | 1.0 | 1.05 | 1.2 |
| builder | random | preset | counter | counter |
Noise is `σ·(u1+u2+u3−1.5)·2` from the sim RNG (deterministic).

## 4. Single-player
- Setup: level (1–15, endless after), difficulty, team size (1v1..6v6). Allies are bots of
  the player's chosen ally difficulty (default normal) with random factions and preset
  fleets; enemies follow the level.
- Enemy budget = `round(1500 × level.enemyBudgetMul × profile.budgetMul)`; the player always has 1500.
- Levels: 1 Primeiro Contato (terran ×0.5, random builder), 2 Patrulha de Fronteira (terran ×0.6),
  3 Bloqueio Orbital (terran ×0.7), 4 Ninho Vorrax (vorrax ×0.7), 5 Maré Viva (vorrax ×0.8),
  6 A Rainha Desperta (vorrax ×0.9, boss: Rainha guaranteed), 7 Luz Distante (lumen ×0.85),
  8 Coro de Cristal (lumen ×0.95), 9 Catedral Errante (lumen ×1.0, boss Catedral),
  10 Sinal Ferrix (ferrix ×0.95), 11 Linha de Ferro (ferrix ×1.05), 12 Mente Primária (ferrix ×1.15, boss),
  13 Aliança Rompida (random ×1.2, counter builder), 14 Armada Negra (random ×1.3, counter),
  15 Fim dos Tempos (random ×1.5, counter + mothership guaranteed). Level n > 15: random,
  ×(1.5 + 0.1·(n−15)). Progress (max level cleared per difficulty) in `localStorage`.
- Results screen offers: play again (same fleet, new seed), next level, edit fleet, menu.

## 5. Multiplayer
- Rooms with 4-letter codes; host picks team size, budget and default bot difficulty; players
  pick slots, build fleets (hidden from others until battle start), ready up; host starts
  (optionally auto-filling empty slots with bots). 5 s countdown during which bot fleets are
  built (counter builders see the human fleets of the other team). Server simulates and streams
  10 Hz frames; clients interpolate. Results → rematch vote.

## 6. Art direction (summary; full detail in `docs/design/visuals.md`)
- Procedural sprites per ship class described as data (mirrored polygon layers in a 100×100
  design space, materials per faction: steel gradient + panel lines; chitin radial gradients +
  membranes; translucent crystal with facets and chromatic edge; nanite flat fill with cell grid
  and circuit traces). Cached offscreen per (class, team, zoom bucket, damage state); one
  `setTransform` + `drawImage` per ship; animated details (engine flames, pulsing cores, orbiting
  shards, automaton cells, breathing segments) drawn on top for nearby zoom levels.
- Team color only on emissive parts (engines, cores, lights, stripes, shields); faction look stays.
- VFX per weapon type (tracers, railgun streaks, missiles with smoke, plasma bolts with trails,
  acid drops, spore clouds, flak bursts, beams with glow/core, lightning arcs), shield hex ripples,
  explosions scaled by size with faction-specific debris, ability VFX (domes, EMP rings, repair
  beams, teleport streaks, singularity), engine trails, SoA particle pool with adaptive density.
- Background: cached parallax starfield layers + procedural nebula + optional planet.
- Camera: auto fit-to-fleets biased toward the action, smooth, trauma-based shake, optional slow-mo on last kill.
- UI theme: dark sci-fi HUD, chamfered panels, Orbitron/Exo 2 (Google Fonts, system fallback),
  team colors blue/orange, faction colors on badges. Fleet builder cards draw the ship live.

## 7. Audio (summary; full detail in `docs/design/audio.md`)
- Single `AudioContext` created on the first user gesture; buses sfx/ui/music → master →
  limiter; one shared synthetic reverb; voice pool of 24 with priorities; 30 ms coalescing per
  sound key; distance attenuation + stereo pan relative to the camera; settings persisted.
- SFX recipes per weapon type, hits (hull/shield), shield break, explosions by size class,
  abilities, UI; faction flavor stage (mechanical / wet organic / harmonic crystalline / digital).
- Generative soundtrack: lookahead scheduler, D minor, themes for menu (72 BPM ambient),
  builder (96 BPM), battle (128 BPM with intensity layers driven by battle state), victory and
  defeat stingers; crossfades on bar boundaries; faction motifs.

## 8. Balance and acceptance criteria (headless, `tools/simulate.js`)
1. Determinism: same config + seed → identical `hashState` at ticks 100, 1000 and end; identical event stream.
2. Mirror matches (each preset vs itself, sides swapped, ≥ 40 seeds): side win rate 50% ± 10, draws < 5%.
3. Faction matrix (presets pooled, ≥ 20 seeds per pair, both sides): every faction vs every other within 35–65%.
4. Per-preset pairs within 20–80% (hard counters allowed, stomps not).
5. Pace: median battle 60–160 s, p95 < 240 s (timeouts < 10%).
6. Difficulty monotonic: vs a `normal` preset fleet, enemy win rate: facil < normal < dificil < especialista, with especialista ≥ 70%, facil ≤ 35%.
7. Never idle: every alive, non-disrupted ship has a target or a movement intent while enemies live.
8. Abilities fire: in a 1v1 with one of every ship class per side, every ability id appears in ≥ 1 `cast` event in ≥ 80% of seeds (passives excluded).
9. Performance: 6v6 full fleets (≈ 500 ships) ≤ 10 ms per tick average in Node (measured ≈ 5 ms;
   the unit test asserts < 20 ms to absorb slow CI runners).
