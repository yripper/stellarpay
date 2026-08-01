# stellarpay — Design Spec

**Date:** 2026-07-31
**Target:** Stellar hackathon, Agentic Payments sub-lane (x402/MPP). Submission Wednesday 2026-08-05.
**Team:** solo dev + Claude. Everything below is testnet unless stated otherwise.

## 1. One-liner & positioning

**stellarpay — one middleware, every machine-payment protocol on Stellar.** Gate any route with x402, MPP charge, or MPP channel by changing one config field; pay for any of them from an agent with one client; monetize an MCP server in one line.

### Landscape: what exists vs. what we add

| Existing | stellarpay adds |
|---|---|
| `@x402/express` / `@x402/hono` / `@x402/fastify` (x402 only, chain-agnostic + `@x402/stellar` scheme) | One config that also speaks MPP charge + channel per route |
| `@x402/fetch` (x402-only client), `mppx/client` (MPP-only client) | `@stellarpay/client` — auto-pays *any* 402, both protocols, with spend limits |
| Nothing | `@stellarpay/mcp` — per-tool-call payments for MCP servers |
| OZ facilitator sponsors x402 gas | Sponsored gas for MPP too (native `feePayer`), plus OZ Channels used for demo ops |

We compose, we don't reimplement: x402 protocol mechanics come from `@x402/core` + `@x402/stellar`, MPP mechanics from `mppx` + `@stellar/mpp`, gasless submission from `@openzeppelin/relayer-plugin-channels`. stellarpay owns the unified config, scheme routing, receipts, and DX.

## 2. Repo architecture

pnpm workspaces, Node >= 22, TypeScript, vitest. Git repo with conventional commits. Living per-module docs under `docs/modules/` (documenting-modules convention, bootstrapped at scaffold time).

```
stellar-402/
  packages/
    core/        # @stellarpay/core    — paywall engine, scheme registry
    express/     # @stellarpay/express — adapter
    hono/        # @stellarpay/hono    — adapter
    fastify/     # @stellarpay/fastify — adapter
    client/      # @stellarpay/client  — agent-side auto-paying fetch + MCP transport helper
    mcp/         # @stellarpay/mcp     — paid MCP server wrapper
    shared/      # internal (unpublished): testnet constants, submitViaChannels, test helpers
  examples/
    express-api/     # flagship paid API: x402 + mpp-charge + free routes
    hono-api/        # "gated in minutes" proof (~6-line diff in its README)
    fastify-api/     # minimal third-framework demo
    mcp-server/      # "Stellar Intel" paid MCP server (crown jewel)
    dashboard/       # live receipts feed (SSE) + "unleash the agent" button
    agent/           # Claude-API-driven buying agent
  scripts/
    setup-demo.ts    # provision demo identities: friendbot, trustlines (via Channels)
  docs/
    modules/         # living docs per package
    ROADMAP.md       # stretch goals (see §8)
  PUBLISHING.md      # exact npm publish steps for the user to run
```

Package naming: npm scope `@stellarpay` (verified available on npm 2026-07-31, along with the bare name `stellarpay`). All packages lockstep version `0.1.0`.

## 3. `@stellarpay/core`

### Config API (README hero snippet)

```ts
import { stellarpay } from "@stellarpay/core";

const paywall = stellarpay({
  network: "stellar:testnet",          // preset picks facilitator URL + USDC SAC
  payTo: "G...RECIPIENT",
  routes: {
    "GET /weather":    { price: "$0.001" },                          // x402 (default)
    "POST /summarize": { price: "$0.01", scheme: "mpp-charge",
                         sponsorGas: true },                         // MPP, server pays fees
    "GET /ticks":      { price: "$0.0001", scheme: "mpp-channel" },  // off-chain vouchers
  },
  onPayment: (receipt) => { /* metering, dashboards, logs */ },
});
```

### Surface

- `paywall.handle(req: Request): Promise<Response | undefined>` — web-standard in/out. Returns a `402` challenge Response, a payment-failure Response, or `undefined` ("paid or free — run the route").
- Route matching: exact `"METHOD /path"` keys plus trailing wildcard (`"GET /api/*"`). Unlisted routes pass through untouched.
- `Receipt` — one normalized type across schemes: `{ scheme, route, payer, amount, asset, txHash | voucherCount, network, timestamp }`.
- Price formats: dollar-string (`"$0.01"`, assumes USDC) or explicit `{ asset, amount }` in base units (SEP-41 contract address).
- Network presets: `stellar:testnet` → OZ facilitator `https://channels.openzeppelin.com/x402/testnet`, testnet USDC SAC; `stellar:pubnet` → mainnet equivalents. Facilitator URL overridable.

