import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestPolicy, normalizeAddress } from '../../server/requestPolicy.js';
import { startServer, envConfig } from '../../server/index.js';
import { createTestClient } from './helpers.js';

const req = (peer, forwarded, extra = {}) => ({ socket: { remoteAddress: peer }, headers: { host: 'game.example', 'x-forwarded-for': forwarded, ...extra } });

test('forwarded IP is ignored unless the immediate peer is explicitly trusted', () => {
  const direct = createRequestPolicy();
  assert.equal(direct.clientAddress(req('::ffff:127.0.0.1', '198.51.100.1')), '127.0.0.1');
  const policy = createRequestPolicy({ trustedProxies: '10.0.0.0/24, 2001:db8:1::/48' });
  assert.equal(policy.clientAddress(req('10.0.1.1', '198.51.100.1')), '10.0.1.1');
  assert.equal(policy.clientAddress(req('10.0.0.1', '192.0.2.99, 198.51.100.1, 10.0.0.2')), '198.51.100.1', 'spoofed left prefix stops at first untrusted hop');
  assert.equal(policy.clientAddress(req('2001:db8:1::2', '2001:0DB8:2:0:0::1')), '2001:db8:2::1');
  assert.equal(normalizeAddress('0:0:0:0:0:ffff:c000:201'), '192.0.2.1');
  for (const header of [undefined, '', 'unknown', '192.0.2.1:80', '192.0.2.1, invalid', Array(34).fill('192.0.2.1').join(',')]) {
    assert.equal(policy.clientAddress(req('10.0.0.1', header)), '10.0.0.1');
  }
});

test('invalid trust and origin configuration fails closed before startup', async () => {
  for (const trustedProxies of ['*', 'localhost', '10.0.0.1/-1', '10.0.0.1/33', '::1/129', '10.0.0.1/', '::ffff:127.0.0.1/128']) {
    assert.throws(() => createRequestPolicy({ trustedProxies }), /FE_TRUSTED_PROXIES/);
  }
  for (const publicOrigin of ['https://game.example/', 'https://user@game.example', 'null', 'https://game.example']) {
    await assert.rejects(startServer({ port: 0, secure: false, publicOrigin }), /FE_PUBLIC_ORIGIN/);
  }
});

test('fixed public origin ignores hostile Host/proto forwarding and applies to HTTP and WS', async (t) => {
  const server = await startServer({ port: 0, secure: true, publicOrigin: 'https://game.example' });
  const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); await server.close(); });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (origin) => fetch(`${base}/api/profile`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'http' }, body: '{}' });
  const good = await post('https://game.example');
  assert.equal(good.status, 200);
  assert.match(good.headers.get('set-cookie'), /; Secure/);
  for (const bad of ['https://evil.example', 'http://game.example', 'https://game.example:444', 'https://game.example/']) assert.equal((await post(bad)).status, 403);
  const browser = createTestClient(`ws://127.0.0.1:${server.port}`, 'proxy', { headers: { Origin: 'https://game.example' } });
  clients.push(browser); await browser.open; assert.equal((await browser.hello()).t, 'welcome');
  const bad = createTestClient(`ws://127.0.0.1:${server.port}`, 'host spoof', { headers: { Host: 'evil.example', Origin: 'https://evil.example' } });
  clients.push(bad); await assert.rejects(bad.open, /403/);
});

test('trusted proxy gives distinct socket and profile creation limits; spoofed prefixes cannot bypass either', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', secure: false, trustedProxies: '127.0.0.1', maxSocketsPerAddress: 1 });
  const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); await server.close(); });
  async function connect(forwarded) {
    const c = createTestClient(`ws://127.0.0.1:${server.port}`, 'proxy', { headers: { 'X-Forwarded-For': forwarded } });
    clients.push(c); await c.open; return c;
  }
  const a = await connect('198.51.100.1');
  const welcome = await a.hello();
  assert.equal(server.sessions.get(welcome.playerId).remoteAddress, '198.51.100.1');
  const b = await connect('198.51.100.2'); await b.hello();
  const spoof = await connect('192.0.2.99, 198.51.100.1');
  assert.equal((await spoof.waitClosed()).code, 4003);
  const post = (forwarded) => fetch(`http://127.0.0.1:${server.port}/api/profile`, { method: 'POST', headers: { 'X-Forwarded-For': forwarded, 'Content-Type': 'application/json' }, body: '{}' });
  for (let i = 0; i < 32; i++) assert.equal((await post('198.51.100.1')).status, 200);
  assert.equal((await post('192.0.2.99, 198.51.100.1')).status, 429);
  assert.equal((await post('198.51.100.2')).status, 200);
});

test('untrusted forwarded IPs do not evade real socket limits', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', secure: false, maxSocketsPerAddress: 1 });
  const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); await server.close(); });
  for (let i = 1; i <= 2; i++) {
    const c = createTestClient(`ws://127.0.0.1:${server.port}`, 'direct', { headers: { 'X-Forwarded-For': `198.51.100.${i}` } });
    clients.push(c); await c.open;
    if (i === 1) assert.equal(server.sessions.get((await c.hello()).playerId).remoteAddress, '127.0.0.1');
    else assert.equal((await c.waitClosed()).code, 4003);
  }
});

test('environment exposes explicit proxy/origin/ephemeral settings', () => {
  const values = { FE_TRUSTED_PROXIES: '10.0.0.1/32', FE_PUBLIC_ORIGIN: 'https://game.example', FE_EPHEMERAL_DATA: '1' };
  const old = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    const config = envConfig();
    assert.equal(config.trustedProxies, values.FE_TRUSTED_PROXIES);
    assert.equal(config.publicOrigin, values.FE_PUBLIC_ORIGIN);
    assert.equal(config.ephemeralData, true);
  } finally { for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
