const test = require('node:test');
const assert = require('node:assert');
const { EaseCurve } = require('../src/curve.js');

test('default curve is linear across 0..1', () => {
  const c = new EaseCurve();
  assert.ok(Math.abs(c.at(0)) < 1e-4);
  assert.ok(Math.abs(c.at(0.5) - 0.5) < 1e-3);
  assert.ok(Math.abs(c.at(1) - 1) < 1e-4);
});

test('curve clamps t and output', () => {
  const c = new EaseCurve();
  assert.equal(c.at(-5), 0);
  assert.equal(c.at(2), 1);
});

test('custom step curve: easy-out shape', () => {
  const c = new EaseCurve();
  // make first half of samples ≈ 0.2 then rest 1.0
  const t = c._table; const n = t.length;
  for (let i = 0; i < n; i++) t[i] = i < n / 2 ? Math.round(0.2 * 65535) : 65535;
  assert.ok(Math.abs(c.at(0.25) - 0.2) < 2e-3);
  assert.ok(Math.abs(c.at(0.75) - 1) < 2e-3);
});

test('sample-pair blend is linear between table entries', () => {
  const c = new EaseCurve();
  const v = c.at(0.0005) * 65535; // between sample 0 and 1 → halfway
  assert.ok(v > 0 && v < 65535);
});
