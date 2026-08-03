import { describe, it, expect } from "vitest";
import { Challenge } from "mppx";
import { createMppChargeModule } from "../src/schemes/mppCharge.js";
import { decimalToBaseUnits } from "../src/internal/price.js";

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
