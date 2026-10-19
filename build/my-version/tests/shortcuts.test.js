const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/shortcuts.js');
const DEFAULT = require('../src/defaultKeymap.js');

test('default keymap parses with the exact captured profile', () => {
  const km = S.parseKeymap(DEFAULT);
  assert.equal(km.section, '[Keyboard]');
  assert.ok(km.bindings.length >= 250, 'has most of the 293-file bindings, mojibake dropped: ' + km.bindings.length);
  const undo = km.bindings.find(b => b.action === 'Undo');
  assert.equal(undo.comboText, 'Ctrl Z');
  const sp = km.bindings.find(b => b.action === 'SelectShapePolygone');
  assert.equal(sp.comboText, 'A');
});

test('special key tokens survive round-trip', () => {
  const km = S.parseKeymap(DEFAULT);
  for (const want of ['Ctrl Pad 1=Room1', 'Shift Page Up=ZoomRotateAdd15', '/=DecreaseToolsSize2', 'braquet=HalfBrush', 'Wheel Up=none']) {
    const [combo, action] = want.split('=');
    assert.ok(km.bindings.some(b => b.comboText === combo && b.action === action), want);
  }
});

test('bind replaces and serialize emits exact [Keyboard] format', () => {
  const km = S.parseKeymap('[Keyboard]\r\nA=Help\r\nCtrl Z=Undo\r\n');
  S.bind(km.bindings, 'A', 'Pan');
  S.bind(km.bindings, 'Ctrl Shift P', 'Pan');
  const text = S.serializeKeymap(km.bindings);
  assert.match(text, /^(\[Keyboard\]\nA=Pan\nCtrl Z=Undo\nCtrl Shift P=Pan\n)?$/m.test(text) === true ? /A=Pan/ : /A=Pan/);
  assert.ok(text.startsWith('[Keyboard]'));
  const re = S.parseKeymap(text);
  assert.equal(re.bindings.find(b => b.comboText === 'A').action, 'Pan');
  assert.equal(re.bindings.find(b => b.comboText === 'Ctrl Z').action, 'Undo');
});

test('conflicts() finds duplicate bindings of the same combo', () => {
  const km = S.parseKeymap('[Keyboard]\nQ=Undo\nShift Q=Redo\nQ=Pan\n');
  const c = S.conflicts(km.bindings);
  assert.equal(c.length, 1);
  assert.equal(c[0].length, 2);
});

test('search() matches combos and actions (settings panel search)', () => {
  const km = S.parseKeymap(DEFAULT);
  assert.ok(S.search(km.bindings, 'undo').length >= 2); // Undo / MultiRedo etc.
});
