import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ABILITIES, FACTION_IDS } from '../../shared/catalog.js';
import {
  ABILITY_SOUNDS, RECIPES, createVoiceContext, applyFlavor, finalizeVoice,
  makeRnd, runRecipe,
} from '../../client/audio/recipes.js';
import { MockAudioContext, MockParam, MockSource, paramsOf, reaches } from './mockAudioContext.js';

const EXPANDED = ['shot.pilot', 'cast.boost', 'cast.shield', 'cast.gravity', 'cast.debuff', 'cast.emp', 'cast.repair', 'cast.regrow'];

function renderGraph(name, { faction = null, size = 2, seed = 42, rnd = makeRnd(seed) } = {}) {
  const ctx = new MockAudioContext();
  ctx.currentTime = 12;
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const noise = Object.fromEntries(['white', 'pink', 'brown', 'crackle'].map((kind) => [kind, { kind, duration: 2 }]));
  const v = createVoiceContext(ctx, {
    t: 12.02, out, gain: 0.5, size, faction, rnd, noise, reverbIn: ctx.destination,
    kind: name.split('.')[0], count: 4, dur: 1.2,
  });
  const first = ctx.created.length;
  v.out = applyFlavor(v, out, ctx.destination);
  assert.equal(runRecipe(name, v), true, `${name} registered`);
  let cleaned = 0;
  finalizeVoice(v, () => { cleaned++; });
  return { ctx, v, nodes: ctx.since(first), get cleaned() { return cleaned; } };
}

function fingerprint(graph) {
  const ids = new Map(graph.nodes.map((node, i) => [node, i]));
  return JSON.stringify(graph.nodes.map((node) => ({
    kind: node.kind, type: node.type, buffer: node.buffer?.kind, offset: node._offset,
    started: node.started, stopped: node.stopped,
    params: Object.entries(node).filter(([, value]) => value instanceof MockParam)
      .map(([name, param]) => [name, param.value, param.events]),
    outputs: node.outputs.map((target) => target instanceof MockParam
      ? ['param', ids.get(target.owner)] : ['node', ids.get(target)]),
  })));
}

