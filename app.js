'use strict';

/* =========================================================
 * Conteúdo: meditações guiadas
 * Cada passo: [segundo em que aparece, texto]
 * ========================================================= */
const GUIDED = [
  {
    id: 'respiracao',
    emoji: '🌿',
    title: 'Respiração consciente',
    minutes: 5,
    ambient: 'riacho',
    steps: [
      [0, 'Sente-se confortavelmente e feche os olhos com suavidade.'],
      [15, 'Leve a atenção para a respiração. Não tente mudá-la, apenas observe.'],
      [45, 'Perceba o ar entrando pelas narinas... e saindo.'],
      [90, 'Se a mente se distrair, tudo bem. Gentilmente, volte para a respiração.'],
      [150, 'Sinta o abdômen subir na inspiração e descer na expiração.'],
      [210, 'Cada respiração é um novo começo. Permaneça aqui, presente.'],
      [270, 'Comece a perceber os sons ao redor e o corpo apoiado.'],
      [290, 'Quando estiver pronto, abra os olhos devagar.'],
    ],
  },
  {
    id: 'corpo',
    emoji: '🌊',
    title: 'Escaneamento corporal',
    minutes: 10,
    ambient: 'oceano',
    steps: [
      [0, 'Deite-se ou sente-se de forma confortável. Feche os olhos.'],
      [20, 'Respire fundo três vezes, soltando o ar devagar.'],
      [50, 'Leve a atenção aos pés. Note qualquer sensação: calor, frio, formigamento.'],
      [110, 'Suba para as pernas e joelhos. Deixe que relaxem.'],
      [170, 'Agora o quadril e a região lombar. Solte qualquer tensão.'],
      [230, 'Perceba o abdômen e o peito se movendo com a respiração.'],
      [290, 'Leve a atenção para as mãos, os braços e os ombros. Deixe os ombros caírem.'],
      [360, 'Relaxe o pescoço, a mandíbula, a testa e os olhos.'],
      [430, 'Sinta o corpo inteiro, como um todo, respirando.'],
      [520, 'Descanse nessa sensação de calma.'],
      [575, 'Mexa suavemente os dedos e, quando quiser, abra os olhos.'],
    ],
  },
  {
    id: 'gratidao',
    emoji: '🌻',
    title: 'Gratidão',
    minutes: 5,
    ambient: 'tigela',
    steps: [
      [0, 'Feche os olhos e faça uma respiração profunda.'],
      [20, 'Pense em algo simples pelo qual você é grato hoje.'],
      [70, 'Sinta essa gratidão no peito, como um calor suave.'],
      [120, 'Agora pense em uma pessoa que faz bem para você.'],
      [170, 'Envie mentalmente um agradecimento a ela.'],
      [220, 'Agradeça também a si mesmo, por reservar este momento.'],
      [280, 'Respire fundo e abra os olhos, levando essa sensação para o seu dia.'],
    ],
  },
  {
    id: 'ansiedade',
    emoji: '🍃',
    title: 'Alívio da ansiedade',
    minutes: 7,
    ambient: 'chuva',
    steps: [
      [0, 'Encontre uma posição confortável. Você está seguro aqui.'],
      [15, 'Inspire contando até quatro... e expire contando até seis.'],
      [60, 'Continue nesse ritmo. Expirar mais longo acalma o corpo.'],
      [110, 'Perceba cinco coisas que você sente: os pés no chão, as mãos, a roupa na pele...'],
      [180, 'Os pensamentos são como nuvens. Deixe-os passar, sem se prender.'],
      [250, 'Diga a si mesmo, em silêncio: “Eu estou aqui. Eu estou bem.”'],
      [320, 'Continue respirando devagar, sentindo o corpo mais leve.'],
      [400, 'Quando estiver pronto, volte devagar e abra os olhos.'],
    ],
  },
  {
    id: 'dormir',
    emoji: '🌙',
    title: 'Para dormir',
    minutes: 10,
    ambient: 'marrom',
    steps: [
      [0, 'Deite-se e deixe o corpo pesar sobre a cama.'],
      [20, 'Solte o ar devagar, como um longo suspiro.'],
      [60, 'Imagine cada parte do corpo ficando pesada e quente.'],
      [140, 'Os pés... as pernas... o quadril... tudo afundando no colchão.'],
      [220, 'Os braços pesados... os ombros soltos... o rosto relaxado.'],
      [320, 'Não há nada para fazer agora. Só descansar.'],
      [420, 'Deixe a respiração ficar lenta e natural.'],
      [500, 'Você pode adormecer quando quiser...'],
    ],
  },
  {
    id: 'foco',
    emoji: '🎯',
    title: 'Foco e clareza',
    minutes: 3,
    ambient: 'none',
    steps: [
      [0, 'Sente-se com a coluna ereta e os olhos fechados.'],
      [10, 'Faça três respirações profundas.'],
      [40, 'Escolha um ponto de atenção: a sensação do ar nas narinas.'],
      [90, 'Cada vez que a mente sair, volte. Isso é treinar o foco.'],
      [150, 'Defina uma intenção clara para a próxima hora.'],
      [170, 'Abra os olhos, pronto para começar.'],
    ],
  },
];

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
 * Meditar
 * ========================================================= */
