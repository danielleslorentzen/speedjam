// Transport-agnostic round lifecycle for "5 Seconds To Finish".
// Shared by the LAN server (lan_server.js, Node + ws) and the web server
// (wan_server.ts, Cloudflare PartyKit). Adapters inject a broadcast fn and a
// clock; the Game owns all state and assigns its own numeric player ids so the
// wire protocol is identical across transports.

export const COLORS = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xfb8c00, 0x00acc1, 0xd81b60];
export const TICK_MS = 100;

const COUNTDOWN_MS = 3000;  // pre-round countdown
const ROUND_END_MS = 3000;  // grace for stragglers after first finish
const LANE_SPACING = 3;
const PHASE = { COUNTDOWN: 'countdown', RACING: 'racing', ROUNDEND: 'roundend' };

export class Game {
  // broadcast(obj, exceptGameId?) -> send to everyone (optionally skipping one player)
  // now() -> current time in ms
  constructor({ broadcast, now = () => Date.now() }) {
    this._broadcast = broadcast;
    this._now = now;
    this.players = new Map();   // gameId -> { id, color, x, z, inRound, finished }
    this.nextId = 1;
    this.phase = PHASE.RACING;  // idle until the first player triggers a countdown
    this.phaseEndsAt = 0;
    this.round = 0;
    this.finishOrder = [];
  }

  get playerCount() { return this.players.size; }

  _connected() { return [...this.players.values()]; }
  _inRound() { return this._connected().filter(p => p.inRound); }
  _standings() { return this.finishOrder.map((id, i) => ({ id, place: i + 1 })); }

  // send(obj) delivers only to the joining connection; register(gameId) lets the
  // adapter record its connection<->id mapping BEFORE any broadcast, so the new
  // player is included in the idle-countdown phase broadcast below.
  addPlayer(send, register) {
    const id = this.nextId++;
    const color = COLORS[(id - 1) % COLORS.length];
    const startX = ((id - 1) % 4 - 1.5) * LANE_SPACING;
    const player = { id, color, x: startX, z: 0, inRound: false, finished: false };
    this.players.set(id, player);
    if (register) register(id);

    send({
      type: 'welcome',
      id, color, x: startX,
      players: this._connected().filter(p => p.id !== id),
      phase: this.phase, round: this.round,
      inRound: false,
      phaseRemaining: this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - this._now()) : null,
      standings: this.phase === PHASE.ROUNDEND ? this._standings() : []
    });
    this._broadcast({ type: 'join', player }, id);

    // If the game is idle (no one racing), kick off a countdown for the newcomer.
    if (this._inRound().length === 0) this._startCountdown();
    return id;
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    this._broadcast({ type: 'leave', id });
    // If the leaver was the last unfinished racer, close out the round.
    const ir = this._inRound();
    if ((this.phase === PHASE.RACING || this.phase === PHASE.ROUNDEND) &&
        ir.length > 0 && ir.every(p => p.finished)) {
      this._startCountdown();
    }
  }

  onState(id, x, z) {
    const p = this.players.get(id);
    if (!p) return;
    p.x = x; p.z = z;
    this._broadcast({ type: 'state', id, x, z }, id);
  }

  onFinish(id) {
    const p = this.players.get(id);
    if (p) this._handleFinish(p);
  }

  tick() {
    const now = this._now();
    if (this.phase === PHASE.COUNTDOWN) {
      if (now >= this.phaseEndsAt) this._startRacing();
    } else if (this.phase === PHASE.RACING) {
      if (this._connected().length > 0 && this._inRound().length === 0) this._startCountdown();
    } else if (this.phase === PHASE.ROUNDEND) {
      if (now >= this.phaseEndsAt) this._startCountdown();
    }
  }

  _startCountdown() {
    this.phase = PHASE.COUNTDOWN;
    this.phaseEndsAt = this._now() + COUNTDOWN_MS;
    this.round++;
    this.finishOrder = [];
    const ps = this._connected();
    const n = ps.length;
    const starts = {};
    ps.forEach((p, i) => {
      p.inRound = true;
      p.finished = false;
      p.x = (i - (n - 1) / 2) * LANE_SPACING;
      p.z = 0;
      starts[p.id] = p.x;
    });
    this._broadcast({ type: 'phase', phase: this.phase, round: this.round, duration: COUNTDOWN_MS, starts });
  }

  _startRacing() {
    this.phase = PHASE.RACING;
    this.phaseEndsAt = 0;
    this._broadcast({ type: 'phase', phase: this.phase, round: this.round });
  }

  _startRoundEnd() {
    this.phase = PHASE.ROUNDEND;
    this.phaseEndsAt = this._now() + ROUND_END_MS;
    this._broadcast({ type: 'phase', phase: this.phase, round: this.round, duration: ROUND_END_MS, standings: this._standings() });
  }

  _handleFinish(player) {
    if (!player.inRound || player.finished || this.phase === PHASE.COUNTDOWN) return;
    player.finished = true;
    this.finishOrder.push(player.id);
    this._broadcast({ type: 'finish', id: player.id, place: this.finishOrder.length });

    const ir = this._inRound();
    if (ir.length > 0 && ir.every(p => p.finished)) {
      this._startCountdown();   // everyone's across -> straight to next countdown
    } else if (this.phase === PHASE.RACING) {
      this._startRoundEnd();    // first finisher opens the grace window
    }
  }
}
