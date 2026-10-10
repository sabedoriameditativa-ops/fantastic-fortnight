# Proposta de Design — Áudio Procedural (Web Audio API) para "Frota Estelar"

Lente: tudo sintetizado em runtime, zero arquivos de áudio. Código em `src/audio/` (compartilhável só o que é puro; o motor em si é browser-only, mas o *descriptor* dos eventos vem da simulação e é isomórfico).

Opiniões fortes resumidas:
- **Um único `AudioContext`**, criado no primeiro gesto, com `latencyHint: 'interactive'`. Nunca criar nós fora do grafo "vivo" sem `disconnect()` — vazamento de nós é o bug nº 1 de jogos Web Audio.
- **Nenhum `ScriptProcessor`/`AudioWorklet` na v1.** Tudo com nós nativos (osciladores, buffers de ruído pré-gerados, filtros, waveshaper, convolver com IR sintético). Worklet é risco de latência/CORS/complexidade sem ganho perceptível aqui.
- **Orçamento de voz fixo e barato**: cada SFX custa ≤ 6 nós, vive ≤ 2,5 s (exceto explosões capitais ≤ 4 s), e é descartado com `onended`. Com 24 vozes isso é ≤ 150 nós ativos; o Chrome aguenta com folga em laptop fraco.
- **Música como sequenciador de lookahead** (Chris Wilson): `setInterval(25ms)` agenda notas até `currentTime + 0.12s`. Música nunca depende de `requestAnimationFrame` (que para em aba oculta).
- **Mixagem em dB, não em "0..1 linear"**. Volume do usuário em slider 0..100 vira ganho `v^2` (curva perceptual barata).

---

## 1. Arquitetura

### 1.1 Grafo de barramentos

```
[SFX voices] ──► sfxBus (Gain) ──► sfxComp (DynamicsCompressor, suave) ─┐
[UI voices]  ──► uiBus  (Gain) ───────────────────────────────────────────┼─► master (Gain)
[Music]      ──► musicBus (Gain) ──► musicLP (BiquadFilter LP, duck) ──┘        │
                                                                                 ▼
                                                                  limiter (DynamicsCompressor:
                                                                   threshold -3 dB, knee 0, ratio 20,
                                                                   attack 0.002, release 0.12)
                                                                                 │
                                                                                 ▼
                                                                          ctx.destination
```

- `sfxComp`: threshold −18 dB, knee 12, ratio 4, attack 0.005, release 0.08. Serve como "glue" para quando 15 tiros entram ao mesmo tempo.
- `musicLP`: lowpass em 20 kHz (transparente); durante uma explosão capital o cutoff cai para 600 Hz por 350 ms (ducking perceptual sem baixar ganho — fica "embaixo" sem sumir).
- Um `ConvolverNode` compartilhado com IR sintética (ruído exponencialmente decaído, 1,4 s, estéreo com decorrelação) alimenta um `reverbReturn (Gain 0.18)` → master. SFX de explosão/escudo enviam uma cópia (`sendGain`) para o reverb. **Um único convolver** para o jogo inteiro; cada send é só um `Gain`.

### 1.2 Criação e autoplay

```js
// audio/AudioEngine.js
export class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.pending = []; }

  // Called on ANY first pointerdown/keydown (listener { once:true } registered at boot on window)
  async init() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive', sampleRate: 48000 });
    this.buildBuses();           // section 1.1
    this.noise = buildNoiseBank(this.ctx);   // section 2.0 (white, pink, brown, crackle: 2 s each)
    this.reverb = buildSyntheticIR(this.ctx);
    this.music = new MusicEngine(this);
    this.applySettings(loadSettings());
    await this.ctx.resume();
    this.ready = true;
    this.pending.splice(0).forEach(fn => fn());   // flush e.g. setMusicState('menu') called before gesture
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }
}
```

- iOS Safari: `resume()` deve ocorrer **dentro** do handler do gesto (não após `await` de outra coisa). O `init()` é chamado síncrono no handler e só depois faz `await`.
- `visibilitychange` → aba oculta: `musicBus.gain` rampa a 0 em 0,3 s e o sequenciador pausa (evita "catch-up" de 200 notas na volta); aba visível: retoma.
- Enquanto `ctx` não existe, `play()` é no-op e `setMusicState()` enfileira o último estado.

### 1.3 Pool de vozes, prioridade, coalescência

```js
const MAX_VOICES = 24;          // SFX bus only; UI and music are separate and uncapped (UI < 4 anyway)
const PRIORITY = { capitalDeath: 100, bigDeath: 80, shieldBreak: 70, cast: 60, midDeath: 55,
                   torpedo: 50, railgun: 50, missile: 40, smallDeath: 35, hitHull: 25,
                   hitShield: 25, laser: 20, plasma: 20, cannon: 15, autocannon: 10, flak: 10, engine: 5 };

class VoicePool {
  constructor(n) { this.voices = []; this.cap = n; }
  acquire(priority, now) {
    this.voices = this.voices.filter(v => v.endTime > now);          // onended also removes, this is belt+braces
    if (this.voices.length < this.cap) return true;
    const victim = this.voices.reduce((a, b) => (b.priority < a.priority ? b : a));
    if (victim.priority >= priority) return false;                   // refuse quietly
    victim.kill(now);  // gain.cancelScheduledValues; gain.setTargetAtTime(0, now, 0.01); stop(now+0.05)
    return true;
  }
}
```

**Coalescência (anti-"metralhadora de 500 naves")**: fila por `sfxKey` (ex.: `cannon.human`). Ao receber um evento:

```js
coalesce(key, event, now) {
  const slot = this.recent.get(key);
  if (slot && now - slot.t < 0.030) {        // 30 ms window
    slot.count++;
    slot.x += event.x; slot.y += event.y;    // average position later
    return null;                             // swallowed
  }
  this.recent.set(key, { t: now, count: 1, x: event.x, y: event.y });
  return { ...event, gainMul: 1 };           // real voice; count applied when the window closes
}
// On window close (checked each update()): gainMul = min(2.2, 1 + 0.35*log2(count)), pitch jitter widened
```

Resultado: 40 autocanhões disparando no mesmo tick = **uma** voz 2,2× mais forte e um pouco mais "larga" (detune aleatório ±60 cents), em vez de 40 vozes.

Rate limit adicional por classe: `hitHull` máx. 12/s, `hitShield` máx. 12/s, `cannon/autocannon/flak` máx. 16/s cada, `laser` (beam loop) máx. 6 instâncias simultâneas, `engine` 1 voz por **time** (ambiente agregado, não por nave). Acima disso, o evento só incrementa `count` do próximo slot.

### 1.4 Espacialização e atenuação

Sem `PannerNode` (caro e 3D). Uso `StereoPannerNode` + atenuação por distância ao centro da câmera:

```js
spatialize(x, y) {   // world coords; camera gives center cx, cy and halfWidth hw (world units)
  const dx = (x - cam.cx) / cam.hw;           // -1..1 is on screen
  const dy = (y - cam.cy) / (cam.hw / cam.aspect);
  const pan  = clamp(dx * 0.8, -0.8, 0.8);
  const dist = Math.hypot(dx, dy);
  const att  = dist <= 1 ? 1 : 1 / (1 + 1.5 * (dist - 1) * (dist - 1));   // off-screen falls fast
  const lpHz = dist <= 1 ? 20000 : max(900, 20000 / (1 + 4*(dist-1)));    // off-screen sounds muffled
  return { pan, gain: att, lpHz };
}
```

