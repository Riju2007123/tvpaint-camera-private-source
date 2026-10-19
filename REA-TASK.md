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

next step: 2

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
