import { parseConfig } from "./config.js";
import { compileRoutes, matchRoute } from "./router.js";
import { createMppChargeModule } from "./schemes/mppCharge.js";
import { createMppChannelModule } from "./schemes/mppChannel.js";
import { createX402Module } from "./schemes/x402.js";
import type { Receipt, RouteRule, Scheme, SchemeModule, StellarpayConfig } from "./types.js";

/** The package's public API: a request handler bound to a validated {@link StellarpayConfig}. */
export type Stellarpay = {
  /**
   * Handle a single request. Resolves `undefined` when no configured route matches
   * `req` (the caller should fall through to its own routing/handler).
   */
  handle(req: Request): Promise<Response | undefined>;
  /**
   * Adapter-facing variant of {@link Stellarpay.handle}. Distinguishes "no match"
   * (`{}`) from "paid through" (`{ passHeaders }`, no response — the caller's route
   * should run and the headers should be attached to its response) from "respond
   * directly" (`{ response }`, e.g. a 402 challenge or an error).
   */
  handleWithMeta(req: Request): Promise<{ response?: Response; passHeaders?: Record<string, string> }>;
  /** Runs each configured scheme module's optional async `init()` (e.g. facilitator discovery). */
  ready(): Promise<void>;
};

/** A route's effective scheme: `x402` when the route doesn't declare one explicitly. */
function effectiveScheme(rule: RouteRule): Scheme {
  return rule.scheme ?? "x402";
}

/** Instantiates the `SchemeModule` for a given scheme. Exhaustive over {@link Scheme}. */
function createSchemeModule(scheme: Scheme, cfg: StellarpayConfig): SchemeModule {
  switch (scheme) {
    case "x402":
      return createX402Module(cfg);
    case "mpp-charge":
      return createMppChargeModule(cfg);
    case "mpp-channel":
      return createMppChannelModule(cfg);
    default: {
      const exhaustive: never = scheme;
      throw new Error(`Unknown scheme: ${String(exhaustive)}`);
    }
  }
}

/**
 * True for errors that indicate the facilitator/RPC endpoint was unreachable rather
 * than a bug in our own request handling: `fetch()` failures surface as `TypeError`
 * (per the WHATWG fetch spec), and Node's undici sometimes attaches a `cause.code`
 * such as `"ECONNREFUSED"` to that (or a wrapping) error.
 */
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.cause && typeof err.cause === "object" && "code" in err.cause) {
    return (err.cause as { code?: unknown }).code === "ECONNREFUSED";
  }
  return false;
}

/** Builds a JSON error `Response`. Body is a fixed, static shape — never the raw error. */
function errorResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Build a {@link Stellarpay} instance from an unknown config value.
 *
 * Validates `config` via {@link parseConfig} (throws {@link StellarpayConfigError}
 * synchronously on invalid input), then instantiates only the scheme modules that
 * the configured routes actually reference before compiling the route table.
 */
export function stellarpay(config: unknown): Stellarpay {
  const cfg = parseConfig(config);
  const compiled = compileRoutes(cfg.routes);

  const usedSchemes = new Set<Scheme>(Object.values(cfg.routes).map(effectiveScheme));
  const modules = [...usedSchemes].map((scheme) => createSchemeModule(scheme, cfg));
  const modulesByScheme = new Map<Scheme, SchemeModule>(modules.map((mod) => [mod.scheme, mod]));

  async function handleWithMeta(req: Request): Promise<{ response?: Response; passHeaders?: Record<string, string> }> {
    try {
      const pathname = new URL(req.url).pathname;
      const match = matchRoute(compiled, req.method, pathname);
      if (!match) return {};

      // modulesByScheme was built from the same route table, so this is always present.
      const mod = modulesByScheme.get(effectiveScheme(match.rule));
      if (!mod) return {};

      const outcome = await mod.handle(req, match);
      if (outcome.type === "respond") return { response: outcome.response };

      if (outcome.receipt) {
        const receipt: Receipt = outcome.receipt;
        try {
          cfg.onPayment?.(receipt);
        } catch (hookError) {
          // A misbehaving user hook must never break an otherwise-successful request.
          console.error("[stellarpay] onPayment hook threw; ignoring", hookError);
        }
      }
      return { passHeaders: outcome.headers };
    } catch (err) {
      if (isNetworkError(err)) {
        return { response: errorResponse(503, { error: "settlement_unavailable", retryable: true }) };
      }
      // Real error is logged server-side only; the response body never echoes it.
      console.error("[stellarpay] internal error handling request", err);
      return { response: errorResponse(500, { error: "paywall_internal" }) };
    }
  }

  return {
    async handle(req) {
      const { response } = await handleWithMeta(req);
      return response;
    },
    handleWithMeta,
    async ready() {
      await Promise.all(modules.map((mod) => mod.init?.()));
    },
  };
}