Com zoom-out total (frota inteira visível) `hw` cresce e tudo fica em `dist ≤ 1` → sem atenuação, só pan. Como cada voz já tem um `BiquadFilter` no caminho (ver recipes), o `lpHz` é gratuito.

### 1.5 Configurações e persistência

```js
settings = { master: 0.8, music: 0.7, sfx: 0.9, ui: 0.8, muted: false }   // sliders 0..1
localStorage key: 'frotaEstelar.audio.v1'
applySettings(s): bus.gain.setTargetAtTime(muted ? 0 : s[bus]**2, now, 0.02)
```
UI: quatro sliders + botão mudo no menu "Opções" e um ícone de alto-falante no HUD de batalha (toggle mudo). Mudar o slider toca `ui.tick` para feedback imediato.

---

## 2. Receitas de SFX

### 2.0 Primitivas compartilhadas

```js
// Noise bank, built once (2 s each, 48 kHz, stereo-decorrelated 2 channels)
white:   Math.random()*2-1
pink:    Paul Kellet 3-pole filter of white
brown:   integrate white, leak 0.98, normalize
crackle: white * (Math.random() < 0.02 ? 1 : 0.05)   // sparse impulses → fire/sparks

function osc(ctx, type, f0, t, dest)  → OscillatorNode (type, frequency.setValueAtTime(f0,t)), connected to dest
function noise(ctx, kind, t, dest)    → AudioBufferSourceNode(loop=true) with random offset start
function env(ctx, t, {a, d, s=0, r, peak=1}, dest)   // ADSR via setValueAtTime(0,t) → linearRamp(peak,t+a) → exponentialRamp(max(s,1e-4), t+a+d) → … → setTargetAtTime(1e-4, tOff, r/4)
function lp(ctx, f, q=0.7, dest)  → BiquadFilter lowpass;  function bp(ctx, f, q, dest) → bandpass; hp(...)
function dist(ctx, amount, dest)  → WaveShaperNode, curve = tanh(amount * x) sampled at 1024, oversample '2x'
function pitchSweep(oscOrFilter.param, f0, f1, t0, t1)  → setValueAtTime(f0,t0); exponentialRampToValueAtTime(f1,t1)
```

Toda voz termina com `src.stop(tEnd)` e `src.onended = () => chain.forEach(n => n.disconnect())`.

Cada receita recebe `{ t, out, gain, pan, lpHz, faction, size, seed }` onde `out` é o `StereoPanner → sfxBus` já ligado; `size` ∈ {0 caça, 1 corveta, 2 fragata, 3 cruzador, 4 capital}. **Jitter determinístico**: `seed` do evento (vem da simulação) alimenta um LCG local → `±4%` pitch / `±8%` duração para evitar o efeito metralhadora. Mesmo seed → mesmo som (reprodução de replays idêntica).

### 2.1 Armas

| Arma | Caráter | Duração | Núcleo |
|---|---|---|---|
| `cannon` (cinético) | "thump" seco + estalo | 0,18 s | sine 180→60 Hz + white burst HP 2 kHz |
| `autocannon` | rajada curta 3–5 pulsos | 0,25 s | square 320→90 Hz, 20 ms cada, 45 ms interval |
| `laser` (beam) | zumbido contínuo | enquanto `beamOn` | saw 220 Hz + sine 440 Hz, LP modulado por LFO 7 Hz |
| `plasma` | "pew" gordo | 0,30 s | triangle 900→180 Hz + saw detune, BP sweep |
| `missile` | clique de trava + whoosh | 0,8 s | pink noise BP 400→2500 Hz, saw 90→140 Hz |
| `torpedo` | lançamento pesado | 1,1 s | brown noise LP 150→500 Hz + sine 55 Hz |
| `railgun` | charge zip + crack | 0,45 s | sine 200→3200 Hz (0,25 s) então white burst + sine 50 Hz |
| `flak` | explosões pequenas secas | 0,12 s ×N | white LP 1200 Hz, decay 60 ms, pitch random |
| `acidSpit` (bio) | "splurt" molhado | 0,35 s | sine 600→140 Hz com vibrato 25 Hz, brown noise BP 700 Hz |
| `beamCharge` | subida tensa | 0,6–1,5 s | 2 sines em 5ª (330/495) subindo 1 oitava + ruído filtrado subindo |

Pseudo-código (os principais; os demais seguem o padrão):

