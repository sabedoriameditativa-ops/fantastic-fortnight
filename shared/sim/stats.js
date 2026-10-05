// Per-player stats accumulation and the battle result / tiebreak (SPEC §1).

/** Create the stats record for every player. */
export function makeStats(players) {
  const stats = {};
  for (const p of players) {
    stats[p.id] = { damageDealt: 0, damageTaken: 0, healing: 0, kills: 0, losses: 0, shipsTotal: 0, shipsAlive: 0, valueAlive: 0 };
  }
  return stats;
}

/** Remaining value of a ship: cost × (hp+shield)/(maxHp+maxShield). */
export function shipValue(s) {
  const denom = s.hpMax + s.shieldMax;
  return denom > 0 ? (s.cost * (s.hp + s.shield)) / denom : 0;
}

/** Σ value over surviving purchased ships of a team. */
export function remainingValue(state, team) {
  const list = state.alive[team], ships = state.ships;
  let v = 0;
  for (let i = 0; i < list.length; i++) {
    const s = ships[list[i] - 1];
    if (s.purchased) v += shipValue(s);
  }
  return v;
}

/** Total damage dealt by a team's players. */
function teamDamage(state, team) {
  let d = 0;
  for (const p of state.config.players) if (p.team === team) d += state.stats[p.id].damageDealt;
  return d;
}

/**
 * Build the BattleResult for the current state.
 * @param {object} state
 * @param {'elimination'|'timeout'|'draw'} reason
 * @param {0|1|-1} winner
 */
export function buildResult(state, reason, winner) {
  const ships = state.ships;
  const players = {};
  for (const p of state.config.players) {
    const st = state.stats[p.id];
    let valueAlive = 0, shipsAlive = 0;
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      if (s.alive && s.purchased && s.owner === p.id) { valueAlive += shipValue(s); shipsAlive++; }
    }
    players[p.id] = {
      damageDealt: Math.round(st.damageDealt), damageTaken: Math.round(st.damageTaken), healing: Math.round(st.healing),
      kills: st.kills, losses: st.losses, shipsTotal: st.shipsTotal, shipsAlive, valueAlive: Math.round(valueAlive),
    };
  }
  let mvp = null;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (s.damageDealt > 0 && (!mvp || s.damageDealt > mvp.damageDealt)) mvp = { shipId: s.id, cls: s.cls, owner: s.owner, damageDealt: Math.round(s.damageDealt) };
  }
  return {
    winner, reason, ticks: state.tick,
    remainingValue: [Math.round(remainingValue(state, 0)), Math.round(remainingValue(state, 1))],
    players, mvp,
  };
}

/**
 * Decide whether the battle ended this tick: elimination (draw if both wiped)
 * or hard stop at maxTicks (higher remaining value, 2% tiebreak by damage).
 * @returns {object|null} BattleResult
 */
export function checkEnd(state) {
  const a0 = state.alivePurchased[0], a1 = state.alivePurchased[1];
  if (a0 === 0 && a1 === 0) return buildResult(state, 'draw', -1);
  if (a1 === 0) return buildResult(state, 'elimination', 0);
  if (a0 === 0) return buildResult(state, 'elimination', 1);
  if (state.tick >= state.maxTicks) {
    const v0 = remainingValue(state, 0), v1 = remainingValue(state, 1);
    const tol = 0.02 * Math.max(v0, v1);
    if (Math.abs(v0 - v1) > tol) return buildResult(state, 'timeout', v0 > v1 ? 0 : 1);
    const d0 = teamDamage(state, 0), d1 = teamDamage(state, 1);
    const dtol = 0.02 * Math.max(d0, d1);
    if (Math.abs(d0 - d1) > dtol) return buildResult(state, 'timeout', d0 > d1 ? 0 : 1);
    return buildResult(state, 'draw', -1);
  }
  return null;
}
