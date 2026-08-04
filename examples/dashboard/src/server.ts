import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { createFeedBuffer, type FeedEvent } from "./buffer.js";
import { createCooldown, type Cooldown } from "./cooldown.js";
import { parseIngestBody } from "./ingest.js";

/**
 * Scopes the UI offers. Mirrors the agent's own `SCOPES` (`examples/agent/src/economy.ts`);
 * duplicated rather than imported because the dashboard deliberately has no dependency on the
 * agent package — an unknown scope is simply forwarded and defaulted by the agent.
 */
export const SCOPES = ["all", "express-api", "hono-api", "fastify-api", "mcp-server"] as const;

/** Source repository, surfaced in the header. Matches the `repository` field in every manifest. */
export const REPO_URL = "https://github.com/yripper/stellarpay";

export type Deps = {
  ingestSecret: string;
  /** Public base URL of the agent service; unset → /unleash answers 503. */
  agentUrl?: string;
  /** Injectable for tests; defaults to a 2-minute global cooldown (spec §4.5). */
  cooldown?: Cooldown;
  /**
   * Separate, shorter gate for /chat. Chat is conversational — sharing UNLEASH's 2-minute
   * cooldown would make the first reply the only reply a judge ever gets — but it still spends
   * real testnet funds per turn, so it is rate-limited rather than open.
   */
  chatCooldown?: Cooldown;
  agentFetch?: typeof fetch;
  html: string;
  /**
   * Seller's public key (G...), for the "verify on-chain" affordance: every payment in the
   * feed settles into this account. Unset → GET /config omits it and the dashboard hides the
   * link entirely (see public/index.html).
   */
  payTo?: string;
  /**
   * Buyer's public key (G...), for the client-side live balance panel (fetched from Horizon
   * by the browser, not by this server). Unset → GET /config omits it and the dashboard
   * hides the panel entirely.
   */
  buyerPublic?: string;
};

/** Pure app factory — `main.ts` binds it to a socket; tests hit it via `app.request`. */
export function buildApp(deps: Deps): Hono {
  const buffer = createFeedBuffer(200);
  const subscribers = new Set<(e: FeedEvent) => void>();
  const cooldown = deps.cooldown ?? createCooldown(120_000);
  const chatCooldown = deps.chatCooldown ?? createCooldown(30_000);
  const agentFetch = deps.agentFetch ?? fetch;
  const app = new Hono();

  const authorized = (c: Context): boolean => c.req.header("authorization") === `Bearer ${deps.ingestSecret}`;

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/", (c) => c.html(deps.html));

  // Public keys only — safe to expose unauthenticated. The static page (public/index.html)
  // fetches this on load to learn whether to show the "verify on-chain" link and the live
  // buyer-balance panel; either field being null hides its affordance entirely.
  app.get("/config", (c) =>
    c.json({ payTo: deps.payTo ?? null, buyerPublic: deps.buyerPublic ?? null, scopes: SCOPES, repoUrl: REPO_URL }),
  );

  app.post("/ingest", async (c) => {
    if (!authorized(c)) return c.json({ error: "unauthorized" }, 401);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "malformed_json" }, 400);
    }
    const parsed = parseIngestBody(raw);
    if (!parsed) return c.json({ error: "malformed_body" }, 400);
    const event = buffer.push({ ...parsed, at: new Date().toISOString() });
    for (const notify of subscribers) {
      try {
        notify(event);
      } catch {
        // One bad subscriber must never block delivery to the others (spec §8).
      }
    }
    return c.body(null, 204);
  });

  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      // Replay the buffer so a freshly opened dashboard is never empty…
      for (const e of buffer.list()) await stream.writeSSE({ data: JSON.stringify(e), id: String(e.seq) });
      // …then stay subscribed until the client goes away.
      let close!: () => void;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      const notify = (e: FeedEvent): void => {
        void stream.writeSSE({ data: JSON.stringify(e), id: String(e.seq) }).catch(close);
      };
      subscribers.add(notify);
      stream.onAbort(() => close());
      // Comment-frame heartbeat keeps proxies (Railway's edge included) from idling us out.
      const ping = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "" }).catch(close);
      }, 25_000);
      await closed;
      clearInterval(ping);
      subscribers.delete(notify);
    }),
  );

  app.post("/unleash", async (c) => {
    if (!deps.agentUrl) return c.json({ error: "agent_not_configured" }, 503);
    const gate = cooldown.check();
    if (!gate.ok) return c.json({ error: "cooldown", retryAfterSeconds: gate.retryAfterSeconds }, 429);
    cooldown.trigger();
    const scope = await scopeOf(c);
    void agentFetch(`${deps.agentUrl}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${deps.ingestSecret}`, "content-type": "application/json" },
      body: JSON.stringify({ scope }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // Fire-and-forget: an unreachable agent must not break the button; the judge
      // sees 202 + an empty run, and the failure lands in this service's logs only.
    });
    return c.json({ status: "unleashed", scope }, 202);
  });

  app.post("/chat", async (c) => {
    if (!deps.agentUrl) return c.json({ error: "agent_not_configured" }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "malformed_json" }, 400);
    }
    const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const message = typeof fields["message"] === "string" ? fields["message"].trim() : "";
    if (!message) return c.json({ error: "empty_message" }, 400);
    const gate = chatCooldown.check();
    if (!gate.ok) return c.json({ error: "cooldown", retryAfterSeconds: gate.retryAfterSeconds }, 429);
    chatCooldown.trigger();

    // Unlike /unleash this awaits the agent: the reply IS the response. The timeout is
    // generous because a chat turn can buy several times, and each purchase settles on-chain.
    try {
      const res = await agentFetch(`${deps.agentUrl}/chat`, {
        method: "POST",
        headers: { authorization: `Bearer ${deps.ingestSecret}`, "content-type": "application/json" },
        body: JSON.stringify({ message, scope: scopeFrom(fields) }),
        signal: AbortSignal.timeout(120_000),
      });
      const answer: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = typeof (answer as Record<string, unknown>)["error"] === "string" ? ((answer as Record<string, unknown>)["error"] as string) : "agent_error";
        return c.json({ error: code }, res.status === 409 ? 409 : 502);
      }
      const reply = typeof (answer as Record<string, unknown>)["reply"] === "string" ? ((answer as Record<string, unknown>)["reply"] as string) : "";
      return c.json({ reply });
    } catch {
      // Unreachable or slow agent: answer honestly rather than hanging the visitor's tab.
      return c.json({ error: "agent_unreachable" }, 502);
    }
  });

  return app;
}

/** Reads `scope` from an already-parsed body, defaulting to the full economy. */
function scopeFrom(fields: Record<string, unknown>): string {
  const raw = fields["scope"];
  return typeof raw === "string" && (SCOPES as readonly string[]).includes(raw) ? raw : "all";
}

/**
 * Reads `scope` from a request whose body may be absent entirely. The UNLEASH button predates
 * scopes and still sends no body, so a missing/unparseable body must mean `"all"`, not an error.
 */
async function scopeOf(c: Context): Promise<string> {
  try {
    const body: unknown = await c.req.json();
    return scopeFrom(typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {});
  } catch {
    return "all";
  }
}
