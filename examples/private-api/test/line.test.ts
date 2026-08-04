import { describe, expect, it } from "vitest";
import { createLineStore, fromStroops, quoteAmount, toStroops } from "../src/line.js";
import { matchDeposits } from "../src/watcher.js";

const SECRET = "test-token-secret";

function makeStore(overrides: Partial<Parameters<typeof createLineStore>[0]> = {}) {
  return createLineStore({ basePriceXlm: "1", creditsPerLine: 5, tokenSecret: SECRET, ...overrides });
}

describe("quoteAmount", () => {
  it("adds the tag in the sub-microXLM digits, preserving 7-decimal precision", () => {
    expect(quoteAmount("1", 173)).toBe("1.0000173");
    expect(quoteAmount("1", 1)).toBe("1.0000001");
    expect(quoteAmount("0.5", 999_999)).toBe("0.5999999");
  });

  // The tag must never be big enough to matter economically — a buyer quoted "1 XLM" should
  // never be asked for meaningfully more than 1 XLM.
  it("a maximum tag costs under 0.1 XLM", () => {
    const quoted = BigInt(toStroops(quoteAmount("1", 999_999)));
    expect(quoted - BigInt(toStroops("1"))).toBeLessThan(BigInt(toStroops("0.1")));
  });
});

describe("stroop conversion", () => {
  it("round-trips", () => {
    for (const xlm of ["1.0000173", "0.0000001", "1234.5678901", "5"]) {
      expect(fromStroops(BigInt(toStroops(xlm)))).toBe(xlm.includes(".") ? xlm.padEnd(xlm.indexOf(".") + 8, "0") : `${xlm}.0000000`);
    }
  });
});

describe("line store", () => {
  it("quotes distinct amounts for concurrently open lines", () => {
    // A degenerate tag source that repeats its first value once: the store must notice the
    // collision and re-roll rather than quote two lines the same amount, which would make the
    // balance-delta match ambiguous.
    const tags = [42, 42, 77];
    let i = 0;
    const store = makeStore({ randomTag: () => tags[i++] ?? 99 });
    const first = store.open();
    const second = store.open();
    expect(first.amount).not.toBe(second.amount);
  });

  it("does not fund a line until its exact amount arrives, and never on a near miss", () => {
    const store = makeStore({ randomTag: () => 173 });
    const line = store.open();
    expect(store.fund("1.0000174")).toBeUndefined();
    expect(store.fund("1")).toBeUndefined();
    expect(store.get(line.id)?.status).toBe("awaiting-payment");

    const funded = store.fund(line.amount);
    expect(funded?.line.id).toBe(line.id);
    expect(store.get(line.id)?.status).toBe("open");
  });

  it("refuses to spend an unfunded line, then spends down a funded one", () => {
    const store = makeStore({ randomTag: () => 1, creditsPerLine: 2 });
    const line = store.open();
    // Before funding there is no token at all; even a correctly-derived one must not work.
    const early = store.spend(line.id, "whatever");
    expect(early).toEqual({ ok: false, reason: "bad-token" });

    const { token } = store.fund(line.amount)!;
    expect(store.spend(line.id, token)).toEqual({ ok: true, creditsLeft: 1 });
    expect(store.spend(line.id, token)).toEqual({ ok: true, creditsLeft: 0 });
    expect(store.spend(line.id, token)).toEqual({ ok: false, reason: "exhausted" });
  });

  it("rejects a forged token and an unknown line", () => {
    const store = makeStore({ randomTag: () => 5 });
    const line = store.open();
    const { token } = store.fund(line.amount)!;
    expect(store.spend(line.id, `${token.slice(0, -1)}0`)).toEqual({ ok: false, reason: "bad-token" });
    // A wrong-length token must be rejected, not throw (timingSafeEqual would).
    expect(store.spend(line.id, "short")).toEqual({ ok: false, reason: "bad-token" });
    expect(store.spend("line_nope", token)).toEqual({ ok: false, reason: "unknown-line" });
  });

  it("refunds pro-rata for unspent credits and makes the line unspendable first", () => {
    const store = makeStore({ randomTag: () => 0 + 100, creditsPerLine: 5 });
    const line = store.open(); // 1.0000100 XLM for 5 credits
    const { token } = store.fund(line.amount)!;
    store.spend(line.id, token);
    store.spend(line.id, token);

    const closed = store.close(line.id, token);
    expect(closed.ok).toBe(true);
    // 3 of 5 credits unspent -> 3/5 of 10000100 stroops = 6000060 stroops.
    expect(closed).toEqual({ ok: true, refundXlm: "0.6000060" });
    // Critical: a request racing the refund must not still spend.
    expect(store.spend(line.id, token)).toEqual({ ok: false, reason: "closed" });
    expect(store.close(line.id, token)).toEqual({ ok: false, reason: "closed" });
  });

  it("only awaits amounts for lines that are still unpaid", () => {
    const store = makeStore({ randomTag: () => 7 });
    const line = store.open();
    expect(store.awaitedAmounts()).toEqual([line.amount]);
    store.fund(line.amount);
    expect(store.awaitedAmounts()).toEqual([]);
  });
});

describe("matchDeposits", () => {
  it("matches a single exact arrival", () => {
    expect(matchDeposits(BigInt(toStroops("1.0000173")), ["1.0000173", "1.0000584"])).toEqual(["1.0000173"]);
  });

  it("credits nothing when the surplus is smaller than every awaited amount", () => {
    expect(matchDeposits(BigInt(toStroops("0.5")), ["1.0000173"])).toEqual([]);
  });

  it("peels apart two payments that landed between polls", () => {
    const combined = BigInt(toStroops("1.0000173")) + BigInt(toStroops("1.0000584"));
    expect(matchDeposits(combined, ["1.0000173", "1.0000584"]).sort()).toEqual(["1.0000173", "1.0000584"]);
  });

  it("never credits the same awaited line twice from one surplus", () => {
    const doubled = BigInt(toStroops("1.0000173")) * 2n;
    expect(matchDeposits(doubled, ["1.0000173"])).toEqual(["1.0000173"]);
  });
});
