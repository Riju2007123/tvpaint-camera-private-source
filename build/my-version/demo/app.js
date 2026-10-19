/* app.js — TVPaint-style animation app shell for my-version.
 * All behavior is our own implementation from the REA-traced SPEC:
 *  - camera: size keys + camera path + rotation/zoom, corners TL/TR/BR/BL, infoFrame order
 *  - canvas: layer compositing, pressure ink (browser Pointer API), undo/redo
 *  - timeline: per-layer exposures, camera key row, audio master row, notes row, playhead
 *  - shortcuts: exact captured keymap format, live dispatcher + ConfigureKeyboard modal
 */
'use strict';
const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const W = 1600, H = 900;                 // world / paper size

/* ---------------- persistent state ---------------- */
const state = {
  currentFrame: 1, endFrame: 60, fps: 24, playing: false,
  mode: 'draw', zoom: 1, panX: 0, panY: 0,
  tool: 'brush', size: 18, smoothing: 0.35, pressure: true,
  color: '#2f6f9f', opacity: 1,
  showCoords: false,
};

/* ---------------- canvas surfaces ---------------- */
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

/* ---------------- layers ---------------- */
function makeLayer(name, opts) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const layer = {
    name, canvas, ctx: canvas.getContext('2d'),
    visible: true, strokes: [], seed: (opts && opts.seed) || null,
    exposures: (opts && opts.exposures) || [{ s: 1, e: 60 }],
  };
  return layer;
}
const layers = [];
let activeLayer = 0;

