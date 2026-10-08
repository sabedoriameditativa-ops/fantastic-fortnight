// Options: audio volumes (master/music/sfx/ui) + mute through the audio API,
// reduced motion, effects quality, HUD defaults, player name, progress reset.

import { T } from '../i18n.js';
import { h, button, segmented, confirmDialog, select, add } from '../util/dom.js';
import { normalizeChatterSettings } from '../battle/chatter.js';
import { DEFAULT_PILOT_BINDINGS, PILOT_ACTIONS, normalizePilotBindings, validPilotKey, pilotKeyLabel } from '../battle/pilotControls.js';
import { MAX_NAME_LENGTH } from '/shared/constants.js';

export function mount(root, props, ctx) {
  const { state } = ctx;
  const s = state.settings;
  s.chatter = normalizeChatterSettings(s.chatter);
  s.pilotBindings = normalizePilotBindings(s.pilotBindings);
  const bindingButtons = new Map();
  let awaiting = null;
  const bindingHint = h('p.tiny.muted', { 'aria-live': 'polite', text: 'Selecione uma ação e pressione a nova tecla. Esc cancela. Mouse aponta e dispara; as teclas N/G/C, 1/2/4, Espaço e Esc ficam reservadas à batalha.' });
  const bindingPanel = h('div.panel.stack', h('h3', 'Pilotar uma nave especial'), bindingHint);
  function refreshBindings() {
    for (const [key, btn] of bindingButtons) btn.textContent = awaiting === key ? 'Pressione uma tecla…' : pilotKeyLabel(s.pilotBindings[key]);
  }
  for (const [action, label] of Object.entries(PILOT_ACTIONS)) {
    const btn = button(pilotKeyLabel(s.pilotBindings[action]), { test: `bind-${action}`, onClick: () => { awaiting = action; refreshBindings(); } });
    btn.setAttribute('aria-label', `Remapear: ${label}`);
    btn.addEventListener('keydown', e => {
      if (awaiting !== action) return;
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') { awaiting = null; refreshBindings(); return; }
      if (!validPilotKey(e.code) || e.ctrlKey || e.altKey || e.metaKey) { bindingHint.textContent = 'Tecla reservada. Escolha uma letra, número disponível ou seta.'; return; }
      if (Object.entries(s.pilotBindings).some(([a, code]) => a !== action && code === e.code)) { bindingHint.textContent = 'Essa tecla já controla outra ação. Escolha uma tecla diferente.'; return; }
      s.pilotBindings[action] = e.code; awaiting = null; refreshBindings(); ctx.persistSettings(); bindingHint.textContent = 'Atalho salvo neste navegador.';
    });
    btn.addEventListener('blur', () => { if (awaiting === action) { awaiting = null; refreshBindings(); } });
    bindingButtons.set(action, btn); add(bindingPanel, h('div.row.between', h('span', label), btn));
  }
  add(bindingPanel, button('Restaurar teclas', { test: 'bindings-reset', onClick: () => { s.pilotBindings = { ...DEFAULT_PILOT_BINDINGS }; awaiting = null; refreshBindings(); ctx.persistSettings(); } }),
    h('p.tiny.muted', 'Ao pausar, perder foco ou desconectar, a nave volta ao piloto automático. A frota segue lutando. Os tiros especiais são direcionais; os disparos comuns podem ser guiados.'));
  const chatterPanel = h('div.panel.stack', h('h3', 'Rádio das facções'),
    h('label.field', h('span.lbl', 'Frequência'), select([{ value: 'normal', label: 'Normal' }, { value: 'rare', label: 'Rara' }, { value: 'off', label: 'Desligada' }], { value: s.chatter.frequency, test: 'chatter-frequency', onChange: e => { s.chatter.frequency = e.target.value; ctx.persistSettings(); } })),
    h('label.check', h('input', { type: 'checkbox', test: 'chatter-subtitles', checked: s.chatter.subtitles, onChange: e => { s.chatter.subtitles = e.target.checked; ctx.persistSettings(); } }), 'Legendas das falas'),
    h('label.check', h('input', { type: 'checkbox', test: 'chatter-speech', checked: s.chatter.speech, onChange: e => { s.chatter.speech = e.target.checked; ctx.persistSettings(); } }), 'Voz em português instalada neste dispositivo'),
    h('label.field', h('span.lbl', 'Volume da voz'), h('input', { type: 'range', min: 0, max: 1, step: 0.05, test: 'chatter-volume', value: s.chatter.volume, onInput: e => { s.chatter.volume = Number(e.target.value); ctx.persistSettings(); } })),
    h('p.tiny.muted', 'A voz é opcional e usa somente vozes locais disponíveis. Sem uma voz compatível, continuam as legendas. Nenhum áudio é enviado a serviços externos.'));

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
        h('label.check', h('input', { type: 'checkbox', test: 'opt-effects', checked: s.reducedEffects, onChange: e => { s.reducedEffects = e.target.checked; ctx.persistSettings(); } }), 'Reduzir flashes e efeitos'),
        h('label.check', h('input', { type: 'checkbox', test: 'opt-contrast', checked: s.highContrast, onChange: e => { s.highContrast = e.target.checked; ctx.persistSettings(); } }), 'Alto contraste e símbolos por equipe'),
        h('label.field', h('span.lbl', { text: T.options.reducedMotion }),
          segmented([{ value: 'auto', label: T.options.rmAuto, test: 'rm-auto' }, { value: 'on', label: T.options.rmOn, test: 'rm-on' }, { value: 'off', label: T.options.rmOff, test: 'rm-off' }], { value: s.reducedMotion, onChange: (v) => { s.reducedMotion = v; ctx.persistSettings(); } }),
          h('span.tiny', { text: T.options.reducedMotionDesc })),
        h('label.field', h('span.lbl', { text: T.options.quality }),
          segmented([{ value: 'auto', label: T.options.qAuto, test: 'q-auto' }, { value: 'low', label: T.options.qLow, test: 'q-low' }, { value: 'medium', label: T.options.qMedium, test: 'q-medium' }, { value: 'high', label: T.options.qHigh, test: 'q-high' }], { value: s.quality, onChange: (v) => { s.quality = v; ctx.persistSettings(); } })),
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
      bindingPanel, chatterPanel,
    ),
  );
  root.appendChild(el);
  return { unmount() {} };
}
