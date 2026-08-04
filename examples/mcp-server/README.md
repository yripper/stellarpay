# mcp-server — Stellar Intel MCP, paid per tool call

An MCP server whose tools are **individually priced**. An AI agent connects, sees four tools,
calls one — and if that tool is priced, the call itself triggers a real on-chain micropayment
on Stellar testnet before the data comes back. No API keys, no subscription, no invoice: the
payment *is* the tool call.

This is the agentic-payments demo in the [stellarpay](../../README.md) lineup. The other
example services sell HTTP routes; this one sells **tool calls**, over MCP's
Streamable HTTP transport, using [`@stellarpay-sdk/mcp`](../../packages/mcp)'s `toolPayments()`.

See [`docs/modules/examples.md`](../../docs/modules/examples.md) for the full module doc.

## Tools

| Tool | Price | Input | What you get |
| --- | --- | --- | --- |
| `network_status` | **free** | — | Live testnet status: Horizon version, latest ledger, ledger capacity usage |
| `account_summary` | **$0.01** | `account` (`G…`) | Balances, subentry count, and auth flags for one account |
| `asset_stats` | **$0.01** | `code`, `issuer` (`G…`) | Circulating supply, holder count, and auth flags for one issued asset |
| `whale_watch` | **$0.02** | — | The 10 largest native-XLM payments among the 200 most recent payment ops, with tx links |

Everything is live Horizon-testnet data ([`src/intel.ts`](./src/intel.ts)) — nothing is
cached, mocked, or fabricated. `whale_watch` has **no size floor**: it returns the largest
payments in the window whatever their size, and reports `count`/`largestXlm` honestly, so a
thin window is visible rather than hidden (same product decision as
[`examples/hono-api`](../hono-api)).

### Free and paid coexist on one server

`network_status` is registered without a price, so `toolPayments`' guard is never applied to
it at all — the handler runs unwrapped, with zero payment overhead
(`packages/mcp/src/server.ts:151`). That is the point: a judge, an agent, or a curious
developer can connect, list the tools, and call the free one to confirm the server is alive
and serving real data **before** spending anything. Paying is a per-tool decision, made at
call time, not a gate on the connection.

## HTTP surface

| Route | What |
| --- | --- |
| `POST /mcp` | The MCP endpoint (Streamable HTTP, stateless) |
| `GET /` | Free JSON index: the tool list with prices |
| `GET /healthz` | `{ "ok": true }` |

## Try it

```bash
cp .env.example .env   # fill in DEMO_PAYTO and DEMO_MPP_SECRET at minimum
pnpm dev                # or: pnpm start
curl localhost:4604/
```

Drive the protocol by hand — a stateless server needs no session header:

```bash
curl -s localhost:4604/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Calling a priced tool without paying returns a JSON-RPC error with code **`-32042`** and a
`data.challenges` array describing what to pay, to whom, in what asset:

```bash
curl -s localhost:4604/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"whale_watch","arguments":{}}}'
```

## Connect an MCP client (Claude Desktop, Claude Code, any MCP host)

The server speaks standard MCP Streamable HTTP at `http://localhost:4604/mcp`. Any MCP client
can connect and use `network_status` immediately. Priced tools will surface their `-32042`
challenge to a client that cannot pay — the tool list, descriptions, and prices are still
fully visible, which is what makes the paywall legible instead of mysterious.

## Pay for a tool call with `@stellarpay-sdk/mcp`

`wrapPaidMcpClient` wraps any MCP SDK client so `callTool` answers the challenge, signs,
settles, and replays the call automatically:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { payingHttpTransport, wrapPaidMcpClient } from "@stellarpay-sdk/mcp";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(payingHttpTransport("http://localhost:4604/mcp", fetch));

const paid = wrapPaidMcpClient(client, {
  secret: process.env.BUYER_SECRET,          // Stellar secret seed (S…), funded with testnet USDC
  network: "stellar:testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
});

const res = await paid.callTool({ name: "whale_watch", arguments: {} });
console.log(res.content);   // live Horizon data
console.log(res.receipt);   // settlement receipt, incl. the transaction reference
```

The buyer account needs testnet XLM for fees and a funded testnet USDC trustline — see
`scripts/smoke.ts`'s setup instructions for the full walkthrough.

## Env vars

See [`.env.example`](./.env.example). Nothing here is ever logged or echoed — a missing
required var is reported by **name** only.

| Var | Required | Purpose |
| --- | --- | --- |
| `DEMO_PAYTO` | yes | Stellar account (`G…`) that receives tool payments. Public value. |
| `DEMO_MPP_SECRET` | yes | HMAC secret binding issued tool challenges. Server-side only. |
| `DASHBOARD_URL` | no | Dashboard base URL, no trailing slash. |
| `INGEST_SECRET` | no | Bearer secret for the dashboard's `/ingest`. |
| `PORT` | no | Listen port. Defaults to `4604`. |

Receipt reporting is entirely optional: with `DASHBOARD_URL` or `INGEST_SECRET` unset, the
reporter is a no-op and the tools are unaffected. Even when configured, reporting is
fire-and-forget with a 3s timeout — a dashboard that is down, slow, or misconfigured can never
fail a paid tool call.

## Tests

None — the payment guard itself is covered by `packages/mcp`'s suite, and this service's own
code is thin Horizon mappings plus SDK wiring. Typecheck only:

```bash
pnpm --filter @stellarpay-examples/mcp-server typecheck
```
