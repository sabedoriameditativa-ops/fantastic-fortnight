// DOM battle HUD: team hull/shield totals and alive counts by size, clock,
// sudden-death banner, speed controls (local) or live indicator + latency
// (network), event log (last 6, pt-BR), toggles (names / grid / camera /
// sound) and the reconnect status. Updated at ~10 Hz by the battle screen from
// renderer.getView() and from frame events.

import { SHIPS, SIZE_CLASSES } from '/shared/catalog.js';
import { TICK_RATE, MAX_TICKS, SUDDEN_DEATH_TICK, FLAG } from '/shared/constants.js';
import { T, fmt } from '../i18n.js';
import { h, clear, svgIcon, add } from '../util/dom.js';
import { ticksToClock, num } from '../util/format.js';
import { createEventLog } from '../util/eventLog.js';

/**
 * @param {HTMLElement} root   container (positioned over the arena viewport)
 * @param {Object} o
 * @param {object} o.start            BattleStartInfo
 * @param {0|1|null} o.myTeam
 * @param {string|null} o.myPlayerId
 * @param {boolean} o.isLocal
 * @param {{ showNames:boolean, grid:boolean, muted:boolean, speed:number }} o.settings
 * @param {(x:number)=>void} o.onSpeed
 * @param {(name:'names'|'grid'|'camera'|'sound')=>void} o.onToggle
 * @param {()=>void} o.onQuit
 * @param {()=>number} o.latency       ms (network)
 */
