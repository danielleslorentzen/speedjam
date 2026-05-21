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

// --- Game lifecycle ---
const COUNTDOWN_MS = 3000;  // pre-round countdown
const ROUND_END_MS = 3000;  // grace for stragglers after first finish
const LANE_SPACING = 3;
const TICK_MS = 100;

const PHASE = { COUNTDOWN: 'countdown', RACING: 'racing', ROUNDEND: 'roundend' };
let phase = PHASE.RACING;   // idle until first player triggers a countdown
let phaseEndsAt = 0;
let round = 0;
let finishOrder = [];       // player ids in the order they crossed

const connected = () => [...players.values()];
const inRoundPlayers = () => connected().filter(p => p.inRound);
const standings = () => finishOrder.map((id, i) => ({ id, place: i + 1 }));

function broadcast(obj, except) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c !== except && c.readyState === 1) c.send(msg);
  }
}

function startCountdown() {
  phase = PHASE.COUNTDOWN;
  phaseEndsAt = Date.now() + COUNTDOWN_MS;
  round++;
  finishOrder = [];
  const ps = connected();
  const n = ps.length;
  const starts = {};
  ps.forEach((p, i) => {
    p.inRound = true;
    p.finished = false;
    p.x = (i - (n - 1) / 2) * LANE_SPACING;
    p.z = 0;
    starts[p.id] = p.x;
  });
  broadcast({ type: 'phase', phase, round, duration: COUNTDOWN_MS, starts });
}

function startRacing() {
  phase = PHASE.RACING;
  phaseEndsAt = 0;
  broadcast({ type: 'phase', phase, round });
}

function startRoundEnd() {
  phase = PHASE.ROUNDEND;
  phaseEndsAt = Date.now() + ROUND_END_MS;
  broadcast({ type: 'phase', phase, round, duration: ROUND_END_MS, standings: standings() });
}

function handleFinish(player) {
  if (!player.inRound || player.finished || phase === PHASE.COUNTDOWN) return;
  player.finished = true;
  finishOrder.push(player.id);
  broadcast({ type: 'finish', id: player.id, place: finishOrder.length });

  const ir = inRoundPlayers();
  if (ir.length > 0 && ir.every(p => p.finished)) {
    startCountdown();              // everyone's across -> straight to next countdown
  } else if (phase === PHASE.RACING) {
    startRoundEnd();               // first finisher opens the grace window
  }
}

function tick() {
  const now = Date.now();
  if (phase === PHASE.COUNTDOWN) {
    if (now >= phaseEndsAt) startRacing();
  } else if (phase === PHASE.RACING) {
    if (connected().length > 0 && inRoundPlayers().length === 0) startCountdown();
  } else if (phase === PHASE.ROUNDEND) {
    if (now >= phaseEndsAt) startCountdown();
  }
}
setInterval(tick, TICK_MS);

wss.on('connection', (ws) => {
  const id = nextId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const startX = ((id - 1) % 4 - 1.5) * LANE_SPACING;
  const player = { id, color, x: startX, z: 0, inRound: false, finished: false };
  players.set(id, player);

  ws.send(JSON.stringify({
    type: 'welcome',
    id, color, x: startX,
    players: [...players.values()].filter(p => p.id !== id),
    phase, round,
    inRound: false,
    phaseRemaining: phaseEndsAt ? Math.max(0, phaseEndsAt - Date.now()) : null,
    standings: phase === PHASE.ROUNDEND ? standings() : []
  }));
  broadcast({ type: 'join', player }, ws);

  // If the game is idle (no one racing), kick off a countdown for the newcomer.
  if (inRoundPlayers().length === 0) startCountdown();

  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'state' && typeof m.x === 'number' && typeof m.z === 'number') {
      player.x = m.x; player.z = m.z;
      broadcast({ type: 'state', id, x: m.x, z: m.z }, ws);
    } else if (m.type === 'finish') {
      handleFinish(player);
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
    // If the leaver was the last unfinished racer, close out the round.
    const ir = inRoundPlayers();
    if ((phase === PHASE.RACING || phase === PHASE.ROUNDEND) &&
        ir.length > 0 && ir.every(p => p.finished)) {
      startCountdown();
    }
  });
});

server.listen(PORT, () => console.log(`speedjam listening on http://localhost:${PORT}`));
