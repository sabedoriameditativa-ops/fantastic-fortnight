// Per-server device identities. The opaque credential exists only in an
// HttpOnly cookie; the database stores its hash. No client result is accepted.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { SHIPS, FACTIONS } from '../shared/catalog.js';
import { DEFAULT_BUDGET, TICK_MS, MAX_TICKS, TICK_RATE, worldSize } from '../shared/constants.js';
import { validateFleet as validateFleetRules } from '../shared/fleet.js';
import { validateName, validateMessage, C2S } from '../shared/protocol.js';
import { DAY_MS, UNLOCKS, normalizeProgressionPolicy, requiredFleetUnlocks, matchReward, inactivityInfo } from '../shared/progression.js';
import { createRequestPolicy } from './requestPolicy.js';

const COOKIE = 'fe.profile';
const RUN_TTL = 60 * 60_000;
const VERIFY_RETRY_MS = 5000;
const MAX_VERIFY_ATTEMPTS = 3;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (v) => JSON.stringify(v);
const parse = (s, fallback = null) => { try { return JSON.parse(s); } catch { return fallback; } };
const problem = (code, status = 400) => Object.assign(new Error(code), { code, status });

function normalizeLegacy(raw) {
  const out = {};
  for (const difficulty of ['facil', 'normal', 'dificil', 'especialista']) {
    const record = raw?.[difficulty];
    if (!record || typeof record !== 'object') continue;
    const cleared = [...new Set((Array.isArray(record.cleared) ? record.cleared : []).filter((n) => Number.isInteger(n) && n > 0 && n <= 999))].sort((a, b) => a - b);
    const max = Math.min(999, Math.max(0, Number.isInteger(record.max) ? record.max : 0, ...cleared));
    out[difficulty] = { max, cleared };
  }
  return out;
}

