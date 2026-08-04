# examples/ — Demo Services

## Purpose

`examples/` holds standalone demo services that showcase the stellarpay SDK end-to-end for
the hackathon judging round. Each service is its own `@stellarpay-examples/<name>` workspace
package — `"private": true`, no build step (`tsx` runs `src/main.ts` directly), and its own
`vitest.config.ts` so `pnpm --filter` works per-package. `examples/dashboard` is the first
and the hub: four paid API services (later tasks) POST payment receipts to its `/ingest`
endpoint, and it fans them out to browsers over Server-Sent Events (SSE).
`examples/express-api` is the second and the flagship seller: a "Stellar Intel" API that
sells live Horizon-testnet data behind two paywalled routes, one per payment scheme.
`examples/hono-api` is the third: a "whale alerts" API on `@stellarpay/hono` whose README's
job is to prove the paywall is a 6-line diff onto a plain Hono app — one x402 route selling
the 10 largest recent native-XLM payments on testnet.

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
- `examples/express-api/src/env.ts` — `Env` type + `readEnv()`, the `.env` loader and
  required-var guard. Loads at import time; exits 1 naming (never echoing) missing vars.
- `examples/express-api/src/reportReceipt.ts` — `IngestEvent` type + `createReceiptReporter()`,
  the fire-and-forget dashboard `/ingest` client. **Copied verbatim into each paid example
  service** (only the `service` value at the call site differs) — examples are private, so a
  shared package for ~20 lines would be YAGNI.
- `examples/express-api/src/intel.ts` — `IntelResult` type + the three Horizon-testnet
  fetchers (`fetchAssetSummary`, `fetchAssetReport`, `fetchAccountDeepDive`). Each takes an
  injected `fetch` as its last parameter, defaulting to global `fetch`, so tests run offline.
- `examples/express-api/src/server.ts` — `buildApp(env): Express`, the pure app factory that
  builds the `StellarpayConfig`, mounts the paywall, and registers the five routes behind an
  `intel()` handler adapter that keeps a Horizon failure from crashing the process.
- `examples/express-api/src/main.ts` — entrypoint: `readEnv()` then `buildApp(env).listen()`.
- `examples/express-api/test/{reportReceipt,intel}.test.ts` — unit tests for the reporter's
  wire format and failure-swallowing, and for the three fetchers via an injected `fetch`.
- `examples/hono-api/src/env.ts` — `Env` type + `readEnv()`, copied per-service from
  `examples/express-api/src/env.ts` with two changes: `required` is just `["DEMO_PAYTO"]`
  (`env.ts:19`, no MPP scheme on this service) and the port default is `4602` (`env.ts:30`).
  `Env` drops `mppSecret`/`sponsorSecret` entirely — this service never needs them
  (`env.ts:9-15`).
- `examples/hono-api/src/reportReceipt.ts` — byte-for-byte copy of
  `examples/express-api/src/reportReceipt.ts`; see that entry above.
- `examples/hono-api/src/whales.ts` — `Whale` type + `extractWhales()` (pure) and
  `fetchWhales()` (network, injected `fetch`). Filters live Horizon `/payments` records down
  to large native-XLM transfers.
- `examples/hono-api/src/server.ts` — `buildApp(env): Hono`, the pure app factory that builds
  the `StellarpayConfig`, mounts `stellarpayHono` before the routes, and registers the free
  index/health routes plus the one paywalled whale-alerts route.
- `examples/hono-api/src/main.ts` — entrypoint: `readEnv()`, `buildApp(env)`, then
  `@hono/node-server`'s `serve({ fetch: app.fetch, port: env.port })`.
- `examples/hono-api/test/whales.test.ts` — unit tests for `extractWhales`: threshold/sort/cap
  behavior and survival of malformed records. `fetchWhales` (the network half) has no
  automated test — see the Testing section below.

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

