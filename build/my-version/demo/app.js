/* app.js — TVPaint-style animation app built from the REA trace.
 *
 * What is traced (see SPEC.md + reports/camera-feature-trace.md):
 *  - timeline: a layer is a list of image INSTANCES with exposure counts, plus
 *    empty exposures; pre/post behaviour is none/repeat/pingpong/hold; layers have
 *    auto-create-instance and auto-break-instance flags (tv_layer* commands).
 *  - keyframes: every instance start is a key; Ctrl Left/Right = Prev/NextInstance,
 *    Page Up/Down = LayerPrev/NextKey.
 *  - canvas: layers are composited images with opacity (tv_layerdensity, 0..1) and a
 *    blend mode (tv_layerblendingmode); drawing at a held frame splits the instance
 *    when auto-break is on, drawing on an empty frame creates one when auto-create is on.
 *  - camera v2: size keys + path + rotation/zoom (exact interpolation from cameraTrack.js).
 *  - shortcuts: captured Fauxtoshop.cfg keymap with live dispatcher + ConfigureKeyboard.
 *
 * INFERRED (stated in the report): the brush dab spacing/flow model, the exact
 * blend-mode list/order, and the pixel body of cMUDBreakInstances. The instance /
 * exposure rules themselves are confirmed by the command handlers.
 */
'use strict';
const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const W = 1600, H = 900;                     // project / paper size
const PAPER = '#f7f4ec';

/* ---------------- state ---------------- */
const state = {
  currentFrame: 1, endFrame: 60, fps: 24, playing: false,
  mode: 'draw', zoom: 1, panX: 0, panY: 0,
  tool: 'brush', size: 18, smoothing: 0.35, pressure: true,
  color: '#2f6f9f', opacity: 1, showCoords: false,
};

/* ---------------- canvas images (one per instance) ---------------- */
function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}
function redrawImage(img) {
  const ctx = img.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  if (img.seed) { ctx.save(); img.seed(ctx); ctx.restore(); }
  for (const st of img.strokes) replayStroke(img, st);
}
function makeImage(seed, strokes) {
  const canvas = makeCanvas();
  const img = { canvas, ctx: canvas.getContext('2d'), seed: seed || null, strokes: strokes ? strokes.slice() : [] };
  redrawImage(img);
  return img;
}
function cloneImage(img) {
  if (!img) return makeImage(null);
  return makeImage(img.seed, img.strokes);
}

