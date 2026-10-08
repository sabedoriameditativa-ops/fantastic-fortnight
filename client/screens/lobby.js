// Multiplayer: entry (create / join a room) and the lobby itself (slot grid,
// bots, ready, host controls, chat, countdown overlay).

import { T, fmt, errorMessage, difficultyName } from '../i18n.js';
import { h, clear, button, segmented, select, svgIcon, add } from '../util/dom.js';
import { num } from '../util/format.js';
import { roomLink } from '../util/url.js';
import { animateShip } from '../util/shipCanvas.js';
import { TEAM_SIZES, BUDGETS, DIFFICULTIES, DEFAULT_BUDGET } from '/shared/constants.js';
import { FACTIONS, FACTION_IDS, shipsOfFaction } from '/shared/catalog.js';
import { isRoomCode, normalizeRoomCode, TEAM_ROLES } from '/shared/protocol.js';
import { fleetSummary } from '/shared/fleet.js';

const BUDGET_LIST = Object.values(BUDGETS);
const ROLE_NAMES = { vanguard: 'Vanguarda', support: 'Suporte', striker: 'Ataque' };

export function mount(root, props, ctx) {
  if (ctx.isStatic) {
    root.appendChild(h('div.screen.narrow', { test: 'static-multiplayer' },
      h('div.screen-head', h('h1', 'Multijogador'), button(T.app.back, { test: 'back', onClick: () => ctx.go('menu') })),
      h('div.panel.stack', h('p', 'Salas e chat precisam de um servidor. Esta versão oferece partidas individuais contra bots.'),
        h('p.small.muted', 'Links de salas e endereços de servidor não ativam uma conexão nesta versão.'),
        button('Jogar campanha', { primary: true, test: 'static-play', onClick: () => ctx.go('spSetup') }))));
    return { unmount() {} };
  }
  const { state } = ctx;
  let net = null;
  let disposed = false;
  const offs = [];
  const stops = [];
  let view = 'entry';
  let fillBots = true;
  let countdownEl = null;
  let countdownTimer = null;
  let chatLog = null;
  let chatPanel = null;
  const roomBody = h('div.room-body');
  const chatMessages = state.mpChat || (state.mpChat = []);  // shared with app.js: survives screen changes

  const container = h('div.screen.wide');
  root.appendChild(container);

  // ---- helpers ----
  const myName = () => state.playerName || 'Comandante';
  function fail(e) { if (!disposed) ctx.toast(errorMessage(e && e.code || 'UNKNOWN', e && e.detail), 'error'); }

  async function ensureNet() {
    if (!state.playerName) { ctx.toast(T.mp.needName, 'warn'); }
    renderConnecting();
    try {
      net = await ctx.getNet();
    } catch (e) {
      if (disposed) return null;
      renderEntry(T.mp.serverUnavailable);
      return null;
    }
    if (disposed) return null;
    subscribe();
    return net;
  }

  let subscribedTo = null;
  function subscribe() {
    if (!net || subscribedTo === net) return;
    subscribedTo = net;
    offs.push(net.onRoom((room) => {
      if (disposed) return;
      if (room.phase === 'lobby' || room.phase === 'results') hideCountdown();
      renderRoom(room);
      // bot factions are chosen at countdown: refresh the reveal when the room push arrives
      if (countdownEl && room.phase === 'countdown') {
        const old = countdownEl.querySelector('.reveal');
        const fresh = revealFromRoom(room);
        if (old && fresh) old.replaceWith(fresh); else if (fresh) countdownEl.appendChild(fresh);
      }
    }));
    offs.push(net.onLeft((reason) => {
      if (disposed) return;
      hideCountdown();
      ctx.toast(reason === 'kicked' ? T.lobby.kicked : reason === 'room_closed' ? T.lobby.roomClosed : T.lobby.left, 'warn');
      renderEntry();
    }));
    offs.push(net.onCountdown((c) => { if (!disposed) showCountdown(c.seconds); }));
    offs.push(net.onChat(() => renderChat()));  // app.js already stored the message
    offs.push(net.feed.onStart(() => { if (!disposed) { hideCountdown(); ctx.go('battle', { mode: 'mp' }); } }));
    offs.push(net.onStatus((s) => {
      if (disposed) return;
      if (s === 'lost') {
        ctx.toast(T.mp.connectionLost, 'error');
        // reconnection gave up while on the entry screen: offer the retry control
        if (view === 'entry') { renderEntry(T.mp.connectionLost); return; }
      }
      const st = container.querySelector('[data-test=conn-status]');
      if (st) st.textContent = s === 'ok' ? fmt(T.mp.connected, { name: net.name }) : s === 'reconnecting' ? T.mp.reconnecting : s === 'lost' ? T.mp.connectionLost : '';
    }));
  }

  // ---- entry ----
  function head(title, subtitle, backTo = 'menu') {
    return h('div.screen-head',
      h('div.titles', h('h1', { text: title }), h('div.subtitle', { text: subtitle })),
      h('div.actions', button(T.app.back, { test: 'back', onClick: () => { if (backTo === 'leave') leave(); else ctx.go(backTo); } })),
    );
  }

  function renderConnecting() {
    view = 'connecting';
    clear(container);
    add(container, head(T.mp.title, T.mp.subtitle), h('div.panel', h('p', { text: T.mp.connecting })));
  }

  function renderEntry(errorText) {
    view = 'entry';
    clear(container);
    let teamSize = 1, budget = DEFAULT_BUDGET;
    const codeInput = h('input.input.code', { type: 'text', test: 'join-code', maxlength: 4, placeholder: T.mp.codePlaceholder, autocomplete: 'off', spellcheck: 'false',
      onInput: (e) => { e.target.value = normalizeRoomCode(e.target.value).slice(0, 4); },
      onKeydown: (e) => { if (e.key === 'Enter') join(); } });
    const createBtn = button(T.mp.create, { test: 'create-room', primary: true, onClick: create });
    const joinBtn = button(T.mp.join, { test: 'join-room', primary: true, onClick: join });
    async function create() {
      if (!net || !net.connected) { if (!(await ensureNet())) return; }
      createBtn.disabled = true;
      try { const room = await net.createRoom({ teamSize, budget }); chatMessages.length = 0; renderRoom(room); }
      catch (e) { fail(e); createBtn.disabled = false; }
    }
    async function join() {
      const code = normalizeRoomCode(codeInput.value);
      if (!isRoomCode(code)) { ctx.toast(T.mp.codeHint, 'warn'); codeInput.focus(); return; }
      if (!net || !net.connected) { if (!(await ensureNet())) return; }
      joinBtn.disabled = true;
      try { const room = await net.joinRoom(code); chatMessages.length = 0; renderRoom(room); }
      catch (e) { fail(e); joinBtn.disabled = false; }
    }
    add(container, 
      head(T.mp.title, T.mp.subtitle),
      errorText ? h('div.validation.error', { style: { marginBottom: '12px' } }, errorText, ' ', button('↻', { test: 'retry-connect', class: 'btn-sm', onClick: () => ensureNet().then((n) => { if (n) renderEntry(); }) })) : null,
      h('div.small.muted', { test: 'conn-status', style: { marginBottom: '10px' }, text: net && net.connected ? fmt(T.mp.connected, { name: net.name }) : '' }),
      h('div.sp-grid',
        h('div.panel.stack', h('h2', { text: T.mp.createTitle }),
          h('label.field', h('span.lbl', { text: T.mp.teamSize }), segmented(TEAM_SIZES.map((n) => ({ value: n, label: `${n}v${n}`, test: `create-teamsize-${n}` })), { value: teamSize, onChange: (v) => { teamSize = v; } })),
          h('label.field', h('span.lbl', { text: T.mp.budget }), segmented(BUDGET_LIST.map((b) => ({ value: b.points, label: `${b.name} · ${b.points}`, test: `create-budget-${b.id}` })), { value: budget, onChange: (v) => { budget = v; } })),
          createBtn),
        h('div.panel.stack', h('h2', { text: T.mp.joinTitle }), h('div.row.gap.wrap', codeInput, joinBtn), h('div.tiny.muted', { text: T.mp.codeHint })),
      ),
    );
    if (props.joinCode && isRoomCode(normalizeRoomCode(props.joinCode))) {
      codeInput.value = normalizeRoomCode(props.joinCode);
      props.joinCode = null;
      join();
    }
  }

  // ---- room ----
  function me(room) {
    for (let t = 0; t < 2; t++) for (let i = 0; i < room.slots[t].length; i++) { const s = room.slots[t][i]; if (s.kind === 'human' && s.playerId === room.you) return { team: t, slot: i, s }; }
    return null;
  }
  function isHost(room) { return room.hostId === room.you; }

  function renderRoom(room) {
    view = 'room';
    const mine = me(room);
    const host = isHost(room);
    // the server is the authority on whether this room has our fleet; the local
    // copy is only a convenience (badge / preload for the builder)
    const myFleet = mine && mine.s.hasFleet ? (state.mpFleet || null) : null;
    // Keep the chat subtree mounted: room pushes must not interrupt typing,
    // selection or input-method composition.
    if (!roomBody.isConnected) { clear(container); container.appendChild(roomBody); }
    clear(roomBody);
    for (const stop of stops.splice(0)) stop();
    const link = roomLink(room.code, location);
    const copy = async (text, msg) => {
      try { await navigator.clipboard.writeText(text); ctx.toast(msg, 'ok', 1800); }
      catch { ctx.toast(T.app.copyFailed, 'warn'); }
    };
    const headEl = h('div.screen-head',
      h('div.titles',
        h('div.row.gap.wrap', h('span.room-code', { test: 'room-code', text: room.code }),
          button(T.lobby.copyCode, { test: 'copy-code', class: 'btn-sm', onClick: () => copy(room.code, T.lobby.codeCopied) }),
          button(T.lobby.copyLink, { test: 'copy-link', class: 'btn-sm', onClick: () => copy(link, T.lobby.linkCopied) })),
        h('div.subtitle.row.gap.wrap',
          h('span', { text: `${room.teamSize}v${room.teamSize} · ${num(room.budget)} ${T.app.points} · ${T.lobby.botDifficulty}: ${difficultyName(room.botDifficulty)}` }),
          h('span.badge', { text: T.lobby.phase[room.phase] || room.phase }),
          h('span.mono.small', { test: 'latency', text: fmt(T.lobby.latency, { ms: num(net.latencyMs) }) }),
        ),
      ),
      h('div.actions', button(T.lobby.leave, { test: 'leave-room', class: 'btn-danger', onClick: leave })),
    );

    // host controls
    let hostPanel = null;
    if (host) {
      hostPanel = h('div.panel.tight.row.gap.wrap',
        h('label.check', h('input', { type: 'checkbox', test: 'room-pilots', checked: room.pilotsEnabled, disabled: room.phase !== 'lobby', onChange: e => net.setRoom({ pilotsEnabled: e.target.checked }).catch(fail) }), 'Naves pilotáveis · reserva de 200 pontos por comandante'),
        h('label.field', h('span.lbl', { text: T.lobby.teamSize }), select(TEAM_SIZES.map((n) => ({ value: n, label: `${n}v${n}` })), { value: room.teamSize, test: 'room-teamsize', onChange: (e) => net.setRoom({ teamSize: Number(e.target.value) }).catch(fail) })),
        h('label.field', h('span.lbl', { text: T.lobby.budget }), select(BUDGET_LIST.map((b) => ({ value: b.points, label: `${b.name} · ${b.points}` })), { value: room.budget, test: 'room-budget', onChange: (e) => net.setRoom({ budget: Number(e.target.value) }).catch(fail) })),
        h('label.field', h('span.lbl', { text: T.lobby.botDifficulty }), select(DIFFICULTIES.map((d) => ({ value: d, label: difficultyName(d) })), { value: room.botDifficulty, test: 'room-botdiff', onChange: (e) => net.setRoom({ botDifficulty: e.target.value }).catch(fail) })),
      );
    }

    // slots
    const slotsEl = h('div.slots');
    for (let t = 0; t < 2; t++) {
      const col = h('div.team-col', { class: `t${t}` }, h('h3', { text: T.app.team[t] }));
      for (let i = 0; i < room.slots[t].length; i++) col.appendChild(renderSlot(room, t, i, room.slots[t][i], mine, host));
      slotsEl.appendChild(col);
    }

    // my fleet + ready
    const fleetPanel = h('div.panel.stack');
    const readyBtn = button(mine && mine.s.ready ? T.lobby.unreadyBtn : T.lobby.readyBtn, { test: 'ready', primary: !(mine && mine.s.ready), class: 'btn-block', disabled: !mine || !mine.s.hasFleet || room.phase !== 'lobby',
      onClick: () => net.setReady(!(mine && mine.s.ready)).catch(fail) });
    if (mine) {
      const sum = myFleet ? fleetSummary(myFleet) : null;
      add(fleetPanel, h('h3', { text: T.lobby.yourFleet }),
        h('label.field', h('span.lbl', 'Meu papel no time'), select(TEAM_ROLES.map(role => ({ value: role, label: ROLE_NAMES[role] })), { value: mine.s.role || 'vanguard', test: 'team-role', onChange: e => net.setRole(e.target.value).catch(fail) })),
        h('p.tiny.muted', 'O papel comunica sua intenção ao time; não concede bônus. Mudá-lo exige confirmar Pronto novamente.'),
        myFleet ? h('div.small', h('span.badge', { class: `f-${myFleet.faction}`, text: FACTIONS[myFleet.faction].short }), ` ${sum.count} ${T.app.ships} · ${num(sum.cost)} ${T.app.points}`) : h('div.small.muted', { text: T.lobby.noFleet }),
        button(myFleet ? T.lobby.editFleet : T.lobby.buildFleet, { test: 'build-fleet', class: 'btn-block', disabled: room.phase !== 'lobby', onClick: () => ctx.go('fleetBuilder', { mode: 'mp', budget: room.budget, fleet: myFleet || state.mpFleet || null, room }) }),
        readyBtn);
    } else {
      add(fleetPanel, h('h3', { text: T.lobby.spectators }), h('div.small.muted', { text: T.lobby.spectating }));
    }

    // start
    const startPanel = h('div.panel.stack');
    if (host) {
      const chk = h('input', { type: 'checkbox', test: 'fill-bots', checked: fillBots, onChange: (e) => { fillBots = e.target.checked; } });
      const startBtn = button(T.lobby.start, { test: 'start', primary: true, class: 'btn-block btn-lg', disabled: room.phase !== 'lobby', onClick: async () => {
        startBtn.disabled = true;
        try { await net.start({ fillBots }); } catch (e) { fail(e); startBtn.disabled = false; }
      } });
      add(startPanel, h('label.check', chk, T.lobby.fillBots), startBtn);
    } else add(startPanel, h('div.small.muted', { text: T.lobby.waitingHost }));

    // spectators
    const specEl = room.spectators && room.spectators.length ? h('div.panel.tight.small', h('span.muted', `${T.lobby.spectators}: `), room.spectators.map((s) => s.name).join(', ')) : null;

    if (!chatPanel) {
      chatLog = h('div.chat-log', { test: 'chat-log', role: 'log', 'aria-live': 'polite' });
      const chatInput = h('input.input.grow', { type: 'text', test: 'chat-input', placeholder: T.lobby.chatPlaceholder, maxlength: 200,
        onKeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChat(); } } });
      let sending = false;
      const sendChat = async () => {
        const draft = chatInput.value, text = draft.trim();
        if (!text || sending) return;
        sending = true;
        try { await net.chat(text); if (chatInput.value === draft) chatInput.value = ''; }
        catch (e) { fail(e); }
        finally { sending = false; }
      };
      chatPanel = h('div.panel.chat', h('h3', { text: T.lobby.chat }), chatLog, h('div.row.gap', chatInput, button(T.lobby.send, { test: 'chat-send', class: 'btn-sm', onClick: sendChat })));
    }
    if (!chatPanel.isConnected) container.appendChild(chatPanel);

    add(roomBody, headEl,
      h('div.lobby-layout',
        h('div.stack', hostPanel, h('div.panel', slotsEl), specEl),
        h('div.stack', fleetPanel, startPanel),
      ));
    renderChat();
  }

  function renderSlot(room, t, i, s, mine, host) {
    const el = h('div.slot', { test: `slot-${t}-${i}`, class: s.kind === 'empty' ? 'empty' : '' });
    const canMove = room.phase === 'lobby' && s.kind === 'empty' && !(mine && mine.team === t && mine.slot === i);
    if (s.kind === 'empty') {
      add(el, h('div.s-body', h('div.s-name', { text: T.lobby.slotEmpty })));
      const ctl = h('div.s-ctl');
      if (canMove) ctl.appendChild(button(T.lobby.slotJoin, { test: `pick-slot-${t}-${i}`, class: 'btn-sm', onClick: () => net.pickSlot(t, i).catch(fail) }));
      if (host && room.phase === 'lobby') {
        const diff = select(DIFFICULTIES.map((d) => ({ value: d, label: difficultyName(d) })), { value: room.botDifficulty, test: `bot-diff-${t}-${i}`, class: 'sel-sm' });
        const fac = select([{ value: '', label: T.lobby.anyFaction }, ...FACTION_IDS.map((f) => ({ value: f, label: FACTIONS[f].short }))], { value: '', test: `bot-faction-${t}-${i}` });
        add(ctl, diff, fac, button(T.lobby.addBot, { test: `add-bot-${t}-${i}`, class: 'btn-sm', onClick: () => net.addBot(t, i, diff.value, fac.value || undefined).catch(fail) }));
      }
      el.appendChild(ctl);
      return el;
    }
    const isMe = s.kind === 'human' && s.playerId === room.you;
    if (isMe) el.classList.add('me');
    const cv = h('canvas', { width: 56, height: 40 });
    if (s.faction && FACTIONS[s.faction]) {
      const mother = shipsOfFaction(s.faction).find((x) => x.sizeClass === 'mothership');
      stops.push(animateShip(cv, mother.id, { team: t, angle: -0.3, pad: 2 }));
    } else { cv.style.opacity = '0.25'; }
    const meta = h('div.s-meta');
    if (s.kind === 'bot') add(meta, h('span', svgIcon('bot', 11), ` ${T.app.bot} · ${difficultyName(s.difficulty)}`), s.faction ? h('span', { class: `f-${s.faction}`, text: FACTIONS[s.faction].short }) : h('span.muted', { text: T.lobby.anyFaction }));
    else {
      add(meta, 
        s.role ? h('span', { text: ROLE_NAMES[s.role] || s.role }) : null,
        s.faction ? h('span', { class: `f-${s.faction}`, text: FACTIONS[s.faction].short }) : null,
        h('span', { class: s.hasFleet ? 'ok' : 'muted', text: s.hasFleet ? T.lobby.fleetReady : T.lobby.fleetMissing }),
        h('span', { class: s.ready ? 's-ready' : 's-wait', text: s.ready ? `● ${T.lobby.ready}` : `○ ${T.lobby.notReady}` }),
        s.connected === false ? h('span.s-off', svgIcon('warn', 11), ` ${T.lobby.disconnected}`) : null,
      );
    }
    const nameEl = h('div.s-name', s.isHost ? h('span.warn', { title: T.lobby.hostMark }, svgIcon('crown', 12)) : null, h('span', { text: s.name || (s.kind === 'bot' ? fmt(T.lobby.botName, { n: i + 1 }) : '?') }), isMe ? h('span.muted.small', { text: `(${T.app.you})` }) : null);
    add(el, cv, h('div.s-body', nameEl, meta));
    if (host && s.kind === 'bot' && room.phase === 'lobby') el.appendChild(h('div.s-ctl', button('✕', { test: `remove-bot-${t}-${i}`, class: 'btn-sm btn-icon btn-danger', title: T.lobby.removeBot, onClick: () => net.removeBot(t, i).catch(fail) })));
    return el;
  }

  function renderChat() {
    if (!chatLog || !chatLog.isConnected) return;
    clear(chatLog);
    for (const m of chatMessages) chatLog.appendChild(h('div.m', h('b', { text: m.name || m.from }), ': ', m.text));
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  /** Players known from the room (names + factions once fleets are set / bots chosen), one column per team. */
  function revealFromRoom(room) {
    if (!room) return null;
    const side = (t) => {
      const el = h('div.side', { class: t === 1 ? 'right' : '' });
      for (const s of room.slots[t]) {
        if (s.kind === 'empty') continue;
        const f = s.faction && FACTIONS[s.faction];
        const cv = h('canvas', { width: 48, height: 34 });
        if (f) { const mother = shipsOfFaction(s.faction).find((x) => x.sizeClass === 'mothership'); stops.push(animateShip(cv, mother.id, { team: t, angle: t === 0 ? -0.2 : Math.PI + 0.2, pad: 3 }, { animate: false })); }
        else cv.style.opacity = '0.25';
        add(el, h('div.pl', h('div.row.gap', { style: t === 1 ? { flexDirection: 'row-reverse' } : null }, cv,
          h('div', h('div.pn', { class: t === 0 ? 'team-a' : 'team-b', text: s.name || (s.kind === 'bot' ? T.app.bot : '?') }),
            h('div.small.muted', { text: f ? f.name : (s.kind === 'bot' ? T.lobby.anyFaction : '') })))));
      }
      return el;
    };
    return h('div.reveal', side(0), h('div.vs', { text: T.battle.vs }), side(1));
  }

  function showCountdown(seconds) {
    hideCountdown();
    let s = Math.max(0, Math.round(seconds));
    const numEl = h('div.countdown-num', { test: 'countdown', text: String(s) });
    countdownEl = h('div.countdown-overlay', numEl, h('div.countdown-text', { text: fmt(T.lobby.countdown, { s }) }), revealFromRoom(net && net.room));
    document.body.appendChild(countdownEl);
    try { ctx.audio.play('ui.countdown'); } catch { /* ignore */ }
    countdownTimer = setInterval(() => {
      s--;
      const textEl = countdownEl.querySelector('.countdown-text');
      if (s <= 0) { countdownEl.querySelector('.countdown-num').textContent = T.lobby.countdownGo; if (textEl) textEl.textContent = ''; clearInterval(countdownTimer); countdownTimer = null; try { ctx.audio.play('ui.go'); } catch { /* ignore */ } return; }
      const n = h('div.countdown-num', { test: 'countdown', text: String(s) });
      countdownEl.querySelector('.countdown-num').replaceWith(n);
      if (textEl) textEl.textContent = fmt(T.lobby.countdown, { s });
      try { ctx.audio.play('ui.countdown'); } catch { /* ignore */ }
    }, 1000);
  }
  function hideCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (countdownEl) { countdownEl.remove(); countdownEl = null; }
  }

  async function leave() {
    if (net && net.room) { try { await net.leaveRoom(); } catch { /* ignore */ } }
    if (!disposed) renderEntry();
  }

  // ---- boot ----
  (async () => {
    if (state.net && state.net.connected) { net = state.net; subscribe(); }
    else if (props.joinCode || state.net) { if (!(await ensureNet())) return; }
    if (disposed) return;
    if (net && net.room) renderRoom(net.room);
    else renderEntry();
  })();

  return {
    unmount() {
      disposed = true;
      hideCountdown();
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      for (const s of stops) s();
    },
  };
}
