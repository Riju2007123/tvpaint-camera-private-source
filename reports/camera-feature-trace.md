# TVPaint Animation 12 Pro Demo — the CAMERA feature (plain-language trace, REA-controlled)

Target: `C:\Program Files\TVPaint Developpement\TVPaint Animation 12 Pro Demo\TVPaint Animation 12 Pro Demo.exe`
SHA-256 `c998c6fe…74c2a`, format PE, x86_64. Tool: REA MCP (rea-agents 6.7.0) + Ghidra 12.1.4 (auto-selected, provider evidence in the exported bundle).
Evidence ledger exported to `evidence/tvpaint-camera-bundle.json` (35 records, 0 unknowns). Every address below comes from that bundle.

## Idea summary (for a beginner)
TVPaint's camera = a special **keyframed track** in the project. Each key stores optional position/x–y, rotation, zoom (and a size property), each with those three "locks". Between two keys, values are eased using a **1001-step custom ease curve** per key. At render time the app evaluates the track for the current frame and uses position/rotation/zoom to place the scene into the camera frame.

## Chain, step by step

1. **The feature's command names (CONFIRMED).** String inventory in the exe contains `tv_camerainfo`, `tv_camerainfoframe`, `tv_camerapath`, `tv_camerainsertpoint`, `tv_cameraremovepoint`, `tv_camerasetpoint`, `tv_cameraaddcurvepoint`, `tv_camerasetcurvepoint`, `tv_camerasetcurvetype`, `tv_cameraremovecurvepoint`, `tv_cameramakelayerfitanim`, plus panel actions `CameraAddPositionKey`, `CameraAddRotationKey`, `CameraAddZoomKey`, `CameraAddSizeKey`, `CameraDelete*Key`, `MultiPlaneCamera`, `FollowCamera`, `ToggleCamera`. (search_strings "amera", Ghitra-defined strings; evidence bundle.)

2. **Command dispatch table (CONFIRMED).** Each `tv_camera…` string has exactly **one** xref. Reading raw bytes around those xrefs (`read_bytes @0x140a5f990`, 192 bytes) shows pointer **pairs** `{name → function}`:
   - `tv_camerainfo → 0x1403f1050`
   - `tv_camerainfoframe → 0x1403f1360`
   - `tv_camerapath → 0x1403f1970`
   - `tv_camerasetpoint → 0x1403f2870`
   - `tv_cameraaddcurvepoint → 0x1403e0e50`, `tv_camerasetcurvepoint → 0x1403f2660`, `tv_camerasetcurvetype → 0x1403f2770`, `tv_cameraremovecurvepoint → 0x1403f24d0`, `tv_cameraremovepoint → 0x1403f25e0`, `tv_cameramakelayerfitanim → 0x1403f1950` (read from the table; handler body prose below only for info/path/infoframe).

