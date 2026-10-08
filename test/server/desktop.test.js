import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { desktopConfig } from '../../server/desktop.js';

const ENTRY = fileURLToPath(new URL('../../server/desktop.js', import.meta.url));

function launch(t, dataDir, { port = '0', extraEnv = {}, eof = false } = {}) {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: path.dirname(dataDir), shell: false,
    env: { ...process.env, FE_DESKTOP_DATA_DIR: dataDir, FE_DESKTOP_PORT: String(port), ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', pending = '';
  const events = [];
  let firstResolve, firstReject;
  const first = new Promise((resolve, reject) => { firstResolve = resolve; firstReject = reject; });
  // A process failure is observed by first/closed, never an unhandled rejection.
  first.catch(() => {});
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text) => {
    stdout += text; pending += text;
    for (;;) {
      const end = pending.indexOf('\n');
      if (end < 0) break;
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (!line) continue;
      try { const event = JSON.parse(line); events.push(event); firstResolve(event); }
      catch (error) { firstReject(new Error(`Invalid desktop stdout: ${line}`, { cause: error })); }
    }
  });
  child.stderr.on('data', (text) => { stderr += text; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', (error) => { firstReject(error); reject(error); });
    child.once('close', (code, signal) => {
      if (!events.length) firstReject(new Error(`Desktop exited before readiness: ${code}; ${stderr}`));
      resolve({ code, signal, stdout, stderr, events });
    });
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  if (eof) child.stdin.end();
  return { child, first, closed };
}

function temporaryData() {
  const root = mkdtempSync(path.join(tmpdir(), 'Frota Estelar ação '));
  return { root, dataDir: path.join(root, 'dados do comandante Ágata') };
}

async function jsonRequest(url, route, data, cookie) {
  const response = await fetch(`${url}${route}`, {
    method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000),
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { response, value: await response.json() };
}

test('desktop configuration keeps the legacy localhost port and validates only desktop inputs', () => {
  const dir = path.resolve(tmpdir(), 'Frota Estelar');
  assert.deepEqual(desktopConfig({ FE_DESKTOP_DATA_DIR: dir, PORT: '9999', HOST: '0.0.0.0' }), { dataDir: dir, port: 3000 });
  assert.equal(desktopConfig({ FE_DESKTOP_DATA_DIR: dir, FE_DESKTOP_PORT: '0' }).port, 0);
  for (const port of ['-1', '65536', '3.5', '', '3000;bad', ' 3000']) assert.throws(() => desktopConfig({ FE_DESKTOP_DATA_DIR: dir, FE_DESKTOP_PORT: port }));
  assert.throws(() => desktopConfig({}));
  assert.throws(() => desktopConfig({ FE_DESKTOP_DATA_DIR: 'relative-data' }));
});

test('desktop serves assets and verifier, persists a Unicode-path profile and restarts on the same origin', { timeout: 15_000 }, async (t) => {
  const { root, dataDir } = temporaryData(t);
  let active;
  try {
    active = launch(t, dataDir, { extraEnv: {
      PORT: '1', HOST: '0.0.0.0', FE_MAX_TICKS: '1', FE_TICK_MS: '1', FE_COUNTDOWN_MS: '1',
      FE_DATA_DIR: path.join(root, 'incorrect'), FE_COOKIE_SECURE: '1', FE_PROGRESSION_POLICY: '{"dailyGainCap":1}',
    } });
    const ready = await active.first;
    assert.equal(ready.type, 'ready');
    assert.match(ready.url, /^http:\/\/localhost:\d+$/);
    const assets = [
      ['/', /^text\/html/, /Frota Estelar/], ['/styles.css', /^text\/css/, /body/],
      ['/battle/simWorker.js', /^text\/javascript/, /stepBattle/],
      ['/shared/sim/battle.js', /^text\/javascript/, /createBattle/],
      ['/shared/catalog.js', /^text\/javascript/, /FACTIONS/],
    ];
    for (const [route, mime, text] of assets) {
      const response = await fetch(`${ready.url}${route}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, route); assert.match(response.headers.get('content-type'), mime);
      assert.match(await response.text(), text);
    }
    const created = await jsonRequest(ready.url, '/api/profile', {});
    assert.equal(created.response.status, 200);
    assert.equal(created.value.profile.policy.dailyGainCap, 180);
    assert.doesNotMatch(created.response.headers.get('set-cookie'), /; Secure/);
    const cookie = created.response.headers.get('set-cookie').split(';')[0];
    await jsonRequest(ready.url, '/api/profile/legacy', { progress: { normal: { max: 2, cleared: [1, 2] } } }, cookie);
    const run = await jsonRequest(ready.url, '/api/profile/run', {
      playerName: 'Ágata', setup: { level: 1, difficulty: 'normal' },
      fleet: { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 1 }] },
    }, cookie);
    assert.equal(run.response.status, 200);
    const completed = await jsonRequest(ready.url, '/api/profile/complete', { runId: run.value.runId }, cookie);
    assert.ok(completed.response.status === 200 || (completed.response.status === 409 && completed.value.error === 'RUN_TOO_EARLY'));
    const inspector = new DatabaseSync(path.join(dataDir, 'profiles.sqlite'), { readOnly: true });
    const result = JSON.parse(inspector.prepare('SELECT result FROM runs WHERE id=?').get(run.value.runId).result);
    inspector.close();
    assert.ok(result.ticks > 1, 'Inherited FE_MAX_TICKS must not shorten desktop battles');
    active.child.stdin.write('shutdown\n');
    assert.equal((await active.closed).code, 0);
    assert.equal(existsSync(path.join(dataDir, 'profiles.sqlite')), true);
    assert.equal(existsSync(path.join(root, 'incorrect')), false);
    active = launch(t, dataDir, { port: new URL(ready.url).port });
    const restarted = await active.first;
    assert.deepEqual(restarted, ready);
    const restored = await jsonRequest(restarted.url, '/api/profile', undefined, cookie);
    assert.equal(restored.response.status, 200);
    assert.equal(restored.value.profile.id, created.value.profile.id);
    assert.deepEqual(restored.value.profile.legacyProgress.normal, { max: 2, cleared: [1, 2] });
    active.child.stdin.end();
    assert.equal((await active.closed).code, 0);
  } finally {
    if (active?.child.exitCode === null) { active.child.kill('SIGKILL'); await active.closed; }
    rmSync(root, { recursive: true, force: true });
  }
});

test('an occupied port reports one friendly error and leaves its owner running', { timeout: 8000 }, async (t) => {
  const { root, dataDir } = temporaryData(t);
  const owner = createServer((req, res) => res.end('existing owner'));
  await new Promise((resolve) => owner.listen(0, '127.0.0.1', resolve));
  const port = owner.address().port;
  try {
    const child = launch(t, dataDir, { port });
    const event = await child.first;
    assert.equal(event.type, 'error'); assert.match(event.message, /porta .*já está em uso/);
    const closed = await child.closed;
    assert.equal(closed.code, 1); assert.equal(closed.events.length, 1);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'existing owner');
  } finally {
    await new Promise((resolve) => owner.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test('stdin EOF before readiness does not leave an orphan server', { timeout: 8000 }, async (t) => {
  const { root, dataDir } = temporaryData(t);
  try {
    const child = launch(t, dataDir, { eof: true });
    assert.equal((await child.closed).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unusable data directory gives a friendly JSON startup error', { timeout: 8000 }, async (t) => {
  const { root, dataDir } = temporaryData(t);
  writeFileSync(dataDir, 'a file cannot be the database directory');
  try {
    const child = launch(t, dataDir);
    const event = await child.first;
    assert.equal(event.type, 'error'); assert.match(event.message, /pasta de dados/);
    assert.equal((await child.closed).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SIGINT and SIGTERM close the desktop server gracefully', { timeout: 10_000, skip: process.platform === 'win32' }, async (t) => {
  const { root, dataDir } = temporaryData(t);
  try {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const child = launch(t, dataDir);
      assert.equal((await child.first).type, 'ready');
      child.child.kill(signal);
      const closed = await child.closed;
      assert.equal(closed.code, 0); assert.equal(closed.signal, null);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
