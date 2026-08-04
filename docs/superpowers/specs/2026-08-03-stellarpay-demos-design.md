# stellarpay Demos & Launch (Plan B) — Design Spec

**Date:** 2026-08-03 · **Deadline:** Wednesday 2026-08-05 (hackathon submission)
**Parent spec:** `docs/superpowers/specs/2026-07-31-stellarpay-design.md` §7 (refined here into a standalone spec)
**Prerequisite:** Plan A is complete at `main` (7 packages, 88 tests green, live-testnet verified). Repo: https://github.com/yripper/stellarpay

## 1. Goal

Ship the judge-facing half of stellarpay: six Railway-hosted demo services forming a live "Stellar Intel" micro-economy, plus launch collateral (npm-publish readiness, README demo links, demo-video guidance). Judges must be able to (a) hit a paid API with curl and see a 402, (b) press one button and watch an AI agent buy intel with real testnet settlements streaming onto a dashboard, and (c) trace a payment to stellar.expert.

## 2. Demo economy — "Stellar Intel" (decided)

One coherent narrative: **every service sells Stellar network intelligence**, computed live from public Horizon/Soroban RPC testnet endpoints — zero external API keys, real data, real payments.

| Service | Sells | Scheme(s) |
|---|---|---|
| express-api (flagship) | Asset reports & account deep-dives | x402 **and** mpp-charge (sponsored) + free teaser route |
| hono-api | Whale alerts (recent large payments) | x402 only — the "~6-line diff" proof |
| fastify-api | Fee & network stats | mpp-charge only |
| mcp-server ("Stellar Intel MCP") | Deep-dive tools for agents | per-tool prices via `toolPayments` |
| dashboard | Nothing — it's the shop window | receives receipts, streams SSE |
| agent | Nothing — it's the buyer | pays via `createPayingFetch` + paid MCP transport |

Data sources (Horizon testnet, all public): `/fee_stats`, `/assets?asset_code&asset_issuer`, `/accounts/{id}` (+ `/payments`, `/operations` sub-resources), `/payments?order=desc&limit=N` for whale scans, `/order_book`. Exact per-endpoint composition is the plan's job; the constraint is **real data only, no lorem ipsum, no external API keys**.

Prices: dollar-string prices in the $0.005–$0.05 range (testnet USDC; small enough that the funded buyer account lasts all judging week). All routes/tools priced individually in the plan.

## 3. Repo placement & shared demo code

Per parent spec §2, demos live in `examples/` as **private** pnpm workspace members (never published):

```
examples/
  express-api/   hono-api/   fastify-api/
  mcp-server/    dashboard/  agent/
scripts/setup-demo.ts
docs/demo-video.md
```

Each example depends on the `@stellarpay-sdk/*` packages via `workspace:*` (resolved locally; these manifests are private so the publish-blocking rule from Plan A does not apply).

**Receipt forwarding is the one piece of shared demo logic.** Rather than a new shared package (YAGNI — examples are private), each API service includes a small local `reportReceipt.ts` helper (identical file, ~20 lines, copy per service is acceptable for examples): builds `onPayment` callbacks (core `StellarpayConfig.onPayment: (receipt: Receipt) => void`, `packages/core/src/types.ts:67`; mcp `ToolPaymentsConfig.onPayment`) that POST the receipt plus `{service: "<name>"}` to the dashboard. Fire-and-forget with a short timeout; failures are swallowed (core already isolates `onPayment` errors, but the helper must not hang the event loop either).

**Dashboard ingestion contract** (the inter-service interface):

- `POST {DASHBOARD_URL}/ingest`
- Header `Authorization: Bearer {INGEST_SECRET}` (shared secret, one value across all services)
- Body: `{ service: string, kind: "receipt", receipt: Receipt }` or `{ service: "agent", kind: "agent-log", message: string }`
- Responses: `204` accepted, `401` bad/missing secret, `400` malformed body. Malformed bodies are rejected without crashing and without disconnecting SSE clients.

The `agent-log` kind is what makes the unleash button theatrical: the agent posts short narration lines ("Mission: brief on USDC… buying asset_stats for $0.01") that interleave with real receipts on the feed.

## 4. Service designs

### 4.1 express-api (flagship)

- Free: `GET /` (self-describing JSON index of routes + prices), `GET /asset/:code/:issuer/summary` (teaser: name, supply, holder count).
- x402: `GET /asset/:code/:issuer/report` — full asset report.
- mpp-charge (sponsored via `sponsorSecret`): `GET /account/:id/deep-dive` — balances, recent activity, flags.
- Built with `stellarpayExpress` (`packages/express/src/index.ts:36`); one config showing both schemes + free routes coexisting — the hero-snippet story, live.

### 4.2 hono-api — the judging-criterion proof

- Free: `GET /` index.
- x402: `GET /alerts/whales` — N largest recent testnet payments with stellar.expert links.
- Its README centers a printed **~6-line diff**: the app before (open) and after (`stellarpayHono`, `packages/hono/src/index.ts:5`) — the "add a paywall in minutes" claim made verifiable.

### 4.3 fastify-api

