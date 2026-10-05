import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createInterpolator, lerpAngle, decodeAngle } from '../../client/battle/interpolator.js';

const TICK_MS = 50, EVERY = 2;

/** Build a frame with ships moving at constant velocity. */
function frame(k, ships, at, e = []) {
  return {
    k, at, e,
    s: ships.map((s) => [s.id, Math.round(s.x * 10), Math.round(s.y * 10), s.h ?? 0, s.hp ?? 1000, s.sh ?? 0, s.flags ?? 0]),
  };
}

function steadyFeed(ip, nFrames, fn, startAt = 0) {
  for (let i = 0; i < nFrames; i++) {
    const k = i * EVERY, at = startAt + i * TICK_MS * EVERY;
    ip.push(frame(k, fn(k), at));
  }
}

describe('lerpAngle / decodeAngle', () => {
  test('shortest arc across the ±π seam', () => {
    const a = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    assert.ok(Math.abs(Math.abs(a) - Math.PI) < 1e-9, `got ${a}`);
    assert.ok(Math.abs(lerpAngle(0, Math.PI / 2, 0.5) - Math.PI / 4) < 1e-9);
    assert.ok(Math.abs(lerpAngle(0.2, -0.2, 0.5)) < 1e-9);
  });
  test('result stays within (-π, π]', () => {
    for (let i = 0; i < 100; i++) {
      const a = lerpAngle(-3, 3, i / 100);
      assert.ok(a > -Math.PI - 1e-9 && a <= Math.PI + 1e-9);
    }
  });
  test('decodeAngle maps 0..255 to radians', () => {
    assert.equal(decodeAngle(0), 0);
    assert.ok(Math.abs(decodeAngle(64) - Math.PI / 2) < 1e-9);
    assert.ok(Math.abs(decodeAngle(192) + Math.PI / 2) < 1e-9);
    assert.ok(Math.abs(Math.abs(decodeAngle(128)) - Math.PI) < 1e-9);
  });
});

