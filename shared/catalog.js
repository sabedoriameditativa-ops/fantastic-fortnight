// Ship catalog: factions, hull types, damage model, weapons, abilities, presets.
// Pure data + small helpers. Shared by the simulation (Node + browser), the
// fleet builder UI, the bot fleet builder and the renderer/audio (for lookups).
//
// Units: distances in world units (u), speeds in u/s, turn rates in deg/s,
// cooldowns/durations in seconds, damage in hull/shield points.

export const SIZE_CLASSES = ['tiny', 'small', 'medium', 'large', 'capital', 'mothership'];

/** Per size class physical constants and display info. */
export const SIZE_CLASS = {
  tiny: { index: 0, radius: 8, accel: 420, name: 'Minúscula', audioSize: 0, mass: 1 },
  small: { index: 1, radius: 14, accel: 300, name: 'Pequena', audioSize: 1, mass: 3 },
  medium: { index: 2, radius: 22, accel: 200, name: 'Média', audioSize: 2, mass: 8 },
  large: { index: 3, radius: 34, accel: 120, name: 'Grande', audioSize: 3, mass: 20 },
  capital: { index: 4, radius: 50, accel: 80, name: 'Capital', audioSize: 4, mass: 45 },
  mothership: { index: 5, radius: 75, accel: 50, name: 'Nave-Mãe', audioSize: 4, mass: 100 },
};

export const HULL_TYPES = {
  armored: { id: 'armored', name: 'Blindado', desc: 'Reduz todo dano recebido no casco em um valor fixo (exceto canhões magnéticos).' },
  organic: { id: 'organic', name: 'Orgânico', desc: 'Regenera casco continuamente, mesmo sob fogo. Pulsos iônicos interrompem a regeneração.' },
  crystalline: { id: 'crystalline', name: 'Cristalino', desc: 'Frágil e sem regeneração; refrata lasers mas estilhaça com projéteis cinéticos.' },
  nanite: { id: 'nanite', name: 'Nanítico', desc: 'Repara o casco após 2 s sem sofrer dano. Pulsos iônicos interrompem o reparo.' },
};

export const WEAPON_TYPES = ['kinetic', 'railgun', 'flak', 'laser', 'plasma', 'missile', 'torpedo', 'bio', 'ion'];

export const WEAPON_TYPE_NAMES = {
  kinetic: 'Cinético', railgun: 'Canhão magnético', flak: 'Flak', laser: 'Laser', plasma: 'Plasma',
  missile: 'Míssil', torpedo: 'Torpedo', bio: 'Bioácido', ion: 'Iônico',
};

/**
 * Damage multipliers. `shield` applies while the target has shield; the hull
 * columns apply to the leftover that reaches the hull, by hull type.
 * Railgun ignores flat damage reduction (DR). DoT ticks ignore DR.
 * Ion hits apply `disrupt` (regen/repair halted) for DISRUPT_SECONDS.
 */
export const DAMAGE_MULT = {
  kinetic: { shield: 0.9, armored: 0.8, organic: 1.0, crystalline: 1.2, nanite: 1.0 },
  railgun: { shield: 0.85, armored: 1.0, organic: 1.0, crystalline: 1.2, nanite: 1.0 },
  flak: { shield: 0.5, armored: 0.6, organic: 1.1, crystalline: 0.9, nanite: 1.0 },
  laser: { shield: 1.2, armored: 0.9, organic: 1.0, crystalline: 0.6, nanite: 1.1 },
  plasma: { shield: 1.0, armored: 1.0, organic: 0.95, crystalline: 1.1, nanite: 1.0 },
  missile: { shield: 0.9, armored: 1.0, organic: 1.1, crystalline: 1.0, nanite: 1.0 },
  torpedo: { shield: 0.8, armored: 1.3, organic: 1.0, crystalline: 1.2, nanite: 1.0 },
  bio: { shield: 0.95, armored: 0.95, organic: 1.0, crystalline: 1.0, nanite: 0.85 },
  ion: { shield: 1.35, armored: 0.85, organic: 0.9, crystalline: 0.8, nanite: 0.9 },
};

/** Base hit probability by weapon type vs target size class (index order of SIZE_CLASSES). */
export const ACCURACY = {
  kinetic: [0.75, 0.85, 0.95, 1.0, 1.0, 1.0],
  railgun: [0.3, 0.45, 0.7, 0.9, 1.0, 1.0],
  flak: [0.95, 0.9, 0.7, 0.5, 0.4, 0.3],
  laser: [0.55, 0.65, 0.85, 1.0, 1.0, 1.0],
  plasma: [0.5, 0.7, 0.9, 1.0, 1.0, 1.0],
  missile: [0.5, 0.7, 0.9, 1.0, 1.0, 1.0],
  torpedo: [0.0, 0.0, 0.5, 0.85, 1.0, 1.0],
  bio: [0.6, 0.8, 0.95, 1.0, 1.0, 1.0],
  ion: [0.6, 0.75, 0.9, 1.0, 1.0, 1.0],
};

export const COMBAT = {
  armorFloor: 0.5,            // hull damage after DR is never below 50% of the pre-DR amount
  minHullDamage: 1,
  disruptSeconds: 2.0,        // ion hit: regen/repair halted
  disruptImmunitySeconds: 2,  // after a disrupt expires, cannot be re-disrupted for this long
  naniteRepairDelay: 2,       // seconds without hull damage before nanite repair starts
  fastTargetSpeed: 150,       // targets moving faster than this get -0.05 accuracy
  fastTargetPenalty: 0.05,
  rangeFalloffStart: 0.8,     // beyond 80% of range accuracy scales linearly down to...
  rangeFalloffMin: 0.6,       // ...60% at max range
  minHitChance: 0.05,
  maxHitChance: 0.98,
  aoeEdgeFalloff: 0.5,        // splash damage at the edge of the radius (linear from 1.0 at center)
  pdInterceptChance: 0.4,     // point-defense attempt success chance per shot
  terranCoordinationBonus: 0.1, terranCoordinationShips: 3,
  vorraxHungerHeal: 0.05,
  lumenPhaseSeconds: 1.0, lumenPhaseCooldown: 20,
  ferrixNeuralAccuracy: 0.1,
};

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

