# Hosting — Cloudflare PartyKit backend + Cloudflare Pages frontend (LAN preserved)

How "5 Seconds To Finish" is deployed for free on the web while keeping LAN play. The round
lifecycle is server-authoritative (phases, finish order, broadcasts), so the web backend needs real
per-room compute — not a dumb relay. We use **Cloudflare PartyKit (Durable Objects)** for the
backend and **Cloudflare Pages** for the static frontend (itch.io is a planned secondary host).

## Layout
- `game/lifecycle.js` — transport-agnostic `Game` class (phases, lane assignment, finish tracking,
  broadcasts). Assigns its own numeric player ids so the wire protocol is identical on every host.
- `lan_server.js` — LAN server (Node + `ws`): serves `public/` and runs the lifecycle. Thin adapter
  over `game/lifecycle.js`.
- `wan_server.ts` + `partykit.json` — web server: PartyKit `Party.Server` (one Durable Object per
  room) over the same `game/lifecycle.js`.
- `public/` — static client (`index.html`, `main.js`, Three.js via unpkg CDN). Deployed as-is to
  Pages/itch.

## Client endpoint (`public/main.js`)
The socket URL resolves as `?server=` override → `DEPLOYED_HOST` → page origin, connecting to
`/parties/main/<room>` (room defaults to `main`):
- **LAN:** `DEPLOYED_HOST` empty → uses page origin → works when served by `lan_server.js`
  (`WebSocketServer({ server })` accepts the `/parties/...` path).
- **Local web dev:** `?server=127.0.0.1:1999` against `partykit dev`.
- **Production (Pages/itch):** set `DEPLOYED_HOST` to the deployed PartyKit host, e.g.
  `speedjam.<user>.partykit.dev`. ⚠️ Set this after the first `partykit deploy` (the username comes
  from the PartyKit/GitHub login used).

## Decisions (locked)
- Backend = PartyKit / Durable Objects (free Workers plan; per-room; hibernates when empty).
- Rooms = **single shared room `main`** to start. Multi-room is free later (distinct room ids in the
  URL).
- CI/CD = **Cloudflare Pages (auto from git) + PartyKit deploy (GitHub Action)** now; itch later.
- Keep `lan_server.js` for LAN; logic shared via `game/lifecycle.js` (no duplication).

## Cost (why per-room is fine)
Cloudflare bills active duration (flat 128 MB/DO/sec while not hibernating) + requests (WS msgs
20:1), no per-server overhead. Per-room is isolated and latency-local; empty rooms hibernate (free).
The 100 ms tick blocks hibernation, so `wan_server.ts` **clears the interval when the room empties**.
Free tier (13,000 GB-s/day, 100k req/day) ≈ ~29 active-room-hours/day and ~7 hrs of continuous
4-player relay/day — comfortable for playtesting. DO alarms for phase timing are a later
optimization, not needed now.

## Deploy
- **Backend:** `npm run deploy:wan` (`npx partykit deploy`) → `https://speedjam.<user>.partykit.dev`.
  CI: `.github/workflows/deploy.yml` runs it on push to `main`; set repo secrets `PARTYKIT_LOGIN`
  and `PARTYKIT_TOKEN` (generate via `npx partykit token generate`).
- **Cloudflare Pages:** connect the GitHub repo in the CF dashboard — no build command, **output
  directory `public/`**, production branch `main`. Auto-deploys on push; free PR previews.
- **itch.io (later):** zip the contents of `public/` (index.html at the zip root), upload as an HTML5
  game, mark "played in the browser", enable fullscreen. Automate later with butler + a GitHub
  Action.

## Local dev / verification
1. **Web (local):** `npm run dev:wan` (PartyKit on `127.0.0.1:1999`); serve `public/` and open two
   tabs with `?server=127.0.0.1:1999`; confirm: 3 s countdown → race → first finisher opens 3 s
   grace → all-cross ends early → next countdown; mid-join spectates with rear-facing leader cam.
2. **LAN regression:** `npm start` (`node lan_server.js`), open `http://localhost:8000` in two tabs;
   confirm identical behavior.
3. **Deploy smoke test:** `npm run deploy:wan`; set `DEPLOYED_HOST`; open a Pages preview + two tabs
   against the live `wss://…partykit.dev` and run a full round.

## Later / out of scope
Multi-room/matchmaking, itch.io butler publish step, DO-alarms hibernation optimization, custom
domain on our own Cloudflare account.
