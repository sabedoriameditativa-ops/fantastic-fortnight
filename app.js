'use strict';

const DURATIONS = [3, 5, 10, 15, 20, 30];

const BREATH_PATTERNS = [
  {
    id: 'caixa',
    name: 'Caixa 4-4-4-4',
    desc: 'Usada por atletas e militares para acalmar e focar. Inspire, segure, expire e segure, 4 segundos cada.',
    phases: [['Inspire', 4, 'in'], ['Segure', 4, 'hold'], ['Expire', 4, 'out'], ['Segure', 4, 'hold']],
  },
  {
    id: '478',
    name: '4-7-8',
    desc: 'Ótima para dormir e reduzir a ansiedade. Inspire por 4, segure por 7, expire por 8.',
    phases: [['Inspire', 4, 'in'], ['Segure', 7, 'hold'], ['Expire', 8, 'out']],
  },
  {
    id: 'coerente',
    name: 'Coerente 5-5',
    desc: 'Equilibra o sistema nervoso. Inspire e expire por 5 segundos, sem pausas.',
    phases: [['Inspire', 5, 'in'], ['Expire', 5, 'out']],
  },
  {
    id: 'relax',
    name: 'Relaxante 4-6',
    desc: 'Expiração mais longa ativa o relaxamento. Inspire por 4, expire por 6.',
    phases: [['Inspire', 4, 'in'], ['Expire', 6, 'out']],
  },
];

const SOUNDS = [
  { id: 'chuva', emoji: '🌧️', name: 'Chuva' },
  { id: 'oceano', emoji: '🌊', name: 'Oceano' },
  { id: 'vento', emoji: '🍃', name: 'Vento' },
  { id: 'riacho', emoji: '💧', name: 'Riacho' },
  { id: 'tigela', emoji: '🔔', name: 'Tigela tibetana' },
  { id: 'marrom', emoji: '🌙', name: 'Ruído marrom' },
];

const $ = (sel) => document.querySelector(sel);

/* =========================================================
 * Áudio (tudo gerado com Web Audio, sem arquivos)
 * ========================================================= */