`examples/express-api`'s HTTP surface (`examples/express-api/src/server.ts:66-83`). Prices
come from the `PRICES` constant (`server.ts:8`), both `"$0.02"`:

- `GET /` — free. JSON service index: name, network, and every route with its price, scheme,
  and one-line description (`server.ts:66-77`). The first thing a judge curls.
- `GET /healthz` — free. `200 { ok: true }` (`server.ts:78-80`).
- `GET /summary/:code/:issuer` — free. Asset teaser from Horizon `/assets`: `code`, `issuer`,
  `supply`, `holders`, `flags`, `source` (`server.ts:81`).
- `GET /report/:code/:issuer` — **$0.02, x402**. Everything `/summary` returns plus a
  `market` block with the top of the asset's XLM order book (`server.ts:82`). Paywall key:
  `"GET /report/*"` (`server.ts:26`).
- `GET /deep-dive/:account` — **$0.02, mpp-charge**, gas-sponsored when `DEMO_SPONSOR_SECRET`
  is set. Account `balances`, `subentries`, `flags`, and `recentPayments` (10 most recent)
  (`server.ts:83`). Paywall key: `"GET /deep-dive/*"` (`server.ts:27-33`).

Horizon failures map through both paid and free intel routes identically: `404` for an
unknown account or an empty asset record set, `502 {"error":"horizon_unavailable"}` for any
other non-OK Horizon response (`intel.ts:15-20`).

`examples/hono-api`'s HTTP surface (`examples/hono-api/src/server.ts:8-34`):

- `GET /` — free. JSON service index: name, the one route with its price/scheme/description,
  and a `diff` marketing line pointing at the README (`server.ts:21-27`).
- `GET /healthz` — free. `200 { ok: true }` (`server.ts:28`).
- `GET /alerts/whales` — **$0.01, x402**. The 10 largest native-XLM payments among the most
  recent 200 payment operations on testnet, at/above a 10,000 XLM threshold
  (`whales.ts:29-37`). Paywall key: `"GET /alerts/whales"` — an exact key, not a wildcard,
  since the route has no path parameters (`server.ts:15`). A Horizon failure maps to `502
  {"error":"horizon_unavailable"}` (`whales.ts:32`); an empty result set is a normal `200`
  with `count: 0`, not an error.

TS surface consumed by later tasks:

- `buildApp(deps: Deps): Hono` (`examples/dashboard/src/server.ts:18`) — `Deps` = `{
  ingestSecret: string; agentUrl?: string; cooldown?: Cooldown; agentFetch?: typeof fetch;
  html: string }` (`server.ts:7-15`).
- `FeedEvent` (`examples/dashboard/src/buffer.ts:2-11`) — `{ seq: number; at: string;
  service: string; kind: "receipt" | "agent-log"; receipt?: Record<string, unknown>;
  message?: string }`.
- `createReceiptReporter(opts)` (`examples/express-api/src/reportReceipt.ts:9-29`) — `opts` =
  `{ service: string; dashboardUrl: string | undefined; ingestSecret: string | undefined;
  fetchImpl?: typeof fetch; timeoutMs?: number }`, returns `(event: IngestEvent) => void`.
  `IngestEvent` = `{ kind: "receipt"; receipt: Record<string, unknown> } | { kind:
  "agent-log"; message: string }` (`reportReceipt.ts:7`). **Tasks 5–7 copy this file
  verbatim** into `examples/{hono-api,fastify-api,mcp-server}/src/reportReceipt.ts`.
- `readEnv(): Env` (`examples/express-api/src/env.ts:20-35`) — `Env` = `{ payTo: string;
  mppSecret: string; facilitatorKey?: string; sponsorSecret?: string; dashboardUrl?: string;
  ingestSecret?: string; port: number }` (`env.ts:9-17`). Also copied per service.
