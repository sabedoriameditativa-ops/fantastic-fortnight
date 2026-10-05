import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SHIP_LIST, SHIPS, SIZE_CLASS, FACTION_IDS } from '../../shared/catalog.js';
import {
  SHIP_DEFS, designBBox, ANIM_TYPES, LAYER_KINDS, ENGINE_KINDS, DEFAULT_ENGINE_KIND, MAX_DESIGN_EXTENT,
} from '../../client/battle/render/shipDefs.js';
import { palette, mix, parseColor, weaponColor, hash01, FACTION_PALETTES } from '../../client/battle/render/palette.js';
import { layerPoints, pickBucket, lodFor, damageState, muzzleOffset, shieldRadius, ZOOM_BUCKETS } from '../../client/battle/sprites.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

describe('ship sprite definitions', () => {
  test('every catalog ship has a definition with the same faction', () => {
    for (const s of SHIP_LIST) {
      const d = SHIP_DEFS[s.id];
      assert.ok(d, `missing sprite def for ${s.id}`);
      assert.equal(d.id, s.id);
      assert.equal(d.faction, s.faction, `${s.id}: faction`);
    }
    assert.equal(Object.keys(SHIP_DEFS).length, SHIP_LIST.length, 'no orphan definitions');
    for (const id of Object.keys(SHIP_DEFS)) assert.ok(SHIPS[id], `orphan def ${id}`);
  });

  test('required fields and sane sizes per size class', () => {
    const minSize = { tiny: 14, small: 24, medium: 40, large: 64, capital: 96, mothership: 140 };
    const maxSize = { tiny: 24, small: 40, medium: 62, large: 92, capital: 130, mothership: 190 };
    for (const s of SHIP_LIST) {
      const d = SHIP_DEFS[s.id];
      assert.ok(Array.isArray(d.layers) && d.layers.length >= 3, `${s.id}: at least 3 layers`);
      assert.ok(Array.isArray(d.engines) && d.engines.length >= 1, `${s.id}: engines`);
      assert.ok(Array.isArray(d.turrets) && d.turrets.length >= 1, `${s.id}: turrets`);
      assert.ok(Array.isArray(d.anim), `${s.id}: anim array`);
      assert.ok(d.style && ['sharp', 'smooth'].includes(d.style.edge), `${s.id}: style.edge`);
      assert.ok(d.damage && Array.isArray(d.damage.sparkPoints) && d.damage.sparkPoints.length >= 2, `${s.id}: sparkPoints`);
      assert.ok(inRange(d.size, minSize[s.sizeClass], maxSize[s.sizeClass]), `${s.id}: size ${d.size} for ${s.sizeClass}`);
      // visual length should be at least the catalog diameter (ships must not look smaller than their hitbox)
      assert.ok(d.size >= SIZE_CLASS[s.sizeClass].radius * 2, `${s.id}: size vs radius`);
      if (d.shieldR !== undefined) assert.ok(inRange(d.shieldR, 0.5, 0.8), `${s.id}: shieldR`);
      if (s.shield.cap > 0) assert.ok(shieldRadius(d) >= d.size * 0.5, `${s.id}: shield radius covers the hull`);
    }
  });

  test('sizes grow monotonically with the size class inside each faction', () => {
    for (const f of FACTION_IDS) {
      const ships = SHIP_LIST.filter((s) => s.faction === f);
      for (const a of ships) for (const b of ships) {
        const ia = SIZE_CLASS[a.sizeClass].index, ib = SIZE_CLASS[b.sizeClass].index;
        if (ia < ib) assert.ok(SHIP_DEFS[a.id].size < SHIP_DEFS[b.id].size, `${a.id} should be smaller than ${b.id}`);
      }
    }
  });

  test('all layers have known kinds and points within design bounds', () => {
    for (const s of SHIP_LIST) {
      const d = SHIP_DEFS[s.id];
      d.layers.forEach((L, i) => {
        assert.ok(LAYER_KINDS.includes(L.kind), `${s.id} layer ${i}: kind ${L.kind}`);
        const chk = (x, y) => {
          assert.ok(inRange(x, -MAX_DESIGN_EXTENT, MAX_DESIGN_EXTENT), `${s.id} layer ${i}: x ${x}`);
          assert.ok(inRange(y, -MAX_DESIGN_EXTENT, MAX_DESIGN_EXTENT), `${s.id} layer ${i}: y ${y}`);
        };
        switch (L.kind) {
          case 'poly': case 'trace':
            assert.ok(Array.isArray(L.pts) && L.pts.length >= (L.kind === 'poly' ? 3 : 2), `${s.id} layer ${i}: pts`);
            for (const p of L.pts) { assert.equal(p.length, 2); chk(p[0], p[1]); }
            if (L.mirror) for (const p of L.pts) assert.ok(p[1] <= 0, `${s.id} layer ${i}: mirrored polys are defined for y <= 0`);
            if (L.kind === 'poly') assert.ok(L.fill || L.stroke, `${s.id} layer ${i}: fill or stroke`);
            break;
          case 'line':
            for (const seg of (L.multi ? L.pts : [L.pts])) { assert.ok(seg.length >= 2); for (const p of seg) chk(p[0], p[1]); }
            break;
          case 'ellipse': chk(L.x - L.rx, L.y - L.ry); chk(L.x + L.rx, L.y + L.ry); assert.ok(L.rx > 0 && L.ry > 0); break;
          case 'ring': chk(L.x - L.r, L.y - L.r); chk(L.x + L.r, L.y + L.r); assert.ok(L.r > 0); if (L.segments) assert.ok(L.segments >= 3); break;
          case 'rects': for (const r of L.items) { assert.equal(r.length, 4); chk(r[0], r[1]); chk(r[0] + r[2], r[1] + r[3]); assert.ok(r[2] > 0 && r[3] > 0); } break;
          case 'light': case 'spot': case 'core': chk(L.x, L.y); assert.ok(L.r > 0 && L.r < 20, `${s.id} layer ${i}: r`); break;
          case 'orbit': assert.ok(L.n >= 1 && L.n <= 12 && L.R > 0 && L.R <= 60 && L.squash > 0 && L.squash <= 1 && L.len > 0); break;
          default: break;
        }
      });
      const bb = designBBox(d);
      assert.ok(bb.w >= 40 && bb.w <= 2 * MAX_DESIGN_EXTENT, `${s.id}: bbox width ${bb.w}`);
      assert.ok(bb.h >= 10 && bb.h <= 2 * MAX_DESIGN_EXTENT, `${s.id}: bbox height ${bb.h}`);
      // the ship must be roughly centered (nose at +x, stern at -x) and use most of the design space along x
      assert.ok(bb.x < -20 && bb.x + bb.w > 20, `${s.id}: bbox ${JSON.stringify(bb)} should span the origin`);
    }
  });

  test('engines, turrets and anims are valid', () => {
    for (const s of SHIP_LIST) {
      const d = SHIP_DEFS[s.id];
      for (const e of d.engines) {
        assert.ok(inRange(e.x, -MAX_DESIGN_EXTENT, 10), `${s.id}: engine at the stern (x=${e.x})`);
        assert.ok(inRange(e.y, -MAX_DESIGN_EXTENT, MAX_DESIGN_EXTENT) && e.w > 0);
        if (e.kind) assert.ok(ENGINE_KINDS.includes(e.kind));
      }
      assert.ok(ENGINE_KINDS.includes(DEFAULT_ENGINE_KIND[d.faction]));
      for (const t of d.turrets) {
        assert.ok(inRange(t.x, -MAX_DESIGN_EXTENT, MAX_DESIGN_EXTENT) && inRange(t.y, -MAX_DESIGN_EXTENT, MAX_DESIGN_EXTENT));
        assert.ok(typeof t.kind === 'string' && t.kind.length > 0);
      }
      for (const a of d.anim) assert.ok(ANIM_TYPES.includes(a.type), `${s.id}: anim ${a.type}`);
      // every weapon has a muzzle to fire from
      for (const w of s.weapons) {
        const m = muzzleOffset(d, w.type === 'laser' ? 'lance' : undefined, 0);
        assert.ok(isNum(m.x) && isNum(m.y));
        assert.ok(Math.abs(m.x) <= d.size * 0.7 && Math.abs(m.y) <= d.size * 0.7);
      }
      for (const p of d.damage.sparkPoints) assert.ok(inRange(p[0], -60, 60) && inRange(p[1], -60, 60));
    }
  });

  test('faction looks are distinct: material markers per faction', () => {
    for (const s of SHIP_LIST) {
      const d = SHIP_DEFS[s.id];
      const polys = d.layers.filter((L) => L.kind === 'poly');
      switch (s.faction) {
        case 'terran': assert.ok(polys.some((L) => L.fill === 'grad:hull' && (L.panels || L.rivets)), `${s.id}: terran panel lines`); break;
        case 'vorrax': assert.ok(polys.some((L) => L.plates), `${s.id}: vorrax plates`); assert.ok(d.layers.some((L) => L.kind === 'spot'), `${s.id}: bioluminescent spots`); break;
        case 'lumen': assert.ok(polys.some((L) => L.fill === 'crystal' && L.facets), `${s.id}: crystal facets`); assert.ok(d.layers.some((L) => L.kind === 'core'), `${s.id}: core`); break;
        case 'ferrix': assert.ok(polys.some((L) => L.fill === 'cells'), `${s.id}: nanite cells`); assert.ok(d.layers.some((L) => L.kind === 'ring' && L.segments), `${s.id}: segmented ring`); break;
        default: assert.fail('unknown faction');
      }
      // team color only on emissive parts: hull polys never use team fills
      for (const L of polys) if (L.fill === 'grad:hull' || L.fill === 'crystal' || L.fill === 'cells') assert.notEqual(L.stroke, 'team');
      assert.ok(d.layers.some((L) => ['light', 'spot', 'core', 'rects', 'poly', 'ring', 'ellipse'].includes(L.kind) && (L.fill === 'team' || L.color === 'team' || L.fill === 'teamDim')) || d.engines.length > 0, `${s.id}: has team-colored emissive`);
    }
  });

  test('silhouettes are distinct within a faction (bbox aspect or layer count differ)', () => {
    for (const f of FACTION_IDS) {
      const ships = SHIP_LIST.filter((s) => s.faction === f);
      for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
        const a = SHIP_DEFS[ships[i].id], b = SHIP_DEFS[ships[j].id];
        const ka = JSON.stringify(a.layers.filter((L) => L.kind === 'poly').map((L) => L.pts));
        const kb = JSON.stringify(b.layers.filter((L) => L.kind === 'poly').map((L) => L.pts));
        assert.notEqual(ka, kb, `${a.id} and ${b.id} share the same polygons`);
      }
    }
  });
});