const Sound = (() => {
  let ctx = null;
  const buffers = {};

  function context() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noiseBuffer(type) {
    if (buffers[type]) return buffers[type];
    const c = context();
    const len = c.sampleRate * 6;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else if (type === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else {
        data[i] = white;
      }
    }
    buffers[type] = buf;
    return buf;
  }

  function noiseSource(type) {
    const src = context().createBufferSource();
    src.buffer = noiseBuffer(type);
    src.loop = true;
    return src;
  }

  function lfo(freq, depth, target) {
    const c = context();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.frequency.value = freq;
    g.gain.value = depth;
    osc.connect(g).connect(target);
    osc.start();
    return osc;
  }

  // Som de tigela/sino: parciais inarmônicos com decaimento exponencial
  function bell(volume = 0.5, when = 0, dest = null) {
    const c = context();
    const t = c.currentTime + when;
    const base = 220;
    const partials = [[1, 1, 7], [2.76, 0.5, 5], [5.4, 0.25, 3], [8.93, 0.12, 2]];
    const out = c.createGain();
    out.gain.value = volume;
    out.connect(dest || c.destination);
    partials.forEach(([ratio, amp, decay]) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = base * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + decay + 0.1);
    });
  }

  function chime() {
    const c = context();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.frequency.value = 528;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 1.3);
  }

  /** Cria um som ambiente. Retorna { setVolume, stop }. */
  function ambient(id, volume = 0.6) {
    const c = context();
    const master = c.createGain();
    master.gain.setValueAtTime(0.0001, c.currentTime);
    master.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), c.currentTime + 2);
    master.connect(c.destination);
    const nodes = [];
    let timer = null;

    if (id === 'chuva') {
      const src = noiseSource('pink');
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      const g = c.createGain(); g.gain.value = 0.9;
      src.connect(hp).connect(lp).connect(g).connect(master);
      src.start();
      nodes.push(src);
    } else if (id === 'oceano') {
      const src = noiseSource('brown');
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = c.createGain(); g.gain.value = 0.5;
      src.connect(lp).connect(g).connect(master);
      src.start();
      nodes.push(src, lfo(0.09, 0.42, g.gain), lfo(0.09, 500, lp.frequency));
    } else if (id === 'vento') {
      const src = noiseSource('pink');
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 1.2;
      const g = c.createGain(); g.gain.value = 1.4;
      src.connect(bp).connect(g).connect(master);
      src.start();
      nodes.push(src, lfo(0.06, 300, bp.frequency), lfo(0.11, 0.6, g.gain));
    } else if (id === 'riacho') {
      const src = noiseSource('white');
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.8;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      const g = c.createGain(); g.gain.value = 0.18;
      src.connect(bp).connect(lp).connect(g).connect(master);
      src.start();
      nodes.push(src, lfo(0.7, 0.05, g.gain), lfo(0.23, 600, bp.frequency));
    } else if (id === 'tigela') {
      [110, 165.5, 220].forEach((f, i) => {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.frequency.value = f;
        g.gain.value = [0.06, 0.025, 0.02][i];
        osc.connect(g).connect(master);
        osc.start();
        nodes.push(osc, lfo(0.1 + i * 0.07, g.gain.value * 0.6, g.gain));
      });
      bell(0.6, 0.2, master);
      timer = setInterval(() => bell(0.5, 0, master), 14000);
    } else if (id === 'marrom') {
      const src = noiseSource('brown');
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const g = c.createGain(); g.gain.value = 0.8;
      src.connect(lp).connect(g).connect(master);
      src.start();
      nodes.push(src);
    }

    return {
      setVolume(v) {
        master.gain.setTargetAtTime(Math.max(v, 0.0001), c.currentTime, 0.1);
      },
      stop() {
        clearInterval(timer);
        const t = c.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        setTimeout(() => {
          nodes.forEach((n) => { try { n.stop(); } catch (e) { /* já parado */ } });
          master.disconnect();
        }, 1600);
      },
    };
  }

  return { context, bell, chime, ambient };
})();

/* =========================================================
 * Voz (narração das meditações guiadas)
 * ========================================================= */
const Voice = (() => {
  const synth = window.speechSynthesis;
  let voice = null;

  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    voice = voices.find((v) => v.lang === 'pt-BR') || voices.find((v) => v.lang.startsWith('pt')) || null;
  }
  if (synth) {
    pickVoice();
    synth.onvoiceschanged = pickVoice;
  }

  return {
    available: !!synth,
    speak(text) {
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      if (voice) u.voice = voice;
      u.rate = 0.85;
      u.pitch = 0.95;
      synth.speak(u);
    },
    stop() { if (synth) synth.cancel(); },
  };
})();

/* =========================================================
 * Armazenamento do histórico
 * ========================================================= */
const Store = {
  key: 'sm.sessions.v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch (e) { return []; }
  },
  save(list) {
    try { localStorage.setItem(this.key, JSON.stringify(list)); } catch (e) { /* armazenamento indisponível */ }
  },
  add(entry) {
    const list = this.load();
    list.push(entry);
    this.save(list);
  },
  clear() { this.save([]); },
};

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/* =========================================================
 * Navegação por abas
 * ========================================================= */
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'progresso') renderProgress();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* =========================================================
 * Premium
 * O código digitado é convertido em hash SHA-256 e comparado com
 * CONFIG.premium.codeHashes. Se você remover um hash do config.js,
 * quem usou aquele código perde o acesso na próxima abertura do app.
 * ========================================================= */
const Premium = {
  key: 'sm.premium.v1',
  isActive() {
    try {
      const saved = localStorage.getItem(this.key);
      return !!saved && CONFIG.premium.codeHashes.includes(saved);
    } catch (e) { return false; }
  },
  async redeem(code) {
    const normalized = code.trim().toUpperCase();
    if (!normalized || !window.crypto || !crypto.subtle) return false;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    if (!CONFIG.premium.codeHashes.includes(hex)) return false;
    try { localStorage.setItem(this.key, hex); } catch (e) { /* armazenamento indisponível */ }
    return true;
  },
  deactivate() {
    try { localStorage.removeItem(this.key); } catch (e) { /* armazenamento indisponível */ }
  },
};

