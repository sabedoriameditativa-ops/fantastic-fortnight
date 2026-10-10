// Results: winner, reason, stars / score / records (single-player campaign),
// skirmish records and team contribution (team formats), unlock
// announcements, per-player table, MVP ship, actions (SP: play again / next
// level / edit fleet / menu; MP: rematch votes / leave) and the debrief:
// ships lost by class, damage by weapon type vs the enemy hull, top killer
// per side, generated tips and a 'Ver frotas' expander.

import { T, fmt, difficultyName, errorMessage } from '../i18n.js';
import { h, clear, button, add, select } from '../util/dom.js';
import { num, ticksToClock, mmss } from '../util/format.js';
import { animateShip } from '../util/shipCanvas.js';
import { randomSeed } from '../util/url.js';
import { rateBattle, starGlyphs, STAR_RULES } from '../util/progress.js';
import { enemyHulls, shipsByClass, damageRows, topKillers, buildTips } from '../util/debrief.js';
import { spBudgetPoints } from '../util/spConfig.js';
import { FACTIONS, SHIPS, WEAPON_TYPE_NAMES } from '/shared/catalog.js';
import { TICK_RATE } from '/shared/constants.js';
import { fleetToArray } from '/shared/fleet.js';
import { levelInfo } from '/shared/levels.js';

