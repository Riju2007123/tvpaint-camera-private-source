/* TVPCameraTrack v2 — EXACT semantics from REA re-trace (SPEC.md v2 §1–§5).
 *
 * What changed vs v1 (both from REA evidence, see reports/camera-feature-trace.md):
 *  - Key x/y are the camera frame SIZE (fun_1401da730 builds corners as center ± (size/2);
 *    default = camera W/H). v1 wrongly treated them as a pan position.
 *  - The pan/translation is the camera PATH (FUN_1401e2690). No path point → the binary
 *    falls back to centering (FUN_1401da730 fallback: (viewW/2, viewH/2)).
 *  - Literal blend from FUN_1401e33c0: c = clamp01(curve(nextKey).at(1-t));
 *    value = prev*(1-c) + next*c. Curve tables are stored x-mirrored at build time
 *    (FUN_14081ec20: x_ui = (1-sx)*1000), which makes this behave as a standard ease(t);
 *    TVPCurve already reflects that, so at() is the standard-eased value.
 *  - Key record fields (stride 0x380 bytes / 0xE0 ints): frame@+0x00, flags@+0x48
 *    (bit1=rotation, bit2=zoom, bit3=size), rotation@+0x18, zoom@+0x20, sizeX@+0x28,
 *    sizeY@+0x30, zoomCurve@+0x178, rotCurve@+0x238, sizeCurve@+0x2F8.
 *  - tv_camerainfoframe 6-float output order (from assembly 0x1403f143f..0x1403f1500):
 *    pathX, pathY, rotation, zoom*100, sizeX, sizeY.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./curve.js')); }
  else { root.TVPCameraTrack = factory(root.TVPCurve); }
})(this, function (C) {
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const span = (a, b) => (b - a <= 1 ? 1 : b - a);

  class CameraTrack {
    constructor(opts) {
      this.keys = [];                     // sorted; each key captures size / rotation / zoom
      this.path = [];                     // camera path points: {frame, x, y} (pan), sorted
      this.cameraWidth = 1920;            // camera rect (scene+0x168)
      this.cameraHeight = 1080;           // scene+0x16C/0x170
      this.startFrame = 1;                // camera layer range [start,end]
      this.endFrame = 60;
      this.viewWidth = 1920;              // fallback path center = view/2 (FUN_1401da730 fallback)
      this.viewHeight = 1080;
      if (opts) Object.assign(this, opts);
    }

    _newKey(frame) {
      return { frame: frame | 0,
        width: this.cameraWidth, height: this.cameraHeight,   // observed defaults: camera rect
        rotation: 0, zoom: 1,
        has: { size: false, rotation: false, zoom: false },
        curves: { size: new C.EaseCurve(), rotation: new C.EaseCurve(), zoom: new C.EaseCurve() } };
    }

    _keyAt(frame) { for (const k of this.keys) if (k.frame === frame) return k; return null; }
    _prevKey(frame, prop) { let r = null; for (const k of this.keys) if (k.frame <= frame && k.has[prop]) r = k; return r; }
    _nextKey(frame, prop) { for (const k of this.keys) if (k.frame >= frame && k.has[prop]) return k; return null; }

    /** UI parity: camera "Add Size Key" / "Add Rotation Key" / "Add Zoom Key" (flags at key+0x48). */
    setKey(frame, prop, values) {
      frame = Math.round(frame);
      let k = this._keyAt(frame);
      if (!k) { k = this._newKey(frame); this.keys.push(k); this.keys.sort((a, b) => a.frame - b.frame); }
      k.has[prop] = true;
      if (values) {
        if (values.width !== undefined) k.width = values.width;
        if (values.height !== undefined) k.height = values.height;
        if (values.rotation !== undefined) k.rotation = values.rotation;
        if (values.zoom !== undefined) k.zoom = values.zoom;
      }
      return k;
    }

    /** Camera path points (tv_camerapath / tv_camerasetpoint domain). */
    setPathPoint(frame, x, y) {
      frame = Math.round(frame);
      let p = this.path.find(p => p.frame === frame);
      if (!p) { p = { frame, x, y }; this.path.push(p); this.path.sort((a, b) => a.frame - b.frame); }
      p.x = x; p.y = y;
      return p;
    }
    removePathPoint(frame) { this.path = this.path.filter(p => p.frame !== frame); }
    removeKey(frame) { this.keys = this.keys.filter(k => k.frame !== frame); }

    /** Scene→layer progress (§4, FUN_1401e4240): t∈[0,1] over the camera layer. */
    progressAtSceneTime(t) {
      const s = this._sceneStart ?? 1, e = this._sceneEnd ?? this.endFrame;
      if (e - s <= 0) return 0;
      const sceneF = s + clamp01(t) * (e - s);
      const base = Math.floor(sceneF);            // observed floor / interlace step
      const frac = sceneF - base;
      return clamp01((base + frac - this.startFrame) / span(this.startFrame, this.endFrame));
    }
    setSceneRange(s, e) { this._sceneStart = s; this._sceneEnd = e; }
    frameAtProgress(p) { return Math.round(this.startFrame + clamp01(p) * (this.endFrame - this.startFrame)); }

    /** Literal-parity blend (FUN_1401e33c0). */
    _evalProp(frame, prop, pick) {
      let exact = this._keyAt(frame);
      const A = (exact && exact.has[prop]) ? exact : this._prevKey(frame, prop);
      const B = this._nextKey(frame, prop);
      if (A && B && A.frame !== B.frame) {
        const t = (frame - A.frame) / (B.frame - A.frame);
        if (t === 0) return pick(A);
        if (t === 1) return pick(B);
        const c = clamp01(B.curves[prop].at(t));    // curve of the LATER key, stored x-mirrored
        const a = pick(A), b = pick(B);
        return a * (1 - c) + b * c;                 // literal observed formula
      }
      if (A) return pick(A);
      if (B) return pick(B);
      return null;                                  // caller applies defaults
    }

    /** Camera path interpolation (FUN_1401e2690 complex; linear blend = INFERRED device). */
    pathAt(frame) {
      if (!this.path.length) return null;
      let A = null, B = null;
      for (const p of this.path) {
        if (p.frame <= frame) A = p;
        if (p.frame >= frame) { B = p; break; }
      }
      if (this.path[0] && frame < this.path[0].frame) return { x: this.path[0].x, y: this.path[0].y };
      if (A && B && A.frame !== B.frame) {
        const t = (frame - A.frame) / (B.frame - A.frame);
        return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
      }
      return { x: (A || B).x, y: (A || B).y };
    }

    /** Camera state at frame F (§3). Note defaults: size=camera rect, rot=0°, zoom=1. */
    evaluate(frame) {
      let size = this._evalProp(frame, 'size', k => [k.width, k.height]);
      if (!size) size = [this.cameraWidth, this.cameraHeight];
      const rot = this._evalProp(frame, 'rotation', k => k.rotation);
      const rotation = rot === null ? 0.0 : rot;
      const z = this._evalProp(frame, 'zoom', k => k.zoom);
      const zoom = z === null ? 1.0 : z;
      const center = this.pathAt(frame) || { x: this.viewWidth / 2, y: this.viewHeight / 2 };
      return { width: size[0], height: size[1], rotation, zoom, cx: center.x, cy: center.y };
    }

    /** Corner rectangle (FUN_1401da730): full rect = center + R(rot)·(±w/2, ±h/2); zoom scales the rect.
     *  Order of outputs observed: TL, TR, BR, BL (params 3..6). Zoom application point in the binary's
     *  matrix compose is a KNOWN UNKNOWN; we scale the frame extents (documented deviation). */
    corners(frame) {
      const s = this.evaluate(frame);
      const hw = s.width * s.zoom / 2, hh = s.height * s.zoom / 2;
      const r = s.rotation * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
      const rot = (dx, dy) => ({ x: s.cx + dx * cos - dy * sin, y: s.cy + dx * sin + dy * cos });
      return { tl: rot(-hw, -hh), tr: rot(hw, -hh), br: rot(hw, hh), bl: rot(-hw, hh) };
    }

    /** Debug parity: tv_camerainfoframe 6-float line (order from assembly; zoom reported ×100). */
    infoFrame(frame) {
      if (frame < this.startFrame || frame > this.endFrame) {
        return "Given frame out of camera layer's range";
      }
      const s = this.evaluate(frame);
      return [s.cx, s.cy, s.rotation, s.zoom * 100, s.width, s.height].map(v => +v.toFixed(6)).join(' ');
    }
  }

  return { CameraTrack, clamp01, span };
});
