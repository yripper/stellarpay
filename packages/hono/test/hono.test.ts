import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { stellarpayHono } from "../src/index.js";

const cfg = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

describe("stellarpayHono", () => {
  const app = new Hono();
  app.use("*", stellarpayHono(cfg));
  app.get("/paid", (c) => c.json({ secret: 42 }));
  app.get("/free", (c) => c.json({ ok: true }));

  it("free passes", async () => expect((await app.request("http://x/free")).status).toBe(200));
  it("paid gates 402", async () => expect((await app.request("http://x/paid")).status).toBe(402));
});