- `buildApp(env: Env): Express` (`examples/express-api/src/server.ts:10`).
- `IntelResult` (`examples/express-api/src/intel.ts:8`) — `{ status: number; body:
  Record<string, unknown> }`, returned by all three fetchers.
- `Whale` (`examples/hono-api/src/whales.ts:2`) — `{ amountXlm: string; from: string; to:
  string; asset: "XLM"; at: string; tx: string; link: string }`.
- `extractWhales(records: unknown[], minXlm: number, limit: number): Whale[]`
  (`examples/hono-api/src/whales.ts:9`) — pure filter, no network; used directly by
  `test/whales.test.ts`.
- `fetchWhales(f?: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }>`
  (`examples/hono-api/src/whales.ts:30`) — the network half; `f` defaults to global `fetch`.
- `buildApp(env: Env): Hono` (`examples/hono-api/src/server.ts:8`) — `Env` = `{ payTo: string;
  facilitatorKey?: string; dashboardUrl?: string; ingestSecret?: string; port: number }`
  (`examples/hono-api/src/env.ts:9-15`).

## Key Methods (`file:line`)

- `createFeedBuffer(capacity: number)` (`examples/dashboard/src/buffer.ts:14-28`) — returns
  `{ push(e), list() }`. `push` assigns a monotonically increasing `seq` (keeps counting
  across evictions) and evicts the oldest event once `capacity` is exceeded
  (`buffer.ts:18-23`). `list()` returns a snapshot copy (`[...events]`), not the live array,
  typed `readonly FeedEvent[]` (`buffer.ts:24-29`) — `/events`' replay loop (`server.ts:54`)
  iterates it across `await` boundaries, and a concurrent `/ingest`'s capacity eviction
  (`events.shift()` in `push`) mutating the same backing array mid-iteration would otherwise
  skip an element or end the loop early, silently dropping events from the replay.
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
- `createReceiptReporter(opts)` (`examples/express-api/src/reportReceipt.ts:9-29`) — returns
  a `void`-returning closure. Returns early without calling `fetch` when either
  `dashboardUrl` or `ingestSecret` is falsy (`reportReceipt.ts:20`), otherwise POSTs
  `{ service, ...event }` to `${dashboardUrl}/ingest` with `authorization: Bearer
  <ingestSecret>` and an `AbortSignal.timeout` (default 3000ms) (`reportReceipt.ts:21-27`).
  The promise is `void`-discarded and terminated with a two-arm `.then(noop, noop)`, so
  neither a rejected fetch nor a non-2xx response can surface as an unhandled rejection.
- `readEnv()` (`examples/express-api/src/env.ts:20-35`) — filters `["DEMO_PAYTO",
  "DEMO_MPP_SECRET"]` for unset values and, if any are missing, prints only their **names**
  and `process.exit(1)`s (`env.ts:21-26`). Optional vars use `|| undefined` so an empty
  string collapses to absent (`env.ts:31-36`). `.env` is loaded at module import time, above
  the export (`env.ts:1-7`), so the load happens before any consumer reads `process.env`.
- `horizonJson(url, f)` (`examples/express-api/src/intel.ts:15-20`) — the single point where
  Horizon status codes are mapped: `404` passes through as `404`, any other non-OK becomes
  `502`, `200` parses the body through `asRec()`. All three fetchers funnel through it.
- `assetSupply(rec)` / `assetHolders(rec)` (`examples/express-api/src/intel.ts:33-40`) — read
  the flat pre-Horizon-2.x `amount`/`num_accounts` fields first, then fall back to the shape
  live Horizon actually returns today: `balances.authorized` and `accounts.authorized`. See
  the gotcha below.
- `fetchAssetReport(code, issuer, f)` (`examples/express-api/src/intel.ts:61-83`) — calls
  `fetchAssetSummary` first and short-circuits on any non-200 (`intel.ts:62-63`), then
  derives `credit_alphanum4`/`credit_alphanum12` from the code's length (`intel.ts:64`) and
  merges the order book's top bid/ask into a `market` block. An order-book fetch that fails
  degrades to `{ note: "order book unavailable" }` rather than failing the paid request
  (`intel.ts:77-81`).
