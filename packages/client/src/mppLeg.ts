import { Keypair } from "@stellar/stellar-sdk";
import { Challenge } from "mppx";
import { Mppx, Transport } from "mppx/client";
import * as chargeClient from "@stellar/mpp/charge/client";
import * as channelClient from "@stellar/mpp/channel/client";
import { toUrlString } from "./url.js";
import type { SpendTracker } from "./limits.js";
import type { Emitter } from "./events.js";

/** Configuration consumed by {@link createMppLeg}, assembled by `index.ts`. */
export type MppLegConfig = {
  /** Stellar secret seed, already resolved by `index.ts`'s `resolveSecret`. */
  secret: string;
  network: "stellar:testnet" | "stellar:pubnet";
  rpcUrl?: string;
  /** Enables the `mpp-channel` client method; omitted → only `mpp-charge` is registered. */
  channelCommitmentSecret?: string;
  /** Transport to probe/pay through — the `_baseFetch` seam, or raw `fetch`. */
  baseFetch: typeof fetch;
  /** Shared with the x402 leg so `maxTotal` is enforced across both protocols. */
  tracker: SpendTracker;
  emitter: Emitter;
  /**
   * Test seam (undocumented): after the limit gate runs and reserves budget, throw
   * instead of calling `helpers.createCredential()`. mppx's fetch wrapper falls back to
   * its own default credential creation whenever `onChallenge` resolves to `undefined`
   * (see `mppx/dist/client/internal/Fetch.js`'s `onChallengeCredential ?? (await
   * createCredential())`), so returning `undefined` would still sign/broadcast — only a
   * thrown error reliably stops the flow before RPC, which is what this seam needs to
   * prove the limit gate ran without touching the network.
   */
  dryRun?: boolean;
};

/** Bookkeeping kept per in-flight challenge, keyed by `challenge.id` so overlapping
 * requests on the same leg don't clobber each other's URL/reservation. */
type PendingChallenge = { url: string; amount: bigint | undefined };

/**
 * Extracts the challenged amount from an mppx `Challenge`, for `SpendTracker`.
 *
 * Both the `stellar.charge` and `stellar.channel` server methods run their configured
 * amount through `toBaseUnits()` in their `request()` hook before it is embedded in the
 * issued challenge, and verify it via `BigInt(challengeRequest.amount)` — so
 * `challenge.request.amount`, as seen here on the client, is already an atomic-base-unit
 * integer string, not a decimal dollar string (verified against
 * `@stellar/mpp/dist/{charge,channel}/server/*.js`'s `request()` hooks and `doVerify`,
 * and `@stellar/mpp/dist/shared/units.d.ts`'s `toBaseUnits('0.01', 7) // '100000'`
 * doc-example). `BigInt(...)` is applied directly here, mirroring `x402Leg.ts`'s
 * `parseX402Amount` for the same reason.
 *
 * `challenge.request` is typed as `Record<string, unknown>` until a specific method's
 * schema narrows it, so `amount` is read defensively — the sole verified field name
 * shared by both methods' request schemas (`@stellar/mpp/dist/{charge,channel}/client/
 * {Charge,Channel}.d.ts`). Anything missing or unparseable resolves to `undefined`, which
 * routes the caller through `SpendTracker`'s unknown-amount path instead of trusting it.
 */
function extractChallengeAmount(challenge: Challenge.Challenge): bigint | undefined {
  const request = challenge.request as Record<string, unknown> | undefined;
  const amount = request?.["amount"];
  if (typeof amount !== "string") return undefined;
  try {
    return BigInt(amount);
  } catch {
    return undefined;
  }
}

/**
 * Builds the MPP payment leg: an `mppx` client wired with the `stellar.charge` method
 * (and, when `channelCommitmentSecret` is supplied, `stellar.channel` too), whose
 * `onChallenge` hook is the spend-limit gate.
 *
 * `polyfill: false` — this leg never touches `globalThis.fetch`; `index.ts` calls
 * `mppxClient.fetch` directly on the request it already decided is an MPP challenge.
 */
export function createMppLeg(config: MppLegConfig): Mppx.Mppx<Mppx.Methods, Transport.Transport<RequestInit, Response>> {
  const keypair = Keypair.fromSecret(config.secret);
  const pending = new Map<string, PendingChallenge>();

  const mppxClient = Mppx.create({
    polyfill: false,
    fetch: config.baseFetch,
    methods: [
      chargeClient.stellar({ keypair, mode: "pull", rpcUrl: config.rpcUrl }),
      ...(config.channelCommitmentSecret
        ? [
            channelClient.stellar({
              commitmentSecret: config.channelCommitmentSecret,
              network: config.network,
              rpcUrl: config.rpcUrl,
            }),
          ]
        : []),
    ],
    async onChallenge(challenge, helpers) {
      const entry = pending.get(challenge.id);
      const url = entry?.url ?? challenge.realm;
      const amount = extractChallengeAmount(challenge);
      config.tracker.checkAndReserve(amount, url); // throws SpendLimitExceeded; nothing reserved on throw
      if (entry) entry.amount = amount; // only reached once the reservation actually landed
      config.emitter.emit({ type: "paying", protocol: "mpp", url });
      if (config.dryRun) throw new Error("stellarpay: _dryRun stops before credential creation");
      return helpers.createCredential();
    },
  });

  mppxClient.onChallengeReceived(({ challenge, input }) => {
    const url = input !== undefined ? toUrlString(input) : challenge.realm;
    pending.set(challenge.id, { url, amount: undefined });
    config.emitter.emit({ type: "challenge", protocol: "mpp", url });
    // This handler only observes — a non-empty string return would be adopted as the
    // credential, skipping onChallenge (and its limit gate) entirely.
    return undefined;
  });

  mppxClient.onCredentialCreated(({ challenge, input }) => {
    const entry = pending.get(challenge.id);
    pending.delete(challenge.id); // success: the reservation stands — nothing left to release
    const url = entry?.url ?? (input !== undefined ? toUrlString(input) : challenge.realm);
    config.emitter.emit({ type: "paid", protocol: "mpp", url });
  });

  mppxClient.onPaymentFailed(({ challenge, input, error }) => {
    const entry = challenge ? pending.get(challenge.id) : undefined;
    if (challenge) pending.delete(challenge.id);
    if (entry) config.tracker.release(entry.amount);
    const url = entry?.url ?? (input !== undefined ? toUrlString(input) : (challenge?.realm ?? "unknown"));
    config.emitter.emit({ type: "error", message: error instanceof Error ? error.message : String(error), url });
  });

  return mppxClient;
}
