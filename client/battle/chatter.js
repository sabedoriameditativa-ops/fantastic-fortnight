// Original faction radio lines. Presentation only: never consumes simulation RNG.
// Speech is optional: only matching-language voices installed on the device.
import { EN_BATTLE_LINES, ES_BATTLE_LINES } from './chatterLanguages.js';

export const CHATTER_LANGUAGES = Object.freeze([
  Object.freeze({ value: 'pt-BR', label: 'Português (Brasil)' }),
  Object.freeze({ value: 'en-US', label: 'English' }),
  Object.freeze({ value: 'es-ES', label: 'Español' }),
]);
export const DEFAULT_CHATTER_SETTINGS = Object.freeze({ frequency: 'normal', subtitles: true, volume: 0.85, speech: false, language: 'pt-BR' });

export function normalizeChatterSettings(raw) {
  const s = { ...DEFAULT_CHATTER_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  if (['off', 'rare', 'normal'].includes(raw.frequency)) s.frequency = raw.frequency;
  if (typeof raw.subtitles === 'boolean') s.subtitles = raw.subtitles;
  if (typeof raw.speech === 'boolean') s.speech = raw.speech;
  if (CHATTER_LANGUAGES.some(option => option.value === raw.language)) s.language = raw.language;
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) s.volume = Math.max(0, Math.min(1, raw.volume));
  return s;
}

export const BATTLE_LINES = Object.freeze({
  terran: {
    start: ['Formação em ordem. Café preso no suporte.', 'Disciplina, escudos e nada de heroísmo sem orçamento.'],
    kill: ['Alvo neutralizado. A papelada fica para depois.', 'Boa mira, frota. Economizamos um míssil. Talvez.'],
    loss: ['Perdemos uma nave. Cubram quem ficou!', 'Quebra na formação. Reorganizem e protejam os aliados.'],
    cast: ['Executando manobra. Esta foi ensaiada, prometo.', 'Sistemas especiais liberados. Segurem as canecas.'],
    sudden: ['Sem reparos daqui para frente. Cada casco conta.', 'Morte súbita. Hora de encerrar o expediente.'],
    victory: ['Vitória da frota. O café agora é por minha conta.', 'Missão cumprida. Contem as naves antes da festa.'],
    defeat: ['Recuar também é uma ordem. Voltaremos preparados.', 'Hoje faltou frota. Amanhã sobra aprendizado.'],
    draw: ['Empate. Ninguém sabe preencher esse formulário.'],
  },
  vorrax: {
    start: ['O enxame sente metal fresco.', 'Muitas asas. Uma fome. Nenhuma reserva de mesa.'],
    kill: ['Crocante por fora. Sucata por dentro.', 'O enxame agradece a refeição.'],
    loss: ['Uma voz silencia. Mil ainda respondem.', 'Protejam a cria! A fome pode esperar.'],
    cast: ['A colmeia canta. O inimigo mastiga o medo.', 'Feromônios no ar. É hora do banquete.'],
    sudden: ['A carne já não se refaz. Mordam com cuidado.', 'A última fome chegou.'],
    victory: ['A colmeia prospera. Reservem espaço para a sobremesa.', 'O enxame venceu. Ninguém come a nave de transporte.'],
    defeat: ['A fome aprende. O enxame retorna.', 'Hoje a presa tinha dentes. Lembraremos.'],
    draw: ['Duas fomes. Nenhuma sobremesa.'],
  },
  lumen: {
    start: ['Afinem os cristais. O vazio espera nossa luz.', 'Somos luz. Ainda assim, respeitem a distância de segurança.'],
    kill: ['Mais um silêncio na partitura do cosmos.', 'O alvo viu a luz. De muito perto.'],
    loss: ['Um brilho se apaga. Guardem sua memória.', 'Protejam o coro. A harmonia está frágil.'],
    cast: ['A fase se abre. Respirem entre os instantes.', 'Ressonância perfeita. Nada disso é decoração.'],
    sudden: ['Até a luz tem limites. Concentrem o brilho.', 'O crepúsculo chegou antes do previsto.'],
    victory: ['O coro permanece. Que a luz encontre o caminho de casa.', 'Vitória luminosa. Poliremos os cristais depois.'],
    defeat: ['A luz se dispersa, mas não desaparece.', 'A próxima canção terá outro arranjo.'],
    draw: ['Duas luzes em equilíbrio. Uma pausa na canção.'],
  },
  ferrix: {
    start: ['Frota sincronizada. Humor habilitado em modo experimental.', 'Probabilidade de sucata: alta. Procedência: em análise.'],
    kill: ['Alvo convertido em inventário.', 'Ameaça removida. Espaço em disco liberado.'],
    loss: ['Unidade perdida. Isso não estava no orçamento.', 'Redundância reduzida. Protejam os núcleos restantes.'],
    cast: ['Executando protocolo. Não desligue o universo.', 'Atualização tática aplicada sem reiniciar.'],
    sudden: ['Regeneração indisponível. Chamado de suporte cancelado.', 'Tempo esgotando. Otimizem a conclusão.'],
    victory: ['Vitória confirmada. Sorriso simulado com sucesso.', 'Resultado satisfatório. A frota será elogiada em binário.'],
    defeat: ['Falha registrada. Aprendizado preservado.', 'Plano revisado. Remover item: perder novamente.'],
    draw: ['Resultado nulo. Ao menos não houve divisão por zero.'],
  },
  astral: {
    start: ['Tracem as órbitas. O destino aceita correções.', 'Curvamos o espaço. As regras da frota continuam valendo.'],
    kill: ['Uma órbita a menos no mapa.', 'O alvo encontrou o centro de gravidade errado.'],
    loss: ['Perdemos um farol. Mantenham a rota.', 'Nem todo futuro pode ser salvo. Protejam este.'],
    cast: ['A geometria acaba de tomar partido.', 'Dobrem o campo. Com cuidado com as bordas.'],
    sudden: ['O horizonte se fecha. Escolham o próximo passo.', 'O tempo também tem gravidade.'],
    victory: ['Chegamos ao futuro planejado.', 'A travessia terminou. Podem soltar os instrumentos.'],
    defeat: ['Recalcularemos a constelação.', 'Esta rota se fecha. Outras permanecem.'],
    draw: ['Duas órbitas, um equilíbrio improvável.'],
  },
});

