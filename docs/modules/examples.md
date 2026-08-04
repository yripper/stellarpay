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
`examples/fastify-api` is the fourth: a "fee & network stats" API on `@stellarpay/fastify`,
the spec's deliberate no-owned-logic example (spec §9) — its only logic beyond the copied,
already-tested `reportReceipt.ts` is a single guarded Horizon `/fee_stats` mapping. Its one
route settles over **mpp-charge**, so across the three paid services both payment schemes
(x402 and mpp-charge) show up more than once.
`examples/mcp-server` is the fifth and the only one that does not sell HTTP routes at all: a
"Stellar Intel MCP" server on `@stellarpay/mcp` whose **individual MCP tools** are priced, so
an AI agent's `tools/call` is what triggers the on-chain micropayment. One tool
(`network_status`) is free and three are paid, on one server, over one connection.

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
  `fetchWhales()` (network, injected `fetch`). Sorts live Horizon `/payments` native-XLM
  records by amount descending and returns the top 10 in the scanned window — no size floor
  (a fixed threshold was tried and dropped; see the Gotchas entry below).
- `examples/hono-api/src/server.ts` — `buildApp(env): Hono`, the pure app factory that builds
  the `StellarpayConfig`, mounts `stellarpayHono` before the routes, and registers the free
  index/health routes plus the one paywalled whale-alerts route.
- `examples/hono-api/src/main.ts` — entrypoint: `readEnv()`, `buildApp(env)`, then
  `@hono/node-server`'s `serve({ fetch: app.fetch, port: env.port })`.
- `examples/hono-api/test/whales.test.ts` — unit tests for `extractWhales`: descending
  sort/cap behavior, an empty window, a window with fewer native payments than the limit,
  and survival of malformed records. `fetchWhales` (the network half) has no automated
  test — see the Testing section below.
