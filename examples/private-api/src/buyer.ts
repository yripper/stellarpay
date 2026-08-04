import { readEnv } from "./env.js";
import { createSppCli } from "./spp.js";

/**
 * The buying side of the shielded-line flow, as an agent would run it:
 *
 *   open a line -> pay it privately, once -> spend the credits instantly -> close and get a
 *   private refund.
 *
 * The expensive part (ZK proving + on-chain settlement) happens once per session, not once per
 * request, which is what makes shielded payments usable for per-call API pricing at all.
 */
const env = readEnv();

const cli = createSppCli({
  bin: env.sppBin,
  account: env.buyerAccount,
  deployment: env.deployment,
  circuitsDir: env.circuitsDir,
  pool: env.pool,
});

const step = (n: number, text: string): void => console.log(`\n[${n}] ${text}`);
const elapsed = (from: number): string => `${((Date.now() - from) / 1000).toFixed(1)}s`;

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${env.sellerUrl}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

step(1, "Opening a credit line with the seller…");
const line = await api("/line/open", { method: "POST" });
console.log(`    line ${line["lineId"]} — pay exactly ${line["amount"]} XLM (uniquely tagged so the seller can spot it)`);
console.log(`    to note key ${String(line["notePublicKey"]).slice(0, 26)}…`);

step(2, `Paying ${line["amount"]} XLM privately from the shielded pool (proving + settling)…`);
const paidAt = Date.now();
await cli.transfer({
  amountXlm: String(line["amount"]),
  notePublicKey: String(line["notePublicKey"]),
  encryptionPublicKey: String(line["encryptionPublicKey"]),
});
console.log(`    settled in ${elapsed(paidAt)} — on-chain this is one opaque contract call, with no payer, payee, or amount visible`);

step(3, "Waiting for the seller to notice the payment in its own balance…");
const waitStart = Date.now();
let token = "";
for (let attempt = 0; attempt < 40 && !token; attempt++) {
  const status = await api(`/line/${String(line["lineId"])}`);
  if (typeof status["token"] === "string") token = status["token"];
  else await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!token) throw new Error("the seller never saw the payment — is its watcher running against the same pool?");
console.log(`    line opened after ${elapsed(waitStart)}; the seller knows it was paid and NOT who paid it`);

step(4, `Spending the line — ${line["credits"]} requests, no further on-chain settlement:`);
const headers = { "x-line-id": String(line["lineId"]), "x-line-token": token };
for (let i = 1; i <= Number(line["credits"]); i++) {
  const at = Date.now();
  const bought = await api("/intel", { headers });
  const intel = bought["intel"] as { lastLedger?: string; ledgerCapacityUsage?: string };
  console.log(`    request ${i}: ledger ${intel.lastLedger} · capacity ${intel.ledgerCapacityUsage} · ${bought["creditsLeft"]} credits left (${elapsed(at)})`);
  if (i === 2) break; // leave credits unspent so the refund below is visible
}

step(5, "Closing the line — the unspent remainder comes back, privately…");
const mine = await cli.keys();
const closed = await api(`/line/${String(line["lineId"])}/close`, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ notePublicKey: mine.notePublicKey, encryptionPublicKey: mine.encryptionPublicKey }),
});
console.log(`    refunded ${closed["refunded"]} XLM — ${closed["note"]}`);

console.log("\nOne shielded payment bought a session. The seller was paid, can prove it, and still");
console.log("cannot tell you who its customer was.");