export const LOCALIZED_BATTLE_LINES = Object.freeze({ 'pt-BR': BATTLE_LINES, 'en-US': EN_BATTLE_LINES, 'es-ES': ES_BATTLE_LINES });

// Web Speech exposes pitch/rate, not a portable audio stream or a custom timbre.
// These are original character directions, never an impersonation of a speaker.
export const FACTION_VOICE_PROFILES = Object.freeze({
  terran: Object.freeze({ rate: 1.02, pitch: 0.94 }),
  vorrax: Object.freeze({ rate: 0.9, pitch: 0.65 }),
  lumen: Object.freeze({ rate: 0.96, pitch: 1.24 }),
  ferrix: Object.freeze({ rate: 0.87, pitch: 0.82 }),
  astral: Object.freeze({ rate: 0.92, pitch: 1.06 }),
});

export function localVoice(language, synth = globalThis.speechSynthesis) {
  const locale = normalizeChatterSettings({ language }).language.toLowerCase();
  const base = locale.split('-')[0];
  try {
    const voices = (synth?.getVoices?.() || []).filter(voice => voice.localService === true
      && String(voice.lang).replaceAll('_', '-').toLowerCase().split('-')[0] === base);
    return voices.find(voice => String(voice.lang).replaceAll('_', '-').toLowerCase() === locale) || voices[0] || null;
  } catch { return null; }
}

export function localPortugueseVoice(synth) { return localVoice('pt-BR', synth); }

/** No voice from another language, network voice, or guessed default is used. */
export function speechStatus(language, synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance) {
  language = normalizeChatterSettings({ language }).language;
  if (typeof Utterance !== 'function' || typeof synth?.speak !== 'function') return { available: false, language, voice: null, reason: 'unsupported' };
  const voice = localVoice(language, synth);
  return { available: !!voice, language, voice, reason: voice ? 'ready' : 'missing-voice' };
}

/** onLine receives {text,faction,event,language,speechAvailable} or null.
 * onSpeakingChange brackets actual speech so the caller can duck other audio.
 * Call updateSettings on mute/option changes even when frames are paused.
 */
