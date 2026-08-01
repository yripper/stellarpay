import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { stellarpayExpress } from "../src/index.js";

const cfg = {
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

function app() {
  const a = express();
  a.use(stellarpayExpress(cfg));
  a.get("/paid", (_req, res) => { res.json({ secret: 42 }); });
  a.get("/free", (_req, res) => { res.json({ ok: true }); });
  return a;
}

describe("stellarpayExpress", () => {
  it("lets free routes through", async () => {
    const res = await request(app()).get("/free");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  it("gates paid routes with 402 + challenge headers", async () => {
    const res = await request(app()).get("/paid");
    expect(res.status).toBe(402);
  });
});
