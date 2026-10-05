// Battle event log: turns SimEvents into short pt-BR lines ("Corveta Falcão
// de Ana destruída por Zangão de Bot Rex"). Pure (no DOM); the HUD renders
// the entries. Keeps only the last `max` entries and expires them after
// `ttlMs`.

import { SHIPS, ABILITIES, SIZE_CLASS } from '/shared/catalog.js';
import { T, fmt } from '../i18n.js';

/**
 * @param {Object} o
 * @param {(id:number)=>({cls:string, team:0|1, owner:string, spawned?:boolean}|null|undefined)} o.lookup
 * @param {(playerId:string)=>string} o.playerName
 * @param {string|null} [o.myPlayerId]
 * @param {number} [o.max=6]
 * @param {number} [o.ttlMs=6000]
 */
export function createEventLog(o) {
  const lookup = o.lookup;
  const playerName = o.playerName || ((id) => id);
  const max = o.max || 6;
  const ttl = o.ttlMs || 6000;
  /** @type {{ text: string, team: 0|1|-1, kind: string, at: number, id: number }[]} */
  let entries = [];
  let seq = 0;
  const lastCast = new Map(); // `${id}:${ability}` → at

  function owner(info) {
    const pid = info && info.owner;
    if (o.myPlayerId && pid === o.myPlayerId) return T.battle.ev.ownerYou;
    return playerName(pid) || pid || '?';
  }
  function shipName(info) {
    const cat = info && SHIPS[info.cls];
    return cat ? cat.name : '?';
  }
  function sizeIdx(info) {
    const cat = info && SHIPS[info.cls];
    return cat ? SIZE_CLASS[cat.sizeClass].index : 0;
  }

  function add(text, team, kind, at) {
    entries.push({ text, team, kind, at, id: ++seq });
    if (entries.length > max) entries.splice(0, entries.length - max);
  }

  return {
    /**
     * Feed events of a frame. Returns the entries added.
     * @param {any[][]} events
     * @param {number} at ms
     */
    push(events, at) {
      const before = entries.length ? entries[entries.length - 1].id : 0;
      const spawnsBySource = new Map();
      for (const e of events) {
        switch (e[0]) {
          case 'die': {
            const info = lookup(e[1]);
            if (!info || info.spawned) break;
            const killer = e[2] ? lookup(e[2]) : null;
            if (killer) add(fmt(T.battle.ev.die, { ship: shipName(info), owner: owner(info), killer: `${shipName(killer)} (${owner(killer)})` }), info.team, 'die', at);
            else add(fmt(T.battle.ev.dieNoKiller, { ship: shipName(info), owner: owner(info) }), info.team, 'die', at);
            break;
          }
          case 'cast': {
            const info = lookup(e[1]);
            const ab = ABILITIES[e[2]];
            if (!info || !ab || ab.kind === 'passive') break;
            const si = sizeIdx(info);
            const notable = si >= 3 || (si === 2 && ['aura', 'spawn', 'area', 'teleport', 'heal'].includes(ab.kind));
            if (!notable) break;
            const key = `${e[1]}:${e[2]}`;
            const prev = lastCast.get(key);
            if (prev !== undefined && at - prev < 8000) break;
            lastCast.set(key, at);
            add(fmt(T.battle.ev.cast, { ship: shipName(info), owner: owner(info), ability: ab.name }), info.team, 'cast', at);
            break;
          }
          case 'sbreak': {
            const info = lookup(e[1]);
            if (!info || info.spawned || sizeIdx(info) < 4) break;
            add(fmt(T.battle.ev.sbreak, { ship: shipName(info), owner: owner(info) }), info.team, 'sbreak', at);
            break;
          }
          case 'spawn': {
            const key = `${e[4]}:${e[2]}`;
            const cur = spawnsBySource.get(key) || { ownerId: e[4], cls: e[2], team: e[3], n: 0 };
            cur.n++;
            spawnsBySource.set(key, cur);
            break;
          }
          case 'phase':
            if (e[1] === 'engage') add(T.battle.ev.engage, -1, 'phase', at);
            else if (e[1] === 'suddenDeath') add(T.battle.ev.suddenDeath, -1, 'phase', at);
            break;
          case 'end':
            add(T.battle.ev.end, -1, 'end', at);
            break;
          default:
            break;
        }
      }
      for (const s of spawnsBySource.values()) {
        const cat = SHIPS[s.cls];
        if (!cat || s.n < 2) continue;
        const ownerName = o.myPlayerId && s.ownerId === o.myPlayerId ? T.battle.ev.ownerYou : playerName(s.ownerId) || s.ownerId;
        add(fmt(T.battle.ev.spawn, { owner: ownerName, n: s.n, ship: cat.name }), s.team, 'spawn', at);
      }
      return entries.filter((x) => x.id > before);
    },
    /** Live entries (not expired) at time `now`. */
    entries(now) {
      entries = entries.filter((x) => now - x.at < ttl);
      return entries.slice();
    },
    clear() { entries = []; lastCast.clear(); },
  };
}
