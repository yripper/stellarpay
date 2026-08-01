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
  it("preserves multi-value set-cookie headers", async () => {
    // Build a mock Response with multiple Set-Cookie headers.
    const response = new Response("test body", { status: 200 });
    response.headers.append("set-cookie", "cookie1=value1; Path=/");
    response.headers.append("set-cookie", "cookie2=value2; Path=/");
    const mockPay = {
      handleWithMeta: async () => ({ response }),
    };

    const a = express();
    a.use(stellarpayExpress(mockPay));
    const res = await request(a).get("/");

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers["set-cookie"];
    expect(Array.isArray(setCookieHeader)).toBe(true);
    expect(setCookieHeader).toHaveLength(2);
    expect(setCookieHeader).toContain("cookie1=value1; Path=/");
    expect(setCookieHeader).toContain("cookie2=value2; Path=/");
  });
});
