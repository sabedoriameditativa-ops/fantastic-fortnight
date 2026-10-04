// Turns tools/balance.mjs result files into markdown tables, one row per arm, plus a check of the balance targets.
// Usage: node tools/balance-summary.mjs results/*.json [--out SUMMARY.md] [--no-targets]
// Dev tool only (also imported by tools/balance.mjs to print a summary after a batch).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

const DEFAULT_VIEWPORT = '1280x800'; // tools/balance.mjs's default
// JSON with object keys sorted, so the same settings always give the same text (and hash)
const stable = v => JSON.stringify(v === undefined ? null : v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x));
const hash = v => createHash('sha1').update(stable(v)).digest('hex').slice(0, 6);
const fullNights = m => !m.nights || (m.nights[0] === 1 && m.nights[1] === NIGHTS);
const tuneTitle = m => (m.tuneName === 'inline' ? 'inline-' + hash(m.tune) : m.tuneName || 'none');

// Arm name: everything that changes the outcome (runs that differ only in their seeds share it and are added together).
// An inline --tune is named by a hash of its content, so two different inline tunes never merge.
export function armKey(m) {
  if (m.label) return m.label;
  const tn = tuneTitle(m);
  let k = m.bot + '/' + m.picks + (tn !== 'none' ? ' @' + tn : '');
  if (!fullNights(m)) k += ' N' + m.nights.join('-');
  if (m.botOpts) k += ' opts-' + hash(m.botOpts);
  if (m.viewport && m.viewport.join('x') !== DEFAULT_VIEWPORT) k += ' ' + m.viewport.join('x');
  return k;
}

const MERGE_FIELDS = ['bot', 'picks', 'tune', 'botOpts', 'nights', 'viewport', 'root', 'git', 'gitDirty'];

export function loadResults(files) {
  const arms = new Map(); // key → { meta, runs }
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
      throw new Error(f + ': ' + ((e && e.message) || e));
    }
    if (!data || !data.meta || !Array.isArray(data.runs)) throw new Error(f + ': not a tools/balance.mjs result (no meta/runs)');
    const key = armKey(data.meta);
    const arm = arms.get(key);
    if (!arm) {
      arms.set(key, { meta: data.meta, runs: data.runs.slice() });
      continue;
    }
    // same arm name: meant for more seeds of the same experiment, so say so when it is not
    for (const field of MERGE_FIELDS) {
      if (stable(arm.meta[field]) !== stable(data.meta[field])) {
        console.error('balance-summary: warning: ' + f + " merged into '" + key + "' but its " + field + ' differs (' +
          stable(data.meta[field]) + ' vs ' + stable(arm.meta[field]) + ')');
      }
    }
    const seen = new Set(arm.runs.map(r => r.seed));
    const twice = data.runs.filter(r => seen.has(r.seed)).length;
    if (twice) console.error('balance-summary: warning: ' + f + " merged into '" + key + "' repeats " + twice + ' seed(s) already counted');
    arm.runs.push(...data.runs);
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
  L.push('### Median damage taken per night (runs that reached the night; (n) = how many, when fewer than all runs)');
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
  L.push('Legend: end night = night of death (W = survived all 14; a run stopped by --nights counts as its last night + 1,');
  L.push('one that timed out or stalled as the night it was in; IQR = 25th–75th percentile). Beam share = the Lente de');
  L.push('Fresnel\'s part of all damage dealt to regular creatures (boss excluded, overkill not counted), median over runs;');
  L.push('"@L3+" counts only nights that began with the Lente at level 3 or more, over the runs that had such nights (n).');
  L.push('TTK = seconds from the boss being fully emerged to its death, median over kills. Levels = level at the start of');
  L.push('that night. 1st kill = seconds into night 1. N1 end HP = HP left at the end of night 1 (% of max).');
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
  // one target table per tuning package: same tune (by content) and viewport. The targets are about whole runs, so
  // arms that played only some nights (--nights) are left out.
  const packages = new Map();
  for (const [k, a] of arms) {
    if (!fullNights(a.meta)) continue;
    const vp = a.meta.viewport ? a.meta.viewport.join('x') : DEFAULT_VIEWPORT;
    const id = stable(a.meta.tune || null) + ' ' + vp;
    if (!packages.has(id)) {
      const tn = tuneTitle(a.meta);
      packages.set(id, { pkg: [tn !== 'none' ? 'tune ' + tn : '', vp !== DEFAULT_VIEWPORT ? vp : ''].filter(Boolean).join(' — ') || 'none', list: [] });
    }
    packages.get(id).list.push({ key: k, meta: a.meta, s: summarizeArm(a.runs) });
  }
  const out = [];
  for (const { pkg, list } of packages.values()) {
    const notes = [];
    const find = (bot, picks) => {
      const xs = list.filter(x => x.meta.bot === bot && x.meta.picks === picks && !x.meta.botOpts);
      if (xs.length > 1) notes.push(xs.length + ' arms are ' + bot + '/' + picks + ' (' + xs.map(x => x.key).join(', ') + '); the checks use ' + xs[0].key);
      return xs[0];
    };
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
    out.push({ pkg, checks, notes });
  }
  return out;
}

export function renderTargets(arms) {
  const L = [];
  for (const { pkg, checks, notes } of evaluateTargets(arms)) {
    if (!checks.length) continue;
    L.push('### Targets' + (pkg !== 'none' ? ' — ' + pkg : ''));
    L.push('');
    L.push('| target | check | result | measured |');
    L.push('|---|---|---|---|');
    for (const c of checks) L.push('| ' + c.id + ' | ' + c.name + ' | ' + (c.pass ? 'PASS' : '**FAIL**') + ' | ' + c.detail + ' |');
    L.push('');
    for (const n of notes) L.push('Note: ' + n + '.', '');
  }
  return L.join('\n');
}

// ------------------------------------------------------------------ CLI

// realpath on both sides: run through a symlinked checkout (or /tmp on macOS), argv[1] keeps the link
let isMain = false;
try { isMain = !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { /* not a file path */ }
if (isMain) {
  const USAGE = 'Usage: node tools/balance-summary.mjs <result.json>... [--out SUMMARY.md] [--no-targets]';
  const die = m => { console.error('balance-summary: ' + m); process.exit(2); };
  const args = process.argv.slice(2);
  const files = [];
  let out = null, targets = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) die('missing value for --out');
      out = args[++i];
    } else if (a === '--no-targets') targets = false;
    else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (a.startsWith('--')) die('unknown option ' + a + '\n' + USAGE);
    else files.push(a);
  }
  if (!files.length) die('give one or more result files from tools/balance.mjs\n' + USAGE);
  let arms;
  try {
    arms = loadResults(files);
  } catch (e) {
    die((e && e.message) || String(e));
  }
  const md = renderMarkdown(arms, { targets });
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, md + '\n');
  }
  console.log(md);
}
