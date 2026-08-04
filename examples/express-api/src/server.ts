import express, { type Express } from "express";
import { stellarpayExpress } from "@stellarpay/express";
import { NETWORKS, type StellarpayConfig } from "@stellarpay/core";
import { fetchAccountDeepDive, fetchAssetReport, fetchAssetSummary, type IntelResult } from "./intel.js";
import { createReceiptReporter } from "./reportReceipt.js";
import type { Env } from "./env.js";

const PRICES = { report: "$0.02", deepDive: "$0.02" } as const;

export function buildApp(env: Env): Express {
  const report = createReceiptReporter({
    service: "express-api",
    dashboardUrl: env.dashboardUrl,
    ingestSecret: env.ingestSecret,
  });

  const config: StellarpayConfig = {
    network: "stellar:testnet",
    payTo: env.payTo,
    mppSecretKey: env.mppSecret,
    rpcUrl: NETWORKS["stellar:testnet"].rpcUrl,
    ...(env.facilitatorKey ? { facilitatorApiKey: env.facilitatorKey } : {}),
    ...(env.sponsorSecret ? { sponsorSecret: env.sponsorSecret } : {}),
    routes: {
      // Route keys are wildcard prefixes — the paywall has no :param syntax (core config.ts:7).
      "GET /report/*": { price: PRICES.report, description: "Full asset report (x402)" },
      "GET /deep-dive/*": {
        price: PRICES.deepDive,
        scheme: "mpp-charge",
        description: "Account deep-dive (MPP)",
        ...(env.sponsorSecret ? { sponsorGas: true } : {}),
      },
    },
    onPayment: (receipt) => report({ kind: "receipt", receipt: receipt as unknown as Record<string, unknown> }),
  };

  const app = express();
  app.use(stellarpayExpress(config)); // paywall first, routes after — adapter contract

  const send = (res: express.Response, out: IntelResult): void => {
    res.status(out.status).json(out.body);
  };

  app.get("/", (_req, res) => {
    res.json({
      name: "Stellar Intel — express-api",
      network: "stellar:testnet",
      routes: {
        "GET /summary/:code/:issuer": { price: "free", what: "asset teaser: supply, holders, flags" },
        "GET /report/:code/:issuer": { price: PRICES.report, scheme: "x402", what: "full asset report + live order-book" },
        "GET /deep-dive/:account": { price: PRICES.deepDive, scheme: "mpp-charge", what: "balances, flags, recent payments" },
      },
      hint: "curl a paid route to receive a 402 challenge; pay it with @stellarpay/client.",
    });
  });
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/summary/:code/:issuer", async (req, res) => send(res, await fetchAssetSummary(req.params.code, req.params.issuer)));
  app.get("/report/:code/:issuer", async (req, res) => send(res, await fetchAssetReport(req.params.code, req.params.issuer)));
  app.get("/deep-dive/:account", async (req, res) => send(res, await fetchAccountDeepDive(req.params.account)));
  return app;
}
