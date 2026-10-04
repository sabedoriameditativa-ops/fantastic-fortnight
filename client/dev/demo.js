// Renderer demo page logic (client/dev/render-demo.html). Drives the renderer
// with the synthetic feed; exposes window.__demo for tools/render-shots.js.

import { createRenderer } from '../battle/renderer.js';
import { createFakeFeed, SHOWCASE } from './fakeFeed.js';
import { SHIP_LIST, FACTIONS } from '/shared/catalog.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'battle';
const seed = params.get('seed') || '42';
const canvas = document.getElementById('arena');
const $ = (id) => document.getElementById(id);

const feed = createFakeFeed({ mode, seed, shipsPerSide: +(params.get('perSide') || 250) });
let renderer = null;
let raf = 0;
const state = { ready: false, frames: 0, phase: 'advance', events: 0 };

function makeAudioStub() {
  // duck-typed audio: counts events so the integration path is exercised
  return {
    events: 0, cam: null,
    consumeEvents(events, lookup) { this.events += events.length; if (events.length) lookup(events[0][1]); },
    setCamera(cx, cy, hw, aspect) { this.cam = { cx, cy, hw, aspect }; },
  };
}
const audio = makeAudioStub();

feed.onStart((start) => {
  renderer = createRenderer(canvas, { start, myTeam: 0, audio, isLocal: true, background: { planet: mode !== 'showcase' } });
  renderer.setOptions({ showNames: $('names').checked, grid: $('grid').checked, reducedMotion: $('motion').checked, quality: $('quality').value });
  renderer.onPhase((name) => { state.phase = name; $('phase').textContent = name === 'suddenDeath' ? 'MORTE SÚBITA' : name === 'engage' ? 'COMBATE' : name; });
  renderer.onEnd((winner) => { $('phase').textContent = `FIM — vencedor: ${winner}`; });
  if (mode === 'showcase') {
    feed.controls.setSpeed(1);
    const w = feed.world;
    renderer.camera.raw.jumpTo(w.w / 2, w.h / 2, Math.min(1.9, (renderer.viewport.w - 80) / ((SHOWCASE.cols - 1) * SHOWCASE.dx + 220)));
    renderer.camera.setMode('free');
  }
  const loop = (t) => {
    renderer.draw(t);
    state.frames++;
    if ((state.frames & 15) === 0) updateStats();
    if (mode === 'showcase') { renderer.camera.setMode('free'); }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  state.ready = true;
});
feed.onFrame((f) => { if (renderer) renderer.onFrame(f); });

function updateStats() {
  if (!renderer) return;
  const s = renderer.stats();
  $('stats').textContent = [
    `fps ${s.fps.toFixed(0)}`, `draw ${s.drawMs.toFixed(1)} ms`, `frame ${s.frameMs.toFixed(1)} ms`, `pior ${s.worstMs.toFixed(1)} ms`,
    `naves ${s.ships}`, `partículas ${s.particles}`, `feixes ${s.beams}`, `projéteis ${s.projectiles}`,
    `sprites ${s.sprites}`, `densidade ${s.density.toFixed(2)}`, `tick ${s.tick.toFixed(1)} @ ${s.ticksPerSec.toFixed(0)}/s`, `zoom ${renderer.camera.zoom.toFixed(2)} (${renderer.camera.mode})`,
    `áudio ev ${audio.events}`,
  ].join('  ·  ');
}

// ---- controls ----
for (const b of document.querySelectorAll('[data-speed]')) b.addEventListener('click', () => { feed.controls.setSpeed(+b.dataset.speed); for (const o of document.querySelectorAll('[data-speed]')) o.classList.toggle('on', o === b); });
$('quality').addEventListener('change', () => renderer && renderer.setOptions({ quality: $('quality').value }));
for (const id of ['names', 'grid', 'motion']) $(id).addEventListener('change', () => renderer && renderer.setOptions({ showNames: $('names').checked, grid: $('grid').checked, reducedMotion: $('motion').checked }));
$('explode').addEventListener('click', () => feed.debug.explode('capital'));
$('cast').addEventListener('click', () => feed.debug.castAll());
$('auto').addEventListener('click', () => { if (renderer) { renderer.camera.follow(0); renderer.camera.setMode('auto'); } });
$('mode').value = mode;
$('mode').addEventListener('change', () => { const u = new URL(location.href); u.searchParams.set('mode', $('mode').value); location.href = u.toString(); });
for (const f of Object.keys(FACTIONS)) {
  const b = document.createElement('button'); b.textContent = FACTIONS[f].short; b.addEventListener('click', () => showcase(f)); $('factions').appendChild(b);
}

/** Showcase helper: frame the 8 ships of a faction (one grid row) at zoom 2. */
function showcase(faction, zoom = 2, half = -1) {
  if (!renderer) return;
  const idx = SHIP_LIST.findIndex((s) => s.faction === faction);
  const row = Math.floor(idx / SHOWCASE.cols);
  const w = feed.world;
  const x0 = w.w / 2 - ((SHOWCASE.cols - 1) * SHOWCASE.dx) / 2;
  const y0 = w.h / 2 - ((SHOWCASE.rows - 1) * SHOWCASE.dy) / 2;
  // half 0 = the 4 smaller ships, 1 = the 4 larger ones, -1 = whole row centered
  const cx = half < 0 ? w.w / 2 : x0 + (half === 0 ? 1.5 : 5.5) * SHOWCASE.dx;
  renderer.camera.raw.jumpTo(cx, y0 + row * SHOWCASE.dy, zoom);
  renderer.camera.setMode('free');
}

function frameAll() {
  if (!renderer) return;
  const w = feed.world;
  renderer.camera.raw.jumpTo(w.w / 2, w.h / 2, Math.min(1.9, (renderer.viewport.w - 80) / ((SHOWCASE.cols - 1) * SHOWCASE.dx + 220)));
  renderer.camera.setMode('free');
}

window.__demo = {
  feed, get renderer() { return renderer; }, state, mode, audio,
  stats: () => (renderer ? renderer.stats() : null),
  explode: (prefer) => feed.debug.explode(prefer),
  castAll: () => feed.debug.castAll(),
  showcase, frameAll,
  setSpeed: (x) => feed.controls.setSpeed(x),
  ready: () => state.ready && state.frames > 5,
  explodeAt: (id) => renderer && renderer.effects.debugExplode(id, performance.now()),
};

feed.start();
