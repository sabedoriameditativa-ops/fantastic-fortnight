// Battle background: cached parallax starfield tiles, procedural nebula from
// the battle seed, optional planet, occasional comet, vignette and the
// optional tactical grid. Everything is deterministic from the seed.

import { makeCanvas } from './render/glow.js';
import { hashStr, hash01, makeRand, rgba, mix, parseColor, TAU, clamp } from './render/palette.js';

const NEB_PALETTES = [
  ['#1a1040', '#0b2a4a'], ['#2a0f2e', '#102a33'], ['#0e2a1a', '#0a1430'], ['#2a1a10', '#0e1a3a'], ['#101a3a', '#2a1030'],
];
const STAR_COLORS = ['#ffffff', '#cfe8ff', '#ffe9c0', '#ffffff', '#ffd9c0'];
const PLANET_SIZE = 1024, PLANET_R = 224;
const smooth = t => t * t * (3 - 2 * t);
const blend = (a, b, t) => a + (b - a) * t;

// Coherent noise is sampled only while baking textures. No image-data work
// enters the render loop; spherical coordinates avoid a seam on the globe.
function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const a = smooth(x - ix), b = smooth(y - iy), c = smooth(z - iz);
  const s0 = seed ^ Math.imul(iz, 92837111), s1 = seed ^ Math.imul(iz + 1, 92837111);
  const lo = blend(blend(hash01(ix, iy, s0), hash01(ix + 1, iy, s0), a), blend(hash01(ix, iy + 1, s0), hash01(ix + 1, iy + 1, s0), a), b);
  const hi = blend(blend(hash01(ix, iy, s1), hash01(ix + 1, iy, s1), a), blend(hash01(ix, iy + 1, s1), hash01(ix + 1, iy + 1, s1), a), b);
  return blend(lo, hi, c);
}
function terrain(x, y, z, seed) {
  return noise3(x, y, z, seed) * 0.57 + noise3(x * 2.07, y * 2.07, z * 2.07, seed + 41) * 0.28 + noise3(x * 4.13, y * 4.13, z * 4.13, seed + 83) * 0.15;
}
function tileNoise(u, v, frequency, seed) {
  const x = u * frequency, y = v * frequency, ix = Math.floor(x), iy = Math.floor(y);
  const a = smooth(x - ix), b = smooth(y - iy);
  const x0 = ((ix % frequency) + frequency) % frequency, x1 = (x0 + 1) % frequency;
  const y0 = ((iy % frequency) + frequency) % frequency, y1 = (y0 + 1) % frequency;
  return blend(blend(hash01(x0, y0, seed), hash01(x1, y0, seed), a), blend(hash01(x0, y1, seed), hash01(x1, y1, seed), a), b);
}