export const FACTIONS = {
  terran: {
    id: 'terran', name: 'Confederação Terrana', short: 'Terrana', race: 'Humanos',
    tagline: 'Blindagem, mísseis e disciplina. Equilibrada; escudos apenas nas naves-capitais.',
    lore: 'Depois de duzentos anos de guerras entre colônias, a Confederação unificou as frotas da Terra, Marte e dos Cinturões sob uma doutrina única: naves modulares, blindagem pesada e saturação de mísseis. Compensam a tecnologia inferior com disciplina, logística e fogo coordenado.',
    color: '#8a96a6', accent: '#d9a21b', hull: 'armored',
    passive: { id: 'fire_coordination', name: 'Coordenação de Fogo', desc: 'Alvos atacados por 3 ou mais naves terranas sofrem +10% de dano cinético.' },
    style: 'angular',
  },
  vorrax: {
    id: 'vorrax', name: 'Enxame Vorrax', short: 'Vorrax', race: 'Insetoides',
    tagline: 'Cascos vivos que se regeneram. Sem escudos, sem recuo, sem fim.',
    lore: 'Os Vorrax não constroem naves: criam-nas. Cada "nave" é um organismo gestado nas colmeias-mãe, com carapaça de quitina viva que cicatriza em pleno combate. Sua tecnologia é bioquímica: plasma secretado, ácido corrosivo e esporos. Não têm escudos; sua defesa é a regeneração e o número.',
    color: '#9c4d4f', accent: '#7dd957', hull: 'organic',
    passive: { id: 'hunger', name: 'Fome', desc: 'Uma nave Vorrax que destrói um inimigo recupera 5% do casco máximo.' },
    style: 'organic',
  },
  lumen: {
    id: 'lumen', name: 'Ascendência Lúmen', short: 'Lúmen', race: 'Seres de energia',
    tagline: 'Escudos de luz, cascos de cristal. Feixes precisos e saltos de fase.',
    lore: 'Os Lúmen são consciências de energia pura que habitam cascos cristalinos cultivados em estrelas moribundas. O cristal é frágil, mas os escudos que projetam são os mais fortes conhecidos. Movem-se dobrando o espaço em saltos curtos de fase e falam por harmônicos de luz.',
    color: '#7c5cff', accent: '#b8f0ff', hull: 'crystalline',
    passive: { id: 'phase', name: 'Fase', desc: 'Ao perder o escudo, a nave fica intocável por 1 s (uma vez a cada 20 s).' },
    style: 'crystal',
  },
  ferrix: {
    id: 'ferrix', name: 'Nexo Ferrix', short: 'Ferrix', race: 'Coletivo de máquinas',
    tagline: 'Nanitos que se reconstroem, canhões magnéticos e pulsos EMP. Fria eficiência.',
    lore: 'O Nexo Ferrix é uma única mente distribuída em bilhões de máquinas. Cada nave é um nó: cascos de nanitos que se reconstroem quando o combate dá trégua, canhões magnéticos que atravessam qualquer liga e pulsos EMP que apagam escudos como velas. O Nexo calculou que o universo é mais eficiente sem orgânicos.',
    color: '#7fb3a8', accent: '#9bffd6', hull: 'nanite',
    passive: { id: 'neural_net', name: 'Rede Neural', desc: '+10% de precisão contra naves minúsculas e pequenas (mira compartilhada).' },
    style: 'modular',
  },
};

export const FACTION_IDS = Object.keys(FACTIONS);

// ---------------------------------------------------------------------------
// Abilities (metadata + tunables; behavior implemented in shared/sim/abilities.js)
// ---------------------------------------------------------------------------

