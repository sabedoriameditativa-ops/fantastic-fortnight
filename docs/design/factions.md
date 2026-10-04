# Proposta de Design — Facções, Raças e Rosters de Naves ("Frota Estelar")

Lens: factions, races, ship rosters, damage model, balance plan. All numbers are a tuned starting point for the headless simulator, not gospel; section 7 says how they get corrected.

---

## 0. Shared conventions (so every table below is unambiguous)

**World & scale.** 1v1 arena 3000×2000 world units (wu); add +500 wu width per extra player per side. Teams spawn on opposite edges, ~2400 wu apart, so long-range ships get 8–15 s of approach fire before the brawl.

**Size classes** (one hitbox radius each; the renderer scales sprites to this):

| class | radius (wu) | base speed band (wu/s) | turn (deg/s) | notes |
|---|---|---|---|---|
| tiny | 8 | 180–210 | 360–420 | interceptors, drones, larvae |
| small | 14 | 130–165 | 220–260 | corvettes, frigates |
| medium | 22 | 90–110 | 140–160 | destroyers, cruisers |
| large | 34 | 60–75 | 80–95 | battleships |
| capital | 50 | 45–55 | 50–60 | carriers, cathedrals |
| mothership | 75 | 28–32 | 35 | one per player |

**Hull types** (mechanical meaning, applied to hull HP only, never to shields):

| hull id | pt-BR | effect |
|---|---|---|
| `armored` | Blindado | flat damage reduction `DR` subtracted from every hit *after* type multiplier (min 1 dmg). Railgun ignores DR. |
| `organic` | Orgânico | continuous regen `regenHull` HP/s, always on (even under fire). Stops for `disruptDuration` when hit by ion/EMP. On kill: +10 % max HP instantly (faction trait "Fome"). |
| `crystalline` | Cristalino | no regen, no DR. Lasers refract (×0.6). Kinetic/railgun shatter (×1.3/1.4). Always paired with large shields. |
| `nanite` | Nanítico | repair `repairHull` HP/s but **only after 3 s without taking hull damage** (`repairDelay = 3`). Some ships add a small DR (plating). Ion/EMP halts repair. Bio eats nanites (×1.4). |

**Shields.** `{cap, regen, delay}` = capacity, HP/s regen, seconds after the last hit before regen resumes. Shields absorb first. A ship with `cap = 0` has no shield (no bubble drawn).

**Weapon schema** (one object per weapon; the engineer can put this verbatim in `data/ships.js`):

```js
{
  id: 'autocannon_twin', type: 'kinetic',   // kinetic|railgun|flak|laser|plasma|missile|torpedo|bio|ion
  damage: 3, salvo: 2, cooldown: 0.6,       // salvo = shots per trigger; cooldown in seconds
  range: 220, speed: 600,                   // speed: wu/s; 0 = hitscan (laser/ion-lance)
  accuracy: 'kinetic',                      // key into ACCURACY table (section 4)
  aoe: 0,                                   // splash radius; 0 = single target
  dot: null,                                // {dps, duration} for acid
  homing: false,                            // missiles/torpedoes turn toward target
  interceptable: false,                     // true for missile/torpedo: flak/PD can shoot them down
  minTargetClass: 'tiny',                   // torpedoes: 'medium' (won't fire at tiny/small)
}
```

**DPS sanity formula** (used when writing the tables; cost is then corrected by the sim):

```
EHP   = hullHP * (1 + DR/20) + shieldCap * 1.1 + 15 * (regenHull or repairHull)
DPS   = Σ_weapons damage * salvo / cooldown * (1 + aoe/200)
cost  ≈ 0.1 * sqrt(EHP * DPS) * classFactor
classFactor: tiny 1.0, small 1.0, medium 1.0, large 0.9, capital 0.85, mothership 0.8
```
Bigger classes are discounted because of overkill, low accuracy vs small targets, and focus-fire vulnerability; abilities add +0 to +4 pts on top by judgement.

---

## 1. The four factions

### 1.1 Confederação Terrana (human) — keyword **"aço e laranja"** (steel blue hulls, orange panel lights, white exhaust)

**Lore.** Depois de duzentos anos de guerras entre colônias, a Confederação unificou as frotas da Terra, Marte e dos Cinturões sob uma doutrina única: navios modulares, blindagem pesada e saturação de mísseis. Não têm a tecnologia mais avançada da galáxia — compensam com disciplina, logística e fogo coordenado. Seus porta-naves lançam esquadrilhas descartáveis; seus encouraçados aguentam castigo que afundaria qualquer outra nave.

**Visual.** Boxy, angular silhouettes, visible turrets, pale-blue engine glow, orange hazard stripes, grey shield bubble (hex-pattern flicker on hit).

**Faction-wide traits.**
- Hull: `armored` on everything (DR 1–8 by size). Shields only on large+ classes.
- Weapons: kinetic + missile + torpedo; flak destroyers for point defense.
- Passive "Coordenação de Fogo": a target currently being shot by ≥3 Terran ships takes +10 % damage from Terran kinetic weapons.
- Projectile interception: Terran flak and PD guns can shoot down enemy missiles/torpedoes.
- Playstyle: balanced line fleet; wins by attrition and anti-missile cover; weak to EMP-stripped shields and to bio-acid DoT that bypasses DR.

### 1.2 Enxame Vorrax (insectoid swarm) — keyword **"quitina e ácido"** (brown-purple chitin, acid-green glow, pulsing bioluminescent veins)

**Lore.** Os Vorrax não constroem naves: criam-nas. Cada "nave" é um organismo gestado nas colmeias-mãe, com carapaça de quitina viva que cicatriza em pleno combate. Não entendem o conceito de recuo — o enxame avança, morre e renasce. Sua tecnologia é bioquímica: plasma secretado, ácido corrosivo, esporos. Não têm escudos; sua defesa é a regeneração e o número.

**Visual.** Asymmetric organic shapes drawn with bezier curves, breathing animation (scale ±3 % at 0.8 Hz), green acid trails, splatter particles on death, spawn pods that "burst".

