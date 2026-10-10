// Fleet builder (single-player and multiplayer): faction selector with live
// mothership cards, roster cards with live sprites and stat bars, +/- buttons,
// budget bar, presets, autocomplete, clear, fleet summary with composition and
// pt-BR validation messages.

import { T, fmt, fleetErrorMessage, errorMessage, difficultyName } from '../i18n.js';
import { h, clear, button, tooltip, svgIcon, statBar, add } from '../util/dom.js';
import { num, dec } from '../util/format.js';
import { animateShip } from '../util/shipCanvas.js';
import { randomSeed } from '../util/url.js';
import { DEFAULT_BUDGET, FLEET_LIMITS } from '/shared/constants.js';
import { FACTIONS, FACTION_IDS, SHIPS, SHIP_LIST, SIZE_CLASSES, SIZE_CLASS, ABILITIES, WEAPON_TYPE_NAMES, DAMAGE_MULT, shipsOfFaction, presetsOfFaction, shipDps, shipEhp } from '/shared/catalog.js';
import { validateFleet, normalizeFleet, fleetCost, fleetShipCount, fleetSummary, presetFleet, autoComplete, sizeClassCap } from '/shared/fleet.js';
import { createRng } from '/shared/rng.js';
import { levelInfo } from '/shared/levels.js';

const MAX = {
  hp: Math.max(...SHIP_LIST.map((s) => s.hp)),
  shield: Math.max(...SHIP_LIST.map((s) => s.shield.cap)),
  dps: Math.max(...SHIP_LIST.map((s) => shipDps(s))),
  speed: Math.max(...SHIP_LIST.map((s) => s.speed)),
};
const scale = (v, max) => Math.sqrt(Math.max(0, v) / max);

/**
 * @param {{ mode:'sp'|'mp', setup?:object, budget?:number, fleet?:object|null, room?:object, onConfirm?:(fleet:object)=>Promise<void>|void, onBack?:()=>void }} props
 */
