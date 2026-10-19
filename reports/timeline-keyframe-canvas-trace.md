# Trace report — timeline, keyframes and canvas (request #3)

Target: `TVPaint Animation 12 Pro Demo.exe`
SHA-256 `c998c6fe9d14e0a4d23726f2b667f1406f72631de2ab20aa52c34a3c97432c2a`
Tools: REA (MCP) with the Ghidra provider. Addresses are file/memory addresses used as evidence anchors.

Status legend: **CONFIRMED** = read directly from the binary or captured from the install ·
**INFERRED** = reasoned from confirmed evidence · **UNKNOWN** = not recovered.

> Session note (honesty): REA was connected for all the tracing calls below, then the REA MCP server
> disconnected from the session before I could decode the last three items (cMUDBreakInstances vftable
> body, the runtime blend-mode table contents, the paint-engine dab maths). Those stay UNKNOWN and are
> listed at the end. Everything else below was read with REA.

---

## Part A — How the timeline really works: instances + exposures

### A1. The exposure command family (CONFIRMED)

Step 1: search the binary's strings for the script-command names. REA found seven:

| string | address |
|---|---|
| `tv_exposureinfo` | 0x140a62268 |
| `tv_exposurebreak` | 0x140a62278 |
| `tv_exposureadd` | 0x140a62290 |
| `tv_exposureset` | 0x140a622a0 |
| `tv_exposurenext` | 0x140a622b0 |
| `tv_exposureprev` | 0x140a622c0 |
| `tv_exposurefauxfixe` | 0x140a622d0 |

Step 2: each name has one cross-reference. They all land in a table at `0x140a5ff60`, and the entries
are 16 bytes apart (8-byte name pointer + 8-byte handler pointer). Reading 0x80 bytes at `0x140a5ff60`
gave the handler for each command:

| command | handler |
|---|---|
| tv_exposureinfo | 0x14040ddc0 |
| tv_exposurebreak | 0x14040dc50 |
| tv_exposureadd | 0x14040dbe0 |
| tv_exposureset | 0x14040df60 |
| tv_exposurenext | 0x14040dec0 |
| tv_exposureprev | 0x14040df10 |
| tv_exposurefauxfixe | 0x14040dcc0 |

### A2. What an "exposure" is (CONFIRMED)

`tv_exposureinfo` (FUN_14040ddc0) answers a very specific question. It:

1. takes the requested frame (default = the scene frame at `scene+0x48`);
2. asks `FUN_14078dfd0(layer, frame)` whether that frame shows an image;
3. if **yes**, prints `"Exposure %d %d"` using `FUN_14078de00(layer, frame)` and a constant `0`;
4. if **no**, returns an empty string (the `DAT_140a5e8e8` empty literal);
5. if the frame is outside the layer range, returns an error string (`DAT_140a5e8c0`).

So a timeline row is not a set of "start/end strips": it is a list of **image instances**, and each
instance is shown for an **exposure count** of frames. Held frames reuse the same image. That `0` in
the printout is why my old start/end strip model was wrong.

Where the value comes from:

* `FUN_14078dfd0(layer, frame)` — dispatch on the layer type at `layer+0x2c` (types 1, 2, 4, 5, 8 go to
  different sub-objects at `+0x30/+0x38/+0x40/+0x48/+0x60`); "does this frame have an image".
* `FUN_14078de00(layer, frame)` — the same dispatch, then `FUN_1404a7e40(container, frame - layerStart)`
  to resolve the value. **frame − layerStart** confirms frames are stored relative to the layer start.
* `FUN_14078ce20` / `FUN_14078e200` — layer first / last frame (used for the range check everywhere).

### A3. Setting an exposure (CONFIRMED)

`tv_exposureset` (FUN_14040df60) parses two arguments and calls `FUN_1407b3100(frame, n)`. That function
is the exact rule we now implement:

* `frame == -999999` → use the current scene frame (`scene+0x48`);
* range-check against `FUN_14078ce20` / `FUN_14078e200`, otherwise error;
* a flag at `layer+0x20` bit 4 short-circuits (the layer is locked / not editable);
* `n = max(1, n)` — an exposure can never be set to 0;
* for image layers it computes the instance that holds the frame and then **inserts** instances
  (grow) or **removes** instances (shrink) so that instance ends up `n` frames long. Later instances
  shift accordingly. Layers of other types go down separate code paths.

### A4. Breaking a hold (CONFIRMED)