let freeMinutes = 10;
let session = null;
let wakeLock = null;
const RING_LEN = 2 * Math.PI * 90;

function renderMeditar() {
  $('#guidedList').innerHTML = GUIDED.map((g) => `
    <button class="card" data-id="${g.id}">
      <span class="emoji">${g.emoji}</span>
      <b>${g.title}</b>
      <small>${g.minutes} min</small>
    </button>`).join('');
  $('#guidedList').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const g = GUIDED.find((x) => x.id === card.dataset.id);
    startSession({ title: g.title, minutes: g.minutes, steps: g.steps, ambient: g.ambient, intervalBell: false });
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
  });
  $('#voiceToggle').addEventListener('change', (e) => { if (!e.target.checked) Voice.stop(); });
  if (!Voice.available) $('#voiceToggleWrap').hidden = true;
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* sem suporte ou negado */ }
}

function startSession({ title, minutes, steps, ambient, intervalBell }) {
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
    ambient: ambient && ambient !== 'none' ? Sound.ambient(ambient, 0.35) : null,
    timer: null,
  };
  $('#meditarSetup').hidden = true;
  $('#done').hidden = true;
  $('#session').hidden = false;
  $('#sessionTitle').textContent = `${title} · ${minutes} min`;
  $('#guideText').textContent = steps.length ? '' : 'Respire naturalmente e observe o momento presente.';
  $('#voiceToggleWrap').style.display = steps.length && Voice.available ? '' : 'none';
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
    if ($('#voiceToggle').checked) Voice.speak(text);
    session.stepIdx++;
  }

  const minute = Math.floor(elapsed / 60);
  if (session.intervalBell && minute > session.lastMinute && session.remaining > 5) {
    session.lastMinute = minute;
    Sound.bell(0.25);
  }

  if (session.remaining <= 0) finishSession(true);
}

function togglePause() {
  if (!session) return;
  session.paused = !session.paused;
  if (session.paused) {
    session.remaining = (session.endAt - Date.now()) / 1000;
    if (session.ambient) session.ambient.setVolume(0.0001);
    Voice.stop();
    $('#pauseBtn').textContent = 'Continuar';
  } else {
    session.endAt = Date.now() + session.remaining * 1000;
    if (session.ambient) session.ambient.setVolume(0.35);
    $('#pauseBtn').textContent = 'Pausar';
  }
}

function finishSession(completed) {
  if (!session) return;
  clearInterval(session.timer);
  if (session.ambient) session.ambient.stop();
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
  $('#doneText').textContent = counted
    ? `${completed ? 'Parabéns!' : 'Bom trabalho.'} Você meditou ${minutes.toLocaleString('pt-BR')} min. Sequência atual: ${currentStreak()} dia(s).`
    : 'Sessões com menos de 1 minuto não entram no histórico.';
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

renderMeditar();
renderBreath();
renderSounds();