export function mount(root, props, ctx) {
  const { state } = ctx;
  const mode = props.mode || 'sp';
  const budget = props.budget || DEFAULT_BUDGET;
  const initial = props.fleet && FACTION_IDS.includes(props.fleet.faction) ? normalizeFleet(props.fleet) : null;
  let faction = initial ? initial.faction : (state.lastFleet && FACTION_IDS.includes(state.lastFleet.faction) ? state.lastFleet.faction : 'terran');
  /** @type {Record<string, Map<string, number>>} per-faction drafts */
  const drafts = {};
  const draft = () => { if (!drafts[faction]) drafts[faction] = new Map(); return drafts[faction]; };
  if (initial) for (const e of initial.ships) draft().set(e.cls, e.count);
  const stops = [];
  let busy = false;

  function fleet() {
    return normalizeFleet({ faction, ships: [...draft()].map(([cls, count]) => ({ cls, count })) });
  }
  function setFleet(f) {
    const d = draft(); d.clear();
    for (const e of normalizeFleet(f).ships) d.set(e.cls, e.count);
    refresh();
  }
  function countBySize(f) {
    const by = {};
    for (const sc of SIZE_CLASSES) by[sc] = 0;
    for (const e of f.ships) { const s = SHIPS[e.cls]; if (s) by[s.sizeClass] += e.count; }
    return by;
  }
  function canAdd(cls) {
    const ship = SHIPS[cls];
    const f = fleet();
    if (fleetShipCount(f) >= FLEET_LIMITS.maxShips) return { ok: false, why: fmt(T.fleetErr.FLEET_SHIP_COUNT_MAX, { max: FLEET_LIMITS.maxShips }) };
    const by = countBySize(f);
    const cap = sizeClassCap(faction, ship.sizeClass);
    if (by[ship.sizeClass] >= cap) return { ok: false, why: fmt(T.builder.capReached, { cap, size: T.builder.sizeClass[ship.sizeClass].toLowerCase() }) };
    return { ok: true };
  }
  function buyShip(cls) {
    const c = canAdd(cls);
    if (!c.ok) { ctx.toast(c.why, 'warn', 1800); return; }
    draft().set(cls, (draft().get(cls) || 0) + 1);
    try { ctx.audio.play('ui.buy'); } catch { /* ignore */ }
    refresh();
  }
  function sellShip(cls) {
    const n = draft().get(cls) || 0;
    if (n <= 1) draft().delete(cls); else draft().set(cls, n - 1);
    refresh();
  }

  // ---- enemy intel (what you are about to fight and what hurts it) ----
  function enemyFactionId() {
    if (mode === 'sp') { const s = props.setup || state.spSetup; const lv = levelInfo(s.level); return lv.enemyFaction && FACTIONS[lv.enemyFaction] ? lv.enemyFaction : null; }
    const room = props.room || (state.net && state.net.room);
    const myId = state.net ? state.net.playerId : null;
    if (!room || !room.slots) return null;
    let myTeam = -1;
    for (let t = 0; t < room.slots.length; t++) for (const sl of room.slots[t]) if (sl && sl.playerId === myId) myTeam = t;
    if (myTeam < 0) return null;
    const enemy = (room.slots[1 - myTeam] || []).map((sl) => sl && sl.faction).filter((f) => f && FACTIONS[f]);
    return enemy.length === 1 ? enemy[0] : null;
  }
  const enemyFid = enemyFactionId();
  const enemyHull = enemyFid ? FACTIONS[enemyFid].hull : null;
  /** weapon types sorted by multiplier vs the enemy hull: [[type, mult], ...] */
  const vsEnemy = enemyHull ? Object.keys(DAMAGE_MULT).map((w) => [w, DAMAGE_MULT[w][enemyHull] ?? 1]).sort((a, b) => b[1] - a[1]) : [];
  const multText = (m) => `×${m.toFixed(1).replace('.', ',')}`;
  let enemyEl = null;
  if (enemyFid) {
    const ef = FACTIONS[enemyFid];
    const lv = mode === 'sp' ? levelInfo((props.setup || state.spSetup).level) : null;
    const boss = lv && lv.boss && SHIPS[lv.boss] ? SHIPS[lv.boss].name : lv && lv.bossSizeClass ? T.builder.sizeClass[lv.bossSizeClass] : null;
    const good = vsEnemy.filter((r) => r[1] > 1.05).slice(0, 3), bad = vsEnemy.filter((r) => r[1] < 0.95).slice(-3).reverse();
    enemyEl = h('div.panel.tight.enemy-intel', { test: 'enemy-intel' },
      h('div.row.gap.wrap',
        h('span.badge', { class: `f-${enemyFid}`, text: T.builder.enemy }),
        h('b', { text: ef.name }),
        h('span.muted', { text: `${T.codex.hullType}: ${T.hullType[ef.hull] || ef.hull}` }),
        boss ? h('span.muted', { text: `${T.sp.boss}: ${boss}` }) : null,
      ),
      h('div.row.gap.wrap.small', { style: { marginTop: '4px' } },
        good.length ? h('span', h('span.ok', { text: `${T.builder.strongVs} ` }), ...good.map(([w, m]) => h('span.chip.good', { class: `w-${w}`, text: `${WEAPON_TYPE_NAMES[w]} ${multText(m)}` }))) : null,
        bad.length ? h('span', h('span.danger', { text: `${T.builder.weakVs} ` }), ...bad.map(([w, m]) => h('span.chip.bad', { class: `w-${w}`, text: `${WEAPON_TYPE_NAMES[w]} ${multText(m)}` }))) : null,
        h('span.tiny.muted', { text: T.builder.enemyHint }),
      ),
    );
  }
  const chipClass = (w) => { if (!enemyHull) return ''; const m = DAMAGE_MULT[w.type] ? (DAMAGE_MULT[w.type][enemyHull] ?? 1) : 1; return m > 1.05 ? 'good' : m < 0.95 ? 'bad' : ''; };

  // ---- header / budget ----
  const costEl = h('span.num', { test: 'budget-cost' });
  const budgetFill = h('div.bar-fill');
  const budgetBar = h('div.bar.budget', budgetFill);
  const shipsEl = h('span.muted', { test: 'ship-count' });
  const remainEl = h('span.small');
  const budgetHead = h('div.budget-head',
    h('span.muted.small', { text: T.builder.budget }), costEl, h('div.grow', { style: { minWidth: '140px' } }, budgetBar), remainEl, shipsEl,
  );

  // ---- faction cards ----
  const factionCards = h('div.faction-cards', { test: 'faction-cards' });
  const factionBtns = new Map();
  for (const fid of FACTION_IDS) {
    const f = FACTIONS[fid];
    const mother = shipsOfFaction(fid).find((s) => s.sizeClass === 'mothership');
    const cv = h('canvas', { width: 220, height: 86 });
    stops.push(animateShip(cv, mother.id, { angle: -0.3, pad: 6, maxZoom: 0.7 }));
    const b = h('button.faction-card', { type: 'button', test: `faction-${fid}`, style: { '--fc': f.color }, onClick: () => selectFaction(fid) },
      cv, h('div.fname', { text: f.name }), h('div.ftag', { text: f.tagline }));
    factionBtns.set(fid, b);
    factionCards.appendChild(b);
  }
  const loreEl = h('div.faction-lore');

  // ---- roster ----
  const roster = h('div.roster', { test: 'roster' });
  const cards = new Map();
  function buildRoster() {
    for (const s of stops.splice(4)) s();
    clear(roster); cards.clear();
    for (const ship of shipsOfFaction(faction)) {
      const cv = h('canvas', { width: 180, height: 96 });
      let hoverA = 0;
      stops.push(animateShip(cv, ship.id, () => ({ angle: -0.35 + hoverA, pad: 6, maxZoom: 2.4 })));
      const qty = h('span.qty.zero', { test: `ship-qty-${ship.id}`, text: '0' });
      const btnMinus = h('button.btn.btn-sm.btn-icon', { type: 'button', test: `ship-remove-${ship.id}`, title: fmt(T.builder.remove, { name: ship.name }), onClick: (e) => { e.stopPropagation(); sellShip(ship.id); } }, '−');
      const btnPlus = h('button.btn.btn-sm.btn-icon', { type: 'button', test: `ship-add-${ship.id}`, title: fmt(T.builder.add, { name: ship.name }), onClick: (e) => { e.stopPropagation(); buyShip(ship.id); } }, '+');
      const cap = sizeClassCap(faction, ship.sizeClass);
      const ab = ABILITIES[ship.ability];
      // a real button: on touch a tap opens the description instead of buying the ship
      const abEl = h('button.sc-ability-btn', { type: 'button', test: `ship-ability-${ship.id}`, 'data-sfx': 'none', 'aria-label': ab ? fmt(T.builder.abilityOf, { name: ab.name }) : '' }, h('b', { text: ab ? ab.name : '' }));
      if (ab) {
        const tip = tooltip(abEl, `${ab.name} (${T.codex.kind[ab.kind] || ab.kind})\n${ab.desc}${ab.cooldown ? `\n${fmt(T.codex.cooldown, { s: ab.cooldown })}` : ''}`);
        abEl.addEventListener('click', (e) => { e.stopPropagation(); tip.toggle(); });
      }
      const countBadge = h('span.sc-count.hidden');
      const card = h('div.ship-card', { test: `ship-card-${ship.id}`, role: 'button', tabindex: '0', title: T.builder.hint,
        onClick: () => buyShip(ship.id),
        onKeydown: (e) => { if (e.key === 'Enter' || e.key === '+') { e.preventDefault(); buyShip(ship.id); } else if (e.key === '-' || e.key === 'Backspace') { e.preventDefault(); sellShip(ship.id); } },
        onPointermove: (e) => { const r = cv.getBoundingClientRect(); hoverA = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 0.5; },
        onPointerleave: () => { hoverA = 0; },
      },
        countBadge, cv,
        h('div.sc-head', h('div.sc-name', { text: ship.name }), h('div.sc-cost', `${ship.cost}`, h('small', ` ${T.app.points}`))),
        h('div.sc-meta', h('span.badge', { class: `f-${faction}`, text: T.builder.sizeClass[ship.sizeClass] }), h('span', { text: T.builder.role[ship.role] || ship.role }), h('span', { text: `${T.builder.max.replace('{n}', String(cap))}` })),
        h('div.sc-stats',
          statBar(T.builder.hull, scale(ship.hp, MAX.hp), { icon: 'hull', text: num(ship.hp), title: `${T.builder.hull}: ${ship.hp}${ship.dr ? ` · RD ${ship.dr}` : ''}${ship.regen ? ` · regen ${ship.regen}/s` : ''}` }),
          statBar(T.builder.shield, scale(ship.shield.cap, MAX.shield), { icon: 'shield', text: ship.shield.cap ? num(ship.shield.cap) : '—', title: ship.shield.cap ? `${T.builder.shield}: ${ship.shield.cap}` : T.builder.noShield, color: ship.shield.cap ? 'linear-gradient(90deg,#7dff9a,#35c8ff)' : '' }),
          statBar(T.builder.dps, scale(shipDps(ship), MAX.dps), { icon: 'dps', text: dec(shipDps(ship), 0), title: `${T.builder.dps}: ${dec(shipDps(ship), 1)} · ${T.builder.range} ${Math.max(...ship.weapons.map((w) => w.range))} u`, color: 'linear-gradient(90deg,#ffb347,#ff7a3d)' }),
          statBar(T.builder.speed, scale(ship.speed, MAX.speed), { icon: 'speed', text: num(ship.speed), title: `${T.builder.speed}: ${ship.speed} u/s`, color: 'linear-gradient(90deg,#7c5cff,#b8f0ff)' }),
        ),
        h('div.sc-chips', ship.weapons.map((w) => h('span.chip', { class: `w-${w.type} ${chipClass(w)}`, title: `${w.name} · ${WEAPON_TYPE_NAMES[w.type]} · ${w.damage}×${w.salvo} / ${w.cooldown}s · ${w.range}u${enemyHull ? ` · ${T.builder.vsEnemyHull} ${multText(DAMAGE_MULT[w.type] ? (DAMAGE_MULT[w.type][enemyHull] ?? 1) : 1)}` : ''}`, text: WEAPON_TYPE_NAMES[w.type] }))),
        h('div.sc-ability', svgIcon('star', 11), abEl),
        h('div.sc-ctl', btnMinus, qty, btnPlus),
      );
      cards.set(ship.id, { card, qty, btnPlus, btnMinus, countBadge, cap, ship });
      roster.appendChild(card);
    }
  }

  // ---- presets ----
  const presetRow = h('div.preset-row', { test: 'presets' });
  function buildPresets() {
    clear(presetRow);
    for (const p of presetsOfFaction(faction)) {
      const b = button(p.name, { test: `preset-${p.id}`, class: 'btn-sm', title: p.desc, onClick: () => { setFleet(presetFleet(p.id, budget)); ctx.toast(fmt(T.builder.presetApplied, { name: p.name }), 'ok', 1500); } });
      presetRow.appendChild(b);
    }
    add(presetRow, 
      button(T.builder.autocomplete, { test: 'autocomplete', class: 'btn-sm', title: T.builder.autocompleteHint, onClick: () => {
        const before = fleetShipCount(fleet());
        const f = autoComplete(fleet(), budget, createRng(randomSeed()));
        setFleet(f);
        ctx.toast(fmt(T.builder.autocompleted, { n: fleetShipCount(f) - before }), 'ok', 1500);
      } }),
      button(T.builder.clear, { test: 'clear', class: 'btn-sm btn-ghost', onClick: () => { draft().clear(); refresh(); } }),
    );
  }

  // ---- summary ----
  const listEl = h('div.fleet-list', { test: 'fleet-list' });
  const compBar = h('div.comp-bar');
  const compLegend = h('div.comp-legend');
  const totalsEl = h('div.row.between.small.muted');
  const validEl = h('div.validation', { test: 'fleet-validation' });
  const confirmBtn = button(mode === 'sp' ? T.builder.confirmSp : T.builder.confirmMp, { test: 'fleet-confirm', primary: true, class: 'btn-lg btn-block', onClick: confirm });
  // the same action inside the sticky budget bar (phones/tablets scroll the side panel away)
  const confirmBtnSm = button(mode === 'sp' ? T.builder.confirmSp : T.builder.confirmMp, { test: 'fleet-confirm-sm', primary: true, class: 'btn-sm fb-confirm-sm', onClick: confirm });

  function refresh() {
    const f = fleet();
    const cost = fleetCost(f), count = fleetShipCount(f);
    const v = validateFleet(f, budget);
    const by = countBySize(f);
    costEl.textContent = fmt(T.builder.budgetValue, { cost: num(cost), budget: num(budget) });
    budgetFill.style.width = `${Math.min(100, (cost / budget) * 100)}%`;
    budgetBar.classList.toggle('warn', cost >= budget * 0.9 && cost <= budget);
    budgetBar.classList.toggle('over', cost > budget);
    shipsEl.textContent = fmt(T.builder.shipsCount, { count, max: FLEET_LIMITS.maxShips });
    remainEl.textContent = cost > budget ? fmt(T.builder.over, { n: num(cost - budget) }) : fmt(T.builder.remaining, { n: num(budget - cost) });
    remainEl.className = 'small ' + (cost > budget ? 'danger' : budget - cost === 0 ? 'ok' : 'muted');
    for (const [cls, c] of cards) {
      const n = draft().get(cls) || 0;
      c.qty.textContent = String(n);
      c.qty.classList.toggle('zero', n === 0);
      c.card.classList.toggle('owned', n > 0);
      const atCap = by[c.ship.sizeClass] >= c.cap || count >= FLEET_LIMITS.maxShips;
      c.card.classList.toggle('maxed', atCap);
      c.btnPlus.disabled = atCap;
      c.btnMinus.disabled = n === 0;
      c.countBadge.classList.toggle('hidden', n === 0);
      c.countBadge.textContent = `×${n}`;
    }
    clear(listEl);
    if (!f.ships.length) listEl.appendChild(h('div.muted.small', { text: T.builder.emptyFleet }));
    for (const e of f.ships) {
      const s = SHIPS[e.cls];
      listEl.appendChild(h('div.fl-row', h('span.q', { text: `${e.count}×` }), h('span', { text: s.name }), h('span.c', { text: `${num(s.cost * e.count)}` })));
    }
    clear(compBar); clear(compLegend);
    for (const sc of SIZE_CLASSES) {
      if (!by[sc]) continue;
      compBar.appendChild(h('span', { class: `sz-${sc}`, style: { width: `${(by[sc] / Math.max(1, count)) * 100}%` }, title: `${T.builder.sizeClass[sc]}: ${by[sc]}` }));
      compLegend.appendChild(h('span', h('i', { class: `sz-${sc}` }), `${by[sc]} ${T.builder.sizeClass[sc].toLowerCase()}`));
    }
    const sum = fleetSummary(f);
    clear(totalsEl);
    add(totalsEl, h('span', `${T.builder.totalEhp} `, h('b.num', { text: num(sum.ehp) })), h('span', `${T.builder.totalDps} `, h('b.num', { text: num(sum.dps) })));
    if (!v.ok) { validEl.className = 'validation error'; validEl.textContent = fleetErrorMessage(v.code, v.detail); }
    else if (budget - cost > 0) { validEl.className = 'validation warn'; validEl.textContent = fmt(T.builder.warnUnspent, { n: num(budget - cost) }); }
    else { validEl.className = 'validation ok'; validEl.textContent = T.builder.valid; }
    confirmBtn.disabled = !v.ok || busy;
    confirmBtnSm.disabled = !v.ok || busy;
    confirmBtn.classList.toggle('btn-pulse', v.ok && !busy);
  }

  function selectFaction(fid) {
    if (fid === faction) return;
    faction = fid;
    for (const [k, b] of factionBtns) b.classList.toggle('on', k === fid);
    try { ctx.audio.setFactionHint(fid); } catch { /* ignore */ }
    renderLore();
    buildRoster();
    buildPresets();
    refresh();
  }

  function renderLore() {
    const f = FACTIONS[faction];
    clear(loreEl);
    add(loreEl, 
      h('div', h('div.row.gap', { style: { marginBottom: '4px' } }, h('span.badge', { class: `f-${faction}`, text: f.race }), h('b', { text: f.name })), h('p.small', { text: f.lore })),
      h('div.passive', h('div.tiny.muted', { text: T.builder.passive.toUpperCase() }), h('b', { text: f.passive.name }), h('div.small', { text: f.passive.desc }),
        h('div.tiny.muted', { style: { marginTop: '6px' } }, `${T.codex.hullType}: `, h('b', { text: T.hullType[f.hull] }))),
    );
  }

  async function confirm() {
    const f = fleet();
    const v = validateFleet(f, budget);
    if (!v.ok) { ctx.toast(fleetErrorMessage(v.code, v.detail), 'error'); return; }
    if (mode === 'sp') {
      ctx.startSinglePlayer(props.setup || state.spSetup, v.fleet);
      return;
    }
    busy = true; refresh();
    try {
      if (props.onConfirm) await props.onConfirm(v.fleet);
      else if (state.net) { await state.net.setFleet(v.fleet); state.mpFleet = v.fleet; ctx.saveLastFleet(v.fleet); ctx.toast(T.builder.fleetSent, 'ok'); ctx.go('lobby'); }
    } catch (e) {
      // server rejections carry protocol codes (FLEET_INVALID{code}, WRONG_PHASE, NOT_CONNECTED…), not only fleet codes
      ctx.toast(errorMessage(e && e.code || 'UNKNOWN', e && e.detail), 'error');
    } finally { busy = false; if (confirmBtn.isConnected) refresh(); }
  }

  const subtitle = mode === 'sp'
    ? (() => { const s = props.setup || state.spSetup; const lv = levelInfo(s.level); return fmt(T.builder.subtitleSp, { level: lv.n, levelName: lv.name, difficulty: difficultyName(s.difficulty) }); })()
    : fmt(T.builder.subtitleMp, { code: props.room ? props.room.code : (state.net && state.net.room ? state.net.room.code : '—'), budget: num(budget) });

  const el = h('div.screen.wide',
    h('div.screen-head',
      h('div.titles', h('h1', { text: T.builder.title }), h('div.subtitle', { text: subtitle })),
      h('div.actions', button(T.app.back, { test: 'back', onClick: () => { if (props.onBack) props.onBack(); else ctx.go(mode === 'sp' ? 'spSetup' : 'lobby'); } })),
    ),
    h('div.fb-layout',
      h('div.fb-main',
        h('div.panel.tight', h('h3', { text: T.builder.faction }), factionCards, h('div', { style: { marginTop: '10px' } }, loreEl)),
        enemyEl,
        h('div.panel.tight.fb-budget', budgetHead, confirmBtnSm),
        h('div.panel.tight', h('div.panel-title', h('h3', { text: T.builder.presets })), presetRow),
        h('div.panel.tight', h('div.panel-title', h('h3', { text: T.builder.roster }), h('span.tiny.muted', { text: T.builder.hint })), roster),
      ),
      h('div.fb-side',
        h('div.panel', h('h3', { text: T.builder.summary }), listEl,
          h('div', { style: { marginTop: '10px' } }, h('div.tiny.muted', { text: T.builder.composition }), compBar, compLegend),
          h('div', { style: { marginTop: '8px' } }, totalsEl),
          h('div', { style: { marginTop: '10px' } }, validEl),
          h('div', { style: { marginTop: '10px' } }, confirmBtn),
        ),
      ),
    ),
  );
  root.appendChild(el);
  factionBtns.get(faction).classList.add('on');
  renderLore(); buildRoster(); buildPresets(); refresh();
  try { ctx.audio.setScene('builder'); ctx.audio.setFactionHint(faction); } catch { /* ignore */ }

  return { unmount() { for (const s of stops) s(); } };
}