const multText = (m) => `×${m.toFixed(1).replace('.', ',')}`;
const pctText = (f) => String(Math.round(Math.max(0, Math.min(1, f)) * 100));

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
  let disposed = false;
  ctx.setArena('dimmed');
  if (!r) { ctx.go('menu'); return { unmount() {} }; }

  const myTeam = props.myTeam;
  const won = myTeam !== null && myTeam !== undefined && r.winner === myTeam;
  const titleText = r.winner === -1 ? T.results.draw : fmt(T.results.winner, { team: T.app.team[r.winner] });
  const titleCls = r.winner === -1 ? 'muted' : r.winner === 0 ? 'team-a' : 'team-b';
  let reason = T.results.reasonDraw;
  if (r.reason === 'elimination') reason = won ? T.results.reasonElim : (myTeam === -1 || myTeam == null) ? T.results.reasonElimNeutral : T.results.reasonElimLost;
  else if (r.reason === 'timeout') {
    const rv = r.remainingValue || [0, 0];
    const hi = Math.max(rv[0], rv[1]);
    reason = hi > 0 && Math.abs(rv[0] - rv[1]) / hi <= 0.02 ? T.results.reasonTimeoutDmg : T.results.reasonTimeout;
  }

  const players = (start.players || []).slice().sort((a, b) => a.team - b.team || a.name.localeCompare(b.name));
  const meta = props.meta;
  const tickRate = start.tickRate || TICK_RATE;

  // ---- progression: stars / score / records (single-player), contribution (team formats) ----
  const rec = mode === 'sp' && meta ? ctx.recordResult({ result: r, start, meta, myPlayerId: props.myPlayerId }) : null;
  const rating = rec ? rec.rating : rateBattle({ result: r, start, myPlayerId: props.myPlayerId });
  const progEl = h('div.res-progress', { test: 'result-progress' });
  if (rec && rec.campaign) {
    const prevStars = rec.prev ? rec.prev.stars : 0;
    if (rating.won) {
      const tag = rec.newStars ? (prevStars > 0 ? T.progress.newRecord : T.progress.firstClear) : fmt(T.progress.bestStars, { stars: prevStars });
      add(progEl, h('div.res-stars', { test: 'result-stars', 'data-stars': String(rating.stars), 'data-new': rec.newStars ? '1' : '0' },
        h('span.glyphs', { text: starGlyphs(rating.stars) }), h('span', { text: ` ${fmt(T.progress.starsLine, { glyphs: '', stars: rating.stars }).trim()}` }), h('span.tag', { class: rec.newStars ? 'ok' : 'muted', text: ` — ${tag}` })));
      const miss = rating.missing[0];
      if (miss === 'value') progEl.appendChild(h('div.small.muted', { test: 'result-missing', text: fmt(T.progress.missingValue, { need: pctText(STAR_RULES.valueFrac), pct: pctText(rating.remainingFrac) }) }));
      else if (miss === 'capital') progEl.appendChild(h('div.small.muted', { test: 'result-missing', text: fmt(rating.hadCapital ? T.progress.missingCapitalLost : T.progress.missingCapital, { fast: STAR_RULES.fastSeconds, time: mmss(rating.seconds) }) }));
    }
    const best = rec.prev ? Math.max(rec.prev.score, rating.won ? rating.score : 0) : (rating.won ? rating.score : 0);
    progEl.appendChild(h('div.res-score.small', { test: 'result-score', 'data-score': String(rating.score), title: T.progress.scoreHint },
      h('span', { text: fmt(T.progress.score, { score: num(rating.score) }) }),
      rec.newScore ? h('span.ok', { text: ` · ${T.progress.scoreNew}` }) : best > 0 ? h('span.muted', { text: ` · ${fmt(T.progress.scoreBest, { best: num(best) })}` }) : null));
    for (const f of rec.unlocked.factions) {
      progEl.appendChild(h('div.ok.res-unlock', { test: 'unlock-faction', 'data-id': f, text: fmt(T.progress.unlockedFaction, { name: FACTIONS[f] ? FACTIONS[f].name : f }) }));
    }
    for (const cls of rec.unlocked.ships) {
      const s = SHIPS[cls];
      progEl.appendChild(h('div.ok.res-unlock', { test: 'unlock-ship', 'data-id': cls, text: fmt(T.progress.unlockedClass, { size: T.builder.sizeClass[s.sizeClass] || s.sizeClass, faction: FACTIONS[s.faction] ? FACTIONS[s.faction].short : s.faction }) }));
    }
    if (rec.unlocked.factions.length || rec.unlocked.ships.length) progEl.appendChild(h('div.tiny.muted', { text: T.progress.unlockedHint }));
  } else if (rec && rec.skirmish) {
    if (rating.contribution) progEl.appendChild(h('div', { test: 'result-contribution', text: fmt(T.progress.contribution, { pct: pctText(rating.contribution.share) }) }));
    const sk = rec.skirmish;
    progEl.appendChild(h('div.small', { test: 'result-skirmish', class: sk.newRecord ? 'ok' : 'muted', text: sk.newRecord
      ? fmt(T.progress.skirmishNew, { format: sk.format, score: num(rating.score) })
      : fmt(T.progress.skirmish, { format: sk.format, wins: sk.record.wins, played: sk.record.played, best: num(sk.record.best) }) }));
    progEl.appendChild(h('div.tiny.muted', { text: T.progress.skirmishNote }));
  } else if (rating && rating.contribution) {
    progEl.appendChild(h('div', { test: 'result-contribution', text: fmt(T.progress.contribution, { pct: pctText(rating.contribution.share) }) }));
  }

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

  // ---- debrief ----
  const debriefStops = [];
  let focusId = players.some((p) => p.id === props.myPlayerId) ? props.myPlayerId : (players[0] ? players[0].id : null);
  const debriefBody = h('div.debrief-grid');
  const smallShip = (cls, team) => {
    const cv = h('canvas', { width: 48, height: 34, title: SHIPS[cls] ? SHIPS[cls].name : cls });
    debriefStops.push(animateShip(cv, cls, { team, angle: team === 0 ? -0.2 : Math.PI + 0.2, pad: 3 }, { animate: false }));
    return cv;
  };
  function renderDebrief() {
    for (const s of debriefStops) s();
    debriefStops.length = 0;
    clear(debriefBody);
    const p = players.find((x) => x.id === focusId);
    if (!p) return;
    const ps = (r.players && r.players[p.id]) || {};
    const hull = enemyHulls(start, p.team)[0] || null;
    // ships lost by class
    const lostCol = h('div.dcol', { test: 'debrief-lost' }, h('h4', { text: T.progress.lostByClass }));
    const byClass = shipsByClass(p, ps).filter((x) => x.lost);
    if (!byClass.length) lostCol.appendChild(h('div.small.muted', { text: T.progress.noLosses }));
    for (const row of byClass) {
      lostCol.appendChild(h('div.drow', smallShip(row.cls, p.team), h('span', { text: SHIPS[row.cls] ? SHIPS[row.cls].name : row.cls }),
        h('span.n', { class: row.lost === row.total ? 'danger' : 'warn', text: fmt(T.progress.lostRow, { lost: row.lost, total: row.total }) })));
    }
    // damage by weapon type vs the enemy hull
    const dmgCol = h('div.dcol', { test: 'debrief-damage' }, h('h4', { text: T.progress.damageByType }, hull ? h('span.tiny.muted', { text: ` · ${fmt(T.progress.vsHull, { hull: T.hullType[hull] || hull })}` }) : null));
    const drows = damageRows(ps, hull);
    if (!drows.length) dmgCol.appendChild(h('div.small.muted', { text: T.progress.noDamage }));
    for (const d of drows) {
      const name = d.type === 'true' ? T.progress.trueDamage : (WEAPON_TYPE_NAMES[d.type] || d.type);
      const cls = d.mult === null ? '' : d.mult > 1.05 ? 'good' : d.mult < 0.95 ? 'bad' : '';
      dmgCol.appendChild(h('div.drow', { test: `damage-${d.type}` },
        h('span.chip', { class: `w-${d.type} ${cls}`, text: name }),
        h('div.bar', h('div.bar-fill', { style: { width: `${Math.round(d.frac * 100)}%` } })),
        h('span.n', { text: num(d.dmg) }),
        d.mult !== null ? h('span.mult', { class: cls, text: multText(d.mult) }) : null));
    }
    // top killer per side + tips (for the human player)
    const kCol = h('div.dcol', { test: 'debrief-killers' }, h('h4', { text: T.progress.topKiller }));
    const ks = topKillers(r, start);
    for (let t = 0; t < 2; t++) {
      const k = ks[t];
      const label = h('span', { class: t === 0 ? 'team-a' : 'team-b', text: `${T.app.teamShort[t]}: ` });
      if (!k) { kCol.appendChild(h('div.drow.small', label, h('span.muted', { text: T.progress.noKills }))); continue; }
      kCol.appendChild(h('div.drow', { test: `killer-${t}` }, smallShip(k.cls, t), h('span', label, fmt(T.progress.topKillerRow, { ship: SHIPS[k.cls].name, owner: k.ownerName, n: k.kills }))));
    }
    if (p.id === props.myPlayerId && rating) {
      const tips = buildTips({ result: r, start, myPlayerId: p.id, rating, hullNames: T.hullType, typeNames: WEAPON_TYPE_NAMES });
      if (tips.length) {
        kCol.appendChild(h('h4', { style: { marginTop: '8px' }, text: T.progress.tipsTitle }));
        for (const tip of tips) kCol.appendChild(h('div.tip', { test: `tip-${tip.id}`, text: fmt(T.progress.tips[tip.id], tip.params) }));
      }
    }
    add(debriefBody, lostCol, dmgCol, kCol);
  }
  // 'Ver frotas': both fleets as the pre-battle reveal shows them
  let fleetsEl = null;
  const fleetsBtn = button(T.progress.showFleets, { test: 'show-fleets', class: 'btn-sm', onClick: () => {
    if (fleetsEl) { fleetsEl.remove(); fleetsEl = null; fleetsBtn.textContent = T.progress.showFleets; return; }
    fleetsEl = renderFleets(); debriefPanel.appendChild(fleetsEl); fleetsBtn.textContent = T.progress.hideFleets;
  } });
  function renderFleets() {
    const side = (t) => {
      const el = h('div.side', { class: t === 1 ? 'right' : '' });
      for (const p of players.filter((x) => x.team === t)) {
        const f = FACTIONS[p.faction];
        const row = h('div.ships-row');
        const seen = new Map();
        for (const cls of fleetToArray(p.fleet)) seen.set(cls, (seen.get(cls) || 0) + 1);
        for (const [cls, n] of seen) {
          row.appendChild(h('span', { style: { position: 'relative' } }, smallShip(cls, t), h('span.badge.tiny', { text: `×${n}`, style: { position: 'absolute', right: '0', bottom: '0', fontSize: '9px', padding: '0 3px', background: 'rgba(5,7,12,.7)' } })));
        }
        el.appendChild(h('div.pl',
          h('div.pn', { class: t === 0 ? 'team-a' : 'team-b', text: p.name + (p.id === props.myPlayerId ? ` (${T.app.you})` : '') }),
          h('div.small.muted', { text: [f ? f.name : p.faction, f ? `${T.codex.hullType}: ${T.hullType[f.hull] || f.hull}` : ''].filter(Boolean).join(' · ') }),
          row));
      }
      return el;
    };
    return h('div.reveal.res-reveal', { test: 'result-fleets' }, side(0), h('div.vs', { text: T.battle.vs }), side(1));
  }
  const debriefPanel = h('div.panel.debrief', { test: 'debrief' },
    h('div.debrief-head', h('h3', { text: T.progress.debrief }),
      h('div.row.gap.wrap',
        players.length > 1 ? h('label.row.gap.small', h('span.muted', { text: T.progress.debriefPlayer }), select(players.map((p) => ({ value: p.id, label: p.name })), { value: focusId, test: 'debrief-player', onChange: (e) => { focusId = e.target.value; renderDebrief(); } })) : null,
        fleetsBtn)),
    debriefBody);
  renderDebrief();

  // actions
  const actions = h('div.res-actions');
  if (mode === 'sp' && meta) {
    const setup = meta.setup;
    const next = { ...setup, level: setup.level + 1 };
    const nl = levelInfo(next.level);
    const nf = FACTIONS[nl.enemyFaction];
    add(actions,
      button(T.results.playAgain, { test: 'play-again', primary: true, title: T.results.playAgainHint, onClick: () => ctx.startSinglePlayer(setup, meta.playerFleet, { seed: randomSeed(), speed: props.speed }) }),
      won ? h('button.btn.btn-primary.btn-next', { type: 'button', test: 'next-level', title: nl.desc, onClick: () => { ctx.saveSpSetup(next); ctx.startSinglePlayer(next, meta.playerFleet, { seed: randomSeed(), speed: props.speed }); } },
        h('span', { text: fmt(T.progress.nextLevel, { n: nl.n, name: nl.name }) }),
        h('span.k', { text: fmt(T.progress.nextLevelVs, { faction: nf ? nf.name : T.sp.randomFaction }) })) : null,
      button(T.results.editFleet, { test: 'edit-fleet', onClick: () => ctx.go('fleetBuilder', { mode: 'sp', setup: won ? next : setup, budget: spBudgetPoints(setup), fleet: meta.playerFleet }) }),
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
    const spectator = myTeam === null || myTeam === undefined;
    // Spectators cannot vote (the server answers SLOT_INVALID): no rematch button for them.
    const rematchBtn = spectator ? null : button(votesLabel(), { test: 'rematch', primary: true, onClick: () => { rematchBtn.disabled = true; net.rematch().catch((e) => { rematchBtn.disabled = false; ctx.toast(errorMessage(e && e.code || 'UNKNOWN', e && e.detail), 'error'); }); } });
    let leaving = false;
    add(actions, rematchBtn, button(T.results.leave, { test: 'leave-room', class: 'btn-danger', onClick: async () => {
      leaving = true;
      try { await net.leaveRoom(); } catch { /* ignore */ }
      if (!disposed) ctx.go('lobby');
    } }));
    offs.push(net.onRoom((room) => {
      if (rematchBtn) rematchBtn.textContent = votesLabel();
      if (room.phase === 'lobby') ctx.go('lobby');
    }));
    offs.push(net.onLeft((reason) => {
      if (disposed || leaving) return; // our own 'Sair': the click handler navigates
      if (reason === 'room_closed') ctx.toast(T.lobby.roomClosed, 'warn');
      else if (reason === 'kicked') ctx.toast(T.lobby.kicked, 'warn');
      ctx.go('lobby');
    }));
    offs.push(net.feed.onStart(() => { if (!disposed) ctx.go('battle', { mode: 'mp' }); }));
  } else {
    add(actions, button(T.results.menu, { test: 'result-menu', onClick: () => ctx.go('menu') }));
  }

  const el = h('div.screen',
    h('div.res-head',
      h('div.res-title', { class: titleCls, test: 'result-winner', 'data-winner': String(r.winner), text: titleText.toUpperCase() }),
      myTeam !== null && myTeam !== undefined && r.winner !== -1 ? h('div', { class: won ? 'ok' : 'danger', text: won ? T.results.youWon : T.results.youLost }) : null,
      h('div.res-reason', { test: 'result-reason', text: reason }),
      h('div.small.muted', { text: fmt(T.results.duration, { time: ticksToClock(r.ticks, tickRate) }) }),
      props.cleared && meta && rec && rec.campaign ? h('div.ok', { test: 'level-cleared', text: fmt(T.results.levelCleared, { level: meta.setup.level, difficulty: difficultyName(meta.setup.difficulty) }) }) : null,
      progEl,
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
    debriefPanel,
  );
  root.appendChild(el);
  try { ctx.audio.setScene(r.winner === -1 ? 'menu' : won ? 'victory' : 'defeat'); } catch { /* ignore */ }
  return { unmount() { disposed = true; for (const s of stops) s(); for (const s of debriefStops) s(); for (const off of offs) off(); } };
}
