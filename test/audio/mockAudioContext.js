// MockAudioContext for unit-testing the audio engine without a browser
// (docs/design/audio.md §5.1). Records every node and every AudioParam
// automation event so tests can assert graph shape, timing and cleanup.

export class MockParam {
  constructor(owner, v) { this.owner = owner; this.value = v; this.events = []; }
  setValueAtTime(v, t) { this._chk(v, t); this.events.push({ m: 'set', v, t }); return this; }
  linearRampToValueAtTime(v, t) { this._chk(v, t); this.events.push({ m: 'lin', v, t }); return this; }
  exponentialRampToValueAtTime(v, t) {
    this._chk(v, t);
    if (!(v > 0)) throw new RangeError(`exponential ramp to ${v} (must be > 0)`);
    this.events.push({ m: 'exp', v, t }); return this;
  }
  setTargetAtTime(v, t, tc) { this._chk(v, t); this.events.push({ m: 'tgt', v, t, tc }); return this; }
  cancelScheduledValues(t) { this.events.push({ m: 'cancel', t }); return this; }
  _chk(v, t) {
    if (!Number.isFinite(v)) throw new TypeError(`non-finite param value ${v}`);
    if (!Number.isFinite(t)) throw new TypeError(`non-finite time ${t}`);
    if (t < this.owner.ctx.currentTime - 1e-9) throw new RangeError(`param event in the past: t=${t} now=${this.owner.ctx.currentTime}`);
  }
}

export class MockNode {
  constructor(ctx, type) {
    this.ctx = ctx; this.kind = type; this.outputs = []; this.started = null; this.stopped = null; this.disconnected = false;
    this.onended = null; this.id = ctx.created.length; ctx.created.push(this);
  }
  connect(n) {
    if (this.disconnected) throw new Error(`connect on disconnected node ${this.kind}#${this.id}`);
    if (!n) throw new TypeError('connect(undefined)');
    this.outputs.push(n); return n;
  }
  disconnect() { this.outputs = []; this.disconnected = true; }
}

export class MockSource extends MockNode {
  start(t = 0) {
    if (this.started !== null) throw new Error(`start twice on ${this.kind}#${this.id}`);
    if (!Number.isFinite(t)) throw new TypeError('start(NaN)');
    if (t < this.ctx.currentTime - 1e-9) throw new RangeError(`start in the past: ${t} < ${this.ctx.currentTime}`);
    this.started = t;
  }
  stop(t = 0) {
    if (this.started === null) throw new Error(`stop before start on ${this.kind}#${this.id}`);
    if (!Number.isFinite(t)) throw new TypeError('stop(NaN)');
    this.stopped = t;
  }
}

export class MockAudioContext {
  constructor({ sampleRate = 48000 } = {}) {
    this.currentTime = 0; this.state = 'suspended'; this.created = []; this.sampleRate = sampleRate;
    this.resumes = 0; this.closed = false;
  }
  _src(kind, fn) { const n = new MockSource(this, kind); fn(n); return n; }
  _node(kind, fn) { const n = new MockNode(this, kind); fn(n); return n; }
  createOscillator() { return this._src('osc', (n) => { n.frequency = new MockParam(n, 440); n.detune = new MockParam(n, 0); n.type = 'sine'; }); }
  createBufferSource() { return this._src('bufsrc', (n) => { n.buffer = null; n.loop = false; n.playbackRate = new MockParam(n, 1); }); }
  createGain() { return this._node('gain', (n) => { n.gain = new MockParam(n, 1); }); }
  createBiquadFilter() { return this._node('biquad', (n) => { n.frequency = new MockParam(n, 350); n.Q = new MockParam(n, 1); n.gain = new MockParam(n, 0); n.detune = new MockParam(n, 0); n.type = 'lowpass'; }); }
  createStereoPanner() { return this._node('panner', (n) => { n.pan = new MockParam(n, 0); }); }
  createDynamicsCompressor() { return this._node('comp', (n) => { for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new MockParam(n, 0); }); }
  createWaveShaper() { return this._node('shaper', (n) => { n.curve = null; n.oversample = 'none'; }); }
  createConvolver() { return this._node('conv', (n) => { n.buffer = null; }); }
  createDelay(max = 1) { return this._node('delay', (n) => { n.delayTime = new MockParam(n, 0); n.maxDelayTime = max; }); }
  createBuffer(ch, len, sr) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
  }
  get destination() { if (!this._d) this._d = new MockNode(this, 'dest'); return this._d; }
  resume() { this.state = 'running'; this.resumes++; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; this.closed = true; return Promise.resolve(); }
  /** Advance the clock, firing onended for sources whose stop time has passed. */
  advance(dt) {
    this.currentTime += dt;
    for (const n of this.created) {
      if (n.stopped !== null && n.stopped <= this.currentTime && n.onended) { const f = n.onended; n.onended = null; f(); }
    }
  }
  /** Nodes created since index `from`. */
  since(from) { return this.created.slice(from); }
}

/** Does `node` reach `dest` following outputs (AudioParam targets count as their owner node)? */
export function reaches(node, dest, seen = new Set()) {
  if (node === dest) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  const outs = node.outputs || [];
  for (const o of outs) {
    const target = o instanceof MockParam ? o.owner : o;
    if (reaches(target, dest, seen)) return true;
  }
  return false;
}

/** All AudioParams of a node. */
export function paramsOf(node) {
  return Object.values(node).filter((v) => v instanceof MockParam);
}

/** Minimal localStorage stand-in. */
export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), get size() { return m.size; } };
}

/** Fake document with a controllable visibilityState. */
export function fakeDocument() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setHidden(h) { this.visibilityState = h ? 'hidden' : 'visible'; const fn = listeners.get('visibilitychange'); if (fn) fn(); },
  };
}

/**
 * Build an engine with a mock context. Returns { engine, ctx, storage, doc }.
 * Timers are stubbed: call engine.tick() manually.
 */
export async function makeEngine(opts = {}) {
  const { createAudioEngine } = await import('../../client/audio/index.js');
  const ctx = new MockAudioContext();
  const storage = opts.storage !== undefined ? opts.storage : memoryStorage();
  const doc = fakeDocument();
  const engine = createAudioEngine({ createContext: () => ctx, storage, document: doc, setInterval: () => 1, clearInterval: () => {}, seed: opts.seed ?? 42 });
  if (opts.init !== false) await engine.init();
  return { engine, ctx, storage, doc };
}
