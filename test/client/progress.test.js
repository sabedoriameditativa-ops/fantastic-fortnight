// Star rules, score, next-star hints and team contribution (client/util/progress.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_sharedHook.mjs', import.meta.url);
const { rateBattle, battleScore, fleetHasCapital, capitalsLost, formatOf, isCampaignFormat, starGlyphs, STAR_RULES, SCORE_TIME_PENALTY_PER_S } = await import('../../client/util/progress.js');
const { presetFleet, fleetCost } = await import('../../shared/fleet.js');
const { createBattle, runToEnd, makeStartInfo } = await import('../../shared/sim/battle.js');
const { TICK_RATE } = await import('../../shared/constants.js');

const withCapital = presetFleet('ter_linha', 1500);         // Prometeu (mothership); Hércules is 'large', Atlas is the Terran capital
const noCapital = { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 10 }, { cls: 'ter_vespa', count: 10 }] };

/** Minimal start/result pair for a 1v1 (team 0 = me). */
function scenario({ fleet = withCapital, winner = 0, ticks = 20 * 30, valueAlive, damageDealt = 1000, lost = {}, mates = [] } = {}) {
  const value = fleetCost(fleet);
  const start = { tickRate: TICK_RATE, players: [
    { id: 'p1', name: 'Ana', team: 0, isBot: false, faction: fleet.faction, fleet },
    ...mates.map((m, i) => ({ id: `m${i}`, name: `M${i}`, team: 0, isBot: true, faction: 'terran', fleet: noCapital, ...m })),
    { id: 'e1', name: 'Bot', team: 1, isBot: true, faction: 'vorrax', fleet: presetFleet('vor_mare', 1500) },
  ] };
  const players = { p1: { damageDealt, damageTaken: 0, healing: 0, kills: 0, losses: 0, shipsTotal: 10, shipsAlive: 5, valueAlive: valueAlive ?? Math.round(value * 0.6), lost, damageByType: {} },
    e1: { damageDealt: 500, damageTaken: 0, healing: 0, kills: 0, losses: 0, shipsTotal: 10, shipsAlive: 0, valueAlive: 0, lost: {}, damageByType: {} } };
  mates.forEach((m, i) => { players[`m${i}`] = { damageDealt: m.damageDealt || 0, valueAlive: 0, shipsAlive: 1, lost: {}, damageByType: {} }; });
  return { start, result: { winner, reason: 'elimination', ticks, remainingValue: [0, 0], players, mvp: null, killers: [null, null] }, value };
}