**Faction-wide traits.**
- Hull: `organic` everywhere (regen 3 %–1 %/s of max HP by size). No shields anywhere.
- Weapons: bio (acid DoT), plasma (bio-plasma), living torpedoes, spore AoE.
- Passive "Fome": any Vorrax ship that lands the killing blow heals 10 % max HP.
- Cheapest ships per class; multiple spawner units.
- Playstyle: swarm, flood the point-defense, melee leeches on big hulls; weak to flak/AoE and to lasers (burn), strong vs nanite hulls and vs long-cooldown railgun fleets (overkill on cheap larvae).

### 1.3 Ascendência Lúmen (energy beings) — keyword **"luz e cristal"** (white-gold crystalline hulls, cyan shield auroras, prismatic beams)

**Lore.** Os Lúmen são consciências de energia pura que habitam cascos cristalinos cultivados em estrelas moribundas. Seus "navios" são catedrais flutuantes de luz; o cristal é frágil, mas os escudos que projetam são os mais fortes conhecidos. Movem-se dobrando o espaço — saltos curtos de fase — e falam por harmônicos de luz. Para eles, a guerra é um coro: cada feixe uma nota, cada salto um compasso.

**Visual.** Symmetric faceted gems (polygons with inner highlight lines), slow rotation of an inner "core" glyph, large shimmering shield ellipses with aurora gradient, hitscan beams drawn as glowing lines with bloom, blink = fade-out/fade-in with light streak.

**Faction-wide traits.**
- Hull: `crystalline` everywhere (low HP); every ship has a shield, usually larger than the hull.
- Weapons: laser (hitscan, high accuracy vs medium+, poor vs tiny), ion.
- Passive "Fase": the first time a ship's shield breaks in a battle it becomes untargetable for 1.0 s (projectiles already in flight still hit). Once per 20 s per ship.
- Mobility: blink/teleport abilities on several hulls.
- Playstyle: glass cannons with a thick energy buffer; want to keep range and kite; weak to ion (×1.6 vs shields) and railguns (×1.4 vs crystal); strong vs organic (laser burn) and vs Terran shields.

### 1.4 Nexo Ferrix (machine collective) — keyword **"grafite e vermelho"** (gunmetal hex-plates, red LED seams, orange railgun flashes)

**Lore.** O Nexo Ferrix é uma única mente distribuída em bilhões de máquinas. Cada nave é um nó: cascos de nanitos que se reconstroem quando o combate dá trégua, canhões magnéticos que atravessam qualquer liga, pulsos EMP que apagam escudos como velas. O Nexo não odeia os orgânicos — simplesmente calculou que o universo é mais eficiente sem eles.

**Visual.** Hexagon/tessellation-based hulls, thin red light seams that pulse when repairing (nanite "weld sparks" particles), railgun shots as long white-hot lines with EM distortion rings, EMP as expanding blue ring with electric arcs.

**Faction-wide traits.**
- Hull: `nanite` everywhere (repair 5–1.2 %/s after 3 s untouched); medium+ add plating DR 3–7.
- Weapons: railgun (ignores DR, long range, slow fire), ion/EMP, kinetic gatlings, plasma repeaters on the brawler.
- Passive "Rede Neural": +10 % accuracy vs tiny/small for all Ferrix weapons (shared targeting).
- Drone fabrication on several hulls.
- Playstyle: ranged alpha-strike + EMP; wins when it can keep a fight at range and burst targets before regen matters; weak to bio (×1.4) and plasma (×1.3) and to swarms that stay inside railgun minimum effectiveness; strong vs Lúmen shields/crystal.

---

## 2. Rosters (8 ships each: 1 tiny, 2 small, 2 medium, 1 large, 1 capital, 1 mothership)

Legend: **HP** hull; **DR** flat reduction; **Reg** regen or repair HP/s; **Shield** cap / regen / delay; **Spd** wu/s; **Turn** deg/s. Weapon tuple: `type dmg×salvo / cd s, range, proj speed (H = hitscan)`. Accuracy uses the table in section 4 by weapon type unless noted.

### 2.1 Confederação Terrana

| # | pt-BR name | id | class | cost | HP | DR | Shield | Spd | Turn |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Interceptador Vespa | `ter_vespa` | tiny | 2 | 45 | 1 | 0 | 190 | 380 |
| 2 | Corveta Falcão | `ter_falcao` | small | 6 | 120 | 2 | 0 | 140 | 240 |
| 3 | Lancha-Torpedeira Lança | `ter_lanca` | small | 5 | 100 | 1 | 0 | 150 | 250 |
| 4 | Destróier Ártemis | `ter_artemis` | medium | 11 | 320 | 3 | 0 | 100 | 150 |
| 5 | Cruzador Órion | `ter_orion` | medium | 13 | 380 | 4 | 0 | 95 | 145 |
| 6 | Encouraçado Hércules | `ter_hercules` | large | 24 | 800 | 6 | 200 / 10 / 5 | 65 | 85 |
| 7 | Porta-Naves Atlas | `ter_atlas` | capital | 32 | 1400 | 5 | 450 / 20 / 6 | 50 | 55 |
| 8 | Nave-Mãe Prometeu | `ter_prometeu` | mothership | 50 | 3000 | 8 | 1000 / 40 / 7 | 30 | 35 |

