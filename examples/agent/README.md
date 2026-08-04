# agent — the autonomous buyer

An AI agent with a funded Stellar wallet, a mission, and a hard budget. Give it a question
it cannot answer for free and it goes shopping: it buys asset reports, whale alerts, fee
stats and MCP tool calls from four of the other five demo services (express-api, hono-api,
fastify-api, mcp-server — never the dashboard, which it only narrates to), paying each one
on-chain, and narrates every purchase to the dashboard feed as it happens.

Nobody approves the payments. There is no checkout, no API key, no invoice. The agent
decides what is worth buying, the paywall answers `402`, and
[`@stellarpay/client`](../../packages/client) settles it — in the middle of a tool call.

This is the last service in the [stellarpay](../../README.md) demo lineup and the one the
dashboard's **▶ UNLEASH THE AGENT** button drives.

> **This wallet signs real transactions.** `DEMO_BUYER_SECRET` is a funded Stellar
> **testnet** account, and every purchase below is a genuine on-chain USDC payment with a
> real transaction hash you can open on stellar.expert. Testnet money, real settlement.

## What it buys

| Tool name | Seller | Price | Scheme | What it returns |
| --- | --- | --- | --- | --- |
| `buy_asset_report` | [express-api](../express-api) | **$0.02** | x402 | USDC authorized supply, holders, flags, top of the XLM order book |
| `buy_account_deep_dive` | [express-api](../express-api) | **$0.02** | mpp-charge | Its own wallet: balances, flags, 10 most recent payments |
| `buy_whale_alerts` | [hono-api](../hono-api) | **$0.01** | x402 | The 10 largest recent native-XLM payments on testnet |
| `buy_fee_stats` | [fastify-api](../fastify-api) | **$0.005** | mpp-charge | Live fee stats + a congestion verdict |
| `buy_mcp_account_summary` | [mcp-server](../mcp-server) | **$0.01** | mpp-charge over MCP | Its own wallet's balances and flags, as an MCP tool call |
| `buy_mcp_whale_watch` | [mcp-server](../mcp-server) | **$0.02** | mpp-charge over MCP | The same whale scan, as an MCP tool call |

Buying everything once costs **$0.085**. The economy is defined in one place
([`src/economy.ts`](./src/economy.ts)) and is what both run modes below shop from.

The USDC issuer is **discovered from Horizon at run time**
(`discoverUsdcIssuer`, [`src/economy.ts`](./src/economy.ts)), never hardcoded, so the asset
report always names an asset that actually exists on testnet today.

## Two ways a run happens

**Claude-driven (primary).** A tool-use loop on `claude-sonnet-5`: the agent is given one
mission and the six buyables as tools, and it chooses which intel the mission actually
needs. Missions rotate through a small list ([`src/run.ts`](./src/run.ts)) so consecutive
runs differ:

1. *Produce a market brief on USDC on Stellar testnet: supply, holders, market depth, and current network conditions.*
2. *Assess my own wallet's position and the current whale activity on testnet — anything notable moving?*
3. *How congested is the Stellar testnet right now, and what are the biggest payments flowing through it?*

**Scripted tour (fallback).** If the Claude call fails for any reason — no API key, expired
key, quota, network — the run degrades to a deterministic tour that buys every item in the
economy in order, with the same narration. The judge's button always produces visible
payments; it never fizzles.

Both modes narrate the same way, and every number in a narration line is read out of the
response that was actually paid for. Nothing is padded, rounded up, or invented — a seller
that answers with an error is quoted as having answered with an error.

## The budget is real

Every run builds a fresh paying `fetch` with hard limits:

```ts
const LIMITS = { maxPerCall: "$0.05", maxTotal: "$0.25" };
```

They are enforced client-side by `@stellarpay/client`'s `SpendTracker` before anything is
signed, and they reset per run. When a purchase would breach one, the SDK emits a `blocked`
event and throws `SpendLimitExceeded` — the agent narrates the refusal and carries on with
the rest of the mission. **A refused purchase on the feed is the guardrail working**, not
the demo breaking.

One caveat worth knowing on stage: these limits cover the **HTTP** purchases, which is what
`createPayingFetch` sees. The two MCP tool purchases settle through `wrapPaidMcpClient`'s
own payment leg ([`packages/mcp/src/client.ts`](../../packages/mcp/src/client.ts)), which
takes no limits — so the narration says "per paid HTTP call" rather than claiming coverage
it does not have.

## HTTP surface

| Route | What |
| --- | --- |
| `POST /run` | Starts a mission. `Authorization: Bearer <INGEST_SECRET>` required. `202` started, `409` a run is already in flight, `401` bad token. |
| `GET /healthz` | `{ "ok": true }` |

`POST /run` returns immediately — the run itself proceeds in the background and reports
itself to the dashboard. Only one run at a time; a second press while one is in flight gets
`409` rather than doubling the spend. The service also fires **one run 5 seconds after
boot**, so the dashboard is never empty when judges first open it.

## Try it

```bash
cp .env.example .env    # fill in DEMO_BUYER_SECRET at minimum
pnpm dev                # or: pnpm start
curl -s -X POST localhost:4605/run -H 'authorization: Bearer <your INGEST_SECRET>'
```

Then watch the dashboard at `http://localhost:4600` — the agent's narration lines interleave
with the receipts each seller reports independently, and every x402 receipt carries a
stellar.expert link to the settlement.

The buyer account needs testnet XLM for fees and a funded testnet USDC trustline — see
`scripts/smoke.ts`'s setup instructions for the full walkthrough.

## Env vars

See [`.env.example`](./.env.example). Nothing here is ever logged or echoed — a missing
required var is reported by **name** only, and the buyer secret never leaves the process.

| Var | Required | Purpose |
| --- | --- | --- |
| `DEMO_BUYER_SECRET` | yes | Funded buyer seed (`S…`). Signs every payment. |
| `INGEST_SECRET` | yes | Bearer token for `POST /run`, and the dashboard `/ingest` credential. |
| `EXPRESS_API_URL` | yes | express-api base URL, no trailing slash. |
| `HONO_API_URL` | yes | hono-api base URL. |
| `FASTIFY_API_URL` | yes | fastify-api base URL. |
| `MCP_SERVER_URL` | yes | mcp-server base URL (`/mcp` is appended). |
| `ANTHROPIC_API_KEY` | no | Unset → every run takes the scripted path. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-sonnet-5`. |
| `DASHBOARD_URL` | no | Unset → narration is a no-op, purchases still happen. |
| `PORT` | no | Listen port. Defaults to `4605`. |

Unlike the selling services, `INGEST_SECRET` is **required** here: it is the token guarding
the endpoint that spends money.

## Resilience

- An unreachable **mcp-server** drops the two MCP buyables from the economy for that run
  instead of ending it — neither Claude nor the scripted tour is offered a tool that cannot
  work, and the three HTTP sellers still get bought from.
- An unreachable **dashboard** is invisible to the run: narration is fire-and-forget with a
  3s timeout ([`src/reportReceipt.ts`](./src/reportReceipt.ts)).
- A failed purchase is narrated and the tour continues; a crashed run is caught, narrated,
  and — critically — clears the in-flight flag, so `/run` can never get stuck answering
  `409` forever.

## Tests

```bash
pnpm --filter @stellarpay-examples/agent test
```

[`test/run.test.ts`](./test/run.test.ts) covers the orchestration contract (which mode a run
takes, and that no failure escapes as a throw), the scripted tour's per-item isolation, and
the purchase summarizers — the narration layer, where a wrong line would mean the agent
saying something the data does not support.
