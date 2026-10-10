// Options: audio volumes (master/music/sfx/ui) + mute through the audio API,
// reduced motion, effects quality, HUD defaults, player name, progress reset.

import { T } from '../i18n.js';
import { h, button, segmented, confirmDialog } from '../util/dom.js';
import { MAX_NAME_LENGTH } from '/shared/constants.js';

export function mount(root, props, ctx) {
  const { state } = ctx;
  const s = state.settings;

  function slider(key, label) {
    const val = h('span.v', { text: `${Math.round(s[key] * 100)}%` });
    const input = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[key], test: `vol-${key}`,
      onInput: (e) => { s[key] = Number(e.target.value); val.textContent = `${Math.round(s[key] * 100)}%`; ctx.persistSettings(); try { ctx.audio.play('ui.tick'); } catch { /* ignore */ } } });
    return h('div.opt-row', h('span', { text: label }), input, val);
  }

  const el = h('div.screen',
    h('div.screen-head', h('div.titles', h('h1', { text: T.options.title })), h('div.actions', button(T.app.back, { test: 'back', onClick: () => ctx.go('menu') }))),
    h('div.opt-grid',
      h('div.panel.stack', h('h3', { text: T.options.audio }),
        slider('master', T.options.master), slider('music', T.options.music), slider('sfx', T.options.sfx), slider('ui', T.options.ui),
        h('label.check', h('input', { type: 'checkbox', test: 'mute', checked: s.muted, onChange: (e) => { s.muted = e.target.checked; ctx.persistSettings(); } }), T.options.mute),
        h('div.tiny.muted', { text: T.options.audioNote }),
      ),
      h('div.panel.stack', h('h3', { text: T.options.video }),
        h('label.field', h('span.lbl', { text: T.options.reducedMotion }),
          segmented([{ value: 'auto', label: T.options.rmAuto, test: 'rm-auto' }, { value: 'on', label: T.options.rmOn, test: 'rm-on' }, { value: 'off', label: T.options.rmOff, test: 'rm-off' }], { label: T.options.reducedMotion, value: s.reducedMotion, onChange: (v) => { s.reducedMotion = v; ctx.persistSettings(); } }),
          h('span.tiny', { text: T.options.reducedMotionDesc })),
        h('label.field', h('span.lbl', { text: T.options.quality }),
          segmented([{ value: 'auto', label: T.options.qAuto, test: 'q-auto' }, { value: 'low', label: T.options.qLow, test: 'q-low' }, { value: 'medium', label: T.options.qMedium, test: 'q-medium' }, { value: 'high', label: T.options.qHigh, test: 'q-high' }], { label: T.options.quality, value: s.quality, onChange: (v) => { s.quality = v; ctx.persistSettings(); } })),
        h('label.check', h('input', { type: 'checkbox', test: 'opt-names', checked: s.showNames, onChange: (e) => { s.showNames = e.target.checked; ctx.persistSettings(); } }), T.options.showNames),
        h('label.check', h('input', { type: 'checkbox', test: 'opt-grid', checked: s.grid, onChange: (e) => { s.grid = e.target.checked; ctx.persistSettings(); } }), T.options.grid),
      ),
      h('div.panel.stack', h('h3', { text: T.options.gameplay }),
        h('label.field', h('span.lbl', { text: T.options.name }),
          h('input.input', { type: 'text', test: 'opt-name', value: state.playerName, maxlength: MAX_NAME_LENGTH, placeholder: T.menu.namePlaceholder, onChange: (e) => { e.target.value = ctx.setPlayerName(e.target.value); } })),
        button(T.options.resetProgress, { test: 'reset-progress', class: 'btn-danger', onClick: async () => {
          if (await confirmDialog(T.options.resetConfirm, { ok: T.options.resetProgress, cancel: T.app.cancel, test: 'reset' })) { ctx.resetProgress(); ctx.toast(T.options.resetDone, 'ok'); }
        } }),
      ),
    ),
  );
  root.appendChild(el);
  return { unmount() {} };
}
