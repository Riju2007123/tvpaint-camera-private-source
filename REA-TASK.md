# REA-TASK

- Target: `C:\Program Files\TVPaint Developpement\TVPaint Animation 12 Pro Demo\TVPaint Animation 12 Pro Demo.exe` (native Windows, need Ghidra route)
- ONE feature: the **Camera** feature (add camera / camera keyframes: pan, zoom, rotation of the scene)
- Goal: **C — my own working version** (=> also produce SPEC.md first)
- Report: plain beginner language; every claim with REA Evidence (file, function, line/offset), CONFIRMED vs INFERRED, UNKNOWN list.

## Answers saved ([19-10-2026])
- Feature: camera feature
- Goal: C
- Workspace: C:\Users\riju\AppData\Local\Temp\opencode\tvpaint-re

## Status
- [x] Step 1 ASK — answers saved
- [x] Step 2 SETUP — doctor --client opencode healthy; registration:opencode ok; GHIDRA_INSTALL_DIR=C:\ghidra_12.1.4_PUBLIC and JAVA_HOME set (Ghidra provider available)
- [ ] Step 3 ROUTE
- [x] Step 4 TRACE — done (reports/camera-feature-trace.md)
- [x] Step 5 REPORT — done (reports/camera-feature-trace.md, evidence/tvpaint-camera-bundle.json: 35 records)
- [x] Step 6 BUILD — SPEC.md + build/my-version (src/curve.js, src/cameraTrack.js, src/index.js, demo/, 12 tests passing: npm test in build/my-version; demo: open demo/index.html)

next step: none — step 7 done

## Step 7 note
Private repo: https://github.com/Riju2007123/tvpaint-camera-private-source (created via GitHub API with the stored credential manager token; pushed with plain git push).

## New request ([19-10-2026] #3)
User: "use REA to reverse engeneer the timeline, key frame and canvas of tv paint 12 then add them in our app" (previous UI rebuild + camera v2 rejected as "not good"; timeline/keyframe/canvas must be traced deeper, not approximated).

## Step 4c TRACE — timeline / keyframes / canvas (v3)
- Exposure command family found and resolved to handlers: tv_exposureinfo 0x14040ddc0, break 0x14040dc50,
  add 0x14040dbe0, set 0x14040df60, next 0x14040dec0, prev 0x14040df10, fauxfixe 0x14040dcc0
  (strings 0x140a62268..0x140a622d0; name/handler table at 0x140a5ff60, stride 0x10).
- CORRECTED MODEL: a layer is a list of image INSTANCES with exposure counts (plus empty exposures),
  not start/end strips. tv_exposureinfo prints "Exposure %d %d" via FUN_14078de00/FUN_14078dfd0 (layer
  type dispatch on +0x2c: 1/2/4/5/8) and FUN_1404a7e40(container, frame - layerStart).
- Setter FUN_1407b3100(frame, n): -999999 = current scene frame (scene+0x48); range check
  FUN_14078ce20/FUN_14078e200; edit-lock layer+0x20 bit4; n = max(1, n); inserts/removes instances.
- Break = undoable cMUDBreakInstances object (RTTI 0x140cddbd0) via FUN_14068f700 + FUN_14078aa30.
- Correction: tv_layerhold (FUN_14040d630) is the "Hold&Fetch" selection tool (FUN_140253920), NOT an
  exposure hold.
- Pre/post behaviour: layer +0x6c / +0x70, modes 0 none / 1 repeat / 2 pingpong / 3 hold
  (FUN_140412ce0 / FUN_140412a80).
- Auto break instance getter FUN_14078a070 (type2 +0x28, type5 +0xb0; folders FUN_1407932d0(...,1));
  auto create instance getter FUN_14078a110 (type2 +0x29, type5 +0xb1; folders (...,2)); setter
  FUN_1407a31b0. Handlers tv_layerautobreakinstance 0x14040e620 / tv_layerautocreateinstance 0x14040e870.
- tv_layer table at 0x140a5fc20 parsed: density 0x140410e90, display 0x140410f40, recomputeexposure
  0x140412f40, insertimage 0x1404118f0, image 0x14040bc80, getimage 0x14040bc40, blendingmode 0x14040f310,
  prebehavior 0x140412ce0, postbehavior 0x140412a80, hold 0x14040d630.
- Canvas: tv_layerdensity reads opacity 0..1 (FUN_1400daaf0) and sets value/100 (FUN_1400e3f70);
  tv_layerblendingmode aliases 0xD→0xC (FUN_1407374b0) with a runtime name table (DAT_140cc0f08/10,
  "Transparent" for folders, FUN_140737670); config.ini has blendingmode=Multiply.
- Keymap (captured): Ctrl Left/Right = PrevInstance/NextInstance; Page Up/Down = LayerPrevKey/LayerNextKey.

## Step 5c REPORT
- reports/timeline-keyframe-canvas-trace.md (full trace, CONFIRMED/INFERRED/UNKNOWN, no copied code).
- evidence/features-bundle.json gained timelineInstances (10), keyframes (3), canvas (5) records + updated verification.

## Step 6c BUILD
- src/timeline.js rewritten as the instance/exposure model (runs, setExposure/addExposure/breakInstance/
  newInstance/clearImage/ensureDrawable, prev/next instance, prev/next key, 4 behaviours).
- demo rebuilt around PER-INSTANCE canvases (Background 1 key, Ball animation 6 keys, Paint 1 key with
  auto break/create as you draw), layer panel gained opacity/blend/before/after/auto flags, timeline gained
  + Exposure / Break / + Instance / Clear and instance nav; brush is a pressure dab engine.
