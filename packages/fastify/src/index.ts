import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { stellarpay, type Stellarpay } from "@stellarpay-sdk/core";

/**
 * Converts a Fastify Request to a Web standard Request.
 * Constructs the URL from protocol, hostname, and url; copies headers.
 * Payment verification is header-based in both protocols — bodies are intentionally omitted.
 */
function toWebRequest(req: FastifyRequest): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  return new Request(`${req.protocol}://${req.hostname}${req.url}`, { method: req.method, headers });
}

/**
 * Builds a Fastify-compatible headers record from a Web standard Response.
 * Multi-value Set-Cookie headers are preserved as an array via `getSetCookie()`
 * (Fastify's `reply.headers()` accepts `string[]` values natively).
 */
function toReplyHeaders(web: Response): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  web.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers[key] = value;
  });
  const cookies = web.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  return headers;
}

/** Writes a Web standard Response to a Fastify Reply. */
async function writeResponse(reply: FastifyReply, web: Response): Promise<void> {
  await reply.code(web.status).headers(toReplyHeaders(web)).send(Buffer.from(await web.arrayBuffer()));
}

/**
 * One-line Fastify paywall plugin: `fastify.register(stellarpayFastify, { config })`.
 *
 * This is a plain async plugin function — it does *not* depend on `fastify-plugin`.
 * Fastify's `register()` normally creates a new encapsulation context, so hooks added
 * inside a plugin are only visible to that plugin's own scope and any children
 * registered from within it (verified empirically: a plain plugin's `onRequest` hook
 * does not gate routes declared directly on the parent instance after registration).
 * To make the paywall gate the whole app when registered at the root — matching this
 * package's one-line-integration contract — the plugin function is marked with
 * Fastify's own `'skip-override'` hidden property, which tells Fastify to skip creating
 * a new context for it (the same mechanism `fastify-plugin` uses internally; see
 * Fastify's "Handle the scope" docs). Because of this, register `stellarpayFastify` at
 * the app root, before declaring routes, so the hook applies app-wide.
 */
export async function stellarpayFastify(
  fastify: FastifyInstance,
  opts: { config: unknown | Stellarpay },
): Promise<void> {
  const configOrInstance = opts.config;
  const pay: Stellarpay =
    typeof configOrInstance === "object" && configOrInstance !== null && "handleWithMeta" in configOrInstance
      ? (configOrInstance as Stellarpay)
      : stellarpay(configOrInstance);

  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const out = await pay.handleWithMeta(toWebRequest(req));
    if (out.response) {
      await writeResponse(reply, out.response);
      return;
    }
    if (out.passHeaders) reply.headers(out.passHeaders);
  });
}
// Skips Fastify's default plugin encapsulation without adding a `fastify-plugin`
// dependency — see the doc comment above for why this is required. `defineProperty`
// (rather than a symbol index expression) keeps this assignment `any`-free under strict mode.
Object.defineProperty(stellarpayFastify, Symbol.for("skip-override"), { value: true });
