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
  function drawBubble(ctx, sx, sy, rPx, pct, teamColor, now, id, dpr, lod, reducedEffects = false, faction = 'terran') {
    let r = rPx;
    const rs = restores.get(id);
    if (rs !== undefined) {
      const u = (now - rs) / 300;
      if (u >= 1) restores.delete(id); else r = rPx * (1 - (1 - u) * (1 - u));
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // The shield reads at its rim; a light interior tint keeps hull material and
    // damage visible instead of washing every ship into its team's color.
    ctx.fillStyle = teamColor; ctx.globalAlpha = reducedEffects ? 0.018 : 0.015 + 0.02 * pct;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
    if (lod >= 1) {
      ctx.strokeStyle = teamColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.12 + 0.2 * pct;
      ctx.stroke();
    }
    if (!reducedEffects && lod >= 2 && r >= 12) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = teamColor; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.13 + 0.16 * pct;
      ctx.beginPath();
      if (faction === 'lumen' || faction === 'astral') {
        // Crystal/astral screens have separated facets; nanite/alloy screens use
        // paired arcs. The actual shield boundary remains circular for all.
        for (let k = 0; k < 6; k++) {
          const a = k * TAU / 6 - Math.PI / 2, b = a + TAU / 6 * 0.7;
          ctx.moveTo(sx + Math.cos(a) * r * 0.95, sy + Math.sin(a) * r * 0.95);
          ctx.lineTo(sx + Math.cos(b) * r * 0.95, sy + Math.sin(b) * r * 0.95);
        }
      } else {
        ctx.arc(sx, sy, r * 0.94, Math.PI * 1.1, Math.PI * 1.6);
        ctx.moveTo(sx + Math.cos(Math.PI * 0.1) * r * 0.94, sy + Math.sin(Math.PI * 0.1) * r * 0.94);
        ctx.arc(sx, sy, r * 0.94, Math.PI * 0.1, Math.PI * 0.38);
      }
      ctx.stroke();
    }
    const bk = breaks.get(id);
    if (bk !== undefined) {
      const age = now - bk;
      if (age > 200) breaks.delete(id);
      else if (!reducedEffects) {
        ctx.strokeStyle = teamColor; ctx.lineWidth = 2; ctx.globalAlpha = 0.5 * (1 - age / 200);
        ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, TAU); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Draw active ripples. `look(id)` → { x, y, r (world shield radius), team color, size } or null.
   */
  function drawRipples(ctx, cam, dpr, now, look, reducedEffects = false) {
    if (!ripples.length) return;
    const z = cam.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = reducedEffects ? 'source-over' : 'lighter';
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
      if (reducedEffects) {
        ctx.strokeStyle = L.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.35 * (1 - u);
        ctx.beginPath(); ctx.arc(cx, cy, R, rp.ang - Math.PI / 4, rp.ang + Math.PI / 4); ctx.stroke();
      } else if (R >= 26) {
        const outer = u * R * 1.5 + 2, inner = Math.max(0, outer - 10 * Math.max(0.6, z) - u * R * 0.5);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
        ctx.beginPath(); ctx.arc(ix, iy, outer, 0, TAU); ctx.arc(ix, iy, inner, 0, TAU, true); ctx.clip('evenodd');
        ctx.globalAlpha = 0.65 * (1 - u) * rp.strength;
        ctx.fillStyle = L.color; ctx.globalAlpha *= 0.35;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.55 * (1 - u) * rp.strength;
        ctx.drawImage(hexMask(R), cx - R, cy - R, R * 2, R * 2);
        ctx.restore();
        // The bright edge identifies the incoming direction even when the
        // interior wave crosses a busy or very dark hull.
        ctx.strokeStyle = L.color; ctx.lineWidth = Math.max(1, 2.2 * z);
        ctx.globalAlpha = 0.65 * (1 - u) * rp.strength;
        ctx.beginPath(); ctx.arc(cx, cy, R, rp.ang - 0.2 - u * 0.75, rp.ang + 0.2 + u * 0.75); ctx.stroke();
        // impact bloom
        const g = 8 * z;
        ctx.globalAlpha = 0.55 * (1 - u);
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
