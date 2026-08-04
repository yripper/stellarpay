import { describe, it, expect, vi } from "vitest";
import { Mcp } from "mppx";
import { toolPayments } from "../src/index.js";

// Same module-boundary stub as `onPaymentIsolation.test.ts` (see its own comment for why
// the real mppx engine can't reach `status: 200` offline — a genuine 200 needs a validly
// signed credential verified against the challenge via Soroban RPC). Extended here so the
// stubbed `withReceipt` reproduces the real mcp-sdk transport's `respondReceipt`
// (`mppx/dist/mcp-sdk/server/Transport.js:66-81`, read directly from the installed
// node_modules 2026-08-04): a `Response` instance normalizes to `{ content: [] }`, any
// other value passes through untouched, and both cases get `_meta[Mcp.receiptMetaKey]`
// merged in from the same closed-over receipt — exactly like `success()`'s `withReceipt`
// closure in the real engine (`mppx/dist/server/Mppx.js:458-485`). This lets these tests
// exercise `guard`'s actual probe-then-attach logic (`packages/mcp/src/server.ts`)
// against transport behavior that matches production, not a rubber-stamp mock.
const { chargeMock } = vi.hoisted(() => ({ chargeMock: vi.fn() }));

vi.mock("mppx/server", () => ({
  Mppx: { create: () => ({ charge: chargeMock }) },
  Store: {
    memory: () => ({ get: async () => null, put: async () => undefined, delete: async () => undefined, update: async () => undefined }),
  },
  Transport: { mcpSdk: () => ({}) },
}));

const REAL_TX_HASH = "20e4b38c2d8589b01ab1069209448bb653ce7650ecc9edbb33f6d103f0c9d05a";

function stubChargeResult(reference: unknown) {
  const receipt = { method: "stellar", reference, status: "success", timestamp: "2026-08-04T00:00:00.000Z" };
  return {
    status: 200,
    withReceipt: (response: unknown) => {
      const normalized = response instanceof Response ? { content: [] } : (response as { _meta?: Record<string, unknown> });
      return { ...normalized, _meta: { ...normalized._meta, [Mcp.receiptMetaKey]: { ...receipt, challengeId: "chal-1" } } };
    },
  };
}

const baseConfig = {
  payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  network: "stellar:testnet" as const,
  mppSecretKey: "test-secret",
  prices: { deep_report: "$0.02" },
};

describe("toolPayments.guard — txHash extraction (mocked mppx engine)", () => {
  it("populates txHash on the onPayment receipt when the settled reference is hash-shaped", async () => {
    chargeMock.mockReturnValue(() => Promise.resolve(stubChargeResult(REAL_TX_HASH)));
    const onPayment = vi.fn();
    const payments = toolPayments({ ...baseConfig, onPayment });
    const handler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "paid result" }] });

    await payments.guard("deep_report", handler)({}, { _meta: {} });

    expect(onPayment).toHaveBeenCalledTimes(1);
    expect(onPayment.mock.calls[0]?.[0]).toMatchObject({ tool: "deep_report", txHash: REAL_TX_HASH });
  });

  it.each([
    ["absent reference", undefined],
    ["wrong length", "abc123"],
    ["uppercase / non-hex", REAL_TX_HASH.toUpperCase()],
    ["non-string reference", 12345],
  ])("leaves txHash undefined for a malformed reference (%s)", async (_label, reference) => {
    chargeMock.mockReturnValue(() => Promise.resolve(stubChargeResult(reference)));
    const onPayment = vi.fn();
    const payments = toolPayments({ ...baseConfig, onPayment });
    const handler = vi.fn().mockResolvedValue({ content: [] });

    await payments.guard("deep_report", handler)({}, { _meta: {} });

    expect(onPayment).toHaveBeenCalledTimes(1);
    expect(onPayment.mock.calls[0]?.[0]).not.toHaveProperty("txHash");
  });

  it("returns the handler's real response untouched — the throwaway probe never leaks into the caller's result", async () => {
    chargeMock.mockReturnValue(() => Promise.resolve(stubChargeResult(REAL_TX_HASH)));
    const payments = toolPayments({ ...baseConfig, onPayment: vi.fn() });
    const realContent = [{ type: "text" as const, text: "paid result" }];
    const handler = vi.fn().mockResolvedValue({ content: realContent });

    const result = await payments.guard("deep_report", handler)({}, { _meta: {} });

    // The handler's own content array survives byte-for-byte — not replaced by the
    // probe's throwaway `{ content: [] }` — while the real receipt is still attached.
    expect(result).toMatchObject({
      content: realContent,
      _meta: { [Mcp.receiptMetaKey]: { reference: REAL_TX_HASH, challengeId: "chal-1" } },
    });
  });
});
