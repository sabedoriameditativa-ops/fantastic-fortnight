// Turns tools/balance.mjs result files into markdown tables, one row per arm, plus a check of the balance targets.
// Usage: node tools/balance-summary.mjs results/*.json [--out SUMMARY.md] [--no-targets]
// Dev tool only (also imported by tools/balance.mjs to print a summary after a batch).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NIGHTS = 14;
const WEAPONS = ['spark', 'beam', 'aura', 'anchors', 'harpoon'];
const FIRSTS = ['beamFirst', 'sparkFirst', 'auraFirst', 'harpoonFirst', 'anchorsFirst'];

// ------------------------------------------------------------------ stats helpers

function quantile(xs, q) {
  const a = xs.filter(x => x != null && Number.isFinite(x)).sort((p, r) => p - r);
  if (!a.length) return null;
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
const median = xs => quantile(xs, 0.5);
const sum = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
const fmt = (v, d = 0) => (v == null ? '–' : Number(v).toFixed(d));
const pct = v => (v == null ? '–' : Math.round(v * 100) + '%');

// weapon level at the start of each night, from the pick log (spark starts at level 1)
function levelsByNight(run, id) {
  const out = {};
  let L = id === 'spark' ? 1 : 0;
  const picks = (run.picks || []).slice();
  for (let n = 1; n <= NIGHTS + 1; n++) {
    out[n] = L;
    for (const p of picks) if (p.night === n && p.pick === id) L++;
  }
  out.final = L;
  return out;
}

// played (non warm-up) nights of a run
const played = run => (run.nights || []).filter(n => !n.warmup && n.outcome !== 'restarted');

// End night: the night of death; 15 for a win (survived all 14); a stopped/timed-out run counts as its last night + 1.
function endNight(run) {
  if (run.result === 'win') return NIGHTS + 1;
  if (run.result === 'death') return run.endNight;
  const ns = played(run);
  const last = ns[ns.length - 1];
  return last ? (last.outcome === 'survived' ? last.night + 1 : last.night) : null;
}

// ------------------------------------------------------------------ one arm

export function summarizeArm(runs) {
  const ok = runs.filter(r => !r.error);
  const res = { n: ok.length, errors: runs.length - ok.length };
  res.wins = ok.filter(r => r.result === 'win').length;
  res.winRate = ok.length ? res.wins / ok.length : null;
  res.other = ok.filter(r => r.result !== 'win' && r.result !== 'death').map(r => r.result);
  const ends = ok.map(endNight);
  res.endNight = { med: median(ends), q1: quantile(ends, 0.25), q3: quantile(ends, 0.75) };
  const deaths = ok.filter(r => r.result === 'death');
  res.deathNights = deaths.map(r => r.endNight);

  // damage taken per night (runs that played that night, the night of death included)
  res.taken = {};
  res.reached = {};
  for (let n = 1; n <= NIGHTS; n++) {
    const xs = [];
    for (const r of ok) for (const nt of played(r)) if (nt.night === n) xs.push(nt.taken || 0);
    res.taken[n] = median(xs);
    res.reached[n] = xs.length;
  }

  // creature damage shares (boss damage excluded)
  const shares = {};
  for (const w of WEAPONS) shares[w] = [];
  const beamL3 = [];
  for (const r of ok) {
    const tot = {};
    for (const nt of played(r)) for (const [k, v] of Object.entries(nt.damageDealt || {})) tot[k] = (tot[k] || 0) + v;
    const all = sum(tot);
    if (all > 0) for (const w of WEAPONS) shares[w].push((tot[w] || 0) / all);
    // beam share over the nights that began with the Lente at level 3+
    const bl = levelsByNight(r, 'beam');
    let b = 0, a = 0;
    for (const nt of played(r)) {
      if (bl[nt.night] < 3) continue;
      b += (nt.damageDealt || {}).beam || 0;
      a += sum(nt.damageDealt);
    }
    if (a > 0) beamL3.push(b / a);
  }
  res.share = {};
  for (const w of WEAPONS) res.share[w] = median(shares[w]);
  res.beamL3 = { med: median(beamL3), n: beamL3.length, values: beamL3 };

  // bosses: time to kill (from fully emerged) among kills; kills / fights
  res.boss = {};
  for (const [type, night] of [['crabKing', 7], ['leviathan', 14]]) {
    const fights = [];
    for (const r of ok) for (const nt of played(r)) if (nt.night === night && nt.boss) fights.push(nt.boss);
    const kills = fights.filter(b => b.ttk != null);
    res.boss[type] = { fights: fights.length, kills: kills.length, ttk: median(kills.map(b => b.ttk)), ttkQ1: quantile(kills.map(b => b.ttk), 0.25), ttkQ3: quantile(kills.map(b => b.ttk), 0.75) };
  }

  // start level of nights 3 / 7 / 10 / 14
  res.level = {};
  for (const n of [3, 7, 10, 14]) {
    const xs = [];
    for (const r of ok) for (const nt of played(r)) if (nt.night === n) xs.push(nt.startLevel);
    res.level[n] = median(xs);
  }

  // night 1 on-ramp
  const n1 = ok.map(r => played(r).find(nt => nt.night === 1)).filter(Boolean);
  res.firstKill = median(n1.map(nt => nt.firstKillT));
  res.n1EndHp = median(n1.map(nt => (nt.outcome === 'survived' ? nt.endHp / nt.maxHp : 0)));
  res.realMs = median(ok.map(r => r.realMs));
  res.fullRunMs = median(ok.filter(r => r.result === 'win' || r.result === 'death').map(r => r.realMs));
  return res;
}

// ------------------------------------------------------------------ loading & grouping

export function armKey(meta) {
  return meta.label || meta.bot + '/' + meta.picks + (meta.tuneName && meta.tuneName !== 'none' ? ' @' + meta.tuneName : '');
}

export function loadResults(files) {
  const arms = new Map(); // key → { meta, runs }
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const key = armKey(data.meta);
    if (!arms.has(key)) arms.set(key, { meta: data.meta, runs: [] });
    arms.get(key).runs.push(...data.runs);
  }
  return arms;
}

