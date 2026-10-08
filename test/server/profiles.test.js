import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createProfileService } from '../../server/profiles.js';
import { DAY_MS, matchReward, DEFAULT_PROGRESSION_POLICY } from '../../shared/progression.js';
import { createBattle, stepBattle, getResult } from '../../shared/sim/battle.js';
import { applyPilotInput } from '../../shared/pilot.js';
import { MAX_TICKS } from '../../shared/constants.js';

async function request(service, route = '', { cookie, data = {}, origin, method = 'POST' } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(data))]);
  req.url = `/api/profile${route}`; req.method = method;
  req.headers = { host: 'localhost', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) };
  req.socket = { remoteAddress: 'test' };
  const headers = {};
  const res = { setHeader(key, value) { headers[key.toLowerCase()] = value; }, writeHead(status, extra) { this.status = status; Object.assign(headers, extra); }, end(body) { this.body = JSON.parse(body); } };
  await service.handleHttp(req, res);
  return { ...res, headers, cookie: headers['set-cookie']?.split(';')[0] };
}

async function identity(service) {
  const response = await request(service);
  assert.equal(response.status, 200);
  return { id: response.body.profile.id, cookie: response.cookie };
}

const result = { winner: 0, ticks: 500, players: { p1: { damageDealt: 300, damageTaken: 200, healing: 0, kills: 2, shipsTotal: 3, shipsAlive: 2 }, e1: { damageDealt: 200, damageTaken: 300 } } };
function reward(service, id, matchId, override = {}) {
  return service.recordMatch({ matchId, result: { ...result, ...override }, participants: [{ profileId: id, playerId: 'p1', team: 0 }, { profileId: null, playerId: 'e1', team: 1 }] });
}

