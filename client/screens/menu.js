// Main menu: title, name field, mode buttons. The animated background is the
// app-wide ambient scene (renderer background + drifting ships).

import { T, fmt, difficultyName } from '../i18n.js';
import { h } from '../util/dom.js';
import { bestProgress } from '../util/storage.js';
import { serverStorageNotice } from '../util/serverInfo.js';
import { MAX_NAME_LENGTH } from '/shared/constants.js';

export function mount(root, props, ctx) {
  const { state } = ctx;
  const nameInput = h('input.input', {
    type: 'text', test: 'name', value: state.playerName, placeholder: T.menu.namePlaceholder, maxlength: MAX_NAME_LENGTH, autocomplete: 'off', spellcheck: 'false',
    onChange: (e) => { const v = ctx.setPlayerName(e.target.value); e.target.value = v; },
  });
  const best = bestProgress(state.progress);
  const menuBtn = (label, test, screen, hint, disabled = false) => h('button.btn.btn-menu', { type: 'button', test, disabled, onClick: () => ctx.go(screen) }, label, hint ? h('span.k', { text: hint }) : null);
  const el = h('div.screen.menu-screen',
    h('div.title-block',
      h('div.game-title', { text: T.app.title.toUpperCase() }),
      h('div.game-tagline', { text: T.app.tagline }),
    ),
    h('div.menu-buttons',
      menuBtn(T.menu.single, 'menu-single', 'spSetup', '1–15+ níveis'),
      menuBtn(T.menu.multi, 'menu-multi', 'lobby', ctx.isStatic ? 'exige servidor' : 'salas online', ctx.isStatic),
      menuBtn(T.menu.codex, 'menu-codex', 'codex', 'naves e habilidades'),
      menuBtn(T.menu.howto, 'menu-howto', 'howto'),
      menuBtn(ctx.isStatic ? 'Progresso local' : 'Perfil e desbloqueios', 'menu-profile', 'profile'),
      menuBtn(T.menu.options, 'menu-options', 'options'),
    ),
    h('label.field.menu-name', h('span.lbl', { text: T.menu.nameLabel }), nameInput, h('span.tiny', { text: T.menu.nameHint })),
    h('div.menu-progress', { text: best ? fmt(T.menu.progress, { level: best.max, difficulty: difficultyName(best.difficulty) }) : T.menu.noProgress }),
    ctx.isStatic ? h('div.menu-static-note.small.muted', { test: 'static-mode-notice' }, 'Versão individual para navegador. Campanha e frotas ficam neste navegador; não há multiplayer nem pontos verificados.') : null,
    serverStorageNotice(ctx),
    h('div.menu-foot', { text: T.menu.footer }),
    ctx.isStatic ? h('div.menu-foot',
      h('span', '© 2026 Pedro Tiago Corrêa Faria · '),
      h('a', { href: './LICENSE.txt', target: '_blank', rel: 'noopener', text: 'Condições de uso' }),
      h('span', ' · '),
      h('a', { href: './THIRD_PARTY_NOTICES.md', target: '_blank', rel: 'noopener', text: 'Licenças de terceiros' })) : null,
  );
  root.appendChild(el);
  return { unmount() {} };
}