/* seed art (our own drawing code; not copied) */
function seedBackground(ctx) {
  // paper wash
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#dce9f2'); g.addColorStop(0.55, '#eef2ea'); g.addColorStop(1, '#e7e2cf');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // distant hills
  ctx.fillStyle = '#b9cdb9'; ctx.beginPath(); ctx.moveTo(0, 620);
  ctx.bezierCurveTo(240, 470, 420, 560, 640, 520); ctx.bezierCurveTo(900, 470, 1100, 560, 1600, 500);
  ctx.lineTo(1600, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a4bf9f'; ctx.beginPath(); ctx.moveTo(0, 700);
  ctx.bezierCurveTo(300, 590, 560, 660, 820, 620); ctx.bezierCurveTo(1120, 575, 1320, 650, 1600, 610);
  ctx.lineTo(1600, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  // ground line + path
  ctx.strokeStyle = 'rgba(90,110,80,.35)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 760); ctx.bezierCurveTo(500, 730, 1000, 790, 1600, 745); ctx.stroke();
}
function seedArt(ctx) {
  // sun
  ctx.fillStyle = 'rgba(244,196,84,.9)'; ctx.beginPath(); ctx.arc(1180, 250, 90, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(220,160,60,.5)'; ctx.lineWidth = 4;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    ctx.beginPath(); ctx.moveTo(1180 + Math.cos(a) * 108, 250 + Math.sin(a) * 108);
    ctx.lineTo(1180 + Math.cos(a) * 132, 250 + Math.sin(a) * 132); ctx.stroke();
  }
  // brushy clouds
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  for (const [cx, cy, s] of [[330, 260, 1], [540, 320, .7], [980, 190, .6]]) {
    ctx.beginPath(); ctx.ellipse(cx, cy, 130 * s, 44 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 70 * s, cy - 22 * s, 90 * s, 38 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
  // painterly figure
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#36546a'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(720, 560); ctx.lineTo(720, 470); ctx.stroke();        // body
  ctx.beginPath(); ctx.moveTo(720, 470); ctx.lineTo(700, 410); ctx.stroke();        // neck
  ctx.fillStyle = '#e8b48f'; ctx.beginPath(); ctx.arc(700, 392, 26, 0, Math.PI * 2); ctx.fill(); // head
  ctx.strokeStyle = '#c25b3a'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(720, 500); ctx.lineTo(660, 530); ctx.stroke();        // arm L
  ctx.beginPath(); ctx.moveTo(720, 500); ctx.lineTo(790, 540); ctx.stroke();        // arm R
  ctx.strokeStyle = '#3d4d63'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(720, 560); ctx.lineTo(690, 650); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(720, 560); ctx.lineTo(760, 650); ctx.stroke();
  // signature-ish scribble
  ctx.strokeStyle = 'rgba(40,70,120,.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(120, 840); ctx.bezierCurveTo(200, 815, 260, 855, 330, 830); ctx.stroke();
}

layers.push(makeLayer('Background', { seed: seedBackground }));
layers.push(makeLayer('Animation', { seed: seedArt, exposures: [{ s: 1, e: 60 }] }));
function redrawLayer(layer) {
  layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.ctx.clearRect(0, 0, W, H);
  if (layer.seed) { layer.ctx.save(); layer.seed(layer.ctx); layer.ctx.restore(); }
  for (const st of layer.strokes) replayStroke(layer, st);
}
function replayStroke(layer, st) {
  const ctx = layer.ctx;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = st.color; ctx.globalAlpha = st.opacity;
  for (let i = 1; i < st.points.length; i++) {
    const a = st.points[i - 1], b = st.points[i];
    const w = strokeWidth(st, b);
    ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}
function strokeWidth(st, pt) {
  if (!st.pressureOn) return st.size;
  return Math.max(0.4, st.size * st.curve.at(clamp(pt.p, 0, 1)));
}
(function initLayers() { for (const l of layers) redrawLayer(l); })();

/* ---------------- camera ---------------- */
const camera = new TVPCamera({ cameraWidth: W, cameraHeight: H, startFrame: 1, endFrame: 60, viewWidth: W, viewHeight: H });
camera.track.setSceneRange(1, 60);

/* ---------------- view rendering ---------------- */
function drawLayersWorld(ctx) {
  ctx.save();
  for (const l of layers) if (l.visible) ctx.drawImage(l.canvas, 0, 0);
  ctx.restore();
}
function cameraState() { return camera.atFrame(state.currentFrame); }

function layTransform() {
  const fit = Math.min(vw / W, vh / H) * 0.92 * state.zoom;
  return {
    fit,
    ox: vw / 2 - W * fit / 2 + state.panX,
    oy: vh / 2 - H * fit / 2 + state.panY,
    toWorld: (sx, sy) => ({ x: (sx - (vw / 2 - W * fit / 2 + state.panX)) / fit, y: (sy - (vh / 2 - H * fit / 2 + state.panY)) / fit }),
    toScreen: (x, y) => ({ x: x * fit + (vw / 2 - W * fit / 2 + state.panX), y: y * fit + (vh / 2 - H * fit / 2 + state.panY) }),
  };
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
  // paper + shadow
  vctx.save();
  vctx.shadowColor = 'rgba(0,0,0,.55)'; vctx.shadowBlur = 18;
  vctx.fillStyle = '#f7f4ec';
  vctx.fillRect(T.ox, T.oy, W * T.fit, H * T.fit);
  vctx.restore();
  vctx.save();
  vctx.imageSmoothingEnabled = true;
  for (const l of layers) if (l.visible) vctx.drawImage(l.canvas, T.ox, T.oy, W * T.fit, H * T.fit);
  vctx.restore();
  // paper edge
  vctx.strokeStyle = 'rgba(0,0,0,.45)'; vctx.lineWidth = 1;
  vctx.strokeRect(T.ox + .5, T.oy + .5, W * T.fit - 1, H * T.fit - 1);
  // camera frame preview overlay in world space (aligned to the paper)
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
    vctx.fillText('world ' + W + '×' + H + ' · zoom ' + (T.fit).toFixed(3), 8, vh - 8);
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
  vctx.beginPath(); vctx.rect(ox, oy, outW, outH); vctx.clip();   // camera output is exactly this rect
  vctx.translate(vw / 2, vh / 2); vctx.rotate(r); vctx.scale(fit, fit); vctx.translate(-s.cx, -s.cy);
  vctx.fillStyle = '#f7f4ec'; vctx.fillRect(0, 0, W, H);
  drawLayersWorld(vctx);
  vctx.restore();
  // corner frame + labels
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
  // path polyline
  if (camera.track.path.length) {
    vctx.strokeStyle = 'rgb(129,170,201)'; vctx.lineWidth = 1; vctx.beginPath();
    camera.track.path.forEach((p, i) => { const q = proj(p); i ? vctx.lineTo(q.x, q.y) : vctx.moveTo(q.x, q.y); });
    vctx.stroke();
    for (const p of camera.track.path) {
      const q = proj(p);
      vctx.fillStyle = 'rgb(129,170,201)'; vctx.beginPath(); vctx.arc(q.x, q.y, 3, 0, Math.PI * 2); vctx.fill();
    }
  }
  // output-safe border
  vctx.strokeStyle = 'rgba(255,255,255,.12)'; vctx.strokeRect(10, 10, vw - 20, vh - 20);
}

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

/* ---------------- pen input / tools ---------------- */
let stroke = null, activeStrokeLayer = null, panning = null;
const pressureCurve = new TVPCurve.EaseCurve();
let livePressure = 0;

function pointerWorld(e) {
  const r = view.getBoundingClientRect();
  const T = layTransform();
  return T.toWorld(e.clientX - r.left, e.clientY - r.top);
}
function pressure01(e) {
  if (e.pointerType !== 'pen') return 1;                 // mouse = full width (no digitizer)
  return clamp(typeof e.pressure === 'number' ? e.pressure : 0.5, 0.02, 1);
}
function updatePressureUI(e) {
  if (!e) return;
  const p = pressure01(e);
  livePressure = p;
  $('press').firstElementChild.style.width = (p * 100) + '%';
  $('pressv').textContent = (e.pointerType === 'pen' ? 'pen ' : 'mouse ') +
    p.toFixed(2) + ' → ' + (state.size * (state.pressure ? pressureCurve.at(p) : 1)).toFixed(1) + 'px';
}

view.addEventListener('pointerdown', e => {
  try { view.setPointerCapture(e.pointerId); } catch (err) {}
  updatePressureUI(e);
  const tool = state.tool;
  if (tool === 'picker') { pickColor(e); return; }
  if (tool === 'pan') { panning = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY }; return; }
  if (tool === 'zoom') { state.zoom = clamp(state.zoom * 1.25, 0.15, 8); draw(); return; }
  if (state.mode !== 'draw') { toast('Switch to Draw view to paint (View ▸ Draw view)'); return; }
  const p = pointerWorld(e);
  activeStrokeLayer = layers[activeLayer];
  stroke = {
    tool, color: state.color, opacity: state.opacity, size: state.size,
    pressureOn: state.pressure, curve: pressureCurve,
    points: [{ x: p.x, y: p.y, p: pressure01(e) }],
  };
  activeStrokeLayer.strokes.push(stroke);
  draw();
});
view.addEventListener('pointermove', e => {
  updatePressureUI(e);
  if (panning) { state.panX = panning.px + (e.clientX - panning.x); state.panY = panning.py + (e.clientY - panning.y); draw(); return; }
  if (!stroke) return;
  const p = pointerWorld(e);
  const last = stroke.points[stroke.points.length - 1];
  const s = clamp(state.smoothing, 0, .9);
  const np = { x: last.x * s + p.x * (1 - s), y: last.y * s + p.y * (1 - s), p: pressure01(e) };
  stroke.points.push(np);
  drawStrokeSegment(activeStrokeLayer, stroke, stroke.points[stroke.points.length - 2], np);
  draw();
});
function endStroke() {
  if (!stroke) return;
  const li = layers.indexOf(activeStrokeLayer);
  stroke = null; activeStrokeLayer = null;
  pushAction({ kind: 'stroke', li });
}
view.addEventListener('pointerup', e => { panning = null; endStroke(); });
view.addEventListener('pointercancel', () => { panning = null; endStroke(); });

function drawStrokeSegment(layer, st, a, b) {  const ctx = layer.ctx;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = st.color; ctx.globalAlpha = st.opacity;
  ctx.lineWidth = strokeWidth(st, b);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
}
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
  if (a.kind === 'stroke') { const L = layers[a.li]; if (L && L.strokes.length) { a.stroke = L.strokes.pop(); a.done = true; redrawLayer(L); } }
  if (a.kind === 'clear') { const L = layers[a.li]; a.cleared = L.strokes; L.strokes = a.prev.slice(); redrawLayer(L); }
  redoStack.push(a); draw();
}
function redo() {
  const a = redoStack.pop(); if (!a) return toast('Nothing to redo');
  if (a.kind === 'stroke' && a.stroke) { layers[a.li].strokes.push(a.stroke); redrawLayer(layers[a.li]); }
  if (a.kind === 'clear') { layers[a.li].strokes = []; redrawLayer(layers[a.li]); }
  undoStack.push(a); draw();
}
function refreshUndo() { /* stacks are lazy; nothing to render */ }

/* ---------------- UI: color palette ---------------- */
const PALETTE = ['#000000','#3a3a3a','#6b6b6b','#9a9a9a','#ffffff','#7a3b2e','#c25b3a','#e08a4a','#f4c454','#f6e7a9',
  '#264653','#2a9d8f','#57cc99','#a8d5ba','#d8f0e3','#1d3557','#457b9d','#8ecae6','#bde0fe','#e8f4ff',
  '#6a4c93','#9b5de5','#c77dff','#e0aaff','#f1e4ff','#7f5539','#b08968','#ddb892','#ede0d4','#5c677d'];
function buildPalette() {
  const pal = $('pal');
  pal.innerHTML = '';
  for (const c of PALETTE) {
    const d = document.createElement('div');
    d.style.background = c; d.dataset.color = c;
    d.title = c;
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

/* ---------------- UI: layers ---------------- */
function renderLayers() {
  const list = $('layerlist');
  list.innerHTML = '';
  layers.forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'lrow' + (i === activeLayer ? ' cur' : '');
    row.innerHTML = '<span class="eye">' + (l.visible ? '👁' : '·') + '</span><span class="nm">' + esc(l.name) +
      '</span><span class="ex">' + l.exposures.map(e => e.s + '-' + e.e).join(' ') + '</span>';
    row.onclick = () => { activeLayer = i; renderLayers(); draw(); updateStatus(); };
    row.querySelector('.eye').onclick = ev => { ev.stopPropagation(); l.visible = !l.visible; renderLayers(); draw(); };
    list.appendChild(row);
  });
  $('slayer').textContent = layers[activeLayer] ? layers[activeLayer].name : '—';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------------- timeline ---------------- */
const PX = 10; // px per frame
function tlFrameFromX(x) { return clamp(Math.floor(x / PX) + 1, 1, 999); }
function buildTimeline() {
  const labels = $('tllabels'), rows = $('tlrows'), ruler = $('ruler');
  labels.innerHTML = '<div class="tllabel head">Timeline</div><div class="tllabel cam">Camera</div>';
  rows.innerHTML = '<div class="tlrow cam" data-row="cam"></div>';
  ruler.innerHTML = '';
  const end = state.endFrame;
  for (let f = 1; f <= end; f++) {
    if (f % 5 === 0) {
      const t = document.createElement('i'); t.className = 'tick'; t.style.left = ((f - 1) * PX) + 'px';
      ruler.appendChild(t);
      const l = document.createElement('span'); l.className = 'lab'; l.textContent = f;
      l.style.left = ((f - 1) * PX) + 'px'; ruler.appendChild(l);
    }
  }
  for (const l of layers) {
    labels.insertAdjacentHTML('beforeend', '<div class="tllabel">' + esc(l.name) + '</div>');
    const row = document.createElement('div'); row.className = 'tlrow'; row.dataset.layer = layers.indexOf(l);
    for (const e of l.exposures) {
      const d = document.createElement('div'); d.className = 'exp';
      d.style.left = ((e.s - 1) * PX) + 'px'; d.style.width = ((e.e - e.s + 1) * PX) + 'px';
      d.title = l.name + ' · ' + e.s + '–' + e.e;
      d.onclick = ev => { ev.stopPropagation(); setFrame(e.s); };
      row.appendChild(d);
    }
    rows.appendChild(row);
  }
  labels.insertAdjacentHTML('beforeend', '<div class="tllabel audio">Audio · Master</div>');
  const audioRow = document.createElement('div'); audioRow.className = 'tlrow';
  audioRow.innerHTML = '<div class="exp" style="left:0;width:' + (end * PX) + 'px;opacity:.35"></div>';
  rows.appendChild(audioRow);
  labels.insertAdjacentHTML('beforeend', '<div class="tllabel notes">Notes</div>');
  const notesRow = document.createElement('div'); notesRow.className = 'tlrow';
  notesRow.innerHTML = '<div style="position:absolute;left:6px;top:3px;color:#8c8c94;font-size:10px">' +
    (state.notes || 'timeline notes (cTimelineNotes)') + '</div>';
  rows.appendChild(notesRow);
  // camera key markers
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
    d.title = 'path point @' + p.frame + ' (' + Math.round(p.x) + ',' + Math.round(p.y) + ')';
    camRow.appendChild(d);
  }
  $('tlcanvas').style.width = Math.max(vw - 150, end * PX + 40) + 'px';
  updateTimelineUI();
}
function updateTimelineUI() {
  $('ph').style.left = ((state.currentFrame - 1) * PX) + 'px';
  $('fnum').textContent = state.currentFrame;
  $('sframe').textContent = state.currentFrame;
  $('send').textContent = state.endFrame;
  $$('#tlrows .tlrow').forEach(row => {
    if (row.dataset.layer === undefined) return;
    const l = layers[+row.dataset.layer];
    const cur = l.exposures.some(e => state.currentFrame >= e.s && state.currentFrame <= e.e);
    row.querySelectorAll('.exp').forEach(d => d.classList.toggle('cur', cur));
  });
  $('tlinfo').textContent = 'frame ' + state.currentFrame + ' · ' + layers.length + ' layers · camera keys '
    + camera.track.keys.length + ' · path points ' + camera.track.path.length;
  $('caminfo').textContent = 'infoFrame: ' + camera.infoFrame(state.currentFrame);
  $('scam').textContent = camera.track.keys.length || camera.track.path.length ? 'animated' : 'off';
}
function setFrame(f) {
  state.currentFrame = clamp(Math.round(f), 1, state.endFrame);
  updateTimelineUI(); draw();
}

/* timeline click = scrub */
$('tlcanvas').addEventListener('pointerdown', e => {
  const r = $('tlcanvas').getBoundingClientRect();
  setFrame(tlFrameFromX(e.clientX - r.left));
});
$('tlscroll').addEventListener('scroll', () => { /* playhead is inside tlcanvas so it scrolls with content */ });

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
  LayerPrevKey: 'prevkey', LayerNextKey: 'nextkey',
  Clear: 'clear', Backspace: 'clear',
  SaveProject: 'save', SaveAsProject: 'save', NewProject: 'new',
  FullScreen: 'fullscreen', DisplayAllLayer: 'allvisible', ToggleCoordinates: 'coords',
  Space: 'tool-zoom', Escape: 'stop', Tab: 'nextframe', 'Shift Tab': 'prevframe',
};

function eventCombo(e) {
  const keyRaw = e.key;
  let key = keyRaw;
  if (key === ' ') key = 'Space';
  else if (key === 'ArrowUp') key = 'Up'; else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left'; else if (key === 'ArrowRight') key = 'Right';
  else if (key === 'PageUp') key = 'Page Up'; else if (key === 'PageDown') key = 'Page Down';
  else if (key === 'Delete') key = 'Del'; else if (key === 'Backspace') key = 'Backspace';
  else if (key === 'Escape') key = 'Escape'; else if (key === 'Enter') key = 'Enter';
  else if (key === 'Home') key = 'Home'; else if (key === 'End') key = 'End'; else if (key === 'Insert') key = 'Insert';
  else if (key === 'Tab') key = 'Tab';
  else if (key.length === 1) key = key.toUpperCase(); else if (/^F\d{1,2}$/.test(key)) { /* F-keys as-is */ }
  if (key === '+') key = '+'; if (key === '-') key = '-';
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
  if (kmCapturing && $('modalback').classList.contains('open')) { captureRebind(e); return; }
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if ($('modalback').classList.contains('open')) { if (e.key === 'Escape') closeKms(); return; }
  const combo = eventCombo(e);
  let action = findAction(combo);
  if (!action && /^[^A-Za-z0-9 ]$/.test(e.key) && e.shiftKey) action = findAction(eventCombo({ ...e, shiftKey: false }));
  if (!action) return;
  e.preventDefault();
  dispatch(action, combo);
});

function dispatch(action, combo) {
  const map = ACTION_ALIASES[action];
  const cmd = map;
  if (cmd) { run(cmd); return; }
  // a few direct actions with clear names
  switch (action) {
    case 'Print': toast('Print — not implemented'); return;
    case 'Quit': toast('Quit — close the tab to exit'); return;
    case 'SearchEngine': toast('Search — not implemented'); return;
    case 'LoadProject': toast('Load project — not implemented'); return;
    case 'Copy': case 'CutStayPut': case 'Paste':
      toast(action + ' — clipboard layer ops not implemented'); return;
    case 'SelectionClear': toast('Selection tools not implemented'); return;
    case 'LayerPickLayer': toast('Pick layer — click a layer in the Layers panel'); return;
    default:
      toast('Shortcut ' + combo + ' → ' + action + ' (not implemented in this build)');
  }
}

/* ---------------- commands ---------------- */
function run(cmd) {
  switch (cmd) {
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'clear': {
      const L = layers[activeLayer];
      pushAction({ kind: 'clear', li: activeLayer, prev: L.strokes.slice() });
      L.strokes = []; redrawLayer(L); draw(); buildTimeline(); break;
    }
    case 'new': layers.length = 0; layers.push(makeLayer('Layer 1'));
      activeLayer = 0; state.currentFrame = 1; resetCamera(); redrawLayer(layers[0]);
      buildTimeline(); renderLayers(); draw(); toast('New scene'); break;
    case 'save': saveProject(); break;
    case 'exportkm': exportKeymap(); break;
    case 'layeradd': {
      const name = 'Layer ' + (layers.length + 1);
      layers.push(makeLayer(name, { exposures: [{ s: state.currentFrame, e: Math.min(state.endFrame, state.currentFrame + 23) }] }));
      activeLayer = layers.length - 1; renderLayers(); buildTimeline(); draw(); break;
    }
    case 'layerdel': {
      if (layers.length <= 1) { toast('Need at least one layer'); break; }
      layers.splice(activeLayer, 1); activeLayer = clamp(activeLayer, 0, layers.length - 1);
      renderLayers(); buildTimeline(); draw(); break;
    }
    case 'layervis': layers[activeLayer].visible = !layers[activeLayer].visible; renderLayers(); draw(); break;
    case 'layerup': activeLayer = clamp(activeLayer + 1, 0, layers.length - 1); renderLayers(); break;
    case 'layerdown': activeLayer = clamp(activeLayer - 1, 0, layers.length - 1); renderLayers(); break;
    case 'layerexp': addExposure(); break;
    case 'addexp': addExposure(); break;
    case 'play': togglePlay(); break;
    case 'stop': state.playing = false; updatePlayBtn(); break;
    case 'prevframe': setFrame(state.currentFrame - 1); break;
    case 'nextframe': setFrame(state.currentFrame + 1); break;
    case 'firstframe': setFrame(1); break;
    case 'lastframe': setFrame(state.endFrame); break;
    case 'prevkey': setFrame(nearestKey(-1)); break;
    case 'nextkey': setFrame(nearestKey(1)); break;
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
    case 'about': toast('my-version — clean-room TVPaint 12 RE: camera (size keys + path), pressure canvas, timeline, shortcut keymap. See SPEC.md.'); break;
    default: toast('Command ' + cmd + ' not implemented');
  }
  updateStatus();
}

function addExposure() {
  const L = layers[activeLayer];
  const hit = L.exposures.find(e => state.currentFrame >= e.s && state.currentFrame <= e.e);
  if (hit) hit.e = Math.min(999, hit.e + 12);
  else L.exposures.push({ s: state.currentFrame, e: Math.min(999, state.currentFrame + 11) });
  L.exposures.sort((a, b) => a.s - b.s);
  buildTimeline(); draw(); toast('Exposure extended on ' + L.name);
}
function nearestKey(dir) {
  const f = state.currentFrame;
  const pts = new Set();
  for (const l of layers) for (const e of l.exposures) { pts.add(e.s); pts.add(e.e + 1); }
  for (const k of camera.track.keys) pts.add(k.frame);
  for (const p of camera.track.path) pts.add(p.frame);
  const xs = [...pts].sort((a, b) => a - b);
  if (dir > 0) return xs.find(x => x > f) || state.endFrame;
  const prev = xs.filter(x => x < f); return prev.length ? prev[prev.length - 1] : 1;
}
function resetCamera() {
  camera.track.keys = []; camera.track.path = [];
  buildTimeline(); draw();
}

/* playback */
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

/* fps */
$('fps').onchange = () => { state.fps = +$('fps').value; };

/* ---------------- mode / tools / options ---------------- */
function setMode(m) {
  state.mode = m;
  $$('.modebtn').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('shint').textContent = m === 'cam'
    ? 'Camera view — scrub the timeline; camera keys ease per the traced curves'
    : 'Draw view — pen pressure drives brush width · Camera panel adds keys';
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

/* menus + command buttons */
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
function openKms() {
  $('modalback').classList.add('open');
  renderKm();
  $('kmsearch').focus();
}
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
    layers: layers.map(l => ({ name: l.name, visible: l.visible, exposures: l.exposures,
      strokes: l.strokes.map(s => ({ tool: s.tool, color: s.color, opacity: s.opacity, size: s.size, pressureOn: s.pressureOn, points: s.points.map(p => [Math.round(p.x), Math.round(p.y), +p.p.toFixed(3)]) })) })),
    camera: { keys: camera.track.keys.map(k => ({ frame: k.frame, width: k.width, height: k.height, rotation: k.rotation, zoom: k.zoom, has: k.has })),
      path: camera.track.path, range: [camera.track.startFrame, camera.track.endFrame] },
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'my-version-project.json';
  a.click();
  toast('Project saved as JSON (strokes + camera + timeline)');
}

/* ---------------- toasts / status ---------------- */
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

/* ---------------- boot ---------------- */
buildPalette();
renderLayers();
buildTimeline();
resizeView();
updateStatus();
$('pressv').textContent = 'pen: waiting for pointer…';
