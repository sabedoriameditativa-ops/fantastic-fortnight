// How to play: short illustrated steps + the damage multiplier matrix and the
// size-class limits, generated from the catalog.

import { T } from '../i18n.js';
import { h, button } from '../util/dom.js';
import { animateShip } from '../util/shipCanvas.js';
import { DAMAGE_MULT, WEAPON_TYPES, WEAPON_TYPE_NAMES, HULL_TYPES, SIZE_CLASSES, SIZE_CLASS, FACTIONS, FACTION_IDS } from '/shared/catalog.js';
import { FLEET_LIMITS } from '/shared/constants.js';

const STEP_SHIPS = ['ter_prometeu', 'vor_rainha', 'lum_serafim', 'fer_ariete', 'lum_ressonante', 'ter_atlas'];

export function mount(root, props, ctx) {
  const stops = [];
  const instructions = ctx.isStatic ? [
    ...T.howto.steps.slice(0, -1),
    { title: '6. Jogue e continue depois', text: 'Enfrente os bots na campanha. Seus níveis concluídos, frotas e preferências ficam neste navegador. Salas online e chat exigem a versão com servidor.' },
  ] : T.howto.steps;
  const steps = instructions.map((s, i) => {
    const cv = h('canvas', { width: 260, height: 90 });
    stops.push(animateShip(cv, STEP_SHIPS[i % STEP_SHIPS.length], { angle: -0.3, pad: 6, maxZoom: 1.6 }));
    return h('div.panel.howto-step', cv, h('h2', { text: s.title }), h('p.small', { text: s.text }));
  });

  const hullCols = Object.keys(HULL_TYPES);
  const matrix = h('table.table.matrix',
    h('thead', h('tr', h('th', ''), h('th', T.howto.vsShield), hullCols.map((k) => h('th', { text: HULL_TYPES[k].name })))),
    h('tbody', WEAPON_TYPES.map((w) => h('tr', h('td', { text: WEAPON_TYPE_NAMES[w] }),
      cell(DAMAGE_MULT[w].shield), hullCols.map((k) => cell(DAMAGE_MULT[w][k]))))),
  );
  function cell(v) { return h('td.v', { class: v >= 1.2 ? 'hi' : v <= 0.7 ? 'lo' : '', text: `×${String(v).replace('.', ',')}` }); }

  const sizes = h('table.table',
    h('thead', h('tr', h('th', T.codex.size), h('th.n', 'Raio'), h('th.n', 'Limite por frota'))),
    h('tbody', SIZE_CLASSES.map((sc) => h('tr', h('td', { text: T.builder.sizeClass[sc] }), h('td.n', `${SIZE_CLASS[sc].radius} u`),
      h('td.n', `${FLEET_LIMITS.maxPerSizeClass[sc]}${sc === 'tiny' ? ` (Vorrax ${FLEET_LIMITS.tinyCapByFaction.vorrax})` : ''}`)))),
  );

  const el = h('div.screen',
    h('div.screen-head', h('div.titles', h('h1', { text: T.howto.title })), h('div.actions', button(T.app.back, { test: 'back', onClick: () => ctx.go('menu') }))),
    h('div.panel', h('h2', 'Seu primeiro comando em três passos'), h('p.small', 'Monte uma frota, escolha uma orientação e observe a batalha. Você pode voltar a este guia a qualquer momento.'),
      button('Começar tutorial', { test: 'start-tutorial', primary: true, onClick: () => ctx.go('fleetBuilder', { mode: 'sp', tutorial: true, setup: { level: 1, difficulty: 'facil', teamSize: 1, allyDifficulty: 'normal' } }) })),
    h('div.howto-steps', steps),
    h('div.panel', { style: { marginTop: '12px' } }, h('h3', { text: T.howto.damageTitle }), h('div.tiny.muted', { style: { marginBottom: '8px' }, text: T.howto.damageHint }), h('div.table-wrap', matrix)),
    h('div.panel', h('h3', { text: T.howto.hullTypes }), h('dl.kv', FACTION_IDS.map((f) => [h('dt', { class: `f-${f}`, text: FACTIONS[f].short }), h('dd', `${HULL_TYPES[FACTIONS[f].hull].name}: ${HULL_TYPES[FACTIONS[f].hull].desc}`)]).flat())),
    h('div.panel', h('h3', { text: T.howto.sizesTitle }), h('div.table-wrap', sizes), h('div.tiny.muted', { style: { marginTop: '6px' }, text: `Máximo de ${FLEET_LIMITS.maxShips} naves por frota.` })),
  );
  root.appendChild(el);
  return { unmount() { for (const s of stops) s(); } };
}