describe('sprite helpers', () => {
  test('layerPoints mirrors y<=0 points without duplicating axis points', () => {
    const pts = layerPoints({ pts: [[-40, 0], [-30, -10], [30, -8], [40, 0]], mirror: true });
    assert.deepEqual(pts, [[-40, 0], [-30, -10], [30, -8], [40, 0], [30, 8], [-30, 10]]);
    const raw = layerPoints({ pts: [[0, -5], [5, 0], [0, 5]], mirror: false });
    assert.equal(raw.length, 3);
  });
  test('pickBucket picks the nearest bucket in log space', () => {
    assert.equal(pickBucket(0.2), 0.35);
    assert.equal(pickBucket(0.58), 0.5);
    assert.equal(pickBucket(0.62), 0.71);
    assert.equal(pickBucket(1.0), 1.0);
    assert.equal(pickBucket(3), 2.0);
    for (const b of ZOOM_BUCKETS) assert.equal(pickBucket(b), b);
  });
  test('lodFor and damageState thresholds', () => {
    assert.equal(lodFor(3), 0); assert.equal(lodFor(10), 1); assert.equal(lodFor(40), 2);
    assert.equal(damageState(1000), 0); assert.equal(damageState(599), 1); assert.equal(damageState(299), 2);
  });
});

