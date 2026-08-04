import { describe, expect, it } from "vitest";
import { extractWhales } from "../src/whales.js";

const pay = (amount: string, extra: Record<string, unknown> = {}) => ({
  type: "payment",
  asset_type: "native",
  amount,
  from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFROM",
  to: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATO",
  created_at: "2026-08-03T00:00:00Z",
  transaction_hash: "deadbeef",
  ...extra,
});

describe("extractWhales", () => {
  it("keeps only native payments, sorted desc, capped to the limit", () => {
    const records = [pay("50"), pay("99999"), pay("20000"), pay("70000"), { type: "create_account" }, pay("30000", { asset_type: "credit_alphanum4" })];
    const whales = extractWhales(records, 2);
    expect(whales.map((w) => w.amountXlm)).toEqual(["99999", "70000"]);
    expect(whales[0]).toMatchObject({
      asset: "XLM",
      tx: "deadbeef",
      link: "https://stellar.expert/explorer/testnet/tx/deadbeef",
    });
  });

  it("survives malformed records", () => {
    expect(extractWhales([null, 42, {}, { type: "payment" }], 5)).toEqual([]);
  });

  it("returns an empty array for an empty window", () => {
    expect(extractWhales([], 10)).toEqual([]);
  });

  it("returns fewer than the limit when the window has fewer native payments", () => {
    const records = [pay("5"), pay("2"), { type: "create_account" }, pay("30", { asset_type: "credit_alphanum4" })];
    const whales = extractWhales(records, 10);
    expect(whales.map((w) => w.amountXlm)).toEqual(["5", "2"]);
    expect(whales).toHaveLength(2);
  });
});
