# Proposta de Direção Visual — "Frota Estelar"
## Lente: arte procedural em Canvas 2D (zero assets externos)

Tudo abaixo assume: mundo fixo 16:9, simulação 20 Hz, renderer apenas consome snapshots/eventos. Identificadores em inglês, texto de UI em pt-BR.

---

## 0. Princípios (opinião, resumida)

1. **Silhueta antes de detalhe.** Com 500+ naves a zoom 0,4 só a silhueta e a cor emissiva sobrevivem. Cada facção precisa ser reconhecível por forma + por "textura de borda" (reta / orgânica / facetada / modular).
2. **Material = 3 tons + 1 borda + 1 emissivo.** Gradientes verticais de 3 cores (sombra/meio/luz), um traço de borda, e uma camada emissiva (luzes, motores, núcleo). Nada de `shadowBlur` em loop quente — brilho vem de **sprites de glow pré-renderizados** (gradiente radial em canvas pequeno, blitado com `lighter`).
3. **Facção é o corpo, time é a luz.** Casco mantém o material da facção; **tudo que emite luz** (motores, núcleos, luzes de posição, listras de marcação, escudo) recebe a cor do time. Isso resolve o conflito "4 facções × 2 times" sem criar 8 paletas.
4. **Cache tudo que é estático, anime só o emissivo.** Casco vai para um offscreen por (classe, time, bucket de zoom, estado de dano). Partes animadas (chama, anel, núcleo, asa) são desenhadas por cima a cada frame, com no máximo 2–4 operações por nave.
5. **Orçamento explícito.** Partículas em pool SoA de 6 000, beams em lista de 256, decals em 512; qualidade adaptativa reduz densidade quando o frame passa de 16 ms.

---

## 1. Direção de arte por facção

Esquema de time (dois lados, até 6 jogadores por lado):

| Time | Nome UI | `team` | `teamDim` | `teamGlow` (centro do glow sprite) |
|---|---|---|---|---|
| A | Azul | `#3fb6ff` | `#1a5f8f` | `#bfe9ff` |
| B | Laranja | `#ff7a3d` | `#8f3a1a` | `#ffd2b8` |

Jogadores dentro de um time recebem um **marcador** secundário (não cor): um pequeno glifo numérico na seleção/HUD e uma listra fina com padrão (sólido, tracejado, duplo, pontilhado, chevron, cruz) na camada `markings`. Não misturar mais matizes: no calor da batalha o jogador precisa só saber "meu lado × lado deles".

Resolução de cores por nave: a função `palette(factionId, teamId)` retorna um dicionário de nomes → cor, e os layers do sprite referenciam nomes, nunca hex.

### 1.1 Confederação Terrana (`terran`) — humanos, aço angular

- **Silhueta:** cunhas, placas sobrepostas, ângulos de 30°/45°/90°, proa pontiaguda, popa larga com 2–3 bocais retangulares. Nenhuma curva, exceto a cúpula do cockpit. Naves grandes são "arranha-céus deitados": superestrutura em degraus.
- **Paleta:**
  - `hullDark #2a3240`, `hullMid #4b5665`, `hullLight #8a96a6`, `hullEdge #c9d3df`
  - `accent #d9a21b` (listras de aviso amarelas, pintura industrial), `panelLine #1a2029`
  - `team`, `teamDim`, `teamGlow` do time
- **Material (aço):** gradiente linear perpendicular ao eixo da nave (`hullLight` no topo → `hullMid` → `hullDark` na base, com uma banda de reflexo estreita a 35% do caminho: `+10% luminância` em 3% de largura). Borda `hullEdge` 1,5 px (em unidades de design, escala com zoom até mínimo 1 px). Linhas de painel: polilinhas `panelLine` de 0,8 px desenhadas em padrão determinístico (seed = hash do id da classe) cruzando o casco em ângulos retos. Rebites: pontos de 1 px `hullLight` ao longo das bordas a cada 6 unidades (só no bucket de zoom ≥ 1).
- **Detalhes animados:**
  - Chama de motor: cone de 2 camadas (externo `team` alpha 0,5, interno `#ffffff` alpha 0,9), comprimento = `8 + 10*thrust + ruído(t*30)*3` unidades, largura do bocal.
  - Luzes de posição piscando (`team`) a 1 Hz na ponta das asas; estroboscópio branco 0,1 s a cada 2 s em capitais.
  - Torres giram para o alvo (ângulo vem do snapshot: `turretAngle` por torre ou derivado do alvo).
  - Hangar de porta-naves: retângulo com luz interna `team` pulsando quando lança drones.
- **Tinta de time:** listras diagonais em `team` na camada `markings` (2 listras na proa, 1 faixa na superestrutura), bocais e luzes `team`, escudo `team`.

### 1.2 Enxame Vorrash (`vorrash`) — insectoide orgânico

- **Silhueta:** corpos segmentados (cabeça–tórax–abdômen), carapaça convexa, mandíbulas, patas/espinhos assimétricos em pares, "asas" membranosas translúcidas. Tudo com curvas (polígonos suavizados Catmull-Rom). Naves grandes são rainhas: abdômen enorme com segmentos em anéis, sacos de ovos luminosos.
- **Paleta:**
  - `hullDark #2e1a24`, `hullMid #5a2d3a`, `hullLight #9c4d4f`, `hullEdge #d98d6a` (quitina marrom-vinho com reflexo cobre)
  - `accent #7dd957` (ácido/bile verde — usado em armas, nunca como cor de time)
  - `membrane rgba(220,150,170,0.35)` para asas
  - bioluminescência = `team`
- **Material (quitina):** gradiente **radial** por segmento (centro deslocado 30% para a "luz" = `hullLight`, borda `hullDark`), o que dá volume de "cápsula". Borda `hullEdge` 1,2 px com alpha 0,8. Textura: 4–8 "placas" por segmento = linhas curvas `hullDark` alpha 0,5. Brilho especular: um pequeno arco branco alpha 0,35 no topo de cada segmento. Membranas: fill translúcido + nervuras (3–5 linhas radiais `hullEdge` alpha 0,4).
- **Detalhes animados:**
  - Respiração: segmento abdominal escala `1 + 0.03*sin(t*2.5 + phase)`; naves do mesmo tipo têm `phase` diferente (hash do id da entidade).
  - Patas/espinhos: `rotate(sin(t*6)*4°)` alternando pares.
  - Asas: flex `scaleY(0.9..1.05)` a 8 Hz nos pequenos, 1,5 Hz nos grandes.
  - Pontos bioluminescentes (`team`) pulsam `0.6 + 0.4*sin(t*3 + i)`.
  - Sacos de ovos na rainha brilham mais forte 0,5 s antes de lançar larvas.
- **Tinta de time:** todos os pontos bioluminescentes, olhos compostos, nervuras das asas (alpha 0,5) e a cauda de ácido (mistura 60% `accent` + 40% `team`).

### 1.3 Coro Lúmen (`lumen`) — raça de energia/cristal

- **Silhueta:** prismas alongados, losangos, hexágonos alongados; **partes desconectadas que flutuam** (fragmentos orbitando um núcleo). Simetria perfeita, bordas afiadas, sem motores visíveis — propulsão é um rastro de luz.
- **Paleta:**
  - `crystalDeep #3b2a7a`, `crystalMid #7c5cff`, `crystalLight #d7ccff`, `crystalEdge #ffffff`
  - `inner #b8f0ff` (refração ciano), `facet rgba(255,255,255,0.18)`
  - núcleo e halo = `team`
- **Material (cristal):** fill com alpha 0,78 (translúcido — permite ver projéteis atrás). Gradiente linear ao longo do eixo longo (`crystalDeep` → `crystalMid` → `crystalLight`). Facetas: triângulos internos preenchidos com `facet` ou `inner` alpha 0,2 em padrão de leque a partir do centro. Borda `crystalEdge` 1 px alpha 0,9 + uma segunda borda interna deslocada 2 unidades em `crystalMid` alpha 0,5 (dá espessura). Aberração cromática barata: desenhar a borda 3× deslocada ±0,7 px em `#ff5aa0`/`#5affd0` alpha 0,25 — só em bucket ≥ 1.
- **Detalhes animados:**
  - Núcleo: círculo `team` raio `r0*(1 + 0.15*sin(t*4))` + glow sprite 3× maior.
  - Anéis rotativos: 1–3 anéis (arcos de 270°) ao redor do núcleo, girando a 20–60°/s em sentidos opostos.
  - Fragmentos orbitais: posições `(cx + R*cos(t*w + k), cy + R*sin(...)*0.4)` — órbita elíptica achatada, "bob" vertical.
  - Cintilação: a cada 0,3–0,8 s uma faceta aleatória recebe um flash branco alpha 0,6 por 80 ms.
- **Tinta de time:** núcleo, halo, anéis, fragmentos menores (fill 50% `team`), rastro de propulsão. O corpo violeta é constante — como o violeta está equidistante do azul e do laranja, funciona para ambos.

### 1.4 Convergência (`nanite`) — coletivo de máquinas/nanitas

- **Silhueta:** blocos modulares, hexágonos e quadrados em grade, braços em cruz, anéis segmentados. Naves grandes são **toros e treliças** com um reator no centro; os blocos "piscam" como um autômato celular. Nenhuma simetria obrigatória de nave viva — mas mantemos simetria bilateral para leitura de direção.
- **Paleta:**
  - `hullDark #121a1c`, `hullMid #263538`, `hullLight #4d6a6e`, `hullEdge #7fb3a8`
  - `accent #9bffd6` (traços de circuito verde-menta — assinatura da facção)
  - `cellOff #1a2426`, `cellOn` = `team`