export const ABILITIES = {
  // --- Terran ---
  afterburner: { id: 'afterburner', name: 'Pós-combustor', cooldown: 12, duration: 3,
    desc: '+80% de velocidade e +50% de giro por 3 s.', params: { speedMul: 1.8, turnMul: 1.5 }, kind: 'buff' },
  countermeasures: { id: 'countermeasures', name: 'Contramedidas', cooldown: 15, duration: 6,
    desc: 'Os próximos 2 mísseis ou torpedos contra esta nave erram.', params: { charges: 2 }, kind: 'buff' },
  stealth_strike: { id: 'stealth_strike', name: 'Ataque Furtivo', cooldown: 20, duration: 4,
    desc: 'Fica intocável por 4 s ou até disparar; o próximo torpedo causa +50% de dano.', params: { damageMul: 1.5 }, kind: 'buff' },
  flak_curtain: { id: 'flak_curtain', name: 'Cortina de Flak', cooldown: 18, duration: 5,
    desc: 'Por 5 s intercepta até 6 mísseis/torpedos inimigos em 250 u e o flak causa +30% de dano.', params: { radius: 250, intercepts: 6, damageMul: 1.3 }, kind: 'buff' },
  barrage_fire: { id: 'barrage_fire', name: 'Fogo de Barragem', cooldown: 22, duration: 4,
    desc: 'Por 4 s a salva de mísseis dobra e recarrega duas vezes mais rápido.', params: { salvoMul: 2, cooldownMul: 0.5 }, kind: 'buff' },
  reactive_armor: { id: 'reactive_armor', name: 'Blindagem Reativa', cooldown: 25, duration: 6,
    desc: '+6 de redução de dano e regeneração de escudo 3× por 6 s.', params: { drAdd: 6, shieldRegenMul: 3 }, kind: 'buff' },
  launch_squadron: { id: 'launch_squadron', name: 'Lançar Esquadrilha', cooldown: 20, duration: 0,
    desc: 'Lança 4 Interceptadores Vespa (máx. 8 vivos, 40 s de duração).', params: { spawn: 'ter_vespa', count: 4, maxAlive: 8, lifetime: 40 }, kind: 'spawn' },
  siege_protocol: { id: 'siege_protocol', name: 'Protocolo de Cerco', cooldown: 40, duration: 6,
    desc: 'Aliados em 600 u recebem +30% de dano e +20% de cadência por 6 s.', params: { radius: 600, damageMul: 1.3, fireRateMul: 1.2 }, kind: 'aura' },

  // --- Vorrax ---
  bile_burst: { id: 'bile_burst', name: 'Explosão Biliar', cooldown: 0, duration: 0,
    desc: 'Ao morrer, explode causando 40 de dano bioácido em 60 u.', params: { damage: 40, radius: 60 }, kind: 'passive' },
  frenzy: { id: 'frenzy', name: 'Frenesi', cooldown: 10, duration: 4,
    desc: '+40% de cadência e +20% de velocidade por 4 s quando um aliado próximo morre.', params: { fireRateMul: 1.4, speedMul: 1.2, radius: 150 }, kind: 'buff' },
  acid_cloud: { id: 'acid_cloud', name: 'Nuvem Ácida', cooldown: 18, duration: 6,
    desc: 'Cria uma nuvem de 100 u por 6 s: 6 de dano/s e sem regeneração de escudo dentro dela.', params: { radius: 100, dps: 6 }, kind: 'area' },
  leech: { id: 'leech', name: 'Sanguessuga', cooldown: 20, duration: 5,
    desc: 'Agarra uma nave média ou maior por 5 s: 25 de dano/s ao alvo e cura 25/s.', params: { dps: 25, healPerSec: 25, range: 150, minTargetClass: 'medium' }, kind: 'latch' },
  spawn_brood: { id: 'spawn_brood', name: 'Gerar Prole', cooldown: 20, duration: 0,
    desc: 'Gera 3 Larvas (máx. 6 vivas).', params: { spawn: 'vor_larva', count: 3, maxAlive: 6, lifetime: 60 }, kind: 'spawn' },
  molt: { id: 'molt', name: 'Muda', cooldown: 30, duration: 5,
    desc: 'Cura 25% do casco, remove ácido e disrupção, regeneração 1,5× por 5 s.', params: { healFrac: 0.25, regenMul: 1.5 }, kind: 'heal' },
  war_pheromone: { id: 'war_pheromone', name: 'Feromônio de Guerra', cooldown: 35, duration: 8,
    desc: 'Aliados em 500 u recebem +25% de dano e +50% de regeneração por 8 s.', params: { radius: 500, damageMul: 1.25, regenMul: 1.5 }, kind: 'aura' },
  endless_swarm: { id: 'endless_swarm', name: 'Enxame Infinito', cooldown: 30, duration: 0,
    desc: 'Gera 3 Larvas e 2 Zangões (máx. 6 larvas e 3 zangões vivos). Aliados em 300 u regeneram +2/s.', params: { spawn: 'vor_larva', count: 3, maxAlive: 6, spawn2: 'vor_zangao', count2: 2, maxAlive2: 3, lifetime: 60, auraRadius: 300, auraRegen: 2 }, kind: 'spawn' },

  // --- Lúmen ---
  blink: { id: 'blink', name: 'Piscar', cooldown: 8, duration: 0,
    desc: 'Teleporta 200 u: para longe da ameaça se o escudo caiu, ou em direção ao alvo fora de alcance.', params: { distance: 200 }, kind: 'teleport' },
  shield_overload: { id: 'shield_overload', name: 'Sobrecarga de Escudo', cooldown: 15, duration: 0,
    desc: 'Restaura 40% da capacidade do escudo instantaneamente.', params: { restoreFrac: 0.4 }, kind: 'heal' },
  mantle: { id: 'mantle', name: 'Manto', cooldown: 12, duration: 8,
    desc: 'Concede a um aliado em 300 u uma camada extra de 200 de escudo por 8 s.', params: { range: 300, shield: 200, minTargetClass: 'medium' }, kind: 'buff_ally' },
  prismatic_focus: { id: 'prismatic_focus', name: 'Foco Prismático', cooldown: 20, duration: 4,
    desc: 'Por 4 s a Lança Solar causa +60% de dano e ganha +100 u de alcance.', params: { damageMul: 1.6, rangeAdd: 100, weaponIndex: 0 }, kind: 'buff' },
  dissonant_pulse: { id: 'dissonant_pulse', name: 'Pulso Dissonante', cooldown: 25, duration: 0,
    desc: 'Inimigos em 220 u perdem 150 de escudo, ficam sem regeneração por 5 s e 30% mais lentos por 3 s.', params: { radius: 220, shieldDamage: 150, disruptSeconds: 5, slowMul: 0.7, slowSeconds: 3 }, kind: 'area' },
  phase_jump: { id: 'phase_jump', name: 'Salto Fásico', cooldown: 30, duration: 0,
    desc: 'Teleporta a si e aliados em 150 u por até 400 u, para longe ou em direção ao inimigo.', params: { distance: 400, radius: 150 }, kind: 'teleport' },
  aurora: { id: 'aurora', name: 'Aurora', cooldown: 35, duration: 6,
    desc: 'Aliados em 400 u restauram 220 de escudo e ganham +50% de regeneração por 6 s.', params: { radius: 400, shieldRestore: 220, shieldRegenMul: 1.5 }, kind: 'aura' },
  singularity: { id: 'singularity', name: 'Singularidade', cooldown: 45, duration: 4,
    desc: 'Poço gravitacional de 250 u por 4 s: puxa inimigos para o centro e causa 20 de dano/s.', params: { radius: 250, pullSpeed: 120, dps: 20, range: 800 }, kind: 'area' },

  // --- Ferrix ---
  overclock: { id: 'overclock', name: 'Sobrecarga', cooldown: 15, duration: 3,
    desc: '+60% de cadência por 3 s quando 3 Vetores atacam o mesmo alvo.', params: { fireRateMul: 1.6 }, kind: 'buff' },
  turret_mode: { id: 'turret_mode', name: 'Modo Torre', cooldown: 20, duration: 6,
    desc: 'Para de se mover; +50% de alcance e +30% de dano por 6 s.', params: { rangeMul: 1.5, damageMul: 1.3 }, kind: 'buff' },
  emp_pulse: { id: 'emp_pulse', name: 'Pulso EMP', cooldown: 18, duration: 0,
    desc: 'Inimigos em 200 u perdem 120 de escudo e ficam sem regeneração/reparo por 5 s.', params: { radius: 200, shieldDamage: 120, disruptSeconds: 5 }, kind: 'area' },
  fabricate_drones: { id: 'fabricate_drones', name: 'Fabricar Drones', cooldown: 28, duration: 0,
    desc: 'Fabrica 3 Vetores (máx. 6 vivos).', params: { spawn: 'fer_vetor', count: 3, maxAlive: 6, lifetime: 60 }, kind: 'spawn' },
  reactive_nanites: { id: 'reactive_nanites', name: 'Nanitos Reativos', cooldown: 25, duration: 5,
    desc: 'Repara 20% do casco instantaneamente e continua reparando sob fogo por 5 s.', params: { healFrac: 0.2 }, kind: 'heal' },
  piercing_shot: { id: 'piercing_shot', name: 'Tiro Perfurante', cooldown: 25, duration: 0,
    desc: 'O próximo tiro do canhão magnético causa +50% de dano e atravessa até 4 inimigos em linha.', params: { damageMul: 1.5, maxTargets: 4, coneDeg: 15 }, kind: 'buff' },
  reconstruction: { id: 'reconstruction', name: 'Reconstrução', cooldown: 35, duration: 5,
    desc: 'Aliados em 400 u reparam 15% do casco em 5 s, mesmo sob fogo.', params: { radius: 400, healFrac: 0.15 }, kind: 'aura' },
  emp_storm: { id: 'emp_storm', name: 'Tempestade EMP', cooldown: 45, duration: 4,
    desc: 'Inimigos em 400 u perdem 320 de escudo, ficam sem regeneração por 6 s e recarregam armas 50% mais devagar por 4 s.', params: { radius: 400, shieldDamage: 320, disruptSeconds: 6, cooldownMul: 1.5 }, kind: 'area' },
};

