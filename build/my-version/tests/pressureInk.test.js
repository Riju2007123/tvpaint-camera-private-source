const test = require('node:test');
const assert = require('node:assert');
const { Ink, readPoint } = require('../src/pressureInk.js');
const { EaseCurve } = require('../src/curve.js');

test('mouse events: no pen digitizer → fixed half pressure (device "has pressure" = false)', () => {
  const p = readPoint({ pointerType: 'mouse', clientX: 3, clientY: 4, pressure: 0.5 });
  assert.equal(p.isPen, false);
  assert.equal(p.hasPressure, false);
  assert.equal(p.pressure, 0.5);
});

test('pen events: pressure taken from the digitizer', () => {
  const p = readPoint({ pointerType: 'pen', clientX: 1, clientY: 2, pressure: 0.75 });
  assert.equal(p.isPen, true);
  assert.equal(p.hasPressure, true);
  assert.equal(p.pressure, 0.75);
});

test('eraser detection via buttons bit 0x20', () => {
  const p = readPoint({ pointerType: 'pen', pressure: 0.3, buttons: 32 });
  assert.equal(p.isEraser, true);
});

test('linear response curve → width = size * pressure', () => {
  const ink = new Ink({ size: 20 });
  assert.equal(ink.widthAtPressure(0), 0);
  assert.equal(ink.widthAtPressure(1), 20);
  assert.ok(Math.abs(ink.widthAtPressure(0.5) - 10) <= 20 / 65535 + 1e-9);
});

test('custom response curve bends the mapping (ease table reused from the camera system)', () => {
  const curve = new EaseCurve();
  const ink = new Ink({ size: 10, curve });
  const w = ink.widthAtPressure(0.25);
  assert.ok(w >= 0 && w <= 10.0001, 'bounded by 4× tool size');
  const ink2 = new Ink({ size: 10 });
  assert.equal(ink2.widthAtPressure(2), 10); // curve table clamps u to [0,1] → width saturates at size
});

test('strokes: smoothed polyline, segment widths from pressure', () => {
  const ink = new Ink({ size: 8, smoothing: 0 });
  const s = ink.beginStroke(readPoint({ pointerType: 'pen', clientX: 0, clientY: 0, pressure: 0 }));
  ink.extendStroke(s, readPoint({ pointerType: 'pen', clientX: 10, clientY: 0, pressure: 1 }));
  const segs = ink.segments(s);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].x2, 10);
  assert.equal(segs[0].width, 8);
  assert.equal(ink.strokes.length, 1);
});