export function createBattleChatter(o = {}) {
  const faction = BATTLE_LINES[o.faction] ? o.faction : 'terran';
  const ships = new Map((o.ships || []).map((s) => [s.id, s]));
  const clock = o.now || (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
  const schedule = o.schedule || setTimeout, cancel = o.cancel || clearTimeout;
  const synth = 'speechSynthesis' in o ? o.speechSynthesis : globalThis.speechSynthesis;
  const Utterance = 'Utterance' in o ? o.Utterance : globalThis.SpeechSynthesisUtterance;
  const next = new Map();
  let lastAt = -Infinity, lastText = '', lastTick = -1, timer = null, speechTimer = null;
  let disposed = false, ended = false, started = false, speaking = false, active = null, previousSettings = null, lastStatus = '';

  function setSpeaking(value) {
    if (speaking === value) return;
    speaking = value;
    o.onSpeakingChange?.(value);
  }

  function status(settings) {
    const value = speechStatus(settings.language, synth, Utterance);
    const key = `${value.language}:${value.reason}:${value.voice?.voiceURI || value.voice?.name || ''}`;
    if (key !== lastStatus) { lastStatus = key; o.onStatus?.(value); }
    return value;
  }

  function clear() {
    if (timer !== null) { cancel(timer); timer = null; }
    o.onLine?.(null);
  }
  function stopSpeech() {
    const pending = active;
    active = null;
    if (speechTimer !== null) { cancel(speechTimer); speechTimer = null; }
    if (pending) { try { synth?.cancel(); } catch { /* device service unavailable */ } }
    setSpeaking(false);
  }

  function settings() {
    const all = o.getSettings?.() || {};
    const chatter = normalizeChatterSettings(all.chatter || all);
    const master = Number.isFinite(all.master) ? Math.max(0, Math.min(1, all.master)) : 0.8;
    return { ...chatter, muted: !!all.muted, master };
  }

  function updateSettings() {
    const s = settings();
    if (disposed) return s;
    if (previousSettings && (s.language !== previousSettings.language || s.speech !== previousSettings.speech
      || s.volume !== previousSettings.volume || s.master !== previousSettings.master)) stopSpeech();
    if (s.muted || s.master === 0 || s.volume === 0 || !s.speech || s.frequency === 'off') stopSpeech();
    if (!s.subtitles || s.frequency === 'off' || (previousSettings && s.language !== previousSettings.language)) clear();
    previousSettings = s;
    status(s);
    return s;
  }

  function say(event, final = false) {
    if (disposed) return;
    const s = updateSettings();
    if (s.frequency === 'off') { clear(); stopSpeech(); return; }
    const at = clock();
    const interval = final ? 4000 : s.frequency === 'rare' ? 30000 : 16000;
    if (at - lastAt < interval) return;
    const lines = LOCALIZED_BATTLE_LINES[s.language][faction][event];
    if (!lines?.length) return;
    const key = `${s.language}:${event}`;
    let i = next.get(key) || 0;
    if (lines[i % lines.length] === lastText && lines.length > 1) i++;
    const text = lines[i % lines.length];
    next.set(key, i + 1);
    lastAt = at; lastText = text;
    clear();
    const availability = status(s);
    if (s.subtitles) {
      o.onLine?.({ text, faction, event, language: s.language, speechAvailable: availability.available });
      timer = schedule(() => { timer = null; if (!disposed) o.onLine?.(null); }, 7000);
    }
    stopSpeech();
    if (s.speech && !s.muted && s.master > 0 && s.volume > 0 && availability.available) {
      try {
        const line = new Utterance(text);
        line.voice = availability.voice; line.lang = availability.voice.lang;
        line.volume = s.volume * s.master;
        Object.assign(line, FACTION_VOICE_PROFILES[faction]);
        line.onstart = () => { if (!disposed && active === line) setSpeaking(true); };
        line.onend = line.onerror = () => {
          if (active !== line) return;
          active = null;
          if (speechTimer !== null) { cancel(speechTimer); speechTimer = null; }
          setSpeaking(false);
        };
        active = line;
        // A broken browser speech service must not keep music ducked forever.
        speechTimer = schedule(() => { if (active === line) stopSpeech(); }, 20000);
        synth.speak(line);
      } catch { stopSpeech(); }
    }
  }
  return {
    onFrame(frame) {
      updateSettings();
      if (disposed || ended || !Number.isFinite(frame?.k) || frame.k <= lastTick) return;
      lastTick = frame.k;
      let event = null, priority = 0;
      const pick = (name, p) => { if (p > priority) { event = name; priority = p; } };
      for (const e of frame.e || []) {
        if (e[0] === 'phase' && e[1] === 'suddenDeath') pick('sudden', 4);
        if (e[0] === 'die') {
          if (ships.get(e[1])?.owner === o.myPlayerId) pick('loss', 3);
          else if (ships.get(e[2])?.owner === o.myPlayerId) pick('kill', 2);
        }
        if (e[0] === 'cast' && ships.get(e[1])?.owner === o.myPlayerId) pick('cast', 1);
      }
      if (!started) { started = true; event ||= 'start'; }
      if (event) say(event);
    },
    onEnd(result) {
      if (disposed || ended || !result) return;
      ended = true;
      say(result.winner === -1 ? 'draw' : result.winner === o.myTeam ? 'victory' : 'defeat', true);
    },
    silence() { clear(); stopSpeech(); },
    updateSettings,
    dispose() { if (disposed) return; disposed = true; clear(); stopSpeech(); },
  };
}

/** A user-requested one-line audition; it never changes stored preferences. */
export function createChatterPreview(o = {}) {
  let chatter = null, disposed = false;
  function cancelPreview() { chatter?.dispose(); chatter = null; }
  return {
    play(faction = 'terran') {
      cancelPreview();
      const all = o.getSettings?.() || {};
      const chosen = normalizeChatterSettings(all.chatter || all);
      const availability = speechStatus(chosen.language,
        'speechSynthesis' in o ? o.speechSynthesis : globalThis.speechSynthesis,
        'Utterance' in o ? o.Utterance : globalThis.SpeechSynthesisUtterance);
      if (disposed) return availability;
      chatter = createBattleChatter({ ...o, faction, getSettings: () => {
        const current = o.getSettings?.() || {};
        return { ...current, chatter: { ...normalizeChatterSettings(current.chatter || current), frequency: 'normal', speech: true, subtitles: true } };
      } });
      chatter.onFrame({ k: 0, e: [] });
      return availability;
    },
    cancel: cancelPreview,
    updateSettings() { chatter?.updateSettings(); },
    dispose() { disposed = true; cancelPreview(); },
  };
}
