// LAN server: serves the static client from public/ and runs the authoritative
// round lifecycle over a Node WebSocket. Game logic lives in game/lifecycle.js
// (shared with the web server, wan_server.ts).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Game, TICK_MS } from './game/lifecycle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8000;
const ROOT = path.join(__dirname, 'public');
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
const conns = new Map(); // gameId -> ws

const game = new Game({
  broadcast(obj, exceptId) {
    const msg = JSON.stringify(obj);
    for (const [gid, ws] of conns) {
      if (gid !== exceptId && ws.readyState === 1) ws.send(msg);
    }
  }
});

// WebSocketServer({ server }) accepts upgrades on any path, so the client's
// unified `/parties/main/<room>` URL works here too.
wss.on('connection', (ws) => {
  const id = game.addPlayer(
    (obj) => ws.send(JSON.stringify(obj)),
    (gid) => conns.set(gid, ws)
  );

  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'state' && typeof m.x === 'number' && typeof m.z === 'number') {
      game.onState(id, m.x, m.z);
    } else if (m.type === 'finish') {
      game.onFinish(id);
    }
  });

  ws.on('close', () => {
    conns.delete(id);
    game.removePlayer(id);
  });
});

setInterval(() => game.tick(), TICK_MS);

server.listen(PORT, () => console.log(`speedjam LAN server on http://localhost:${PORT}`));
