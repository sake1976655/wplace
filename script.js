// Клиент-логика: Socket.io негізінде
const socket = io();
let W = 300, H = 150; // default, сервердан өзгертуі мүмкін
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const status = document.getElementById('status');

// пиксель өлшемін экранға қарай есептеу
function resizeCanvas() {
  const maxWidth = Math.min(window.innerWidth - 40, 900);
  canvas.width = maxWidth;
  canvas.height = Math.round(maxWidth * (H / W));
  drawAllPixels();
}

let pixels = {}; // key = `${x},${y}` -> color

function drawAllPixels() {
  // clear
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  const pxW = canvas.width / W;
  const pxH = canvas.height / H;
  for (const k in pixels) {
    const [x,y] = k.split(',').map(Number);
    ctx.fillStyle = pixels[k];
    ctx.fillRect(Math.floor(x * pxW), Math.floor(y * pxH), Math.ceil(pxW), Math.ceil(pxH));
  }
}

// map client coords -> canvas coords
function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const cx = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
  const cy = (evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top;
  const x = Math.floor(cx / rect.width * W);
  const y = Math.floor(cy / rect.height * H);
  return { x, y };
}

// place via socket
function placePixel(x,y,color) {
  socket.emit('place', { x, y, color });
}

canvas.addEventListener('click', (e) => {
  const { x, y } = getCanvasPos(e);
  const color = colorPicker.value;
  placePixel(x,y,color);
});

// socket handlers
socket.on('connect', () => {
  status.textContent = 'connected';
});
socket.on('disconnect', () => { status.textContent = 'disconnected'; });

socket.on('config', (cfg) => {
  W = cfg.width; H = cfg.height; resizeCanvas();
});

socket.on('pixels', (rows) => {
  pixels = {};
  rows.forEach(r => { pixels[`${r.x},${r.y}`] = r.color; });
  drawAllPixels();
});

socket.on('pixel', (p) => {
  pixels[`${p.x},${p.y}`] = p.color;
  drawAllPixels();
});

socket.on('placeDenied', (msg) => {
  status.textContent = msg.reason || 'denied';
  setTimeout(()=>status.textContent = '', 2000);
});

// алғашында барлық пиксельдерді сұрау
socket.emit('getPixels');

window.addEventListener('resize', () => resizeCanvas());
resizeCanvas();