| # | Weapons | Signature ability | AI trigger | Counters / countered by |
|---|---|---|---|---|
| 1 | W1 `kinetic 3×2 / 0.6 s, 220, 600` | **Pós-combustor**: +80 % speed, +50 % turn for 3 s. cd 12 s | target out of range by >100 wu, OR a missile is homing on self | counters: enemy tiny/small, missiles (bait). Countered by flak, spore AoE, PD. |
| 2 | W1 `kinetic 7×2 / 0.6, 260, 650`; W2 `missile 18×2 / 4.0, 450, 320, homing, interceptable` | **Contramedidas**: next 2 missiles/torpedoes targeting self auto-miss within 6 s. cd 15 s | ≥1 missile homing on self | counters: small/medium organics (missile ×1.1). Countered by beams, swarms. |
| 3 | W1 `torpedo 110×1 / 8.0, 500, 250, homing, minTargetClass medium, interceptable` | **Ataque Furtivo**: untargetable 4 s or until it fires; next torpedo +50 % dmg. cd 20 s | enemy large+ within 700 and ability ready | counters: large/capital/mothership (torpedo ×1.4 vs armored, ×1.2 crystal). Countered by anything that targets it; flak intercepts its torpedo. |
| 4 | W1 `flak 6×3 / 0.8, 320, 500, aoe 40`; W2 `kinetic 7×2 / 0.6, 260, 650` | **Cortina de Flak**: for 5 s intercepts up to 8 enemy missiles/torpedoes within 250 of self; also flak dmg +30 % | ≥3 enemy interceptable projectiles in flight toward allies within 300, OR ≥6 enemy tiny within 320 | counters: tiny/small swarms, missiles. Countered by large hulls (flak ×0.6 armored, low acc vs large). |
| 5 | W1 `kinetic 14×2 / 0.9, 320, 700`; W2 `missile 20×4 / 5.0, 520, 320, homing, interceptable` | **Fogo de Barragem**: for 4 s missile salvo doubled (8), cooldown halved | ≥2 enemy medium+ within 520, or enemy capital+ in range | generalist line ship; counters medium; countered by EMP (no shield to lose, but missiles intercepted by Ferrix PD) and Lúmen beams at range. |
| 6 | W1 `kinetic 32×2 / 1.5, 420, 750`; W2 `torpedo 110×2 / 10.0, 550, 250, homing, minTargetClass medium` | **Blindagem Reativa**: DR +10 and shield regen ×3 for 6 s. cd 25 s | hull < 60 %, OR ≥3 enemies currently targeting self | counters: medium/large brawlers. Countered by acid DoT (ignores DR after first tick), plasma (×1.2 armored), leeches. |
| 7 | W1 `kinetic 5×2 / 0.3, 240, 650` (PD; can target projectiles) | **Lançar Esquadrilha**: spawns 4 `ter_vespa` (lifetime 35 s, max 8 alive from this ship). cd 30 s | battle start; thereafter whenever ready and any enemy within 1000 | counters: swarms (wasps + PD), missiles. Countered by railgun alpha, Lúmen beams (shield ×1.2). |
| 8 | W1 `railgun 150×1 / 5.0, 750, 1500`; W2 `missile 20×6 / 3.0, 550, 320, homing, interceptable` | **Protocolo de Cerco**: all allies within 600 get +30 % damage and +20 % fire rate for 6 s. cd 40 s | ≥50 % of surviving allied cost within 600 of self AND ≥3 enemies within 700 | the anchor; countered by Tempestade EMP (−400 shield) and by being out-ranged by Luz Primordial (800). |

### 2.2 Enxame Vorrax

| # | pt-BR name | id | class | cost | HP | DR | Reg (HP/s) | Shield | Spd | Turn |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Larva | `vor_larva` | tiny | 1 | 30 | 0 | 1.0 | 0 | 200 | 420 |
| 2 | Zangão | `vor_zangao` | small | 4 | 90 | 0 | 2.5 | 0 | 165 | 260 |
| 3 | Cuspidor | `vor_cuspidor` | small | 4 | 100 | 0 | 2.0 | 0 | 130 | 220 |
| 4 | Carrapato | `vor_carrapato` | medium | 10 | 320 | 0 | 5.0 | 0 | 110 | 160 |
| 5 | Matriz Voadora | `vor_matriz` | medium | 12 | 350 | 0 | 6.0 | 0 | 90 | 140 |
| 6 | Mandíbula | `vor_mandibula` | large | 22 | 950 | 3 | 12 | 0 | 70 | 90 |
| 7 | Rainha-Guerreira | `vor_rainha` | capital | 32 | 1900 | 0 | 20 | 0 | 50 | 55 |
| 8 | Colmeia-Mãe | `vor_colmeia` | mothership | 48 | 3800 | 4 | 30 | 0 | 28 | 35 |

| # | Weapons | Signature ability | AI trigger | Counters / countered by |
|---|---|---|---|---|
| 1 | W1 `bio 3×1 / 0.6, 180, 450` | **Explosão Biliar**: on death OR when hull < 20 %, explode: 20 bio dmg, aoe 60 (self dies) | automatic | counters: clumped tiny/small, nanite (×1.4). Countered by flak, spores, PD. |
| 2 | W1 `plasma 9×1 / 0.8, 240, 480` | **Frenesi**: +40 % fire rate, +20 % speed for 4 s | an allied Vorrax died within 150 of self in the last tick. cd 10 s | counters: nanite/armored small-medium (plasma ×1.3/×1.2). Countered by lasers, flak. |
| 3 | W1 `bio 18×1 / 2.5, 420, 300, arcing, dot {12 dps? no: 3 dps × 4 s = 12}` → write as `dot:{dps:3,duration:4}` | **Nuvem Ácida**: spawns a cloud r=100 at target point for 6 s; enemies inside take 6 bio/s and have shield regen halted | ≥2 enemies within a 100-radius circle inside range. cd 18 s | counters: armored/nanite (DoT ignores DR after first application; bio ×1.4 nanite). Countered by fast hunters (low HP). |
| 4 | W1 `bio 30×1 / 1.0, 40 (contact), H, accuracy 1.0`; W2 `bio 5×1 / 0.8, 200, 450` | **Sanguessuga**: latch onto target medium+ for 5 s (follows it, cannot be shaken): 15 bio/s to target, heals self 15/s | enemy medium+ within 150 and ability ready. cd 20 s | counters: large/capital hulls. Countered by PD/flak escorts and ion (halts its regen). |
| 5 | W1 `bio 8×1 / 1.5, 300, 350, aoe 50` (spores) | **Gerar Prole**: spawn 3 `vor_larva` (max 6 alive from this ship). cd 20 s | ready AND any enemy within 900 | counters: enemy tiny (spores) and attrition fights. Countered by railgun alpha (350 HP, no DR). |
| 6 | W1 `plasma 28×2 / 1.2, 360, 480`; W2 `torpedo 100×1 / 9.0, 500, 200, homing, minTargetClass medium` ("Torpedo Vivo") | **Muda**: heal 25 % max HP instantly, purge disrupt/DoT, regen ×1.5 for 5 s. cd 30 s | hull < 40 % | counters: Terran large/capital (plasma ×1.2 armored, torpedo ×1.4). Countered by focused lasers (×1.3 organic). |
| 7 | W1 `plasma 12×3 / 0.6, 380, 500` (spines); W2 `bio 40×1 / 3.0, 520, 300, aoe 70` (acid artillery) | **Feromônio de Guerra**: allies within 500 get +25 % damage and +50 % regen for 8 s. cd 35 s | ≥4 allies within 500 AND ≥1 enemy within 600 | counters: everything medium; countered by Lúmen beams (crystal takes little plasma penalty, lasers burn her), Ferrix railguns out-ranging her. |
| 8 | W1 `plasma 120×1 / 4.0, 600, 400, aoe 60` ("Vômito de Plasma"); W2 `bio 8×2 / 1.5, 300, 350, aoe 50` | **Enxame Infinito**: spawn 6 `vor_larva` + 2 `vor_zangao` (max 12 larva + 4 zangão alive from this ship). cd 30 s | ready AND any enemy within 1200. Passive: allies within 300 get +2 HP/s regen | the engine of attrition; countered by EMP (halts regen 6 s), Luz Primordial out-ranging (800 vs 600). |