- **Material (nanita):** fill plano `hullMid` + grade de 1 px `hullDark` a cada 4 unidades (clip ao polígono). Blocos "ativos": quadrados 3×3 em `team` alpha 0,8 em posições de uma grade determinística. Traços de circuito: polilinhas ortogonais `accent` alpha 0,6 com pontos brilhantes correndo (`dash offset` animado). Borda `hullEdge` 1 px. Sem gradientes — o contraste com as outras facções vem da ausência deles.
- **Detalhes animados:**
  - Autômato: a cada 0,25 s uma célula aleatória (hash determinístico de `(entityId, floor(t*4))`) alterna on/off; 20–40 células por nave grande, 4–6 por pequena.
  - Anel segmentado gira 15°/s; os segmentos "saltam" 1 unidade para fora quando a nave dispara.
  - Reator central: hexágono `team` com `lineDashOffset` animado para parecer que gira.
  - Ao morrer: a nave **se desmonta em blocos** (ver explosão).
- **Tinta de time:** `cellOn`, reator, anel, bocais (pontos, não chama), nuvem de nanitas.

---

## 2. Sistema de sprites procedurais

### 2.1 Espaço de design e estrutura de dados

- Espaço de design: **100 × 100 unidades, origem no centro, nave aponta para +x** (coordenadas em [-50, 50]). A escala real vem de `def.size` (diâmetro em unidades de mundo). `size=12` interceptor, `size≈120` nave-mãe.
- Simetria: polígonos marcados `mirror:true` são definidos **só para y ≤ 0** (metade superior) e espelhados em y = 0 automaticamente (o último ponto e o primeiro fecham pelo eixo). Polígonos assimétricos (`mirror:false`) são permitidos para detalhes.

```js
// ShipDef (data only, shareable between server and client)
export const TERRAN_CORVETTE = {
  id: 'terran_corvette', faction: 'terran', size: 14,
  style: { edge: 'sharp' },              // 'sharp' | 'smooth' (Catmull-Rom) 
  layers: [
    // order = draw order; z<0 = behind animated details, z>0 = in front
    { kind: 'poly', name: 'wing',    pts: [[-22,-6],[-34,-26],[-14,-28],[6,-10]], mirror: true,
      fill: 'grad:hull', stroke: 'hullEdge', lw: 1.2 },
    { kind: 'poly', name: 'hull',    pts: [[-40,0],[-36,-9],[-12,-11],[18,-7],[48,0]], mirror: true,
      fill: 'grad:hull', stroke: 'hullEdge', lw: 1.5, panels: 3, rivets: true },
    { kind: 'poly', name: 'canopy',  pts: [[8,0],[10,-3],[22,-3],[30,0]], mirror: true,
      fill: 'grad:canopy', stroke: 'hullEdge', lw: 0.8 },
    { kind: 'stripe', pts: [[26,-4],[30,-1],[34,-4],[30,-7]], mirror: true, fill: 'team' },
    { kind: 'light', x: -30, y: -27, r: 1.5, color: 'team', blink: 1.0 },   // mirrored by default
  ],
  engines: [ { x: -40, y: 5, w: 5 }, { x: -40, y: -5, w: 5 } ],   // nozzle center, width
  turrets: [ { x: 20, y: 0, kind: 'fixed', weaponSlot: 0 } ],
  anim:    [],                                                  // see §2.4
  damage:  { scorch: 6, sparkPoints: [[-10,-6],[12,4]] },       // decals per damage state
};
```

Tipos de `fill`: nome de cor (`'hullMid'`, `'team'`), `grad:hull` (gradiente material da facção calculado sobre o bbox do layer), `grad:canopy` (cockpit: `#9fd8ff`→`#143a5a`), `grad:radial` (quitina), `cells` (grade nanita), `facets` (cristal). A função `materialFill(ctx, facção, nomeFill, bbox, palette)` resolve isso.

### 2.2 Cache de sprites

- Chave: `` `${def.id}|${team}|${zoomBucket}|${dmgState}` ``.
- `zoomBucket ∈ {0.35, 0.5, 0.71, 1.0, 1.41, 2.0}` (passos de √2) × `dpr` (máx 2). O blit usa `zoomReal/zoomBucket` como escala residual (sempre entre 0,84 e 1,19 — sem blur perceptível).
- `dmgState ∈ {0: íntegra, 1: <60% casco (fuligem), 2: <30% (rachaduras + placas faltando)}`. Decals determinísticos: `scorch` manchas radiais pretas alpha 0,5 em posições `hash(def.id, i)`; estado 2 também remove (`destination-out`) 2–3 pequenos triângulos nas bordas.
- Tamanho do offscreen: `ceil(def.size * bucket * dpr * 1.25)` quadrado (margem de 25% para glow de borda), limite 512 px. Naves-mãe a zoom 2 × dpr 2 = 120·2·2·1,25 = 600 → clamp 512, escala residual compensada.
- Orçamento: 4 facções × ~7 classes × 2 times × 6 buckets × 3 estados = 1 008 sprites possíveis, mas construídos **lazy** no primeiro uso; pré-aquecer os buckets 0,5/0,71/1,0 das classes presentes na batalha durante a tela "Preparando batalha" (barra de progresso real). Memória típica em batalha: ~120 sprites × média 64 KB ≈ 8 MB. LRU com teto de 400 entradas.
- **Abaixo do bucket 0,35 (LOD 0)** não há sprite: a nave é um triângulo `hullLight` + ponto `team` de 2 px. Entre 0,35 e 0,5 (LOD 1) usa-se o sprite mas sem layers `rivets/panels/facets/cells` (flag `detail:false` no builder) e sem detalhes animados além da chama.

### 2.3 Polígonos concretos (metade y ≤ 0, espelhar em y=0)

**Terran — "Lança" (corvette, size 14)** — acima em §2.1.

**Terran — "Bastião" (dreadnought/nave-mãe, size 110)**
```
hullMain  (mirror): [-50,0],[-48,-8],[-42,-12],[-30,-11],[-22,-17],[12,-17],[32,-12],[46,-6],[50,0]
superStr  (mirror): [-26,0],[-26,-7],[-18,-10],[4,-10],[10,-6],[14,0]          // fill hullLight, z=+1
bridgeTower(mirror):[-12,0],[-12,-4],[-4,-5],[0,0]                              // fill grad:canopy
hangarBay (mirror): [-6,-17],[-6,-21],[18,-21],[22,-17]                         // fill hullDark, inner light 'team' alpha .4
armorPlateFwd(mirror): [20,-11],[22,-14],[40,-8],[44,-5]                         // fill hullMid, stroke hullEdge
sternBlock(mirror): [-50,-8],[-50,-12],[-44,-14],[-40,-12]                      // fill hullDark
stripes: 3 diagonal 'team' stripes on hullMain near x=30..40 (4 units wide, 2 gap)
engines: (-50,±4,w4), (-50,±10,w3), (-50,0,w5)
turrets: (-20,±12,'heavy'), (0,±14,'heavy'), (22,±9,'medium'), (38,0,'spinal'), (-36,±10,'pd'), (8,±8,'pd')
lights: (-30,±17 blink 1Hz), (48,0 strobe)
```
Outros Terran (descrição): **Fragata "Escolta"** (size 24) — "Lança" esticada com dois pods laterais retangulares de mísseis; **Destróier "Vanguarda"** (size 36) — proa dupla (garfo) com trilho de railgun exposto no eixo central desenhado como uma linha `accent`; **Cruzador "Paladino"** (size 56) — Bastião sem hangar, superestrutura em 3 degraus; **Porta-naves "Cidadela"** (size 90) — casco retangular achatado com 2 hangares laterais abertos (fill `hullDark` + luz `team`), 4 drones "Lança" miniaturizados (`size 7`).

**Vorrash — "Ferrão" (stinger drone, size 12)**, `style.edge='smooth'`
```
head    (mirror,smooth): [32,0],[28,-7],[14,-9],[8,-5]                           // grad:radial, eye at (24,-4) r1.6 'team'
thorax  (mirror,smooth): [10,-9],[-4,-13],[-18,-9],[-14,-2]                       // grad:radial
abdomen (mirror,smooth): [-14,-7],[-30,-11],[-44,-6],[-48,0]                      // grad:radial, segments:3
mandible(mirror, no smooth): [30,-5],[40,-9],[44,-3],[34,-2]                      // fill hullEdge alpha .9
legs    (mirror, stroke only lw1.2 hullEdge): [[-2,-10],[-10,-20],[-4,-26]], [[6,-9],[0,-20],[8,-24]]
wing    (mirror): [-6,-10],[-24,-30],[-2,-34],[14,-14]                            // fill membrane, veins 3
glowSpots: (-22,±6 r1.5), (-34,±4 r1.2), (-42,±2 r1)                              // 'team', pulse
engines: (-48,0,w4)  → rendered as 'spore trail', not flame
anim: [{type:'flex', layer:'wing', axis:'y', amp:0.08, hz:8}, {type:'breathe', layer:'abdomen', amp:0.03, hz:2.5}, {type:'wiggle', layer:'legs', deg:4, hz:6}]
```
**Vorrash — "Matriarca" (hive mother, size 120)**
```
head     (mirror,smooth): [50,0],[46,-8],[34,-14],[22,-10]                       // 2 compound eyes (40,±5) r3 'team' with hex pattern
thorax   (mirror,smooth): [24,-14],[8,-24],[-10,-22],[-14,-8]                    // 6 leg stubs stroke lw2
abdomen1 (mirror,smooth): [-10,-20],[-26,-28],[-40,-22],[-44,-6]                 
abdomen2 (mirror,smooth): [-38,-18],[-48,-16],[-50,-4],[-46,0]                   // tail
eggSacs  : 6 ellipses on abdomen1 at (-18,±14,r4),(-30,±16,r4.5),(-38,±10,r3.5)   // fill 'team' alpha .55 + glow; brighten before spawn
spines   (mirror, stroke lw2 hullEdge): [[-4,-24],[-10,-40]], [[-20,-28],[-24,-44]], [[12,-20],[14,-34]]
wingL/R  (mirror): [0,-22],[-30,-50],[-48,-44],[-28,-26]                          // membrane, veins 5, flex 1.5Hz
mandibles(mirror): [44,-8],[58,-14],[62,-6],[50,-3]                               // overhangs the 100 box deliberately (bbox computed from pts)
engines: (-50,±3,w6) spore trail
turrets: (30,±8,'acid'), (0,±20,'spore'), (-20,±24,'acid'), (46,0,'tendril')
anim: breathe abdomen1 amp .04 hz 1.2; wiggle spines; flex wings
```
Outros Vorrash: **"Vespa"** (size 22) — Ferrão com asas maiores e 2 pods de ácido; **"Besouro"** (size 34) — carapaça dupla convexa (2 polígonos sobrepostos com highlight), sem asas, tanque; **"Louva-a-deus"** (size 52) — braços foice dobrados para frente (tendril beam), tórax alto; **"Ninho"** (size 85) — abdômen esférico (porta-larvas), 8 sacos de ovos.

