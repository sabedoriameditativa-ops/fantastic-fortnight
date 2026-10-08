// Reproducible Astral balance sample. Results are observations, never pass/fail
// thresholds: changing one ship can legitimately change a matchup.
// node tools/balance.js --seeds=8 --budget=1500
import { createBattle, stepBattle } from '../shared/sim/battle.js';
import { presetFleet, fleetCost } from '../shared/fleet.js';
import { PRESETS } from '../shared/catalog.js';

const option = (name, fallback) => {
  const value = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return value ? Number(value.slice(name.length + 3)) : fallback;
};
const seeds = option('seeds', 8), budget = option('budget', 1500);
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 100 || !Number.isInteger(budget) || budget < 800 || budget > 5000) {
  throw new Error('Use --seeds=1..100 and --budget=800..5000');
}
const opponents = ['ter_linha', 'ter_atlas', 'vor_mare', 'vor_garras', 'lum_coro', 'lum_catedral', 'fer_ferro', 'fer_fabrica'];
const summary = { budget, seeds, ai: 'human especialista', matches: 0, wins: 0, draws: 0, sideDisagreements: 0, byPreset: {}, rows: [] };
for (const preset of ['ast_orbita', 'ast_baluarte']) {
  const ours = presetFleet(preset, budget), totals = { matches: 0, wins: 0, draws: 0 };
  summary.byPreset[preset] = totals;
  for (const opponent of opponents) {
    const theirs = presetFleet(opponent, budget);
    const row = { preset, opponent, faction: PRESETS[opponent].faction, cost: fleetCost(ours), enemyCost: fleetCost(theirs),
      matches: seeds * 2, wins: 0, draws: 0, leftWins: 0, rightWins: 0, meanSeconds: 0, sideDisagreements: 0 };
    for (let seed = 0; seed < seeds; seed++) {
      const outcomes = [];
      for (let side = 0; side < 2; side++) {
        const players = [{ id: 'astral', team: side, fleet: ours }, { id: 'opponent', team: 1 - side, fleet: theirs }];
        const state = createBattle({ seed, players });
        while (!state.ended) stepBattle(state);
        const win = state.ended.winner === side, draw = state.ended.winner === -1;
        row.wins += Number(win); row.draws += Number(draw); row[side ? 'rightWins' : 'leftWins'] += Number(win);
        row.meanSeconds += state.tick / 20; outcomes.push(win ? 'win' : draw ? 'draw' : 'loss');
      }
      if (outcomes[0] !== outcomes[1]) row.sideDisagreements++;
    }
    row.meanSeconds = Math.round(row.meanSeconds / row.matches * 10) / 10;
    summary.matches += row.matches; summary.wins += row.wins; summary.draws += row.draws; summary.sideDisagreements += row.sideDisagreements;
    totals.matches += row.matches; totals.wins += row.wins; totals.draws += row.draws;
    summary.rows.push(row);
  }
}
console.log(JSON.stringify(summary, null, 2));
