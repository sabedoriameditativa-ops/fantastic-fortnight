// Tiny DOM helpers. Never uses innerHTML with user data: text goes through
// textContent; markup is built from elements.

/**
 * Create an element.
 * @param {string} tag            'div', 'button.cls#id'... (class/id shorthand supported)
 * @param {Object|null} [attrs]   attributes; special keys: class, text, html(SAFE static only), on{Event}, dataset, style, test (→ data-test)
 * @param {...(Node|string|null|undefined|false|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]+)((?:[.#][\w-]+)*)$/i.exec(tag) || [null, tag, ''];
  const el = document.createElement(m[1] || 'div');
  if (m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
    }
  }
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') { for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c); }
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'test') el.setAttribute('data-test', String(v));
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'disabled' || k === 'checked' || k === 'selected' || k === 'hidden') { el[k] = !!v; }
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  } else if (attrs !== undefined && attrs !== null) {
    children.unshift(attrs);
  }
  append(el, children);
  return el;
}

/** Append children (strings become text nodes; arrays are flattened; falsy skipped). */
export function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) { append(el, c); continue; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Null-safe variadic append (the DOM's own append() would print "null"). */
export function add(el, ...children) {
  return append(el, children);
}

/** Remove all children. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** querySelector shorthand. */
export function $(sel, root = document) {
  return root.querySelector(sel);
}

/** querySelectorAll as an array. */
export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

/**
 * Button helper with data-test.
 * @param {string} label
 * @param {Object} [opts] { test, onClick, class, primary, disabled, title }
 */
export function button(label, opts = {}) {
  const b = h('button', {
    type: 'button', class: ['btn', opts.primary ? 'btn-primary' : '', opts.class || ''].filter(Boolean).join(' '),
    test: opts.test, disabled: !!opts.disabled, title: opts.title,
    onClick: opts.onClick,
  });
  b.textContent = label;
  return b;
}

/** Icon-ish inline SVG (hand-drawn, tiny). */
export function svgIcon(name, size = 14) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico', 'ico-' + name);
  const path = document.createElementNS(NS, 'path');
  const PATHS = {
    hull: 'M2 12 L8 3 L14 12 Z',
    shield: 'M8 1 L14 3 V8 C14 11 11 14 8 15 C5 14 2 11 2 8 V3 Z',
    dps: 'M2 9 L6 9 L8 3 L10 13 L12 7 L14 7',
    speed: 'M1 8 H9 M5 4 H13 M7 12 H15',
    range: 'M8 2 A6 6 0 1 1 7.99 2 M8 5 A3 3 0 1 1 7.99 5',
    play: 'M4 2 L13 8 L4 14 Z',
    pause: 'M4 2 H7 V14 H4 Z M9 2 H12 V14 H9 Z',
    crown: 'M2 12 L3 5 L6 8 L8 3 L10 8 L13 5 L14 12 Z',
    check: 'M2 8 L6 12 L14 4',
    cross: 'M3 3 L13 13 M13 3 L3 13',
    bot: 'M4 5 H12 V13 H4 Z M6 8 H7 M9 8 H10 M8 2 V5',
    user: 'M8 2 A3 3 0 1 1 7.99 2 M2 15 C2 10 14 10 14 15',
    warn: 'M8 2 L15 14 H1 Z M8 6 V10 M8 12 V12.5',
    link: 'M6 10 L10 6 M4 8 L2.5 9.5 A2.5 2.5 0 0 0 6.5 13.5 L8 12 M12 8 L13.5 6.5 A2.5 2.5 0 0 0 9.5 2.5 L8 4',
    sound: 'M2 6 H5 L9 2 V14 L5 10 H2 Z M11 5 C13 7 13 9 11 11',
    grid: 'M2 2 H14 V14 H2 Z M2 8 H14 M8 2 V14',
    camera: 'M2 5 H10 V11 H2 Z M10 7 L14 5 V11 L10 9',
    tag: 'M2 2 H8 L14 8 L8 14 L2 8 Z M5 5 H5.5',
    star: 'M8 1 L10 6 L15 6 L11 9.5 L12.5 15 L8 12 L3.5 15 L5 9.5 L1 6 L6 6 Z',
    skull: 'M8 2 A5 5 0 0 1 13 7 V10 H11 V13 H5 V10 H3 V7 A5 5 0 0 1 8 2 Z M6 7 H7 M9 7 H10',
  };
  path.setAttribute('d', PATHS[name] || PATHS.tag);
  path.setAttribute('fill', ['hull', 'play', 'pause', 'crown', 'star'].includes(name) ? 'currentColor' : 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

/**
 * Simple stat bar: label + track + fill at `frac` (0..1).
 * @param {string} label
 * @param {number} frac
 * @param {{ icon?: string, color?: string, text?: string, title?: string }} [opts]
 */
export function statBar(label, frac, opts = {}) {
  const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
  const fill = h('div.bar-fill', { style: { width: `${Math.round(f * 100)}%`, background: opts.color || '' } });
  const el = h('div.stat', { title: opts.title || '' },
    opts.icon ? svgIcon(opts.icon, 12) : null,
    h('span.stat-label', { text: label }),
    h('div.bar', fill),
    opts.text !== undefined ? h('span.stat-text', { text: opts.text }) : null,
  );
  el.fill = fill;
  return el;
}

/**
 * Attach a hover/focus tooltip (DOM, positioned near the element). Content is text.
 * @param {HTMLElement} el
 * @param {string|(() => string)} text
 */
export function tooltip(el, text) {
  let tip = null;
  const show = () => {
    const t = typeof text === 'function' ? text() : text;
    if (!t) return;
    if (!tip) { tip = h('div.tooltip', { role: 'tooltip' }); document.body.appendChild(tip); }
    tip.textContent = t;
    const r = el.getBoundingClientRect();
    tip.style.left = '0px'; tip.style.top = '0px'; tip.style.display = 'block';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    tip.style.left = `${Math.round(x)}px`; tip.style.top = `${Math.round(y)}px`;
  };
  const hide = () => { if (tip) { tip.remove(); tip = null; } };
  el.addEventListener('pointerenter', show);
  el.addEventListener('pointerleave', hide);
  el.addEventListener('focus', show);
  el.addEventListener('blur', hide);
  el.addEventListener('pointerdown', hide);
  return { hide };
}

/** Select element from options [{value,label}] with data-test. */
export function select(options, opts = {}) {
  const sel = h('select', { class: 'sel ' + (opts.class || ''), test: opts.test, disabled: !!opts.disabled, title: opts.title, onChange: opts.onChange });
  for (const o of options) sel.appendChild(h('option', { value: o.value, text: o.label, selected: o.value === opts.value }));
  if (opts.value !== undefined) sel.value = String(opts.value);
  return sel;
}

/** Segmented control: list of buttons, one active. */
export function segmented(items, opts = {}) {
  const wrap = h('div.seg', { class: opts.class || '', role: 'group', 'aria-label': opts.label || '' });
  let value = opts.value;
  const buttons = new Map();
  const setValue = (v, fire = true) => {
    value = v;
    for (const [k, b] of buttons) b.classList.toggle('on', k === v);
    if (fire && opts.onChange) opts.onChange(v);
  };
  for (const it of items) {
    const b = h('button', { type: 'button', class: 'seg-btn' + (it.value === value ? ' on' : ''), test: it.test, title: it.title, disabled: !!it.disabled, onClick: () => setValue(it.value) }, it.label);
    buttons.set(it.value, b);
    wrap.appendChild(b);
  }
  wrap.setValue = (v) => setValue(v, false);
  wrap.getValue = () => value;
  return wrap;
}

/** Show a modal confirmation; resolves true/false. Keyboard: Esc cancels, Enter confirms. */
export function confirmDialog(message, { ok = 'OK', cancel = 'Cancelar', test = 'confirm' } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
    const overlay = h('div.modal-overlay',
      h('div.panel.modal', { role: 'dialog', 'aria-modal': 'true' },
        h('p.modal-text', { text: message }),
        h('div.row.gap.end',
          button(cancel, { test: test + '-cancel', onClick: () => done(false) }),
          button(ok, { test: test + '-ok', primary: true, onClick: () => done(true) }),
        ),
      ),
    );
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    const okBtn = overlay.querySelector('.btn-primary');
    if (okBtn) okBtn.focus();
  });
}
