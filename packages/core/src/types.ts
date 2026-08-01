/**
 * Public type surface for `@stellarpay/core`. Every later task in the SDK
 * compiles against these exact names, field names, and optionality — treat
 * this file as a contract, not an implementation detail.
 *
 * `NetworkId` is intentionally re-declared here (rather than imported from
 * `@stellarpay/shared`) so this package's public `.d.ts` never references
 * `@stellarpay/shared` types; `@stellarpay/shared` is a private, bundled
 * dependency and must not leak into `@stellarpay/core`'s public API surface.
 */

/** Stellar network the SDK is configured to operate against. */
export type NetworkId = "stellar:testnet" | "stellar:pubnet";

/** Payment scheme used to settle a route. */
export type Scheme = "x402" | "mpp-charge" | "mpp-channel";

/** A route's price: a dollar string ("$0.01") or explicit asset + base units. */
export type PriceInput = string | { asset: string; amount: string };

/** Per-route payment configuration. */
export type RouteRule = { price: PriceInput; scheme?: Scheme; sponsorGas?: boolean; description?: string };

/** Settlement receipt emitted once a route's payment has been processed. */
export type Receipt = {
  scheme: Scheme;
  route: string;
  network: NetworkId;
  /** Decimal amount charged. */
  amount: string;
  /** Asset contract id, or "USDC" for dollar-denominated prices. */
  asset: string;
  payer?: string;
  txHash?: string;
  /** Upstream receipt/settlement payload; opaque to this package. */
  raw?: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
};

/** Top-level Stellarpay SDK configuration. */
export type StellarpayConfig = {
  network: NetworkId;
  payTo: string;
  routes: Record<string, RouteRule>;
  facilitatorUrl?: string;
  /** HMAC secret for mppx credentials; required if any route uses an mpp-* scheme. */
  mppSecretKey?: string;
  /** S... secret key; required if any route sets `sponsorGas`. */
  sponsorSecret?: string;
  /** Required if any route uses the mpp-channel scheme. */
  channel?: { contract: string; commitmentPublicKey: string };
  rpcUrl?: string;
  onPayment?: (receipt: Receipt) => void;
};

/** Result of a scheme handler processing a single request. */
export type SchemeOutcome =
  | { type: "pass"; receipt?: Receipt; headers?: Record<string, string> }
  | { type: "respond"; response: Response };

/** A pluggable payment scheme implementation. */
export type SchemeModule = {
  scheme: Scheme;
  init?(): Promise<void>;
  handle(req: Request, match: { pattern: string; rule: RouteRule }): Promise<SchemeOutcome>;
};

/** Thrown by `parseConfig` (see `config.ts`) when a `StellarpayConfig` fails validation. */
export class StellarpayConfigError extends Error {}
