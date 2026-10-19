const test = require('node:test');
const assert = require('node:assert');
const { CameraTrack } = require('../src/cameraTrack.js');

function track(opts) { return new CameraTrack(Object.assign({ cameraWidth: 1920, cameraHeight: 1080 }, opts)); }

test('v2 defaults: no keys → size = camera rect, rotation 0, zoom 1 (observed constants)', () => {
  const t = track();
  const s = t.evaluate(5);
  assert.equal(s.width, 1920); assert.equal(s.height, 1080);
  assert.equal(s.rotation, 0); assert.equal(s.zoom, 1);
});

test('v1→v2 semantic fix: size keys frame the corners; pan comes from the PATH', () => {
  const t = track({ startFrame: 1, endFrame: 40 });
  t.setKey(10, 'size', { width: 960, height: 540 });
  t.setPathPoint(1, 0, 0); t.setPathPoint(40, 200, 100);
  const c10 = t.corners(10);
  assert.equal(Math.round(c10.tr.x - c10.tl.x), 960);          // width drives TR-TL distance
  assert.equal(Math.round(c10.bl.y - c10.tl.y), 540);          // height drives BL-TL distance
  const s1 = t.evaluate(1), s40 = t.evaluate(40);
  assert.equal(s1.cx, 0); assert.equal(s40.cx, 200);           // pan = path, not size keys
});

test('no path point → fallback centered view (FUN_1401da730 fallback)', () => {
  const t = track({ viewWidth: 1000, viewHeight: 800 });
  const s = t.evaluate(3);
  assert.equal(s.cx, 500); assert.equal(s.cy, 400);
});

test('rotate 90°: corners swap axis distances (still axis-aligned distances)', () => {
  const t = track();
  t.setKey(5, 'rotation', { rotation: 90 });
  const c = t.corners(5);
  const w = Math.round(Math.hypot(c.tr.x - c.tl.x, c.tr.y - c.tl.y));
  const h = Math.round(Math.hypot(c.bl.x - c.tl.x, c.bl.y - c.tl.y));
  assert.equal(w, 1920); assert.equal(h, 1080);
});

test('zoom scales the framed rectangle', () => {
  const t = track();
  t.setKey(5, 'zoom', { zoom: 2 });
  const c = t.corners(5);
  const w = Math.round(Math.hypot(c.tr.x - c.tl.x, c.tr.y - c.tl.y));
  assert.equal(w, 3840);
});

test('interpolation parity: linear default curve → midpoint halfway', () => {
  const t = track();
  t.setKey(10, 'zoom', { zoom: 1 });
  t.setKey(20, 'zoom', { zoom: 3 });
  assert.ok(Math.abs(t.evaluate(15).zoom - 2) <= 2 / 65535); // uint16 table quantization parity
  assert.equal(t.evaluate(10).zoom, 1);
  assert.equal(t.evaluate(20).zoom, 3);
});

test('sparse property parity: exact frame key only wins for its own property', () => {
  const t = track();
  t.setKey(15, 'rotation', { rotation: 90 });
  assert.equal(t.evaluate(15).rotation, 90);
  const s = t.evaluate(15);
  assert.deepEqual([s.width, s.height], [1920, 1080]);
});

test('before first / after last key: boundary key holds', () => {
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

test('infoFrame 6-float order = pathX pathY rotation zoom*100 sizeX sizeY (assembly order)', () => {
  const t = track({ startFrame: 1, endFrame: 10, viewWidth: 400, viewHeight: 300 });
  t.setPathPoint(1, 12, 34);
  t.setKey(1, 'rotation', { rotation: 45 });
  t.setKey(1, 'zoom', { zoom: 1.5 });
  t.setKey(1, 'size', { width: 800, height: 450 });
  const f = t.infoFrame(1).split(' ').map(Number);
  assert.equal(f[0], 12); assert.equal(f[1], 34);
  assert.equal(f[2], 45);
  assert.equal(f[3], 150);          // zoom reported ×100 like the binary
  assert.equal(f[4], 800); assert.equal(f[5], 450);
});

test('span ≤ 1 guarded to 1', () => {
  const t = track({ startFrame: 7, endFrame: 7 });
  assert.equal(t.evaluate(7).zoom, 1);
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