// ------------------------------------------------------------------ markdown

const endCell = s => {
  const m = s.endNight;
  const f = v => (v == null ? '–' : v >= NIGHTS + 1 ? 'W' : fmt(v, v % 1 ? 1 : 0));
  return f(m.med) + ' (' + f(m.q1) + '–' + f(m.q3) + ')';
};

export function renderMarkdown(arms, opts = {}) {
  const rows = [...arms.entries()].map(([k, a]) => [k, a, summarizeArm(a.runs)]);
  const L = [];
  L.push('### Outcomes');
  L.push('');
  L.push('| arm | runs | win | end night med (IQR) | beam share | beam share @L3+ (n) | Caranguejo-Rei TTK s (kills/fights) | Leviatã TTK s (kills/fights) | lvl N3 | lvl N7 | lvl N10 | lvl N14 | 1st kill N1 s | N1 end HP |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, , s] of rows) {
    const bc = s.boss.crabKing, bl = s.boss.leviathan;
    L.push('| ' + [
      k, s.n + (s.errors ? ' (+' + s.errors + ' err)' : ''), pct(s.winRate), endCell(s),
      pct(s.share.beam), pct(s.beamL3.med) + ' (' + s.beamL3.n + ')',
      fmt(bc.ttk) + ' (' + bc.kills + '/' + bc.fights + ')', fmt(bl.ttk) + ' (' + bl.kills + '/' + bl.fights + ')',
      fmt(s.level[3]), fmt(s.level[7]), fmt(s.level[10]), fmt(s.level[14]),
      fmt(s.firstKill, 1), pct(s.n1EndHp),
    ].join(' | ') + ' |');
  }
  L.push('');
  L.push('### Median damage taken per night (runs that reached the night; n reaching in brackets for the last column set)');
  L.push('');
  L.push('| arm | ' + Array.from({ length: NIGHTS }, (_, i) => 'N' + (i + 1)).join(' | ') + ' |');
  L.push('|---|' + '---|'.repeat(NIGHTS));
  for (const [k, , s] of rows) {
    L.push('| ' + k + ' | ' + Array.from({ length: NIGHTS }, (_, i) => {
      const n = i + 1;
      return s.reached[n] ? fmt(s.taken[n]) + (s.reached[n] < s.n ? ' (' + s.reached[n] + ')' : '') : '–';
    }).join(' | ') + ' |');
  }
  L.push('');
  L.push('### Median share of creature damage by weapon');
  L.push('');
  L.push('| arm | ' + WEAPONS.join(' | ') + ' |');
  L.push('|---|' + '---|'.repeat(WEAPONS.length));
  for (const [k, , s] of rows) L.push('| ' + k + ' | ' + WEAPONS.map(w => pct(s.share[w])).join(' | ') + ' |');
  L.push('');
  L.push('Legend: end night = night of death (W = survived all 14; IQR = 25th–75th percentile). Beam share = the');
  L.push('Lente de Fresnel\'s part of all damage dealt to regular creatures (boss excluded, overkill not counted), median');
  L.push('over runs; "@L3+" counts only nights that began with the Lente at level 3 or more, over the runs that had such');
  L.push('nights (n). TTK = seconds from the boss being fully emerged to its death, median over kills. Levels = level at');
  L.push('the start of that night. 1st kill = seconds into night 1. N1 end HP = HP left at the end of night 1 (% of max).');
  if (opts.targets !== false) {
    L.push('');
    L.push(renderTargets(arms));
  }
  return L.join('\n');
}

