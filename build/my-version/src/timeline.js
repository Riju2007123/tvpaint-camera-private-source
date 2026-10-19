/* TVPTimeline v2 — instance/exposure model, rebuilt from the REA trace of TVPaint 12.
 *
 * Confirmed in the binary (evidence/features-bundle.json + report addendum):
 *  - A layer owns a sequence of image INSTANCES. Each instance is shown for an
 *    "exposure" count of frames (tv_exposureinfo prints "Exposure <n> <0>"; empty
 *    frames return an empty string). FUN_14078de00 resolves the image shown at a
 *    frame; FUN_14078dfd0 says whether that frame has an image.
 *  - tv_exposureadd / tv_exposureset / tv_exposurebreak / next / prev are commands
 *    (handlers 0x14040dbe0/0x14040df60/0x14040dc50/0x14040dec0/0x14040df10).
 *    The setter (FUN_1407b3100) clamps n to >= 1 and, for image layers,
 *    inserts/removes instances so the run starting at the frame has length n.
 *  - Layer pre/post behaviour at +0x6c/+0x70 with modes 0 none, 1 repeat,
 *    2 pingpong, 3 hold (tv_layerprebehavior/postbehavior handlers).
 *  - Per-layer flags: auto break instance (type2 sub +0x28, type5 sub +0xb0) and
 *    auto create instance (type2 sub +0x29, type5 sub +0xb1); commands
 *    tv_layerautobreakinstance / tv_layerautocreateinstance.
 *  - Layer opacity is stored 0..1 (tv_layerdensity divides the command value by 100);
 *    blend mode setter is thunk_FUN_1400d5450 (tv_layerblendingmode).
 *  - Keymap: Ctrl Left/Right = PrevInstance/NextInstance, Page Up/Down = LayerPrevKey/LayerNextKey.
 *
 * Still INFERRED: the exact image-copy rules of cMUDBreakInstances (vftable body not
 * read) — we clone the image on break, which is what the UI behaviour requires.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TVPTimeline = factory(); }
})(this, function () {
  'use strict';

  const BEHAVIORS = ['none', 'repeat', 'pingpong', 'hold'];   // traced order 0..3

  class Run {
    constructor(kind, count, image) {
      this.kind = kind;                 // 'image' | 'empty'
      this.count = Math.max(0, count | 0);
      this.image = kind === 'image' ? (image || null) : null;
    }
    cloneImage(copyFn) {
      return new Run(this.kind, this.count, this.kind === 'image'
        ? (copyFn ? copyFn(this.image) : this.image) : null);
    }
  }

  class Layer {
    constructor(o) {
      o = o || {};
      this.name = o.name || 'Layer';
      this.visible = o.visible !== false;
      this.locked = !!o.locked;
      this.bookmark = !!o.bookmark;
      this.startFrame = o.startFrame || 1;
      this.runs = o.runs || [new Run('image', o.count || 1, o.image || null)];
      this.opacity = o.opacity == null ? 1 : o.opacity;      // 0..1, tv_layerdensity
      this.blend = o.blend || 'normal';                      // tv_layerblendingmode
      this.preBehavior = o.preBehavior || 'hold';            // +0x6c
      this.postBehavior = o.postBehavior || 'hold';          // +0x70
      this.autoBreak = o.autoBreak !== false;
      this.autoCreate = o.autoCreate !== false;
      this.color = o.color || null;
    }

    get totalFrames() { return this.runs.reduce((n, r) => n + r.count, 0); }
    get endFrame() { return this.startFrame + this.totalFrames - 1; }
    get instanceCount() { return this.runs.filter(r => r.kind === 'image').length; }

    /** Absolute segments for the widget/tests: [{kind,start,end,count,image,index}]. */
    segments() {
      const out = [];
      let f = this.startFrame;
      this.runs.forEach((r, i) => {
        if (r.count > 0) out.push({ kind: r.kind, start: f, end: f + r.count - 1, count: r.count, image: r.image, runIndex: i });
        f += r.count;
      });
      return out;
    }

    _localIndex(frame) {
      if (frame < this.startFrame || frame > this.endFrame) return null;
      let off = frame - this.startFrame;
      for (let i = 0; i < this.runs.length; i++) {
        const r = this.runs[i];
        if (off < r.count) return { runIndex: i, offset: off };
        off -= r.count;
      }
      return null;
    }

    /** Behaviour outside the layer range (traced modes). Returns a local index. */
    _behaviorIndex(frame, which) {
      const mode = which === 'pre' ? this.preBehavior : this.postBehavior;
      const len = this.totalFrames;
      if (len <= 0 || mode === 'none') return null;
      if (mode === 'hold') return which === 'pre' ? 0 : len - 1;
      let x = frame - this.startFrame;
      if (mode === 'repeat') return ((x % len) + len) % len;
      if (mode === 'pingpong') {
        const period = Math.max(1, 2 * len - 2);
        let p = ((x % period) + period) % period;
        return p < len ? p : period - p;
      }
      return null;
    }

    _indexToSample(idx) {
      let off = idx;
      for (let i = 0; i < this.runs.length; i++) {
        const r = this.runs[i];
        if (off < r.count) return { kind: r.kind, runIndex: i, offset: off, run: r };
        off -= r.count;
      }
      return null;
    }

    /** What is shown at an absolute frame (honours pre/post behaviour). */
    sample(frame) {
      const inside = this._localIndex(frame);
      if (inside) return this._indexToSample(frame - this.startFrame);
      const idx = this._behaviorIndex(frame, frame < this.startFrame ? 'pre' : 'post');
      return idx == null ? null : this._indexToSample(idx);
    }

    /** Inside the layer only (used by editing commands). */
    sampleInside(frame) {
      const li = this._localIndex(frame);
      return li ? this._indexToSample(frame - this.startFrame) : null;
    }

    imageAt(frame) { const s = this.sample(frame); return s && s.kind === 'image' ? s.run.image : null; }
    exposureAt(frame) { const s = this.sampleInside(frame); return s && s.kind === 'image' ? s.run.count : 0; }

    /** True when the frame is a key (first frame of an image instance). */
    isKey(frame) {
      const s = this.sample(frame);
      return !!s && s.kind === 'image' && s.offset === 0;
    }

    _nearestImage(frame, dir) {
      const starts = this.segments().filter(s => s.kind === 'image').map(s => s.start);
      if (dir > 0) return starts.find(x => x > frame) || this.endFrame;
      const prev = starts.filter(x => x < frame);
      return prev.length ? prev[prev.length - 1] : this.startFrame;
    }
    nextInstance(frame) { return this._nearestImage(frame, 1); }
    prevInstance(frame) { return this._nearestImage(frame, -1); }

    /** LayerPrevKey / LayerNextKey: exposure boundaries (key starts and holds ends). */
    nextKey(frame) {
      const xs = [];
      for (const s of this.segments()) if (s.kind === 'image') { xs.push(s.start); xs.push(s.end + 1); }
      xs.sort((a, b) => a - b);
      return xs.find(x => x > frame) || this.endFrame;
    }
    prevKey(frame) {
      const xs = [];
      for (const s of this.segments()) if (s.kind === 'image') { xs.push(s.start); xs.push(s.end + 1); }
      xs.sort((a, b) => a - b);
      const p = xs.filter(x => x < frame);
      return p.length ? p[p.length - 1] : this.startFrame;
    }

    _split(i, offset) {
      const r = this.runs[i];
      if (r.kind !== 'image' || offset <= 0 || offset >= r.count) return;
      const a = new Run('image', offset, r.image);
      const b = new Run('image', r.count - offset, r.image);
      this.runs.splice(i, 1, a, b);
      return { first: a, second: b };
    }

    /** tv_exposureset: set the exposure count of the image run at `frame` to n (>=1). */
    setExposure(frame, n) {
      n = Math.max(1, n | 0);
      const s = this.sampleInside(frame);
      if (!s) return false;
      if (s.kind === 'image') {
        const delta = n - s.run.count;
        if (delta > 0) s.run.count += delta;
        else if (delta < 0) s.run.count = Math.max(1, n);
        return true;
      }
      // empty frame: turn n frames of the empty run into an image instance
      const prevImg = (this.runs[s.runIndex - 1] && this.runs[s.runIndex - 1].image) || null;
      this._insertImageAt(s.runIndex, s.offset, n, prevImg, false);
      return true;
    }

    /** tv_exposureadd: add exposure frames at `frame` (extends the image / starts one). */
    addExposure(frame, n) {
      n = Math.max(1, n == null ? 1 : n | 0);
      const s = this.sampleInside(frame);
      if (!s) {
        if (frame > this.endFrame) { this.runs.push(new Run('empty', frame - this.endFrame)); }
        else return false;
      }
      const ss = this.sampleInside(frame);
      if (!ss) return false;
      if (ss.kind === 'image') { ss.run.count += n; return true; }
      const prevImg = (this.runs[ss.runIndex - 1] && this.runs[ss.runIndex - 1].image) || null;
      this._insertImageAt(ss.runIndex, ss.offset, n, prevImg, false);
      return true;
    }

    /** Insert an image run of `count` frames into an empty run at runIndex/offset. */
    _insertImageAt(runIndex, offset, count, image, cloneForRest) {
      const r = this.runs[runIndex];
      const before = offset, after = r.count - offset;
      const parts = [];
      if (before > 0) parts.push(new Run('empty', before));
      parts.push(new Run('image', count, image));
      if (after > 0) parts.push(new Run('empty', after));
      this.runs.splice(runIndex, 1, ...parts);
      if (cloneForRest && after > 0) { /* nothing extra: image only for the inserted run */ }
      return parts.find(p => p.kind === 'image');
    }

    /** LayerExposureBreak / cMUDBreakInstances: split the hold at `frame`, new image copy. */
    breakInstance(frame, cloneImage) {
      const s = this.sampleInside(frame);
      if (!s) return false;
      if (s.kind === 'empty') {
        const img = (this.runs[s.runIndex - 1] && this.runs[s.runIndex - 1].image) || null;
        this._insertImageAt(s.runIndex, s.offset, 1, cloneImage ? cloneImage(img) : img, false);
        return true;
      }
      if (s.offset === 0) return false;
      const split = this._split(s.runIndex, s.offset);
      if (split) {
        split.second.image = cloneImage ? cloneImage(split.first.image) : split.first.image;
        return true;
      }
      return false;
    }

    /** New key image at `frame` (LayerAddKey / drawing with auto-create). */
    newInstance(frame, blankImage, cloneImage) {
      const s = this.sampleInside(frame);
      if (!s) {
        if (frame > this.endFrame) this.runs.push(new Run('empty', frame - this.endFrame));
        const ss = this.sampleInside(frame);
        if (!ss) return null;
        const img = blankImage || null;
        this._insertImageAt(ss.runIndex, ss.offset, 1, img, false);
        return img;
      }
      if (s.kind === 'empty') {
        const prev = (this.runs[s.runIndex - 1] && this.runs[s.runIndex - 1].image) || null;
        const img = cloneImage ? cloneImage(prev) : (blankImage || prev);
        this._insertImageAt(s.runIndex, s.offset, 1, img, false);
        return img;
      }
      if (s.offset === 0) {
        // insert a fresh key before the existing one, keeping the existing image
        const img = cloneImage ? cloneImage(s.run.image) : (blankImage || s.run.image);
        this.runs.splice(s.runIndex, 0, new Run('image', 1, img));
        return img;
      }
      const split = this._split(s.runIndex, s.offset);
      if (!split) return null;
      split.second.image = cloneImage ? cloneImage(split.first.image) : split.first.image;
      return split.second.image;
    }

    /** Remove the image at `frame` but keep the same number of frames (empty exposure). */
    clearImage(frame) {
      const s = this.sampleInside(frame);
      if (!s || s.kind !== 'image') return false;
      const r = s.run;
      r.kind = 'empty'; r.image = null;
      return true;
    }

    /** Drawing entry point: returns the image that must be painted at `frame`. */
    ensureDrawable(frame, opts) {
      opts = opts || {};
      const autoCreate = opts.autoCreate == null ? this.autoCreate : opts.autoCreate;
      const autoBreak = opts.autoBreak == null ? this.autoBreak : opts.autoBreak;
      const make = opts.makeImage || (() => null);
      const clone = opts.cloneImage || ((img) => img);
      if (frame > this.endFrame) this.runs.push(new Run('empty', frame - this.endFrame));
      if (frame < this.startFrame) {
        const shift = this.startFrame - frame;
        this.runs.unshift(new Run('empty', shift));
        this.startFrame = frame;
      }
      const s = this.sampleInside(frame);
      if (!s) return { image: null, created: false, broke: false };
      if (s.kind === 'empty') {
        if (!autoCreate) return { image: null, created: false, broke: false, empty: true };
        const img = make(frame);
        this._insertImageAt(s.runIndex, s.offset, 1, img, false);
        return { image: img, created: true, broke: false };
      }
      if (s.offset > 0) {
        if (!autoBreak) return { image: s.run.image, created: false, broke: false };
        const split = this._split(s.runIndex, s.offset);
        if (!split) return { image: s.run.image, created: false, broke: false };
        split.second.image = clone(split.first.image);
        return { image: split.second.image, created: false, broke: true };
      }
      return { image: s.run.image, created: false, broke: false };
    }
  }

  class AudioTrack {
    constructor(o) {
      o = o || {};
      this.name = o.name || 'Audio';
      this.kind = o.kind || 'simple';       // master | simple | plane (RTTI names)
      this.visible = o.visible !== false;
      this.mute = !!o.mute;
    }
  }

  class Timeline {
    constructor(opts) {
      opts = opts || {};
      this.layers = [];
      this.audio = new AudioTrack({ name: 'Master', kind: 'master' });
      this.notes = { text: opts.notes || '' };
      this.currentFrame = opts.currentFrame || 1;
      this.fps = opts.fps || 24;
      this.endFrame = opts.endFrame || 60;
    }
    addLayer(name, opts) {
      const l = new Layer(Object.assign({ name }, opts || {}));
      this.layers.push(l);
      return l;
    }
    get layerCount() { return this.layers.length; }
    get contentEnd() {
      let last = this.endFrame;
      for (const l of this.layers) last = Math.max(last, l.endFrame);
      return last;
    }
    get currentLayer() { return this.layers[this.activeLayer || 0]; }

    nearestInstance(frame, li) {
      const l = this.layers[li == null ? (this.activeLayer || 0) : li];
      return l ? { prev: l.prevInstance(frame), next: l.nextInstance(frame) } : { prev: frame, next: frame };
    }
    nearestKey(frame, li) {
      const l = this.layers[li == null ? (this.activeLayer || 0) : li];
      return l ? { prev: l.prevKey(frame), next: l.nextKey(frame) } : { prev: frame, next: frame };
    }

    /** Scene-wide key boundaries (used by the camera row / scene nav). */
    allKeyFrames() {
      const xs = new Set();
      for (const l of this.layers) for (const s of l.segments()) if (s.kind === 'image') { xs.add(s.start); xs.add(s.end + 1); }
      return [...xs].sort((a, b) => a - b);
    }

    layout(pxPerFrame, opts) {
      opts = opts || {};
      const rowH = opts.rowH || 22;
      const end = this.contentEnd + 1;
      return {
        rowH,
        width: end * pxPerFrame,
        rows: this.layers.map(l => ({ kind: 'layer', name: l.name, rowH, segments: l.segments(), layer: l })),
        audioRows: [{ kind: 'audio', name: this.audio.name, rowH }],
        notesRow: { kind: 'notes', rowH },
        rulerEnd: end,
        originX: opts.x0 || 0,
      };
    }
  }

  return { Timeline, Layer, Run, AudioTrack, BEHAVIORS };
});