```js
// --- cannon (kinetic) ---
cannon({t, out, gain, size, rnd}) {
  const g = env(ctx, t, {a:0.002, d:0.14, r:0.06, peak: gain*0.9}, out);
  const body = osc(ctx,'sine', 180*rnd(0.95,1.05), t, g);
  pitchSweep(body.frequency, 180, 55, t, t+0.12);
  body.start(t); body.stop(t+0.2);
  const ng = env(ctx, t, {a:0.001, d:0.03, r:0.02, peak: gain*0.5}, out);
  const hpF = hp(ctx, 2000, 0.7, ng);
  const n = noise(ctx,'white', t, hpF); n.start(t); n.stop(t+0.08);
  if (size >= 2) { // bigger guns add a sub thump
    const sg = env(ctx, t, {a:0.004, d:0.25, r:0.1, peak: gain*0.6}, out);
    const sub = osc(ctx,'sine', 48, t, sg); sub.start(t); sub.stop(t+0.4);
  }
}

// --- autocannon burst ---
autocannon({t, out, gain, rnd}) {
  const n = 3 + Math.floor(rnd(0,3));          // 3..5 pulses
  for (let i=0;i<n;i++) {
    const ti = t + i*0.045;
    const g = env(ctx, ti, {a:0.001, d:0.02, r:0.015, peak: gain*0.55}, out);
    const o = osc(ctx,'square', 320*rnd(0.9,1.1), ti, g);
    pitchSweep(o.frequency, 320, 90, ti, ti+0.03);
    o.start(ti); o.stop(ti+0.05);
  }
}

// --- laser beam: a sustained voice keyed by shooterId; stop on beamOff event ---
laserStart(id, {t, out, gain}) {
  const g = ctx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain*0.35, t+0.03); g.connect(out);
  const f = lp(ctx, 1800, 4, g);
  const a = osc(ctx,'sawtooth', 220, t, f), b = osc(ctx,'sine', 440, t, f);
  const lfo = osc(ctx,'sine', 7, t); const lfoG = ctx.createGain(); lfoG.gain.value = 600; lfo.connect(lfoG).connect(f.frequency);
  a.start(t); b.start(t); lfo.start(t);
  this.beams.set(id, { g, nodes:[a,b,lfo] , started:t});
}
laserStop(id, t) {
  const v = this.beams.get(id); if (!v) return;
  v.g.gain.setTargetAtTime(0, t, 0.04); v.nodes.forEach(n => n.stop(t+0.25)); this.beams.delete(id);
}
// Hard cap: if beams.size >= 6, laserStart just bumps a shared "beam chorus" gain instead of a new voice.

// --- plasma bolt ---
plasma({t, out, gain, rnd}) {
  const g = env(ctx, t, {a:0.004, d:0.22, r:0.08, peak: gain*0.7}, out);
  const bpF = bp(ctx, 1200, 2.5, g); pitchSweep(bpF.frequency, 1600, 300, t, t+0.25);
  const o1 = osc(ctx,'triangle', 900*rnd(0.95,1.05), t, bpF); pitchSweep(o1.frequency, 900, 180, t, t+0.28);
  const o2 = osc(ctx,'sawtooth', 905, t, bpF); o2.detune.value = 12; pitchSweep(o2.frequency, 905, 182, t, t+0.28);
  o1.start(t); o2.start(t); o1.stop(t+0.32); o2.stop(t+0.32);
}

// --- missile: lock click then whoosh with slight doppler-ish rise then fall ---
missile({t, out, gain, rnd}) {
  const ck = env(ctx, t, {a:0.001, d:0.01, r:0.01, peak: gain*0.4}, out);
  const c = osc(ctx,'square', 2200, t, ck); c.start(t); c.stop(t+0.03);
  const g = env(ctx, t+0.05, {a:0.08, d:0.4, r:0.3, peak: gain*0.6}, out);
  const f = bp(ctx, 400, 1.2, g); pitchSweep(f.frequency, 400, 2500, t+0.05, t+0.45); f.frequency.exponentialRampToValueAtTime(600, t+0.85);
  const n = noise(ctx,'pink', t, f); n.start(t+0.05); n.stop(t+0.9);
  const eg = env(ctx, t+0.05, {a:0.05, d:0.5, r:0.2, peak: gain*0.25}, out);
  const e = osc(ctx,'sawtooth', 90, t, eg); pitchSweep(e.frequency, 90, 140, t+0.05, t+0.6); e.start(t+0.05); e.stop(t+0.85);
}

// --- railgun: charge zip (0.25 s) then crack + sub ---
railgun({t, out, gain}) {
  const zg = env(ctx, t, {a:0.02, d:0.2, r:0.03, peak: gain*0.3}, out);
  const z = osc(ctx,'sine', 200, t, zg); pitchSweep(z.frequency, 200, 3200, t, t+0.25); z.start(t); z.stop(t+0.27);
  const tc = t + 0.25;
  const cg = env(ctx, tc, {a:0.001, d:0.05, r:0.05, peak: gain}, out);
  const d = dist(ctx, 6, cg); const n = noise(ctx,'white', tc, d); n.start(tc); n.stop(tc+0.1);
  const sg = env(ctx, tc, {a:0.002, d:0.3, r:0.15, peak: gain*0.8}, out);
  const s = osc(ctx,'sine', 50, tc, sg); pitchSweep(s.frequency, 70, 38, tc, tc+0.3); s.start(tc); s.stop(tc+0.5);
  this.reverbSend(cg, 0.5, tc);  // crack gets room
}

// --- torpedo ---
torpedo({t, out, gain}) {
  const g = env(ctx, t, {a:0.05, d:0.7, r:0.3, peak: gain*0.8}, out);
  const f = lp(ctx, 150, 1.0, g); pitchSweep(f.frequency, 150, 500, t, t+0.6);
  const n = noise(ctx,'brown', t, f); n.start(t); n.stop(t+1.1);
  const sg = env(ctx, t, {a:0.02, d:0.6, r:0.3, peak: gain*0.7}, out);
  const s = osc(ctx,'sine', 55, t, sg); s.start(t); s.stop(t+1.0);
}

// --- flak: N small dry pops, N from event.count (coalesced) capped 4 ---
flak({t, out, gain, rnd, count}) {
  for (let i=0;i<Math.min(4,count);i++) {
    const ti = t + rnd(0,0.06);
    const g = env(ctx, ti, {a:0.001, d:0.05, r:0.03, peak: gain*0.5}, out);
    const f = lp(ctx, 1200*rnd(0.7,1.3), 0.8, g);
    const n = noise(ctx,'white', ti, f); n.start(ti); n.stop(ti+0.12);
  }
}

// --- acid spit (bio) ---
acidSpit({t, out, gain, rnd}) {
  const g = env(ctx, t, {a:0.01, d:0.25, r:0.1, peak: gain*0.6}, out);
  const o = osc(ctx,'sine', 600*rnd(0.9,1.1), t, g); pitchSweep(o.frequency, 600, 140, t, t+0.3);
  const vib = osc(ctx,'sine', 25, t); const vg = ctx.createGain(); vg.gain.value = 40; vib.connect(vg).connect(o.frequency);
  const ng = env(ctx, t, {a:0.005, d:0.15, r:0.1, peak: gain*0.35}, out);
  const f = bp(ctx, 700, 3, ng); const n = noise(ctx,'brown', t, f); n.start(t); n.stop(t+0.3);
  o.start(t); vib.start(t); o.stop(t+0.35); vib.stop(t+0.35);
}

// --- beam charge-up (duration given by the ability's windup, 0.6..1.5 s) ---
beamCharge({t, out, gain, dur}) {
  const g = env(ctx, t, {a:dur*0.9, d:0.05, r:0.05, peak: gain*0.5}, out);
  const a = osc(ctx,'sine', 330, t, g), b = osc(ctx,'sine', 495, t, g);
  pitchSweep(a.frequency, 330, 660, t, t+dur); pitchSweep(b.frequency, 495, 990, t, t+dur);
  const f = bp(ctx, 500, 6, g); pitchSweep(f.frequency, 500, 6000, t, t+dur);
  const n = noise(ctx,'white', t, f);
  [a,b,n].forEach(x => { x.start(t); x.stop(t+dur+0.1); });
}
```

### 2.2 Sabor por facção (modificador aplicado sobre a receita base)

A simulação envia `faction` em cada evento. O motor aplica um `FactionFlavor` ao `out` da voz (um estágio extra, barato) e ajusta parâmetros:

| Facção | Timbre | Modificador concreto |
|---|---|---|
| **Humanos / Coalizão Terrana** (mecânico) | seco, metálico, kick | osc base `square`→`sawtooth` mix; `dist(3)` suave; +1 "clank": sine 2.4 kHz, 8 ms, gain 0.2 |
| **Insetoides / Enxame** (orgânico, molhado) | pitch com vibrato, ruído brown, "splash" | todo pitch com LFO 18–30 Hz (±5%), filtro `bp` Q alto (4), + cauda de `brown` 80 ms LP 500 Hz |
| **Raça de energia / Cristalinos** (harmônico) | sines/triângulos em intervalos justos, ressonâncias | substitui `square/saw` por `triangle`; adiciona 2 parciais em 5ª e oitava (gain 0.3/0.15); `bp` Q 12 em 2,2 kHz ("ring"); sem ruído branco, só `pink` |
| **Máquinas / Sintéticos** (digital, glitch) | bitcrush falso, pulsos quadrados, chirps | `WaveShaper` com curva *degrau* (16 níveis) = bitcrush falso; PWM: `square` + LFO 40 Hz em `detune` ±200 cents; 10% chance de "glitch" (gate de 5 ms a 50 Hz por 60 ms) |

```js
flavorChain(faction, dest) {
  switch (faction) {
    case 'human':   return dist(ctx, 3, dest);
    case 'swarm':   { const f = bp(ctx, 900, 4, dest); return f; }           // vibrato applied at osc level
    case 'crystal': { const f = bp(ctx, 2200, 12, ctx.createGain()); /*parallel: dry + ring*/ ... }
    case 'machine': return stepShaper16(ctx, dest);
  }
}
```

Observação: as receitas base já são "humanas"; a facção só reinterpreta. Com isso, 10 armas × 4 facções = 40 sons distintos ao custo de 10 receitas + 4 modificadores.

### 2.3 Impactos, escudo, explosões

