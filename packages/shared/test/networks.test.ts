import { describe, it, expect } from "vitest";
import { NETWORKS } from "../src/index.js";

describe("NETWORKS", () => {
  it("testnet preset", () => {
    const t = NETWORKS["stellar:testnet"];
    expect(t.facilitatorUrl).toBe("https://channels.openzeppelin.com/x402/testnet");
    expect(t.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(t.channelsUrl).toBe("https://channels.openzeppelin.com/testnet");
    expect(t.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });
  it("pubnet preset", () => {
    const p = NETWORKS["stellar:pubnet"];
    expect(p.facilitatorUrl).toBe("https://channels.openzeppelin.com/x402");
    expect(p.channelsUrl).toBe("https://channels.openzeppelin.com");
    expect(p.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
  });
});
