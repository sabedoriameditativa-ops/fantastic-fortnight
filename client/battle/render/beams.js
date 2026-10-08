// Beam list and renderer: hitscan lasers, ion lances, lightning arcs, tethers,
// repair/disassembler dashed beams. Three strokes per beam (glow, body, core)
// with 'lighter' blending; paths are regenerated cheaply per frame.

import { getGlow } from './glow.js';
import { hash01, clamp, TAU } from './palette.js';

/** Beam looks keyed by kind. */
export const BEAM_KINDS = {
  lance:      { w: 2.2, dur: 140, wavy: true },
  laserLight: { w: 1.0, dur: 90 },
  ion:        { w: 1.4, dur: 120, jitter: 2 },
  arc:        { w: 1.0, dur: 160, lightning: true },
  primordial: { w: 5.0, dur: 420, wavy: true, impact: 3 },
  tendril:    { w: 2.0, dur: 5000, bezier: true, suckers: true },
  repair:     { w: 1.0, dur: 400, dash: true },
  nanite:     { w: 1.2, dur: 400, dash: true },
  pd:         { w: 0.8, dur: 60 },
};

/**
 * @param {number} max maximum simultaneous beams
 */
export function createBeams(max = 256) {
  /** @type {object[]} */
  const list = [];
  const scratch = new Float32Array(64);

  function add(b) {
    if (list.length >= max) list.shift();
    const k = BEAM_KINDS[b.kind] || BEAM_KINDS.lance;
    const beam = {
      kind: b.kind, srcId: b.srcId || 0, dstId: b.dstId || 0,
      x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1,
      ox: b.ox || 0, oy: b.oy || 0,        // muzzle offset in the source frame (world units, local)
      w: b.w ?? k.w, colA: b.colA, colB: b.colB || '#ffffff',
      t0: b.t0, t1: b.t1 ?? b.t0 + (b.dur ?? k.dur), seed: (hash01(b.t0 | 0, b.srcId | 0) * 1e6) | 0,
      flags: k, follow: b.follow !== false,
      impactR: b.impactR ?? 10,
    };
    list.push(beam);
    return beam;
  }

  /** Find an active beam between two ships of a kind (for coalescing). */
  function find(kind, srcId, dstId) {
    for (const b of list) if (b.kind === kind && b.srcId === srcId && b.dstId === dstId) return b;
    return null;
  }

  function update(now, view) {
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (now > b.t1 + 100) { list.splice(i, 1); continue; }
      if (!b.follow) continue;
      const s = b.srcId ? view(b.srcId) : null;
      if (s) {
        const c = Math.cos(s.a), sn = Math.sin(s.a);
        b.x0 = s.x + b.ox * c - b.oy * sn; b.y0 = s.y + b.ox * sn + b.oy * c;
      }
      const d = b.dstId ? view(b.dstId) : null;
      if (d) { b.x1 = d.x; b.y1 = d.y; }
    }
  }

  function strokePts(ctx, n, lw, color, alpha) {
    ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(scratch[0], scratch[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(scratch[i * 2], scratch[i * 2 + 1]);
    ctx.stroke();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx base transform [dpr,0,0,dpr,0,0]
   */
  function draw(ctx, cam, dpr, now, quality, options = {}) {
    if (!list.length) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = options.reducedEffects ? 'source-over' : 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const z = cam.zoom;
    const detailed = quality > 0.5 && !options.reducedEffects;
    const motionTime = options.reducedMotion ? 0 : now;
    for (const b of list) {
      const age = now - b.t0;
      if (age < 0) continue;
      const fadeIn = clamp(age / 50, 0, 1), fadeOut = clamp((b.t1 - now + 80) / 80, 0, 1);
      const a = fadeIn * fadeOut;
      if (a <= 0.02) continue;
      const p0x = cam.worldToScreenX(b.x0), p0y = cam.worldToScreenY(b.y0);
      const p1x = cam.worldToScreenX(b.x1), p1y = cam.worldToScreenY(b.y1);
      // cull: both ends far outside
      const vx0 = cam.vx - 100, vy0 = cam.vy - 100, vx1 = cam.vx + cam.vw + 100, vy1 = cam.vy + cam.vh + 100;
      if ((p0x < vx0 && p1x < vx0) || (p0x > vx1 && p1x > vx1) || (p0y < vy0 && p1y < vy0) || (p0y > vy1 && p1y > vy1)) continue;
      const f = b.flags;
      let n = 2;
      const dx = p1x - p0x, dy = p1y - p0y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      if (options.reducedEffects) {
        scratch[0] = p0x; scratch[1] = p0y; scratch[2] = p1x; scratch[3] = p1y;
      } else if (f.lightning) {
        n = 12 + Math.min(6, (len / 40) | 0);
        const frame = (motionTime / 50) | 0;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const j = i === 0 || i === n - 1 ? 0 : (hash01(b.seed, frame, i) - 0.5) * 12 * z * Math.sin(u * Math.PI);
          scratch[i * 2] = p0x + dx * u + nx * j; scratch[i * 2 + 1] = p0y + dy * u + ny * j;
        }
      } else if (f.wavy) {
        n = 12;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const j = Math.sin(motionTime * 0.04 + i * 1.1 + b.seed) * 1.5 * z * b.w * 0.5 * Math.sin(u * Math.PI);
          scratch[i * 2] = p0x + dx * u + nx * j; scratch[i * 2 + 1] = p0y + dy * u + ny * j;
        }
      } else if (f.bezier) {
        n = 14;
        const sway = Math.sin(motionTime * 0.004 + b.seed) * 15 * z;
        const cx = (p0x + p1x) / 2 + nx * sway, cy = (p0y + p1y) / 2 + ny * sway;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1), v = 1 - u;
          scratch[i * 2] = v * v * p0x + 2 * v * u * cx + u * u * p1x; scratch[i * 2 + 1] = v * v * p0y + 2 * v * u * cy + u * u * p1y;
        }
      } else if (f.jitter) {
        n = 6;
        const frame = (motionTime / 40) | 0;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const j = i === 0 || i === n - 1 ? 0 : (hash01(b.seed, frame, i) - 0.5) * f.jitter * 2 * z;
          scratch[i * 2] = p0x + dx * u + nx * j; scratch[i * 2 + 1] = p0y + dy * u + ny * j;
        }
      } else {
        scratch[0] = p0x; scratch[1] = p0y; scratch[2] = p1x; scratch[3] = p1y;
      }
      const w = b.w * Math.max(0.6, z);
      if (detailed) strokePts(ctx, n, w * 5, b.colA, 0.16 * a);
      strokePts(ctx, n, w * 1.8, b.colA, 0.85 * a);
      if (f.dash) { ctx.setLineDash([6 * z, 4 * z]); ctx.lineDashOffset = -motionTime * 0.25 * z; }
      strokePts(ctx, n, Math.max(0.6, w * 0.55), b.colB, a * 0.9);
      if (f.dash) ctx.setLineDash([]);
      // impact bloom
      const ir = b.impactR * z * (f.impact || 1);
      ctx.globalAlpha = 0.8 * a;
      if (detailed) ctx.drawImage(getGlow(b.colA), p1x - ir, p1y - ir, ir * 2, ir * 2);
      if (detailed && f.dash && len > 24) {
        // Repair packets are squares; the disassembler uses diamonds. Both
        // remain distinct from an attack beam without relying only on color.
        ctx.fillStyle = b.colB; ctx.globalAlpha = 0.65 * a;
        const size = Math.max(1.3, z * 1.8);
        const travel = (motionTime * 0.0007) % 1;
        for (let k = 0; k < 3; k++) {
          const u = (travel + k / 3) % 1, px = p0x + dx * u, py = p0y + dy * u;
          if (b.kind === 'nanite') {
            ctx.beginPath(); ctx.moveTo(px, py - size * 1.4); ctx.lineTo(px + size * 1.4, py);
            ctx.lineTo(px, py + size * 1.4); ctx.lineTo(px - size * 1.4, py); ctx.closePath(); ctx.fill();
          } else ctx.fillRect(px - size, py - size, size * 2, size * 2);
        }
      }
      if (f.suckers && detailed) {
        ctx.fillStyle = b.colB; ctx.globalAlpha = 0.6 * a;
        for (let i = 1; i < n - 1; i += 2) { ctx.beginPath(); ctx.arc(scratch[i * 2], scratch[i * 2 + 1], 1.5 * z, 0, TAU); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return { add, find, update, draw, get count() { return list.length; }, clear() { list.length = 0; }, list };
}
