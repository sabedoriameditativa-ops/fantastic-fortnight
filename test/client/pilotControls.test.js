import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPilotControls, normalizePilotBindings, DEFAULT_PILOT_BINDINGS } from '../../client/battle/pilotControls.js';
import { createFeedBase } from '../../client/battle/feed.js';

function rig(pilot = true, startOptions = {}) {
  const doc = new EventTarget(), win = new EventTarget(), canvas = new EventTarget();
  doc.visibilityState = 'visible'; doc.activeElement = null;
  canvas.getBoundingClientRect = () => ({ left: 20, top: 30 });
  const base = createFeedBase({ isLocal: true }), commands = [], followed = [], statuses = [];
  const controls = { speed: 1, paused: false, pilot: (input) => commands.push(input) };
  const feed = { ...base, controls, get lastStart() { return base.lastStart; } };
  base.emitStart({ world: { w: 1000, h: 800 }, players: [{ id: 'p1', team: 0, pilot }], ships: pilot ? [{ id: 7, owner: 'p1', cls: 'ter_ace', pilot: true }] : [], ...startOptions });
  let tick, period, cancelled = false;
  const controller = createPilotControls({ canvas, feed, myPlayerId: 'p1', doc, win,
    renderer: { camera: { follow: (id) => followed.push(id), raw: { screenToWorld: (x, y) => ({ x: x * 2, y: y * 2 }) } } },
    onState: (state) => statuses.push(state), setInterval: (fn, ms) => { tick = fn; period = ms; return 1; }, clearInterval: () => { cancelled = true; } });
  controller.update({ ships: new Map([[7, { x: 100, y: 200, a: 0 }]]) });
  const event = (target, type, props = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, props); target.dispatchEvent(e); return e;
  };
  return { base, doc, win, canvas, controller, commands, controls, followed, statuses, event, tick: () => tick(), period, get cancelled() { return cancelled; } };
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

test('short keyboard and pointer taps survive until exactly one 100 ms heartbeat without extra transmissions', () => {
  const r = rig();
  try {
    r.controller.setEnabled(true);
    assert.equal(r.period, 100, 'network heartbeat stays at 10 inputs per second');
    const before = r.commands.length;
    for (const code of ['KeyF', 'KeyE']) {
      r.event(r.doc, 'keydown', { code }); r.event(r.doc, 'keyup', { code });
    }
    assert.equal(r.commands.length, before, 'keypresses never add network sends');
    r.tick();
    assert.equal(r.commands.length, before + 1);
    assert.equal(r.commands.at(-1).fire, true); assert.equal(r.commands.at(-1).ability, true);
    r.tick();
    assert.equal(r.commands.at(-1).fire, false); assert.equal(r.commands.at(-1).ability, false);
    const afterKeys = r.commands.length;
    r.event(r.canvas, 'pointerdown', { button: 0, clientX: 420, clientY: 130 });
    r.event(r.win, 'pointerup');
    assert.equal(r.commands.length, afterKeys);
    r.tick(); assert.equal(r.commands.at(-1).fire, true);
    assert.equal(r.commands.at(-1).aimX, 800);
    r.tick(); assert.equal(r.commands.at(-1).fire, false);
  } finally { r.controller.dispose(); }
});

test('held keys keep firing but autorepeat cannot create an extra shot after release', () => {
  const r = rig();
  try {
    r.controller.setEnabled(true);
    for (const code of ['KeyF', 'KeyE']) r.event(r.doc, 'keydown', { code });
    r.tick(); r.tick();
    assert.equal(r.commands.at(-1).fire, true); assert.equal(r.commands.at(-1).ability, true);
    for (const code of ['KeyF', 'KeyE']) {
      r.event(r.doc, 'keydown', { code, repeat: true }); r.event(r.doc, 'keyup', { code });
    }
    r.tick();
    assert.equal(r.commands.at(-1).fire, false); assert.equal(r.commands.at(-1).ability, false);
  } finally { r.controller.dispose(); }
});

