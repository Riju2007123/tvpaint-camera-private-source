const test = require('node:test');
const assert = require('node:assert');
const { Timeline, Layer, AudioTrack, BEHAVIORS } = require('../src/timeline.js');

const mk = (runs, extra) => new Layer(Object.assign({ runs }, extra || {}));
const img = (count, tag) => ({ kind: 'image', count, image: { tag: tag || 'img' } });
const empty = (count) => ({ kind: 'empty', count });

test('exposure model: image runs + empty runs, absolute segment layout', () => {
  const l = mk([img(3, 'A'), empty(2), img(4, 'B')], { startFrame: 10 });
  const seg = l.segments();
  assert.deepEqual(seg.map(s => [s.kind, s.start, s.end, s.count]), [
    ['image', 10, 12, 3], ['empty', 13, 14, 2], ['image', 15, 18, 4]]);
  assert.equal(l.endFrame, 18);
  assert.equal(l.exposureAt(11), 3);
  assert.equal(l.exposureAt(13), 0);        // tv_exposureinfo returns "" for empty
  assert.equal(l.imageAt(16).tag, 'B');
  assert.equal(l.isKey(15), true);          // instance start = key
  assert.equal(l.isKey(16), false);         // held exposure frame
});

test('tv_exposureset: sets the run count at the frame (grow / shrink, min 1)', () => {
  const l = mk([img(10)], { startFrame: 1 });
  l.setExposure(3, 4);
  assert.equal(l.exposureAt(1), 4);
  assert.equal(l.endFrame, 4);
  l.setExposure(1, 12);
  assert.equal(l.exposureAt(1), 12);
  assert.equal(l.endFrame, 12);
  l.setExposure(1, 0);                      // traced handler clamps to 1
  assert.equal(l.exposureAt(1), 1);
  assert.equal(l.endFrame, 1);
});

test('tv_exposureadd: extends a hold and shifts later instances', () => {
  const l = mk([img(2, 'A'), img(3, 'B')], { startFrame: 1 });
  l.addExposure(2, 2);                      // frame 2 is inside A's hold
  assert.equal(l.runs[0].count, 4);
  assert.equal(l.segments()[1].start, 5);   // B shifted
  l.addExposure(1, 6);                      // empty? no: extends A again
  assert.equal(l.runs[0].count, 10);
});

test('tv_exposurebreak: splitting a hold creates a new key and clones the image', () => {
  const l = mk([img(10, 'A')], { startFrame: 1 });
  const clone = (i) => ({ tag: i.tag + '!' });
  assert.equal(l.breakInstance(4, clone), true);
  assert.deepEqual(l.runs.map(r => [r.kind, r.count, r.image.tag]), [
    ['image', 3, 'A'], ['image', 7, 'A!']]);
  assert.equal(l.breakInstance(1, clone), false);   // already a key
  assert.equal(l.runs.length, 2);
});

test('auto create instance at an empty frame / auto break on a held frame', () => {
  const l = mk([img(3, 'A'), empty(3)], { startFrame: 1, autoCreate: true, autoBreak: true });
  const made = l.ensureDrawable(5, { makeImage: () => ({ tag: 'new' }) });
  assert.equal(made.created, true);
  assert.equal(made.image.tag, 'new');
  assert.equal(l.exposureAt(5), 1);

  const l2 = mk([img(8, 'A')], { startFrame: 1 });
  const r = l2.ensureDrawable(4, { cloneImage: (i) => ({ tag: i.tag + '2' }) });
  assert.equal(r.broke, true);
  assert.equal(r.image.tag, 'A2');
  assert.deepEqual(l2.runs.map(x => x.count), [3, 5]);
  assert.equal(l2.imageAt(2).tag, 'A');     // earlier hold untouched
  assert.equal(l2.imageAt(6).tag, 'A2');    // new key used for new drawing

  const l3 = mk([empty(4)], { startFrame: 1, autoCreate: false });
  assert.equal(l3.ensureDrawable(2, {}).empty, true);     // autoCreate false -> cannot draw
});

test('Prev/Next Instance vs LayerPrev/Next Key (keymap actions)', () => {
  const l = mk([img(3, 'A'), img(5, 'B'), img(2, 'C')], { startFrame: 1 });
  assert.equal(l.nextInstance(2), 4);
  assert.equal(l.nextInstance(4), 9);
  assert.equal(l.prevInstance(9), 4);
  assert.equal(l.nextKey(3), 4);            // end of A + 1 = start of B
  assert.equal(l.nextKey(4), 9);
  assert.equal(l.prevKey(9), 4);
  assert.equal(l.prevKey(5), 4);
});

test('layer pre/post behaviour: none / hold / repeat / pingpong (traced modes 0..3)', () => {
  assert.deepEqual(BEHAVIORS, ['none', 'repeat', 'pingpong', 'hold']);
  const runs = [img(1, 'A'), img(2, 'B')];  // layer 10..12
  const pre = (mode) => mk(runs.map(r => ({ kind: r.kind, count: r.count, image: r.image })), { startFrame: 10, preBehavior: mode }).imageAt(8);
  assert.equal(pre('none'), null);
  assert.equal(pre('hold').tag, 'A');
  assert.equal(pre('repeat').tag, 'B');     // x=-2 -> local 1
});

test('pingpong post behaviour mirrors the layer', () => {
  const l = mk([img(1, 'A'), img(2, 'B')], { startFrame: 1, postBehavior: 'pingpong' });
  // layer frames 1..3: A B B; period = 4; frame 4 -> p=3 -> 4-3=1 -> B; frame 5 -> p=0 -> A
  assert.equal(l.imageAt(4).tag, 'B');
  assert.equal(l.imageAt(5).tag, 'A');
  assert.equal(l.imageAt(6).tag, 'B');
});

test('timeline layout: layers, audio (master) and notes rows in order (RTTI shape)', () => {
  const tl = new Timeline({ endFrame: 60 });
  tl.addLayer('A', { runs: [img(10), img(12)] });
  tl.addLayer('B', { runs: [img(60)] });
  const lay = tl.layout(4, { x0: 0 });
  assert.equal(lay.rows.length, 2);
  assert.equal(lay.rows[0].kind, 'layer');
  assert.equal(lay.audioRows.length, 1);
  assert.equal(lay.notesRow.kind, 'notes');
  assert.equal(tl.audio.kind, 'master');
  assert.equal(lay.rows[0].segments[0].start, 1);
  assert.equal(lay.rows[0].segments[1].start, 11);
});

test('contentEnd extends ruler; audio track kinds match RTTI names', () => {
  const tl = new Timeline({ endFrame: 10 });
  tl.addLayer('L', { runs: [img(20)] });
  assert.equal(tl.contentEnd, 20);
  assert.equal(new AudioTrack().kind, 'simple');
  assert.equal(new AudioTrack({ kind: 'master' }).kind, 'master');
  assert.equal(new AudioTrack({ kind: 'plane' }).kind, 'plane');
});

test('layer opacity (tv_layerdensity 0..1), blend mode, auto flags and bookmark', () => {
  const l = mk([img(1)]);
  assert.equal(l.opacity, 1);
  l.opacity = 0.42; l.blend = 'multiply';
  l.autoBreak = false; l.autoCreate = false; l.bookmark = true;
  assert.deepEqual([l.opacity, l.blend, l.autoBreak, l.autoCreate, l.bookmark],
    [0.42, 'multiply', false, false, true]);
});
