// Battle camera: auto fit-to-fleets biased toward the action, exponential
// smoothing, zoom limits, trauma-based shake, follow(id), free mode (wheel /
// drag) that stays until the player returns to auto, world <-> screen helpers.
//
// Screen coordinates are CSS pixels inside the 16:9 letterboxed viewport
// (vx, vy, vw, vh) set by the renderer. Pure module (no DOM).

import { clamp, noise1, hash01 } from './render/palette.js';

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2.0;

/**
 * @param {{ world: {w:number,h:number}, zoomMin?: number, zoomMax?: number, reducedMotion?: boolean, seed?: number }} o
 */
export function createCamera(o) {
  const world = o.world;
  const zoomMin = o.zoomMin ?? ZOOM_MIN, zoomMax = o.zoomMax ?? ZOOM_MAX;
  let reducedMotion = !!o.reducedMotion;
  const seed = (o.seed ?? 1) | 0;

  const cam = {
    x: world.w / 2, y: world.h / 2, zoom: 0.5,
    tx: world.w / 2, ty: world.h / 2, tzoom: 0.5,
    vx: 0, vy: 0, vw: 1280, vh: 720,
    shakeX: 0, shakeY: 0, trauma: 0,
    mode: 'auto', followId: 0,
    // action tracking
    action: new Map(),        // id -> weight (recent damage, decays)
    lastDeath: null,          // { x, y, t }
    bbox: { x0: 0, y0: 0, x1: world.w, y1: world.h },
  };
  let initialized = false;
  let lastNow = 0;

  function applyLimits() {
    cam.zoom = clamp(cam.zoom, zoomMin * 0.9, zoomMax * 1.1);
    const halfW = cam.vw / 2 / cam.zoom, halfH = cam.vh / 2 / cam.zoom;
    const m = 100;
    if (halfW * 2 >= world.w + 2 * m) cam.x = world.w / 2;
    else cam.x = clamp(cam.x, halfW - m, world.w - halfW + m);
    if (halfH * 2 >= world.h + 2 * m) cam.y = world.h / 2;
    else cam.y = clamp(cam.y, halfH - m, world.h - halfH + m);
  }

  function autoTarget(ships, now) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let cxw = 0, cyw = 0, wsum = 0;
    let n = 0;
    const teams = [0, 0];
    for (const v of ships.values()) {
      const r = (v.size || 30) * 0.5;
      if (v.x - r < x0) x0 = v.x - r; if (v.x + r > x1) x1 = v.x + r;
      if (v.y - r < y0) y0 = v.y - r; if (v.y + r > y1) y1 = v.y + r;
      const recent = cam.action.get(v.id) || 0;
      const w = (v.size || 30) * (1 + 4 * recent);
      cxw += v.x * w; cyw += v.y * w; wsum += w;
      n++;
      if (v.team === 0 || v.team === 1) teams[v.team]++;
    }
    if (n === 0) {
      if (cam.lastDeath && now - cam.lastDeath.t < 3000) { cam.tx = cam.lastDeath.x; cam.ty = cam.lastDeath.y; cam.tzoom = Math.max(cam.tzoom, 0.8); }
      return;
    }
    if ((teams[0] === 0 || teams[1] === 0) && cam.lastDeath && now - cam.lastDeath.t < 2000) {
      const d = cam.lastDeath;
      if (d.x < x0) x0 = d.x; if (d.x > x1) x1 = d.x; if (d.y < y0) y0 = d.y; if (d.y > y1) y1 = d.y;
    }
    const pad = 120;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    cam.bbox.x0 = x0; cam.bbox.y0 = y0; cam.bbox.x1 = x1; cam.bbox.y1 = y1;
    const bw = Math.max(200, x1 - x0), bh = Math.max(120, y1 - y0);
    cam.tzoom = clamp(Math.min(cam.vw / bw, cam.vh / bh), zoomMin, zoomMax);
    const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
    const acx = wsum > 0 ? cxw / wsum : bcx, acy = wsum > 0 ? cyw / wsum : bcy;
    // mostly bbox-centered, biased toward the action; keep the bbox inside the view when possible
    let tx = bcx + (acx - bcx) * 0.35, ty = bcy + (acy - bcy) * 0.35;
    const halfW = cam.vw / 2 / cam.tzoom, halfH = cam.vh / 2 / cam.tzoom;
    if (bw <= halfW * 2) tx = clamp(tx, x1 - halfW, x0 + halfW);
    if (bh <= halfH * 2) ty = clamp(ty, y1 - halfH, y0 + halfH);
    cam.tx = tx; cam.ty = ty;
  }

  return {
    get x() { return cam.x; }, get y() { return cam.y; }, get zoom() { return cam.zoom; },
    get mode() { return cam.mode; }, get followId() { return cam.followId; },
    get shakeX() { return cam.shakeX; }, get shakeY() { return cam.shakeY; },
    get trauma() { return cam.trauma; },
    get vx() { return cam.vx; }, get vy() { return cam.vy; }, get vw() { return cam.vw; }, get vh() { return cam.vh; },
    get bbox() { return cam.bbox; },
    world,

    /** Set the viewport rect (CSS px) the camera renders into. */
    setViewport(vx, vy, vw, vh) {
      cam.vx = vx; cam.vy = vy; cam.vw = Math.max(1, vw); cam.vh = Math.max(1, vh);
    },
    setReducedMotion(b) { reducedMotion = !!b; },

    /**
     * Advance the camera.
     * @param {number} dt seconds
     * @param {Map<number, object>} ships interpolated ship views (need x, y, size, team, id)
     * @param {number} now ms
     */
    update(dt, ships, now) {
      lastNow = now;
      dt = clamp(dt, 0, 0.1);
      // decay action weights
      if (cam.action.size) {
        const f = Math.exp(-dt / 1.5);
        for (const [id, w] of cam.action) { const nw = w * f; if (nw < 0.01) cam.action.delete(id); else cam.action.set(id, nw); }
      }
      if (cam.mode === 'follow') {
        const v = ships.get(cam.followId);
        if (v) { cam.tx = v.x; cam.ty = v.y; }
        else cam.mode = 'auto';
      }
      if (cam.mode === 'auto') autoTarget(ships, now);
      if (!initialized) {
        cam.x = cam.tx; cam.y = cam.ty; cam.zoom = cam.tzoom; initialized = true;
      } else {
        const kp = 1 - Math.exp(-dt / 0.45), kz = 1 - Math.exp(-dt / 0.9);
        cam.x += (cam.tx - cam.x) * kp; cam.y += (cam.ty - cam.y) * kp;
        cam.zoom += (cam.tzoom - cam.zoom) * (cam.mode === 'free' ? 1 - Math.exp(-dt / 0.15) : kz);
      }
      applyLimits();
      // trauma shake (screen px)
      cam.trauma = Math.max(0, cam.trauma - dt * 1.2);
      const s = cam.trauma * cam.trauma * (reducedMotion ? 0.5 : 1);
      if (s > 0.0001) {
        const t = now / 1000;
        cam.shakeX = s * 14 * noise1(t * 25, seed);
        cam.shakeY = s * 14 * noise1(t * 25, seed + 7);
      } else { cam.shakeX = 0; cam.shakeY = 0; }
    },

    /** Center on a ship and keep following it. */
    follow(id) { cam.followId = id | 0; cam.mode = id ? 'follow' : 'auto'; },
    /** @param {'auto'|'free'|'follow'} m */
    setMode(m) {
      if (m === 'follow' && !cam.followId) m = 'auto';
      cam.mode = m;
      if (m === 'auto') { cam.action.clear(); }
    },
    /** Multiply the zoom (free mode), keeping the point under (px,py) fixed. */
    zoomBy(f, px, py) {
      const nz = clamp(cam.tzoom * f, zoomMin, zoomMax);
      if (px !== undefined && py !== undefined) {
        const wx = (px - cam.vx - cam.vw / 2) / cam.zoom + cam.x, wy = (py - cam.vy - cam.vh / 2) / cam.zoom + cam.y;
        cam.tx = wx - (px - cam.vx - cam.vw / 2) / nz; cam.ty = wy - (py - cam.vy - cam.vh / 2) / nz;
        if (cam.mode === 'follow') { cam.tx = cam.x; cam.ty = cam.y; }
      }
      cam.tzoom = nz;
      if (cam.mode !== 'follow') cam.mode = 'free';
    },
    /** Pan by screen pixels (free mode). */
    pan(dx, dy) {
      cam.tx -= dx / cam.zoom; cam.ty -= dy / cam.zoom;
      cam.x = cam.tx; cam.y = cam.ty;
      cam.mode = 'free';
      applyLimits(); cam.tx = cam.x; cam.ty = cam.y;
    },
    /** Add screen shake (0..1). */
    addTrauma(t) { cam.trauma = Math.min(1, cam.trauma + t); },
    /** Register damage activity on a ship (bias for the auto camera). */
    noteAction(id, frac) { cam.action.set(id, Math.min(3, (cam.action.get(id) || 0) + frac)); },
    noteDeath(x, y, now) { cam.lastDeath = { x, y, t: now }; },

    worldToScreenX(x) { return (x - cam.x) * cam.zoom + cam.vx + cam.vw / 2 + cam.shakeX; },
    worldToScreenY(y) { return (y - cam.y) * cam.zoom + cam.vy + cam.vh / 2 + cam.shakeY; },
    screenToWorld(px, py) {
      return { x: (px - cam.vx - cam.vw / 2 - cam.shakeX) / cam.zoom + cam.x, y: (py - cam.vy - cam.vh / 2 - cam.shakeY) / cam.zoom + cam.y };
    },
    /** Visible world rect (with margin in world units). */
    visibleRect(margin = 0) {
      const hw = cam.vw / 2 / cam.zoom + margin, hh = cam.vh / 2 / cam.zoom + margin;
      return { x0: cam.x - hw, y0: cam.y - hh, x1: cam.x + hw, y1: cam.y + hh };
    },
    isVisible(x, y, r) {
      const hw = cam.vw / 2 / cam.zoom, hh = cam.vh / 2 / cam.zoom;
      return x + r >= cam.x - hw && x - r <= cam.x + hw && y + r >= cam.y - hh && y - r <= cam.y + hh;
    },
    /** Half width of the view in world units (for audio). */
    halfWidth() { return cam.vw / 2 / cam.zoom; },
    /** Jump instantly to a pose (demo / tests). */
    jumpTo(x, y, zoom) {
      cam.x = cam.tx = x; cam.y = cam.ty = y; cam.zoom = cam.tzoom = clamp(zoom, zoomMin, zoomMax); initialized = true; applyLimits();
    },
    seedNoise: hash01(seed),
  };
}
