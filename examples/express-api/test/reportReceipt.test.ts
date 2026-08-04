import { describe, expect, it, vi } from "vitest";
import { createReceiptReporter } from "../src/reportReceipt.js";

describe("createReceiptReporter", () => {
  it("POSTs the receipt with bearer auth and service tag", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const report = createReceiptReporter({
      service: "express-api",
      dashboardUrl: "http://dash.test",
      ingestSecret: "s3cret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    report({ kind: "receipt", receipt: { amount: "0.02" } });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://dash.test/ingest");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual({ service: "express-api", kind: "receipt", receipt: { amount: "0.02" } });
  });

  it("is a no-op when the dashboard is not configured", () => {
    const fetchImpl = vi.fn();
    const report = createReceiptReporter({ service: "x", dashboardUrl: undefined, ingestSecret: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    report({ kind: "agent-log", message: "m" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows fetch rejections (fire-and-forget)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("dashboard down"));
    const report = createReceiptReporter({ service: "x", dashboardUrl: "http://dash.test", ingestSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(() => report({ kind: "receipt", receipt: {} })).not.toThrow();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await new Promise((r) => setTimeout(r, 10)); // unhandled rejection would fail the test run
  });
});
