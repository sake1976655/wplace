// server.js — Node.js + Express + Socket.io + SQLite
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');

// CONFIG (қажет болса .env арқылы орнатуға болады)
const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ORIGIN || 'http://localhost:3000'; // production-да нақты домен
const CANVAS_W = parseInt(process.env.CANVAS_W || '300', 10); // канвастың ені
const CANVAS_H = parseInt(process.env.CANVAS_H || '150', 10); // канвастың биіктігі
const PLACE_COOLDOWN_MS = parseInt(process.env.PLACE_COOLDOWN_MS || '5000', 10); // IP-ке орын қою арасындағы күту

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ORIGIN,
    methods: ['GET', 'POST']
  }
});

// қорғаныс
app.use(helmet());
app.use(express.json({ limit: '1kb' })); // үлкен payload-тарды блоктау
app.use(express.urlencoded({ extended: false }));
app.use(cors({ origin: ORIGIN }));

// rate limiter — REST API үшін
const apiLimiter = rateLimit({
  windowMs: 15 * 1000, // 15 секунд терезе
  max: 30, // IP-ден 15 секунд ішінде 30 сұраудан артық болмауы
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// статикалық файлдар
app.use(express.static(path.join(__dirname, 'public')));

// DB: sqlite, файл persistent.db
const db = new sqlite3.Database(path.join(__dirname, 'pixels.db'));

// инициализация
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS pixels (
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    color TEXT NOT NULL,
    last_modified INTEGER NOT NULL,
    PRIMARY KEY (x, y)
  )`);

  // Pre-fill (опционал) — тек қажет болса
  // for performance: don't fill by default
});

// көмекші: түсті тексеру — #RRGGBB форматы
function validColor(c) {
  return typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);
}

// REST: барлық пиксельдерді алу (қысқартылған формат)
app.get('/api/pixels', (req, res) => {
  db.all('SELECT x, y, color FROM pixels', (err, rows) => {
    if (err) return res.status(500).json({ error: 'db' });
    res.json(rows);
  });
});

// REST: белгі қою (кейбір клиенттер үшін қолдануға болады)
app.post('/api/place', (req, res) => {
  const ip = req.ip;
  const { x, y, color } = req.body;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return res.status(400).json({ error: 'invalid coords' });
  if (x < 0 || x >= CANVAS_W || y < 0 || y >= CANVAS_H) return res.status(400).json({ error: 'out of bounds' });
  if (!validColor(color)) return res.status(400).json({ error: 'invalid color' });

  const ts = Date.now();

  // place logic with cooldown per IP stored in-memory (simple)
  // NOTE: production-да Redis сияқты сыртқы кеш пайдалану жақсы
  if (!global._placeCooldown) global._placeCooldown = {};
  const last = global._placeCooldown[ip] || 0;
  if (ts - last < PLACE_COOLDOWN_MS) return res.status(429).json({ error: 'cooldown' });
  global._placeCooldown[ip] = ts;

  const sql = `INSERT INTO pixels(x,y,color,last_modified) VALUES(?,?,?,?)
    ON CONFLICT(x,y) DO UPDATE SET color=excluded.color, last_modified=excluded.last_modified`;
  db.run(sql, [x, y, color, ts], function (err) {
    if (err) return res.status(500).json({ error: 'db' });
    // emit websocket хабарлама
    io.emit('pixel', { x, y, color });
    res.json({ ok: true });
  });
});

// WebSocket — place оқиғасы
io.on('connection', (socket) => {
  // send config
  socket.emit('config', { width: CANVAS_W, height: CANVAS_H });

  // socket сұрап алған кезде барлық пиксельдерді жіберу
  socket.on('getPixels', () => {
    db.all('SELECT x, y, color FROM pixels', (err, rows) => {
      if (err) return socket.emit('error', 'db');
      socket.emit('pixels', rows);
    });
  });

  // place оқиғасы
  socket.on('place', (data) => {
    try {
      const ip = socket.handshake.address;
      const { x, y, color } = data;
      if (!Number.isInteger(x) || !Number.isInteger(y)) return;
      if (x < 0 || x >= CANVAS_W || y < 0 || y >= CANVAS_H) return;
      if (!validColor(color)) return;

      const ts = Date.now();
      if (!global._socketCooldown) global._socketCooldown = {};
      const last = global._socketCooldown[ip] || 0;
      if (ts - last < PLACE_COOLDOWN_MS) {
        socket.emit('placeDenied', { reason: 'cooldown' });
        return;
      }
      global._socketCooldown[ip] = ts;

      const sql = `INSERT INTO pixels(x,y,color,last_modified) VALUES(?,?,?,?)
        ON CONFLICT(x,y) DO UPDATE SET color=excluded.color, last_modified=excluded.last_modified`;
      db.run(sql, [x, y, color, ts], function (err) {
        if (err) return;
        io.emit('pixel', { x, y, color });
      });
    } catch (e) {
      // silent fail to avoid data leakage
    }
  });
});

// бастау
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