test('cookie identity is private, same-origin, and durable with only a token hash stored', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fe-profiles-'));
  let service = createProfileService({ dataDir: directory });
  try {
    const response = await request(service);
    const cookie = response.cookie, id = response.body.profile.id;
    assert.match(response.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
    assert.equal(JSON.stringify(response.body).includes(cookie.split('=')[1]), false);
    assert.equal(service.authenticateRequest({ headers: { cookie } }), id);
    assert.equal(service.authenticateRequest({ headers: { cookie: `${cookie}; ${cookie}` } }), null);
    assert.equal((await request(service, '', { cookie, origin: 'https://attacker.example' })).status, 403);
    service.close();
    const db = new DatabaseSync(path.join(directory, 'profiles.sqlite'), { readOnly: true });
    const row = db.prepare('SELECT * FROM profiles').get();
    assert.notEqual(row.token_hash, cookie.split('=')[1]);
    assert.equal(row.token_hash.length, 64); db.close();
    service = createProfileService({ dataDir: directory });
    assert.equal(service.authenticateRequest({ headers: { cookie } }), id);
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('server rewards are idempotent, capped, and cannot be submitted through HTTP', async () => {
  let at = 1_000_000;
  const service = createProfileService({ filename: ':memory:', now: () => at, policy: { dailyGainCap: 40, rewardIntervalMs: 1000 } });
  try {
    const { id, cookie } = await identity(service);
    reward(service, id, 'one'); reward(service, id, 'one');
    assert.equal(service.getProfile(id).points, 28);
    reward(service, id, 'fast');
    assert.equal(service.getProfile(id).points, 28);
    at += 1000; reward(service, id, 'two');
    assert.equal(service.getProfile(id).points, 40);
    assert.equal(service.getProfile(id).history.length, 3);
    assert.equal((await request(service, '/result', { cookie, data: { result, points: 99999 } })).status, 404);
    assert.equal(service.getProfile(id).points, 40);
    service.recordMatch({ matchId: 'both-sides', result, participants: [{ profileId: id, playerId: 'p1', team: 0 }, { profileId: id, playerId: 'e1', team: 1 }] });
    assert.equal(service.getProfile(id).history.length, 3);
  } finally { service.close(); }
});

test('losses are mild, cannot create debt, and low impact gives less reward', async () => {
  const base = DEFAULT_PROGRESSION_POLICY;
  const bad = { ...result, winner: 1, players: { ...result.players, p1: { damageDealt: 0, damageTaken: 900, healing: 0 } } };
  assert.equal(matchReward(bad, { playerId: 'p1', team: 0 }, base, [{ playerId: 'p1', team: 0 }]).delta, -4);
  const service = createProfileService({ filename: ':memory:', policy: { rewardIntervalMs: 0, dailyLossCap: 6 } });
  try {
    const { id } = await identity(service);
    reward(service, id, 'lose-zero', bad);
    assert.equal(service.getProfile(id).points, 0);
    reward(service, id, 'win');
    reward(service, id, 'lose-one', bad); reward(service, id, 'lose-two', bad);
    assert.equal(service.getProfile(id).points, 22);
  } finally { service.close(); }
});

test('unlock purchases persist across decay; inactivity is elapsed days, with a grace and hard cap', async () => {
  let at = 100 * DAY_MS;
  const service = createProfileService({ filename: ':memory:', now: () => at, policy: { rewardIntervalMs: 0, dailyGainCap: 500 } });
  try {
    const { id } = await identity(service);
    for (let i = 0; i < 6; i++) reward(service, id, `win-${i}`);
    service.unlock(id, 'special:terran'); service.unlock(id, 'special:terran');
    assert.equal(service.getProfile(id).points, 88);
    assert.equal(service.validatePilot(id, 'terran'), true);
    assert.equal(service.validatePilot(null, 'terran'), false);
    at += 14 * DAY_MS;
    assert.equal(service.getProfile(id).points, 88);
    at += DAY_MS;
    assert.equal(service.getProfile(id).points, 86);
    assert.equal(service.getProfile(id).points, 86);
    at += 365 * DAY_MS;
    assert.equal(service.getProfile(id).points, 48);
    assert.deepEqual(service.getProfile(id).unlocks, ['special:terran']);
    assert.equal(service.validateFleet(null, { faction: 'astral', ships: [{ cls: 'ast_lanceta', count: 1 }] }).ok, false);
  } finally { service.close(); }
});

test('legacy progress is merged without awarding unverifiable points', async () => {
  const service = createProfileService({ filename: ':memory:' });
  try {
    const { id } = await identity(service);
    service.migrateLegacy(id, { normal: { max: 3, cleared: [1, 3] } });
    service.migrateLegacy(id, { normal: { max: 2, cleared: [2] }, points: 9999 });
    const profile = service.getProfile(id);
    assert.deepEqual(profile.legacyProgress.normal, { max: 3, cleared: [1, 2, 3] });
    assert.equal(profile.points, 0); assert.equal(profile.legacyVerified, false);
  } finally { service.close(); }
});

test('singleplayer uses a server seed and simulation, binds runs to owners, and awards once', async () => {
  let at = 1_000_000;
  const service = createProfileService({ filename: ':memory:', now: () => at });
  try {
    const first = await identity(service), other = await identity(service);
    const run = await service.beginRun(first.id, { playerName: '  Almirante Ana  ', setup: { level: 1, teamSize: 1, difficulty: 'facil' }, fleet: { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 2 }] }, seed: 'CHEAT', maxTicks: 1 });
    assert.equal(run.config.players.find(p => !p.isBot).name, 'Almirante Ana');
    assert.notEqual(run.config.seed, 'CHEAT');
    assert.notEqual(run.config.maxTicks, 1);
    await assert.rejects(service.completeRun(other.id, run.runId), { code: 'RUN_EXPIRED' });
    await assert.rejects(service.completeRun(first.id, run.runId), { code: 'RUN_TOO_EARLY' });
    const replay = createBattle(run.config);
    while (!replay.ended) stepBattle(replay);
    at += 600_000;
    const completed = await service.completeRun(first.id, run.runId);
    assert.deepEqual(completed.result, getResult(replay));
    const again = await service.completeRun(first.id, run.runId);
    assert.equal(again.profile.points, completed.profile.points);
    assert.equal(again.profile.history.length, completed.profile.history.length);
    await assert.rejects(service.completeRun(first.id, run.runId, [{ tick: 0, ownerId: 'bot_e1', input: { seq: 1 } }]), { code: 'BAD_REPLAY' });
  } finally { service.close(); }
});

test('a completed battle below the reward threshold verifies after its actual duration without points', async () => {
  let at = 1_000_000;
  const minimumRewardTicks = 10000;
  const service = createProfileService({ filename: ':memory:', now: () => at, policy: { minBattleTicks: minimumRewardTicks } });
  try {
    const { id } = await identity(service);
    const run = await service.beginRun(id, { setup: { level: 1, teamSize: 1, difficulty: 'normal' }, fleet: { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 1 }] } });
    const state = createBattle(run.config);
    while (!state.ended) stepBattle(state);
    assert.ok(state.tick < minimumRewardTicks);
    at += Math.ceil(state.tick * 50 / 4);
    const completed = await service.completeRun(id, run.runId);
    assert.equal(completed.verified, true);
    assert.deepEqual(completed.result, getResult(state));
    assert.equal(completed.profile.points, 0);
    assert.equal(completed.profile.history.length, 0);
  } finally { service.close(); }
});

