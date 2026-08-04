import type { LineStore } from "./line.js";
import type { SppCli } from "./spp.js";

/** Narrates one line to the dashboard feed. Never throws — narration must not break a run. */
export type Narrate = (message: string) => void;

export type DemoResult = { paid: string; requests: number; refunded: string };

/**
 * The whole shielded-payment lifecycle, driven end to end so a visitor can watch it happen:
 * open a line, pay it privately, wait for the seller to spot the money in its own balance,
 * spend some credits, then close and get the remainder refunded privately.
 *
 * Buyer and seller are distinct shielded identities that happen to share a process. That is not
 * a shortcut around the privacy claim — the seller still identifies the payment purely by the
 * amount arriving in its own balance, and still has no way to attribute it to the payer.
 */
export async function runShieldedDemo(deps: {
  store: LineStore;
  tokens: Map<string, string>;
  buyer: SppCli;
  seller: { notePublicKey: string; encryptionPublicKey: string };
  buyerKeys: () => Promise<{ notePublicKey: string; encryptionPublicKey: string }>;
  intel: () => Promise<unknown>;
  refund: (amountXlm: string, to: { notePublicKey: string; encryptionPublicKey: string }) => Promise<void>;
  narrate: Narrate;
  /** Credits to actually spend, leaving the rest to be refunded. */
  spend?: number;
  /** How long to wait for the seller's watcher to see the payment. */
  fundTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DemoResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spend = deps.spend ?? 2;
  const started = Date.now();
  const since = (from: number): string => `${((Date.now() - from) / 1000).toFixed(1)}s`;

  const line = deps.store.open();
  deps.narrate(`Opening a shielded credit line — the seller quotes ${line.amount} XLM, tagged so it can recognize this exact payment.`);

  const paidAt = Date.now();
  await deps.buyer.transfer({
    amountXlm: line.amount,
    notePublicKey: deps.seller.notePublicKey,
    encryptionPublicKey: deps.seller.encryptionPublicKey,
  });
  deps.narrate(`Paid ${line.amount} XLM out of the shielded pool in ${since(paidAt)} — on-chain this is one opaque contract call, no payer, payee or amount.`);

  const waitStart = Date.now();
  const deadline = waitStart + (deps.fundTimeoutMs ?? 120_000);
  let token = deps.tokens.get(line.id);
  while (!token && Date.now() < deadline) {
    await sleep(2000);
    token = deps.tokens.get(line.id);
  }
  if (!token) throw new Error("the seller never saw the payment land in its shielded balance");
  deps.narrate(`Seller spotted ${line.amount} XLM in its own balance after ${since(waitStart)} — it knows it was paid, and cannot tell by whom.`);

  let served = 0;
  for (let i = 0; i < spend; i++) {
    const at = Date.now();
    const outcome = deps.store.spend(line.id, token);
    if (!outcome.ok) break;
    await deps.intel();
    served += 1;
    deps.narrate(`Request ${served} served in ${since(at)} — ${outcome.creditsLeft} credits left, nothing touched the chain.`);
  }

  const closed = deps.store.close(line.id, token);
  deps.tokens.delete(line.id);
  if (!closed.ok) throw new Error(`could not close the line: ${closed.reason}`);
  const back = await deps.buyerKeys();
  await deps.refund(closed.refundXlm, back);
  deps.narrate(`Line closed — ${closed.refundXlm} XLM refunded privately. Whole cycle: ${since(started)}.`);

  return { paid: line.amount, requests: served, refunded: closed.refundXlm };
}
