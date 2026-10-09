import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress } from '../../server/index.js';

const req = (headers, remote = '10.0.0.9') => ({ headers, socket: { remoteAddress: remote } });

test('clientAddress uses the socket address unless TRUST_PROXY is on', () => {
  assert.equal(clientAddress(req({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }), false), '10.0.0.9');
  assert.equal(clientAddress(req({}), false), '10.0.0.9');
});

test('clientAddress takes the first X-Forwarded-For entry when trusting the proxy', () => {
  assert.equal(clientAddress(req({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }), true), '203.0.113.5');
  assert.equal(clientAddress(req({ 'x-forwarded-for': ['198.51.100.7'] }), true), '198.51.100.7');
  assert.equal(clientAddress(req({}), true), '10.0.0.9');
  assert.equal(clientAddress(req({ 'x-forwarded-for': '  ' }), true), '10.0.0.9');
  assert.equal(clientAddress(undefined, true), undefined);
});
