/* TVPTimeline — timeline model in the shape of the traced TVPaint 12 timeline (SPEC.md §9).
 *
 * Evidence (RTTI class strings in the target EXE):
 *   cTimelineLayer / cTimelineLayers / cTimelineLayerTimeline / cTimelineLayerOptions
 *   cTimelineStrip, cTimelineAudio, cTimelineAudioMultiTrack,
 *   cTimelineAudioTrack / cTimelineAudioTrackMaster / cTimelineAudioTrackSimple /
 *   cTimelineAudioTrackPlane, cTimelineNotes
 * Settings strings: TimelineUncompactedAtOpen, CenterTimeline,
 *   LayerPanel-TimelineNotesHeight, LayerPanel-TimelineAudioHeight.
 * => the panel is per-LAYER rows with a notes row and audio tracks (master + simple).
 * Exact widget behavior = KNOWN UNKNOWN (non-goal); we model the data structure + layout.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TVPTimeline = factory(); }
})(this, function () {
  class Layer {
    constructor(o) {
      this.name = (o && o.name) || 'Layer'
      this.exposures = (o && o.exposures) || [];   // image segments: [{startFrame, endFrame}]
      this.visible = !o || o.visible !== false;
      this.locked = !!(o && o.locked);
      this.bookmark = !!(o && o.bookmark);        // BookmarkToggle exists in the keymap
    }
    addExposure(startFrame, endFrame) { this.exposures.push({ startFrame, endFrame }); return this; }
  }

  class AudioTrack {
    constructor(o) {
      this.name = (o && o.name) || 'Audio';
      this.kind = (o && o.kind) || 'simple';      // master | simple | plane (RTTI names)
      this.visible = !o || o.visible !== false;
      this.mute = !!(o && o.mute);
    }
  }

  class Timeline {
    constructor(opts) {
      this.layers = [];                           // image layers (cTimelineLayers)
      this.audio = new AudioTrack({ name: 'Master', kind: 'master' });
      this.notes = { text: (opts && opts.notes) || '' };   // cTimelineNotes
      this.currentFrame = 1;
      this.fps = 24;
      this.endFrame = (opts && opts.endFrame) || 60;
    }
    addLayer(name) { const l = new Layer({ name }); this.layers.push(l); return l; }
    get layerCount() { return this.layers.length; }

    static _spanOver(layers, end) {
      let last = 1;
      for (const l of layers) for (const e of l.exposures) last = Math.max(last, e.endFrame);
      return last;
    }
    /** Content end = last exposed frame (drives ruler length; UNCOMPACTED display). */
    get contentEnd() { return Math.max(this.endFrame, Timeline._spanOver(this.layers, this.endFrame)); }

    nearestExposureChange(frame) {                 // LayerPrevKey / LayerNextKey behavior
      const s = new Set();
      for (const l of this.layers) for (const e of l.exposures) { s.add(e.startFrame); s.add(e.endFrame + 1); }
      const xs = [...s].sort((a, b) => a - b);
      let prev = null, next = null;
      for (const x of xs) { if (x <= frame) prev = x; if (x > frame && next === null) next = x; }
      return { prev, next };
    }

    /** Layout for a timeline view (non-exact widget): pxPerFrame, row order = layers, audio, notes. */
    layout(pxPerFrame, opts) {
      const rowH = (opts && opts.rowH) || 22;      // LayerPanel-TimelineAudioHeight analog
      const end = this.contentEnd + 1;
      return {
        rowH,
        width: end * pxPerFrame,
        rows: this.layers.map(l => ({ kind: 'layer', name: l.name, rowH, exposures: l.exposures })),
        audioRows: [{ kind: 'audio', name: this.audio.name, rowH }],
        notesRow: { kind: 'notes', rowH },
        rulerEnd: end,
        originX: (opts && opts.x0) || 0,
      };
    }
  }

  return { Timeline, Layer, AudioTrack };
});
