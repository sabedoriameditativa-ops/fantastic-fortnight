import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfileClient } from '../../client/util/profile.js';

test('profile requests stay same-origin, reject redirects, and share initialization', async () => {
  const calls = [];
  const profile = { id: 'device-public-id', points: 28, unlocks: [] };
  const client = createProfileClient({ fetch: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ profile }) };
  } });
  assert.equal(client.snapshot, null);
  await Promise.all([client.ensure(), client.ensure()]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/profile');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.body, '{}');
  let seen;
  const stop = client.subscribe((value) => { seen = value; });
  assert.equal(seen, profile);
  await client.migrateLegacy({ normal: { max: 2, cleared: [1, 2] } });
  assert.equal(calls[1].url, '/api/profile/legacy');
  assert.equal(client.snapshot.points, 28); stop();
});

test('failed rewards do not replace the last known server profile', async () => {
  let count = 0;
  const client = createProfileClient({ fetch: async () => ++count === 1
    ? { ok: true, json: async () => ({ profile: { points: 10 } }) }
    : { ok: false, status: 409, json: async () => ({ error: 'RUN_TOO_EARLY' }) } });
  await client.ensure();
  await assert.rejects(client.completeRun('run'), { code: 'RUN_TOO_EARLY', status: 409 });
  assert.equal(client.snapshot.points, 10);
});
