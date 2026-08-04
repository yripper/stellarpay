import type { LineStore } from "./line.js";
import { fromStroops, toStroops } from "./line.js";

/**
 * Decides which awaited lines an unexplained balance increase pays for.
 *
 * Pure so the matching rule is testable without a chain. Exact single matches are preferred;
 * only if none fits does it fall back to peeling off amounts that fit inside the surplus, which
 * is what happens when two buyers fund between two polls. Amounts are unique per open line
 * (`quoteAmount`), so a peel is very unlikely to credit the wrong line — but it IS a heuristic,
 * and a production seller would verify the note itself rather than a balance delta.
 */
export function matchDeposits(unaccountedStroops: bigint, awaited: string[]): string[] {
  const matched: string[] = [];
  let left = unaccountedStroops;
  const pool = [...awaited].sort((a, b) => Number(BigInt(toStroops(b)) - BigInt(toStroops(a))));
  for (;;) {
    // Both lookups must skip already-matched amounts: each awaited amount belongs to exactly
    // one line, so a surplus of 2x a single amount credits that line once and leaves the rest
    // unaccounted — it is not two payments for the same line.
    const exact = pool.find((a) => BigInt(toStroops(a)) === left && !matched.includes(a));
    if (exact) {
      matched.push(exact);
      break;
    }
    const fits = pool.find((a) => BigInt(toStroops(a)) <= left && !matched.includes(a));
    if (!fits) break;
    matched.push(fits);
    left -= BigInt(toStroops(fits));
  }
  return matched;
}

export type Watcher = { stop: () => void; poll: () => Promise<void> };

/**
 * Polls the seller's own shielded balance and funds any line whose quoted amount arrived.
 *
 * This is the verification step, and it is deliberately one-sided: the seller reads ITS OWN
 * balance and never receives anything from the buyer beyond a line id. It learns that a note of
 * a given size arrived — not who sent it, and not what else that payer has ever bought.
 */
export function startWatcher(deps: {
  balance: () => Promise<string>;
  store: LineStore;
  onFunded: (lineId: string, token: string, amount: string) => void;
  onError?: (err: unknown) => void;
  pollMs?: number;
  /** Injectable for tests; production leaves this to `setInterval`. */
  schedule?: (fn: () => void, ms: number) => { unref?: () => void; close?: () => void };
}): Watcher {
  let accountedFor = 0n;
  let primed = false;
  let running = false;

  async function poll(): Promise<void> {
    if (running) return; // a slow CLI call must not stack up behind itself
    running = true;
    try {
      const balance = BigInt(toStroops(await deps.balance()));
      if (!primed) {
        // Whatever the seller already held before this process started is not payment for any
        // line it is currently offering — bank it so the first poll can't credit a stale balance.
        accountedFor = balance;
        primed = true;
        return;
      }
      const unaccounted = balance - accountedFor;
      if (unaccounted <= 0n) return;
      for (const amount of matchDeposits(unaccounted, deps.store.awaitedAmounts())) {
        const funded = deps.store.fund(amount);
        if (!funded) continue;
        accountedFor += BigInt(toStroops(amount));
        deps.onFunded(funded.line.id, funded.token, amount);
      }
    } catch (err) {
      deps.onError?.(err);
    } finally {
      running = false;
    }
  }

  const timer = (deps.schedule ?? setInterval)(() => void poll(), deps.pollMs ?? 5000);
  timer.unref?.();
  return {
    poll,
    stop: () => {
      if (timer.close) timer.close();
      else clearInterval(timer as unknown as NodeJS.Timeout);
    },
  };
}

/** Re-exported so callers formatting a refund don't need to reach into `line.ts`. */
export { fromStroops };