**Lumen — "Fragmento" (shard, size 12)**
```
body    (mirror): [46,0],[6,-10],[-30,-7],[-46,0]                                 // crystal fill alpha .78
facets  : triangles (6,-10)-(46,0)-(6,0) 'inner' a.2 ; (6,-10)-(-30,-7)-(6,0) 'facet'
core    : circle (0,0) r3 'team' + glow x3
orbiters: 3 mini shards (len 5) orbiting R=14, w=90°/s, ellipse 0.45, fill 'team' a.6
edges   : white 1px + chromatic (bucket>=1)
engines : none; trail 'light' from (-46,0)
anim: [{type:'orbit', n:3, R:14, w:90, squash:.45}, {type:'pulse', layer:'core', amp:.15, hz:4}, {type:'twinkle', every:[0.3,0.8]}]
```
**Lumen — "Catedral" (size 115)**
```
prism      (mirror): [50,0],[22,-13],[-8,-18],[-38,-11],[-50,0]                   // main crystal
spire      (mirror): [-4,-18],[0,-30],[6,-18]                                     // top spire, drawn z=+1
wingShardA (mirror, detached, bob 0.6Hz amp 2): [8,-22],[-10,-40],[-28,-34],[-14,-22]
wingShardB (mirror, detached, bob 0.45Hz amp 3): [-26,-18],[-46,-30],[-54,-20],[-40,-12]
tailShards : 4 small shards trailing at x=-52..-70 along y=±4, scale decreasing, alpha .6 → .2
core       : circle (0,0) r12 'team' + glow x3 (the brightest thing on screen besides explosions)
rings      : arc r20 (270°, +30°/s, lw2 'team' a.8), arc r27 (240°, -18°/s, lw1.5 'crystalLight' a.6), arc r34 (300°, +10°/s, lw1 'team' a.4)
facets     : fan of 8 triangles from (0,0) to prism edge, alternating 'facet'/'inner'
turrets    : (36,0,'lance'), (10,±14,'prism'), (-20,±10,'arc'), ring points for 'plasma' x4
anim: orbit n=6 R=42 squash .35 w=25 (medium shards, fill crystalMid a.7); pulse core; twinkle
```
Outros Lumen: **"Prisma"** (size 24) — losango duplo (dois Fragmentos cruzados em X, um girando 90° lentamente); **"Lâmina"** (size 36) — prisma longo e fino com 2 fragmentos laterais fixos, canhão lance no eixo; **"Coro"** (size 54) — 3 prismas em triângulo ao redor de um núcleo, cada um girando sobre si; **"Portal"** (size 80) — anel de cristal (torus de 12 segmentos) com núcleo vazio que acende ao teleportar aliados.

**Nanite — "Nó" (node, size 12)**
```
core   (mirror): [10,0],[5,-9],[-5,-9],[-10,0]                                    // hexagon, fill cells (grid 3)
armFwd (mirror): [10,-2],[10,-5],[30,-5],[34,-2],[34,0]                            // fill hullMid, trace accent along center
armSide(mirror): [-2,-9],[-2,-12],[4,-24],[8,-24],[8,-9]
blocks : 4 cubes 4x4 at (-12,±6),(18,±7) 'cellOn' a.8 → these are the "engines" (points, no flame)
reactor: hexagon r4 'team' lineDashOffset anim
traces : polyline [[-12,0],[-6,0],[-6,-4],[0,-4],[0,0],[30,0]] accent a.6 + running dot
anim: [{type:'automaton', n:6, hz:4}, {type:'dashspin', layer:'reactor', speed:40}]
```
**Nanite — "Ômega" (assembler, size 120)**
```
ring      : torus r=38, thickness 12, 24 segments (trapezoids), fill hullMid, gaps 2 units, rotates 15°/s;
            every 3rd segment has a 'cellOn' block; segments pop out +2 units for 150ms when any weapon fires
crossArm  (mirror): [-50,-3],[-50,-9],[-14,-9],[-14,-3]  and vertical arm [-3,-14],[-9,-14],[-9,-50],[-3,-50] (mirror both axes via second def with mirror:true and rotate 90)
spineFwd  (mirror): [14,-4],[14,-8],[48,-8],[52,-4],[52,0]                           // forward spine, railgun-like 'disassembler' emitter at (52,0)
hub       : hexagon r14 fill cells grid 4 ; reactor hexagon r8 'team' + glow x2.5
lattice   : 12 thin struts from hub to ring, stroke hullEdge a.5 lw1
cells     : 36 automaton cells across hub+arms
turrets   : (52,0,'disassembler'), ring points x6 'pulse', (-40,±6,'emp'), hub 'swarm' launcher x2
engines   : 6 'cellOn' blocks on the stern arms (no flame; emit a faint team-colored pixel stream)
anim: ringspin 15; automaton n=36 hz 4; dashspin reactor; lattice shimmer (alpha .4..6 hz .7)
```
Outros Nanite: **"Célula"** (size 22) — 3 "Nós" fundidos em linha; **"Treliça"** (size 36) — retângulo vazado com 2 anéis pequenos nas pontas; **"Replicador"** (size 55) — hub com 2 anéis concêntricos contra-rotativos, lança nuvem de nanitas; **"Fundição"** (size 85) — cruz grande com 4 hubs; reparadora (feixes de nanita).

### 2.4 Detalhes animados (desenhados por cima do sprite cacheado)

| `anim.type` | Parâmetros | Custo/frame | Facções |
|---|---|---|---|
| `flame` (automático dos `engines`) | thrust do snapshot | 2 fills por bocal | terran |
| `sporeTrail` | emite 1 partícula/60 ms | partícula | vorrash |
| `lightTrail` | linha gradiente 20 un. atrás | 1 stroke | lumen |
| `pixelStream` | 3 pontos team a 1 px | 3 fillRect | nanite |
| `pulse` | amp, hz | 1 arc + 1 glow blit | lumen, vorrash |
| `orbit` | n, R, w, squash | n polígonos pequenos | lumen |
| `ringspin` / `arc rings` | speed | n arcs | lumen, nanite |
| `automaton` | n, hz | n fillRect | nanite |
| `flex` / `breathe` / `wiggle` | layer, amp, hz | re-desenha o layer (não cacheado) | vorrash |
| `blink` / `strobe` | hz | 1 glow blit | terran |
| `turret` | ângulo | 1 pequeno sprite cacheado por tipo | todos |

Regra de orçamento: por nave, no máximo **6 draw calls animadas** no bucket ≥ 0,71, **2** no bucket 0,5, **0** abaixo. `flex/breathe/wiggle` dos Vorrash são caros (re-desenham polígono com gradiente radial) — só em bucket ≥ 1 e naves de `size ≥ 30`; pequenos usam o sprite estático com `scale(1, 1+0.04 sin)` no blit inteiro (barato e lê igual).

---

## 3. Catálogo de VFX

Convenções: `G(color, r)` = blit de glow sprite (gradiente radial `rgba(c,1)→rgba(c,0)`, 64×64 cacheado por cor) com `lighter`. Tempos em ms. Partículas usam o pool (§6.2). Todas as cores emissivas de arma: 70% cor da arma + 30% cor do time (`mix(weaponColor, team, 0.3)`), para que o jogador identifique quem atira sem perder a identidade da arma.

### 3.1 Projéteis (posições vêm do snapshot; o renderer só decora)

