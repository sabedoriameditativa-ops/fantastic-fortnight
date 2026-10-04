/*
 * In-page bots for tools/balance.mjs. Loaded into index.html#debug; defines window.QFBalance.
 * Dev tool only — the game never loads this file.
 *
 *   QFBalance.run({ bot, botOpts, picks, seed, nights: [a, b], maxSim, maxNight }) → telemetry of one run
 *   QFBalance.applyTune({ 'WEAPONS.beam.dpsPerLevel': 6, ... }) → mutates QF.debug.getConfig() in place
 *
 * Autopilots get the view built by the game (QF.debug.setAutopilot) — only what a player could see — and return a
 * move vector. They re-decide every `react` seconds (default 0.1 s, a quick human) and hold that move in between.
 */
(function () {
  'use strict';

  const STEP = 1 / 60;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ movement building blocks

  const DEFAULTS = {
    react: 0.1, // s between decisions (a quick human)
    threatR: 260, // creatures closer than this (plus their radius) are threats
    bossMargin: 120, // extra berth for the boss
    clearance: 40, // gap kept between bodies when choosing a heading
    wallClear: 60, // ... and from the shore / the tower
    edgeMargin: 230, // start steering off the shore this far from it
    cruiseR: 520, // when nothing is near, keep circling the lighthouse around this radius
    emberR: 200, // kite: grab embers this close
    prefW: 1.6, // how much the wanted direction counts against the danger of a heading
    radius: 300, // circle: orbit radius around the lighthouse
    dodgeMargin: 22, // skilled: clearance kept from projectiles and telegraphs
    safeW: 0.35, // skilled: threat weight below which it goes ember hunting
    engageAfter: 8, // skilled: closes in on a boss that lost under 3 % of its hp over this many seconds
  };

  // 16 candidate headings
  const DIRS = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)]);
  const LOOK = [0.12, 0.3, 0.55]; // s ahead sampled along a heading

  // Weighted centroid of the threats: creatures within reach, the boss with extra berth. Closer and nastier
  // threats weigh more. (Squids hovering at range are left out on purpose: running straight away from them is
  // running along their ink; the kite keeps circling instead, which makes their unaimed shots miss.)
  function threatCentroid(v, o, ignoreBoss) {
    const p = v.player;
    let cx = 0, cy = 0, W = 0;
    for (const e of v.enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const reach = o.threatR + e.r;
      if (d >= reach) continue;
      let w = ((reach - d) / reach) ** 2;
      if (e.emerging) w *= 0.5;
      if (e.type === 'puffer') w *= 1.6;
      else if (e.type === 'eel') w *= 1.3;
      if (e.elite) w *= 1.5;
      cx += e.x * w; cy += e.y * w; W += w;
    }
    const b = v.boss;
    if (b && !b.emerging && !ignoreBoss) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      const reach = o.threatR + b.r + o.bossMargin;
      if (d < reach) {
        const w = ((reach - d) / reach) ** 2 * 4;
        cx += b.x * w; cy += b.y * w; W += w;
      }
    }
    if (W > 0) { cx /= W; cy /= W; }
    return { x: cx, y: cy, w: W };
  }

  // How bad heading along (dx, dy) looks over the next ~0.5 s: bodies closer than `clearance` (creatures moved
  // along their velocity, the boss along its estimated velocity), the shore and the tower. `sees` (skilled bot)
  // adds projectiles, slam circles and the boss's dash lane.
  function danger(v, o, mem, dx, dy, sees) {
    const p = v.player, b = v.boss;
    const shore = v.islandR - p.r - o.wallClear, tower = v.lighthouse.r + p.r + o.wallClear;
    let sum = 0;
    for (const t of LOOK) {
      const qx = p.x + dx * p.speed * t, qy = p.y + dy * p.speed * t;
      for (const e of v.enemies) {
        const gap = Math.hypot(qx - e.x - e.vx * t, qy - e.y - e.vy * t) - (e.r + p.r) * 0.85;
        if (gap < o.clearance) sum += ((o.clearance - gap) / o.clearance) * (e.type === 'puffer' ? 1.5 : 1);
      }
      if (b && !b.emerging) {
        const gap = Math.hypot(qx - b.x - mem.bvx * t, qy - b.y - mem.bvy * t) - b.r * 0.8 - p.r * 0.85;
        if (gap < o.clearance * 2) sum += ((o.clearance * 2 - gap) / o.clearance) * 2;
      }
      const r = Math.hypot(qx, qy);
      if (r > shore) sum += ((r - shore) / o.wallClear) * 3;
      if (r < tower) sum += ((tower - r) / o.wallClear) * 3;
      if (!sees) continue;
      for (const s of v.projectiles) {
        const gap = Math.hypot(qx - s.x - s.vx * t, qy - s.y - s.vy * t) - s.r - p.r * 0.8;
        if (gap < o.dodgeMargin) sum += ((o.dodgeMargin - gap) / o.dodgeMargin) * 3;
      }
      for (const g of v.telegraphs) {
        if (g.kind === 'slam') {
          if (Math.hypot(qx - g.x, qy - g.y) < g.r + p.r * 0.5 + o.dodgeMargin) sum += 4;
        } else if (g.kind === 'dash') {
          const rx = qx - g.x, ry = qy - g.y;
          const along = rx * g.dx + ry * g.dy, perp = Math.abs(-rx * g.dy + ry * g.dx);
          // a committed lane is deadly; while it still aims, standing on its line is merely unwise
          if (along > -g.width && along < g.length + g.width && perp < g.width * 0.8 + p.r * 0.85 + o.dodgeMargin) sum += g.aiming ? 1 : 5;
        }
      }
    }
    return sum;
  }

  // The best of the 16 headings: closest to the wanted direction (pref, whose length says how much it matters)
  // once its danger is subtracted.
  function steer(v, o, mem, px, py, sees) {
    let best = DIRS[0], bs = -Infinity;
    for (const d of DIRS) {
      const s = (d[0] * px + d[1] * py) * o.prefW - danger(v, o, mem, d[0], d[1], sees);
      if (s > bs) { bs = s; best = d; }
    }
    return { x: best[0], y: best[1] };
  }

  function nearestEmber(v, maxD) {
    const p = v.player;
    let best = null, bd = maxD * maxD;
    for (const m of v.embers) {
      const d2 = (m.x - p.x) ** 2 + (m.y - p.y) ** 2;
      if (d2 < bd) { bd = d2; best = m; }
    }
    return best;
  }

  // Richest ember in view: value over distance (those already being pulled in are left alone).
  function bestEmber(v) {
    const p = v.player;
    let best = null, bs = 0;
    for (const m of v.embers) {
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < p.pickupR * 0.6) continue;
      const s = m.value / (d + 60);
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  // Wanted direction of a kiting player: away from the threat centroid, toward embers (close ones for the kite;
  // the skilled bot goes hunting when it is calm), off the shore, and never standing still — with nothing around it
  // keeps circling the lighthouse near cruiseR, which also spoils aimed shots.
  function kitePref(v, o, mem, hunts) {
    const p = v.player;
    const r = Math.hypot(p.x, p.y) || 1;
    const ux = p.x / r, uy = p.y / r;
    const th = threatCentroid(v, o, mem.engage);
    let mx = 0, my = 0;
    if (mem.engage && v.boss) {
      // short-range builds hurt the boss only up close: walk in (the look-ahead still keeps clear of its body)
      const bx = v.boss.x - p.x, by = v.boss.y - p.y, bd = Math.hypot(bx, by) || 1;
      if (bd > v.boss.r + 90) { mx += (bx / bd) * 1.2; my += (by / bd) * 1.2; }
    }
    if (th.w > 0) {
      const ax = p.x - th.x, ay = p.y - th.y;
      const d = Math.hypot(ax, ay);
      const urgency = clamp(th.w * 2, 0.4, 1.5);
      if (d > 1) { mx = (ax / d) * urgency; my = (ay / d) * urgency; }
    }
    const m = hunts && th.w < o.safeW ? bestEmber(v) : nearestEmber(v, o.emberR);
    if (m) {
      const ex = m.x - p.x, ey = m.y - p.y, ed = Math.hypot(ex, ey) || 1;
      const fl = Math.hypot(mx, my);
      if (fl < 1e-6 || (ex * mx + ey * my) / (ed * fl) > -0.2) {
        const w = th.w < (hunts ? o.safeW : 0.05) ? 1 : 0.6;
        mx += (ex / ed) * w; my += (ey / ed) * w;
      }
    }
    // cruise: tangential around the tower, pulled toward the cruise ring; fades as threats take over
    const calm = clamp(1 - th.w * 2, 0.15, 1) * (m ? 0.4 : 1);
    const k = clamp((o.cruiseR - r) / 200, -1, 1);
    mx += (-uy * mem.dir + ux * k * 0.6) * calm * 0.7;
    my += (ux * mem.dir + uy * k * 0.6) * calm * 0.7;
    const edge = v.islandR - o.edgeMargin;
    if (r > edge) { const w = ((r - edge) / o.edgeMargin) * 1.5; mx -= ux * w; my -= uy * w; }
    return [mx, my];
  }

  // A skilled player notices when the boss is not losing hp (a build that only hurts it up close) and closes in.
  function updateEngage(v, o, mem) {
    const b = v.boss;
    if (!b || b.emerging) { mem.hpLog.length = 0; mem.engage = false; return; }
    mem.hpLog.push([v.time, b.hp]);
    while (mem.hpLog.length > 1 && v.time - mem.hpLog[1][0] >= o.engageAfter) mem.hpLog.shift();
    const [t0, hp0] = mem.hpLog[0];
    if (v.time - t0 >= o.engageAfter) mem.engage = (hp0 - b.hp) / b.maxHp < 0.03;
  }

  // Decides every o.react seconds and holds that move in between; keeps a little memory (orbit direction,
  // the boss's velocity estimated from its last two positions, the boss's recent hp).
  function withReaction(o, rand, decide) {
    let left = 0, mv = { x: 0, y: 0 };
    const mem = { dir: rand() < 0.5 ? 1 : -1, bx: null, by: null, bt: 0, bvx: 0, bvy: 0, hpLog: [], engage: false };
    return v => {
      if (v.phase !== 'night') { mem.bx = null; return { x: 0, y: 0 }; }
      left -= STEP;
      if (left > 1e-9) return mv;
      left = o.react;
      const b = v.boss;
      if (b && mem.bx != null && v.time > mem.bt) {
        mem.bvx = (b.x - mem.bx) / (v.time - mem.bt);
        mem.bvy = (b.y - mem.by) / (v.time - mem.bt);
      } else { mem.bvx = 0; mem.bvy = 0; }
      mem.bx = b ? b.x : null; mem.by = b ? b.y : null; mem.bt = v.time;
      mv = decide(v, mem);
      return mv;
    };
  }

  // ------------------------------------------------------------------ autopilots: (opts, rand) → fn(view) → {x, y}

  const AUTOPILOTS = {
    // stands still all night
    idle() {
      return () => ({ x: 0, y: 0 });
    },

    // orbits the lighthouse at opts.radius, whatever happens
    circle(o, rand) {
      return withReaction(o, rand, (v, mem) => {
        const p = v.player;
        const r = Math.hypot(p.x, p.y) || 1;
        const ux = p.x / r, uy = p.y / r;
        const k = clamp((o.radius - r) / 80, -1.5, 1.5);
        return { x: -uy * mem.dir + ux * k, y: ux * mem.dir + uy * k };
      });
    },

    // away from the weighted centroid of nearby threats, off the shore and the tower, grabbing close embers;
    // picks the heading with a short look-ahead so it does not run into creatures on the far side
    kite(o, rand) {
      return withReaction(o, rand, (v, mem) => {
        const [px, py] = kitePref(v, o, mem, false);
        return steer(v, o, mem, px, py, false);
      });
    },

    // the kite, plus: hunts embers when it is calm, its look-ahead also sees projectiles (ink, orbs),
    // telegraphed slams and the Caranguejo-Rei's dash lane, and it closes in on a boss it is not hurting
    skilled(o, rand) {
      return withReaction(o, rand, (v, mem) => {
        updateEngage(v, o, mem);
        const [px, py] = kitePref(v, o, mem, true);
        return steer(v, o, mem, px, py, true);
      });
    },
  };

  // ------------------------------------------------------------------ pick policies: fn(offers, info) → index

  const WEAPON_IDS = ['spark', 'beam', 'aura', 'anchors', 'harpoon'];
  const PICKS = ['random', 'weapons', 'passives', 'noBeam'].concat(WEAPON_IDS.map(w => w + 'First'));

  function makePicker(policy, rand) {
    const any = offers => Math.floor(rand() * offers.length);
    const among = (offers, pred) => {
      const idx = [];
      offers.forEach((x, i) => { if (pred(x)) idx.push(i); });
      return idx.length ? idx[Math.floor(rand() * idx.length)] : any(offers);
    };
    if (policy === 'random') return any;
    if (policy === 'weapons') return offers => among(offers, x => x.kind === 'weapon');
    if (policy === 'passives') return offers => among(offers, x => x.kind === 'passive');
    if (policy === 'noBeam') return offers => among(offers, x => x.id !== 'beam');
    const m = /^(\w+)First$/.exec(policy);
    if (m && WEAPON_IDS.indexOf(m[1]) >= 0) {
      // always that weapon (or its upgrade) when offered, otherwise random
      return offers => { const i = offers.findIndex(x => x.id === m[1]); return i >= 0 ? i : any(offers); };
    }
    throw new Error('unknown pick policy: ' + policy + ' (use ' + PICKS.join(', ') + ')');
  }

  // ------------------------------------------------------------------ tuning

  // a tune may only replace a single value with one of the same kind ("20" for 20 would concatenate in the game)
  const kind = v => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

  function applyTune(tune) {
    const cfg = window.QF.debug.getConfig();
    const applied = {};
    for (const path of Object.keys(tune || {})) {
      const parts = path.split('.');
      let o = cfg;
      for (let i = 0; i < parts.length - 1; i++) {
        o = o[parts[i]];
        if (!o || typeof o !== 'object') throw new Error('tune: no such table ' + parts.slice(0, i + 1).join('.'));
      }
      const k = parts[parts.length - 1];
      if (!(k in o)) throw new Error('tune: no such value ' + path);
      const old = o[k], nu = tune[path];
      if (kind(old) === 'object') throw new Error('tune: ' + path + ' is a table; tune its values one by one');
      if (kind(nu) !== kind(old)) throw new Error('tune: ' + path + ' is a ' + kind(old) + ', got ' + JSON.stringify(nu));
      applied[path] = [old, nu];
      o[k] = nu;
    }
    return applied; // path → [old, new]
  }

  // ------------------------------------------------------------------ one run

  function run(cfg) {
    const d = window.QF.debug;
    const seed = cfg.seed >>> 0;
    const last = d.getConfig().NIGHTS.total;
    const nights = cfg.nights || [1, last];
    const from = nights[0], to = Math.min(nights[1], last);
    const maxSim = cfg.maxSim || 3600, maxNight = cfg.maxNight || 600;
    const o = Object.assign({}, DEFAULTS, cfg.botOpts || {});
    const make = AUTOPILOTS[cfg.bot];
    if (!make) throw new Error('unknown bot: ' + cfg.bot + ' (use ' + Object.keys(AUTOPILOTS).join(', ') + ')');
    // bots and pickers draw from their own streams, so the game's seeded stream is the same for every policy
    d.setRender(false);
    d.setManualClock(true);
    d.setAutopilot(make(o, mulberry32(seed ^ 0x5bd1e995)));
    d.setPicker(makePicker(cfg.picks || 'random', mulberry32(seed ^ 0x27d4eb2f)));
    let st = d.startRun(seed);
    let god = from > 1;
    d.godMode(god);
    const t0 = performance.now();
    let end = null;
    while (!end) {
      if (god && st.night >= from && st.phase === 'night') { d.godMode(false); god = false; }
      // single steps while the warm-up hands over, so god mode ends on the first step of night `from`
      st = d.runSteps(god && st.night === from - 1 && st.phase !== 'night' ? 1 : 30);
      if (st.ended) end = st.screen === 'victory' ? 'win' : 'death';
      else if (to < last && (st.night > to || (st.night === to && st.phase === 'sunrise'))) end = 'stopped';
      else if (st.time > maxSim) end = 'timeout';
      else if (st.nightT > maxNight) end = 'stalled';
      else if (st.screen !== 'playing') end = 'stuck:' + st.screen;
    }
    const s = d.stats();
    d.setAutopilot(null);
    d.setPicker(null);
    d.godMode(false);
    s.nights = s.nights.filter(n => n.night <= to);
    for (const n of s.nights) n.warmup = n.night < from;
    if (end !== 'win' && end !== 'death') {
      s.result = end;
      s.endNight = Math.min(st.night, to);
      s.level = st.level;
    }
    s.seed = seed;
    s.realMs = Math.round(performance.now() - t0);
    return s;
  }

  window.QFBalance = { run, applyTune, makePicker, AUTOPILOTS, PICKS, DEFAULTS };
})();