```js
// hit on hull: short metallic thud, pitch by target size
hitHull({t, out, gain, size, rnd}) {
  const f0 = [900, 650, 420, 300, 200][size] * rnd(0.9,1.1);
  const g = env(ctx, t, {a:0.001, d:0.08, r:0.04, peak: gain*0.5}, out);
  const o = osc(ctx,'triangle', f0, t, g); pitchSweep(o.frequency, f0, f0*0.45, t, t+0.08); o.start(t); o.stop(t+0.14);
  const ng = env(ctx, t, {a:0.001, d:0.04, r:0.02, peak: gain*0.35}, out);
  const n = noise(ctx,'crackle', t, hp(ctx, 1500, 0.7, ng)); n.start(t); n.stop(t+0.07);
}

// hit on shield: glassy "ping" with slight ring; shieldPct (0..1) raises pitch as shield weakens
hitShield({t, out, gain, shieldPct, rnd}) {
  const f0 = 1400 + (1-shieldPct)*900;
  const g = env(ctx, t, {a:0.002, d:0.18, r:0.1, peak: gain*0.45}, out);
  const f = bp(ctx, f0, 9, g);
  const o1 = osc(ctx,'sine', f0, t, f), o2 = osc(ctx,'sine', f0*1.5, t, f);
  o2.detune.value = rnd(-20,20);
  o1.start(t); o2.start(t); o1.stop(t+0.3); o2.stop(t+0.3);
  this.reverbSend(g, 0.3, t);
}

// shield break: downward "shatter" — glass partials falling + noise burst
shieldBreak({t, out, gain, size}) {
  const partials = [2400, 1800, 1350, 900, 600];
  partials.forEach((p, i) => {
    const ti = t + i*0.02;
    const g = env(ctx, ti, {a:0.002, d:0.25, r:0.2, peak: gain*0.35}, out);
    const o = osc(ctx,'sine', p, ti, g); pitchSweep(o.frequency, p, p*0.35, ti, ti+0.45); o.start(ti); o.stop(ti+0.5);
  });
  const ng = env(ctx, t, {a:0.001, d:0.12, r:0.15, peak: gain*0.6}, out);
  const n = noise(ctx,'white', t, hp(ctx, 3000, 0.7, ng)); n.start(t); n.stop(t+0.3);
  if (size >= 3) { const sg = env(ctx, t, {a:0.01,d:0.4,r:0.2,peak:gain*0.5}, out); const s = osc(ctx,'sine',60,t,sg); s.start(t); s.stop(t+0.6); }
  this.reverbSend(ng, 0.6, t);
}

// explosion by size class: 0 small pop … 4 capital rumble
const EXPLO = [
  { dur:0.35, noiseLP:[3000,400], sub:null,       crackle:false, send:0.2, peak:0.6 },   // fighter
  { dur:0.6,  noiseLP:[2500,250], sub:[70,40],    crackle:false, send:0.3, peak:0.8 },   // corvette
  { dur:1.0,  noiseLP:[2000,150], sub:[60,35],    crackle:true,  send:0.45, peak:1.0 },  // frigate
  { dur:1.8,  noiseLP:[1500,100], sub:[50,30],    crackle:true,  send:0.6, peak:1.2 },   // cruiser
  { dur:3.5,  noiseLP:[1200,60],  sub:[42,24],    crackle:true,  send:0.8, peak:1.5 },   // capital
];
explosion({t, out, gain, size, rnd}) {
  const p = EXPLO[size]; const dur = p.dur*rnd(0.9,1.1);
  const g = env(ctx, t, {a:0.004, d:dur*0.5, r:dur*0.5, peak: gain*p.peak}, out);
  const d = size >= 2 ? dist(ctx, 2.5, g) : g;
  const f = lp(ctx, p.noiseLP[0], 0.9, d); pitchSweep(f.frequency, p.noiseLP[0], p.noiseLP[1], t, t+dur);
  const n = noise(ctx, size>=3 ? 'brown' : 'white', t, f); n.start(t); n.stop(t+dur+0.1);
  if (p.sub) { const sg = env(ctx, t, {a:0.01, d:dur*0.6, r:dur*0.4, peak: gain*p.peak*0.9}, out);
               const s = osc(ctx,'sine', p.sub[0], t, sg); pitchSweep(s.frequency, p.sub[0], p.sub[1], t, t+dur); s.start(t); s.stop(t+dur+0.2); }
  if (p.crackle) { const cg = env(ctx, t+0.1, {a:0.05, d:dur*0.7, r:0.2, peak: gain*0.3}, out);
                   const c = noise(ctx,'crackle', t, bp(ctx, 2500, 1, cg)); c.start(t+0.1); c.stop(t+dur); }
  this.reverbSend(g, p.send, t);
  if (size >= 3) this.duckMusic(t, size === 4 ? 0.5 : 0.3);        // musicLP cutoff 20k→600 Hz and back
  if (size === 4) this.secondaryPops(t, 6, gain*0.4);               // 6 fighter-size pops spread over 1.2 s (debris)
}
```

A explosão capital é o único som que pode passar de 2,5 s; em troca é prioridade 100 e desarma qualquer coalescência (sempre toca).

### 2.4 Habilidades

```js
emp({t,out,gain}) {            // rising zap then electrical discharge with decaying "sizzle"
  const g = env(ctx,t,{a:0.15,d:0.1,r:0.5,peak:gain*0.7},out);
  const o = osc(ctx,'sawtooth',120,t,g); pitchSweep(o.frequency,120,2400,t,t+0.15); o.frequency.exponentialRampToValueAtTime(80,t+0.6);
  const sq = osc(ctx,'square',2400,t,g); sq.frequency.setValueAtTime(2400,t+0.15); pitchSweep(sq.frequency,2400,300,t+0.15,t+0.7);
  const ng = env(ctx,t+0.15,{a:0.005,d:0.3,r:0.4,peak:gain*0.4},out);
  const n = noise(ctx,'crackle',t,hp(ctx,2000,0.7,ng)); 
  [o,sq,n].forEach(x=>{x.start(t); x.stop(t+0.9);}); this.reverbSend(g,0.5,t);
}
shieldDome({t,out,gain}) {     // bright major-ish swell: 3 sines (1 : 1.5 : 2) rising fifth, slow attack, long ring
  [440, 660, 880].forEach((f,i)=>{ const g=env(ctx,t,{a:0.25,d:0.6,r:0.8,peak:gain*[0.5,0.3,0.2][i]},out);
    const o=osc(ctx,'sine',f*0.75,t,g); pitchSweep(o.frequency,f*0.75,f,t,t+0.3); o.start(t); o.stop(t+1.8); });
  this.reverbSend(out,0.6,t);
}
repair({t,out,gain}) {         // 4 ascending plucks on a pentatonic (C5 E5 G5 A5) + soft hiss
  [523,659,784,880].forEach((f,i)=>{ const ti=t+i*0.09; const g=env(ctx,ti,{a:0.005,d:0.2,r:0.15,peak:gain*0.4},out);
    const o=osc(ctx,'triangle',f,ti,g); o.start(ti); o.stop(ti+0.4); });
  const hg=env(ctx,t,{a:0.1,d:0.4,r:0.3,peak:gain*0.15},out); const n=noise(ctx,'pink',t,bp(ctx,4000,2,hg)); n.start(t); n.stop(t+0.8);
}
teleport({t,out,gain}) {       // out: downward shimmer with ring mod; in (0.4 s later): reversed shape
  const g=env(ctx,t,{a:0.02,d:0.3,r:0.1,peak:gain*0.6},out);
  const car=osc(ctx,'sine',1200,t); const mod=osc(ctx,'sine',310,t); const rm=ctx.createGain(); rm.gain.value=0;
  mod.connect(rm.gain); car.connect(rm); rm.connect(g);
  pitchSweep(car.frequency,1200,200,t,t+0.35); car.start(t); mod.start(t); car.stop(t+0.4); mod.stop(t+0.4);
  this.scheduleIn(0.4, () => teleportIn(...));   // same graph, sweep 200→1200, env a:0.25 d:0.05
}
cloak({t,out,gain}) {          // phaser-like: pink noise through bp swept by slow LFO, fading to nothing
  const g=env(ctx,t,{a:0.1,d:0.5,r:0.6,peak:gain*0.35},out);
  const f=bp(ctx,800,5,g); const lfo=osc(ctx,'sine',1.5,t); const lg=ctx.createGain(); lg.gain.value=600; lfo.connect(lg).connect(f.frequency);
  const n=noise(ctx,'pink',t,f); const o=osc(ctx,'sine',220,t,g); pitchSweep(o.frequency,220,110,t,t+1.0);
  [n,o,lfo].forEach(x=>{x.start(t);x.stop(t+1.3);});
}
droneLaunch({t,out,gain,count}) {   // mechanical clack + tiny rising whine, one per drone up to 4 within 0.3 s
  for (let i=0;i<Math.min(4,count);i++){ const ti=t+i*0.07;
    const cg=env(ctx,ti,{a:0.001,d:0.03,r:0.02,peak:gain*0.3},out); const c=noise(ctx,'white',ti,hp(ctx,2500,1,cg)); c.start(ti); c.stop(ti+0.05);
    const wg=env(ctx,ti+0.03,{a:0.05,d:0.2,r:0.1,peak:gain*0.2},out); const w=osc(ctx,'sawtooth',500,ti,lp(ctx,2000,2,wg)); pitchSweep(w.frequency,500,1400,ti+0.03,ti+0.3); w.start(ti+0.03); w.stop(ti+0.4); }
}
```