function isLocked(meditation) {
  return !!meditation.premium && !Premium.isActive();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ---------- Janela inferior ---------- */
function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheetBody').innerHTML = '';
}
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

function supportHtml() {
  const contact = CONFIG.premium.support;
  if (!contact) return '';
  const href = contact.includes('@') && !contact.startsWith('http') ? `mailto:${contact}` : contact;
  return `<p class="small muted center">Dúvidas? <a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="color:var(--accent)">Fale conosco</a></p>`;
}

function openPaywall(reason) {
  if (Premium.isActive()) { openPremiumStatus(); return; }
  const { price, checkoutUrl } = CONFIG.premium;
  const premiumCount = GUIDED.filter((g) => g.premium).length;
  openSheet(`
    <h2>✨ Seja Premium</h2>
    <p class="muted">${escapeHtml(reason || 'Aprofunde sua prática com todo o conteúdo do app.')}</p>
    <div class="price">${escapeHtml(price)}</div>
    <ul class="benefits">
      <li>🧘 Mais ${premiumCount} meditações guiadas (${GUIDED.length} no total)</li>
      <li>🗓️ Jornada completa: ${escapeHtml(PROGRAM.title)}</li>
      <li>📴 Tudo funciona sem internet</li>
      <li>💜 Você apoia a criação de novos conteúdos</li>
    </ul>
    <button id="buyBtn" class="btn primary wide" ${checkoutUrl ? '' : 'disabled'}>Assinar agora</button>
    ${checkoutUrl ? '' : '<p class="msg muted center">Pagamento ainda não configurado (veja config.js).</p>'}
    <hr class="divider">
    <label class="field-label" for="codeInput">Já assinou? Digite seu código de acesso</label>
    <div class="code-row">
      <input id="codeInput" placeholder="PAZ-XXXX-XXXX" autocomplete="off" autocapitalize="characters">
      <button id="redeemBtn" class="btn">Liberar</button>
    </div>
    <p id="codeMsg" class="msg" aria-live="polite"></p>
    ${supportHtml()}`);

  if (checkoutUrl) $('#buyBtn').addEventListener('click', () => window.open(checkoutUrl, '_blank', 'noopener'));
  const redeem = async () => {
    const msg = $('#codeMsg');
    if (await Premium.redeem($('#codeInput').value)) {
      msg.className = 'msg ok';
      msg.textContent = 'Acesso premium liberado! Aproveite. 💜';
      refreshPremiumUI();
      setTimeout(closeSheet, 1400);
    } else {
      msg.className = 'msg err';
      msg.textContent = 'Código inválido. Confira e tente de novo.';
    }
  };
  $('#redeemBtn').addEventListener('click', redeem);
  $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(); });
}

function openPremiumStatus() {
  openSheet(`
    <h2>✨ Você é Premium</h2>
    <p class="muted">Todo o conteúdo está liberado neste aparelho. Obrigado pelo apoio! 💜</p>
    ${supportHtml()}
    <button id="logoutPremium" class="btn ghost small-btn">Remover acesso deste aparelho</button>`);
  $('#logoutPremium').addEventListener('click', () => {
    if (!confirm('Remover o acesso premium deste aparelho? Você precisará digitar o código de novo.')) return;
    Premium.deactivate();
    refreshPremiumUI();
    closeSheet();
  });
}

function refreshPremiumUI() {
  $('#premiumBtn').classList.toggle('active', Premium.isActive());
  $('#premiumBtn').textContent = Premium.isActive() ? '✨ Premium ✓' : '✨ Premium';
  renderGuidedList();
  renderProgram();
}

$('#premiumBtn').addEventListener('click', () => openPaywall());

/* =========================================================
 * Jornada (programa de vários dias)
 * ========================================================= */
