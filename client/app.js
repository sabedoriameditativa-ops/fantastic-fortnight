// Frota Estelar — client entry: screen router, app state, URL parameters,
// settings, audio gesture init, toasts and the debug hook (window.__fe).

import { T, errorMessage } from './i18n.js';
import { h, clear } from './util/dom.js';
import {
  loadName, saveName, loadSettings, saveSettings, loadProgress, saveProgress, withLevelCleared,
  loadLastFleet, saveLastFleet, loadSpSetup, saveSpSetup,
} from './util/storage.js';
import { parseParams, defaultWsUrl, randomSeed } from './util/url.js';
import { createAmbient } from './util/ambient.js';
import { setShipAnimations } from './util/shipCanvas.js';
import { buildSpConfig, autotestSetup, normalizeSpSetup } from './util/spConfig.js';
import { audio } from './audio/index.js';
import { createNetClient } from './battle/netClient.js';
import { createProfileClient } from './util/profile.js';
import { createServerInfoClient } from './util/serverInfo.js';
import { validateName } from '/shared/protocol.js';
import { DEFAULT_BUDGET } from '/shared/constants.js';

import * as menu from './screens/menu.js';
import * as howto from './screens/howto.js';
import * as spSetup from './screens/spSetup.js';
import * as fleetBuilder from './screens/fleetBuilder.js';
import * as lobby from './screens/lobby.js';
import * as battle from './screens/battle.js';
import * as results from './screens/results.js';
import * as codex from './screens/codex.js';
import * as options from './screens/options.js';
import * as profile from './screens/profile.js';

const screens = { menu, howto, spSetup, fleetBuilder, lobby, battle, results, codex, options, profile };
const isStatic = document.documentElement.dataset.deployment === 'static';
const profileClient = isStatic ? null : createProfileClient();
const serverInfo = isStatic ? null : createServerInfoClient();

const root = document.getElementById('app');
const arena = document.getElementById('arena');
const bgCanvas = document.getElementById('bg');
const toastsEl = document.getElementById('toasts');
const params = parseParams(location.search);

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const state = {
  playerName: loadName(),
  settings: loadSettings(),
  progress: loadProgress(),
  lastFleet: loadLastFleet(),
  spSetup: normalizeSpSetup(loadSpSetup()),
  params,
  /** @type {ReturnType<typeof createNetClient>|null} */
  net: null,
  screen: null,
  screenName: '',
  feed: null,
  renderer: null,
  errors: [],
};

const reducedMotionMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Effective reduced-motion flag (settings override the system preference). */
function reducedMotion() {
  const s = state.settings.reducedMotion;
  if (s === 'on') return true;
  if (s === 'off') return false;
  return !!(reducedMotionMq && reducedMotionMq.matches);
}

function applySettings() {
  document.documentElement.setAttribute('data-rm', state.settings.reducedMotion);
  setShipAnimations(!reducedMotion());
  try {
    audio.setSettings(state.settings);
  } catch (e) { reportError(e); }
  if (state.renderer) state.renderer.setOptions({ reducedMotion: reducedMotion(), quality: state.settings.quality, reducedEffects: state.settings.reducedEffects, highContrast: state.settings.highContrast, showNames: state.settings.showNames, grid: state.settings.grid });
  state.screen?.onSettingsChanged?.();
  ambient.refresh();
}

function persistSettings() {
  saveSettings(state.settings);
  applySettings();
}

// ---------------------------------------------------------------------------
// Toasts / errors
// ---------------------------------------------------------------------------

/**
 * @param {string} msg
 * @param {'info'|'ok'|'warn'|'error'} [type]
 * @param {number} [ms]
 */
function toast(msg, type = 'info', ms = 3200) {
  const el = h('div.toast', { class: type, role: 'status', test: 'toast' }, msg);
  if (type === 'error') { try { audio.play('ui.error'); } catch { /* ignore */ } }
  toastsEl.appendChild(el);
  while (toastsEl.children.length > 4) toastsEl.removeChild(toastsEl.firstChild);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
  return el;
}