### 2.3 Ascendência Lúmen

| # | pt-BR name | id | class | cost | HP (crystal) | Shield cap / regen / delay | Spd | Turn |
|---|---|---|---|---|---|---|---|---|
| 1 | Centelha | `lum_centelha` | tiny | 3 | 25 | 30 / 6 / 2 | 210 | 420 |
| 2 | Prisma | `lum_prisma` | small | 6 | 70 | 100 / 12 / 3 | 150 | 250 |
| 3 | Véu | `lum_veu` | small | 6 | 60 | 120 / 15 / 3 | 145 | 240 |
| 4 | Harmônico | `lum_harmonico` | medium | 14 | 200 | 280 / 25 / 4 | 100 | 150 |
| 5 | Ressonante | `lum_ressonante` | medium | 11 | 200 | 320 / 25 / 4 | 100 | 150 |
| 6 | Serafim | `lum_serafim` | large | 24 | 500 | 700 / 45 / 5 | 70 | 90 |
| 7 | Catedral | `lum_catedral` | capital | 34 | 1000 | 1500 / 80 / 6 | 48 | 55 |
| 8 | Luz Primordial | `lum_luz_primordial` | mothership | 52 | 1800 | 3200 / 120 / 8 | 28 | 35 |

| # | Weapons | Signature ability | AI trigger | Counters / countered by |
|---|---|---|---|---|
| 1 | W1 `laser 5×1 / 0.5, 240, H` | **Piscar**: teleport 200 wu (away from nearest threat if shield down; toward target if out of range). cd 8 s | shield = 0 and hull < 100 % → away; else target distance > range+60 → toward | counters: organic tinies (laser ×1.3). Countered by flak (ignores most of its tiny shield), spores. |
| 2 | W1 `laser 14×1 / 0.7, 320, H` | **Sobrecarga de Escudo**: instantly restore 50 % shield cap; shield regen delay reset to 0. cd 15 s | shield < 20 % | counters: Terran small/medium and organics. Countered by Ferrix ion/railgun. |
| 3 | W1 `ion 10×1 / 1.0, 350, H` | **Manto**: grant an ally within 300 a temporary 120-pt shield layer for 8 s (stacks above its own shield) | ally medium+ within 300 with shield < 30 % cap, prefer highest cost. cd 16 s | support; counters enemy focus-fire; countered by being killed first (60 HP). |
| 4 | W1 `laser 30×1 / 1.0, 420, H` ("Lança Solar"); W2 `laser 5×2 / 0.5, 260, H` | **Foco Prismático**: for 4 s W1 +60 % dmg and +100 range | enemy large+ within 520 | counters: organics and Terran shields; countered by railguns (×1.4 crystal), Vorrax larvae swarms (laser acc 0.4 vs tiny). |
| 5 | W1 `ion 24×1 / 1.5, 400, 700` | **Pulso Dissonante**: aoe 220 around self: enemies lose 150 shield, shield regen + nanite repair + organic regen halted 5 s, speed −30 % 3 s. cd 25 s | ≥3 enemies within 220 OR enemy capital+ within 220 | counters: Terran capitals, Ferrix nanite repair, Vorrax regen. Countered by anything that kills it at range. |
| 6 | W1 `laser 45×2 / 1.4, 480, H` | **Salto Fásico**: teleport self + allies within 150 by up to 400 wu. Direction: away from enemy centroid if defensive; toward highest-value enemy if offensive | defensive: shield < 25 % AND ≥2 enemies within 300. offensive: ability ready, shield > 80 %, no enemy within 480 but enemy capital+ within 900 | counters: Terran large (kinetic weak vs shield), organics. Countered by Ferrix Ariete railgun, ion. |
| 7 | W1 `laser 90×1 / 3.0, 600, H, chain: +2 secondary targets within 150 for 45 each` ("Coro Radiante"); W2 `laser 5×2 / 0.5, 260, H` | **Aurora**: every ally within 400 restores 300 shield (capped) and gets +50 % shield regen for 6 s. cd 35 s | ≥3 allies within 400 with shield < 50 % | counters: medium clusters; keeps the line alive. Countered by Tempestade EMP, railgun focus. |
| 8 | W1 `laser 350×1 / 6.0, 800, H, charge 1.0 s (telegraphed), minTargetClass medium`; W2 `laser 8×4 / 0.6, 300, H` | **Singularidade**: gravity well at target point r=250 for 4 s: enemies pulled 120 wu/s toward center, 20 dmg/s (true damage, no type mult), projectiles inside curve toward center (visual only). cd 45 s | ≥4 enemies (or ≥2 medium+) within a 250-radius circle inside 800 | counters: swarms (pulls them into AoE), slow capitals. Countered by Ferrix railguns (×0.8 shield then ×1.4 crystal) and ion. |