/** Bake a lit sphere; the output also occludes stars on its unlit hemisphere. */
function bakeGlobe(radius, p, seed, moon = false) {
  const size = radius * 2 + 4, cv = makeCanvas(size, size), g = cv.getContext('2d');
  const pixels = g.createImageData(size, size), data = pixels.data;
  const hue = parseColor(p.hue), cloud = parseColor(moon ? '#a2a4ae' : '#d5deed');
  const lightZ = p.lightZ ?? 0.5, side = Math.sqrt(1 - lightZ * lightZ);
  const lx = Math.cos(p.lightA) * side, ly = Math.sin(p.lightA) * side;
  const cx = size / 2, cy = size / 2;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const nx = (px + 0.5 - cx) / radius, ny = (py + 0.5 - cy) / radius, rr = nx * nx + ny * ny;
    if (rr >= 1) continue;
    const nz = Math.sqrt(1 - rr), dot = nx * lx + ny * ly + nz * lightZ;
    const n = terrain(nx * 4.4 + 13, ny * 4.4 + 7, nz * 4.4 + 3, seed);
    let red, green, blue, rough = 0, cloudCover = 0;
    if (moon) {
      const crater = noise3(nx * 23 + 5, ny * 23, nz * 23, seed + 59);
      const albedo = 0.38 + n * 0.48 + (crater - 0.5) * 0.16;
      red = hue[0] * albedo; green = hue[1] * albedo; blue = hue[2] * albedo;
      rough = (crater - 0.5) * 0.09;
    } else if (p.gas) {
      const flow = ny * 23 + (n - 0.5) * 4.5 + Math.sin(nx * 4 + nz * 3) * 0.7;
      const band = 0.5 + Math.sin(flow) * 0.27 + Math.sin(flow * 2.7 + n) * 0.1;
      const stormX = (nx - 0.28) / 0.3, stormY = (ny + 0.17) / 0.13;
      const stormR = Math.sqrt(stormX * stormX + stormY * stormY);
      const storm = Math.max(0, 1 - stormR) * (0.45 + 0.35 * Math.sin(stormR * 19 + Math.atan2(stormY, stormX)));
      const bright = clamp(band * 0.48 + n * 0.2 + storm * 0.5, 0, 0.65);
      red = blend(hue[0] * 0.55, 218, bright); green = blend(hue[1] * 0.55, 202, bright); blue = blend(hue[2] * 0.55, 175, bright);
    } else {
      const land = smooth(clamp((n - 0.49) * 16, 0, 1));
      const coast = Math.max(0, 1 - Math.abs(n - 0.49) * 60) * 0.3;
      red = blend(hue[0] * 0.38, 67 + n * 43, land) + coast * 24;
      green = blend(hue[1] * 0.6, 80 + n * 34, land) + coast * 32;
      blue = blend(hue[2] * 0.76, 52 + n * 23, land) + coast * 20;
      const ice = smooth(clamp((Math.abs(ny) + n * 0.13 - 0.88) * 16, 0, 1));
      red = blend(red, 194, ice); green = blend(green, 209, ice); blue = blend(blue, 220, ice);
      cloudCover = smooth(clamp((terrain(nx * 7 + 31, ny * 7 + 9, nz * 7, seed + 193) - 0.55) * 8, 0, 1)) * 0.83;
      const spec = Math.pow(Math.max(0, nx * lx * 0.56 + ny * ly * 0.56 + nz * 0.88), 30) * (1 - land) * 0.16;
      red += spec * 175; green += spec * 198; blue += spec * 222;
    }
    const light = 0.035 + Math.pow(Math.max(0, dot + rough), 0.8) * 0.93;
    const rim = moon ? 0 : Math.pow(1 - nz, 3) * Math.max(0, dot + 0.12) * 0.3;
    const at = (py * size + px) * 4;
    data[at] = blend(red, cloud[0], cloudCover) * light + rim * 78;
    data[at + 1] = blend(green, cloud[1], cloudCover) * light + rim * 141;
    data[at + 2] = blend(blue, cloud[2], cloudCover) * light + rim * 212;
    data[at + 3] = clamp((1 - Math.sqrt(rr)) * radius, 0, 1) * 255;
  }
  g.putImageData(pixels, 0, 0);
  return cv;
}


