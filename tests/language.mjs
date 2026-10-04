// Language test: browser language picks the UI language, the toggle (title + pause) switches at once and is saved,
// English mode leaves no Portuguese on any screen, Portuguese mode keeps its text.
// Usage: node tests/language.mjs
// The English title is not final: nothing here names it (it is only checked to be English and used everywhere).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT, loadPlaywright, launchChromium, blockNetwork, watchErrors, assert, sleep, createReport } from './helpers.mjs';

const URL_ = pathToFileURL(path.join(ROOT, 'index.html')).href;
const VIEWPORT = { width: 1280, height: 720 };
const STORE_KEY = 'quinzena-fantastica:v1';

// Portuguese tell-tales: accented letters, and common words that are not English words
const PT_WORDS = ['de', 'da', 'das', 'dos', 'em', 'um', 'uma', 'para', 'com', 'que', 'ou', 'nas', 'nos', 'mais', 'menos',
  'noite', 'noites', 'som', 'ligado', 'desligado', 'ligar', 'desligar', 'recorde', 'pontos', 'vida', 'chefe', 'farol',
  'ilha', 'brasas', 'criaturas', 'melhoria', 'melhorias', 'jogar', 'sair', 'sim', 'voltar', 'pausado', 'pausar',
  'abates', 'arma', 'passiva', 'novo', 'nova', 'amanhecer', 'dia', 'toque', 'setas', 'mover', 'regras', 'controles',
  'idioma', 'continuar', 'cancelar', 'escolha', 'subiu', 'quinzena', 'catorze', 'perdida', 'lanterna', 'pavio',
  'casco', 'botas', 'moeda', 'quente', 'luz', 'apagou', 'tentar', 'jogo', 'diário', 'caranguejo', 'dano', 'faltam',
  'falta', 'sobrevivido', 'recomeçar', 'tela', 'inicial', 'pausa', 'até', 'mar', 'cada', 'seu', 'sua', 'suas'];
const ATTRS = ['aria-label', 'aria-valuetext', 'aria-roledescription', 'title', 'alt', 'placeholder'];

// Installed in every page: window.__ptLeftovers() lists Portuguese found outside [lang^=pt] in <title>, the meta
// description, every text node of the body (shown or hidden) and the accessibility attributes.
function installScanner({ words, attrs }) {
  window.__ptLeftovers = () => {
    const out = [];
    const re = new RegExp('(^|[^\\p{L}])(' + words.join('|') + ')(?=$|[^\\p{L}])', 'iu');
    const accents = /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ]/;
    const inPt = node => {
      for (let e = node.nodeType === 1 ? node : node.parentElement; e && e !== document.documentElement; e = e.parentElement) {
        if (/^pt/i.test(e.getAttribute('lang') || '')) return true;
      }
      return false;
    };
    const where = e => '<' + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '>';
    const check = (place, s) => {
      if (!s || !s.trim()) return;
      const m = s.match(accents) || s.match(re);
      if (m) out.push(`${place} "${s.trim().slice(0, 90)}" [${m[0].trim()}]`);
    };
    check('<title>', document.title);
    check('meta description', (document.querySelector('meta[name=description]') || {}).content);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement.closest('script, style') && !inPt(n)) check('text in ' + where(n.parentElement), n.nodeValue);
    }
    for (const e of document.body.querySelectorAll('*')) {
      for (const a of attrs) if (e.hasAttribute(a) && !inPt(e)) check(`${a} of ${where(e)}`, e.getAttribute(a));
    }
    return out;
  };
}

const rep = createReport('Language');
const pw = await loadPlaywright();
const browser = await launchChromium(pw);
const errors = [];
const blocked = [];

async function open(locale, hash = '#debug') {
  const context = await browser.newContext({ viewport: VIEWPORT, locale });
  await blockNetwork(context, { blocked });
  await context.addInitScript(installScanner, { words: PT_WORDS, attrs: ATTRS });
  const page = await context.newPage();
  watchErrors(page, locale, errors);
  await page.goto(URL_ + hash);
  await ready(page);
  return { context, page };
}
const ready = page => page.waitForFunction(() => window.QF && !document.getElementById('app').hasAttribute('data-i18n-pending'), null, { timeout: 8000 });

const ui = page => page.evaluate(key => {
  const txt = sel => { const n = document.querySelector(sel); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; };
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { stored = 'unreadable'; }
  return {
    lang: window.QF.getState().lang, html: document.documentElement.lang, docTitle: document.title,
    h1: txt('#title-h'), sub: txt('.subtitle'), meta: document.querySelector('meta[name=description]').content,
    start: txt('#btn-start'), howto: txt('#btn-howto'),
    toggle: txt('#btn-lang-title .lang-name'), toggleLang: document.querySelector('#btn-lang-title .lang-name').lang,
    nightLabel: txt('#night-label'), killsUnit: txt('#kills-unit'), pauseH: txt('#pause-h'), resume: txt('#btn-resume'),
    focus: document.activeElement && document.activeElement.id, storedLang: stored && stored.lang,
  };
}, STORE_KEY);

