// Canvas 2D battle renderer (docs/ARCHITECTURE.md §5.3).
//
//   const r = createRenderer(canvas, { start, myTeam, audio });
//   feed.onFrame(r.onFrame); requestAnimationFrame(function loop(t) { r.draw(t); requestAnimationFrame(loop); });
//
// Draw order: background → area effects → trails → ships (small → large) →
// projectiles → effects → in-world UI → vignette. One setTransform + drawImage
// per ship from the sprite cache; animated details only at LOD 2.

import { SHIPS, FACTIONS } from '/shared/catalog.js';
import { TEAM_COLORS, SNAPSHOT_EVERY, FLAG } from '/shared/constants.js';
import { createInterpolator } from './interpolator.js';
import { createCamera } from './camera.js';
import { createBackground } from './background.js';
import { createEffects } from './effects.js';
import {
  getDef, createSpriteCache, blitShip, drawLod0, drawShipDetails, pickBucket, lodFor, damageState, breatheScale,
} from './sprites.js';
import { palette, clamp, hash01, TAU } from './render/palette.js';

const DELAY_LOCAL = 120, DELAY_NET = 160;
const UI_FONT = '"Exo 2", "Segoe UI", system-ui, sans-serif';

/**
 * @typedef {Object} RendererOptions
 * @property {object} start        BattleStartInfo
 * @property {0|1|null} [myTeam]
 * @property {object} [audio]      duck-typed: consumeEvents(events, lookup), setCamera(cx, cy, halfWidth, aspect)
 * @property {boolean} [isLocal]   presentation delay 120 ms (true, default) or 160 ms (network)
 * @property {number} [delayMs]    override presentation delay
 * @property {{ planet?: boolean }} [background]  background options (planet allowed, default true)
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {RendererOptions} o
 */
