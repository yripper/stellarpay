import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpClient } from "mppx/mcp-sdk/client";
import { stellar as stellarChargeClient } from "@stellar/mpp/charge/client";

/** Options for {@link wrapPaidMcpClient}. */
export type PaidMcpClientOptions = {
  /** Stellar secret seed (S…), passed straight through to `stellar.charge`'s client `secretKey`. */
  secret: string;
  /**
   * CAIP-2 network identifier. Accepted for interface parity with the server-side
   * `ToolPaymentsConfig.network` and reserved for a future network-aware client leg (e.g.
   * mpp-channel) — the installed `@stellar/mpp/charge/client` `stellar()` method does not
   * take a `network` parameter at all (`@stellar/mpp/dist/charge/client/Charge.d.ts:60-91`);
   * it resolves the network from the *issued challenge*'s own
   * `request.methodDetails.network` at credential-creation time
   * (`@stellar/mpp/dist/charge/client/Charge.js:74`: `resolveNetworkId(request.methodDetails?.network)`).
   * See docs/modules/mcp.md Gotchas.
   */
  network: "stellar:testnet" | "stellar:pubnet";
  /** Soroban RPC endpoint override. @defaultValue resolved from the challenge's network. */
  rpcUrl?: string;
};

/**
 * Wraps an MCP SDK client so `callTool` automatically pays `-32042` payment-required
 * challenges issued by an mppx `Transport.mcpSdk()` server (e.g. {@link toolPayments}'s
 * guarded tools), via the `stellar.charge` client method (pull mode: client signs, server
 * broadcasts).
 *
 * Thin adapter over mppx's own `McpClient.wrap` (`mppx/dist/mcp-sdk/client/McpClient.d.ts:44`,
 * doc example at `:22-42`) — `client` is constrained to `Pick<Client, 'callTool'>` to match
 * `wrap`'s own generic bound exactly, rather than the brief's looser `{ callTool: Function }`
 * sketch, since the real installed signature is available and more precise.
 */
export function wrapPaidMcpClient<const client extends Pick<Client, "callTool">>(
  client: client,
  opts: PaidMcpClientOptions,
): McpClient.wrap.McpClient<client, readonly [ReturnType<typeof stellarChargeClient>]> {
  return McpClient.wrap(client, {
    methods: [stellarChargeClient({ secretKey: opts.secret, mode: "pull", rpcUrl: opts.rpcUrl })],
  });
}

/**
 * Builds a Streamable HTTP MCP client transport whose outbound requests are routed through
 * `payFetch` — for HTTP-level (x402-gated) MCP servers, distinct from the MCP SDK
 * JSON-RPC-level `-32042` challenges {@link wrapPaidMcpClient} pays.
 *
 * `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransportOptions.fetch` accepts a
 * `FetchLike` (`(url: string | URL, init?: RequestInit) => Promise<Response>`,
 * `@modelcontextprotocol/sdk/dist/esm/shared/transport.d.ts:2`); `typeof fetch`'s wider
 * `RequestInfo | URL` parameter is structurally assignable to it.
 */
export function payingHttpTransport(url: string, payFetch: typeof fetch): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(url), { fetch: payFetch });
}