const ProgramStore = {
  key: `sm.program.${PROGRAM.id}`,
  done() {
    try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch (e) { return []; }
  },
  markDone(index) {
    const list = this.done();
    if (list.includes(index)) return;
    list.push(index);
    try { localStorage.setItem(this.key, JSON.stringify(list)); } catch (e) { /* armazenamento indisponível */ }
  },
};

function dayLocked(index) {
  return index > 0 && !Premium.isActive();
}

function renderProgram() {
  const done = ProgramStore.done();
  const next = PROGRAM.days.findIndex((_, i) => !done.includes(i));
  $('#programTitle').textContent = PROGRAM.title;
  $('#programProgress').textContent = next === -1 ? 'Concluída 🎉' : `${done.length}/${PROGRAM.days.length}`;
  $('#programDays').innerHTML = PROGRAM.days.map((d, i) => `
    <button class="day-btn${done.includes(i) ? ' done' : ''}${i === next ? ' next' : ''}" data-day="${i}"
      aria-label="Dia ${i + 1}: ${escapeHtml(d.title)}${dayLocked(i) ? ' (premium)' : ''}">
      ${done.includes(i) ? '✓' : i + 1}${dayLocked(i) ? '<span class="lock">🔒</span>' : ''}
    </button>`).join('');
}

$('#programDays').addEventListener('click', (e) => {
  const btn = e.target.closest('.day-btn');
  if (!btn) return;
  const index = Number(btn.dataset.day);
  if (dayLocked(index)) {
    openPaywall(`O dia 1 é grátis. Assine para continuar a jornada "${PROGRAM.title}".`);
    return;
  }
  const day = PROGRAM.days[index];
  const g = GUIDED.find((x) => x.id === day.meditation);
  openSheet(`
    <small class="muted">Dia ${index + 1} de ${PROGRAM.days.length}</small>
    <h2>${escapeHtml(day.title)}</h2>
    <p>${escapeHtml(day.intro)}</p>
    <p class="muted small">Prática de hoje: ${g.emoji} ${escapeHtml(g.title)} · ${g.minutes} min</p>
    <button id="startDay" class="btn primary wide">Começar</button>`);
  $('#startDay').addEventListener('click', () => {
    closeSheet();
    startSession({ ...meditationOptions(g), title: `Dia ${index + 1} · ${day.title}`, programDay: index });
  });
});

/* =========================================================
 * Meditar
 * ========================================================= */
let freeMinutes = 10;
let session = null;
let wakeLock = null;
const RING_LEN = 2 * Math.PI * 90;

function meditationOptions(g) {
  return { title: g.title, minutes: g.minutes, steps: g.steps, ambient: g.ambient, audio: g.audio, intervalBell: false };
}

function renderGuidedList() {
  $('#guidedList').innerHTML = GUIDED.map((g) => `
    <button class="card${isLocked(g) ? ' locked' : ''}" data-id="${g.id}">
      ${isLocked(g) ? '<span class="lock" aria-label="Premium">🔒</span>' : ''}
      <span class="emoji">${g.emoji}</span>
      <b>${g.title}</b>
      <small>${g.minutes} min${g.premium ? '<span class="badge">Premium</span>' : ''}</small>
    </button>`).join('');
}

function renderMeditar() {
  renderGuidedList();
  $('#guidedList').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const g = GUIDED.find((x) => x.id === card.dataset.id);
    if (isLocked(g)) {
      openPaywall(`"${g.title}" faz parte do conteúdo Premium.`);
      return;
    }
    startSession(meditationOptions(g));
  });

  $('#durationChips').innerHTML = DURATIONS.map((m) =>
    `<button class="chip${m === freeMinutes ? ' active' : ''}" data-min="${m}">${m} min</button>`).join('');
  $('#durationChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    freeMinutes = Number(chip.dataset.min);
    $('#durationChips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
  });

  $('#ambientSelect').innerHTML = '<option value="none">Silêncio</option>' +
    SOUNDS.map((s) => `<option value="${s.id}">${s.emoji} ${s.name}</option>`).join('');

  $('#startFree').addEventListener('click', () => {
    startSession({
      title: 'Meditação livre',
      minutes: freeMinutes,
      steps: [],
      ambient: $('#ambientSelect').value,
      intervalBell: $('#intervalBell').checked,
    });
  });

  $('#pauseBtn').addEventListener('click', togglePause);
  $('#stopBtn').addEventListener('click', () => finishSession(false));
  $('#doneBtn').addEventListener('click', () => {
    $('#done').hidden = true;
    $('#meditarSetup').hidden = false;
    renderProgram();
  });
  $('#voiceToggle').addEventListener('change', (e) => { if (!e.target.checked) Voice.stop(); });
  if (!Voice.available) $('#voiceToggleWrap').hidden = true;
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* sem suporte ou negado */ }
}