describe('interpolator', () => {
  test('sample before any frame returns an empty map', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 120 });
    const r = ip.sample(1000);
    assert.equal(r.ships.size, 0);
    assert.deepEqual(r.events, []);
  });

  test('steady feed: presentation tick runs delayMs behind the newest frame', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 120 });
    const vel = 100; // u/s along x
    const pos = (k) => [{ id: 1, x: 100 + vel * (k * TICK_MS) / 1000, y: 200, h: 0 }];
    // feed 21 frames (k = 0..40) at 100 ms intervals and sample every 16 ms
    let now = 0;
    for (let i = 0; i <= 20; i++) {
      const k = i * EVERY;
      ip.push(frame(k, pos(k), i * 100));
      const until = (i + 1) * 100;
      while (now < until) { ip.sample(now); now += 16; }
    }
    const r = ip.sample(now); // now = 2096
    // newest frame k=40 at t=2000 → target = 40 + 96/50 - 120/50 = 39.52
    const expectedTick = 40 + (now - 2000) / TICK_MS - 120 / TICK_MS;
    assert.ok(Math.abs(r.tick - expectedTick) < 0.15, `tick ${r.tick} vs ${expectedTick}`);
    const v = r.ships.get(1);
    assert.ok(v, 'ship present');
    const expectedX = 100 + vel * (r.tick * TICK_MS) / 1000;
    assert.ok(Math.abs(v.x - expectedX) < 0.6, `x ${v.x} vs ${expectedX}`);
    assert.equal(v.y, 200);
    assert.ok(Math.abs(v.vx - vel) < 1e-6);
    assert.equal(r.extrapolating, false);
  });

  test('lerps x/y and heading (shortest arc), hp/sh from the newer frame', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 0, maxExtrapolateMs: 0 });
    ip.push(frame(0, [{ id: 7, x: 0, y: 0, h: 250, hp: 1000, sh: 500 }], 0));
    ip.push(frame(2, [{ id: 7, x: 100, y: 50, h: 6, hp: 800, sh: 300 }], 100));
    ip.push(frame(4, [{ id: 7, x: 200, y: 100, h: 20, hp: 600, sh: 100 }], 200));
    ip.sample(0);
    // presentation at now=150 → target = 4 + (150-200)*rate ... clamp; drive the clock to tick 1
    let r = ip.sample(50);
    assert.ok(r.tick >= 0 && r.tick <= 4);
    // force exact position: sample until tick ≈ 1
    const ip2 = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 100, maxExtrapolateMs: 0 });
    ip2.push(frame(0, [{ id: 7, x: 0, y: 0, h: 250, hp: 1000, sh: 500 }], 0));
    ip2.push(frame(2, [{ id: 7, x: 100, y: 50, h: 6, hp: 800, sh: 300 }], 100));
    r = ip2.sample(150); // target = 2 + (150-100)/50 - 100/50 = 1
    assert.ok(Math.abs(r.tick - 1) < 1e-9, `tick ${r.tick}`);
    const v = r.ships.get(7);
    assert.ok(Math.abs(v.x - 50) < 1e-6 && Math.abs(v.y - 25) < 1e-6);
    // heading 250 ≈ -0.147 rad, 6 ≈ +0.147 rad → midpoint ≈ 0 (shortest arc, not through π)
    assert.ok(Math.abs(v.a) < 1e-6, `heading ${v.a}`);
    assert.equal(v.hp, 800);
    assert.equal(v.sh, 300);
  });

  test('events are released when the presentation tick crosses their frame, in order', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 100, maxExtrapolateMs: 0 });
    const s = [{ id: 1, x: 0, y: 0 }];
    ip.push(frame(0, s, 0, [['phase', 'engage']]));
    ip.push(frame(2, s, 100, [['shot', 1, 2, 0, 1], ['hit', 2, 5, 'kinetic', 0]]));
    ip.push(frame(4, s, 200, [['die', 2, 1, 0, 0]]));
    let r = ip.sample(200); // target = 4 - 2 = 2 → frames 0 and 2 crossed
    assert.deepEqual(r.events.map((e) => e[0]), ['phase', 'shot', 'hit']);
    r = ip.sample(250);     // tick 3 → nothing new
    assert.deepEqual(r.events, []);
    r = ip.sample(300);     // tick 4 → die
    assert.deepEqual(r.events.map((e) => e[0]), ['die']);
    r = ip.sample(350);
    assert.deepEqual(r.events, []);
  });

  test('a dying ship keeps its last state until its frame is crossed, then disappears', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 100, maxExtrapolateMs: 0 });
    ip.push(frame(0, [{ id: 1, x: 0, y: 0 }, { id: 2, x: 500, y: 0, hp: 100 }], 0));
    ip.push(frame(2, [{ id: 1, x: 10, y: 0 }, { id: 2, x: 510, y: 0, hp: 50 }], 100));
    ip.push(frame(4, [{ id: 1, x: 20, y: 0 }], 200, [['die', 2, 1, 510, 0]]));
    let r = ip.sample(250); // tick 3: between frame 2 and 4 → ship 2 held at frame-2 state
    assert.ok(Math.abs(r.tick - 3) < 1e-9);
    assert.ok(r.ships.has(2));
    assert.equal(r.ships.get(2).x, 510);
    assert.equal(r.ships.get(2).hp, 50);
    assert.equal(r.ships.get(1).x, 15);
    r = ip.sample(300);     // tick 4: die event released, ship gone
    assert.deepEqual(r.events.map((e) => e[0]), ['die']);
    assert.ok(!r.ships.has(2));
    assert.ok(r.ships.has(1));
  });

  test('bounded extrapolation when the buffer runs dry', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 0, maxExtrapolateMs: 100 });
    ip.push(frame(0, [{ id: 1, x: 0, y: 0 }], 0));
    ip.push(frame(2, [{ id: 1, x: 100, y: 0 }], 100)); // 1000 u/s
    ip.sample(100);
    const r1 = ip.sample(150); // 50 ms past newest → x ≈ 150
    assert.ok(r1.extrapolating);
    assert.ok(Math.abs(r1.ships.get(1).x - 150) < 1e-6, `x ${r1.ships.get(1).x}`);
    const r2 = ip.sample(1000); // clamped to +100 ms → x = 200, tick = 4
    assert.ok(Math.abs(r2.ships.get(1).x - 200) < 1e-6, `x ${r2.ships.get(1).x}`);
    assert.ok(Math.abs(r2.tick - 4) < 1e-9);
  });

  test('speed change (frames arriving 4x faster) is tracked without unbounded lag', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 120 });
    const pos = (k) => [{ id: 1, x: k, y: 0 }];
    let now = 0, k = 0;
    // 1x for 2 s
    for (let i = 0; i < 20; i++) { ip.push(frame(k, pos(k), now)); k += 2; for (let j = 0; j < 6; j++) ip.sample(now + j * 16); now += 100; }
    // 4x for 2 s (frames every 25 ms)
    for (let i = 0; i < 80; i++) { ip.push(frame(k, pos(k), now)); k += 2; ip.sample(now + 12); now += 25; }
    const r = ip.sample(now);
    const newest = k - 2;
    const lagTicks = newest - r.tick;
    // delay 120 ms at 4x = 9.6 ticks; allow convergence slack
    assert.ok(lagTicks > 4 && lagTicks < 16, `lag ${lagTicks} ticks`);
    assert.ok(ip.ticksPerSec > 60, `rate ${ip.ticksPerSec}`);
  });

  test('a sub-second pause does not drag the tick-rate estimate down (single long gap ignored)', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 120 });
    const pos = (k) => [{ id: 1, x: k, y: 0 }];
    let now = 0, k = 0;
    for (let i = 0; i < 20; i++) { ip.push(frame(k, pos(k), now)); k += 2; now += 100; }
    assert.ok(Math.abs(ip.ticksPerSec - 20) < 0.5, `steady rate ${ip.ticksPerSec}`);
    now += 800; // paused (speed 0) for 800 ms, then resumed at 1x
    const rates = [];
    for (let i = 0; i < 12; i++) { ip.push(frame(k, pos(k), now)); k += 2; now += 100; rates.push(ip.ticksPerSec); }
    for (const r of rates) assert.ok(r > 19.5 && r < 20.5, `rate after unpause ${rates.map((x) => x.toFixed(1)).join(' ')}`);
  });

  test('a sustained slowdown (x4 → x1) is still tracked', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 120 });
    const pos = (k) => [{ id: 1, x: k, y: 0 }];
    let now = 0, k = 0;
    for (let i = 0; i < 80; i++) { ip.push(frame(k, pos(k), now)); k += 2; now += 25; }
    assert.ok(ip.ticksPerSec > 60, `x4 rate ${ip.ticksPerSec}`);
    for (let i = 0; i < 40; i++) { ip.push(frame(k, pos(k), now)); k += 2; now += 100; }
    assert.ok(ip.ticksPerSec < 24, `x1 rate after slowdown ${ip.ticksPerSec}`);
  });

  test('a pause (no frames) freezes at the extrapolation bound and resumes cleanly', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 120, maxExtrapolateMs: 100 });
    const pos = (k) => [{ id: 1, x: k * 5, y: 0 }];
    let now = 0, k = 0;
    for (let i = 0; i < 10; i++) { ip.push(frame(k, pos(k), now)); k += 2; ip.sample(now + 50); now += 100; }
    const paused = ip.sample(now + 5000);
    assert.ok(paused.tick <= (k - 2) + 2 + 1e-9, 'never beyond newest + 2 ticks');
    // resume: frames continue from k
    now += 5000;
    for (let i = 0; i < 10; i++) { ip.push(frame(k, pos(k), now)); k += 2; ip.sample(now + 50); now += 100; }
    const r = ip.sample(now);
    assert.ok(Math.abs((k - 2) - r.tick) < 6, `resumed lag ${(k - 2) - r.tick}`);
    assert.ok(Math.abs(r.ships.get(1).x - r.tick * 5) < 1, 'position consistent with tick');
  });

  test('reset clears frames, ships and the clock', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 0 });
    ip.push(frame(0, [{ id: 1, x: 0, y: 0 }], 0));
    ip.sample(10);
    assert.equal(ip.ships.size, 1);
    ip.reset();
    assert.equal(ip.ships.size, 0);
    assert.equal(ip.frameCount, 0);
    assert.equal(ip.tick, -1);
    const r = ip.sample(20);
    assert.equal(r.ships.size, 0);
  });

  test('newShip decorator is applied to new views', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 0, newShip: (id) => ({ cls: 'cls' + id }) });
    ip.push(frame(0, [{ id: 3, x: 1, y: 2 }], 0));
    const r = ip.sample(0);
    assert.equal(r.ships.get(3).cls, 'cls3');
  });

  test('a restarted tick sequence (new battle) resets the buffer', () => {
    const ip = createInterpolator({ tickMs: TICK_MS, snapshotEvery: EVERY, delayMs: 0 });
    let now = 0;
    for (let k = 0; k < 200; k += 2) { ip.push(frame(k, [{ id: 1, x: k, y: 0 }], now)); now += 100; }
    ip.sample(now);
    ip.push(frame(0, [{ id: 9, x: 0, y: 0 }], now + 100));
    const r = ip.sample(now + 100);
    assert.ok(r.ships.has(9));
    assert.ok(!r.ships.has(1));
  });
});
