// Battle background: cached parallax starfield tiles, procedural nebula from
// the battle seed, optional planet, occasional comet, vignette and the
// optional tactical grid. Everything is deterministic from the seed.

import { makeCanvas, getGlow } from './render/glow.js';
import { hashStr, hash01, makeRand, rgba, mix, TAU, clamp } from './render/palette.js';

const NEB_PALETTES = [
  ['#1a1040', '#0b2a4a'], ['#2a0f2e', '#102a33'], ['#0e2a1a', '#0a1430'], ['#2a1a10', '#0e1a3a'], ['#101a3a', '#2a1030'],
];
const STAR_COLORS = ['#ffffff', '#cfe8ff', '#ffe9c0', '#ffffff', '#ffd9c0'];

/**
 * @param {{ seed: number|string, world: {w:number,h:number}, dpr?: number, planet?: boolean }} o
 *   planet: allow a planet (default true; 55% of seeds get one)
 */
export function createBackground(o) {
  const seed = hashStr(String(o.seed ?? 1));
  const world = o.world;
  let dpr = o.dpr || 1;
  const rnd = makeRand(seed);

  // ---- nebula tile (world-anchored, seamless) ----
  const NEB_T = 4096;         // world units per tile
  const NEB_PX = 512;
  let nebula = null;
  function buildNebula() {
    const cv = makeCanvas(NEB_PX, NEB_PX);
    const g = cv.getContext('2d');
    const s = NEB_PX / NEB_T;
    const pal = NEB_PALETTES[seed % NEB_PALETTES.length];
    const r = makeRand(seed ^ 0xabc);
    g.fillStyle = '#05070c'; g.fillRect(0, 0, NEB_PX, NEB_PX);
    g.globalCompositeOperation = 'lighter';
    const blobs = 7 + r.int(0, 3);
    const drawBlob = (x, y, rx, ry, rot, col, a) => {
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const bx = x + ox * NEB_T, by = y + oy * NEB_T;
        if (bx + rx < 0 || bx - rx > NEB_T || by + ry < 0 || by - ry > NEB_T) continue;
        g.save();
        g.translate(bx * s, by * s); g.rotate(rot); g.scale(1, ry / rx);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx * s);
        gr.addColorStop(0, rgba(col, a)); gr.addColorStop(0.5, rgba(col, a * 0.45)); gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx * s, 0, TAU); g.fill();
        g.restore();
      }
    };
    for (let i = 0; i < blobs; i++) {
      const col = pal[i % 2];
      drawBlob(r.range(0, NEB_T), r.range(0, NEB_T), r.range(500, 1300), r.range(300, 900), r.range(0, TAU), col, r.range(0.14, 0.26));
    }
    // cheap "noise": many faint circles
    for (let i = 0; i < 320; i++) {
      const col = pal[i % 2];
      drawBlob(r.range(0, NEB_T), r.range(0, NEB_T), r.range(60, 200), r.range(60, 200), 0, mix(col, '#ffffff', 0.2), 0.035);
    }
    // Fine luminous dust lanes, baked once; wrapping uses the same seamless blobs.
    for (let lane = 0; lane < 2; lane++) {
      const y0 = r.range(0, NEB_T), phase = r.range(0, TAU);
      const col = mix(pal[lane], lane ? '#9fc6de' : '#b29adb', 0.24);
      for (let i = 0; i < 24; i++) {
        const x = i * NEB_T / 24, a = x / NEB_T * TAU + phase;
        drawBlob(x, (y0 + Math.sin(a) * 360 + NEB_T) % NEB_T, 250, 58, Math.cos(a) * 0.5, col, 0.16);
      }
    }
    g.globalCompositeOperation = 'source-over';
    return cv;
  }

  // ---- star layers ----
  const STAR_T = 1024;
  const far = [];   // {x,y,r,a,c} in tile units
  const mid = [];
  const near = [];
  {
    const r = makeRand(seed ^ 0x51a7);
    for (let i = 0; i < 900; i++) far.push({ x: r.range(0, STAR_T), y: r.range(0, STAR_T), r: r.range(0.5, 1.1), a: r.range(0.35, 0.8), c: r.pick(STAR_COLORS) });
    for (let i = 0; i < 330; i++) mid.push({ x: r.range(0, STAR_T), y: r.range(0, STAR_T), r: r.range(0.9, 1.6), a: r.range(0.5, 0.95), c: r.pick(STAR_COLORS), cross: i < 18, tw: i >= 18 && i < 30 ? r.range(1, 3) : 0, ph: r.range(0, TAU) });
    for (let i = 0; i < 70; i++) near.push({ x: r.range(0, STAR_T), y: r.range(0, STAR_T), r: r.range(1.4, 2.2), a: r.range(0.6, 1), c: r.pick(STAR_COLORS) });
  }
  const farTiles = new Map(); // band -> canvas
  function farTile(band) {
    let cv = farTiles.get(band);
    if (cv) return cv;
    const s = band === 0 ? 1 : 2; // px per world unit
    const px = STAR_T * s;
    cv = makeCanvas(px, px);
    const g = cv.getContext('2d');
    for (const st of far) {
      g.fillStyle = st.c; g.globalAlpha = st.a;
      const rr = Math.max(0.6, st.r * (band === 0 ? 1.1 : s * 0.8));
      g.beginPath(); g.arc(st.x * s, st.y * s, rr, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    farTiles.set(band, cv);
    return cv;
  }

  // ---- planet ----
  let planet = null;
  if (o.planet !== false && rnd() < 0.55) {
    const r = makeRand(seed ^ 0x9e3779b9);
    const radius = r.range(320, 560);
    const corner = r.int(0, 3);
    planet = {
      x: (corner & 1 ? 0.9 : 0.1) * world.w + r.range(-150, 150),
      y: (corner & 2 ? 0.88 : 0.12) * world.h + r.range(-100, 100),
      radius, gas: r() < 0.6, ring: r() < 0.4, lightA: r.range(0, TAU),
      hue: r.pick(['#4a6cb0', '#b07a4a', '#7a4ab0', '#4aa890', '#b04a5a', '#6a7090']),
      canvas: null,
    };
  }
  function buildPlanet(p) {
    const S = 1024, R = S * 0.4, cx = S / 2, cy = S / 2;
    const cv = makeCanvas(S, S);
    const g = cv.getContext('2d');
    const r = makeRand(seed ^ 0x77);
    // atmosphere glow
    const atm = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.22);
    atm.addColorStop(0, rgba(p.hue, 0.5)); atm.addColorStop(1, rgba(p.hue, 0));
    g.fillStyle = atm; g.beginPath(); g.arc(cx, cy, R * 1.22, 0, TAU); g.fill();
    // body
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    // soft antialiased limb: drawn below everything inside the clip
    g.fillStyle = '#03040a'; g.fillRect(0, 0, S, S);
    const lx = cx + Math.cos(p.lightA) * R * 0.6, ly = cy + Math.sin(p.lightA) * R * 0.6;
    const body = g.createRadialGradient(lx, ly, R * 0.1, cx, cy, R * 1.05);
    body.addColorStop(0, mix(p.hue, '#ffffff', 0.15)); body.addColorStop(0.45, mix(p.hue, '#000000', 0.25)); body.addColorStop(0.85, mix(p.hue, '#000000', 0.75)); body.addColorStop(1, '#03040a');
    g.fillStyle = body; g.fillRect(0, 0, S, S);
    if (p.gas) {
      g.globalAlpha = 0.07;
      for (let i = 0; i < 6; i++) {
        const y = cy + (i - 2.5) * R * 0.3 + r.range(-10, 10);
        g.strokeStyle = i % 2 ? '#ffffff' : '#000000'; g.lineWidth = r.range(8, 26);
        g.beginPath(); g.moveTo(cx - R, y);
        g.bezierCurveTo(cx - R * 0.4, y + r.range(-25, 25), cx + R * 0.4, y + r.range(-25, 25), cx + R, y + r.range(-10, 10));
        g.stroke();
      }
      g.globalAlpha = 1;
    } else {
      g.globalAlpha = 0.25;
      for (let i = 0; i < 40; i++) {
        const a = r.range(0, TAU), d = r.range(0, R * 0.95), rr = r.range(4, 22);
        g.fillStyle = i % 3 ? '#000000' : '#ffffff';
        g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    // terminator shading
    const term = g.createRadialGradient(lx, ly, R * 0.3, lx, ly, R * 1.9);
    term.addColorStop(0, 'rgba(0,0,0,0)'); term.addColorStop(0.6, 'rgba(0,0,0,0.25)'); term.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = term; g.fillRect(0, 0, S, S);
    g.restore();
    g.strokeStyle = 'rgba(3,4,10,0.9)'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R + 1, 0, TAU); g.stroke();
    if (p.ring) {
      g.strokeStyle = rgba(mix(p.hue, '#ffffff', 0.5), 0.22); g.lineWidth = 16;
      g.beginPath(); g.ellipse(cx, cy, R * 1.5, R * 0.42, p.lightA * 0.3, 0, TAU); g.stroke();
      g.strokeStyle = rgba(mix(p.hue, '#ffffff', 0.7), 0.16); g.lineWidth = 4;
      g.beginPath(); g.ellipse(cx, cy, R * 1.68, R * 0.47, p.lightA * 0.3, 0, TAU); g.stroke();
    }
    return cv;
  }

  // ---- comet ----
  let comet = null, nextComet = 0;
  const cometRnd = makeRand(seed ^ 0xc0e7);

  // ---- vignette ----
  let vignette = null, vigW = 0, vigH = 0;

  function drawTiled(ctx, cv, tileU, parallax, cam, alpha = 1) {
    const z = cam.zoom;
    const lx = cam.x * parallax, ly = cam.y * parallax;
    const hw = cam.vw / 2 / z, hh = cam.vh / 2 / z;
    const i0 = Math.floor((lx - hw) / tileU), i1 = Math.floor((lx + hw) / tileU);
    const j0 = Math.floor((ly - hh) / tileU), j1 = Math.floor((ly + hh) / tileU);
    const ox = cam.vx + cam.vw / 2 + cam.shakeX, oy = cam.vy + cam.vh / 2 + cam.shakeY;
    const size = tileU * z;
    ctx.globalAlpha = alpha;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      ctx.drawImage(cv, (i * tileU - lx) * z + ox, (j * tileU - ly) * z + oy, size + 0.5, size + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  function drawStarsDirect(ctx, list, parallax, cam, now, boost) {
    const z = cam.zoom;
    const lx = cam.x * parallax, ly = cam.y * parallax;
    const hw = cam.vw / 2 / z, hh = cam.vh / 2 / z;
    const i0 = Math.floor((lx - hw) / STAR_T), i1 = Math.floor((lx + hw) / STAR_T);
    const j0 = Math.floor((ly - hh) / STAR_T), j1 = Math.floor((ly + hh) / STAR_T);
    const ox = cam.vx + cam.vw / 2 + cam.shakeX - lx * z, oy = cam.vy + cam.vh / 2 + cam.shakeY - ly * z;
    const t = now / 1000;
    const x0 = lx - hw, x1 = lx + hw, y0 = ly - hh, y1 = ly + hh;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const tx = i * STAR_T, ty = j * STAR_T;
      for (const st of list) {
        const wx = tx + st.x, wy = ty + st.y;
        if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
        const sx = wx * z + ox, sy = wy * z + oy;
        let a = st.a, r = st.r * boost;
        if (st.tw) { a *= 0.55 + 0.45 * Math.sin(t * st.tw + st.ph); r *= 1 + 0.3 * Math.sin(t * st.tw + st.ph); }
        ctx.globalAlpha = a; ctx.fillStyle = st.c;
        ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
        if (st.cross) {
          ctx.globalAlpha = a * 0.35;
          const l = 5 * boost;
          ctx.fillRect(sx - l, sy - 0.4, l * 2, 0.8); ctx.fillRect(sx - 0.4, sy - l, 0.8, l * 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    setDpr(v) { dpr = v; },
    get planet() { return planet; },
    /**
     * Draw everything behind the ships. Base transform must be [dpr,0,0,dpr,0,0];
     * caller clips to the viewport.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} cam camera
     * @param {number} now ms
     * @param {{ grid?: boolean, quality?: number, reducedMotion?: boolean, highContrast?: boolean }} opts
     */
    draw(ctx, cam, now, opts = {}) {
      const z = cam.zoom;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05070c';
      ctx.fillRect(cam.vx, cam.vy, cam.vw, cam.vh);
      // nebula
      if (!nebula) nebula = buildNebula();
      drawTiled(ctx, nebula, NEB_T, 0.15, cam, opts.highContrast ? 0.25 : 1);
      // planet (behind stars? no: stars are far; planet is between far and mid)
      // far stars (cached tile, band by zoom)
      const band = z < 0.9 ? 0 : 1;
      drawTiled(ctx, farTile(band), STAR_T, 0.3, cam, opts.highContrast ? 0.25 : z < 0.5 ? 0.8 : 1);
      if (planet) {
        if (!planet.canvas) planet.canvas = buildPlanet(planet);
        // parallax 0.2, anchored so that at the world center the offset is zero
        const p = 0.2;
        const wx = planet.x - (cam.x - world.w / 2) * (1 - p);
        const wy = planet.y - (cam.y - world.h / 2) * (1 - p);
        const sx = cam.worldToScreenX(wx), sy = cam.worldToScreenY(wy);
        const R = planet.radius * z * 1.25; // canvas radius includes atmosphere/rings (0.4*S body)
        const S = R / 0.4;
        if (sx + S / 2 > cam.vx - 50 && sx - S / 2 < cam.vx + cam.vw + 50 && sy + S / 2 > cam.vy - 50 && sy - S / 2 < cam.vy + cam.vh + 50) {
          ctx.globalAlpha = opts.highContrast ? 0.25 : 1;
          ctx.drawImage(planet.canvas, sx - S / 2, sy - S / 2, S, S);
          ctx.globalAlpha = 1;
        }
      }
      // mid stars (direct, twinkle)
      const starTime = opts.reducedMotion ? 0 : now;
      if ((opts.quality ?? 1) > 0.3 && !opts.highContrast) drawStarsDirect(ctx, mid, 0.55, cam, starTime, z < 0.6 ? 0.9 : 1.1);
      // near stars
      if (!opts.highContrast) drawStarsDirect(ctx, near, 0.85, cam, starTime, 1.2);
      // comet
      if (!opts.reducedMotion && !opts.highContrast && (opts.quality ?? 1) > 0.5) {
        if (now >= nextComet && !comet) {
          const r = cometRnd;
          const vr = cam.visibleRect(200);
          comet = { t0: now, dur: 450, x: r.range(vr.x0, vr.x1), y: r.range(vr.y0, vr.y1), a: r.range(0, TAU), len: r.range(250, 500) / Math.max(0.5, z) };
          nextComet = now + cometRnd.range(20000, 40000);
        }
        if (comet) {
          const u = (now - comet.t0) / comet.dur;
          if (u >= 1) comet = null;
          else {
            const dx = Math.cos(comet.a), dy = Math.sin(comet.a);
            const head = { x: comet.x + dx * comet.len * u, y: comet.y + dy * comet.len * u };
            const tail = { x: head.x - dx * comet.len * 0.35, y: head.y - dy * comet.len * 0.35 };
            const hx = cam.worldToScreenX(head.x), hy = cam.worldToScreenY(head.y), tx = cam.worldToScreenX(tail.x), ty = cam.worldToScreenY(tail.y);
            const gr = ctx.createLinearGradient(tx, ty, hx, hy);
            gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, `rgba(255,255,255,${0.8 * Math.sin(u * Math.PI)})`);
            ctx.strokeStyle = gr; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
          }
        }
      }
      // arena bounds + optional tactical grid
      const vr = cam.visibleRect(0);
      ctx.strokeStyle = 'rgba(29,58,92,0.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(cam.worldToScreenX(0), cam.worldToScreenY(0), world.w * z, world.h * z);
      if (opts.grid) {
        ctx.strokeStyle = 'rgba(29,58,92,0.28)';
        ctx.beginPath();
        const step = 200;
        const gx0 = Math.max(0, Math.floor(vr.x0 / step) * step), gx1 = Math.min(world.w, vr.x1);
        const gy0 = Math.max(0, Math.floor(vr.y0 / step) * step), gy1 = Math.min(world.h, vr.y1);
        const sy0 = cam.worldToScreenY(Math.max(0, vr.y0)), sy1 = cam.worldToScreenY(Math.min(world.h, vr.y1));
        const sx0 = cam.worldToScreenX(Math.max(0, vr.x0)), sx1 = cam.worldToScreenX(Math.min(world.w, vr.x1));
        for (let x = gx0; x <= gx1; x += step) { const sx = cam.worldToScreenX(x); ctx.moveTo(sx, sy0); ctx.lineTo(sx, sy1); }
        for (let y = gy0; y <= gy1; y += step) { const sy = cam.worldToScreenY(y); ctx.moveTo(sx0, sy); ctx.lineTo(sx1, sy); }
        ctx.stroke();
        // grid labels every 600 u
        ctx.fillStyle = 'rgba(127,147,168,0.5)'; ctx.font = '10px "Exo 2", system-ui, sans-serif';
        for (let x = gx0; x <= gx1; x += 600) for (let y = gy0; y <= gy1; y += 600) {
          if (x === 0 && y === 0) continue;
          ctx.fillText(`${x},${y}`, cam.worldToScreenX(x) + 3, cam.worldToScreenY(y) - 3);
        }
      }
    },

    /**
     * Draw the vignette over the viewport (screen space).
     * @param {number} strength 0..1 extra darkening (sudden death / slow-mo)
     */
    drawVignette(ctx, vx, vy, vw, vh, strength = 0) {
      if (!vignette || vigW !== vw || vigH !== vh) {
        vigW = vw; vigH = vh;
        const W = Math.max(2, Math.round(vw / 2)), H = Math.max(2, Math.round(vh / 2));
        vignette = makeCanvas(W, H);
        const g = vignette.getContext('2d');
        const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.5)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(vignette, vx, vy, vw, vh);
      if (strength > 0) {
        ctx.fillStyle = `rgba(40,0,0,${0.25 * strength})`;
        ctx.fillRect(vx, vy, vw, vh);
      }
    },

    dispose() { nebula = null; farTiles.clear(); vignette = null; if (planet) planet.canvas = null; },
  };
}
