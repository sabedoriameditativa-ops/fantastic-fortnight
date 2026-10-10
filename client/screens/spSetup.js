// Single-player setup: level (1–15 + endless) with stars and optional gating,
// enemy difficulty, budget preset (Escaramuça / Padrão / Guerra Total), team
// size and ally bot difficulty. Cleared levels, stars and locks come from the
// localStorage progress (storage.js / unlocks.js).

import { T, fmt, difficultyName, difficultyDescription } from '../i18n.js';
import { h, clear, button, segmented, select, add } from '../util/dom.js';
import { num } from '../util/format.js';
import { isLevelCleared, levelStars, starsSummary, maxLevelCleared } from '../util/storage.js';
import { normalizeSpSetup, spLevelInfo, spBudgetPoints, SP_BUDGET_IDS } from '../util/spConfig.js';
import { isLevelUnlocked } from '../util/unlocks.js';
import { starGlyphs } from '../util/progress.js';
import { DIFFICULTIES, TEAM_SIZES, BUDGETS } from '/shared/constants.js';
import { FACTIONS, SHIPS } from '/shared/catalog.js';
import { LEVELS, levelInfo, LAST_AUTHORED_LEVEL } from '/shared/levels.js';
import { AI_PROFILES } from '/shared/aiProfiles.js';
import { validateFleet } from '/shared/fleet.js';

