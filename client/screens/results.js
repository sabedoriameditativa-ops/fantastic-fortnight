// Results: winner, reason, per-player table, MVP ship, actions (SP: play
// again / next level / edit fleet / menu; MP: rematch votes / leave).

import { T, fmt, difficultyName } from '../i18n.js';
import { h, clear, button, add } from '../util/dom.js';
import { num, ticksToClock } from '../util/format.js';
import { animateShip } from '../util/shipCanvas.js';
import { randomSeed } from '../util/url.js';
import { FACTIONS, SHIPS } from '/shared/catalog.js';
import { TICK_RATE } from '/shared/constants.js';

/**
 * @param {{ mode:'sp'|'mp', result:object, start:object, meta?:object, myTeam:0|1|null, myPlayerId:string|null, cleared?:boolean, speed?:number }} props
 */
export function mount(root, props, ctx) {
  const { state } = ctx;
  const r = props.result;
  const start = props.start || { players: [] };
  const mode = props.mode || 'sp';
  const stops = [];
  const offs = [];
  ctx.setArena('dimmed');
  if (!r) { ctx.go('menu'); return { unmount() {} }; }

  const myTeam = props.myTeam;
  const won = myTeam !== null && myTeam !== undefined && r.winner === myTeam;
  const titleText = r.winner === -1 ? T.results.draw : fmt(T.results.winner, { team: T.app.team[r.winner] });
  const titleCls = r.winner === -1 ? 'muted' : r.winner === 0 ? 'team-a' : 'team-b';
  let reason = T.results.reasonDraw;
  if (r.reason === 'elimination') reason = T.results.reasonElim;
  else if (r.reason === 'timeout') {
    const rv = r.remainingValue || [0, 0];
    const hi = Math.max(rv[0], rv[1]);
    reason = hi > 0 && Math.abs(rv[0] - rv[1]) / hi <= 0.02 ? T.results.reasonTimeoutDmg : T.results.reasonTimeout;
  }

  const players = (start.players || []).slice().sort((a, b) => a.team - b.team || a.name.localeCompare(b.name));
  const rows = players.map((p) => {
    const ps = (r.players && r.players[p.id]) || { damageDealt: 0, damageTaken: 0, healing: 0, kills: 0, losses: 0, shipsTotal: 0, shipsAlive: 0, valueAlive: 0 };
    const f = FACTIONS[p.faction];
    return h('tr', { class: [p.id === props.myPlayerId ? 'me' : '', ps.shipsAlive === 0 ? 'dead' : ''].join(' '), test: `result-row-${p.id}` },
      h('td', h('span', { class: p.team === 0 ? 'team-a' : 'team-b', text: '■ ' }), p.name, p.id === props.myPlayerId ? h('span.muted.small', ` (${T.app.you})`) : null, p.isBot ? h('span.muted.small', ` · ${T.app.bot} ${difficultyName(p.ai)}`) : null),
      h('td', f ? h('span', h('span.faction-dot', { style: { background: f.color } }), f.short) : '—'),
      h('td.n', `${ps.shipsAlive}/${ps.shipsTotal}`),
      h('td.n', num(ps.damageDealt)),
      h('td.n', num(ps.damageTaken)),
      h('td.n', String(ps.kills)),
      h('td.n', num(ps.valueAlive)),
    );
  });

  // MVP
  const mvpPanel = h('div.panel.mvp');
  if (r.mvp && SHIPS[r.mvp.cls]) {
    const cv = h('canvas', { width: 220, height: 120 });
    const owner = players.find((p) => p.id === r.mvp.owner);
    const team = owner ? owner.team : 0;
    stops.push(animateShip(cv, r.mvp.cls, { team, angle: -0.3, pad: 10 }));
    add(mvpPanel, h('h3', { text: T.results.mvp }), cv,
      h('b', { test: 'result-mvp', text: SHIPS[r.mvp.cls].name }),
      h('div.small.muted', { text: fmt(T.results.mvpDesc, { ship: SHIPS[r.mvp.cls].name, owner: owner ? owner.name : r.mvp.owner, dmg: num(r.mvp.damageDealt) }) }));
  } else add(mvpPanel, h('h3', { text: T.results.mvp }), h('div.muted.small', { text: '—' }));

  // actions
  const actions = h('div.res-actions');
  const meta = props.meta;
  if (mode === 'sp' && meta) {
    const setup = meta.setup;
    add(actions, 
      button(T.results.playAgain, { test: 'play-again', primary: true, title: T.results.playAgainHint, onClick: () => ctx.startSinglePlayer(setup, meta.playerFleet, { seed: randomSeed(), speed: props.speed }) }),
      won ? button(T.results.nextLevel, { test: 'next-level', primary: true, onClick: () => { const next = { ...setup, level: setup.level + 1 }; ctx.saveSpSetup(next); ctx.startSinglePlayer(next, meta.playerFleet, { seed: randomSeed(), speed: props.speed }); } }) : null,
      button(T.results.editFleet, { test: 'edit-fleet', onClick: () => ctx.go('fleetBuilder', { mode: 'sp', setup: won ? { ...setup, level: setup.level + 1 } : setup, fleet: meta.playerFleet }) }),
      button(T.results.menu, { test: 'result-menu', onClick: () => ctx.go('menu') }),
    );
  } else if (mode === 'mp' && state.net) {
    const net = state.net;
    const votesLabel = () => {
      const room = net.room;
      const total = room ? room.slots.flat().filter((s) => s.kind === 'human' && s.connected !== false).length : 0;
      const n = room && Array.isArray(room.rematchVotes) ? room.rematchVotes.length : 0;
      return n > 0 ? fmt(T.results.rematchVotes, { n, total }) : T.results.rematch;
    };
    const rematchBtn = button(votesLabel(), { test: 'rematch', primary: true, onClick: () => { rematchBtn.disabled = true; net.rematch().catch((e) => { rematchBtn.disabled = false; ctx.toast(e.code || 'erro', 'error'); }); } });
    add(actions, rematchBtn, button(T.results.leave, { test: 'leave-room', class: 'btn-danger', onClick: async () => { try { await net.leaveRoom(); } catch { /* ignore */ } ctx.go('lobby'); } }));
    offs.push(net.onRoom((room) => {
      rematchBtn.textContent = votesLabel();
      if (room.phase === 'lobby') ctx.go('lobby');
    }));
    offs.push(net.onLeft(() => { ctx.toast(T.lobby.roomClosed, 'warn'); ctx.go('lobby'); }));
    offs.push(net.feed.onStart(() => ctx.go('battle', { mode: 'mp' })));
  } else {
    add(actions, button(T.results.menu, { test: 'result-menu', onClick: () => ctx.go('menu') }));
  }

  const el = h('div.screen',
    h('div.res-head',
      h('div.res-title', { class: titleCls, test: 'result-winner', 'data-winner': String(r.winner), text: titleText.toUpperCase() }),
      myTeam !== null && myTeam !== undefined && r.winner !== -1 ? h('div', { class: won ? 'ok' : 'danger', text: won ? T.results.youWon : T.results.youLost }) : null,
      h('div.res-reason', { test: 'result-reason', text: reason }),
      h('div.small.muted', { text: fmt(T.results.duration, { time: ticksToClock(r.ticks, start.tickRate || TICK_RATE) }) }),
      props.cleared && meta ? h('div.ok', { test: 'level-cleared', text: fmt(T.results.levelCleared, { level: meta.setup.level, difficulty: difficultyName(meta.setup.difficulty) }) }) : null,
    ),
    h('div.res-layout',
      h('div.panel.table-wrap',
        h('table.table', { test: 'result-table' },
          h('thead', h('tr', h('th', T.results.player), h('th', T.results.faction), h('th.n', T.results.ships), h('th.n', T.results.dealt), h('th.n', T.results.taken), h('th.n', T.results.kills), h('th.n', T.results.value))),
          h('tbody', rows)),
        start.seed !== undefined ? h('div.tiny.muted', { style: { marginTop: '8px' }, text: fmt(T.results.seed, { seed: start.seed }) }) : null,
      ),
      mvpPanel,
    ),
    actions,
  );
  root.appendChild(el);
  try { ctx.audio.setScene(r.winner === -1 ? 'menu' : won ? 'victory' : 'defeat'); } catch { /* ignore */ }
  return { unmount() { for (const s of stops) s(); for (const off of offs) off(); } };
}