function startSession({ title, minutes, steps, ambient, audio, intervalBell, programDay = null }) {
  Sound.context();
  stopSoundsTab();
  const total = minutes * 60;
  session = {
    title,
    total,
    remaining: total,
    endAt: Date.now() + total * 1000,
    paused: false,
    steps,
    stepIdx: 0,
    intervalBell,
    lastMinute: 0,
    programDay,
    narration: null,
    ambient: ambient && ambient !== 'none' ? Sound.ambient(ambient, 0.35) : null,
    timer: null,
  };
  $('#meditarSetup').hidden = true;
  $('#done').hidden = true;
  $('#session').hidden = false;
  $('#sessionTitle').textContent = `${title} · ${minutes} min`;
  $('#guideText').textContent = steps.length ? '' : 'Respire naturalmente e observe o momento presente.';
  $('#voiceToggleWrap').style.display = steps.length && Voice.available && !audio ? '' : 'none';
  if (audio) startNarration(audio);
  $('#pauseBtn').textContent = 'Pausar';
  $('#ringFg').style.strokeDasharray = RING_LEN;
  $('#ringFg').style.strokeDashoffset = 0;
  Sound.bell(0.5);
  requestWakeLock();
  session.timer = setInterval(tick, 250);
  tick();
}

function tick() {
  if (!session || session.paused) return;
  session.remaining = (session.endAt - Date.now()) / 1000;
  const elapsed = session.total - session.remaining;

  $('#timeLeft').textContent = fmtTime(session.remaining);
  $('#ringFg').style.strokeDashoffset = RING_LEN * Math.min(1, elapsed / session.total);

  while (session.stepIdx < session.steps.length && session.steps[session.stepIdx][0] <= elapsed) {
    const text = session.steps[session.stepIdx][1];
    $('#guideText').textContent = text;
    if (!session.narration && $('#voiceToggle').checked) Voice.speak(text);
    session.stepIdx++;
  }

  const minute = Math.floor(elapsed / 60);
  if (session.intervalBell && minute > session.lastMinute && session.remaining > 5) {
    session.lastMinute = minute;
    Sound.bell(0.25);
  }

  if (session.remaining <= 0) finishSession(true);
}

/* Áudio gravado (sua voz). Se o arquivo não carregar, volta para a voz sintética. */
function startNarration(src) {
  const el = new window.Audio(src);
  session.narration = el;
  const current = session;
  const fallback = () => {
    if (session !== current || session.narration !== el) return;
    session.narration = null;
    $('#voiceToggleWrap').style.display = Voice.available ? '' : 'none';
  };
  el.addEventListener('error', fallback);
  el.play().catch(fallback);
}

function togglePause() {
  if (!session) return;
  session.paused = !session.paused;
  if (session.paused) {
    session.remaining = (session.endAt - Date.now()) / 1000;
    if (session.ambient) session.ambient.setVolume(0.0001);
    Voice.stop();
    if (session.narration) session.narration.pause();
    $('#pauseBtn').textContent = 'Continuar';
  } else {
    session.endAt = Date.now() + session.remaining * 1000;
    if (session.ambient) session.ambient.setVolume(0.35);
    if (session.narration) session.narration.play().catch(() => {});
    $('#pauseBtn').textContent = 'Pausar';
  }
}

