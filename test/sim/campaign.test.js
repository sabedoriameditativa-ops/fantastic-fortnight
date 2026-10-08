import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, hashState, runToEnd } from '../../shared/sim/battle.js';
import { initCampaign, tickCampaign, campaignDesired, campaignResult, campaignSnapshot } from '../../shared/campaign.js';
import { levelCampaign, LEVELS } from '../../shared/levels.js';
import { processDeaths } from '../../shared/sim/damage.js';
import { buildSpConfig } from '../../shared/spConfig.js';
import { presetFleet, fleetCost } from '../../shared/fleet.js';

function mission(type, overrides = {}) {
  const config = {
    seed: 'campaign-test', maxTicks: 400,
    campaign: { type, durationTicks: 200, waveCount: 3, waveIntervalTicks: 80, ...overrides },
    players: [
      { id: 'p1', team: 0, fleet: { faction: 'terran', ships: [{ cls: 'ter_orion', count: 1 }] } },
      { id: 'e1', team: 1, isBot: true, fleet: { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 3 }] } },
    ],
  };
  const state = createBattle(config);
  if (!state.campaign) initCampaign(state);
  return state;
}

function killPurchased(state, team) {
  for (const s of state.ships) if (s.team === team && s.purchased) s.hp = 0;
  processDeaths(state);
}

describe('campaign missions', () => {
  test('the authored ladder includes five genuinely different conditions', () => {
    assert.deepEqual([...new Set(LEVELS.map((l) => levelCampaign(l).type))].sort(), ['defense', 'elimination', 'escort', 'survival', 'waves']);
  });

  test('escort adds a vulnerable unarmed objective without changing purchased fleet statistics', () => {
    const s = mission('escort'), c = s.campaign, transport = s.ships[c.objectiveId - 1];
    assert.equal(transport.purchased, false);
    assert.equal(s.stats.p1.shipsTotal, 1);
    assert.equal(s.alivePurchased[0], 1);
    assert.equal(transport.hpMax, 2400);
    assert.equal(transport.ability.id, null);
    assert.ok(transport.weapons.every((w) => w.readyAt > s.maxTicks));
    const out = {};
    assert.equal(campaignDesired(s, transport, out), true);
    assert.ok(out.dx > 0 && out.speed > 0);
    assert.equal(campaignDesired(s, s.ships[0], out), false);
    killPurchased(s, 1);
    assert.equal(campaignResult(s), null, 'clearing enemies alone does not complete escort');
    transport.x = c.goalX; transport.y = c.goalY;
    tickCampaign(s);
    assert.equal(campaignResult(s).reason, 'escort_complete');
    assert.equal(campaignResult(s).winner, 0);
  });

  test('objective destruction wins over arrival and fails defense even with a healthy fleet', () => {
    for (const type of ['escort', 'defense']) {
      const s = mission(type), c = s.campaign, objective = s.ships[c.objectiveId - 1];
      objective.x = c.goalX; objective.hp = 0;
      processDeaths(s); tickCampaign(s);
      assert.equal(campaignResult(s).reason, 'objective_destroyed');
      assert.equal(campaignResult(s).winner, 1);
      assert.equal(s.alivePurchased[0], 1);
    }
  });

  test('defense holds position and survival requires time even when the first enemies die', () => {
    for (const type of ['defense', 'survival']) {
      const s = mission(type);
      if (type === 'defense') {
        const out = {};
        campaignDesired(s, s.ships[s.campaign.objectiveId - 1], out);
        assert.equal(out.speed, 0);
      }
      killPurchased(s, 1);
      s.tick = 10; tickCampaign(s);
      assert.equal(campaignResult(s), null);
      s.tick = 80; tickCampaign(s);
      assert.equal(s.campaign.wave, 2);
      assert.ok(s.alivePurchased[1] > 0, 'timed reinforcement is a real purchased ship');
      s.tick = 200; tickCampaign(s);
      assert.equal(campaignResult(s).reason, `${type}_complete`);
      assert.equal(campaignResult(s).winner, 0);
    }
  });

  test('clearing a wave spawns the next and the final wave must actually die', () => {
    const s = mission('waves');
    for (let wave = 1; wave < 3; wave++) {
      killPurchased(s, 1);
      assert.equal(campaignResult(s), null);
      s.tick++; tickCampaign(s);
      assert.equal(s.campaign.wave, wave + 1);
      assert.ok(s.alivePurchased[1] > 0);
      assert.ok(s.events.some((event) => event[0] === 'spawn' && event[8] === 0));
    }
    killPurchased(s, 1); tickCampaign(s);
    assert.equal(campaignResult(s).reason, 'waves_complete');
    assert.ok(s.stats.e1.shipsTotal > 3);
    assert.equal(s.stats.e1.losses, s.stats.e1.shipsTotal);
  });

  test('loss of the fleet and mission timeout cannot become a value-based win', () => {
    const eliminated = mission('survival');
    killPurchased(eliminated, 0);
    eliminated.tick = 200; tickCampaign(eliminated);
    assert.equal(campaignResult(eliminated).winner, 1);
    const timeout = mission('escort');
    timeout.tick = 200; tickCampaign(timeout);
    assert.equal(campaignResult(timeout).reason, 'objective_timeout');
  });

  test('campaign snapshots are small serializable public status', () => {
    const s = mission('escort');
    const snapshot = campaignSnapshot(s);
    assert.equal(snapshot.objectiveHp, 1000);
    assert.equal(snapshot.ticksLeft, 200);
    assert.ok(!('pending' in snapshot));
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  });

  test('battle loop enforces timed survival and is deterministic with reinforcements', () => {
    const initial = mission('survival', { durationTicks: 100, waveIntervalTicks: 20 });
    const a = createBattle(initial.config), b = createBattle(initial.config);
    for (let tick = 0; tick < 100; tick++) {
      assert.deepEqual(stepBattle(a), stepBattle(b));
      assert.equal(hashState(a), hashState(b));
    }
    assert.equal(a.ended?.reason, 'survival_complete');
    assert.equal(a.campaign.wave, 3);
  });

  test('single-player setup wires authored missions, varied personalities, and explicit resources', () => {
    const options = { setup: { level: 3, teamSize: 6, resourceMul: 1.5 }, playerFleet: presetFleet('ter_linha', 1500), seed: 'sp-missions' };
    const { config, meta } = buildSpConfig(options);
    assert.equal(config.campaign.type, 'defense');
    assert.equal(new Set(config.players.filter((p) => p.isBot).map((p) => p.personality)).size, 5);
    assert.equal(meta.enemyBudget, Math.round(1500 * 0.7 * 1.5));
    for (const enemy of config.players.filter((p) => p.team === 1)) {
      assert.ok(fleetCost(enemy.fleet) * (1 + 2 * config.campaign.reinforcementFraction) <= meta.enemyBudget);
    }
    const short = { ...config, campaign: { ...config.campaign, durationTicks: 2 } };
    assert.equal(runToEnd(short).reason, 'defense_complete');
  });
});
