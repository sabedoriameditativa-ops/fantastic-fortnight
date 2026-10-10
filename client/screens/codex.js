// Ship gallery (codex): all 32 ships with live sprites and stats, abilities and
// faction lore; click a card for the full sheet.

import { T, fmt } from '../i18n.js';
import { h, clear, button, segmented, add } from '../util/dom.js';
import { num, dec, secs } from '../util/format.js';
import { animateShip } from '../util/shipCanvas.js';
import { FACTIONS, FACTION_IDS, SHIPS, SHIP_LIST, ABILITIES, WEAPON_TYPE_NAMES, HULL_TYPES, SIZE_CLASS, shipsOfFaction, shipDps } from '/shared/catalog.js';
import { sizeClassCap } from '/shared/fleet.js';

export function mount(root, props, ctx) {
  let filter = props.faction && FACTION_IDS.includes(props.faction) ? props.faction : 'all';
  let stops = [];
  const body = h('div');

  function stopAll() { for (const s of stops) s(); stops = []; }

  function renderGrid() {
    stopAll();
    clear(body);
    const factions = filter === 'all' ? FACTION_IDS : [filter];
    for (const fid of factions) {
      const f = FACTIONS[fid];
      body.appendChild(h('div.faction-head', h('span.badge', { class: `f-${fid}`, text: f.race }), h('h2', { class: `f-${fid}`, text: f.name }), h('span.small.muted', { text: f.tagline })));
      body.appendChild(h('p.small.muted', { style: { marginBottom: '8px' } }, f.lore, ' ', h('b', { text: `${T.codex.passive}: ${f.passive.name}.` }), ' ', f.passive.desc));
      const grid = h('div.codex-grid');
      for (const ship of shipsOfFaction(fid)) {
        const cv = h('canvas', { width: 200, height: 120 });
        stops.push(animateShip(cv, ship.id, { angle: -0.3, pad: 8, maxZoom: 2.4 }));
        grid.appendChild(h('button.codex-card', { type: 'button', test: `codex-${ship.id}`, onClick: () => renderDetail(ship.id) },
          cv, h('div.cc-name', { text: ship.name }),
          h('div.cc-meta', h('span', { text: `${T.builder.sizeClass[ship.sizeClass]} · ${T.builder.role[ship.role] || ship.role}` }), h('span.accent', { text: `${ship.cost} ${T.app.points}` })),
          h('div.tiny.muted', { text: ship.desc }),
        ));
      }
      body.appendChild(grid);
    }
  }

  function renderDetail(cls) {
    stopAll();
    const ship = SHIPS[cls];
    const f = FACTIONS[ship.faction];
    const ab = ABILITIES[ship.ability];
    clear(body);
    const cv = h('canvas', { width: 480, height: 280 });
    stops.push(animateShip(cv, cls, { angle: -0.3, pad: 16, maxZoom: 3, thrust: 0.7 }));
    const kv = (pairs) => h('dl.kv', pairs.filter(Boolean).map(([k, v]) => [h('dt', { text: k }), h('dd', v)]).flat());
    const weaponsTable = h('table.table.weapon-table',
      h('thead', h('tr', h('th', T.codex.weapons), h('th.n', T.codex.weapon.damage), h('th.n', T.codex.weapon.cooldown), h('th.n', T.codex.weapon.range), h('th', ''))),
      h('tbody', ship.weapons.map((w) => {
        const extras = [];
        if (w.speed === 0 && !w.contact) extras.push(T.codex.weapon.hitscan);
        if (w.contact) extras.push(T.codex.weapon.contact);
        if (w.aoe) extras.push(`${T.codex.weapon.aoe} ${w.aoe} u`);
        if (w.dot) extras.push(`${T.codex.weapon.dot} ${w.dot.dps}/s · ${secs(w.dot.duration)}`);
        if (w.pd) extras.push(T.codex.weapon.pd);
        if (w.homing) extras.push(T.codex.weapon.homing);
        if (w.charge) extras.push(`${T.codex.weapon.charge} ${secs(w.charge)}`);
        if (w.chain) extras.push(`${T.codex.weapon.chain} ×${w.chain.targets}`);
        if (w.minTargetClass && w.minTargetClass !== 'tiny') extras.push(`${T.codex.weapon.minTarget}: ${T.builder.sizeClass[w.minTargetClass].toLowerCase()}`);
        return h('tr', h('td', h('div', { text: w.name }), h('span.chip', { class: `w-${w.type}`, text: WEAPON_TYPE_NAMES[w.type] })),
          h('td.n', `${w.damage}${w.salvo > 1 ? ` ×${w.salvo}` : ''}`), h('td.n', secs(w.cooldown)), h('td.n', `${w.range} u`), h('td.tiny.muted', extras.join(' · ')));
      })),
    );
    add(body, 
      h('div.row.gap.wrap', { style: { marginBottom: '12px' } }, button('← ' + T.codex.title, { test: 'codex-back', class: 'btn-sm', onClick: renderGrid }), h('h2', { text: ship.name }), h('span.badge', { class: `f-${ship.faction}`, text: f.short })),
      h('div.codex-detail',
        h('div.panel', cv, h('p.small', { text: ship.desc }), ship.spawnable ? h('div.tiny.muted', { text: T.codex.spawnable }) : null),
        h('div.stack',
          h('div.panel', h('h3', { text: T.codex.stats }), kv([
            [T.codex.cost, `${ship.cost} ${T.app.points}`],
            [T.codex.size, `${T.builder.sizeClass[ship.sizeClass]} (${fmt(T.builder.max, { n: sizeClassCap(ship.faction, ship.sizeClass) })})`],
            [T.codex.role, T.builder.role[ship.role] || ship.role],
            [T.codex.hp, `${num(ship.hp)}${ship.dr ? ` · RD ${ship.dr}` : ''}`],
            [T.codex.hullType, `${HULL_TYPES[ship.hullType].name} — ${HULL_TYPES[ship.hullType].desc}`],
            ship.regen ? [T.codex.regen, `${ship.regen}${T.codex.perSec}`] : null,
            [T.codex.shield, ship.shield.cap ? fmt(T.codex.shieldDetail, { cap: ship.shield.cap, regen: ship.shield.regen, delay: ship.shield.delay }) : '—'],
            [T.codex.speed, `${ship.speed} ${T.codex.unitUs} · ${T.codex.turn} ${ship.turnRate}${T.codex.unitDeg}`],
            [T.builder.dps, dec(shipDps(ship), 1)],
          ])),
          h('div.panel', weaponsTable),
          ab ? h('div.panel', h('h3', { text: T.codex.ability }), h('b', { text: ab.name }), ' ', h('span.badge', { text: T.codex.kind[ab.kind] || ab.kind }), h('p.small', { style: { marginTop: '6px' }, text: ab.desc }),
            h('div.tiny.muted', { text: [ab.cooldown ? fmt(T.codex.cooldown, { s: ab.cooldown }) : '', ab.duration ? fmt(T.codex.duration, { s: ab.duration }) : ''].filter(Boolean).join(' · ') })) : null,
          h('div.panel', h('h3', { text: T.codex.passive }), h('b', { text: f.passive.name }), h('p.small', { text: f.passive.desc })),
        ),
      ),
    );
    root.scrollTop = 0;
  }

  const el = h('div.screen.wide',
    h('div.screen-head',
      h('div.titles', h('h1', { text: T.codex.title }), h('div.subtitle', { text: T.codex.subtitle })),
      h('div.actions', segmented([{ value: 'all', label: T.codex.all, test: 'codex-all' }, ...FACTION_IDS.map((f) => ({ value: f, label: FACTIONS[f].short, test: `codex-faction-${f}` }))], { label: T.codex.faction, value: filter, onChange: (v) => { filter = v; renderGrid(); } }),
        button(T.app.back, { test: 'back', onClick: () => ctx.go('menu') })),
    ),
    body,
  );
  root.appendChild(el);
  if (props.ship && SHIPS[props.ship]) renderDetail(props.ship); else renderGrid();
  return { unmount() { stopAll(); } };
}
