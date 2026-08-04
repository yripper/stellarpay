# examples/ — Demo Services

## Purpose

`examples/` holds standalone demo services that showcase the stellarpay SDK end-to-end for
the hackathon judging round. Each service is its own `@stellarpay-examples/<name>` workspace
package — `"private": true`, no build step (`tsx` runs `src/main.ts` directly), and its own
`vitest.config.ts` so `pnpm --filter` works per-package. `examples/dashboard` is the first
and the hub: four paid API services (later tasks) POST payment receipts to its `/ingest`
endpoint, and it fans them out to browsers over Server-Sent Events (SSE).

## Structure

- `examples/dashboard/src/buffer.ts` — `FeedEvent` type + `createFeedBuffer()`, a
  fixed-capacity in-memory ring buffer of feed events.
- `examples/dashboard/src/cooldown.ts` — `createCooldown()`, a global rate limiter for the
  `/unleash` endpoint with an injectable clock.
- `examples/dashboard/src/ingest.ts` — `parseIngestBody()`, hand-rolled validation of the
  `/ingest` request body (two shapes: `receipt` or `agent-log`).
- `examples/dashboard/src/server.ts` — `buildApp(deps): Hono`, the pure app factory wiring
  the buffer, cooldown, and ingest validator into four routes.
- `examples/dashboard/src/main.ts` — entrypoint: loads `.env`, reads `INGEST_SECRET`/
  `AGENT_URL`/`PORT`, reads `public/index.html`, and binds `buildApp()`'s `Hono` instance to
  a socket via `@hono/node-server`'s `serve()`.
- `examples/dashboard/public/index.html` — served at `GET /`; the real dashboard UI (dark
  "mission control" theme). Self-contained: inline `<style>`/`<script>`, no build step, no
  CDN dependency. Opens an `EventSource` on `/events` and renders each `FeedEvent` as a feed
  row (or an italic narration line for `kind: "agent-log"`); drives the "▶ UNLEASH THE AGENT"
  button against `/unleash`, including its 202/429/503 states and cooldown countdown. See
  `examples/dashboard/README.md`'s "Dashboard UI" section for the full field-by-field
  breakdown.
- `examples/dashboard/test/{buffer,cooldown,ingest,server}.test.ts` — unit tests for the
  three pure modules plus HTTP-level tests against `buildApp()` via Hono's `app.request()`
  (no socket).

## Endpoints / Public Surface

`examples/dashboard`'s HTTP surface (`examples/dashboard/src/server.ts:18-92`):

- `GET /healthz` — `200 { ok: true }`. Open, no auth (`server.ts:27`).
- `GET /` — `200`, serves the `html` string passed into `buildApp()` (`server.ts:28`).
- `POST /ingest` — header `Authorization: Bearer <INGEST_SECRET>`; JSON body
  `{ service: string, kind: "receipt", receipt: object }` or
  `{ service: string, kind: "agent-log", message: string }`. `401` on missing/wrong bearer
  token, `400` on malformed JSON or a body `parseIngestBody()` rejects, `204` on success
  (`server.ts:30-49`). A successful ingest stamps `at` server-side, pushes onto the ring
  buffer, and fans the resulting `FeedEvent` out to every live `/events` subscriber.
- `GET /events` — SSE stream of `FeedEvent` JSON. On connect, replays the full current
  buffer (oldest first) as SSE frames (`data` = `JSON.stringify(event)`, `id` = `seq`), then
  stays open and pushes new events as they arrive. Sends an `event: ping` heartbeat frame
  every 25s to keep proxies from idling the connection out (`server.ts:51-73`).
