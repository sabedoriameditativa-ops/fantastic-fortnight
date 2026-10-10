// Unlock ladder and level gating (client/util/unlocks.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_sharedHook.mjs', import.meta.url);
const { createUnlocks, newUnlocks, factionLevels, isLevelUnlocked, highestUnlockedLevel, maxLevelAnyDifficulty, FACTION_UNLOCK_LEVEL, CLASS_UNLOCK_STARS } = await import('../../client/util/unlocks.js');
const { normalizeProgress, withLevelRecord, withLevelCleared } = await import('../../client/util/storage.js');
const { FACTION_IDS, SHIPS, shipsOfFaction } = await import('../../shared/catalog.js');
const { LEVELS } = await import('../../shared/levels.js');

const cleared = (d, ...levels) => { let p = normalizeProgress({}); for (const n of levels) p = withLevelCleared(p, d, n); return normalizeProgress(p); };
const starred = (p, d, n, stars) => withLevelRecord(p, d, n, { stars, score: 100, ticks: 100, at: 1 }).progress;

describe('unlock ladder', () => {
  test('table: Terran from the start, Vorrax after L3, Lúmen after L6, Ferrix after L9; capitals 6 stars, motherships 9', () => {
    assert.deepEqual(FACTION_UNLOCK_LEVEL, { terran: 0, vorrax: 3, lumen: 6, ferrix: 9 });
    assert.deepEqual(CLASS_UNLOCK_STARS, { capital: 6, mothership: 9 });
    assert.deepEqual(factionLevels('terran'), [1, 2, 3]);
    assert.deepEqual(factionLevels('vorrax'), [4, 5, 6]);
    assert.deepEqual(factionLevels('lumen'), [7, 8, 9]);
    assert.deepEqual(factionLevels('ferrix'), [10, 11, 12]);
    // the faction unlock level is the last level of that faction's arc (the player meets the faction before playing it)
    for (const f of ['vorrax', 'lumen', 'ferrix']) assert.equal(FACTION_UNLOCK_LEVEL[f], LEVELS.filter((l) => l.enemyFaction === FACTION_IDS[FACTION_IDS.indexOf(f) - 1]).at(-1).n);
  });

  test('a fresh profile has Terran only, without its capital and mothership', () => {
    const u = createUnlocks(normalizeProgress({}), { fullArsenal: false });
    assert.deepEqual(u.snapshot().factions, ['terran']);
    assert.equal(u.isFactionUnlocked('vorrax'), false);
    assert.equal(u.isShipUnlocked('ter_falcao'), true);
    assert.equal(u.isShipUnlocked('ter_hercules'), true, 'large hulls are free');
    assert.equal(u.isShipUnlocked('ter_atlas'), false, 'capital');
    assert.equal(u.isShipUnlocked('ter_prometeu'), false, 'mothership');
    assert.equal(u.isShipUnlocked('vor_larva'), false);
    assert.equal(u.isShipUnlocked('nope'), false);
    assert.equal(u.isFleetUnlocked({ faction: 'terran', ships: [{ cls: 'ter_falcao', count: 3 }] }), true);
    assert.equal(u.isFleetUnlocked({ faction: 'terran', ships: [{ cls: 'ter_falcao', count: 3 }, { cls: 'ter_atlas', count: 1 }] }), false);
    assert.equal(u.isFleetUnlocked(null), false);
    assert.deepEqual(u.factionRequirement('vorrax').level, 3);
    assert.deepEqual(u.shipRequirement('ter_atlas'), { faction: 'terran', sizeClass: 'capital', stars: 6, have: 0, levels: [1, 2, 3] });
    assert.equal(u.shipRequirement('ter_falcao'), null);
  });

  test('"Arsenal completo" opens everything', () => {
    const u = createUnlocks(normalizeProgress({}), { fullArsenal: true });
    assert.equal(u.all, true);
    assert.deepEqual(u.snapshot().factions, FACTION_IDS);
    assert.equal(u.snapshot().ships.length, Object.keys(SHIPS).length);
    assert.equal(u.isShipUnlocked('fer_mente'), true);
  });

  test('factions unlock by clearing levels on any difficulty', () => {
    assert.deepEqual(createUnlocks(cleared('facil', 1, 2, 3)).snapshot().factions, ['terran', 'vorrax']);
    assert.deepEqual(createUnlocks(cleared('especialista', 6)).snapshot().factions, ['terran', 'lumen']); // L6 alone (free explore) opens Lúmen
    assert.deepEqual(createUnlocks(cleared('normal', 1, 2, 3, 4, 5, 6, 7, 8, 9)).snapshot().factions, FACTION_IDS);
    assert.equal(maxLevelAnyDifficulty(cleared('dificil', 2, 5)), 5);
  });

  test('capital after 6 stars and mothership after 9 stars on the faction\'s own levels, summed over difficulties', () => {
    let p = cleared('normal', 1, 2, 3);
    p = starred(p, 'normal', 1, 3); p = starred(p, 'normal', 2, 2); // 3 + 2 + 1 (L3 cleared) = 6
    let u = createUnlocks(p);
    assert.equal(u.factionStars('terran'), 6);
    assert.equal(u.isShipUnlocked('ter_atlas'), true, 'capital at 6 stars');
    assert.equal(u.isShipUnlocked('ter_prometeu'), false, 'mothership needs 9');
    assert.equal(u.isShipUnlocked('vor_rainha'), false, 'Vorrax capital: stars on L4–6');
    p = starred(p, 'facil', 1, 3); // other difficulty counts: 9
    u = createUnlocks(p);
    assert.equal(u.factionStars('terran'), 9);
    assert.equal(u.isShipUnlocked('ter_prometeu'), true);
    // Vorrax capital needs the faction AND the stars
    let q = cleared('normal', 1, 2, 3, 4, 5, 6);
    for (const n of [4, 5]) q = starred(q, 'normal', n, 3);
    const uq = createUnlocks(q);
    assert.equal(uq.factionStars('vorrax'), 7);
    assert.equal(uq.isShipUnlocked(shipsOfFaction('vorrax').find((s) => s.sizeClass === 'capital').id), true);
    assert.equal(uq.isShipUnlocked(shipsOfFaction('vorrax').find((s) => s.sizeClass === 'mothership').id), false);
  });

  test('newUnlocks reports what a progress change opened (factions, then classes), ignoring the arsenal option', () => {
    const before = cleared('normal', 1, 2);
    const after = withLevelCleared(before, 'normal', 3);
    assert.deepEqual(newUnlocks(before, after), { factions: ['vorrax'], ships: [] });
    assert.deepEqual(newUnlocks(after, after), { factions: [], ships: [] });
    let p = after;
    p = starred(p, 'normal', 1, 3); p = starred(p, 'normal', 2, 3);
    const d = newUnlocks(after, p); // 3+3+1 = 7 stars → Terran capital
    assert.deepEqual(d, { factions: [], ships: ['ter_atlas'] });
    // the ships of a freshly unlocked faction are not listed as class unlocks
    assert.deepEqual(newUnlocks(normalizeProgress({}), cleared('normal', 1, 2, 3, 4, 5, 6)).factions, ['vorrax', 'lumen']);
    assert.deepEqual(newUnlocks(normalizeProgress({}), cleared('normal', 1, 2, 3, 4, 5, 6)).ships, []);
  });
});

