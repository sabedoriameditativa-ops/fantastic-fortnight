import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { T, fmt, errorMessage, fleetErrorMessage, difficultyName, difficultyDescription } from '../../client/i18n.js';
import { AI_PROFILES } from '../../shared/aiProfiles.js';
import { FLEET_LIMITS } from '../../shared/constants.js';
import { ERR } from '../../shared/protocol.js';
import { FLEET_ERR } from '../../shared/fleet.js';
import { DIFFICULTIES } from '../../shared/constants.js';

describe('i18n', () => {
  test('fmt fills placeholders and leaves unknown ones', () => {
    assert.equal(fmt('{a} e {b}', { a: 1, b: 'x' }), '1 e x');
    assert.equal(fmt('{a} {c}', { a: 1 }), '1 {c}');
    assert.equal(fmt('sem params'), 'sem params');
  });

  test('every protocol error code has a pt-BR message', () => {
    for (const code of Object.values(ERR)) {
      const msg = errorMessage(code);
      assert.ok(msg && !msg.includes('desconhecido'), `${code}: ${msg}`);
      assert.ok(!/\{\w+\}/.test(msg), `${code}: unfilled placeholder in "${msg}"`);
    }
    assert.match(errorMessage('WHATEVER'), /desconhecido/);
    for (const code of ['TIMEOUT', 'DISCONNECTED', 'CONNECT_FAILED', 'NOT_CONNECTED']) assert.ok(T.err[code]);
  });

  test('fleet error codes produce specific messages with details', () => {
    for (const code of Object.values(FLEET_ERR)) assert.ok(fleetErrorMessage(code, {}).length > 5, code);
    assert.equal(fleetErrorMessage('FLEET_OVER_BUDGET', { cost: 1600, budget: 1500 }), 'Frota ultrapassa o orçamento em 100 pts.');
    assert.match(fleetErrorMessage('FLEET_SHIP_COUNT', { count: 0, min: 1, max: 40 }), /pelo menos 1/);
    assert.match(fleetErrorMessage('FLEET_SHIP_COUNT', { count: 41, min: 1, max: 40 }), /no máximo 40/);
    assert.match(fleetErrorMessage('FLEET_CLASS_CAP', { sizeClass: 'capital', cap: 2, count: 3 }), /Limite de 2 nave\(s\) capital/);
    // server FLEET_INVALID carrying the fleet code as detail
    assert.match(errorMessage('FLEET_INVALID', { code: 'FLEET_OVER_BUDGET', detail: { cost: 900, budget: 800 } }), /100 pts/);
    // fleet codes passed directly to errorMessage
    assert.match(errorMessage('FLEET_CLASS_CAP', { sizeClass: 'mothership', cap: 1, count: 2 }), /nave-mãe/);
    // FLEET_SHIP_COUNT has no direct T.fleetErr entry (rendered via _MIN/_MAX) but is a fleet code
    assert.match(errorMessage('FLEET_SHIP_COUNT', { count: 41, min: 1, max: 40 }), /no máximo 40/);
    assert.match(errorMessage('FLEET_INVALID', { code: 'FLEET_SHIP_COUNT', detail: { count: 0, min: 1, max: 40 } }), /pelo menos 1 nave/);
    assert.doesNotMatch(errorMessage('FLEET_INVALID', { code: 'FLEET_SHIP_COUNT', detail: { count: 0, min: 1, max: 40 } }), /FLEET_SHIP_COUNT/);
  });

  test('ROOM_FULL with the server-limit details is not "room is full"', () => {
    assert.equal(errorMessage('ROOM_FULL'), T.err.ROOM_FULL);
    assert.equal(errorMessage('ROOM_FULL', 'server'), T.err.ROOM_LIMIT);
    assert.equal(errorMessage('ROOM_FULL', 'codes'), T.err.ROOM_LIMIT);
    assert.notEqual(T.err.ROOM_LIMIT, T.err.ROOM_FULL);
  });

  test('difficulty descriptions derive the budget percentage from AI_PROFILES', () => {
    for (const d of DIFFICULTIES) {
      const txt = difficultyDescription(d, AI_PROFILES[d].budgetMul);
      assert.ok(txt.length > 10, d);
      assert.ok(!/\{pct\}/.test(txt), `${d}: placeholder filled`);
      const pct = Math.round(Math.abs(AI_PROFILES[d].budgetMul - 1) * 100);
      if (pct > 0) assert.match(txt, new RegExp(`${pct}%`), `${d}: mentions ${pct}%`);
      else assert.doesNotMatch(txt, /%/, `${d}: no percentage when the budget is the same`);
    }
    assert.match(difficultyDescription('especialista', 1.2), /20% a mais/);
    assert.doesNotMatch(difficultyDescription('especialista', 1.2), /30%/);
    assert.doesNotMatch(difficultyDescription('dificil', 1), /%/);
    assert.equal(difficultyDescription('nope', 1), '');
  });

  test('how-to text matches the shared rules (Vorrax tiny cap, damage tiebreak) and reset wording', () => {
    const step2 = T.howto.steps[1].text;
    assert.match(step2, new RegExp(`${FLEET_LIMITS.maxPerSizeClass.tiny} minúsculas`));
    assert.match(step2, new RegExp(`${FLEET_LIMITS.tinyCapByFaction.vorrax} para Vorrax`));
    assert.match(T.howto.steps[3].text, /2%.*dano/);
    assert.match(T.options.resetConfirm, /modo Um jogador/);
  });

  test('NOT_ALL_READY lists the missing players', () => {
    const msg = errorMessage('NOT_ALL_READY', { missing: [{ name: 'Bia', reason: 'fleet' }, { name: 'Caio', reason: 'ready' }, 'slots'] });
    assert.match(msg, /Bia \(sem frota\)/);
    assert.match(msg, /Caio \(não está pronto\)/);
    assert.match(msg, /slots/);
    const srv = errorMessage('NOT_ALL_READY', { missing: [{ team: 1, slot: 0, reason: 'empty' }, { team: 0, slot: 1, reason: 'no_fleet' }, { team: 0, slot: 2, reason: 'not_ready' }, { team: 1, slot: 1, reason: 'disconnected' }] });
    assert.match(srv, /Laranja · vaga 1 \(vaga livre\)/);
    assert.match(srv, /Azul · vaga 2 \(sem frota\)/);
    assert.match(srv, /Azul · vaga 3 \(não está pronto\)/);
    assert.match(srv, /Laranja · vaga 2 \(desconectado\)/);
  });

  test('difficulty names and the pt-BR surface of key sections', () => {
    for (const d of DIFFICULTIES) assert.ok(difficultyName(d) && difficultyName(d) !== d);
    assert.equal(T.menu.single, 'Um jogador');
    assert.equal(T.app.team[0], 'Time Azul');
    assert.ok(T.howto.steps.length >= 4);
    for (const k of ['facil', 'normal', 'dificil', 'especialista']) assert.ok(T.sp.diffDesc[k]);
  });
});
