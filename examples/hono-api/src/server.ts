import { Hono } from "hono";
import { stellarpayHono } from "@stellarpay/hono";
import type { StellarpayConfig } from "@stellarpay/core";
import { fetchWhales } from "./whales.js";
import { createReceiptReporter } from "./reportReceipt.js";
import type { Env } from "./env.js";

export function buildApp(env: Env): Hono {
  const report = createReceiptReporter({ service: "hono-api", dashboardUrl: env.dashboardUrl, ingestSecret: env.ingestSecret });

  const config: StellarpayConfig = {
    network: "stellar:testnet",
    payTo: env.payTo,
    ...(env.facilitatorKey ? { facilitatorApiKey: env.facilitatorKey } : {}),
    routes: { "GET /alerts/whales": { price: "$0.01", description: "Whale alerts (x402)" } },
    onPayment: (receipt) => report({ kind: "receipt", receipt: receipt as unknown as Record<string, unknown> }),
  };

  const app = new Hono();
  app.use("*", stellarpayHono(config));
  app.get("/", (c) =>
    c.json({
      name: "Stellar Intel — hono-api",
      routes: { "GET /alerts/whales": { price: "$0.01", scheme: "x402", what: "10 largest recent native payments on testnet" } },
      diff: "this whole paywall is a 6-line diff — see the README",
    }),
  );
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/alerts/whales", async (c) => {
    const out = await fetchWhales();
    return c.json(out.body, out.status as 200 | 502);
  });
  return app;
}
