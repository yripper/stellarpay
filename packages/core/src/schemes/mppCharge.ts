import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { Keypair } from "@stellar/stellar-sdk";
import { dollarToDecimal, NETWORKS } from "@stellarpay/shared";
import type { Receipt, RouteRule, SchemeModule, SchemeOutcome, StellarpayConfig } from "../types.js";

function amountFor(rule: RouteRule): { amount: string; asset: string } {
  if (typeof rule.price === "string") return { amount: dollarToDecimal(rule.price), asset: "USDC" };
  return { amount: rule.price.amount, asset: rule.price.asset };
}

/** MPP charge scheme: per-request on-chain settlement via mppx + @stellar/mpp (pull mode). */
export function createMppChargeModule(cfg: StellarpayConfig): SchemeModule {
  const mppx = Mppx.create({
    secretKey: cfg.mppSecretKey!,
    methods: [
      stellar.charge({
        recipient: cfg.payTo,
        currency: USDC_SAC_TESTNET, // explicit-asset routes override per call via amountFor
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
      const receipt: Receipt = {
        scheme: "mpp-charge", route: match.pattern, network: cfg.network,
        amount, asset, raw: headers["payment-receipt"], timestamp: new Date().toISOString(),
      };
      return { type: "pass", receipt, headers };
    },
  };
}