`tv_exposurebreak` (FUN_14040dc50) does two calls: `FUN_14068f700(layer, frame)` then
`FUN_14078aa30(layer, frame)`. `FUN_14068f700` allocates an undo-command object whose RTTI class is
`cMUDBreakInstances` (`.?AVcMUDBreakInstances@@` at 0x140cddbd0) storing `{layer, frame}`. So breaking a
hold is a first-class, undoable **instance split**, not a strip edit.

### A5. A correction worth writing down (CONFIRMED)

`tv_layerhold` looks like it should hold an exposure. It does not. Its handler (FUN_14040d630) calls
`FUN_140253920`, which builds a **"Hold&Fetch" selection tool** (`"Hold&Fetch"` literal, allocated
buffer). Exposure holding is done with `tv_exposureset` / `tv_exposureadd`. I had this wrong before.

### A6. Before/after the layer range (CONFIRMED)

`tv_layerprebehavior` (FUN_140412ce0) and `tv_layerpostbehavior` (FUN_140412a80) read `layer+0x6c` and
`layer+0x70`. The values map to strings:

* 0 → the `none` literal (referenced as `DAT_140a5c96c`)
* 1 → `"repeat"`
* 2 → `"pingpong"`
* 3 → `"hold"`

Setters go through `FUN_1400d5750` / `FUN_1400d54f0`. This is exactly the sampler we implemented:
`none` = nothing outside the range, `hold` = clamp, `repeat` = loop, `pingpong` = mirror.

### A7. The two per-layer animation flags (CONFIRMED)

* **auto break instance**: getter `FUN_14078a070` → type-2 sub-object `+0x28`, type-5 sub-object `+0xb0`;
  a folder (type 6) reports true if any child has it (`FUN_1407932d0(...,1)`). Command handler
  `tv_layerautobreakinstance` (FUN_14040e620); setter `FUN_1407a31b0`.
* **auto create instance**: getter `FUN_14078a110` → type-2 `+0x29`, type-5 `+0xb1`; folders via
  `FUN_1407932d0(...,2)`. Handler `tv_layerautocreateinstance` (FUN_14040e870).

Both commands accept the usual George on/off/toggle words. These two flags are what make drawing behave
like animation: draw on a hold and it breaks into a new key; draw on an empty frame and an instance is
created.

### A8. The rest of the tv_layer table (CONFIRMED)

Parsing the table at `0x140a5fc20` (0x330 bytes) gave the handlers for the timeline/canvas-relevant
commands: `tv_layerdensity` 0x140410e90, `tv_layerdisplay` 0x140410f40,
`tv_layerrecomputeexposure` 0x140412f40, `tv_layerinsertimage` 0x1404118f0, `tv_layerimage` 0x14040bc80,
`tv_layergetimage` 0x14040bc40, `tv_layerblendingmode` 0x14040f310,
`tv_layerautobreakinstance` 0x14040e620, `tv_layerautocreateinstance` 0x14040e870,
`tv_layerprebehavior` 0x140412ce0, `tv_layerpostbehavior` 0x140412a80, `tv_layerhold` 0x14040d630.

`tv_layerrecomputeexposure` takes 4 arguments and re-spaces exposures over a range via
`FUN_1400dd1a0` / `FUN_1400dcf50`; I did not decode the re-spacing maths, so the app does not implement
recompute (UNKNOWN, listed below).

---

## Part B — Keyframes and navigation

The captured keymap file (`%APPDATA%\TVPaint Animation 12 Pro Demo\default\keymaps\Fauxtoshop.cfg`)
defines two different navigations, and they are **not** the same thing:

| combo | action | meaning |
|---|---|---|
| Ctrl Left | `PrevInstance` | previous image instance |
| Ctrl Right | `NextInstance` | next image instance |
| Page Up | `LayerPrevKey` | previous exposure boundary of the layer |
| Page Down | `LayerNextKey` | next exposure boundary of the layer |

A key is the first frame of an instance (offset 0 in the run); a held frame inside the exposure is not a
key. Boundaries are instance starts and end+1, which is exactly where the exposure setter splits.
**INFERRED** from the confirmed exposure model; the exact original UI hit-testing is not needed because
the actions are named in the keymap.

The wiring of the two flags into the paint path (draw → break / create) is **INFERRED**: the flags are
confirmed, but I did not trace the paint function frame-by-frame.

---

## Part C — Canvas: layers, opacity, blend, images

### C1. Layer opacity / density (CONFIRMED)

