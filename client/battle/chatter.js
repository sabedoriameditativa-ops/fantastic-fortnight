// Original faction radio lines. Presentation only: never consumes simulation RNG.
// Speech is optional and restricted to Portuguese voices installed on the device.
export const DEFAULT_CHATTER_SETTINGS = Object.freeze({ frequency: 'normal', subtitles: true, volume: 0.5, speech: false });

export function normalizeChatterSettings(raw) {
  const s = { ...DEFAULT_CHATTER_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  if (['off', 'rare', 'normal'].includes(raw.frequency)) s.frequency = raw.frequency;
  if (typeof raw.subtitles === 'boolean') s.subtitles = raw.subtitles;
  if (typeof raw.speech === 'boolean') s.speech = raw.speech;
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

export function localPortugueseVoice(synth) {
  try { return (synth?.getVoices?.() || []).find((v) => v.localService === true && /^pt(?:-|$)/i.test(v.lang)) || null; }
  catch { return null; }
}

/** onLine receives {text,faction,event} or null to clear the subtitle. */
export function createBattleChatter(o = {}) {
  const faction = BATTLE_LINES[o.faction] ? o.faction : 'terran';
  const ships = new Map((o.ships || []).map((s) => [s.id, s]));
  const clock = o.now || (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
  const schedule = o.schedule || setTimeout, cancel = o.cancel || clearTimeout;
  const synth = o.speechSynthesis ?? globalThis.speechSynthesis;
  const Utterance = o.Utterance ?? globalThis.SpeechSynthesisUtterance;
  const next = new Map();
  let lastAt = -Infinity, lastText = '', lastTick = -1, timer = null, disposed = false, ended = false, started = false, speaking = false;

  function clear() {
    if (timer !== null) { cancel(timer); timer = null; }
    o.onLine?.(null);
  }
  function stopSpeech() { if (speaking) { try { synth?.cancel(); } catch { /* device service unavailable */ } speaking = false; } }
  function say(event, final = false) {
    if (disposed) return;
    const all = o.getSettings?.() || {};
    const s = normalizeChatterSettings(all.chatter || all);
    if (s.frequency === 'off') { clear(); stopSpeech(); return; }
    const at = clock();
    const interval = final ? 4000 : s.frequency === 'rare' ? 30000 : 16000;
    if (at - lastAt < interval) return;
    const lines = BATTLE_LINES[faction][event];
    if (!lines?.length) return;
    let i = next.get(event) || 0;
    if (lines[i % lines.length] === lastText && lines.length > 1) i++;
    const text = lines[i % lines.length];
    next.set(event, i + 1);
    lastAt = at; lastText = text;
    clear();
    if (s.subtitles) {
      o.onLine?.({ text, faction, event });
      timer = schedule(() => { timer = null; if (!disposed) o.onLine?.(null); }, 7000);
    }
    stopSpeech();
    const voice = s.speech && !all.muted && s.volume > 0 && localPortugueseVoice(synth);
    if (voice && typeof Utterance === 'function') {
      try {
        const line = new Utterance(text);
        line.voice = voice; line.lang = voice.lang;
        line.volume = s.volume * (Number.isFinite(all.master) ? Math.max(0, Math.min(1, all.master)) : 0.8);
        line.rate = faction === 'ferrix' ? 0.92 : 1;
        line.onend = line.onerror = () => { speaking = false; };
        speaking = true; synth.speak(line);
      } catch { speaking = false; }
    }
  }
  return {
    onFrame(frame) {
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
    dispose() { if (disposed) return; disposed = true; clear(); stopSpeech(); },
  };
}
