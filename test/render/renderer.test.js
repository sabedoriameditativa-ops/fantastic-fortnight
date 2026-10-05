// Renderer registration contract (docs/ARCHITECTURE.md §5.3): ships spawned
// mid-battle and ships learned from a reconnect `battle_start` are registered
// so their interpolated views carry cls/team/size. Runs under node with a
// no-op 2D context (no pixels are checked).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../client/_sharedHook.mjs', import.meta.url);

function fakeContext() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const special = {
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  };
  const store = {};
  return new Proxy({}, {
    get: (t, k) => (k in special ? special[k] : k in store ? store[k] : (typeof k === 'string' ? noop : undefined)),
    set: (t, k, v) => { store[k] = v; return true; },
  });
}
class FakeCanvas {
  constructor(w = 1280, h = 720) { this.width = w; this.height = h; this.clientWidth = w; this.clientHeight = h; }
  getContext() { return fakeContext(); }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
}

let createRenderer, SHIPS;
const saved = {};
before(async () => {
  saved.OffscreenCanvas = globalThis.OffscreenCanvas;
  saved.performance = globalThis.performance;
  globalThis.OffscreenCanvas = FakeCanvas;
  ({ createRenderer } = await import('../../client/battle/renderer.js'));
  ({ SHIPS } = await import('../../shared/catalog.js'));
});
after(() => { globalThis.OffscreenCanvas = saved.OffscreenCanvas; });

function pick(faction, sizeClass) { return Object.values(SHIPS).find((s) => s.faction === faction && s.sizeClass === sizeClass); }
const row = (id, x, y) => [id, x * 10, y * 10, 0, 1000, 500, 0];

describe('renderer ship registration', () => {
  function makeStart() {
    const cap = pick('vorrax', 'capital'), fr = pick('terran', 'small');
    return {
      seed: 11, world: { w: 2800, h: 1575 }, tickRate: 20, snapshotEvery: 2, isLocal: false,
      players: [{ id: 'p1', name: 'Ana', team: 0, faction: 'vorrax', fleet: {}, isBot: false }, { id: 'p2', name: 'Bot', team: 1, faction: 'terran', fleet: {}, isBot: true }],
      ships: [{ id: 1, cls: cap.id, team: 0, owner: 'p1' }, { id: 2, cls: fr.id, team: 1, owner: 'p2' }],
    };
  }

  test('a spawn event in a frame gives the new view cls/team/size before it is first sampled', () => {
    const start = makeStart();
    const r = createRenderer(new FakeCanvas(), { start, myTeam: 0, isLocal: false });
    const tiny = pick('vorrax', 'tiny');
    r.onFrame({ k: 0, at: 0, s: [row(1, 100, 100), row(2, 900, 100)], e: [] });
    r.onFrame({ k: 2, at: 100, s: [row(1, 100, 100), row(2, 900, 100), row(7, 120, 110)], e: [['spawn', 7, tiny.id, 0, 'p1']] });
    r.onFrame({ k: 4, at: 200, s: [row(1, 100, 100), row(2, 900, 100), row(7, 125, 112)], e: [] });
    r.draw(400);
    const v = r.getView().ships.get(7);
    assert.ok(v, 'spawned ship is presented');
    assert.equal(v.cls, tiny.id);
    assert.equal(v.team, 0);
    assert.equal(v.owner, 'p1');
    assert.ok(v.size > 0 && v.size !== 30 || r.info(7).size === 30, 'size comes from the sprite definition, not the 30 default');
    assert.equal(v.size, r.info(7).size);
    r.dispose();
  });

  test('resync(start) registers ships spawned while disconnected (idempotent) and resets the interpolator', () => {
    const start = makeStart();
    const r = createRenderer(new FakeCanvas(), { start, myTeam: 0, isLocal: false });
    r.onFrame({ k: 0, at: 0, s: [row(1, 100, 100), row(2, 900, 100)], e: [] });
    r.onFrame({ k: 2, at: 100, s: [row(1, 100, 100), row(2, 900, 100)], e: [] });
    r.draw(300);
    assert.equal(r.info(9), null);
    // reconnect: the server resends start with the alive spawned units appended and the dead list
    const tiny = pick('vorrax', 'tiny');
    const again = { ...start, ships: start.ships.concat([{ id: 9, cls: tiny.id, team: 0, owner: 'p1' }]), dead: [2] };
    r.resync(again);
    r.resync(again);
    assert.equal(r.info(9).cls, tiny.id);
    assert.equal(r.info(1).cls, start.ships[0].cls, 'existing ships untouched');
    r.onFrame({ k: 40, at: 2100, s: [row(1, 100, 100), row(9, 130, 120)], e: [] });
    r.onFrame({ k: 42, at: 2200, s: [row(1, 100, 100), row(9, 132, 121)], e: [] });
    r.draw(2500);
    const v = r.getView().ships.get(9);
    assert.ok(v, 'spawned ship presented after resync');
    assert.equal(v.cls, tiny.id);
    assert.equal(v.team, 0);
    assert.ok(!r.getView().ships.has(2), 'dead ship absent from the new frames is not presented');
    r.dispose();
  });

  test('draw() keeps the canvas save/restore stack balanced when a pass throws', () => {
    const start = makeStart();
    const canvas = new FakeCanvas();
    const counts = { save: 0, restore: 0 };
    const base = fakeContext();
    canvas.getContext = () => new Proxy(base, { get: (t, k) => (k === 'save' || k === 'restore' ? () => { counts[k]++; } : t[k]) });
    const r = createRenderer(canvas, { start, myTeam: 0, isLocal: false });
    r.effects.drawEffects = () => { throw new Error('boom'); };
    r.onFrame({ k: 0, at: 0, s: [row(1, 100, 100)], e: [] });
    assert.throws(() => r.draw(100), /boom/);
    assert.throws(() => r.draw(200), /boom/);
    assert.equal(counts.save, counts.restore, `save ${counts.save} vs restore ${counts.restore}`);
    r.effects.drawEffects = () => {};
    r.draw(300);
    assert.equal(counts.save, counts.restore);
    assert.ok(counts.save >= 3);
    r.dispose();
  });
});
