# SPEC — Camera (exact) + Canvas/Pen-pressure + Timeline + Shortcuts (re-implementation specification)

Target observed: TVPaint Animation 12 Pro Demo.exe (SHA-256 c998c6fe…74c2a), traced with REA+Ghidra;
evidence bundles: `evidence/tvpaint-camera-bundle.json` (35 records, v1) + `evidence/features-bundle.json`
(new records for v2). Full trace: `reports/camera-feature-trace.md` (+ addendum for §8–§11).
This SPEC contains **no copied code** — it describes observable behavior and the structural facts REA observed
(function names/addresses are cited as evidence anchors only).

## 1. Data model (v2 — SEMANTICS CORRECTED by re-trace)
- A scene contains one optional **camera track** (observed at `scene+0x2F0`).
- Track holds an ordered list of **camera keys** and a separate **camera path** (FUN_1401e2690 domain;
  `tv_camerapath`/`tv_camerasetpoint` handlers). Each key:
  - `frame: int`
  - **`width`, `height` (frame SIZE — NOT a pan position!)**, `rotation: double degrees`, `zoom: double`;
    a key captures properties by flag bits at key offset +0x48: bit1 = rotation, bit2 = zoom,
    bit3 = the size slot (observed; CONFIRMED via FUN_1401da730, where the evaluated x/y pair is used as
    `center ± (x/2, y/2)` for the corner rectangle and its no-key defaults are the camera rect itself).
  - Per-property **ease curve** slots: +0x178 zoom, +0x238 rotation, +0x2F8 size.
- **Camera path**: ordered points `{frame, x, y}` = the pan translation of the camera frame center.
  With no path point the binary falls back to a centered view (FUN_1401da730 fallback; center ≈ view size / 2).
- Track properties (locked flags): `lockall, lockx, locky, lockangle`, `mode`, `motionblur` (stored;
  semantics beyond lock flags = UNKNOWN).
- Camera layer (the layer chosen as the camera) has `startFrame`, `endFrame`.

## 2. Ease curve (per key, per property)
- Table of **1001 uint16 samples**; value ∈ [0,1] = `sample / 65535`.
- Evaluate `curve(t)`: clamp t∈[0,1]; `i = round(t*1000)`; linear blend of samples `i`, `i+1`.
- **Storage is x-mirrored at build time** (FUN_14081ec20: each authored control point `(sx, sy)` is rasterized
  at table position `(1 - sx) * 1000`); the evaluator samples at `(1 - t)` (FUN_1401e33c0), which **cancels**
  to a standard ease for the authored curve shape. Default curve (key creation) = linear ramp.
- Curve editor operations: `addCurvePoint`, `setCurvePoint`, `setCurveType`, `removeCurvePoint`
  (observed script commands).

## 3. Evaluation at frame F (observed `tv_camerainfoframe` + `FUN_1401e33c0`/`e5020`/`e4a80`, LITERAL)
1. Resolve camera layer; error `"No camera Layer"` if absent.
2. `F` outside `[startFrame, endFrame]` → error `"Given frame out of camera layer's range"` (exact strings).
3. For each property p ∈ {size(w,h), rotation, zoom}:
   - `A` = key at `F` **with p's flag**, else previous key with p's flag (`FUN_1401e3870`-family =
     greatest property-key frame < F).
   - `B` = next key with p's flag (`FUN_1401e3690`-family = smallest property-key frame > F).
   - Only `A` → value = A.p. Only `B` → value = B.p. Neither → default:
     size = camera (width, height) (scene +0x168/0x16C), zoom = 1.0, rotation = 0.0.
   - Both → `t = (F - A.frame) / (B.frame - A.frame)`;
     **`c = clamp01(B.curveForP(1 - t))`; value = A.p * (1 - c) + B.p * c** — the exact literal decompiled
     formula; with the x-mirrored table this equals a standard eased lerp.
4. Center = **camera path interpolation** at `F` (FUN_1401e2690; its internal math is complex, our path blends
   linearly between path points — INFERRED device). No path → fallback centered `(viewW/2, viewH/2)`.
5. Output state `{sizeW, sizeH, rotation, zoom, cx, cy}`.

## 4. Time mapping scene → camera layer (observed `FUN_1401e4240`)
- Given scene play range `[S, E]` and camera layer `[s, e]`, with `e-s ≤ 1 → treat span as 1`.
- `sceneF = S + t*(E - S)`; `base = floor(sceneF)` (interlace step observed);
  progress = `(sceneF - s) / span`, clamped to [0,1].

## 5. Rendering application (corner semantics CONFIRMED; final compose = KNOWN SMALL DEVIATION)
- FUN_1401da730 builds the camera frame rectangle in world space with corner order **TL, TR, BR, BL**:
  `corner = R(rotation) · (± width*zoom/2, ± height*zoom/2) + center` (fallback center when no path).
  Where exactly zoom/rotation enter the binary's matrix compose (FUN_1401e9880) is not fully disambiguated —
  we scale the frame extents by zoom and rotate corners about the center (documented deviation).
- Demo maps the world camera frame onto the output canvas:
  `screen = out/2 + R(-rot)·fit·(world − center)`, `fit = min(outW/(w·zoom), outH/(h·zoom))`.
