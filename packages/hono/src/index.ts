import type { MiddlewareHandler } from "hono";
import { stellarpay, type Stellarpay } from "@stellarpay/core";

/** One-line Hono paywall: app.use("*", stellarpayHono(config)). */
export function stellarpayHono(configOrInstance: unknown): MiddlewareHandler {
  const pay: Stellarpay =
    typeof configOrInstance === "object" && configOrInstance !== null && "handleWithMeta" in configOrInstance
      ? (configOrInstance as Stellarpay) : stellarpay(configOrInstance);
  return async (c, next) => {
    const out = await pay.handleWithMeta(c.req.raw);
    if (out.response) return out.response;
    await next();
    if (out.passHeaders) for (const [k, v] of Object.entries(out.passHeaders)) c.res.headers.set(k, v);
  };
}