function reportError(e) {
  const text = e && e.stack ? String(e.stack) : String(e);
  state.errors.push(text);
  if (state.errors.length > 50) state.errors.shift();
  console.error(e);
}

window.addEventListener('error', (ev) => { state.errors.push(String(ev.message || ev.error)); });
window.addEventListener('unhandledrejection', (ev) => { reportError(ev.reason); });

// ---------------------------------------------------------------------------
// Ambient background + audio gesture init
// ---------------------------------------------------------------------------

const ambient = createAmbient(bgCanvas, { reducedMotion });

function initAudioOnGesture() {
  const once = () => {
    try { audio.init(); applySettings(); } catch (e) { reportError(e); }
    document.removeEventListener('pointerdown', once, true);
    document.removeEventListener('keydown', once, true);
  };
  document.addEventListener('pointerdown', once, true);
  document.addEventListener('keydown', once, true);
}
initAudioOnGesture();

// UI click sounds (buttons only)
document.addEventListener('click', (ev) => {
  const b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
  if (b && !b.disabled) { try { audio.play(b.classList.contains('btn-primary') ? 'ui.confirm' : 'ui.click'); } catch { /* ignore */ } }
});
// UI hover ticks (mouse only; one per button entry)
document.addEventListener('pointerover', (ev) => {
  if (ev.pointerType && ev.pointerType !== 'mouse') return;
  const b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
  if (!b || b.disabled || (ev.relatedTarget && b.contains(ev.relatedTarget))) return;
  try { audio.play('ui.hover'); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Networking (lazy)
// ---------------------------------------------------------------------------

function wsUrl() {
  if (params.ws) return params.ws;
  return defaultWsUrl(location);
}

/** Connected NetClient (creates + connects on first use). */
async function getNet() {
  if (isStatic) throw new Error('O multijogador exige um servidor e não está disponível nesta versão.');
  const name = validateName(state.playerName) || 'Comandante';
  if (!state.net) {
    state.net = createNetClient(wsUrl());
    state.net.onError((e) => {
      if (e.rid === undefined) toast(errorMessage(e.code, e.detail), 'error');
    });
    // chat history lives on the app state so it survives screen changes (lobby ↔ fleet builder ↔ results)
    if (!state.mpChat) state.mpChat = [];
    state.net.onChat((m) => { state.mpChat.push(m); if (state.mpChat.length > 80) state.mpChat.shift(); });
    state.net.onLeft(() => { state.mpChat.length = 0; state.mpFleet = null; });
  }
  if (!state.net.connected) {
    // Establish the same-origin HttpOnly profile cookie before the WS handshake.
    await profileClient.ensure().catch(() => null);
    await state.net.connect(name);
  }
  return state.net;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ctx = {
  state, params, T, toast, audio, ambient, reducedMotion, applySettings, persistSettings, getNet, reportError, isStatic, serverInfo,
  profile: profileClient,
  go: (name, props) => go(name, props),
  setArena(mode) { setArena(mode); },
  setPlayerName(name) {
    const v = validateName(name);
    state.playerName = v || '';
    saveName(state.playerName);
    return state.playerName;
  },
  saveSpSetup(setup) { state.spSetup = normalizeSpSetup(setup); saveSpSetup(state.spSetup); },
  saveLastFleet(fleet) { state.lastFleet = fleet; saveLastFleet(fleet); },
  markLevelCleared(difficulty, level) {
    state.progress = withLevelCleared(state.progress, difficulty, level);
    saveProgress(state.progress);
  },
  resetProgress() { state.progress = {}; saveProgress(state.progress); },
  /** Start a single-player battle from a setup + fleet. */
  startSinglePlayer(setup, fleet, { seed, speed, practice = false } = {}) {
    const s = seed ?? params.seed ?? randomSeed();
    let built;
    try {
      built = buildSpConfig({ setup, playerFleet: fleet, playerName: state.playerName || 'Comandante', seed: s, budget: DEFAULT_BUDGET });
    } catch (e) {
      reportError(e);
      toast(errorMessage(e.code || 'UNKNOWN', e.detail), 'error');
      return false;
    }
    ctx.saveLastFleet(fleet);
    ctx.saveSpSetup(setup);
    const launch = {};
    state.pendingLaunch = launch;
    const start = (battle, rated, runId) => {
      if (state.pendingLaunch !== launch) return;
      state.pendingLaunch = null;
      go('battle', { mode: 'sp', config: battle.config, meta: battle.meta, rated, runId, speed: speed ?? state.settings.speed });
    };
    // Explicit seeds and the automated harness remain reproducible practice.
    if (isStatic || params.autotest || practice || params.seed != null) start(built, false);
    else {
      toast('Preparando partida…', 'ok', 1800);
      profileClient.beginRun({ setup, fleet, playerName: state.playerName || 'Comandante' }).then(run => start(run, true, run.runId)).catch(() => {
        if (state.pendingLaunch !== launch) return;
        toast('Treino local: esta partida não concede pontos verificados.', 'warn', 5000);
        start(built, false);
      });
    }
    return true;
  },
};

/**
 * Arena canvas mode: 'hidden' (menus), 'battle' (live), 'dimmed' (results backdrop).
 * @param {'hidden'|'battle'|'dimmed'} mode
 */
function setArena(mode) {
  arena.classList.toggle('visible', mode !== 'hidden');
  arena.classList.toggle('dimmed', mode === 'dimmed');
  bgCanvas.style.visibility = mode === 'hidden' ? '' : 'hidden';
  ambient.setVisible(mode === 'hidden');
}

function go(name, props = {}) {
  if (isStatic && props.mode === 'mp' && ['fleetBuilder', 'battle', 'results'].includes(name)) {
    name = 'lobby';
    props = {};
  }
  const mod = screens[name];
  if (!mod) { reportError(new Error(`unknown screen ${name}`)); return; }
  state.pendingLaunch = null;
  if (state.screen && typeof state.screen.unmount === 'function') {
    try { state.screen.unmount(); } catch (e) { reportError(e); }
  }
  state.screen = null;
  clear(root);
  root.className = name === 'battle' ? 'battle' : '';
  root.scrollTop = 0;
  if (name !== 'battle' && name !== 'results') setArena('hidden');
  state.screenName = name;
  try {
    audio.setScene(name === 'battle' ? 'battle' : name === 'fleetBuilder' ? 'builder' : 'menu');
  } catch { /* ignore */ }
  try {
    state.screen = mod.mount(root, props, ctx) || { unmount() {} };
  } catch (e) {
    reportError(e);
    clear(root);
    root.className = '';
    setArena('hidden');
    root.appendChild(h('div.screen.narrow',
      h('div.panel', h('h1', T.app.errorTitle), h('p', { text: T.app.unexpectedError }), h('p.small.muted', { text: String(e && e.message || e) }),
        h('button.btn', { type: 'button', test: 'error-menu', onClick: () => go('menu') }, T.results.menu)),
    ));
  }
  if (name !== 'battle') ambient.start();
  updateDebug();
}

// ---------------------------------------------------------------------------
// Debug hook
// ---------------------------------------------------------------------------

const fe = {
  get state() { return state; },
  get screen() { return state.screenName; },
  get feed() { return state.feed; },
  get renderer() { return state.renderer; },
  get errors() { return state.errors; },
  audio,
  go,
  params,
};
function updateDebug() {
  if (params.debug || params.autotest) window.__fe = fe;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  applySettings();
  ambient.start();
  if (params.autotest) {
    const { setup, fleet } = autotestSetup(params, DEFAULT_BUDGET);
    const speed = params.speed ?? 4;
    if (!state.playerName) state.playerName = 'Teste';
    if (!ctx.startSinglePlayer(setup, fleet, { seed: params.seed ?? randomSeed(), speed })) go('menu');
    return;
  }
  if (params.sala && !isStatic) {
    go('lobby', { joinCode: params.sala });
    return;
  }
  go('menu');
}

if (reducedMotionMq && typeof reducedMotionMq.addEventListener === 'function') reducedMotionMq.addEventListener('change', applySettings);
boot();