- `fetchAccountDeepDive(account, f)` (`examples/express-api/src/intel.ts:85-109`) — two
  Horizon calls. Only the `/accounts` call gates the status; a failing `/payments` call
  degrades to an empty `recentPayments` array (`intel.ts:90-97`).
- `buildApp(env)` (`examples/express-api/src/server.ts:10-84`) — builds the reporter
  (`server.ts:11-15`), then the `StellarpayConfig` with `rpcUrl` wired explicitly from
  `NETWORKS["stellar:testnet"].rpcUrl` (`server.ts:21`) and `facilitatorApiKey`/
  `sponsorSecret`/`sponsorGas` spread in conditionally so an unset optional var never lands
  as `undefined` in the config (`server.ts:22-23,31`). `onPayment` forwards every receipt to
  the reporter (`server.ts:34`). `app.use(stellarpayExpress(config))` is called **before**
  any route registration (`server.ts:38`).
- `extractWhales(records, minXlm, limit)` (`examples/hono-api/src/whales.ts:9-25`) — for each
  raw record, keeps it only if `type === "payment"` and `asset_type === "native"`
  (`whales.ts:13`) and every one of `amount`/`from`/`to`/`created_at`/`transaction_hash` is
  present and a string (`whales.ts:14-19`), then only if `Number(amount)` is finite and
  `>= minXlm` (`whales.ts:20-21`). Survivors sort by `amount` descending and are capped to
  `limit` (`whales.ts:24`). Malformed input (non-objects, `null`, missing fields) is filtered
  out rather than thrown on — `asRec`/`str` narrow everything defensively (`whales.ts:5-6`).
- `fetchWhales(f)` (`examples/hono-api/src/whales.ts:30-37`) — calls live
  `GET https://horizon-testnet.stellar.org/payments?order=desc&limit=200`. A non-OK response
  becomes `502 {"error":"horizon_unavailable"}` (`whales.ts:32`); otherwise the response's
  `_embedded.records` are run through `extractWhales` with a hardcoded `minXlm: 10_000` and
  `limit: 10` (`whales.ts:35`) and wrapped in `{ thresholdXlm, count, whales, source:
  "horizon-testnet, live" }` (`whales.ts:36`). Neither threshold nor limit nor the record
  window (200) is configurable via `Env` — changing them is a code change, not a config knob.
- `buildApp(env)` (`examples/hono-api/src/server.ts:8-34`) — builds the reporter
  (`server.ts:9`), then a `StellarpayConfig` with `facilitatorApiKey` spread in conditionally
  off `env.facilitatorKey` (`server.ts:14`, same unset-optional-var pattern as express-api).
  `onPayment` forwards every receipt to the reporter (`server.ts:16`).
  `app.use("*", stellarpayHono(config))` is called **before** any route registration
  (`server.ts:19-20`). No `mppSecretKey`/`sponsorSecret`/`rpcUrl` — this service only uses the
  x402 scheme, which needs none of them (`packages/core/src/schemes/x402.ts` never reads
  `rpcUrl`).

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

`examples/express-api` (`examples/express-api/package.json:12-23`):

- `express` (^4, resolved `4.22.2`) — a runtime dependency here, and the declared
  `peerDependency` of `@stellarpay/express` (`packages/express/package.json:31-33`).
- `@stellarpay/express` (`workspace:*`) — `stellarpayExpress(config)` returns an Express
  `RequestHandler` (`packages/express/src/index.ts:36`).
- `@stellarpay/core` (`workspace:*`) — `StellarpayConfig` (`packages/core/src/types.ts:48`),
  `Receipt` (`types.ts:25`), and the `NETWORKS` presets re-exported from
  `packages/core/src/index.ts:11`.
