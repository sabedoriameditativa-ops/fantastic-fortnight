import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, clearGrid, insertGrid, queryCircle, queryBox } from '../../shared/sim/spatial.js';
import { createRng } from '../../shared/rng.js';

function makeShips(n, w, h, rng) {
  const ships = [];
  for (let i = 0; i < n; i++) ships.push({ id: i + 1, x: rng.range(0, w), y: rng.range(0, h), alive: rng.next() > 0.1, team: i % 2 });
  return ships;
}

test('queryCircle matches brute force for 1000 points × 50 queries (same set, same id order)', () => {
  const rng = createRng('spatial');
  const w = 4000, h = 2250;
  const grid = createGrid(w, h);
  const ships = makeShips(1000, w, h, rng);
  for (const s of ships) if (s.alive) insertGrid(grid, s.id, s.x, s.y);
  const out = [];
  for (let q = 0; q < 50; q++) {
    const x = rng.range(-100, w + 100), y = rng.range(-100, h + 100), r = rng.range(10, 900);
    const team = q % 3 === 0 ? -1 : q % 2;
    queryCircle(grid, ships, x, y, r, out, team);
    const brute = ships.filter((s) => s.alive && (team < 0 || s.team === team) && (s.x - x) ** 2 + (s.y - y) ** 2 <= r * r).map((s) => s.id).sort((a, b) => a - b);
    const got = out.map((s) => s.id).sort((a, b) => a - b);
    assert.deepEqual(got, brute);
  }
});

test('queries are deterministic and cells keep id order; rebuild clears', () => {
  const grid = createGrid(1000, 1000);
  insertGrid(grid, 5, 10, 10); insertGrid(grid, 7, 20, 20); insertGrid(grid, 9, 900, 900);
  const out = [];
  queryBox(grid, 15, 15, 50, out);
  assert.deepEqual(out, [5, 7]);
  queryBox(grid, 15, 15, 50, out);
  assert.deepEqual(out, [5, 7]);
  clearGrid(grid);
  queryBox(grid, 15, 15, 50, out);
  assert.deepEqual(out, []);
  assert.equal(grid.count, 0);
  // out-of-range coordinates are clamped to edge cells, never throw
  insertGrid(grid, 1, -500, 5000);
  queryBox(grid, -1000, 9000, 10, out);
  assert.deepEqual(out, [1]);
});
