// Web server: Cloudflare PartyKit (Durable Object per room) running the same
// authoritative lifecycle as the LAN server. Reachable by a plain browser
// WebSocket at wss://<project>.<user>.partykit.dev/parties/main/<room>.
import type * as Party from "partykit/server";
import { Game, TICK_MS } from "./game/lifecycle.js";

export default class WanServer implements Party.Server {
  game: Game;
  gidToConn = new Map<number, string>();
  connToGid = new Map<string, number>();
  timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {
    this.game = new Game({
      broadcast: (obj, exceptGid?: number) => {
        const connId = exceptGid != null ? this.gidToConn.get(exceptGid) : undefined;
        this.room.broadcast(JSON.stringify(obj), connId ? [connId] : []);
      },
    });
  }

  onConnect(conn: Party.Connection) {
    this.game.addPlayer(
      (obj) => conn.send(JSON.stringify(obj)),
      (gid) => { this.gidToConn.set(gid, conn.id); this.connToGid.set(conn.id, gid); }
    );
    this.ensureTick();
  }

  onMessage(raw: string, conn: Party.Connection) {
    const gid = this.connToGid.get(conn.id);
    if (gid == null) return;
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "state" && typeof m.x === "number" && typeof m.z === "number") {
      this.game.onState(gid, m.x, m.z);
    } else if (m.type === "finish") {
      this.game.onFinish(gid);
    }
  }

  onClose(conn: Party.Connection) {
    const gid = this.connToGid.get(conn.id);
    if (gid != null) {
      this.connToGid.delete(conn.id);
      this.gidToConn.delete(gid);
      this.game.removePlayer(gid);
    }
    // Stop ticking once the room is empty so the Durable Object can hibernate.
    if (this.game.playerCount === 0) this.clearTick();
  }

  ensureTick() {
    if (!this.timer) this.timer = setInterval(() => this.game.tick(), TICK_MS);
  }

  clearTick() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
