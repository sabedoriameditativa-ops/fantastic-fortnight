// Shield visuals: idle bubble, hexagonal ripple on hit (clipped hex mask
// wave for large ships, 90° arc for small ones), break shatter and the
// "shield returning" grow animation.

import { makeCanvas, getGlow } from './glow.js';
import { KIND } from './particles.js';
import { TAU, clamp, rgba, makeRand } from './palette.js';

export function createShields(o) {
  const P = o.particles;
  const maskCache = new Map();
  /** @type {object[]} */
  const ripples = [];
  const MAX_RIPPLES = 24;
  /** id -> t0 of shield-break flash */
  const breaks = new Map();
  /** id -> t0 of shield restore (grow-in) */
  const restores = new Map();
  const rand = makeRand(0x5e1d);

  /** Mask radii (px): a handful of power-of-two sizes; drawImage scales the mask to the requested radius. */
  const MASK_SIZES = [32, 64, 128, 256, 512];
  const MASK_CACHE_MAX = MASK_SIZES.length;
  /**
   * Hex-grid mask canvas for a given screen radius (px). Quantized up to the next
   * power-of-two radius so the cache holds at most 5 canvases (~5.5 MB) instead
   * of one per 8-px bucket (≈50 MB with a zooming camera over aura domes).
   */
  function hexMask(rPx) {
    let key = MASK_SIZES[MASK_SIZES.length - 1];
    for (const sz of MASK_SIZES) if (rPx <= sz) { key = sz; break; }
    let c = maskCache.get(key);
    if (c) return c;
    if (maskCache.size >= MASK_CACHE_MAX) maskCache.delete(maskCache.keys().next().value);
    const S = key * 2;
    c = makeCanvas(S, S);
    const g = c.getContext('2d');
    g.save();
    g.beginPath(); g.arc(key, key, key - 1, 0, TAU); g.clip();
    const side = Math.max(5, key / 6);
    const w = side * Math.sqrt(3), h = side * 1.5;
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1;
    g.beginPath();
    for (let row = -1; row * h < S + h; row++) {
      for (let col = -1; col * w < S + w; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * h;
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i / 6) * TAU;
          const x = cx + Math.cos(a) * side, y = cy + Math.sin(a) * side;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
      }
    }
    g.stroke();
    g.restore();
    maskCache.set(key, c);
    return c;
  }

  /** Register a hit ripple on ship `id` at absolute angle `ang` (radians, world). */
  function ripple(id, ang, now, strength = 1) {
    if (ripples.length >= MAX_RIPPLES) ripples.shift();
    ripples.push({ id, ang, t0: now, strength });
  }

  /** Shield reached zero: flash + hex shards. */
  function shatter(id, x, y, r, teamColor, now, density) {
    breaks.set(id, now);
    const ci = P.color(teamColor);
    const n = Math.round(16 * density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand.range(-0.2, 0.2), v = rand.range(40, 110);
      P.spawn(KIND.HEX, x + Math.cos(a) * r, y + Math.sin(a) * r, Math.cos(a) * v, Math.sin(a) * v, rand.range(400, 600), Math.max(2, r * 0.08), 1, ci, a, rand.range(-6, 6), 0.97);
    }
  }

  function restored(id, now) { restores.set(id, now); }

  /**
   * Idle bubble + break flash + restore grow for one ship. Called during the
   * ship pass with the base transform [dpr,0,0,dpr,0,0].
   * @param {number} sx screen x
   * @param {number} sy screen y
   * @param {number} rPx bubble radius in screen px
   * @param {number} pct shield 0..1
   */
  function drawBubble(ctx, sx, sy, rPx, pct, teamColor, now, id, dpr, lod) {
    let r = rPx;
    const rs = restores.get(id);
    if (rs !== undefined) {
      const u = (now - rs) / 300;
      if (u >= 1) restores.delete(id); else r = rPx * (1 - (1 - u) * (1 - u));
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = teamColor; ctx.globalAlpha = 0.05 + 0.05 * pct;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    if (lod >= 1) {
      ctx.strokeStyle = teamColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.1 + 0.2 * pct;
      ctx.stroke();
    }
    const bk = breaks.get(id);
    if (bk !== undefined) {
      const age = now - bk;
      if (age > 200) breaks.delete(id);
      else if (((age / 80) | 0) % 2 === 0) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.9 * (1 - age / 200);
        ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, TAU); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Draw active ripples. `look(id)` → { x, y, r (world shield radius), team color, size } or null.
   */
  function drawRipples(ctx, cam, dpr, now, look) {
    if (!ripples.length) return;
    const z = cam.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      const u = (now - rp.t0) / 350;
      if (u >= 1) { ripples.splice(i, 1); continue; }
      if (u < 0) continue;
      const L = look(rp.id);
      if (!L) { ripples.splice(i, 1); continue; }
      const R = L.r * z;
      const cx = cam.worldToScreenX(L.x), cy = cam.worldToScreenY(L.y);
      if (!cam.isVisible(L.x, L.y, L.r)) continue;
      const ix = cx + Math.cos(rp.ang) * R, iy = cy + Math.sin(rp.ang) * R;
      if (R >= 26) {
        const outer = u * R * 1.5 + 2, inner = Math.max(0, outer - 10 * Math.max(0.6, z) - u * R * 0.5);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
        ctx.beginPath(); ctx.arc(ix, iy, outer, 0, TAU); ctx.arc(ix, iy, inner, 0, TAU, true); ctx.clip('evenodd');
        ctx.globalAlpha = 0.9 * (1 - u) * rp.strength;
        ctx.fillStyle = L.color; ctx.globalAlpha *= 0.35;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.9 * (1 - u) * rp.strength;
        ctx.drawImage(hexMask(R), cx - R, cy - R, R * 2, R * 2);
        ctx.restore();
        // impact bloom
        const g = 8 * z;
        ctx.globalAlpha = 0.8 * (1 - u);
        ctx.drawImage(getGlow(L.color), ix - g, iy - g, g * 2, g * 2);
      } else {
        ctx.strokeStyle = L.color; ctx.lineWidth = Math.max(1.5, 3 * z); ctx.globalAlpha = (1 - u) * rp.strength;
        ctx.beginPath(); ctx.arc(cx, cy, R, rp.ang - Math.PI / 4 - u * 0.5, rp.ang + Math.PI / 4 + u * 0.5); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return { ripple, shatter, restored, drawBubble, drawRipples, hexMask, clear() { ripples.length = 0; breaks.clear(); restores.clear(); maskCache.clear(); }, get maskCacheSize() { return maskCache.size; }, rgba, clamp };
}
