import Fastify, { type FastifyInstance } from "fastify";
import { stellarpayFastify } from "@stellarpay/fastify";
import type { StellarpayConfig } from "@stellarpay/core";
import { fetchFeeStats } from "./fees.js";
import { createReceiptReporter } from "./reportReceipt.js";
import type { Env } from "./env.js";

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const report = createReceiptReporter({ service: "fastify-api", dashboardUrl: env.dashboardUrl, ingestSecret: env.ingestSecret });

  const config: StellarpayConfig = {
    network: "stellar:testnet",
    payTo: env.payTo,
    mppSecretKey: env.mppSecret,
    routes: { "GET /stats/fees": { price: "$0.005", scheme: "mpp-charge", description: "Fee & congestion stats (MPP)" } },
    onPayment: (receipt) => report({ kind: "receipt", receipt: receipt as unknown as Record<string, unknown> }),
  };

  const app = Fastify();
  await app.register(stellarpayFastify, { config }); // must precede route declarations (adapter contract)
  app.get("/", async () => ({
    name: "Stellar Intel — fastify-api",
    routes: { "GET /stats/fees": { price: "$0.005", scheme: "mpp-charge", what: "live fee stats + congestion verdict" } },
  }));
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/stats/fees", async (_req, reply) => {
    const out = await fetchFeeStats();
    return reply.status(out.status).send(out.body);
  });
  return app;
}