// ---------------------------------------------------------------------------
// Weapon helper
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Weapon
 * @property {string} id
 * @property {string} name          pt-BR display name
 * @property {string} type          one of WEAPON_TYPES
 * @property {number} damage        per shot
 * @property {number} salvo         shots per trigger
 * @property {number} cooldown      seconds between triggers
 * @property {number} range         u
 * @property {number} speed         projectile speed u/s; 0 = hitscan
 * @property {number} arc           half-angle in degrees the target must be within (180 = turret)
 * @property {number} aoe           splash radius (0 = single target)
 * @property {{dps:number,duration:number}|null} dot  damage over time applied on hit (ignores DR)
 * @property {boolean} homing       missile/torpedo: tracks its target
 * @property {boolean} interceptable  can be shot down by point defense / flak
 * @property {string} minTargetClass  smallest size class this weapon fires at
 * @property {boolean} pd           can target enemy projectiles (point defense)
 * @property {number} [charge]      seconds of telegraphed charge before firing (heavy beams)
 * @property {{targets:number,radius:number,damage:number}} [chain]  secondary targets (chain beam)
 * @property {boolean} [contact]    melee: always hits
 */
function W(id, name, type, o) {
  return {
    id, name, type,
    damage: o.dmg, salvo: o.salvo ?? 1, cooldown: o.cd, range: o.range, speed: o.speed ?? 0,
    arc: o.arc ?? 180, aoe: o.aoe ?? 0, dot: o.dot ?? null,
    homing: o.homing ?? (type === 'missile' || type === 'torpedo'),
    interceptable: o.interceptable ?? (type === 'missile' || type === 'torpedo'),
    minTargetClass: o.minTargetClass ?? (type === 'torpedo' ? 'medium' : 'tiny'),
    pd: o.pd ?? false,
    ...(o.charge ? { charge: o.charge } : {}),
    ...(o.chain ? { chain: o.chain } : {}),
    ...(o.contact ? { contact: true } : {}),
  };
}

function S(o) {
  const sc = SIZE_CLASS[o.sizeClass];
  return {
    id: o.id, faction: o.faction, name: o.name, desc: o.desc, sizeClass: o.sizeClass, role: o.role,
    cost: o.cost, hp: o.hp, hullType: FACTIONS[o.faction].hull, dr: o.dr ?? 0, regen: o.regen ?? 0,
    shield: o.shield ?? { cap: 0, regen: 0, delay: 0 },
    speed: o.speed, turnRate: o.turn, accel: sc.accel, radius: sc.radius, mass: sc.mass,
    weapons: o.weapons, ability: o.ability,
    spawnable: o.spawnable ?? false,
  };
}

// ---------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------

