import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSimLoop } from '../../client/util/simLoop.js';

/** Deterministic fake clock + timer queue. */
function fakeClock() {
  let now = 0;
  const timers = [];
  const schedule = (fn, ms) => { const h = { fn, at: now + ms, seq: timers.length }; timers.push(h); return h; };
  const cancel = (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); };
  const advance = (ms) => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const h = timers[0];
      if (!h || h.at > target) break;
      now = Math.max(now, h.at); timers.shift(); h.fn();
    }
    now = target;
  };
  /** Jump the clock without firing timers (a stalled main thread). */
  const jump = (ms) => { now += ms; };
  return { now: () => now, schedule, cancel, advance, jump, get pending() { return timers.length; } };
}

/** Fake simulation: one ship, ends at `endTick`. */
function fakeSim(endTick = Infinity) {
  const state = { tick: 0, ended: null };
  return {
    state,
    step: (s) => { s.tick++; const ev = [['tick', s.tick]]; if (s.tick >= endTick) { s.ended = { winner: 0, reason: 'timeout', ticks: s.tick }; ev.push(['end', 0, 'timeout']); } return ev; },
    snapshot: (s) => ({ k: s.tick, s: [[1, s.tick * 10, 0, 0, 1000, 0, 0]] }),
    result: (s) => s.ended,
  };
}

function make(opts = {}, endTick) {
  const clock = fakeClock();
  const sim = fakeSim(endTick);
  const frames = [], ends = [];
  const loop = createSimLoop({
    ...sim, tickMs: 50, snapshotEvery: 2, now: clock.now, schedule: clock.schedule, cancel: clock.cancel,
    onFrame: (f) => frames.push(f), onEnd: (r) => ends.push(r), ...opts,
  });
  return { clock, sim, loop, frames, ends };
}

describe('createSimLoop', () => {
  test('emits an initial k=0 frame, then one frame every snapshotEvery ticks with the events in between', () => {
    const { clock, loop, frames } = make();
    loop.start();
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], { k: 0, s: [[1, 0, 0, 0, 1000, 0, 0]], e: [] });
    clock.advance(100);
    assert.equal(frames.length, 2);
    assert.equal(frames[1].k, 2);
    assert.deepEqual(frames[1].e, [['tick', 1], ['tick', 2]]);
    clock.advance(1000);
    assert.equal(frames[frames.length - 1].k, 22);
    for (let i = 1; i < frames.length; i++) assert.equal(frames[i].k - frames[i - 1].k, 2, 'frames every 2 ticks');
  });

  test('speed scales the tick rate; speed 0 and pause stop the clock without catch-up', () => {
    const { clock, loop, sim } = make({ speed: 4 });
    loop.start();
    clock.advance(1000);
    assert.equal(sim.state.tick, 80, '4x → 80 ticks per second');
    loop.setSpeed(0);
    clock.advance(5000);
    assert.equal(sim.state.tick, 80, 'paused at speed 0');
    assert.equal(clock.pending, 0, 'no timers while dormant');
    loop.setSpeed(1);
    clock.advance(500);
    assert.equal(sim.state.tick, 90, 'no catch-up after resuming');
    loop.setPaused(true);
    clock.advance(2000);
    assert.equal(sim.state.tick, 90);
    assert.equal(loop.paused, true);
    loop.setPaused(false);
    clock.advance(500);
    assert.equal(sim.state.tick, 100);
    loop.setSpeed(2);
    clock.advance(500);
    assert.equal(sim.state.tick, 120);
  });

  test('bounds catch-up after a long stall instead of spiraling', () => {
    const { clock, loop, sim } = make({ maxCatchUpTicks: 8 });
    loop.start();
    clock.advance(100);
    assert.equal(sim.state.tick, 2);
    clock.jump(10_000);      // the thread stalled for 10 s: the pending wakeup fires late
    clock.advance(0);
    assert.equal(sim.state.tick, 10, 'at most 8 catch-up ticks for the stall');
    clock.advance(1000);     // backlog dropped: normal pacing resumes
    assert.equal(sim.state.tick, 30);
  });

  test('ends exactly once with the result and stops scheduling', () => {
    const { clock, loop, frames, ends } = make({}, 7);
    loop.start();
    clock.advance(2000);
    assert.equal(ends.length, 1);
    assert.equal(ends[0].ticks, 7);
    const last = frames[frames.length - 1];
    assert.equal(last.k, 7, 'a final frame is emitted on the ending tick');
    assert.deepEqual(last.e[last.e.length - 1], ['end', 0, 'timeout']);
    assert.equal(loop.running, false);
    assert.equal(loop.ended, true);
    assert.equal(clock.pending, 0);
    const n = frames.length;
    clock.advance(1000);
    assert.equal(frames.length, n, 'no frames after the end');
  });

  test('stop() cancels timers; fastForward steps silently to a tick', () => {
    const { clock, loop, sim, frames } = make({ emitInitialFrame: false });
    loop.fastForward(10);
    assert.equal(sim.state.tick, 10);
    assert.equal(frames.length, 0);
    loop.start();
    clock.advance(100);
    assert.equal(frames[0].k, 12);
    assert.deepEqual(frames[0].e, [['tick', 11], ['tick', 12]], 'events of fast-forwarded ticks are not replayed');
    loop.stop();
    assert.equal(clock.pending, 0);
    clock.advance(1000);
    assert.equal(sim.state.tick, 12);
  });
});
