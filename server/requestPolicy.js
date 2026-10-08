// Reverse-proxy trust is opt-in. Host/proto forwarding headers never select
// the credential origin, and an untrusted peer cannot choose its rate-limit IP.
import { BlockList, isIP, SocketAddress } from 'node:net';

export function normalizeAddress(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return null;
  const address = new SocketAddress({ address: value, family: isIP(value) === 4 ? 'ipv4' : 'ipv6' }).address;
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export function createRequestPolicy({ trustedProxies = [], publicOrigin, secure = false } = {}) {
  const entries = typeof trustedProxies === 'string'
    ? trustedProxies.split(',').map((entry) => entry.trim()).filter(Boolean) : trustedProxies;
  if (!Array.isArray(entries)) throw new Error('FE_TRUSTED_PROXIES deve conter IPs ou redes CIDR separados por vírgulas');
  const networks = new BlockList();
  for (const entry of entries) {
    if (typeof entry !== 'string') throw new Error('FE_TRUSTED_PROXIES inválido');
    const parts = entry.split('/');
    const address = normalizeAddress(parts[0]);
    const bits = address && isIP(address) === 4 ? 32 : 128;
    // Use IPv4 notation for mapped IPv4 networks to avoid ambiguous prefixes.
    if (!address || parts.length > 2 || (parts.length === 2 && parts[0].includes(':') && bits === 32)) throw new Error(`FE_TRUSTED_PROXIES inválido: ${entry}`);
    const family = bits === 32 ? 'ipv4' : 'ipv6';
    if (parts.length === 1) networks.addAddress(address, family);
    else {
      const prefix = Number(parts[1]);
      if (!/^\d+$/.test(parts[1]) || prefix < 0 || prefix > bits) throw new Error(`FE_TRUSTED_PROXIES inválido: ${entry}`);
      networks.addSubnet(address, prefix, family);
    }
  }
  let fixedOrigin;
  if (publicOrigin !== undefined && publicOrigin !== '') {
    try {
      const url = new URL(publicOrigin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== publicOrigin) throw new Error();
      if ((url.protocol === 'https:') !== secure) throw new Error();
      fixedOrigin = url.origin;
    } catch {
      throw new Error('FE_PUBLIC_ORIGIN deve ser uma origem HTTP(S) sem caminho; HTTPS exige FE_COOKIE_SECURE=1');
    }
  }
  const trusted = (address) => networks.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');

  function clientAddress(req) {
    const peer = normalizeAddress(req.socket?.remoteAddress);
    if (!peer) return 'unknown';
    if (!trusted(peer)) return peer;
    const header = req.headers['x-forwarded-for'];
    if (typeof header !== 'string' || header.length > 2048) return peer;
    const chain = header.split(',');
    if (chain.length > 32) return peer;
    const addresses = chain.map((value) => normalizeAddress(value.trim()));
    if (addresses.some((address) => !address)) return peer;
    let address = peer;
    for (let i = addresses.length - 1; i >= 0 && trusted(address); i--) address = addresses[i];
    return address;
  }

  function permitsOrigin(req) {
    const origin = req.headers.origin;
    // Native clients have no browser Origin; credentials remain explicit.
    if (origin === undefined) return true;
    if (typeof origin !== 'string') return false;
    try {
      const candidate = new URL(origin);
      if (!['http:', 'https:'].includes(candidate.protocol) || candidate.origin !== origin) return false;
      const expected = fixedOrigin || new URL(`${secure || req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host}`).origin;
      return candidate.origin === expected;
    } catch { return false; }
  }

  return { clientAddress, permitsOrigin };
}
