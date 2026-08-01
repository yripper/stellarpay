import { Mppx, Store, Transport } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { Keypair } from "@stellar/stellar-sdk";
import { dollarToDecimal } from "@stellarpay/shared";

/**
 * Input shape mppx's `Transport.mcpSdk()` hands to every route handler: the MCP SDK tool
 * call's `extra` (`RequestHandlerExtra`-compatible) parameter, carrying any inbound
 * payment credential under `_meta["org.paymentauth/credential"]`.
 *
 * Derived structurally from the installed transport (`Transport.InputOf<Transport.McpSdk>`,
 * `mppx/dist/server/Transport.d.ts:58` + `:9`) rather than importing mppx's internal
 * `Extra` type by name — that type isn't re-exported from `mppx/server`'s public surface,
 * only `Transport.McpSdk`/`Transport.mcpSdk` are (`mppx/dist/server/Transport.d.ts:9`).
 */
type McpToolExtra = Transport.InputOf<Transport.McpSdk>;

/**
 * The MCP tool-result shape mppx's `Transport.mcpSdk()` expects `withReceipt()` to
 * decorate — `@modelcontextprotocol/sdk`'s `CallToolResult`, per the transport's own
 * `McpSdk = Transport.Transport<Extra, McpError, CallToolResult>` alias
 * (`mppx/dist/mcp-sdk/server/Transport.d.ts:16`). Derived the same structural way as
 * {@link McpToolExtra}, via `Transport.ReceiptResponseOf<Transport.McpSdk>`
 * (`mppx/dist/server/Transport.d.ts:61-62`).
 */
type McpToolResult = Transport.ReceiptResponseOf<Transport.McpSdk>;

/** A single tool-payment event, reported to {@link ToolPaymentsConfig.onPayment}. */
export type ToolPaymentReceipt = {
  /** The MCP tool name that was paid for. */
  tool: string;
  /** Charged amount, as a decimal string (e.g. `"0.02"`), matching {@link dollarToDecimal}'s output. */
  amount: string;
  /** Raw settlement reference (e.g. a transaction hash), when the underlying method exposes one. */
  raw?: string;
  /** ISO 8601 timestamp of when the charge was accepted. */
  timestamp: string;
};

/** Configuration consumed by {@link toolPayments}. */
export type ToolPaymentsConfig = {
  /** Recipient Stellar public key (G…) or contract address (C…) for settled charges. */
  recipient: string;
  /** CAIP-2 network identifier the `stellar.charge` server method verifies against. */
  network: "stellar:testnet" | "stellar:pubnet";
  /** mppx server secret key, used to HMAC-bind issued challenges (`Mppx.create`'s `secretKey`). */
  mppSecretKey: string;
  /** Optional server-sponsored fee payer secret (S...); enables fee-payer mode when set. */
  sponsorSecret?: string;
  /** Soroban RPC endpoint override. @defaultValue resolved from `network` by `stellar.charge`. */
  rpcUrl?: string;
  /** Map of MCP tool name → dollar price string (e.g. `"$0.02"`). Tools absent here are unpriced. */
  prices: Record<string, string>;
  /** Invoked once a charge is accepted, before the wrapped handler runs. */
  onPayment?: (receipt: ToolPaymentReceipt) => void;
};

/** Returned by {@link toolPayments}: the per-tool payment guard and its price lookup. */
export type ToolPayments = {
  /**
   * Wraps an MCP tool handler so it only runs once a configured price is paid.
   *
   * Tools absent from {@link ToolPaymentsConfig.prices} bypass payment entirely — the
   * original `handler` is returned unwrapped, not merely invoked unconditionally, so an
   * unpriced tool pays zero mppx overhead.
   */
  guard<A, R>(toolName: string, handler: (args: A, extra: unknown) => Promise<R>): (args: A, extra: unknown) => Promise<R>;
  /** Returns the configured dollar price string for `toolName`, or `undefined` if unpriced. */
  priceOf(toolName: string): string | undefined;
};

/**
 * Builds a per-tool MCP payment guard backed by mppx's `Transport.mcpSdk()` transport and
 * the `@stellar/mpp` `stellar.charge` server method (pull-mode SEP-41 transfers).
 *
 * Follows the verified upstream pattern from `Transport.mcpSdk()`'s own doc example
 * (`mppx/dist/mcp-sdk/server/Transport.d.ts:24-40`): `payment.charge({ ... })(extra)` →
 * `result.status === 402` throws the issued `McpError` (code `-32042`, per
 * `mppx/dist/Mcp.d.ts:7`) directly; a `200` result's `withReceipt(...)` decorates the
 * handler's own result with the payment receipt under
 * `_meta["org.paymentauth/receipt"]` (`mppx/dist/mcp-sdk/server/Transport.js:66-81`).
 *
 * Replay protection is backed by `Store.memory()` — see `@stellarpay/core`'s
 * `createMppChargeModule` (`packages/core/src/schemes/mppCharge.ts`) for the same
 * single-process-topology caveat, which applies identically here.
 */
export function toolPayments(config: ToolPaymentsConfig): ToolPayments {
  const payment = Mppx.create({
    secretKey: config.mppSecretKey,
    transport: Transport.mcpSdk(),
    methods: [
      stellar.charge({
        recipient: config.recipient,
        // Fixed to testnet USDC regardless of `config.network`, matching
        // `@stellarpay/core`'s `createMppChargeModule` precedent
        // (`packages/core/src/schemes/mppCharge.ts:33`) — the brief's produced interface
        // has no per-price asset override, so there is no non-fabricated way to pick a
        // different SAC address for pubnet without inventing a field. Documented as a
        // known limitation in docs/modules/mcp.md, not silently "fixed."
        currency: USDC_SAC_TESTNET,
        network: config.network,
        rpcUrl: config.rpcUrl,
        store: Store.memory(),
        ...(config.sponsorSecret ? { feePayer: { envelopeSigner: Keypair.fromSecret(config.sponsorSecret) } } : {}),
      }),
    ],
  });

  return {
    priceOf: (tool: string) => config.prices[tool],
    guard<A, R>(toolName: string, handler: (args: A, extra: unknown) => Promise<R>) {
      const price = config.prices[toolName];
      if (!price) return handler; // unpriced tools bypass entirely — no mppx call at all
      const amount = dollarToDecimal(price);
      return async (args: A, extra: unknown): Promise<R> => {
        // `extra` is deliberately typed `unknown` at this function's public boundary (it's
        // opaque MCP SDK plumbing to callers); narrowed here to the structural shape mppx's
        // mcp-sdk transport actually reads (`_meta["org.paymentauth/credential"]`), matching
        // the transport's own `getCredential(extra)` (`Transport.js:42-47`).
        const result = await payment.charge({ amount, description: `MCP tool: ${toolName}` })(extra as McpToolExtra);
        if (result.status === 402) throw result.challenge; // McpError, code -32042 (Mcp.d.ts:7)
        config.onPayment?.({ tool: toolName, amount, timestamp: new Date().toISOString() });
        const response = await handler(args, extra);
        // `withReceipt` is narrowed by the mcp-sdk transport to `CallToolResult`
        // (`McpToolResult`), while `guard`'s own contract keeps `R` fully generic per the
        // brief's produced interface — bridged with an explicit double cast rather than
        // constraining `R`, since MCP tool handlers are expected (by MCP SDK convention,
        // not enforced by this generic signature) to already return `CallToolResult`-shaped
        // values.
        return result.withReceipt(response as unknown as McpToolResult) as unknown as R;
      };
    },
  };
}
