import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, hashState, makeSnapshot } from '../../shared/sim/battle.js';
import { applyPilotInput, releasePilot, SPECIAL_SHIPS, PILOT_COST } from '../../shared/pilot.js';
import { validateFleet } from '../../shared/fleet.js';
import { SHIPS } from '../../shared/catalog.js';
import { spawnDirectional, advanceProjectiles } from '../../shared/sim/weapons.js';
import { applyDamageQueue } from '../../shared/sim/damage.js';
import { clearGrid, insertGrid } from '../../shared/sim/spatial.js';
import { teleportShip } from '../../shared/sim/effects.js';

const config = (faction = 'terran') => ({ seed: 'pilot', players: [
  { id: 'a', team: 0, pilot: true, fleet: { faction, ships: [{ cls: Object.values(SHIPS).find((s) => s.faction === faction && !s.pilotOnly).id, count: 2 }] } },
  { id: 'b', team: 1, fleet: { faction: 'terran', ships: [{ cls: 'ter_hercules', count: 2 }] } },
] });
const command = (seq, extra = {}) => ({ seq, manual: true, moveX: 1, moveY: 1, aimX: 2000, aimY: 700, fire: true, ability: false, ...extra });

test('one optional specialist per player, costed and excluded from normal fleet purchases', () => {
  for (const faction of Object.keys(SPECIAL_SHIPS)) {
    const state = createBattle(config(faction)), c = state.pilots.a, s = state.ships[c.shipId - 1];
    assert.equal(s.cls, SPECIAL_SHIPS[faction]); assert.equal(s.cost, PILOT_COST);
    assert.equal(state.initialShips.filter((ship) => ship.pilot).length, 1);
    assert.equal(validateFleet({ faction, ships: [{ cls: s.cls, count: 1 }] }, 1500).ok, false);
    assert.equal(makeSnapshot(state).p[0].shipId, s.id);
  }
  const cfg = config(); delete cfg.players[0].pilot;
  assert.deepEqual(makeSnapshot(createBattle(cfg)).p, []);
});

test('pilot commands validate owner, sequence, finite bounds and clamp diagonal thrust', () => {
  const state = createBattle(config());
  assert.equal(applyPilotInput(state, 'b', command(0)).code, 'PILOT_UNAVAILABLE');
  for (const extra of [{ moveX: NaN }, { aimY: Infinity }, { moveX: 2 }, { aimX: -1 }, { seq: -1 }, { fire: 'true' }]) {
    assert.equal(applyPilotInput(state, 'a', command(0, extra)).code, 'PILOT_BAD_INPUT');
  }
  assert.equal(applyPilotInput(state, 'a', command(1)).ok, true);
  assert.equal(Math.hypot(state.pilots.a.moveX, state.pilots.a.moveY), 1);
  assert.equal(applyPilotInput(state, 'a', command(1)).code, 'PILOT_STALE_INPUT');
  assert.equal(applyPilotInput(state, 'a', { seq: 2, manual: false }).ok, true);
  assert.equal(state.pilots.a.manual, false);
});

test('manual movement/fire/ability replay deterministically, expire safely, respect death', () => {
  const a = createBattle(config()), b = createBattle(config());
  let emitted = 0;
  for (let tick = 0; tick < 50; tick++) {
    if (tick % 5 === 0 && tick < 25) for (const state of [a, b]) applyPilotInput(state, 'a', command(tick, { ability: tick === 0 }));
    emitted += stepBattle(a).filter((e) => e[0] === 'proj' && e[2] === a.pilots.a.shipId).length;
    stepBattle(b); assert.equal(hashState(a), hashState(b));
    const s = a.ships[a.pilots.a.shipId - 1]; assert.ok(Math.hypot(s.vx, s.vy) <= s.speed * s.mod.speedMul + 1e-8);
  }
  assert.ok(emitted > 0); assert.equal(a.pilots.a.manual, false, 'heartbeat expiry returns to AI');
  assert.ok(a.ships[a.pilots.a.shipId - 1].ability.readyAt > 50);
  releasePilot(a, 'a');
  a.ships[a.pilots.a.shipId - 1].alive = false;
  assert.equal(applyPilotInput(a, 'a', command(100)).code, 'PILOT_DEAD');
});