const TERRAN = [
  S({ id: 'ter_vespa', faction: 'terran', name: 'Interceptador Vespa', sizeClass: 'tiny', role: 'diver', cost: 17,
    desc: 'Caça leve e ágil. Barato, rápido e descartável; ótimo para distrair mísseis.',
    hp: 60, dr: 1, speed: 190, turn: 380, spawnable: true,
    weapons: [W('ter_autocannon_light', 'Autocanhão leve', 'kinetic', { dmg: 5, salvo: 2, cd: 0.6, range: 220, speed: 600, arc: 40 })],
    ability: 'afterburner' }),
  S({ id: 'ter_falcao', faction: 'terran', name: 'Corveta Falcão', sizeClass: 'small', role: 'brawler', cost: 60,
    desc: 'Corveta de linha com autocanhões e mísseis. Contramedidas confundem torpedos.',
    hp: 140, dr: 2, speed: 140, turn: 240,
    weapons: [
      W('ter_autocannon', 'Autocanhão duplo', 'kinetic', { dmg: 7, salvo: 2, cd: 0.6, range: 260, speed: 650, arc: 60 }),
      W('ter_missile_light', 'Mísseis leves', 'missile', { dmg: 18, salvo: 2, cd: 4.0, range: 450, speed: 320, arc: 120 }),
    ],
    ability: 'countermeasures' }),
  S({ id: 'ter_lanca', faction: 'terran', name: 'Lancha-Torpedeira Lança', sizeClass: 'small', role: 'striker', cost: 34,
    desc: 'Lancha furtiva armada com um torpedo pesado. Caça naves grandes.',
    hp: 150, dr: 1, speed: 150, turn: 250,
    weapons: [W('ter_torpedo', 'Torpedo pesado', 'torpedo', { dmg: 140, cd: 8.0, range: 500, speed: 250, arc: 60 })],
    ability: 'stealth_strike' }),
  S({ id: 'ter_artemis', faction: 'terran', name: 'Destróier Ártemis', sizeClass: 'medium', role: 'escort', cost: 105,
    desc: 'Destróier antiaéreo. Flak contra enxames e cortina contra mísseis.',
    hp: 320, dr: 3, speed: 100, turn: 150,
    weapons: [
      W('ter_flak', 'Canhão flak', 'flak', { dmg: 6, salvo: 3, cd: 0.8, range: 320, speed: 500, aoe: 40, pd: true }),
      W('ter_autocannon', 'Autocanhão duplo', 'kinetic', { dmg: 7, salvo: 2, cd: 0.6, range: 260, speed: 650 }),
    ],
    ability: 'flak_curtain' }),
  S({ id: 'ter_orion', faction: 'terran', name: 'Cruzador Órion', sizeClass: 'medium', role: 'brawler', cost: 130,
    desc: 'Cruzador generalista: canhões e lançadores de mísseis em barragem.',
    hp: 380, dr: 4, speed: 95, turn: 145,
    weapons: [
      W('ter_cannon', 'Canhão naval', 'kinetic', { dmg: 17, salvo: 2, cd: 0.9, range: 320, speed: 700 }),
      W('ter_missile_rack', 'Lançador de mísseis', 'missile', { dmg: 20, salvo: 4, cd: 5.0, range: 520, speed: 320 }),
    ],
    ability: 'barrage_fire' }),
  S({ id: 'ter_hercules', faction: 'terran', name: 'Encouraçado Hércules', sizeClass: 'large', role: 'brawler', cost: 240,
    desc: 'Encouraçado pesado com escudo. Aguenta castigo e dispara torpedos.',
    hp: 880, dr: 6, shield: { cap: 200, regen: 10, delay: 5 }, speed: 65, turn: 85,
    weapons: [
      W('ter_heavy_cannon', 'Canhão pesado', 'kinetic', { dmg: 40, salvo: 2, cd: 1.5, range: 420, speed: 750 }),
      W('ter_torpedo_tubes', 'Tubos de torpedo', 'torpedo', { dmg: 110, salvo: 2, cd: 10.0, range: 550, speed: 250, arc: 90 }),
    ],
    ability: 'reactive_armor' }),
  S({ id: 'ter_atlas', faction: 'terran', name: 'Porta-Naves Atlas', sizeClass: 'capital', role: 'carrier', cost: 330,
    desc: 'Porta-naves com defesa de ponto. Lança esquadrilhas de Vespas.',
    hp: 1400, dr: 5, shield: { cap: 450, regen: 20, delay: 6 }, speed: 50, turn: 55,
    weapons: [W('ter_pd', 'Defesa de ponto', 'kinetic', { dmg: 10, salvo: 2, cd: 0.35, range: 300, speed: 650, pd: true })],
    ability: 'launch_squadron' }),
  S({ id: 'ter_prometeu', faction: 'terran', name: 'Nave-Mãe Prometeu', sizeClass: 'mothership', role: 'anchor', cost: 470,
    desc: 'Capitânia da Confederação. Canhão magnético, mísseis e protocolo de cerco.',
    hp: 3000, dr: 8, shield: { cap: 1000, regen: 40, delay: 7 }, speed: 40, turn: 35,
    weapons: [
      W('ter_railgun', 'Canhão magnético', 'railgun', { dmg: 190, cd: 5.0, range: 750, speed: 1500, arc: 60 }),
      W('ter_missile_battery', 'Bateria de mísseis', 'missile', { dmg: 24, salvo: 5, cd: 3.0, range: 550, speed: 320 }),
    ],
    ability: 'siege_protocol' }),
];

const VORRAX = [
  S({ id: 'vor_larva', faction: 'vorrax', name: 'Larva', sizeClass: 'tiny', role: 'diver', cost: 10,
    desc: 'Organismo mínimo e numeroso. Explode em bile ao morrer.',
    hp: 36, regen: 1.0, speed: 200, turn: 420, spawnable: true,
    weapons: [W('vor_spit_small', 'Cuspe', 'bio', { dmg: 5, cd: 0.6, range: 180, speed: 450, arc: 40 })],
    ability: 'bile_burst' }),
  S({ id: 'vor_zangao', faction: 'vorrax', name: 'Zangão', sizeClass: 'small', role: 'diver', cost: 35,
    desc: 'Caçador rápido que entra em frenesi quando aliados morrem.',
    hp: 130, regen: 2.0, speed: 165, turn: 260, spawnable: true,
    weapons: [W('vor_bioplasma', 'Bioplasma', 'plasma', { dmg: 13, cd: 0.8, range: 240, speed: 480, arc: 50 })],
    ability: 'frenzy' }),
  S({ id: 'vor_cuspidor', faction: 'vorrax', name: 'Cuspidor', sizeClass: 'small', role: 'kiter', cost: 40,
    desc: 'Artilharia ácida de longo alcance. Deixa nuvens corrosivas.',
    hp: 100, regen: 1.5, speed: 130, turn: 220,
    weapons: [W('vor_acid_lob', 'Cuspe ácido', 'bio', { dmg: 24, cd: 2.5, range: 420, speed: 300, arc: 90, dot: { dps: 5, duration: 4 } })],
    ability: 'acid_cloud' }),
  S({ id: 'vor_carrapato', faction: 'vorrax', name: 'Carrapato', sizeClass: 'medium', role: 'diver', cost: 88,
    desc: 'Parasita que se agarra a naves grandes e drena o casco delas.',
    hp: 400, regen: 4.0, speed: 125, turn: 160,
    weapons: [
      W('vor_mandibles', 'Mandíbulas', 'bio', { dmg: 24, cd: 1.0, range: 40, speed: 0, arc: 60, contact: true }),
      W('vor_spit', 'Cuspe', 'bio', { dmg: 5, cd: 0.8, range: 200, speed: 450, arc: 90 }),
    ],
    ability: 'leech' }),
  S({ id: 'vor_matriz', faction: 'vorrax', name: 'Matriz Voadora', sizeClass: 'medium', role: 'carrier', cost: 120,
    desc: 'Incubadora móvel. Lança esporos e gera larvas.',
    hp: 350, regen: 4.0, speed: 90, turn: 140,
    weapons: [W('vor_spores', 'Esporos', 'bio', { dmg: 8, cd: 1.5, range: 300, speed: 350, aoe: 50 })],
    ability: 'spawn_brood' }),
  S({ id: 'vor_mandibula', faction: 'vorrax', name: 'Mandíbula', sizeClass: 'large', role: 'brawler', cost: 220,
    desc: 'Besta de assalto com plasma e torpedos vivos. Troca de pele quando ferida.',
    hp: 950, dr: 3, regen: 9, speed: 70, turn: 90,
    weapons: [
      W('vor_plasma_heavy', 'Plasma pesado', 'plasma', { dmg: 32, salvo: 2, cd: 1.2, range: 360, speed: 480 }),
      W('vor_living_torpedo', 'Torpedo vivo', 'torpedo', { dmg: 100, cd: 9.0, range: 500, speed: 200, arc: 90 }),
    ],
    ability: 'molt' }),
  S({ id: 'vor_rainha', faction: 'vorrax', name: 'Rainha-Guerreira', sizeClass: 'capital', role: 'brawler', cost: 320,
    desc: 'Rainha de combate. Espinhos de plasma, artilharia ácida e feromônio de guerra.',
    hp: 2100, regen: 16, speed: 50, turn: 55,
    weapons: [
      W('vor_spines', 'Espinhos de plasma', 'plasma', { dmg: 12, salvo: 3, cd: 0.6, range: 380, speed: 500 }),
      W('vor_acid_artillery', 'Artilharia ácida', 'bio', { dmg: 44, cd: 3.0, range: 520, speed: 300, aoe: 60 }),
    ],
    ability: 'war_pheromone' }),
  S({ id: 'vor_colmeia', faction: 'vorrax', name: 'Colmeia-Mãe', sizeClass: 'mothership', role: 'anchor', cost: 520,
    desc: 'Coração do enxame. Vomita plasma e gera prole sem fim.',
    hp: 3800, dr: 4, regen: 13, speed: 38, turn: 35,
    weapons: [
      W('vor_plasma_vomit', 'Vômito de plasma', 'plasma', { dmg: 120, cd: 4.0, range: 600, speed: 400, aoe: 50, arc: 90 }),
      W('vor_spores_heavy', 'Esporos', 'bio', { dmg: 8, salvo: 2, cd: 1.5, range: 300, speed: 350, aoe: 50 }),
    ],
    ability: 'endless_swarm' }),
];

