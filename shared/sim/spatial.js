// Uniform grid spatial hash for ships. Rebuilt every tick; cells keep ids in
// insertion (= id) order and queries scan cells in fixed (row, col) order, so
// results are deterministic. No per-tick allocation: cell arrays are reused.

export const CELL_SIZE = 200;

/**
 * @param {number} w world width
 * @param {number} h world height
 * @param {number} [cell]
 */
export function createGrid(w, h, cell = CELL_SIZE) {
  const cols = Math.max(1, Math.ceil(w / cell) + 1);
  const rows = Math.max(1, Math.ceil(h / cell) + 1);
  const cells = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = [];
  return { w, h, cell, cols, rows, cells, count: 0 };
}

/** Empty every cell (keeps arrays). */
export function clearGrid(grid) {
  const cells = grid.cells;
  for (let i = 0; i < cells.length; i++) cells[i].length = 0;
  grid.count = 0;
}

function cellX(grid, x) {
  const c = Math.floor(x / grid.cell);
  return c < 0 ? 0 : c >= grid.cols ? grid.cols - 1 : c;
}
function cellY(grid, y) {
  const r = Math.floor(y / grid.cell);
  return r < 0 ? 0 : r >= grid.rows ? grid.rows - 1 : r;
}

/** Insert an id at (x, y). Call in ascending id order for determinism. */
export function insertGrid(grid, id, x, y) {
  grid.cells[cellY(grid, y) * grid.cols + cellX(grid, x)].push(id);
  grid.count++;
}

/**
 * Collect ids whose cell intersects the circle's bounding box into `out`
 * (out.length reset to 0). The caller filters by exact distance. Cells are
 * scanned in (row, col) ascending order.
 * @returns {number[]} out
 */
export function queryBox(grid, x, y, r, out) {
  out.length = 0;
  const x0 = cellX(grid, x - r), x1 = cellX(grid, x + r);
  const y0 = cellY(grid, y - r), y1 = cellY(grid, y + r);
  const cells = grid.cells, cols = grid.cols;
  for (let cy = y0; cy <= y1; cy++) {
    const base = cy * cols;
    for (let cx = x0; cx <= x1; cx++) {
      const c = cells[base + cx];
      for (let i = 0; i < c.length; i++) out.push(c[i]);
    }
  }
  return out;
}

/**
 * Exact circle query over ships: pushes ship objects (alive only) within r of
 * (x, y) into `out`, optionally filtered by team (-1 = any) and by a predicate.
 * @param {object} grid
 * @param {object[]} ships ships array (index = id - 1)
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {object[]} out reused output array
 * @param {number} [team] -1 any
 * @param {number[]} [scratch] reused id buffer
 */
export function queryCircle(grid, ships, x, y, r, out, team = -1, scratch = SCRATCH) {
  out.length = 0;
  queryBox(grid, x, y, r, scratch);
  const r2 = r * r;
  for (let i = 0; i < scratch.length; i++) {
    const s = ships[scratch[i] - 1];
    if (!s.alive) continue;
    if (team >= 0 && s.team !== team) continue;
    const dx = s.x - x, dy = s.y - y;
    if (dx * dx + dy * dy <= r2) out.push(s);
  }
  return out;
}

const SCRATCH = [];