/** No database side effects occur at import time. */
export function createProfileService({ dataDir = process.env.FE_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'frota-estelar'), filename, now = Date.now, policy: rawPolicy = parse(process.env.FE_PROGRESSION_POLICY, {}) || {}, secureCookie = process.env.FE_COOKIE_SECURE === '1', requestPolicy = createRequestPolicy({ secure: secureCookie }) } = {}) {
  const policy = normalizeProgressionPolicy(rawPolicy);
  const dbFile = filename || path.join(dataDir, 'profiles.sqlite');
  if (dbFile !== ':memory:') mkdirSync(path.dirname(dbFile), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbFile);
  if (dbFile !== ':memory:') chmodSync(dbFile, 0o600);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0, lifetime_points INTEGER NOT NULL DEFAULT 0,
      last_played_at INTEGER NOT NULL, inactivity_charged INTEGER NOT NULL DEFAULT 0,
      last_reward_at INTEGER, legacy_progress TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS unlocks (
      profile_id TEXT NOT NULL REFERENCES profiles(id), unlock_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(profile_id, unlock_id)
    );
    CREATE TABLE IF NOT EXISTS history (
      profile_id TEXT NOT NULL REFERENCES profiles(id), match_id TEXT NOT NULL, mode TEXT NOT NULL,
      outcome TEXT NOT NULL, delta INTEGER NOT NULL, at INTEGER NOT NULL, details TEXT NOT NULL,
      PRIMARY KEY(profile_id, match_id)
    );
    CREATE INDEX IF NOT EXISTS history_at ON history(profile_id, at DESC);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id), created_at INTEGER NOT NULL,
      config TEXT NOT NULL, meta TEXT NOT NULL, result TEXT, input_hash TEXT, completed INTEGER NOT NULL DEFAULT 0,
      verify_attempts INTEGER NOT NULL DEFAULT 0, last_verify_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS runs_profile ON runs(profile_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS verification_failures (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      input_hash TEXT NOT NULL, code TEXT NOT NULL,
      PRIMARY KEY(run_id, input_hash)
    );
  `);
  const runColumns = new Set(db.prepare('PRAGMA table_info(runs)').all().map((column) => column.name));
  if (!runColumns.has('input_hash')) db.exec('ALTER TABLE runs ADD COLUMN input_hash TEXT');
  if (!runColumns.has('verify_attempts')) db.exec('ALTER TABLE runs ADD COLUMN verify_attempts INTEGER NOT NULL DEFAULT 0');
  if (!runColumns.has('last_verify_at')) db.exec('ALTER TABLE runs ADD COLUMN last_verify_at INTEGER');
  const q = (sql) => db.prepare(sql);
  const profileRow = (id) => q('SELECT * FROM profiles WHERE id=?').get(id);
  let closed = false;
  const verifications = new Map();
  const workers = new Set();
  const creationRates = new Map();

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  function authenticateRequest(req) {
    const cookie = req.headers?.cookie || '';
    if (typeof cookie !== 'string' || cookie.length > 16_384) return null;
    const values = cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE}=`));
    if (values.length !== 1) return null;
    const token = values[0].slice(COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return q('SELECT id FROM profiles WHERE token_hash=?').get(hash(token))?.id || null;
  }

  function createIdentity(req, res) {
    const at = now();
    const address = requestPolicy.clientAddress(req);
    const previous = creationRates.get(address);
    if (previous && at - previous.at < 60_000 && previous.count >= 32) throw problem('PROFILE_RATE_LIMIT', 429);
    if (creationRates.size > 2048) for (const [ip, r] of creationRates) if (at - r.at >= 60_000) creationRates.delete(ip);
    creationRates.set(address, previous && at - previous.at < 60_000 ? { at: previous.at, count: previous.count + 1 } : { at, count: 1 });
    const id = randomUUID(), token = randomBytes(32).toString('base64url');
    q('INSERT INTO profiles(id,token_hash,created_at,last_played_at) VALUES(?,?,?,?)').run(id, hash(token), at, at);
    const secure = secureCookie || req.socket?.encrypted;
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=157680000${secure ? '; Secure' : ''}`);
    return id;
  }

  function applyInactivity(id) {
    const row = profileRow(id);
    if (!row) throw problem('PROFILE_NOT_FOUND', 404);
    const info = inactivityInfo(row.last_played_at, now(), row.inactivity_charged, policy);
    if (info.due > 0) {
      const loss = Math.min(row.points, info.due);
      // Account for elapsed days even at zero, avoiding debt when points return.
      q('UPDATE profiles SET points=points-?,inactivity_charged=inactivity_charged+? WHERE id=?').run(loss, info.due, id);
    }
  }

  function getProfile(id) {
    applyInactivity(id);
    const row = profileRow(id);
    return {
      id: row.id, points: row.points, lifetimePoints: row.lifetime_points,
      createdAt: row.created_at, lastPlayedAt: row.last_played_at,
      unlocks: q('SELECT unlock_id FROM unlocks WHERE profile_id=? ORDER BY created_at,unlock_id').all(id).map((r) => r.unlock_id),
      history: q('SELECT * FROM history WHERE profile_id=? ORDER BY at DESC,match_id DESC LIMIT 50').all(id).map((r) => ({ matchId: r.match_id, mode: r.mode, outcome: r.outcome, delta: r.delta, at: r.at, ...parse(r.details, {}) })),
      legacyProgress: parse(row.legacy_progress, {}), legacyVerified: false,
      policy: { ...policy }, inactivity: inactivityInfo(row.last_played_at, now(), row.inactivity_charged, policy),
      unlockCatalog: UNLOCKS.filter((u) => u.kind === 'ship' ? SHIPS[u.ship] : !u.faction || FACTIONS[u.faction]),
      scope: 'server-device',
    };
  }

  function validateFleet(profileId, fleet) {
    const owned = profileId ? new Set(q('SELECT unlock_id FROM unlocks WHERE profile_id=?').all(profileId).map((r) => r.unlock_id)) : new Set();
    const missing = requiredFleetUnlocks(fleet).filter((id) => !owned.has(id));
    return missing.length ? { ok: false, code: 'CONTENT_LOCKED', detail: { unlocks: missing } } : { ok: true };
  }

  function validatePilot(profileId, faction) {
    return !!profileId && (faction !== 'astral' || !!q('SELECT 1 FROM unlocks WHERE profile_id=? AND unlock_id=?').get(profileId, 'faction:astral')) && !!q('SELECT 1 FROM unlocks WHERE profile_id=? AND unlock_id=?').get(profileId, `special:${faction}`);
  }

  function unlock(id, unlockId) {
    const item = UNLOCKS.find((u) => u.id === unlockId && (u.kind === 'ship' ? SHIPS[u.ship] : !u.faction || FACTIONS[u.faction]));
    if (!item) throw problem('UNKNOWN_UNLOCK');
    transaction(() => {
      applyInactivity(id);
      if (q('SELECT 1 FROM unlocks WHERE profile_id=? AND unlock_id=?').get(id, unlockId)) return;
      const requirement = item.requires || (item.kind === 'special' && item.faction === 'astral' ? 'faction:astral' : null);
      if (requirement && !q('SELECT 1 FROM unlocks WHERE profile_id=? AND unlock_id=?').get(id, requirement)) throw problem('PREREQUISITE_LOCKED');
      if (profileRow(id).points < item.cost) throw problem('INSUFFICIENT_POINTS');
      q('UPDATE profiles SET points=points-? WHERE id=?').run(item.cost, id);
      q('INSERT INTO unlocks(profile_id,unlock_id,created_at) VALUES(?,?,?)').run(id, unlockId, now());
    });
    return getProfile(id);
  }

  /** Internal only: caller must supply the actual server simulation result. */
  function recordMatch({ matchId, result, participants, mode = 'multiplayer' }) {
    if (typeof matchId !== 'string' || !matchId || matchId.length > 120 || !Array.isArray(participants)) throw problem('BAD_MATCH');
    const at = now(), dayStart = Math.floor(at / DAY_MS) * DAY_MS;
    const updated = [];
    transaction(() => {
      const seen = new Set();
      for (const participant of participants) {
        const id = participant.profileId;
        if (!id || seen.has(id) || !profileRow(id)) continue;
        seen.add(id);
        // The same identity commanding both sides cannot farm a guaranteed win.
        if (participants.some((p) => p.profileId === id && p.team !== participant.team)) continue;
        if (q('SELECT 1 FROM history WHERE profile_id=? AND match_id=?').get(id, matchId)) continue;
        const reward = matchReward(result, participant, policy, participants);
        if (!reward.eligible) continue;
        applyInactivity(id);
        const row = profileRow(id);
        const sums = q('SELECT COALESCE(SUM(MAX(delta,0)),0) gains,COALESCE(SUM(MAX(-delta,0)),0) losses FROM history WHERE profile_id=? AND at>=?').get(id, dayStart);
        let delta = reward.delta;
        let limited = null;
        if (row.last_reward_at !== null && at - row.last_reward_at < policy.rewardIntervalMs) { delta = 0; limited = 'cooldown'; }
        else if (delta >= 0) { delta = Math.min(delta, Math.max(0, policy.dailyGainCap - sums.gains)); if (delta < reward.delta) limited = 'daily_gain_cap'; }
        else { delta = -Math.min(-delta, row.points, Math.max(0, policy.dailyLossCap - sums.losses)); if (delta > reward.delta) limited = 'daily_loss_cap'; }
        const stats = result.players[participant.playerId];
        const details = { performance: reward.performance, limited, ticks: result.ticks,
          stats: Object.fromEntries(['damageDealt', 'damageTaken', 'healing', 'kills', 'losses', 'shipsTotal', 'shipsAlive'].map((k) => [k, Number.isFinite(stats[k]) ? Math.max(0, Math.round(stats[k])) : 0])) };
        q('INSERT INTO history(profile_id,match_id,mode,outcome,delta,at,details) VALUES(?,?,?,?,?,?,?)').run(id, matchId, mode, reward.outcome, delta, at, json(details));
        q('UPDATE profiles SET points=MAX(0,points+?),lifetime_points=lifetime_points+?,last_played_at=?,inactivity_charged=0,last_reward_at=? WHERE id=?').run(delta, Math.max(0, delta), at, limited === 'cooldown' ? row.last_reward_at : at, id);
        updated.push(id);
      }
    });
    return updated.map(getProfile);
  }

  function migrateLegacy(id, progress) {
    const current = parse(profileRow(id)?.legacy_progress, {}), incoming = normalizeLegacy(progress);
    for (const [difficulty, record] of Object.entries(incoming)) {
      const old = current[difficulty] || { max: 0, cleared: [] };
      current[difficulty] = { max: Math.max(old.max, record.max), cleared: [...new Set([...old.cleared, ...record.cleared])].sort((a, b) => a - b) };
    }
    q('UPDATE profiles SET legacy_progress=? WHERE id=?').run(json(current), id);
    return getProfile(id);
  }

  async function beginRun(id, request) {
    const valid = validateFleetRules(request?.fleet, DEFAULT_BUDGET);
    if (!valid.ok) throw problem(valid.code);
    const access = validateFleet(id, valid.fleet);
    if (!access.ok) throw problem(access.code);
    // Reject unauthorized pilots before building up to eleven bot fleets.
    if (valid.fleet.pilot && !validatePilot(id, valid.fleet.faction)) throw problem('CONTENT_LOCKED');
    const { buildSpConfig, normalizeSpSetup } = await import('../shared/spConfig.js');
    const requestedSetup = normalizeSpSetup(request.setup);
    q('DELETE FROM runs WHERE created_at<?').run(now() - RUN_TTL);
    const active = q('SELECT * FROM runs WHERE profile_id=? AND completed=0').get(id);
    if (active) {
      const meta = parse(active.meta);
      if (json(meta.setup) === json(requestedSetup) && json(meta.playerFleet) === json(valid.fleet)) return { runId: active.id, config: parse(active.config), meta, resumed: true };
      if (now() - active.created_at < policy.rewardIntervalMs) throw problem('RUN_RATE_LIMIT', 429);
      if (verifications.has(active.id)) throw problem('VERIFIER_BUSY', 503);
      q('DELETE FROM runs WHERE id=?').run(active.id);
    }
    const latest = q('SELECT created_at FROM runs WHERE profile_id=? ORDER BY created_at DESC LIMIT 1').get(id);
    if (latest && now() - latest.created_at < policy.rewardIntervalMs) throw problem('RUN_RATE_LIMIT', 429);
    if (q('SELECT COUNT(*) count FROM runs WHERE completed=0').get().count >= 64) throw problem('VERIFIER_BUSY', 503);
    const built = buildSpConfig({ setup: request.setup, playerFleet: valid.fleet, playerName: validateName(request.playerName) || 'Comandante', seed: randomBytes(16).toString('hex'), budget: DEFAULT_BUDGET, plan: request.plan });
    // Recheck after the import await: simultaneous requests must share one run.
    const raced = q('SELECT * FROM runs WHERE profile_id=? AND completed=0').get(id);
    if (raced) return { runId: raced.id, config: parse(raced.config), meta: parse(raced.meta), resumed: true };
    const runId = randomUUID();
    q('INSERT INTO runs(id,profile_id,created_at,config,meta) VALUES(?,?,?,?,?)').run(runId, id, now(), json(built.config), json(built.meta));
    return { runId, ...built };
  }

  function verify(config, inputs) {
    if (workers.size >= 2) return Promise.reject(problem('VERIFIER_BUSY', 503));
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./profileVerifier.js', import.meta.url), { workerData: { config, inputs }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      workers.add(worker);
      let done = false;
      const finish = (error, result) => {
        if (done) return; done = true;
        clearTimeout(timer); workers.delete(worker); worker.terminate();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(problem('VERIFICATION_TIMEOUT', 503)), 20_000);
      worker.once('message', (message) => finish(message.error ? problem(message.error, message.error === 'BAD_REPLAY' ? 400 : 503) : null, message.result));
      worker.once('error', () => finish(problem('VERIFICATION_FAILED', 503)));
      worker.once('exit', () => { if (!done) finish(problem('VERIFICATION_FAILED', 503)); });
    });
  }

  function beginVerification(runId, config, inputs, inputHash) {
    const cached = q('SELECT code FROM verification_failures WHERE run_id=? AND input_hash=?').get(runId, inputHash);
    if (cached) throw problem(cached.code);
    // A busy verifier does not consume the owner's attempt allowance.
    if (workers.size >= 2) throw problem('VERIFIER_BUSY', 503);
    transaction(() => {
      const run = q('SELECT verify_attempts,last_verify_at FROM runs WHERE id=?').get(runId);
      if (!run) throw problem('RUN_EXPIRED', 404);
      if (run.verify_attempts >= MAX_VERIFY_ATTEMPTS) throw problem('RUN_VERIFICATION_LIMIT', 429);
      if (run.last_verify_at !== null && now() - run.last_verify_at < VERIFY_RETRY_MS) throw problem('VERIFICATION_RATE_LIMIT', 429);
      // Reserve before the first async boundary, including failed worker starts.
      q('UPDATE runs SET verify_attempts=verify_attempts+1,last_verify_at=? WHERE id=?').run(now(), runId);
    });
    const pending = verify(config, inputs).then((result) => {
      if (closed) throw problem('SERVER_CLOSED', 503);
      q('UPDATE runs SET result=?,input_hash=? WHERE id=?').run(json(result), inputHash, runId);
      return result;
    }).catch((error) => {
      // Deterministic rejection is reusable across requests and server restarts.
      // Transient failures may retry after the interval, within the same cap.
      if (!closed && error.code === 'BAD_REPLAY') q('INSERT OR IGNORE INTO verification_failures(run_id,input_hash,code) VALUES(?,?,?)').run(runId, inputHash, error.code);
      throw error;
    }).finally(() => { verifications.delete(runId); });
    pending.inputHash = inputHash;
    verifications.set(runId, pending);
    return pending;
  }

  async function completeRun(id, runId, inputs = []) {
    if (typeof runId !== 'string') throw problem('BAD_RUN');
    let run = q('SELECT * FROM runs WHERE id=? AND profile_id=?').get(runId, id);
    if (!run || now() - run.created_at > RUN_TTL) throw problem('RUN_EXPIRED', 404);
    if (!Array.isArray(inputs) || inputs.length > MAX_TICKS) throw problem('BAD_REPLAY');
    const config = parse(run.config);
    const player = config.players.find((p) => !p.isBot);
    const owner = player?.id;
    if (inputs.length && !player?.pilot) throw problem('BAD_REPLAY');
    const perSide = Math.max(config.players.filter((p) => p.team === 0).length, config.players.filter((p) => p.team === 1).length, 1);
    const world = worldSize(perSide);
    let lastTick = -1, lastSeq = -1;
    const buckets = new Map();
    const cleanInputs = inputs.map((entry) => {
      const tick = entry?.tick, input = entry?.input;
      if (!Number.isSafeInteger(tick) || tick < lastTick || tick < 0 || tick >= (config.maxTicks || MAX_TICKS) || entry.ownerId !== owner || !input || !Number.isSafeInteger(input.seq) || input.seq <= lastSeq) throw problem('BAD_REPLAY');
      if (!validateMessage({ t: C2S.PILOT_INPUT, matchId: runId, input }).ok || (input.manual && (input.aimX < 0 || input.aimX > world.w || input.aimY < 0 || input.aimY > world.h))) throw problem('BAD_REPLAY');
      const bucket = Math.floor(tick / TICK_RATE), count = (buckets.get(bucket) || 0) + 1;
      if (count > 20) throw problem('REPLAY_RATE_LIMIT');
      buckets.set(bucket, count); lastTick = tick; lastSeq = input.seq;
      return { tick, ownerId: owner, input: input.manual
        ? Object.fromEntries(['seq', 'manual', 'moveX', 'moveY', 'aimX', 'aimY', 'fire', 'ability'].map((key) => [key, input[key]]))
        : { seq: input.seq, manual: false } };
    });
    const inputHash = hash(json(cleanInputs));
    if (run.input_hash && run.input_hash !== inputHash) {
      // Older saved results hashed ignored neutral fields too. Their exact
      // retransmission remains idempotent after the canonicalization upgrade.
      const previousHash = hash(json(cleanInputs.map((entry, index) => ({ ...entry,
        input: Object.fromEntries(['seq', 'manual', 'moveX', 'moveY', 'aimX', 'aimY', 'fire', 'ability'].map((key) => [key, inputs[index].input[key]])),
      }))));
      if (run.input_hash !== previousHash) throw problem('REPLAY_CHANGED', 409);
    }
    if (run.completed) return { profile: getProfile(id), result: parse(run.result), verified: true };
    let result = parse(run.result);
    if (!result) {
      let pending = verifications.get(runId);
      if (pending && pending.inputHash !== inputHash) throw problem('REPLAY_CHANGED', 409);
      if (!pending) pending = beginVerification(runId, config, cleanInputs, inputHash);
      result = await pending;
    }
    // Allow one second of scheduling/transport skew at the maximum 4× speed.
    if (now() - run.created_at + 1000 < result.ticks * TICK_MS / 4) throw problem('RUN_TOO_EARLY', 409);
    const participants = config.players.map((p) => ({ profileId: p.isBot ? null : id, playerId: p.id, team: p.team }));
    recordMatch({ matchId: `sp:${runId}`, result, participants, mode: 'singleplayer' });
    q('UPDATE runs SET completed=1 WHERE id=?').run(runId);
    return { profile: getProfile(id), result, verified: true };
  }

  function send(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(json(value));
  }

  async function body(req, limit = 32_768) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw problem('JSON_REQUIRED', 415);
    if (Number(req.headers['content-length'] || 0) > limit) throw problem('BODY_TOO_LARGE', 413);
    let size = 0, chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw problem('BODY_TOO_LARGE', 413);
      chunks.push(chunk);
    }
    const value = parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem('BAD_BODY');
    return value;
  }

  async function handleHttp(req, res) {
    const pathname = (req.url || '').split('?')[0];
    if (!pathname.startsWith('/api/profile')) return false;
    try {
      if (closed) throw problem('SERVER_CLOSED', 503);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw problem('ORIGIN_REJECTED', 403);
      if (!requestPolicy.permitsOrigin(req)) throw problem('ORIGIN_REJECTED', 403);
      let id = authenticateRequest(req);
      if (pathname === '/api/profile' && req.method === 'GET') {
        if (!id) throw problem('PROFILE_REQUIRED', 401);
        send(res, 200, { profile: getProfile(id) }); return true;
      }
      if (req.method !== 'POST') throw problem('METHOD_NOT_ALLOWED', 405);
      const input = await body(req, pathname === '/api/profile/complete' ? 1_048_576 : 32_768);
      if (closed) throw problem('SERVER_CLOSED', 503);
      if (pathname === '/api/profile') {
        if (!id) id = createIdentity(req, res);
        send(res, 200, { profile: getProfile(id) }); return true;
      }
      if (!id) throw problem('PROFILE_REQUIRED', 401);
      if (pathname === '/api/profile/unlock') send(res, 200, { profile: unlock(id, input.id) });
      else if (pathname === '/api/profile/legacy') send(res, 200, { profile: migrateLegacy(id, input.progress) });
      else if (pathname === '/api/profile/run') send(res, 200, await beginRun(id, input));
      else if (pathname === '/api/profile/complete') send(res, 200, await completeRun(id, input.runId, input.inputs));
      else throw problem('NOT_FOUND', 404);
    } catch (err) { send(res, err.status || 500, { error: err.code || 'PROFILE_UNAVAILABLE' }); }
    return true;
  }

  return { persistence: dbFile === ':memory:' ? 'memory' : 'durable', handleHttp, authenticateRequest, getProfile, recordMatch, validateFleet, validatePilot, unlock, migrateLegacy, beginRun, completeRun,
    close() { if (closed) return; closed = true; for (const worker of workers) worker.terminate(); db.close(); },
  };
}