### 2.4 Nexo Ferrix

| # | pt-BR name | id | class | cost | HP | DR | Repair (HP/s after 3 s) | Shield | Spd | Turn |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Vetor | `fer_vetor` | tiny | 2 | 40 | 0 | 3 | 0 | 185 | 380 |
| 2 | Sentinela | `fer_sentinela` | small | 5 | 120 | 0 | 4 | 0 | 140 | 230 |
| 3 | Disruptor | `fer_disruptor` | small | 5 | 100 | 0 | 4 | 0 | 145 | 240 |
| 4 | Fabricador | `fer_fabricador` | medium | 11 | 300 | 0 | 8 | 0 | 95 | 145 |
| 5 | Bastião | `fer_bastiao` | medium | 13 | 420 | 3 | 10 | 0 | 95 | 145 |
| 6 | Ariete | `fer_ariete` | large | 21 | 900 | 4 | 15 | 0 | 60 | 80 |
| 7 | Núcleo Fabril | `fer_nucleo` | capital | 31 | 1800 | 5 | 25 | 0 | 48 | 52 |
| 8 | Mente Primária | `fer_mente` | mothership | 48 | 3400 | 7 | 40 | 0 | 30 | 35 |

| # | Weapons | Signature ability | AI trigger | Counters / countered by |
|---|---|---|---|---|
| 1 | W1 `kinetic 3×1 / 0.3, 200, 650` (gatling) | **Sobrecarga**: +100 % fire rate for 3 s. cd 12 s | ≥3 other Vetores targeting the same enemy | counters: enemy tiny/small (crystal ×1.3). Countered by flak, spores. |
| 2 | W1 `railgun 26×1 / 2.0, 450, 1200` | **Modo Torre**: stop moving; +50 % range, +30 % dmg for 6 s. cd 20 s | no enemy within 250 AND an enemy within 675 | counters: Lúmen small/medium (railgun ×1.4 crystal, ignores DR vs Terran). Countered by fast tinies. |
| 3 | W1 `ion 8×1 / 0.8, 300, 600` | **Pulso EMP**: aoe 150: enemies lose 80 shield; shield regen, nanite repair, organic regen halted 4 s. cd 18 s | enemy with shield > 50 % cap within 150, OR enemy organic medium+ within 150 | counters: Lúmen shields, Vorrax regen. Countered by anything with real damage. |
| 4 | W1 `kinetic 8×1 / 0.7, 280, 650` | **Fabricar Drones**: spawn 3 `fer_vetor` (max 9 alive from this ship). cd 20 s | ready AND enemy within 900 | counters: attrition; countered by plasma (×1.3 nanite) and bio. |
| 5 | W1 `plasma 16×2 / 1.0, 320, 500` | **Nanitos Reativos**: repair 20 % max HP instantly; repair continues while being hit for 5 s. cd 25 s | hull < 35 % | brawler; counters Terran armored (plasma ×1.2) and other nanite ships. Countered by bio DoT (halts... no, bio does not halt; it just ×1.4) and lasers at range. |
| 6 | W1 `railgun 140×1 / 4.0, 650, 1500`; W2 `ion 8×1 / 0.8, 300, 600` | **Tiro Perfurante**: next railgun shot +50 % dmg and pierces: hits every enemy on a 650-wu line (max 4). cd 25 s | ≥2 enemies inside a 15° cone within range | counters: Lúmen large/capital, Terran capitals (ignores DR). Countered by Vorrax swarm (overkill on larvae), Carrapato leech. |
| 7 | W1 `railgun 70×2 / 3.0, 600, 1500`; W2 `ion 6×2 / 0.5, 240, 600` (PD; can target projectiles) | **Reconstrução**: all allies within 400 repair 15 % max HP over 5 s (works while under fire). cd 35 s | ≥3 allies within 400 with hull < 60 % | the Ferrix sustain anchor; countered by acid clouds (bio ×1.4), Rainha artillery. |
| 8 | W1 `railgun 300×1 / 7.0, 850, 1500, minTargetClass small`; W2 `ion 30×1 / 3.0, 500, 600, aoe 90` | **Tempestade EMP**: aoe 400 around self: enemies lose 400 shield; shield regen/nanite/organic regen halted 6 s; enemy weapon cooldowns +50 % for 4 s. cd 45 s | ≥5 enemies within 400 OR enemy mothership within 400 | counters: Luz Primordial, Prometeu, Colmeia regen. Countered by Vorrax larvae flood (300-dmg railgun on 30-HP larva), Lúmen Singularidade. |

**Fix to Cuspidor W1 for clarity:** `bio 18×1 / 2.5 s, range 420, speed 300, arcing, dot:{dps:3, duration:4}` — direct 18 + 12 over time.

---

## 3. Signature abilities as data (common trigger DSL)

Every ability is one object; the ship AI evaluates `trigger` every 5 ticks (0.25 s) in deterministic ship-id order:

```js
{
  id: 'reactive_armor', nameBR: 'Blindagem Reativa',
  cooldown: 25, duration: 6,
  trigger: { any: [ {hullBelow: 0.6}, {targetedByAtLeast: 3} ] },
  effects: [ {stat:'dr', add:10}, {stat:'shieldRegenMul', mul:3} ],
  sfx: 'armor_up', vfx: 'hex_flash'
}
```

Trigger predicates needed (complete list for the engineer): `hullBelow`, `shieldBelow`, `targetedByAtLeast`, `enemiesWithin {r, n, minClass}`, `alliesWithin {r, n, shieldBelow|hullBelow}`, `enemyClassWithin {class, r}`, `targetOutOfRangeBy`, `missileInbound`, `projectilesInboundWithin {r, n}`, `allyDiedWithin {r, sinceTicks}`, `enemiesInCone {deg, n}`, `clusterOfEnemies {r, n}`, `alliedCostFractionWithin {r, frac}`, `sameTargetAllies {n}`, `always`.

