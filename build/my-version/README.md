# my-version — keyframed camera (from the TVPaint Demo trace)

Clean-room re-implementation of the traced **camera** behavior (see repo `SPEC.md`,
evidence in `../../evidence/`). No copied code — behavior + observed constants only.

## Run the tests

```bash
cd build/my-version
npm install   # no dependencies; just packet metadata
npm test      # node --test tests/ (12 tests: defaults, sparse keyspan, exact-frame win,
              # boundary hold, error strings, span guard, time map, curve table/quantization)
```

## Run the visual demo

Open `demo/index.html` **directly in a browser** (double-click; classic scripts, works
over file://). Click once on the canvas to play/pause. Buttons add Position/Rotation/Zoom
keys at the current frame; the timeline shows easing between them with the 1001-sample
per-key curve; the debug line prints the 6-float `infoFrame()` parity string
(zoom ×100, like the traced `tv_camerainfoframe`).

## Structure

- `src/curve.js` — ease curve: 1001 uint16 samples ÷ 65535, round(t·1000) lookup with
  linear blend, clamped; default linear ramp (observed in `FUN_14081fd40`).
- `src/cameraTrack.js` — key list, sparse per-property keyspans (rotation/zoom/position
  flags), defaults (zoom 1.0 / rotation 0° / position = camera size), span ≤ 1 guard,
  scene→layer progress map with floor step, exact observed error strings.
- `src/index.js` — small façade (`addPositionKey`, …, `atSceneT`).
- `demo/` — canvas renderer applying the evaluated state as a standard 2-D transform
  (translate · rotate · scale) — SOP §5 declares this the known deviation zone.

## Known deviations / unknowns (honest list)

- Pixel-transform application and 6-float output tail are unspecified in the binary
  (see report UNKNOWNs #1 and #3): demo uses standard transform semantics.
- Ease-curve orientation (original evaluates the *later* key's curve with `1−t`); the
  linear default makes both readings equivalent, and this implementation standardizes
  on `curve(t)`.
- `size` property and lock flags are stored but not yet rendered; motion blur, multi
  plane camera and curve-editor UI are non-goals (SPEC §7).
