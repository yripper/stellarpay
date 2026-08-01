import { describe, it, expect, vi, beforeEach } from "vitest";
import { stellarpay } from "../src/index.js";
import type { Receipt, SchemeModule } from "../src/types.js";

// `stellarpay.ts` imports `createMppChargeModule` from "./schemes/mppCharge.js" (relative to
// src/); mocking the same file by its test-relative path substitutes the module in the shared
// module graph, so `stellarpay()`'s internal `createSchemeModule("mpp-charge", cfg)` call picks
// up this stub instead of the real mppx-backed implementation. No production code changes.
// `vi.mock` calls are hoisted above imports by Vitest's transform, so declaration order here
// doesn't matter; `vi.hoisted` is required only because `handleMock` must exist by the time the
// (also hoisted) factory below runs.
const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }));

vi.mock("../src/schemes/mppCharge.js", () => ({
  createMppChargeModule: (): SchemeModule => ({
    scheme: "mpp-charge",
    handle: handleMock,
  }),
}));

const cfg = {
  network: "stellar:testnet" as const,
  payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" as const } },
};

const receipt: Receipt = {
  scheme: "mpp-charge",
  route: "GET /paid",
  network: "stellar:testnet",
  amount: "0.01",
  asset: "USDC",
  timestamp: new Date().toISOString(),
};

describe("stellarpay() error boundary and onPayment isolation (mocked scheme module)", () => {
  beforeEach(() => {
    handleMock.mockReset();
  });

  it("maps a thrown plain Error to 500 paywall_internal without leaking the message", async () => {
    handleMock.mockRejectedValue(new Error("super-secret-internal-detail"));
    const pay = stellarpay(cfg);
    const res = await pay.handle(new Request("http://x/paid"));
    expect(res?.status).toBe(500);
    const body = await res!.json();
    expect(body).toEqual({ error: "paywall_internal" });
    // The raw error message must never reach the response body.
    expect(JSON.stringify(body)).not.toContain("super-secret-internal-detail");
  });

  it("maps a thrown TypeError (network-ish) to 503 settlement_unavailable", async () => {
    handleMock.mockRejectedValue(new TypeError("fetch failed"));
    const pay = stellarpay(cfg);
    const res = await pay.handle(new Request("http://x/paid"));
    expect(res?.status).toBe(503);
    expect(await res!.json()).toEqual({ error: "settlement_unavailable", retryable: true });
  });

  it("invokes onPayment with the receipt on a pass outcome, and a throwing hook does not break the request", async () => {
    handleMock.mockResolvedValue({ type: "pass", receipt, headers: { "x-test": "1" } });
    const onPayment = vi.fn(() => {
      throw new Error("onPayment blew up");
    });
    const pay = stellarpay({ ...cfg, onPayment });
    const meta = await pay.handleWithMeta(new Request("http://x/paid"));
    expect(onPayment).toHaveBeenCalledWith(receipt);
    expect(meta).toEqual({ passHeaders: { "x-test": "1" } });
    expect(meta.response).toBeUndefined();
  });
});