### Scheme modules

Each scheme implements one small internal interface — `challenge(route) → Response` and `verifyAndSettle(req, route) → Receipt | failure` — so future schemes are additive.

- **`x402`** — delegates to `@x402/core` facilitator client + `@x402/stellar` `ExactStellarScheme` (x402 v2, `exact` scheme). Challenge: `402` + `PAYMENT-REQUIRED` header; client answers with signed Soroban auth entry in `PAYMENT-SIGNATURE`; verify + settle via the OZ facilitator (sponsored fees). Receipt gets the settlement tx hash.
- **`mpp-charge`** — delegates to `mppx/server` + `@stellar/mpp/charge/server`, pull mode. `sponsorGas: true` wires MPP's native `feePayer.envelopeSigner` (server-held funded testnet account) so clients sign only auth entries. Replay protection via the SDK `Store` — memory by default, interface exposed so users can plug Redis.
- **`mpp-channel`** — delegates to `@stellar/mpp/channel/server` against a deployed `one-way-channel` contract. Per-request cumulative ed25519 voucher commitments, zero on-chain tx per call; `close()` batch-settles. Core supports this scheme from day one; its *hosted demo* is a stretch item (§8).

### OpenZeppelin Channels usage

- x402 settlement already rides Channels via the hosted facilitator.
- `shared/submitViaChannels()`: `ChannelsClient` wrapper — retry on `POOL_CAPACITY`, fall back to direct self-paying submission **only** on `FEE_LIMIT_EXCEEDED`, surface all other errors. Used by `setup-demo.ts` (trustlines) and channel close settlement.
- If `@stellar/mpp` exposes a custom-broadcast hook, `mpp-charge` settlement is also routed through Channels behind `sponsorGas`. **Verify at implementation; not promised.**

## 4. Adapters

Thin translations to/from web-standard Request/Response; all logic stays in core.

- `@stellarpay/express` — `app.use(stellarpayExpress(config))` (Node req/res bridge).
- `@stellarpay/hono` — near-passthrough (Hono is already web-standard); this powers the "gated in minutes" demo.
- `@stellarpay/fastify` — Fastify plugin (`fastify.register`).

## 5. `@stellarpay/client`

```ts
import { createPayingFetch } from "@stellarpay/client";

const payFetch = createPayingFetch({
  secret: process.env.AGENT_SECRET,      // S... or Keypair
  network: "stellar:testnet",
  limits: { maxPerCall: "$0.05", maxTotal: "$2.00" },
  onEvent: (e) => console.log(e),        // "402" → "signing" → "settled" → "retrying"
});
```