const LUMEN = [
  S({ id: 'lum_centelha', faction: 'lumen', name: 'Centelha', sizeClass: 'tiny', role: 'diver', cost: 20,
    desc: 'Fragmento de luz veloz. Pisca pelo campo de batalha.',
    hp: 30, shield: { cap: 50, regen: 6, delay: 2 }, speed: 210, turn: 420,
    weapons: [W('lum_laser_light', 'Laser leve', 'laser', { dmg: 8, cd: 0.5, range: 240, arc: 40 })],
    ability: 'blink' }),
  S({ id: 'lum_prisma', faction: 'lumen', name: 'Prisma', sizeClass: 'small', role: 'kiter', cost: 55,
    desc: 'Escolta de laser. Sobrecarrega o escudo quando ele cai.',
    hp: 70, shield: { cap: 100, regen: 12, delay: 3 }, speed: 150, turn: 250,
    weapons: [W('lum_laser', 'Laser', 'laser', { dmg: 15, cd: 0.7, range: 320, arc: 60 })],
    ability: 'shield_overload' }),
  S({ id: 'lum_veu', faction: 'lumen', name: 'Véu', sizeClass: 'small', role: 'support', cost: 46,
    desc: 'Nave de apoio. Projeta mantos de escudo nos aliados.',
    hp: 80, shield: { cap: 150, regen: 15, delay: 3 }, speed: 145, turn: 240,
    weapons: [W('lum_ion_light', 'Emissor iônico', 'ion', { dmg: 15, cd: 1.0, range: 350, arc: 90 })],
    ability: 'mantle' }),
  S({ id: 'lum_harmonico', faction: 'lumen', name: 'Harmônico', sizeClass: 'medium', role: 'kiter', cost: 140,
    desc: 'Plataforma de Lança Solar: laser pesado de longo alcance.',
    hp: 200, shield: { cap: 280, regen: 25, delay: 4 }, speed: 100, turn: 150,
    weapons: [
      W('lum_solar_lance', 'Lança Solar', 'laser', { dmg: 30, cd: 1.0, range: 420, arc: 60 }),
      W('lum_laser_light2', 'Lasers leves', 'laser', { dmg: 6, salvo: 2, cd: 0.5, range: 260 }),
    ],
    ability: 'prismatic_focus' }),
  S({ id: 'lum_ressonante', faction: 'lumen', name: 'Ressonante', sizeClass: 'medium', role: 'brawler', cost: 110,
    desc: 'Canhão iônico e pulso dissonante que apaga escudos e regeneração.',
    hp: 200, shield: { cap: 320, regen: 25, delay: 4 }, speed: 100, turn: 150,
    weapons: [W('lum_ion_cannon', 'Canhão iônico', 'ion', { dmg: 32, cd: 1.5, range: 400, speed: 700 })],
    ability: 'dissonant_pulse' }),
  S({ id: 'lum_serafim', faction: 'lumen', name: 'Serafim', sizeClass: 'large', role: 'brawler', cost: 240,
    desc: 'Nave de batalha cristalina. Salta de fase com os aliados.',
    hp: 500, shield: { cap: 700, regen: 45, delay: 5 }, speed: 70, turn: 90,
    weapons: [W('lum_twin_lance', 'Lanças gêmeas', 'laser', { dmg: 42, salvo: 2, cd: 1.4, range: 480 })],
    ability: 'phase_jump' }),
  S({ id: 'lum_catedral', faction: 'lumen', name: 'Catedral', sizeClass: 'capital', role: 'kiter', cost: 340,
    desc: 'Catedral de luz. Coro radiante que atinge vários alvos e aurora restauradora.',
    hp: 1000, shield: { cap: 1300, regen: 80, delay: 6 }, speed: 48, turn: 55,
    weapons: [
      W('lum_radiant_choir', 'Coro Radiante', 'laser', { dmg: 96, cd: 3.0, range: 600, chain: { targets: 2, radius: 150, damage: 48 } }),
      W('lum_laser_light3', 'Lasers leves', 'laser', { dmg: 6, salvo: 2, cd: 0.5, range: 260 }),
    ],
    ability: 'aurora' }),
  S({ id: 'lum_luz_primordial', faction: 'lumen', name: 'Luz Primordial', sizeClass: 'mothership', role: 'anchor', cost: 520,
    desc: 'A primeira luz. Feixe devastador telegrafado e singularidade gravitacional.',
    hp: 1800, shield: { cap: 2200, regen: 100, delay: 8 }, speed: 38, turn: 35,
    weapons: [
      W('lum_primordial_beam', 'Feixe Primordial', 'laser', { dmg: 250, cd: 6.0, range: 800, arc: 90, charge: 1.0, minTargetClass: 'medium' }),
      W('lum_laser_array', 'Matriz de lasers', 'laser', { dmg: 8, salvo: 4, cd: 0.6, range: 300 }),
    ],
    ability: 'singularity' }),
];

