// Structure-of-arrays particle pool. Two render passes (additive / normal),
// cached soft sprites instead of per-particle gradients, swap-remove on death.

import { getSoft, getGlow } from './glow.js';
import { mix } from './palette.js';

export const KIND = {
  SPARK: 0, FIRE: 1, SMOKE: 2, DEBRIS: 3, EMBER: 4, PLASMA: 5, HEX: 6, CUBE: 7, DOT: 8, SHARD: 9, GLOW: 10, DROP: 11, PLUS: 12, STREAK: 13,
};
// true = additive ('lighter') pass
const ADDITIVE = [true, true, false, false, true, true, true, false, true, false, true, false, true, true];

const FIRE_STAGES = ['#fff2c0', '#ffb347', '#ff7a3d', '#8a2a10', '#3a1a10'];

/**
 * @param {number} max pool size
 */
export function createParticles(max = 4500) {
  const P = {
    x: new Float32Array(max), y: new Float32Array(max), vx: new Float32Array(max), vy: new Float32Array(max),
    life: new Float32Array(max), max: new Float32Array(max), s0: new Float32Array(max), s1: new Float32Array(max),
    rot: new Float32Array(max), vrot: new Float32Array(max), drag: new Float32Array(max),
    kind: new Uint8Array(max), col: new Uint16Array(max), seed: new Uint8Array(max),
  };
  let count = 0;
  const colors = [];
  const colorIdx = new Map();
  let seedCounter = 0;

  function color(css) {
    let i = colorIdx.get(css);
    if (i === undefined) { i = colors.length; colors.push(css); colorIdx.set(css, i); }
    return i;
  }

  /**
   * Spawn one particle. Returns its index or -1 when the pool is full.
   * @param {number} kind KIND.*
   * @param {number} x world
   * @param {number} y world
   * @param {number} vx u/s
   * @param {number} vy u/s
   * @param {number} life ms
   * @param {number} s0 size (world units) at birth
   * @param {number} s1 size at death
   * @param {number} col color index (from color())
   * @param {number} [rot] radians
   * @param {number} [vrot] rad/s
   * @param {number} [drag] velocity multiplier per 1/60 s (0.98 ≈ smoke)
   */
  function spawn(kind, x, y, vx, vy, life, s0, s1, col, rot = 0, vrot = 0, drag = 1) {
    if (count >= max) return -1;
    const i = count++;
    P.kind[i] = kind; P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy;
    P.life[i] = life; P.max[i] = life; P.s0[i] = s0; P.s1[i] = s1; P.col[i] = col;
    P.rot[i] = rot; P.vrot[i] = vrot; P.drag[i] = drag; P.seed[i] = (seedCounter++) & 255;
    return i;
  }

  function swapRemove(i) {
    const j = --count;
    if (i === j) return;
    P.kind[i] = P.kind[j]; P.x[i] = P.x[j]; P.y[i] = P.y[j]; P.vx[i] = P.vx[j]; P.vy[i] = P.vy[j];
    P.life[i] = P.life[j]; P.max[i] = P.max[j]; P.s0[i] = P.s0[j]; P.s1[i] = P.s1[j]; P.col[i] = P.col[j];
    P.rot[i] = P.rot[j]; P.vrot[i] = P.vrot[j]; P.drag[i] = P.drag[j]; P.seed[i] = P.seed[j];
  }

  /** @param {number} dt seconds */
  function update(dt) {
    const dms = dt * 1000;
    const dragPow = dt * 60; // drag is specified per 1/60 s
    for (let i = 0; i < count;) {
      P.life[i] -= dms;
      if (P.life[i] <= 0) { swapRemove(i); continue; }
      const d = P.drag[i];
      if (d !== 1) { const f = Math.pow(d, dragPow); P.vx[i] *= f; P.vy[i] *= f; }
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.rot[i] += P.vrot[i] * dt;
      i++;
    }
  }

  function alphaOf(kind, u, seed, t) {
    switch (kind) {
      case KIND.SPARK: case KIND.STREAK: return 1 - u;
      case KIND.FIRE: return u < 0.15 ? 1 : Math.pow(1 - u, 0.7);
      case KIND.SMOKE: return 0.32 * (u < 0.1 ? u * 10 : 1 - (u - 0.1) / 0.9);
      case KIND.DEBRIS: case KIND.CUBE: return u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      case KIND.EMBER: return (0.4 + 0.6 * Math.abs(Math.sin(t * 20 + seed))) * (1 - u);
      case KIND.SHARD: return (0.6 + 0.4 * Math.abs(Math.sin(t * 15 + seed))) * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4);
      case KIND.PLUS: return u < 0.2 ? 1 : 1 - (u - 0.2) / 0.8;
      default: return 1 - u;
    }
  }

  /**
   * Render all particles.
   * @param {CanvasRenderingContext2D} ctx base transform must be [dpr,0,0,dpr,0,0]
   * @param {object} cam camera (worldToScreenX/Y, zoom, visibleRect)
   * @param {number} dpr
   * @param {number} now ms
   */
  function render(ctx, cam, dpr, now) {
    if (count === 0) return;
    const t = now / 1000;
    const z = cam.zoom;
    const vr = cam.visibleRect(40);
    const ox = cam.vx + cam.vw / 2 + cam.shakeX - cam.x * z, oy = cam.vy + cam.vh / 2 + cam.shakeY - cam.y * z;
    for (let pass = 0; pass < 2; pass++) {
      const additive = pass === 1;
      ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let curCol = -1;
      ctx.lineWidth = Math.max(1, 1.2 * z);
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const kind = P.kind[i];
        if (ADDITIVE[kind] !== additive) continue;
        const x = P.x[i], y = P.y[i];
        if (x < vr.x0 || x > vr.x1 || y < vr.y0 || y > vr.y1) continue;
        const u = 1 - P.life[i] / P.max[i];
        const size = (P.s0[i] + (P.s1[i] - P.s0[i]) * u) * z;
        const sx = x * z + ox, sy = y * z + oy;
        const a = alphaOf(kind, u, P.seed[i], t);
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        switch (kind) {
          case KIND.SPARK: {
            if (P.col[i] !== curCol) { curCol = P.col[i]; ctx.strokeStyle = colors[curCol]; }
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - P.vx[i] * 0.03 * z, sy - P.vy[i] * 0.03 * z); ctx.stroke();
            break;
          }
          case KIND.STREAK: {
            if (P.col[i] !== curCol) { curCol = P.col[i]; ctx.strokeStyle = colors[curCol]; }
            ctx.lineWidth = Math.max(1, size);
            ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(P.rot[i]) * P.s1[i] * z, sy + Math.sin(P.rot[i]) * P.s1[i] * z); ctx.stroke();
            ctx.lineWidth = Math.max(1, 1.2 * z);
            break;
          }
          case KIND.FIRE: {
            const stage = FIRE_STAGES[Math.min(FIRE_STAGES.length - 1, Math.floor(u * FIRE_STAGES.length))];
            if (size < 0.4) break;
            if (size < 1.6) { ctx.fillStyle = stage; curCol = -1; ctx.fillRect(sx - size, sy - size, size * 2, size * 2); break; }
            ctx.drawImage(getSoft(stage, u < 0.4 ? 0.3 : 0.1), sx - size, sy - size, size * 2, size * 2);
            break;
          }
          case KIND.SMOKE: {
            if (size < 1.5) break;
            ctx.drawImage(getSoft(colors[P.col[i]], 0.1), sx - size, sy - size, size * 2, size * 2);
            break;
          }
          case KIND.PLASMA: case KIND.GLOW: {
            if (size < 0.4) break;
            if (size < 1.6) { if (P.col[i] !== curCol) { curCol = P.col[i]; ctx.fillStyle = colors[curCol]; } ctx.fillRect(sx - size, sy - size, size * 2, size * 2); break; }
            ctx.drawImage(getGlow(colors[P.col[i]]), sx - size, sy - size, size * 2, size * 2);
            break;
          }
          case KIND.EMBER: case KIND.DOT: {
            if (P.col[i] !== curCol) { curCol = P.col[i]; ctx.fillStyle = colors[curCol]; }
            const s = Math.max(1, size);
            ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
            break;
          }
          case KIND.DROP: {
            if (P.col[i] !== curCol) { curCol = P.col[i]; ctx.fillStyle = colors[curCol]; }
            const s = Math.max(0.8, size);
            ctx.beginPath(); ctx.ellipse(sx, sy, s, s * 0.65, Math.atan2(P.vy[i], P.vx[i]), 0, Math.PI * 2); ctx.fill();
            break;
          }
          case KIND.PLUS: {
            if (P.col[i] !== curCol) { curCol = P.col[i]; ctx.fillStyle = colors[curCol]; }
            const s = Math.max(2, size);
            ctx.fillRect(sx - s / 2, sy - s / 6, s, s / 3); ctx.fillRect(sx - s / 6, sy - s / 2, s / 3, s);
            break;
          }
          case KIND.DEBRIS: case KIND.CUBE: case KIND.HEX: case KIND.SHARD: {
            if (P.col[i] !== curCol) { curCol = P.col[i]; ctx.fillStyle = colors[curCol]; }
            const s = Math.max(0.8, size);
            const c = Math.cos(P.rot[i]), sn = Math.sin(P.rot[i]);
            ctx.setTransform(c * dpr, sn * dpr, -sn * dpr, c * dpr, sx * dpr, sy * dpr);
            if (kind === KIND.CUBE) ctx.fillRect(-s / 2, -s / 2, s, s);
            else if (kind === KIND.HEX) {
              ctx.beginPath();
              for (let k = 0; k < 6; k++) { const an = (k / 6) * Math.PI * 2; ctx.lineTo(Math.cos(an) * s, Math.sin(an) * s); }
              ctx.closePath(); ctx.fill();
            } else if (kind === KIND.SHARD) {
              ctx.beginPath(); ctx.moveTo(s * 1.2, 0); ctx.lineTo(-s * 0.5, -s * 0.4); ctx.lineTo(-s * 0.8, 0); ctx.lineTo(-s * 0.5, s * 0.4); ctx.closePath(); ctx.fill();
            } else {
              const sd = P.seed[i];
              if (sd & 1) ctx.fillRect(-s / 2, -s / 3, s, s * 0.66);
              else { ctx.beginPath(); ctx.moveTo(s * 0.7, 0); ctx.lineTo(-s * 0.5, -s * 0.5); ctx.lineTo(-s * 0.3, s * 0.5); ctx.closePath(); ctx.fill(); }
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            break;
          }
          default: break;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    spawn, update, render, color,
    get count() { return count; },
    get max() { return max; },
    /** Fraction of the pool in use. */
    get load() { return count / max; },
    clear() { count = 0; },
    /** Helper: mixed color index cached by (a,b,t). */
    mixColor(a, b, t) { return color(mix(a, b, t)); },
    KIND,
  };
}