function finishSession(completed) {
  if (!session) return;
  clearInterval(session.timer);
  if (session.ambient) session.ambient.stop();
  if (session.narration) session.narration.pause();
  Voice.stop();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }

  const elapsedSec = Math.min(session.total, session.total - Math.max(0, session.remaining));
  const minutes = Math.round((elapsedSec / 60) * 10) / 10;
  const counted = elapsedSec >= 60;
  if (counted) Store.add({ date: new Date().toISOString(), minutes, title: session.title });

  if (completed) {
    Sound.bell(0.6);
    Sound.bell(0.5, 2.5);
    Sound.bell(0.4, 5);
  }

  $('#session').hidden = true;
  $('#done').hidden = false;
  let text = counted
    ? `${completed ? 'Parabéns!' : 'Bom trabalho.'} Você meditou ${minutes.toLocaleString('pt-BR')} min. Sequência atual: ${currentStreak()} dia(s).`
    : 'Sessões com menos de 1 minuto não entram no histórico.';
  // Dia da jornada conta como feito se a pessoa praticou pelo menos 80% do tempo
  if (session.programDay !== null && elapsedSec >= session.total * 0.8) {
    ProgramStore.markDone(session.programDay);
    text += ` Dia ${session.programDay + 1} da jornada concluído!`;
  }
  $('#doneText').textContent = text;
  session = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && session && !wakeLock) requestWakeLock();
});

/* =========================================================
 * Respirar
 * ========================================================= */
let breathPattern = BREATH_PATTERNS[0];
let breath = null;

function renderBreath() {
  $('#breathChips').innerHTML = BREATH_PATTERNS.map((p, i) =>
    `<button class="chip${i === 0 ? ' active' : ''}" data-id="${p.id}">${p.name}</button>`).join('');
  $('#breathDesc').textContent = breathPattern.desc;
  $('#breathChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    stopBreath();
    breathPattern = BREATH_PATTERNS.find((p) => p.id === chip.dataset.id);
    $('#breathDesc').textContent = breathPattern.desc;
    $('#breathChips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
  });
  $('#breathBtn').addEventListener('click', () => (breath ? stopBreath() : startBreath()));
}

function startBreath() {
  Sound.context();
  breath = { phase: -1, left: 0, cycles: 0, timer: null };
  $('#breathBtn').textContent = 'Parar';
  $('#breathCycles').textContent = 'Ciclos: 0';
  nextPhase();
  breath.timer = setInterval(() => {
    breath.left--;
    if (breath.left <= 0) nextPhase();
    else $('#breathCount').textContent = breath.left;
  }, 1000);
}

function nextPhase() {
  const phases = breathPattern.phases;
  breath.phase = (breath.phase + 1) % phases.length;
  if (breath.phase === 0 && breath.started) {
    breath.cycles++;
    $('#breathCycles').textContent = `Ciclos: ${breath.cycles}`;
  }
  breath.started = true;
  const [label, secs, kind] = phases[breath.phase];
  breath.left = secs;
  $('#breathLabel').textContent = label;
  $('#breathCount').textContent = secs;
  const circle = $('#breathCircle');
  circle.style.transitionDuration = `${secs}s`;
  if (kind === 'in') circle.style.transform = 'scale(1.9)';
  if (kind === 'out') circle.style.transform = 'scale(1)';
  Sound.chime();
}

function stopBreath() {
  if (!breath) return;
  clearInterval(breath.timer);
  breath = null;
  const circle = $('#breathCircle');
  circle.style.transitionDuration = '1s';
  circle.style.transform = 'scale(1)';
  $('#breathLabel').textContent = 'Pronto?';
  $('#breathCount').textContent = '';
  $('#breathBtn').textContent = 'Começar';
}

/* =========================================================
 * Sons
 * ========================================================= */
let playing = null; // { id, handle }
let sleepMinutes = 0;
let sleepTimer = null;
const SLEEP_OPTIONS = [0, 15, 30, 60];