### 2.5 Ambiente de motores

Uma voz por **time** (duas no total), não por nave:

```js
engineBed(team) {   // persistent while battle is running
  // brown noise LP 120 Hz + sawtooth 38 Hz (human) / sine 44 Hz with 0.3 Hz vibrato (swarm) / triangle 55+82.5 Hz (crystal) / square 30 Hz PWM (machine)
  // gain target = 0.08 * sqrt(aliveMass(team)/initialMass(team)), setTargetAtTime every 250 ms
  // pan = average x of the team's alive ships relative to camera
}
```
Custa 4 nós para o jogo inteiro e cai de volume conforme a frota morre — reforça narrativa sem custo.

### 2.6 UI

| Evento | Receita |
|---|---|
| `ui.hover` | sine 1800 Hz, 25 ms, peak 0.12 |
| `ui.click` | square 900→450 Hz em 30 ms, peak 0.25 |
| `ui.confirm` | 2 notas triangle 660→990 Hz, 60 ms cada, peak 0.3 |
| `ui.error` | square 220 Hz + 233 Hz (batimento) 180 ms, peak 0.3, LP 1200 |
| `ui.buy` | pluck triangle 1046 Hz com env d:0.15 + cents jitter |
| `ui.countdown` (3,2,1) | sine 880 Hz 90 ms; no "0/Lutar!" sine 1320 Hz 300 ms + sub 55 Hz |
| `ui.victory` | stinger: acorde em 3 vozes (saw LP 2 kHz) I–IV–V–I em D maior, 2,2 s, reverb 0.5 |
| `ui.defeat` | stinger: 2 sines descendo semitons D4→A3 em 1,8 s + brown noise LP 200 Hz, 2,5 s |

---

## 3. Trilha sonora generativa

### 3.1 Motor de sequenciamento

```js
class MusicEngine {
  constructor(engine) { this.ctx = engine.ctx; this.out = engine.musicBus;
    this.lookahead = 0.12; this.tickMs = 25; this.nextNoteTime = 0; this.step = 0;   // 16th-note steps
    this.state = null; this.intensity = 0; this.layers = {}; }
  start(theme) { this.theme = THEMES[theme]; this.step = 0; this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.scheduler(), this.tickMs); }
  scheduler() {
    while (this.nextNoteTime < this.ctx.currentTime + this.lookahead) {
      this.theme.onStep(this, this.step, this.nextNoteTime);
      this.nextNoteTime += 60 / this.theme.bpm / 4;   // 16th
      this.step++;
    }
  }
}
```

- Tudo que "toca" dentro de `onStep` agenda nós em `time` exato; o `setInterval` só decide *o que* vai tocar. Drift zero.
- Uma `rngMusic` própria (seed = `Date.now()` no menu; seed da partida em batalha, para o replay ter a mesma música — bônus barato).

### 3.2 Instrumentos

```js
pad(time, midi[], dur, {cutoff=900, gain=0.18}) {   // detuned saws through LP, slow attack
  const g = env(ctx, time, {a: dur*0.4, d: dur*0.2, s: 0.7, r: 1.5, peak: gain}, padOut);
  const f = lp(ctx, cutoff, 0.8, g);
  midi.forEach(m => [-7, 0, +7].forEach(cents => {
    const o = osc(ctx,'sawtooth', mtof(m), time, f); o.detune.value = cents; o.start(time); o.stop(time + dur + 2);
  }));
}   // 3 notes × 3 oscs = 9 oscs per chord; chord lasts 1 bar → ~9–18 oscs alive. Fine.

bass(time, midi, dur, {gain=0.35}) {   // sine fundamental + square an octave up, LP'd, short
  const g = env(ctx, time, {a:0.005, d:dur*0.5, s:0.3, r:0.08, peak:gain}, bassOut);
  const f = lp(ctx, 400, 1.2, g); pitchSweep(f.frequency, 900, 300, time, time+0.15);
  const s = osc(ctx,'sine', mtof(midi), time, f), q = osc(ctx,'square', mtof(midi+12), time, f); q.gain = 0.25 (via gain node)
  s.start(time); q.start(time); s.stop(time+dur); q.stop(time+dur);
}
arp(time, midi, {gain=0.14, cutoff=2500}) {   // triangle + sine, plucky, bp'd, into a feedback delay (dotted 8th)
  const g = env(ctx, time, {a:0.003, d:0.18, r:0.12, peak:gain}, arpDelaySend);
  const f = lp(ctx, cutoff, 2, g);
  const t1 = osc(ctx,'triangle', mtof(midi), time, f), s1 = osc(ctx,'sine', mtof(midi+12), time, f);
  t1.start(time); s1.start(time); t1.stop(time+0.4); s1.stop(time+0.4);
}
lead(time, midi, dur, {gain=0.2}) {   // 2 saws detuned ±8c + sine sub, LP 1800 w/ env sweep, vibrato after 150 ms
  …
}
kick(time, {gain=0.9}) {   // sine 150→45 Hz over 60 ms, env d:0.25 + click (white 8 ms HP 3k)
  const g=env(ctx,time,{a:0.001,d:0.25,r:0.05,peak:gain},drumOut); const o=osc(ctx,'sine',150,time,g);
  pitchSweep(o.frequency,150,45,time,time+0.06); o.start(time); o.stop(time+0.35);
}
snare(time, {gain=0.5}) {   // white noise BP 1800 Hz Q1 d:0.18 + triangle 200→120 Hz d:0.08
  …
}
hat(time, open=false, {gain=0.18}) {   // white noise HP 7000 Hz, d: open ? 0.25 : 0.04
  …
}
tom(time, midi) { sine mtof(midi)*1.5→mtof(midi), d:0.3 }
```

Delay do arp: `DelayNode 0.375*60/bpm` (dotted 8th), feedback `Gain 0.35`, LP 3 kHz na realimentação, mix 0.4 → `musicBus`. Um delay para a música inteira.

### 3.3 Escala/harmonia

