import { x402ResourceServer, x402HTTPResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { NETWORKS } from "@stellarpay/shared";
import { webAdapter } from "./webAdapter.js";
import type { Receipt, SchemeModule, SchemeOutcome, StellarpayConfig } from "../types.js";

function toResponse(instr: { status: number; headers: Record<string, string>; body?: unknown; isHtml?: boolean }): Response {
  const body = instr.body === undefined ? null : instr.isHtml ? String(instr.body) : JSON.stringify(instr.body);
  return new Response(body, { status: instr.status, headers: instr.headers });
}

/** x402 scheme: verification + settlement through the configured facilitator. */
export function createX402Module(cfg: StellarpayConfig): SchemeModule {
  const facilitator = new HTTPFacilitatorClient({ url: cfg.facilitatorUrl ?? NETWORKS[cfg.network].facilitatorUrl });
  const server = new x402ResourceServer(facilitator);
  server.register(cfg.network, new ExactStellarScheme());
  const x402Routes = Object.fromEntries(
    Object.entries(cfg.routes)
      .filter(([, r]) => (r.scheme ?? "x402") === "x402")
      .map(([pattern, r]) => [pattern, { accepts: { scheme: "exact", price: r.price, network: cfg.network, payTo: cfg.payTo } }]),
  );
  const httpServer = new x402HTTPResourceServer(server, x402Routes);
  let initialized: Promise<void> | undefined;

  return {
    scheme: "x402",
    init: () => (initialized ??= httpServer.initialize()),
    async handle(req, match): Promise<SchemeOutcome> {
      await (initialized ??= httpServer.initialize());
      const adapter = webAdapter(req);
      const context = { adapter, path: new URL(req.url).pathname, method: req.method,
        paymentHeader: req.headers.get("PAYMENT-SIGNATURE") ?? undefined, routePattern: match.pattern };
      const result = await httpServer.processHTTPRequest(context);
      if (result.type === "payment-error") return { type: "respond", response: toResponse(result.response) };
      if (result.type === "no-payment-required") return { type: "pass" };
      // payment-verified → settle immediately (settle-then-serve), then let the route run
      const settle = await httpServer.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, { request: context });
      if (!settle.success) return { type: "respond", response: toResponse(settle.response) };
      const receipt: Receipt = {
        scheme: "x402", route: match.pattern, network: cfg.network,
        amount: typeof match.rule.price === "string" ? match.rule.price.replace("$", "") : match.rule.price.amount,
        asset: typeof match.rule.price === "string" ? "USDC" : match.rule.price.asset,
        raw: JSON.stringify(settle), timestamp: new Date().toISOString(),
      };
      // Settlement tx fields are treated as opaque until the smoke run confirms them (see Global Constraints):
      const s = settle as Record<string, unknown>;
      if (typeof s["transaction"] === "string") receipt.txHash = s["transaction"];
      if (typeof s["payer"] === "string") receipt.payer = s["payer"];
      return { type: "pass", receipt, headers: settle.headers };
    },
  };
}
