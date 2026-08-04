import { Hono } from "hono";
import type { LineStore } from "./line.js";

export type SellerDeps = {
  store: LineStore;
  /** The seller's own note/encryption keys — where buyers address their private payment. */
  payTo: { notePublicKey: string; encryptionPublicKey: string; pool: string };
  /** Tokens handed out by the watcher once a line's payment lands. */
  tokens: Map<string, string>;
  /**
   * Refunds the unspent remainder privately, to a destination the BUYER names at close time —
   * the seller has no idea who its payers are and so cannot address a refund on its own.
   * Absent → /line/close reports refunds unavailable.
   */
  refund?: (amountXlm: string, to: { notePublicKey: string; encryptionPublicKey: string }) => Promise<void>;
  /** The intel this API actually sells. */
  intel: () => Promise<unknown>;
  creditsPerLine: number;
  /**
   * Runs the whole lifecycle for a watching visitor (see `demo.ts`). Absent → `/demo/run` 503s,
   * which is what happens when this service has no buyer identity configured.
   */
  runDemo?: () => Promise<{ paid: string; requests: number; refunded: string }>;
  /**
   * Where a failed demo run reports itself. A cycle is fire-and-forget from the visitor's point
   * of view, so without this hook a failure is completely invisible — the feed just goes quiet.
   */
  onDemoError?: (err: unknown) => void;
};

/**
 * A paid API whose payments are *shielded*: the seller can prove it was paid without ever
 * learning who paid. One on-chain shielded transfer opens a credit line; the requests it buys
 * are then answered instantly, so ZK proving is paid once per session rather than per request.
 */
export function buildSeller(deps: SellerDeps): Hono {
  const app = new Hono();
  let demoRunning = false;

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/", (c) =>
    c.json({
      name: "private-api",
      sells: "Stellar testnet intel, paid for out of a shielded pool",
      howToPay: "POST /line/open, send the quoted amount privately to notePublicKey, then GET /intel with your token",
      creditsPerLine: deps.creditsPerLine,
    }),
  );

  /**
   * Quotes a line. The amount is uniquely tagged so the seller can recognize *this* payment in
   * its own balance without the buyer identifying itself.
   */
  app.post("/line/open", (c) => {
    const line = deps.store.open();
    return c.json({
      lineId: line.id,
      amount: line.amount,
      asset: "XLM",
      pool: deps.payTo.pool,
      notePublicKey: deps.payTo.notePublicKey,
      encryptionPublicKey: deps.payTo.encryptionPublicKey,
      credits: line.creditsLeft,
      instructions: `spp transfer ${deps.payTo.pool} ${line.amount} --note-key ${deps.payTo.notePublicKey} --encryption-key ${deps.payTo.encryptionPublicKey}`,
    });
  });

  /**
   * Polled by the buyer after paying. Returns the session token once the seller has seen the
   * payment land — the token, never the line id alone, is what buys requests.
   */
  app.get("/line/:id", (c) => {
    const id = c.req.param("id");
    const line = deps.store.get(id);
    if (!line) return c.json({ error: "unknown_line" }, 404);
    const token = deps.tokens.get(id);
    return c.json({
      lineId: line.id,
      status: line.status,
      creditsLeft: line.creditsLeft,
      amount: line.amount,
      ...(token ? { token } : {}),
    });
  });

  /** The paid route. One credit per call; no per-request on-chain settlement. */
  app.get("/intel", async (c) => {
    const lineId = c.req.header("x-line-id") ?? "";
    const token = c.req.header("x-line-token") ?? "";
    const spend = deps.store.spend(lineId, token);
    if (!spend.ok) {
      const status = spend.reason === "not-funded" || spend.reason === "exhausted" ? 402 : 401;
      return c.json({ error: spend.reason, hint: status === 402 ? "open and fund a line at POST /line/open" : undefined }, status);
    }
    return c.json({ creditsLeft: spend.creditsLeft, intel: await deps.intel() });
  });

  /**
   * Closes a line and privately refunds whatever was not spent. The buyer supplies the refund
   * destination, because the seller genuinely cannot derive it — nothing in a shielded payment
   * identifies its sender. A buyer that wants to stay unlinkable should hand over a note key
   * that is NOT the one registered against its public Stellar account.
   */
  app.post("/line/:id/close", async (c) => {
    const id = c.req.param("id");
    const closed = deps.store.close(id, c.req.header("x-line-token") ?? "");
    if (!closed.ok) return c.json({ error: closed.reason }, closed.reason === "unknown-line" ? 404 : 401);
    deps.tokens.delete(id);
    if (BigInt(closed.refundXlm.replace(".", "")) === 0n) return c.json({ refunded: "0", note: "line fully spent" });
    if (!deps.refund) return c.json({ refunded: "0", owed: closed.refundXlm, note: "refunds not configured on this seller" });

    const body: unknown = await c.req.json().catch(() => ({}));
    const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const notePublicKey = typeof fields["notePublicKey"] === "string" ? fields["notePublicKey"] : "";
    const encryptionPublicKey = typeof fields["encryptionPublicKey"] === "string" ? fields["encryptionPublicKey"] : "";
    if (!notePublicKey || !encryptionPublicKey) {
      return c.json({ refunded: "0", owed: closed.refundXlm, error: "close requires notePublicKey and encryptionPublicKey to refund to" }, 400);
    }

    try {
      await deps.refund(closed.refundXlm, { notePublicKey, encryptionPublicKey });
      return c.json({ refunded: closed.refundXlm, note: "sent privately — the refund is as unlinkable as the payment" });
    } catch (err) {
      // The line is already closed; report honestly rather than pretending it settled.
      return c.json({ refunded: "0", owed: closed.refundXlm, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  /**
   * Drives one full shielded lifecycle. Awaited but fire-and-forget from the dashboard's point
   * of view — it answers 202 and the visitor watches the feed, because a full cycle is two
   * on-chain settlements and takes ~40s. One at a time: the `spp` CLI has a single wallet DB.
   */
  app.post("/demo/run", (c) => {
    if (!deps.runDemo) return c.json({ error: "demo_not_configured" }, 503);
    if (demoRunning) return c.json({ error: "run_in_progress" }, 409);
    demoRunning = true;
    void deps
      .runDemo()
      .catch((err: unknown) => deps.onDemoError?.(err))
      .finally(() => {
        demoRunning = false;
      });
    return c.json({ status: "started" }, 202);
  });

  return app;
}
