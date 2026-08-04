import { serve } from "@hono/node-server";
import { readEnv } from "./env.js";
import { createLineStore } from "./line.js";
import { createSppCli } from "./spp.js";
import { buildSeller } from "./server.js";
import { startWatcher } from "./watcher.js";

const env = readEnv();

const cli = createSppCli({
  bin: env.sppBin,
  account: env.sellerAccount,
  deployment: env.deployment,
  circuitsDir: env.circuitsDir,
  pool: env.pool,
});

const store = createLineStore({
  basePriceXlm: env.basePriceXlm,
  creditsPerLine: env.creditsPerLine,
  tokenSecret: env.tokenSecret,
});

const tokens = new Map<string, string>();

/** What this API sells: live Stellar testnet fee/congestion stats, read fresh from Horizon. */
async function intel(): Promise<unknown> {
  const res = await fetch("https://horizon-testnet.stellar.org/fee_stats");
  if (!res.ok) throw new Error(`Horizon fee_stats -> ${res.status}`);
  const body = (await res.json()) as { last_ledger: string; fee_charged: Record<string, string>; ledger_capacity_usage: string };
  return {
    lastLedger: body.last_ledger,
    ledgerCapacityUsage: body.ledger_capacity_usage,
    feeCharged: { min: body.fee_charged["min"], p50: body.fee_charged["p50"], p99: body.fee_charged["p99"] },
    source: "horizon-testnet.stellar.org/fee_stats",
  };
}

const keys = await cli.keys();
console.log(`private-api selling from shielded pool ${env.pool}`);
console.log(`  note key: ${keys.notePublicKey}`);

startWatcher({
  balance: () => cli.balance(),
  store,
  onFunded: (lineId, token, amount) => {
    tokens.set(lineId, token);
    // The seller knows an amount arrived. It does NOT know who sent it — that is the point.
    console.log(`line ${lineId} funded: ${amount} XLM arrived from an unknown payer`);
  },
  onError: (err) => console.error(`balance poll failed: ${err instanceof Error ? err.message : String(err)}`),
  pollMs: 4000,
});

const app = buildSeller({
  store,
  tokens,
  payTo: { notePublicKey: keys.notePublicKey, encryptionPublicKey: keys.encryptionPublicKey, pool: env.pool },
  refund: (amountXlm, to) => cli.transfer({ amountXlm, notePublicKey: to.notePublicKey, encryptionPublicKey: to.encryptionPublicKey }),
  intel,
  creditsPerLine: env.creditsPerLine,
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`private-api listening on :${info.port}`);
});