const FERRIX = [
  S({ id: 'fer_vetor', faction: 'ferrix', name: 'Vetor', sizeClass: 'tiny', role: 'diver', cost: 17,
    desc: 'Drone de combate com metralhadora. Sobrecarrega em grupo.',
    hp: 70, regen: 3, speed: 185, turn: 380, spawnable: true,
    weapons: [W('fer_gatling', 'Metralhadora', 'kinetic', { dmg: 5, cd: 0.3, range: 200, speed: 650, arc: 40 })],
    ability: 'overclock' }),
  S({ id: 'fer_sentinela', faction: 'ferrix', name: 'Sentinela', sizeClass: 'small', role: 'kiter', cost: 55,
    desc: 'Atirador de canhão magnético. Vira torre fixa para alcance máximo.',
    hp: 130, regen: 4, speed: 140, turn: 230,
    weapons: [W('fer_railgun_light', 'Canhão magnético leve', 'railgun', { dmg: 36, cd: 2.0, range: 450, speed: 1200, arc: 30 })],
    ability: 'turret_mode' }),
  S({ id: 'fer_disruptor', faction: 'ferrix', name: 'Disruptor', sizeClass: 'small', role: 'brawler', cost: 46,
    desc: 'Especialista em guerra eletrônica. Pulsos EMP de curto alcance.',
    hp: 200, regen: 6, speed: 145, turn: 240,
    weapons: [W('fer_ion_light', 'Emissor iônico', 'ion', { dmg: 15, cd: 0.8, range: 300, speed: 600, arc: 90, aoe: 40 })],
    ability: 'emp_pulse' }),
  S({ id: 'fer_fabricador', faction: 'ferrix', name: 'Fabricador', sizeClass: 'medium', role: 'carrier', cost: 125,
    desc: 'Fábrica móvel que monta Vetores em combate.',
    hp: 300, regen: 8, speed: 95, turn: 145,
    weapons: [W('fer_cannon_light', 'Canhão', 'kinetic', { dmg: 12, cd: 0.7, range: 280, speed: 650 })],
    ability: 'fabricate_drones' }),
  S({ id: 'fer_bastiao', faction: 'ferrix', name: 'Bastião', sizeClass: 'medium', role: 'brawler', cost: 125,
    desc: 'Nave de linha com repetidores de plasma e nanitos reativos.',
    hp: 480, dr: 3, regen: 10, speed: 95, turn: 145,
    weapons: [W('fer_plasma_repeater', 'Repetidor de plasma', 'plasma', { dmg: 20, salvo: 2, cd: 1.0, range: 320, speed: 500 })],
    ability: 'reactive_nanites' }),
  S({ id: 'fer_ariete', faction: 'ferrix', name: 'Aríete', sizeClass: 'large', role: 'kiter', cost: 210,
    desc: 'Canhão magnético pesado em um casco de nanitos. Tiros perfurantes.',
    hp: 900, dr: 4, regen: 15, speed: 60, turn: 80,
    weapons: [
      W('fer_railgun_heavy', 'Canhão magnético pesado', 'railgun', { dmg: 140, cd: 3.5, range: 650, speed: 1500, arc: 25 }),
      W('fer_ion_light2', 'Emissor iônico', 'ion', { dmg: 8, cd: 0.8, range: 300, speed: 600 }),
    ],
    ability: 'piercing_shot' }),
  S({ id: 'fer_nucleo', faction: 'ferrix', name: 'Núcleo Fabril', sizeClass: 'capital', role: 'carrier', cost: 310,
    desc: 'Âncora de sustentação Ferrix. Reconstrói aliados e tem defesa iônica.',
    hp: 1800, dr: 5, regen: 25, speed: 48, turn: 52,
    weapons: [
      W('fer_railgun_twin', 'Canhões magnéticos duplos', 'railgun', { dmg: 80, salvo: 2, cd: 3.0, range: 600, speed: 1500 }),
      W('fer_ion_pd', 'Defesa iônica', 'ion', { dmg: 8, salvo: 2, cd: 0.5, range: 240, speed: 600, pd: true }),
    ],
    ability: 'reconstruction' }),
  S({ id: 'fer_mente', faction: 'ferrix', name: 'Mente Primária', sizeClass: 'mothership', role: 'anchor', cost: 480,
    desc: 'O nó central do Nexo. Canhão magnético de cerco e tempestade EMP.',
    hp: 3800, dr: 7, regen: 40, speed: 40, turn: 35,
    weapons: [
      W('fer_siege_railgun', 'Canhão magnético de cerco', 'railgun', { dmg: 300, cd: 7.0, range: 850, speed: 1500, arc: 40, minTargetClass: 'small' }),
      W('fer_ion_burst', 'Rajada iônica', 'ion', { dmg: 40, cd: 3.0, range: 500, speed: 600, aoe: 100 }),
    ],
    ability: 'emp_storm' }),
];

export const SHIP_LIST = [...TERRAN, ...VORRAX, ...LUMEN, ...FERRIX];
export const SHIPS = Object.freeze(Object.fromEntries(SHIP_LIST.map((s) => [s.id, s])));

export function getShip(id) {
  const s = SHIPS[id];
  if (!s) throw new Error(`Unknown ship class: ${id}`);
  return s;
}