`tv_layerdensity` (FUN_140410e90): reads the current opacity as a 0..1 double (`FUN_1400daaf0`), sets it
from the command value / 100 (`FUN_1400e3f70(layer, value/100)`), and returns the old value rounded to a
percent (`int(old * 100)`). Our layer opacity therefore uses the same 0..1 range.

### C2. Layer blend mode (CONFIRMED command; list UNKNOWN)

`tv_layerblendingmode` (FUN_14040f310) sets a per-layer blend mode. `FUN_1407374b0` **aliases mode 0xD
to 0xC** when naming it, and the name list is a runtime string array (`DAT_140cc0f10`, count at
`DAT_140cc0f08`) that gets a `"Transparent"` entry for folder layers (`FUN_140737670`). The install's
`config.ini` contains `blendingmode=Multiply`, plus `blendbackground=1` and `blendmask=0`, so
**Multiply is a real mode value** in this build.

The exact number/order/ids of all modes is UNKNOWN (the table is built at runtime and I did not read its
contents). Our select offers normal/multiply/screen/add/overlay/darken/lighten/difference mapped to
Canvas2D composite operations, with Multiply as the confirmed one.

### C3. Layer images (CONFIRMED commands, engine UNKNOWN)

`tv_layerinsertimage`, `tv_layerimage` and `tv_layergetimage` exist (handlers above), i.e. the binary has
its own per-layer image entry points. Combined with the instance model, this supports our design: **each
instance owns its own canvas image**, and drawing edits the image of the instance at the playhead.

The paint engine itself (dab shape, spacing, opacity flow, wet/oil brushes) was **not** decoded. Our
brush stamps radial-gradient dabs along the stroke with pressure-driven width and alpha and spacing =
12% of the dab width, and keeps the stroke points so an image can be re-rendered deterministically for
undo. This is INFERRED, and labelled as such in the README and SPEC.

---

## Part D — What we rebuilt from this

* `src/timeline.js` (v2): `Layer` owns **runs** (`{kind:'image'|'empty', count, image}`), with
  `setExposure`, `addExposure`, `breakInstance`, `newInstance`, `clearImage`, `ensureDrawable`,
  `prevInstance/nextInstance`, `prevKey/nextKey`, and the four before/after behaviours. No start/end
  strips anymore.
* The demo now draws on **per-instance canvases**: `Background` (1 key × 60f), `Ball animation`
  (6 keys × 10f, six visibly different drawings) and `Paint` (1 key × 60f, the drawing layer).
* Layer panel gained the traced settings: opacity (density), blend, before/after behaviour, auto create
  and auto break — all on the active layer.
* Timeline buttons: `+ Exposure`, `Break`, `+ Instance`, `Clear`, plus `◀◆`/`◆▶` for instance
  navigation, and the key readout `key i/n · exposure · frames a–b`.

## Verification

* `npm test` → **38/38** Node tests pass (11 of them are the new instance/exposure/behaviour model).
* `node tools/verify-ui.mjs` → **24/24** Chrome DevTools Protocol checks pass, driving the real page
  with mouse and keyboard: auto-break split a 60f exposure to `19 + 41` at frame 20 with the new key
  cloned from the held image, Ctrl Z undo, + Exposure / + Instance / Clear + undo, Ctrl Right vs
  Page Down, per-key canvas identity, Ctrl K (283 captured bindings) and Escape, camera view, zero
  console/page errors. Screenshots: `evidence/ui/01-draw-key1.png`, `02-draw-key2.png`,
  `03-camera-view.png`.
* One real bug was found and fixed by this check: the dev server mapped `/` to `/demo/index.html`, so
  the page's relative `styles.css`/`app.js` 404'd; it now redirects to `/demo/`.

## UNKNOWN (with the next question to ask REA)

1. **cMUDBreakInstances body** — does break deep-copy the image or share/reference-count it? (next:
   read the vftable at the RTTI reference and decompile its Do/Undo.)
2. **Blend-mode enum table** — the full list, order and ids (next: dump `DAT_140cc0f08/DAT_140cc0f10`
   at runtime, or find the initialiser that fills them).
3. **Paint-engine maths** — dab spacing/opacity/build-up and the wet/oil engines (next: trace the paint
   command from the tool dispatch into the image blit and read the spacing constant).
4. **tv_layerrecomputeexposure** re-spacing curve (next: decompile `FUN_1400dcf50`).
5. **tv_layeranim** (layer → animated instances) handler 0x14040f300: REA reported no loaded source
   mapping for that address at the time, so its behaviour is not confirmed.