describe('star rules', () => {
  test('1 star = win; 2 = ≥ 50% of the fleet value left; 3 = fast or capital intact (additive)', () => {
    assert.equal(STAR_RULES.valueFrac, 0.5);
    assert.equal(STAR_RULES.fastSeconds, 60);
    // fast win, capital intact, 60% left → 3 stars
    let s = scenario({ ticks: 20 * 30 });
    let r = rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' });
    assert.equal(r.won, true); assert.equal(r.stars, 3); assert.deepEqual(r.missing, []);
    assert.equal(r.fast, true); assert.equal(r.hadCapital, true); assert.equal(r.capitalIntact, true);
    // slow win, capital lost, 60% left → 2 stars, missing 'capital'
    s = scenario({ ticks: 20 * 90, lost: { ter_prometeu: 1 } });
    r = rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' });
    assert.equal(r.stars, 2); assert.deepEqual(r.missing, ['capital']); assert.equal(r.lostCapital, true);
    // slow win, capital intact, 30% left → 2 stars, missing 'value'
    s = scenario({ ticks: 20 * 90, valueAlive: Math.round(fleetCost(withCapital) * 0.3) });
    r = rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' });
    assert.equal(r.stars, 2); assert.deepEqual(r.missing, ['value']);
    assert.ok(Math.abs(r.remainingFrac - 0.3) < 0.01);
    // slow win, no capital in the fleet, 30% left → 1 star, both missing (a fleet without capitals cannot claim 'capital intact')
    s = scenario({ fleet: noCapital, ticks: 20 * 90, valueAlive: 200 });
    r = rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' });
    assert.equal(r.stars, 1); assert.deepEqual(r.missing, ['value', 'capital']); assert.equal(r.hadCapital, false); assert.equal(r.capitalIntact, false);
    // fast win without capitals still earns the 3rd star
    s = scenario({ fleet: noCapital, ticks: 20 * 40, valueAlive: 200 });
    assert.equal(rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' }).stars, 2);
    s = scenario({ fleet: noCapital, ticks: 20 * 40, valueAlive: 1000 });
    assert.equal(rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' }).stars, 3);
    // exactly 60 s is not "under 60 s"; exactly 50% counts
    s = scenario({ ticks: 20 * 60, lost: { ter_prometeu: 1 }, valueAlive: Math.round(fleetCost(withCapital) * 0.5) });
    r = rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' });
    assert.equal(r.fast, false); assert.equal(r.stars, 2);
  });

  test('a loss is 0 stars with no hints; unknown per-class losses never grant the capital star', () => {
    let s = scenario({ winner: 1 });
    let r = rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' });
    assert.equal(r.won, false); assert.equal(r.stars, 0); assert.deepEqual(r.missing, []);
    s = scenario({ ticks: 20 * 90 });
    delete s.result.players.p1.lost; // older server result without per-class data
    r = rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' });
    assert.equal(r.lostCapital, null); assert.equal(r.capitalIntact, false); assert.equal(r.stars, 2);
    assert.equal(rateBattle({ result: s.result, start: s.start, myPlayerId: 'nobody' }), null);
  });

  test('score = remaining value + damage dealt − 4 × seconds, never negative', () => {
    assert.equal(SCORE_TIME_PENALTY_PER_S, 4);
    assert.equal(battleScore({ valueAlive: 900, damageDealt: 1500 }, 20 * 30), 900 + 1500 - 120);
    assert.equal(battleScore({ valueAlive: 0, damageDealt: 10 }, 20 * 240), 0);
    const s = scenario({ ticks: 20 * 45, valueAlive: 700, damageDealt: 2000 });
    assert.equal(rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' }).score, 700 + 2000 - 180);
  });

  test('team formats: share of the team damage; 1v1 has no contribution', () => {
    const s = scenario({ mates: [{ damageDealt: 3000 }], damageDealt: 1000 });
    const r = rateBattle({ result: s.result, start: s.start, myPlayerId: 'p1' });
    assert.ok(r.contribution);
    assert.equal(r.contribution.mates, 2);
    assert.ok(Math.abs(r.contribution.share - 0.25) < 1e-9);
    assert.equal(rateBattle({ result: scenario().result, start: scenario().start, myPlayerId: 'p1' }).contribution, null);
    assert.equal(formatOf(1), '1v1'); assert.equal(formatOf(3), '3v3'); assert.equal(formatOf('x'), '1v1'); assert.equal(formatOf(9), '6v6');
    assert.equal(isCampaignFormat(1), true); assert.equal(isCampaignFormat(2), false);
  });

  test('helpers: capital detection, glyphs', () => {
    assert.equal(fleetHasCapital(withCapital), true);
    assert.equal(fleetHasCapital(noCapital), false);
    assert.equal(capitalsLost({ lost: { ter_vespa: 3, ter_hercules: 1, ter_atlas: 1, ter_prometeu: 1 } }), 2);
    assert.equal(capitalsLost({ lost: {} }), 0);
    assert.equal(capitalsLost({}), null);
    assert.equal(starGlyphs(0), '☆☆☆'); assert.equal(starGlyphs(2), '★★☆'); assert.equal(starGlyphs(7), '★★★');
  });

  test('rates a real simulated battle consistently with its result', () => {
    const config = { seed: 5, players: [
      { id: 'p1', name: 'Ana', team: 0, isBot: false, ai: 'especialista', fleet: withCapital },
      { id: 'e1', name: 'Bot', team: 1, isBot: true, ai: 'facil', fleet: presetFleet('vor_mare', 1000) },
    ] };
    const start = makeStartInfo(config, createBattle(config));
    const result = runToEnd(config);
    const r = rateBattle({ result, start, myPlayerId: 'p1' });
    assert.ok(r);
    assert.equal(r.won, result.winner === 0);
    assert.equal(r.seconds, result.ticks / TICK_RATE);
    assert.ok(r.remainingFrac >= 0 && r.remainingFrac <= 1);
    if (r.won) assert.ok(r.stars >= 1 && r.stars <= 3); else assert.equal(r.stars, 0);
    assert.equal(r.score, battleScore(result.players.p1, result.ticks));
  });
});
