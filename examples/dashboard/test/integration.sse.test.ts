import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
// Cross-example import is deliberate: this test IS the integration point between the
// two demo-owned pieces (reporter and dashboard). Examples are private; no package
// boundary is being violated for consumers.
import { createReceiptReporter } from "../../express-api/src/reportReceipt.js";

const SECRET = "integration-secret";
let server: ServerType;
let baseUrl: string;

beforeAll(async () => {
  const app = buildApp({ ingestSecret: SECRET, html: "<h1>t</h1>" });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://localhost:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe("receipt → ingest → SSE, over real HTTP", () => {
  it("a reported receipt arrives on the event stream", async () => {
    const report = createReceiptReporter({ service: "express-api", dashboardUrl: baseUrl, ingestSecret: SECRET });
    report({ kind: "receipt", receipt: { scheme: "x402", route: "GET /report/*", amount: "0.02", asset: "USDC" } });

    // Wait for ingestion, then read the replayed buffer from a fresh SSE connection.
    await new Promise((r) => setTimeout(r, 300));
    const res = await fetch(`${baseUrl}/events`, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(3000) });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const frame = new TextDecoder().decode(value);
    const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
    expect(dataLine).toBeDefined();
    const event = JSON.parse((dataLine as string).slice(5)) as Record<string, unknown>;
    expect(event).toMatchObject({ service: "express-api", kind: "receipt" });
    expect((event["receipt"] as Record<string, unknown>)["amount"]).toBe("0.02");
    expect(typeof event["at"]).toBe("string");
  });

  it("an unauthorized reporter's receipt never reaches the stream", async () => {
    const report = createReceiptReporter({ service: "evil", dashboardUrl: baseUrl, ingestSecret: "wrong-secret" });
    report({ kind: "receipt", receipt: { amount: "999" } });
    await new Promise((r) => setTimeout(r, 300));
    const res = await fetch(`${baseUrl}/events`, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(3000) });
    const { value } = await res.body!.getReader().read();
    expect(new TextDecoder().decode(value)).not.toContain('"evil"');
  });
});