- `examples/fastify-api/src/env.ts` — `Env` type + `readEnv()`, copied per-service from
  `examples/express-api/src/env.ts` with `required` = `["DEMO_PAYTO", "DEMO_MPP_SECRET"]`
  (`env.ts:19`, this service's one route is mpp-charge and needs the HMAC secret) and the port
  default `4603` (`env.ts:30`). `Env` drops `facilitatorKey`/`sponsorSecret` entirely — this
  service never needs an x402 facilitator or gas sponsorship (`env.ts:9-15`).
- `examples/fastify-api/src/reportReceipt.ts` — byte-for-byte copy of
  `examples/express-api/src/reportReceipt.ts`; see that entry above.
- `examples/fastify-api/src/fees.ts` — `fetchFeeStats(f?: typeof fetch)`, the one Horizon
  fetcher: reads live `/fee_stats` and derives a `low`/`moderate`/`high` congestion verdict.
  Takes an injected `fetch` defaulting to global `fetch` so it is testable without network,
  even though this package ships no test suite (brief's explicit deliberate choice).
- `examples/fastify-api/src/server.ts` — `buildApp(env): Promise<FastifyInstance>`, the pure
  (but async — see Gotchas) app factory that builds the `StellarpayConfig`, `await`s
  `app.register(stellarpayFastify, { config })` before declaring any route, and registers the
  free index/health routes plus the one paywalled fee-stats route.
- `examples/fastify-api/src/main.ts` — entrypoint: `readEnv()`, `await buildApp(env)`, then
  `app.listen({ port, host: "0.0.0.0" })`.
- No `test/` directory — spec-sanctioned (spec §9 names fastify-api the no-owned-logic
  example); the copied `reportReceipt.ts` is already covered by Task 4's tests, and `fees.ts`'s
  one fetcher has no automated test despite being injectable.
- `examples/mcp-server/src/env.ts` — `Env` type + `readEnv()`, copied per-service from
  `examples/express-api/src/env.ts` with `required` = `["DEMO_PAYTO", "DEMO_MPP_SECRET"]`
  (`env.ts:19`, every priced tool settles over MPP and needs the HMAC secret) and the port
  default `4604` (`env.ts:30`). `Env` shape is identical to fastify-api's — no
  `facilitatorKey`/`sponsorSecret`, since `toolPayments` has no x402 leg and this service does
  not sponsor gas (`env.ts:9-15`).
- `examples/mcp-server/src/reportReceipt.ts` — byte-for-byte copy of
  `examples/express-api/src/reportReceipt.ts`; see that entry above.
- `examples/mcp-server/src/intel.ts` — the four Horizon-testnet fetchers backing the four
  tools: `networkStatus` (`intel.ts:22`), `accountSummary` (`intel.ts:34`), `assetStats`
  (`intel.ts:63`), `whaleWatch` (`intel.ts:96`), plus the private `assetSupply`/`assetHolders`
  Horizon-2.x adapters (`intel.ts:53,58`) and the pure `extractWhales` sort/cap
  (`intel.ts:111`). Each network fetcher takes an injected `fetch` as its last parameter,
  defaulting to global `fetch`. Kept deliberately separate from the MCP wiring.
- `examples/mcp-server/src/mcp.ts` — `PRICES` (`mcp.ts:8`), `buildPayments(env, report)`
  (`mcp.ts:21`) which constructs the one `toolPayments()` instance, `withoutArgs`
  (`mcp.ts:49`, the schema-less-tool arity adapter — see Gotchas), and
  `buildMcpServer(payments)` (`mcp.ts:58`) which registers the four tools. No HTTP here.
- `examples/mcp-server/src/main.ts` — entrypoint and the only HTTP host: `readEnv()`, the
  reporter, the **module-scope** `buildPayments(...)` (`main.ts:9`), then an Express app with
  `GET /`, `GET /healthz`, and `POST /mcp` (`main.ts:37-58`).
- No `test/` directory and no `test` script — the payment guard is covered by
  `packages/mcp`'s own suite and the copied `reportReceipt.ts` by Task 4's; what is left here
  is Horizon mappings plus SDK wiring. Same posture as `examples/fastify-api`.

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
- `GET /alerts/whales` — **$0.01, x402**. The top 10 largest native-XLM payments among the
  most recent 200 payment operations on testnet — no size floor (`whales.ts:14-29`). Paywall
  key: `"GET /alerts/whales"` — an exact key, not a wildcard, since the route has no path
  parameters (`server.ts:15`). A Horizon failure maps to `502 {"error":"horizon_unavailable"}`
  (`whales.ts:44`); a thin or empty window is a normal `200` with `count` below 10 (or `0`)
  and `largestXlm: null` when there are no native payments at all — never an error.

`examples/fastify-api`'s HTTP surface (`examples/fastify-api/src/server.ts:21-29`):

- `GET /` — free. JSON service index: name and the one route with its price/scheme/what
  (`server.ts:21-24`).
- `GET /healthz` — free. `200 { ok: true }` (`server.ts:25`).
- `GET /stats/fees` — **$0.005, mpp-charge**. Live Horizon `/fee_stats`: `lastLedger`,
  `ledgerCapacityUsage`, a derived `congestion` verdict (`low`/`moderate`/`high`/`unknown`),
  and the raw `feeCharged`/`maxFee` percentile blocks (`fees.ts:12-22`). Paywall key:
  `"GET /stats/fees"` — an exact key, not a wildcard, since the route has no path parameters
  (`server.ts:15`). A Horizon non-OK response maps to `502 {"error":"horizon_unavailable"}`
  (`fees.ts:8`); an unreachable Horizon (thrown `fetch` rejection) is instead caught by
  Fastify's own promise handling and answered `500` — see the Gotchas entry below.

`examples/mcp-server`'s surface is an **MCP tool list**, not an HTTP route table. Prices come
from the `PRICES` constant (`examples/mcp-server/src/mcp.ts:8`) and are the single source of
truth for both the guard and every human-readable description.

- `POST /mcp` (`main.ts:37-58`) — the MCP Streamable HTTP endpoint, **stateless**
  (`sessionIdGenerator: undefined`), no session header required. Four tools
  (`mcp.ts:61-86`):
  - `network_status` — **free**. Horizon root + `/fee_stats`: `network`, `horizonVersion`,
    `latestLedger`, `ledgerCapacityUsage`, `source` (`intel.ts:22-31`). Registered with no
    price, so `toolPayments`' guard is never applied to it — the handler is invoked directly
    (`mcp.ts:61-65`).
  - `account_summary` — **$0.01**. Input `{ account: string }`. `/accounts/{id}`:
    `balances`, `subentries`, `flags` (`intel.ts:34-44`).
  - `asset_stats` — **$0.01**. Input `{ code: string, issuer: string }`. `/assets`:
    `supply`, `holders`, `flags` (`intel.ts:63-77`).
  - `whale_watch` — **$0.02**. No input. `/payments`: `{ window, count, largestXlm, whales,
    source }`, the 10 largest native payments in the 200-op window (`intel.ts:96-108`).
  An unpaid priced tool call answers a JSON-RPC **error** with `code: -32042` and a
  `data.challenges` array (not an `isError` tool result — see the Gotchas entry on the error
  code collision). A Horizon failure inside any tool becomes an `isError: true` tool result,
  never a crash.
- `GET /` — free. JSON index: name, the `POST /mcp` endpoint, and the tool→price map
  (`main.ts:14-21`).
- `GET /healthz` — free. `200 { ok: true }` (`main.ts:22-24`).

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
- `extractWhales(records: unknown[], limit: number): Whale[]`
  (`examples/hono-api/src/whales.ts:14`) — pure sort/cap, no network, no size floor; used
  directly by `test/whales.test.ts`.
- `fetchWhales(f?: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }>`
  (`examples/hono-api/src/whales.ts:42`) — the network half; `f` defaults to global `fetch`.
- `buildApp(env: Env): Hono` (`examples/hono-api/src/server.ts:8`) — `Env` = `{ payTo: string;
  facilitatorKey?: string; dashboardUrl?: string; ingestSecret?: string; port: number }`
  (`examples/hono-api/src/env.ts:9-15`).
- `fetchFeeStats(f?: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }>`
  (`examples/fastify-api/src/fees.ts:6`) — `f` defaults to global `fetch`.
- `buildApp(env: Env): Promise<FastifyInstance>` (`examples/fastify-api/src/server.ts:8`) —
  `Env` = `{ payTo: string; mppSecret: string; dashboardUrl?: string; ingestSecret?: string;
  port: number }` (`examples/fastify-api/src/env.ts:9-15`). `async` because it `await`s
  `app.register(stellarpayFastify, { config })` before returning.
- `PRICES` (`examples/mcp-server/src/mcp.ts:8`) — `{ account_summary: "$0.01", asset_stats:
  "$0.01", whale_watch: "$0.02" }`, `as const`. `network_status` is deliberately absent —
  that absence is what makes it free.
- `buildPayments(env: Env, report: (e: IngestEvent) => void): ToolPayments`
  (`examples/mcp-server/src/mcp.ts:21`) — the one `toolPayments()` call. **Call it once per
  process.**
- `buildMcpServer(payments: ReturnType<typeof buildPayments>): McpServer`
  (`examples/mcp-server/src/mcp.ts:58`) — call it per request.
- `networkStatus(f?)` / `accountSummary(account, f?)` / `assetStats(code, issuer, f?)` /
  `whaleWatch(f?)` (`examples/mcp-server/src/intel.ts:22,34,63,96`) — all
  `Promise<Record<string, unknown>>`; `f` defaults to global `fetch`.

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
- `extractWhales(records, limit)` (`examples/hono-api/src/whales.ts:14-29`) — for each raw
  record, keeps it only if `type === "payment"` and `asset_type === "native"`
  (`whales.ts:18`) and every one of `amount`/`from`/`to`/`created_at`/`transaction_hash` is
  present and a string (`whales.ts:19-24`), then only if `Number(amount)` is finite
  (`whales.ts:25`) — **no lower-bound check**. Survivors sort by `amount` descending and are
  capped to `limit` (`whales.ts:28`). Malformed input (non-objects, `null`, missing fields)
  is filtered out rather than thrown on — `asRec`/`str` narrow everything defensively
  (`whales.ts:5-6`). This function originally took a third `minXlm` argument and dropped
  anything below it; that filter was removed as a product decision after the review found
  live testnet payment volume (~2 XLM typical) meant the fixed 10,000 XLM floor made the
  paid route return an empty list almost always — see the Gotchas entry below.
- `fetchWhales(f)` (`examples/hono-api/src/whales.ts:42-58`) — calls live
  `GET https://horizon-testnet.stellar.org/payments?order=desc&limit=200` (`whales.ts:43`).
  A non-OK response becomes `502 {"error":"horizon_unavailable"}` (`whales.ts:44`); otherwise
  the response's `_embedded.records` are run through `extractWhales` with a hardcoded
  `limit: 10` (`whales.ts:47`) and wrapped in `{ window, count, largestXlm, whales, source:
  "horizon-testnet, live" }` (`whales.ts:48-57`). `count` is always `whales.length`;
  `largestXlm` reads `whales[0]?.amountXlm ?? null` (`whales.ts:53`) — `null` only when the
  window contains zero native payments, never fabricated. Neither the limit (10) nor the
  scan window (200) is configurable via `Env` — changing them is a code change, not a config
  knob.
- `buildApp(env)` (`examples/hono-api/src/server.ts:8-34`) — builds the reporter
  (`server.ts:9`), then a `StellarpayConfig` with `facilitatorApiKey` spread in conditionally
  off `env.facilitatorKey` (`server.ts:14`, same unset-optional-var pattern as express-api).
  `onPayment` forwards every receipt to the reporter (`server.ts:16`).
  `app.use("*", stellarpayHono(config))` is called **before** any route registration
  (`server.ts:19-20`). No `mppSecretKey`/`sponsorSecret`/`rpcUrl` — this service only uses the
  x402 scheme, which needs none of them (`packages/core/src/schemes/x402.ts` never reads
  `rpcUrl`).
- `fetchFeeStats(f)` (`examples/fastify-api/src/fees.ts:6-23`) — a Horizon non-OK response
  becomes `502 {"error":"horizon_unavailable"}` (`fees.ts:8`); otherwise the body is parsed
  through `asRec()` and `Number(data["ledger_capacity_usage"])` drives the verdict:
  `!Number.isFinite` → `"unknown"`, `< 0.5` → `"low"`, `< 0.8` → `"moderate"`, else `"high"`
  (`fees.ts:10-11`). Does **not** catch a thrown `fetch` (DNS/connection failure) itself — that
  rejection propagates to the caller; see the resilience gotcha below for why that is still
  safe on Fastify.
- `buildApp(env)` (`examples/fastify-api/src/server.ts:8-31`) — builds the reporter
  (`server.ts:9`), then a `StellarpayConfig` with no explicit `rpcUrl` — `mppCharge.ts:35`
  falls back to `NETWORKS[cfg.network].rpcUrl` when unset, so omitting it here is intentional,
  not an oversight (`packages/core/src/schemes/mppCharge.ts:35`). `onPayment` forwards every
  receipt to the reporter (`server.ts:16`). `await app.register(stellarpayFastify, { config })`
  is called and awaited **before** any route registration (`server.ts:20`) — `stellarpayFastify`
  is a `skip-override` plugin, so its `onRequest` hook gates the whole app rather than being
  scoped to a child encapsulation context (`packages/fastify/src/index.ts:38-51,75`).
- `buildPayments(env, report)` (`examples/mcp-server/src/mcp.ts:21-36`) — one
  `toolPayments({ payTo, network: "stellar:testnet", mppSecretKey, prices: PRICES, onPayment })`
  call. `onPayment` adapts `ToolPaymentReceipt` (`{ tool, amount, raw?, timestamp }`,
  `packages/mcp/src/server.ts:30-39`) into the dashboard's loose receipt shape by mapping
  `tool → route` and hardcoding `scheme: "mpp-charge"` / `asset: "USDC"` — both are true by
  construction, not guesses: `toolPayments` only ever settles `stellar.charge` in
  `USDC_SAC_TESTNET` (`packages/mcp/src/server.ts:93-101`). `raw` is spread in conditionally
  because the guard never populates it today (`packages/mcp/src/server.ts:124`).
- `withoutArgs(guarded)` (`examples/mcp-server/src/mcp.ts:49-51`) — converts a guarded
  `(args, extra)` handler into the one-argument `(extra)` callback the MCP SDK invokes for
  tools registered without an `inputSchema`. Load-bearing; see the Gotchas entry.
- `buildMcpServer(payments)` (`examples/mcp-server/src/mcp.ts:58-88`) — constructs a fresh
  `McpServer({ name: "stellar-intel", version: "0.1.0" })` and registers the four tools.
  `network_status` is registered with its raw handler (`mcp.ts:64`); the three priced tools go
  through `payments.guard(<tool name>, …)` with the **same string** used as the `PRICES` key
  and the `registerTool` name (`mcp.ts:72,80,85`) — a typo in any one of the three silently
  makes the tool free (`packages/mcp/src/server.ts:114`).
- `assetSupply(rec)` / `assetHolders(rec)` (`examples/mcp-server/src/intel.ts:53-60`) — the
  same pre-2.x → Horizon-2.x fallback as `examples/express-api/src/intel.ts:33-40`, for the
  same reason (see the shared `/assets` gotcha below).
- `whaleWatch(f)` / `extractWhales(records, limit)`
  (`examples/mcp-server/src/intel.ts:96-108,111-126`) — mirrors
  `examples/hono-api/src/whales.ts:14-58` including the **absence** of a size floor; the
  window (200) and cap (10) are module constants (`intel.ts:82-84`), not `Env` fields.
- `POST /mcp` handler (`examples/mcp-server/src/main.ts:37-58`) — registered as a
  **synchronous** handler that immediately enters `void (async () => { … })()` with its own
  `try/catch`, never as a bare `async` handler (see the Express-4 gotcha, which applies here
  exactly as it does to express-api). Per request it builds a fresh `buildMcpServer(payments)`
  + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`, registers a
  `res.on("close")` teardown that closes both with `.catch(() => undefined)` attached (a bare
  `void close()` would leave a rejected teardown promise unhandled, and it fires outside the
  `try/catch`), then `await server.connect(transport)` and
  `await transport.handleRequest(req, res, req.body)`.

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

`examples/fastify-api` (`examples/fastify-api/package.json:12-16`):

- `fastify` (^4, resolved `4.29.1`) — a runtime dependency here, and the declared
  `peerDependency` of `@stellarpay/fastify` (`packages/fastify/package.json:31-33`).
- `@stellarpay/fastify` (`workspace:*`) — `stellarpayFastify(fastify, { config })`, an async
  plugin function registered via `app.register()` (`packages/fastify/src/index.ts:53`).
- `@stellarpay/core` (`workspace:*`) — `StellarpayConfig` only, imported as a type
  (`server.ts:3`).
- `tsx` (^4.19.0) — runtime dependency, same no-build-step rationale as the other examples.
- No HTTP client dependency: Horizon is reached through the platform's global `fetch`
  (`fetchFeeStats`'s injectable `f` param), the dashboard through `reportReceipt.ts`'s
  `doFetch`, same pattern as every other example service.

`examples/mcp-server` (`examples/mcp-server/package.json:11-21`):

- `@modelcontextprotocol/sdk` (^1.30.0, resolved `1.30.0`) — a **direct runtime dependency
  here, not just a type dependency**: `main.ts` imports `StreamableHTTPServerTransport` and
  `mcp.ts` imports `McpServer`, and `@stellarpay/mcp` declares the SDK only as a
  `peerDependency` (`packages/mcp/package.json`), so the consuming app must supply it. Omitting
  it would not be a compile error — it would make every priced tool's 402 path throw mppx's
  "Missing optional dependency" at runtime (`docs/modules/mcp.md`'s peer-dependency gotcha).
- `@stellarpay/mcp` (`workspace:*`) — `toolPayments(config)` (`packages/mcp/src/server.ts:88`).
  The client-side exports (`wrapPaidMcpClient`, `payingHttpTransport`,
  `packages/mcp/src/client.ts:36,55`) are used by this service's README example and by the
  buying agent, not by the server itself.
- `express` (^4, resolved `4.22.2`) — the HTTP host. Only `express.json()` and three routes;
  no stellarpay Express adapter is involved, because the paywall here lives at the MCP
  JSON-RPC layer, not the HTTP layer.
- `zod` (^4, resolved `4.4.3`) — tool input schemas. The MCP SDK accepts `^3.25 || ^4.0`
  (`@modelcontextprotocol/sdk/package.json` peer), and `registerTool`'s `inputSchema` takes a
  raw shape object (`{ account: z.string() }`), not a wrapped `z.object({...})`.
- `tsx` (^4.19.0) — runtime dependency, same no-build-step rationale as the other examples.
- No `@stellarpay/core` dependency: this service never builds a `StellarpayConfig`.

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
  `extractWhales` reads (`whales.ts:19-24`) is present and correctly named. No adaptation was
  needed here; do not assume this generalizes to other Horizon endpoints (see the `/assets`
  gotcha above).
- **There is no fixed XLM threshold — this was a deliberate reversal of the original
  design, made after judge-facing review.** The brief originally specified `extractWhales(records,
  minXlm, limit)` with `minXlm: 10_000`, on the (reasonable-sounding) assumption that "whale
  alerts" implies a size floor. Live testnet data disproved that: of the 200 most recent
  payment operations sampled 2026-08-04, only 25 were native payments and the largest was
  ~2–80 XLM depending on the sample — so a 10,000 XLM floor made `GET /alerts/whales`
  answer `count: 0` on almost every call, which is an honest response but a dead demo when
  a judge is watching an agent pay $0.01 for it on camera. The repo owner's ruling
  (post-review) replaced the floor with "always return the top 10 largest native payments
  in the window, whatever their size, and say so explicitly" — see `extractWhales`'s and
  `fetchWhales`'s Key Methods entries above for the new `{ window, count, largestXlm,
  whales, source }` envelope. **Do not reintroduce a size floor** without revisiting this
  decision; it was made once already and reverted for a documented reason.
- **`count` and `largestXlm` are truthful by construction, not just by convention.** `count`
  is always `whales.length` — never a hardcoded 10 — so a thin window (fewer than 10 native
  payments) is visible in the response, not padded or hidden. `largestXlm` is computed from
  the actual top result (`whales[0]?.amountXlm ?? null`, `whales.ts:53`) and is `null`, not
  `"0"` or omitted, on the one edge case where the window has zero native payments — a
  caller can tell "no data" apart from "the largest was zero" without guessing.
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
- **Cap (10) and scan window (200 most recent payment ops) are hardcoded inside
  `fetchWhales`** (`whales.ts:33-34,47`), not `Env` fields. There is no threshold anymore
  (see above) — a later task wanting a different cap or window size changes the source, not
  `.env`.
- **`extractWhales` is exported and unit-tested directly; `fetchWhales` is not.** The network
  half is exercised only by the manual live-verification procedure below — there is no
  `test/` coverage for the `502` mapping or the `_embedded.records` unwrap.

`examples/fastify-api`:

- **Live Horizon `/fee_stats` matches this service's field assumptions exactly** — the third
  data-point (after `/assets`' mismatch and `/payments`' match) confirming Horizon endpoint
  shapes must be checked individually, never assumed from one endpoint to the next. Confirmed
  2026-08-04 by curling `https://horizon-testnet.stellar.org/fee_stats`: the live response
  carries `last_ledger`, `ledger_capacity_usage` (a decimal string, e.g. `"0.09"`),
  `fee_charged`, and `max_fee` — every field `fetchFeeStats` reads (`fees.ts:15-19`) is present
  and correctly named. No adaptation from the brief's given code was needed.
- **Fastify catches async-handler rejections; Express 4 does not (same finding as hono-api,
  different mechanism).** Read `wrapThenable.js`
  (`node_modules/.pnpm/fastify@4.29.1/node_modules/fastify/lib/wrapThenable.js:8-48`): every
  route handler's return value is awaited through `wrapThenable`, whose rejection branch
  (`:31-47`) calls `reply.send(err)` rather than letting the rejection propagate — Fastify's
  default error handler then answers `500`. Confirmed empirically: a throwaway route wired
  identically to `GET /stats/fees` but calling `fetchFeeStats(brokenFetch)` with a `fetch` that
  throws (simulating an unreachable Horizon) returned `500
  {"statusCode":500,"error":"Internal Server Error","message":"fetch failed"}` via
  `app.inject()`, and a follow-up request to `/healthz` on the same instance still returned
  `200` — the process and the server both survived. **Unlike `examples/express-api`'s `intel()`
  adapter, `GET /stats/fees` needs no rejection-to-502 adapter** — `fetchFeeStats` deliberately
  does not catch a thrown `fetch` itself (`fees.ts:7`, no `try/catch` around `await f(...)`),
  and that is safe specifically because Fastify's own `wrapThenable` is the safety net. Adding
  an adapter here would be redundant machinery, same conclusion as hono-api reached by a
  different framework mechanism.
- **No explicit `rpcUrl` in this service's `StellarpayConfig`, unlike express-api's mpp-charge
  route.** `mppCharge.ts:35` (`packages/core/src/schemes/mppCharge.ts`) falls back to
  `NETWORKS[cfg.network].rpcUrl` when `cfg.rpcUrl` is unset, so `server.ts` omitting it is a
  valid simplification, not a gap — verified by the live paid call below actually settling.
- **The mpp-charge receipt carries no `payer` or `txHash`**, same as express-api's `/deep-dive`
  route (`packages/core/src/schemes/mppCharge.ts:51-54`) — the dashboard's payer/txHash columns
  render `—` for every receipt this service reports.
- **`rpcUrl`/`sponsorSecret`/`facilitatorApiKey` are all absent from `Env`.** This service has
  one route on one scheme (mpp-charge, unsponsored) and needs none of them — a deliberate
  minimal `Env` shape, matching hono-api's precedent of dropping fields a service's single
  scheme doesn't use.

`examples/mcp-server`:

- **`toolPayments()` must be instantiated exactly once per process. This is the invariant that
  breaks the service if you get it wrong.** `main.ts:9` calls `buildPayments(env, report)` at
  module scope, deliberately outside the `/mcp` handler. Its replay-protection store is
  `Store.memory()` (`packages/mcp/src/server.ts:104`), a plain in-process map: moving the call
  into the handler gives every HTTP request an empty store, which silently disables replay
  protection entirely. Only the `McpServer` and `StreamableHTTPServerTransport` are per-request
  — that is what stateless streamable HTTP means, and it does **not** extend to the payment
  engine. Verified live 2026-08-04: a byte-identical credential-bearing JSON-RPC body,
  captured from a successful paid `asset_stats` call and replayed as a *separate* HTTP request
  moments later, came back `-32042 "Payment verification failed."` with a freshly issued
  challenge. Per-request instantiation could not produce that rejection — the second request's
  store would have had no memory of the spent challenge.
- **A priced tool registered without an `inputSchema` must go through `withoutArgs`
  (`mcp.ts:49-51`), or it is permanently unpayable.** The SDK's `executeToolHandler` calls
  `handler(args, extra)` when `tool.inputSchema` is set and `handler(extra)` when it is not
  (`@modelcontextprotocol/sdk/dist/esm/server/mcp.js:229-236`). `toolPayments`' `guard` always
  returns a two-parameter `(args, extra)` function (`packages/mcp/src/server.ts:116`), so
  registering it raw on a schema-less tool hands `extra` to the `args` slot and `undefined` to
  the `extra` slot; mppx then reads the credential off `undefined`
  (`packages/mcp/src/server.ts:121`), finds none, and issues a fresh 402 no matter how
  correctly the caller pays. `whale_watch` is the only such tool today (`mcp.ts:85`). This
  surfaced as a `tsc` error ("Target signature provides too few arguments"), which is the one
  cheap way to catch it — do not silence it with a cast.
- **`-32042` is *also* `ErrorCode.UrlElicitationRequired` in the MCP SDK, and that collision is
  the only reason the payment challenge reaches the client as a JSON-RPC error at all.**
  `McpServer`'s `tools/call` handler catches everything a tool handler throws and converts it
  into an `isError: true` `CallToolResult` — **except** an `McpError` whose code is
  `ErrorCode.UrlElicitationRequired` (`mcp.js:134-141`), and
  `ErrorCode.UrlElicitationRequired = -32042` (`types.js:170`), the same value as mppx's
  `paymentRequiredCode` (`mppx/dist/Mcp.js:2`). If the SDK ever renumbers that code, every
  unpaid priced tool call here starts returning a *successful* JSON-RPC response carrying an
  `isError` result, `McpClient.wrap`'s `isPaymentRequiredError` check stops matching
  (`mppx/dist/mcp-sdk/client/McpClient.js`, which requires a thrown `error.code === -32042`
  with `data.challenges`), and paying clients silently stop paying instead of failing loudly.
  Verified 2026-08-04 by an isolated probe (`McpServer` + `InMemoryTransport`, tool throwing
  `new McpError(-32042, …)`) and end-to-end over HTTP. The companion half also holds:
  `McpError.fromError` only downgrades a `-32042` into a `UrlElicitationRequiredError` when
  `data.elicitations` is present (`types.js:2039-2048`) — mppx's data carries `challenges`, so
  the error stays a plain `McpError` with its challenge payload intact.
- **`network_status` is free because it is absent from `PRICES`, not because of a flag.**
  `guard` returns the handler unwrapped for an unpriced tool (`packages/mcp/src/server.ts:114`),
  and `mcp.ts:64` doesn't call `guard` at all. Conversely, the tool name string appears three
  times per paid tool — as the `PRICES` key, the `registerTool` name, and the `guard` argument
  (`mcp.ts:8,66-72,74-80,82-85`). A mismatch in the `guard` argument makes the tool **free**,
  silently and with no error anywhere; it is not a typo TypeScript can catch.
- **Never register a bare `async` route handler on this Express app** — identical Express-4
  finding to `examples/express-api` (see that gotcha), and it applies with more force here:
  `transport.handleRequest` and everything the MCP layer awaits can reject. `main.ts:37-58`
  therefore uses the same synchronous-handler + inner-async-IIFE + `try/catch` shape, and the
  `res.on("close")` teardown attaches `.catch(() => undefined)` to both `close()` calls since
  that callback fires outside the `try`. Verified 2026-08-04 with a throwaway harness (not
  committed) that wires the real `buildMcpServer`/`buildPayments` into an identical Express app
  with a global `fetch` that throws for every Horizon URL, plus a `process.on("unhandledRejection")`
  tripwire: a `network_status` call returned `200` with `{"isError":true,"content":[{"text":"fetch
  failed"}]}`, `/healthz` still answered `200`, and the tripwire never fired.
- **A Horizon outage inside a *paid* tool still charges the caller.** `guard` settles the
  payment *before* invoking the wrapped handler (`packages/mcp/src/server.ts:121-133`), so a
  Horizon failure after settlement yields a paid-for `isError` result. That ordering lives in
  `packages/mcp`, not here; this service cannot fix it without pre-fetching, which would defeat
  the paywall. Worth knowing before a live demo.
- **`POST /mcp` with a body that isn't valid JSON returns Express's default HTML 400**, not a
  JSON-RPC parse error — `express.json()` throws before the handler runs, so Express's default
  error handler answers. Every *other* malformed input is answered properly by the transport
  (missing `accept` header → `406`; valid JSON that isn't JSON-RPC → `400 {"code":-32700}`;
  unknown method → `-32601`; unknown tool or bad arguments → an `isError` result). All verified
  live 2026-08-04, with `/healthz` still `200` afterward.
- **Stateless mode means no `GET /mcp` and no session header.** `sessionIdGenerator: undefined`
  (`main.ts:39`), and only `POST /mcp` is registered — a client that expects to open a
  standalone SSE stream over `GET /mcp` gets Express's `404`.
- **`reportReceipt.ts` and `env.ts` are duplicated here too, on purpose** — same rule as the
  other example services (see express-api's gotcha).

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
- `examples/hono-api/test/whales.test.ts` — `extractWhales` via four cases: mixed native
  and non-native/wrong-type records sorted descending and capped to `limit` (no size floor,
  so a below-what-was-once-a-threshold `"50"` record still competes on sort order alone); an
  empty input array → `[]`; a window with fewer native payments than the limit → an
  array shorter than `limit`, `length` matching the actual native-payment count; and
  survival of malformed input (`null`, a number, `{}`, a `payment`-typed record missing every
  other field) → `[]`. No test file covers `fetchWhales` or `buildApp()` — out of the brief's
  file list (`test/whales.test.ts` only).
- Run: `pnpm --filter @stellarpay-examples/hono-api test`. Same root-suite caveat as above:
  `pnpm test` from repo root does not include `examples/*`.
- Live verification of `examples/hono-api` is not covered by any automated test — same
  testnet-funds requirement as express-api. Manual procedure: run the dashboard on `:4600` and
  the API on `:4602` with `DASHBOARD_URL`/`INGEST_SECRET` pointing at it, curl `/` and
  `/healthz`, curl `/alerts/whales` bare to see the `402`, then drive it through
  `createPayingFetch({ secret, network: "stellar:testnet", rpcUrl })` and read the dashboard's
  `/events` stream to confirm the receipt arrived.
- `examples/fastify-api` ships **no `test/` directory and no `test` script** — spec-sanctioned
  (spec §9 names it the no-owned-logic example): its only logic beyond the already-tested
  copied `reportReceipt.ts` is `fetchFeeStats`, which takes an injected `fetch` (testable
  offline in principle) but has no automated coverage on purpose. `pnpm test` from repo root is
  unaffected either way — the root suite is scoped to `packages/*` and never touches
  `examples/*` (see the root-suite caveat above).
- Typecheck: `pnpm --filter @stellarpay-examples/fastify-api typecheck` (or `pnpm typecheck`
  from repo root).
- Live verification of `examples/fastify-api` is not covered by any automated test — same
  testnet-funds requirement as the other two paid examples. Manual procedure: run the dashboard
  on `:4600` and the API on `:4603` with `DASHBOARD_URL`/`INGEST_SECRET` pointing at it, curl
  `/` and `/healthz`, curl `/stats/fees` bare to see the `402`, then drive it through
  `createPayingFetch({ secret, network: "stellar:testnet", rpcUrl })` and read the dashboard's
  `/events` stream to confirm the receipt arrived. The Fastify-async-rejection resilience claim
  above is additionally checked via a throwaway `app.inject()` harness (not committed) wiring
  the real `fetchFeeStats` export into a bare Fastify route with a throwing `fetch`.
- `examples/mcp-server` ships **no `test/` directory and no `test` script**, same posture and
  rationale as fastify-api: the payment guard is covered by `packages/mcp`'s own suite
  (`docs/modules/mcp.md`'s Testing section), `reportReceipt.ts` by Task 4's tests, and what
  remains is Horizon mappings plus SDK wiring. The one piece of genuinely owned logic with a
  non-obvious failure mode — `withoutArgs` (`mcp.ts:49-51`) — is guarded by `tsc` rather than a
  test: removing it reintroduces the compile error that caught it. The root `pnpm test` suite is
  unaffected either way (see the root-suite caveat above).
- Typecheck: `pnpm --filter @stellarpay-examples/mcp-server typecheck` (or `pnpm typecheck`
  from repo root).
- Live verification of `examples/mcp-server` is not covered by any automated test — same
  testnet-funds requirement as the other paid examples. Manual procedure: run the dashboard on
  `:4600` and this service on `:4604` with `DASHBOARD_URL`/`INGEST_SECRET` pointing at it; curl
  `/` and `/healthz`; drive `tools/list` and a free `tools/call network_status` over raw curl
  (`content-type: application/json` **and** `accept: application/json, text/event-stream` are
  both required, and responses come back SSE-framed as `event: message\ndata: {…}` even for a
  single JSON-RPC reply); call a priced tool bare to see the `-32042` challenge; then drive the
  paid calls through `wrapPaidMcpClient(client, { secret, network: "stellar:testnet", rpcUrl })`
  over `payingHttpTransport("http://localhost:4604/mcp", fetch)` from `@stellarpay/mcp` and read
  the dashboard's `/events` stream to confirm the receipts arrived.

## Verified Against

- Source read and line numbers confirmed 2026-08-04 against the current working tree
  (`examples/dashboard/src/{buffer,cooldown,ingest,server,main}.ts`,
  `examples/express-api/src/{env,reportReceipt,intel,server,main}.ts`,
  `examples/hono-api/src/{env,reportReceipt,whales,server,main}.ts`,
  `examples/fastify-api/src/{env,reportReceipt,fees,server,main}.ts`,
  `examples/mcp-server/src/{env,reportReceipt,intel,mcp,main}.ts`), plus the cross-package
  citations into `packages/core/src/{config,router,stellarpay,types}.ts`,
  `packages/core/src/schemes/{mppCharge,x402}.ts`, `packages/express/src/index.ts`,
  `packages/hono/src/index.ts`, `packages/fastify/src/index.ts`, and
  `packages/mcp/src/{server,client}.ts`.
- `hono` resolved at `4.12.33`, `@hono/node-server` at `2.0.12`, `express` at `4.22.2`,
  `fastify` at `4.29.1`, `@modelcontextprotocol/sdk` at `1.30.0`, `zod` at `4.4.3`, and
  `mppx` at `0.6.31` in `node_modules` — all match the versions this doc's line citations
  were checked against.
- All 21 dashboard tests pass (`buffer`: 3, `cooldown`: 1, `ingest`: 9, `server`: 8), all
  9 express-api tests pass (`reportReceipt`: 3, `intel`: 6), and both hono-api tests pass
  (`whales`: 2); `examples/fastify-api` and `examples/mcp-server` ship no tests, by design (see
  Testing above). The repo-root `pnpm typecheck` (`pnpm -r typecheck`, every package plus all
  five examples; the root itself declares no `typecheck` script) succeeds; the root `pnpm test`
  suite (`packages/*`, 88 tests) is unaffected — `examples/*` tests run only via their own
  per-package filter, never the root suite.
- Horizon response shapes for `/assets`, `/order_book`, `/accounts`, and
  `/accounts/{id}/payments` re-confirmed 2026-08-04 by curling live
  `horizon-testnet.stellar.org` — this is where the `balances`/`accounts` vs
  `amount`/`num_accounts` gotcha above was caught. `/payments` re-confirmed the same day: live
  native-payment records match `whales.ts`'s field assumptions exactly (no gotcha there).
  `/fee_stats` re-confirmed the same day too: live `last_ledger`/`ledger_capacity_usage`/
  `fee_charged`/`max_fee` match `fees.ts`'s field assumptions exactly (no gotcha there either —
  see the fastify-api gotcha above for the full field list). Horizon's **root document** `/`
  checked for the first time the same day for `examples/mcp-server`'s `networkStatus`: live
  `horizon_version` (`"27.0.0-338710d6…"`) and `history_latest_ledger` (a number) are both
  present and correctly named. All four endpoints `examples/mcp-server` reads — `/`,
  `/fee_stats`, `/accounts/{id}` (`balances`, `subentry_count`, `flags`), `/assets`
  (`balances.authorized`, `accounts.authorized`, `flags` — **not** `amount`/`num_accounts`),
  and `/payments` (`type`, `asset_type`, `amount`, `from`, `to`, `created_at`,
  `transaction_hash`) — were curled individually before the code was written, not assumed from
  one another.
- `examples/express-api` verified live end-to-end 2026-08-04 on Stellar testnet: free routes
  returned real Horizon data, both paid routes issued genuine `402`s (x402 →
  `payment-required` header; mpp-charge → `WWW-Authenticate: Payment … intent="charge"`,
  both quoting `200000` base units = `$0.02` USDC), and both settled to `200` through
  `createPayingFetch`, with both receipts arriving on the dashboard's `/events` feed.
- `examples/hono-api` verified live end-to-end 2026-08-04 on Stellar testnet, **twice**: once
  against the original fixed-threshold design (`GET /` and `GET /healthz` returned the
  expected JSON, `GET /alerts/whales` bare issued a genuine `402` with a `PAYMENT-REQUIRED`
  challenge header quoting `100000` base units = `$0.01` USDC, and the route settled to a
  correctly-shaped but empty `200 {"thresholdXlm":10000,"count":0,"whales":[]}` — real data,
  but a dead-looking demo, which is exactly what prompted the threshold's removal); and again
  after dropping the threshold, same day: the same `402` behavior held, and the paid route
  settled to `200 {"window":"200 most recent payment ops","count":10,"largestXlm":
  "2.0000000","whales":[ …10 real records… ],"source":"horizon-testnet, live"}` — a populated,
  non-empty result with real `from`/`to`/`tx` values, confirming the fix actually produces a
  demo-ready response. The receipt arrived on the dashboard's `/events` feed both times,
  carrying the real payer and `txHash`.
- Hono's automatic-500-on-rejection behavior confirmed both by reading
  `node_modules/.pnpm/hono@4.12.33/node_modules/hono/dist/hono-base.js`'s `#dispatch()` and by
  running a throwaway handler that `await fetch()`s an unreachable host: `app.request()`
  returned `500` and the process stayed alive, in contrast to `examples/express-api`'s
  Express-4 finding above.
- `examples/fastify-api` verified live end-to-end 2026-08-04 on Stellar testnet: `GET /` and
  `GET /healthz` returned the expected JSON, `GET /stats/fees` bare issued a genuine `402` with
  a `WWW-Authenticate: Payment … intent="charge"` challenge header quoting `50000` base units =
  `$0.005` USDC, and the route settled to `200` through `createPayingFetch` with a live
  `congestion: "low"` verdict and real `feeCharged`/`maxFee` percentile blocks, with the receipt
  (`scheme: "mpp-charge"`, `route: "GET /stats/fees"`, `amount: "0.005"`) arriving on the
  dashboard's `/events` feed.
- Fastify's automatic-500-on-rejection behavior confirmed both by reading
  `node_modules/.pnpm/fastify@4.29.1/node_modules/fastify/lib/wrapThenable.js`'s rejection
  branch (`:31-47`, which calls `reply.send(err)` instead of letting the rejection escape) and
  by running a throwaway route wired like `GET /stats/fees` but with a `fetch` that always
  throws: `app.inject()` returned `500 {"statusCode":500,"error":"Internal Server
  Error","message":"fetch failed"}`, and a follow-up `/healthz` request on the same instance
  still returned `200` — the process and the server both survived, same conclusion as Hono's
  finding above, in contrast to `examples/express-api`'s Express-4 finding.
- `examples/mcp-server` verified live end-to-end 2026-08-04 on Stellar testnet against a
  dashboard running on `:4600`. `GET /` and `GET /healthz` returned the expected JSON.
  `tools/list` over raw curl returned all four tools with their descriptions and input schemas
  (`network_status` and `whale_watch` with no properties; `account_summary` requiring
  `account`; `asset_stats` requiring `code` and `issuer`). Free `tools/call network_status`
  returned live Horizon data with no payment (`horizonVersion: "27.0.0-338710d6…"`,
  `latestLedger: 3966232`, `ledgerCapacityUsage: "0.09"`). Unpaid `tools/call` on
  `account_summary` and on `whale_watch` both returned a genuine JSON-RPC
  `error.code: -32042` with one challenge quoting `100000` base units (`$0.01`) and the testnet
  USDC SAC as `currency`. **Four real paid tool calls then settled on-chain** through
  `wrapPaidMcpClient` over `payingHttpTransport`, each returning a settlement receipt with a
  real transaction reference: `asset_stats` → `supply: "99950.0000000", holders: 2` for live
  testnet USDC; `account_summary` → a real `balances` array and `subentries: 0`;
  `whale_watch` → `count: 10, largestXlm: "2.0000000"` with real `from`/`to`/`tx` values; plus
  a second `asset_stats` for the replay test. All three distinct tools' receipts arrived on the
  dashboard's `/events` feed with the right `route` (the tool name) and `amount`
  (`"0.01"`/`"0.01"`/`"0.02"`) — the `payer`/`txHash` columns render `—`, expected for MPP.
  Four consecutive paid calls on one un-restarted process all behaved correctly, and the
  credential-replay rejection described in the once-per-process gotcha above was captured in
  the same session.
