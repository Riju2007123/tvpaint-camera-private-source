/* PressureInk — pen-pressure ink for the canvas (SPEC.md §10).
 *
 * TVPaint evidence:
 *   - "pressure" string 0x140a3d1a8; diagnostics "has pressure ? %s" 0x140a70f30 inside
 *     tablet info function FUN_14053f9e0, which prints tablet id / button count / is-eraser /
 *     has-pressure from globals DAT_140ce0d88..DAT_140ce0d94.
 *   - RTTI ".?AUcMyTabletReader@nInk@@" (0x140cdb4e8): an ink/tablet reader COM class.
 * Exact brush-engine internals = KNOWN UNKNOWN. We implement the mapped behavior:
 *   width = size * curve(pressure)   (curve = the same 1001-sample ease table as the camera)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./curve.js')); }
  else { root.TVPPressure = factory(root.TVPCurve); }
})(this, function (C) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /** Extract input point from a browser PointerEvent (or plain object in tests).
   *  Mouse has no pressure in the DOM spec — event.pressure is 0.5 while button held,
   *  matching how OS-derived events without a digitizer report a mid value
   *  (the binary prints has pressure yes/no per device; a mouse "has pressure" = false). */
  function readPoint(evt) {
    const isPen = evt.pointerType === 'pen';
    const hasPressure = isPen && typeof evt.pressure === 'number';
    return {
      x: evt.clientX, y: evt.clientY,
      pressure: hasPressure ? clamp(evt.pressure, 0, 1) : 0.5,
      hasPressure,
      isPen, isEraser: !!(evt.buttons & 0x20),
      tiltX: evt.tiltX || 0, tiltY: evt.tiltY || 0,
    };
  }

  class Ink {
    constructor(opts) {
      this.size = (opts && opts.size) || 24;           // tool size, px
      this.curve = (opts && opts.curve) || new C.EaseCurve();  // pressure response curve
      this.smoothing = (opts && opts.smoothing !== undefined) ? opts.smoothing : 0.4;
      this.strokes = [];
    }

    /** Width at pressure: size * curve(p). Linear curve → proportional. */
    widthAtPressure(p) {
      return clamp(this.size * clamp(this.curve.at(clamp(p, 0, 1)), 0, 4), 0, this.size * 4);
    }

    _smoothed(prev, pt) {
      const s = clamp(this.smoothing, 0, 0.95);
      if (!prev) return { x: pt.x, y: pt.y, pressure: pt.pressure };
      return { x: prev.x * s + pt.x * (1 - s), y: prev.y * s + pt.y * (1 - s), pressure: pt.pressure };
    }

    beginStroke(pt) {
      const stroke = { points: [this._smoothed(null, pt)], width: this.widthAtPressure(pt.pressure) };
      this.strokes.push(stroke);
      return stroke;
    }
    extendStroke(stroke, pt) {
      const last = stroke.points[stroke.points.length - 1];
      stroke.points.push(this._smoothed(last, pt));
      return stroke;
    }
    /** Segment draw hint (for canvas): each segment gets its own width from its pressure. */
    segments(stroke) {
      const out = [];
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i - 1], b = stroke.points[i];
        out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: this.widthAtPressure(b.pressure) });
      }
      return out;
    }
  }

  return { Ink, readPoint, clamp };
});