| Arma | Facção típica | Receita |
|---|---|---|
| **Traçante cinético** (autocannon) | terran | Linha de 8 un. na direção da velocidade, `lw 1.5`, gradiente `#ffe9a8`→transparente na cauda; cabeça `G('#fff2c0', 3)`. Sem partículas. |
| **Railgun** (perfurante) | terran, nanite ("disassembler" é beam) | Projétil = risco de 40 un., `lw 2`, branco-azulado `#cfe8ff`, com 2 linhas paralelas finas `team` alpha 0,4 a ±1,5 px (efeito de trilho). Deixa **streak decal** de 300 ms (linha que desvanece) e ao atravessar casco emite 6 faíscas. Muzzle: anel elétrico. |
| **Míssil guiado** | terran, vorrash ("larva") | Corpo: triângulo 4×1,5 `hullLight` + chama `#ffb347` 3 un. Fumaça: 1 partícula a cada 40 ms, `r 1.5→4`, `#9aa3ad` alpha 0,35→0, vida 700, velocidade = −0,2·v + ruído. Versão Vorrash: corpo segmentado verde `#7dd957`, rastro de gotas (`r 1`, verde, vida 400), e serpenteia (`sin` lateral de 2 un. a 3 Hz, só visual). |
| **Torpedo** | terran (pesado), vorrash | Elipse 6×2,5 `hullMid` com anel `team` pulsando 2 Hz; fumaça mais densa (cada 25 ms, r 2→6, vida 900); glow `G(team, 5)`. Armado: pisca vermelho `#ff4d5e` nos últimos 500 ms antes de atingir (se o sim marcar `fuse`). |
| **Bolt de plasma** | lumen, nanite ("pulse") | Núcleo círculo r 2,5 branco; halo `G(mix('#7c5cff', team), 7)`; cauda: 3 partículas/30 ms, `r 2→0`, vida 250, cor do halo, `lighter`. Leve wobble `±0,5 px` no raio a 20 Hz. |
| **Cuspe de ácido** | vorrash | Gota: elipse 3×2 `#7dd957`→`#b8ff80` orientada pela velocidade, alpha 0,9; rastro de 1 gota pequena/50 ms vida 300 que **cai** (gravidade visual +y·0 — não; em vez disso, desacelera e some). Impacto: mancha corrosiva (decal) + fumaça verde. |
| **Esporo / nuvem** | vorrash | Projétil lento: 5–8 partículas agrupadas (`r 3–5`, `#7dd957` alpha 0,3, `lighter`) orbitando o centro R 4; ao chegar, vira **nuvem** decal: círculo R do sim, 24 partículas lentas vida 2 500, alpha 0,2, verde; naves dentro recebem tint verde 20%. |
| **Flak** | terran (pd) | Projétil: ponto `#ffd27a` 2 px. Detona (evento): flash `G('#fff0c0', 10)` 80 ms + 10 estilhaços (linhas 3 un., `#ffb347`, vida 300, vel 60–120) + anel de fumaça cinza (8 partículas r 3→7 vida 600). |
| **Nuvem de nanitas** (guiada) | nanite | Enxame de 12 pontos `team`/`accent` 1,5 px que orbitam o centro do projétil (R 3–6, fases distintas) + linha fina ligando 3 deles (treliça). Ao atingir: pontos "pousam" no alvo (partículas que seguem o alvo por 600 ms). |
| **Larva viva** | vorrash (Ninho) | Mini "Ferrão" `size 5` com `wiggle`, trajetória serpenteante; morre com splat verde pequeno. |

### 3.2 Feixes (eventos `beamStart/beamEnd` ou flag no snapshot com `from, to, t`)

Renderer de feixe (§6.3) com 3 passes: glow largo (`lw = 6·w`, cor `G`, alpha 0,25, `lighter`), corpo (`lw 2·w`, cor), núcleo (`lw 0,7·w`, branco). `w` por arma:

| Feixe | Facção | `w` | Cor | Extra |
|---|---|---|---|---|
| Laser PD | terran | 0,8 | `#ff6a6a` | pulsos de 60 ms, não contínuo |
| Lança (lance) | lumen | 2,5 | `#d7ccff` + `team` | 150 ms de "carga": partículas convergindo para o emissor; depois feixe com **ondulação** (segmentar em 12 pontos, deslocar perpendicular `sin(t*40 + i)·1,5`) |
| Prisma | lumen | 1,2 | 3 feixes finos `#ff5aa0`,`#5affd0`,`#ffffff` que se separam 1,5 un. e reconvergem no alvo (aberração) | |
| Arco elétrico | lumen | 1 | `#bfe9ff` | **Lightning**: polilinha de 10–16 segmentos com jitter perpendicular ±6 un., regenerada a cada 50 ms; 1–2 ramificações curtas |
| Tentáculo | vorrash | 2 | `#9c4d4f` + `#7dd957` | Curva Bézier quadrática com ponto de controle oscilando ±15 un., 2 Hz; "ventosas" (círculos r 1,5) a cada 8 un. |
| Desmontador | nanite | 1,5 | `accent` | Linha **tracejada** (`setLineDash([6,4])`, offset −200 un./s = flui para o alvo); no alvo, 6 cubos 2×2 `team` se desprendem do casco por 300 ms |
| Reparo | terran (eng.), nanite | 1 | `#7dff9a` | Tracejado fluindo **do** emissor **para** o aliado; no aliado, `+` verdes pequenos subindo (vida 500) |

Feixes param no ponto de impacto (vem do sim). Alpha do feixe = `min(1, age/60ms)` no início e `1 - (age-dur+80)/80` no fim.

### 3.3 Flashes de boca (muzzle)

Evento `shot{weaponKind, pos, dir}`: 1 sprite de flash cacheado por tipo (canvas 32×32, desenhado uma vez): cinético = estrela de 4 pontas `#fff2c0`; plasma = círculo `G`; railgun = anel `#cfe8ff` lw 2 r 6; ácido = respingos (3 gotas). Duração 70 ms, escala `1.3 → 0.6`, alpha `1 → 0`. Custo: 1 drawImage. Em naves abaixo de bucket 0,5, pular muzzle de armas leves (rate > 4/s).

### 3.4 Impactos

- **Casco (`hit{pos, normal, dmg, armorType}`)**:
  - Faíscas: `n = clamp(3 + dmg/8, 3, 14)` partículas, cone de 60° ao redor da normal, vel 80–220 un./s, vida 150–350, cor por casco: aço `#ffd27a`→`#ff6a3d`; quitina `#d98d6a` + 2 gotas `#7dd957`; cristal `#ffffff`→`#7c5cff` (fragmentos triangulares em vez de linhas); nanita cubos `team` 1,5 px.
  - Flash `G(white, 4 + dmg/20)` 60 ms.
  - Decal de queimadura no sprite não é feito por hit (caro); o estado de dano (0/1/2) troca o sprite.
  - Fumaça: naves com casco < 30% emitem fumaça contínua (`sparkPoints` da def): 1 partícula/120 ms r 2→6 cinza alpha 0,4 vida 1 200, e 1 faísca a cada 400 ms.
- **Escudo (`hit{shield:true}`)**: ver 3.5.
- **Ácido**: decal verde (círculo r 3–6 alpha 0,5, vida 2 000, desvanece) preso à nave (lista `attachedDecals` por entidade, máx 6).

### 3.5 Escudo — ondulação hexagonal

- Cada classe com escudo tem `shieldR = size·0,62`. Pré-render por `(shieldR, bucket)`: **máscara hex** = grade de hexágonos (lado `max(4, shieldR/6)`) desenhada em stroke branco lw 1 dentro do círculo, com os 2 hexágonos mais externos cortados pelo círculo. Canvas `2·shieldR·bucket·dpr`.
- Estado ocioso: círculo `team` alpha `0,06 + 0,04·shieldPct` + borda lw 1 alpha `0,25·shieldPct`. Sem hexágonos.
- Hit: evento cria `ShieldRipple{ship, angleLocal, t0}`; durante 350 ms desenha a máscara hex com `clip` radial: `globalAlpha = 0.9·(1-u)`, apenas num **anel** centrado no ponto de impacto com raio interno `u·shieldR·1.4 − 8`, externo `u·shieldR·1.4` (`u = age/350`) — hexágonos "acendem" em onda a partir do impacto. Implementação: `ctx.save(); clip(circle hit, rOuter); clip(circle, rInner, evenodd)…` Mais barato: desenhar a máscara inteira com `globalAlpha` e um gradiente radial `destination-in` — mas isso exige canvas temporário. Recomendo: canvas temporário por ripple **só para naves `size ≥ 30`**; naves pequenas usam um arco de 90° na borda do escudo (lw 3, `team`, alpha 1−u) — lê bem a zoom baixo.
- Escudo caindo (`shieldDown`): borda pisca branco 2× (80 ms), 16 fragmentos hexagonais (partículas tipo `hex`, r 3, `team`, vida 500, giram) voam para fora.
- Escudo voltando: anel cresce de 0 → shieldR em 300 ms com ease-out.

### 3.6 Explosões (escaladas por `size`)

`S = size/12` (1 para interceptor, 10 para nave-mãe). Fases (todas a partir do evento `death{pos, size, faction, team}`):

