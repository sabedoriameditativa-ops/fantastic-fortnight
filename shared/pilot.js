// Pure, authoritative pilot commands. No wall clock, DOM, client damage or positions.
import { ABILITIES } from './catalog.js';
import { TICK_RATE } from './constants.js';
import { makeShip, updateStatus } from './sim/ship.js';
import { registerShip } from './sim/effects.js';
import { ABILITY_REGISTRY } from './sim/abilities.js';

export const PILOT_COST = 200;
export const PILOT_INPUT_TIMEOUT = TICK_RATE; // missing heartbeat gives control to AI after 1 s
export const SPECIAL_SHIPS = Object.freeze({ terran: 'ter_ace', vorrax: 'vor_ace', lumen: 'lum_ace', ferrix: 'fer_ace', astral: 'ast_ace' });

export function initPilots(state) {
  state.pilots = Object.create(null);
  for (const p of state.config.players) {
    if (p.pilot !== true || !SPECIAL_SHIPS[p.fleet.faction]) continue;
    const owned = state.ships.filter((s) => s.owner === p.id);
    const x = owned.length ? owned.reduce((n, s) => n + s.x, 0) / owned.length : (p.team ? 0.8 : 0.2) * state.world.w;
    const y = owned.length ? owned.reduce((n, s) => n + s.y, 0) / owned.length : state.world.h / 2;
    const s = makeShip({ id: state.nextId++, cls: SPECIAL_SHIPS[p.fleet.faction], owner: p.id, team: p.team, x, y,
      heading: p.team ? Math.PI : 0, tick: 0, slot: state.alive[p.team].length });
    s.planning = p.fleet.planning;
    const control = { shipId: s.id, owner: p.id, manual: false, lastSeq: -1, lastInputTick: 0, moveX: 0, moveY: 0,
      aimX: x + (p.team ? -200 : 200), aimY: y, fire: false, ability: false };
    state.pilots[p.id] = control; s.pilotControl = control;
    state.ships.push(s); state.alive[p.team].push(s.id); state.alivePurchased[p.team]++;
    state.stats[p.id].shipsTotal++; state.stats[p.id].shipsAlive++;
    registerShip(state, s);
    state.initialShips.push({ id: s.id, cls: s.cls, owner: p.id, team: p.team, x, y, a: s.heading, pilot: true });
  }
}

/** Accept an input for the next simulation tick. The server supplies ownerId. */
export function applyPilotInput(state, ownerId, input) {
  const c = state.pilots?.[ownerId];
  if (state.ended) return { ok: false, code: 'PILOT_ENDED' };
  if (!c) return { ok: false, code: 'PILOT_UNAVAILABLE' };
  if (!state.ships[c.shipId - 1]?.alive) return { ok: false, code: 'PILOT_DEAD' };
  if (input && typeof input === 'object' && !Array.isArray(input) && input.manual === false) {
    input = { ...input, moveX: 0, moveY: 0, aimX: c.aimX, aimY: c.aimY, fire: false, ability: false };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !Number.isSafeInteger(input.seq) || input.seq < 0 || input.seq > 0x7fffffff ||
    typeof input.manual !== 'boolean' || typeof input.fire !== 'boolean' || typeof input.ability !== 'boolean' ||
    !Number.isFinite(input.moveX) || Math.abs(input.moveX) > 1 || !Number.isFinite(input.moveY) || Math.abs(input.moveY) > 1 ||
    !Number.isFinite(input.aimX) || input.aimX < 0 || input.aimX > state.world.w ||
    !Number.isFinite(input.aimY) || input.aimY < 0 || input.aimY > state.world.h) return { ok: false, code: 'PILOT_BAD_INPUT' };
  if (input.seq <= c.lastSeq) return { ok: false, code: 'PILOT_STALE_INPUT' };
  const len = Math.hypot(input.moveX, input.moveY);
  c.lastSeq = input.seq; c.lastInputTick = state.tick;
  c.manual = input.manual; c.moveX = input.moveX / Math.max(1, len); c.moveY = input.moveY / Math.max(1, len);
  c.aimX = input.aimX; c.aimY = input.aimY; c.fire = input.manual && input.fire; c.ability = input.manual && input.ability;
  const ship = state.ships[c.shipId - 1];
  ship.ability.pendingAt = -1; ship.ai.nextThink = state.tick + 1;
  return { ok: true, shipId: c.shipId, tick: state.tick + 1 };
}

/** Neutralize on server disconnect/focus loss without fabricating client sequence numbers. */
export function releasePilot(state, ownerId) {
  const c = state.pilots?.[ownerId];
  if (!c) return;
  c.manual = false; c.fire = false; c.ability = false; c.moveX = 0; c.moveY = 0;
  const ship = state.ships[c.shipId - 1]; if (ship) ship.ai.nextThink = state.tick;
}

export function tickPilots(state) {
  for (const c of Object.values(state.pilots || {})) {
    const ship = state.ships[c.shipId - 1];
    if (c.manual && (!ship.alive || state.tick - c.lastInputTick > PILOT_INPUT_TIMEOUT)) releasePilot(state, c.owner);
    if (!c.manual) continue;
    ship.ai.retreating = false; ship.ai.mode = 'manual';
    const ab = ship.ability;
    if (c.ability && ab.readyAt <= state.tick && ship.stunUntil <= state.tick) {
      const impl = ABILITY_REGISTRY[ab.id];
      // Every pilot ability is self-centred: the client never chooses a victim or heal amount.
      impl.cast({ state, me: ship, tick: state.tick, target: null, team: state.teams[ship.team], P: state.profiles[ship.owner], rng: state.rng, incoming: ship.incoming });
      ab.readyAt = state.tick + Math.round(ABILITIES[ab.id].cooldown * TICK_RATE);
      c.ability = false; updateStatus(ship, state.tick);
    }
  }
}

export function pilotSnapshot(state) {
  return Object.values(state.pilots || {}).map((c) => ({ owner: c.owner, shipId: c.shipId,
    manual: c.manual && state.ships[c.shipId - 1].alive, abilityReadyAt: state.ships[c.shipId - 1].ability.readyAt, lastSeq: c.lastSeq }));
}
