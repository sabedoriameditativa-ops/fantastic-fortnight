// Ambient scene behind the menus: the renderer's parallax background with a
// few ships of different factions drifting slowly across. Runs on its own
// canvas; paused while hidden or during battles. Reduced motion → one static
// frame (redrawn on resize).

import { createBackground } from '../battle/background.js';
import { createCamera } from '../battle/camera.js';
import { getDef, blitShip, drawShipDetails, lodFor } from '../battle/sprites.js';
import { palette } from '../battle/render/palette.js';
import { TEAM_COLORS } from '/shared/constants.js';
import { spriteCache } from './shipCanvas.js';

const DRIFTERS = [
  { cls: 'ter_hercules', team: 0, y: 0.30, speed: 22, zoom: 1.0, a: 0.05 },
  { cls: 'lum_catedral', team: 1, y: 0.62, speed: 14, zoom: 0.85, a: -0.08 },
  { cls: 'vor_mandibula', team: 1, y: 0.80, speed: 26, zoom: 0.9, a: 0.12 },
  { cls: 'fer_ariete', team: 0, y: 0.18, speed: 18, zoom: 0.75, a: -0.02 },
  { cls: 'ter_falcao', team: 0, y: 0.34, speed: 30, zoom: 1.0, a: 0.05 },
  { cls: 'ter_falcao', team: 0, y: 0.27, speed: 30, zoom: 1.0, a: 0.05 },
  { cls: 'lum_prisma', team: 1, y: 0.58, speed: 20, zoom: 0.85, a: -0.08 },
  { cls: 'vor_zangao', team: 1, y: 0.84, speed: 34, zoom: 0.9, a: 0.12 },
  { cls: 'fer_sentinela', team: 0, y: 0.14, speed: 24, zoom: 0.75, a: -0.02 },
];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ seed?: string|number, reducedMotion?: () => boolean }} [o]
 */
export function createAmbient(canvas, o = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const world = { w: 6000, h: 3375 };
  const camera = createCamera({ world, seed: 3 });
  let dpr = 1;
  const background = createBackground({ seed: o.seed ?? 'frota-estelar', world, dpr, planet: true });
  const isReduced = o.reducedMotion || (() => false);
  const ships = DRIFTERS.map((d, i) => ({ ...d, x: (i * 0.37 + 0.1) % 1, phase: i * 1.7 }));
  let raf = 0;
  let running = false;
  let visible = true;
  let last = 0;
  let camX = world.w / 2, camY = world.h / 2;
  const zoom = 0.62;

  function resize() {
    const cw = Math.max(1, canvas.clientWidth || window.innerWidth), ch = Math.max(1, canvas.clientHeight || window.innerHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    camera.setViewport(0, 0, cw, ch);
    background.setDpr(dpr);
    camera.jumpTo(camX, camY, zoom);
    if (!running || isReduced()) draw(performance.now(), 0);
  }

  function draw(now, dt) {
    if (!ctx) return;
    const vw = camera.vw, vh = camera.vh;
    camX += 9 * dt;
    if (camX > world.w - vw / zoom) camX = vw / zoom;
    camera.jumpTo(camX, camY, zoom);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.clip();
    background.draw(ctx, camera, now, { grid: false, quality: 0.8, reducedMotion: isReduced() });
    const cache = spriteCache();
    const animate = !isReduced();
    for (const s of ships) {
      s.x += (s.speed * dt) / (vw / zoom + 600);
      if (s.x > 1.12) { s.x = -0.12; }
      const bob = animate ? Math.sin(now / 2600 + s.phase) * 10 : 0;
      const sx = s.x * vw, sy = s.y * vh + bob;
      const def = getDef(s.cls);
      const z = s.zoom * zoom * 1.6;
      const cos = Math.cos(s.a), sin = Math.sin(s.a);
      const spr = cache.get(def, s.team, z, 0);
      blitShip(ctx, spr, sx, sy, cos, sin, z, dpr, 0.92, 1);
      if (lodFor(def.size * z) === 2) {
        const pal = palette(def.faction, s.team, TEAM_COLORS);
        drawShipDetails(ctx, def, pal, sx, sy, cos, sin, z, dpr, { id: 100 + ships.indexOf(s), thrust: 0.45, boosted: false, disrupted: false }, now, { anims: animate, glow: true });
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.restore();
    background.drawVignette(ctx, 0, 0, vw, vh, 0.15);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function loop(now) {
    raf = 0;
    if (!running || !visible) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    draw(now, dt);
    if (!isReduced()) raf = requestAnimationFrame(loop);
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  return {
    start() {
      if (running) return;
      running = true;
      canvas.style.display = '';
      resize();
      last = 0;
      if (!raf) raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    },
    setVisible(b) {
      visible = !!b;
      if (visible && running && !raf) { last = 0; raf = requestAnimationFrame(loop); }
    },
    /** Re-render once (reduced-motion setting changed). */
    refresh() { if (running) { last = 0; if (!raf) raf = requestAnimationFrame(loop); } },
    resize,
    get running() { return running; },
    dispose() { this.stop(); window.removeEventListener('resize', onResize); background.dispose(); },
  };
}
