const test = require('node:test');
const assert = require('node:assert');
const { Timeline, Layer, AudioTrack } = require('../src/timeline.js');

test('layers, audio (master) and notes rows in timeline order (RTTI shape)', () => {
  const tl = new Timeline({ endFrame: 60 });
  const a = tl.addLayer('A'); a.addExposure(1, 10); a.addExposure(12, 24);
  tl.addLayer('B').addExposure(1, 60);
  const lay = tl.layout(4, { x0: 0 });
  assert.equal(lay.rows.length, 2);
  assert.equal(lay.rows[0].kind, 'layer');            // cTimelineLayer rows
  assert.equal(lay.audioRows.length, 1);              // cTimelineAudioTrackMaster
  assert.equal(lay.audioRows[0].kind, 'master'.length === 6 ? 'audio' : 'audio');
  assert.equal(lay.notesRow.kind, 'notes');           // cTimelineNotes
  assert.equal(tl.audio.kind === 'master', true);
});

test('content end extends ruler beyond base end; exposure gaps visible', () => {
  const tl = new Timeline({ endFrame: 10 });
  tl.addLayer('L').addExposure(5, 20);
  assert.equal(tl.contentEnd, 20);
  const row = tl.layout(1).rows[0];
  assert.equal(row.exposures[0].startFrame, 5);
  assert.equal(row.exposures[0].endFrame, 20);
});

test('nearestExposureChange: LayerPrevKey/LayerNextKey parity', () => {
  const tl = new Timeline({});
  tl.addLayer('L').addExposure(10, 20).addExposure(30, 40);
  const n = tl.nearestExposureChange(25);
  assert.equal(n.prev, 21);   // = 20 + 1 (exposure end +1)
  assert.equal(n.next, 30);
});

test('AudioTrack kinds match RTTI names ', () => {
  assert.equal(new AudioTrack().kind, 'simple');
  assert.equal(new AudioTrack({ kind: 'master' }).kind, 'master');
  assert.equal(new AudioTrack({ kind: 'plane' }).kind, 'plane');
});

test('layer visibility and bookmark flags', () => {
  const tl = new Timeline({});
  const l = tl.addLayer('X');
  assert.equal(l.visible, true);
  assert.equal(l.bookmark, false);
  l.bookmark = true; l.visible = false;
  assert.deepEqual({ v: l.visible, b: l.bookmark }, { v: false, b: true });
  assert.ok(tl.layerCount === 1);
});
