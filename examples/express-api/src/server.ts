import express, { type Express } from "express";
import { stellarpayExpress } from "@stellarpay-sdk/express";
import { NETWORKS, type StellarpayConfig } from "@stellarpay-sdk/core";
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

  /**
   * Adapts an intel fetcher into an Express handler.
   *
   * The try/catch is load-bearing, not defensive padding: Express 4 does not catch
   * rejections from `async` handlers, so a rejected fetcher escapes as an unhandled
   * rejection, which terminates the process under Node 22's default
   * `--unhandled-rejections=throw`. Horizon is a third-party network dependency that
   * can fail at any moment (DNS, TLS, connection reset — all surface as a thrown
   * `TypeError` from `fetch`, which `intel.ts` deliberately does not swallow), so
   * without this one `fetch failed` would take the whole paid service down mid-demo.
   */
  const intel = (fetcher: (req: express.Request) => Promise<IntelResult>): express.RequestHandler => {
    return (req, res) => {
      void (async () => {
        try {
          const out = await fetcher(req);
          res.status(out.status).json(out.body);
        } catch (err) {
          // Logged server-side only; the body never echoes the upstream error.
          console.error("[express-api] intel fetch failed", err);
          if (!res.headersSent) res.status(502).json({ error: "horizon_unavailable" });
        }
      })();
    };
  };

  app.get("/", (_req, res) => {
    res.json({
      name: "Stellar Intel — express-api",
      network: "stellar:testnet",
      routes: {
        "GET /summary/:code/:issuer": { price: "free", what: "asset teaser: authorized supply, holders, flags" },
        "GET /report/:code/:issuer": { price: PRICES.report, scheme: "x402", what: "full asset report + live order-book" },
        "GET /deep-dive/:account": { price: PRICES.deepDive, scheme: "mpp-charge", what: "balances, flags, recent payments" },
      },
      hint: "curl a paid route to receive a 402 challenge; pay it with @stellarpay-sdk/client.",
    });
  });
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/summary/:code/:issuer", intel((req) => fetchAssetSummary(req.params.code, req.params.issuer)));
  app.get("/report/:code/:issuer", intel((req) => fetchAssetReport(req.params.code, req.params.issuer)));
  app.get("/deep-dive/:account", intel((req) => fetchAccountDeepDive(req.params.account)));
  return app;
}
