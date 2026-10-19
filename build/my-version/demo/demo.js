/* Demo for my-version camera. Renders a synthetic "scene" (paintings + text) and moves the
 * camera exactly per the traced evaluation: transform = translate(center) rotate scale (SPEC §5). */
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const CW = 1920, CH = 1080;                 // camera rect (scene ints +0x168/0x16C semantics)
const scene = new TVPCamera.CameraTrack({ cameraWidth: CW, cameraHeight: CH, startFrame: 1, endFrame: 60 });
scene.setSceneRange(1, 60);
const cam = new TVPCamera(scene);

let t = 0, playing = false;
const S = () => Math.round(scene.startFrame + t * (scene.endFrame - scene.startFrame));

function drawScene() { // simple scene content, same world-space as the camera rect
  ctx.fillStyle = '#15202b'; ctx.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 40; i++) {           // grid to make pan visible
    ctx.fillStyle = i % 2 ? '#1e3242' : '#1a2a38';
    ctx.fillRect(i * 120, 0, 60, CH);
  }
  ctx.fillStyle = '#eee'; ctx.font = 'bold 140px Georgia'; ctx.textAlign = 'center';
  ctx.fillText('TVPaint-like camera', CW / 2, CH / 2 - 80);
  ctx.fillStyle = '#fa0'; ctx.beginPath();
  ctx.ellipse(CW - 500, CH - 380, 300, 180, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#eee'; ctx.font = '40px Georgia';
  for (let i = 0; i < 5; i++) ctx.fillText('layer sample ' + (i + 1), 300 + i * 160, 200 + i * 160);
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const s = scene.evaluate(S());
  // map camera rect → centered viewport
  const cx = canvas.width / 2 + s.x, cy = canvas.height / 2 + s.y;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(s.rotation * Math.PI / 180);
  ctx.scale(s.zoom, s.zoom);
  ctx.translate(-CW / 2, -CH / 2);
  if (s.x !== CW || s.y !== CH) ctx.translate(-(s.x - CW), -(s.y - CH)); // parallax-style pan from default framing
  drawScene();
  ctx.restore();
  // draw the camera frame rect after the transform (whenever enabled)
  if (document.getElementById('showcam').checked) {
    ctx.strokeStyle = '#0f0'; ctx.lineWidth = 2;
    const fit = Math.min(canvas.width / CW, canvas.height / CH);
    ctx.strokeRect(canvas.width / 2 - CW * fit / 2, canvas.height / 2 - CH * fit / 2, CW * fit, CH * fit);
  }
  document.getElementById('info').textContent =
    'FRAME ' + S() + ' → x=' + s.x.toFixed(1) + ' y=' + s.y.toFixed(1) +
    ' rot=' + s.rotation.toFixed(2) + '° zoom=' + s.zoom.toFixed(3) +
    '  |  infoFrame(): ' + scene.infoFrame(S());
}

const ui = document.getElementById('time');
ui.oninput = () => { t = +ui.value; render(); };
const addBtn = (id, fn) => document.getElementById(id).onclick = () => { fn(); render(); };
addBtn('bp', () => scene.setKey(S(), 'position', { x: Math.round((Math.random() - 0.5) * CW), y: Math.round((Math.random() - 0.5) * CH) }));
addBtn('br', () => scene.setKey(S(), 'rotation', { rotation: (Math.random() * 50 - 25) }));
addBtn('bz', () => scene.setKey(S(), 'zoom', { zoom: +(0.5 + Math.random() * 2).toFixed(2) }));
addBtn('bd', () => scene.removeKey(S()));
document.getElementById('bl').onclick = () => {
  scene.setKey(1, 'zoom', { zoom: 0.5 }); scene.setKey(60, 'zoom', { zoom: 1.5 }); render();
};
document.getElementById('follow').onchange = render;

setInterval(() => { if (playing) { t = (t + 0.02) % 1.00001; ui.value = t; render(); } }, 40);
canvas.onclick = () => { playing = !playing; };
render();
