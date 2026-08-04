# stellarpay dashboard

The hub of the stellarpay hackathon demo. Four paid API services (built in later demo tasks)
POST payment receipts and agent narration lines to this service's `/ingest` endpoint, and it
fans them out live to any browser watching `/events` over Server-Sent Events (SSE). A big
"Unleash the agent" button on the dashboard triggers a configured agent service's `/run`
endpoint, rate-limited by a global cooldown so it can't be hammered during the demo.

Part of the [stellarpay](../../README.md) SDK's `examples/` directory. See
[`docs/modules/examples.md`](../../docs/modules/examples.md) for the full module doc
(endpoints, internals, gotchas).

**Screenshot:** _(to be captured from a live run before the demo recording — run `pnpm dev`
and open http://localhost:4600)_

## Dashboard UI

`public/index.html` is a single self-contained dark "mission control" page — no build step,
no CDN dependencies (Railway serves the file directly, `src/main.ts:19,23-25`). It opens an
`EventSource` on `/events` and renders each `FeedEvent` as a row in a live feed (CSS
`column-reverse`, so the newest row appears on top without any DOM reordering): timestamp,
paying service, a scheme badge (`x402` amber / `mpp` cyan — anything other than the literal
string `"x402"` renders as the `mpp`-styled badge), the route or tool name, amount + asset,
a truncated payer address (`GABC…MNOP`), and a `stellar.expert` testnet explorer link
(`https://stellar.expert/explorer/testnet/tx/<txHash>`) when the receipt carries a `txHash`.
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

## Endpoints

- `GET /healthz` — `200 { ok: true }`.
- `GET /` — serves `public/index.html`, the mission-control dashboard UI (see below).
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