- Free: `GET /` index.
- mpp-charge: `GET /stats/fees` — current fee stats + congestion read.
- Minimal on purpose: same shape as express, different adapter import (`stellarpayFastify`, `packages/fastify/src/index.ts:53`).

### 4.4 mcp-server — "Stellar Intel MCP"

- Streamable-HTTP MCP server exposing:
  - Free tool: `network_status` (latest ledger, fee stats, testnet health) — proves free/paid coexist per-tool.
  - Paid tools (via `toolPayments`, `packages/mcp/src/server.ts:88`, `prices` map): `account_summary`, `asset_stats`, `whale_watch` — each a genuinely useful Horizon/RPC composition.
- `tools/list` is always free. Unpaid calls to paid tools return the MPP challenge (McpError −32042) — the SDK handles this; the demo just configures it.

### 4.5 dashboard — dark mission-control (decided)

- Aesthetic: dark fintech/ops. Live payment feed as a terminal-style stream; per-event: service, route/tool, scheme badge (x402 / mpp-charge), amount, payer (truncated), stellar.expert tx link when `txHash` present; running totals (count + USDC volume); big **"UNLEASH THE AGENT"** button.
- Stack: Hono + one static HTML/CSS/JS page (no frontend framework — YAGNI), native `EventSource` SSE.
- Endpoints: `GET /` (page), `GET /events` (SSE; replays the buffer on connect, then live), `POST /ingest` (§3), `POST /unleash` (public, no auth — it's the judge's button; rate-limited).
- State: in-memory ring buffer (last 200 events). Restart loses history — acceptable demo infra, stated in its README.
- `/unleash`: enforces a global cooldown (1 run / 2 min, in-memory timestamp). Within cooldown → `429` with `retryAfterSeconds`, and the page shows the countdown on the button. Otherwise → `POST {AGENT_URL}/run` with `Authorization: Bearer {INGEST_SECRET}` and returns `202`.

### 4.6 agent — Claude-driven with scripted fallback (decided)

