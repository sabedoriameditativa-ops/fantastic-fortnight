// Device-local fleet blueprints. This library is independent of server points.
import { localStore, readJson, readString, writeJson, loadLastFleet } from './storage.js';
import { validateFleet, fleetSummary } from '../../shared/fleet.js';

export const FLEET_LIBRARY_KEY = 'fe.fleetLibrary.v1';
export const MAX_SAVED_FLEETS = 40;
const copy = (v) => JSON.parse(JSON.stringify(v));
const cleanName = (value) => String(value || 'Minha frota').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 48) || 'Minha frota';

function safeFleet(fleet) {
  try {
    if (!validateFleet(fleet, Infinity).ok) return null;
    // Keep tactical fields added by future versions instead of destroying them
    // through fleet normalization. The original lastFleet also remains intact.
    return JSON.stringify(fleet).length <= 32_768 ? copy(fleet) : null;
  } catch { return null; }
}

function readLibrary(store) {
  const raw = readJson(store, FLEET_LIBRARY_KEY, null);
  if (raw?.version === 1 && Array.isArray(raw.entries)) return raw;
  // Unknown/future schemas and corrupt JSON stay untouched for recovery.
  if (readString(store, FLEET_LIBRARY_KEY, '')) return { version: 1, entries: [], protected: true };
  return { version: 1, entries: [], migratedLastFleet: false };
}

/** First successful read migrates the last fleet exactly once, without deleting it. */
export function listFleets(store = localStore()) {
  const lib = readLibrary(store);
  if (lib.protected) return [];
  if (!lib.migratedLastFleet) {
    const fleet = safeFleet(loadLastFleet(store));
    if (fleet && lib.entries.length < MAX_SAVED_FLEETS) {
      const now = Date.now();
      lib.entries.push({ id: 'legacy-last-fleet', name: 'Última frota (importada)', fleet, createdAt: now, updatedAt: now });
    }
    lib.migratedLastFleet = true;
    writeJson(store, FLEET_LIBRARY_KEY, lib);
  }
  return lib.entries.filter((e) => e && typeof e.id === 'string' && safeFleet(e.fleet)).map(copy);
}

export function saveFleet({ id, name, fleet, plan } = {}, store = localStore()) {
  const safe = safeFleet(fleet);
  if (!safe) return { ok: false, error: 'Frota inválida.' };
  let safePlan;
  try {
    if (plan !== undefined) {
      if (JSON.stringify(plan).length > 4096) return { ok: false, error: 'Plano muito grande.' };
      safePlan = copy(plan);
    }
  } catch { return { ok: false, error: 'Plano inválido.' }; }
  listFleets(store);
  const lib = readLibrary(store);
  if (lib.protected) return { ok: false, error: 'A biblioteca existente não pode ser lida; seus dados foram preservados.' };
  const index = id ? lib.entries.findIndex((e) => e.id === id) : -1;
  if (id && index < 0) return { ok: false, error: 'Frota não encontrada.' };
  if (index < 0 && lib.entries.length >= MAX_SAVED_FLEETS) return { ok: false, error: `Limite de ${MAX_SAVED_FLEETS} frotas.` };
  const now = Date.now();
  const entry = {
    id: index >= 0 ? id : (globalThis.crypto?.randomUUID?.() || `fleet-${now.toString(36)}-${Math.random().toString(36).slice(2)}`),
    name: cleanName(name), fleet: safe, createdAt: index >= 0 ? lib.entries[index].createdAt : now, updatedAt: now,
  };
  if (safePlan !== undefined) entry.plan = safePlan;
  else if (index >= 0 && lib.entries[index].plan !== undefined) entry.plan = lib.entries[index].plan;
  if (index >= 0) lib.entries[index] = entry;
  else lib.entries.push(entry);
  return writeJson(store, FLEET_LIBRARY_KEY, lib) ? { ok: true, entry: copy(entry) } : { ok: false, error: 'Armazenamento indisponível ou cheio; a frota anterior foi preservada.' };
}

export function duplicateFleet(id, name, store = localStore()) {
  const entry = listFleets(store).find((e) => e.id === id);
  if (!entry) return { ok: false, error: 'Frota não encontrada.' };
  return saveFleet({ name: name || `${entry.name} (cópia)`, fleet: entry.fleet, plan: entry.plan }, store);
}

export function removeFleet(id, store = localStore()) {
  listFleets(store);
  const lib = readLibrary(store);
  if (lib.protected) return false;
  lib.entries = lib.entries.filter((e) => e.id !== id);
  return writeJson(store, FLEET_LIBRARY_KEY, lib);
}

export function compareFleets(a, b) {
  const left = a?.fleet || a, right = b?.fleet || b;
  const first = fleetSummary(left), second = fleetSummary(right);
  const counts = (fleet) => new Map((fleet?.ships || []).map((e) => [e.cls, e.count]));
  const ca = counts(left), cb = counts(right);
  return {
    left: first, right: second,
    delta: Object.fromEntries(['cost', 'count', 'ehp', 'dps'].map((k) => [k, Math.round((second[k] - first[k]) * 100) / 100])),
    ships: [...new Set([...ca.keys(), ...cb.keys()])].map((cls) => ({ cls, left: ca.get(cls) || 0, right: cb.get(cls) || 0, delta: (cb.get(cls) || 0) - (ca.get(cls) || 0) })),
  };
}
