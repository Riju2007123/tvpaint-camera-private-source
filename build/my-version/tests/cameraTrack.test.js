const test = require('node:test');
const assert = require('node:assert');
const { CameraTrack } = require('../src/cameraTrack.js');

function track(opts) { return new CameraTrack(Object.assign({ cameraWidth: 1920, cameraHeight: 1080 }, opts)); }

test('defaults: no keys → position = camera size, zoom 1, rotation 0 (observed constants)', () => {
  const t = track();
  const s = t.evaluate(5);
  assert.equal(s.x, 1920); assert.equal(s.y, 1080);
  assert.equal(s.rotation, 0); assert.equal(s.zoom, 1);
});

test('sparse property: only zoom keys exist → rotation/position keep defaults', () => {
  const t = track();
  t.setKey(10, 'zoom', { zoom: 2 });
  const s = t.evaluate(10);
  assert.equal(s.zoom, 2);
  assert.equal(s.rotation, 0);
  assert.deepEqual([s.x, s.y], [t.cameraWidth, t.cameraHeight]);
});

test('interpolates between previous and next key with the property', () => {
  const t = track();
  t.setKey(10, 'zoom', { zoom: 1 });
  t.setKey(20, 'zoom', { zoom: 3 });
  assert.ok(Math.abs(t.evaluate(15).zoom - 2) <= 2 / 65535); // linear default curve (uint16 table quantization, binary parity)
  assert.equal(t.evaluate(10).zoom, 1); // exact frame win with the property
  assert.equal(t.evaluate(20).zoom, 3);
});

test('exact-frame key without the property flag does NOT stop search (sparse parity)', () => {
  const t = track();
  t.setKey(15, 'rotation', { rotation: 90 }); // irrelevant property at 15
  assert.equal(t.evaluate(15).rotation, 90);
  // position ignores a rotation-only key → default
  assert.deepEqual([t.evaluate(15).x, t.evaluate(15).y], [1920, 1080]);
});

test('before first / after last key: value taken from boundary key with the property', () => {
  const t = track();
  t.setKey(30, 'zoom', { zoom: 2.5 });
  assert.equal(t.evaluate(10).zoom, 2.5);
  assert.equal(t.evaluate(90).zoom, 2.5);
});

test('error strings parity', () => {
  const t = track({ startFrame: 10, endFrame: 40 });
  assert.equal(t.infoFrame(5), "Given frame out of camera layer's range");
  assert.equal(t.infoFrame(50), "Given frame out of camera layer's range");
});

test('span ≤ 1 guarded to 1 (division guard observed as dVar7 <= 1 → 1)', () => {
  const t = track({ startFrame: 7, endFrame: 7 });
  assert.equal(t.evaluate(7).zoom, 1); // single-frame layer still safe
});

test('progressAtSceneTime maps scene time into layer progress and clamps', () => {
  const t = track({ startFrame: 0, endFrame: 100 });
  t.setSceneRange(0, 100);
  assert.equal(t.progressAtSceneTime(0), 0);
  assert.equal(t.progressAtSceneTime(1), 1);
  assert.equal(t.progressAtSceneTime(0.5), 0.5);
  assert.equal(t.progressAtSceneTime(2), 1);
  assert.equal(t.progressAtSceneTime(-1), 0);
});