export function createHud(root, o) {
  const start = o.start;
  const tickRate = start.tickRate || TICK_RATE;
  const maxTicks = start.maxTicks || MAX_TICKS;
  const names = new Map((start.players || []).map((p) => [p.id, p.name || p.id]));
  const playerTeam = new Map((start.players || []).map((p) => [p.id, p.team]));
  /** @type {Map<number, {cls:string, team:0|1, owner:string, maxHp:number, maxSh:number, spawned:boolean, sizeClass:string, alive:boolean}>} */
  const reg = new Map();
  const maxTotals = [{ hull: 0, sh: 0, n: 0 }, { hull: 0, sh: 0, n: 0 }];
  const sizesAtStart = [{}, {}];
  const pstats = new Map();
  for (const p of start.players || []) pstats.set(p.id, { id: p.id, name: p.name, team: p.team, kills: 0, losses: 0, total: 0, alive: 0 });

  function register(id, cls, team, owner, spawned) {
    const cat = SHIPS[cls];
    if (!cat) return null;
    const r = { cls, team, owner, maxHp: cat.hp, maxSh: cat.shield ? cat.shield.cap : 0, spawned, sizeClass: cat.sizeClass, alive: true };
    reg.set(id, r);
    if (!spawned) {
      maxTotals[team].hull += cat.hp; maxTotals[team].sh += r.maxSh; maxTotals[team].n++;
      sizesAtStart[team][cat.sizeClass] = (sizesAtStart[team][cat.sizeClass] || 0) + 1;
      const ps = pstats.get(owner); if (ps) { ps.total++; ps.alive++; }
    }
    return r;
  }
  for (const s of start.ships || []) register(s.id, s.cls, s.team, s.owner, !!s.objective);
  function markDead(id) {
    const r = reg.get(id);
    if (!r || !r.alive) return;
    r.alive = false;
    if (!r.spawned) { const ps = pstats.get(r.owner); if (ps) { ps.alive = Math.max(0, ps.alive - 1); ps.losses++; } }
  }
  if (Array.isArray(start.dead)) for (const id of start.dead) markDead(id);

  const log = createEventLog({ lookup: (id) => reg.get(id), playerName: (id) => names.get(id) || id, myPlayerId: o.myPlayerId, max: 6, ttlMs: 7000 });
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  // ---- DOM ----
  const teamEls = [0, 1].map((t) => {
    const hullFill = h('div.bar-fill'), ghost = h('div.ghost'), shFill = h('div.bar-fill');
    const alive = h('span.num.alive', { test: `hud-alive-${t}` });
    const pctEl = h('span.muted.pct');
    const sizes = h('div.ht-sizes');
    const sizeEls = new Map();
    for (const sc of SIZE_CLASSES) {
      if (!sizesAtStart[t][sc]) continue;
      const count = h('b');
      const item = h('span', count, ` ${T.builder.sizeShort[sc]}`);
      sizeEls.set(sc, { item, count }); sizes.appendChild(item);
    }
    const el = h('div.hud-team', { class: `t${t}` },
      h('div.ht-head', h('span.nm', { text: T.app.team[t] + (o.myTeam === t ? ` (${T.app.you})` : '') }), h('span', alive, ' ', pctEl)),
      h('div.bar.hull', hullFill, ghost),
      h('div.bar.shield', shFill),
      sizes,
    );
    return { el, hullFill, ghost, shFill, alive, pctEl, sizes, sizeEls, ghostW: 100 };
  });
  const timeEl = h('div.time', { test: 'hud-time', text: '00:00' });
  const speedWrap = h('div.speed');
  const speedButtons = new Map();
  if (o.isLocal) {
    for (const x of [0, 1, 2, 4]) {
      const b = h('button.btn.btn-sm', { type: 'button', test: `speed-${x}`, title: x === 0 ? T.battle.pause : `×${x}`, onClick: () => o.onSpeed(x) }, x === 0 ? svgIcon('pause', 10) : `×${x}`);
      speedButtons.set(x, b);
      speedWrap.appendChild(b);
    }
  }
  const liveEl = h('div.hud-live', { test: 'hud-live' }, h('span.dot'), h('span.lbl', { text: T.battle.live }), h('span.lat.muted.mono'));
  const clockEl = h('div.hud-clock', timeEl, o.isLocal ? speedWrap : liveEl);
  const top = h('div.hud-top', teamEls[0].el, clockEl, teamEls[1].el);
  const banner = h('div.hud-banner.hidden');
  const logEl = h('div.hud-log', { test: 'hud-log', 'aria-live': 'polite' });
  const logRows = new Map();
  const btnNames = h('button.btn.btn-sm', { type: 'button', test: 'hud-names', class: o.settings.showNames ? 'on' : '', onClick: () => o.onToggle('names') }, svgIcon('tag', 11), T.battle.names);
  const btnGrid = h('button.btn.btn-sm', { type: 'button', test: 'hud-grid', class: o.settings.grid ? 'on' : '', onClick: () => o.onToggle('grid') }, svgIcon('grid', 11), T.battle.grid);
  const btnCam = h('button.btn.btn-sm', { type: 'button', test: 'hud-camera', onClick: () => o.onToggle('camera') }, svgIcon('camera', 11), T.battle.cameraAuto);
  const btnSound = h('button.btn.btn-sm', { type: 'button', test: 'hud-sound', class: o.settings.muted ? '' : 'on', onClick: () => o.onToggle('sound') }, svgIcon('sound', 11), T.battle.sound);
  const right = h('div.hud-right', btnNames, btnGrid, btnCam, btnSound);
  const btnQuit = h('button.btn.btn-sm.btn-ghost', { type: 'button', test: 'hud-quit', onClick: () => o.onQuit() }, svgIcon('cross', 10), T.battle.quit);
  const left = h('div.hud-left', btnQuit);
  const playersEl = h('div.hud-players', { test: 'hud-players' });
  const decisionTitle = h('b');
  const decisionText = h('div.small');
  const decision = h('div.hud-decision.hidden', { test: 'ship-decision' }, decisionTitle, decisionText);
  const mission = h('div.hud-mission.hidden', { test: 'mission-status', role: 'status' });
  const playerRows = new Map();
  for (const ps of [...pstats.values()].sort((a, b) => a.team - b.team || a.name.localeCompare(b.name))) {
    const row = h('div.hp', { class: `t${ps.team}` }, h('span.pn', { text: ps.name + (ps.id === o.myPlayerId ? ` (${T.app.you})` : '') }), h('span.mono'));
    playerRows.set(ps.id, row);
    playersEl.appendChild(row);
  }
  clear(root);
  root.id = 'hud';
  add(root, top, banner, logEl, right, left, playersEl, decision, mission);

  // ---- state ----
  let suddenDeath = false;
  let bannerTimer = null;
  let paused = false;
  let intro = false;
  let status = 'ok';
  let lastVp = null;
  let speed = o.settings.speed ?? 1;
  const battleState = { aliveFrac: [1, 1], destroyedFrac: 0, elapsedSec: 0 };

  function setSpeedUI(x) {
    speed = x;
    for (const [k, b] of speedButtons) b.classList.toggle('on', k === x);
    updatePausedBanner();
  }
  function updatePausedBanner() {
    const show = o.isLocal && !intro && (speed === 0 || paused);
    if (show) { if (!banner.classList.contains('paused')) { banner.className = 'hud-banner paused'; banner.textContent = T.battle.paused; } }
    else if (banner.classList.contains('paused')) { banner.className = 'hud-banner hidden'; banner.textContent = ''; }
  }
  function showBanner(kind) {
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
    clear(banner);
    if (kind === 'suddenDeath') { banner.className = 'hud-banner'; add(banner, T.battle.suddenDeath, h('small', { text: T.battle.suddenDeathHint })); }
    else if (kind === 'engage') { banner.className = 'hud-banner engage'; banner.textContent = T.battle.engage; }
    else { banner.className = 'hud-banner hidden'; return; }
    bannerTimer = setTimeout(() => { banner.className = 'hud-banner hidden'; bannerTimer = null; updatePausedBanner(); }, kind === 'suddenDeath' ? 4000 : 2200);
  }

  const api = {
    /** Consume a frame's events (arrival time). */
    onFrame(frame) {
      const at = frame.at;
      if (frame.campaign) {
        const c = frame.campaign;
        mission.classList.remove('hidden');
        const label = ({ escort: 'Escolta', defense: 'Defesa', survival: 'Sobrevivência', waves: 'Ondas' })[c.type] || 'Missão';
        setText(mission, `${label} · onda ${c.wave}/${c.totalWaves}${c.objectiveHp !== null ? ` · objetivo ${Math.round(c.objectiveHp / 10)}%` : ''} · ${ticksToClock(c.ticksLeft, tickRate)}`);
      }
      for (const e of frame.e) {
        const t = e[0];
        if (t === 'spawn') register(e[1], e[2], e[3], e[4], true);
        else if (t === 'die') {
          const r = reg.get(e[1]);
          if (r && r.alive) {
            markDead(e[1]);
            const k = e[2] ? reg.get(e[2]) : null;
            if (k && !r.spawned) { const ks = pstats.get(k.owner); if (ks) ks.kills++; }
          }
        } else if (t === 'phase') {
          if (e[1] === 'suddenDeath') { suddenDeath = true; showBanner('suddenDeath'); }
          else if (e[1] === 'engage') showBanner('engage');
        }
      }
      const added = log.push(frame.e, at);
      if (added.length) renderLog(at);
    },
    /** Refresh totals from the renderer view. */
    update(now, view, viewport, selectedId) {
      if (viewport && (!lastVp || viewport.x !== lastVp.x || viewport.y !== lastVp.y || viewport.w !== lastVp.w || viewport.h !== lastVp.h || viewport.ch !== lastVp.ch)) {
        lastVp = { ...viewport };
        // Overlay the 16:9 arena; on short letterboxes (portrait phones) use the whole canvas instead.
        const useFull = viewport.h < 420 && viewport.ch > viewport.h;
        const r = useFull ? { x: 0, y: 0, w: viewport.cw, h: viewport.ch } : viewport;
        root.style.inset = 'auto';
        root.style.left = `${r.x}px`; root.style.top = `${r.y}px`; root.style.width = `${r.w}px`; root.style.height = `${r.h}px`;
      }
      if (!view) return;
      const selected = view.ships.get(selectedId), selectedInfo = reg.get(selectedId);
      decision.classList.toggle('hidden', !selected || !selectedInfo);
      if (selected && selectedInfo) {
        const ship = SHIPS[selectedInfo.cls];
        const conditions = [];
        if (selected.flags & FLAG.RETREATING) conditions.push('Recuando para tentar recuperar proteção; o recuo tem duração e intervalo limitados.');
        if (selected.flags & FLAG.DISRUPTED) conditions.push('Disrupção ativa: reparos e regeneração interrompidos.');
        if (selected.flags & FLAG.UNTARGETABLE) conditions.push('Fase ou camuflagem: temporariamente inalvejável.');
        if (selected.flags & FLAG.CASTING) conditions.push('Preparando habilidade ou disparo pesado.');
        if (selected.flags & FLAG.STATIONARY) conditions.push('Ancorada: posição fixa de combate.');
        setText(decisionTitle, `${ship.name} · casco ${Math.round(selected.hp / 10)}%`);
        const doctrine = ({ support: 'Doutrina: reparar e acompanhar aliados.', carrier: 'Doutrina: lançar unidades e manter distância.', escort: 'Doutrina: proteger aliados próximos.', kiter: 'Doutrina: preservar distância de tiro.', anchor: 'Doutrina: sustentar a linha.', diver: 'Doutrina: aproximar e atacar alvos vulneráveis.' })[ship.role] || 'Doutrina: buscar alvos conforme alcance, função e prioridade tática.';
        setText(decisionText, conditions.length ? conditions.join(' ') : doctrine);
      }
      const tick = Math.max(0, view.tick || 0);
      setText(timeEl, fmt(T.battle.timer, { time: ticksToClock(tick, tickRate), max: ticksToClock(maxTicks, tickRate) }));
      timeEl.classList.toggle('sd', suddenDeath || tick >= SUDDEN_DEATH_TICK);
      const tot = [{ hull: 0, sh: 0, n: 0 }, { hull: 0, sh: 0, n: 0 }];
      const aliveByOwner = new Map();
      const sizes = [{}, {}];
      for (const v of view.ships.values()) {
        const r = reg.get(v.id);
        if (!r || r.spawned) continue;
        const t = r.team;
        tot[t].hull += (v.hp / 1000) * r.maxHp;
        tot[t].sh += (v.sh / 1000) * r.maxSh;
        tot[t].n++;
        sizes[t][r.sizeClass] = (sizes[t][r.sizeClass] || 0) + 1;
        aliveByOwner.set(r.owner, (aliveByOwner.get(r.owner) || 0) + 1);
      }
      const totalShips = maxTotals[0].n + maxTotals[1].n;
      battleState.aliveFrac = [maxTotals[0].n ? tot[0].n / maxTotals[0].n : 0, maxTotals[1].n ? tot[1].n / maxTotals[1].n : 0];
      battleState.destroyedFrac = totalShips ? 1 - (tot[0].n + tot[1].n) / totalShips : 0;
      battleState.elapsedSec = tick / tickRate;
      for (let t = 0; t < 2; t++) {
        const te = teamEls[t], m = maxTotals[t];
        const hf = m.hull > 0 ? tot[t].hull / m.hull : 0;
        const sf = m.sh > 0 ? tot[t].sh / m.sh : 0;
        const hw = Math.round(hf * 1000) / 10;
        te.hullFill.style.width = `${hw}%`;
        te.ghostW = hw < te.ghostW ? te.ghostW + (hw - te.ghostW) * 0.12 : hw;
        te.ghost.style.width = `${Math.max(0, te.ghostW - hw)}%`;
        te.ghost.style.left = t === 0 ? `${hw}%` : 'auto';
        te.ghost.style.right = t === 1 ? `${hw}%` : 'auto';
        te.shFill.style.width = `${Math.round(sf * 1000) / 10}%`;
        setText(te.alive, fmt(T.battle.alive, { alive: tot[t].n, total: m.n }));
        setText(te.pctEl, `${Math.round(hf * 100)}%`);
        for (const [sc, nodes] of te.sizeEls) {
          const n = sizes[t][sc] || 0;
          if (nodes.count.textContent !== String(n)) {
            nodes.count.textContent = String(n);
            nodes.item.title = `${T.builder.sizeClass[sc]}: ${n}/${sizesAtStart[t][sc]}`;
          }
        }
      }
      for (const [id, row] of playerRows) {
        const ps = pstats.get(id);
        const alive = aliveByOwner.get(id) || 0;
        setText(row.lastChild, `${alive}/${ps.total} · ${ps.kills} ✕`);
        row.classList.toggle('dead', alive === 0 && ps.total > 0);
      }
      if (!o.isLocal) {
        const ms = o.latency ? o.latency() : 0;
        liveEl.querySelector('.lat').textContent = status === 'ok' ? fmt(T.lobby.latency, { ms: num(ms) }) : '';
      }
      renderLog(now);
    },
    setSpeed(x) { setSpeedUI(x); },
    setPaused(b) { paused = !!b; updatePausedBanner(); },
    /** While the reveal overlay is up the clock is intentionally stopped: hide the pause banner. */
    setIntro(b) { intro = !!b; updatePausedBanner(); },
    /**
     * Reconnect to the same battle (idempotent): units in `start.ships` we never
     * saw are spawned ones (their 'spawn' event was missed), `start.dead` lists
     * the ids destroyed so far (missed 'die' events count as losses; kills are unknown).
     */
    resync(start) {
      for (const s of (start && start.ships) || []) if (s && !reg.has(s.id)) register(s.id, s.cls, s.team, s.owner, true);
      if (start && Array.isArray(start.dead)) for (const id of start.dead) markDead(id);
    },
    /** @param {'ok'|'reconnecting'|'lost'} s */
    setStatus(s) {
      status = s;
      liveEl.classList.toggle('warn', s === 'reconnecting');
      liveEl.classList.toggle('bad', s === 'lost');
      liveEl.querySelector('.lbl').textContent = s === 'ok' ? T.battle.live : s === 'reconnecting' ? T.battle.reconnecting : T.battle.lost;
    },
    setToggles({ showNames, grid, muted }) {
      if (showNames !== undefined) btnNames.classList.toggle('on', !!showNames);
      if (grid !== undefined) btnGrid.classList.toggle('on', !!grid);
      if (muted !== undefined) btnSound.classList.toggle('on', !muted);
    },
    /** Per-player kills/losses accumulated from events (for results fallback). */
    get playerStats() { return pstats; },
    /** For audio.setBattleState: alive fractions per team, destroyed fraction, elapsed seconds. */
    get battleState() { return battleState; },
    get suddenDeath() { return suddenDeath; },
    dispose() {
      if (bannerTimer) clearTimeout(bannerTimer);
      clear(root);
    },
  };

  function renderLog(now) {
    const entries = log.entries(now);
    const live = new Set(entries.map(e => e.id));
    for (const [id, node] of logRows) if (!live.has(id)) { node.remove(); logRows.delete(id); }
    for (const e of entries) {
      let el = logRows.get(e.id);
      if (!el) {
        el = h('div.le', { class: `t${e.team === -1 ? 'x' : e.team} ${e.kind}`, text: e.text });
        logRows.set(e.id, el); logEl.appendChild(el);
      }
      el.classList.toggle('fade', now - e.at > 5000);
    }
  }

  setSpeedUI(speed);
  return api;
}