- `POST /unleash` — fires the configured agent's `/run` endpoint. `503 { error:
  "agent_not_configured" }` if `agentUrl` is unset; `429 { error: "cooldown",
  retryAfterSeconds }` if within the cooldown window; otherwise `202 { status: "unleashed"
  }` and a fire-and-forget `POST <agentUrl>/run` with the ingest secret as bearer auth and a
  5s timeout — an unreachable or failing agent never turns the `202` into an error
  (`server.ts:75-89`).

TS surface consumed by later tasks:

- `buildApp(deps: Deps): Hono` (`examples/dashboard/src/server.ts:18`) — `Deps` = `{
  ingestSecret: string; agentUrl?: string; cooldown?: Cooldown; agentFetch?: typeof fetch;
  html: string }` (`server.ts:7-15`).
- `FeedEvent` (`examples/dashboard/src/buffer.ts:2-11`) — `{ seq: number; at: string;
  service: string; kind: "receipt" | "agent-log"; receipt?: Record<string, unknown>;
  message?: string }`.

## Key Methods (`file:line`)

- `createFeedBuffer(capacity: number)` (`examples/dashboard/src/buffer.ts:14-28`) — returns
  `{ push(e), list() }`. `push` assigns a monotonically increasing `seq` (keeps counting
  across evictions) and evicts the oldest event once `capacity` is exceeded
  (`buffer.ts:18-23`). `list()` returns the live array by reference as `readonly FeedEvent[]`.
- `createCooldown(intervalMs, now?)` (`examples/dashboard/src/cooldown.ts:2-16`) — returns
  `{ check(), trigger() }`. `check()` returns `{ ok: true }` until `trigger()` has been
  called and less than `intervalMs` has elapsed since, in which case it returns `{ ok:
  false, retryAfterSeconds }` with `retryAfterSeconds = Math.ceil(remainingMs / 1000)`
  (`cooldown.ts:5-11`). `now` is injectable — `buildApp()` uses `Date.now` by default, tests
  pass a fake clock via `deps.cooldown`.
- `parseIngestBody(body: unknown)` (`examples/dashboard/src/ingest.ts:8-21`) — returns the
  parsed `Omit<FeedEvent, "seq" | "at">` or `undefined`. Rejects non-objects, empty
  `service`, a `receipt` shape whose `receipt` field isn't a plain object, an `agent-log`
  shape with an empty `message`, and any other `kind`.
- `buildApp(deps: Deps)` (`examples/dashboard/src/server.ts:18-92`) — constructs one
  `createFeedBuffer(200)`, one `Set` of SSE subscriber callbacks, and either `deps.cooldown`
  or a fresh `createCooldown(120_000)` (2-minute default), then registers the four routes
  above closed over those instances.
- `main.ts` entrypoint (`examples/dashboard/src/main.ts:1-25`) — loads `.env` via Node 22's
  `process.loadEnvFile()` guarded against `ENOENT` (`main.ts:6-11`, same pattern as
  `scripts/smoke.ts:39-44`), exits 1 if `INGEST_SECRET` is unset (`main.ts:14-17`), reads
  `public/index.html` relative to the module URL (`main.ts:19`), and binds via
  `@hono/node-server`'s `serve({ fetch: app.fetch, port })` (`main.ts:23-25`).

## Dependencies

- `hono` (^4, pinned to `4.12.33` in the lockfile) — `Hono`, `Context`, and
  `streamSSE`/`SSEStreamingApi` from `hono/streaming`
  (`node_modules/hono/dist/types/helper/streaming/sse.d.ts:13`).
- `@hono/node-server` (^2.0.12) — `serve()` binds the `Hono` fetch handler to a Node socket;
  same usage pattern as `scripts/smoke.ts:229`.
- `tsx` (^4.19.0) — runtime dependency (not a devDependency): Railway's start command runs
  `tsx src/main.ts` directly, no build step.
- No `@stellarpay/*` package dependency — the dashboard is transport-agnostic and only
  understands the `/ingest` wire contract; it never imports the SDK.

## Gotchas & Invariants

- **In-memory only, by design.** `createFeedBuffer` and `createCooldown` hold state in
  process memory. A restart loses feed history and resets the cooldown. This is intentional
  demo infra, not a bug — do not add persistence without discussing the tradeoff.
- **Ring buffer capacity is hardcoded to 200** inside `buildApp()` (`server.ts:19`), not
  configurable via `Deps`. If a later task needs a different capacity, that's a deliberate
  API change, not a config tweak.
- **`seq` never resets** even as old events are evicted — `/events`' `id: String(e.seq)`
  SSE field and any future "replay from seq N" logic depend on `seq` being strictly
  increasing across the buffer's whole lifetime, not just the currently retained window.
- **`/ingest` auth failure returns before body parsing.** A request with a bad bearer token
  gets `401` even if the body is also malformed — auth is checked first (`server.ts:31`).
- **One-bad-subscriber isolation.** The `/ingest` handler wraps each subscriber `notify()`
  call in its own `try/catch` (`server.ts:41-47`) so one `/events` stream throwing during
  fan-out can never block delivery to the others.
- **`/events` heartbeat is a comment-style `ping` event**, not real data — it exists purely
  to keep intermediary proxies (Railway's edge included) from treating the SSE connection as
  idle and closing it (`server.ts:65-68`).
- **`/unleash` is fire-and-forget.** The outbound call to `<agentUrl>/run` is not awaited by
  the response; a `.catch()` swallows failures so an unreachable agent still yields `202`.
  The 5s `AbortSignal.timeout` bounds how long the outbound call can hang before it's
  abandoned (`server.ts:80-87`).
- **Cooldown is global, not per-caller.** `createCooldown` tracks a single `lastAt`; there is
  no per-IP or per-token bucketing.
- **`html` is required and injected, not read from disk inside `buildApp()`.** `main.ts`
  reads `public/index.html` and passes its contents in; this keeps `buildApp()` a pure,
  filesystem-free factory that tests can call directly.
- **The dashboard UI treats every receipt field as untrusted and optional.** `receipt` is
  `Record<string, unknown>` end-to-end (`buffer.ts:9`, never validated beyond "is it an
  object" in `ingest.ts:13`); `public/index.html`'s client JS only trusts a field if
  `typeof value === "string" && value !== ""`, otherwise renders `—`. Every interpolated
  value goes through an `esc()` helper before landing in `innerHTML` — there is no other XSS
  guard, so a future change that skips `esc()` on a new field is a real vulnerability, not
  just a style nit.
- **The `x402`/`mpp` badge split is a string-equality check, not an enum.** Any `scheme`
  value other than the exact string `"x402"` (including `undefined` → `"—"`) renders with
  the `mpp`-styled badge class. A future third scheme would silently render as `mpp`-colored
  unless this ternary is revisited.

## Testing

- `examples/dashboard/test/buffer.test.ts` — seq assignment/monotonicity and
  capacity-eviction behavior of `createFeedBuffer`.
- `examples/dashboard/test/cooldown.test.ts` — first-trigger allow, within-window block with
  the correct `retryAfterSeconds`, and allow again once the window has elapsed, using an
  injected fake clock.
- `examples/dashboard/test/ingest.test.ts` — accepts both valid shapes; `it.each` over seven
  malformed-body cases (non-object, wrong types, empty strings, unknown `kind`, etc.).
- `examples/dashboard/test/server.test.ts` — HTTP-level tests via `app.request()` (no real
  socket): `/healthz` open; `/ingest` 401 on missing/wrong bearer, 400 on malformed
  JSON/body, 204 on a valid receipt; `GET /events` replays previously ingested events to a
  newly connected subscriber in `seq` order (reads the SSE stream directly and cancels once
  both buffered events arrive, which drives the same `stream.onAbort()` cleanup path a real
  client disconnect would); `/unleash` 503 with no agent configured, 202 + agent `fetch`
  called with the right URL/headers on first call, 429 with the exact `retryAfterSeconds` on
  a call within the cooldown window, and 202 even when the agent `fetch` rejects.
- Run: `pnpm --filter @stellarpay-examples/dashboard test` (or `pnpm test` from repo root
  covers `packages/*`; the root `vitest.config.ts` glob is scoped to `packages/**`, so
  `examples/*` tests run only via their own per-package `vitest.config.ts` — a deliberate
  choice, see `examples/dashboard/vitest.config.ts`).
- Typecheck: `pnpm --filter @stellarpay-examples/dashboard typecheck` (or `pnpm typecheck`
  from repo root, which runs `pnpm -r typecheck` across every workspace package).

## Verified Against

- Source read and line numbers confirmed 2026-08-04 against the current working tree
  (`examples/dashboard/src/{buffer,cooldown,ingest,server,main}.ts`).
- `hono` resolved at `4.12.33`, `@hono/node-server` at `2.0.12` in `node_modules` — both
  match the versions this doc's line citations were checked against.
- All 21 dashboard tests pass (`buffer`: 3, `cooldown`: 1, `ingest`: 9, `server`: 8);
  `pnpm --filter @stellarpay-examples/dashboard typecheck` and the repo-root `pnpm
  typecheck` (`pnpm -r typecheck`, 9 packages incl. `examples/dashboard`) both succeed; the
  root `pnpm test` suite (`packages/*`, 88 tests) is unaffected.