Effect kinds: `stat add/mul` (temporary), `heal`, `shieldRestore`, `spawn {shipId, n, maxAlive, lifetime}`, `teleport {dist, mode}`, `aoe {r, shieldDamage, disrupt, slow, dps}`, `latch`, `untargetable`, `cloud`, `gravityWell`, `aura`.

Spawned units: cost 0, do not count toward fleet caps, `maxAlive` per source ship, carry `sourceId`, and are included in snapshots like any ship (the renderer plays a spawn VFX/SFX on the `spawn` event).

---

## 4. Damage model

### 4.1 Type multipliers

Rows = weapon type; columns = what the hit lands on. Shield column applies while shield > 0; hull columns after.

| weapon | vs **shield** | vs **armored** | vs **organic** | vs **crystalline** | vs **nanite** | special |
|---|---|---|---|---|---|---|
| kinetic | 0.6 | 0.8 (then −DR) | 1.0 | 1.3 | 1.0 | +10 % if ≥3 Terran attackers (faction trait) |
| railgun | 0.8 | 1.2, **ignores DR** | 0.9 | 1.4 | 1.0 | long range, slow cd, overkills tinies |
| flak | 0.5 | 0.6 (then −DR) | 1.2 | 0.9 | 1.0 | AoE; can intercept missiles/torpedoes |
| laser | 1.2 | 0.9 (then −DR) | 1.3 (burn) | 0.6 (refract) | 1.0 | hitscan; poor accuracy vs tiny |
| plasma | 1.0 | 1.2 (then −DR) | 0.8 | 1.0 | 1.3 | slow projectile |
| missile | 0.9 | 1.0 (then −DR) | 1.1 | 1.0 | 1.0 | homing; interceptable |
| torpedo | 0.7 | 1.4 (then −DR) | 1.0 | 1.2 | 1.1 | only vs medium+; interceptable |
| bio | 0.4 | 1.1 (then −DR; DoT ticks ignore DR) | 1.0 | 0.8 | 1.4 | DoT; acid cloud halts shield regen |
| ion | 1.6 | 0.5 (then −DR) | 0.5 | 0.8 | 0.7 | every hit applies `disrupt` 1.5 s (regen/repair halted) |

**Design intent, by matchup:**
- Terran kinetic is bad into shields but great into crystal → Terran must pop Lúmen shields with missile/torpedo volume, then kinetic shreds. Lúmen lasers ×1.2 into Terran capital shields but Terran small/medium have no shield and DR eats laser chip damage.
- Vorrax bio is terrible into shields (0.4) → vs Lúmen they rely on plasma (1.0) and numbers; Lúmen lasers burn organics (1.3) but miss tinies (acc 0.4). Expected close.
- Ferrix railgun/ion dismantle Lúmen (0.8/1.6 shields, 1.4 crystal) → to keep it close, Lúmen have plasma-free rosters but Singularidade + Fase passive + blink kiting + Harmônico lasers neutral (1.0) into nanite. Risk flagged in section 7.
- Vorrax bio ×1.4 and plasma ×1.3 into nanite; Ferrix railguns overkill larvae and EMP halts regen. Expected close with EMP timing being the swing.

### 4.2 Accuracy by weapon type vs target size

| weapon | tiny | small | medium | large | capital | mothership |
|---|---|---|---|---|---|---|
| kinetic | 0.75 | 0.85 | 0.95 | 1.0 | 1.0 | 1.0 |
| railgun | 0.25 | 0.45 | 0.70 | 0.90 | 1.0 | 1.0 |
| flak | 0.95 | 0.90 | 0.70 | 0.50 | 0.40 | 0.30 |
| laser | 0.40 | 0.60 | 0.85 | 1.0 | 1.0 | 1.0 |
| plasma | 0.50 | 0.70 | 0.90 | 1.0 | 1.0 | 1.0 |
| missile | 0.50 | 0.70 | 0.90 | 1.0 | 1.0 | 1.0 |
| torpedo | — | — | 0.40 | 0.80 | 1.0 | 1.0 |
| bio | 0.60 | 0.80 | 0.95 | 1.0 | 1.0 | 1.0 |
| ion | 0.60 | 0.75 | 0.90 | 1.0 | 1.0 | 1.0 |

Modifiers: Ferrix "Rede Neural" +0.10 vs tiny/small (cap 1.0). Target speed > 150 wu/s: −0.05. Contact weapons (Carrapato mandibles) always 1.0.

### 4.3 Resolution pseudo-code (deterministic)

```js
function fireWeapon(ship, w, target, rng) {
  for (let s = 0; s < w.salvo; s++) {
    const acc = ACCURACY[w.accuracy][target.sizeClass] + accMods(ship, target);
    const hit = rng.next() < acc;                 // rolled at fire time, never at impact
    if (w.speed === 0) { if (hit) applyHit(ship, w, target); emit('beam', ...); }
    else spawnProjectile(ship, w, target, hit);   // miss = aimed at offset point, never collides
  }
}

function applyHit(src, w, t, dmg = w.damage) {
  let d = dmg * (src.buffDamageMul || 1);
  if (t.shield > 0) {
    const sd = d * SHIELD_MULT[w.type];
    const absorbed = Math.min(t.shield, sd);
    t.shield -= absorbed; t.shieldDelayTimer = t.shieldDelay;
    d = (sd - absorbed) / SHIELD_MULT[w.type];       // overflow returned to raw damage
    if (absorbed > 0) emit('shieldHit', ...);
    if (t.shield === 0) onShieldBreak(t);           // Lúmen 'Fase' passive
  }
  if (d > 0) {
    let hd = d * HULL_MULT[w.type][t.hullType];
    if (w.type !== 'railgun') hd = Math.max(1, hd - t.dr - t.tempDr);
    t.hp -= hd; t.lastHullHitTick = tick;           // resets nanite repair delay
    if (w.dot) addDot(t, w.dot, w.type);            // DoT ticks skip DR
    if (w.type === 'ion') t.disruptTicks = Math.max(t.disruptTicks, 30);
    emit('hullHit', ...);
    if (t.hp <= 0) kill(t, src);
  }
}

function regenTick(t) {           // called once per tick (dt = 0.05)
  if (t.disruptTicks > 0) { t.disruptTicks--; return; }
  if (t.shieldCap && t.shieldDelayTimer <= 0) t.shield = min(t.shieldCap, t.shield + t.shieldRegen*dt);
  if (t.hullType === 'organic') t.hp = min(t.maxHp, t.hp + t.regenHull*dt);
  if (t.hullType === 'nanite' && tick - t.lastHullHitTick >= 60) t.hp = min(t.maxHp, t.hp + t.repairHull*dt);
}
```