export function mount(root, props, ctx) {
  const { state } = ctx;
  const setup = normalizeSpSetup({ ...state.spSetup, ...(props.setup || {}) });

  const levelGrid = h('div.level-grid', { test: 'level-grid' });
  const starsSummaryEl = h('span.small.muted', { test: 'level-stars-summary' });
  const info = h('div.level-info');
  const allyWrap = h('div');
  const quickWrap = h('div');
  const endlessWrap = h('div.row.gap.wrap', { style: { marginTop: '10px' } });
  let endlessLevel = Math.max(LAST_AUTHORED_LEVEL + 1, setup.level > LAST_AUTHORED_LEVEL ? setup.level : LAST_AUTHORED_LEVEL + 1);

  const unlocked = (n) => isLevelUnlocked(state.progress, state.progressOpts, setup.difficulty, n);
  /** A stored level that is locked on this difficulty (gating turned on later, difficulty changed) falls back to the highest open one. */
  function ensureUnlocked() {
    if (!unlocked(setup.level)) setup.level = Math.max(1, maxLevelCleared(state.progress, setup.difficulty) + 1);
  }
  function lockedToast(n) {
    ctx.toast(fmt(T.progress.lockedToast, { n: n - 1, difficulty: difficultyName(setup.difficulty) }), 'warn');
  }
  function pickLevel(n) {
    if (!unlocked(n)) { lockedToast(n); return; }
    setup.level = n; renderLevels(); renderInfo();
  }

  function renderLevels() {
    clear(levelGrid);
    const sum = starsSummary(state.progress, setup.difficulty, LAST_AUTHORED_LEVEL);
    starsSummaryEl.textContent = fmt(T.progress.starsOf, { stars: sum.stars, total: sum.total, difficulty: difficultyName(setup.difficulty) });
    for (const lv of LEVELS) {
      const cleared = isLevelCleared(state.progress, setup.difficulty, lv.n);
      const stars = levelStars(state.progress, setup.difficulty, lv.n);
      const locked = !unlocked(lv.n);
      const b = h('button.level-btn', {
        type: 'button', test: `level-${lv.n}`, 'data-locked': locked ? '1' : null, // stays clickable: the click explains the lock (toast)
        class: [setup.level === lv.n ? 'on' : '', cleared ? 'cleared' : '', lv.boss || lv.bossSizeClass ? 'boss' : '', locked ? 'locked' : ''].join(' '),
        title: locked ? fmt(T.progress.lockedLevel, { n: lv.n - 1, difficulty: difficultyName(setup.difficulty) }) : `${lv.name} — ${lv.desc}`,
        onClick: () => pickLevel(lv.n),
      }, h('span.n', { text: String(lv.n) }), h('span.nm', { text: lv.name }),
      stars > 0 ? h('span.stars', { test: `level-stars-${lv.n}`, 'data-stars': String(stars), text: starGlyphs(stars) }) : locked ? h('span.lock', { text: T.sp.levelLocked }) : null);
      levelGrid.appendChild(b);
    }
    const endlessLocked = !unlocked(LAST_AUTHORED_LEVEL + 1);
    const endlessBtn = h('button.level-btn', {
      type: 'button', test: 'level-endless', class: [setup.level > LAST_AUTHORED_LEVEL ? 'on' : '', endlessLocked ? 'locked' : ''].join(' '), 'data-locked': endlessLocked ? '1' : null,
      title: endlessLocked ? fmt(T.progress.lockedLevel, { n: LAST_AUTHORED_LEVEL, difficulty: difficultyName(setup.difficulty) }) : T.sp.endlessHint,
      onClick: () => pickLevel(endlessLevel),
    }, h('span.n', { text: '16+' }), h('span.nm', { text: T.sp.endless }), endlessLocked ? h('span.lock', { text: T.sp.levelLocked }) : null);
    levelGrid.appendChild(endlessBtn);
    clear(endlessWrap);
    if (setup.level > LAST_AUTHORED_LEVEL) {
      add(endlessWrap,
        h('span.muted.small', { text: T.sp.customLevel }),
        button('−', { test: 'level-endless-minus', class: 'btn-sm', onClick: () => { endlessLevel = Math.max(LAST_AUTHORED_LEVEL + 1, endlessLevel - 1); pickLevel(endlessLevel); } }),
        h('span.num', { test: 'level-endless-value', text: String(setup.level), style: { minWidth: '40px', textAlign: 'center' } }),
        button('+', { test: 'level-endless-plus', class: 'btn-sm', onClick: () => { const n = Math.min(999, endlessLevel + 1); if (!unlocked(n)) { lockedToast(n); return; } endlessLevel = n; pickLevel(endlessLevel); } }),
        h('span.tiny.muted', { text: T.sp.endlessHint }),
      );
    }
  }

  function renderInfo() {
    const lv = levelInfo(setup.level);
    const budget = spBudgetPoints(setup);
    const li = spLevelInfo(setup, budget);
    const builder = li.builder;
    const faction = FACTIONS[lv.enemyFaction];
    const bossNames = (li.bosses || []).map((id) => (SHIPS[id] ? SHIPS[id].name : null)).filter(Boolean);
    const boss = bossNames.length ? [...new Set(bossNames)].join(', ') : lv.bossSizeClass ? T.builder.sizeClass[lv.bossSizeClass] : null;
    const builderLabel = `${T.sp.builder[builder] || builder}${li.preset ? `: ${li.preset.name}` : ''}`;
    const stars = levelStars(state.progress, setup.difficulty, setup.level);
    clear(info);
    add(info,
      h('div.lv-name', { test: 'level-name', text: `${T.sp.level} ${lv.n} · ${lv.name}` }),
      stars > 0 ? h('div.small', h('span.warn', { text: starGlyphs(stars) }), h('span.muted', { text: ` ${fmt(T.progress.bestStars, { stars })}` })) : null,
      h('p.small', { text: lv.desc }),
      h('dl.kv',
        h('dt', T.sp.enemyFaction), h('dd', faction ? h('span', { class: `f-${faction.id}` }, faction.name) : T.sp.randomFaction),
        h('dt', T.sp.enemyBudget), h('dd', { test: 'enemy-budget' }, `${num(li.enemySpendable)} ${T.app.points}`, li.budgetCapped ? h('span.muted.small', ` ${fmt(T.sp.budgetOf, { n: num(li.enemyBudget) })}`) : null, h('span.muted.small', ` (${builderLabel})`)),
        li.enemyAi && li.enemyAi !== setup.difficulty ? h('dt', T.sp.enemyAi) : null,
        li.enemyAi && li.enemyAi !== setup.difficulty ? h('dd.warn', { test: 'enemy-ai', text: difficultyName(li.enemyAi) }) : null,
        h('dt', T.sp.yourBudget), h('dd', { test: 'your-budget' }, `${num(budget)} ${T.app.points}`, h('span.muted.small', ` (${BUDGETS[setup.budget].name})`)),
        boss ? h('dt', '★') : null, boss ? h('dd.warn', { text: fmt(T.sp.boss, { name: boss }) }) : null,
      ),
      h('p.small.muted', { text: difficultyDescription(setup.difficulty, AI_PROFILES[setup.difficulty] ? AI_PROFILES[setup.difficulty].budgetMul : 1) }),
    );
    renderAllies();
    renderQuick();
  }

  function renderAllies() {
    clear(allyWrap);
    if (setup.teamSize > 1) {
      add(allyWrap,
        h('div.small.muted', { style: { marginBottom: '6px' }, text: fmt(T.sp.allies, { n: setup.teamSize - 1, difficulty: difficultyName(setup.allyDifficulty) }) }),
        h('label.field', h('span.lbl', { text: T.sp.allyDifficulty }),
          select(DIFFICULTIES.map((d) => ({ value: d, label: difficultyName(d) })), { value: setup.allyDifficulty, test: 'ally-difficulty', onChange: (e) => { setup.allyDifficulty = e.target.value; renderAllies(); } })),
        h('div.tiny.muted', { style: { marginTop: '6px' }, text: T.progress.skirmishNote }),
      );
    } else add(allyWrap, h('div.small.muted', { text: T.sp.noAllies }));
  }

  /** 'Jogar com a última frota': only when the last fleet fits the budget and uses no locked ship. */
  function renderQuick() {
    clear(quickWrap);
    if (!state.lastFleet) return;
    const ok = validateFleet(state.lastFleet, spBudgetPoints(setup)).ok && ctx.unlocks().isFleetUnlocked(state.lastFleet);
    if (ok) quickWrap.appendChild(button(T.sp.quickPlay, { test: 'sp-quick', class: 'btn-block', onClick: () => { ctx.saveSpSetup(setup); ctx.startSinglePlayer({ ...setup }, state.lastFleet); } }));
    else quickWrap.appendChild(h('div.tiny.muted', { test: 'sp-quick-locked', text: T.progress.lastFleetLocked }));
  }

  const diffSeg = segmented(DIFFICULTIES.map((d) => ({ value: d, label: difficultyName(d), test: `difficulty-${d}` })), { label: T.sp.difficulty, value: setup.difficulty, onChange: (v) => { setup.difficulty = v; ensureUnlocked(); renderLevels(); renderInfo(); } });
  const sizeSeg = segmented(TEAM_SIZES.map((n) => ({ value: n, label: `${n}v${n}`, test: `teamsize-${n}` })), { label: T.sp.teamSize, value: setup.teamSize, onChange: (v) => { setup.teamSize = v; renderAllies(); } });
  const budgetSeg = segmented(SP_BUDGET_IDS.map((id) => ({ value: id, label: BUDGETS[id].name, test: `budget-${id}`, title: fmt(T.progress.budgetOption, { name: BUDGETS[id].name, points: num(BUDGETS[id].points) }) })), { label: T.progress.budget, value: setup.budget, onChange: (v) => { setup.budget = v; renderInfo(); } });

  const el = h('div.screen',
    h('div.screen-head',
      h('div.titles', h('h1', { text: T.sp.title }), h('div.subtitle', { text: T.sp.subtitle })),
      h('div.actions', button(T.app.back, { test: 'back', onClick: () => ctx.go('menu') })),
    ),
    h('div.sp-grid',
      h('div.stack',
        h('div.panel', h('div.level-head', h('h3', { text: T.sp.level }), starsSummaryEl), levelGrid, endlessWrap),
        h('div.panel', h('h3', { text: T.sp.difficulty }), diffSeg),
        h('div.panel', h('h3', { text: T.progress.budget }), budgetSeg, h('div.tiny.muted', { style: { marginTop: '6px' }, text: `${SP_BUDGET_IDS.map((id) => fmt(T.progress.budgetOption, { name: BUDGETS[id].name, points: num(BUDGETS[id].points) })).join(' · ')}. ${T.progress.budgetHint}` })),
        h('div.panel', h('h3', { text: T.sp.teamSize }), sizeSeg, h('div.tiny.muted', { style: { marginTop: '6px' }, text: T.sp.teamSizeHint }), h('div', { style: { marginTop: '10px' } }, allyWrap)),
      ),
      h('div.stack',
        h('div.panel', info),
        h('div.panel.stack',
          button(T.sp.build, { test: 'sp-build', primary: true, class: 'btn-lg btn-block', onClick: () => { ctx.saveSpSetup(setup); ctx.go('fleetBuilder', { mode: 'sp', setup: { ...setup }, budget: spBudgetPoints(setup), fleet: state.lastFleet }); } }),
          quickWrap,
        ),
      ),
    ),
  );
  root.appendChild(el);
  ensureUnlocked();
  renderLevels();
  renderInfo();
  return { unmount() {} };
}
