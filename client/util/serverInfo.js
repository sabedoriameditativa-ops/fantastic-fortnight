import { h } from './dom.js';

// A single same-origin request per page load. Static builds never create this client.
export function createServerInfoClient({ fetch: fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  let request;
  return {
    load() {
      if (!request) request = (async () => {
        if (!fetcher) return null;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetcher('/health', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal, redirect: 'error' });
          if (!response.ok) return null;
          const value = await response.json();
          return value?.ok === true ? value.capabilities || null : null;
        } catch { return null; }
        finally { clearTimeout(timeout); }
      })();
      return request;
    },
  };
}

export function serverStorageNotice(ctx) {
  if (ctx.isStatic || !ctx.serverInfo) return null;
  const note = h('p.small.server-storage-notice', { test: 'server-storage-notice', hidden: true, role: 'note' });
  ctx.serverInfo.load().then(info => {
    if (info?.profilePersistence !== 'ephemeral' && info?.profilePersistence !== 'memory') return;
    note.textContent = 'Servidor de testes com dados temporários: pontos, histórico e desbloqueios online podem reiniciar com o servidor. Salas em andamento também são encerradas. A campanha e as frotas salvas neste navegador permanecem separadas.';
    note.hidden = false;
  });
  return note;
}
