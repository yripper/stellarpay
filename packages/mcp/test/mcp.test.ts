import { describe, it, expect, vi } from "vitest";
import { toolPayments } from "../src/index.js";

const payments = toolPayments({
  recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  network: "stellar:testnet", mppSecretKey: "test-secret",
  prices: { deep_report: "$0.02" },
});

describe("toolPayments.guard", () => {
  it("throws an MCP payment-required error (-32042) for unpaid priced tool calls", async () => {
    const guarded = payments.guard("deep_report", async () => ({ content: [] }));
    await expect(guarded({}, { _meta: {} })).rejects.toMatchObject({ code: -32042 });
  });
  it("passes through tools without a configured price", async () => {
    const handler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "free" }] });
    const guarded = payments.guard("health_check", handler);
    await expect(guarded({}, { _meta: {} })).resolves.toBeTruthy();
    expect(handler).toHaveBeenCalled();
  });
  it("priceOf reports configured prices", () => {
    expect(payments.priceOf("deep_report")).toBe("$0.02");
    expect(payments.priceOf("nope")).toBeUndefined();
  });
});