Overkill note: `kill()` emits a `death` event with `overkill = -t.hp` so the renderer can scale explosion size; Larva's death burst is processed in the same tick (deterministic order).

---

## 5. Target selection (so "counters" actually happen)

Per ship, every 10 ticks, score each enemy in `max(range)+150`:

```
score = (threatToMe * 0.3 + valueOfTarget * 0.4 + killability * 0.3) * typeAffinity * distanceFalloff
typeAffinity  = HULL_MULT[w.type][enemy.hullType] * (enemy.shield>0 ? SHIELD_MULT[w.type] : 1)
killability   = min(1, myDPS*3 / enemy.effectiveHPRemaining)
valueOfTarget = enemy.cost / 50
```

Plus role overrides: flak/PD prefer tinies and projectiles; torpedoes refuse < medium; Carrapato prefers highest-cost medium+; Disruptor prefers shield-fraction > 0.5. Target stickiness: keep current target unless a new one scores > 1.3×. This is what makes the matchups rock-paper-scissors rather than "everyone shoots the nearest thing".

---

## 6. Budgets, caps, presets

### 6.1 Budgets

| mode | pt-BR | points | typical fleet |
|---|---|---|---|
| skirmish | Escaramuça | 80 | no mothership (cannot afford a useful one) |
| standard | Padrão (default) | 150 | mothership + capital + line |
| total war | Guerra Total | 250 | two capitals, big line |

### 6.2 Caps (per player, enforced at fleet-build time)

- Mothership: max 1. Capital: max 2. Large: max 4.
- Total purchased ships: max 40 (performance budget: 6v6 × 40 = 480 purchased + spawns; spawns are capped per source as listed, worst case ≈ 700 entities — the sim must handle this at 20 tps; spatial hash required).
- Tiny: max 24 purchased. Vorrax exception: 32 (their identity), compensated by Larva being 1 pt and dying to flak.
- Minimum: ≥ 60 % of budget must be spent to press Play (prevents degenerate stalling fleets).
- Spawned units never exceed their `maxAlive`; a source ship dying freezes further spawns (existing survivors remain).
- Same-ship duplicates unlimited within class caps.

### 6.3 Default compositions (budget 150; all abide by caps)

**Confederação Terrana**
1. **Linha de Batalha** (balanced): Prometeu 50 + Hércules 24 + Órion ×2 (26) + Ártemis 11 + Falcão ×4 (24) + Vespa ×7 (14) = 149.
2. **Doutrina Atlas** (carrier/attrition): Atlas 32 + Hércules ×2 (48) + Ártemis ×2 (22) + Falcão ×4 (24) + Lança ×2 (10) + Vespa ×7 (14) = 150.
3. **Enxame de Mísseis** (alpha strike): Prometeu 50 + Órion ×4 (52) + Lança ×4 (20) + Falcão ×3 (18) + Vespa ×5 (10) = 150.

**Enxame Vorrax**
1. **Maré Viva** (swarm): Colmeia-Mãe 48 + Matriz ×2 (24) + Zangão ×8 (32) + Cuspidor ×4 (16) + Larva ×30 (30) = 150.
2. **Garras da Rainha** (brawl): Rainha 32 + Mandíbula ×2 (44) + Carrapato ×4 (40) + Zangão ×5 (20) + Larva ×14 (14) = 150.
3. **Chuva Ácida** (artillery/attrition): Colmeia-Mãe 48 + Rainha 32 + Cuspidor ×8 (32) + Matriz 12 + Zangão ×4 (16) + Larva ×10 (10) = 150.

**Ascendência Lúmen**
1. **Coro Radiante** (standard): Luz Primordial 52 + Serafim 24 + Harmônico ×2 (28) + Ressonante 11 + Prisma ×4 (24) + Centelha ×3 (9) = 148.
2. **Catedral Errante** (sustain): Catedral 34 + Serafim ×2 (48) + Véu ×3 (18) + Harmônico ×2 (28) + Prisma ×2 (12) + Centelha ×3 (9) = 149.
3. **Dissonância** (anti-shield/EMP): Luz Primordial 52 + Ressonante ×4 (44) + Prisma ×5 (30) + Véu ×2 (12) + Centelha ×4 (12) = 150.

**Nexo Ferrix**
1. **Linha de Ferro** (railgun line): Mente Primária 48 + Ariete ×2 (42) + Sentinela ×6 (30) + Disruptor ×2 (10) + Vetor ×10 (20) = 150.
2. **Fábrica Ambulante** (drones/sustain): Núcleo Fabril 31 + Fabricador ×3 (33) + Bastião ×3 (39) + Sentinela ×4 (20) + Disruptor ×3 (15) + Vetor ×6 (12) = 150.
3. **Apagão** (EMP alpha): Mente Primária 48 + Ariete 21 + Disruptor ×6 (30) + Bastião ×2 (26) + Sentinela ×3 (15) + Vetor ×5 (10) = 150.

AI opponents at difficulty levels pick: Fácil = random legal fleet (60–80 % budget); Normal = a preset; Difícil = the preset with the best historical win-rate vs the human's faction (lookup table generated by the balance sim); Brutal = Difícil + counter-pick (picks a preset after seeing the human's fleet).

---

## 7. Cross-faction balance plan

### 7.1 Expected matchup map (before tuning)

