// Fleet builder (single-player and multiplayer): faction selector with live
// mothership cards, roster cards with live sprites and stat bars, +/- buttons,
// budget bar, presets, autocomplete, clear, fleet summary with composition and
// pt-BR validation messages.

import { T, fmt, fleetErrorMessage, errorMessage, difficultyName } from '../i18n.js';
import { h, clear, button, tooltip, svgIcon, statBar, add, select } from '../util/dom.js';
import { createFleetLibraryPanel } from './fleetLibraryPanel.js';
import { num, dec } from '../util/format.js';
import { animateShip } from '../util/shipCanvas.js';
import { randomSeed } from '../util/url.js';
import { DEFAULT_BUDGET, FLEET_LIMITS } from '/shared/constants.js';
import { FACTIONS, FACTION_IDS, SHIPS, SHIP_LIST, SIZE_CLASSES, SIZE_CLASS, ABILITIES, WEAPON_TYPE_NAMES, shipsOfFaction, presetsOfFaction, shipDps, shipEhp } from '/shared/catalog.js';
import { validateFleet, normalizeFleet, fleetCost, fleetShipCount, fleetSummary, presetFleet, autoComplete, sizeClassCap } from '/shared/fleet.js';
import { createRng } from '/shared/rng.js';
import { levelInfo } from '/shared/levels.js';
import { PILOT_COST } from '/shared/pilot.js';

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
  const matchBudget = props.budget || DEFAULT_BUDGET;
  let pilot = mode === 'mp' ? !!props.room?.pilotsEnabled : !!props.fleet?.pilot;
  let budget = matchBudget - (pilot ? PILOT_COST : 0);
  const initial = props.fleet && FACTION_IDS.includes(props.fleet.faction) ? normalizeFleet(props.fleet) : null;
  let faction = initial ? initial.faction : (state.lastFleet && FACTION_IDS.includes(state.lastFleet.faction) ? state.lastFleet.faction : 'terran');
  /** @type {Record<string, Map<string, number>>} per-faction drafts */
  const drafts = {};
  const draft = () => { if (!drafts[faction]) drafts[faction] = new Map(); return drafts[faction]; };
  if (initial) for (const e of initial.ships) draft().set(e.cls, e.count);
  const stops = [];
  let busy = false;
  let tutorialUpdate = () => {};
  let planning = { formation: 'balanced', position: 'center', priority: 'balanced', ...(initial?.planning || {}) };

  function fleet() {
    return { ...normalizeFleet({ faction, ships: [...draft()].map(([cls, count]) => ({ cls, count })) }), planning: { ...planning }, ...(pilot ? { pilot: true } : {}) };
  }
  function setFleet(f) {
    if (f.planning) planning = { ...planning, ...f.planning };
    if (planningControls) for (const [key, control] of planningControls) control.value = planning[key];
    updateFormation();
    const d = draft(); d.clear();
    for (const e of normalizeFleet(f).ships) d.set(e.cls, e.count);
    refresh();
  }

  const planningControls = new Map();
  const planSelect = (key, label, values, hint) => {
    const control = select(values.map(([value, label]) => ({ value, label })), { value: planning[key], test: `plan-${key}`, onChange: () => { planning[key] = control.value; updateFormation(); } });
    planningControls.set(key, control);
    return h('label.field', h('span.lbl', label), control, h('span.tiny.muted', hint));
  };
  const formationPreview = h('div.formation-preview', { test: 'formation-preview', 'aria-label': 'Prévia esquemática da formação' });
  function updateFormation() {
    clear(formationPreview);
    const shape = planning.formation;
    const points = shape === 'wedge' ? [[65,50],[45,30],[45,70],[25,15],[25,85]]
      : shape === 'line' ? [[50,10],[50,30],[50,50],[50,70],[50,90]]
      : shape === 'screen' ? [[70,20],[70,50],[70,80],[30,35],[30,65]]
      : [[60,25],[60,75],[40,50],[20,25],[20,75]];
    for (const [x, y] of points) formationPreview.appendChild(h('span', { style: { left: `${x}%`, top: `${y}%` } }));
    formationPreview.dataset.position = planning.position;
  }
  const planningPanel = h('details.panel', { open: true, test: 'fleet-planning' }, h('summary', 'Plano de batalha'),
    formationPreview,
    planSelect('formation', 'Formação', [['balanced','Equilibrada'],['wedge','Cunha'],['line','Linha'],['screen','Tela de proteção']], 'Distribuição inicial; cada nave continua decidindo como lutar.'),
    planSelect('position', 'Posição inicial', [['front','Avançada'],['center','Central'],['rear','Retaguarda']], 'Ajusta a distância inicial até o inimigo.'),
    planSelect('priority', 'Prioridade de alvo', [['balanced','Equilibrada'],['weakest','Enfraquecidos'],['support','Suporte'],['capital','Naves capitais']], 'A IA pondera essa prioridade junto com alcance e função.'),
  );
  updateFormation();
  const pilotCheck = h('input', { type: 'checkbox', test: 'fleet-pilot', checked: pilot, disabled: mode === 'mp', onChange: () => { pilot = pilotCheck.checked; budget = matchBudget - (pilot ? PILOT_COST : 0); refresh(); } });
  const pilotPanel = h('div.panel.stack', h('label.check', pilotCheck, 'Pilotar a nave especial'),
    h('p.tiny.muted', `Reserva ${PILOT_COST} pontos para uma nave especial da sua facção. A frota continua automática. Setas movem; F dispara, E usa a habilidade e P alterna o piloto automático. Remapeie em Opções.`),
    h('p.tiny.muted', mode === 'mp' ? 'A disponibilidade é definida para os dois times pelo anfitrião; a licença do Perfil é necessária.' : 'Experimente no treino local. A licença do Perfil é necessária para partidas verificadas e pontos.'));
  const libraryPanel = createFleetLibraryPanel({ getFleet: fleet, onLoad: f => {
    selectFaction(f.faction);
    if (mode === 'sp') { pilot = !!f.pilot; pilotCheck.checked = pilot; budget = matchBudget - (pilot ? PILOT_COST : 0); }
    setFleet(f);
  }, toast: ctx.toast });
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
    for (const s of stops.splice(FACTION_IDS.length)) s();
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
      const abEl = h('b', { text: ab ? ab.name : '' });
      if (ab) tooltip(abEl, `${ab.name} (${T.codex.kind[ab.kind] || ab.kind})\n${ab.desc}${ab.cooldown ? `\n${fmt(T.codex.cooldown, { s: ab.cooldown })}` : ''}`);
      const countBadge = h('span.sc-count.hidden');
      const card = h('div.ship-card', { test: `ship-card-${ship.id}`, role: 'button', tabindex: '0', title: T.builder.hint,
        onClick: () => buyShip(ship.id),
        onKeydown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === '+' || e.key === ' ') { e.preventDefault(); buyShip(ship.id); } else if (e.key === '-' || e.key === 'Backspace') { e.preventDefault(); sellShip(ship.id); } },
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
        h('div.sc-chips', ship.weapons.map((w) => h('span.chip', { class: `w-${w.type}`, title: `${w.name} · ${WEAPON_TYPE_NAMES[w.type]} · ${w.damage}×${w.salvo} / ${w.cooldown}s · ${w.range}u`, text: WEAPON_TYPE_NAMES[w.type] }))),
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
    confirmBtn.classList.toggle('btn-pulse', v.ok && !busy);
    tutorialUpdate();
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
      ctx.startSinglePlayer(props.setup || state.spSetup, f, props.tutorial ? { seed: 'tutorial-v1', speed: 1, practice: true } : {});
      return;
    }
    busy = true; refresh();
    try {
      if (props.onConfirm) await props.onConfirm(f);
      else if (state.net) { await state.net.setFleet(f); state.mpFleet = f; ctx.saveLastFleet(f); ctx.toast(T.builder.fleetSent, 'ok'); ctx.go('lobby'); }
    } catch (e) {
      // server rejections carry protocol codes (FLEET_INVALID{code}, WRONG_PHASE, NOT_CONNECTED…), not only fleet codes
      ctx.toast(errorMessage(e && e.code || 'UNKNOWN', e && e.detail), 'error');
    } finally { busy = false; if (confirmBtn.isConnected) refresh(); }
  }

  const subtitle = mode === 'sp'
    ? (() => { const s = props.setup || state.spSetup; const lv = levelInfo(s.level); return fmt(T.builder.subtitleSp, { level: lv.n, levelName: lv.name, difficulty: difficultyName(s.difficulty) }); })()
    : fmt(T.builder.subtitleMp, { code: props.room ? props.room.code : (state.net && state.net.room ? state.net.room.code : '—'), budget: num(budget) });
  let tutorialStage = 0;
  const lessonTitle = h('h2'), lessonText = h('p.small');
  const nextLesson = button('Próximo passo', { test: 'tutorial-next', onClick: () => { tutorialStage = Math.min(2, tutorialStage + 1); tutorialUpdate(); } });
  const tutorialPanel = props.tutorial ? h('div.panel.tutorial', { test: 'tutorial-panel', role: 'region', 'aria-label': 'Tutorial' }, lessonTitle, lessonText, nextLesson) : null;
  tutorialUpdate = () => {
    if (!tutorialPanel) return;
    const lessons = [
      ['1 de 3 · Escolha uma frota', 'Selecione uma facção e aplique uma predefinição abaixo, ou compre naves com +. Cada nave usa parte do orçamento. Para continuar, adicione pelo menos uma nave.'],
      ['2 de 3 · Dê uma orientação', 'Abra o Plano de batalha. Experimente uma formação, posição inicial e prioridade de alvo. Elas orientam a IA; sua frota continua lutando automaticamente. Salve uma composição na Biblioteca para reutilizá-la.'],
      ['3 de 3 · Observe e aprenda', 'Inicie o treino no botão de confirmação. Use a roda do mouse para zoom, arraste para mover a câmera e clique em uma nave para acompanhá-la e ler sua doutrina. Espaço pausa; o relatório explica o resultado.'],
    ];
    lessonTitle.textContent = lessons[tutorialStage][0]; lessonText.textContent = lessons[tutorialStage][1];
    nextLesson.hidden = tutorialStage === 2; nextLesson.disabled = tutorialStage === 0 && fleetShipCount(fleet()) === 0;
  };

  const el = h('div.screen.wide',
    h('div.screen-head',
      h('div.titles', h('h1', { text: T.builder.title }), h('div.subtitle', { text: subtitle })),
      h('div.actions', button(T.app.back, { test: 'back', onClick: () => { if (props.onBack) props.onBack(); else ctx.go(mode === 'sp' ? 'spSetup' : 'lobby'); } })),
    ),
    tutorialPanel,
    h('div.fb-layout',
      h('div.fb-main',
        h('div.panel.tight', h('h3', { text: T.builder.faction }), factionCards, h('div', { style: { marginTop: '10px' } }, loreEl)),
        h('div.panel.tight', budgetHead),
        h('div.panel.tight', h('div.panel-title', h('h3', { text: T.builder.presets })), presetRow),
        libraryPanel,
        h('div.panel.tight', h('div.panel-title', h('h3', { text: T.builder.roster }), h('span.tiny.muted', { text: T.builder.hint })), roster),
      ),
      h('div.fb-side',
        planningPanel, pilotPanel,
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