test('takeover release, focus loss, pause and disconnect discard taps before resuming manual control', () => {
  const losses = [
    r => r.controller.setEnabled(false),
    r => r.event(r.win, 'blur'),
    r => { r.doc.visibilityState = 'hidden'; r.event(r.doc, 'visibilitychange'); },
    r => { r.doc.activeElement = { tagName: 'INPUT' }; r.tick(); },
    r => { r.controls.paused = true; r.tick(); },
    r => { r.controls.speed = 0; r.tick(); },
    r => r.controller.setSuspended(true),
    r => r.base.emitStatus('reconnecting'),
    r => r.controller.setBindings(DEFAULT_PILOT_BINDINGS),
  ];
  for (const lose of losses) {
    const r = rig();
    try {
      r.controller.setEnabled(true);
      for (const code of ['KeyF', 'KeyE']) {
        r.event(r.doc, 'keydown', { code }); r.event(r.doc, 'keyup', { code });
      }
      r.event(r.canvas, 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
      r.event(r.win, 'pointerup');
      lose(r);
      assert.equal(r.controller.state.manual, false);
      r.doc.visibilityState = 'visible'; r.doc.activeElement = null;
      r.controls.speed = 1; r.controls.paused = false;
      r.base.emitStatus('ok'); r.controller.setSuspended(false);
      r.controller.setEnabled(true); r.tick();
      assert.equal(r.commands.at(-1).fire, false, 'a prior tap cannot fire after takeover');
      assert.equal(r.commands.at(-1).ability, false);
    } finally { r.controller.dispose(); }
  }
});

test('pointer cancellation removes its pending shot without dropping an independent keyboard tap', () => {
  const r = rig();
  try {
    r.controller.setEnabled(true);
    r.event(r.canvas, 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    r.event(r.win, 'pointercancel'); r.tick();
    assert.equal(r.commands.at(-1).fire, false);
    r.event(r.doc, 'keydown', { code: 'KeyF' }); r.event(r.doc, 'keyup', { code: 'KeyF' });
    r.event(r.canvas, 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    r.event(r.win, 'pointercancel'); r.tick();
    assert.equal(r.commands.at(-1).fire, true);
    r.controller.dispose();
    const count = r.commands.length; r.tick(); assert.equal(r.commands.length, count);
  } finally { r.controller.dispose(); }
});

test('cooldown and ship class come from authoritative start/frame data, never heartbeat or rendered state', () => {
  const r = rig(true, { tickRate: 40 });
  const frame = (k, abilityReadyAt) => r.base.emitFrame({ k, s: [[7, 0, 0, 0, 100]], p: [{ owner: 'p1', shipId: 7, abilityReadyAt }], e: [] });
  try {
    assert.equal(r.controller.state.shipClass, 'ter_ace');
    r.controller.setEnabled(true);
    r.event(r.doc, 'keydown', { code: 'KeyE' }); r.event(r.doc, 'keyup', { code: 'KeyE' }); r.tick();
    assert.equal(r.controller.state.abilityReady, true, 'sending an ability request does not invent a cooldown');
    frame(10, 99);
    assert.equal(r.controller.state.abilityCooldown, 2.3);
    assert.equal(r.controller.state.abilityReady, false);
    r.tick(); r.tick();
    r.controller.update({ ships: new Map([[7, { x: 1, y: 2, cls: 'not-authoritative', abilityReadyAt: 0 }]]) });
    assert.equal(r.controller.state.abilityCooldown, 2.3, 'presentation and wall time cannot reduce cooldown');
    assert.equal(r.controller.state.shipClass, 'ter_ace');
    frame(98, 99); assert.equal(r.controller.state.abilityCooldown, 0.1);
    assert.equal(r.controller.state.abilityReady, false);
    frame(99, 99); assert.equal(r.controller.state.abilityCooldown, 0);
    assert.equal(r.controller.state.abilityReady, true);
    assert.equal(r.statuses.at(-1).abilityCooldown, 0);
  } finally { r.controller.dispose(); }
  const fallback = rig(true, { k: 10, p: [{ owner: 'p1', shipId: 7, abilityReadyAt: 80 }] });
  try {
    assert.equal(fallback.controller.state.abilityCooldown, 3.5, 'missing tickRate uses 20 Hz');
    assert.equal(fallback.controller.state.abilityReady, false);
  } finally { fallback.controller.dispose(); }
});