- Tests: 38/38 pass (11 new timeline model tests).
- NEW tools/verify-ui.mjs: zero-dependency headless-Chrome CDP check, 24/24 pass, screenshots in evidence/ui/.
- Bug found by that check and fixed: tools/serve.js mapped "/" to /demo/index.html so relative styles.css/app.js 404'd; now redirects to /demo/.

## REA availability note ([19-10-2026])
The REA MCP server was connected for every tracing call above, then disconnected from the session (the
Code Mode catalog dropped the rea tools). Remaining items need a reconnected REA session:
cMUDBreakInstances vftable body, the runtime blend-mode table contents, paint-engine dab maths,
tv_layerrecomputeexposure re-spacing (FUN_1400dcf50), and tv_layeranim (0x14040f300 had no loaded source
mapping when read).

next step: 4 (resume REA tracing of the UNKNOWN list, then Step 7 push)

## New request ([19-10-2026] #2)
User: bring Camera to EXACT parity, add: (1) canvas, (2) pen pressure, (3) shortcuts + shortcut settings, (4) exact timeline.

## Step 4b TRACE — camera EXACT + new features
- Camera semantics FIX (was wrong in v1): keys' x/y = camera frame SIZE (default = camera W/H); pan position comes from the camera PATH object (FUN_1401e2690), corners = FUN_1401da730: center ± (size/2). Evaluator blend literal: c = clamp01(curve(nextKey).at(1-t)); value = prev*(1-c) + next*c (FUN_1401e33c0). FUN_14081ec20 shows curve tables are x-mirrored at build (x_ui = (1-sx)*1000), so net behavior = standard ease(t). 6-float output order (tv_camerainfoframe, from assembly 0x1403f1345..0x1403f1500): path(x), path(y), rotation, zoom*100, sizeX, sizeY.
- Pen pressure: strings 0x140a3d1a8 "pressure", 0x140a70f30 "\thas pressure ? %s\n" (used in tablet diagnostics FUN_14053f9e0 reading globals 0x140ce0d88/0x140ce0d94: tablet id / buttons / eraser / has-pressure), RTTI ".?AUcMyTabletReader@nInk@@" 0x140cdb4e8 (Microsoft Ink COM style reader). Settings artifacts "_pressure.mot" 0x140a45188.
- Shortcuts: EXACT settings file found and captured: %APPDATA%\TVPaint Animation 12 Pro Demo\default\keymaps\Fauxtoshop.cfg — "[Keyboard]" section, "Modifier Key=Action" lines, "none" = unbound; 293 lines; actions like Undo/Pan/SelectAll; special tokens: Ctrl Pad N, Wheel Up/Down, Page Up/Down, braquet; in-binary support strings: mShortcutKey* (colors/state), "Export Shortcuts" 0x140a6ab78, action id "11700020Cycle_keyboardshortcut".
- Timeline: RTTI classes cTimelineLayer/Layers/LayerTimeline, cTimelineStrip, cTimelineAudioTrack(+Master|Simple|Plane), cTimelineAudio, cTimelineNotes; settings strings TimelineUncompactedAtOpen, CenterTimeline, LayerPanel-TimelineNotesHeight, LayerPanel-TimelineAudioHeight.
- Canvas/panels: RTTI cPanel* (Storyboard/Palette/ProjectView absent under that name) — visual layout kept INFERRED.

## Step 6b BUILD
- SPEC.md got §8 shortcuts, §9 timeline, §10 pen pressure, §11 canvas; camera §1–§5 rewritten to size+path semantics.
- build/my-version: src/shortcuts.js (+keymaps/Fauxtoshop.cfg + src/defaultKeymap.js), src/timeline.js, src/pressureInk.js, fixed src/cameraTrack.js (size keys + camera path + corners), demo with tabs (Camera / Canvas+pressure / Timeline / Shortcuts).

## Step 7b
- Same private repo, new commits pushed.

## Step 6c/7c BUILD — UI shell (user feedback #3: "canvas is black, UI is shit")
- Fixed the black canvas: the draw view now renders a white paper with composited layers (the old demo filled dark only).
- Rebuilt the demo as a single TVPaint-style app shell instead of tabs: menu bar, options bar, left tool rail, viewport, right panels (Color / Camera / Layers), bottom timeline, status bar.
- UI theme is evidence-based: all colours read from TVPaint's own config.ini "Night" scheme (mdesktopbackground 49 49 54, mdocumentbackground 45 45 50, mgadgetborder 43 43 48, mgadgettextinside 182 182 182, mgadgettextbackground 70 70 77, mgadgettoolbarbutton 92 92 92, selected 62 71 107, layer handles 90 90 97 / 110 110 117 / 90 102 204, notes 80 80 87, playhead 255 255 0, notifications 137 143 166 / 10 10 10). Cited per CSS variable in demo/styles.css.
- Camera view now renders the real camera output: output rect clipped + letterboxed, TL/TR/BR/BL labels, path polyline, HUD with the exact 6-float infoFrame order; draw view shows the camera frame overlay aligned to the paper.
- Fixed a real bug found in browser testing: camera path points were absolute near origin instead of centred on the paper (camera pointed off-canvas); ranges now stay around the paper centre.
- Live shortcut dispatcher wired to real actions (undo/redo, tools, layers, frame/key nav, panel toggles, size, zoom, fullscreen, save); Configure Keyboard dialog with search/rebind/reset/export in the exact captured format.
- Verified in browser: pen stroke draw + Ctrl Z undo + Shift U redo, E/B tool switching, Right/Page Down navigation, F6 panel toggle, Ctrl K dialog, camera keys/path, infoFrame order, zero console errors. 32/32 tests pass.
- Docs: README rewritten for the app; report addendum (camera v2 + canvas + pressure + shortcuts + timeline + UI theme); evidence/features-bundle.json distilled ledger. tools/serve.js added (dev-only static server with correct MIME types).

