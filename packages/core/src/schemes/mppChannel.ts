import { Mppx, Store } from "mppx/server";
import { close, getChannelState, stellar, watchChannel } from "@stellar/mpp/channel/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { StrKey } from "@stellar/stellar-sdk";
import { dollarToDecimal, NETWORKS } from "../internal/index.js";
import type { Receipt, RouteRule, SchemeModule, SchemeOutcome, StellarpayConfig } from "../types.js";

/** Re-exported for ops tooling (settlement scripts, dispute monitors) — see `@stellar/mpp/channel/server`. */
export { close, getChannelState, watchChannel };

function amountFor(rule: RouteRule): { amount: string; asset: string } {
  if (typeof rule.price === "string") return { amount: dollarToDecimal(rule.price), asset: "USDC" };
  return { amount: rule.price.amount, asset: rule.price.asset };
}

/**
 * MPP channel scheme: off-chain voucher accumulation against an on-chain one-way
 * payment channel via mppx + @stellar/mpp (pull mode, `stellar.channel`).
 *
 * Replay protection, cumulative-amount tracking, and channel lifecycle state are
 * backed by `Store.memory()` — an in-process `Map` scoped to this module instance.
 * Consequences to be aware of before relying on this in production:
 * - State is lost on process restart, so a spent voucher could be re-verified after a
 *   redeploy or crash.
 * - It is not shared across processes or instances, so in a horizontally-scaled or
 *   serverless deployment a credential spent against one instance can still replay
 *   against a sibling instance.
 * Single-process deployments are the supported v0.1 topology; a pluggable store (e.g.
 * Redis-backed, satisfying mppx's `Store.AtomicStore` contract) is on the roadmap for
 * multi-instance deployments.
 *
 * On-chain currency verification is pinned to `USDC_SAC_TESTNET` (same known v0.1
 * simplification as the mpp-charge module); pubnet channel deployments settling in
 * mainnet USDC must wait for a mainnet-preset roadmap item before this can verify
 * their token correctly.
 */
export function createMppChannelModule(cfg: StellarpayConfig): SchemeModule {
  const commitmentKey = StrKey.encodeEd25519PublicKey(Buffer.from(cfg.channel!.commitmentPublicKey, "hex"));

  const mppx = Mppx.create({
    secretKey: cfg.mppSecretKey!,
    methods: [
      stellar.channel({
        channel: cfg.channel!.contract,
        commitmentKey,
        store: Store.memory(),
        network: cfg.network,
        rpcUrl: cfg.rpcUrl ?? NETWORKS[cfg.network].rpcUrl,
        recipient: cfg.payTo,
        currency: USDC_SAC_TESTNET,
      }),
    ],
  });

  return {
    scheme: "mpp-channel",
    async handle(req, match): Promise<SchemeOutcome> {
      const { amount, asset } = amountFor(match.rule);
      const result = await mppx.channel({ amount, description: match.rule.description ?? match.pattern })(req);
      if (result.status === 402) return { type: "respond", response: result.challenge };
      // Capture the Payment-Receipt header without hijacking the route's own response:
      const probe = result.withReceipt(new Response(null));
      const headers = Object.fromEntries(probe.headers.entries());
      const receipt: Receipt = {
        scheme: "mpp-channel", route: match.pattern, network: cfg.network,
        amount, asset, raw: headers["payment-receipt"], timestamp: new Date().toISOString(),
      };
      return { type: "pass", receipt, headers };
    },
  };
}
