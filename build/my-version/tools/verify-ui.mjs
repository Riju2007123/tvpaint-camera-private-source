/* tools/verify-ui.mjs — end-to-end UI check for the demo using the Chrome DevTools
 * Protocol directly (Node's built-in WebSocket + spawn). No extra dependencies.
 *
 * It launches headless Chrome, drives the app like a user (mouse stroke, timeline
 * buttons, shortcut keys), asserts the timeline/canvas effects, and writes
 * screenshots to evidence/ui/. Exits non-zero if any assertion fails.
 *
 * Usage: node tools/verify-ui.mjs [url]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_APP = process.argv[2] || 'http://127.0.0.1:8124/';
const PORT = 9333;
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'evidence', 'ui');
mkdirSync(OUT, { recursive: true });
const PROFILE = path.join(tmpdir(), 'tvp-verify-profile-' + Date.now());

const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const consoleErrors = [];
const pageErrors = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--window-size=1500,950',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank',
], { stdio: 'ignore' });

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(150);
  }
  throw new Error('timeout waiting for ' + url);
}

let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}, timeoutMs = 15000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeoutMs);
    pending.set(id, { resolve, reject, t });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function click(x, y) {
  const base = { x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
}
async function drag(points) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[0].x, y: points[0].y, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: points[0].x, y: points[0].y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
  for (const p of points.slice(1)) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, pointerType: 'mouse' });
    await sleep(12);
  }
  const last = points[points.length - 1];
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
}
async function key(keyName, code, vk, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}
async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, name + '.png');
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}
async function rectOf(sel) {
  return evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2 }; })()`);
}
async function clickSel(sel) {
  const r = await rectOf(sel);
  if (!r) throw new Error('selector not found: ' + sel);
  await click(r.cx, r.cy);
  await sleep(120);
}

try {
  await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  const list = await waitJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = list.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); clearTimeout(p.t); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 300));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      pageErrors.push(String(m.params.entry.text).slice(0, 300));
    }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

  await send('Page.navigate', { url: URL_APP });
  for (let i = 0; i < 60; i++) {
    try { if (await evaluate('document.readyState === "complete" && !!window.TVPTimeline')) break; } catch {}
    await sleep(150);
  }
  await sleep(700);

  /* 1. boot state */
  const boot = await evaluate(`(() => ({
    layers: layers.map(l => ({ name: l.name, keys: l.instanceCount, runs: l.runs.map(r => r.kind + ':' + r.count), opacity: l.opacity, blend: l.blend, pre: l.preBehavior, post: l.postBehavior, autoCreate: l.autoCreate, autoBreak: l.autoBreak })),
    rows: document.querySelectorAll('#tlrows .tlrow').length,
    blocks: document.querySelectorAll('#tlrows .exp').length,
    keys: document.querySelectorAll('#tlrows .exp.key').length,
    camKeys: document.querySelectorAll('.keymark').length,
    keyinfo: document.getElementById('keyinfo').textContent,
    tlinfo: document.getElementById('tlinfo').textContent
  }))()`);
  check('app booted with 3 layers', boot.layers.length === 3, boot.layers.map(l => l.name).join(', '));
  check('ball layer has 6 keys (6x10f)', boot.layers[1] && boot.layers[1].keys === 6 && boot.layers[1].runs.join('|') === 'image:10|image:10|image:10|image:10|image:10|image:10', boot.layers[1] && boot.layers[1].runs.join('|'));
  check('timeline rows = camera + 3 layers + audio + notes', boot.rows === 6, String(boot.rows));
  check('timeline draws one block per image instance (6 ball keys + 2 layers + 1 audio block = 9)', boot.blocks === 9, String(boot.blocks));
  check('every image instance block carries its key marker (audio block excluded)', boot.keys === 8 && boot.keys < boot.blocks, boot.keys + '/' + boot.blocks);
  check('layer settings surface pre/post + auto flags', boot.layers[2].pre === 'hold' && boot.layers[2].autoBreak === true, JSON.stringify(boot.layers[2]));

  /* 2. draw a stroke on the Paint layer (frame 1, its first key) */
  const paper = await evaluate(`(() => { const r = view.getBoundingClientRect(); return { cx: r.x + r.width/2, cy: r.y + r.height/2 }; })()`);
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push({ x: paper.cx - 260 + t * 520, y: paper.cy - 60 + Math.sin(t * Math.PI) * 150 });
  }
  await drag(pts);
  await sleep(250);
  const afterStroke = await evaluate(`(() => { const L = layers[activeLayer]; const s = L.sampleInside(state.currentFrame);
    return { strokes: s && s.run.image ? s.run.image.strokes.length : -1, keys: L.instanceCount, frames: L.runs.map(r => r.count), frame: state.currentFrame }; })()`);
  check('mouse drag paints a stroke on the current image', afterStroke.strokes === 1, JSON.stringify(afterStroke));
  check('drawing on a key does not split the exposure', afterStroke.keys === 1 && afterStroke.frames.length === 1, JSON.stringify(afterStroke));

  /* 3. draw at frame 20: auto-break must split the 60f exposure into two keys */
  await evaluate('setFrame(20)');
  await sleep(120);
  const p2 = [];
  for (let i = 0; i <= 10; i++) p2.push({ x: paper.cx - 180 + i * 36, y: paper.cy + 40 + Math.sin(i) * 20 });
  await drag(p2);
  await sleep(250);
  const afterBreak = await evaluate(`(() => { const L = layers[activeLayer]; return { keys: L.instanceCount, runs: L.runs.map(r => r.kind + ':' + r.count), frame: state.currentFrame, firstStrokes: L.runs[0].image.strokes.length, secondStrokes: L.runs[1].image.strokes.length }; })()`);
  check('auto break instance split the held image at frame 20', afterBreak.keys === 2 && afterBreak.runs.join('|') === 'image:19|image:41', JSON.stringify(afterBreak));
  check('the new key starts as a copy of the held image (cMUDBreakInstances)', afterBreak.secondStrokes === afterBreak.firstStrokes + 1, JSON.stringify(afterBreak));

  /* 4. undo with Ctrl+Z removes the stroke, keeps the split exposure (undo is per image) */
  await key('z', 'KeyZ', 90, 2);
  await sleep(200);
  const afterUndo = await evaluate(`(() => { const L = layers[activeLayer]; const s = L.sampleInside(state.currentFrame);
    return { strokes: s && s.run.image ? s.run.image.strokes.length : -1, first: L.runs[0].image.strokes.length, keys: L.instanceCount }; })()`);
  check('Ctrl+Z undoes the stroke painted on the new key', afterUndo.strokes === 1 && afterUndo.first === 1, JSON.stringify(afterUndo));
  await key('z', 'KeyZ', 90, 2);
  await sleep(150);
  const afterUndo2 = await evaluate(`(() => { const L = layers[activeLayer]; return { first: L.runs[0].image.strokes.length }; })()`);
  check('Ctrl+Z again undoes the first stroke', afterUndo2.first === 0, JSON.stringify(afterUndo2));

  /* 5. timeline commands: add exposure, new instance, clear */
  await evaluate('setFrame(30)');
  const before = await evaluate('layers[activeLayer].runs.map(r => r.count).join("|")');
  await clickSel('#tlbar [data-cmd=addexp]');
  const afterExp = await evaluate('layers[activeLayer].runs.map(r => r.count).join("|")');
  check('+ Exposure extends the instance at the playhead', before !== afterExp, before + ' -> ' + afterExp);

  await evaluate('setFrame(45)');
  await clickSel('#tlbar [data-cmd=newkey]');
  const afterKey = await evaluate('layers[activeLayer].runs.map(r => r.kind + ":" + r.count).join("|")');
  check('+ Instance creates a new key at the playhead (split)', afterKey.split('|').length >= 3, afterKey);

  await clickSel('#tlbar [data-cmd=clearexp]');
  const cleared = await evaluate('(() => { const s = layers[activeLayer].sampleInside(state.currentFrame); return s ? s.kind : "outside"; })()');
  check('Clear turns the instance into an empty exposure', cleared === 'empty', cleared);
  await key('z', 'KeyZ', 90, 2);
  const restored = await evaluate('(() => { const s = layers[activeLayer].sampleInside(state.currentFrame); return s ? s.kind : "outside"; })()');
  check('Ctrl+Z restores the cleared image (undo keeps the run)', restored === 'image', restored);

  /* 6. navigation: Page Down = LayerNextKey, Ctrl+Right = NextInstance */
  await evaluate('setFrame(1)');
  await key('ArrowRight', 'ArrowRight', 39, 2);   // Ctrl+Right
  await sleep(120);
  const instFrame = await evaluate('state.currentFrame');
  check('Ctrl+Right jumps to the next instance (PrevInstance/NextInstance)', instFrame > 1, 'frame ' + instFrame);
  await key('PageDown', 'PageDown', 34, 0);
  await sleep(120);
  const nextKeyFrame = await evaluate('state.currentFrame');
  check('Page Down jumps to the layer next key', nextKeyFrame >= instFrame, 'frame ' + nextKeyFrame);

  /* 7. per-key canvases: pillarboxed frames show different art (image identity) */
  const identity = await evaluate(`(() => { const L = layers[1]; const a = L.imageAt(1), b = L.imageAt(11), c = L.imageAt(21);
    return { distinct: a !== b && b !== c && a !== c, frames: [1,11,21].map(f => L.sampleInside(f).run.count) }; })()`);
  check('each animation key is its own canvas image', identity.distinct === true, JSON.stringify(identity));

  /* 8. shortcuts dialog + captured keymap */
  await key('k', 'KeyK', 75, 2);
  await sleep(220);
  const km = await evaluate(`(() => ({ open: document.getElementById('modalback').classList.contains('open'),
    count: document.getElementById('kmcount').textContent,
    rows: document.querySelectorAll('#kmlist tr').length }))()`);
  check('Ctrl+K opens Configure keyboard with the captured keymap', km.open === true && km.rows > 200, JSON.stringify(km));
  await key('Escape', 'Escape', 27, 0);
  await sleep(150);
  const closed = await evaluate(`document.getElementById('modalback').classList.contains('open')`);
  check('Escape closes the shortcuts dialog', closed === false, String(closed));

  /* 9. camera view still renders the composited canvas */
  await clickSel('[data-mode=cam]');
  await sleep(250);
  const cam = await evaluate(`(() => ({ mode: state.mode, hud: document.getElementById('camhud').textContent.split('\\n')[0] }))()`);
  check('Camera view renders the composited animation', cam.mode === 'cam' && /CAMERA/.test(cam.hud), JSON.stringify(cam));
  await screenshot('03-camera-view');
  await clickSel('[data-mode=draw]');
  await sleep(150);
  await evaluate('setFrame(11)');
  await sleep(200);
  await screenshot('02-draw-key2');
  await evaluate('setFrame(1)');
  await sleep(150);
  await screenshot('01-draw-key1');

  check('no uncaught page errors', pageErrors.filter(t => !/favicon/i.test(t)).length === 0, pageErrors.filter(t => !/favicon/i.test(t)).slice(0, 3).join(' | '));
  const realConsoleErrors = consoleErrors.filter(t => !/favicon/i.test(t));
  check('no console errors', realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('scenario ran to completion', false, String(err && err.message || err));
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  await sleep(300);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
}

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ url: URL_APP, pass: results.length - failed.length, fail: failed.length, results, screenshots: OUT }, null, 2));
process.exit(failed.length ? 1 : 0);