| | Terran | Vorrax | Lúmen | Ferrix |
|---|---|---|---|---|
| **Terran** | 50 | 50±5 (flak vs swarm, acid vs armor) | 45–50 (lasers ×1.2 shields, but kinetic ×1.3 crystal) | 50±5 (railgun ignores DR; missiles 1.0 nanite) |
| **Vorrax** | | 50 | 45–50 (bio 0.4 shield is the risk) | 52–55 (bio/plasma into nanite; EMP is Ferrix's answer) |
| **Lúmen** | | | 50 | **42–48 — most at-risk matchup** (ion ×1.6, railgun ×1.4) |
| **Ferrix** | | | | 50 |

Pre-planned levers if Lúmen vs Ferrix falls below 40 %: (a) crystalline vs railgun 1.4 → 1.2; (b) Fase passive untargetable 1.0 → 1.5 s; (c) Ferrix ion vs shield 1.6 → 1.4 (ion still ≥ laser). Pre-planned lever if Vorrax beats Ferrix > 60 %: nanite repair delay 3 s → 2 s, or EMP disrupt 4/6 s → 5/8 s. If Terran under-performs everywhere: DR values +1 on medium+, or kinetic vs shield 0.6 → 0.7.

### 7.2 Headless simulation protocol (`node tools/balance.mjs`)

1. **Mirror sanity (bias check).** Each preset vs itself, both spawn sides, 100 seeds. Expected 50 % ± 4 (binomial 95 % at n=100 is ±10, so use 400 seeds for the final gate). Any deviation beyond that is a *map/order bug* (spawn side advantage, tick-order advantage), not a balance issue — fix before tuning numbers.
2. **Faction matrix.** 12 presets × 12 presets (incl. mirrors) × 30 seeds × 2 sides = 8 640 battles at budget 150. Also run budget 80 (no motherships) and 250 (2 capitals) with 10 seeds each to catch cap-dependent degeneracy.
3. **Aggregate per faction pair** (3×3 presets pooled): acceptance **40–60 % win-rate for every faction vs every other faction**. Per preset pair: **25–75 %** (hard counters allowed, stomps not).
4. **Per-ship value audit.** From event logs compute `value_i = (damage dealt + damage absorbed*0.5 + healing/shield restored*0.7 + value of kills secured*0.3) / cost_i`, averaged over all battles the ship appeared in. Any ship outside **0.65×–1.5× of the median** gets its cost adjusted ±1 (or ±2 for large+) and the matrix re-runs. Iterate ≤ 8 rounds; converge when no ship moves.
5. **Pace gate.** Median battle length 60–150 s sim-time; p95 < 240 s; draws (both sides alive at 300 s hard cap, or both motherships dead same tick) < 2 %. If Vorrax/Ferrix regen fights exceed p95, raise disrupt durations or add a "Morte Súbita" phase at 240 s: all regen/repair/shield regen off, announced in UI.
6. **Determinism gate.** Same seed + same fleets → identical final snapshot hash in Node and in the browser (run the engine in a Worker, compare hashes); run as a unit test.
7. **Difficulty gate.** Normal AI preset vs human-like random-legal fleets should win 55–65 %; Difícil 70–80 %.

Pseudo-code:

```js
for (const [a, b] of pairs(presets))
  for (const seed of seeds)
    for (const flip of [false, true]) {
      const r = runBattle({ left: flip ? b : a, right: flip ? a : b, seed, maxTicks: 6000 });
      record(a, b, r.winner, r.ticks, r.unitStats);
    }
printMatrix(); printOutliers(); writeJSON('balance-report.json');
```

Performance target for the runner: ≥ 50 battles/s on a laptop core (no rendering, spatial hash, typed arrays for projectiles) so a full matrix is ~3 minutes; run it with `--workers=os.cpus()`.

### 7.3 Risks (flagged)

1. **Spawners inflate effective budget.** Matriz/Fabricador/Atlas/Colmeia/Mente create free units; `maxAlive` and lifetimes are the lever. Watch for "double Matriz + Colmeia" producing 30+ larvae every 20 s and hitting the entity ceiling — the per-source caps sum to 12+6+6 = 24 extra larvae max, which is intentional but must be perf-tested at 6v6.
2. **Teleport AI (Lúmen).** Blink/Salto Fásico need a "safe destination" check (inside arena, not inside another hull) and a deterministic direction rule; naive implementations oscillate (jump in, jump out). Add 2 s "no re-evaluate" after a jump.
3. **Hitscan vs projectile fairness.** Lúmen lasers hit instantly; everyone else's shots travel 0.3–1.5 s and can be dodged by blinks/afterburners. Accuracy roll at fire time (not at impact) keeps it deterministic and simple; it also means projectiles never "miss by movement", so dodging abilities must be modelled by `untargetable`/`autoMiss` flags, not by geometry.
4. **EMP chain-lock.** Three Disruptors can keep a target disrupted permanently (4 s each, 18 s cd — not permanent alone, but with Ressonantes it can be). Cap: a ship cannot be re-disrupted for 2 s after a disrupt expires (`disruptImmunityTicks`).
5. **Flak intercept ordering.** Interceptors must claim a projectile deterministically (lowest ship id first), otherwise two Ártemis "kill" the same missile and the second wastes its shot — minor but it shows up in balance numbers.
6. **Carrapato latch** needs a hard rule when its host dies or teleports (detach, stun 0.5 s) and must not latch to motherships from the opposite side of the arena (range 150 check at cast).
7. **Chain beam (Catedral) and pierce (Ariete)** are the only multi-target direct hits; make sure the `hit` events carry all targets so the renderer draws the fork.
8. **Lore/name collisions:** avoid "Protoss/Zerg"-style terms; the pt-BR names above are original. "Vorrax", "Lúmen", "Ferrix" are intentionally short for UI badges.

---

## 8. One-line summary per faction for the UI faction-select screen (pt-BR)

- **Confederação Terrana** — "Blindagem, mísseis e disciplina. Equilibrada; escudos apenas nas naves-capitais."
- **Enxame Vorrax** — "Cascos vivos que se regeneram. Sem escudos, sem recuo, sem fim."
- **Ascendência Lúmen** — "Escudos de luz, cascos de cristal. Feixes precisos e saltos de fase."
- **Nexo Ferrix** — "Nanitos que se reconstroem, canhões magnéticos e pulsos EMP. Fria eficiência."