1. **Flash** (0–120 ms): `G(white, 10·S)` alpha 1→0; a 0 ms também `G(teamGlow, 20·S)` alpha 0,6→0.
2. **Bola de fogo** (0–500·√S ms): 8+6·S partículas `fire` (r `4·S → 0`, cor `#fff2c0 → #ff7a3d → #3a1a10`, vel 20–90 un./s, `lighter` nas primeiras 40% da vida, depois `source-over` = fumaça escura).
3. **Onda de choque** (0–600·√S ms): anel `r = 6·S + 90·S·ease(u)`, `lw 3·S·(1−u)`, cor `#ffd2b8` alpha `0,8·(1−u)`; capitais (S ≥ 5): segundo anel 150 ms atrasado + **distorção falsa**: redesenhar o fundo estrelado localmente deslocado? Não — caro. Em vez disso, 2º anel branco fino lw 1 e um `G(white, 60·S)` alpha 0,15 por 200 ms.
4. **Destroços** (0–2 500 ms): `n = 6 + 4·S` (máx 46): partículas `debris` com forma por facção — terran: triângulos/retângulos `hullMid` 2–5 un. girando; vorrash: segmentos curvos `hullLight` + 3 gotas verdes; lumen: cacos translúcidos `crystalLight` que **cintilam** (alpha flicker) e não têm fumaça; nanite: a nave **desmonta em cubos 3×3** (`cellOff`/`team`) que primeiro congelam 150 ms e depois voam em direções em grade (só ±x, ±y, diagonais) — assinatura. Vel 40–160 un./s, drag 0,98/frame, rotação 90–360°/s.
5. **Brasas** (300–3 000 ms): `12·S` partículas `ember` r 1, `#ff9a3d` piscando (alpha `0,5+0,5·sin(t·20+i)`), vel 5–30, vida 1 500–3 000.
6. **Fumaça lingering** (S ≥ 3): 4·S partículas r `8·S → 20·S`, `#3a3f48` alpha 0,35→0, vida 2 500, vel 5–15.
7. **Secundárias** (S ≥ 5): 3 + S mini-explosões (S' = 1–2) espalhadas no bbox da nave, escalonadas a cada 80–140 ms **antes** do flash principal (o sim envia `death` na hora da morte; o renderer pode adiar o flash principal em `80·min(S,8)` ms e **manter o sprite desenhando** com tremor durante esse tempo — fica muito mais cinematográfico). Risco: dessincroniza ligeiramente com o som; o motor de áudio recebe a mesma regra de atraso.
8. Screen shake: `trauma += clamp(0.08·S, 0.08, 0.6)` (§4.3).

Orçamento por explosão (S=10): 6 fases ≈ 60 fire + 46 debris + 120 embers + 40 smoke ≈ 270 partículas. Com 6 capitais morrendo em 2 s: 1 600 — cabe no pool de 6 000 com densidade 1,0. A densidade adaptativa escala `n` de cada fase.

### 3.7 VFX de habilidades

| Habilidade | Receita |
|---|---|
| **Domo de escudo** (área) | Círculo R, fill `team` alpha 0,08 + hex mask alpha 0,15 + borda lw 2 pulsando; ao ativar, anel cresce 0→R em 250 ms. Naves dentro recebem `+10%` luminância na camada emissiva. |
| **EMP** | Anel `#bfe9ff` lw 4 expandindo 0→R em 400 ms + 24 raios curtos (arco elétrico de 8 un.) ao longo do anel; naves atingidas: sprite recebe `tint` azul 40% por 1 s + 3 arcos elétricos pequenos saltando no casco a cada 150 ms + animações pausadas (automaton congela, chamas apagam). |
| **Reparo** | Feixe tracejado (§3.2) + "+" verdes; nanite: nuvem de 20 pontos `accent` que viaja do reparador ao alvo (partículas com `seek`) e "envolve" o alvo girando por 1 s. |
| **Teleporte (blink)** | Origem: a nave "se estica" na direção do destino (blit com `scaleX 2,5, alpha 0,6`) por 80 ms, 8 partículas de luz; destino: anel `team` contraindo R 20·S → 0 em 150 ms + flash. Entre os dois, 1 linha fina `team` alpha 0,3 que desvanece em 200 ms. Lumen: destino aparece primeiro como "cristal se montando": 6 facetas convergindo. |
| **Camuflagem** | Sprite com alpha 0,18 para o inimigo (se o espectador for do outro time) / 0,5 para aliado; **shimmer**: 2 vezes por segundo um `clip` em faixa diagonal de 6 un. passa pelo sprite desenhando-o com alpha 0,5 (refração). Ao descamuflar: borda branca lw 2 por 120 ms. |
| **Lançar drones** | Hangar acende; cada drone nasce como ponto `team` que cresce para sprite em 200 ms (`scale 0,2 → 1`) com rastro curto. Vorrash: sacos de ovos "estouram" (6 gotas verdes) e larva sai com wiggle. |
| **Overcharge / fúria** | Casco recebe camada `lighter` com `team` alpha 0,2 pulsando 6 Hz; motores 1,6× maiores; 2 partículas/50 ms de faíscas brancas pelo casco. |
| **Enxame de nanitas (área)** | 60 pontos `accent` em movimento browniano dentro de R, 3 treliças aleatórias ligando trios a cada 100 ms. |
| **Esporo de cura (vorrash)** | Nuvem verde-clara (como §3.1 esporo) com partículas subindo lentamente e "+" em `#b8ff80`. |

### 3.8 Rastros de motor

- Buffer circular de 12 posições por nave (gravado a cada 50 ms), só para `size ≥ 20` ou se o número total de naves < 120 (senão só capitais).
- Terran: polilinha `lw 3·thrust`, gradiente de `team` alpha 0,35 → 0. Lumen: duas linhas finas brancas + uma `team` larga alpha 0,25, com cintilações. Vorrash: sem linha; partículas de esporo (`r 2`, `team` alpha 0,25, vida 600, drift aleatório). Nanite: 1 ponto 1 px `team` a cada 50 ms (vida 800, sem movimento) = pontilhado atrás da nave.
- Desenhar rastros **antes** das naves, em um único `beginPath` por time quando possível (mesma cor): reduz state changes.

### 3.9 Orçamento de partículas e pooling (500+ naves a 60 fps)

- Pool SoA: `Float32Array` para `x, y, vx, vy, life, maxLife, size0, size1, rot, vrot, drag`, `Uint8Array` para `kind`, `Uint16Array` para `colorIdx` (índice em tabela de cores pré-resolvidas). `MAX = 6000`. Alocação por índice livre (stack de livres); morte = swap-remove.
- Render agrupado por `(kind, blend)`: um passe `lighter` para `fire/plasma/ember/glow`, um `source-over` para `smoke/debris/spark`. Dentro do passe, `fillStyle` muda só quando `colorIdx` muda (ordenar por cor a cada 4 frames com counting sort — barato).
- Formas: `spark` = linha (2 pontos: pos e pos − v·0,02); `fire/smoke/plasma` = **drawImage de glow/soft sprite** (nunca `arc` + gradiente por partícula); `debris` = `fillRect` rotacionado (ou triângulo); `hex/cube` = `fillRect`.
- Limite por evento (density 1,0): hit 14, muzzle 0, shot plasma 3/30 ms, explosão conforme §3.6, habilidade ≤ 80. Global: se `alive > 0,85·MAX` novos spawns recebem `n·0,5`; se `> 0,95·MAX` só eventos com prioridade ≥ 2 (mortes, habilidades) spawnam.
- Densidade adaptativa: medir `frameMs` (média móvel 30 frames); `> 18 ms` → `density *= 0,8` (min 0,25) e desliga rastros/aberração/flex; `< 11 ms` por 120 frames → `density = min(1, density·1,15)`.
- Metas: 500 naves = ~500 sprite blits + ~1 000 draws animados + ~2 000 partículas + 60 beams ≈ 3,5 k operações de canvas/frame — dentro do confortável (Canvas 2D aguenta 10–20 k ops simples/frame em hardware médio). O gargalo real é `save/restore/rotate` por nave: usar `setTransform(a,b,c,d,e,f)` direto com cos/sin pré-calculados, nunca `save/rotate/restore`.

---

## 4. Fundo e câmera

### 4.1 Mundo e viewport

- Mundo: **3200 × 1800** unidades (16:9). Frotas começam em x ∈ [200, 700] e [2500, 3000].
- Viewport: canvas ocupa a janela; a área de jogo é letterboxed para 16:9 com barras `#05070c`; o HUD fica dentro da área de jogo (overlay DOM posicionado por `%` relativo a ela).
- HiDPI: `dpr = min(devicePixelRatio, 2)`; `canvas.width = cssW·dpr`; transform base `[dpr,0,0,dpr,0,0]`; todo o render usa coordenadas CSS. Redimensionar reconstrói buckets de glow (não os sprites — estes dependem só de `bucket·dpr`, invalidar se dpr mudar).

### 4.2 Fundo (3 camadas de parallax + nebulosa + planeta)

Renderizado uma vez para um **canvas de fundo** maior que a viewport (viewport × 1,5), re-renderizado só quando o zoom muda de bucket; a cada frame só `drawImage` com offset de parallax.

- **Camada 0 – nebulosa:** 6–10 blobs = gradientes radiais elípticos (raio 300–900 un.) em 2 cores por seed (paletas: `[#1a1040,#0b2a4a]`, `[#2a0f2e,#102a33]`, `[#0e2a1a,#0a1430]`), alpha 0,12–0,25, `lighter`. Por cima, "ruído" barato: 300 círculos r 40–120 alpha 0,02 em cor da nebulosa, posições por seed. Parallax 0,15.
- **Camada 1 – estrelas distantes:** 900 pontos r 0,5–1 alpha 0,3–0,7, cores `#ffffff/#cfe8ff/#ffe9c0`. Parallax 0,3.
- **Camada 2 – estrelas médias:** 350 pontos r 1–1,6 + 20 estrelas com cruz de difração (4 linhas 6 un., alpha 0,3). Parallax 0,55. 8 delas cintilam (alpha `sin`).
- **Camada 3 – próximas (desenhadas direto, não cacheadas):** 60 pontos r 1,5–2,2 que também recebem o shake. Parallax 0,85.
- **Planeta** (50% dos mapas, por seed): círculo r 350–700 fora da zona central (um canto), gradiente radial para o terminador (luz vinda de um ponto), 3–5 faixas de bezier translúcidas (gás) ou manchas (rochoso), atmosfera = anel `G` 1,15·r alpha 0,25. Anel opcional (elipse lw 18 alpha 0,35). Cacheado em canvas próprio. Parallax 0,2.
- **Grade:** desligada por padrão; opção "Grade tática" no HUD desenha linhas a cada 200 un. `#1d3a5c` alpha 0,25.
- Ocasional: 1 cometa/estrela cadente a cada 20–40 s (linha com gradiente, 400 ms) — detalhe barato que vende "vivo".

### 4.3 Câmera

```
state: x, y, zoom, targetX, targetY, targetZoom, trauma, shakeSeed, mode ('auto'|'free'|'follow')
each frame (dt):
  if mode==='auto':
    bbox = AABB of alive ships (expand by 120 units)      // computed from interpolated positions
    if ships alive on one side only → bbox also includes last-death position for 2 s
    targetZoom = clamp( min(viewW/bbox.w, viewH/bbox.h), ZOOM_MIN=0.35, ZOOM_MAX=2.0 )
    // action centroid: weighted by (recent damage dealt+taken in last 2 s) + size
    c = Σ w_i·p_i / Σ w_i  with w_i = size_i·(1 + 4·recentDamage_i/maxHull_i)
    target = lerp(bboxCenter, c, 0.35)                   // mostly bbox-centered, biased to the action
  // smoothing: exponential with different time constants (zoom slower)
  x += (targetX - x)·(1 - exp(-dt/0.45)); y likewise
  zoom += (targetZoom - zoom)·(1 - exp(-dt/0.9))
  // never let the view leave the world: clamp x,y so that viewport ⊂ world (+ 100 margin)
  // shake (trauma model)
  trauma = max(0, trauma - dt·1.2)
  s = trauma²
  shakeX = s·14·noise1(t·25, seed);  shakeY = s·14·noise1(t·25, seed+7);  shakeRot = s·0.02·noise1(t·25, seed+13)
```
- Trauma: tiro de railgun 0,05; morte `clamp(0.08·S, 0.08, 0.6)`; EMP 0,25. Shake em **pixels de tela**, não de mundo (lê igual em qualquer zoom); reduzido 50% com a opção "Reduzir movimento".
- Zoom manual (roda do mouse / pinch) coloca `mode='free'` por 6 s de inatividade, depois volta a `auto` com ease. Clique numa nave → `follow` (centro = nave, zoom mantido).
- **Câmera lenta no último abate (opcional, recomendado):** quando o sim emite `death` que zera o time, o cliente pede `timeScale = 0,25` por 1,8 s (o renderer já interpola; o sim local/servidor continua em 20 Hz, o cliente só atrasa o relógio de apresentação — em multiplayer o servidor pode marcar `lastKill` no evento e o cliente faz a desaceleração localmente sobre snapshots já recebidos, bufferizando). Zoom `×1,6` ease-in para o ponto da morte; vinheta escurece 20%. Depois corta para a tela de resultado com fade de 400 ms.
- Vinheta: gradiente radial `rgba(0,0,0,0)→rgba(0,0,0,0.45)` fixo nos cantos — custa 1 fill, dá profundidade.

---

## 5. Tema de UI (HUD sci-fi)

### 5.1 Tipografia e cores

- **Google Fonts:** `Orbitron` (títulos, números grandes, pesos 500/700) + `Exo 2` (corpo, 400/600). Fallback: `font-family: "Orbitron", "Exo 2", "Segoe UI", system-ui, sans-serif`. Números tabulares no HUD: `font-variant-numeric: tabular-nums`. Carregar com `display=swap`; se o fetch falhar (offline), o sistema serve — nada quebra.
- Tokens:

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#05070c` | fundo de página / letterbox |
| `--panel` | `rgba(10,16,30,0.82)` | painéis (com `backdrop-filter: blur(6px)` opcional) |
| `--line` | `#1d3a5c` | bordas 1 px |
| `--line-hi` | `#35c8ff` | borda ativa / foco |
| `--text` | `#d9e6f2` | texto |
| `--muted` | `#7f93a8` | rótulos |
| `--accent` | `#35c8ff` | botões primários, barras |
| `--warn` | `#ffb347` | avisos |
| `--danger` | `#ff4d5e` | perigo / casco crítico |
| `--ok` | `#7dff9a` | reparo / escudo cheio |
| `--team-a` / `--team-b` | `#3fb6ff` / `#ff7a3d` | tudo que é "de time" |
| `--f-terran/-vorrash/-lumen/-nanite` | `#8a96a6` / `#9c4d4f` / `#7c5cff` / `#7fb3a8` | ícone/borda de facção |

- Painéis com **cantos chanfrados** via `clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)` e uma linha de "circuito" decorativa (pseudo-elemento com `border-top: 1px` em `--line-hi` de 40 px no canto superior esquerdo). Scanlines sutis: `repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,0.015) 3px 4px)` no overlay inteiro.
- Botões: fundo transparente, borda `--line`, texto `--accent`, hover: fundo `rgba(53,200,255,0.12)` + `box-shadow: 0 0 12px rgba(53,200,255,0.35)`, transição 120 ms. Primário: fundo `--accent`, texto `#05070c`.
- Barras de status: trilha `#0e1626`, preenchimento com gradiente horizontal (`--ok` → `--accent` para escudo; `#8a96a6` → `#d9e6f2` para casco; muda para `--warn` < 50% e `--danger` < 25%) e **transição animada** (`width 250ms ease-out`) + um "fantasma" branco que encolhe mais devagar (dano recente).
- Ícones: inline SVG desenhados à mão (16 ícones: facções, armas, escudo, casco, velocidade, play, etc.) — sem fontes de ícones.

### 5.2 Telas

**Menu principal:** canvas de fundo (nebulosa + estrelas + 3 naves de facções diferentes passando devagar, desenhadas com o sistema de sprites — demo viva do visual). Título "FROTA ESTELAR" em Orbitron 700 com `letter-spacing: .18em`, brilho `text-shadow: 0 0 24px rgba(53,200,255,.5)`, animação de "ligar" (clip de scanline de cima para baixo, 600 ms) na primeira exibição. Botões: "Jogar solo", "Multijogador", "Galeria de naves" (codex), "Opções".

**Lobby:** lista de jogadores em 2 colunas (time Azul / time Laranja), cada linha com avatar = sprite da nave-mãe da facção escolhida (56 px, girando lentamente), nome, facção, "Pronto". Chat simples. Botão "Iniciar" para o host. Seletor de dificuldade/tamanho (1v1…6v6) e orçamento de pontos.

**Montador de frota (fleet builder):**
- Topo: seletor de facção = 4 cartões largos com a nave-mãe desenhada ao vivo (canvas 220×120 cada, sprite + anims), nome, 1 linha de doutrina ("Blindagem e artilharia", "Enxame e corrosão", "Energia e precisão", "Adaptação e replicação"). Selecionar → transição 300 ms em que o roster desliza.
- Esquerda (roster): cartões 180×240: canvas 160×100 com a nave em 3/4 (rotação −20°, zoom para caber, anims ligadas, hover: rotação segue o mouse ±15°); nome; custo em pontos (Orbitron); 4 barras compactas: Casco, Escudo (ou "—" se não tiver, com ícone riscado), Dano, Velocidade; ícones das armas (até 3) e da habilidade com tooltip pt-BR. Clique = adiciona; roda do mouse = ajusta quantidade.
- Direita (frota): lista com quantidade × classe, custo total vs orçamento (barra que fica `--warn` em 90% e `--danger` ao exceder), composição por tamanho (minibarra: pequenas/médias/capitais) e **preview tático** (canvas 320×180 onde a frota aparece em formação, pontos à escala — dá noção de "o quão grande é minha nave-mãe").
- Botão "Pronto" fica pulsando quando válido.

**HUD de batalha:**
- Topo: barra dupla centralizada: esquerda azul, direita laranja, cada uma com **casco total** (preenchimento) e **escudo total** (linha fina acima); contagem de naves vivas por tamanho (ícones Δ ○ ◇ com número). No meio, tempo `mm:ss` em Orbitron e controles de velocidade `▶ ×1 ×2 ×4 ∥` (solo) ou só `∥` para pausa cooperativa (multi: votação).
- Cantos inferiores: painel de cada jogador (nome, facção, naves vivas/total, dano causado) — colapsável.
- Esquerda: feed de eventos (últimos 5: "Bastião [Ana] destruído", "Matriarca lança larvas") com ícone e cor de time, cada item entra deslizando e some em 6 s.
- Hover em nave: tooltip canvas (desenhado no mesmo frame, não DOM) com nome, barras de casco/escudo, arma atual. Clique: seguir.
- Botões: "Grade", "Mostrar nomes", "Câmera auto", "Som".
- Barras de casco **sobre as naves**: só para `size ≥ 30` ou nave sob o cursor; pequenas mostram só um traço de 8 px quando < 50%.

**Resultados:** fundo = última imagem da batalha congelada e desfocada (`filter: blur(4px) brightness(.5)` num `drawImage` do canvas para outro canvas — ou, mais barato, redesenhar o frame com alpha 0,5 sobre preto). Título "VITÓRIA DO TIME AZUL" na cor do time com animação de contagem de pontos. Tabela por jogador: facção (ícone), naves perdidas/total, dano causado, dano absorvido por escudos, abates, MVP (nave que mais causou dano, desenhada em 96 px). Gráfico de linha simples (canvas) do casco total dos dois times ao longo do tempo. Botões "Revanche", "Nova frota", "Menu".

**Galeria (codex):** grade de todas as naves, cada uma em canvas 200×140 com rotação lenta; clique abre ficha grande (canvas 480×300 com a nave a zoom 2, anims, botão "Testar armas" que dispara os VFX da nave em um alvo-fantasma — ótimo para debug também).

### 5.3 Transições

- Entre telas: `opacity` + `translateY(8px)` 250 ms; a cena de fundo (canvas) nunca pisca — telas são overlays DOM sobre o mesmo canvas.
- "Preparando batalha": painel central com barra de progresso real (pré-aquecimento de sprites) e os dois lados listando as naves que entram em formação (os sprites são blitados em fila, 30 ms cada). Dura 1,5–3 s — esconde o custo do cache.
- Contagem regressiva "3, 2, 1, COMBATE" em Orbitron 96 px, cada número com `scale 1.4→1` e glow.
- `prefers-reduced-motion` → sem shake, sem scanline, transições 0 ms.

---

## 6. Pseudo-código

### 6.1 Construtor de sprite cache

```js
const cache = new Map(); // key -> {canvas, ox, oy, scale}

function getShipSprite(def, team, zoom, dmgState) {
  const bucket = pickBucket(zoom);                       // nearest of [0.35,.5,.71,1,1.41,2]
  const key = `${def.id}|${team}|${bucket}|${dmgState}`;
  let s = cache.get(key);
  if (!s) { s = buildShipSprite(def, team, bucket, dmgState); cache.set(key, s); lruTouch(key); }
  return s;
}

function buildShipSprite(def, team, bucket, dmgState) {
  const pal = palette(def.faction, team);
  const k = def.size / 100 * bucket * DPR;               // design unit -> device px
  const bb = designBBox(def);                            // includes overhangs (mandibles, shards)
  const pad = 0.25 * def.size * bucket * DPR;
  const w = Math.min(512, Math.ceil((bb.w*k) + 2*pad)), h = Math.min(512, Math.ceil((bb.h*k) + 2*pad));
  const cv = new OffscreenCanvas(w, h), g = cv.getContext('2d');
  const ox = -bb.x*k + pad, oy = -bb.y*k + pad;          // design origin in canvas px
  g.setTransform(k, 0, 0, k, ox, oy);
  const detail = bucket >= 0.71;
  for (const L of sortBy(def.layers, 'z')) {
    if (L.kind === 'poly' || L.kind === 'stripe') {
      tracePoly(g, L, def.style.edge);                   // handles mirror + smoothing
      g.fillStyle = resolveFill(g, L.fill, L, pal, def.faction);   // 'grad:hull' -> createLinearGradient on layer bbox
      g.globalAlpha = L.alpha ?? (def.faction==='lumen' ? 0.78 : 1);
      g.fill();
      if (detail) drawMaterialDetail(g, L, def, pal);    // panels/rivets | plates+specular | facets+chromatic | cells+traces
      if (L.stroke) { g.lineWidth = Math.max(L.lw, 1/k); g.strokeStyle = pal[L.stroke]; g.stroke(); }
      g.globalAlpha = 1;
    } else if (L.kind === 'light' && L.static) {
      drawDot(g, L.x, L.y, L.r, pal[L.color]); if (L.mirror !== false) drawDot(g, L.x, -L.y, L.r, pal[L.color]);
    }
  }
  if (dmgState >= 1) applyScorch(g, def, pal, dmgState); // deterministic decals via hash(def.id,i)
  if (dmgState >= 2) applyBreaches(g, def);              // destination-out small triangles
  return { canvas: cv, ox, oy, k, w, h };
}

function tracePoly(g, L, edge) {
  const pts = L.mirror ? [...L.pts, ...L.pts.slice().reverse().map(([x,y]) => [x,-y])] : L.pts;
  g.beginPath();
  if (edge === 'smooth' && L.smooth !== false) catmullRomPath(g, pts, 0.5, true);
  else { g.moveTo(...pts[0]); for (let i=1;i<pts.length;i++) g.lineTo(...pts[i]); }
  g.closePath();
}

// Blit (per ship, per frame)
function blitShip(ctx, s, sx, sy, angle, zoom, alpha=1) {
  const r = zoom / s.bucket;                             // residual scale (0.84..1.19)
  const c = Math.cos(angle)*r, n = Math.sin(angle)*r;
  ctx.setTransform(c*DPR, n*DPR, -n*DPR, c*DPR, sx*DPR, sy*DPR); // one call, no save/restore
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(s.canvas, -s.ox / s.k * (s.k/ (s.bucket*DPR)) , -s.oy / s.k * (s.k/(s.bucket*DPR)), s.w/(s.bucket*DPR), s.h/(s.bucket*DPR));
  if (alpha !== 1) ctx.globalAlpha = 1;
}
```
(No blit, o drawImage usa dimensões em "unidades de mundo × bucket" para que a escala residual se aplique corretamente; o ponto é: **uma `setTransform` + um `drawImage`** por nave.)

### 6.2 Sistema de partículas (SoA)

```js
const MAX = 6000;
const P = { x:new Float32Array(MAX), y:..., vx:..., vy:..., life:..., max:..., s0:..., s1:..., rot:..., vrot:..., drag:...,
            kind:new Uint8Array(MAX), col:new Uint16Array(MAX) };
let count = 0;                                            // alive are [0,count)
const KIND = { SPARK:0, FIRE:1, SMOKE:2, DEBRIS:3, EMBER:4, PLASMA:5, HEX:6, CUBE:7, DOT:8, SHARD:9 };
const BLEND = [ 'lighter','lighter','source-over','source-over','lighter','lighter','lighter','source-over','lighter','source-over' ];

function spawn(kind, x, y, vx, vy, life, s0, s1, col, rot=0, vrot=0, drag=1) {
  if (count >= MAX) return -1;                            // (caller already scaled n by density)
  const i = count++;
  P.kind[i]=kind; P.x[i]=x; P.y[i]=y; P.vx[i]=vx; P.vy[i]=vy; P.life[i]=life; P.max[i]=life;
  P.s0[i]=s0; P.s1[i]=s1; P.col[i]=col; P.rot[i]=rot; P.vrot[i]=vrot; P.drag[i]=drag; return i;
}
function update(dt) {
  for (let i=0;i<count;) {
    P.life[i]-=dt;
    if (P.life[i] <= 0) { swapRemove(i); continue; }      // copy last into i, count--
    P.vx[i]*=P.drag[i]; P.vy[i]*=P.drag[i];
    P.x[i]+=P.vx[i]*dt; P.y[i]+=P.vy[i]*dt; P.rot[i]+=P.vrot[i]*dt; i++;
  }
}
function render(ctx, cam) {
  // bucket indices by (blend, kind, col) every frame: counting sort into 'order' array (cheap, ~6k ints)
  let curBlend = null, curCol = -1;
  for (const i of order) {
    const b = BLEND[P.kind[i]]; if (b !== curBlend) { ctx.globalCompositeOperation = b; curBlend = b; }
    const u = 1 - P.life[i]/P.max[i], size = lerp(P.s0[i], P.s1[i], u) * cam.zoom;
    const sx = (P.x[i]-cam.x)*cam.zoom + cam.hw, sy = (P.y[i]-cam.y)*cam.zoom + cam.hh;
    if (sx < -20 || sy < -20 || sx > cam.w+20 || sy > cam.h+20) continue;
    ctx.globalAlpha = alphaCurve(P.kind[i], u);
    switch (P.kind[i]) {
      case KIND.SPARK: if (P.col[i]!==curCol){ctx.strokeStyle=COL[P.col[i]];curCol=P.col[i];}
        ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx-P.vx[i]*0.02*cam.zoom, sy-P.vy[i]*0.02*cam.zoom); ctx.stroke(); break;
      case KIND.FIRE: case KIND.SMOKE: case KIND.PLASMA: case KIND.EMBER:
        ctx.drawImage(softSprite(P.col[i], P.kind[i]), sx-size, sy-size, size*2, size*2); break;   // cached 32px radial
      case KIND.DEBRIS: case KIND.CUBE: case KIND.HEX: case KIND.SHARD:
        ctx.setTransform(DPR*cos(P.rot[i]), DPR*sin(P.rot[i]), -DPR*sin(P.rot[i]), DPR*cos(P.rot[i]), sx*DPR, sy*DPR);
        if (P.col[i]!==curCol){ctx.fillStyle=COL[P.col[i]];curCol=P.col[i];}
        drawShape(ctx, P.kind[i], size); ctx.setTransform(DPR,0,0,DPR,0,0); break;
      case KIND.DOT: ctx.fillRect(sx-size/2, sy-size/2, size, size); break;
    }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
```

### 6.3 Renderer de feixes

```js
function drawBeam(ctx, cam, b, now) {                     // b: {kind, from, to, w, colA, colB, t0, t1}
  const age = now - b.t0, a = clamp(age/60, 0, 1) * clamp((b.t1 - now + 80)/80, 0, 1);
  const p0 = toScreen(b.from), p1 = toScreen(b.to);
  const pts = (b.kind==='arc') ? lightningPath(p0, p1, 14, 6*cam.zoom, now>>>6)   // regenerated every 64 ms
            : (b.kind==='lance') ? wavyPath(p0, p1, 12, 1.5*cam.zoom, now)
            : (b.kind==='tendril') ? bezierPath(p0, p1, now)
            : [p0, p1];
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  stroke(ctx, pts, b.w*6*cam.zoom, b.colA, 0.25*a);       // glow
  stroke(ctx, pts, b.w*2*cam.zoom, b.colB, 0.9*a);        // body
  if (b.kind==='disassembler' || b.kind==='repair') { ctx.setLineDash([6*cam.zoom, 4*cam.zoom]); ctx.lineDashOffset = -now*0.2*cam.zoom; }
  stroke(ctx, pts, b.w*0.7*cam.zoom, '#ffffff', a);       // core
  ctx.setLineDash([]);
  ctx.drawImage(glow(b.colA), p1.x-10*cam.zoom, p1.y-10*cam.zoom, 20*cam.zoom, 20*cam.zoom); // impact bloom
  ctx.globalCompositeOperation = 'source-over';
}
```

### 6.4 Explosão (gerador de eventos → partículas + efeitos temporizados)

```js
function spawnExplosion(ev, now) {                        // ev: {x,y,size,faction,team}
  const S = ev.size/12, d = density, pal = palette(ev.faction, ev.team);
  const delay = S >= 5 ? 80*Math.min(S,8) : 0;            // capitals: secondaries first
  if (delay) { for (let i=0;i<3+S;i++) timed(now + i*110, () => spawnExplosion({...ev, size: 14 + rnd()*10, x: ev.x+rnd(-ev.size/2,ev.size/2), y: ev.y+rnd(-ev.size/3,ev.size/3)}, now+i*110));
               ghosts.push({ev, until: now+delay, shake: 2*S}); }  // keep drawing the sprite, trembling
  timed(now + delay, () => {
    flashes.push({x:ev.x,y:ev.y, r:10*S, col:'#ffffff', t0:now+delay, dur:120});
    flashes.push({x:ev.x,y:ev.y, r:20*S, col:pal.teamGlow, t0:now+delay, dur:200, a:0.6});
    rings.push({x:ev.x,y:ev.y, r0:6*S, r1:96*S, lw:3*S, col:'#ffd2b8', t0:now+delay, dur:600*Math.sqrt(S)});
    for (let i=0;i<(8+6*S)*d;i++) { const a=rnd(0,TAU), v=rnd(20,90); spawn(FIRE, ev.x,ev.y, cos(a)*v, sin(a)*v, rnd(300,500)*sqrt(S), 4*S, 0, COL_FIRE, 0,0,0.96); }
    const nDeb = Math.min(46, 6+4*S)*d;
    for (let i=0;i<nDeb;i++) debrisFor(ev.faction, ev.x, ev.y, S, pal);   // nanite: CUBE kind, grid-aligned velocities, 150 ms freeze via drag trick
    for (let i=0;i<12*S*d;i++) { const a=rnd(0,TAU), v=rnd(5,30); spawn(EMBER, ev.x,ev.y, cos(a)*v, sin(a)*v, rnd(1500,3000), 1,1, COL_EMBER); }
    if (S>=3) for (let i=0;i<4*S*d;i++) spawn(SMOKE, ev.x+rnd(-4*S,4*S), ev.y+rnd(-4*S,4*S), rnd(-15,15), rnd(-15,15), 2500, 8*S, 20*S, COL_SMOKE);
    camera.trauma = Math.min(1, camera.trauma + clamp(0.08*S, 0.08, 0.6));
  });
}
```

### 6.5 Interpolação de snapshots

```js
// Snapshots arrive at 20 Hz: {tick, ships:[{id,x,y,angle,hull,shield,thrust,flags,turrets:[ang]}], projectiles:[...]}
const TICK_MS = 50, DELAY_MS = 100;                       // render 2 ticks behind the newest (jitter buffer)
const buf = [];                                           // sorted by tick, keep last ~10
let clockOffset = null;                                   // serverTickTime -> local now

function onSnapshot(s, recvNow) { buf.push(s); if (buf.length>10) buf.shift(); clockOffset ??= recvNow - s.tick*TICK_MS; 
                                  clockOffset = lerp(clockOffset, recvNow - s.tick*TICK_MS, 0.05); } // slow drift correction

function sample(now) {
  const t = now - clockOffset - DELAY_MS;                 // presentation time in "tick ms"
  const tickF = t / TICK_MS;
  let a = null, b = null;
  for (let i=buf.length-1;i>=0;i--) if (buf[i].tick <= tickF) { a = buf[i]; b = buf[i+1] ?? null; break; }
  if (!a) return buf[0] && viewOf(buf[0]);
  if (!b) return extrapolate(a, (tickF - a.tick)*TICK_MS, 100);   // at most 100 ms ahead using velocity
  const u = clamp((tickF - a.tick)/(b.tick - a.tick), 0, 1);
  // ships are matched by id (Map from b); a ship absent in b is dying -> keep a's state, alpha fades via death event
  return { ships: a.ships.map(sa => { const sb = b.byId.get(sa.id); if (!sb) return sa;
            return { ...sa, x: lerp(sa.x,sb.x,u), y: lerp(sa.y,sb.y,u), angle: lerpAngle(sa.angle,sb.angle,u),
                     turrets: sa.turrets.map((ta,i)=>lerpAngle(ta, sb.turrets[i], u)), hull: sb.hull, shield: sb.shield }; }),
           projectiles: lerpById(a.projectiles, b.projectiles, u) };
}
// Events: each snapshot carries events of its tick; they are queued with time = tick*TICK_MS + clockOffset + DELAY_MS
// and fired when 'now' passes that time (so VFX line up with the interpolated positions). The audio engine consumes
// the same queue. Single-player uses the same path (local sim pushes snapshots) → one code path.
```

### 6.6 Loop de render (ordem)

```js
function frame(now) {
  const dt = Math.min(0.05, (now - last)/1000); last = now;
  perf.begin();
  const view = sample(now);                // 6.5
  pumpEvents(now);                         // death/hit/shot/ability -> spawn VFX (3.x), audio
  camera.update(view, dt);                 // 4.3
  particles.update(dt);                    // 6.2
  trails.record(view, now);

  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle = '#05070c'; ctx.fillRect(0,0,W,H);           // letterbox clears everything
  ctx.save(); ctx.beginPath(); ctx.rect(vp.x,vp.y,vp.w,vp.h); ctx.clip();   // 16:9 viewport
  ctx.translate(vp.x + camera.shakeX, vp.y + camera.shakeY); ctx.rotate(camera.shakeRot);

  // 1. background (parallax layers, planet) — cached canvases, drawImage with per-layer offset
  background.draw(ctx, camera);
  // 2. ground-level effects: area clouds (spores, nanite swarm), shield domes (fill only), beam glows that are "behind"
  areaEffects.draw(ctx, camera, now);
  // 3. engine trails (batched strokes per team)
  trails.draw(ctx, camera);
  // 4. ships (sorted: small first, capitals last so big ones overlap small; cloaked drawn with alpha)
  for (const sh of view.ships sorted by size asc) {
    if (!inView(sh, camera)) continue;
    const lod = lodFor(camera.zoom, sh.size);
    if (lod === 0) { drawLod0(ctx, sh); continue; }
    const spr = getShipSprite(DEFS[sh.classId], sh.team, camera.zoom, dmgStateOf(sh));
    blitShip(ctx, spr, sx(sh), sy(sh), sh.angle, camera.zoom, alphaOf(sh));   // 6.1
    if (lod >= 2) drawAnimatedDetails(ctx, sh, now, camera);                  // 2.4 (flames, cores, rings, cells, turrets)
    if (sh.shield > 0 && lod >= 1) drawShieldIdle(ctx, sh, camera);
  }
  // 5. projectiles (from snapshot) + muzzle flashes
  for (const p of view.projectiles) drawProjectile(ctx, p, camera, now);      // 3.1
  muzzles.draw(ctx, camera, now);
  // 6. effects: beams, shield ripples, explosion flashes/rings, particles (additive pass then normal pass), ability overlays
  beams.draw(ctx, camera, now);            // 6.3
  shieldRipples.draw(ctx, camera, now);    // 3.5
  rings.draw(ctx, camera, now); flashes.draw(ctx, camera, now);
  particles.render(ctx, camera);           // 6.2
  abilityOverlays.draw(ctx, camera, now);  // EMP tint, overcharge, blink lines, cloak shimmer
  // 7. in-world UI: hull bars over big ships, selection ring, hover tooltip, tactical grid (if enabled)
  worldUI.draw(ctx, camera, view, now);
  ctx.restore();
  // 8. screen-space: vignette, slow-mo darkening, letterbox bars already cleared; DOM HUD updates (throttled to 10 Hz for text, 60 Hz for bars)
  vignette.draw(ctx); hud.update(view, now);
  perf.end(); adaptDensity(perf.avgMs);
  requestAnimationFrame(frame);
}
```

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| `shadowBlur`, gradientes por partícula e `save/restore` por nave destroem o frame time | Proibidos no loop quente; glow = sprites cacheados; `setTransform` direto; lint de code review. |
| Gradientes radiais dos Vorrash (por segmento) são caros no build do sprite | Só no build (offscreen, lazy, pré-aquecido); layers `breathe/flex` ao vivo apenas em `size ≥ 30` e bucket ≥ 1. |
| Translucidez dos Lumen (alpha 0,78) + `lighter` pode "estourar" para branco em aglomerados | Limitar `lighter` ao núcleo/halo; corpo em `source-over`. Testar com 60 Fragmentos juntos. |
| Cores de time vs. cor de arma (verde ácido, violeta plasma) confundem | Regra fixa `mix(weapon, team, 0.3)` + rastros de motor sempre em `team`; teste de daltonismo: azul/laranja é o par mais seguro, e as marcações de time também diferem em **forma** (listras A = diagonal, B = chevron). |
| Ripples hexagonais com canvas temporário por hit em 500 naves | Só `size ≥ 30`; pequenos usam arco de 90°. Cap de 24 ripples simultâneos. |
| Slow-motion no último abate em multiplayer dessincroniza relógio de apresentação | Implementar como desaceleração puramente local sobre o buffer de snapshots (que já tem 100 ms de atraso); ao fim, "catch-up" com `timeScale 1.5` por 1 s ou corte direto para resultados. Marcar como opcional/fase 2. |
| Fontes do Google offline | `display=swap` + fallback; o layout não depende de métricas (sem `ch` units). |
| Explosões de capitais atrasadas (secundárias) desalinhadas com o áudio e com o sim (nave já removida) | O renderer mantém "ghost" do sprite por `delay` ms; o áudio recebe o mesmo `delay`; o sim não sabe nada disso (nenhuma dependência). |
| Memória do cache com 6 facções×classes×estados | LRU 400 entradas, ~8–25 MB; medir com `performance.memory` em dev. |
| Tela de "Preparando batalha" demorada em hardware fraco | Pré-aquecer apenas 3 buckets das classes presentes; o resto lazy (um stutter aceitável no primeiro zoom extremo). |

**Ordem de implementação sugerida (para o lead):** paletas + `tracePoly`/`materialFill` + 2 naves por facção com cache e blit → partículas SoA + glow sprites → projéteis e beams → explosões escaladas → escudo hex → câmera auto + shake → fundo parallax/nebulosa → HUD/fleet builder com preview ao vivo → habilidades → polimento (aberração, slow-mo, codex).