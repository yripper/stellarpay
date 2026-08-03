# @stellarpay/mcp

Per-tool-call payments for MCP servers. Server side, `toolPayments(config)` wraps individual
MCP tool handlers so an unpaid priced call throws the in-protocol MCP payment-required error
(JSON-RPC code `-32042`) instead of running; client side, `wrapPaidMcpClient` automatically pays
those challenges. Built entirely on `mppx`'s own `Transport.mcpSdk()` and `McpClient.wrap`
primitives — payments are **in-protocol MPP**, not HTTP-level x402 (an approved deviation from
the original design sketch — see `docs/superpowers/specs/2026-07-31-stellarpay-design.md` §6).

Part of the [stellarpay](../../README.md) SDK.

## Install

Not yet published — see [PUBLISHING.md](../../PUBLISHING.md). Once published:

```sh
npm install @stellarpay/mcp @modelcontextprotocol/sdk
```

## Minimal working example — server side (guard a tool)

Taken directly from `test/mcp.test.ts`:

```ts
import { toolPayments } from "@stellarpay/mcp";

const payments = toolPayments({
  payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  network: "stellar:testnet",
  mppSecretKey: "test-secret",
  prices: { deep_report: "$0.02" }, // tools not listed here are unpriced (free)
});

// Wrap an MCP tool handler — server.registerTool("deep_report", ..., payments.guard("deep_report", handler))
const guarded = payments.guard("deep_report", async () => ({ content: [{ type: "text", text: "..." }] }));

payments.priceOf("deep_report"); // "$0.02"
payments.priceOf("health_check"); // undefined — unpriced
```

An unpaid call to `guarded(...)` rejects with an `McpError` (`code: -32042`); wire `guarded` in
as the handler for an `@modelcontextprotocol/sdk` `server.registerTool(...)` call and the MCP
SDK surfaces that error to the calling client automatically.

## Minimal working example — client side (pay for tool calls)

Derived from the verified `wrapPaidMcpClient`/`payingHttpTransport` signatures in `src/client.ts`
(there is no dedicated test file for the client helpers yet — server-side coverage is
`test/mcp.test.ts` / `test/onPaymentIsolation.test.ts`):

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { wrapPaidMcpClient, payingHttpTransport } from "@stellarpay/mcp";
import { createPayingFetch } from "@stellarpay/client";

const payFetch = createPayingFetch({ secret: process.env.AGENT_SECRET!, network: "stellar:testnet" });

const client = new Client({ name: "agent", version: "1.0.0" });
await client.connect(payingHttpTransport("http://localhost:3000/mcp", payFetch));

const paidClient = wrapPaidMcpClient(client, {
  secret: process.env.AGENT_SECRET!,
  network: "stellar:testnet",
});

// Automatically pays a -32042 challenge and retries.
const result = await paidClient.callTool({ name: "deep_report", arguments: {} });
```

## API

Public exports, from `src/index.ts` (`export * from "./server.js"` + `"./client.js"`).

| Export | Signature | Description |
|---|---|---|
| `toolPayments` | `(config: ToolPaymentsConfig) => ToolPayments` | Server-side entry point. |
| `ToolPaymentsConfig` (type) | `{ payTo, network, mppSecretKey, sponsorSecret?, rpcUrl?, prices, onPayment? }` | `prices: Record<string, string>` maps tool name → dollar price (e.g. `"$0.02"`); tools absent here are unpriced. |
| `ToolPayments` (type) | `{ guard, priceOf }` | `guard<A, R>(toolName, handler)` wraps a handler with the payment check — unpriced tools are returned unwrapped. `priceOf(toolName)` looks up the configured price. |
| `ToolPaymentReceipt` (type) | `{ tool, amount, raw?, timestamp }` | Passed to `ToolPaymentsConfig.onPayment` once a charge is accepted. |
| `wrapPaidMcpClient` | `<const client extends Pick<Client, "callTool">>(client, opts: PaidMcpClientOptions) => WrappedClient` | Client-side entry point: wraps an MCP SDK `Client` so `callTool` auto-pays `-32042` challenges via `@stellar/mpp`'s `stellar.charge` client method. |
| `PaidMcpClientOptions` (type) | `{ secret, network, rpcUrl? }` | `network` is accepted for interface parity but not yet wired into the underlying client call — see the module doc. |
| `payingHttpTransport` | `(url: string, payFetch: typeof fetch) => StreamableHTTPClientTransport` | Builds an MCP SDK Streamable HTTP transport whose requests go through a paying `fetch` — for HTTP-level (x402-gated) MCP servers, distinct from the `-32042` JSON-RPC challenges `wrapPaidMcpClient` pays. |

If your own `onPayment` hook throws, `guard` catches it, logs the real error server-side only
(`console.error`), and still returns the already-paid tool result — don't put secrets in your
hook's own error messages, since they're logged verbatim.

Full API surface, gotchas (single-process replay-store caveat, the `currency` fixed to testnet
USDC, etc.), and file:line citations: [`docs/modules/mcp.md`](../../docs/modules/mcp.md).

[Back to root README](../../README.md)
