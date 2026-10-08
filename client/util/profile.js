// The browser never reads, saves or transmits a profile credential itself.
// A same-origin HttpOnly cookie binds requests to this server and device.
export function createProfileClient({ fetch: fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  let snapshot = null;
  let ensuring = null;
  const listeners = new Set();
  function publish(profile) {
    if (profile) {
      snapshot = profile;
      for (const listener of listeners) { try { listener(snapshot); } catch { /* one view must not break the request */ } }
    }
    return snapshot;
  }
  async function request(suffix = '', data, method = 'POST') {
    if (!fetcher) throw Object.assign(new Error('Perfil indisponível offline.'), { code: 'PROFILE_OFFLINE' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), suffix === '/complete' ? 25_000 : 8000);
    try {
      const response = await fetcher(`/api/profile${suffix}`, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || 'PROFILE_UNAVAILABLE'), { code: result.error, status: response.status });
      if (result.profile) publish(result.profile);
      return result;
    } finally { clearTimeout(timer); }
  }
  async function ensure() {
    if (snapshot) return snapshot;
    if (!ensuring) ensuring = request().then((r) => r.profile).finally(() => { ensuring = null; });
    return ensuring;
  }
  return {
    get snapshot() { return snapshot; },
    ensure,
    async refresh() { await ensure(); return (await request('', undefined, 'GET')).profile; },
    async unlock(id) { await ensure(); return (await request('/unlock', { id })).profile; },
    async migrateLegacy(progress) { await ensure(); return (await request('/legacy', { progress })).profile; },
    async beginRun(options) { await ensure(); return request('/run', options); },
    async completeRun(runId, options = {}) { await ensure(); return request('/complete', { runId, ...options }); },
    subscribe(listener) {
      listeners.add(listener);
      if (snapshot) listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
}