- `tsx` (^4.19.0) — runtime dependency, same no-build-step rationale as the dashboard.
- No HTTP client dependency: Horizon is reached through the platform's global `fetch`, and
  the dashboard through the same (both injectable for tests).

`examples/hono-api` (`examples/hono-api/package.json:12-19`):

- `hono` (^4) + `@hono/node-server` (^2.0.12) — same versions/roles as the dashboard above.
- `@stellarpay/hono` (`workspace:*`) — `stellarpayHono(config)` returns a Hono
  `MiddlewareHandler` (`packages/hono/src/index.ts:5`).
- `@stellarpay/core` (`workspace:*`) — `StellarpayConfig` only, imported as a type
  (`server.ts:3`).
- `tsx` (^4.19.0) — runtime dependency, same no-build-step rationale as the other examples.
- No HTTP client dependency: Horizon and the dashboard are both reached through the platform's
  global `fetch` (`fetchWhales`'s `f` param and `reportReceipt.ts`'s `doFetch`, both
  injectable for tests).

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

`examples/express-api`:

- **Paywall route keys are wildcard prefixes; Express routes are `:param` patterns — they
  are two different syntaxes describing the same paths.** `config.routes` accepts only
  `"METHOD /exact/path"` or `"METHOD /prefix/*"` (`packages/core/src/config.ts:7`,
  `packages/core/src/router.ts:14-19`), so `/report/:code/:issuer` must be registered in the
  paywall as `"GET /report/*"` (`server.ts:26`). Writing `"GET /report/:code/:issuer"` there
  compiles to an *exact* route that matches literally nothing, silently making the route
  free. This is not a bug to "fix" — keep the two in sync by hand.
- **`matchRoute`'s wildcard requires `prefix + "/"`** (`packages/core/src/router.ts:102`), so
  `"GET /report/*"` covers `/report/USDC/G…` but **not** bare `/report`. A request to
  `/report` is unpaywalled — and also unrouted by Express, so it 404s. Adding a `GET /report`
  index later would silently create a free route.
- **Horizon's own 4xx on malformed input surfaces as `502 horizon_unavailable`, not `400`.**
  `horizonJson` only special-cases `404` (`intel.ts:17-18`); Horizon answers `400 Bad
  Request` for a syntactically invalid issuer, which falls into the `!res.ok` → `502` arm.
  Verified live: `GET /summary/NOPE/GX` → `502`, while a well-formed-but-unknown asset (`GET
  /summary/ZZQQ/GA22K…`) correctly → `404`. Mildly misleading to a caller; a deliberate
  simplification, not an oversight.
- **Live Horizon `/assets` records have no `amount` or `num_accounts` field.** Horizon 2.x
  reports supply and holder count as `balances.authorized` (a string) and
  `accounts.authorized` (a number). `assetSupply`/`assetHolders` (`intel.ts:33-40`) read the
  flat legacy names first and fall back to the nested ones, so both shapes resolve. Reading
  only the flat names — as an earlier draft did — yields `supply: "—", holders: null` against
  live Horizon, i.e. a paid route that returns nothing of value. Confirmed 2026-08-04 by
  curling `https://horizon-testnet.stellar.org/assets?asset_code=USDC`.
- **The mpp-charge receipt carries no `payer` or `txHash`.** `packages/core/src/schemes/
  mppCharge.ts:51-54` builds it from the `Payment-Receipt` response header and sets only
  `scheme`/`route`/`network`/`amount`/`asset`/`raw`/`timestamp`; the payer and transaction
  hash live inside the opaque `raw` payload. On the dashboard those two columns render `—`
  for every MPP row while x402 rows show both. Expected, not a wiring bug.
