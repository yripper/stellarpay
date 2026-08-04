import { serve } from "@hono/node-server";
import { readEnv } from "./env.js";
import { createLineStore } from "./line.js";
import { createSppCli } from "./spp.js";
import { buildSeller } from "./server.js";
import { startWatcher } from "./watcher.js";
import { runShieldedDemo } from "./demo.js";

const env = readEnv();

const cli = createSppCli({
  bin: env.sppBin,
  account: env.sellerAccount,
  deployment: env.deployment,
  circuitsDir: env.circuitsDir,
  pool: env.pool,
  timeoutMs: env.sppTimeoutMs,
  ...(env.dataDir ? { dataDir: env.dataDir } : {}),
});

/**
 * The buyer identity used by `/demo/run`. A distinct shielded identity that happens to share
 * this process — the seller still cannot attribute the payment to it.
 */
const buyerCli = createSppCli({
  bin: env.sppBin,
  account: env.buyerAccount,
  deployment: env.deployment,
  circuitsDir: env.circuitsDir,
  pool: env.pool,
  timeoutMs: env.sppTimeoutMs,
  ...(env.dataDir ? { dataDir: env.dataDir } : {}),
});

/** Narrates a demo run onto the dashboard's live feed, exactly like the agent does. */
function narrate(message: string): void {
  console.log(message);
  if (!env.dashboardUrl || !env.ingestSecret) return;
  void fetch(`${env.dashboardUrl}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.ingestSecret}` },
    body: JSON.stringify({ service: "private-api", kind: "agent-log", message }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // Narration is best-effort: an unreachable dashboard must never fail a payment run.
  });
}

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

const refund = (amountXlm: string, to: { notePublicKey: string; encryptionPublicKey: string }): Promise<void> =>
  cli.transfer({ amountXlm, notePublicKey: to.notePublicKey, encryptionPublicKey: to.encryptionPublicKey });

const app = buildSeller({
  store,
  tokens,
  payTo: { notePublicKey: keys.notePublicKey, encryptionPublicKey: keys.encryptionPublicKey, pool: env.pool },
  refund,
  intel,
  creditsPerLine: env.creditsPerLine,
  runDemo: () =>
    runShieldedDemo({
      store,
      tokens,
      buyer: buyerCli,
      seller: { notePublicKey: keys.notePublicKey, encryptionPublicKey: keys.encryptionPublicKey },
      buyerKeys: async () => {
        const k = await buyerCli.keys();
        return { notePublicKey: k.notePublicKey, encryptionPublicKey: k.encryptionPublicKey };
      },
      intel,
      refund,
      narrate,
      // Detection = the watcher's next `overview` after the note lands, and a single overview
      // can take tens of seconds on shared cloud vCPUs. The local default (120s) is too tight.
      fundTimeoutMs: 300_000,
    }),
  onDemoError: (err) => {
    // The message names the failing step (spp stderr or a demo-stage error); never a secret.
    narrate(`Shielded demo run failed: ${err instanceof Error ? err.message : String(err)}`);
  },
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`private-api listening on :${info.port}`);
});