- Tonalidade base: **Ré menor** (D natural minor / eólio): D E F G A Bb C → MIDI 62 64 65 67 69 70 72.
- Pentatônica menor para arps e leads (nunca soa errado sobre o progression): D F G A C → 62 65 67 69 72 (+oitavas).
- Progressões (graus → acordes, em tríades MIDI):

| Tema | Progressão (4 compassos) | Acordes (MIDI) |
|---|---|---|
| Menu | i – VI – III – VII | Dm [50 57 62 65] · Bb [46 53 58 62] · F [41 48 53 57] · C [48 55 60 64] |
| Frota (builder) | i – VII – VI – VII (brilhante, dórico opcional: B natural no 2º ciclo) | Dm · C · Bb · C |
| Batalha A (base) | i – i – VI – VII | Dm · Dm · Bb · C |
| Batalha B (intensidade ≥ 0.5) | i – bII – i – V (frígio: Eb) | Dm · Eb [51 58 63] · Dm · A [45 52 57 61 (A7)] |
| Vitória | IV – V – I em Ré **maior** | G [55 59 62] · A [57 61 64] · D [50 54 57 62] |
| Derrota | i → i(b5) descendo | Dm [50 53 57] → Ddim [50 53 56] → sustain D2 (38) |

### 3.4 Temas

**Menu** — 72 BPM, 4/4, ambient.
- Pad: um acorde por 2 compassos (8 s), cutoff 700 Hz com LFO 0,05 Hz (±200 Hz). Voicing aberto (adiciona 9ª com 30% de chance).
- Arp esparso: a cada 16th com probabilidade 0,22, nota da pentatônica em 2 oitavas (74–86), `gain 0.08`, delay dotted-8th gera tapetes.
- "Sub-drone": sine D1 (26 → 36,7 Hz) contínuo gain 0.12.
- Sem percussão. Fade in 3 s.

**Construtor de frota** — 96 BPM.
- Pad mais aberto (cutoff 1400 Hz), 1 acorde/compasso.
- Bass: padrão `x . . x . . x .` em colcheias (tônica, oitava).
- Hat fechado nos contratempos (gain 0.08), kick suave só no tempo 1 e 3 (gain 0.4).
- Arp determinístico: `[0,2,4,2,7,4,2,0]` sobre a pentatônica em 16ths, cutoff 2000.
- Ao selecionar facção, o **motivo de facção** (3.6) toca uma vez como *fill* no próximo compasso.

**Batalha** — 128 BPM, camadas por `intensity ∈ [0,1]`:

```
intensity = clamp( max( 0.45*destroyedFrac + 0.2*min(1, elapsed/60s) + 0.35*(1 - min(aliveFracA, aliveFracB)), density ) )
// density = clamp((sound requests per second) / 40) smoothed over 3 s: a heavy exchange pushes the layers up even in short fights
// sudden death forces intensity = 1 (all layers)
// destroyedFrac = total mass destroyed / total initial mass; updated from snapshots at 4 Hz; smoothed with 2 s time constant
```

| Camada | Entra em | Conteúdo |
|---|---|---|
| L0 Pad + drone | sempre | pad Batalha A, cutoff 900 + 900·intensity |
| L1 Bass | ≥ 0.1 | `x . x . x . x x` colcheias, tônica, com nota de passagem (7º) no último 16th do compasso |
| L2 Kick + hat | ≥ 0.2 | kick em 1, 3 (+ 2.5 ghost quando ≥0.5); hat 16ths gain 0.1 (open no 4.5) |
| L3 Snare + arp | ≥ 0.35 | snare em 2, 4; arp 16ths padrão `[0,4,7,4, 0,4,9,4]` sobre a tríade atual |
| L4 Lead + progressão B | ≥ 0.5 | troca para Batalha B na próxima barra múltipla de 4; lead frase de 2 compassos da pentatônica, rngMusic escolhe entre 4 frases pré-escritas: `[62,65,67,69,72,69,67,65]`, `[69,72,74,72,69,67,65,67]`, … |
| L5 Toms + double kick | ≥ 0.68 | toms em 3.5/4/4.5 (midi 50/45/43), kick 8ths |

Cada camada tem um `Gain` próprio (`layers[k]`) que rampa com `setTargetAtTime(target, now, 0.8)`; **as notas são sempre agendadas** (histerese: camada só "sai" se intensity cair 0,15 abaixo do limiar) — evita que a bateria entre e saia a cada tick. A troca de progressão só acontece em fronteira de 4 compassos.

**Pulso de encerramento**: quando a simulação emite `battleEnd`, o scheduler para na próxima colcheia, todos os layers rampam a 0 em 0,4 s, e o stinger `ui.victory`/`ui.defeat` toca na mesma referência de tempo (`nextNoteTime`), em compasso com a música. Depois de 3 s, volta ao tema `menu` com crossfade.

### 3.5 Transições

```js
setMusicState(state) {   // 'none' | 'menu' | 'builder' | 'battle' | 'victory' | 'defeat'
  if (state === this.state) return;
  const old = this.current;                      // {theme, bus}
  const next = this.spawnTheme(state);           // new sub-bus Gain at 0 → musicBus; starts on next bar boundary of old (or now if none)
  const tSwitch = old ? old.nextBarTime() : ctx.currentTime;
  next.bus.gain.setValueAtTime(0, tSwitch); next.bus.gain.linearRampToValueAtTime(1, tSwitch + 2.0);
  if (old) { old.bus.gain.setValueAtTime(1, tSwitch); old.bus.gain.linearRampToValueAtTime(0, tSwitch + 2.0); old.stopAt(tSwitch + 2.2); }
  this.current = next; this.state = state;
}
```
Crossfade em fronteira de compasso do tema antigo e mesmo tom (tudo em Ré) → a transição soa como "modulação de arranjo", não corte.

### 3.6 Motivo por facção (opcional, barato)

Quatro células de 8 notas, tocadas pelo `lead` no builder ao escolher a facção e, em batalha, como *fill* na camada L4 a cada 8 compassos pelo time que estiver vencendo (`aliveFrac` maior):

| Facção | Motivo (MIDI, 8ths) | Timbre do lead |
|---|---|---|
| Humanos | 62 62 69 67 65 67 69 74 (marcial, 5ª/4ª) | saw + LP 1500, sem vibrato |
| Enxame | 62 63 62 65 63 62 60 62 (cromático, rastejante) | triangle + vibrato 6 Hz ±40c, BP Q 5 |
| Cristalinos | 62 69 74 81 78 74 69 62 (arpejo de quintas abertas) | sine + parciais 1.5/2/3, reverb 0.7 |
| Máquinas | 62 62 62 65 62 62 72 62 (staccato, repetitivo) | square PWM + stepShaper, hat extra 32nds |

### 3.7 Custo

- Menu: ~15 nós vivos. Builder: ~35. Batalha em L5: ~60–80 nós (pad 18 oscs é o maior item). Total do jogo em pico (SFX 24 vozes × ~5 nós + música 80 + buses 15) ≈ 215 nós. Aceitável.

---

## 4. Contrato de integração

### 4.1 Eventos consumidos (vêm do `events[]` de cada tick da simulação)