test('manual campaign requires the license and verifies actual input replay, never a reported score', async () => {
  let at = 1_000_000;
  const service = createProfileService({ filename: ':memory:', now: () => at, policy: { rewardIntervalMs: 0 } });
  try {
    const { id } = await identity(service);
    const options = { setup: { level: 1, teamSize: 1, difficulty: 'facil' }, fleet: { faction: 'terran', pilot: true, ships: [{ cls: 'ter_falcao', count: 2 }] } };
    await assert.rejects(service.beginRun(id, options), { code: 'CONTENT_LOCKED' });
    for (let i = 0; i < 3; i++) reward(service, id, `license-${i}`);
    service.unlock(id, 'special:terran');
    const run = await service.beginRun(id, options);
    const state = createBattle(run.config);
    const inputs = [{ tick: 0, ownerId: 'p1', input: { seq: 0, manual: true, moveX: 0.5, moveY: 0, aimX: 1800, aimY: 900, fire: true, ability: true } }];
    assert.equal(applyPilotInput(state, 'p1', inputs[0].input).ok, true);
    while (!state.ended) stepBattle(state);
    at += 600_000;
    const verified = await service.completeRun(id, run.runId, inputs);
    assert.deepEqual(verified.result, getResult(state));
    await assert.rejects(service.completeRun(id, run.runId, []), { code: 'REPLAY_CHANGED' });
    const second = await service.beginRun(id, options);
    at += 600_000;
    await assert.rejects(service.completeRun(id, second.runId, [{ ...inputs[0], input: { ...inputs[0].input, moveX: 9999 } }]), { code: 'BAD_REPLAY' });
  } finally { service.close(); }
});

test('an unlicensed pilot is rejected before reading expensive battle setup', async () => {
  const service = createProfileService({ filename: ':memory:' });
  try {
    const { id } = await identity(service);
    await assert.rejects(service.beginRun(id, {
      fleet: { faction: 'terran', pilot: true, ships: [{ cls: 'ter_falcao', count: 2 }] },
      get setup() { assert.fail('Unauthorised request reached battle setup'); },
    }), { code: 'CONTENT_LOCKED' });
  } finally { service.close(); }
});