- Debug `infoFrame()` string reproduces the **exact observed 6-float output order** (assembly
  0x1403f143f…0x1403f1500): `pathX pathY rotation zoom×100 sizeX sizeY` (exact error strings from §3).

## 6. Edge cases required
- No camera layer → error. Frame before/after layer range → error (exact strings).
- Keys with zero-property flags are ignored for any property.
- `span ≤ 1` division guarded to 1 (observed `dVar7 <= 1.0 → 1.0` pattern).
- Curve t clamped; curve value clamped to [0,1].
- Exact-frame key wins over search; duplicate frames: first match wins (observed loop `break` on first equal).

## 7. Camera non-goals (UNKNOWNs documented)
Lock-flag behaviors of `lockx/locky/lockangle`, motion blur, multi-plane camera, exact FUN_1401e2690
internal path math, and full `tv_camera*` writer-command protocol parity — see the report's UNKNOWN list.

## 8. Shortcuts & shortcut settings (NEW — binding data EXACT)
- **Storage format captured exactly from this install**:
  `%APPDATA%\TVPaint Animation 12 Pro Demo\default\keymaps\Fauxtoshop.cfg` — `[Keyboard]` section, one binding
  per line `<Combo>=<Action>`; Combo = optional `Shift`/`Ctrl` tokens + a key token (`A…Z`, `0…9`, punctuation,
  `F1…F12`, `Ctrl Pad 0…9`, `Wheel Up/Down`, `Page Up/Down`, odd locale tokens like `braquet` kept verbatim);
  `none` = unbound. 293 lines captured byte-for-byte → `build/my-version/keymaps/Fauxtoshop.cfg` and embedded
  verbatim in `src/defaultKeymap.js` (data, regenerable via `tools/genDefaultKeymap.js`).
- In-binary support strings: `mShortcutKey*` (settings-panel state/colors; RGBA values also in `config.ini`:
  `mmenushortcut`, `mshortcutkeyfoundresult` 129 170 201, `mshortcutkeyinuse` 240 208 146,
  `mshortcutkeynormaltext` 182 182 182, `mshortcutkeyselected` 62 71 107), panel action `Export Shortcuts`
  (0x140a6ab78), script action id `11700020Cycle_keyboardshortcut`, `ConfigureKeyboard` (Ctrl K in
  the default map).
- Our behavior: parse `[Keyboard]` files; list/search bindings (found = `mShortcutKeyFoundResult` color,
  conflicts = `mShortcutKeyInUse` color); rebind by pressing a combo (ConfigureKeyboard parity); Export
  re-serializes in the exact `[Keyboard]` format.
- Exact rendering of TVPaint's own shortcuts panel UI = UNKNOWN; the binding data and format are exact.

## 9. Timeline (NEW — structure traced; widget layout INFERRED)
- Evidence: RTTI classes `cTimelineLayer`, `cTimelineLayers`, `cTimelineLayerTimeline`, `cTimelineLayerOptions`,
  `cTimelineStrip`, `cTimelineAudio`, `cTimelineAudioMultiTrack`, `cTimelineAudioTrack(Master|Simple|Plane)`,
  `cTimelineNotes`; settings strings `TimelineUncompactedAtOpen`, `CenterTimeline`,
  `LayerPanel-TimelineNotesHeight`, `LayerPanel-TimelineAudioHeight`.
- Model: per-LAYER rows of exposure segments `{startFrame, endFrame}`; an audio block with kinds
  master/simple/plane; a notes row; ruler end = content end (uncompacted display analog);
  `LayerPrevKey`/`LayerNextKey` = nearest exposure boundary (prev = endExclusive, next = start).
- Exact widget pixel behavior of TVPaint's timeline = UNKNOWN (documented; our layout is an honest device).

## 10. Pen pressure (NEW — device behavior mapped; brush internals UNKNOWN)
- Evidence: string `pressure` (0x140a3d1a8); diagnostics `"\thas pressure ? %s"` (0x140a70f30) inside the tablet
  info function `FUN_14053f9e0`, printing tablet id / button count / is-eraser / has-pressure from globals
  `DAT_140ce0d88`/`DAT_140ce0d94`; RTTI `.?AUcMyTabletReader@nInk@@` (0x140cdb4e8, ink/tablet COM reader);
  settings artifact name `_pressure.mot`.
- Our model: input point `{x, y, pressure 0..1, hasPressure, isPen, isEraser, tilt}`; a mouse (no digitizer)
  reports the constant 0.5 ("has pressure" = false); **width = toolSize · curve(pressure)** reusing the exact
  1001-sample ease-curve system (§2); polyline smoothing factor; eraser via stylus button bit.
- Exact TVPaint brush-engine internals (dab rendering, opacity-map interplay) = UNKNOWN.

## 11. Canvas (NEW — drawing surface with camera-aware world space)
- Evidence anchors: `ToggleCanvasDocking` binary string; the traced layer/exposure data model (§9); the default
  profile's tool/drawing icon set (`tool_*brush`, `drawing_*` shapes).
- We ship a drawing-canvas tab: Pointer-API ink (§10) over the world space; the camera framing (§5) applies to
  the same world. Exact TVPaint canvas behaviors (pan/zoom inertia, paper/grid, wet/oil engines) = UNKNOWN.
