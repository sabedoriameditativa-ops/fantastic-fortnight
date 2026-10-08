// Cookie authentication must not make a same-site, cross-origin page a
// commander. Native clients may omit Origin; browsers cannot spoof it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, envConfig } from '../../server/index.js';
import { createTestClient } from './helpers.js';

async function setup(t, options = {}) {
  const server = await startServer({ port: 0, secure: false, ...options, log: { warn() {} } });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await server.close();
  });
  const authority = `127.0.0.1:${server.port}`;
  const origin = `http://${authority}`;
  const response = await fetch(`${origin}/api/profile`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const profile = (await response.json()).profile;
  const cookieHeader = response.headers.get('set-cookie');
  const cookie = cookieHeader.split(';')[0];
  function client(headers) {
    const c = createTestClient(`ws://${authority}`, 'Origin test', { headers });
    clients.push(c);
    return c;
  }
  return { server, authority, origin, profile, cookie, cookieHeader, client };
}

test('WS denies foreign browser origins before cookie authentication and keeps native reconnect working', async (t) => {
  const { server, authority, origin, profile, cookie, client } = await setup(t);
  let authentications = 0;
  const authenticate = server.profiles.authenticateRequest;
  server.profiles.authenticateRequest = (req) => { authentications++; return authenticate(req); };
  const native = client({ Cookie: cookie });
  await native.open;
  const welcome = await native.hello();
  assert.equal(server.sessions.get(welcome.playerId).profileId, profile.id);
  for (const bad of [
    `http://127.0.0.1:${server.port === 65535 ? 65534 : server.port + 1}`,
    'http://attacker.example', `https://${authority}`, 'null', 'not-an-origin',
    `${origin}/unexpected-path`, `${origin}?unexpected=1`, `http://user@${authority}`,
  ]) {
    const before = authentications;
    const denied = client({ Cookie: cookie, Origin: bad, 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'attacker.example' });
    await assert.rejects(denied.open, /Unexpected server response: 403/, bad);
    assert.equal(authentications, before, 'denied origins cannot reach cookie authentication');
    assert.equal(server.sessions.size, 1);
  }
  await native.close();
  const resumed = client({ Cookie: cookie });
  await resumed.open;
  assert.equal((await resumed.hello({ token: welcome.token })).playerId, welcome.playerId, 'native clients may resume without Origin');
  const browser = client({ Cookie: cookie, Origin: origin });
  await browser.open;
  const browserWelcome = await browser.hello();
  assert.equal(server.sessions.get(browserWelcome.playerId).profileId, profile.id);
});

test('explicit HTTPS proxy mode accepts only HTTPS origin and sets Secure cookie', async (t) => {
  const { server, authority, cookie, cookieHeader, client } = await setup(t, { secure: true });
  assert.match(cookieHeader, /; Secure(?:;|$)/);
  const browser = client({ Cookie: cookie, Origin: `https://${authority}`, 'X-Forwarded-Proto': 'http' });
  await browser.open;
  assert.equal((await browser.hello()).t, 'welcome');
  const insecure = client({ Cookie: cookie, Origin: `http://${authority}`, 'X-Forwarded-Proto': 'https' });
  await assert.rejects(insecure.open, /Unexpected server response: 403/);
  assert.equal(server.sessions.size, 1);
});

test('FE_COOKIE_SECURE explicitly configures HTTPS proxy origin policy', () => {
  const old = process.env.FE_COOKIE_SECURE;
  try {
    process.env.FE_COOKIE_SECURE = '1';
    assert.equal(envConfig().secure, true);
    process.env.FE_COOKIE_SECURE = '0';
    assert.equal(envConfig().secure, false);
  } finally {
    if (old === undefined) delete process.env.FE_COOKIE_SECURE;
    else process.env.FE_COOKIE_SECURE = old;
  }
});
