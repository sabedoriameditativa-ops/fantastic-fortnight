// Unlock ladder (SPEC §4 progression), data-driven: factions open by clearing
// campaign levels (any difficulty) and the capital / mothership class of a
// faction by stars earned on that faction's own levels (summed over every
// difficulty). 'Arsenal completo' (progress option fullArsenal) switches the
// ladder off. Pure; the fleet builder greys locked cards through ctx.unlocks().

import { LEVELS } from '/shared/levels.js';
import { FACTION_IDS, SHIPS, FACTIONS } from '/shared/catalog.js';
import { PROGRESS_DIFFICULTIES, maxLevelCleared, starsOnLevels } from './storage.js';

/** Level that must be cleared (on any difficulty) before the faction can be played. */
export const FACTION_UNLOCK_LEVEL = Object.freeze({ terran: 0, vorrax: 3, lumen: 6, ferrix: 9 });
/** Stars on the faction's own campaign levels (all difficulties summed) that open a size class. */
export const CLASS_UNLOCK_STARS = Object.freeze({ capital: 6, mothership: 9 });

/** Campaign levels where `faction` is the enemy (its "own" levels: Terran 1–3, Vorrax 4–6, Lúmen 7–9, Ferrix 10–12). */
export function factionLevels(faction) {
  return LEVELS.filter((l) => l.enemyFaction === faction).map((l) => l.n);
}

/** Highest level cleared on any difficulty. */
export function maxLevelAnyDifficulty(progress) {
  let m = 0;
  for (const d of PROGRESS_DIFFICULTIES) m = Math.max(m, maxLevelCleared(progress, d));
  return m;
}

/**
 * Level gating: with the `gating` progress option on, level n is playable when
 * n ≤ (highest level cleared on that difficulty) + 1; with it off ('Explorar
 * livremente') every level is open.
 */
export function isLevelUnlocked(progress, opts, difficulty, level) {
  if (!opts || !opts.gating) return true;
  const n = Math.floor(Number(level)) || 1;
  return n <= maxLevelCleared(progress, difficulty) + 1;
}

/** Highest playable level on a difficulty under gating (Infinity when gating is off). */
export function highestUnlockedLevel(progress, opts, difficulty) {
  return opts && opts.gating ? maxLevelCleared(progress, difficulty) + 1 : Infinity;
}

/** Does the player's progress clear `level` on any difficulty? (level 0 = always) */
function clearedAny(progress, level) {
  if (level <= 0) return true;
  for (const d of PROGRESS_DIFFICULTIES) {
    const cur = progress && progress[d];
    if (cur && Array.isArray(cur.cleared) && cur.cleared.includes(level)) return true;
  }
  return false;
}

/**
 * Unlock state for a progress object.
 * @param {object} progress   v2 progress (storage.js)
 * @param {{ fullArsenal?: boolean }} [opts]
 */
export function createUnlocks(progress, opts = {}) {
  const all = !!opts.fullArsenal;
  const factionStars = (f) => starsOnLevels(progress, factionLevels(f));
  const isFactionUnlocked = (f) => {
    if (!FACTION_IDS.includes(f)) return false;
    if (all) return true;
    return clearedAny(progress, FACTION_UNLOCK_LEVEL[f] ?? 0);
  };
  const isShipUnlocked = (cls) => {
    const s = SHIPS[cls];
    if (!s) return false;
    if (all) return true;
    if (!isFactionUnlocked(s.faction)) return false;
    const need = CLASS_UNLOCK_STARS[s.sizeClass];
    return need === undefined || factionStars(s.faction) >= need;
  };
  return {
    all,
    isFactionUnlocked,
    isShipUnlocked,
    /** Every ship of the fleet is available (an empty/invalid fleet is not). */
    isFleetUnlocked(fleet) {
      if (!fleet || !FACTION_IDS.includes(fleet.faction) || !Array.isArray(fleet.ships)) return false;
      return isFactionUnlocked(fleet.faction) && fleet.ships.every((e) => isShipUnlocked(e.cls));
    },
    factionStars,
    /** What opens a faction: { level, name } (level 0 = available from the start). */
    factionRequirement(f) { return { level: FACTION_UNLOCK_LEVEL[f] ?? 0, name: FACTIONS[f] ? FACTIONS[f].name : f }; },
    /** What opens a ship class: { faction, sizeClass, stars, have, levels } or null when the ship has no star requirement. */
    shipRequirement(cls) {
      const s = SHIPS[cls];
      if (!s || CLASS_UNLOCK_STARS[s.sizeClass] === undefined) return null;
      return { faction: s.faction, sizeClass: s.sizeClass, stars: CLASS_UNLOCK_STARS[s.sizeClass], have: factionStars(s.faction), levels: factionLevels(s.faction) };
    },
    /** Everything unlocked right now (ids), for diffs. */
    snapshot() {
      return {
        factions: FACTION_IDS.filter(isFactionUnlocked),
        ships: Object.keys(SHIPS).filter(isShipUnlocked),
      };
    },
  };
}

/**
 * What a progress change unlocked on the ladder (independent of the 'Arsenal completo' option,
 * so the results screen can announce it even for veterans).
 * @returns {{ factions: string[], ships: string[] }}  ships lists only size-class unlocks (capital / mothership)
 */
export function newUnlocks(before, after) {
  const a = createUnlocks(before, { fullArsenal: false }).snapshot();
  const b = createUnlocks(after, { fullArsenal: false }).snapshot();
  const factions = b.factions.filter((f) => !a.factions.includes(f));
  const ships = b.ships.filter((cls) => !a.ships.includes(cls) && CLASS_UNLOCK_STARS[SHIPS[cls].sizeClass] !== undefined && !factions.includes(SHIPS[cls].faction));
  return { factions, ships };
}
