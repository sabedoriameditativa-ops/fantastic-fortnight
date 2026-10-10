// Battle VFX: maps SimEvents (docs/ARCHITECTURE.md §3.1) to visual effects and
// draws them in the renderer's passes. Composes the SoA particle pool, beams,
// visual projectiles, explosions and shields from client/battle/render/*.
//
// Public surface (used by renderer.js):
//   createEffects({ info, view, cam, teamColors, seed }) →
//     handleEvents(events, now)        presented events of this frame
//     update(dt, now, ships)           advance everything (call after handleEvents)
//     drawArea / drawTrails / drawProjectiles / drawEffects (ctx, cam, dpr, now)
//     drawShipOverlay(ctx, v, inf, sx, sy, zoom, dpr, now, lod)
//     shipState(v, inf, now) → { thrust, boosted, disrupted, spawnScale, alpha }
//     ghosts, quality, setQuality(), onPhase(cb), onEnd(cb), suddenDeath, stats()

import { SHIPS, ABILITIES } from '/shared/catalog.js';
import { createParticles, KIND } from './render/particles.js';
import { createBeams } from './render/beams.js';
import { createProjectiles, KIND_BY_TYPE } from './render/projectiles.js';
import { createExplosions } from './render/explosions.js';
import { createShields } from './render/shields.js';
import { getGlow, getFlash, getSoft } from './render/glow.js';
import { weaponColor, mix, rgba, hash01, makeRand, TAU, clamp } from './render/palette.js';
import { muzzleOffset, shieldRadius } from './sprites.js';

const TURRET_KIND_BY_TYPE = { kinetic: 'light', railgun: 'rail', flak: 'flak', missile: 'missile', torpedo: 'torpedo', plasma: 'plasma', bio: 'acid', ion: 'ion', laser: 'lance' };
const FLASH_KIND_BY_TYPE = { kinetic: 'kinetic', railgun: 'railgun', flak: 'flak', missile: 'missile', torpedo: 'missile', plasma: 'plasma', bio: 'acid', ion: 'ion', laser: 'laser' };
const PROJ_KIND_BY_ID = { vor_living_torpedo: 'ltorpedo', vor_spores: 'spore', vor_spores_heavy: 'spore', ter_pd: 'tracer', fer_ion_pd: 'ion' };
const TRAIL_N = 12;

/**
 * @param {{ info:(id:number)=>object|null, view:(id:number)=>object|null, cam:object, teamColors?:object[], seed?:number }} o
 */