describe('level gating', () => {
  test('level n+1 opens after clearing n on that difficulty; off with "Explorar livremente"', () => {
    const p = cleared('normal', 1, 2);
    const on = { gating: true }, off = { gating: false };
    assert.equal(isLevelUnlocked(p, on, 'normal', 1), true);
    assert.equal(isLevelUnlocked(p, on, 'normal', 3), true);
    assert.equal(isLevelUnlocked(p, on, 'normal', 4), false);
    assert.equal(isLevelUnlocked(p, on, 'dificil', 2), false, 'per difficulty');
    assert.equal(isLevelUnlocked(p, on, 'dificil', 1), true);
    assert.equal(isLevelUnlocked(p, off, 'dificil', 15), true);
    assert.equal(isLevelUnlocked(p, null, 'dificil', 15), true);
    assert.equal(isLevelUnlocked(normalizeProgress({}), on, 'normal', 1), true);
    assert.equal(isLevelUnlocked(normalizeProgress({}), on, 'normal', 2), false);
    assert.equal(highestUnlockedLevel(p, on, 'normal'), 3);
    assert.equal(highestUnlockedLevel(p, on, 'facil'), 1);
    assert.equal(highestUnlockedLevel(p, off, 'facil'), Infinity);
    // endless (16+) opens after L15
    const q = cleared('normal', ...Array.from({ length: 15 }, (_, i) => i + 1));
    assert.equal(isLevelUnlocked(q, on, 'normal', 16), true);
    assert.equal(isLevelUnlocked(q, on, 'normal', 17), false);
  });
});