export function shipsOfFaction(factionId) {
  return SHIP_LIST.filter((s) => s.faction === factionId);
}

export function sizeIndex(sizeClass) {
  return SIZE_CLASS[sizeClass].index;
}

/** Raw DPS (before accuracy/multipliers) for display and heuristics. */
export function shipDps(ship) {
  return ship.weapons.reduce((sum, w) => sum + (w.damage * w.salvo) / w.cooldown, 0);
}

/** Effective HP (hull + shield) for display and heuristics. */
export function shipEhp(ship) {
  return ship.hp + ship.shield.cap;
}

// ---------------------------------------------------------------------------
// Presets (fleet templates), scaled to the budget by the fleet module
// ---------------------------------------------------------------------------

/**
 * Each preset lists ships in purchase priority order with target counts for a
 * 1500-point budget. `fleet.js` scales counts to the actual budget.
 * @type {Record<string, {id:string, faction:string, name:string, desc:string, style:string, ships:[string, number][]}>}
 */
export const PRESETS = {
  ter_linha: { id: 'ter_linha', faction: 'terran', name: 'Linha de Batalha', style: 'balanced',
    desc: 'Nave-mãe, encouraçado e cruzadores com escolta de corvetas.',
    ships: [['ter_prometeu', 1], ['ter_hercules', 1], ['ter_orion', 2], ['ter_artemis', 2], ['ter_lanca', 2], ['ter_falcao', 2], ['ter_vespa', 5]] },
  ter_atlas: { id: 'ter_atlas', faction: 'terran', name: 'Doutrina Atlas', style: 'carrier',
    desc: 'Porta-naves e encouraçados: atrito com esquadrilhas e defesa de ponto.',
    ships: [['ter_atlas', 1], ['ter_hercules', 4], ['ter_artemis', 2]] },
  ter_misseis: { id: 'ter_misseis', faction: 'terran', name: 'Enxame de Mísseis', style: 'alpha',
    desc: 'Cruzadores e lanchas-torpedeiras: saturação de mísseis e torpedos.',
    ships: [['ter_prometeu', 1], ['ter_orion', 4], ['ter_artemis', 1], ['ter_lanca', 4], ['ter_falcao', 3], ['ter_vespa', 4]] },

  vor_mare: { id: 'vor_mare', faction: 'vorrax', name: 'Maré Viva', style: 'swarm',
    desc: 'Colmeia-mãe, matrizes e dezenas de larvas e zangões.',
    ships: [['vor_colmeia', 1], ['vor_mandibula', 1], ['vor_matriz', 2], ['vor_zangao', 6], ['vor_cuspidor', 4], ['vor_larva', 14]] },
  vor_garras: { id: 'vor_garras', faction: 'vorrax', name: 'Garras da Rainha', style: 'brawl',
    desc: 'Rainha, mandíbulas e carrapatos: combate corpo a corpo.',
    ships: [['vor_rainha', 1], ['vor_mandibula', 2], ['vor_carrapato', 5], ['vor_zangao', 4], ['vor_larva', 14]] },
  vor_chuva: { id: 'vor_chuva', faction: 'vorrax', name: 'Chuva Ácida', style: 'artillery',
    desc: 'Colmeia, rainha e muitos cuspidores: artilharia ácida à distância.',
    ships: [['vor_colmeia', 1], ['vor_rainha', 1], ['vor_cuspidor', 8], ['vor_matriz', 1], ['vor_zangao', 4], ['vor_larva', 7]] },

  lum_coro: { id: 'lum_coro', faction: 'lumen', name: 'Coro Radiante', style: 'balanced',
    desc: 'Luz Primordial, Serafim e harmônicos com escolta de prismas.',
    ships: [['lum_luz_primordial', 1], ['lum_serafim', 1], ['lum_harmonico', 2], ['lum_ressonante', 1], ['lum_prisma', 4], ['lum_centelha', 3]] },
  lum_catedral: { id: 'lum_catedral', faction: 'lumen', name: 'Catedral Errante', style: 'sustain',
    desc: 'Catedral e serafins com véus de apoio: linha que não cai.',
    ships: [['lum_catedral', 1], ['lum_serafim', 2], ['lum_veu', 3], ['lum_harmonico', 2], ['lum_prisma', 2], ['lum_centelha', 3]] },
  lum_dissonancia: { id: 'lum_dissonancia', faction: 'lumen', name: 'Dissonância', style: 'anti_shield',
    desc: 'Ressonantes e prismas: pulsos que apagam escudos e regeneração.',
    ships: [['lum_luz_primordial', 1], ['lum_ressonante', 3], ['lum_harmonico', 1], ['lum_prisma', 4], ['lum_veu', 2], ['lum_centelha', 4]] },

  fer_ferro: { id: 'fer_ferro', faction: 'ferrix', name: 'Linha de Ferro', style: 'ranged',
    desc: 'Mente Primária, aríetes e sentinelas: canhões magnéticos à distância.',
    ships: [['fer_mente', 1], ['fer_ariete', 2], ['fer_sentinela', 5], ['fer_bastiao', 1], ['fer_disruptor', 2], ['fer_vetor', 8]] },
  fer_fabrica: { id: 'fer_fabrica', faction: 'ferrix', name: 'Fábrica Ambulante', style: 'carrier',
    desc: 'Núcleo fabril, fabricadores e bastiões: drones e sustentação.',
    ships: [['fer_nucleo', 1], ['fer_fabricador', 3], ['fer_bastiao', 2], ['fer_sentinela', 5], ['fer_disruptor', 3], ['fer_vetor', 8]] },
  fer_apagao: { id: 'fer_apagao', faction: 'ferrix', name: 'Apagão', style: 'emp',
    desc: 'Mente Primária e disruptores: tempestade EMP e rajadas iônicas.',
    ships: [['fer_mente', 1], ['fer_ariete', 1], ['fer_disruptor', 5], ['fer_bastiao', 2], ['fer_fabricador', 1], ['fer_sentinela', 2], ['fer_vetor', 6]] },
};

export const PRESET_LIST = Object.values(PRESETS);

export function presetsOfFaction(factionId) {
  return PRESET_LIST.filter((p) => p.faction === factionId);
}