- **`sponsorGas` and `sponsorSecret` must be set together or not at all.** `parseConfig`
  rejects a route with `sponsorGas: true` when `sponsorSecret` is absent
  (`packages/core/src/config.ts:106-111`), which would throw at `buildApp()` time. Both are
  therefore spread in conditionally off the same `env.sponsorSecret` check
  (`server.ts:23,31`) — never decouple those two conditions.
- **Receipt reporting must stay fire-and-forget.** `onPayment` runs inside the paywall's
  request path; core already wraps it in a `try/catch` (`packages/core/src/stellarpay.ts:96-101`), but the reporter additionally never awaits, never throws, and terminates its
  promise with a two-arm `.then` (`reportReceipt.ts:21-28`). A refactor that `await`s the
  POST, or drops the rejection handler, turns a dashboard outage into slow or failing paid
  requests.
- **`reportReceipt.ts` and `env.ts` are duplicated across example services on purpose.**
  Tasks 5–7 copy them verbatim. Changing the interface here means changing it in every copy;
  do not "DRY" them into a shared package without revisiting that decision (spec §3).
- **`env.ts` loads `.env` as an import side effect** (`env.ts:1-7`), before `readEnv()` is
  ever called. Importing this module for its types alone still performs the load.
- **Never register a bare `async` route handler on this Express app.** Express 4 does not
  catch rejections from `async` handlers, so a rejected handler escapes as an unhandled
  rejection — which terminates the process under Node 22's default
  `--unhandled-rejections=throw`. `intel.ts`'s fetchers deliberately do not swallow `fetch`
  failures (DNS, TLS, connection reset all surface as a thrown `TypeError`), so every intel
  route goes through the `intel()` adapter (`server.ts:51-64`), which catches, logs
  server-side, and answers `502 {"error":"horizon_unavailable"}` behind a `res.headersSent`
  guard. Verified by repro: with a permanently failing global `fetch`, a bare `async (req,
  res) => …` handler produced `UnhandledPromiseRejection: fetch failed` and killed the
  process; through `intel()` the same request returns `502` and the server stays up. A
  judge who paid $0.02 during a Horizon blip would otherwise take the demo down.
- **`buildApp()` is pure but not free.** `stellarpayExpress(config)` calls `stellarpay(config)`
  eagerly (`packages/express/src/index.ts:37-40`), which runs `parseConfig` and instantiates
  a scheme module per configured scheme — so an invalid config throws synchronously from
  `buildApp()`, before `listen()`.

`examples/hono-api`:

- **Live Horizon `/payments` records match this service's field assumptions exactly** —
  unlike `/assets` above. Confirmed 2026-08-04 by curling
  `https://horizon-testnet.stellar.org/payments?order=desc&limit=200`: native payment records
  carry `type: "payment"`, `asset_type: "native"`, `amount` (decimal string, e.g.
  `"2.0000000"`), `from`, `to`, `created_at`, and `transaction_hash` — every field
  `extractWhales` reads (`whales.ts:13-19`) is present and correctly named. No adaptation was
  needed here; do not assume this generalizes to other Horizon endpoints (see the `/assets`
  gotcha above).
- **A live `count: 0` response is normal, not a bug.** Of the 200 most recent payment
  operations sampled 2026-08-04, only 25 were native payments and the largest was ~80 XLM —
  far under the 10,000 XLM threshold. `GET /alerts/whales` legitimately answers `200
  {"thresholdXlm":10000,"count":0,"whales":[],"source":"horizon-testnet, live"}` whenever no
  single payment in the current 200-op window clears the bar. Don't "fix" this by lowering the
  threshold to make demos look busier — it's real data, and the brief fixed the threshold at
  10,000.
