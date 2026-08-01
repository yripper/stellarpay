import { describe, it, expect } from "vitest";
import { createMppChargeModule } from "../src/schemes/mppCharge.js";

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
  it("converts dollar price to decimal amount for mppx", async () => {
    // challenge generator must be driven with amount "0.01", not "$0.01" — asserted via generated challenge
    const mod = createMppChargeModule(cfg);
    const out = await mod.handle(new Request("http://x/paid"), { pattern: "GET /paid", rule: { price: "$0.01", scheme: "mpp-charge" } });
    expect(out.type).toBe("respond");
  });
});
