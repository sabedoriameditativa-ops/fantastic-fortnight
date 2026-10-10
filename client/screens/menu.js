// Main menu: title, name field, mode buttons, progress line (best level and
// stars). The animated background is the app-wide ambient scene (renderer
// background + drifting ships).

import { T, fmt, difficultyName } from '../i18n.js';
import { h } from '../util/dom.js';
import { bestProgress, starsSummary } from '../util/storage.js';
import { MAX_NAME_LENGTH } from '/shared/constants.js';
import { LAST_AUTHORED_LEVEL } from '/shared/levels.js';

/** "Progresso: nível 6 em Normal · 12/45 estrelas" for the best difficulty, or the no-progress line. */
export function progressLine(progress) {
  const best = bestProgress(progress);
  if (!best) return T.menu.noProgress;
  const s = starsSummary(progress, best.difficulty, LAST_AUTHORED_LEVEL);
  return fmt(T.progress.menuProgress, { level: best.max, difficulty: difficultyName(best.difficulty), stars: s.stars, total: s.total });
}

export function mount(root, props, ctx) {
  const { state } = ctx;
  const nameInput = h('input.input', {
    type: 'text', test: 'name', value: state.playerName, placeholder: T.menu.namePlaceholder, maxlength: MAX_NAME_LENGTH, autocomplete: 'off', spellcheck: 'false',
    onChange: (e) => { const v = ctx.setPlayerName(e.target.value); e.target.value = v; },
  });
  const menuBtn = (label, test, screen, hint) => h('button.btn.btn-menu', { type: 'button', test, onClick: () => ctx.go(screen) }, label, hint ? h('span.k', { text: hint }) : null);
  const el = h('div.screen.menu-screen',
    h('div.title-block',
      h('div.game-title', { text: T.app.title.toUpperCase() }),
      h('div.game-tagline', { text: T.app.tagline }),
    ),
    h('div.menu-buttons',
      menuBtn(T.menu.single, 'menu-single', 'spSetup', '1–15+ níveis'),
      menuBtn(T.menu.multi, 'menu-multi', 'lobby', 'salas online'),
      menuBtn(T.menu.codex, 'menu-codex', 'codex', '32 naves'),
      menuBtn(T.menu.howto, 'menu-howto', 'howto'),
      menuBtn(T.menu.options, 'menu-options', 'options'),
    ),
    h('label.field.menu-name', h('span.lbl', { text: T.menu.nameLabel }), nameInput, h('span.tiny', { text: T.menu.nameHint })),
    h('div.menu-progress', { test: 'menu-progress', text: progressLine(state.progress) }),
    h('div.menu-foot', { text: T.menu.footer }),
  );
  root.appendChild(el);
  return { unmount() {} };
}
