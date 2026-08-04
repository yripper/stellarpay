import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { createFeedBuffer, type FeedEvent } from "./buffer.js";
import { createCooldown, type Cooldown } from "./cooldown.js";
import { parseIngestBody } from "./ingest.js";

export type Deps = {
  ingestSecret: string;
  /** Public base URL of the agent service; unset → /unleash answers 503. */
  agentUrl?: string;
  /** Injectable for tests; defaults to a 2-minute global cooldown (spec §4.5). */
  cooldown?: Cooldown;
  agentFetch?: typeof fetch;
  html: string;
};

/** Pure app factory — `main.ts` binds it to a socket; tests hit it via `app.request`. */
export function buildApp(deps: Deps): Hono {
  const buffer = createFeedBuffer(200);
  const subscribers = new Set<(e: FeedEvent) => void>();
  const cooldown = deps.cooldown ?? createCooldown(120_000);
  const agentFetch = deps.agentFetch ?? fetch;
  const app = new Hono();

  const authorized = (c: Context): boolean => c.req.header("authorization") === `Bearer ${deps.ingestSecret}`;

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/", (c) => c.html(deps.html));

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

  app.post("/unleash", (c) => {
    if (!deps.agentUrl) return c.json({ error: "agent_not_configured" }, 503);
    const gate = cooldown.check();
    if (!gate.ok) return c.json({ error: "cooldown", retryAfterSeconds: gate.retryAfterSeconds }, 429);
    cooldown.trigger();
    void agentFetch(`${deps.agentUrl}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${deps.ingestSecret}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      // Fire-and-forget: an unreachable agent must not break the button; the judge
      // sees 202 + an empty run, and the failure lands in this service's logs only.
    });
    return c.json({ status: "unleashed" }, 202);
  });

  return app;
}