/* ---------------- seed art (our own code, not copied) ---------------- */
function seedBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#dce9f2'); g.addColorStop(0.55, '#eef2ea'); g.addColorStop(1, '#e7e2cf');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#b9cdb9'; ctx.beginPath(); ctx.moveTo(0, 620);
  ctx.bezierCurveTo(240, 470, 420, 560, 640, 520); ctx.bezierCurveTo(900, 470, 1100, 560, 1600, 500);
  ctx.lineTo(1600, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a4bf9f'; ctx.beginPath(); ctx.moveTo(0, 700);
  ctx.bezierCurveTo(300, 590, 560, 660, 820, 620); ctx.bezierCurveTo(1120, 575, 1320, 650, 1600, 610);
  ctx.lineTo(1600, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,110,80,.35)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 760); ctx.bezierCurveTo(500, 730, 1000, 790, 1600, 745); ctx.stroke();
  // sun and clouds
  ctx.fillStyle = 'rgba(244,196,84,.9)'; ctx.beginPath(); ctx.arc(1180, 250, 90, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(220,160,60,.5)'; ctx.lineWidth = 4;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    ctx.beginPath(); ctx.moveTo(1180 + Math.cos(a) * 108, 250 + Math.sin(a) * 108);
    ctx.lineTo(1180 + Math.cos(a) * 132, 250 + Math.sin(a) * 132); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  for (const [cx, cy, s] of [[330, 260, 1], [540, 320, .7], [980, 190, .6]]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, 130 * s, 44 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 70 * s, cy - 22 * s, 90 * s, 38 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
}
/* One different image per animation instance: this is what the timeline keys drive. */
function seedBall(ctx, i, n) {
  const t = n <= 1 ? 0 : i / (n - 1);
  const x = 230 + t * 1120;
  const y = 690 - Math.abs(Math.sin(t * Math.PI * 1.35)) * 430;
  // motion arc
  ctx.strokeStyle = 'rgba(60,90,120,.20)'; ctx.lineWidth = 3; ctx.setLineDash([2, 8]);
  ctx.beginPath();
  for (let k = 0; k <= 40; k++) {
    const u = k / 40;
    const px = 230 + u * 1120, py = 690 - Math.abs(Math.sin(u * Math.PI * 1.35)) * 430;
    k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.stroke(); ctx.setLineDash([]);
  // ground shadow
  ctx.fillStyle = 'rgba(30,40,30,.18)';
  ctx.beginPath(); ctx.ellipse(x, 720, 64 - (690 - y) * 0.04, 13, 0, 0, Math.PI * 2); ctx.fill();
  // ball
  const g = ctx.createRadialGradient(x - 18, y - 20, 4, x, y, 52);
  g.addColorStop(0, '#ffd27a'); g.addColorStop(.45, '#e98b3c'); g.addColorStop(1, '#a8481f');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 48, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(90,35,15,.55)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.beginPath(); ctx.ellipse(x - 16, y - 20, 11, 7, -0.6, 0, Math.PI * 2); ctx.fill();
  // key number, like a dope-sheet reference
  ctx.fillStyle = 'rgba(50,60,70,.55)'; ctx.font = '16px Consolas,monospace';
  ctx.fillText('KEY ' + (i + 1), 28, 44 + i * 0);
}

/* ---------------- timeline / layers ---------------- */
const TL = new TVPTimeline.Timeline({ endFrame: 60, fps: 24 });
const layers = TL.layers;                // same array: the timeline owns the layer list
let activeLayer = 2;
const LAYER_COLORS = ['#5b6170', '#7a6b58', '#4f6675', '#6a5a75'];

function seedScene() {
  layers.length = 0;
  const bg = new TVPTimeline.Layer({ name: 'Background', startFrame: 1, color: LAYER_COLORS[0],
    runs: [new TVPTimeline.Run('image', 60, makeImage(seedBackground))] });
  const anim = new TVPTimeline.Layer({ name: 'Ball animation', startFrame: 1, color: LAYER_COLORS[1] });
  anim.runs = [];
  for (let i = 0; i < 6; i++) anim.runs.push(new TVPTimeline.Run('image', 10, makeImage(ctx => seedBall(ctx, i, 6))));
  const paint = new TVPTimeline.Layer({ name: 'Paint', startFrame: 1, color: LAYER_COLORS[2],
    runs: [new TVPTimeline.Run('image', 60, makeImage(null))] });
  layers.push(bg, anim, paint);
  activeLayer = 2;
}
seedScene();

/* ---------------- camera ---------------- */
const camera = new TVPCamera({ cameraWidth: W, cameraHeight: H, startFrame: 1, endFrame: 60, viewWidth: W, viewHeight: H });
camera.track.setSceneRange(1, 60);

/* ---------------- viewport ---------------- */
const view = $('view'), vctx = view.getContext('2d');
let vw = 0, vh = 0, dpr = 1;

function resizeView() {
  const r = $('viewport').getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  vw = Math.max(1, Math.round(r.width)); vh = Math.max(1, Math.round(r.height));
  view.width = Math.round(vw * dpr); view.height = Math.round(vh * dpr);
  draw();
}
new ResizeObserver(resizeView).observe($('viewport'));

function layTransform() {
  const fit = Math.min(vw / W, vh / H) * 0.92 * state.zoom;
  const ox = vw / 2 - W * fit / 2 + state.panX;
  const oy = vh / 2 - H * fit / 2 + state.panY;
  return {
    fit, ox, oy,
    toWorld: (sx, sy) => ({ x: (sx - ox) / fit, y: (sy - oy) / fit }),
    toScreen: (x, y) => ({ x: x * fit + ox, y: y * fit + oy }),
  };
}

/* ---------------- compositing (canvas) ---------------- */
const BLEND_MAP = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', add: 'lighter',
  overlay: 'overlay', darken: 'darken', lighten: 'lighten', difference: 'difference',
};
function compositeLayers(ctx, frame) {
  for (const l of layers) {
    if (!l.visible) continue;
    const img = l.imageAt(frame);
    if (!img) continue;
    ctx.save();
    ctx.globalAlpha = clamp(l.opacity, 0, 1);
    ctx.globalCompositeOperation = BLEND_MAP[l.blend] || 'source-over';
    ctx.drawImage(img.canvas, 0, 0);
    ctx.restore();
  }
}

function draw() {
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vctx.clearRect(0, 0, vw, vh);
  if (state.mode === 'draw') drawDrawMode(); else drawCamMode();
  updateHud();
}
function drawDrawMode() {
  vctx.fillStyle = 'rgb(49,49,54)'; vctx.fillRect(0, 0, vw, vh);
  const T = layTransform();
  vctx.save();
  vctx.shadowColor = 'rgba(0,0,0,.55)'; vctx.shadowBlur = 18;
  vctx.fillStyle = PAPER; vctx.fillRect(T.ox, T.oy, W * T.fit, H * T.fit);
  vctx.restore();
  vctx.save();
  vctx.translate(T.ox, T.oy); vctx.scale(T.fit, T.fit);
  compositeLayers(vctx, state.currentFrame);
  vctx.restore();
  vctx.strokeStyle = 'rgba(0,0,0,.45)'; vctx.lineWidth = 1;
  vctx.strokeRect(T.ox + .5, T.oy + .5, W * T.fit - 1, H * T.fit - 1);
  const c = camera.corners(state.currentFrame);
  vctx.strokeStyle = 'rgba(120,200,120,.6)'; vctx.lineWidth = 1;
  vctx.beginPath();
  for (const [a, b] of [['tl','tr'],['tr','br'],['br','bl'],['bl','tl']]) {
    const p = T.toScreen(c[a].x, c[a].y), q = T.toScreen(c[b].x, c[b].y);
    vctx.moveTo(p.x, p.y); vctx.lineTo(q.x, q.y);
  }
  vctx.stroke();
  if (state.showCoords) {
    vctx.fillStyle = '#9ad'; vctx.font = '11px Consolas,monospace';
    vctx.fillText('paper ' + W + '×' + H + ' · view ' + T.fit.toFixed(3) + ' · frame ' + state.currentFrame, 8, vh - 8);
  }
}
function drawCamMode() {
  vctx.fillStyle = '#0b0c0f'; vctx.fillRect(0, 0, vw, vh);
  const s = cameraState();
  const fit = Math.min(vw / (s.width * s.zoom), vh / (s.height * s.zoom)) * 0.92;
  const r = -s.rotation * Math.PI / 180;
  const outW = s.width * s.zoom * fit, outH = s.height * s.zoom * fit;
  const ox = (vw - outW) / 2, oy = (vh - outH) / 2;
  vctx.save();
  vctx.beginPath(); vctx.rect(ox, oy, outW, outH); vctx.clip();
  vctx.translate(vw / 2, vh / 2); vctx.rotate(r); vctx.scale(fit, fit); vctx.translate(-s.cx, -s.cy);
  vctx.fillStyle = PAPER; vctx.fillRect(0, 0, W, H);
  compositeLayers(vctx, state.currentFrame);
  vctx.restore();
  const c = camera.corners(state.currentFrame);
  const proj = p => { const dx = p.x - s.cx, dy = p.y - s.cy;
    return { x: vw / 2 + (dx * Math.cos(r) - dy * Math.sin(r)) * fit, y: vh / 2 + (dx * Math.sin(r) + dy * Math.cos(r)) * fit }; };
  vctx.strokeStyle = 'rgb(80,220,120)'; vctx.lineWidth = 1.5; vctx.setLineDash([6, 4]);
  vctx.beginPath();
  const P = { tl: proj(c.tl), tr: proj(c.tr), br: proj(c.br), bl: proj(c.bl) };
  vctx.moveTo(P.tl.x, P.tl.y); vctx.lineTo(P.tr.x, P.tr.y); vctx.lineTo(P.br.x, P.br.y); vctx.lineTo(P.bl.x, P.bl.y); vctx.closePath(); vctx.stroke();
  vctx.setLineDash([]);
  vctx.fillStyle = 'rgb(80,220,120)'; vctx.font = '10px Consolas,monospace';
  for (const k of ['tl','tr','br','bl']) vctx.fillText(k.toUpperCase(), P[k].x + 3, P[k].y + 11);
  if (camera.track.path.length) {
    vctx.strokeStyle = 'rgb(129,170,201)'; vctx.lineWidth = 1; vctx.beginPath();
    camera.track.path.forEach((p, i) => { const q = proj(p); i ? vctx.lineTo(q.x, q.y) : vctx.moveTo(q.x, q.y); });
    vctx.stroke();
    for (const p of camera.track.path) {
      const q = proj(p);
      vctx.fillStyle = 'rgb(129,170,201)'; vctx.beginPath(); vctx.arc(q.x, q.y, 3, 0, Math.PI * 2); vctx.fill();
    }
  }
}
function cameraState() { return camera.atFrame(state.currentFrame); }
function updateHud() {
  const hud = $('camhud');
  if (state.mode !== 'cam') { hud.style.display = 'none'; return; }
  hud.style.display = 'block';
  const s = cameraState();
  hud.textContent = 'CAMERA  frame ' + state.currentFrame
    + '\nsize ' + Math.round(s.width) + ' × ' + Math.round(s.height)
    + '   rot ' + s.rotation.toFixed(2) + '°   zoom ' + (s.zoom * 100).toFixed(0) + '%'
    + '\ncenter (' + s.cx.toFixed(1) + ', ' + s.cy.toFixed(1) + ')'
    + '\ninfoFrame: ' + camera.infoFrame(state.currentFrame);
}

/* ---------------- brush engine: pressure dabs along the stroke ---------------- */
const pressureCurve = new TVPCurve.EaseCurve();
function pressure01(e) {
  if (e.pointerType !== 'pen') return 1;
  return clamp(typeof e.pressure === 'number' ? e.pressure : 0.5, 0.02, 1);
}
function widthFor(st, p) {
  if (!st.pressureOn) return st.size;
  return Math.max(0.6, st.size * Math.max(0.10, st.curve.at(clamp(p, 0, 1))));
}
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function stampDab(ctx, st, x, y, p) {
  const r = Math.max(0.5, widthFor(st, p) / 2);
  const alpha = st.opacity * (0.30 + 0.70 * clamp(p, 0, 1));
  ctx.save();
  ctx.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  const solid = st.tool === 'eraser' ? 'rgba(0,0,0,1)' : hexToRgba(st.color, 1);
  const soft = st.tool === 'eraser' ? 'rgba(0,0,0,.85)' : hexToRgba(st.color, .85);
  g.addColorStop(0, solid); g.addColorStop(0.62, soft); g.addColorStop(1, st.tool === 'eraser' ? 'rgba(0,0,0,0)' : hexToRgba(st.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function stampStart(ctx, st, pt) {
  st._carry = Math.max(0.7, widthFor(st, pt.p) * 0.12);
  stampDab(ctx, st, pt.x, pt.y, pt.p);
}
function stampSegment(ctx, st, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  let distToNext = st._carry || 0;
  let travelled = 0;
  let guard = 0;
  while (travelled + distToNext <= len && guard++ < 20000) {
    travelled += distToNext;
    const t = travelled / len;
    const p = a.p + (b.p - a.p) * t;
    stampDab(ctx, st, a.x + dx * t, a.y + dy * t, p);
    distToNext = Math.max(0.7, widthFor(st, p) * 0.12);
  }
  st._carry = Math.max(0, distToNext - (len - travelled));
}
function replayStroke(img, st) {
  const ctx = img.ctx;
  if (!st.points.length) return;
  const copy = { tool: st.tool, color: st.color, opacity: st.opacity, size: st.size,
    pressureOn: st.pressureOn, curve: st.curve };
  stampStart(ctx, copy, st.points[0]);
  for (let i = 1; i < st.points.length; i++) stampSegment(ctx, copy, st.points[i - 1], st.points[i]);
}

/* ---------------- input ---------------- */
let stroke = null, activeImage = null, panning = null;
let livePressure = 0;
function pointerWorld(e) {
  const r = view.getBoundingClientRect();
  return layTransform().toWorld(e.clientX - r.left, e.clientY - r.top);
}
function updatePressureUI(e) {
  if (!e) return;
  const p = pressure01(e);
  livePressure = p;
  $('press').firstElementChild.style.width = (p * 100) + '%';
  $('pressv').textContent = (e.pointerType === 'pen' ? 'pen ' : 'mouse ') + p.toFixed(2) +
    ' → ' + widthFor({ size: state.size, pressureOn: state.pressure, curve: pressureCurve }, p).toFixed(1) + 'px';
}

view.addEventListener('pointerdown', e => {
  try { view.setPointerCapture(e.pointerId); } catch (err) {}
  updatePressureUI(e);
  if (state.tool === 'picker') { pickColor(e); return; }
  if (state.tool === 'pan') { panning = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY }; return; }
  if (state.tool === 'zoom') { state.zoom = clamp(state.zoom * 1.25, 0.15, 8); draw(); return; }
  if (state.mode !== 'draw') { toast('Switch to Draw view to paint (View ▸ Draw view)'); return; }
  const L = layers[activeLayer];
  if (!L) return;
  if (L.locked) { toast(L.name + ' is locked'); return; }
  if (state.currentFrame < 1) return;
  const res = L.ensureDrawable(state.currentFrame, {
    makeImage: () => makeImage(null), cloneImage,
    autoCreate: L.autoCreate, autoBreak: L.autoBreak,
  });
  if (!res.image) {
    toast('No image at frame ' + state.currentFrame + ' — enable Auto create instance or add exposure');
    return;
  }
  activeImage = res.image;
  const p = pointerWorld(e);
  stroke = {
    tool: state.tool, color: state.color, opacity: state.opacity, size: state.size,
    pressureOn: state.pressure, curve: pressureCurve,
    points: [{ x: p.x, y: p.y, p: pressure01(e) }],
  };
  activeImage.strokes.push(stroke);
  stampStart(activeImage.ctx, stroke, stroke.points[0]);
  draw();
  if (res.created || res.broke) {
    buildTimeline(); renderLayers();
    toast(res.created ? 'New instance created at frame ' + state.currentFrame
      : 'Held exposure split — new key at frame ' + state.currentFrame);
  }
});
view.addEventListener('pointermove', e => {
  updatePressureUI(e);
  if (panning) { state.panX = panning.px + (e.clientX - panning.x); state.panY = panning.py + (e.clientY - panning.y); draw(); return; }
  if (!stroke || !activeImage) return;
  const p = pointerWorld(e);
  const last = stroke.points[stroke.points.length - 1];
  const s = clamp(state.smoothing, 0, .9);
  const np = { x: last.x * s + p.x * (1 - s), y: last.y * s + p.y * (1 - s), p: pressure01(e) };
  stroke.points.push(np);
  stampSegment(activeImage.ctx, stroke, last, np);
  draw();
});
function endStroke() {
  if (!stroke) { panning = null; return; }
  const li = layers.indexOf(layers[activeLayer]);
  const img = activeImage;
  stroke = null; activeImage = null; panning = null;
  pushAction({ kind: 'stroke', li, image: img });
  updateTimelineUI();
}
view.addEventListener('pointerup', endStroke);
view.addEventListener('pointercancel', endStroke);
function pickColor(e) {
  const r = view.getBoundingClientRect();
  const d = vctx.getImageData(Math.round((e.clientX - r.left) * dpr), Math.round((e.clientY - r.top) * dpr), 1, 1).data;
  setColor('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
  toast('Picked color ' + state.color);
}

/* ---------------- undo / redo ---------------- */
const undoStack = [], redoStack = [];
function pushAction(a) { undoStack.push(a); redoStack.length = 0; }
function undo() {
  const a = undoStack.pop(); if (!a) return toast('Nothing to undo');
  if (a.kind === 'stroke' && a.image && a.image.strokes.length) {
    a.stroke = a.image.strokes.pop(); redrawImage(a.image);
  }
  if (a.kind === 'clear' && a.image) {
    a.cleared = a.image.strokes.slice();
    a.image.strokes = a.prev.slice();
    if (a.run) { a.run.kind = 'image'; a.run.image = a.image; }
    redrawImage(a.image);
  }
  redoStack.push(a); draw(); updateTimelineUI();
}
function redo() {
  const a = redoStack.pop(); if (!a) return toast('Nothing to redo');
  if (a.kind === 'stroke' && a.stroke) { a.image.strokes.push(a.stroke); redrawImage(a.image); }
  if (a.kind === 'clear' && a.image) { a.image.strokes = []; if (a.run) { a.run.kind = 'empty'; a.run.image = null; } redrawImage(a.image); }
  undoStack.push(a); draw(); updateTimelineUI();
}

/* ---------------- palette ---------------- */
const PALETTE = ['#000000','#3a3a3a','#6b6b6b','#9a9a9a','#ffffff','#7a3b2e','#c25b3a','#e08a4a','#f4c454','#f6e7a9',
  '#264653','#2a9d8f','#57cc99','#a8d5ba','#d8f0e3','#1d3557','#457b9d','#8ecae6','#bde0fe','#e8f4ff',
  '#6a4c93','#9b5de5','#c77dff','#e0aaff','#f1e4ff','#7f5539','#b08968','#ddb892','#ede0d4','#5c677d'];
function buildPalette() {
  const pal = $('pal');
  pal.innerHTML = '';
  for (const c of PALETTE) {
    const d = document.createElement('div');
    d.style.background = c; d.dataset.color = c; d.title = c;
    d.onclick = () => setColor(c);
    pal.appendChild(d);
  }
  setColor(state.color);
}
function setColor(c) {
  state.color = c;
  $('swatch').style.background = c;
  $$('#pal div').forEach(d => d.classList.toggle('cur', d.dataset.color === c));
}

/* ---------------- layers panel ---------------- */
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderLayers() {
  const list = $('layerlist');
  list.innerHTML = '';
  layers.forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'lrow' + (i === activeLayer ? ' cur' : '');
    row.innerHTML = '<span class="eye">' + (l.visible ? '👁' : '·') + '</span><span class="nm">' + esc(l.name) +
      '</span><span class="ex">' + l.instanceCount + ' keys</span>';
    row.onclick = () => { activeLayer = i; renderLayers(); renderLayerSettings(); buildTimeline(); draw(); };
    row.querySelector('.eye').onclick = ev => { ev.stopPropagation(); l.visible = !l.visible; renderLayers(); draw(); };
    list.appendChild(row);
  });
  $('slayer').textContent = layers[activeLayer] ? layers[activeLayer].name : '—';
}
let syncingLayerUI = false;
function renderLayerSettings() {
  const L = layers[activeLayer]; if (!L) return;
  syncingLayerUI = true;
  $('layop').value = Math.round(clamp(L.opacity, 0, 1) * 100);
  $('layopv').textContent = $('layop').value;
  $('layblend').value = L.blend in BLEND_MAP ? L.blend : 'normal';
  $('laypre').value = L.preBehavior;
  $('laypost').value = L.postBehavior;
  $('layautocreate').checked = !!L.autoCreate;
  $('layautobreak').checked = !!L.autoBreak;
  syncingLayerUI = false;
}
$('layop').oninput = () => {
  if (syncingLayerUI) return;
  const L = layers[activeLayer]; L.opacity = +$('layop').value / 100;
  $('layopv').textContent = $('layop').value; draw();
};
$('layblend').onchange = () => { const L = layers[activeLayer]; L.blend = $('layblend').value; draw(); };
$('laypre').onchange = () => { const L = layers[activeLayer]; L.preBehavior = $('laypre').value; draw(); updateTimelineUI(); };
$('laypost').onchange = () => { const L = layers[activeLayer]; L.postBehavior = $('laypost').value; draw(); updateTimelineUI(); };
$('layautocreate').onchange = () => { layers[activeLayer].autoCreate = $('layautocreate').checked; toast('Auto create instance ' + ($('layautocreate').checked ? 'on' : 'off')); };
$('layautobreak').onchange = () => { layers[activeLayer].autoBreak = $('layautobreak').checked; toast('Auto break instance ' + ($('layautobreak').checked ? 'on' : 'off')); };

/* ---------------- timeline widget ---------------- */
const PX = 10;
function tlFrameFromX(x) { return clamp(Math.floor(x / PX) + 1, 1, 999); }

function buildTimeline() {
  const labels = $('tllabels'), rows = $('tlrows'), ruler = $('ruler');
  labels.innerHTML = '<div class="tllabel head">Timeline</div><div class="tllabel cam">Camera</div>';
  rows.innerHTML = '<div class="tlrow cam" data-row="cam"></div>';
  ruler.innerHTML = '';
  const end = Math.max(state.endFrame, TL.contentEnd);
  for (let f = 1; f <= end; f++) {
    if (f % 5 === 0) {
      const t = document.createElement('i'); t.className = 'tick'; t.style.left = ((f - 1) * PX) + 'px';
      ruler.appendChild(t);
      const l = document.createElement('span'); l.className = 'lab'; l.textContent = f;
      l.style.left = ((f - 1) * PX) + 'px'; ruler.appendChild(l);
    }
  }
  layers.forEach((l, li) => {
    labels.insertAdjacentHTML('beforeend', '<div class="tllabel">' + esc(l.name) + '</div>');
    const row = document.createElement('div'); row.className = 'tlrow'; row.dataset.layer = li;
    for (const seg of l.segments()) {
      if (seg.kind === 'empty') continue;             // traced: empty exposure prints nothing
      const d = document.createElement('div');
      d.className = 'exp img key' + (li === activeLayer ? '' : '');
      d.style.left = ((seg.start - 1) * PX) + 'px';
      d.style.width = (seg.count * PX) + 'px';
      d.style.background = l.color || '';
      d.title = l.name + ' · key @' + seg.start + ' · exposure ' + seg.count;
      if (seg.count * PX >= 18) {
        d.innerHTML = '<i class="k"></i><span class="ec">' + seg.count + '</span>';
      } else {
        d.innerHTML = '<i class="k"></i>';
      }
      d.onclick = ev => {
        ev.stopPropagation();
        activeLayer = li; renderLayers(); renderLayerSettings();
        setFrame(seg.start);
      };
      row.appendChild(d);
    }
    rows.appendChild(row);
  });
  labels.insertAdjacentHTML('beforeend', '<div class="tllabel audio">Audio · Master</div>');
  const audioRow = document.createElement('div'); audioRow.className = 'tlrow';
  audioRow.innerHTML = '<div class="exp img" style="left:0;width:' + (end * PX) + 'px;opacity:.25"></div>';
  rows.appendChild(audioRow);
  labels.insertAdjacentHTML('beforeend', '<div class="tllabel notes">Notes</div>');
  const notesRow = document.createElement('div'); notesRow.className = 'tlrow';
  notesRow.innerHTML = '<div style="position:absolute;left:6px;top:3px;color:#8c8c94;font-size:10px">' +
    (TL.notes.text || 'timeline notes (cTimelineNotes)') + '</div>';
  rows.appendChild(notesRow);
  const camRow = rows.querySelector('[data-row=cam]');
  for (const k of camera.track.keys) {
    const d = document.createElement('div'); d.className = 'keymark';
    d.style.left = ((k.frame - 1) * PX) + 'px';
    d.title = 'camera key @' + k.frame + ' ' + JSON.stringify(k.has);
    camRow.appendChild(d);
  }
  for (const p of camera.track.path) {
    const d = document.createElement('div'); d.className = 'pathmark';
    d.style.left = ((p.frame - 1) * PX + 3) + 'px';
    d.title = 'camera path point @' + p.frame + ' (' + Math.round(p.x) + ',' + Math.round(p.y) + ')';
    camRow.appendChild(d);
  }
  $('tlcanvas').style.width = Math.max(vw - 150, end * PX + 40) + 'px';
  updateTimelineUI();
}

function updateTimelineUI() {
  const end = Math.max(state.endFrame, TL.contentEnd);
  $('ph').style.left = ((state.currentFrame - 1) * PX) + 'px';
  $('fnum').textContent = state.currentFrame;
  $('sframe').textContent = state.currentFrame;
  $('send').textContent = end;
  $$('#tlrows .tlrow').forEach(row => {
    if (row.dataset.layer === undefined) return;
    const li = +row.dataset.layer, L = layers[li];
    const cur = L && L.sample(state.currentFrame) && L.sample(state.currentFrame).kind === 'image';
    row.classList.toggle('cur', !!cur);
    row.querySelectorAll('.exp').forEach(d => d.classList.toggle('cur', !!cur && li === activeLayer));
  });
  const L = layers[activeLayer];
  if (L) {
    const s = L.sampleInside(state.currentFrame);
    if (!s) $('keyinfo').textContent = 'frame ' + state.currentFrame + ' · outside ' + L.name;
    else if (s.kind === 'empty') $('keyinfo').textContent = 'frame ' + state.currentFrame + ' · empty exposure';
    else {
      const keys = L.segments().filter(x => x.kind === 'image');
      const idx = keys.findIndex(x => state.currentFrame >= x.start && state.currentFrame <= x.end);
      $('keyinfo').textContent = 'key ' + (idx + 1) + '/' + keys.length + ' · exposure ' + s.run.count +
        ' · frames ' + keys[idx].start + '–' + keys[idx].end;
    }
  }
  const totalKeys = layers.reduce((n, l) => n + l.instanceCount, 0);
  $('tlinfo').textContent = 'frame ' + state.currentFrame + ' · ' + layers.length + ' layers · ' +
    totalKeys + ' keys · camera ' + (camera.track.keys.length + camera.track.path.length) + ' pts';
  $('caminfo').textContent = 'infoFrame: ' + camera.infoFrame(state.currentFrame);
  $('scam').textContent = camera.track.keys.length || camera.track.path.length ? 'animated' : 'off';
}
function setFrame(f) {
  state.currentFrame = clamp(Math.round(f), 1, Math.max(state.endFrame, TL.contentEnd));
  updateTimelineUI(); draw();
}
$('tlcanvas').addEventListener('pointerdown', e => {
  const r = $('tlcanvas').getBoundingClientRect();
  setFrame(tlFrameFromX(e.clientX - r.left));
});

/* ---------------- instance / exposure actions (traced commands) ---------------- */
function requireLayer() { const L = layers[activeLayer]; if (!L) { toast('No active layer'); return null; } return L; }
function afterTimelineChange() { buildTimeline(); renderLayers(); renderLayerSettings(); draw(); }

function actionAddExposure(n) {
  const L = requireLayer(); if (!L) return;
  if (!L.addExposure(state.currentFrame, n == null ? 1 : n)) return toast('Cannot add exposure here');
  afterTimelineChange();
  toast('Exposure +' + (n == null ? 1 : n) + ' on ' + L.name + ' at frame ' + state.currentFrame);
}
function actionBreak() {
  const L = requireLayer(); if (!L) return;
  if (!L.breakInstance(state.currentFrame, cloneImage)) return toast('Frame ' + state.currentFrame + ' already starts a key');
  afterTimelineChange();
  toast('Broke the hold — new key at frame ' + state.currentFrame);
}
function actionNewKey() {
  const L = requireLayer(); if (!L) return;
  const img = L.newInstance(state.currentFrame, makeImage(null), cloneImage);
  if (!img) return toast('Cannot create an instance here');
  afterTimelineChange();
  toast('New instance (key) at frame ' + state.currentFrame);
}
function actionClearImage() {
  const L = requireLayer(); if (!L) return;
  const s = L.sampleInside(state.currentFrame);
  if (!s || s.kind !== 'image') return toast('No image at frame ' + state.currentFrame);
  const img = s.run.image;
  pushAction({ kind: 'clear', image: img, run: s.run, prev: img.strokes.slice() });
  L.clearImage(state.currentFrame);
  afterTimelineChange();
  toast('Cleared image at frame ' + state.currentFrame + ' (empty exposure)');
}
function actionSetExposure(n) {
  const L = requireLayer(); if (!L) return;
  if (!L.setExposure(state.currentFrame, n)) return toast('No exposure at this frame');
  afterTimelineChange();
  toast('Exposure set to ' + Math.max(1, n) + ' at frame ' + state.currentFrame);
}
function actionPrevInstance() { const L = requireLayer(); if (!L) return; setFrame(L.prevInstance(state.currentFrame)); }
function actionNextInstance() { const L = requireLayer(); if (!L) return; setFrame(L.nextInstance(state.currentFrame)); }
function actionPrevKey() { const L = requireLayer(); if (!L) return; setFrame(L.prevKey(state.currentFrame)); }
function actionNextKey() { const L = requireLayer(); if (!L) return; setFrame(L.nextKey(state.currentFrame)); }

/* ---------------- camera actions ---------------- */
function camAction(kind) {
  const f = state.currentFrame;
  if (kind === 'size') camera.addSizeKey(f, Math.round(W * (0.78 + Math.random() * 0.32)), Math.round(H * (0.78 + Math.random() * 0.32)));
  if (kind === 'rot') camera.addRotationKey(f, +(Math.random() * 24 - 12).toFixed(1));
  if (kind === 'zoom') camera.addZoomKey(f, +(0.75 + Math.random() * 0.85).toFixed(2));
  if (kind === 'path') camera.addPathPoint(f, Math.round(W / 2 + (Math.random() - .5) * 360), Math.round(H / 2 + (Math.random() - .5) * 240));
  if (kind === 'del') { camera.removeKey(f); camera.removePathPoint(f); }
  buildTimeline(); updateTimelineUI(); draw();
  toast('Camera ' + kind + ' key at frame ' + f);
}

/* ---------------- shortcuts ---------------- */
const DEFAULT_KM_TEXT = (typeof TVPDefaultKeymap === 'string') ? TVPDefaultKeymap : String(TVPDefaultKeymap);
let keymap = TVPShortcuts.parseKeymap(DEFAULT_KM_TEXT);
let kmSelected = -1, kmCapturing = false;

const ACTION_ALIASES = {
  Undo: 'undo', UndoProject: 'undo', MultiRedo: 'redo',
  ToolEraser: 'tool-eraser', ShapeFreeHandLine: 'tool-brush', PicColor: 'tool-picker',
  Pan: 'tool-pan', ShapeZoomHand: 'tool-zoom',
  ConfigureKeyboard: 'kms',
  TogglePalettePanel: 'togglepalette', ToggleToolPanel: 'toggletools', LayerPanelToggle: 'togglelayers',
  IncreaseToolsSize: 'sizeinc', IncreaseToolsSize2: 'sizeinc', DecreaseToolsSize: 'sizedec', DecreaseToolsSize2: 'sizedec',
  ZoomIn: 'zoomin', ZoomOut: 'zoomout', ZoomOneOne: 'zoom100', ZoomCenter: 'zoomfit', ShowPage: 'zoomfit',
  LayerUp: 'layerup', LayerDown: 'layerdown', LayerUpSelection: 'layerup', LayerDownSelection: 'layerdown',
  LayerLeft: 'prevframe', LayerRight: 'nextframe', LayerLeftSelection: 'prevframe', LayerRightSelection: 'nextframe',
  LayerFirstImage: 'firstframe', LayerLastImage: 'lastframe',
  PrevInstance: 'previnst', NextInstance: 'nextinst',
  LayerPrevKey: 'prevkey', LayerNextKey: 'nextkey',
  Clear: 'clear', Backspace: 'clear',
  SaveProject: 'save', SaveAsProject: 'save', NewProject: 'new',
  FullScreen: 'fullscreen', DisplayAllLayer: 'allvisible', ToggleCoordinates: 'coords',
  Space: 'tool-zoom', Escape: 'stop', Tab: 'nextframe', 'Shift Tab': 'prevframe',
};

function eventCombo(e) {
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key === 'ArrowUp') key = 'Up'; else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left'; else if (key === 'ArrowRight') key = 'Right';
  else if (key === 'PageUp') key = 'Page Up'; else if (key === 'PageDown') key = 'Page Down';
  else if (key === 'Delete') key = 'Del'; else if (key === 'Backspace') key = 'Backspace';
  else if (key === 'Escape') key = 'Escape'; else if (key === 'Enter') key = 'Enter';
  else if (key === 'Home') key = 'Home'; else if (key === 'End') key = 'End'; else if (key === 'Insert') key = 'Insert';
  else if (key === 'Tab') key = 'Tab';
  else if (key.length === 1) key = key.toUpperCase();
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join(' ');
}
function findAction(combo) {
  const target = TVPShortcuts.comboText(TVPShortcuts.parseCombo(combo));
  const b = keymap.bindings.find(x => TVPShortcuts.comboText(x.chord) === target);
  return b && b.action !== 'none' ? b.action : null;
}
document.addEventListener('keydown', e => {
  if ($('modalback').classList.contains('open')) {
    if (kmCapturing) { captureRebind(e); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeKms(); }
    return;
  }
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  const combo = eventCombo(e);
  let action = findAction(combo);
  if (!action && /^[^A-Za-z0-9 ]$/.test(e.key) && e.shiftKey) action = findAction(eventCombo({ ...e, shiftKey: false }));
  if (!action) return;
  e.preventDefault();
  dispatch(action, combo);
});
function dispatch(action, combo) {
  const cmd = ACTION_ALIASES[action];
  if (cmd) { run(cmd); return; }
  switch (action) {
    case 'Print': toast('Print — not implemented'); return;
    case 'Quit': toast('Quit — close the tab to exit'); return;
    case 'SearchEngine': toast('Search — not implemented'); return;
    case 'LoadProject': toast('Load project — not implemented'); return;
    case 'Copy': case 'CutStayPut': case 'Paste':
      toast(action + ' — clipboard layer ops not implemented'); return;
    case 'SelectionClear': toast('Selection tools not implemented'); return;
    case 'LayerPickLayer': toast('Pick layer — click a layer in the Layers panel'); return;
    default: toast('Shortcut ' + combo + ' → ' + action + ' (not implemented in this build)');
  }
}

/* ---------------- commands ---------------- */
function run(cmd) {
  switch (cmd) {
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'clear': actionClearImage(); break;
    case 'new': seedScene(); state.currentFrame = 1; resetCamera(); buildTimeline(); renderLayers(); renderLayerSettings(); draw(); toast('New scene'); break;
    case 'save': saveProject(); break;
    case 'exportkm': exportKeymap(); break;
    case 'layeradd': {
      const name = 'Layer ' + (layers.length + 1);
      const L = new TVPTimeline.Layer({ name, startFrame: state.currentFrame, color: LAYER_COLORS[layers.length % LAYER_COLORS.length],
        runs: [new TVPTimeline.Run('image', Math.max(1, state.endFrame - state.currentFrame + 1), makeImage(null))] });
      layers.push(L); TL.layers = layers;
      activeLayer = layers.length - 1; renderLayers(); renderLayerSettings(); buildTimeline(); draw(); break;
    }
    case 'layerdel': {
      if (layers.length <= 1) { toast('Need at least one layer'); break; }
      layers.splice(activeLayer, 1); activeLayer = clamp(activeLayer, 0, layers.length - 1);
      renderLayers(); renderLayerSettings(); buildTimeline(); draw(); break;
    }
    case 'layervis': layers[activeLayer].visible = !layers[activeLayer].visible; renderLayers(); draw(); break;
    case 'layerup': activeLayer = clamp(activeLayer + 1, 0, layers.length - 1); renderLayers(); renderLayerSettings(); buildTimeline(); draw(); break;
    case 'layerdown': activeLayer = clamp(activeLayer - 1, 0, layers.length - 1); renderLayers(); renderLayerSettings(); buildTimeline(); draw(); break;
    case 'layerexp': actionAddExposure(1); break;
    case 'addexp': actionAddExposure(1); break;
    case 'breakexp': actionBreak(); break;
    case 'newkey': actionNewKey(); break;
    case 'clearexp': actionClearImage(); break;
    case 'setexp1': actionSetExposure(1); break;
    case 'play': togglePlay(); break;
    case 'stop': state.playing = false; updatePlayBtn(); break;
    case 'prevframe': setFrame(state.currentFrame - 1); break;
    case 'nextframe': setFrame(state.currentFrame + 1); break;
    case 'firstframe': setFrame(1); break;
    case 'lastframe': setFrame(Math.max(state.endFrame, TL.contentEnd)); break;
    case 'previnst': actionPrevInstance(); break;
    case 'nextinst': actionNextInstance(); break;
    case 'prevkey': actionPrevKey(); break;
    case 'nextkey': actionNextKey(); break;
    case 'mode-draw': setMode('draw'); break;
    case 'mode-cam': setMode('cam'); break;
    case 'kms': openKms(); break;
    case 'togglepalette': togglePanel('panelPalette'); break;
    case 'togglelayers': togglePanel('panelLayers'); break;
    case 'toggletools': $('tools').style.display = $('tools').style.display === 'none' ? '' : 'none'; resizeView(); break;
    case 'camsize': camAction('size'); break;
    case 'camrot': camAction('rot'); break;
    case 'camzoom': camAction('zoom'); break;
    case 'campath': camAction('path'); break;
    case 'camdel': camAction('del'); break;
    case 'tool-brush': setTool('brush'); break;
    case 'tool-eraser': setTool('eraser'); break;
    case 'tool-picker': setTool('picker'); break;
    case 'tool-pan': setTool('pan'); break;
    case 'tool-zoom': setTool('zoom'); break;
    case 'sizeinc': state.size = clamp(state.size + 2, 1, 120); $('size').value = state.size; $('sizev').textContent = state.size; break;
    case 'sizedec': state.size = clamp(state.size - 2, 1, 120); $('size').value = state.size; $('sizev').textContent = state.size; break;
    case 'zoomin': state.zoom = clamp(state.zoom * 1.2, .15, 8); draw(); break;
    case 'zoomout': state.zoom = clamp(state.zoom / 1.2, .15, 8); draw(); break;
    case 'zoom100': state.zoom = 1; state.panX = state.panY = 0; draw(); break;
    case 'zoomfit': state.zoom = 1; state.panX = state.panY = 0; draw(); break;
    case 'coords': state.showCoords = !state.showCoords; draw(); break;
    case 'allvisible': { const any = layers.every(l => l.visible); layers.forEach(l => l.visible = !any); renderLayers(); draw(); break; }
    case 'fullscreen': if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => toast('Fullscreen blocked')); else document.exitFullscreen(); break;
    case 'about': toast('my-version — clean-room TVPaint 12 RE: instance/exposure timeline, per-key canvases, layer behaviours, pressure dabs, camera v2, exact keymap. See SPEC.md.'); break;
    default: toast('Command ' + cmd + ' not implemented');
  }
  updateStatus();
}