- `POST /run` (Bearer `INGEST_SECRET`; only the dashboard calls it). Also fires one run on boot so the feed is never empty when judges first open the dashboard.
- **Primary path:** a Claude tool-use loop (model `claude-sonnet-5`, user's `ANTHROPIC_API_KEY` in Railway env) given a mission — e.g. "Produce a market brief on testnet USDC. You have a funded wallet; buy whatever intel you need." Its tools: the paid MCP tools (via `wrapPaidMcpClient` + `payingHttpTransport`, `packages/mcp/src/client.ts:36,55`) and the three HTTP APIs (via `createPayingFetch`, `packages/client/src/index.ts:100`). Missions rotate from a small hardcoded list so consecutive runs differ.
- **Spend limits are load-bearing demo copy:** `limits: { maxPerCall, maxTotal }` set per run; the agent narrates its remaining budget in `agent-log` lines. A `SpendLimitExceeded` refusal is a *feature* to show, not an error to hide.
- **Fallback:** if the Claude API call fails (auth, quota, network), a deterministic scripted tour runs instead — one paid call per API service + two paid MCP tools, with matching `agent-log` narration — so the judge's button press always produces visible payments. The run result (`mode: "claude" | "scripted"`) is posted to the feed.
- The agent's wallet is the funded smoke-test buyer (`SMOKE_BUYER_SECRET` values reused under demo var names).

## 5. Railway deployment (decided: new project, generated domains)

- One **new** Railway project `stellarpay-demo` in the user's default workspace, created and configured **via the railway MCP tools** (`create_project`, `create_service`, `set_variables`, `generate_domain`, `deploy`, `get_logs`).
- Six services, each sourced from GitHub `yripper/stellarpay` with root directory `examples/<name>`; pnpm-workspace-aware build (install from repo root; per-service start command). Exact builder config (Railpack/Nixpacks settings, watch paths) is resolved at plan time against Railway docs via the railway MCP `docs_search`.
- Each service gets a generated `*.up.railway.app` domain; those URLs go into the README and dashboard config.
- Env vars (set per service, values from the existing local `.env` — never committed, never echoed):

| Var | Used by | Notes |
|---|---|---|
| `DEMO_PAYTO` | 3 APIs, mcp-server | seller public key (G…) |
| `DEMO_MPP_SECRET` | express, fastify, mcp-server | mppx HMAC secret |
| `DEMO_SPONSOR_SECRET` | express | sponsored-gas leg (optional) |
| `DEMO_FACILITATOR_KEY` | express, hono | OZ facilitator Bearer key |
| `DEMO_BUYER_SECRET` | agent | funded buyer seed (S…) |
| `ANTHROPIC_API_KEY` | agent | user-provided |
| `INGEST_SECRET` | all six | one shared random value |
| `DASHBOARD_URL`, `AGENT_URL` | cross-links | public generated domains |
| `PORT` | all | Railway-injected; services must bind it |

- Every example also runs locally via `pnpm dev` reading `examples/<name>/.env` (each with a committed `.env.example` documenting every var).
- Deployment is **tasked incrementally**: dashboard first (so later services have a `DASHBOARD_URL`), then the three APIs + mcp-server, then agent, then a live end-to-end verification task (curl each free route, one paid route via the SDK client, one unleash run watched via `get_logs` + the SSE feed).

## 6. Ops script — `scripts/setup-demo.ts`

Idempotent provisioning/verification for demo identities, runnable before demos and by anyone cloning the repo:

- For buyer + payTo accounts: check existence on Horizon testnet; friendbot-fund if missing.
- Check/establish the testnet-USDC trustline (SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`) via `submitViaChannels` from `@stellarpay-sdk/shared`.
- Detect a zero-USDC buyer balance and print the manual faucet instruction (the faucet step cannot be automated).
- Prints a ✅/⚠️ table; never prints secret seeds.

## 7. Launch collateral

1. **Manifest `repository` field (early task):** add `"repository": { "type": "git", "url": "git+https://github.com/yripper/stellarpay.git", "directory": "packages/<name>" }` to all six publishable manifests. Blocks nothing else; do it first.
2. **README demo links:** replace every `<!-- filled by Plan B -->` placeholder with live Railway URLs, plus a "try it in 10 seconds" curl block (free route → 402 on a paid route) and the dashboard link front-and-center.
3. **Per-example READMEs:** what it sells, its routes/tools + prices, the env vars, `pnpm dev` instructions; hono-api's centers the 6-line diff.
4. **Publish readiness:** verify `PUBLISHING.md` steps are current post-Plan-B (repository fields now present); the **user runs `npm publish` personally** — no plan task executes it.
5. **`docs/demo-video.md`:** a shot list for a ~3-minute judge video: (1) hero snippet in the README, (2) curl a paid route → raw 402 challenge, (3) dashboard live feed, (4) UNLEASH → agent narration + receipts landing, (5) click through to stellar.expert settlement, (6) the hono 6-line diff. Includes suggested talk track per shot. Recording itself is the user's task, early enough to re-shoot.

## 8. Error handling & demo resilience

- **The button never fizzles:** Claude-path failure → scripted fallback (§4.6); cooldown → visible countdown, never a silent no-op.
- **Feed never dies:** `/ingest` rejects bad payloads with 4xx without affecting SSE clients; SSE handlers tolerate client disconnects; dashboard has no code path that throws on malformed receipt fields (render unknowns as `—`).
- **Paywalls degrade per SDK contract:** facilitator/RPC outage → the SDK's `503 settlement_unavailable`; demos add nothing on top.
- **Secrets:** only in Railway env vars and local untracked `.env` files; no secret ever logged, echoed into Railway build logs, or committed. `INGEST_SECRET` comparison happens on every ingest/run request.
- **Agent spend:** hard `limits` on every run; `SpendLimitExceeded` is caught, narrated, and ends the run gracefully.

## 9. Testing

- **Unit (vitest, only where the demo owns logic):** dashboard ring buffer + ingestion auth (401/400/204 paths), unleash cooldown math, agent fallback selection (Claude-path failure → scripted), receipt-forwarder fire-and-forget (does not throw/hang on dashboard outage). Examples with no owned logic (fastify-api) need no test suite. Root vitest include glob must not break under `pnpm --filter` (same per-package-config pattern as Plan A).
- **Local integration:** run dashboard + one API locally, mocked settlement boundary as in Plan A's integration test, assert a receipt POSTed end-to-end onto the SSE stream.
- **Live verification (manual task, real testnet):** the §5 end-to-end check against the deployed Railway URLs, plus one full unleash run observed on the live dashboard. Performed before README links are declared final.

## 10. Stretch (optional tail tasks only — plan them last, clearly skippable)

- **mpp-channel feed demo:** per-tick priced feed over a channel session (requires deploying the `one-way-channel` Soroban contract).
- **Agent treasury with policy signers:** smart-account wallet with on-chain daily cap + allow-list.
- Neither blocks submission; each is a self-contained tail task group.

## 11. Out of scope

- Everything in parent spec §12 (mainnet, x402 v1, MPP push, Python).
- Persistent dashboard storage, user accounts, HTTPS/auth beyond shared secrets.
- Publishing execution (user-run), video recording execution (user-run, guided by `docs/demo-video.md`).
- CI for examples (unit tests run in the normal suite; deployment is not CI-gated).

## 12. Global constraints (must appear verbatim in the plan's Global Constraints)

- Conventional commits; **NEVER any `Co-Authored-By`, Claude, or AI attribution line in any commit** — repeat this in every implementer dispatch and verify `git log` after each task.
- Never print, log, or commit secrets: `.env` values, `S...` seeds, `DEMO_MPP_SECRET`, `DEMO_FACILITATOR_KEY`, `INGEST_SECRET`, `ANTHROPIC_API_KEY`.
- Railway operations go through the railway MCP tools, not the Railway CLI/web.
- Verify every upstream API name against the installed `node_modules` (`.d.ts`) before writing code that uses it; never guess.
- Judge-quality bar for all demo UX and copy: real data, coherent Stellar Intel narrative, no lorem ipsum, no dead buttons.
- `examples/*` are `"private": true` and are never published.
- Module-doc convention applies: each example gets/updates docs per CLAUDE.md before its task completes.
