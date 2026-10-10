// Post-battle debrief computations (client/util/debrief.js) and their pt-BR strings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_sharedHook.mjs', import.meta.url);
const { enemyHulls, multVs, bestTypesVs, shipsByClass, damageRows, topKillers, buildTips } = await import('../../client/util/debrief.js');
const { rateBattle } = await import('../../client/util/progress.js');
const { T, fmt } = await import('../../client/i18n.js');
const { presetFleet } = await import('../../shared/fleet.js');
const { DAMAGE_MULT, WEAPON_TYPE_NAMES, SHIPS } = await import('../../shared/catalog.js');
const { createBattle, runToEnd, makeStartInfo } = await import('../../shared/sim/battle.js');

const me = { id: 'p1', name: 'Ana', team: 0, faction: 'terran', fleet: presetFleet('ter_linha', 1500) };
const enemy = { id: 'e1', name: 'Bot', team: 1, faction: 'terran', fleet: presetFleet('ter_atlas', 1500) };
const start = { tickRate: 20, players: [me, enemy] };
function result(o = {}) {
  return {
    winner: o.winner ?? 0, reason: o.reason || 'elimination', ticks: o.ticks ?? 20 * 90, remainingValue: [0, 0],
    players: {
      p1: { damageDealt: 2000, valueAlive: o.valueAlive ?? 900, shipsAlive: 5, shipsTotal: 16, damageByType: o.damageByType || { kinetic: 1200, torpedo: 500, missile: 300 }, lost: o.lost || { ter_vespa: 5, ter_falcao: 1 } },
      e1: { damageDealt: 900, valueAlive: 0, shipsAlive: 0, shipsTotal: 7, damageByType: { flak: 900 }, lost: { ter_hercules: 4 } },
    },
    mvp: null,
    killers: o.killers || [{ shipId: 2, cls: 'ter_hercules', owner: 'p1', kills: 4, damageDealt: 1500 }, { shipId: 20, cls: 'ter_atlas', owner: 'e1', kills: 3, damageDealt: 400 }],
  };
}

