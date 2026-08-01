import { describe, it, expect } from "vitest";
import { createMppChannelModule } from "../src/schemes/mppChannel.js";

const cfg = {
  network: "stellar:testnet" as const, payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  channel: { contract: "C" + "A".repeat(55), commitmentPublicKey: "ab".repeat(32) },
  routes: { "GET /tick": { price: "$0.0001", scheme: "mpp-channel" as const } },
};

describe("mpp-channel module", () => {
  it("responds 402 with voucher challenge for unpaid request", async () => {
    const mod = createMppChannelModule(cfg);
    const out = await mod.handle(new Request("http://x/tick"), { pattern: "GET /tick", rule: cfg.routes["GET /tick"]! });
    expect(out.type).toBe("respond");
    if (out.type === "respond") expect(out.response.status).toBe(402);
  });
});