- **Protocol detection from the 402 response itself**: `PAYMENT-REQUIRED` header → x402 handler (`@x402/fetch` + `@x402/stellar` client scheme); MPP negotiation headers → MPP handler (`mppx/client`, charge + channel registered).
- **Explicit scoped wrapper — never a global fetch polyfill** (upstream `Mppx.create()` monkey-patches global fetch; we deliberately don't).
- **Spend limits first-class**: per-call and cumulative caps; a challenge exceeding them throws `SpendLimitExceeded` without signing anything. Docs link this to the on-chain policy-signer roadmap item.
- **MCP transport helper**: plugs `payFetch` into the MCP SDK client transport so any agent can call paid MCP servers. (Exact custom-fetch option name in `StreamableHTTPClientTransport` verified at implementation.)

## 6. `@stellarpay/mcp`

```ts
import { withPayments } from "@stellarpay/mcp";

const paid = withPayments(mcpServer, {
  payTo, network: "stellar:testnet",
  tools: {
    search_web:   { price: "$0.002" },
    deep_report:  { price: "$0.02" },
    health_check: "free",
  },
});
```

- **Amended 2026-07-31 after upstream API verification:** payments are **in-protocol MPP**, not HTTP-level x402. `mppx` ships a purpose-built MCP payment transport (`Transport.mcpSdk()`): unpaid priced tool calls throw `McpError` code `-32042` with the challenge in `error.data`; credentials travel in `_meta["org.paymentauth/credential"]`; receipts attach to tool results. We build on it with `@stellar/mpp`'s charge method. API: `toolPayments(config)` returning a `guard(toolName, handler)` wrapper + `priceOf(toolName)`. `initialize`, `tools/list`, and unpriced tools pass through untouched.
- The paying client side (`wrapPaidMcpClient`, via `mppx`'s `McpClient.wrap`) lives in `@stellarpay/mcp` too (amended from §5: keeps `@stellarpay/client` MCP-free); a `payingHttpTransport` helper (MCP SDK's `StreamableHTTPClientTransport` `fetch` option, verified) also supports HTTP-level-gated servers.
- Emits payment events via `onPayment`.

## 7. Hosted demos (Railway, one project, six services)

1. **express-api** — flagship: x402 route + `mpp-charge` (sponsored) route + free route in one config.
2. **hono-api** — the judging-criterion proof: paywall added in a ~6-line diff, diff printed in its README.
3. **fastify-api** — minimal; same shape as express demo, different adapter import.
4. **mcp-server** — "Stellar Intel" MCP: useful tools on Horizon/RPC (`account_summary`, `asset_stats`, …), no external API keys; free `tools/list` + one free tool + paid premium tools.
5. **dashboard** — receives `Receipt` POSTs from all services (shared-secret auth), streams over SSE: route, scheme badge, amount, payer, stellar.expert link for on-chain settlements. In-memory store (demo infra, not product). Includes **"unleash the agent"** button → triggers a rate-limited hosted agent run so judges watch payments land live.
6. **agent** — Claude-API-driven buyer using `createPayingFetch` + paying MCP transport; walks the whole economy within its spend limits.

**Ops:** all testnet. `scripts/setup-demo.ts` friendbot-funds demo accounts, establishes USDC trustlines via `submitViaChannels`, prints results; testnet-USDC faucet step is manual and the script detects + instructs. Secrets only in Railway env vars; `.env.example` documents every var. Demo video recorded early against live deployment; every service also runs locally via `pnpm dev`.

## 8. Roadmap / stretch (docs/ROADMAP.md)

- **mpp-channel hosted feed demo** — per-tick priced data feed over a channel session; requires deploying the `one-way-channel` Soroban contract. Weekend attempt if the core suite is solid.
- **Agent treasury with policy signers** — smart-account agent wallet (smart-account-kit) whose policy signer enforces a daily spend cap + contract allow-list; payment inside policy succeeds, outside policy refused on-chain. Attempt only if time remains before Wednesday.
- Redis `Store` adapter for MPP replay protection.
- Mainnet preset hardening.

## 9. Error handling

- **Config fails fast**: all public entry points validate config with Zod at startup — bad address, unknown scheme, malformed price → boot-time error, never request-time.
- **Paywall never crashes the host app**: scheme handlers return result objects; unexpected internal errors → `500 { error: "paywall_internal" }` on the gated route only; no stack traces or config leakage.
- **Protocol-correct failures**: bad/expired/replayed payment → fresh `402` with machine-readable reason; facilitator/RPC unreachable → `503 { error: "settlement_unavailable", retryable: true }`.
- **Channels discipline**: retry `POOL_CAPACITY`; fall back to self-pay only on `FEE_LIMIT_EXCEEDED`; surface everything else.
- **Client**: typed errors `SpendLimitExceeded`, `UnsupportedChallenge`, `SettlementFailed`; never signs without a parsed, in-limit challenge.
- **Security**: private keys never logged on either side; dashboard ingestion authed with shared secret; no secrets in repo.

## 10. Testing

- **Unit (vitest, per package)**: route matching, config validation, challenge building, receipt normalization, protocol detection, spend-limit math — mocked facilitator/mppx. Mandatory edge cases: replayed payment, expired auth, over-limit challenge, unknown scheme header, malformed JSON-RPC to MCP wrapper, unauthorized dashboard POST.
- **Integration (local, deterministic, in CI)**: real Express/Hono/Fastify servers + real middleware + real client, settlement mocked at the boundary; proves full 402→pay→retry loop.
- **Smoke (real testnet, manual)**: `pnpm smoke` — one true end-to-end x402 payment and one mpp-charge payment. Run before demos and before publish; not in CI.
- TDD where practical; every public function tested.

## 11. Docs & publishing

- Root README: hero snippet, landscape table (§1), mermaid architecture diagram, links to all six live demos, 5-minute quickstart.
- Per-package READMEs, npm-first.
- `docs/modules/` living doc per package (documenting-modules convention).
- `PUBLISHING.md`: `npm login` → create `@stellarpay` org/scope → `pnpm -r publish --access public`. The user runs publishing personally when ready.

## 12. Out of scope (explicit)

- Python/FastAPI adapter (TS-only for the hackathon).
- Mainnet deployments and real-money flows.
- Persistent dashboard storage.
- x402 v1 compatibility (facilitator is v2).
- MPP push mode (pull mode only; push documented as upstream capability).
