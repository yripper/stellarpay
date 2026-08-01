import type { HTTPAdapter } from "@x402/core/server";

/** Adapts a web-standard Request to x402's HTTPAdapter. */
export function webAdapter(req: Request): HTTPAdapter {
  const url = new URL(req.url);
  return {
    getHeader: (name) => req.headers.get(name) ?? undefined,
    getMethod: () => req.method,
    getPath: () => url.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") ?? "*/*",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
  };
}
