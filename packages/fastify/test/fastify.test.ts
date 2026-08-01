import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { stellarpayFastify } from "../src/index.js";

const cfg = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

describe("stellarpayFastify", () => {
  it("gates and passes appropriately", async () => {
    const app = Fastify();
    await app.register(stellarpayFastify, { config: cfg });
    app.get("/paid", async () => ({ secret: 42 }));
    app.get("/free", async () => ({ ok: true }));
    expect((await app.inject({ method: "GET", url: "/free" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/paid" })).statusCode).toBe(402);
  });
});