```ts
// Already produced by the sim (shared code); audio needs these fields at minimum:
{ kind:'shot',   weapon: WeaponId, faction: FactionId, shooterId, size: 0..4, x, y, seed: uint32, beam?: 'on'|'off' }
{ kind:'hit',    target: 'hull'|'shield', faction: FactionId /* of the TARGET */, size: 0..4, x, y, shieldPct?: 0..1, seed }
{ kind:'shieldBreak', faction, size, x, y, seed }
{ kind:'death',  faction, size: 0..4, x, y, seed }
{ kind:'cast',   ability: 'emp'|'shieldDome'|'repair'|'teleport'|'cloak'|'droneLaunch'|'beamCharge', faction, x, y, dur?, count?, seed }
{ kind:'spawn',  … }                       // drones use cast:droneLaunch; spawn itself is silent
{ kind:'battleStart' } { kind:'battleEnd', winner: teamId|null }
```
Pedido ao engenheiro-líder: **`seed` por evento** (ex.: `hash(tick, entityId, n)`), e `size` como classe 0..4. Sem isso, o jitter não é determinístico e o replay soa diferente.

### 4.2 API pública

```js
// src/audio/index.js
export const audio = new AudioEngine();

audio.init(): Promise<void>                      // call synchronously inside the first user gesture handler
audio.isReady(): boolean
audio.play(name: string, opts?: { x?, y?, size?, faction?, seed?, gain?, dur?, count?, id?, shieldPct? }): void
     // name ∈ 'shot.cannon' | 'shot.autocannon' | 'shot.laser' (opts.id + opts.on for beams) | 'shot.plasma' | 'shot.missile' |
     //        'shot.torpedo' | 'shot.railgun' | 'shot.flak' | 'shot.acidSpit' | 'cast.beamCharge' | 'hit.hull' | 'hit.shield' |
     //        'shieldBreak' | 'death' | 'cast.emp' | 'cast.shieldDome' | 'cast.repair' | 'cast.teleport' | 'cast.cloak' |
     //        'cast.droneLaunch' | 'ui.hover' | 'ui.click' | 'ui.confirm' | 'ui.error' | 'ui.buy' | 'ui.countdown' | 'ui.go'
audio.consumeEvents(events: SimEvent[], tickTime: number): void   // maps sim events → play(); applies coalescing; called once per rendered frame with the events of ticks since last frame
audio.setCamera(cx, cy, halfWidth, aspect): void                  // once per frame
audio.setBattleState({ aliveFrac: [a, b], destroyedFrac, elapsed, teamMass: [...], teamCenter: [[x,y],[x,y]] }): void   // 4 Hz is enough
audio.setMusicState('none'|'menu'|'builder'|'battle'|'victory'|'defeat'): void
audio.setFactionHint(factionId): void             // builder: triggers the faction motif fill
audio.setVolume(bus: 'master'|'music'|'sfx'|'ui', v: 0..1): void
audio.setMuted(bool): void
audio.getSettings(): Settings
audio.suspend()/resume()                           // used by visibility handling and pause menu
```

### 4.3 Mapeamento evento → som e temporização

```js
consumeEvents(events, tickTime) {
  // tickTime is the sim time (s) of the tick; renderer passes it with its interpolation offset so audio lines up with visuals
  const base = this.ctx.currentTime + 0.02;                     // small safety lead so scheduling is never in the past
  for (const e of events) {
    const t = base + clamp(e.tickOffset, 0, 0.05);              // ticks are 50 ms apart; offset spreads multiple ticks per frame
    switch (e.kind) {
      case 'shot':        this.enqueue(`shot.${e.weapon}`, e, t); break;
      case 'hit':         this.enqueue(e.target === 'shield' ? 'hit.shield' : 'hit.hull', e, t); break;
      case 'shieldBreak': this.enqueue('shieldBreak', e, t); break;
      case 'death':       this.enqueue('death', e, t); break;
      case 'cast':        this.enqueue(`cast.${e.ability}`, e, t); break;
      case 'battleStart': this.setMusicState('battle'); this.engineBeds.start(); break;
      case 'battleEnd':   this.engineBeds.stop(); this.setMusicState(e.winner === localTeam ? 'victory' : 'defeat'); break;
    }
  }
  this.flushCoalesced(base);
}
```

### 4.4 Mantendo barato a 500 naves

1. **Coalescência por chave + janela 30 ms** (1.3): 500 naves atirando a 2 tiros/s = 1000 eventos/s → após coalescência, ≤ ~16/s por tipo de arma × ~10 tipos efetivamente ativos ≈ 100–160 vozes/s de tentativa; o pool de 24 e os rate-limits derrubam para ≤ 40 vozes novas/s reais. Isso é ~200 nós criados/s, trivial.
2. **Culling por distância antes de criar nós**: `gain < 0.03` após atenuação → descartado antes de alocar qualquer nó (o cálculo é 5 operações float).
3. **Culling por relevância**: `hit.*` só toca quando `size ≥ 1` *ou* está em `dist ≤ 0.6` (na tela e perto). Tiros de caças fora de tela não existem para o áudio.
4. **Ambiente agregado** (motores por time, não por nave).
5. **Nenhum nó persistente por entidade** exceto beams (cap 6).
6. **Zero alocação por frame no caminho quente**: `recent` é um `Map` reutilizado; os objetos de voz vêm de um array pré-alocado de 32.
7. **Buffers de ruído compartilhados** (4 buffers × 2 s); `AudioBufferSourceNode` é o nó mais barato que existe.
8. Métrica de depuração: `audio.stats()` → `{voices, created/s, coalesced/s, dropped/s, musicNodes}` exibido no overlay de debug (`F3`).

---

## 5. Plano de testes sem ouvidos

### 5.1 Unit (Node, `node:test`) com `MockAudioContext`

```js
// test/audio/mockAudioContext.js
class MockParam { constructor(v){ this.value=v; this.events=[]; }
  setValueAtTime(v,t){ this.events.push({m:'set',v,t}); return this; }
  linearRampToValueAtTime(v,t){ this.events.push({m:'lin',v,t}); return this; }
  exponentialRampToValueAtTime(v,t){ if (v<=0) throw new RangeError('exp ramp to <=0'); this.events.push({m:'exp',v,t}); return this; }
  setTargetAtTime(v,t,tc){ this.events.push({m:'tgt',v,t,tc}); return this; }
  cancelScheduledValues(t){ this.events.push({m:'cancel',t}); return this; } }
class MockNode { constructor(ctx,type){ this.ctx=ctx; this.type=type; this.outputs=[]; this.started=null; this.stopped=null; ctx.created.push(this); }
  connect(n){ this.outputs.push(n); return n; } disconnect(){ this.outputs=[]; this.disconnected=true; }
  start(t=0){ if(this.started!==null) throw new Error('start twice'); this.started=t; } stop(t=0){ this.stopped=t; } }
export class MockAudioContext { currentTime=0; state='suspended'; created=[]; sampleRate=48000;
  createOscillator(){ const n=new MockNode(this,'osc'); n.frequency=new MockParam(440); n.detune=new MockParam(0); n.type='sine'; return n; }
  createGain(){ const n=new MockNode(this,'gain'); n.gain=new MockParam(1); return n; }
  createBiquadFilter(){ const n=new MockNode(this,'biquad'); n.frequency=new MockParam(350); n.Q=new MockParam(1); n.type='lowpass'; return n; }
  createBufferSource(){ const n=new MockNode(this,'bufsrc'); n.loop=false; n.playbackRate=new MockParam(1); return n; }
  createBuffer(ch,len,sr){ return { numberOfChannels:ch, length:len, sampleRate:sr, getChannelData:()=>new Float32Array(len) }; }
  createStereoPanner(){ const n=new MockNode(this,'panner'); n.pan=new MockParam(0); return n; }
  createDynamicsCompressor(){ const n=new MockNode(this,'comp'); ['threshold','knee','ratio','attack','release'].forEach(k=>n[k]=new MockParam(0)); return n; }
  createWaveShaper(){ return new MockNode(this,'shaper'); } createConvolver(){ return new MockNode(this,'conv'); } createDelay(){ const n=new MockNode(this,'delay'); n.delayTime=new MockParam(0); return n; }
  get destination(){ return this._d ??= new MockNode(this,'dest'); }
  resume(){ this.state='running'; return Promise.resolve(); } suspend(){ this.state='suspended'; return Promise.resolve(); }
  advance(dt){ this.currentTime+=dt; for (const n of this.created) if (n.stopped!==null && n.stopped<=this.currentTime && n.onended) { n.onended(); n.onended=null; } }
}
```

