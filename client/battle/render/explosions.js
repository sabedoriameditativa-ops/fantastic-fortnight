// Explosions scaled by ship size with faction-specific debris, secondary
// explosions for capitals (with a "ghost" of the sprite trembling before the
// main blast), plus the generic timed overlays (rings, flashes) used by other
// effects.

import { KIND } from './particles.js';
import { getGlow } from './glow.js';
import { makeRand, rgba, TAU, clamp, easeOut } from './palette.js';

const DIRS8 = [];
for (let i = 0; i < 8; i++) DIRS8.push([Math.cos((i / 8) * TAU), Math.sin((i / 8) * TAU)]);

/**
 * @param {{ particles: object }} o
 */
export function createExplosions(o) {
  const P = o.particles;
  const rand = makeRand(0x5eed);
  /** @type {object[]} */
  const rings = [];
  /** @type {object[]} */
  const flashes = [];
  /** @type {{t:number, fn:Function}[]} */
  const timers = [];
  /** @type {object[]} */
  const ghosts = [];
  let trauma = 0;
  const C = {
    ember: P.color('#ff9a3d'), smoke: P.color('#2a2e36'), white: P.color('#ffffff'),
    drop: P.color('#7dd957'), cube: P.color('#1a2426'),
  };

  function ring(r) { if (rings.length < 300) rings.push({ a0: 0.8, lw: 2, dash: 0, ...r }); }
  function flash(f) { if (flashes.length < 300) flashes.push({ a: 1, ...f }); }
  function timed(t, fn) { timers.push({ t, fn }); }

  function debrisFor(faction, x, y, S, pal, n, density) {
    const dcol = P.color(pal.debris || pal.hullMid), lcol = P.color(pal.hullLight), tcol = P.color(pal.team);
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, TAU), v = rand.range(40, 160) * Math.sqrt(S) * 0.6;
      const life = rand.range(1200, 2500), rot = rand.range(0, TAU), vrot = rand.range(1.5, 6) * (rand() < 0.5 ? -1 : 1);
      switch (faction) {
        case 'vorrax':
          P.spawn(KIND.DEBRIS, x, y, Math.cos(a) * v, Math.sin(a) * v, life, rand.range(2, 5) * Math.sqrt(S), 1, i % 3 ? dcol : lcol, rot, vrot, 0.985);
          if (i % 2 === 0) P.spawn(KIND.DROP, x, y, Math.cos(a) * v * 0.8, Math.sin(a) * v * 0.8, rand.range(500, 900), 1.6, 0.4, C.drop, 0, 0, 0.96);
          break;
        case 'lumen':
          P.spawn(KIND.SHARD, x, y, Math.cos(a) * v, Math.sin(a) * v, life, rand.range(2, 5) * Math.sqrt(S), 1.5, i % 3 ? lcol : C.white, rot, vrot, 0.99);
          break;
        case 'ferrix': {
          // nanite disassembly: cubes fly along grid directions after a short freeze (handled by caller delay)
          const d = DIRS8[i % 8];
          const vv = rand.range(40, 150) * Math.sqrt(S) * 0.6;
          P.spawn(KIND.CUBE, x + rand.range(-3, 3) * S, y + rand.range(-3, 3) * S, d[0] * vv, d[1] * vv, life, rand.range(2, 4) * Math.sqrt(S), 1.5, i % 4 === 0 ? tcol : i % 2 ? dcol : C.cube, 0, 0, 0.985);
          break;
        }
        default:
          P.spawn(KIND.DEBRIS, x, y, Math.cos(a) * v, Math.sin(a) * v, life, rand.range(2, 5) * Math.sqrt(S), 1, i % 4 === 0 ? lcol : dcol, rot, vrot, 0.985);
      }
    }
    void density;
  }

  /**
   * Spawn a full explosion.
   * @param {{x:number,y:number,size:number,faction:string,team:number,pal:object,def?:object,a?:number,now:number}} ev
   * @param {number} density 0.25..1
   * @returns {number} delay (ms) before the main blast (capitals)
   */
  function spawn(ev, density = 1) {
    const S = clamp(ev.size / 18, 0.6, 10), d = density, pal = ev.pal, now = ev.now;
    const delay = S >= 5 ? 80 * Math.min(S, 8) : (ev.faction === 'ferrix' ? 150 : 0);
    if (S >= 5) {
      const n = Math.floor(3 + S * 0.6);
      for (let i = 0; i < n; i++) {
        const t = now + i * 110;
        timed(t, () => spawn({
          x: ev.x + rand.range(-ev.size * 0.4, ev.size * 0.4), y: ev.y + rand.range(-ev.size * 0.3, ev.size * 0.3),
          size: 18 + rand() * 16, faction: ev.faction, team: ev.team, pal, now: t, secondary: true,
        }, d));
      }
    }
    if (delay) ghosts.push({ def: ev.def, pal, x: ev.x, y: ev.y, a: ev.a || 0, team: ev.team, t0: now, until: now + delay, shake: 1.5 * Math.sqrt(S), id: ev.id || 0 });
    const main = () => {
      const t0 = now + delay;
      const x = ev.x, y = ev.y;
      flash({ x, y, r: 10 * S, col: '#ffffff', t0, dur: 120 });
      flash({ x, y, r: 20 * S, col: pal.teamGlow, t0, dur: 220, a: 0.6 });
      ring({ x, y, r0: 6 * S, r1: 96 * S, lw: 1.2 * S, col: '#ffd2b8', t0, dur: 600 * Math.sqrt(S), a0: 0.6 });
      ring({ x, y, r0: 4 * S, r1: 70 * S, lw: 0.6 * S + 0.5, col: '#ffffff', t0: t0 + 40, dur: 450 * Math.sqrt(S), a0: 0.5 });
      if (S >= 5) {
        ring({ x, y, r0: 4 * S, r1: 110 * S, lw: 1.2, col: '#ffffff', t0: t0 + 150, dur: 700 * Math.sqrt(S), a0: 0.6 });
        flash({ x, y, r: 60 * S, col: '#ffffff', t0, dur: 220, a: 0.18 });
      }
      const nFire = Math.round((8 + 6 * S) * d);
      for (let i = 0; i < nFire; i++) {
        const a = rand.range(0, TAU), v = rand.range(20, 90) * (0.6 + 0.4 * Math.sqrt(S));
        P.spawn(KIND.FIRE, x + rand.range(-2, 2) * S, y + rand.range(-2, 2) * S, Math.cos(a) * v, Math.sin(a) * v, rand.range(300, 520) * Math.sqrt(S), 4 * S, 0.5, C.white, 0, 0, 0.96);
      }
      const nDeb = Math.round(Math.min(46, 6 + 4 * S) * d);
      if (ev.faction === 'ferrix' && !ev.secondary) timed(t0 + 150, () => debrisFor('ferrix', x, y, S, pal, nDeb, d));
      else debrisFor(ev.faction, x, y, S, pal, nDeb, d);
      const nEmb = Math.round(12 * S * d);
      for (let i = 0; i < nEmb; i++) {
        const a = rand.range(0, TAU), v = rand.range(5, 30) * Math.sqrt(S);
        P.spawn(KIND.EMBER, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(1500, 3000), 1.2, 1, C.ember, 0, 0, 0.995);
      }
      if (S >= 2.5 && ev.faction !== 'lumen') {
        const nSm = Math.round(4 * S * d);
        for (let i = 0; i < nSm; i++) {
          P.spawn(KIND.SMOKE, x + rand.range(-4, 4) * S, y + rand.range(-4, 4) * S, rand.range(-15, 15), rand.range(-15, 15), 2500, 8 * S, 20 * S, C.smoke, 0, 0, 0.99);
        }
      }
      trauma += clamp(0.08 * S, 0.08, 0.6);
    };
    if (delay) timed(now + delay, main); else main();
    return delay;
  }

  /** Small generic burst (flak pop, missile impact, aoe). */
  function burst(x, y, r, col, now, density, opts = {}) {
    flash({ x, y, r: r * 1.2, col: opts.flashCol || '#fff0c0', t0: now, dur: 90 });
    if (opts.ring !== false) ring({ x, y, r0: r * 0.3, r1: r * 1.6, lw: 1.5, col, t0: now, dur: opts.ringDur || 260, a0: 0.7 });
    const nF = Math.round((opts.fire ?? 6) * density);
    const ci = P.color(col);
    for (let i = 0; i < nF; i++) {
      const a = rand.range(0, TAU), v = rand.range(30, 90) * (r / 20);
      P.spawn(opts.kind ?? KIND.FIRE, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(200, 400), r * 0.35, 0.3, ci, 0, 0, 0.95);
    }
    const nS = Math.round((opts.shards ?? 0) * density);
    for (let i = 0; i < nS; i++) {
      const a = rand.range(0, TAU), v = rand.range(60, 140);
      P.spawn(KIND.SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(200, 320), 1, 1, ci);
    }
    const nSm = Math.round((opts.smoke ?? 0) * density);
    for (let i = 0; i < nSm; i++) {
      const a = rand.range(0, TAU), v = rand.range(10, 40);
      P.spawn(KIND.SMOKE, x, y, Math.cos(a) * v, Math.sin(a) * v, rand.range(500, 700), r * 0.2, r * 0.5, opts.smokeCol ?? C.smoke, 0, 0, 0.97);
    }
  }

  function update(now) {
    if (timers.length) {
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= now) { const t = timers[i]; timers.splice(i, 1); t.fn(); }
    }
    for (let i = ghosts.length - 1; i >= 0; i--) if (ghosts[i].until <= now) ghosts.splice(i, 1);
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t0 + rings[i].dur <= now) rings.splice(i, 1);
    for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].t0 + flashes[i].dur <= now) flashes.splice(i, 1);
  }

  /** Draw rings and flashes (additive). Base transform [dpr,0,0,dpr,0,0]. */
  function draw(ctx, cam, dpr, now) {
    if (!rings.length && !flashes.length) return;
    const z = cam.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      const u = (now - r.t0) / r.dur;
      if (u < 0 || u >= 1) continue;
      const rr = (r.r0 + (r.r1 - r.r0) * easeOut(u)) * z;
      if (!cam.isVisible(r.x, r.y, rr / z)) continue;
      ctx.strokeStyle = r.col; ctx.globalAlpha = r.a0 * (1 - u); ctx.lineWidth = Math.max(0.8, r.lw * (1 - u) * z);
      if (r.dash) ctx.setLineDash([r.dash * z, r.dash * z]);
      ctx.beginPath(); ctx.arc(cam.worldToScreenX(r.x), cam.worldToScreenY(r.y), rr, 0, TAU); ctx.stroke();
      if (r.dash) ctx.setLineDash([]);
    }
    for (const f of flashes) {
      const u = (now - f.t0) / f.dur;
      if (u < 0 || u >= 1) continue;
      const rr = f.r * z * (1 + u * 0.3);
      if (!cam.isVisible(f.x, f.y, rr / z)) continue;
      ctx.globalAlpha = f.a * (1 - u);
      ctx.drawImage(getGlow(f.col), cam.worldToScreenX(f.x) - rr, cam.worldToScreenY(f.y) - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    spawn, burst, ring, flash, timed, update, draw, ghosts,
    /** Take accumulated camera trauma. */
    consumeTrauma() { const t = trauma; trauma = 0; return t; },
    clear() { rings.length = 0; flashes.length = 0; timers.length = 0; ghosts.length = 0; trauma = 0; },
    rgba,
  };
}