export function createEffects(o) {
  const info = o.info, view = o.view, cam = o.cam;
  const rand = makeRand((o.seed ?? 7) | 0);
  const particles = createParticles(6000);
  const beams = createBeams(256);
  const projectiles = createProjectiles({ particles, max: 900 });
  const explosions = createExplosions({ particles });
  const shields = createShields({ particles });

  const quality = { density: 1, trails: true, chroma: true, anims: true, glow: true };
  let shipCount = 0;

  /** @type {object[]} */ const muzzles = [];
  /** @type {object[]} */ const domes = [];
  /** @type {object[]} */ const empRings = [];
  /** @type {Map<number, object>} */ const areas = new Map();
  /** @type {Map<number, object>} */ const buffs = new Map();
  /** @type {Map<number, object>} */ const charges = new Map();
  /** @type {Map<number, number>} */ const spawnAt = new Map();
  /** @type {Map<number, {ang:number,t:number}>} */ const lastHit = new Map();
  /** @type {Map<number, {x:number,y:number,a:number}>} */ const lastPos = new Map();
  /** @type {Map<number, object>} */ const trails = new Map();
  /** @type {Map<number, number>} */ const emitAt = new Map();
  /** @type {Map<number, number>} */ const healAt = new Map();
  /** @type {Map<number, number>} */ const salvoCount = new Map();
  let suddenDeath = false;
  let phaseCb = null, endCb = null;
  const C = {
    white: particles.color('#ffffff'), spark: particles.color('#ffd27a'), spark2: particles.color('#ff6a3d'),
    chitin: particles.color('#d98d6a'), drop: particles.color('#7dd957'), dropLight: particles.color('#b8ff80'),
    violet: particles.color('#7c5cff'), cyan: particles.color('#bfe9ff'), mint: particles.color('#9bffd6'),
    green: particles.color('#7dff9a'), smokeGreen: particles.color('#4f8a3a'), chaff: particles.color('#ffe9a8'),
    smoke: particles.color('#3a3f48'), gold: particles.color('#d9a21b'), pink: particles.color('#ff6aa0'),
  };

  const posOf = (id) => view(id) || lastPos.get(id) || null;
  /** Density for low-priority emitters (trails, engines): backs off as the pool fills. */
  function lowDensity() {
    const load = particles.load;
    return quality.density * (load > 0.85 ? 0.2 : load > 0.6 ? 0.5 : 1);
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  function muzzleWorld(inf, v, w, salvo) {
    const mo = muzzleOffset(inf.def, TURRET_KIND_BY_TYPE[w.type], salvo);
    const c = Math.cos(v.a), s = Math.sin(v.a);
    return { x: v.x + mo.x * c - mo.y * s, y: v.y + mo.x * s + mo.y * c, ox: mo.x, oy: mo.y };
  }

  function addMuzzle(x, y, a, w, col, now) {
    if (muzzles.length > 200) muzzles.shift();
    const size = clamp(5 + w.damage * 0.25, 5, 22);
    muzzles.push({ x, y, a, kind: FLASH_KIND_BY_TYPE[w.type] || 'kinetic', col, t0: now, size, light: w.damage < 10 });
  }

  function beamKindFor(w) {
    if (w.chain) return 'arc';
    if (w.charge) return 'primordial';
    if (w.type === 'ion') return 'ion';
    if (w.type === 'laser') return w.damage >= 25 ? 'lance' : 'laserLight';
    return 'laserLight';
  }

  function hullSparks(x, y, ang, amount, hullType, pal, teamCol) {
    const n = Math.round(clamp(3 + amount / 8, 3, 14) * quality.density);
    const spread = Math.PI / 3;
    for (let i = 0; i < n; i++) {
      const a = ang + rand.range(-spread, spread), v = rand.range(80, 220);
      const vx = Math.cos(a) * v, vy = Math.sin(a) * v, life = rand.range(150, 350);
      switch (hullType) {
        case 'organic':
          if (i % 3 === 2) particles.spawn(KIND.DROP, x, y, vx * 0.6, vy * 0.6, life * 2, 1.4, 0.5, C.drop, 0, 0, 0.95);
          else particles.spawn(KIND.SPARK, x, y, vx, vy, life, 1, 1, C.chitin);
          break;
        case 'crystalline':
          particles.spawn(KIND.SHARD, x, y, vx * 0.7, vy * 0.7, life * 2.5, 2.2, 1, i % 2 ? C.white : C.violet, a, rand.range(-8, 8), 0.98);
          break;
        case 'nanite':
          particles.spawn(KIND.CUBE, x, y, vx * 0.6, vy * 0.6, life * 2, 1.8, 1.2, i % 2 ? particles.color(teamCol) : C.mint, 0, 0, 0.97);
          break;
        default:
          particles.spawn(KIND.SPARK, x, y, vx, vy, life, 1, 1, i % 2 ? C.spark : C.spark2);
      }
    }
    explosions.flash({ x, y, r: 4 + amount / 20, col: '#ffffff', t0: cam.now || 0, dur: 60 });
    void pal;
  }

  function impactFor(kind, x, y, col, now, outcome) {
    const d = quality.density;
    if (outcome === 2) { explosions.burst(x, y, 12, '#ffd27a', now, d, { fire: 5, shards: 8, smoke: 4, flashCol: '#ffffff' }); return; }
    if (outcome === 0) {
      if (kind === 'missile' || kind === 'torpedo' || kind === 'ltorpedo') explosions.burst(x, y, 8, col, now, d, { fire: 3, smoke: 3, ring: false });
      else if (kind === 'acid' || kind === 'spore') { for (let i = 0; i < 3 * d; i++) particles.spawn(KIND.DROP, x, y, rand.range(-30, 30), rand.range(-30, 30), 300, 1.2, 0.3, C.drop, 0, 0, 0.9); }
      return;
    }
    switch (kind) {
      case 'tracer': explosions.flash({ x, y, r: 3, col, t0: now, dur: 60 }); break;
      case 'flak': explosions.burst(x, y, 10, '#ffb347', now, d, { fire: 4, shards: 10, smoke: 6, flashCol: '#fff0c0' }); break;
      case 'rail': {
        explosions.flash({ x, y, r: 8, col: '#cfe8ff', t0: now, dur: 90 });
        for (let i = 0; i < 6 * d; i++) { const a = rand.range(0, TAU), v = rand.range(100, 260); particles.spawn(KIND.SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(150, 300), 1, 1, C.white); }
        break;
      }
      case 'missile': explosions.burst(x, y, 16, '#ffb347', now, d, { fire: 8, smoke: 4, flashCol: '#fff0c0' }); break;
      case 'torpedo': explosions.burst(x, y, 26, '#ff8a5c', now, d, { fire: 14, smoke: 8, shards: 6, flashCol: '#ffffff', ringDur: 400 }); explosions.flash({ x, y, r: 30, col: '#ffd2b8', t0: now, dur: 200, a: 0.5 }); break;
      case 'ltorpedo': explosions.burst(x, y, 24, '#7dd957', now, d, { fire: 10, smoke: 6, flashCol: '#b8ff80', smokeCol: C.smokeGreen, ringDur: 400 }); for (let i = 0; i < 8 * d; i++) { const a = rand.range(0, TAU), v = rand.range(40, 120); particles.spawn(KIND.DROP, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(400, 700), 1.8, 0.5, C.drop, 0, 0, 0.94); } break;
      case 'plasma': explosions.burst(x, y, 10, col, now, d, { fire: 6, kind: KIND.PLASMA, flashCol: col, ringDur: 200 }); break;
      case 'acid': {
        explosions.flash({ x, y, r: 6, col: '#b8ff80', t0: now, dur: 80 });
        for (let i = 0; i < 8 * d; i++) { const a = rand.range(0, TAU), v = rand.range(30, 110); particles.spawn(KIND.DROP, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(300, 600), 1.6, 0.4, i % 2 ? C.drop : C.dropLight, 0, 0, 0.93); }
        for (let i = 0; i < 3 * d; i++) particles.spawn(KIND.SMOKE, x, y, rand.range(-10, 10), rand.range(-10, 10), 1400, 3, 9, C.smokeGreen, 0, 0, 0.98);
        break;
      }
      case 'spore': for (let i = 0; i < 8 * d; i++) particles.spawn(KIND.PLASMA, x + rand.range(-8, 8), y + rand.range(-8, 8), rand.range(-12, 12), rand.range(-12, 12), rand.range(1200, 2000), 4, 7, C.drop, 0, 0, 0.99); break;
      case 'ion': {
        explosions.flash({ x, y, r: 9, col: '#bfe9ff', t0: now, dur: 100 });
        for (let i = 0; i < 5 * d; i++) { const a = rand.range(0, TAU), v = rand.range(80, 200); particles.spawn(KIND.SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(120, 240), 1, 1, C.cyan); }
        break;
      }
      default: explosions.flash({ x, y, r: 4, col, t0: now, dur: 60 });
    }
  }

  function empRing(x, y, R, col, now, big) {
    if (empRings.length > 40) empRings.shift();
    empRings.push({ x, y, R, col, t0: now, dur: big ? 600 : 400, arcs: big ? 32 : 20, seed: rand.int(0, 1e6) });
    explosions.flash({ x, y, r: R * 0.5, col, t0: now, dur: 200, a: 0.5 });
    const n = Math.round((big ? 30 : 14) * quality.density);
    const ci = particles.color(col);
    for (let i = 0; i < n; i++) { const a = rand.range(0, TAU), v = R / 0.4 * rand.range(0.6, 1); particles.spawn(KIND.SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(250, 450), 1, 1, ci); }
    cam.addTrauma(big ? 0.25 : 0.08);
  }

  function addDome(d) {
    if (domes.length > 40) domes.shift();
    domes.push({ hex: true, grow: 250, ...d });
  }

  function addBuff(id, ms, col, kind, now) {
    buffs.set(id, { until: now + ms, col, kind, t0: now });
  }

  function teleportFx(id, inf, now, destX, destY) {
    const from = lastPos.get(id);
    const pal = inf.pal;
    const S = clamp(inf.def.size / 18, 1, 8);
    if (from) {
      const dx = destX - from.x, dy = destY - from.y;
      beams.add({ kind: 'laserLight', x0: from.x, y0: from.y, x1: destX, y1: destY, colA: pal.team, colB: '#ffffff', t0: now, dur: 220, follow: false, w: 0.8 * Math.sqrt(S), impactR: 6 });
      const ci = particles.color(pal.team);
      for (let i = 0; i < 8 * quality.density; i++) particles.spawn(KIND.GLOW, from.x + rand.range(-4, 4) * S, from.y + rand.range(-4, 4) * S, dx * 0.5 + rand.range(-20, 20), dy * 0.5 + rand.range(-20, 20), rand.range(250, 400), 3 * S, 0.5, ci, 0, 0, 0.9);
      explosions.flash({ x: from.x, y: from.y, r: 10 * S, col: pal.team, t0: now, dur: 150, a: 0.7 });
    }
    explosions.ring({ x: destX, y: destY, r0: 24 * S, r1: 2, lw: 2, col: pal.team, t0: now, dur: 180, a0: 0.9 });
    explosions.flash({ x: destX, y: destY, r: 14 * S, col: '#ffffff', t0: now, dur: 160, a: 0.8 });
    if (inf.faction === 'lumen') {
      // crystal assembling: 6 shards converging
      const ci = particles.color(pal.hullLight);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, d = 30 * S; particles.spawn(KIND.SHARD, destX + Math.cos(a) * d, destY + Math.sin(a) * d, -Math.cos(a) * d * 4, -Math.sin(a) * d * 4, 250, 3 * S, 1, ci, a, 0, 1); }
    }
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  function handleCast(e, now) {
    const [, src, abilityId, target, x, y] = e;
    const inf = info(src);
    if (!inf) return;
    const v = posOf(src) || { x, y, a: 0 };
    const pal = inf.pal, team = pal.team;
    const ab = ABILITIES[abilityId];
    const kind = ab ? ab.kind : 'buff';
    const prm = ab ? ab.params : {};
    const S = clamp(inf.def.size / 18, 1, 8);
    const d = quality.density;
    switch (abilityId) {
      case 'afterburner': addBuff(src, 3000, team, 'boost', now); explosions.flash({ x: v.x, y: v.y, r: 8 * S, col: team, t0: now, dur: 150, a: 0.7 }); break;
      case 'countermeasures': {
        addBuff(src, 6000, '#ffe9a8', 'chaff', now);
        for (let i = 0; i < 14 * d; i++) { const a = rand.range(0, TAU), vv = rand.range(40, 120); particles.spawn(KIND.DOT, v.x, v.y, Math.cos(a) * vv, Math.sin(a) * vv, rand.range(800, 1500), 1.4, 1, i % 2 ? C.chaff : C.white, 0, 0, 0.96); }
        break;
      }
      case 'stealth_strike': explosions.ring({ x: v.x, y: v.y, r0: 20 * S, r1: 2, lw: 2, col: '#ffffff', t0: now, dur: 250, a0: 0.8 }); break;
      case 'flak_curtain': addDome({ x: v.x, y: v.y, r: prm.radius || 250, col: '#ffd27a', t0: now, t1: now + 5000, kind: 'curtain', hex: false, dash: 8, followId: src }); addBuff(src, 5000, '#ffd27a', 'glow', now); break;
      case 'barrage_fire': addBuff(src, 4000, '#ffb347', 'glow', now); break;
      case 'reactive_armor': addBuff(src, 6000, '#c9d3df', 'armor', now); explosions.ring({ x: v.x, y: v.y, r0: 2, r1: inf.def.size * 0.7, lw: 3, col: '#c9d3df', t0: now, dur: 300, a0: 0.9 }); break;
      case 'launch_squadron': case 'spawn_brood': case 'fabricate_drones': case 'endless_swarm':
        explosions.flash({ x: v.x, y: v.y, r: 12 * S, col: team, t0: now, dur: 300, a: 0.8 });
        if (abilityId === 'endless_swarm') addDome({ x: v.x, y: v.y, r: prm.auraRadius || 300, col: '#7dd957', t0: now, t1: now + 4000, kind: 'aura', followId: src });
        break;
      case 'siege_protocol': addDome({ x: v.x, y: v.y, r: prm.radius || 600, col: '#d9a21b', t0: now, t1: now + 6000, kind: 'aura', followId: src }); addBuff(src, 6000, '#d9a21b', 'glow', now); cam.addTrauma(0.1); break;
      case 'bile_burst': impactFor('acid', x, y, '#7dd957', now, 1); break;
      case 'frenzy': addBuff(src, 4000, '#ff6aa0', 'rage', now); for (let i = 0; i < 6 * d; i++) { const a = rand.range(0, TAU); particles.spawn(KIND.DROP, v.x, v.y, Math.cos(a) * 60, Math.sin(a) * 60, 400, 1.5, 0.4, C.pink, 0, 0, 0.94); } break;
      case 'acid_cloud': {
        // spit arc from the caster to the target point
        const n = Math.round(10 * d);
        for (let i = 0; i < n; i++) { const t = i / n; const px = v.x + (x - v.x) * t, py = v.y + (y - v.y) * t; particles.spawn(KIND.DROP, px, py, rand.range(-15, 15), rand.range(-15, 15), 300 + t * 400, 1.6, 0.5, C.drop, 0, 0, 0.95); }
        break;
      }
      case 'leech': {
        if (target) {
          beams.add({ kind: 'tendril', srcId: src, dstId: target, x0: v.x, y0: v.y, x1: x, y1: y, ox: inf.def.size * 0.4, oy: 0, colA: pal.hullLight, colB: '#7dd957', t0: now, dur: (ab.duration || 5) * 1000, impactR: 6 });
          explosions.flash({ x, y, r: 10, col: '#7dd957', t0: now, dur: 200, a: 0.8 });
        }
        break;
      }
      case 'molt': {
        addBuff(src, 5000, '#b8ff80', 'heal', now);
        const ci = particles.color(pal.hullLight);
        for (let i = 0; i < 10 * d; i++) { const a = rand.range(0, TAU), vv = rand.range(30, 80); particles.spawn(KIND.DEBRIS, v.x, v.y, Math.cos(a) * vv, Math.sin(a) * vv, rand.range(800, 1400), 3 * Math.sqrt(S), 1, ci, a, rand.range(-4, 4), 0.97); }
        explosions.flash({ x: v.x, y: v.y, r: 12 * S, col: '#b8ff80', t0: now, dur: 300, a: 0.7 });
        break;
      }
      case 'war_pheromone': addDome({ x: v.x, y: v.y, r: prm.radius || 500, col: '#ff6aa0', t0: now, t1: now + 8000, kind: 'spores', followId: src }); addBuff(src, 8000, '#ff6aa0', 'rage', now); break;
      case 'blink': teleportFx(src, inf, now, x, y); break;
      case 'phase_jump': teleportFx(src, inf, now, x, y); explosions.ring({ x, y, r0: prm.radius || 150, r1: 10, lw: 2, col: team, t0: now, dur: 350, a0: 0.8 }); cam.addTrauma(0.08); break;
      case 'shield_overload': shields.restored(src, now); explosions.ring({ x: v.x, y: v.y, r0: 2, r1: shieldRadius(inf.def), lw: 3, col: team, t0: now, dur: 300, a0: 0.9 }); explosions.flash({ x: v.x, y: v.y, r: 14 * S, col: team, t0: now, dur: 250, a: 0.8 }); break;
      case 'mantle': {
        if (target) {
          beams.add({ kind: 'repair', srcId: src, dstId: target, x0: v.x, y0: v.y, x1: x, y1: y, colA: team, colB: '#ffffff', t0: now, dur: 450 });
          addBuff(target, (ab.duration || 8) * 1000, team, 'mantle', now);
        }
        break;
      }
      case 'prismatic_focus': addBuff(src, 4000, '#ffffff', 'focus', now); break;
      case 'dissonant_pulse': empRing(x, y, prm.radius || 220, '#b8f0ff', now, false); break;
      case 'aurora': addDome({ x: v.x, y: v.y, r: prm.radius || 400, col: team, t0: now, t1: now + 6000, kind: 'aurora', followId: src }); break;
      case 'singularity': explosions.ring({ x, y, r0: (prm.radius || 250) * 1.2, r1: 4, lw: 3, col: '#7c5cff', t0: now, dur: 500, a0: 0.9 }); explosions.flash({ x, y, r: 60, col: '#7c5cff', t0: now, dur: 400, a: 0.7 }); cam.addTrauma(0.15); break;
      case 'overclock': addBuff(src, 3000, '#9bffd6', 'glow', now); break;
      case 'turret_mode': addBuff(src, 6000, '#9bffd6', 'anchor', now); explosions.ring({ x: v.x, y: v.y, r0: 2, r1: inf.def.size * 0.9, lw: 2, col: '#9bffd6', t0: now, dur: 400, a0: 0.8 }); break;
      case 'emp_pulse': empRing(x, y, prm.radius || 150, '#bfe9ff', now, false); break;
      case 'reactive_nanites': {
        addBuff(src, 5000, '#9bffd6', 'heal', now);
        for (let i = 0; i < 20 * d; i++) { const a = rand.range(0, TAU), r = inf.def.size * 0.5; particles.spawn(KIND.DOT, v.x + Math.cos(a) * r, v.y + Math.sin(a) * r, -Math.sin(a) * 40, Math.cos(a) * 40, rand.range(600, 1000), 1.6, 1, C.mint, 0, 0, 0.98); }
        break;
      }
      case 'piercing_shot': addBuff(src, 1500, '#cfe8ff', 'focus', now); break;
      case 'reconstruction': addDome({ x: v.x, y: v.y, r: prm.radius || 400, col: '#9bffd6', t0: now, t1: now + 5000, kind: 'nanite', followId: src }); break;
      case 'emp_storm': empRing(x, y, prm.radius || 400, '#bfe9ff', now, true); break;
      default:
        if (kind === 'area') explosions.ring({ x, y, r0: 4, r1: prm.radius || 100, lw: 2, col: team, t0: now, dur: 400, a0: 0.8 });
        else if (kind === 'aura') addDome({ x: v.x, y: v.y, r: prm.radius || 300, col: team, t0: now, t1: now + ((ab && ab.duration) || 5) * 1000, kind: 'aura', followId: src });
        else addBuff(src, ((ab && ab.duration) || 3) * 1000, team, 'glow', now);
    }
  }

  function handleEvent(e, now) {
    switch (e[0]) {
      case 'shot': {
        const [, src, dst, wIdx, hit] = e;
        const inf = info(src); const v = posOf(src); const dv = posOf(dst);
        if (!inf || !v || !dv) break;
        const w = inf.cat.weapons[wIdx] || inf.cat.weapons[0];
        if (!w) break;
        const col = weaponColor(w.type, inf.pal.team);
        const ang = Math.atan2(dv.y - v.y, dv.x - v.x);
        if (w.contact) {
          const ci = particles.color(inf.pal.accent);
          for (let i = 0; i < 6 * quality.density; i++) { const a = ang + rand.range(-0.8, 0.8), vv = rand.range(40, 120); particles.spawn(KIND.SPARK, dv.x, dv.y, Math.cos(a) * vv, Math.sin(a) * vv, rand.range(120, 240), 1, 1, ci); }
          explosions.flash({ x: dv.x, y: dv.y, r: 8, col: inf.pal.accent, t0: now, dur: 90, a: 0.9 });
          lastHit.set(dst, { ang, t: now });
          break;
        }
        const sc = (salvoCount.get(src) || 0); salvoCount.set(src, sc + 1);
        const m = muzzleWorld(inf, v, w, sc);
        let x1 = dv.x, y1 = dv.y;
        if (!hit) { const off = rand.range(18, 40) * (rand() < 0.5 ? -1 : 1); x1 += -Math.sin(ang) * off + Math.cos(ang) * 30; y1 += Math.cos(ang) * off + Math.sin(ang) * 30; }
        const kind = beamKindFor(w);
        beams.add({ kind, srcId: src, dstId: hit ? dst : 0, x0: m.x, y0: m.y, x1, y1, ox: m.ox, oy: m.oy, colA: col, colB: '#ffffff', t0: now, w: kind === 'arc' ? 1 : undefined, impactR: 6 + w.damage * 0.08 });
        if (!(cam.zoom < 0.5 && w.damage < 10)) addMuzzle(m.x, m.y, ang, w, col, now);
        if (kind === 'primordial') { cam.addTrauma(0.2); explosions.burst(x1, y1, 30, col, now, quality.density, { fire: 10, kind: KIND.PLASMA, flashCol: '#ffffff', ringDur: 500 }); charges.delete(src); }
        if (hit) lastHit.set(dst, { ang, t: now });
        break;
      }
      case 'charge': {
        const [, src, , seconds] = e;
        const inf = info(src);
        if (!inf) break;
        charges.set(src, { t0: now, until: now + seconds * 1000, col: inf.pal.team, lastEmit: now });
        break;
      }
      case 'proj': {
        const [, pid, src, dst, wIdx, x, y] = e;
        const inf = info(src);
        if (!inf) break;
        const w = inf.cat.weapons[wIdx] || inf.cat.weapons[0];
        if (!w) break;
        const dv = posOf(dst);
        const tx = dv ? dv.x : x + Math.cos(0) * 100, ty = dv ? dv.y : y;
        const col = weaponColor(w.type, inf.pal.team);
        const kind = PROJ_KIND_BY_ID[w.id] || (w.aoe && w.type === 'bio' ? 'spore' : KIND_BY_TYPE[w.type] || 'tracer');
        let size = 1;
        if (kind === 'plasma') size = clamp(0.7 + w.damage / 40, 0.7, 2.2);
        else if (kind === 'acid') size = clamp(0.8 + w.damage / 40, 0.8, 2);
        else if (kind === 'rail' || kind === 'tracer') size = w.damage >= 70 ? 1.6 : w.damage >= 14 ? 1.25 : 1;
        projectiles.launch({ id: pid, kind, x, y, dstId: dst, tx, ty, speed: w.speed, team: inf.team, col, colB: mix(col, '#ffffff', 0.5), size, now, seed: pid * 131, aoe: w.aoe });
        const ang = Math.atan2(ty - y, tx - x);
        if (!(cam.zoom < 0.5 && w.damage < 10) && !(w.pd && cam.zoom < 0.8)) addMuzzle(x, y, ang, w, col, now);
        if (dv) lastHit.set(dst, { ang, t: now + (Math.hypot(tx - x, ty - y) / Math.max(50, w.speed)) * 1000 });
        break;
      }
      case 'pend': {
        const [, pid, outcome, x, y] = e;
        const pr = projectiles.end(pid);
        impactFor(pr ? pr.kind : 'tracer', x, y, pr ? pr.col : '#ffffff', now, outcome);
        break;
      }
      case 'hit': {
        const [, dst, amount, , toShield] = e;
        const inf = info(dst); const v = posOf(dst);
        if (!inf || !v) break;
        const lh = lastHit.get(dst);
        const ang = lh && Math.abs(now - lh.t) < 500 ? lh.ang : rand.range(0, TAU);
        if (toShield) {
          shields.ripple(dst, ang + Math.PI, now, clamp(0.5 + amount / 40, 0.5, 1));
          const ci = particles.color(inf.pal.team);
          const R = shieldRadius(inf.def);
          const ix = v.x + Math.cos(ang + Math.PI) * R, iy = v.y + Math.sin(ang + Math.PI) * R;
          for (let i = 0; i < 2 * quality.density; i++) { const a = ang + Math.PI + rand.range(-1, 1); particles.spawn(KIND.SPARK, ix, iy, Math.cos(a) * 90, Math.sin(a) * 90, 160, 1, 1, ci); }
        } else {
          const r = inf.def.size * 0.3;
          const hx = v.x + Math.cos(ang + Math.PI) * r * rand.range(0.2, 1) + rand.range(-4, 4), hy = v.y + Math.sin(ang + Math.PI) * r * rand.range(0.2, 1) + rand.range(-4, 4);
          cam.now = now;
          hullSparks(hx, hy, ang + Math.PI, amount, inf.hullType, inf.pal, inf.pal.team);
        }
        cam.noteAction(dst, amount / Math.max(1, inf.cat.hp));
        break;
      }
      case 'sbreak': {
        const [, id] = e;
        const inf = info(id); const v = posOf(id);
        if (!inf || !v) break;
        shields.shatter(id, v.x, v.y, shieldRadius(inf.def), inf.pal.team, now, quality.density);
        explosions.flash({ x: v.x, y: v.y, r: shieldRadius(inf.def), col: inf.pal.team, t0: now, dur: 180, a: 0.6 });
        break;
      }
      case 'die': {
        const [, id, , ex, ey] = e;
        const inf = info(id);
        const lp = lastPos.get(id);
        const x = lp ? lp.x : ex, y = lp ? lp.y : ey, a = lp ? lp.a : 0;
        if (inf) {
          explosions.spawn({ x, y, a, size: inf.def.size, faction: inf.faction, team: inf.team, pal: inf.pal, def: inf.def, now, id }, quality.density);
          if (inf.cls === 'vor_larva') impactFor('acid', x, y, '#7dd957', now, 1);
        } else {
          explosions.spawn({ x, y, size: 30, faction: 'terran', team: 0, pal: { team: '#ffffff', teamGlow: '#ffffff', debris: '#888888', hullMid: '#888', hullLight: '#aaa' }, now }, quality.density);
        }
        cam.noteDeath(x, y, now);
        trails.delete(id); buffs.delete(id); charges.delete(id); spawnAt.delete(id); emitAt.delete(id);
        break;
      }
      case 'cast': handleCast(e, now); break;
      case 'spawn': {
        const [, id, cls, team, , x, y, , source] = e;
        spawnAt.set(id, now);
        const cat = SHIPS[cls];
        const si = source ? info(source) : null;
        const tc = (o.teamColors && o.teamColors[team]) ? o.teamColors[team].main : (team ? '#ff7a3d' : '#3fb6ff');
        const ci = particles.color(tc);
        if (cat && cat.faction === 'vorrax') {
          for (let i = 0; i < 6 * quality.density; i++) { const a = rand.range(0, TAU), vv = rand.range(30, 90); particles.spawn(KIND.DROP, x, y, Math.cos(a) * vv, Math.sin(a) * vv, rand.range(300, 600), 1.5, 0.4, C.drop, 0, 0, 0.93); }
        } else if (cat && cat.faction === 'ferrix') {
          for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, d = 24; particles.spawn(KIND.CUBE, x + Math.cos(a) * d, y + Math.sin(a) * d, -Math.cos(a) * d * 4, -Math.sin(a) * d * 4, 250, 2.5, 1.5, i % 2 ? ci : C.mint, 0, 0, 1); }
        } else {
          explosions.flash({ x, y, r: 10, col: tc, t0: now, dur: 250, a: 0.8 });
          if (si) { const sv = posOf(source); if (sv) beams.add({ kind: 'laserLight', x0: sv.x, y0: sv.y, x1: x, y1: y, colA: tc, colB: '#ffffff', t0: now, dur: 150, follow: false, w: 0.6, impactR: 4 }); }
        }
        if (si) explosions.flash({ x: (posOf(source) || { x, y }).x, y: (posOf(source) || { x, y }).y, r: 10, col: tc, t0: now, dur: 200, a: 0.5 });
        break;
      }
      case 'heal': {
        const [, src, dst, , kind] = e;
        const dv = posOf(dst); const di = info(dst);
        if (!dv || !di) break;
        const col = kind === 'shield' ? di.pal.team : '#7dff9a';
        if (src && src !== dst) {
          const sv = posOf(src); const si = info(src);
          if (sv && si) {
            const bk = si.faction === 'ferrix' ? 'nanite' : 'repair';
            const b = beams.find(bk, src, dst);
            if (b) b.t1 = now + 350;
            else beams.add({ kind: bk, srcId: src, dstId: dst, x0: sv.x, y0: sv.y, x1: dv.x, y1: dv.y, colA: col, colB: '#ffffff', t0: now, dur: 350, impactR: 5 });
          }
        }
        const last = healAt.get(dst) || 0;
        if (now - last > 150) {
          healAt.set(dst, now);
          const ci = particles.color(col);
          const r = di.def.size * 0.35;
          particles.spawn(KIND.PLUS, dv.x + rand.range(-r, r), dv.y + rand.range(-r, r), 0, -22, 550, 4, 3, ci);
        }
        break;
      }
      case 'aoe': {
        const [, x, y, radius, kind] = e;
        const d = quality.density;
        switch (kind) {
          case 'bio': case 'bile_burst': case 'acid_cloud':
            explosions.ring({ x, y, r0: radius * 0.2, r1: radius, lw: 2, col: '#7dd957', t0: now, dur: 300, a0: 0.6 });
            for (let i = 0; i < 10 * d; i++) { const a = rand.range(0, TAU), vv = radius * rand.range(1, 2.5); particles.spawn(KIND.DROP, x, y, Math.cos(a) * vv, Math.sin(a) * vv, rand.range(300, 500), 1.6, 0.4, C.drop, 0, 0, 0.92); }
            for (let i = 0; i < 4 * d; i++) particles.spawn(KIND.SMOKE, x, y, rand.range(-10, 10), rand.range(-10, 10), 1300, radius * 0.2, radius * 0.5, C.smokeGreen, 0, 0, 0.98);
            break;
          case 'plasma': explosions.burst(x, y, radius * 0.6, '#9c7cff', now, d, { fire: 10, kind: KIND.PLASMA, flashCol: '#d7ccff', ringDur: 350 }); break;
          case 'ion': explosions.ring({ x, y, r0: 4, r1: radius, lw: 3, col: '#bfe9ff', t0: now, dur: 300, a0: 0.8 }); for (let i = 0; i < 8 * d; i++) { const a = rand.range(0, TAU), vv = radius * 2; particles.spawn(KIND.SPARK, x, y, Math.cos(a) * vv, Math.sin(a) * vv, 250, 1, 1, C.cyan); } break;
          case 'flak': explosions.burst(x, y, radius * 0.5, '#ffb347', now, d, { fire: 4, shards: 8, smoke: 5 }); break;
          case 'torpedo': case 'missile': case 'kinetic': case 'railgun':
            explosions.burst(x, y, radius * 0.5, '#ffb347', now, d, { fire: 8, smoke: 5, ringDur: 350 }); break;
          case 'emp_pulse': case 'emp_storm': case 'dissonant_pulse': empRing(x, y, radius, '#bfe9ff', now, kind === 'emp_storm'); break;
          case 'singularity': explosions.ring({ x, y, r0: radius, r1: 2, lw: 2, col: '#7c5cff', t0: now, dur: 450, a0: 0.8 }); break;
          default: explosions.ring({ x, y, r0: 4, r1: radius, lw: 2, col: '#ffffff', t0: now, dur: 300, a0: 0.6 });
        }
        break;
      }
      case 'area': {
        const [, areaId, kind, x, y, radius, on] = e;
        if (on) {
          areas.set(areaId, { kind, x, y, r: radius, t0: now, t1: 0, lastEmit: now, seed: rand.int(0, 1e6) });
          if (kind === 'singularity') cam.addTrauma(0.12);
        } else {
          const a = areas.get(areaId);
          if (a) a.t1 = now;
        }
        break;
      }
      case 'phase': {
        if (e[1] === 'suddenDeath') suddenDeath = true;
        if (phaseCb) phaseCb(e[1]);
        break;
      }
      case 'end': if (endCb) endCb(e[1], e[2]); break;
      default: break;
    }
  }

  /** @param {any[]} events presented this frame */
  function handleEvents(events, now) {
    if (!events.length) return;
    salvoCount.clear();
    for (const e of events) {
      try { handleEvent(e, now); } catch (err) { /* never let a bad event break the frame */ if (typeof console !== 'undefined' && console.warn) console.warn('vfx event error', e, err); }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  function recordTrail(v, inf, now) {
    let t = trails.get(v.id);
    if (!t) { t = { buf: new Float32Array(TRAIL_N * 2), head: 0, n: 0, lastT: 0 }; trails.set(v.id, t); }
    if (now - t.lastT < 50) return;
    t.lastT = now;
    const c = Math.cos(v.a), s = Math.sin(v.a);
    const back = inf.def.size * 0.45;
    t.buf[t.head * 2] = v.x - c * back; t.buf[t.head * 2 + 1] = v.y - s * back;
    t.head = (t.head + 1) % TRAIL_N; if (t.n < TRAIL_N) t.n++;
  }

  function update(dt, now, ships) {
    shipCount = ships.size;
    cam.now = now;
    particles.update(dt);
    projectiles.update(dt, now, view, lowDensity());
    beams.update(now, view);
    explosions.update(now);
    const tr = explosions.consumeTrauma(); if (tr) cam.addTrauma(tr);
    for (let i = muzzles.length - 1; i >= 0; i--) if (now - muzzles[i].t0 > 80) muzzles.splice(i, 1);
    for (let i = domes.length - 1; i >= 0; i--) {
      const dm = domes[i];
      if (now > dm.t1 + 300) { domes.splice(i, 1); continue; }
      if (dm.followId) { const fv = view(dm.followId); if (fv) { dm.x = fv.x; dm.y = fv.y; } else dm.t1 = Math.min(dm.t1, now); }
    }
    for (let i = empRings.length - 1; i >= 0; i--) if (now - empRings[i].t0 > empRings[i].dur) empRings.splice(i, 1);
    for (const [id, b] of buffs) if (now > b.until) buffs.delete(id);
    for (const [id, c] of charges) {
      if (now > c.until + 300) { charges.delete(id); continue; }
      const v = view(id); const inf = info(id);
      if (v && inf && now < c.until && now - c.lastEmit > 40 / quality.density) {
        c.lastEmit = now;
        const m = muzzleWorld(inf, v, inf.cat.weapons[0], 0);
        const a = rand.range(0, TAU), d = inf.def.size * 0.6;
        particles.spawn(KIND.GLOW, m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, -Math.cos(a) * d * 3, -Math.sin(a) * d * 3, 330, 3, 1, particles.color(c.col), 0, 0, 1);
      }
    }
    for (const [id, t0] of spawnAt) if (now - t0 > 400) spawnAt.delete(id);
    // areas: emission + expiry
    for (const [id, a] of areas) {
      if (a.t1 && now - a.t1 > 400) { areas.delete(id); continue; }
      if (a.t1) continue;
      if (!cam.isVisible(a.x, a.y, a.r)) continue;
      if (a.kind === 'acid_cloud') {
        if (now - a.lastEmit > 90 / quality.density) {
          a.lastEmit = now;
          const an = rand.range(0, TAU), d = rand.range(0, a.r * 0.8);
          particles.spawn(KIND.SMOKE, a.x + Math.cos(an) * d, a.y + Math.sin(an) * d, rand.range(-8, 8), rand.range(-8, 8), rand.range(1500, 2200), a.r * 0.12, a.r * 0.3, C.smokeGreen, 0, 0, 0.99);
          if (rand() < 0.5) particles.spawn(KIND.DOT, a.x + Math.cos(an) * d, a.y + Math.sin(an) * d, 0, -10, 900, 1.5, 1, C.dropLight);
        }
      } else if (a.kind === 'singularity') {
        if (now - a.lastEmit > 35 / quality.density) {
          a.lastEmit = now;
          const an = rand.range(0, TAU), d = a.r * rand.range(0.8, 1.1);
          const speed = a.r * 0.9;
          particles.spawn(KIND.GLOW, a.x + Math.cos(an) * d, a.y + Math.sin(an) * d, -Math.cos(an) * speed - Math.sin(an) * speed * 0.6, -Math.sin(an) * speed + Math.cos(an) * speed * 0.6, (d / speed) * 1000, 3.5, 0.5, rand() < 0.5 ? C.violet : C.white, 0, 0, 1.02);
        }
      } else if (now - a.lastEmit > 120 / quality.density) {
        a.lastEmit = now;
        const an = rand.range(0, TAU), d = rand.range(0, a.r);
        particles.spawn(KIND.GLOW, a.x + Math.cos(an) * d, a.y + Math.sin(an) * d, 0, -8, 900, 2, 0.5, C.white);
      }
    }
    // ship-driven: trails, engine emitters, disrupt arcs, last positions
    const trailsOn = quality.trails;
    const trailSmall = shipCount < 120;
    const ld = lowDensity();
    const emitMinSize = shipCount < 100 ? 0 : shipCount < 250 ? 30 : 48;
    for (const v of ships.values()) {
      const inf = info(v.id);
      if (!inf) continue;
      const vis = cam.isVisible(v.x, v.y, inf.def.size);
      if (trailsOn && vis && (inf.def.size >= 40 || trailSmall) && (inf.faction === 'terran' || inf.faction === 'lumen')) recordTrail(v, inf, now);
      if (vis && ld > 0.3 && (inf.faction === 'vorrax' || inf.faction === 'ferrix') && inf.def.size >= emitMinSize && inf.def.size * cam.zoom >= 10) {
        const last = emitAt.get(v.id) || 0;
        const period = (inf.faction === 'vorrax' ? 70 : 60) / ld;
        if (now - last > period) {
          emitAt.set(v.id, now);
          const c = Math.cos(v.a), s = Math.sin(v.a);
          for (const en of inf.def.engines) {
            const ex = v.x + (en.x * c - en.y * s) * inf.def.size / 100, ey = v.y + (en.x * s + en.y * c) * inf.def.size / 100;
            if (inf.faction === 'vorrax') particles.spawn(KIND.PLASMA, ex, ey, -c * 15 + rand.range(-8, 8), -s * 15 + rand.range(-8, 8), 550, 1.6 + en.w * 0.3, 0.4, particles.color(inf.pal.team), 0, 0, 0.98);
            else particles.spawn(KIND.DOT, ex, ey, 0, 0, 700, 1.2, 1.2, particles.color(inf.pal.team));
            if (inf.def.engines.length > 2) break; // budget: at most 2 nozzles emit
          }
        }
      }
      if (vis && (v.flags & 2) && quality.anims) { // DISRUPTED: arcs on the hull
        const last = emitAt.get(-v.id) || 0;
        if (now - last > 150) {
          emitAt.set(-v.id, now);
          const r = inf.def.size * 0.35;
          for (let i = 0; i < 2; i++) { const a = rand.range(0, TAU); particles.spawn(KIND.SPARK, v.x + Math.cos(a) * r * rand(), v.y + Math.sin(a) * r * rand(), rand.range(-60, 60), rand.range(-60, 60), 120, 1, 1, C.cyan); }
        }
      }
      let lp = lastPos.get(v.id);
      if (!lp) { lp = { x: v.x, y: v.y, a: v.a }; lastPos.set(v.id, lp); }
      else { lp.x = v.x; lp.y = v.y; lp.a = v.a; }
    }
    if (lastPos.size > ships.size + 64) for (const id of lastPos.keys()) if (!ships.has(id)) lastPos.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Draw passes
  // ---------------------------------------------------------------------------

  const focus = { followId: 0, hoverId: 0 };
  /** Ships whose auras are drawn filled (the followed and the hovered ship). */
  function setFocus(followId, hoverId) { focus.followId = followId | 0; focus.hoverId = hoverId | 0; }

  function drawArea(ctx, c, dpr, now) {
    if (!areas.size && !domes.length) return;
    const z = c.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const a of areas.values()) {
      if (!c.isVisible(a.x, a.y, a.r)) continue;
      const sx = c.worldToScreenX(a.x), sy = c.worldToScreenY(a.y);
      const grow = clamp((now - a.t0) / 300, 0, 1);
      const fade = a.t1 ? clamp(1 - (now - a.t1) / 400, 0, 1) : 1;
      const R = a.r * z * (0.2 + 0.8 * grow);
      if (a.kind === 'singularity') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.85 * fade;
        const core = R * 0.3;
        ctx.drawImage(getSoft('#000000', 0.5), sx - core, sy - core, core * 2, core * 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5 * fade;
        ctx.drawImage(getGlow('#7c5cff'), sx - R * 0.5, sy - R * 0.5, R, R);
        ctx.strokeStyle = '#b8f0ff'; ctx.lineWidth = Math.max(1, 1.5 * z);
        for (let k = 0; k < 3; k++) {
          const rr = R * (0.45 + k * 0.25), a0 = now * 0.002 * (k % 2 ? -1 : 1) + k;
          ctx.globalAlpha = (0.5 - k * 0.12) * fade;
          ctx.beginPath(); ctx.arc(sx, sy, rr, a0, a0 + Math.PI * 1.3); ctx.stroke();
        }
      } else if (a.kind === 'acid_cloud') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.16 + 0.04 * Math.sin(now * 0.004 + a.seed)) * fade;
        ctx.drawImage(getSoft('#7dd957', 0.1), sx - R, sy - R, R * 2, R * 2);
        ctx.strokeStyle = '#b8ff80'; ctx.lineWidth = Math.max(1, 1.2 * z); ctx.globalAlpha = 0.22 * fade;
        ctx.beginPath(); ctx.arc(sx, sy, R * 0.96, now * 0.001, now * 0.001 + Math.PI * 1.5); ctx.stroke();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.14 * fade;
        ctx.drawImage(getSoft('#ffffff', 0.1), sx - R, sy - R, R * 2, R * 2);
      }
    }
    let visibleDomes = 0;
    for (const dm of domes) if (now <= dm.t1 + 300 && c.isVisible(dm.x, dm.y, dm.r)) visibleDomes++;
    for (const dm of domes) {
      if (!c.isVisible(dm.x, dm.y, dm.r)) continue;
      const u0 = clamp((now - dm.t0) / dm.grow, 0, 1);
      const fade = now > dm.t1 ? clamp(1 - (now - dm.t1) / 300, 0, 1) : 1;
      const R = dm.r * z * (1 - (1 - u0) * (1 - u0));
      const sx = c.worldToScreenX(dm.x), sy = c.worldToScreenY(dm.y);
      ctx.globalCompositeOperation = 'lighter';
      // Readability: a filled disc per capital aura turns a 6v6 into a tinted soup. Only the
      // dome of the ship the player follows or hovers is filled; the rest are thin rings that
      // fade further when many overlap the view.
      const focused = dm.followId && (dm.followId === focus.followId || dm.followId === focus.hoverId);
      const crowd = visibleDomes > 3 ? 0.45 : 1;
      if (focused) {
        ctx.fillStyle = dm.col; ctx.globalAlpha = 0.05 * fade;
        ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
        if (dm.hex && quality.glow && R <= 420) { ctx.globalAlpha = 0.05 * fade; ctx.drawImage(shields.hexMask(R), sx - R, sy - R, R * 2, R * 2); }
      }
      ctx.strokeStyle = dm.col; ctx.lineWidth = Math.max(1, (focused ? 1.5 : 1) * z);
      ctx.globalAlpha = (focused ? 0.32 + 0.18 * Math.sin(now * 0.008) : 0.22) * fade * crowd;
      if (dm.dash || !focused) ctx.setLineDash([(dm.dash || 10) * z, (dm.dash || 10) * z]);
      ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      if (dm.kind === 'aurora') {
        ctx.lineWidth = Math.max(1, 3 * z);
        for (let k = 0; k < 3; k++) { const a0 = now * 0.0015 * (k % 2 ? -1 : 1) + k * 2; ctx.globalAlpha = 0.3 * fade; ctx.beginPath(); ctx.arc(sx, sy, R * (0.5 + k * 0.17), a0, a0 + 1.2); ctx.stroke(); }
      } else if (dm.kind === 'nanite') {
        ctx.fillStyle = '#9bffd6'; ctx.globalAlpha = 0.8 * fade;
        const fr = (now / 100) | 0;
        for (let k = 0; k < 24; k++) { const a = hash01(fr, k, 1) * TAU, d = hash01(fr, k, 2) * R; const px = sx + Math.cos(a) * d, py = sy + Math.sin(a) * d; ctx.fillRect(px - 1, py - 1, 2, 2); }
      } else if (dm.kind === 'spores') {
        ctx.fillStyle = '#ff6aa0'; ctx.globalAlpha = 0.5 * fade;
        const fr = (now / 400) | 0, sub = (now % 400) / 400;
        for (let k = 0; k < 16; k++) { const a = hash01(fr, k, 3) * TAU, d = hash01(fr, k, 4) * R; ctx.beginPath(); ctx.arc(sx + Math.cos(a) * d, sy + Math.sin(a) * d - sub * 10 * z, Math.max(1, 1.5 * z), 0, TAU); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawTrails(ctx, c, dpr, now) {
    if (!trails.size || !quality.trails) return;
    const z = c.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [id, t] of trails) {
      if (t.n < 3) continue;
      const v = view(id); const inf = info(id);
      if (!v || !inf) { if (now - t.lastT > 1000) trails.delete(id); continue; }
      if (!c.isVisible(v.x, v.y, inf.def.size * 3)) continue;
      const lw = Math.max(1, (inf.faction === 'lumen' ? 2.5 : 3) * z * clamp(inf.def.size / 60, 0.5, 1.5));
      // two strokes: older half dimmer
      for (let half = 0; half < 2; half++) {
        ctx.strokeStyle = inf.pal.team;
        ctx.globalAlpha = half ? 0.3 : 0.12;
        ctx.lineWidth = half ? lw : lw * 0.7;
        ctx.beginPath();
        const start = half ? Math.floor(t.n / 2) : 0, end = half ? t.n : Math.floor(t.n / 2) + 1;
        for (let k = start; k < end; k++) {
          const idx = (t.head - t.n + k + TRAIL_N * 2) % TRAIL_N;
          const x = c.worldToScreenX(t.buf[idx * 2]), y = c.worldToScreenY(t.buf[idx * 2 + 1]);
          if (k === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        if (half) { const c0 = Math.cos(v.a), s0 = Math.sin(v.a); ctx.lineTo(c.worldToScreenX(v.x - c0 * inf.def.size * 0.45), c.worldToScreenY(v.y - s0 * inf.def.size * 0.45)); }
        ctx.stroke();
      }
      if (inf.faction === 'lumen') {
        ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.25; ctx.lineWidth = Math.max(0.6, 0.8 * z);
        ctx.beginPath();
        for (let k = Math.floor(t.n / 2); k < t.n; k++) {
          const idx = (t.head - t.n + k + TRAIL_N * 2) % TRAIL_N;
          const x = c.worldToScreenX(t.buf[idx * 2]), y = c.worldToScreenY(t.buf[idx * 2 + 1]);
          if (k === Math.floor(t.n / 2)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawProjectiles(ctx, c, dpr, now) {
    projectiles.draw(ctx, c, dpr, now, quality.density);
  }

  function drawMuzzles(ctx, c, dpr, now) {
    if (!muzzles.length) return;
    const z = c.zoom;
    ctx.globalCompositeOperation = 'lighter';
    for (const m of muzzles) {
      const u = (now - m.t0) / 70;
      if (u < 0 || u >= 1) continue;
      if (!c.isVisible(m.x, m.y, 20)) continue;
      const s = m.size * z * (1.3 - 0.7 * u);
      const sx = c.worldToScreenX(m.x), sy = c.worldToScreenY(m.y);
      const co = Math.cos(m.a), si = Math.sin(m.a);
      ctx.setTransform(co * dpr, si * dpr, -si * dpr, co * dpr, sx * dpr, sy * dpr);
      ctx.globalAlpha = 1 - u;
      ctx.drawImage(getFlash(m.kind, m.col), -s / 2, -s / 2, s, s);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawEmp(ctx, c, dpr, now) {
    if (!empRings.length) return;
    const z = c.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const r of empRings) {
      const u = (now - r.t0) / r.dur;
      if (u < 0 || u >= 1) continue;
      if (!c.isVisible(r.x, r.y, r.R)) continue;
      const R = r.R * z * (1 - (1 - u) * (1 - u));
      const sx = c.worldToScreenX(r.x), sy = c.worldToScreenY(r.y);
      ctx.strokeStyle = r.col; ctx.lineWidth = Math.max(1, 4 * z * (1 - u)); ctx.globalAlpha = 0.9 * (1 - u);
      ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.stroke();
      ctx.lineWidth = Math.max(0.8, 1.2 * z);
      const fr = (now / 50) | 0;
      ctx.beginPath();
      for (let k = 0; k < r.arcs; k++) {
        const a = (k / r.arcs) * TAU + hash01(r.seed, fr, k) * 0.3;
        const l = (6 + hash01(r.seed, fr, k + 7) * 10) * z;
        const px = sx + Math.cos(a) * R, py = sy + Math.sin(a) * R;
        const j = (hash01(r.seed, fr, k + 13) - 0.5) * 6 * z;
        ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l * 0.5 - Math.sin(a) * j, py + Math.sin(a) * l * 0.5 + Math.cos(a) * j); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function shieldLook(id) {
    const v = view(id); const inf = info(id);
    if (!v || !inf) return null;
    return { x: v.x, y: v.y, r: shieldRadius(inf.def), color: inf.pal.team, size: inf.def.size };
  }

  function drawEffects(ctx, c, dpr, now) {
    beams.draw(ctx, c, dpr, now, quality.density);
    drawMuzzles(ctx, c, dpr, now);
    shields.drawRipples(ctx, c, dpr, now, shieldLook);
    explosions.draw(ctx, c, dpr, now);
    drawEmp(ctx, c, dpr, now);
    particles.render(ctx, c, dpr, now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Per-ship overlay drawn right after the ship sprite (shield bubble, buff
   * glow, charge, mantle, anchor marker). Base transform is restored.
   */
  function drawShipOverlay(ctx, v, inf, sx, sy, zoom, dpr, now, lod) {
    const hasShield = inf.cat.shield && inf.cat.shield.cap > 0;
    if (hasShield && v.sh > 0 && lod >= 1) {
      shields.drawBubble(ctx, sx, sy, shieldRadius(inf.def) * zoom, v.sh / 1000, inf.pal.team, now, v.id, dpr, lod);
    }
    const b = buffs.get(v.id);
    const ch = charges.get(v.id);
    if ((b || ch) && lod >= 1) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      if (b) {
        const r = inf.def.size * 0.6 * zoom;
        const pulse = 0.5 + 0.5 * Math.sin((now - b.t0) * 0.0377);
        const fade = clamp((b.until - now) / 300, 0, 1) * clamp((now - b.t0) / 150, 0, 1);
        if (b.kind === 'mantle') {
          ctx.strokeStyle = b.col; ctx.lineWidth = Math.max(1, 2 * zoom); ctx.globalAlpha = (0.35 + 0.25 * pulse) * fade;
          const R = shieldRadius(inf.def) * zoom * 1.15;
          ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 0.18 * fade; ctx.drawImage(shields.hexMask(R), sx - R, sy - R, R * 2, R * 2);
        } else if (b.kind === 'anchor') {
          ctx.strokeStyle = b.col; ctx.lineWidth = Math.max(1, 1.5 * zoom); ctx.globalAlpha = 0.6 * fade;
          const R = inf.def.size * 0.7 * zoom;
          ctx.setLineDash([6 * zoom, 6 * zoom]); ctx.lineDashOffset = now * 0.02 * zoom;
          ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
          ctx.globalAlpha = 0.25 * fade; ctx.drawImage(getGlow(b.col), sx - r, sy - r, r * 2, r * 2);
        } else {
          ctx.globalAlpha = (b.kind === 'rage' ? 0.28 : 0.2) * (0.6 + 0.4 * pulse) * fade;
          ctx.drawImage(getGlow(b.col), sx - r, sy - r, r * 2, r * 2);
          if (b.kind === 'armor') { ctx.globalAlpha = 0.2 * fade; const R = inf.def.size * 0.55 * zoom; ctx.drawImage(shields.hexMask(R), sx - R, sy - R, R * 2, R * 2); }
        }
      }
      if (ch) {
        const u = clamp((now - ch.t0) / (ch.until - ch.t0), 0, 1);
        const m = muzzleWorld(inf, v, inf.cat.weapons[0], 0);
        const mx = cam.worldToScreenX(m.x), my = cam.worldToScreenY(m.y);
        const r = (6 + 26 * u) * zoom;
        ctx.globalAlpha = 0.4 + 0.6 * u;
        ctx.drawImage(getGlow(ch.col), mx - r, my - r, r * 2, r * 2);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(getGlow('#ffffff'), mx - r * 0.4, my - r * 0.4, r * 0.8, r * 0.8);
        ctx.strokeStyle = ch.col; ctx.lineWidth = Math.max(1, 1.5 * zoom); ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(mx, my, r * 1.3 * (1 - u) + 2, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if ((v.flags & 1) && lod >= 1) { // UNTARGETABLE: cloak shimmer outline
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.15 + 0.1 * Math.sin(now * 0.012 + v.id);
      ctx.beginPath(); ctx.arc(sx, sy, inf.def.size * 0.5 * zoom, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Per-ship presentation state derived from flags/buffs (for sprites.js). */
  function shipState(v, inf, now, myTeam) {
    const b = buffs.get(v.id);
    const sp = spawnAt.get(v.id);
    const spawnScale = sp === undefined ? 1 : clamp(0.2 + 0.8 * ((now - sp) / 200), 0.2, 1);
    const speed = Math.hypot(v.vx, v.vy);
    const thrust = clamp(speed / Math.max(20, inf.cat.speed), 0, 1);
    let alpha = 1;
    if (v.flags & 1) alpha = myTeam === null || myTeam === undefined ? 0.45 : v.team === myTeam ? 0.5 : 0.18;
    return { thrust, boosted: !!(b && b.kind === 'boost') || !!(v.flags & 4), disrupted: !!(v.flags & 2), spawnScale, alpha, id: v.id };
  }

  return {
    handleEvents, update, drawArea, drawTrails, drawProjectiles, drawEffects, drawShipOverlay, shipState, setFocus,
    quality,
    setQuality(q) { Object.assign(quality, q); },
    get ghosts() { return explosions.ghosts; },
    get suddenDeath() { return suddenDeath; },
    onPhase(cb) { phaseCb = cb; },
    onEnd(cb) { endCb = cb; },
    stats() { return { particles: particles.count, beams: beams.count, projectiles: projectiles.count, areas: areas.size, domes: domes.length, buffs: buffs.size }; },
    /** Debug: explode a ship visually (demo). */
    debugExplode(id, now) { const inf = info(id); const v = posOf(id); if (inf && v) explosions.spawn({ x: v.x, y: v.y, a: v.a, size: inf.def.size, faction: inf.faction, team: inf.team, pal: inf.pal, def: inf.def, now, id }, quality.density); },
    clear() {
      particles.clear(); beams.clear(); projectiles.clear(); explosions.clear(); shields.clear();
      muzzles.length = 0; domes.length = 0; empRings.length = 0; areas.clear(); buffs.clear(); charges.clear(); spawnAt.clear();
      lastHit.clear(); lastPos.clear(); trails.clear(); emitAt.clear(); healAt.clear(); suddenDeath = false;
    },
    rgba,
  };
}