Testes (todos rodam em `npm test` junto com os da simulação):

| Teste | Afirmações |
|---|---|
| `buses.test.js` | após `init`, existe caminho `sfxBus→comp→master→limiter→destination`; `limiter.ratio.value === 20`; `setVolume('sfx', 0.5)` agenda `tgt` com `v = 0.25` |
| `recipes.test.js` (table-driven, 1 caso por receita × 4 facções × 5 tamanhos) | não lança; cria ≤ 14 nós; toda fonte tem `start` e `stop` com `stop > start`; `stop − start ≤ 4.0`; todo `exp` ramp tem `v > 0`; todo evento de param tem `t ≥ ctx.currentTime`; o envelope termina em `tgt 1e-4`; **cada nó criado alcança `destination`** (BFS pelos `outputs`) |
| `recipes.determinism.test.js` | mesmo `seed` → sequência idêntica de `(type, param events)`; seeds diferentes → difere |
| `cleanup.test.js` | após `advance(5)`, todo nó criado por SFX está `disconnected` e `pool.voices.length === 0` |
| `pool.test.js` | 30 `shot.autocannon` em 0 ms → `voices ≤ 24`; depois `death size 4` → sempre aceito e a vítima de menor prioridade recebe `cancel`+`tgt 0` |
| `coalesce.test.js` | 40 `shot.cannon` com `t` dentro de 30 ms → 1 voz com `gainMul ≈ 1+0.35·log2(40)` capped 2.2; com 31 ms de espaçamento → 2 vozes |
| `spatial.test.js` | `(cx, cy)` → pan 0, gain 1; `x = cx + 2·hw` → pan 0.8, gain ≈ 0.29, lpHz < 20000; fora de tela com gain < 0.03 → **nenhum nó criado** |
| `music.scheduler.test.js` | com `ctx.currentTime` avançado manualmente em 25 ms, após 10 s de tema `battle` 128 BPM foram agendados `~85 steps` (10·128/60·4 = 85,3) com `t` monotônico e espaçamento `60/128/4 ± 1e-9`; nenhuma nota com `t < currentTime` |
| `music.layers.test.js` | `setBattleState` com intensity 0.7 → `layers.L3.gain` tem `tgt 1`; cair para 0.6 mantém L4 (histerese); cair para 0.45 → L4 `tgt 0`; troca para progressão B só em `step % 64 === 0` |
| `music.transition.test.js` | `setMusicState('menu'→'builder')` → ganho antigo `lin 0` e novo `lin 1` no mesmo `t`, e `t` é múltiplo de compasso do tema antigo |
| `settings.test.js` | `localStorage` mock: `setVolume` persiste; `init` lê; valor corrompido → defaults |
| `events.test.js` | `consumeEvents` com um lote gravado de uma batalha real (fixture JSON de 2000 eventos gerada pela própria sim com seed fixo) → não lança, `stats.created ≤ 60/s equivalente`, `stats.dropped` registrado |

Também um **lint estrutural**: script que varre `src/audio/recipes/*.js` e falha se encontrar `new AudioContext`, `setTimeout` ou `Math.random` (tudo deve passar por `ctx`/`rnd` injetados).

### 5.2 Playwright (Chromium headless, `--autoplay-policy=no-user-gesture-required` **desligado** de propósito para testar o gesto)

```js
test('context resumes after first click', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => window.__audio?.ctx?.state ?? 'none')).toBe('none');
  await page.click('#btn-play');
  await expect.poll(() => page.evaluate(() => window.__audio.ctx.state)).toBe('running');
});

test('full battle produces no audio exceptions and stays within voice cap', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e)); page.on('console', m => m.type()==='error' && errors.push(m.text()));
  await page.goto('/?autotest=1&seed=42&fleet=stress500');  // debug route: skips menu, builds 2×250 ships, auto-plays at 8× speed
  await page.click('body');                                   // gesture
  await page.waitForFunction(() => window.__game.state === 'ended', null, { timeout: 120_000 });
  expect(errors).toEqual([]);
  const stats = await page.evaluate(() => window.__audio.stats());
  expect(stats.maxVoices).toBeLessThanOrEqual(24);
  expect(stats.peakNodes).toBeLessThan(400);
  expect(stats.musicState).toMatch(/victory|defeat/);
});

test('mute persists', async ({ page }) => { /* set slider, reload, read settings via evaluate */ });
```

Headless Chromium tem um `AudioContext` real (saída nula) — rampas exponenciais inválidas, `start()` duplo e `connect` em nó destruído lançam de verdade lá, que é exatamente o que queremos pegar.

### 5.3 Verificação "quase com ouvidos"

- Modo `?audiodemo=1`: página que lista todos os `play()` names × facções × tamanhos como botões, com um `AnalyserNode` desenhando a forma de onda e o pico em dBFS. Permite ao engenheiro-líder conferir em 2 minutos que nada clipa (pico de qualquer voz isolada ≤ −6 dBFS antes do limiter) e que as facções soam distintas.
- Teste automatizado opcional com `OfflineAudioContext` (Playwright): renderiza cada receita por 2 s e afirma `peak ≤ 1.0`, `rms > 0.01` (não silencioso) e que o último 10% é `< 0.005` (sem cauda infinita/vazamento).

---

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| iOS: `resume()` fora do gesto síncrono mantém o contexto suspenso | `init()` chamado síncrono no `pointerdown`; checagem a cada clique subsequente (`if state!=='running' resume()`) |
| "Pop" em `exponentialRampToValueAtTime(0)` (lança) ou envelopes cortados | helper `env` nunca usa 0 (1e-4); `kill()` usa `cancelScheduledValues` + `setTargetAtTime` |
| Fadiga auditiva com 500 naves | coalescência, culling por relevância, ducking de música e a cama de motores decrescente dão dinâmica em vez de parede de ruído |
| Chrome aba oculta: `setInterval` throttled a 1 s → música engasga | pausa música em `visibilitychange`; lookahead de 0,12 s cobre jitter normal |
| Músicas "procedurais" soarem genéricas | progressões fixas e motivos escritos à mão (não aleatórios); aleatoriedade só em densidade do arp e escolha de frases |
| Nós vazando em batalhas longas (memória cresce) | `onended → disconnect` + `advance`-style GC no `update()`; teste `cleanup.test.js` |
| Firefox: `StereoPannerNode` ok; `DynamicsCompressor` tem knee diferente | parâmetros conservadores; limiter com ratio 20 funciona igual |
| Compartilhar `faction`/`size`/`seed` nos eventos aumenta o snapshot | são 3 bytes por evento; eventos já são a parte pequena do snapshot |

Pedidos concretos ao líder: (1) `seed` e `size` por evento; (2) evento `beam on/off` para lasers; (3) `battleStart/battleEnd` como eventos da simulação, não da UI; (4) `tickOffset` por evento quando vários ticks chegam num frame; (5) uma rota de debug `?autotest=1&seed=&fleet=` para o Playwright.