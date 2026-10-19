# SPEC — "Camera" keyframed feature (re-implementation specification)

Target observed: TVPaint Animation 12 Pro Demo.exe (SHA-256 c998c6fe…74c2a), traced with REA+Ghidra;
evidence bundle: `evidence/tvpaint-camera-bundle.json` (35 records). Full trace: `reports/camera-feature-trace.md`.
This SPEC contains **no copied code** — it describes observable behavior and the structural facts REA observed
(function names/addresses are cited as evidence anchors only).

## 1. Data model
- A scene contains one optional **camera track** (observed at `scene+0x2F0`).
- Track holds an ordered list of **camera keys**. Each key:
  - `frame: int`
  - optional `x`, `y` (position), `rotation: double degrees`, `zoom: double`, plus a `size` property slot
    (the UI exposes separate "Add Position/Rotation/Zoom/Size Key" actions; per-key capability flag bits map
    to properties — flags at key offset +0x48: bit1 rotation, bit2 zoom, bit3 position observed; bit0 = size INFERRED).
  - Per-property **ease curve** for the property this key enables (observed curve slots at +0x178 zoom,
    +0x238 rotation, +0x2F8 position).
- Track properties (locked flags): `lockall, lockx, locky, lockangle`, a `mode`, `motionblur` (observed in
  `tv_camerapath` handler; demo stores them, semantics beyond lock flags = UNKNOWN).
- Camera layer (a normal layer chosen as the camera) has `startFrame`, `endFrame`.

## 2. Ease curve (per key, per property)
- Table of **1001 uint16 samples**; value ∈ [0,1] = `sample / 65535`.
- Evaluate `curve(t)`: clamp t∈[0,1]; `i = round(t*1000)`; result = linear blend of samples `i`, `i+1` by fractional part.
- Default curve (key creation): **linear ramp** across the 1001 samples (observed rebuild with `1000.0` and `0xFFFF`).
- Curve editor operations: `addCurvePoint`, `setCurvePoint`, `setCurveType`, `removeCurvePoint`
  (observed script commands; demo implements point add/set/remove as adjusters of the table).

## 3. Evaluation (`camera at frame F`, observed in `tv_camerainfoframe` handler)
1. Resolve camera layer; error `"No camera Layer"` if absent.
2. If `F` outside `[startFrame, endFrame]` → error `"Given frame out of camera layer's range"` (exact observed strings).
3. For each property p ∈ {position(x,y), rotation, zoom}:
   - `A` = key exactly at `F` **with p's flag set**; else `A` = previous key with p's flag set.
   - `B` = next key with p's flag set (observed lookup pairs, e.g. `FUN_1401e3690`/`FUN_1401e3870` for position).
   - Only `A` → value = A.p. Only `B` → value = B.p. Neither → default:
     position = camera (width, height) (observed defaults read from scene +0x168/0x16C),
     zoom = 1.0, rotation = 0.0.
   - Both → `t = (F - A.frame) / (B.frame - A.frame)`; intercept the scene→layer progress remap (see §4
     applies to outer time map) obs:-blend weight `c = clamp01(A.curveForP(1 - t))` per the binary's
     orientation (`FUN_14081fd40(*B.curve, 1-t)`); note the **linear default then behaves like the standard
     lerp `A→B`** in our re-implementation; we standardize to `c = clamp01(B.curveForP(t))` and flag the
     exact orientation of the original as a known UNKNOWN (report UNKNOWN list).
4. Output state: `{x, y, rotation, zoom}`.

## 4. Time mapping scene → camera layer (observed `FUN_1401e4240`)
- Given scene play range `[S, E]` and camera layer `[s, e]` with `e-s ≤ 1 → treat span as 1`.
- `sceneF = S + t*(E - S)`; `base = floor(sceneF)` (interlaced-field handling observed; demo keeps the floor step
  and maps `(sceneF - S)` into layer normalized progress, clamped to [0,1]).

## 5. Rendering application (demo scope, deviates = KNOWN DEVIATION)
The binary's pixel transform application is not fully traced (report UNKNOWN #1). The demo applies the observed
state honestly as a standard 2-D transform: translate(center) · rotate(rotation) · scale(zoom), with the camera
rect projected onto the viewport, plus a debug `infoFrame()` string in the observed 6-float style
(zoom reported ×100).

## 6. Edge cases required
- No camera layer → error. Frame before/after layer range → error (exact strings).
- Keys with zero-property flags are ignored for any property.
- `span ≤ 1` division guarded to 1 (observed `dVar7 <= 1.0 → 1.0` pattern).
- Curve t clamped; curve value clamped to [0,1].
- Exact-frame key wins over search; duplicate frames: first match wins (observed loop `break` on first equal).

## 7. Non-goals
Lock-flag behaviors of `lockx/locky/lockangle`, motion blur, multi-plane camera (multiple camera layers),
layer `size` property semantics, and the writer commands' full parity (script-command protocol) — all
listed in `reports/camera-feature-trace.md` UNKNOWNs.
