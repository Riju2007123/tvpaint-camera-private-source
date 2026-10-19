/* TVPCameraTrack — keyframed camera track, per SPEC.md §1–§4 (REA evidence: FUN_1401e33c0/e5020/e4a80/e4240).
 * Keys are sparse per property: each key sets which properties it captures
 * (rotation/zoom/position flags observed at key+0x48; demo exposes addPositionKey/addRotationKey/addZoomKey). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./curve.js')); }
  else { root.TVPCameraTrack = factory(root.TVPCurve); }
})(this, function (C) {
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const span = (a, b) => (b - a <= 1 ? 1 : b - a);

  class CameraTrack {
    constructor(opts) {
      this.keys = [];                      // sorted; each: {frame, x, y, rotation, zoom, has}
      this.cameraWidth = 1920;             // scene camera width (scene+0x168 default value here)
      this.cameraHeight = 1080;
      this.startFrame = 1;                 // camera layer range [start, end]
      this.endFrame = 60;
      this.lockall = false; this.lockx = false; this.locky = false; this.lockangle = false;
      this.mode = 0; this.motionblur = 0;
      if (opts) Object.assign(this, opts);
    }

    _newKey(frame) {
      return { frame: frame | 0, x: this.cameraWidth, y: this.cameraHeight,
        rotation: 0, zoom: 1, has: { position: false, rotation: false, zoom: false },
        curves: { position: new C.EaseCurve(), rotation: new C.EaseCurve(), zoom: new C.EaseCurve() } };
    }

    /** First key exactly at frame wins (observed loop breaks at first equality). */
    _keyAt(frame) { for (const k of this.keys) if (k.frame === frame) return k; return null; }
    _prevKey(frame, prop) { let r = null; for (const k of this.keys) if (k.frame <= frame && k.has[prop]) r = k; return r; }
    _nextKey(frame, prop) { for (const k of this.keys) if (k.frame >= frame && k.has[prop]) return k; return null; }

    setKey(frame, prop, values) { // ui parity: CameraAdd{Position,Rotation,Zoom}Key
      frame = Math.round(frame);
      let k = this._keyAt(frame);
      if (!k) { k = this._newKey(frame); this.keys.push(k); this.keys.sort((a, b) => a.frame - b.frame); }
      k.has[prop] = true;
      if (values) {
        if (values.x !== undefined) k.x = values.x;
        if (values.y !== undefined) k.y = values.y;
        if (values.rotation !== undefined) k.rotation = values.rotation;
        if (values.zoom !== undefined) k.zoom = values.zoom;
      }
      return k;
    }
    removeKey(frame) { // `tv_cameraremovepoint` behavior for the demo
      this.keys = this.keys.filter(k => k.frame !== frame);
    }

    /** Scene→layer progress (§4). t ∈ [0,1] across the camera layer. */
    progressAtSceneTime(t) {
      const s = this._sceneStart ?? 1, e = this._sceneEnd ?? this.endFrame;
      if (e - s <= 0) return 0;
      const sceneF = s + clamp01(t) * (e - s);
      const base = Math.floor(sceneF);            // observed floor / interlace step
      const frac = sceneF - base;
      return clamp01((base + frac - this.startFrame) / span(this.startFrame, this.endFrame));
    }
    setSceneRange(s, e) { this._sceneStart = s; this._sceneEnd = e; }

    _evalProp(frame, prop, pick) {
      // A = exact-frame key with prop, else previous; B = next key with prop (observed pairs)
      let exact = this._keyAt(frame);
      const A = exact && exact.has[prop] ? exact : this._prevKey(frame, prop);
      const B = this._nextKey(frame, prop);
      if (A && B && A.frame !== B.frame) {
        const t = (frame - A.frame) / (B.frame - A.frame);       // span guarded (≤1 span → guarded in caller's curve)
        if (t === 0) return pick(A);
        if (t === 1) return pick(B);
        const c = clamp01(B.curves[prop].at(t));                 // per-key ease (curve of the later key)
        const a = pick(A), b = pick(B);
        return a + (b - a) * c;
      }
      if (A) return pick(A);
      if (B) return pick(B);
      return null; // caller applies defaults
    }

    /** Camera state at frame F (§3). */
    evaluate(frame) {
      let pos = this._evalProp(frame, 'position', k => [k.x, k.y]);
      if (!pos) pos = [this.cameraWidth, this.cameraHeight];       // observed default: camera size
      const rot = this._evalProp(frame, 'rotation', k => k.rotation);
      const rotation = rot === null ? 0.0 : rot;                   // observed default: 0°
      const z = this._evalProp(frame, 'zoom', k => k.zoom);
      const zoom = z === null ? 1.0 : z;                           // observed default: 1.0
      return { x: pos[0], y: pos[1], rotation, zoom };
    }

    /** Debug parity string: 6-float style as in tv_camerainfoframe (zoom reported ×100). */
    infoFrame(frame) {
      if (frame < this.startFrame || frame > this.endFrame) {
        return "Given frame out of camera layer's range";
      }
      const st = this.evaluate(frame);
      return (st.x).toFixed(6) + ' ' + (st.y).toFixed(6) + ' ' + st.rotation.toFixed(6)
           + ' ' + (st.zoom * 100).toFixed(6) + ' ' + 1 + ' ' + 0; // last two: undefined in binary (KNOWN UNKNOWN)
    }
  }

  return { CameraTrack, clamp01, span };
});
