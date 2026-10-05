// Battle screen: canvas arena (renderer) + DOM HUD. Works with the local
// runner (single-player) and the network feed (multiplayer) through the same
// BattleFeed contract; no branching on the source for frames.

import { T, fmt } from '../i18n.js';
import { h, clear, confirmDialog } from '../util/dom.js';
import { animateShip } from '../util/shipCanvas.js';
import { createRenderer } from '../battle/renderer.js';
import { createLocalRunner } from '../battle/localRunner.js';
import { createHud } from '../battle/hud.js';
import { FACTIONS, SHIPS } from '/shared/catalog.js';
import { fleetToArray } from '/shared/fleet.js';

const INTRO_MS = 2600;
const END_OVERLAY_MS = 2300;

/**
 * @param {HTMLElement} root
 * @param {{ mode:'sp'|'mp', config?:object, meta?:object, speed?:number, intro?:boolean }} props
 */
export function mount(root, props, ctx) {
  const { state, audio } = ctx;
  const mode = props.mode || 'sp';
  const isLocal = mode === 'sp';
  const arena = document.getElementById('arena');
  const hudRoot = h('div#hud');
  root.appendChild(hudRoot);
  ctx.setArena('battle');

  let feed = null;
  let renderer = null;
  let hud = null;
  let raf = 0;
  let lastHud = 0;
  let disposed = false;
  let myTeam = null;
  let myPlayerId = null;
  let result = null;
  let endTimer = null;
  let endShown = false;
  let introEl = null;
  let introTimer = null;
  let speed = isLocal ? (props.speed ?? state.settings.speed ?? 1) : 1;
  let startedOnce = false;
  let currentSeed = null;
  const stops = [];
  const offs = [];
  const skipIntro = props.intro === false || ctx.params.autotest;

  // ---- feed ----
  if (isLocal) {
    try {
      feed = createLocalRunner(props.config, { speed: 0 });
    } catch (e) {
      ctx.reportError(e);
      ctx.toast(T.app.unexpectedError, 'error');
      ctx.go('menu');
      return { unmount() {} };
    }
    myPlayerId = 'p1';
    myTeam = 0;
  } else {
    const net = state.net;
    if (!net || !net.feed) { ctx.go('lobby'); return { unmount() {} }; }
    feed = net.feed;
    myPlayerId = net.playerId;
  }
  state.feed = feed;

  function onStart(start) {
    if (disposed) return;
    if (!isLocal) {
      const me = (start.players || []).find((p) => p.id === myPlayerId);
      myTeam = me ? me.team : null;
    }
    if (startedOnce && renderer && String(start.seed) === String(currentSeed)) {
      // reconnect to the same battle: the server resends start with the units
      // spawned meanwhile (start.ships) and the ids that died (start.dead).
      // Register them in the views we keep, then resync the interpolator.
      try { renderer.resync(start); } catch (e) { ctx.reportError(e); }
      try { if (hud) hud.resync(start); } catch (e) { ctx.reportError(e); }
      return;
    }
    if (renderer) { renderer.dispose(); renderer = null; }
    if (hud) { hud.dispose(); hud = null; }
    startedOnce = true;
    currentSeed = start.seed;
    result = null; endShown = false;
    renderer = createRenderer(arena, { start, myTeam, audio, isLocal });
    renderer.setOptions({ showNames: state.settings.showNames, grid: state.settings.grid, reducedMotion: ctx.reducedMotion(), quality: state.settings.quality });
    renderer.onEnd(() => { if (result) showEnd(); else endShown = 'pending'; });
    state.renderer = renderer;
    hud = createHud(hudRoot, {
      start, myTeam, myPlayerId, isLocal,
      settings: { showNames: state.settings.showNames, grid: state.settings.grid, muted: state.settings.muted, speed: isLocal ? 0 : 1 },
      onSpeed: setSpeed,
      onToggle: toggle,
      onQuit: quit,
      latency: () => (state.net ? state.net.latencyMs : 0),
    });
    hud.setStatus(feed.isLocal ? 'ok' : (state.net ? (state.net.status === 'ok' ? 'ok' : state.net.status === 'reconnecting' ? 'reconnecting' : 'lost') : 'ok'));
    try { audio.setScene('battle'); audio.setFactionHint(me(start) ? me(start).faction : null); } catch { /* ignore */ }
    if (!raf) raf = requestAnimationFrame(loop);
    if (skipIntro) { startClock(); }
    else showIntro(start);
  }
  function me(start) { return (start.players || []).find((p) => p.id === myPlayerId) || null; }

  function startClock() {
    if (introEl) { introEl.remove(); introEl = null; }
    if (introTimer) { clearTimeout(introTimer); introTimer = null; }
    if (hud) hud.setIntro(false);
    if (isLocal) setSpeed(speed > 0 ? speed : 1);
  }

  function showIntro(start) {
    if (hud) hud.setIntro(true);
    const players = start.players || [];
    const side = (t) => {
      const el = h('div.side', { class: t === 1 ? 'right' : '' });
      for (const p of players.filter((x) => x.team === t)) {
        const f = FACTIONS[p.faction];
        const row = h('div.ships-row');
        const seen = new Map();
        for (const cls of fleetToArray(p.fleet)) seen.set(cls, (seen.get(cls) || 0) + 1);
        for (const [cls, n] of seen) {
          const cv = h('canvas', { width: 48, height: 34, title: `${n}× ${SHIPS[cls].name}` });
          stops.push(animateShip(cv, cls, { team: t, angle: t === 0 ? -0.2 : Math.PI + 0.2, pad: 3 }, { animate: false }));
          row.appendChild(h('span', { style: { position: 'relative' } }, cv, h('span.badge.tiny', { text: `×${n}`, style: { position: 'absolute', right: '0', bottom: '0', fontSize: '9px', padding: '0 3px', background: 'rgba(5,7,12,.7)' } })));
        }
        el.appendChild(h('div.pl',
          h('div.pn', { class: t === 0 ? 'team-a' : 'team-b', text: p.name + (p.id === myPlayerId ? ` (${T.app.you})` : '') }),
          h('div.small.muted', { text: [f ? f.name : p.faction, p.isBot ? `${T.app.bot} ${T.difficulty[p.ai] || ''}`.trim() : ''].filter(Boolean).join(' · ') }),
          row,
        ));
      }
      return el;
    };
    introEl = h('div.battle-overlay', { test: 'battle-intro' },
      h('div.reveal', side(0), h('div.vs', { text: T.battle.vs }), side(1)),
      h('button.btn.btn-primary', { type: 'button', test: 'battle-begin', onClick: startClock }, T.battle.begin),
    );
    hudRoot.appendChild(introEl);
    introTimer = setTimeout(startClock, ctx.reducedMotion() ? 800 : INTRO_MS);
  }

  function setSpeed(x) {
    if (!isLocal || !feed) return;
    const v = [0, 1, 2, 4].includes(x) ? x : 1;
    if (v > 0 && v !== state.settings.speed) { state.settings.speed = v; try { ctx.persistSettings(); } catch { /* storage may be unavailable */ } }
    if (v > 0) speed = v;
    feed.controls.setSpeed(v);
    if (hud) hud.setSpeed(v);
  }
  function togglePause() {
    if (!isLocal || !feed) return;
    setSpeed(feed.controls.speed === 0 ? speed || 1 : 0);
  }

  function toggle(name) {
    if (name === 'names') { state.settings.showNames = !state.settings.showNames; ctx.persistSettings(); }
    else if (name === 'grid') { state.settings.grid = !state.settings.grid; ctx.persistSettings(); }
    else if (name === 'camera') { if (renderer) { renderer.camera.follow(0); renderer.camera.setMode('auto'); } }
    else if (name === 'sound') { state.settings.muted = !state.settings.muted; ctx.persistSettings(); }
    if (renderer) renderer.setOptions({ showNames: state.settings.showNames, grid: state.settings.grid });
    if (hud) hud.setToggles({ showNames: state.settings.showNames, grid: state.settings.grid, muted: state.settings.muted });
  }

  let quitting = false;
  async function quit() {
    if (quitting) return;
    quitting = true;
    let ok = false;
    try { ok = await confirmDialog(T.battle.quitConfirm, { ok: T.battle.quit, cancel: T.app.cancel, test: 'quit' }); }
    finally { quitting = false; }
    if (!ok || disposed) return;
    if (!isLocal && state.net) { state.net.leaveRoom().catch(() => {}); ctx.go('lobby'); }
    else ctx.go('menu');
  }

  function showEnd() {
    if (endShown === true || disposed) return;
    endShown = true;
    const r = result;
    let text, cls;
    if (r.winner === -1) { text = T.battle.draw; cls = 'muted'; }
    else if (myTeam !== null && r.winner === myTeam) { text = T.battle.victoryYours; cls = myTeam === 0 ? 'team-a' : 'team-b'; }
    else if (myTeam !== null) { text = T.battle.defeat; cls = 'danger'; }
    else { text = fmt(T.battle.victory, { team: T.app.team[r.winner].toUpperCase() }); cls = r.winner === 0 ? 'team-a' : 'team-b'; }
    const ov = h('div.battle-overlay.transparent', { test: 'battle-end' }, h('div.big', { class: cls, text }), h('div.sub', { text: T.battle.reason[r.reason] || '' }));
    hudRoot.appendChild(ov);
    try { audio.setScene(r.winner === -1 ? 'menu' : (myTeam !== null && r.winner === myTeam) ? 'victory' : 'defeat'); } catch { /* ignore */ }
    endTimer = setTimeout(goResults, ctx.reducedMotion() ? 900 : END_OVERLAY_MS);
  }

  function goResults() {
    if (disposed) return;
    const start = feed.lastStart;
    ctx.go('results', { mode, result, start, meta: props.meta || null, myTeam, myPlayerId, cleared: props.meta ? clearedLevel : false, speed });
  }

  let clearedLevel = false;
  function onEnd(r) {
    if (disposed || !r) return;
    result = r;
    if (isLocal && props.meta && r.winner === 0) {
      ctx.markLevelCleared(props.meta.setup.difficulty, props.meta.setup.level);
      clearedLevel = true;
    }
    if (endShown === 'pending') showEnd();
    // safety net: the renderer presents the end a bit later; never hang here
    setTimeout(() => { if (!disposed && endShown !== true) showEnd(); }, 2500);
  }

  function loop(t) {
    raf = 0;
    if (disposed) return;
    if (renderer) {
      try { renderer.draw(t); } catch (e) { ctx.reportError(e); }
      if (t - lastHud >= 100) {
        lastHud = t;
        if (hud) { try { hud.update(t, renderer.getView(), renderer.viewport); hud.setPaused(feed.controls.paused === true); } catch (e) { ctx.reportError(e); } }
        if (hud && audio && typeof audio.setBattleState === 'function') {
          try { audio.setBattleState({ ...hud.battleState, aliveFrac: hud.battleState.aliveFrac.slice() }); } catch { /* ignore */ }
        }
      }
    }
    raf = requestAnimationFrame(loop);
  }

  // ---- keyboard ----
  const onKey = (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (quitting) return; // the quit dialog owns the keyboard (Esc / Enter / Space on its buttons)
    if (e.key === ' ') { e.preventDefault(); if (introEl) startClock(); else togglePause(); }
    else if (e.key === '1') setSpeed(1);
    else if (e.key === '2') setSpeed(2);
    else if (e.key === '4') setSpeed(4);
    else if (e.key === 'n' || e.key === 'N') toggle('names');
    else if (e.key === 'g' || e.key === 'G') toggle('grid');
    else if (e.key === 'c' || e.key === 'C') toggle('camera');
    else if (e.key === 'Escape') quit();
  };
  document.addEventListener('keydown', onKey);
  const onResize = () => { if (renderer) renderer.resize(); };
  window.addEventListener('resize', onResize);

  offs.push(feed.onStart(onStart));
  offs.push(feed.onFrame((f) => { if (renderer) renderer.onFrame(f); if (hud) hud.onFrame(f); }));
  offs.push(feed.onEnd(onEnd));
  offs.push(feed.onStatus((s) => { if (hud) hud.setStatus(s); if (s === 'lost') ctx.toast(T.mp.connectionLost, 'error'); }));
  if (!isLocal && state.net) {
    offs.push(state.net.onLeft((reason) => { if (!disposed) { ctx.toast(reason === 'room_closed' ? T.lobby.roomClosed : T.lobby.left, 'warn'); ctx.go('lobby'); } }));
  }

  return {
    unmount() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (endTimer) clearTimeout(endTimer);
      if (introTimer) clearTimeout(introTimer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      for (const s of stops) s();
      if (hud) hud.dispose();
      if (renderer) renderer.dispose();
      if (isLocal && feed) feed.dispose();
      state.renderer = null;
      if (isLocal) state.feed = null;
      clear(root);
    },
  };
}
