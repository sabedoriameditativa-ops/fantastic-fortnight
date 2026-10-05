// Synthetic BattleFeed for exercising the renderer without the simulation.
// Produces a BattleStartInfo and 10 Hz frames { k, s, e, at } whose events use
// valid ship ids, weapon indexes and ability ids from the catalog
// (docs/ARCHITECTURE.md §3.1 / §3.2). Not deterministic in wall-clock terms,
// but all randomness is seeded.
//
// Modes: 'battle' (one of each class per team, moving + fighting), 'stress'
// (~500 ships), 'showcase' (all 32 classes parked in a grid, no events).

import { SHIPS, SHIP_LIST, ABILITIES, FACTIONS, FACTION_IDS, SIZE_CLASS } from '/shared/catalog.js';
import { TICK_RATE, TICK_MS, SNAPSHOT_EVERY, POS_SCALE, ANGLE_STEPS, HP_SCALE, FLAG, worldSize } from '/shared/constants.js';
import { createRng } from '/shared/rng.js';

const TAU = Math.PI * 2;

export const SHOWCASE = { cols: 8, rows: 4, dx: 190, dy: 200 };

/**
 * @param {{ mode?: 'battle'|'stress'|'showcase', seed?: number|string, shipsPerSide?: number }} o
 */
export function createFakeFeed(o = {}) {
  const mode = o.mode || 'battle';
  const seed = o.seed ?? 42;
  const rng = createRng(seed);
  const perSide = mode === 'stress' ? (o.shipsPerSide || 250) : 1;
  const world = mode === 'stress' ? worldSize(6) : mode === 'showcase' ? { w: 2000, h: 1125 } : worldSize(1);

  const players = [
    { id: 'p1', name: 'Ana', team: 0, isBot: false, faction: 'terran', fleet: { faction: 'terran', ships: [] }, ai: 'especialista' },
    { id: 'p2', name: 'Bot Rex', team: 1, isBot: true, faction: 'vorrax', fleet: { faction: 'vorrax', ships: [] }, ai: 'dificil' },
  ];

  /** @type {object[]} live ship states */
  const ships = [];
  const byId = new Map();
  let nextId = 1;

  function makeShip(cls, team, x, y, a, owner, source = 0) {
    const cat = SHIPS[cls];
    const sh = {
      id: nextId++, cls, cat, team, owner: owner || (team === 0 ? 'p1' : 'p2'), x, y, a, vx: 0, vy: 0,
      hp: cat.hp, maxHp: cat.hp, sh: cat.shield.cap, shCap: cat.shield.cap, flags: 0, alive: true,
      speed: cat.speed, turn: (cat.turnRate * Math.PI) / 180, radius: cat.radius,
      wcd: cat.weapons.map((w, i) => Math.floor(rng.range(0, w.cooldown * TICK_RATE)) + i * 3),
      acd: Math.floor(rng.range(2, 8) * TICK_RATE), target: 0, wander: { x, y }, source,
      flagUntil: 0, chargeUntil: 0, chargeTarget: 0, shieldRegenAt: 0, orbitDir: rng.chance(0.5) ? 1 : -1,
    };
    ships.push(sh); byId.set(sh.id, sh);
    return sh;
  }

  // ---- initial layout ----
  if (mode === 'showcase') {
    const x0 = world.w / 2 - ((SHOWCASE.cols - 1) * SHOWCASE.dx) / 2, y0 = world.h / 2 - ((SHOWCASE.rows - 1) * SHOWCASE.dy) / 2;
    SHIP_LIST.forEach((cat, i) => {
      const col = i % SHOWCASE.cols, row = Math.floor(i / SHOWCASE.cols);
      makeShip(cat.id, i % 2, x0 + col * SHOWCASE.dx, y0 + row * SHOWCASE.dy, -0.35, i % 2 ? 'p2' : 'p1');
    });
  } else {
    for (let team = 0; team < 2; team++) {
      const list = [];
      if (mode === 'battle') for (const cat of SHIP_LIST) list.push(cat.id);
      else {
        const weights = { tiny: 7, small: 6, medium: 3, large: 1.4, capital: 0.5, mothership: 0.15 };
        const total = SHIP_LIST.reduce((s, c) => s + weights[c.sizeClass], 0);
        for (let i = 0; i < perSide; i++) {
          let r = rng.next() * total;
          for (const c of SHIP_LIST) { r -= weights[c.sizeClass]; if (r <= 0) { list.push(c.id); break; } }
        }
      }
      // columns by size from the rear, like deploy.js
      list.sort((a, b) => SIZE_CLASS[SHIPS[b].sizeClass].index - SIZE_CLASS[SHIPS[a].sizeClass].index);
      const rows = Math.max(4, Math.ceil(list.length / 10));
      list.forEach((cls, i) => {
        const col = Math.floor(i / rows), row = i % rows;
        const colW = 90, rowH = (world.h - 200) / rows;
        const xr = 120 + col * colW + rng.range(-20, 20), y = 100 + row * rowH + rowH / 2 + rng.range(-30, 30);
        const x = team === 0 ? xr : world.w - xr;
        makeShip(cls, team, x, y, team === 0 ? 0 : Math.PI);
      });
    }
  }

  const startInfo = {
    seed, players, world, tickRate: TICK_RATE, snapshotEvery: SNAPSHOT_EVERY, isLocal: true,
    ships: ships.map((s) => ({ id: s.id, cls: s.cls, owner: s.owner, team: s.team, x: s.x, y: s.y, a: s.a })),
  };

  // ---- callbacks ----
  const cbs = { start: [], frame: [], end: [], status: [] };
  let speed = 1, tick = 0, timer = null, nextTickAt = 0, running = false, engaged = false, suddenDeath = false, ended = false;
  /** @type {{t:number, e:any[]}[]} scheduled future events (pend/hit) */
  const scheduled = [];
  let pendingEvents = [];
  let projId = 1, areaId = 1;
  const respawns = [];

  function schedule(dtTicks, e) { scheduled.push({ t: tick + Math.max(1, Math.round(dtTicks)), e }); }
  function emit(e) { pendingEvents.push(e); }

  function enemiesOf(s) { return ships.filter((t) => t.alive && t.team !== s.team); }

  function applyDamage(t, amount, type, srcId) {
    if (!t.alive) return;
    let toShield = 0;
    if (t.sh > 0) {
      const absorbed = Math.min(t.sh, amount);
      t.sh -= absorbed; toShield = 1; t.shieldRegenAt = tick + 5 * TICK_RATE;
      emit(['hit', t.id, Math.max(1, Math.round(absorbed)), type, 1]);
      if (t.sh <= 0) { t.sh = 0; emit(['sbreak', t.id]); t.flags |= FLAG.SHIELD_BROKEN; }
      amount -= absorbed;
      if (amount <= 0) return;
    }
    t.hp -= amount;
    emit(['hit', t.id, Math.max(1, Math.round(amount)), type, 0]);
    void toShield;
    if (t.hp <= 0) kill(t, srcId);
  }

  function kill(t, killerId) {
    if (!t.alive) return;
    t.alive = false; t.hp = 0;
    emit(['die', t.id, killerId || 0, Math.round(t.x), Math.round(t.y)]);
    if (t.cls === 'vor_larva') emit(['aoe', Math.round(t.x), Math.round(t.y), 60, 'bile_burst']);
    if (!t.source && mode !== 'showcase') respawns.push({ t: tick + 10 * TICK_RATE, cls: t.cls, team: t.team, owner: t.owner });
  }

  function fireWeapon(s, wi, w, t) {
    const d = Math.hypot(t.x - s.x, t.y - s.y);
    const hit = rng.chance(0.8) ? 1 : 0;
    if (w.contact || w.speed === 0) {
      if (w.charge && s.chargeUntil === 0) { s.chargeUntil = tick + Math.round(w.charge * TICK_RATE); s.chargeTarget = t.id; s.flags |= FLAG.CASTING; emit(['charge', s.id, wi, w.charge]); return; }
      emit(['shot', s.id, t.id, wi, hit]);
      if (hit) applyDamage(t, w.damage * (0.4 + rng.next() * 0.6), w.type, s.id);
      if (w.chain && hit) {
        const others = enemiesOf(s).filter((o2) => o2 !== t && Math.hypot(o2.x - t.x, o2.y - t.y) < w.chain.radius).slice(0, w.chain.targets);
        for (const o2 of others) { emit(['shot', s.id, o2.id, wi, 1]); applyDamage(o2, w.chain.damage * 0.5, w.type, s.id); }
      }
    } else {
      const c = Math.cos(s.a), sn = Math.sin(s.a);
      const mx = s.x + c * s.radius * 0.9, my = s.y + sn * s.radius * 0.9;
      const pid = projId++;
      emit(['proj', pid, s.id, t.id, wi, Math.round(mx), Math.round(my)]);
      const travel = (d / w.speed) * TICK_RATE;
      const intercept = w.interceptable && rng.chance(0.12);
      schedule(travel, ['__pend', pid, intercept ? 2 : hit, t.id, w.damage, w.type, w.aoe, s.id]);
    }
  }

  function tryAbility(s) {
    const ab = ABILITIES[s.cat.ability];
    if (!ab || ab.kind === 'passive') return;
    const enemies = enemiesOf(s);
    const allies = ships.filter((t) => t.alive && t.team === s.team && t !== s);
    let target = 0, x = s.x, y = s.y;
    const near = enemies.filter((t) => Math.hypot(t.x - s.x, t.y - s.y) < 600);
    if (!near.length && ab.kind !== 'heal' && ab.kind !== 'spawn') return;
    switch (ab.kind) {
      case 'area': {
        const t = near[0] || enemies[0]; if (!t) return;
        if (ab.id === 'emp_pulse' || ab.id === 'dissonant_pulse' || ab.id === 'emp_storm') { x = s.x; y = s.y; }
        else { x = t.x; y = t.y; }
        emit(['cast', s.id, ab.id, 0, Math.round(x), Math.round(y)]);
        emit(['aoe', Math.round(x), Math.round(y), ab.params.radius || 100, ab.id]);
        if (ab.id === 'acid_cloud' || ab.id === 'singularity') {
          const aid = areaId++;
          emit(['area', aid, ab.id, Math.round(x), Math.round(y), ab.params.radius, 1]);
          schedule(ab.duration * TICK_RATE, ['area', aid, ab.id, Math.round(x), Math.round(y), ab.params.radius, 0]);
        }
        for (const t of enemies) if (Math.hypot(t.x - x, t.y - y) < (ab.params.radius || 100)) { t.flags |= FLAG.DISRUPTED; t.flagUntil = tick + 3 * TICK_RATE; if (ab.params.shieldDamage) applyDamage(t, Math.min(t.sh, ab.params.shieldDamage) || 5, 'ion', s.id); }
        break;
      }
      case 'teleport': {
        const t = near[0]; if (!t) return;
        const away = s.sh === 0 || rng.chance(0.5);
        const ang = Math.atan2(t.y - s.y, t.x - s.x) + (away ? Math.PI : 0);
        s.x = Math.max(50, Math.min(world.w - 50, s.x + Math.cos(ang) * ab.params.distance));
        s.y = Math.max(50, Math.min(world.h - 50, s.y + Math.sin(ang) * ab.params.distance));
        emit(['cast', s.id, ab.id, 0, Math.round(s.x), Math.round(s.y)]);
        break;
      }
      case 'latch': {
        const t = near.find((e) => SIZE_CLASS[e.cat.sizeClass].index >= 2 && Math.hypot(e.x - s.x, e.y - s.y) < 200);
        if (!t) return;
        emit(['cast', s.id, ab.id, t.id, Math.round(t.x), Math.round(t.y)]);
        s.flags |= FLAG.LATCHED; s.flagUntil = tick + 5 * TICK_RATE;
        for (let i = 1; i <= 10; i++) schedule(i * 10, ['heal', s.id, s.id, 7, 'hull']);
        break;
      }
      case 'buff_ally': {
        const t = allies.find((a) => Math.hypot(a.x - s.x, a.y - s.y) < 300 && a.shCap > 0) || allies[0];
        if (!t) return;
        emit(['cast', s.id, ab.id, t.id, Math.round(t.x), Math.round(t.y)]);
        break;
      }
      case 'spawn': {
        const n = ab.params.count;
        emit(['cast', s.id, ab.id, 0, Math.round(s.x), Math.round(s.y)]);
        for (let i = 0; i < n; i++) {
          const ang = rng.range(0, TAU), d = s.radius + 30;
          const sp = makeShip(ab.params.spawn, s.team, s.x + Math.cos(ang) * d, s.y + Math.sin(ang) * d, s.a, s.owner, s.id);
          emit(['spawn', sp.id, sp.cls, sp.team, sp.owner, Math.round(sp.x), Math.round(sp.y), +sp.a.toFixed(3), s.id]);
        }
        break;
      }
      case 'heal': {
        if (ab.id === 'shield_overload') { if (s.sh > s.shCap * 0.5) return; s.sh = s.shCap * 0.5; emit(['cast', s.id, ab.id, 0, Math.round(s.x), Math.round(s.y)]); emit(['heal', s.id, s.id, Math.round(s.shCap * 0.5), 'shield']); }
        else { if (s.hp > s.maxHp * 0.7) return; s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.25); emit(['cast', s.id, ab.id, 0, Math.round(s.x), Math.round(s.y)]); emit(['heal', s.id, s.id, Math.round(s.maxHp * 0.25), 'hull']); }
        break;
      }
      case 'aura': {
        emit(['cast', s.id, ab.id, 0, Math.round(s.x), Math.round(s.y)]);
        if (ab.id === 'reconstruction' || ab.id === 'aurora') {
          const kind = ab.id === 'aurora' ? 'shield' : 'hull';
          for (const a of allies) if (Math.hypot(a.x - s.x, a.y - s.y) < ab.params.radius) for (let i = 1; i <= 6; i++) schedule(i * 12, ['heal', s.id, a.id, 10, kind]);
        }
        for (const a of allies) if (Math.hypot(a.x - s.x, a.y - s.y) < ab.params.radius) { a.flags |= FLAG.BOOSTED; a.flagUntil = tick + ab.duration * TICK_RATE; }
        break;
      }
      default: {
        emit(['cast', s.id, ab.id, target, Math.round(x), Math.round(y)]);
        if (ab.id === 'afterburner') { s.flags |= FLAG.BOOSTED; s.flagUntil = tick + 3 * TICK_RATE; }
        if (ab.id === 'stealth_strike') { s.flags |= FLAG.UNTARGETABLE; s.flagUntil = tick + 4 * TICK_RATE; }
        if (ab.id === 'turret_mode') { s.flags |= FLAG.STATIONARY; s.flagUntil = tick + 6 * TICK_RATE; }
      }
    }
    s.acd = Math.round((ab.cooldown || 10) * TICK_RATE * (0.6 + rng.next() * 0.8));
  }

  function stepShip(s) {
    if (mode === 'showcase') return;
    const enemies = enemiesOf(s);
    // target selection
    let t = byId.get(s.target);
    if (!t || !t.alive || rng.chance(0.004)) {
      let best = null, bd = Infinity;
      for (const e of enemies) { const d = Math.hypot(e.x - s.x, e.y - s.y) * (0.7 + rng.next() * 0.6); if (d < bd) { bd = d; best = e; } }
      t = best; s.target = t ? t.id : 0;
    }
    const maxRange = s.cat.weapons.reduce((m, w) => Math.max(m, w.range), 100);
    let dx, dy;
    if (t) {
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      const want = maxRange * 0.7;
      if (!engaged && d < maxRange * 1.1) { engaged = true; emit(['phase', 'engage']); }
      if (d > want + 40) { dx = t.x - s.x; dy = t.y - s.y; }
      else if (d < want - 60) { dx = s.x - t.x; dy = s.y - t.y; }
      else { const ang = Math.atan2(t.y - s.y, t.x - s.x) + (Math.PI / 2) * s.orbitDir; dx = Math.cos(ang); dy = Math.sin(ang); }
    } else { dx = world.w / 2 - s.x; dy = world.h / 2 - s.y; }
    // steering
    const desired = Math.atan2(dy, dx);
    let da = desired - s.a; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    const turn = s.turn / TICK_RATE * ((s.flags & FLAG.BOOSTED) ? 1.5 : 1);
    s.a += Math.max(-turn, Math.min(turn, da));
    const align = Math.max(0, Math.cos(da));
    const stationary = s.flags & FLAG.STATIONARY;
    const spd = stationary ? 0 : s.speed * align * ((s.flags & FLAG.BOOSTED) ? 1.6 : 1) * (SIZE_CLASS[s.cat.sizeClass].index >= 4 ? 0.7 : 1);
    s.vx = Math.cos(s.a) * spd; s.vy = Math.sin(s.a) * spd;
    s.x += s.vx / TICK_RATE; s.y += s.vy / TICK_RATE;
    // separation (cheap)
    if (tick % 4 === 0) for (const o2 of ships) {
      if (o2 === s || !o2.alive) continue;
      const sep = s.radius + o2.radius + 12;
      const ox = s.x - o2.x, oy = s.y - o2.y, d = Math.hypot(ox, oy);
      if (d < sep && d > 0.01) { const push = (sep - d) * 0.5; s.x += (ox / d) * push; s.y += (oy / d) * push; }
    }
    s.x = Math.max(20, Math.min(world.w - 20, s.x)); s.y = Math.max(20, Math.min(world.h - 20, s.y));
    // weapons
    if (t && engaged) {
      s.cat.weapons.forEach((w, wi) => {
        if (s.wcd[wi] > 0) { s.wcd[wi]--; return; }
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (SIZE_CLASS[t.cat.sizeClass].index < SIZE_CLASS[w.minTargetClass].index) return;
        const bearing = Math.abs(((Math.atan2(t.y - s.y, t.x - s.x) - s.a + Math.PI * 3) % TAU) - Math.PI) * 180 / Math.PI;
        if (d <= w.range && bearing <= w.arc) {
          for (let k = 0; k < w.salvo; k++) fireWeapon(s, wi, w, t);
          s.wcd[wi] = Math.round(w.cooldown * TICK_RATE * (0.9 + rng.next() * 0.3));
        }
      });
      if (s.chargeUntil && tick >= s.chargeUntil) {
        const ct = byId.get(s.chargeTarget); s.chargeUntil = 0; s.flags &= ~FLAG.CASTING;
        if (ct && ct.alive) { emit(['shot', s.id, ct.id, 0, 1]); applyDamage(ct, 200, 'laser', s.id); }
      }
      if (s.acd > 0) s.acd--; else tryAbility(s);
    }
    // regen
    if (!suddenDeath) {
      if (s.shCap > 0 && tick >= s.shieldRegenAt && s.sh < s.shCap) { s.sh = Math.min(s.shCap, s.sh + s.cat.shield.regen / TICK_RATE); if (s.sh > 0) s.flags &= ~FLAG.SHIELD_BROKEN; }
      if (s.cat.regen > 0) s.hp = Math.min(s.maxHp, s.hp + s.cat.regen / TICK_RATE);
    }
    if (s.flagUntil && tick > s.flagUntil) { s.flags &= ~(FLAG.BOOSTED | FLAG.UNTARGETABLE | FLAG.DISRUPTED | FLAG.STATIONARY | FLAG.LATCHED); s.flagUntil = 0; }
  }

  function stepTick() {
    tick++;
    // scheduled events
    for (let i = scheduled.length - 1; i >= 0; i--) {
      const sc = scheduled[i];
      if (sc.t > tick) continue;
      scheduled.splice(i, 1);
      const e = sc.e;
      if (e[0] === '__pend') {
        const [, pid, outcome, tid, dmg, type, aoe, srcId] = e;
        const t = byId.get(tid);
        const x = t ? Math.round(t.x + rng.range(-8, 8)) : 0, y = t ? Math.round(t.y + rng.range(-8, 8)) : 0;
        emit(['pend', pid, outcome, x, y]);
        if (outcome === 1 && t && t.alive) {
          applyDamage(t, dmg * (0.4 + rng.next() * 0.6), type, srcId);
          if (aoe) { emit(['aoe', x, y, aoe, type]); for (const o2 of ships) if (o2.alive && o2 !== t && o2.team === t.team && Math.hypot(o2.x - x, o2.y - y) < aoe) applyDamage(o2, dmg * 0.4, type, srcId); }
        }
      } else emit(e);
    }
    for (const s of ships) if (s.alive) stepShip(s);
    // spawned units expire
    for (const s of ships) if (s.alive && s.source && rng.chance(0.0004)) kill(s, 0);
    // respawns keep the demo populated
    for (let i = respawns.length - 1; i >= 0; i--) {
      const r = respawns[i];
      if (r.t > tick) continue;
      respawns.splice(i, 1);
      const x = r.team === 0 ? rng.range(80, 400) : world.w - rng.range(80, 400), y = rng.range(100, world.h - 100);
      const sp = makeShip(r.cls, r.team, x, y, r.team === 0 ? 0 : Math.PI, r.owner);
      emit(['spawn', sp.id, sp.cls, sp.team, sp.owner, Math.round(sp.x), Math.round(sp.y), +sp.a.toFixed(3), 0]);
    }
    if (!suddenDeath && tick >= 150 * TICK_RATE && mode !== 'showcase') { suddenDeath = true; emit(['phase', 'suddenDeath']); }
    // compact dead ships occasionally
    if (tick % 200 === 0) for (let i = ships.length - 1; i >= 0; i--) if (!ships[i].alive) { byId.delete(ships[i].id); ships.splice(i, 1); }
  }

  function snapshot() {
    const s = [];
    for (const sh of ships) {
      if (!sh.alive) continue;
      let a = sh.a % TAU; if (a < 0) a += TAU;
      s.push([sh.id, Math.round(sh.x * POS_SCALE), Math.round(sh.y * POS_SCALE), Math.round((a / TAU) * ANGLE_STEPS) & (ANGLE_STEPS - 1),
        Math.max(0, Math.min(HP_SCALE, Math.round((sh.hp / sh.maxHp) * HP_SCALE))), sh.shCap ? Math.round((sh.sh / sh.shCap) * HP_SCALE) : 0, sh.flags]);
    }
    return s;
  }

  function emitFrame() {
    const frame = { k: tick, s: snapshot(), e: pendingEvents, at: performance.now() };
    pendingEvents = [];
    for (const cb of cbs.frame) cb(frame);
  }

  function loop() {
    if (!running || speed === 0) return;
    const now = performance.now();
    let n = 0;
    while (now >= nextTickAt && n < 8) {
      stepTick();
      if (tick % SNAPSHOT_EVERY === 0) emitFrame();
      nextTickAt += TICK_MS / speed;
      n++;
    }
    if (n >= 8) nextTickAt = now; // fell behind (tab hidden): drop time
  }

  const feed = {
    onStart(cb) { cbs.start.push(cb); },
    onFrame(cb) { cbs.frame.push(cb); },
    onEnd(cb) { cbs.end.push(cb); },
    onStatus(cb) { cbs.status.push(cb); },
    controls: {
      setSpeed(x) {
        speed = x;
        if (x > 0) { nextTickAt = performance.now(); if (!timer) timer = setInterval(loop, 10); }
      },
      isLocal: true,
    },
    /** Begin emitting: fires onStart then frames. */
    start() {
      running = true;
      for (const cb of cbs.start) cb(startInfo);
      for (const cb of cbs.status) cb('ok');
      emitFrame();
      nextTickAt = performance.now();
      if (!timer) timer = setInterval(loop, 10);
    },
    dispose() { running = false; if (timer) clearInterval(timer); timer = null; },
    get startInfo() { return startInfo; },
    get tick() { return tick; },
    get world() { return world; },
    /** Debug helpers for the demo page. */
    debug: {
      /** Kill a random (preferably big) ship; returns its id. */
      explode(prefer = 'capital') {
        const alive = ships.filter((s) => s.alive);
        if (!alive.length) return 0;
        const big = alive.filter((s) => s.cat.sizeClass === prefer || s.cat.sizeClass === 'mothership');
        const pick = big.length ? rng.pick(big) : rng.pick(alive);
        kill(pick, 0);
        return pick.id;
      },
      /** Kill a specific ship id now. */
      kill(id) { const s = byId.get(id); if (s && s.alive) kill(s, 0); return !!s; },
      /** Force every alive ship to cast its ability now. */
      castAll() { for (const s of ships) if (s.alive) { s.acd = 0; tryAbility(s); } },
      engage() { engaged = true; },
      endBattle(winner = 0) { if (ended) return; ended = true; emit(['end', winner, 'elimination']); for (const cb of cbs.end) cb({ winner, reason: 'elimination', ticks: tick }); },
      ships,
      byId,
    },
  };
  return feed;
}

/** Faction order used by the showcase grid (catalog order). */
export const SHOWCASE_FACTIONS = FACTION_IDS;
export { FACTIONS };
