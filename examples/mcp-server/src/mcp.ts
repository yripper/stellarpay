import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolPayments } from "@stellarpay/mcp";
import { z } from "zod";
import { accountSummary, assetStats, networkStatus, whaleWatch } from "./intel.js";
import type { IngestEvent } from "./reportReceipt.js";
import type { Env } from "./env.js";

export const PRICES = { account_summary: "$0.01", asset_stats: "$0.01", whale_watch: "$0.02" } as const;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/**
 * The payments guard is built ONCE per process — its in-memory replay store must span
 * requests. Only McpServer instances are per-request (stateless streamable HTTP).
 *
 * Calling this inside the `/mcp` handler would hand every request a fresh `Store.memory()`
 * (`packages/mcp/src/server.ts:141`), silently disabling replay protection and re-minting the
 * HMAC-bound challenge state a client's credential was issued against. `main.ts` calls it at
 * module scope for that reason; do not "simplify" it into the handler.
 */
export function buildPayments(env: Env, report: (e: IngestEvent) => void) {
  return toolPayments({
    payTo: env.payTo,
    network: "stellar:testnet",
    mppSecretKey: env.mppSecret,
    prices: PRICES,
    onPayment: (r) =>
      report({
        kind: "receipt",
        // Adapt ToolPaymentReceipt → the dashboard's loose receipt rendering (route/scheme/amount/asset).
        // `raw` is never populated by the guard (packages/mcp/src/server.ts:181-184 only ever
        // adds `txHash`, not `raw`) — spread conditionally so the field is absent rather than
        // `undefined` when it stays unset. `txHash` (packages/mcp/src/server.ts:73) *is*
        // populated, via the guard's throwaway `withReceipt(...)` probe, whenever the settled
        // mppx receipt's `reference` is a genuine 64-char lowercase hex Stellar tx hash — spread
        // in the same conditional way so the dashboard only ever renders a stellar.expert link
        // it can trust.
        receipt: {
          route: r.tool, scheme: "mpp-charge", amount: r.amount, asset: "USDC", timestamp: r.timestamp,
          ...(r.raw ? { raw: r.raw } : {}), ...(r.txHash ? { txHash: r.txHash } : {}),
        },
      }),
  });
}

/**
 * Adapts a payment-guarded `(args, extra)` handler to the *one-argument* callback shape the
 * MCP SDK uses for tools registered without an `inputSchema`: `executeToolHandler` calls
 * `handler(extra)`, not `handler(args, extra)`, when `tool.inputSchema` is unset
 * (`@modelcontextprotocol/sdk/dist/esm/server/mcp.js:229-236`).
 *
 * Load-bearing, not a typing nicety: registering a guarded handler directly on a schema-less
 * priced tool hands `extra` to the guard's `args` slot and `undefined` to its `extra` slot,
 * so mppx's credential lookup (`packages/mcp/src/server.ts:158`) always comes up empty and
 * the tool answers −32042 forever — a tool nobody can buy, however correctly they pay.
 */
function withoutArgs<R>(guarded: (args: undefined, extra: unknown) => Promise<R>): (extra: unknown) => Promise<R> {
  return (extra) => guarded(undefined, extra);
}

/**
 * Builds one stateless `McpServer` around the process-wide payments guard. Tool descriptions
 * are read by a buying LLM agent as well as by humans, so each states plainly what it returns
 * and what it costs.
 */
export function buildMcpServer(payments: ReturnType<typeof buildPayments>): McpServer {
  const server = new McpServer({ name: "stellar-intel", version: "0.1.0" });

  server.registerTool(
    "network_status",
    { description: "Live Stellar testnet status: latest ledger, fee pressure. FREE." },
    async () => text(await networkStatus()),
  );
  server.registerTool(
    "account_summary",
    {
      description: `Balances, flags and subentries for a Stellar account. Paid: ${PRICES.account_summary} (MPP).`,
      inputSchema: { account: z.string().describe("Stellar account id (G...)") },
    },
    payments.guard("account_summary", async ({ account }: { account: string }) => text(await accountSummary(account))),
  );
  server.registerTool(
    "asset_stats",
    {
      description: `Supply, holders and flags for an issued asset. Paid: ${PRICES.asset_stats} (MPP).`,
      inputSchema: { code: z.string(), issuer: z.string().describe("Issuer account id (G...)") },
    },
    payments.guard("asset_stats", async ({ code, issuer }: { code: string; issuer: string }) => text(await assetStats(code, issuer))),
  );
  server.registerTool(
    "whale_watch",
    { description: `The 10 largest recent native payments on testnet. Paid: ${PRICES.whale_watch} (MPP).` },
    withoutArgs(payments.guard("whale_watch", async (_args: undefined) => text(await whaleWatch()))),
  );
  return server;
}