function resetCamera() {
  camera.track.keys = []; camera.track.path = [];
  buildTimeline(); draw();
}

/* ---------------- playback ---------------- */
let lastT = 0, acc = 0;
function togglePlay() { state.playing = !state.playing; updatePlayBtn(); }
function updatePlayBtn() { $('playbtn').textContent = state.playing ? '⏸' : '▶'; $('playbtn').classList.toggle('on', state.playing); }
function loop(t) {
  if (state.playing) {
    if (!lastT) lastT = t;
    acc += (t - lastT) / 1000; lastT = t;
    const step = 1 / state.fps;
    while (acc >= step) {
      acc -= step;
      state.currentFrame = state.currentFrame >= state.endFrame ? 1 : state.currentFrame + 1;
      updateTimelineUI(); draw();
    }
  } else { lastT = 0; acc = 0; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------------- mode / tools / options ---------------- */
function setMode(m) {
  state.mode = m;
  $$('.modebtn').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('shint').textContent = m === 'cam'
    ? 'Camera view — scrub the timeline; camera keys ease per the traced curves'
    : 'Draw view — each key is its own canvas · auto create/break split exposures as you draw';
  draw(); updateStatus();
}
function setTool(t) {
  state.tool = t;
  $$('#tools button[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  const names = { brush: 'Brush', eraser: 'Eraser', picker: 'Color picker', pan: 'Pan', zoom: 'Zoom' };
  $('toolname').textContent = names[t];
  $('stool').textContent = names[t];
}
$$('#tools button[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$$('.modebtn').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('size').oninput = () => { state.size = +$('size').value; $('sizev').textContent = state.size; };
$('smooth').oninput = () => { state.smoothing = +$('smooth').value / 100; };
$('btnpress').onclick = () => { state.pressure = !state.pressure; $('btnpress').classList.toggle('on', state.pressure); };
$('opacity').oninput = () => { state.opacity = +$('opacity').value / 100; $('opacityv').textContent = $('opacity').value; };
$('fit').onclick = () => run('zoomfit');
$('zoomin').onclick = () => run('zoomin');
$('zoomout').onclick = () => run('zoomout');
for (const f of ['pal', 'cam', 'layers']) {
  document.querySelector('[data-fold=' + f + ']').onclick = ev => {
    ev.stopPropagation();
    const body = $(f + 'body'); body.classList.toggle('collapsed');
    ev.target.textContent = body.classList.contains('collapsed') ? '+' : '−';
  };
}
$('panelPalette').querySelector('.ph').ondblclick = () => togglePanel('panelPalette');
$('panelCamera').querySelector('.ph').ondblclick = () => togglePanel('panelCamera');
$('panelLayers').querySelector('.ph').ondblclick = () => togglePanel('panelLayers');
function togglePanel(id) { const el = $(id); el.style.display = el.style.display === 'none' ? '' : 'none'; resizeView(); }

$$('.menu > button').forEach(b => b.onclick = ev => {
  ev.stopPropagation();
  const m = b.parentElement;
  const open = m.classList.contains('open');
  $$('.menu').forEach(x => x.classList.remove('open'));
  if (!open) m.classList.add('open');
});
document.addEventListener('click', ev => {
  $$('.menu').forEach(m => { if (!m.contains(ev.target)) m.classList.remove('open'); });
  const el = ev.target.closest('[data-cmd]');
  if (el && !el.closest('#kms')) { run(el.dataset.cmd); $$('.menu').forEach(x => x.classList.remove('open')); }
});

/* ---------------- shortcuts modal ---------------- */
function openKms() { $('modalback').classList.add('open'); renderKm(); $('kmsearch').focus(); }
function closeKms() { $('modalback').classList.remove('open'); kmCapturing = false; kmSelected = -1; }
$('kmsclose').onclick = closeKms;
$('modalback').addEventListener('pointerdown', e => { if (e.target === $('modalback')) closeKms(); });
$('kmsearch').oninput = renderKm;
$('kmreset').onclick = () => { keymap = TVPShortcuts.parseKeymap(DEFAULT_KM_TEXT); renderKm(); toast('Keymap reset to the captured TVPaint default'); };
$('kmexport').onclick = exportKeymap;

function renderKm() {
  const q = $('kmsearch').value.trim().toLowerCase();
  const rows = q ? TVPShortcuts.search(keymap.bindings, q) : keymap.bindings;
  const conflicts = TVPShortcuts.conflicts(keymap.bindings);
  let html = '<table>';
  rows.forEach(b => {
    const i = keymap.bindings.indexOf(b);
    const inUse = conflicts.some(g => g.includes(b));
    const cls = [i === kmSelected ? 'cur' : '', inUse ? 'use' : '', q ? 'found' : ''].join(' ').trim();
    html += '<tr data-i="' + i + '" class="' + cls + '"><td style="width:210px;font-family:Consolas,monospace">' + esc(b.comboText) +
      '</td><td>' + esc(b.action) + '</td><td style="width:70px;color:#888;text-align:right;font-size:10px">' +
      (inUse ? 'in use' : '') + '</td></tr>';
  });
  html += '</table>';
  $('kmlist').innerHTML = html;
  $$('#kmlist tr').forEach(tr => tr.onclick = () => {
    kmSelected = +tr.dataset.i; kmCapturing = true;
    $('kmmsg').textContent = 'Press a key combo to bind "' + keymap.bindings[kmSelected].action + '" (Esc cancels)';
    renderKm();
  });
  $('kmcount').textContent = keymap.bindings.length + ' bindings';
}
function captureRebind(e) {
  e.preventDefault();
  if (e.key === 'Escape') { kmCapturing = false; kmSelected = -1; $('kmmsg').textContent = 'Click a binding, then press a key combo to rebind it.'; renderKm(); return; }
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
  const combo = eventCombo(e);
  const b = keymap.bindings[kmSelected];
  if (!b) return;
  b.comboText = combo; b.chord = TVPShortcuts.parseCombo(combo);
  kmCapturing = false;
  $('kmmsg').textContent = 'Bound ' + b.action + ' → ' + combo;
  renderKm();
}
function exportKeymap() {
  const text = TVPShortcuts.serializeKeymap(keymap.bindings);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'Fauxtoshop.cfg';
  a.click();
  toast('Exported keymap (exact [Keyboard] format)');
}

/* ---------------- save project ---------------- */
function saveProject() {
  const data = {
    app: 'my-version (TVPaint 12 RE)',
    size: [W, H], currentFrame: state.currentFrame, endFrame: state.endFrame, fps: state.fps,
    layers: layers.map(l => ({
      name: l.name, visible: l.visible, startFrame: l.startFrame, opacity: l.opacity, blend: l.blend,
      preBehavior: l.preBehavior, postBehavior: l.postBehavior, autoCreate: l.autoCreate, autoBreak: l.autoBreak,
      runs: l.runs.map(r => ({ kind: r.kind, count: r.count,
        strokes: r.kind === 'image' && r.image ? r.image.strokes.map(s => ({
          tool: s.tool, color: s.color, opacity: s.opacity, size: s.size, pressureOn: s.pressureOn,
          points: s.points.map(p => [Math.round(p.x), Math.round(p.y), +p.p.toFixed(3)]) })) : [] })),
    })),
    camera: { keys: camera.track.keys.map(k => ({ frame: k.frame, width: k.width, height: k.height, rotation: k.rotation, zoom: k.zoom, has: k.has })),
      path: camera.track.path, range: [camera.track.startFrame, camera.track.endFrame] },
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'my-version-project.json';
  a.click();
  toast('Project saved as JSON (instances + exposures + strokes + camera)');
}

/* ---------------- toasts / status / boot ---------------- */
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function updateStatus() {
  $('stool').textContent = $('toolname').textContent;
  $('slayer').textContent = layers[activeLayer] ? layers[activeLayer].name : '—';
  $('scam').textContent = (state.mode === 'cam' ? 'preview' : (camera.track.keys.length || camera.track.path.length ? 'animated' : 'off'));
}

buildPalette();
renderLayers();
renderLayerSettings();
buildTimeline();
resizeView();
updateStatus();
$('pressv').textContent = 'pen: waiting for pointer…';
