// Single-player setup: level (1–15 + endless), enemy difficulty, team size and
// ally bot difficulty. Cleared levels are marked from localStorage progress.

import { T, fmt, difficultyName } from '../i18n.js';
import { h, clear, button, segmented, select, add } from '../util/dom.js';
import { num } from '../util/format.js';
import { isLevelCleared } from '../util/storage.js';
import { normalizeSpSetup } from '../util/spConfig.js';
import { DIFFICULTIES, TEAM_SIZES, DEFAULT_BUDGET } from '/shared/constants.js';
import { FACTIONS, SHIPS } from '/shared/catalog.js';
import { LEVELS, levelInfo, enemyBudget, levelBuilder } from '/shared/levels.js';
import { validateFleet } from '/shared/fleet.js';

export function mount(root, props, ctx) {
  const { state } = ctx;
  const setup = normalizeSpSetup({ ...state.spSetup, ...(props.setup || {}) });

  const levelGrid = h('div.level-grid', { test: 'level-grid' });
  const info = h('div.level-info');
  const allyWrap = h('div');
  const endlessWrap = h('div.row.gap.wrap', { style: { marginTop: '10px' } });
  let endlessLevel = Math.max(16, setup.level > 15 ? setup.level : 16);

  function renderLevels() {
    clear(levelGrid);
    for (const lv of LEVELS) {
      const cleared = isLevelCleared(state.progress, setup.difficulty, lv.n);
      const b = h('button.level-btn', {
        type: 'button', test: `level-${lv.n}`, class: [setup.level === lv.n ? 'on' : '', cleared ? 'cleared' : '', lv.boss || lv.bossSizeClass ? 'boss' : ''].join(' '),
        title: `${lv.name} — ${lv.desc}`,
        onClick: () => { setup.level = lv.n; renderLevels(); renderInfo(); },
      }, h('span.n', { text: String(lv.n) }), h('span.nm', { text: lv.name }));
      levelGrid.appendChild(b);
    }
    const endlessBtn = h('button.level-btn', {
      type: 'button', test: 'level-endless', class: setup.level > 15 ? 'on' : '', title: T.sp.endlessHint,
      onClick: () => { setup.level = endlessLevel; renderLevels(); renderInfo(); },
    }, h('span.n', { text: '16+' }), h('span.nm', { text: T.sp.endless }));
    levelGrid.appendChild(endlessBtn);
    clear(endlessWrap);
    if (setup.level > 15) {
      add(endlessWrap, 
        h('span.muted.small', { text: T.sp.customLevel }),
        button('−', { test: 'level-endless-minus', class: 'btn-sm', onClick: () => { endlessLevel = Math.max(16, endlessLevel - 1); setup.level = endlessLevel; renderLevels(); renderInfo(); } }),
        h('span.num', { test: 'level-endless-value', text: String(setup.level), style: { minWidth: '40px', textAlign: 'center' } }),
        button('+', { test: 'level-endless-plus', class: 'btn-sm', onClick: () => { endlessLevel = Math.min(999, endlessLevel + 1); setup.level = endlessLevel; renderLevels(); renderInfo(); } }),
        h('span.tiny.muted', { text: T.sp.endlessHint }),
      );
    }
  }

  function renderInfo() {
    const lv = levelInfo(setup.level);
    const budget = enemyBudget(lv, setup.difficulty, DEFAULT_BUDGET);
    const builder = levelBuilder(lv, setup.difficulty);
    const faction = FACTIONS[lv.enemyFaction];
    const boss = lv.boss && SHIPS[lv.boss] ? SHIPS[lv.boss].name : lv.bossSizeClass ? T.builder.sizeClass[lv.bossSizeClass] : null;
    clear(info);
    add(info, 
      h('div.lv-name', { test: 'level-name', text: `${T.sp.level} ${lv.n} · ${lv.name}` }),
      h('p.small', { text: lv.desc }),
      h('dl.kv',
        h('dt', T.sp.enemyFaction), h('dd', faction ? h('span', { class: `f-${faction.id}` }, faction.name) : T.sp.randomFaction),
        h('dt', T.sp.enemyBudget), h('dd', { test: 'enemy-budget' }, `${num(budget)} ${T.app.points}`, h('span.muted.small', ` (${T.sp.builder[builder]})`)),
        h('dt', T.sp.yourBudget), h('dd', `${num(DEFAULT_BUDGET)} ${T.app.points}`),
        boss ? h('dt', '★') : null, boss ? h('dd.warn', { text: fmt(T.sp.boss, { name: boss }) }) : null,
      ),
      h('p.small.muted', { text: T.sp.diffDesc[setup.difficulty] }),
    );
    renderAllies();
  }

  function renderAllies() {
    clear(allyWrap);
    if (setup.teamSize > 1) {
      add(allyWrap, 
        h('div.small.muted', { style: { marginBottom: '6px' }, text: fmt(T.sp.allies, { n: setup.teamSize - 1, difficulty: difficultyName(setup.allyDifficulty) }) }),
        h('label.field', h('span.lbl', { text: T.sp.allyDifficulty }),
          select(DIFFICULTIES.map((d) => ({ value: d, label: difficultyName(d) })), { value: setup.allyDifficulty, test: 'ally-difficulty', onChange: (e) => { setup.allyDifficulty = e.target.value; renderAllies(); } })),
      );
    } else add(allyWrap, h('div.small.muted', { text: T.sp.noAllies }));
  }

  const diffSeg = segmented(DIFFICULTIES.map((d) => ({ value: d, label: difficultyName(d), test: `difficulty-${d}` })), { value: setup.difficulty, onChange: (v) => { setup.difficulty = v; renderLevels(); renderInfo(); } });
  const sizeSeg = segmented(TEAM_SIZES.map((n) => ({ value: n, label: `${n}v${n}`, test: `teamsize-${n}` })), { value: setup.teamSize, onChange: (v) => { setup.teamSize = v; renderAllies(); } });

  const lastOk = state.lastFleet && validateFleet(state.lastFleet, DEFAULT_BUDGET).ok;
  const el = h('div.screen',
    h('div.screen-head',
      h('div.titles', h('h1', { text: T.sp.title }), h('div.subtitle', { text: T.sp.subtitle })),
      h('div.actions', button(T.app.back, { test: 'back', onClick: () => ctx.go('menu') })),
    ),
    h('div.sp-grid',
      h('div.stack',
        h('div.panel', h('h3', { text: T.sp.level }), levelGrid, endlessWrap),
        h('div.panel', h('h3', { text: T.sp.difficulty }), diffSeg),
        h('div.panel', h('h3', { text: T.sp.teamSize }), sizeSeg, h('div.tiny.muted', { style: { marginTop: '6px' }, text: T.sp.teamSizeHint }), h('div', { style: { marginTop: '10px' } }, allyWrap)),
      ),
      h('div.stack',
        h('div.panel', info),
        h('div.panel.stack',
          button(T.sp.build, { test: 'sp-build', primary: true, class: 'btn-lg btn-block', onClick: () => { ctx.saveSpSetup(setup); ctx.go('fleetBuilder', { mode: 'sp', setup: { ...setup }, fleet: state.lastFleet }); } }),
          lastOk ? button(T.sp.quickPlay, { test: 'sp-quick', class: 'btn-block', onClick: () => { ctx.saveSpSetup(setup); ctx.startSinglePlayer({ ...setup }, state.lastFleet); } }) : null,
        ),
      ),
    ),
  );
  root.appendChild(el);
  renderLevels();
  renderInfo();
  return { unmount() {} };
}