export function createRenderer(canvas, o) {
  const start = o.start;
  const myTeam = o.myTeam ?? null;
  const audio = o.audio || null;
  const world = start.world || { w: 2800, h: 1575 };
  const tickRate = start.tickRate || 20;
  const tickMs = 1000 / tickRate;
  const snapshotEvery = start.snapshotEvery || SNAPSHOT_EVERY;
  const isLocal = o.isLocal ?? (start.isLocal !== false);
  const delayMs = o.delayMs ?? (isLocal ? DELAY_LOCAL : DELAY_NET);
  const ctx = canvas.getContext('2d', { alpha: false });
  let dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
  const options = { showNames: false, grid: false, reducedMotion: false, reducedEffects: false, highContrast: false, quality: 'auto' };
  const playerNames = new Map();
  for (const p of start.players || []) playerNames.set(p.id, p.name || p.id);

  // ---- static ship info ----
  /** @type {Map<number, object>} */
  const infos = new Map();
  function register(id, cls, team, owner) {
    const cat = SHIPS[cls];
    if (!cat) return null;
    const def = getDef(cls);
    const inf = {
      id, cls, cat, def, team, owner, faction: cat.faction, sizeClass: cat.sizeClass, size: def.size,
      hullType: cat.hullType, pal: palette(cat.faction, team, TEAM_COLORS), name: cat.name, ownerName: playerNames.get(owner) || owner,
    };
    infos.set(id, inf);
    return inf;
  }
  for (const s of start.ships || []) register(s.id, s.cls, s.team, s.owner);
  const info = (id) => infos.get(id) || null;
  /** Idempotent: register ships not yet known (spawned units from a reconnect start, or a frame's spawn events). */
  function registerShips(ships) {
    const fresh = new Set();
    for (const s of ships || []) {
      if (!s || infos.has(s.id)) continue;
      const inf = register(s.id, s.cls, s.team, s.owner);
      if (inf) fresh.add(inf.cls);
    }
    if (fresh.size) { try { sprites.warm([...fresh], [0.5, 0.71], [0, 1]); } catch (e) { /* ignore in exotic environments */ } }
    return fresh;
  }

  // ---- subsystems ----
  const interp = createInterpolator({
    tickMs, snapshotEvery, delayMs,
    newShip: (id) => { const inf = infos.get(id); return inf ? { cls: inf.cls, team: inf.team, owner: inf.owner, size: inf.size } : { size: 30 }; },
  });
  const view = (id) => interp.ships.get(id) || null;
  const camera = createCamera({ world, reducedMotion: options.reducedMotion, seed: typeof start.seed === 'number' ? start.seed : 1 });
  const background = createBackground({ seed: start.seed ?? 1, world, dpr, planet: o.background ? o.background.planet !== false : true });
  const effects = createEffects({ info, view, cam: camera, teamColors: TEAM_COLORS, seed: typeof start.seed === 'number' ? start.seed : 7 });
  const sprites = createSpriteCache({ dpr, teamColors: TEAM_COLORS });
  const spriteQuality = { anims: true, glow: true, reducedMotion: false };
  const backgroundOptions = { grid: false, quality: 1, reducedMotion: false, reducedEffects: false, highContrast: false };
  const shipPresentation = {};

  let phaseCb = null, endCb = null, phaseName = 'advance';
  effects.onPhase((name) => { phaseName = name; if (phaseCb) phaseCb(name); });
  effects.onEnd((winner, reason) => { if (endCb) endCb(winner, reason); });

  // ---- viewport / letterbox ----
  const vp = { x: 0, y: 0, w: 1280, h: 720, cw: 1280, ch: 720 };
  function resize() {
    const cw = Math.max(1, canvas.clientWidth || canvas.width || 1280), ch = Math.max(1, canvas.clientHeight || canvas.height || 720);
    dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    let w = cw, h = Math.round((cw * 9) / 16);
    if (h > ch) { h = ch; w = Math.round((ch * 16) / 9); }
    vp.cw = cw; vp.ch = ch; vp.w = w; vp.h = h; vp.x = Math.round((cw - w) / 2); vp.y = Math.round((ch - h) / 2);
    camera.setViewport(vp.x, vp.y, vp.w, vp.h);
    sprites.setDpr(dpr);
    background.setDpr(dpr);
  }
  resize();

  // ---- warm the sprite cache for the classes present ----
  {
    const present = new Set();
    for (const inf of infos.values()) present.add(inf.cls);
    try { sprites.warm([...present], [0.5, 0.71], [0, 1]); } catch (e) { /* ignore in exotic environments */ }
  }

  // ---- pointer interaction ----
  let hoverId = 0, hoverPx = 0, hoverPy = 0;
  let dragging = false, dragMoved = false, dragX = 0, dragY = 0, pointerDownAt = 0;
  const listeners = [];
  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); listeners.push([target, type, fn, opts]); }
  function pointerPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  function pickShip(px, py) {
    const w = camera.screenToWorld(px, py);
    let best = 0, bd = Infinity;
    for (const v of interp.ships.values()) {
      const inf = infos.get(v.id); if (!inf) continue;
      const r = Math.max(14 / camera.zoom, inf.size * 0.55);
      const d = Math.hypot(v.x - w.x, v.y - w.y);
      if (d < r && d < bd) { bd = d; best = v.id; }
    }
    return best;
  }
  if (typeof canvas.addEventListener === 'function') {
    on(canvas, 'pointermove', (ev) => {
      const p = pointerPos(ev); hoverPx = p.x; hoverPy = p.y;
      if (dragging) {
        const dx = p.x - dragX, dy = p.y - dragY;
        if (!dragMoved && Math.hypot(dx, dy) > 4) dragMoved = true;
        if (dragMoved) { camera.pan(dx, dy); dragX = p.x; dragY = p.y; }
      } else hoverId = pickShip(p.x, p.y);
    });
    on(canvas, 'pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const p = pointerPos(ev); dragging = true; dragMoved = false; dragX = p.x; dragY = p.y; pointerDownAt = performance.now();
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    });
    on(canvas, 'pointerup', (ev) => {
      if (!dragging) return;
      dragging = false;
      try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      if (!dragMoved && performance.now() - pointerDownAt < 400) {
        const p = pointerPos(ev);
        const id = pickShip(p.x, p.y);
        if (id && id !== camera.followId) camera.follow(id);
        else if (id && id === camera.followId) camera.follow(0);
        else if (!id && camera.mode === 'follow') camera.follow(0);
      }
    });
    on(canvas, 'pointerleave', () => { hoverId = 0; dragging = false; });
    on(canvas, 'wheel', (ev) => {
      ev.preventDefault();
      const p = pointerPos(ev);
      const f = Math.exp(-ev.deltaY * 0.0015);
      camera.zoomBy(clamp(f, 0.5, 2), p.x, p.y);
    }, { passive: false });
    on(canvas, 'dblclick', () => { camera.follow(0); camera.setMode('auto'); });
  }

  // ---- adaptive quality ----
  const perf = { drawMs: 8, frameMs: 16, goodFrames: 0, fps: 60, lastFpsT: 0, frames: 0, worst: 0, total: 0, passes: { sim: 0, bg: 0, area: 0, trails: 0, ships: 0, proj: 0, fx: 0, ui: 0 } };
  const pnow = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  const lap = (k, t) => { const n = pnow(); perf.passes[k] += (n - t - perf.passes[k]) * 0.1; return n; };
  function adapt() {
    if (options.quality !== 'auto' || options.reducedEffects) return;
    if (perf.total < 90) { perf.drawMs = Math.min(perf.drawMs, 12); return; } // ignore warm-up (sprite builds)
    const q = effects.quality;
    if (perf.drawMs > 18) {
      // require sustained slowness (not a GC / sprite-build spike) before degrading
      perf.badFrames = (perf.badFrames || 0) + 1;
      if (perf.badFrames >= 12) {
        perf.badFrames = 0;
        if (q.density > 0.25) { q.density = Math.max(0.25, q.density * 0.8); }
        if (q.density < 0.6) { q.trails = false; q.chroma = false; q.glow = false; q.anims = spriteQuality.anims = q.density > 0.35; }
      }
      perf.goodFrames = 0;
    } else if (perf.drawMs < 11) {
      perf.badFrames = 0;
      perf.goodFrames++;
      if (perf.goodFrames > 120) {
        perf.goodFrames = 0;
        q.density = Math.min(1, q.density * 1.15);
        if (q.density >= 0.6) { q.trails = true; q.chroma = true; q.glow = true; q.anims = spriteQuality.anims = true; }
      }
    } else perf.goodFrames = 0;
  }
  function applyQualityPreset(name) {
    const q = effects.quality;
    if (name === 'low') { q.density = 0.35; q.trails = false; q.chroma = false; q.anims = false; spriteQuality.anims = false; }
    else if (name === 'medium') { q.density = 0.7; q.trails = true; q.chroma = false; q.anims = true; spriteQuality.anims = true; }
    else { q.density = 1; q.trails = true; q.chroma = true; q.anims = true; spriteQuality.anims = true; }
    q.glow = name !== 'low';
    q.reducedEffects = options.reducedEffects;
    q.reducedMotion = options.reducedMotion || options.reducedEffects;
    if (options.reducedEffects) {
      q.density = 0.2; q.trails = false; q.chroma = false; q.glow = false;
      q.anims = spriteQuality.anims = false;
    }
  }

  function setOptions(opts = {}) {
    for (const key of ['showNames', 'grid', 'reducedMotion', 'reducedEffects', 'highContrast']) {
      if (typeof opts?.[key] === 'boolean') options[key] = opts[key];
    }
    if (['auto', 'low', 'medium', 'high'].includes(opts?.quality)) options.quality = opts.quality;
    camera.setReducedMotion(options.reducedMotion || options.reducedEffects);
    if (opts && ['quality', 'reducedMotion', 'reducedEffects'].some((key) => key in opts)) applyQualityPreset(options.quality);
  }

  // ---- audio lookup ----
  const lookup = (id) => {
    const inf = infos.get(id); const v = interp.ships.get(id);
    if (!inf) return null;
    return { cls: inf.cls, faction: inf.faction, sizeClass: inf.sizeClass, team: inf.team, x: v ? v.x : 0, y: v ? v.y : 0 };
  };

  // ---- draw ----
  let lastNow = -1;
  let order = [];
  let lastTick = -1;
  let lastExtrapolating = false;

  function drawShips(now, zoom) {
    const bucket = pickBucket(zoom);
    order.length = 0;
    for (const v of interp.ships.values()) order.push(v);
    order.sort((a, b) => (a.size - b.size) || (a.id - b.id));
    const q = effects.quality;
    spriteQuality.anims = q.anims;
    spriteQuality.glow = q.glow;
    spriteQuality.reducedMotion = q.reducedMotion;
    for (const v of order) {
      const inf = infos.get(v.id);
      if (!inf) continue;
      const size = inf.def.size;
      if (!camera.isVisible(v.x, v.y, size)) continue;
      const sx = camera.worldToScreenX(v.x), sy = camera.worldToScreenY(v.y);
      const st = effects.shipState(v, inf, now, myTeam, shipPresentation);
      const lod = lodFor(size * bucket);
      const cos = Math.cos(v.a), sin = Math.sin(v.a);
      if (lod === 0) {
        if (st.alpha !== 1) ctx.globalAlpha = st.alpha;
        drawLod0(ctx, inf.pal, sx, sy, cos, sin, size * zoom, dpr, inf.faction);
        ctx.globalAlpha = 1;
      } else {
        const spr = sprites.get(inf.def, inf.team, zoom, damageState(v.hp));
        const scaleY = (lod === 2 && spriteQuality.anims && !q.reducedMotion && inf.faction === 'vorrax') ? breatheScale(inf.def, v.id, now) : 1;
        blitShip(ctx, spr, sx, sy, cos, sin, zoom * st.spawnScale, dpr, st.alpha, scaleY);
        if (lod === 2 && st.spawnScale === 1) {
          if (st.alpha !== 1) ctx.globalAlpha = st.alpha;
          drawShipDetails(ctx, inf.def, inf.pal, sx, sy, cos, sin, zoom, dpr, st, now, spriteQuality);
          ctx.globalAlpha = 1;
        }
      }
      effects.drawShipOverlay(ctx, v, inf, sx, sy, zoom, dpr, now, lod);
    }
    // dying capitals: ghost sprites trembling before the main blast
    for (const g of effects.ghosts) {
      if (!g.def || !camera.isVisible(g.x, g.y, g.def.size)) continue;
      const u = (now - g.t0) / Math.max(1, g.until - g.t0);
      const sh = q.reducedMotion ? 0 : g.shake * zoom;
      const frame = Math.floor(now / 40);
      const sx = camera.worldToScreenX(g.x) + (hash01(g.id, frame, 1) - 0.5) * sh, sy = camera.worldToScreenY(g.y) + (hash01(g.id, frame, 2) - 0.5) * sh;
      const spr = sprites.get(g.def, g.team, zoom, 2);
      blitShip(ctx, spr, sx, sy, Math.cos(g.a), Math.sin(g.a), zoom, dpr, 1 - u * 0.4, 1);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawWorldUI(now, zoom) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${Math.max(10, Math.min(13, 11 * Math.sqrt(zoom)))}px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const manyShips = interp.ships.size > 150;
    for (const v of order) {
      const inf = infos.get(v.id); if (!inf) continue;
      const size = inf.def.size;
      if (!camera.isVisible(v.x, v.y, size)) continue;
      const hovered = v.id === hoverId, followed = v.id === camera.followId;
      const big = size >= 60;
      const showBar = big || hovered || followed || (size >= 30 && v.hp < 500 && !manyShips);
      const sx = camera.worldToScreenX(v.x), sy = camera.worldToScreenY(v.y);
      const top = sy - size * 0.55 * zoom - 6;
      if (options.highContrast) {
        // Different silhouettes identify teams even when their colors are hard to distinguish.
        const x = sx, y = sy + size * 0.55 * zoom + 5, r = 3;
        ctx.fillStyle = inf.team === 0 ? '#b8efff' : '#ffe09a';
        ctx.strokeStyle = '#05070c'; ctx.lineWidth = 2;
        ctx.beginPath();
        if (inf.team === 0) ctx.rect(x - r, y - r, r * 2, r * 2);
        else { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y); ctx.lineTo(x, y + r + 1); ctx.lineTo(x - r - 1, y); ctx.closePath(); }
        ctx.stroke(); ctx.fill();
      }
      if (followed) {
        ctx.strokeStyle = inf.pal.team; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
        ctx.setLineDash([4, 4]); ctx.lineDashOffset = effects.quality.reducedMotion ? 0 : -now * 0.02;
        ctx.beginPath(); ctx.arc(sx, sy, size * 0.6 * zoom + 4, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (showBar) {
        const w = clamp(size * zoom * 0.8, 22, 120), h = big || hovered ? 4 : 2;
        const x0 = sx - w / 2, y0 = top - h;
        const hp = v.hp / 1000;
        ctx.fillStyle = 'rgba(5,7,12,0.7)'; ctx.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
        ctx.fillStyle = hp < 0.25 ? '#ff4d5e' : hp < 0.5 ? '#ffb347' : '#d9e6f2';
        ctx.fillRect(x0, y0, w * hp, h);
        if (inf.cat.shield && inf.cat.shield.cap > 0) {
          ctx.fillStyle = 'rgba(5,7,12,0.7)'; ctx.fillRect(x0 - 1, y0 - 4, w + 2, 3);
          ctx.fillStyle = inf.pal.team; ctx.fillRect(x0, y0 - 3, w * (v.sh / 1000), 2);
        }
      } else if (size >= 30 && v.hp < 500) {
        ctx.fillStyle = v.hp < 250 ? '#ff4d5e' : '#ffb347';
        ctx.fillRect(sx - 4, top, 8 * (v.hp / 1000) + 2, 2);
      }
      if ((options.showNames && (!manyShips || big)) || hovered) {
        ctx.fillStyle = hovered ? '#ffffff' : 'rgba(217,230,242,0.85)';
        ctx.fillText(`${inf.name} · ${inf.ownerName}`, sx, top - (showBar ? 8 : 2));
      }
    }
    // hover tooltip
    if (hoverId) {
      const v = interp.ships.get(hoverId); const inf = infos.get(hoverId);
      if (v && inf) {
        const sx = clamp(hoverPx + 14, vp.x + 4, vp.x + vp.w - 190), sy = clamp(hoverPy + 14, vp.y + 4, vp.y + vp.h - 70);
        const w = 184, h = 62;
        ctx.fillStyle = 'rgba(10,16,30,0.86)'; ctx.fillRect(sx, sy, w, h);
        ctx.strokeStyle = inf.pal.team; ctx.lineWidth = 1; ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = '#d9e6f2'; ctx.font = `600 12px ${UI_FONT}`;
        ctx.fillText(inf.name, sx + 8, sy + 6);
        ctx.fillStyle = '#7f93a8'; ctx.font = `11px ${UI_FONT}`;
        ctx.fillText(`${FACTIONS[inf.faction]?.short || inf.faction} · ${inf.ownerName}`, sx + 8, sy + 22);
        const bx = sx + 8, bw = w - 16;
        ctx.fillStyle = '#0e1626'; ctx.fillRect(bx, sy + 40, bw, 5);
        ctx.fillStyle = v.hp < 250 ? '#ff4d5e' : v.hp < 500 ? '#ffb347' : '#8a96a6'; ctx.fillRect(bx, sy + 40, bw * v.hp / 1000, 5);
        if (inf.cat.shield.cap > 0) { ctx.fillStyle = '#0e1626'; ctx.fillRect(bx, sy + 48, bw, 4); ctx.fillStyle = inf.pal.team; ctx.fillRect(bx, sy + 48, bw * v.sh / 1000, 4); }
        const flags = [];
        if (v.flags & FLAG.UNTARGETABLE) flags.push('intocável'); if (v.flags & FLAG.DISRUPTED) flags.push('interrompida'); if (v.flags & FLAG.BOOSTED) flags.push('impulso'); if (v.flags & FLAG.RETREATING) flags.push('recuando'); if (v.flags & FLAG.CASTING) flags.push('carregando'); if (v.flags & FLAG.LATCHED) flags.push('agarrada');
        if (flags.length) { ctx.fillStyle = '#ffb347'; ctx.textAlign = 'right'; ctx.fillText(flags.join(', '), sx + w - 8, sy + 22); }
      }
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function draw(now) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : now);
    const dt = lastNow < 0 ? 0.016 : clamp((now - lastNow) / 1000, 0, 0.1);
    perf.frameMs = lastNow < 0 ? 16 : Math.min(200, now - lastNow);
    lastNow = now;
    if (canvas.clientWidth && (canvas.clientWidth !== vp.cw || canvas.clientHeight !== vp.ch)) resize();

    // 1. presentation state + events
    const s = interp.sample(now);
    lastTick = s.tick; lastExtrapolating = s.extrapolating;
    if (s.events.length) {
      for (const e of s.events) if (e[0] === 'spawn') register(e[1], e[2], e[3], e[4]);
      effects.handleEvents(s.events, now);
      if (audio && typeof audio.consumeEvents === 'function') { try { audio.consumeEvents(s.events, lookup); } catch (e) { /* audio must never break rendering */ } }
    }
    camera.update(dt, interp.ships, now);
    effects.update(dt, now, interp.ships);
    if (audio && typeof audio.setCamera === 'function') { try { audio.setCamera(camera.x, camera.y, camera.halfWidth(), vp.w / vp.h); } catch (e) { /* ignore */ } }
    const zoom = camera.zoom;

    // 2. clear + clip to the 16:9 viewport
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (vp.x > 0 || vp.y > 0) { ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, vp.cw, vp.ch); }
    ctx.save();
    ctx.beginPath(); ctx.rect(vp.x, vp.y, vp.w, vp.h); ctx.clip();

    // 3. passes (restore is in a finally: a throwing pass must not leave the save stack growing every frame)
    let tp = lap('sim', t0);
    try {
      backgroundOptions.grid = options.grid;
      backgroundOptions.quality = effects.quality.density;
      backgroundOptions.reducedMotion = effects.quality.reducedMotion;
      backgroundOptions.reducedEffects = effects.quality.reducedEffects;
      backgroundOptions.highContrast = options.highContrast;
      background.draw(ctx, camera, now, backgroundOptions);
      tp = lap('bg', tp);
      effects.drawArea(ctx, camera, dpr, now);
      tp = lap('area', tp);
      effects.drawTrails(ctx, camera, dpr, now);
      tp = lap('trails', tp);
      drawShips(now, zoom);
      tp = lap('ships', tp);
      effects.drawProjectiles(ctx, camera, dpr, now);
      tp = lap('proj', tp);
      effects.drawEffects(ctx, camera, dpr, now);
      tp = lap('fx', tp);
      drawWorldUI(now, zoom);
    } finally {
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    lap('ui', tp);
    background.drawVignette(ctx, vp.x, vp.y, vp.w, vp.h, effects.suddenDeath ? 0.6 : 0);

    // 4. perf + adaptive quality
    const drawMs = (typeof performance !== 'undefined' ? performance.now() : now) - t0;
    perf.drawMs += (Math.min(drawMs, perf.drawMs * 3 + 2) - perf.drawMs) * 0.1; // spike-clipped EMA
    perf.worst = Math.max(perf.worst * 0.99, drawMs);
    perf.frames++; perf.total++;
    if (now - perf.lastFpsT > 1000) { perf.fps = perf.frames * 1000 / Math.max(1, now - perf.lastFpsT); perf.frames = 0; perf.lastFpsT = now; }
    adapt();
  }

  const cameraApi = {
    follow: (id) => camera.follow(id),
    setMode: (m) => camera.setMode(m),
    zoomBy: (f) => camera.zoomBy(f, vp.x + vp.w / 2, vp.y + vp.h / 2),
    pan: (dx, dy) => camera.pan(dx, dy),
    get mode() { return camera.mode; },
    get zoom() { return camera.zoom; },
    get x() { return camera.x; },
    get y() { return camera.y; },
    get followId() { return camera.followId; },
    jumpTo: (x, y, z) => camera.jumpTo(x, y, z),
    addTrauma: (t) => camera.addTrauma(t),
    raw: camera,
  };

  return {
    /** Push a frame { k, s, e, at } from the feed. */
    onFrame(frame) {
      if (frame.at === undefined) frame = { ...frame, at: typeof performance !== 'undefined' ? performance.now() : lastNow };
      // Register spawned units before the interpolator creates their views, so
      // newShip() finds cls/team/size for drones, broods and larvae.
      if (frame.e && frame.e.length) {
        for (const e of frame.e) if (e && e[0] === 'spawn' && !infos.has(e[1])) registerShips([{ id: e[1], cls: e[2], team: e[3], owner: e[4] }]);
      }
      interp.push(frame);
    },
    /**
     * Reconnect to the same battle: `start.ships` carries the initial ships plus the
     * units spawned meanwhile, `start.dead` the ids destroyed so far. Idempotent;
     * resets the interpolator so the next frame snaps the presentation clock.
     */
    resync(start) {
      registerShips((start && start.ships) || []);
      interp.reset();
    },
    registerShips,
    draw,
    resize,
    /** Presentation only; never changes simulation snapshots or random state. */
    setOptions,
    updateOptions: setOptions,
    getOptions() { return { ...options }; },
    get options() { return { ...options }; },
    /** @returns {{ ships: Map<number, object>, tick: number }} */
    getView() { return { ships: interp.ships, tick: lastTick }; },
    camera: cameraApi,
    /** Static info for a ship id (cls, team, owner, faction, size...). */
    info,
    get hoverId() { return hoverId; },
    get phase() { return phaseName; },
    onPhase(cb) { phaseCb = cb; },
    onEnd(cb) { endCb = cb; },
    /** Performance / debug counters. */
    stats() { return { fps: perf.fps, drawMs: perf.drawMs, frameMs: perf.frameMs, worstMs: perf.worst, passes: { ...perf.passes }, ships: interp.ships.size, sprites: sprites.size, spriteBuilds: sprites.builds, density: effects.quality.density, trails: effects.quality.trails, tick: lastTick, ticksPerSec: interp.ticksPerSec, extrapolating: lastExtrapolating, ...effects.stats() }; },
    effects,
    interpolator: interp,
    sprites,
    get viewport() { return { ...vp }; },
    dispose() {
      for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
      listeners.length = 0;
      effects.clear(); sprites.clear(); background.dispose(); interp.reset(); infos.clear();
    },
  };
}
