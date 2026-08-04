import { describe, expect, it, vi } from "vitest";
import { createCooldown } from "../src/cooldown.js";
import { REPO_URL, SCOPES, buildApp } from "../src/server.js";

const SECRET = "test-secret";

function makeApp(overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({ ingestSecret: SECRET, html: "<h1>test</h1>", ...overrides });
}

// A plain default parameter (`auth = Bearer ${SECRET}`) can't distinguish "omitted" from
// "explicitly passed undefined" — JS substitutes the default in both cases, which would
// silently turn the "missing bearer token" test case below into a valid-auth request. The
// rest-parameter form preserves that distinction: `authArg.length === 0` only when the
// caller truly omitted the argument.
function ingest(app: ReturnType<typeof buildApp>, body: unknown, ...authArg: [auth?: string | undefined]) {
  const auth = authArg.length > 0 ? authArg[0] : `Bearer ${SECRET}`;
  return app.request("/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("dashboard app", () => {
  it("healthz is open", async () => {
    const res = await makeApp().request("/healthz");
    expect(res.status).toBe(200);
  });

  it("ingest rejects a missing or wrong bearer token", async () => {
    const app = makeApp();
    expect((await ingest(app, { service: "s", kind: "agent-log", message: "m" }, undefined)).status).toBe(401);
    expect((await ingest(app, { service: "s", kind: "agent-log", message: "m" }, "Bearer wrong")).status).toBe(401);
  });

  it("ingest rejects malformed JSON and malformed bodies without crashing", async () => {
    const app = makeApp();
    expect((await ingest(app, "{not json")).status).toBe(400);
    expect((await ingest(app, { service: "s", kind: "nope" })).status).toBe(400);
  });

  it("ingest accepts a valid receipt with 204", async () => {
    const res = await ingest(makeApp(), { service: "express-api", kind: "receipt", receipt: { amount: "0.02" } });
    expect(res.status).toBe(204);
  });

  // Not in the brief's server.test.ts snippet verbatim, but "SSE feed" is the task's own
  // namesake feature and this is its one load-bearing behavior: a dashboard opened after
  // events already happened must not be empty. Reads the SSE stream directly (no EventSource
  // polyfill) and cancels once both buffered events have arrived — canceling triggers Hono's
  // `stream.onAbort()` (`src/server.ts:64`), which clears the heartbeat interval and drops the
  // subscriber, so the test leaves nothing running behind it.
  it("events replays the buffered history to a newly connected subscriber, in seq order", async () => {
    const app = makeApp();
    await ingest(app, { service: "svc", kind: "agent-log", message: "one" });
    await ingest(app, { service: "svc", kind: "agent-log", message: "two" });

    const res = await app.request("/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let combined = "";
    while (!combined.includes('"seq":2')) {
      const { value, done } = await reader.read();
      if (done) break;
      combined += decoder.decode(value, { stream: true });
    }
    await reader.cancel();

    const firstAt = combined.indexOf('"seq":1');
    const secondAt = combined.indexOf('"seq":2');
    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(secondAt).toBeGreaterThan(firstAt);
    expect(combined).toContain("id: 1");
    expect(combined).toContain("id: 2");
  });

  it("unleash returns 503 when no agent is configured", async () => {
    const res = await makeApp().request("/unleash", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("unleash fires the agent once then enforces the cooldown", async () => {
    let t = 0;
    const agentFetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const app = makeApp({
      agentUrl: "http://agent.test",
      cooldown: createCooldown(120_000, () => t),
      agentFetch: agentFetch as unknown as typeof fetch,
    });
    const first = await app.request("/unleash", { method: "POST" });
    expect(first.status).toBe(202);
    expect(agentFetch).toHaveBeenCalledWith(
      "http://agent.test/run",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
        // A bodyless UNLEASH press must still reach the agent as the full economy.
        body: JSON.stringify({ scope: "all" }),
      }),
    );
    t += 30_000;
    const second = await app.request("/unleash", { method: "POST" });
    expect(second.status).toBe(429);
    expect(((await second.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBe(90);
  });

  it("unleash still 202s when the agent call rejects (fire-and-forget)", async () => {
    const agentFetch = vi.fn().mockRejectedValue(new Error("down"));
    const app = makeApp({ agentUrl: "http://agent.test", agentFetch: agentFetch as unknown as typeof fetch });
    const res = await app.request("/unleash", { method: "POST" });
    expect(res.status).toBe(202);
  });

  // /config is how the static public/index.html learns the seller/buyer public keys for the
  // "verify on-chain" link and the client-side Horizon balance panel — both must degrade to
  // null (not omitted, not an error) when the corresponding env var is unset, so the page can
  // hide each affordance independently.
  it("config reports null payTo/buyerPublic when unset", async () => {
    const res = await makeApp().request("/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ payTo: null, buyerPublic: null, scopes: SCOPES, repoUrl: REPO_URL });
  });

  it("config echoes payTo/buyerPublic when configured", async () => {
    const app = makeApp({ payTo: "GSELLERPUBLICKEY", buyerPublic: "GBUYERPUBLICKEY" });
    const res = await app.request("/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      payTo: "GSELLERPUBLICKEY",
      buyerPublic: "GBUYERPUBLICKEY",
      scopes: SCOPES,
      repoUrl: REPO_URL,
    });
  });

  // The scope a visitor picks must reach the agent verbatim; an unknown one must not.
  it("unleash forwards a known scope and falls back to all for an unknown one", async () => {
    const post = async (scope: string): Promise<unknown> => {
      const agentFetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
      const app = makeApp({
        agentUrl: "http://agent.test",
        cooldown: createCooldown(120_000, () => 0),
        agentFetch: agentFetch as unknown as typeof fetch,
      });
      const res = await app.request("/unleash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      expect(res.status).toBe(202);
      return (agentFetch.mock.calls[0]?.[1] as { body: string }).body;
    };
    expect(await post("hono-api")).toBe(JSON.stringify({ scope: "hono-api" }));
    expect(await post("not-a-service")).toBe(JSON.stringify({ scope: "all" }));
  });

  it("chat rejects an empty message before spending anything", async () => {
    const agentFetch = vi.fn();
    const app = makeApp({ agentUrl: "http://agent.test", agentFetch: agentFetch as unknown as typeof fetch });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    expect(res.status).toBe(400);
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it("chat returns the agent's reply and then enforces its own cooldown", async () => {
    let t = 0;
    const agentFetch = vi.fn().mockResolvedValue(Response.json({ reply: "I bought whale alerts." }));
    const app = makeApp({
      agentUrl: "http://agent.test",
      chatCooldown: createCooldown(30_000, () => t),
      agentFetch: agentFetch as unknown as typeof fetch,
    });
    const ask = async (): Promise<Response> =>
      app.request("/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "what can you do?", scope: "hono-api" }),
      });

    const first = await ask();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ reply: "I bought whale alerts." });
    expect(agentFetch).toHaveBeenCalledWith(
      "http://agent.test/chat",
      expect.objectContaining({ body: JSON.stringify({ message: "what can you do?", scope: "hono-api" }) }),
    );

    t += 10_000;
    const second = await ask();
    expect(second.status).toBe(429);
    expect(((await second.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBe(20);
  });

  // An agent mid-run answers 409; the visitor must see that, not a generic 502.
  it("chat surfaces the agent's run_in_progress as 409", async () => {
    const agentFetch = vi.fn().mockResolvedValue(Response.json({ error: "run_in_progress" }, { status: 409 }));
    const app = makeApp({ agentUrl: "http://agent.test", agentFetch: agentFetch as unknown as typeof fetch });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(409);
  });

  it("chat answers 502 rather than hanging when the agent is unreachable", async () => {
    const agentFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const app = makeApp({ agentUrl: "http://agent.test", agentFetch: agentFetch as unknown as typeof fetch });
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "agent_unreachable" });
  });
});