/**
 * @param {{ seed: number|string, world: {w:number,h:number}, dpr?: number, planet?: boolean }} o
 *   planet: allow a planet (default true; 75% of seeds get one)
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
    const g = cv.getContext('2d'), pixels = g.createImageData(NEB_PX, NEB_PX), data = pixels.data;
    const pal = NEB_PALETTES[seed % NEB_PALETTES.length];
    const a = parseColor(mix(pal[0], '#aa8bbb', 0.16)), b = parseColor(mix(pal[1], '#7cb9cf', 0.16));
    for (let y = 0; y < NEB_PX; y++) for (let x = 0; x < NEB_PX; x++) {
      const u = x / NEB_PX, v = y / NEB_PX;
      const warp = (tileNoise(u, v, 4, seed + 11) - 0.5) * 0.3;
      const n = tileNoise(u + warp, v - warp, 4, seed + 21);
      const fine = tileNoise(u + warp, v, 16, seed + 31);
      const dust = tileNoise(u, v + warp, 8, seed + 51);
      const cloud = Math.pow(Math.max(0, n * 0.8 + fine * 0.2 - 0.25), 2) * 1.7;
      const filament = Math.max(0, 1 - Math.abs(dust - 0.48) * 18) * cloud * 0.46;
      const shadow = 1 - smooth(clamp((dust - 0.58) * 6, 0, 1)) * 0.82;
      const tint = smooth(clamp(n * 1.4 - 0.15, 0, 1)), i = (y * NEB_PX + x) * 4;
      data[i] = 4 + (blend(a[0], b[0], tint) * cloud + filament * 26) * shadow;
      data[i + 1] = 6 + (blend(a[1], b[1], tint) * cloud + filament * 32) * shadow;
      data[i + 2] = 12 + (blend(a[2], b[2], tint) * cloud + filament * 44) * shadow;
      data[i + 3] = 255;
    }
    g.putImageData(pixels, 0, 0);
    return cv;
  }

  // ---- star layers ----
  const STAR_T = 1024;
  const far = [];   // {x,y,r,a,c} in tile units
  const mid = [];
  const near = [];
  {
    const r = makeRand(seed ^ 0x51a7);
    for (let i = 0; i < 620; i++) far.push({ x: r.range(0, STAR_T), y: r.range(0, STAR_T), r: r.range(0.5, 1.1), a: r.range(0.2, 0.65), c: r.pick(STAR_COLORS) });
    for (let i = 0; i < 180; i++) mid.push({ x: r.range(0, STAR_T), y: r.range(0, STAR_T), r: r.range(0.9, 1.6), a: r.range(0.35, 0.8), c: r.pick(STAR_COLORS), cross: i < 18, tw: i >= 18 && i < 30 ? r.range(1, 3) : 0, ph: r.range(0, TAU) });
    for (let i = 0; i < 40; i++) near.push({ x: r.range(0, STAR_T), y: r.range(0, STAR_T), r: r.range(1.4, 2.2), a: r.range(0.6, 1), c: r.pick(STAR_COLORS) });
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
  if (o.planet !== false && rnd() < 0.75) {
    const r = makeRand(seed ^ 0x9e3779b9);
    const radius = r.range(320, 560);
    const corner = r.int(0, 3);
    planet = {
      x: (corner & 1 ? 0.9 : 0.1) * world.w + r.range(-150, 150),
      y: (corner & 2 ? 0.88 : 0.12) * world.h + r.range(-100, 100),
      radius, gas: r() < 0.6, ring: r() < 0.6, lightA: r.range(-2.7, -0.5), lightZ: r.range(0.35, 0.65),
      ringAngle: r.range(-0.55, 0.4), moon: r() < 0.65, moonAngle: r.range(-1.8, 1.8), moonCanvas: null,
      hue: r.pick(['#4a6cb0', '#b07a4a', '#7a4ab0', '#4aa890', '#b04a5a', '#6a7090']),
      canvas: null, toneCanvas: null, toneMode: 0,
    };
  }
  function buildPlanet(p) {
    const cv = makeCanvas(PLANET_SIZE, PLANET_SIZE), g = cv.getContext('2d');
    const cx = PLANET_SIZE / 2, cy = PLANET_SIZE / 2, R = PLANET_R;
    const ringColor = mix(p.hue, '#d8c8a7', 0.7);
    const drawRings = front => {
      if (!p.ring) return;
      g.save(); g.translate(cx, cy); g.rotate(p.ringAngle);
      // Upper half is behind the globe; lower half crosses in front. Keeping
      // the split in ring-local coordinates also works for inclined rings.
      const from = front ? 0 : Math.PI, to = front ? Math.PI : TAU;
      for (let i = 0; i < 30; i++) {
        if (i === 17 || i === 18 || i === 25) continue; // Cassini-like divisions
        const rr = R * (1.2 + i * 0.022);
        const lit = (front ? 0.3 : 0.2) + hash01(seed, i, 84) * 0.2;
        g.strokeStyle = rgba(ringColor, lit); g.lineWidth = R * 0.018;
        g.beginPath(); g.ellipse(0, 0, rr, rr * 0.29, 0, from, to); g.stroke();
      }
      g.restore();
    };
    drawRings(false);
    // Restrained atmosphere outside the opaque globe, not an all-over bloom.
    const atm = g.createRadialGradient(cx, cy, R * 0.99, cx, cy, R * 1.085);
    atm.addColorStop(0, rgba(mix(p.hue, '#9dcbff', 0.5), 0.48));
    atm.addColorStop(0.32, rgba(p.hue, 0.16)); atm.addColorStop(1, rgba(p.hue, 0));
    g.fillStyle = atm; g.beginPath(); g.arc(cx, cy, R * 1.085, 0, TAU); g.fill();
    const globe = bakeGlobe(R, p, seed ^ 0x77);
    g.drawImage(globe, cx - globe.width / 2, cy - globe.height / 2);
    if (p.ring) {
      // Ring shadow conforms to the body: clipped and subtly offset from its
      // front band. The visible rings themselves are never clipped to the disc.
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
      g.translate(cx, cy + R * 0.075); g.rotate(p.ringAngle);
      g.strokeStyle = 'rgba(1,3,8,0.42)'; g.lineWidth = R * 0.055;
      g.beginPath(); g.ellipse(0, 0, R * 1.44, R * 0.42, 0, 0, Math.PI); g.stroke();
      g.restore();
    }
    drawRings(true);
    return cv;
  }

  function planetTexture(mode) {
    if (!planet.canvas) planet.canvas = buildPlanet(planet);
    if (!mode) return planet.canvas;
    // Keep alpha unchanged: even a darkened night side must occlude stars.
    // At most one tinted variant lives beside the original atlas.
    if (!planet.toneCanvas || planet.toneMode !== mode) {
      const cv = makeCanvas(PLANET_SIZE, PLANET_SIZE), g = cv.getContext('2d');
      g.drawImage(planet.canvas, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = mode === 2 ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.22)';
      g.fillRect(0, 0, PLANET_SIZE, PLANET_SIZE);
      planet.toneCanvas = cv; planet.toneMode = mode;
    }
    return planet.toneCanvas;
  }

  // ---- comet ----
  let comet = null, nextComet = 0, cometCanvas = null;
  function buildComet() {
    const cv = makeCanvas(256, 8), g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, 'rgba(194,219,255,0)'); gr.addColorStop(1, 'rgba(224,238,255,0.85)');
    g.strokeStyle = gr; g.lineWidth = 1.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 4); g.lineTo(253, 4); g.stroke();
    return cv;
  }
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
     * @param {{ grid?: boolean, quality?: number, reducedMotion?: boolean, reducedEffects?: boolean, highContrast?: boolean }} opts
     */
    draw(ctx, cam, now, opts = {}) {
      const z = cam.zoom;
      const quiet = opts.reducedEffects || (opts.quality ?? 1) < 0.5;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05070c';
      ctx.fillRect(cam.vx, cam.vy, cam.vw, cam.vh);
      // nebula
      if (!nebula) nebula = buildNebula();
      drawTiled(ctx, nebula, NEB_T, 0.15, cam, opts.highContrast ? 0.13 : quiet ? 0.65 : 1);
      // All stars lie behind the opaque planet; distant layer uses cached tiles.
      const band = z < 0.9 ? 0 : 1;
      drawTiled(ctx, farTile(band), STAR_T, 0.3, cam, opts.highContrast ? 0.25 : z < 0.5 ? 0.8 : 1);
      // mid stars (direct, twinkle)
      const starTime = opts.reducedMotion ? 0 : now;
      if (!quiet && !opts.highContrast) drawStarsDirect(ctx, mid, 0.55, cam, starTime, z < 0.6 ? 0.9 : 1.1);
      // near stars
      if (!quiet && !opts.highContrast) drawStarsDirect(ctx, near, 0.85, cam, starTime, 1.2);
      if (planet) {
        const texture = planetTexture(opts.highContrast ? 2 : quiet ? 1 : 0);
        // parallax 0.2, anchored so that at the world center the offset is zero
        const p = 0.2;
        const wx = planet.x - (cam.x - world.w / 2) * (1 - p);
        const wy = planet.y - (cam.y - world.h / 2) * (1 - p);
        const sx = cam.worldToScreenX(wx), sy = cam.worldToScreenY(wy);
        const R = planet.radius * z;
        const S = R * PLANET_SIZE / PLANET_R;
        if (sx + S / 2 > cam.vx - 50 && sx - S / 2 < cam.vx + cam.vw + 50 && sy + S / 2 > cam.vy - 50 && sy - S / 2 < cam.vy + cam.vh + 50) {
          ctx.drawImage(texture, sx - S / 2, sy - S / 2, S, S);
        }
        if (planet.moon && !quiet && !opts.highContrast) {
          if (!planet.moonCanvas) planet.moonCanvas = bakeGlobe(96, { ...planet, hue: '#989baa' }, seed ^ 0x919, true);
          const mx = sx + Math.cos(planet.moonAngle) * R * 2.4, my = sy + Math.sin(planet.moonAngle) * R * 1.65;
          const msize = R * 0.34;
          ctx.drawImage(planet.moonCanvas, mx - msize / 2, my - msize / 2, msize, msize);
        }
      }
      // comet
      if (!quiet && !opts.reducedMotion && !opts.highContrast && (opts.quality ?? 1) > 0.5) {
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
            const headX = comet.x + dx * comet.len * u, headY = comet.y + dy * comet.len * u;
            const hx = cam.worldToScreenX(headX), hy = cam.worldToScreenY(headY);
            if (!cometCanvas) cometCanvas = buildComet();
            ctx.save(); ctx.translate(hx, hy); ctx.rotate(comet.a);
            ctx.globalAlpha = 0.8 * Math.sin(u * Math.PI);
            ctx.drawImage(cometCanvas, -comet.len * 0.35 * z, -4, comet.len * 0.35 * z, 8);
            ctx.restore();
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

    dispose() { nebula = null; farTiles.clear(); vignette = null; cometCanvas = null; comet = null; if (planet) { planet.canvas = null; planet.moonCanvas = null; planet.toneCanvas = null; } },
  };
}
