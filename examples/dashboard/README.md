# stellarpay dashboard

The hub of the stellarpay hackathon demo. Four paid API services (express-api, hono-api,
fastify-api, mcp-server) POST payment receipts to this service's `/ingest` endpoint; the
agent narration lines on the same feed come from a fifth service, the buying agent itself
(`createNarrator`, `examples/agent/src/narrate.ts:7-11`), not from the sellers. The dashboard
fans everything out live to any browser watching `/events` over Server-Sent Events (SSE). A
big "Unleash the agent" button on the dashboard triggers the agent service's `/run` endpoint,
rate-limited by a global cooldown so it can't be hammered during the demo.

Part of the [stellarpay](../../README.md) SDK's `examples/` directory. See
[`docs/modules/examples.md`](../../docs/modules/examples.md) for the full module doc
(endpoints, internals, gotchas).

**What the page looks like:** a single dark "mission control" page (no build step, no CDN
assets — see "Dashboard UI" below for the full breakdown). A header strip along the top shows
running totals (payment count, summed USDC volume), and — when `DEMO_BUYER_PUBLIC` is set —
the buyer's live USDC/XLM balance read straight from Horizon, next to the "▶ UNLEASH THE
AGENT" button. When `DEMO_PAYTO` is set, a "verify on-chain ↗" bar links out to the seller
account on stellar.expert, framing the claim: every payment in the feed lands in that account,
and that page is not served by us. Below it, a live feed grows upward (newest row on top) as
receipts and narration arrive: each paid-route row shows a timestamp, the paying service, an
amber `x402` or cyan `mpp` scheme badge, the route or tool name, the amount and asset, a
truncated payer address, and — for any receipt that carries a `txHash` (both x402 and
mpp-charge legs now populate it, see `docs/modules/core.md`) — a "settlement ↗" link to the
transaction on stellar.expert; agent narration lines render as italic text instead of a
receipt row. Live at
[dashboard-production-5c18.up.railway.app](https://dashboard-production-5c18.up.railway.app),
or run `pnpm dev` and open `http://localhost:4600` to see it locally.

## Dashboard UI

`public/index.html` is a single self-contained dark "mission control" page — no build step,
no CDN dependencies (Railway serves the file directly, `src/main.ts:19,23-25`). It opens an
`EventSource` on `/events` and renders each `FeedEvent` as a row in a live feed (CSS
`column-reverse`, so the newest row appears on top without any DOM reordering): timestamp,
paying service, a scheme badge (`x402` amber / `mpp` cyan — anything other than the literal
string `"x402"` renders as the `mpp`-styled badge), the route or tool name, amount + asset,
a truncated payer address (`GABC…MNOP`), and a `stellar.expert` testnet explorer link
(`https://stellar.expert/explorer/testnet/tx/<txHash>`) when the receipt carries a `txHash` —
the link condition itself is scheme-agnostic; it just happened to be x402-only before the
mpp-charge leg started populating `txHash` too (see `docs/modules/core.md`).
`agent-log` events render as an italic narration line instead of a receipt row. A header
strip tracks running totals (payment count, summed USDC volume). The receipt payload is
untrusted and opaque (`examples/dashboard/src/buffer.ts:9`), so every field is read
defensively and missing/non-string values render as `—`; every interpolated value is passed
through an `esc()` helper before being written into `innerHTML`.

The "▶ UNLEASH THE AGENT" button POSTs `/unleash` and reflects the real response: `202`
starts a visible 120s cooldown countdown on the button, `429` reads `retryAfterSeconds` from
the body and counts down from that instead, and `503` (no `AGENT_URL` configured) re-enables
the button immediately with an "Agent unavailable right now." message. The SSE connection
uses the browser's native `EventSource`, which auto-reconnects on its own if the stream
drops — no custom reconnect logic needed.

**On-chain proof (independent of our backend).** The page fetches `GET /config` on load to
learn the seller's and buyer's public keys (see Endpoints below); either being unset hides
its affordance entirely — no dead link, no broken panel. When `DEMO_PAYTO` is set, a
"verify on-chain ↗" bar (above the feed) links to
`https://stellar.expert/explorer/testnet/account/<DEMO_PAYTO>` — a third-party block explorer,
not served by this app — framed with copy explaining that every payment in the feed lands in
that account. When `DEMO_BUYER_PUBLIC` is set, the header shows a live USDC/XLM balance panel
that the browser fetches directly from `https://horizon-testnet.stellar.org/accounts/<DEMO_BUYER_PUBLIC>`
(never proxied through this server — the whole point is that the number can't be a canned
value from our own backend) and re-fetches after every new non-`agent-log` feed event, so it
visibly ticks down as the agent spends.

## Endpoints

- `GET /healthz` — `200 { ok: true }`.
- `GET /` — serves `public/index.html`, the mission-control dashboard UI (see below).
- `GET /config` — `200 { payTo: string | null, buyerPublic: string | null }`. Public keys
  only (no auth) — `null` when the corresponding env var is unset. The static page fetches
  this on load to decide whether to show the "verify on-chain" link and the live buyer
  balance panel (`src/server.ts`).
- `POST /ingest` — header `Authorization: Bearer <INGEST_SECRET>`; JSON body
  `{ service, kind: "receipt", receipt: object }` or
  `{ service, kind: "agent-log", message: string }`. `401` bad/missing auth, `400` malformed
  JSON or body, `204` on success.
- `GET /events` — SSE stream of feed events. Replays the current in-memory buffer on
  connect, then streams new events as they arrive.
- `POST /unleash` — fires the configured agent's `/run` endpoint. `503` if `AGENT_URL` is
  unset, `429 { error: "cooldown", retryAfterSeconds }` inside the cooldown window,
  otherwise `202 { status: "unleashed" }`.

## Env vars

See [`.env.example`](./.env.example):

- `INGEST_SECRET` — shared bearer secret for `/ingest` and outbound `/unleash → /run` calls.
  Required; the process exits at startup if it's unset.
- `AGENT_URL` — public base URL of the agent service (no trailing slash). Unset →
  `/unleash` always returns `503`.
- `PORT` — port to bind. Railway injects `PORT` in deployment; local default `4600`.
- `DEMO_PAYTO` — **optional.** Seller account (`G…`) that receives payments; same var name
  the seller services (`express-api`, `hono-api`, `fastify-api`, `mcp-server`) already use.
  When set, the header shows a "verify on-chain ↗" link to that account on stellar.expert, so
  a judge can independently confirm every payment in the feed lands there. Unset → the link
  is hidden entirely, not shown broken.
- `DEMO_BUYER_PUBLIC` — **optional.** Buyer account (`G…`) the agent spends from — a public
  value (it already appears as `payer` in every x402 receipt on the feed). When set, the
  header shows a live USDC/XLM balance panel, fetched directly from Horizon by the browser
  (not proxied through this server) and refreshed after every new receipt so it visibly ticks
  down as the agent spends. Unset → the panel is hidden entirely.

## Run it

```sh
cp .env.example .env   # then fill in INGEST_SECRET
pnpm install            # from the repo root, if you haven't already
pnpm dev                 # tsx watch src/main.ts — no build step
```

`pnpm start` runs the same entrypoint without the watcher (what Railway's start command
uses). `pnpm test` runs the unit + HTTP-level test suite; `pnpm typecheck` runs `tsc --noEmit`.

## In-memory history

The feed buffer (last 200 events) and the unleash cooldown both live in process memory —
this is demo infrastructure by design, not a bug. A restart clears the feed history and
resets the cooldown; there is no database.
