const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(ROOT, urlPath);
  const rel = path.relative(ROOT, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const players = new Map();
const COLORS = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xfb8c00, 0x00acc1, 0xd81b60];
let nextId = 1;

function broadcast(obj, except) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c !== except && c.readyState === 1) c.send(msg);
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const startX = ((id - 1) % 4 - 1.5) * 3;
  const player = { id, color, x: startX, z: 0 };
  players.set(id, player);

  ws.send(JSON.stringify({
    type: 'welcome',
    id, color, x: startX,
    players: [...players.values()].filter(p => p.id !== id)
  }));
  broadcast({ type: 'join', player }, ws);

  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'state' && typeof m.x === 'number' && typeof m.z === 'number') {
      player.x = m.x; player.z = m.z;
      broadcast({ type: 'state', id, x: m.x, z: m.z }, ws);
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
  });
});

server.listen(PORT, () => console.log(`speedjam listening on http://localhost:${PORT}`));
