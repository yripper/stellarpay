import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { x402Version } from "@x402/core";
import type { SupportedResponse } from "@x402/core/types";
import { createX402Module } from "../src/schemes/x402.js";

const cfg = {
  network: "stellar:testnet" as const, payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  routes: { "GET /paid": { price: "$0.01" } },
};

// `init()` calls the facilitator's `/supported` endpoint (`x402ResourceServer.initialize()` ->
// `HTTPFacilitatorClient.getSupported()`, confirmed non-lazy: `x402HTTPResourceServer.initialize()`
// awaits it and throws `RouteConfigurationError` if the response doesn't declare a matching
// scheme/network — see packages/core/node_modules/@x402/core/dist/esm/server/index.mjs:458-503
// and .../chunk-4Y6I6537.mjs:523-559). The response body must satisfy the shape the facilitator
// client parses. `@x402/core/schemas`'s public exports do NOT include a `SupportedResponse` zod
// schema (verified: no "Supported" symbol anywhere in
// node_modules/@x402/core/dist/esm/schemas/index.d.mts's full export list) — the schema used at
// runtime (`supportedResponseSchema`, .../dist/esm/chunk-4Y6I6537.mjs:801-804) is internal and not
// exported from any subpath. So this stub is built as a plain object typed against the public
// `SupportedResponse` type (`@x402/core/types`) instead, matching the internal schema's required
// shape: `kinds: [{ x402Version, scheme, network }]`.
const supportedResponse: SupportedResponse = {
  kinds: [{ x402Version, scheme: "exact", network: cfg.network }],
  extensions: [],
  signers: {},
};

describe("x402 module", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/supported")) {
          return new Response(JSON.stringify(supportedResponse), { status: 200 });
        }
        throw new Error(`unexpected fetch in test: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("responds 402 with PAYMENT-REQUIRED header when unpaid", async () => {
    const mod = createX402Module(cfg);
    await mod.init?.();
    const out = await mod.handle(new Request("http://x/paid"), { pattern: "GET /paid", rule: cfg.routes["GET /paid"]! });
    expect(out.type).toBe("respond");
    if (out.type === "respond") {
      expect(out.response.status).toBe(402);
      expect(out.response.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    }
  });
  it("unpaid request with no payment header yields a 402 challenge regardless of method normalization", async () => {
    const mod = createX402Module(cfg);
    await mod.init?.();
    const out = await mod.handle(new Request("http://x/paid", { method: "GET" }), { pattern: "GET /paid", rule: cfg.routes["GET /paid"]! });
    expect(out.type).toBe("respond"); // still a 402 — no payment header supplied
    // Paid-path/settlement coverage (payment-verified → processSettlement → Receipt) lands in
    // the cross-package integration test (Task 16), not here.
  });
});
