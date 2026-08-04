import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { Keypair } from "@stellar/stellar-sdk";
import { dollarToDecimal, NETWORKS } from "../internal/index.js";
import type { Receipt, RouteRule, SchemeModule, SchemeOutcome, StellarpayConfig } from "../types.js";

function amountFor(rule: RouteRule): { amount: string; asset: string } {
  if (typeof rule.price === "string") return { amount: dollarToDecimal(rule.price), asset: "USDC" };
  return { amount: rule.price.amount, asset: rule.price.asset };
}

/** 64-character lowercase hex — the shape of a Stellar transaction hash (a SHA-256 digest). */
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The mpp `Payment-Receipt` header's `reference` field carries the on-chain settlement hash
 * for the `stellar` charge method — `@stellar/mpp`'s server sets `reference` to the broadcast
 * transaction's hash (its `Charge.js` server module: `reference: hash` / `reference:
 * sendResult.hash`), the same hash Horizon indexes. This exists so the mpp-charge leg's
 * receipt can carry a `txHash` the way the x402 leg's already does, instead of leaving every
 * MPP row on the dashboard unverifiable. The header's schema is otherwise owned by
 * `mppx`/`@stellar/mpp`, not this package, so every step decodes defensively: any failure
 * (missing header, undecodable base64url, non-JSON payload, no `reference`, or a `reference`
 * that isn't hash-shaped) yields `undefined` rather than a guessed value — a wrong explorer
 * link on camera during a live demo is worse than no link at all.
 */
export function txHashFromReceiptHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof decoded !== "object" || decoded === null) return undefined;
  const reference = (decoded as Record<string, unknown>)["reference"];
  return typeof reference === "string" && TX_HASH_PATTERN.test(reference) ? reference : undefined;
}

/**
 * MPP charge scheme: per-request on-chain settlement via mppx + @stellar/mpp (pull mode).
 *
 * Replay protection is backed by `Store.memory()` — an in-process `Map` scoped to this
 * module instance. Consequences to be aware of before relying on this in production:
 * - State is lost on process restart, so a spent challenge could be re-verified after a
 *   redeploy or crash.
 * - It is not shared across processes or instances, so in a horizontally-scaled or
 *   serverless deployment a credential spent against one instance can still replay
 *   against a sibling instance.
 * Single-process deployments are the supported v0.1 topology; a pluggable store (e.g.
 * Redis-backed, satisfying mppx's `Store.AtomicStore` contract) is on the roadmap for
 * multi-instance deployments.
 */
export function createMppChargeModule(cfg: StellarpayConfig): SchemeModule {
  const mppx = Mppx.create({
    secretKey: cfg.mppSecretKey!,
    methods: [
      stellar.charge({
        recipient: cfg.payTo,
        currency: USDC_SAC_TESTNET,
        network: cfg.network,
        rpcUrl: cfg.rpcUrl ?? NETWORKS[cfg.network].rpcUrl,
        store: Store.memory(),
        ...(cfg.sponsorSecret ? { feePayer: { envelopeSigner: Keypair.fromSecret(cfg.sponsorSecret) } } : {}),
      }),
    ],
  });

  return {
    scheme: "mpp-charge",
    async handle(req, match): Promise<SchemeOutcome> {
      const { amount, asset } = amountFor(match.rule);
      const result = await mppx.charge({ amount, description: match.rule.description ?? match.pattern })(req);
      if (result.status === 402) return { type: "respond", response: result.challenge };
      // Capture the Payment-Receipt header without hijacking the route's own response:
      const probe = result.withReceipt(new Response(null));
      const headers = Object.fromEntries(probe.headers.entries());
      const raw = headers["payment-receipt"];
      const receipt: Receipt = {
        scheme: "mpp-charge", route: match.pattern, network: cfg.network,
        amount, asset, raw, timestamp: new Date().toISOString(),
      };
      const txHash = txHashFromReceiptHeader(raw);
      if (txHash) receipt.txHash = txHash;
      return { type: "pass", receipt, headers };
    },
  };
}
