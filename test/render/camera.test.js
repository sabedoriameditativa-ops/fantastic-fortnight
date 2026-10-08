import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, ZOOM_MIN } from '../../client/battle/camera.js';

test('portrait auto camera fits both initial fleets on the first populated frame', () => {
  const camera = createCamera({ world: { w: 2800, h: 1600 } });
  camera.setViewport(0, 313, 390, 219);
  camera.update(0.016, new Map(), 0); // initial draw arrives before the worker frame
  const ships = new Map([
    [1, { id: 1, x: 380, y: 500, size: 40, team: 0 }],
    [2, { id: 2, x: 2420, y: 1100, size: 40, team: 1 }],
  ]);
  camera.update(0.016, ships, 16);
  assert.ok(camera.zoom < ZOOM_MIN, 'phone may zoom out past the desktop floor');
  for (const ship of ships.values()) {
    assert.ok(camera.isVisible(ship.x, ship.y, ship.size / 2));
    assert.ok(camera.worldToScreenX(ship.x) > 0 && camera.worldToScreenX(ship.x) < 390);
    assert.ok(camera.worldToScreenY(ship.y) > 313 && camera.worldToScreenY(ship.y) < 532);
  }
  camera.zoomBy(1e6);
  for (let i = 0; i < 60; i++) camera.update(1 / 60, ships, 16 + i * 16);
  assert.ok(camera.zoom <= 2, 'maximum detail zoom remains bounded');
});

test('reduced motion eliminates camera shake without changing its target', () => {
  const camera = createCamera({ world: { w: 2800, h: 1600 }, reducedMotion: true });
  camera.jumpTo(1000, 800, 1); camera.setMode('free'); camera.addTrauma(1);
  camera.update(0.016, new Map(), 16);
  assert.equal(camera.shakeX, 0); assert.equal(camera.shakeY, 0);
  assert.equal(camera.x, 1000); assert.equal(camera.y, 800);
});