function renderSounds() {
  $('#soundGrid').innerHTML = SOUNDS.map((s) =>
    `<button class="sound" data-id="${s.id}"><span>${s.emoji}</span>${s.name}</button>`).join('');
  $('#soundGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.sound');
    if (!btn) return;
    const id = btn.dataset.id;
    const wasPlaying = playing && playing.id === id;
    stopSoundsTab();
    if (!wasPlaying) {
      playing = { id, handle: Sound.ambient(id, Number($('#volume').value)) };
      btn.classList.add('playing');
      armSleepTimer();
    }
  });
  $('#volume').addEventListener('input', (e) => {
    if (playing) playing.handle.setVolume(Number(e.target.value));
  });

  $('#sleepChips').innerHTML = SLEEP_OPTIONS.map((m) =>
    `<button class="chip${m === sleepMinutes ? ' active' : ''}" data-min="${m}">${m ? `${m} min` : 'Nunca'}</button>`).join('');
  $('#sleepChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    sleepMinutes = Number(chip.dataset.min);
    $('#sleepChips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    if (playing) armSleepTimer();
  });
}

function armSleepTimer() {
  clearTimeout(sleepTimer);
  if (sleepMinutes) sleepTimer = setTimeout(stopSoundsTab, sleepMinutes * 60000);
}

function stopSoundsTab() {
  clearTimeout(sleepTimer);
  if (playing) playing.handle.stop();
  playing = null;
  document.querySelectorAll('.sound.playing').forEach((b) => b.classList.remove('playing'));
}

/* =========================================================
 * Progresso
 * ========================================================= */
function streaks() {
  const days = new Set(Store.load().map((s) => dayKey(s.date)));
  // sequência atual: conta a partir de hoje (ou de ontem, se ainda não meditou hoje)
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let current = 0;
  while (days.has(dayKey(d))) { current++; d.setDate(d.getDate() - 1); }

  const sorted = [...days].sort();
  let best = 0, run = 0, prev = null;
  sorted.forEach((k) => {
    const date = new Date(`${k}T12:00:00`);
    run = prev && (date - prev) / 86400000 < 1.5 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  });
  return { current, best };
}

function currentStreak() { return streaks().current; }

function renderProgress() {
  const list = Store.load();
  const { current, best } = streaks();
  const totalMin = list.reduce((a, s) => a + s.minutes, 0);
  $('#statStreak').textContent = current;
  $('#statBest').textContent = best;
  $('#statSessions').textContent = list.length;
  $('#statMinutes').textContent = Math.round(totalMin);

  const perDay = {};
  list.forEach((s) => { const k = dayKey(s.date); perDay[k] = (perDay[k] || 0) + s.minutes; });
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''), min: perDay[dayKey(d)] || 0 });
  }
  const max = Math.max(10, ...days.map((d) => d.min));
  $('#weekChart').innerHTML = days.map((d) => `
    <div class="day" title="${Math.round(d.min)} min">
      <span class="val">${d.min ? Math.round(d.min) : ''}</span>
      <div class="bar${d.min ? '' : ' empty'}" style="height:${Math.max(4, (d.min / max) * 100)}%"></div>
      <small>${d.label}</small>
    </div>`).join('');

  $('#history').innerHTML = list.length
    ? list.slice().reverse().slice(0, 30).map((s) => `
      <li><span>${s.title}</span><span>${new Date(s.date).toLocaleDateString('pt-BR')} · ${s.minutes.toLocaleString('pt-BR')} min</span></li>`).join('')
    : '<li class="muted">Nenhuma sessão ainda. Que tal começar agora?</li>';
}

$('#clearHistory').addEventListener('click', () => {
  if (confirm('Apagar todo o histórico de meditações?')) {
    Store.clear();
    renderProgress();
  }
});

/* =========================================================
 * Instalação (PWA)
 * ========================================================= */
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('#installBtn').hidden = true;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

function applyAppName() {
  const words = CONFIG.appName.trim().split(/\s+/);
  const last = words.pop();
  $('#appName').innerHTML = words.length ? `${escapeHtml(words.join(' '))} <span>${escapeHtml(last)}</span>` : `<span>${escapeHtml(last)}</span>`;
  document.title = CONFIG.appName;
}

applyAppName();
renderMeditar();
refreshPremiumUI();
renderBreath();
renderSounds();
