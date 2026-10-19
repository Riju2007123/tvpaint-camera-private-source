/* TVPCurve — per-key ease curve, per REA trace (FUN_14081fd40):
 * 1001 uint16 samples, value = sample/65535, linear blend at round(t*1000), clamped t, clamped output.
 * Default: built-in linear ramp (observed regeneration via FUN_14081ec20 with 1000.0/0xFFFF). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TVPCurve = factory(); }
})(this, function () {
  const SAMPLES = 1001;
  const SCALE = 1 / 65535;

  function linearTable() {
    const t = new Uint16Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) t[i] = Math.round(65535 * (i / (SAMPLES - 1)));
    return t;
  }

  class EaseCurve {
    constructor(table) {
      this._table = table instanceof Uint16Array && table.length === SAMPLES
        ? table.slice() : linearTable();
    }
    /** index = round(t*1000); blend samples[i], samples[i+1]; scale 1/65535 */
    at(t) {
      let x = Math.min(1, Math.max(0, t));
      const i = Math.round(x * (SAMPLES - 1));
      const frac = x * (SAMPLES - 1) - i;
      const a = this._table[i];
      const b = this._table[Math.min(SAMPLES - 1, i + 1)];
      return Math.min(1, Math.max(0, (a * (1 - frac) + b * frac) * SCALE));
    }
    addCurvePoint(pos, value) {
      // tv_cameraaddcurvepoint parity: writes an eased value sample into the table
      const p = Math.round(Math.min(1, Math.max(0, pos)) * (SAMPLES - 1));
      const v = Math.round(Math.min(1, Math.max(0, value)) * 65535);
      this._table[p] = v;
    }
    setCurvePoint(index) { if (index >= 0 && index < SAMPLES) this._table[index] = Math.min(65535, Math.max(0, Math.round(index * 65535 / (SAMPLES - 1)))); }
    removeCurvePoint(index) { if (index >= 0 && index < SAMPLES) this.setCurvePoint(index); }
  }

  return { EaseCurve, SAMPLES, SCALE, linearTable };
});
