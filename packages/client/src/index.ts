import { Keypair } from "@stellar/stellar-sdk";
import { detectProtocol } from "./detect.js";
import { SpendTracker } from "./limits.js";
import { Emitter } from "./events.js";
import { buildX402Fetch } from "./x402Leg.js";
import { createMppLeg } from "./mppLeg.js";
import { toUrlString } from "./url.js";
import type { PayEvent } from "./events.js";

export type { PayEvent } from "./events.js";
export { SpendLimitExceeded } from "./limits.js";

/** Thrown when a probe returns a payment challenge for a protocol this SDK doesn't yet support. */
export class UnsupportedChallenge extends Error {}

/** Configuration for `createPayingFetch`. */
export type PayingFetchConfig = {
  /** Stellar secret seed ("S..."). One of `secret`/`keypair` is required. */
  secret?: string;
  /** A `Keypair` instance from `@stellar/stellar-sdk`; narrowed internally. */
  keypair?: unknown;
  network: "stellar:testnet" | "stellar:pubnet";
  limits?: { maxPerCall?: string; maxTotal?: string; allowUnknownAmount?: boolean };
  onEvent?: (e: PayEvent) => void;
  rpcUrl?: string;
  /** Ed25519 secret key (S...) for the mpp-channel client method. Omitted → only the
   * mpp-charge method is registered for MPP challenges (no channel support). */
  channelCommitmentSecret?: string;
};

/**
 * Internal-only fields layered onto {@link PayingFetchConfig} for tests. Never part of
 * the public contract — callers reach them only via an `as never` cast (see
 * `test/payingFetch.test.ts`), which is deliberate: it keeps these seams out of the
 * documented config shape while still letting this module's own tests exercise them.
 */
type InternalPayingFetchConfig = PayingFetchConfig & {
  /** Test seam: injected transport, used instead of the global `fetch` for the initial
   * probe, the x402 leg's payment retry, and (via mppLeg.ts) the mpp leg's re-probe. */
  _baseFetch?: typeof fetch;
  /** Test seam: see `mppLeg.ts`'s `MppLegConfig.dryRun` doc comment. */
  _dryRun?: boolean;
};

/** Narrows `config.secret`/`config.keypair` (one required) down to a raw Stellar secret seed. */
function resolveSecret(config: PayingFetchConfig): string {
  if (config.secret) return config.secret;
  if (config.keypair instanceof Keypair) return config.keypair.secret();
  throw new Error("createPayingFetch requires either `secret` or `keypair` in its config");
}

/**
 * Shape of the decoded `PAYMENT-REQUIRED` header body this task reads; guarded and never
 * trusted — every field is optional/unknown until validated.
 */
type X402PaymentRequired = { accepts?: Array<{ amount?: unknown; asset?: unknown }> };

/**
 * Parses the challenged amount (in base units) out of an x402 `PAYMENT-REQUIRED` header:
 * base64 → JSON → `accepts[0].amount`. Returns `undefined` on anything unparseable so the
 * caller can route it through `SpendTracker`'s unknown-amount path instead of trusting it.
 */
function parseX402Amount(res: Response): bigint | undefined {
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) return undefined;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as X402PaymentRequired;
    const amount = parsed.accepts?.[0]?.amount;
    return typeof amount === "string" ? BigInt(amount) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds a `fetch`-compatible function that transparently pays 402 challenges: it probes
 * the request, and on a 402 response, checks the challenged amount against configured
 * spend limits before replaying the request through the matching payment leg — x402 or
 * MPP, detected from the response headers.
 *
 * Budget is reserved before any signing is attempted (so a burst of concurrent calls
 * can't race past `maxTotal`), but a failed attempt — bad signer, network error,
 * misconfigured secret — releases its reservation instead of permanently consuming it;
 * only a successful payment keeps the reservation. See `SpendTracker.release`.
 */
export function createPayingFetch(config: PayingFetchConfig): typeof fetch {
  const internal = config as InternalPayingFetchConfig;
  const baseFetch = internal._baseFetch ?? fetch;
  const emitter = new Emitter(config.onEvent);
  const tracker = new SpendTracker(config.limits ?? {}, (event) => emitter.emit(event));
  let mppLeg: ReturnType<typeof createMppLeg> | undefined;

  return async function payingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = toUrlString(input);
    const probe = await baseFetch(input, init);
    if (probe.status !== 402) return probe;

    const protocol = detectProtocol(probe);
    if (protocol === undefined) return probe;

    emitter.emit({ type: "challenge", protocol, url });

    if (protocol === "mpp") {
      // The mpp leg's own onChallenge is the limit gate (it re-probes via mppxClient.fetch,
      // so the amount is only known once it re-parses the real challenge) — no
      // checkAndReserve/release here; see mppLeg.ts.
      mppLeg ??= createMppLeg({
        secret: resolveSecret(config),
        network: config.network,
        rpcUrl: config.rpcUrl,
        channelCommitmentSecret: config.channelCommitmentSecret,
        baseFetch,
        tracker,
        emitter,
        dryRun: internal._dryRun ?? false,
      });
      return mppLeg.fetch(input, init);
    }

    const amount = parseX402Amount(probe);
    tracker.checkAndReserve(amount, url);

    try {
      emitter.emit({ type: "paying", protocol, url });
      const payFetch = buildX402Fetch(baseFetch, { secret: resolveSecret(config), network: config.network, rpcUrl: config.rpcUrl });
      const result = await payFetch(input, init);
      emitter.emit({ type: "paid", protocol, url });
      return result;
    } catch (err) {
      tracker.release(amount);
      emitter.emit({ type: "error", message: err instanceof Error ? err.message : String(err), url });
      throw err;
    }
  };
}