- **Hono catches async-handler rejections; Express 4 does not.** Verified both by reading
  `hono-base.js`'s `#dispatch()` (`node_modules/.pnpm/hono@4.12.33/node_modules/hono/dist/
  hono-base.js`) — the single-handler and composed-middleware paths both `.catch((err) =>
  this.#handleError(err, c))` a rejected handler promise, and the default `errorHandler`
  answers `500 "Internal Server Error"` — and empirically: a handler that `await fetch()`s an
  unreachable host and never catches returned `500` via `app.request()`, with the process
  still alive afterward. Unlike `examples/express-api`'s `intel()` adapter
  (`server.ts:51-64`, gotcha above), **`GET /alerts/whales` needs no rejection-to-502
  adapter** — a Horizon outage inside `fetchWhales()`'s unguarded `await f(...)` still yields
  a clean `500` from Hono's own default error handler, and the server keeps serving other
  requests. This is a deliberate difference from the Express example, not an oversight: adding
  an adapter here would be redundant machinery.
- **Threshold (10,000 XLM), cap (10), and scan window (200 most recent payment ops) are all
  hardcoded inside `fetchWhales`** (`whales.ts:35`), not `Env` fields. A later task wanting a
  different threshold changes the source, not `.env`.
- **`extractWhales` is exported and unit-tested directly; `fetchWhales` is not.** The network
  half is exercised only by the manual live-verification procedure below — there is no
  `test/` coverage for the `502` mapping or the `_embedded.records` unwrap.

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
- `examples/express-api/test/reportReceipt.test.ts` — the reporter's wire format (URL,
  `Bearer` header, `{service, ...event}` body) against an injected `fetch`; the
  unset-dashboard no-op; and that a rejecting `fetch` neither throws synchronously nor
  escapes as an unhandled rejection.
- `examples/express-api/test/intel.test.ts` — the three fetchers via an injected `fetch`,
  never the network: curated summary fields; the live Horizon 2.x `balances`/`accounts`
  shape; an empty asset record set → `404`; the report's summary + order-book merge; a
  Horizon `404` passed through; a Horizon `500` → `502`.
- Run: `pnpm --filter @stellarpay-examples/dashboard test` and `pnpm --filter
  @stellarpay-examples/express-api test`. `pnpm test` from repo root covers `packages/*`
  only — the root `vitest.config.ts` glob is scoped to `packages/**`, so `examples/*` tests
  run exclusively via their own per-package `vitest.config.ts`. A deliberate choice; adding
  a new example does **not** extend the root suite, so run its filter explicitly.
- Typecheck: `pnpm --filter @stellarpay-examples/<name> typecheck` (or `pnpm typecheck`
  from repo root, which runs `pnpm -r typecheck` across every workspace package).
- **No server-level test file exists for `examples/express-api`** — the brief's file list
  scoped it to `test/{reportReceipt,intel}.test.ts`. The `intel()` adapter's
  rejection-to-`502` behavior is therefore covered by a manual repro (see the gotcha above),
  not by a regression test. A `test/server.test.ts` driving `buildApp()` with a rejecting
  `fetch` would close that gap.
- Live verification of `examples/express-api` is not covered by any automated test — it
  needs testnet funds. The manual procedure: run the dashboard on `:4600` and the API on
  `:4601` with `DASHBOARD_URL`/`INGEST_SECRET` pointing at it, curl the free routes, curl a
  paid route bare to see the `402`, then drive both paid routes through
  `createPayingFetch({ secret, network: "stellar:testnet", rpcUrl })` from
  `@stellarpay/client` (the pattern in `scripts/smoke.ts:283-293`) and read the dashboard's
  `/events` stream to confirm both receipts arrived.
- `examples/hono-api/test/whales.test.ts` — `extractWhales` via two cases: mixed records
  (below-threshold, above-threshold, `create_account`, a non-native asset) filtered, sorted
  descending, and capped to `limit`; and survival of malformed input (`null`, a number, `{}`,
  a `payment`-typed record missing every other field) → `[]`. No test file covers `fetchWhales`
  or `buildApp()` — out of the brief's file list (`test/whales.test.ts` only).
- Run: `pnpm --filter @stellarpay-examples/hono-api test`. Same root-suite caveat as above:
  `pnpm test` from repo root does not include `examples/*`.
