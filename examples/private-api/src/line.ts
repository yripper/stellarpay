import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * A credit line bought with one shielded payment. The seller never learns who funded it —
 * only that a note of the quoted amount arrived in its own shielded balance.
 */
export type Line = {
  id: string;
  /** The exact XLM amount this line must be funded with, tagged to be unique (see quoteAmount). */
  amount: string;
  /** Requests still purchasable on this line. */
  creditsLeft: number;
  status: "awaiting-payment" | "open" | "closed";
  openedAt: number;
};

export type LineStore = ReturnType<typeof createLineStore>;

/** Stroops per XLM — Stellar's 7-decimal fixed-point unit. */
const STROOPS = 10_000_000n;

/**
 * Quotes a payment amount that is unique among open lines.
 *
 * This is the whole verification trick. The seller cannot ask "did buyer X pay me?" — shielded
 * notes carry no sender — so it asks "did *exactly* this many stroops arrive?" instead. Two
 * concurrent buyers quoted a flat 1 XLM would be indistinguishable in a balance delta; quoted
 * 1.0000173 and 1.0000584 they are not. `tag` is drawn from the sub-microXLM digits, which are
 * economically irrelevant (a tag costs at most 0.0000999 XLM ≈ nothing) but arithmetically
 * decisive.
 */
export function quoteAmount(baseXlm: string, tag: number): string {
  const [whole = "0", frac = ""] = baseXlm.split(".");
  const base = BigInt(whole) * STROOPS + BigInt(frac.padEnd(7, "0").slice(0, 7));
  const total = base + BigInt(tag);
  const asStroops = total % STROOPS;
  return `${total / STROOPS}.${asStroops.toString().padStart(7, "0")}`;
}

/** HMAC session token. The line id alone must not be enough to spend — it is quoted publicly. */
function sign(secret: string, lineId: string): string {
  return createHmac("sha256", secret).update(lineId).digest("hex");
}

/** Constant-time compare that never throws on a length mismatch (Buffer.equals would). */
function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type RejectReason = "unknown-line" | "bad-token" | "not-funded" | "exhausted" | "closed";

export type SpendOutcome = { ok: true; creditsLeft: number } | { ok: false; reason: RejectReason };

export type CloseOutcome = { ok: true; refundXlm: string } | { ok: false; reason: RejectReason };

/**
 * In-memory line ledger. Single-process only, exactly like `@stellarpay-sdk/core`'s mpp replay
 * store — a restart forgets every open line, and a horizontally-scaled deployment would need
 * shared storage. Fine for a demo, stated so nobody ships it as-is.
 */
export function createLineStore(config: {
  /** Base price of one line, in XLM. The tag is added on top. */
  basePriceXlm: string;
  /** Requests a funded line buys. */
  creditsPerLine: number;
  /** HMAC key for session tokens. */
  tokenSecret: string;
  /** Injectable for tests. */
  now?: () => number;
  /** Injectable for tests; must return a distinct value per call in production. */
  randomTag?: () => number;
}) {
  const now = config.now ?? Date.now;
  // 1..999_999 stroops: never 0 (an untagged amount would collide with the base price) and
  // always under 0.1 XLM, so the tag can't meaningfully change what the buyer pays.
  const randomTag = config.randomTag ?? ((): number => randomInt(1, 1_000_000));
  const lines = new Map<string, Line>();

  return {
    /** Quotes a new line. Retries the tag until the amount is unique among lines still owed. */
    open(): Line {
      const owed = new Set([...lines.values()].filter((l) => l.status === "awaiting-payment").map((l) => l.amount));
      let amount = "";
      // Bounded: with <1000 open lines over a 999_999-value tag space, a second collision is
      // already vanishingly unlikely — but never loop forever on a degenerate randomTag.
      for (let attempt = 0; attempt < 50; attempt++) {
        amount = quoteAmount(config.basePriceXlm, randomTag());
        if (!owed.has(amount)) break;
      }
      const line: Line = {
        id: `line_${randomInt(1, 2 ** 48).toString(36)}`,
        amount,
        creditsLeft: config.creditsPerLine,
        status: "awaiting-payment",
        openedAt: now(),
      };
      lines.set(line.id, line);
      return line;
    },

    /** The amounts the seller is currently watching its shielded balance for. */
    awaitedAmounts(): string[] {
      return [...lines.values()].filter((l) => l.status === "awaiting-payment").map((l) => l.amount);
    },

    /**
     * Marks the line whose quoted amount just arrived as funded, returning its session token.
     * `undefined` when no line is awaiting that exact amount — an unmatched delta is somebody
     * else's payment, and crediting it to the wrong line would hand out free requests.
     */
    fund(amount: string): { line: Line; token: string } | undefined {
      const line = [...lines.values()].find((l) => l.status === "awaiting-payment" && l.amount === amount);
      if (!line) return undefined;
      line.status = "open";
      return { line, token: sign(config.tokenSecret, line.id) };
    },

    /** Spends one credit. The token, not the id, is the bearer of authority. */
    spend(lineId: string, token: string): SpendOutcome {
      const line = lines.get(lineId);
      if (!line) return { ok: false, reason: "unknown-line" };
      if (!tokenMatches(sign(config.tokenSecret, lineId), token)) return { ok: false, reason: "bad-token" };
      if (line.status === "awaiting-payment") return { ok: false, reason: "not-funded" };
      if (line.status === "closed") return { ok: false, reason: "closed" };
      if (line.creditsLeft <= 0) return { ok: false, reason: "exhausted" };
      line.creditsLeft -= 1;
      return { ok: true, creditsLeft: line.creditsLeft };
    },

    /**
     * Closes a line and reports what is owed back. Refunding is the caller's job (it needs the
     * chain); this only does the arithmetic and makes the line unspendable first, so a request
     * racing the refund can't spend a credit that has already been paid back.
     */
    close(lineId: string, token: string): CloseOutcome {
      const line = lines.get(lineId);
      if (!line) return { ok: false, reason: "unknown-line" };
      if (!tokenMatches(sign(config.tokenSecret, lineId), token)) return { ok: false, reason: "bad-token" };
      if (line.status === "awaiting-payment") return { ok: false, reason: "not-funded" };
      if (line.status === "closed") return { ok: false, reason: "closed" };
      const perCredit = BigInt(toStroops(line.amount)) / BigInt(config.creditsPerLine);
      const refund = perCredit * BigInt(line.creditsLeft);
      line.status = "closed";
      line.creditsLeft = 0;
      return { ok: true, refundXlm: fromStroops(refund) };
    },

    get(lineId: string): Line | undefined {
      return lines.get(lineId);
    },
  };
}

/** `"1.0000173"` → `"10000173"`. */
export function toStroops(xlm: string): string {
  const [whole = "0", frac = ""] = xlm.split(".");
  return (BigInt(whole) * STROOPS + BigInt(frac.padEnd(7, "0").slice(0, 7))).toString();
}

/** `10000173n` → `"1.0000173"`. */
export function fromStroops(stroops: bigint): string {
  return `${stroops / STROOPS}.${(stroops % STROOPS).toString().padStart(7, "0")}`;
}
