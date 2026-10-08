import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPilotControls, normalizePilotBindings, DEFAULT_PILOT_BINDINGS } from '../../client/battle/pilotControls.js';
import { createFeedBase } from '../../client/battle/feed.js';

function rig(pilot = true) {
  const doc = new EventTarget(), win = new EventTarget(), canvas = new EventTarget();
  doc.visibilityState = 'visible'; doc.activeElement = null;
  canvas.getBoundingClientRect = () => ({ left: 20, top: 30 });
  const base = createFeedBase({ isLocal: true }), commands = [], followed = [], statuses = [];
  const controls = { speed: 1, paused: false, pilot: (input) => commands.push(input) };
  const feed = { ...base, controls, get lastStart() { return base.lastStart; } };
  base.emitStart({ world: { w: 1000, h: 800 }, players: [{ id: 'p1', team: 0, pilot }], ships: pilot ? [{ id: 7, owner: 'p1', cls: 'ter_ace', pilot: true }] : [] });
  let tick, cancelled = false;
  const controller = createPilotControls({ canvas, feed, myPlayerId: 'p1', doc, win,
    renderer: { camera: { follow: (id) => followed.push(id), raw: { screenToWorld: (x, y) => ({ x: x * 2, y: y * 2 }) } } },
    onState: (state) => statuses.push(state), setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { cancelled = true; } });
  controller.update({ ships: new Map([[7, { x: 100, y: 200, a: 0 }]]) });
  const event = (target, type, props = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, props); target.dispatchEvent(e); return e;
  };
  return { base, doc, win, canvas, controller, commands, controls, followed, statuses, event, tick: () => tick(), get cancelled() { return cancelled; } };
}

test('manual intent uses keys and world mouse aim without client positions or damage', () => {
  const r = rig();
  try {
    assert.equal(r.commands.length, 0, 'autopilot is unchanged by default');
    assert.equal(r.controller.setEnabled(true), true);
    assert.deepEqual(r.followed, [7]);
    assert.equal(r.event(r.canvas, 'dblclick').defaultPrevented, true, 'rapid firing must not reset the camera');
    r.event(r.doc, 'keydown', { code: 'ArrowRight' });
    r.event(r.doc, 'keydown', { code: 'KeyE' });
    r.event(r.canvas, 'pointerdown', { button: 0, clientX: 420, clientY: 130 });
    r.tick();
    assert.deepEqual(r.commands.at(-1), { manual: true, moveX: 1, moveY: 0, aimX: 800, aimY: 200, fire: true, ability: true });
    r.event(r.win, 'pointerup'); r.event(r.doc, 'keyup', { code: 'ArrowRight' }); r.event(r.doc, 'keyup', { code: 'KeyE' }); r.tick();
    assert.equal(r.commands.at(-1).fire, false);
    assert.equal(r.commands.at(-1).moveX, 0);
    assert.equal(r.commands.at(-1).ability, false);
  } finally { r.controller.dispose(); }
});

test('focus, pause and disconnect release held inputs and require explicit takeover', () => {
  const r = rig();
  try {
    for (const lose of [() => r.event(r.win, 'blur'), () => { r.controls.speed = 0; r.tick(); }, () => r.base.emitStatus('reconnecting')]) {
      r.controls.speed = 1; r.base.emitStatus('ok');
      assert.equal(r.controller.setEnabled(true), true);
      r.event(r.doc, 'keydown', { code: 'KeyF' }); lose();
      assert.deepEqual(r.commands.at(-1), { manual: false });
      assert.equal(r.controller.state.manual, false);
      r.controls.speed = 1; r.base.emitStatus('ok'); r.tick();
      assert.equal(r.commands.at(-1).manual, false, 'no automatic resumption of fire');
    }
    r.doc.activeElement = { tagName: 'INPUT' };
    assert.equal(r.controller.setEnabled(true), false);
  } finally { r.controller.dispose(); }
  assert.equal(r.cancelled, true);
});

test('death and absence of a special ship cannot enter manual mode', () => {
  const r = rig();
  try {
    r.controller.setEnabled(true);
    r.base.emitFrame({ k: 2, s: [], p: [{ owner: 'p1', shipId: 7, abilityReadyAt: 100 }], e: [] });
    assert.equal(r.controller.state.alive, false);
    assert.equal(r.controller.state.abilityReady, false);
    assert.equal(r.controller.setEnabled(true), false);
    assert.deepEqual(r.commands.at(-1), { manual: false });
  } finally { r.controller.dispose(); }
  const noPilot = rig(false);
  try {
    assert.equal(noPilot.controller.setEnabled(true), false);
    assert.equal(noPilot.event(noPilot.doc, 'keydown', { code: 'KeyP' }).defaultPrevented, false);
  } finally { noPilot.controller.dispose(); }
});

test('remapping rejects duplicate keys and reserved battle shortcuts', () => {
  assert.deepEqual(normalizePilotBindings({ fire: 'KeyE' }), DEFAULT_PILOT_BINDINGS);
  assert.equal(normalizePilotBindings({ fire: 'Space' }).fire, 'KeyF');
  assert.equal(normalizePilotBindings({ fire: 'KeyC' }).fire, 'KeyF');
  assert.equal(normalizePilotBindings({ fire: 'KeyZ' }).fire, 'KeyZ');
});

test('explicit HUD takeover releases button focus, but a dialog retains keyboard ownership', () => {
  const r = rig();
  try {
    r.doc.activeElement = { tagName: 'BUTTON', blur() { r.doc.activeElement = null; } };
    assert.equal(r.controller.setEnabled(true), true);
    r.controller.setEnabled(false);
    r.doc.activeElement = { tagName: 'BUTTON', closest: () => ({}), blur() { throw new Error('must not blur dialog'); } };
    assert.equal(r.controller.setEnabled(true), false);
  } finally { r.controller.dispose(); }
});