3. **`tv_camerainfo` handler = project camera format (CONFIRMED).** `FUN_1403f1050` reads/writes project fields at `+0x168` (width, int), `+0x16C` (height, int), `+0x170` (double, guarded: `<=0.001 → 1.0`). Output lock `%d %d …` — camera width/height and a ratio (pixel aspect or similar — see UNKNOWN #4).

4. **`tv_camerainfoframe` handler = per-frame camera state (CONFIRMED).** `FUN_1403f1360`:
   - get current scene (`FUN_1400b3380`), get **camera layer** (`FUN_1400b6e30`) — else error string `"No camera Layer"`; parse frame from args; if frame outside layer's `[FUN_14078ce20, FUN_14078e200]` = `[start, end]` → `"Given frame out of camera layer's range"`.
   - access the **camera track** object at `scene + 0x2F0`, convert target frame via ratio, then evaluate: position `FUN_1401e33c0` (→ x, y), zoom `FUN_1401e5020` (×100 in the reported string), rotation `FUN_1401e4a80`, plus one more evaluated pair, and return 6 floats with `%f %f %f %f %f %f`.

5. **Key storage layout (CONFIRMED structure; offsets).** Track keeps a pointer array (`track+0x10`) of records with stride **0x380**; key count at `track+8`; a "has-key-track" flag byte at `track+0x33`. Inside a record, a key entry array with stride **0xE0**: `int frame` at +0x00, `double rotation` at +0x18, `double zoom` at +0x20, `double x` at +0x28, `double y` at +0x30, capability flags `int` at +0x48 (bit 1 = has rotation `(>>1)&1`, bit 2 = has zoom `(>>2)&1`, bit 3 = has position `(>>3)&1`), and per-property ease-curve objects at 0x178 (zoom), 0x238 (rotation), 0x2F8 (position) (decompiled `FUN_1401e33c0`, `FUN_1401e5020`, `FUN_1401e4a80`).

6. **Which keys count: per-property keyspans (CONFIRMED).** Camera keys are sparse per property: interpolation only considers the **previous/next key that actually has that property enabled** (e.g. rotation uses flags bit 1) — found via `FUN_1401e3690`/`FUN_1401e3870` (position) and `FUN_1401e46f0`/`FUN_1401e48b0` (rotation), `FUN_1401e4c90`/`FUN_1401e4e50` (zoom). Defaults when no such key exists: position = camera size (scene ints +0x28/+0x2C when track+0x33 flag off), zoom = **1.0**, rotation = **0.0**.

7. **Per-key easing = 1001-sample custom curve (CONFIRMED).** `FUN_14081fd40(curve, t)`: if the curve is absent/short (`0x24 < 0x3EA`) it (re)builds a table of 1001 uint16 samples via `FUN_14081ec20(curve, buffer, 1000.0, 0xFFFF)` — i.e. a linear default. Lookup: clamp t∈[0,1], `i = round(t*1000)`, linear blend `v[i]*(1-frac) + v[i+1]*frac`, scale `1.5259021896696422e-05 = 1/65535`. The eased value is clamped to [0,1] and used as the blend weight between the two keyframe values:
   `v = a*(1-c) + b*c` for x, y (FUN_1401e33c0), zoom (FUN_1401e5020), rotation (FUN_1401e4a80). This is what `tv_cameraaddcurvepoint`/`tv_camerasetcurvepoint`/`tv_camerasetcurvetype` edit — TVPaint's per-key interpolation editor.

8. **Time mapping scene → camera layer (CONFIRMED).** `FUN_1401e4240` maps a normalized scene-time `t` onto the camera layer's own frame span: it also accounts for the scene's play range (`FUN_1400b6670`/`FUN_1400b7820`), and a `floor` + interfield mixing (`FUN_1400da940`) — interlaced-field handling (INFERRED purpose; the mechanics are CONFIRMED calls).

9. **Camera path settings block (CONFIRMED).** `FUN_1403f1970` (`tv_camerapath` handler) builds a descriptive string from scene fields `+0x2F0 lockall`, `+0x30C lockx`, `+0x30D locky`, `+0x30E lockangle`, `+0x308 mode`, `+0x318 motionblur`, plus adjacent flag bytes — the exported text contains literally ` mode `, ` motionblur `, ` lockall `, ` lockx `, ` locky `, ` lockangle `.

## UI actions ↔ internal meaning (CONFIRMED names ↔ evidence)
- `CameraAddPositionKey`/`CameraAddRotationKey`/`CameraAddZoomKey`/`CameraAddSizeKey` ↔ the per-property flag bits + property values stored per key (5.).
- `CameraMoveTo{First,Previous,Next,Last}Key` ↔ keyspan navigation (INFERRED: these are panel action names; handler not traced).
- `No camera Layer`, `Given frame out of camera layer's range` ↔ exactly literal strings in handler 4.

## CONFIRMED vs INFERRED
- CONFIRMED: every statement above labeled so, each tied to a decompiled function and address in the evidence bundle.
- INFERRED (clearly marked): meaning of `scene+0x28/0x2C` as "camera size" (read from a settings-like context), the interlace role of `floor+FUN_1400da940`, purpose of the 6th output float in `tv_camerainfoframe`.

## UNKNOWN + next questions
1. How coordinates/zoom apply to pixels at render (the transform application into the compositor); the huge `FUN_1401e2690` (17.9 KB pseudocode) is the strongest suspect (it walks keys and builds 0x380-sized per-frame records).
2. Full semantic of `scene+0x170` double (`tv_camerainfo`): pixel aspect or DPI.
3. Exact ordering/meaning of the 6 reported floats in `tv_camerainfoframe`.
4. `MultiPlaneCamera`: how multiple camera layers are composed (z-order / per-layer parallax).
5. Writers (`tv_camerasetpoint`, `tv_camerainsertpoint`, curve editors) — needed if we want full parity when *authoring* cameras, but not needed to *read/play* them.
6. Default curve generation details inside `FUN_14081ec20` (not decompiled yet).

## Bottom line for goal C
To make **my own working camera version**, the observed behavior is: a keyframe track with per-property (x, y, rotation, zoom, size) keys; sparse property ranges; per-key 1001-sample ease curves (linear default); evaluation between the previous/next key having that property; defaults x,y = camera size, zoom = 1, rotation = 0; time mapped from scene range onto the camera layer range.
