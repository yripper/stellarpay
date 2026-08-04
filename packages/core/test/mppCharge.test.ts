import { describe, it, expect } from "vitest";
import { Challenge } from "mppx";
import { createMppChargeModule, txHashFromReceiptHeader } from "../src/schemes/mppCharge.js";
import { decimalToBaseUnits } from "../src/internal/price.js";

// Real production Payment-Receipt header, captured live (see docs/modules/core.md's
// "Confirmed Wire Shapes"): base64url of
// {"method":"stellar","reference":"20e4b38c2d8589b01ab1069209448bb653ce7650ecc9edbb33f6d103f0c9d05a","status":"success","timestamp":"2026-08-04T16:51:21.790Z"}
// `reference` resolves on Horizon testnet as a real, successful transaction (ledger 3968442) —
// confirmed via `curl https://horizon-testnet.stellar.org/transactions/20e4b3...` before this
// test was written.
const REAL_RECEIPT_HEADER =
  "eyJtZXRob2QiOiJzdGVsbGFyIiwicmVmZXJlbmNlIjoiMjBlNGIzOGMyZDg1ODliMDFhYjEwNjkyMDk0NDhiYjY1M2NlNzY1MGVjYzllZGJiMzNmNmQxMDNmMGM5ZDA1YSIsInN0YXR1cyI6InN1Y2Nlc3MiLCJ0aW1lc3RhbXAiOiIyMDI2LTA4LTA0VDE2OjUxOjIxLjc5MFoifQ";
const REAL_TX_HASH = "20e4b38c2d8589b01ab1069209448bb653ce7650ecc9edbb33f6d103f0c9d05a";

const cfg = {
  network: "stellar:testnet" as const, payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret-please-rotate",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" as const } },
};

describe("mpp-charge module", () => {
  it("responds 402 with challenge headers for unpaid request", async () => {
    const mod = createMppChargeModule(cfg);
    const out = await mod.handle(new Request("http://x/paid"), { pattern: "GET /paid", rule: cfg.routes["GET /paid"]! });
    expect(out.type).toBe("respond");
    if (out.type === "respond") {
      expect(out.response.status).toBe(402);
      // mppx serializes the challenge into response headers; at least one header must be present
      expect([...out.response.headers.keys()].length).toBeGreaterThan(0);
    }
  });
  it("converts dollar price to decimal amount for mppx, not the raw \"$0.01\" string", async () => {
    // The challenge is carried on the 402 response's WWW-Authenticate header (mppx's default
    // HTTP transport, `Challenge.serialize` — verified against
    // node_modules/mppx/dist/server/Transport.js). `Challenge.fromResponse` decodes it back
    // into `{ request: { amount, ... } }`. @stellar/mpp's `stellar.charge` server method runs
    // that decimal amount through `toBaseUnits()` before embedding it (verified against
    // node_modules/@stellar/mpp/dist/charge/server/Charge.js's `request()` hook), so the wire
    // amount is base units, not "0.01" — decoding it and asserting the exact base-unit value
    // makes the dollarToDecimal("$0.01") -> "0.01" conversion load-bearing: passing the raw
    // "$0.01" straight through (skipping the $-strip) would make mppx's toBaseUnits() throw on
    // the leading "$" (`BigInt("$0")` is not valid), and any other wrong conversion would
    // produce a different base-unit amount here.
    const mod = createMppChargeModule(cfg);
    const out = await mod.handle(new Request("http://x/paid"), { pattern: "GET /paid", rule: { price: "$0.01", scheme: "mpp-charge" } });
    expect(out.type).toBe("respond");
    if (out.type !== "respond") throw new Error("expected a 402 respond outcome");
    const challenge = Challenge.fromResponse(out.response);
    expect(challenge.request["amount"]).toBe(decimalToBaseUnits("0.01").toString());
  });
});

describe("txHashFromReceiptHeader", () => {
  it("decodes a real production Payment-Receipt header to its settlement tx hash", () => {
    expect(txHashFromReceiptHeader(REAL_RECEIPT_HEADER)).toBe(REAL_TX_HASH);
  });

  it("returns undefined when the header is absent", () => {
    expect(txHashFromReceiptHeader(undefined)).toBeUndefined();
  });

  it("returns undefined for a header that is not valid base64url JSON", () => {
    expect(txHashFromReceiptHeader("not-valid-base64url-json!!!")).toBeUndefined();
  });

  it("returns undefined when the decoded payload is valid base64url but not JSON", () => {
    // base64url of the plain string "hello world", not JSON at all
    expect(txHashFromReceiptHeader(Buffer.from("hello world", "utf8").toString("base64url"))).toBeUndefined();
  });

  it("returns undefined when the decoded JSON has no reference field", () => {
    const header = Buffer.from(JSON.stringify({ method: "stellar", status: "success" }), "utf8").toString("base64url");
    expect(txHashFromReceiptHeader(header)).toBeUndefined();
  });

  it("returns undefined when reference is not hash-shaped (wrong length)", () => {
    const header = Buffer.from(JSON.stringify({ reference: "abc123" }), "utf8").toString("base64url");
    expect(txHashFromReceiptHeader(header)).toBeUndefined();
  });

  it("returns undefined when reference is not hash-shaped (uppercase / non-hex)", () => {
    const upper = REAL_TX_HASH.toUpperCase();
    const header = Buffer.from(JSON.stringify({ reference: upper }), "utf8").toString("base64url");
    expect(txHashFromReceiptHeader(header)).toBeUndefined();
  });

  it("returns undefined when reference is not a string", () => {
    const header = Buffer.from(JSON.stringify({ reference: 12345 }), "utf8").toString("base64url");
    expect(txHashFromReceiptHeader(header)).toBeUndefined();
  });
});