test('pilot in automatic mode preserves the bot difficulty think interval after heartbeat expiry', () => {
  const cfg = config(); cfg.players[0].isBot = true; cfg.players[0].ai = 'facil';
  const st = createBattle(cfg), ship = st.ships[st.pilots.a.shipId - 1];
  while (st.tick < 40) stepBattle(st);
  let thinks = 0;
  for (let i = 0; i < 32; i++) { const before = ship.ai.nextThink; stepBattle(st); if (ship.ai.nextThink !== before) thinks++; }
  assert.equal(thinks, 2, 'easy autopilot must think every 16 ticks, never every tick');
});

function shootingRange() {
  const st = createBattle(config()), s = st.ships[st.pilots.a.shipId - 1], t = st.ships.find((ship) => ship.owner === 'b');
  for (const ship of st.ships) { ship.x = 2400; ship.y = 1400; ship.prevX = ship.x; ship.prevY = ship.y; }
  s.x = 500; s.y = 500; t.x = 600; t.y = 500; t.prevX = t.x; t.prevY = t.y; t.shield = 0;
  clearGrid(st.grid); for (const ship of st.ships) insertGrid(st.grid, ship.id, ship.x, ship.y);
  return { st, s, t };
}

test('directional shots collide with first hull and can actually miss a moving target', () => {
  const { st, s, t } = shootingRange(), before = t.hp;
  const p = spawnDirectional(st, s, s.weapons[0], 0, 100);
  for (let i = 0; i < 8 && p.alive; i++) { st.tick++; advanceProjectiles(st); applyDamageQueue(st); }
  assert.ok(t.hp < before); assert.equal(p.alive, false);
  const second = shootingRange(); const hp = second.t.hp;
  const miss = spawnDirectional(second.st, second.s, second.s.weapons[0], 0, 100);
  second.t.y = second.t.prevY = 700;
  clearGrid(second.st.grid); for (const ship of second.st.ships) insertGrid(second.st.grid, ship.id, ship.x, ship.y);
  for (let i = 0; i < 40 && miss.alive; i++) { second.st.tick++; advanceProjectiles(second.st); applyDamageQueue(second.st); }
  assert.equal(second.t.hp, hp); assert.equal(miss.alive, false);
});

test('swept collisions catch hull crossing a fast projectile between ticks', () => {
  const { st, s, t } = shootingRange();
  t.x = t.prevX = 525; t.prevY = 450; t.y = 550;
  const p = spawnDirectional(st, s, s.weapons[0], 0, 100); st.tick++;
  const hp = t.hp; advanceProjectiles(st); applyDamageQueue(st);
  assert.equal(p.alive, false); assert.ok(t.hp < hp);
});

test('instant teleport paths do not collide with directional projectiles', () => {
  const { st, s, t } = shootingRange();
  t.x = t.prevX = 525; t.y = t.prevY = 450;
  const p = spawnDirectional(st, s, s.weapons[0], 0, 100); st.tick++;
  teleportShip(st, t, 525, 550);
  const hp = t.hp; advanceProjectiles(st); applyDamageQueue(st);
  assert.equal(p.alive, true); assert.equal(t.hp, hp);
});

test('a teleport exit is collidable immediately, without a delayed spatial rebuild', () => {
  const { st, s, t } = shootingRange();
  t.x = t.prevX = 1500; t.y = t.prevY = 500;
  clearGrid(st.grid); for (const ship of st.ships) insertGrid(st.grid, ship.id, ship.x, ship.y);
  const p = spawnDirectional(st, s, s.weapons[0], 0, 100); st.tick++;
  teleportShip(st, t, 560, 500);
  const hp = t.hp; advanceProjectiles(st); applyDamageQueue(st);
  assert.equal(p.alive, false); assert.ok(t.hp < hp);
});
