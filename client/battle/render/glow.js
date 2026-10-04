// Cached glow / soft sprites (radial gradients rendered once, blitted with
// 'lighter'). Nothing in the hot loop should create gradients or use shadowBlur.

import { parseColor } from './palette.js';

const glowCache = new Map();
const softCache = new Map();
const flashCache = new Map();

/**
 * Create a canvas that works both in the browser and (as a no-op stub) in Node.
 * @param {number} w
 * @param {number} h
 */
export function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(w, h); } catch (e) { /* fall through */ }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  throw new Error('No canvas implementation available');
}

/**
 * 64x64 glow sprite: solid color at the center fading to transparent.
 * @param {string} color css color
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
export function getGlow(color) {
  let c = glowCache.get(color);
  if (c) return c;
  const S = 64;
  c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const [r, gg, b] = parseColor(color);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  grad.addColorStop(0.25, `rgba(${r},${gg},${b},0.55)`);
  grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.14)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  glowCache.set(color, c);
  return c;
}

/**
 * 32x32 soft disc (for smoke/fire particles): opaque center, soft edge.
 * @param {string} color
 * @param {number} [hard] 0..1 how hard the edge is
 */
export function getSoft(color, hard = 0.4) {
  const key = color + '|' + hard;
  let c = softCache.get(key);
  if (c) return c;
  const S = 32;
  c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const [r, gg, b] = parseColor(color);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  grad.addColorStop(hard, `rgba(${r},${gg},${b},0.9)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  softCache.set(key, c);
  return c;
}

/**
 * Muzzle flash sprites by kind (32x32), drawn once.
 * @param {'kinetic'|'plasma'|'railgun'|'acid'|'flak'|'ion'|'laser'|'missile'} kind
 * @param {string} color
 */
export function getFlash(kind, color) {
  const key = kind + '|' + color;
  let c = flashCache.get(key);
  if (c) return c;
  const S = 32, h = S / 2;
  c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const [r, gg, b] = parseColor(color);
  const col = (a) => `rgba(${r},${gg},${b},${a})`;
  g.globalCompositeOperation = 'lighter';
  switch (kind) {
    case 'kinetic': case 'flak': case 'missile': {
      // 4-point star
      g.fillStyle = col(0.95);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, rr = i % 2 ? h * 0.25 : h * 0.95;
        g.lineTo(h + Math.cos(a) * rr, h + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      g.drawImage(getGlow(color), h - 10, h - 10, 20, 20);
      break;
    }
    case 'railgun': {
      g.strokeStyle = col(0.9); g.lineWidth = 2.5;
      g.beginPath(); g.arc(h, h, h * 0.55, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
      g.beginPath(); g.arc(h, h, h * 0.8, 0, Math.PI * 2); g.stroke();
      break;
    }
    case 'acid': {
      g.fillStyle = col(0.9);
      for (let i = 0; i < 3; i++) {
        const a = -0.6 + i * 0.6;
        g.beginPath(); g.ellipse(h + Math.cos(a) * 6, h + Math.sin(a) * 6, 4, 2.2, a, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    default: {
      g.drawImage(getGlow(color), 0, 0, S, S);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath(); g.arc(h, h, 4, 0, Math.PI * 2); g.fill();
    }
  }
  flashCache.set(key, c);
  return c;
}

/** Drop cached sprites (e.g. on dispose). */
export function clearGlowCaches() {
  glowCache.clear(); softCache.clear(); flashCache.clear();
}
