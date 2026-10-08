import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, saveLastFleet, loadLastFleet, KEYS } from '../../client/util/storage.js';
import { listFleets, saveFleet, duplicateFleet, removeFleet, compareFleets, FLEET_LIBRARY_KEY } from '../../client/util/fleetLibrary.js';

const fleet = { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 2 }] };

test('last fleet migrates once, and named copies do not mutate the original', () => {
  const store = memoryStore();
  saveLastFleet(fleet, store);
  const first = listFleets(store);
  assert.equal(first.length, 1);
  assert.deepEqual(loadLastFleet(store), fleet);
  assert.equal(listFleets(store).length, 1);
  const saved = saveFleet({ name: 'Escolta', fleet, plan: { formation: 'wedge' } }, store);
  assert.equal(saved.ok, true);
  const copy = duplicateFleet(saved.entry.id, 'Escolta II', store);
  assert.equal(copy.ok, true);
  assert.notEqual(copy.entry.id, saved.entry.id);
  assert.deepEqual(copy.entry.plan, saved.entry.plan);
  copy.entry.fleet.ships[0].count = 9;
  assert.equal(listFleets(store).find((e) => e.id === saved.entry.id).fleet.ships[0].count, 2);
  assert.equal(removeFleet(saved.entry.id, store), true);
  assert.equal(listFleets(store).length, 2);
});

test('comparison calculates reusable blueprint differences', () => {
  const difference = compareFleets(fleet, { ...fleet, ships: [{ cls: 'ter_falcao', count: 4 }] });
  assert.equal(difference.delta.count, 2);
  assert.equal(difference.delta.cost, difference.left.cost);
  assert.deepEqual(difference.ships, [{ cls: 'ter_falcao', left: 2, right: 4, delta: 2 }]);
});

test('invalid and quota-limited saves preserve the previous data', () => {
  const store = memoryStore();
  saveFleet({ name: 'Seguro', fleet }, store);
  const before = store.getItem(FLEET_LIBRARY_KEY);
  assert.equal(saveFleet({ name: 'Inválida', fleet: { faction: '???', ships: [] } }, store).ok, false);
  const quota = { getItem: store.getItem, setItem() { throw new Error('quota'); } };
  assert.equal(saveFleet({ name: 'Nova', fleet }, quota).ok, false);
  assert.equal(store.getItem(FLEET_LIBRARY_KEY), before);
  store.setItem(KEYS.lastFleet, '{corrupt');
  assert.equal(listFleets(store).length, 1);
  store.setItem(FLEET_LIBRARY_KEY, '{unknown-existing-data');
  assert.deepEqual(listFleets(store), []);
  assert.equal(saveFleet({ name: 'Nova', fleet }, store).ok, false);
  assert.equal(removeFleet('anything', store), false);
  assert.equal(store.getItem(FLEET_LIBRARY_KEY), '{unknown-existing-data');
});
