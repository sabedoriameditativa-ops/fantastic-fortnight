// Visual projectiles driven by 'proj' / 'pend' events. The renderer only
// decorates: the sim decides hits. Each projectile homes on its target's
// interpolated position at its weapon speed so the visual end point lines up
// with the 'pend' impact.

import { KIND } from './particles.js';
import { getGlow } from './glow.js';
import { hash01, noise1, TAU, clamp } from './palette.js';

/** Visual kind per weapon type (ids override, see effects.js). */
export const KIND_BY_TYPE = {
  kinetic: 'tracer', railgun: 'rail', flak: 'flak', missile: 'missile', torpedo: 'torpedo',
  plasma: 'plasma', bio: 'acid', ion: 'ion', laser: 'tracer',
};

const TURN = { tracer: 12, rail: 20, flak: 10, missile: 3.5, torpedo: 2.2, ltorpedo: 2.6, plasma: 5, acid: 3, spore: 2, ion: 6 };

/**
 * @param {{ particles: ReturnType<import('./particles.js').createParticles>, max?: number }} o
 */
export function createProjectiles(o) {
  const P = o.particles;
  const max = o.max || 900;
  /** @type {Map<number, object>} */
  const byId = new Map();
  const cols = {
    smoke: P.color('#9aa3ad'), smokeDark: P.color('#6a7078'), flame: P.color('#ffb347'), drop: P.color('#7dd957'), dropLight: P.color('#b8ff80'),
    rail: P.color('#cfe8ff'), white: P.color('#ffffff'),
  };

  /**
   * Launch a projectile.
   * @param {object} p { id, kind, x, y, dstId, tx, ty, speed, team, col, colB, size, now, seed, aoe }
   */
  function launch(p) {
    if (byId.size >= max) { const first = byId.keys().next().value; byId.delete(first); }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const a = Math.atan2(dy, dx);
    const range = Math.hypot(dx, dy);
    const pr = {
      id: p.id, kind: p.kind, x: p.x, y: p.y, a, speed: p.speed || 400, dstId: p.dstId, tx: p.tx, ty: p.ty,
      team: p.team, col: p.col, colB: p.colB || '#ffffff', size: p.size || 1, born: p.now, lastEmit: p.now,
      seed: p.seed ?? ((p.id * 7919) & 1023), arrived: false, aoe: p.aoe || 0, directional: !!p.directional,
      maxLife: (range / Math.max(50, p.speed || 400)) * 1000 + 2500,
      colIdx: P.color(p.col), colBIdx: P.color(p.colB || '#ffffff'),
    };
    byId.set(p.id, pr);
    return pr;
  }

  /** Remove a projectile (pend). Returns it (for impact FX) or null. */
  function end(id) {
    const pr = byId.get(id);
    if (pr) byId.delete(id);
    return pr || null;
  }

  function update(dt, now, view, density) {
    for (const pr of byId.values()) {
      if (now - pr.born > pr.maxLife) { byId.delete(pr.id); continue; }
      const t = pr.directional ? null : view(pr.dstId);
      if (t) { pr.tx = t.x; pr.ty = t.y; }
      const dx = pr.tx - pr.x, dy = pr.ty - pr.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 6) { pr.arrived = true; continue; }
      let want = Math.atan2(dy, dx);
      if (!pr.directional && (pr.kind === 'ltorpedo' || pr.kind === 'spore')) want += Math.sin(now * 0.012 + pr.seed) * 0.35; // serpentine
      let d = want - pr.a;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      const turn = (TURN[pr.kind] || 6) * dt;
      pr.a += clamp(d, -turn, turn);
      const step = Math.min(dist, pr.speed * dt);
      pr.x += Math.cos(pr.a) * step; pr.y += Math.sin(pr.a) * step;
      // trail emission
      if (density <= 0) continue;
      const since = now - pr.lastEmit;
      switch (pr.kind) {
        case 'missile':
          if (since > 45 / density) { pr.lastEmit = now; P.spawn(KIND.SMOKE, pr.x, pr.y, -Math.cos(pr.a) * 20 + noise1(now * 0.01, pr.seed) * 15, -Math.sin(pr.a) * 20 + noise1(now * 0.01, pr.seed + 3) * 15, 650, 1.5, 4.5, cols.smoke, 0, 0, 0.97); }
          break;
        case 'torpedo':
          if (since > 28 / density) { pr.lastEmit = now; P.spawn(KIND.SMOKE, pr.x, pr.y, -Math.cos(pr.a) * 15 + noise1(now * 0.01, pr.seed) * 12, -Math.sin(pr.a) * 15 + noise1(now * 0.01, pr.seed + 3) * 12, 900, 2.2, 6.5, cols.smokeDark, 0, 0, 0.97); }
          break;
        case 'ltorpedo':
          if (since > 40 / density) { pr.lastEmit = now; P.spawn(KIND.DROP, pr.x, pr.y, -Math.cos(pr.a) * 25, -Math.sin(pr.a) * 25, 450, 1.4, 0.4, cols.drop, 0, 0, 0.95); }
          break;
        case 'plasma':
          if (since > 30 / density) { pr.lastEmit = now; P.spawn(KIND.PLASMA, pr.x, pr.y, -Math.cos(pr.a) * 30 + (hash01(pr.seed, now | 0) - 0.5) * 20, -Math.sin(pr.a) * 30 + (hash01(pr.seed, (now | 0) + 1) - 0.5) * 20, 260, pr.size * 2.2, 0.2, pr.colIdx); }
          break;
        case 'acid':
          if (since > 50 / density) { pr.lastEmit = now; P.spawn(KIND.DROP, pr.x, pr.y, -Math.cos(pr.a) * 40 + (hash01(pr.seed, now | 0) - 0.5) * 30, -Math.sin(pr.a) * 40 + (hash01(pr.seed, (now | 0) + 1) - 0.5) * 30, 320, 1.1, 0.3, cols.drop, 0, 0, 0.9); }
          break;
        case 'rail':
          if (since > 25) { pr.lastEmit = now; P.spawn(KIND.STREAK, pr.x, pr.y, 0, 0, 300, 1.5 * pr.size, 24, cols.rail, pr.a + Math.PI, 0, 1); }
          break;
        case 'ion':
          if (since > 60 / density) { pr.lastEmit = now; P.spawn(KIND.SPARK, pr.x, pr.y, (hash01(pr.seed, now | 0) - 0.5) * 120, (hash01(pr.seed, (now | 0) + 1) - 0.5) * 120, 160, 1, 1, pr.colIdx); }
          break;
        default: break;
      }
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx base transform [dpr,0,0,dpr,0,0]
   */
  function draw(ctx, cam, dpr, now, quality) {
    if (!byId.size) return;
    const z = cam.zoom;
    const vr = cam.visibleRect(60);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    const simple = z < 0.45 || quality < 0.5;
    // additive pass for all projectiles (they are emissive)
    ctx.globalCompositeOperation = 'lighter';
    for (const pr of byId.values()) {
      if (pr.x < vr.x0 || pr.x > vr.x1 || pr.y < vr.y0 || pr.y > vr.y1) continue;
      const sx = cam.worldToScreenX(pr.x), sy = cam.worldToScreenY(pr.y);
      const c = Math.cos(pr.a), s = Math.sin(pr.a);
      if (quality < 0.5) {
        // Keep every shot visible on low quality; a compact head and direction
        // stroke replace bloom, flicker and multiple sub-particles.
        const length = Math.max(3, (pr.kind === 'rail' ? 22 : 6) * z * pr.size);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = pr.col; ctx.lineWidth = Math.max(1, 1.5 * z); ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(sx - c * length, sy - s * length); ctx.lineTo(sx, sy); ctx.stroke();
        if (['missile', 'torpedo', 'ltorpedo', 'plasma', 'spore'].includes(pr.kind)) {
          const r = Math.max(1.2, 2 * z);
          ctx.fillStyle = pr.col;
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        }
        continue;
      }
      switch (pr.kind) {
        case 'tracer': {
          const l = 8 * z * pr.size;
          ctx.strokeStyle = pr.col; ctx.lineWidth = Math.max(1, 1.5 * z); ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.moveTo(sx - c * l, sy - s * l); ctx.lineTo(sx, sy); ctx.stroke();
          if (!simple) { const r = 3 * z; ctx.globalAlpha = 0.9; ctx.drawImage(getGlow(pr.colB), sx - r, sy - r, r * 2, r * 2); }
          break;
        }
        case 'flak': {
          ctx.fillStyle = pr.col; ctx.globalAlpha = 1;
          const r = Math.max(1, 1.2 * z);
          ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
          break;
        }
        case 'rail': {
          const l = 40 * z * pr.size;
          ctx.strokeStyle = '#cfe8ff'; ctx.lineWidth = Math.max(1, 2 * z); ctx.globalAlpha = 0.95;
          ctx.beginPath(); ctx.moveTo(sx - c * l, sy - s * l); ctx.lineTo(sx, sy); ctx.stroke();
          if (!simple) {
            ctx.strokeStyle = pr.col; ctx.lineWidth = Math.max(0.6, 0.8 * z); ctx.globalAlpha = 0.5;
            const o = 1.8 * z;
            ctx.beginPath();
            ctx.moveTo(sx - c * l - s * o, sy - s * l + c * o); ctx.lineTo(sx - s * o, sy + c * o);
            ctx.moveTo(sx - c * l + s * o, sy - s * l - c * o); ctx.lineTo(sx + s * o, sy - c * o);
            ctx.stroke();
            const r = 5 * z; ctx.globalAlpha = 1; ctx.drawImage(getGlow('#ffffff'), sx - r, sy - r, r * 2, r * 2);
          }
          break;
        }
        case 'missile': {
          const L = 5 * z, W = 1.8 * z;
          ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, sx * dpr, sy * dpr);
          ctx.fillStyle = '#c9d3df'; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(-L * 0.6, -W); ctx.lineTo(-L * 0.6, W); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffb347'; ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now * 0.05 + pr.seed);
          ctx.beginPath(); ctx.moveTo(-L * 0.6, -W * 0.6); ctx.lineTo(-L * 1.6, 0); ctx.lineTo(-L * 0.6, W * 0.6); ctx.closePath(); ctx.fill();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (!simple) { const r = 4 * z; ctx.globalAlpha = 0.6; ctx.drawImage(getGlow(pr.col), sx - r, sy - r, r * 2, r * 2); }
          break;
        }
        case 'torpedo': case 'ltorpedo': {
          const L = 7 * z, W = 2.8 * z;
          ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, sx * dpr, sy * dpr);
          ctx.fillStyle = pr.kind === 'ltorpedo' ? '#7dd957' : '#4b5665'; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.ellipse(0, 0, L, W, 0, 0, TAU); ctx.fill();
          if (pr.kind === 'ltorpedo') {
            ctx.fillStyle = '#2e1a24'; ctx.globalAlpha = 0.8;
            for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.ellipse(i * L * 0.5, 0, W * 0.5, W * 0.8, 0, 0, TAU); ctx.fill(); }
          } else {
            ctx.strokeStyle = pr.col; ctx.lineWidth = Math.max(0.8, 1.2 * z); ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now * 0.0126 + pr.seed);
            ctx.beginPath(); ctx.ellipse(-L * 0.2, 0, W * 0.9, W * 0.9, 0, 0, TAU); ctx.stroke();
            ctx.fillStyle = '#ffb347'; ctx.globalAlpha = 0.9;
            ctx.beginPath(); ctx.moveTo(-L, -W * 0.5); ctx.lineTo(-L * 1.8, 0); ctx.lineTo(-L, W * 0.5); ctx.closePath(); ctx.fill();
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const r = 7 * z; ctx.globalAlpha = 0.7; ctx.drawImage(getGlow(pr.col), sx - r, sy - r, r * 2, r * 2);
          break;
        }
        case 'plasma': {
          const wob = 1 + 0.12 * Math.sin(now * 0.12 + pr.seed);
          const r = 7 * z * pr.size * wob;
          ctx.globalAlpha = 0.9; ctx.drawImage(getGlow(pr.col), sx - r, sy - r, r * 2, r * 2);
          ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, 2.5 * z * pr.size * wob), 0, TAU); ctx.fill();
          break;
        }
        case 'acid': {
          const L = 3.2 * z * pr.size, W = 2 * z * pr.size;
          ctx.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, sx * dpr, sy * dpr);
          ctx.fillStyle = '#7dd957'; ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.ellipse(0, 0, L, W, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#b8ff80'; ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.ellipse(L * 0.25, 0, L * 0.5, W * 0.5, 0, 0, TAU); ctx.fill();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (!simple) { const r = 5 * z * pr.size; ctx.globalAlpha = 0.5; ctx.drawImage(getGlow(pr.col), sx - r, sy - r, r * 2, r * 2); }
          break;
        }
        case 'spore': {
          const n = simple ? 2 : 6;
          for (let i = 0; i < n; i++) {
            const a = now * 0.003 + i * (TAU / n) + pr.seed, R = 4 * z;
            const r = (3 + (i % 3)) * z;
            ctx.globalAlpha = 0.35;
            ctx.drawImage(getGlow(pr.col), sx + Math.cos(a) * R - r, sy + Math.sin(a) * R * 0.6 - r, r * 2, r * 2);
          }
          break;
        }
        case 'ion': {
          const r = 5 * z; ctx.globalAlpha = 0.9; ctx.drawImage(getGlow(pr.col), sx - r, sy - r, r * 2, r * 2);
          ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, 1.8 * z), 0, TAU); ctx.fill();
          if (!simple) {
            ctx.strokeStyle = pr.col; ctx.lineWidth = Math.max(0.6, z * 0.8); ctx.globalAlpha = 0.8;
            const fr = (now / 40) | 0;
            ctx.beginPath();
            for (let k = 0; k < 2; k++) {
              const a0 = hash01(pr.seed, fr, k) * TAU, l0 = (4 + hash01(pr.seed, fr, k + 5) * 4) * z;
              ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a0) * l0 * 0.5 + (hash01(pr.seed, fr, k + 9) - 0.5) * 3 * z, sy + Math.sin(a0) * l0 * 0.5); ctx.lineTo(sx + Math.cos(a0) * l0, sy + Math.sin(a0) * l0);
            }
            ctx.stroke();
          }
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return { launch, end, update, draw, get(id) { return byId.get(id); }, get count() { return byId.size; }, clear() { byId.clear(); } };
}