test('verification limits migrate the previous database schema without changing progress', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fe-profiles-migration-'));
  const options = { dataDir: directory, policy: { rewardIntervalMs: 0 } };
  let service = createProfileService(options);
  try {
    const { id, cookie } = await identity(service);
    for (let i = 0; i < 3; i++) reward(service, id, `license-${i}`);
    service.unlock(id, 'special:terran');
    const run = await service.beginRun(id, { setup: { level: 1 }, fleet: { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 2 }] } });
    const before = service.getProfile(id);
    service.close();
    const oldDatabase = new DatabaseSync(path.join(directory, 'profiles.sqlite'));
    oldDatabase.exec('DROP TABLE verification_failures; ALTER TABLE runs DROP COLUMN verify_attempts; ALTER TABLE runs DROP COLUMN last_verify_at;');
    oldDatabase.close();
    service = createProfileService(options);
    const after = service.getProfile(id);
    assert.equal(after.points, before.points);
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.unlocks, before.unlocks);
    assert.equal(service.authenticateRequest({ headers: { cookie } }), id);
    const resumed = await service.beginRun(id, { setup: { level: 1 }, fleet: { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 2 }] } });
    assert.equal(resumed.runId, run.runId);
    const inspector = new DatabaseSync(path.join(directory, 'profiles.sqlite'), { readOnly: true });
    const row = inspector.prepare('SELECT verify_attempts,last_verify_at FROM runs WHERE id=?').get(run.runId);
    assert.equal(row.verify_attempts, 0); assert.equal(row.last_verify_at, null);
    inspector.close();
  } finally { service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('invalid replay work is cached, rate limited and capped even across a server restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fe-replay-limits-'));
  let at = 1_000_000;
  const options = { dataDir: directory, now: () => at, policy: { rewardIntervalMs: 0 } };
  let service = createProfileService(options);
  const inspector = new DatabaseSync(path.join(directory, 'profiles.sqlite'), { readOnly: true });
  try {
    const { id } = await identity(service);
    for (let i = 0; i < 3; i++) reward(service, id, `license-${i}`);
    service.unlock(id, 'special:terran');
    const run = await service.beginRun(id, { setup: { level: 1, teamSize: 1, difficulty: 'facil', resourceMul: 0.5 }, fleet: { faction: 'terran', pilot: true, ships: [{ cls: 'ter_falcao', count: 2 }] } });
    const simulated = createBattle(run.config);
    while (!simulated.ended) stepBattle(simulated);
    assert.ok(simulated.tick < MAX_TICKS - 1, 'Fixture must end before the late pilot command');
    at += 600_000;
    const bad = (seq) => [{ tick: MAX_TICKS - 1, ownerId: 'p1', input: { seq, manual: false } }];
    const attempts = () => inspector.prepare('SELECT verify_attempts FROM runs WHERE id=?').get(run.runId).verify_attempts;
    // These are valid command shapes; only a full replay discovers that the
    // battle ended before the command. Concurrent duplicates share that work.
    const duplicate = await Promise.allSettled([service.completeRun(id, run.runId, bad(0)), service.completeRun(id, run.runId, bad(0))]);
    for (const response of duplicate) { assert.equal(response.status, 'rejected'); assert.equal(response.reason.code, 'BAD_REPLAY'); }
    assert.equal(attempts(), 1);
    await assert.rejects(service.completeRun(id, run.runId, bad(0)), { code: 'BAD_REPLAY' });
    assert.equal(attempts(), 1);
    await assert.rejects(service.completeRun(id, run.runId, bad(1)), { code: 'VERIFICATION_RATE_LIMIT' });
    assert.equal(attempts(), 1);
    at += 5000;
    await assert.rejects(service.completeRun(id, run.runId, bad(1)), { code: 'BAD_REPLAY' });
    assert.equal(attempts(), 2);
    at += 5000;
    await assert.rejects(service.completeRun(id, run.runId, bad(2)), { code: 'BAD_REPLAY' });
    assert.equal(attempts(), 3);
    service.close(); service = createProfileService(options);
    at += 5000;
    await assert.rejects(service.completeRun(id, run.runId, bad(0)), { code: 'BAD_REPLAY' });
    await assert.rejects(service.completeRun(id, run.runId, bad(3)), { code: 'RUN_VERIFICATION_LIMIT' });
    assert.equal(attempts(), 3);
    assert.equal(inspector.prepare('SELECT COUNT(*) count FROM verification_failures WHERE run_id=?').get(run.runId).count, 3);
    // Replacing a run also removes its bounded negative cache.
    await service.beginRun(id, { setup: { level: 2 }, fleet: { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 2 }] } });
    assert.equal(inspector.prepare('SELECT COUNT(*) count FROM verification_failures WHERE run_id=?').get(run.runId).count, 0);
  } finally { inspector.close(); service.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('corrected replay may succeed on the final attempt and success retries consume no work', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fe-replay-success-'));
  let at = 1_000_000;
  const service = createProfileService({ dataDir: directory, now: () => at, policy: { rewardIntervalMs: 0 } });
  const inspector = new DatabaseSync(path.join(directory, 'profiles.sqlite'), { readOnly: true });
  try {
    const { id } = await identity(service);
    for (let i = 0; i < 3; i++) reward(service, id, `license-${i}`);
    service.unlock(id, 'special:terran');
    const run = await service.beginRun(id, { setup: { level: 1, resourceMul: 0.5 }, fleet: { faction: 'terran', pilot: true, ships: [{ cls: 'ter_falcao', count: 2 }] } });
    const simulated = createBattle(run.config);
    while (!simulated.ended) stepBattle(simulated);
    assert.ok(simulated.tick < MAX_TICKS - 1);
    at += 600_000;
    for (let seq = 0; seq < 2; seq++) {
      await assert.rejects(service.completeRun(id, run.runId, [{ tick: MAX_TICKS - 1, ownerId: 'p1', input: { seq, manual: false } }]), { code: 'BAD_REPLAY' });
      at += 5000;
    }
    const completions = await Promise.all([service.completeRun(id, run.runId), service.completeRun(id, run.runId)]);
    assert.deepEqual(completions[0].result, getResult(simulated));
    assert.deepEqual(completions[1].profile, completions[0].profile);
    const repeated = await service.completeRun(id, run.runId);
    assert.deepEqual(repeated.profile, completions[0].profile);
    assert.equal(inspector.prepare('SELECT verify_attempts FROM runs WHERE id=?').get(run.runId).verify_attempts, 3);
    assert.equal(repeated.profile.history.filter((entry) => entry.matchId === `sp:${run.runId}`).length, 1);
  } finally { inspector.close(); service.close(); rmSync(directory, { recursive: true, force: true }); }
});