describe('expanded procedural combat sounds', () => {
  test('special cues map real catalog abilities to implemented, distinguishable recipes', () => {
    for (const [id, name] of Object.entries(ABILITY_SOUNDS)) {
      assert.ok(ABILITIES[id], `real ability: ${id}`);
      assert.equal(typeof RECIPES[name], 'function', `playable cue: ${id}`);
    }
    assert.equal(ABILITY_SOUNDS.gravity_snare, 'cast.debuff');
    assert.equal(ABILITY_SOUNDS.gravity_well, 'cast.gravity');
    assert.equal(ABILITY_SOUNDS.orbital_aegis, 'cast.shield');
    assert.notEqual(ABILITY_SOUNDS.molt, ABILITY_SOUNDS.reactive_nanites, 'organic regrowth differs from mechanical repair');
    assert.notEqual(ABILITY_SOUNDS.singularity, ABILITY_SOUNDS.emp_storm, 'gravity differs from electrical interference');
    const signatures = new Set(EXPANDED.map((name) => fingerprint(renderGraph(name))));
    assert.equal(signatures.size, EXPANDED.length, 'each new cue has its own audible graph and envelope');
  });

  test('every new cue preserves seed determinism and varies between events', () => {
    for (const name of EXPANDED) {
      for (const faction of FACTION_IDS) {
        const first = fingerprint(renderGraph(name, { faction, seed: 314 }));
        assert.equal(first, fingerprint(renderGraph(name, { faction, seed: 314 })), `${name}/${faction}: replay`);
        assert.notEqual(first, fingerprint(renderGraph(name, { faction, seed: 315 })), `${name}/${faction}: jitter`);
      }
    }
  });

  test('pilot shots retain distinct faction timbres and a short, immediate attack', () => {
    const signatures = new Set();
    for (const faction of FACTION_IDS) {
      const graph = renderGraph('shot.pilot', { faction, size: 1 });
      signatures.add(fingerprint(graph));
      const sources = graph.nodes.filter((node) => node instanceof MockSource);
      assert.ok(sources.some((node) => node.started === graph.v.t), `${faction}: immediate feedback`);
      assert.ok(sources.every((node) => node.stopped - graph.v.t < 0.3), `${faction}: no long shot tail`);
    }
    assert.equal(signatures.size, FACTION_IDS.length);
  });

  test('Astral has its own audible processing for both pitched and noise-only sounds', () => {
    for (const name of ['shot.plasma', 'impact.intercept', 'cast.gravity']) {
      const neutral = renderGraph(name);
      const astral = renderGraph(name, { faction: 'astral' });
      assert.notEqual(fingerprint(astral), fingerprint(neutral), `${name}: Astral is not the default flavor`);
      assert.equal(astral.nodes.length, neutral.nodes.length + 2, `${name}: bounded flavor cost`);
      assert.ok(astral.nodes.some((node) => node.kind === 'biquad' && node.type === 'lowpass' && node.frequency.events.length > 1), 'moving resonance');
    }
  });

  test('all new graphs fit 14 recipe/flavor nodes, reach the output and clean up once', () => {
    for (const name of EXPANDED) {
      for (const faction of [...FACTION_IDS, null]) {
        for (const size of [0, 1, 2, 3, 4]) {
          const graph = renderGraph(name, { faction, size });
          const label = `${name}/${faction}/${size}`;
          assert.ok(graph.nodes.length <= 14, `${label}: leaves two nodes for the engine wrapper`);
          for (const node of graph.nodes) {
            assert.ok(reaches(node, graph.ctx.destination), `${label}: connected ${node.kind}`);
            for (const param of paramsOf(node)) for (const event of param.events) {
              assert.ok(Number.isFinite(event.v) && event.t >= graph.v.t, `${label}: valid automation`);
              if (event.m === 'exp') assert.ok(event.v > 0, `${label}: positive exponential target`);
            }
            if (node instanceof MockSource) {
              assert.ok(node.stopped > node.started, `${label}: source ends`);
              assert.ok(node.stopped - node.started <= 4 + 1e-9, `${label}: bounded lifetime`);
            }
          }
          graph.ctx.advance(5);
          assert.equal(graph.cleaned, 1, `${label}: cleanup runs`);
          assert.ok(graph.nodes.every((node) => node.disconnected), `${label}: no orphan nodes`);
          graph.v.cleanup();
          assert.equal(graph.cleaned, 1, `${label}: cleanup is idempotent`);
        }
      }
    }
  });

  test('capital explosions respect the four-second source cap even at maximum jitter', () => {
    for (const faction of [...FACTION_IDS, null]) {
      const maxRnd = (min = 0, max = 1) => max;
      maxRnd.chance = () => true;
      const graph = renderGraph('death', { faction, size: 4, rnd: maxRnd });
      for (const source of graph.v.sources) {
        assert.ok(source.stopped - source.started <= 4 + 1e-9, `${faction}/${source.kind}: lifetime ${source.stopped - source.started}`);
      }
    }
  });

  test('weapon contours distinguish immediate rail discharge, laser snap and plasma ripple', () => {
    const rail = renderGraph('shot.railgun');
    const crack = rail.nodes.find((node) => node.kind === 'bufsrc');
    assert.ok(crack.started - rail.v.t < 0.025, 'rail discharge follows the shot event immediately');
    const laser = renderGraph('shot.laser');
    const oscillator = laser.nodes.find((node) => node.kind === 'osc');
    const attack = oscillator.frequency.events.find((event) => event.m === 'exp');
    assert.ok(attack && attack.t - laser.v.t < 0.05, 'laser has a fast pitch attack');
    assert.ok(attack.v < oscillator.frequency.events[0].v, 'laser attack descends');
    const plasma = renderGraph('shot.plasma');
    assert.ok(plasma.nodes.some((node) => node.outputs.some((target) => target instanceof MockParam
      && target === target.owner.frequency && target.owner.kind === 'osc')), 'plasma has frequency modulation');
  });
});