const screen = page => page.evaluate(() => window.QF.getState().screen);
async function until(page, want, timeout = 8000) {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < timeout) {
    s = await screen(page);
    if (s === want) return;
    // a level-up on the way (the sunrise, a boss's embers) is answered with its first card
    if (s === 'levelup' && want !== 'levelup') await page.evaluate(() => { const c = document.querySelector('#lu-cards .card'); if (c) c.click(); });
    await sleep(50);
  }
  throw new Error(`screen ${s}, expected ${want}`);
}
const D = (page, fn, ...args) => page.evaluate(([f, a]) => window.QF.debug[f](...a), [fn, args]);

const ACCENTS = /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ]/;

try {
  await rep.step('1. Browser language: en-US and fr-FR open in English', async () => {
    const notes = [];
    for (const locale of ['en-US', 'fr-FR']) {
      const { context, page } = await open(locale, '');
      const u = await ui(page);
      assert(u.lang === 'en' && u.html === 'en', `${locale}: lang ${u.lang}, <html lang> ${u.html}`);
      assert(u.h1 && u.h1 === u.docTitle && u.h1 !== 'Quinzena Fantástica' && !ACCENTS.test(u.h1), `${locale}: title "${u.h1}" / <title> "${u.docTitle}"`);
      assert(u.meta.startsWith(u.h1 + ':'), `${locale}: meta description "${u.meta}"`);
      assert(u.start === 'Start' && u.howto === 'How to Play', `${locale}: buttons "${u.start}", "${u.howto}"`);
      assert(u.toggle === 'Português' && u.toggleLang === 'pt-BR', `${locale}: toggle "${u.toggle}" lang=${u.toggleLang}`);
      notes.push(`${locale} → "${u.h1}"`);
      await context.close();
    }
    return notes.join(', ');
  });

  await rep.step('2. Browser language: pt-BR opens in Portuguese', async () => {
    const { context, page } = await open('pt-BR', '');
    const u = await ui(page);
    await context.close();
    assert(u.lang === 'pt' && u.html === 'pt-BR', `lang ${u.lang}, <html lang> ${u.html}`);
    assert(u.h1 === 'Quinzena Fantástica' && u.docTitle === 'Quinzena Fantástica', `title "${u.h1}" / "${u.docTitle}"`);
    assert(u.sub === 'Catorze noites no farol da Ilha Perdida', 'subtitle ' + u.sub);
    assert(u.start === 'Começar' && u.howto === 'Como jogar', `buttons "${u.start}", "${u.howto}"`);
    assert(u.toggle === 'English' && u.toggleLang === 'en', `toggle "${u.toggle}" lang=${u.toggleLang}`);
    return `"${u.h1}", toggle "${u.toggle}"`;
  });

  await rep.step('3. Title toggle switches at once, keeps focus, and the choice survives a reload', async () => {
    const { context, page } = await open('en-US', '');
    await page.getByRole('button', { name: 'Switch language to Portuguese' }).click();
    let u = await ui(page);
    assert(u.lang === 'pt' && u.h1 === 'Quinzena Fantástica' && u.start === 'Começar' && u.html === 'pt-BR', `after click: ${u.lang} "${u.h1}"`);
    assert(u.focus === 'btn-lang-title', 'focus moved to ' + u.focus);
    assert(u.storedLang === 'pt', 'saved lang ' + u.storedLang);
    await page.reload();
    await ready(page);
    u = await ui(page);
    assert(u.lang === 'pt', 'after reload (browser still en-US): ' + u.lang);
    // back to English with the keyboard
    const btn = page.getByRole('button', { name: 'Mudar o idioma para inglês' });
    await btn.focus();
    await page.keyboard.press('Enter');
    u = await ui(page);
    assert(u.lang === 'en' && u.start === 'Start' && u.storedLang === 'en' && u.focus === 'btn-lang-title', `Enter: ${u.lang}, saved ${u.storedLang}, focus ${u.focus}`);
    await page.reload();
    await ready(page);
    u = await ui(page);
    await context.close();
    assert(u.lang === 'en', 'after second reload: ' + u.lang);
    return 'en → pt (click) → reload pt → en (Enter) → reload en';
  });

  await rep.step('4. Pause toggle re-renders HUD and pause menu at once', async () => {
    const { context, page } = await open('pt-BR');
    await page.click('#btn-start');
    await until(page, 'playing');
    await D(page, 'godMode', true);
    await page.keyboard.press('p');
    await until(page, 'paused');
    let u = await ui(page);
    assert(u.pauseH === 'Pausado' && u.nightLabel === 'Noite 1/14' && u.resume === 'Continuar', `before: "${u.pauseH}", "${u.nightLabel}", "${u.resume}"`);
    await page.getByRole('button', { name: 'Mudar o idioma para inglês' }).click();
    u = await ui(page);
    assert(u.pauseH === 'Paused' && u.nightLabel === 'Night 1/14' && u.resume === 'Resume', `after: "${u.pauseH}", "${u.nightLabel}", "${u.resume}"`);
    assert(/^kills?$/.test(u.killsUnit), 'kills unit ' + u.killsUnit);
    assert(u.focus === 'btn-lang-pause', 'focus moved to ' + u.focus);
    assert(u.storedLang === 'en', 'saved lang ' + u.storedLang);
    const left = await page.evaluate(() => window.__ptLeftovers());
    assert(!left.length, 'Portuguese left after switching: ' + left.slice(0, 3).join(' | '));
    await page.keyboard.press('Enter'); // the toggle still has focus
    u = await ui(page);
    assert(u.pauseH === 'Pausado' && u.nightLabel === 'Noite 1/14', `back: "${u.pauseH}", "${u.nightLabel}"`);
    await context.close();
    return 'Pausado/Noite 1/14 → Paused/Night 1/14 → back';
  });

  await rep.step('5. English: no Portuguese on any screen (text, aria-labels, title)', async () => {
    const { context, page } = await open('en-US');
    const found = [];
    const seen = [];
    const scan = async name => {
      seen.push(name);
      for (const l of await page.evaluate(() => window.__ptLeftovers())) found.push(name + ': ' + l);
    };
    await scan('title');
    await page.click('#btn-howto');
    await until(page, 'howto');
    await scan('how-to');
    await page.click('#btn-howto-back');
    await page.click('#btn-start');
    await until(page, 'playing');
    await D(page, 'godMode', true);
    await sleep(600);
    await scan('HUD + night banner');
    await page.keyboard.press('m');
    await scan('HUD muted');
    await page.keyboard.press('m');
    await D(page, 'addXp', 400); // several level-ups queued: "n more to come"
    await until(page, 'levelup');
    await scan('level-up (queue)');
    await until(page, 'playing');
    await D(page, 'setTimeScale', 10); // quick sunrises
    for (let n = 1; n <= 13; n++) { // every Dawn hint
      if (n > 1) await D(page, 'setNight', n);
      await until(page, 'playing');
      await D(page, 'skipNight');
      await until(page, 'dawn');
      await scan('dawn after night ' + n);
      await page.waitForFunction(() => { // Dawn ignores Enter for a moment after it opens
        if (window.QF.getState().screen !== 'dawn') return true;
        document.getElementById('btn-next-night').click();
        return false;
      }, null, { polling: 100, timeout: 4000 });
    }
    await D(page, 'setTimeScale', 1);
    await until(page, 'playing');
    await page.keyboard.press('p');
    await until(page, 'paused');
    await scan('pause');
    await page.click('#btn-restart');
    await scan('confirm restart');
    await page.click('#btn-confirm-no');
    await page.click('#btn-quit');
    await scan('confirm quit');
    await page.click('#btn-confirm-no');
    await page.keyboard.press('p');
    await until(page, 'playing');
    await D(page, 'setNight', 7);
    await page.waitForFunction(() => window.QF.getState().bossAlive);
    await sleep(500);
    await scan('boss 7 (banner + bar)');
    await D(page, 'setNight', 14);
    await page.waitForFunction(() => window.QF.getState().bossAlive);
    await sleep(500);
    await scan('boss 14 (banner + bar)');
    await D(page, 'damageBoss', 2700); // enraged: toast
    await page.waitForFunction(() => document.getElementById('toast').textContent.trim().length > 0, null, { timeout: 2000 });
    await scan('boss 14 enraged (toast)');
    await D(page, 'damageBoss', 1e7);
    await until(page, 'victory');
    await scan('victory');
    await page.click('#btn-again');
    await until(page, 'playing');
    await D(page, 'godMode', false);
    await D(page, 'setHp', 0);
    await until(page, 'gameover');
    await scan('game over');
    await page.click('#btn-go-menu');
    await until(page, 'title');
    await scan('title with high score');
    const lang = (await ui(page)).lang;
    await context.close();
    assert(lang === 'en', 'language changed to ' + lang);
    assert(!found.length, found.length + ' leftover(s): ' + found.slice(0, 4).join(' | '));
    return `${seen.length} screens scanned`;
  });

  await rep.step('6. English: every level-up card (each upgrade at each level) has no Portuguese', async () => {
    const { context, page } = await open('en-US');
    const r = await page.evaluate(() => {
      const d = window.QF.debug;
      const ids = { spark: 5, beam: 5, aura: 5, anchors: 5, harpoon: 5, boots: 5, hull: 5, regen: 5, magnet: 5, wick: 5,
        powder: 5, hourglass: 5, tea: 1, coin: 1 };
      const problems = [];
      let cards = 0;
      for (const id in ids) {
        // card for reaching level L (the Spark is owned from the start, so its first card is level 2)
        for (let L = id === 'spark' ? 2 : 1; L <= ids[id]; L++) {
          d.startRun(1);
          d.setManualClock(true);
          for (let i = id === 'spark' ? 2 : 1; i < L; i++) d.grantUpgrade(id);
          d.addXp(20);
          d.runSteps(2);
          if (!d.setOffers([id])) { problems.push(`${id} L${L}: no level-up screen`); continue; }
          const card = document.querySelector('#lu-cards .card');
          const text = card ? card.textContent.replace(/\s+/g, ' ').trim() : '';
          if (!text) { problems.push(`${id} L${L}: no card`); continue; }
          cards++;
          for (const l of window.__ptLeftovers()) problems.push(`${id} L${L}: ${l}`);
        }
      }
      d.setManualClock(false);
      return { cards, problems };
    });
    await context.close();
    assert(!r.problems.length, r.problems.length + ' problem(s): ' + r.problems.slice(0, 4).join(' | '));
    assert(r.cards === 12 * 5 - 1 + 2, 'cards checked: ' + r.cards);
    return `${r.cards} cards`;
  });

  await rep.step('7. Portuguese: key strings unchanged', async () => {
    const { context, page } = await open('pt-BR');
    const t = sel => page.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);
    const want = async (sel, text) => { const got = await t(sel); assert(got === text, `${sel}: "${got}" ≠ "${text}"`); };
    await want('#title-h', 'Quinzena Fantástica');
    await want('.eyebrow', 'Diário do farol');
    await want('#btn-start', 'Começar');
    await page.click('#btn-howto');
    await want('#howto-h', 'Como jogar');
    await want('.rules li:nth-child(4)', 'Sobreviva às 14 noites. Nas noites 7 e 14, um chefe sobe do mar.');
    await page.click('#btn-howto-back');
    await page.click('#btn-start');
    await until(page, 'playing');
    await D(page, 'godMode', true);
    await want('#night-label', 'Noite 1/14');
    await D(page, 'addXp', 20);
    await until(page, 'levelup');
    await D(page, 'setOffers', ['spark']);
    await want('#lu-cards .card .card-name', 'Faísca');
    await page.keyboard.press('1');
    await until(page, 'playing');
    await page.keyboard.press('p');
    await until(page, 'paused');
    await want('#pause-h', 'Pausado');
    await want('#btn-resume', 'Continuar');
    await page.click('#btn-restart');
    await want('#confirm-text', 'Recomeçar perde o progresso desta quinzena.');
    await want('#btn-confirm-yes', 'Sim, recomeçar');
    await page.click('#btn-confirm-no');
    await page.keyboard.press('p');
    await until(page, 'playing');
    await D(page, 'godMode', false);
    await D(page, 'setHp', 0);
    await until(page, 'gameover');
    await want('#go-h', 'A luz se apagou');
    await want('#btn-retry', 'Tentar de novo');
    const label = await page.evaluate(() => document.getElementById('game').getAttribute('aria-label'));
    const hits = await page.evaluate(() => window.__ptLeftovers().length); // the scanner of steps 4-6 does see Portuguese
    await context.close();
    assert(label === 'Ilha Perdida — área de jogo', 'canvas aria-label ' + label);
    assert(hits > 30, 'the Portuguese scanner found only ' + hits + ' hits in Portuguese mode');
    return `title, how-to, HUD, card, pause, confirmation, game over, canvas label; scanner self-check ${hits} hits`;
  });

  await rep.step('8. No console errors, page errors or network requests', async () => {
    assert(!errors.length, errors.length + ' error(s): ' + errors.slice(0, 3).join(' | '));
    assert(!blocked.length, 'requests outside file: ' + blocked.slice(0, 3).join(' | '));
  });
} catch (err) {
  rep.record('Unexpected harness failure', false, String((err && err.message) || err).split('\n')[0]);
} finally {
  await browser.close();
}
for (const e of errors) console.log('  ' + e);
rep.finish();
