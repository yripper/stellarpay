import { Mppx, Store, Transport } from "mppx/server";
import { Mcp } from "mppx";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { Keypair } from "@stellar/stellar-sdk";
import { dollarToDecimal } from "@stellarpay/core";

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

/** 64-character lowercase hex — the shape of a Stellar transaction hash (a SHA-256 digest). */
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Extracts a Stellar tx hash from an mppx settlement receipt's `reference` field.
 *
 * Deliberately duplicated, not imported, from `@stellarpay/core`'s
 * `txHashFromReceiptHeader` (`packages/core/src/schemes/mppCharge.ts:28-39`): that helper
 * base64url-decodes and JSON-parses an HTTP `Payment-Receipt` header first, but the
 * mcp-sdk transport's receipt (`mppx`'s `Mcp.Receipt`, `mppx/dist/Mcp.d.ts`) is already a
 * parsed object attached under `_meta[Mcp.receiptMetaKey]` (see `guard` below) — there is
 * no header or base64url envelope to decode here, so the HTTP helper's signature doesn't
 * fit. `@stellarpay/core`'s public surface is a single `"."` export
 * (`packages/core/package.json`'s `exports`), which doesn't re-export the underlying
 * hash-shape regex on its own, and `@stellarpay/mcp` is a published package that must not
 * reach past a sibling package's public entry to grab an internal — so the ~3-line check
 * is copied here rather than coupling the two packages over an unpublished path.
 *
 * Applies the identical conservative rule as the HTTP leg: only a genuinely hash-shaped
 * `reference` yields a value; anything else (`undefined`, non-string, wrong shape) yields
 * `undefined` — a wrong explorer link on camera during a live demo is worse than no link.
 */
function txHashFromReference(reference: unknown): string | undefined {
  return typeof reference === "string" && TX_HASH_PATTERN.test(reference) ? reference : undefined;
}

/** A single tool-payment event, reported to {@link ToolPaymentsConfig.onPayment}. */
export type ToolPaymentReceipt = {
  /** The MCP tool name that was paid for. */
  tool: string;
  /** Charged amount, as a decimal string (e.g. `"0.02"`), matching {@link dollarToDecimal}'s output. */
  amount: string;
  /** Raw settlement reference (e.g. a transaction hash), when the underlying method exposes one. */
  raw?: string;
  /**
   * On-chain settlement transaction hash (64-char lowercase hex), when the settled
   * receipt's `reference` is genuinely hash-shaped. Populated in `guard` via a throwaway
   * `withReceipt(...)` probe — mirrors `@stellarpay/core`'s mpp-charge leg
   * (`packages/core/src/schemes/mppCharge.ts:84-85`) so the dashboard can link every paid
   * MCP tool call to stellar.expert the same way it already does for HTTP-settled routes.
   * `undefined` whenever the reference can't be confidently decoded — see
   * {@link txHashFromReference}.
   */
  txHash?: string;
  /** ISO 8601 timestamp of when the charge was accepted. */
  timestamp: string;
};

/** Configuration consumed by {@link toolPayments}. */
export type ToolPaymentsConfig = {
  /** Recipient Stellar public key (G…) or contract address (C…) for settled charges. */
  payTo: string;
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
        recipient: config.payTo,
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
        // Probe the settlement receipt with a throwaway `Response`, the same technique
        // `@stellarpay/core`'s mpp-charge leg uses for the HTTP transport
        // (`packages/core/src/schemes/mppCharge.ts:77`), adapted to the mcp-sdk transport.
        // `withReceipt` is a pure function closing over the charge's already-settled
        // `receiptData` (`mppx/dist/server/Mppx.js:458-485`'s `success()`); it never
        // mutates its `response` argument or any shared state, so probing here and calling
        // it again below with the handler's real response neither re-charges nor
        // re-verifies anything, and can't double-attach the receipt onto the real result —
        // it's the identical pattern mppx uses on itself (`toNodeListener`,
        // `mppx/dist/server/Mppx.js:1489`, also probes with a throwaway `Response` before
        // separately handling the real response). The mcp-sdk transport's own
        // `respondReceipt` special-cases a `Response` instance to `{ content: [] }` before
        // merging `_meta[Mcp.receiptMetaKey]` in (`mppx/dist/mcp-sdk/server/
        // Transport.js:66-81`), so this probe's `{ content: [] }` is discarded here and
        // never reaches the caller — only the second `withReceipt(response)` call below,
        // on the handler's actual result, does.
        const probe = result.withReceipt(new Response(null) as unknown as McpToolResult);
        const probeMeta = (probe as unknown as { _meta?: Record<string, unknown> })._meta;
        const settledReceipt = probeMeta?.[Mcp.receiptMetaKey] as { reference?: unknown } | undefined;
        const txHash = txHashFromReference(settledReceipt?.reference);
        try {
          config.onPayment?.({
            tool: toolName, amount, timestamp: new Date().toISOString(),
            ...(txHash ? { txHash } : {}),
          });
        } catch (hookError) {
          // A misbehaving user hook must never turn an already-paid call into a hard
          // error for the caller — the charge already settled, so the client should
          // still get its tool result. Mirrors @stellarpay/core's identical isolation
          // for its own `onPayment` hook (packages/core/src/stellarpay.ts:96-101).
          // Logged server-side only, matching that precedent's own comment.
          console.error("[stellarpay/mcp] onPayment hook threw; ignoring", hookError);
        }
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