- Live verification of `examples/hono-api` is not covered by any automated test — same
  testnet-funds requirement as express-api. Manual procedure: run the dashboard on `:4600` and
  the API on `:4602` with `DASHBOARD_URL`/`INGEST_SECRET` pointing at it, curl `/` and
  `/healthz`, curl `/alerts/whales` bare to see the `402`, then drive it through
  `createPayingFetch({ secret, network: "stellar:testnet", rpcUrl })` and read the dashboard's
  `/events` stream to confirm the receipt arrived.

## Verified Against

- Source read and line numbers confirmed 2026-08-04 against the current working tree
  (`examples/dashboard/src/{buffer,cooldown,ingest,server,main}.ts`,
  `examples/express-api/src/{env,reportReceipt,intel,server,main}.ts`,
  `examples/hono-api/src/{env,reportReceipt,whales,server,main}.ts`), plus the cross-package
  citations into `packages/core/src/{config,router,stellarpay,types}.ts`,
  `packages/core/src/schemes/{mppCharge,x402}.ts`, `packages/express/src/index.ts`, and
  `packages/hono/src/index.ts`.
- `hono` resolved at `4.12.33`, `@hono/node-server` at `2.0.12`, `express` at `4.22.2` in
  `node_modules` — all match the versions this doc's line citations were checked against.
- All 21 dashboard tests pass (`buffer`: 3, `cooldown`: 1, `ingest`: 9, `server`: 8), all
  9 express-api tests pass (`reportReceipt`: 3, `intel`: 6), and both hono-api tests pass
  (`whales`: 2); the repo-root `pnpm typecheck` (`pnpm -r typecheck`, every package plus all
  three examples; the root itself declares no `typecheck` script) succeeds; the root `pnpm
  test` suite (`packages/*`, 88 tests) is unaffected — `examples/*` tests run only via their
  own per-package filter, never the root suite.
- Horizon response shapes for `/assets`, `/order_book`, `/accounts`, and
  `/accounts/{id}/payments` re-confirmed 2026-08-04 by curling live
  `horizon-testnet.stellar.org` — this is where the `balances`/`accounts` vs
  `amount`/`num_accounts` gotcha above was caught. `/payments` re-confirmed the same day: live
  native-payment records match `whales.ts`'s field assumptions exactly (no gotcha there).
- `examples/express-api` verified live end-to-end 2026-08-04 on Stellar testnet: free routes
  returned real Horizon data, both paid routes issued genuine `402`s (x402 →
  `payment-required` header; mpp-charge → `WWW-Authenticate: Payment … intent="charge"`,
  both quoting `200000` base units = `$0.02` USDC), and both settled to `200` through
  `createPayingFetch`, with both receipts arriving on the dashboard's `/events` feed.
- `examples/hono-api` verified live end-to-end 2026-08-04 on Stellar testnet: `GET /` and `GET
  /healthz` returned the expected JSON, `GET /alerts/whales` bare issued a genuine `402` with
  a `PAYMENT-REQUIRED` challenge header quoting `100000` base units = `$0.01` USDC, and the
  route settled to `200 {"thresholdXlm":10000,"count":0,"whales":[],"source":"horizon-testnet,
  live"}` through `createPayingFetch` (a live, correctly-shaped answer — `count: 0` because no
  single native payment in the sampled window cleared 10,000 XLM, not a bug), with the receipt
  arriving on the dashboard's `/events` feed carrying the real payer and `txHash`.
- Hono's automatic-500-on-rejection behavior confirmed both by reading
  `node_modules/.pnpm/hono@4.12.33/node_modules/hono/dist/hono-base.js`'s `#dispatch()` and by
  running a throwaway handler that `await fetch()`s an unreachable host: `app.request()`
  returned `500` and the process stayed alive, in contrast to `examples/express-api`'s
  Express-4 finding above.
