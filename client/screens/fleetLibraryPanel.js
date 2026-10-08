import { h, button, clear, select, add } from '../util/dom.js';
import { listFleets, saveFleet, duplicateFleet, removeFleet, compareFleets } from '../util/fleetLibrary.js';
import { num } from '../util/format.js';
import { FACTIONS } from '/shared/catalog.js';

/** Device-local blueprints; loading always returns through the builder's validation. */
export function createFleetLibraryPanel({ getFleet, onLoad, toast }) {
  const rows = h('div.stack', { test: 'fleet-library-list' });
  const name = h('input.input', { test: 'fleet-library-name', maxlength: 48, placeholder: 'Nome da frota', 'aria-label': 'Nome da frota' });
  const compare = h('div.small', { test: 'fleet-compare', 'aria-live': 'polite' });
  const selectors = h('div.row.gap.wrap');
  let selected = null;
  const done = result => {
    if (!result?.ok) { toast(result?.error || 'Não foi possível salvar.', 'error'); return; }
    selected = result.entry.id; name.value = result.entry.name; render(); toast('Frota salva neste navegador.', 'ok');
  };
  function render() {
    clear(rows); clear(selectors); clear(compare);
    const entries = listFleets();
    if (!entries.length) rows.appendChild(h('p.small.muted', 'Salve uma composição para reutilizá-la em outras partidas.'));
    for (const entry of entries) {
      rows.appendChild(h('div.library-row',
        h('div', h('b', { text: entry.name }), h('div.tiny.muted', { text: FACTIONS[entry.fleet.faction]?.name || entry.fleet.faction })),
        h('div.row.gap.wrap',
          button('Usar', { test: `library-load-${entry.id}`, class: 'btn-sm', onClick: () => { selected = entry.id; name.value = entry.name; onLoad(entry.fleet); } }),
          button('Duplicar', { test: `library-duplicate-${entry.id}`, class: 'btn-sm', onClick: () => done(duplicateFleet(entry.id)) }),
          button('Renomear', { class: 'btn-sm', onClick: () => { if (!name.value.trim()) { name.focus(); return; } done(saveFleet({ ...entry, name: name.value })); } }),
          button('Excluir', { class: 'btn-sm btn-ghost', onClick: () => { if (!removeFleet(entry.id)) toast('Não foi possível excluir.', 'error'); else { if (selected === entry.id) selected = null; render(); } } }),
        ),
      ));
    }
    if (entries.length >= 2) {
      const options = entries.map(e => ({ value: e.id, label: e.name }));
      const left = select(options, { value: entries[0].id, test: 'compare-left', onChange: compareNow });
      const right = select(options, { value: entries[1].id, test: 'compare-right', onChange: compareNow });
      left.setAttribute('aria-label', 'Primeira frota'); right.setAttribute('aria-label', 'Segunda frota');
      function compareNow() {
        const a = entries.find(e => e.id === left.value), b = entries.find(e => e.id === right.value);
        const result = compareFleets(a, b);
        clear(compare);
        const values = [['Custo', 'cost'], ['Naves', 'count'], ['Resistência', 'ehp'], ['Dano/s teórico', 'dps']];
        add(compare, h('table.table', h('thead', h('tr', h('th', 'Medida'), h('th', a.name), h('th', b.name))),
          h('tbody', values.map(([label, key]) => h('tr', h('td', label), h('td.n', num(result.left[key])), h('td.n', num(result.right[key])))))),
          h('p.tiny.muted', 'Os totais ajudam a comparar composições; alcance, habilidades e adversários também mudam o resultado.'));
      }
      add(selectors, left, right); compareNow();
    }
  }
  const el = h('details.panel.library', { test: 'fleet-library' }, h('summary', 'Biblioteca de frotas'),
    h('p.tiny.muted', 'Salva neste navegador, independentemente dos pontos do perfil.'),
    h('div.row.gap.wrap', name,
      button('Salvar nova', { test: 'library-save', class: 'btn-sm', onClick: () => done(saveFleet({ name: name.value, fleet: getFleet() })) }),
      button('Atualizar selecionada', { test: 'library-update', class: 'btn-sm', onClick: () => selected ? done(saveFleet({ id: selected, name: name.value, fleet: getFleet() })) : toast('Use uma frota salva primeiro.', 'warn') })),
    rows, h('h3', 'Comparar'), selectors, compare);
  render();
  return el;
}