// ------------------------------------------------------------------ balance targets

function rising(seq) {
  // last above first, and at most one step down along the way
  const v = seq.filter(x => x != null);
  if (v.length < 2) return false;
  let dips = 0;
  for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) dips++;
  return v[v.length - 1] > v[0] && dips <= 1;
}

export function evaluateTargets(arms) {
  // one target table per tuning package (meta.tuneName)
  const packages = new Map();
  for (const [k, a] of arms) {
    const p = a.meta.tuneName || 'none';
    if (!packages.has(p)) packages.set(p, []);
    packages.get(p).push({ key: k, meta: a.meta, s: summarizeArm(a.runs) });
  }
  const out = [];
  for (const [pkg, list] of packages) {
    const find = (bot, picks) => list.find(x => x.meta.bot === bot && x.meta.picks === picks && !x.meta.botOpts);
    const checks = [];
    const add = (id, name, pass, detail) => checks.push({ id, name, pass, detail });

    const idles = list.filter(x => x.meta.bot === 'idle');
    for (const x of idles) {
      const m = x.s.endNight.med;
      add('T1', 'idle never wins, median death night 5–8 (' + x.key + ')', x.s.wins === 0 && m != null && m >= 5 && m <= 8,
        'wins ' + x.s.wins + '/' + x.s.n + ', median end night ' + fmt(m, 1));
    }
    const kr = find('kite', 'random');
    if (kr) add('T2', 'kite/random win rate 40–80%', kr.s.winRate >= 0.4 && kr.s.winRate <= 0.8, pct(kr.s.winRate));
    const sr = find('skilled', 'random');
    if (sr) add('T2', 'skilled/random win rate ≥ 70%', sr.s.winRate >= 0.7, pct(sr.s.winRate));

    const firsts = FIRSTS.map(p => find('kite', p)).filter(Boolean);
    if (firsts.length >= 2) {
      const wr = firsts.map(x => x.s.winRate);
      const spread = Math.max(...wr) - Math.min(...wr);
      add('T3', 'kite xFirst win-rate spread ≤ 40 pp', spread <= 0.4,
        Math.round(spread * 100) + ' pp (' + firsts.map(x => x.meta.picks + ' ' + pct(x.s.winRate)).join(', ') + ')');
    }
    const kites = list.filter(x => x.meta.bot === 'kite');
    const pooled = [].concat(...kites.map(x => x.s.beamL3.values));
    if (pooled.length) {
      const m = median(pooled);
      add('T3', 'beam median share at L3+ ≤ 50% (kite arms pooled)', m <= 0.5, pct(m) + ' over ' + pooled.length + ' runs');
    }

    if (kr) {
      const t = kr.s.taken;
      const r26 = [2, 3, 4, 5, 6].map(n => t[n]);
      const r813 = [8, 9, 10, 11, 12, 13].map(n => t[n]);
      add('T4', 'kite/random: night 3 median ≥ 3', t[3] != null && t[3] >= 3, fmt(t[3]));
      add('T4', 'kite/random: night 6 median ≥ 10', t[6] != null && t[6] >= 10, fmt(t[6]));
      add('T4', 'kite/random: rises across nights 2–6', rising(r26), r26.map(v => fmt(v)).join(' → '));
      add('T4', 'kite/random: rises across nights 8–13', rising(r813), r813.map(v => fmt(v)).join(' → '));
      const others = Object.entries(t).filter(([n, v]) => Number(n) !== NIGHTS && v != null).map(([, v]) => v);
      add('T4', 'kite/random: night 14 is the hardest night', t[NIGHTS] != null && t[NIGHTS] >= Math.max(...others),
        'N14 ' + fmt(t[NIGHTS]) + ' vs max other ' + fmt(Math.max(...others)) + ' (n reaching N14 = ' + kr.s.reached[NIGHTS] + ')');
      const ck = kr.s.boss.crabKing, lv = kr.s.boss.leviathan;
      add('T5', 'kite/random: Caranguejo-Rei TTK 30–90 s', ck.ttk != null && ck.ttk >= 30 && ck.ttk <= 90,
        fmt(ck.ttk) + ' s (' + ck.kills + '/' + ck.fights + ' killed)');
      add('T5', 'kite/random: Leviatã TTK 60–150 s', lv.ttk != null && lv.ttk >= 60 && lv.ttk <= 150,
        fmt(lv.ttk) + ' s (' + lv.kills + '/' + lv.fights + ' killed)');
    }
    // "~4 s": up to 4.5 s passes
    for (const x of [kr].concat(idles).filter(Boolean)) {
      add('T6', 'night 1 first kill within ~4 s (' + x.key + ')', x.s.firstKill != null && x.s.firstKill <= 4.5, fmt(x.s.firstKill, 1) + ' s');
    }
    for (const x of idles) {
      add('T6', 'idle ends night 1 with ≥ 50% HP (' + x.key + ')', x.s.n1EndHp != null && x.s.n1EndHp >= 0.5, pct(x.s.n1EndHp));
    }
    out.push({ pkg, checks });
  }
  return out;
}

export function renderTargets(arms) {
  const L = [];
  for (const { pkg, checks } of evaluateTargets(arms)) {
    L.push('### Targets' + (pkg !== 'none' ? ' — tune ' + pkg : ''));
    L.push('');
    L.push('| target | check | result | measured |');
    L.push('|---|---|---|---|');
    for (const c of checks) L.push('| ' + c.id + ' | ' + c.name + ' | ' + (c.pass ? 'PASS' : '**FAIL**') + ' | ' + c.detail + ' |');
    L.push('');
  }
  return L.join('\n');
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const files = [];
  let out = null, targets = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i];
    else if (args[i] === '--no-targets') targets = false;
    else if (args[i] === '-h' || args[i] === '--help') {
      console.log('Usage: node tools/balance-summary.mjs <result.json>... [--out SUMMARY.md] [--no-targets]');
      process.exit(0);
    } else files.push(args[i]);
  }
  if (!files.length) {
    console.error('balance-summary: give one or more result files from tools/balance.mjs');
    process.exit(2);
  }
  const md = renderMarkdown(loadResults(files), { targets });
  if (out) fs.writeFileSync(out, md + '\n');
  console.log(md);
}
