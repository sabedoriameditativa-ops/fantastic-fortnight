// Draw catalog ships live on small canvases (fleet builder cards, codex,
// lobby avatars, results MVP) using the renderer's procedural sprite system.
// A shared animator redraws registered canvases at ~24 fps while they are
// visible; with reduced motion they are drawn once.

import { getDef, createSpriteCache, blitShip, drawShipDetails, lodFor } from '../battle/sprites.js';
import { designBBox } from '../battle/render/shipDefs.js';
import { palette } from '../battle/render/palette.js';
import { TEAM_COLORS } from '/shared/constants.js';

let cache = null;
let cacheDpr = 1;

function dpr() {
  return Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
}

/** Shared sprite cache (built lazily; rebuilt when the DPR changes). */
export function spriteCache() {
  const d = dpr();
  if (!cache) { cache = createSpriteCache({ dpr: d, teamColors: TEAM_COLORS, maxEntries: 600 }); cacheDpr = d; }
  else if (d !== cacheDpr) { cache.setDpr(d); cacheDpr = d; }
  return cache;
}

/** Ensure the backing store matches the CSS size × dpr. Returns { w, h, d } in CSS px. */
export function fitCanvas(canvas) {
  const d = dpr();
  const cw = canvas.clientWidth || Number(canvas.getAttribute('width')) || 160;
  const ch = canvas.clientHeight || Number(canvas.getAttribute('height')) || 100;
  const W = Math.max(1, Math.round(cw * d)), H = Math.max(1, Math.round(ch * d));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  return { w: cw, h: ch, d };
}

/**
 * Zoom that fits a ship (rotated by `angle`) into w×h with padding.
 * @returns {number}
 */
export function fitZoom(cls, w, h, angle = -0.35, pad = 8, minZoom = 0.35, maxZoom = 2.6) {
  const def = getDef(cls);
  const bb = designBBox(def);
  const k = def.size / 100;
  const W = Math.max(1, bb.w * k), H = Math.max(1, bb.h * k);
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const ex = c * W + s * H, ey = s * W + c * H;
  const z = Math.min((w - 2 * pad) / ex, (h - 2 * pad) / ey);
  return Math.max(minZoom, Math.min(maxZoom, z));
}

/**
 * Draw one ship centered on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {string} cls
 * @param {{ team?: 0|1, angle?: number, zoom?: number|'fit', pad?: number, anims?: boolean, now?: number, thrust?: number,
 *          clear?: boolean, bg?: string|null, damage?: 0|1|2, maxZoom?: number, minZoom?: number, boosted?: boolean, alpha?: number, offsetY?: number }} [o]
 */
export function drawShip(canvas, cls, o = {}) {
  const { w, h, d } = fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const angle = o.angle ?? -0.35;
  const zoom = typeof o.zoom === 'number' ? o.zoom : fitZoom(cls, w, h, angle, o.pad ?? 8, o.minZoom ?? 0.35, o.maxZoom ?? 2.6);
  const def = getDef(cls);
  const team = o.team ?? 0;
  const pal = palette(def.faction, team, TEAM_COLORS);
  ctx.setTransform(d, 0, 0, d, 0, 0);
  if (o.clear !== false) {
    ctx.clearRect(0, 0, w, h);
    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, w, h); }
  }
  const cx = w / 2, cy = h / 2 + (o.offsetY || 0);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const now = o.now ?? (typeof performance !== 'undefined' ? performance.now() : 0);
  const spr = spriteCache().get(def, team, zoom, o.damage || 0);
  blitShip(ctx, spr, cx, cy, cos, sin, zoom, d, o.alpha ?? 1, 1);
  if (o.anims !== false && lodFor(def.size * zoom) === 2) {
    if ((o.alpha ?? 1) !== 1) ctx.globalAlpha = o.alpha;
    drawShipDetails(ctx, def, pal, cx, cy, cos, sin, zoom, d, { id: hashCls(cls), thrust: o.thrust ?? 0.55, boosted: !!o.boosted, disrupted: false }, now, { anims: o.anims !== false, glow: true });
    ctx.globalAlpha = 1;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function hashCls(s) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000 + 1;
}

// ---------------------------------------------------------------------------
// Animator: redraws registered canvases while visible
// ---------------------------------------------------------------------------

const entries = new Map();
let raf = 0;
let lastFrame = 0;
let reducedMotion = false;
let observer = null;
const FPS = 24;

function ensureObserver() {
  if (observer || typeof IntersectionObserver !== 'function') return;
  observer = new IntersectionObserver((list) => {
    for (const it of list) {
      const e = entries.get(it.target);
      if (e) { e.visible = it.isIntersecting; if (e.visible) e.dirty = true; }
    }
    schedule();
  }, { rootMargin: '64px' });
}

function schedule() {
  if (raf || typeof requestAnimationFrame !== 'function') return;
  raf = requestAnimationFrame(tick);
}

function tick(now) {
  raf = 0;
  if (!entries.size) return;
  const due = now - lastFrame >= 1000 / FPS;
  let anyAnimated = false;
  for (const [canvas, e] of entries) {
    if (!canvas.isConnected) { entries.delete(canvas); if (observer) observer.unobserve(canvas); continue; }
    if (!e.visible) continue;
    const animate = e.animate && !reducedMotion;
    if (e.dirty || (animate && due)) {
      const o = typeof e.opts === 'function' ? e.opts() : e.opts;
      try { drawShip(canvas, e.cls, { ...o, now, anims: animate || o.anims === true }); } catch (err) { entries.delete(canvas); if (typeof console !== 'undefined') console.warn('[shipCanvas]', err); }
      e.dirty = false;
    }
    if (animate) anyAnimated = true;
  }
  if (due) lastFrame = now;
  if (anyAnimated || [...entries.values()].some((e) => e.dirty)) schedule();
}

/**
 * Keep a canvas drawn (and animated) with a ship. Returns an unregister function.
 * @param {HTMLCanvasElement} canvas
 * @param {string} cls
 * @param {object|(() => object)} [opts] drawShip options (or a getter re-read every frame)
 * @param {{ animate?: boolean }} [o]
 */
export function animateShip(canvas, cls, opts = {}, o = {}) {
  ensureObserver();
  const e = { cls, opts, animate: o.animate !== false, visible: !observer, dirty: true };
  entries.set(canvas, e);
  if (observer) observer.observe(canvas);
  schedule();
  return () => { entries.delete(canvas); if (observer) observer.unobserve(canvas); };
}

/** Change the class drawn on a registered canvas. */
export function updateShip(canvas, cls, opts) {
  const e = entries.get(canvas);
  if (!e) return;
  e.cls = cls;
  if (opts !== undefined) e.opts = opts;
  e.dirty = true;
  schedule();
}

/** Redraw everything (e.g. after a DPR / theme change). */
export function redrawAll() {
  for (const e of entries.values()) e.dirty = true;
  schedule();
}

export function setShipAnimations(enabled) {
  reducedMotion = !enabled;
  redrawAll();
}

/** Number of registered canvases (debug). */
export function animatedCount() {
  return entries.size;
}
