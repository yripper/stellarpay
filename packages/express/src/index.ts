import type { NextFunction, Request as ExReq, RequestHandler, Response as ExRes } from "express";
import { stellarpay, type Stellarpay } from "@stellarpay-sdk/core";

/**
 * Converts an Express Request to a Web standard Request.
 * Constructs the URL from protocol, host, and originalUrl; copies headers.
 * Payment verification is header-based in both protocols — bodies are intentionally omitted.
 */
function toWebRequest(req: ExReq): Request {
  const proto = req.protocol || "http";
  const host = req.get("host") ?? "localhost";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  return new Request(`${proto}://${host}${req.originalUrl}`, { method: req.method, headers });
}

/**
 * Writes a Web standard Response to an Express Response.
 * Copies headers (with special handling for multi-value Set-Cookie) and writes the body.
 */
async function writeResponse(res: ExRes, web: Response): Promise<void> {
  // Copy all headers except set-cookie (which may have multiple values).
  web.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  // Multi-value headers: getSetCookie() returns an array of all values.
  const cookies = web.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  res.status(web.status).send(Buffer.from(await web.arrayBuffer()));
}

/** One-line Express paywall: app.use(stellarpayExpress(config)). */
export function stellarpayExpress(configOrInstance: unknown): RequestHandler {
  const pay: Stellarpay =
    typeof configOrInstance === "object" && configOrInstance !== null && "handleWithMeta" in configOrInstance
      ? (configOrInstance as Stellarpay)
      : stellarpay(configOrInstance);
  return (req: ExReq, res: ExRes, next: NextFunction) => {
    void pay.handleWithMeta(toWebRequest(req)).then(async (out) => {
      if (out.response) return writeResponse(res, out.response);
      if (out.passHeaders) for (const [k, v] of Object.entries(out.passHeaders)) res.setHeader(k, v);
      next();
    }).catch(next);
  };
}