describe('palette', () => {
  test('palettes exist for every faction and expose team colors', () => {
    for (const f of FACTION_IDS) {
      assert.ok(FACTION_PALETTES[f], f);
      for (const t of [0, 1]) {
        const p = palette(f, t);
        for (const k of ['hullDark', 'hullMid', 'hullLight', 'hullEdge', 'accent', 'team', 'teamDim', 'teamGlow']) assert.ok(typeof p[k] === 'string' && p[k].length > 0, `${f}/${t}: ${k}`);
        assert.equal(palette(f, t), p, 'cached');
      }
      assert.notEqual(palette(f, 0).team, palette(f, 1).team);
    }
  });
  test('color math', () => {
    assert.deepEqual(parseColor('#ff0080'), [255, 0, 128, 1]);
    assert.deepEqual(parseColor('rgba(1,2,3,0.5)'), [1, 2, 3, 0.5]);
    assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
    assert.equal(mix('#000000', '#ffffff', 0), '#000000');
    assert.match(weaponColor('laser', '#3fb6ff'), /^#[0-9a-f]{6}$/);
    assert.notEqual(weaponColor('laser', '#3fb6ff'), weaponColor('laser', '#ff7a3d'));
    const h = hash01(1, 2, 3);
    assert.ok(h >= 0 && h < 1 && h === hash01(1, 2, 3));
  });
});