describe('debrief', () => {
  test('enemy hull, multipliers and best weapon types come from DAMAGE_MULT', () => {
    assert.deepEqual(enemyHulls(start, 0), ['armored']);
    assert.deepEqual(enemyHulls({ players: [me, { ...enemy, faction: 'vorrax' }, { id: 'e2', team: 1, faction: 'vorrax' }, { id: 'e3', team: 1, faction: 'lumen' }] }, 0), ['organic', 'crystalline']);
    assert.equal(multVs('torpedo', 'armored'), DAMAGE_MULT.torpedo.armored);
    assert.equal(multVs('true', 'armored'), 1);
    assert.equal(multVs('laser', null), 1);
    assert.equal(bestTypesVs('armored')[0][0], 'torpedo');
    assert.equal(bestTypesVs('crystalline')[0][1], 1.2);
  });

  test('ships by class pair the start fleet with the per-class losses', () => {
    const rows = shipsByClass(me, result().players.p1);
    const vespa = rows.find((r) => r.cls === 'ter_vespa'), falcao = rows.find((r) => r.cls === 'ter_falcao'), prometeu = rows.find((r) => r.cls === 'ter_prometeu');
    assert.deepEqual(vespa, { cls: 'ter_vespa', total: 5, lost: 5, alive: 0 });
    assert.deepEqual(falcao, { cls: 'ter_falcao', total: 2, lost: 1, alive: 1 });
    assert.deepEqual(prometeu, { cls: 'ter_prometeu', total: 1, lost: 0, alive: 1 });
    assert.equal(rows.reduce((a, r) => a + r.total, 0), 16);
    // without per-class data (older server) the losses are unknown
    assert.equal(shipsByClass(me, { damageDealt: 1 })[0].lost, null);
  });

  test('damage rows: sorted by damage, with the fraction and the multiplier vs the enemy hull', () => {
    const rows = damageRows(result().players.p1, 'armored');
    assert.deepEqual(rows.map((r) => r.type), ['kinetic', 'torpedo', 'missile']);
    assert.equal(rows[0].mult, DAMAGE_MULT.kinetic.armored);
    assert.ok(Math.abs(rows[0].frac - 0.6) < 1e-9);
    assert.equal(damageRows(result().players.p1, null)[0].mult, null);
    assert.deepEqual(damageRows({}, 'armored'), []);
    assert.equal(damageRows({ damageByType: { true: 50, laser: 0 } }, 'armored').length, 1);
    assert.equal(damageRows({ damageByType: { true: 50 } }, 'armored')[0].mult, null, 'direct damage has no multiplier');
  });

  test('top killers per side resolve the owner name', () => {
    const ks = topKillers(result(), start);
    assert.equal(ks[0].cls, 'ter_hercules'); assert.equal(ks[0].ownerName, 'Ana'); assert.equal(ks[0].kills, 4);
    assert.equal(ks[1].cls, 'ter_atlas'); assert.equal(ks[1].ownerName, 'Bot');
    assert.deepEqual(topKillers({ killers: [null, null] }, start), [null, null]);
    assert.deepEqual(topKillers({}, start), [null, null]);
  });

  test('tips: weak weapon type vs the hull, enemy killer, lost capital, next star, loss', () => {
    const names = { hullNames: T.hullType, typeNames: WEAPON_TYPE_NAMES };
    // kinetic (×0.8 vs armored) carried 60% of the damage → weakWeapon first, then the Atlas with 3 kills
    let r = result();
    let rating = rateBattle({ result: r, start, myPlayerId: 'p1' });
    let tips = buildTips({ result: r, start, myPlayerId: 'p1', rating, ...names });
    assert.deepEqual(tips.map((t) => t.id), ['weakWeapon', 'killer']);
    assert.equal(tips[0].params.type, 'Cinético'); assert.equal(tips[0].params.best, 'Torpedo'); assert.equal(tips[0].params.hull, 'Blindado'); assert.equal(tips[0].params.bestMult, '×1,3');
    assert.equal(tips[1].params.ship, SHIPS.ter_atlas.name); assert.equal(tips[1].params.n, 3);
    // every tip id renders a full pt-BR sentence without leftover placeholders
    for (const t of tips) { const s = fmt(T.progress.tips[t.id], t.params); assert.ok(s.length > 20, t.id); assert.doesNotMatch(s, /\{\w+\}/, s); }
    // lost capital + slow win with 30% left: lostCapital, then star2 (max 2 tips)
    r = result({ damageByType: { torpedo: 2000 }, lost: { ter_prometeu: 1 }, killers: [null, null], valueAlive: 400 });
    rating = rateBattle({ result: r, start, myPlayerId: 'p1' });
    tips = buildTips({ result: r, start, myPlayerId: 'p1', rating, ...names });
    assert.deepEqual(tips.map((t) => t.id), ['lostCapital', 'star2']);
    assert.equal(tips[0].params.ship, SHIPS.ter_prometeu.name);
    assert.equal(tips[1].params.need, '50');
    // star3 hint only for fleets without a capital
    const noCap = { ...me, fleet: { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 10 }] } };
    r = result({ damageByType: { torpedo: 2000 }, lost: {}, killers: [null, null], valueAlive: 500 });
    rating = rateBattle({ result: r, start: { ...start, players: [noCap, enemy] }, myPlayerId: 'p1' });
    tips = buildTips({ result: r, start: { ...start, players: [noCap, enemy] }, myPlayerId: 'p1', rating, ...names });
    assert.deepEqual(tips.map((t) => t.id), ['star3']);
    assert.equal(tips[0].params.time, '1:30');
    // losses: timeout → timeout tip; elimination → 'defeat' with the best type vs the hull
    r = result({ winner: 1, reason: 'timeout', damageByType: { torpedo: 2000 }, lost: {}, killers: [null, null] });
    rating = rateBattle({ result: r, start, myPlayerId: 'p1' });
    assert.deepEqual(buildTips({ result: r, start, myPlayerId: 'p1', rating, ...names }).map((t) => t.id), ['timeout']);
    r = result({ winner: 1, damageByType: { torpedo: 2000 }, lost: {}, killers: [null, null] });
    rating = rateBattle({ result: r, start, myPlayerId: 'p1' });
    tips = buildTips({ result: r, start, myPlayerId: 'p1', rating, ...names });
    assert.deepEqual(tips.map((t) => t.id), ['defeat']);
    assert.match(fmt(T.progress.tips.defeat, tips[0].params), /Torpedo.*×1,3.*Blindado/);
    // unknown player → no tips; at most `max`
    assert.deepEqual(buildTips({ result: r, start, myPlayerId: 'zz', rating: null }), []);
    assert.equal(buildTips({ result: result(), start, myPlayerId: 'p1', rating: rateBattle({ result: result(), start, myPlayerId: 'p1' }) }, 1).length, 1);
  });

  test('the i18n section covers every tip id and the debrief labels', () => {
    for (const id of ['weakWeapon', 'killer', 'killerNoHull', 'lostCapital', 'star2', 'star3', 'timeout', 'defeat']) assert.ok(T.progress.tips[id], id);
    for (const k of ['debrief', 'lostByClass', 'damageByType', 'topKiller', 'tipsTitle', 'showFleets', 'hideFleets', 'contribution', 'unlockedFaction', 'nextLevel', 'starsLine', 'missingValue', 'missingCapital']) assert.ok(T.progress[k], k);
    assert.match(fmt(T.progress.contribution, { pct: 38 }), /38 % do dano do time/);
    assert.match(fmt(T.progress.unlockedFaction, { name: 'Enxame Vorrax' }), /Facção desbloqueada: Enxame Vorrax/);
  });

  test('works end to end on a simulated battle (per-type damage sums to the damage dealt)', () => {
    const config = { seed: 3, players: [
      { id: 'p1', name: 'Ana', team: 0, isBot: false, ai: 'especialista', fleet: presetFleet('ter_linha', 1500) },
      { id: 'e1', name: 'Bot', team: 1, isBot: true, ai: 'normal', fleet: presetFleet('vor_mare', 1200) },
    ] };
    const st = makeStartInfo(config, createBattle(config));
    const r = runToEnd(config);
    for (const id of ['p1', 'e1']) {
      const rows = damageRows(r.players[id], enemyHulls(st, st.players.find((p) => p.id === id).team)[0]);
      const sum = rows.reduce((a, x) => a + x.dmg, 0);
      assert.ok(Math.abs(sum - r.players[id].damageDealt) <= rows.length, `${id}: ${sum} vs ${r.players[id].damageDealt}`);
      const lost = shipsByClass(st.players.find((p) => p.id === id), r.players[id]).reduce((a, x) => a + x.lost, 0);
      assert.equal(lost, r.players[id].losses);
    }
    const ks = topKillers(r, st);
    assert.ok(ks[0] || ks[1]);
    const rating = rateBattle({ result: r, start: st, myPlayerId: 'p1' });
    const tips = buildTips({ result: r, start: st, myPlayerId: 'p1', rating, hullNames: T.hullType, typeNames: WEAPON_TYPE_NAMES });
    assert.ok(tips.length <= 2);
  });
});
