import { describe, it, expect, vi } from "vitest";
import { toolPayments } from "../src/index.js";

// `server.ts` imports `{ Mppx, Store, Transport } from "mppx/server"`; mocking that
// module substitutes the real mppx engine in the shared module graph, so
// `toolPayments()`'s internal `Mppx.create(...)` call picks up this stub instead of the
// real pull-mode signing/RPC-broadcast machinery. Reaching mppx's real `status: 200`
// branch offline isn't feasible with the genuine engine — a real 200 requires a valid
// signed credential verified against the challenge via Soroban RPC, which needs live
// network access — so the engine is stubbed at the module boundary instead. Mirrors
// `@stellarpay-sdk/core`'s `test/stellarpayErrorBoundary.test.ts`, which stubs
// `createMppChargeModule` the same way to drive `stellarpay()`'s `onPayment` isolation
// through a controlled "pass" outcome. `vi.mock` calls are hoisted above imports by
// Vitest's transform, so declaration order doesn't matter; `vi.hoisted` is required only
// because `chargeMock` must exist by the time the (also hoisted) factory below runs.
const { chargeMock } = vi.hoisted(() => ({ chargeMock: vi.fn() }));

vi.mock("mppx/server", () => ({
  Mppx: { create: () => ({ charge: chargeMock }) },
  // Real `@stellar/mpp/charge/server`'s `stellar.charge(...)` factory (not mocked —
  // it's inert until actually invoked, which never happens here since `Mppx.create` is
  // fully stubbed) synchronously requires `store.update` to be a function
  // (`@stellar/mpp/dist/charge/server/Charge.js:41-43`), so the stub store provides one.
  Store: { memory: () => ({ get: async () => null, put: async () => undefined, delete: async () => undefined, update: async () => undefined }) },
  Transport: { mcpSdk: () => ({}) },
}));

describe("toolPayments.guard — onPayment hook isolation (mocked mppx engine)", () => {
  it("a throwing onPayment hook does not turn an already-paid tool call into a hard error", async () => {
    chargeMock.mockReturnValue(() => Promise.resolve({ status: 200, withReceipt: (response: unknown) => response }));
    const onPayment = vi.fn(() => {
      throw new Error("onPayment blew up");
    });
    const payments = toolPayments({
      payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      network: "stellar:testnet",
      mppSecretKey: "test-secret",
      prices: { deep_report: "$0.02" },
      onPayment,
    });
    const handler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "paid result" }] });
    const guarded = payments.guard("deep_report", handler);

    await expect(guarded({}, { _meta: {} })).resolves.toEqual({ content: [{ type: "text", text: "paid result" }] });
    expect(onPayment).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
