import { describe, it, expect } from "vitest";
import { parseConfig, StellarpayConfigError } from "../src/index.js";

const valid = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  routes: { "GET /a": { price: "$0.01" } },
};

describe("parseConfig", () => {
  it("accepts minimal x402 config", () => {
    const c = parseConfig(valid);
    expect(c.routes["GET /a"]!.scheme ?? "x402").toBe("x402");
  });
  it("rejects bad payTo", () => expect(() => parseConfig({ ...valid, payTo: "not-a-key" })).toThrow(StellarpayConfigError));
  it("rejects bad route key format", () =>
    expect(() => parseConfig({ ...valid, routes: { "/no-method": { price: "$1" } } })).toThrow(StellarpayConfigError));
  it("rejects malformed dollar price", () =>
    expect(() => parseConfig({ ...valid, routes: { "GET /a": { price: "0.01" } } })).toThrow(StellarpayConfigError));
  it("accepts explicit asset price", () => {
    const c = parseConfig({ ...valid, routes: { "GET /a": { price: { asset: "C".padEnd(56, "A"), amount: "10000" } } } });
    expect(typeof c.routes["GET /a"]!.price).toBe("object");
  });
  it("requires mppSecretKey when an mpp route exists", () =>
    expect(() => parseConfig({ ...valid, routes: { "GET /a": { price: "$1", scheme: "mpp-charge" } } })).toThrow(StellarpayConfigError));
  it("requires sponsorSecret when sponsorGas set", () =>
    expect(() => parseConfig({ ...valid, mppSecretKey: "s", routes: { "GET /a": { price: "$1", scheme: "mpp-charge", sponsorGas: true } } })).toThrow(StellarpayConfigError));
  it("requires channel config for mpp-channel routes", () =>
    expect(() => parseConfig({ ...valid, mppSecretKey: "s", routes: { "GET /a": { price: "$1", scheme: "mpp-channel" } } })).toThrow(StellarpayConfigError));
  it("rejects unknown scheme", () =>
    expect(() => parseConfig({ ...valid, routes: { "GET /a": { price: "$1", scheme: "stripe" } } })).toThrow(StellarpayConfigError));
  it("accepts an optional facilitatorApiKey", () => {
    const c = parseConfig({ ...valid, facilitatorApiKey: "test-facilitator-key" });
    expect(c.facilitatorApiKey).toBe("test-facilitator-key");
  });
});
