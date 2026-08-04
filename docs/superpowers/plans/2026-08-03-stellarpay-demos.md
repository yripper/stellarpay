# stellarpay Demos & Launch (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six Railway-hosted demo services forming a live "Stellar Intel" paid micro-economy on Stellar testnet, plus launch collateral (repository metadata, README demo links, demo-video guidance, ops script).

**Architecture:** Each demo is a private pnpm workspace member under `examples/`, consuming the shipped `@stellarpay-sdk/*` packages via `workspace:*`. Three paid APIs (express/hono/fastify) + one paid MCP server sell live Horizon/RPC intel; a dashboard receives receipt POSTs over a shared-secret `/ingest` contract and streams them via SSE; an agent service buys across the whole economy via `createPayingFetch` + paid MCP transport, Claude-driven with a deterministic scripted fallback. Deployment is one Railway project (`stellarpay-demo`) using the **shared-monorepo** pattern (no root directory; per-service start command `pnpm --filter <pkg> start` — confirmed against Railway docs `deployments/monorepo`; this supersedes the spec's "root directory `examples/<name>`" wording, which breaks pnpm workspace resolution).

**Tech Stack:** TypeScript (NodeNext, strict, from `tsconfig.base.json`), Node ≥22, tsx as the runtime (no build step for examples), Hono + `@hono/node-server` (dashboard, agent), Express 4, Fastify 4, `@modelcontextprotocol/sdk` ^1.30.0, `@anthropic-ai/sdk`, vitest 3, Railway MCP tools.

**Spec:** `docs/superpowers/specs/2026-08-03-stellarpay-demos-design.md`. Deadline: Wednesday 2026-08-05.

## Global Constraints

- Conventional commits; **NEVER any `Co-Authored-By`, Claude, or AI attribution line in any commit** — repeat this in every implementer dispatch and verify `git log --format=%B` after each task.
- Never print, log, or commit secrets: `.env` values, `S...` seeds, `DEMO_MPP_SECRET`, `DEMO_FACILITATOR_KEY`, `INGEST_SECRET`, `ANTHROPIC_API_KEY`.
- Railway operations go through the railway MCP tools, not the Railway CLI/web. (Exception, by design: the user personally enters the three real-secret env values — `DEMO_BUYER_SECRET`, `DEMO_SPONSOR_SECRET`, `ANTHROPIC_API_KEY` — via the Railway dashboard UI so seeds never transit agent context. Tasks 11–13 mark these pause points.)
- Verify every upstream API name against the installed `node_modules` (`.d.ts`) before writing code that uses it; never guess. (All SDK APIs referenced in this plan were verified at plan time — citations inline. Newly installed deps — `@anthropic-ai/sdk` — carry an explicit verify step.)
- Judge-quality bar for all demo UX and copy: real Horizon/RPC data, coherent "Stellar Intel" narrative, no lorem ipsum, no dead buttons.
- `examples/*` are `"private": true` and are never published.
- Module-doc convention (CLAUDE.md): `docs/modules/examples.md` is created in Task 2 and updated in the same change by every task that touches `examples/`; bump its "Last verified" date each time.
- Route keys in `StellarpayConfig.routes` support ONLY `"METHOD /exact/path"` or `"METHOD /prefix/*"` — **no `:params`** (`packages/core/src/config.ts:7`, `packages/core/src/router.ts:14-19`). Framework routes may use params; the paywall key must be a wildcard prefix.
- All demo prices are dollar strings; spend limits are dollar strings too (`packages/client/src/limits.ts:8,27-30`).
- Local dev ports: dashboard 4600, express-api 4601, hono-api 4602, fastify-api 4603, mcp-server 4604, agent 4605.
- Env-var names (spec §5): `DEMO_PAYTO`, `DEMO_MPP_SECRET`, `DEMO_SPONSOR_SECRET`, `DEMO_FACILITATOR_KEY`, `DEMO_BUYER_SECRET`, `ANTHROPIC_API_KEY`, `INGEST_SECRET`, `DASHBOARD_URL`, `AGENT_URL`, `PORT`, plus per-consumer service URLs `EXPRESS_API_URL`, `HONO_API_URL`, `FASTIFY_API_URL`, `MCP_SERVER_URL`.
- Every example loads env via Node 22's `process.loadEnvFile()` with the ENOENT-guarded pattern from `scripts/smoke.ts:39-44`; missing required vars → print names only (never values) and exit 1.

## File Structure

```
examples/
  dashboard/        package.json, tsconfig.json, vitest.config.ts, .env.example, README.md
                    src/{buffer,cooldown,ingest,server,main}.ts  public/index.html
                    test/{buffer,cooldown,ingest,server}.test.ts  test/integration.sse.test.ts (Task 10)
  express-api/      package.json, tsconfig.json, vitest.config.ts, .env.example, README.md
                    src/{env,reportReceipt,intel,server,main}.ts
                    test/{reportReceipt,intel}.test.ts
  hono-api/         package.json, tsconfig.json, vitest.config.ts, .env.example, README.md
                    src/{env,reportReceipt,whales,server,main}.ts  test/whales.test.ts
  fastify-api/      package.json, tsconfig.json, .env.example, README.md
                    src/{env,reportReceipt,fees,server,main}.ts
  mcp-server/       package.json, tsconfig.json, .env.example, README.md
                    src/{env,reportReceipt,intel,mcp,main}.ts
  agent/            package.json, tsconfig.json, vitest.config.ts, .env.example, README.md
                    src/{env,narrate,economy,claude,scripted,run,server,main}.ts
                    test/run.test.ts
scripts/setup-demo.ts   scripts/verify-live.ts
docs/demo-video.md      docs/modules/examples.md
```

`reportReceipt.ts` and `env.ts` are deliberately copied per service (≈20 lines each; examples are private, a shared package would be YAGNI — spec §3).

---

### Task 1: Repository metadata in publishable manifests

**Files:**
- Modify: `packages/{core,express,hono,fastify,client,mcp}/package.json`
- Modify: `PUBLISHING.md:32-37` (the "No `repository` field is set" caveat block)

**Interfaces:** none (metadata only).

- [ ] **Step 1: Add the repository field to all six manifests**

In each of the six `packages/*/package.json` (NOT `packages/shared` — it is private and unpublished), add at top level (after `"license"`):

```json
"repository": { "type": "git", "url": "git+https://github.com/yripper/stellarpay.git", "directory": "packages/<name>" }
```

with `<name>` = `core`, `express`, `hono`, `fastify`, `client`, `mcp` respectively.

- [ ] **Step 2: Verify**

Run: `node -e 'for (const p of ["core","express","hono","fastify","client","mcp"]) { const m = require("./packages/" + p + "/package.json"); if (m.repository?.url !== "git+https://github.com/yripper/stellarpay.git" || m.repository?.directory !== "packages/" + p) throw new Error(p); } console.log("OK")'`
Expected: `OK`

- [ ] **Step 3: Update PUBLISHING.md**

Replace the caveat block at `PUBLISHING.md:32-37` (the bullet starting "**No `repository` field is set**" through the end of that bullet) with:

```markdown
- **`repository` fields are set** — all six publishable manifests point at
  `https://github.com/yripper/stellarpay` with per-package `directory` entries, so npm's
  package pages link back to the monorepo.
```

- [ ] **Step 4: Typecheck + test still green, then commit**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (metadata change; nothing compiles differently)

```bash
git add packages/*/package.json PUBLISHING.md
git commit -m "chore: add repository metadata to publishable manifests"
```

---

### Task 2: Dashboard core (ingest, SSE feed, unleash cooldown)

**Files:**
- Create: `examples/dashboard/package.json`, `examples/dashboard/tsconfig.json`, `examples/dashboard/vitest.config.ts`, `examples/dashboard/.env.example`, `examples/dashboard/README.md`
- Create: `examples/dashboard/src/buffer.ts`, `src/cooldown.ts`, `src/ingest.ts`, `src/server.ts`, `src/main.ts`, `public/index.html` (one-line placeholder; Task 3 replaces it)
- Create: `examples/dashboard/test/buffer.test.ts`, `test/cooldown.test.ts`, `test/ingest.test.ts`, `test/server.test.ts`
- Create: `docs/modules/examples.md`; Modify: `docs/modules/README.md` (add index row `examples/* → examples.md`)

**Interfaces:**
- Produces (HTTP, consumed by every other service): `POST /ingest` — header `Authorization: Bearer <INGEST_SECRET>`, JSON body `{ service: string, kind: "receipt", receipt: object }` or `{ service: string, kind: "agent-log", message: string }`; responses `204`/`401`/`400`. `GET /events` — SSE stream of `FeedEvent` JSON. `POST /unleash` — `202 {status:"unleashed"}` / `429 {error:"cooldown", retryAfterSeconds}` / `503 {error:"agent_not_configured"}`. `GET /healthz` — `200 {ok:true}`.
- Produces (TS, consumed by Task 3 & 10): `buildApp(deps: Deps): Hono` from `src/server.ts`; `FeedEvent` from `src/buffer.ts`.
- Consumes: `streamSSE` (`node_modules/hono/dist/types/helper/streaming/sse.d.ts:13`), `serve` from `@hono/node-server` (pattern: `scripts/smoke.ts:229`).

- [ ] **Step 1: Scaffold the package**

`examples/dashboard/package.json`:

```json
{
  "name": "@stellarpay-examples/dashboard",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@hono/node-server": "^2.0.12",
    "hono": "^4",
    "tsx": "^4.19.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.9.2",
    "vitest": "^3.0.0"
  }
}
```

(`tsx` is a runtime dependency on purpose: Railway's start command runs `tsx src/main.ts` — no build step.)

`examples/dashboard/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src", "test"]
}
```

`examples/dashboard/vitest.config.ts` (same per-package pattern as `packages/*` — the root glob breaks under `pnpm --filter`, a Plan A ruling):

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

`examples/dashboard/.env.example`:

```
# Shared secret authorizing /ingest POSTs and outbound /unleash → agent /run calls.
INGEST_SECRET=change-me
# Public base URL of the agent service (no trailing slash). Unset → /unleash returns 503.
AGENT_URL=
# Port to bind (Railway injects PORT; local default 4600).
PORT=4600
```

Run `pnpm install` at the repo root (links the new workspace member; `pnpm-workspace.yaml` already includes `examples/*`).

- [ ] **Step 2: Write failing tests for the three pure modules**

`examples/dashboard/test/buffer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFeedBuffer } from "../src/buffer.js";

describe("createFeedBuffer", () => {
  it("assigns increasing seq numbers and returns pushed events", () => {
    const buf = createFeedBuffer(10);
    const a = buf.push({ at: "2026-08-03T00:00:00Z", service: "s", kind: "agent-log", message: "one" });
    const b = buf.push({ at: "2026-08-03T00:00:01Z", service: "s", kind: "agent-log", message: "two" });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(buf.list().map((e) => e.message)).toEqual(["one", "two"]);
  });

  it("drops the oldest event beyond capacity", () => {
    const buf = createFeedBuffer(2);
    buf.push({ at: "t", service: "s", kind: "agent-log", message: "1" });
    buf.push({ at: "t", service: "s", kind: "agent-log", message: "2" });
    buf.push({ at: "t", service: "s", kind: "agent-log", message: "3" });
    expect(buf.list().map((e) => e.message)).toEqual(["2", "3"]);
    expect(buf.list().at(-1)?.seq).toBe(3); // seq keeps counting across evictions
  });
});
```

`examples/dashboard/test/cooldown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createCooldown } from "../src/cooldown.js";

describe("createCooldown", () => {
  it("allows the first trigger, blocks within the window, allows after it", () => {
    let t = 1_000_000;
    const cd = createCooldown(120_000, () => t);
    expect(cd.check()).toEqual({ ok: true });
    cd.trigger();
    t += 30_000;
    const blocked = cd.check();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBe(90);
    t += 90_000;
    expect(cd.check()).toEqual({ ok: true });
  });
});
```

`examples/dashboard/test/ingest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseIngestBody } from "../src/ingest.js";

describe("parseIngestBody", () => {
  it("accepts a receipt event", () => {
    expect(parseIngestBody({ service: "express-api", kind: "receipt", receipt: { route: "GET /report/*" } })).toEqual({
      service: "express-api",
      kind: "receipt",
      receipt: { route: "GET /report/*" },
    });
  });

  it("accepts an agent-log event", () => {
    expect(parseIngestBody({ service: "agent", kind: "agent-log", message: "hi" })).toEqual({
      service: "agent",
      kind: "agent-log",
      message: "hi",
    });
  });

  it.each([
    null,
    "string",
    {},
    { service: "", kind: "receipt", receipt: {} },
    { service: "s", kind: "receipt", receipt: "not-an-object" },
    { service: "s", kind: "agent-log", message: "" },
    { service: "s", kind: "unknown" },
  ])("rejects malformed body %#", (body) => {
    expect(parseIngestBody(body)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @stellarpay-examples/dashboard test`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the pure modules**

`examples/dashboard/src/buffer.ts`:

```ts
/** One event on the live feed: a settlement receipt or an agent narration line. */
export type FeedEvent = {
  seq: number;
  /** ISO 8601, stamped at ingestion time by the dashboard (not trusted from the sender). */
  at: string;
  service: string;
  kind: "receipt" | "agent-log";
  /** Opaque receipt payload — rendered defensively, unknown fields shown as "—". */
  receipt?: Record<string, unknown>;
  message?: string;
};

/** Fixed-capacity in-memory ring buffer. Demo infra by design (spec §4.5): restart loses history. */
export function createFeedBuffer(capacity: number) {
  const events: FeedEvent[] = [];
  let seq = 0;
  return {
    push(e: Omit<FeedEvent, "seq">): FeedEvent {
      const event: FeedEvent = { ...e, seq: ++seq };
      events.push(event);
      if (events.length > capacity) events.shift();
      return event;
    },
    list(): readonly FeedEvent[] {
      return events;
    },
  };
}

export type FeedBuffer = ReturnType<typeof createFeedBuffer>;
```

`examples/dashboard/src/cooldown.ts`:

```ts
/** Global unleash cooldown. `now` is injectable for tests. */
export function createCooldown(intervalMs: number, now: () => number = Date.now) {
  let lastAt: number | undefined;
  return {
    check(): { ok: true } | { ok: false; retryAfterSeconds: number } {
      if (lastAt !== undefined) {
        const elapsed = now() - lastAt;
        if (elapsed < intervalMs) return { ok: false, retryAfterSeconds: Math.ceil((intervalMs - elapsed) / 1000) };
      }
      return { ok: true };
    },
    trigger(): void {
      lastAt = now();
    },
  };
}

export type Cooldown = ReturnType<typeof createCooldown>;
```

`examples/dashboard/src/ingest.ts`:

```ts
import type { FeedEvent } from "./buffer.js";

/**
 * Validates an /ingest body. Hand-rolled (no zod) on purpose: two shapes, and the
 * dashboard treats receipt payloads as opaque — deep receipt validation would couple
 * demo infra to the SDK's Receipt type for no gain.
 */
export function parseIngestBody(body: unknown): Omit<FeedEvent, "seq" | "at"> | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b["service"] !== "string" || b["service"] === "") return undefined;
  if (b["kind"] === "receipt") {
    if (typeof b["receipt"] !== "object" || b["receipt"] === null || Array.isArray(b["receipt"])) return undefined;
    return { service: b["service"], kind: "receipt", receipt: b["receipt"] as Record<string, unknown> };
  }
  if (b["kind"] === "agent-log") {
    if (typeof b["message"] !== "string" || b["message"] === "") return undefined;
    return { service: b["service"], kind: "agent-log", message: b["message"] };
  }
  return undefined;
}
```

- [ ] **Step 5: Run the pure-module tests — pass**

Run: `pnpm --filter @stellarpay-examples/dashboard test`
Expected: buffer/cooldown/ingest PASS.

- [ ] **Step 6: Write failing HTTP tests**

`examples/dashboard/test/server.test.ts` (uses Hono's built-in `app.request` — no socket):

```ts
import { describe, expect, it, vi } from "vitest";
import { createCooldown } from "../src/cooldown.js";
import { buildApp } from "../src/server.js";

const SECRET = "test-secret";

function makeApp(overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({ ingestSecret: SECRET, html: "<h1>test</h1>", ...overrides });
}

function ingest(app: ReturnType<typeof buildApp>, body: unknown, auth: string | undefined = `Bearer ${SECRET}`) {
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
      expect.objectContaining({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } }),
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
});
```

Run: `pnpm --filter @stellarpay-examples/dashboard test` — Expected: FAIL (`server.js` missing).

- [ ] **Step 7: Implement `src/server.ts` + `src/main.ts`**

`examples/dashboard/src/server.ts`:

```ts
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
```

`examples/dashboard/src/main.ts`:

```ts
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { buildApp } from "./server.js";

// Node 22 built-in .env loader — same ENOENT-guarded pattern as scripts/smoke.ts:39-44.
try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

const ingestSecret = process.env["INGEST_SECRET"];
if (!ingestSecret) {
  console.error("Missing required env var: INGEST_SECRET (see .env.example)");
  process.exit(1);
}

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const port = Number(process.env["PORT"] ?? 4600);
const app = buildApp({ ingestSecret, agentUrl: process.env["AGENT_URL"] || undefined, html });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`stellarpay dashboard listening on :${info.port}`);
});
```

Until Task 3 lands, create a one-line placeholder `examples/dashboard/public/index.html` containing `<h1>stellarpay dashboard — UI lands in the next task</h1>` so `main.ts` boots.

- [ ] **Step 8: Run all dashboard tests + typecheck — pass**

Run: `pnpm --filter @stellarpay-examples/dashboard test && pnpm --filter @stellarpay-examples/dashboard typecheck`
Expected: PASS. Also confirm the root suite still passes: `pnpm test`.

- [ ] **Step 9: Module doc + README**

Create `docs/modules/examples.md` following the shared template (Purpose / Structure / Public surface / Key methods with `file:line` / Dependencies / Gotchas / Testing), documenting the ingest contract (this task's Interfaces block) and the dashboard's internals; add the row `examples/* → examples.md` to `docs/modules/README.md`. Write `examples/dashboard/README.md`: what it is, endpoints, env vars, `pnpm dev`, the in-memory-history caveat.

- [ ] **Step 10: Commit**

```bash
git add examples/dashboard docs/modules pnpm-lock.yaml
git commit -m "feat(examples): dashboard core — ingest auth, SSE feed, unleash cooldown"
```

---

### Task 3: Dashboard UI (dark mission-control)

**Files:**
- Create: `examples/dashboard/public/index.html` (replaces the Task 2 placeholder)
- Modify: `examples/dashboard/README.md` (screenshot placeholder + description), `docs/modules/examples.md`

**Interfaces:**
- Consumes: `GET /events` SSE (`FeedEvent` JSON per message; `ping` events to ignore), `POST /unleash` (202/429/503) — from Task 2.

- [ ] **Step 1: Write the page**

`examples/dashboard/public/index.html` — complete file:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>stellarpay // mission control</title>
<style>
  :root {
    --bg: #0a0e14; --panel: #11161f; --border: #1d2633; --text: #c9d4e3;
    --dim: #5c6b80; --green: #3ddc84; --cyan: #4dd0e1; --amber: #ffb74d; --red: #ef5350;
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 14px/1.5 "SF Mono", ui-monospace, Menlo, monospace; min-height: 100vh; }
  header { display: flex; align-items: center; gap: 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  header h1 { font-size: 1rem; letter-spacing: .15em; color: var(--green); font-weight: 600; }
  header .sub { color: var(--dim); font-size: .8rem; }
  #stats { display: flex; gap: 2rem; margin-left: auto; }
  #stats div { text-align: right; }
  #stats .n { color: var(--cyan); font-size: 1.1rem; font-weight: 600; }
  #stats .l { color: var(--dim); font-size: .7rem; text-transform: uppercase; letter-spacing: .1em; }
  #unleash-bar { padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 1rem; }
  #unleash {
    background: transparent; color: var(--green); border: 1px solid var(--green); border-radius: 4px;
    font: inherit; font-weight: 700; letter-spacing: .12em; padding: .6rem 1.4rem; cursor: pointer;
  }
  #unleash:hover:not(:disabled) { background: var(--green); color: var(--bg); }
  #unleash:disabled { color: var(--dim); border-color: var(--dim); cursor: not-allowed; }
  #unleash-msg { color: var(--dim); font-size: .8rem; }
  #feed { padding: .75rem 1.5rem; display: flex; flex-direction: column-reverse; }
  .row { display: flex; gap: .75rem; padding: .45rem .6rem; border-bottom: 1px solid var(--border); align-items: baseline; flex-wrap: wrap; }
  .row .at { color: var(--dim); font-size: .75rem; white-space: nowrap; }
  .row .svc { color: var(--cyan); min-width: 8ch; }
  .badge { font-size: .7rem; padding: .1rem .5rem; border-radius: 3px; border: 1px solid; letter-spacing: .05em; }
  .badge.x402 { color: var(--amber); border-color: var(--amber); }
  .badge.mpp { color: var(--cyan); border-color: var(--cyan); }
  .amt { color: var(--green); font-weight: 600; }
  .payer { color: var(--dim); }
  .row a { color: var(--cyan); }
  .row.log { color: var(--dim); font-style: italic; }
  .row.log .msg { color: var(--text); font-style: italic; }
  #empty { color: var(--dim); padding: 2rem 1.5rem; }
</style>
</head>
<body>
<header>
  <h1>STELLARPAY // MISSION CONTROL</h1>
  <span class="sub">live payment feed · stellar testnet</span>
  <div id="stats">
    <div><div class="n" id="stat-count">0</div><div class="l">payments</div></div>
    <div><div class="n" id="stat-volume">0.0000</div><div class="l">USDC volume</div></div>
  </div>
</header>
<div id="unleash-bar">
  <button id="unleash">▶ UNLEASH THE AGENT</button>
  <span id="unleash-msg">An autonomous agent will buy intel across this economy, within its spend limits.</span>
</div>
<div id="empty">Waiting for payments…</div>
<div id="feed"></div>
<script>
  "use strict";
  const feed = document.getElementById("feed");
  const empty = document.getElementById("empty");
  const statCount = document.getElementById("stat-count");
  const statVolume = document.getElementById("stat-volume");
  let count = 0, volume = 0;

  function esc(v) {
    return String(v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  // Every receipt field is untrusted and optional: render unknowns as "—" (spec §8).
  function field(obj, key) { return obj && typeof obj[key] === "string" && obj[key] !== "" ? obj[key] : undefined; }

  function render(ev) {
    const row = document.createElement("div");
    if (ev.kind === "agent-log") {
      row.className = "row log";
      row.innerHTML = '<span class="at">' + esc(ev.at || "") + '</span><span class="svc">' + esc(ev.service) + '</span><span class="msg">' + esc(ev.message || "") + "</span>";
    } else {
      const r = ev.receipt || {};
      const scheme = field(r, "scheme") || "—";
      const amount = field(r, "amount");
      const asset = field(r, "asset") || "";
      const payer = field(r, "payer");
      const tx = field(r, "txHash");
      row.className = "row";
      row.innerHTML =
        '<span class="at">' + esc(ev.at || "") + '</span>' +
        '<span class="svc">' + esc(ev.service) + '</span>' +
        '<span class="badge ' + (scheme === "x402" ? "x402" : "mpp") + '">' + esc(scheme) + "</span>" +
        '<span>' + esc(field(r, "route") || field(r, "tool") || "—") + "</span>" +
        '<span class="amt">' + (amount ? esc(amount) + " " + esc(asset) : "—") + "</span>" +
        '<span class="payer">' + (payer ? esc(payer.slice(0, 4) + "…" + payer.slice(-4)) : "") + "</span>" +
        (tx ? '<a href="https://stellar.expert/explorer/testnet/tx/' + esc(tx) + '" target="_blank" rel="noopener">settlement ↗</a>' : "");
      count += 1;
      const parsed = Number(amount);
      if (Number.isFinite(parsed)) volume += parsed;
      statCount.textContent = String(count);
      statVolume.textContent = volume.toFixed(4);
    }
    empty.style.display = "none";
    feed.appendChild(row); // column-reverse flex → newest visually on top
  }

  const source = new EventSource("/events");
  source.onmessage = (msg) => {
    try { render(JSON.parse(msg.data)); } catch { /* never let one bad event kill the feed */ }
  };

  const btn = document.getElementById("unleash");
  const msg = document.getElementById("unleash-msg");
  let countdownTimer;
  function startCountdown(seconds) {
    btn.disabled = true;
    let left = seconds;
    const tick = () => {
      if (left <= 0) { btn.disabled = false; btn.textContent = "▶ UNLEASH THE AGENT"; return; }
      btn.textContent = "COOLDOWN " + left + "s";
      left -= 1;
      countdownTimer = setTimeout(tick, 1000);
    };
    clearTimeout(countdownTimer);
    tick();
  }
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const res = await fetch("/unleash", { method: "POST" });
      if (res.status === 202) { msg.textContent = "Agent unleashed — watch the feed."; startCountdown(120); }
      else if (res.status === 429) { const body = await res.json(); msg.textContent = "Agent is cooling down."; startCountdown(body.retryAfterSeconds || 60); }
      else { msg.textContent = "Agent unavailable right now."; btn.disabled = false; }
    } catch { msg.textContent = "Request failed — try again."; btn.disabled = false; }
  });
</script>
</body>
</html>
```

- [ ] **Step 2: Verify locally against the real server**

```bash
cd examples/dashboard && INGEST_SECRET=dev PORT=4600 pnpm start &
sleep 2
curl -s localhost:4600/ | grep -c "MISSION CONTROL"          # expect 1
curl -s -X POST localhost:4600/ingest -H 'authorization: Bearer dev' -H 'content-type: application/json' \
  -d '{"service":"express-api","kind":"receipt","receipt":{"scheme":"x402","route":"GET /report/*","amount":"0.02","asset":"USDC","txHash":"abc123"}}' -o /dev/null -w '%{http_code}\n'   # expect 204
curl -s -N localhost:4600/events --max-time 2 | head -3       # expect a data: line with the receipt
kill %1
```

Open `http://localhost:4600` in a browser once: confirm the row renders with badge/amount/link, and the button shows the 503 "unavailable" path (no AGENT_URL set).

- [ ] **Step 3: Update docs and commit**

Update `examples/dashboard/README.md` and `docs/modules/examples.md` ("Last verified" bump).

```bash
git add examples/dashboard docs/modules/examples.md
git commit -m "feat(examples): dashboard mission-control UI"
```

---

### Task 4: express-api — flagship paid API

**Files:**
- Create: `examples/express-api/{package.json,tsconfig.json,vitest.config.ts,.env.example,README.md}`
- Create: `examples/express-api/src/{env,reportReceipt,intel,server,main}.ts`
- Create: `examples/express-api/test/{reportReceipt,intel}.test.ts`
- Modify: `docs/modules/examples.md`

**Interfaces:**
- Consumes: `stellarpayExpress(config)` (`packages/express/src/index.ts:36`, mount pattern `app.use(...)` before routes per `packages/express/test`), `StellarpayConfig`/`Receipt` (`packages/core/src/types.ts:48,25`), `NETWORKS` (`packages/core/src/index.ts:11`), dashboard ingest contract (Task 2).
- Produces (HTTP, consumed by agent Task 8): free `GET /` (JSON index), free `GET /summary/:code/:issuer`; paid `GET /report/:code/:issuer` (x402 $0.02, config key `"GET /report/*"`), paid `GET /deep-dive/:account` (mpp-charge $0.02, sponsored when `DEMO_SPONSOR_SECRET` set, config key `"GET /deep-dive/*"`).
- Produces (pattern reused by Tasks 5–8): `createReceiptReporter` in `src/reportReceipt.ts` — copied per service verbatim (only the `service` value differs at the call site).

- [ ] **Step 1: Scaffold**

`examples/express-api/package.json`:

```json
{
  "name": "@stellarpay-examples/express-api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@stellarpay-sdk/core": "workspace:*",
    "@stellarpay-sdk/express": "workspace:*",
    "express": "^4",
    "tsx": "^4.19.0"
  },
  "devDependencies": {
    "@types/express": "^4",
    "@types/node": "^22.10.0",
    "typescript": "^5.9.2",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json` and `vitest.config.ts`: identical to Task 2 Step 1's. Run `pnpm install` at root.

`.env.example`:

```
# Seller/recipient public key (G...). Public value — safe to share.
DEMO_PAYTO=G...
# HMAC secret for the mpp-charge scheme (any random string; server-side only).
DEMO_MPP_SECRET=change-me
# OZ facilitator bearer key for the x402 route. Free: curl https://channels.openzeppelin.com/testnet/gen
DEMO_FACILITATOR_KEY=
# Optional: sponsor account secret seed (S...). When set, the deep-dive route is gas-sponsored.
DEMO_SPONSOR_SECRET=
# Dashboard receipt reporting (both optional — unset disables reporting, the API still works).
DASHBOARD_URL=
INGEST_SECRET=
PORT=4601
```

- [ ] **Step 2: Failing tests for the receipt reporter**

`examples/express-api/test/reportReceipt.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createReceiptReporter } from "../src/reportReceipt.js";

describe("createReceiptReporter", () => {
  it("POSTs the receipt with bearer auth and service tag", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const report = createReceiptReporter({
      service: "express-api",
      dashboardUrl: "http://dash.test",
      ingestSecret: "s3cret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    report({ kind: "receipt", receipt: { amount: "0.02" } });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://dash.test/ingest");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual({ service: "express-api", kind: "receipt", receipt: { amount: "0.02" } });
  });

  it("is a no-op when the dashboard is not configured", () => {
    const fetchImpl = vi.fn();
    const report = createReceiptReporter({ service: "x", dashboardUrl: undefined, ingestSecret: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    report({ kind: "agent-log", message: "m" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows fetch rejections (fire-and-forget)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("dashboard down"));
    const report = createReceiptReporter({ service: "x", dashboardUrl: "http://dash.test", ingestSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(() => report({ kind: "receipt", receipt: {} })).not.toThrow();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await new Promise((r) => setTimeout(r, 10)); // unhandled rejection would fail the test run
  });
});
```

Run: `pnpm --filter @stellarpay-examples/express-api test` — Expected: FAIL.

- [ ] **Step 3: Implement the reporter**

`examples/express-api/src/reportReceipt.ts`:

```ts
/**
 * Fire-and-forget receipt/narration reporting to the dashboard's /ingest endpoint
 * (contract: docs/modules/examples.md). A dashboard outage must never affect the
 * paid API — every failure path is swallowed. Copied per example service on purpose
 * (examples are private; a shared package for ~20 lines would be YAGNI — spec §3).
 */
export type IngestEvent = { kind: "receipt"; receipt: Record<string, unknown> } | { kind: "agent-log"; message: string };

export function createReceiptReporter(opts: {
  service: string;
  dashboardUrl: string | undefined;
  ingestSecret: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): (event: IngestEvent) => void {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3000;
  return (event) => {
    if (!opts.dashboardUrl || !opts.ingestSecret) return; // reporting is optional wiring
    void doFetch(`${opts.dashboardUrl}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.ingestSecret}` },
      body: JSON.stringify({ service: opts.service, ...event }),
      signal: AbortSignal.timeout(timeoutMs),
    }).then(
      () => undefined,
      () => undefined,
    );
  };
}
```

Run the reporter tests — Expected: PASS.

- [ ] **Step 4: Failing tests for the intel fetchers**

`examples/express-api/test/intel.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { fetchAssetSummary, fetchAssetReport, fetchAccountDeepDive } from "../src/intel.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ASSET_RECORD = { asset_code: "USDC", asset_issuer: "GISSUER", amount: "1000.5", num_accounts: 42, flags: { auth_required: false } };

describe("intel fetchers", () => {
  it("summary returns curated fields for a known asset", async () => {
    const f = vi.fn().mockResolvedValue(json({ _embedded: { records: [ASSET_RECORD] } }));
    const out = await fetchAssetSummary("USDC", "GISSUER", f as unknown as typeof fetch);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ code: "USDC", issuer: "GISSUER", supply: "1000.5", holders: 42 });
  });

  it("summary maps an empty record set to 404", async () => {
    const f = vi.fn().mockResolvedValue(json({ _embedded: { records: [] } }));
    expect((await fetchAssetSummary("NOPE", "GX", f as unknown as typeof fetch)).status).toBe(404);
  });

  it("report merges summary and order-book top levels", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ _embedded: { records: [ASSET_RECORD] } }))
      .mockResolvedValueOnce(json({ bids: [{ price: "0.51" }], asks: [{ price: "0.55" }] }));
    const out = await fetchAssetReport("USDC", "GISSUER", f as unknown as typeof fetch);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ market: { bestBidXlm: "0.51", bestAskXlm: "0.55" } });
  });

  it("deep-dive maps a Horizon 404 through", async () => {
    const f = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    expect((await fetchAccountDeepDive("GNOBODY", f as unknown as typeof fetch)).status).toBe(404);
  });

  it("horizon 5xx maps to 502", async () => {
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    expect((await fetchAssetSummary("USDC", "GX", f as unknown as typeof fetch)).status).toBe(502);
  });
});
```

Run — Expected: FAIL.

- [ ] **Step 5: Implement the intel fetchers**

`examples/express-api/src/intel.ts`:

```ts
/**
 * Live Horizon-testnet intel. All endpoints are public and keyless. Field names below
 * were confirmed against live Horizon responses (curl the endpoints once if in doubt —
 * they are versioned and stable); every read is defensive because the payload is external.
 */
const HORIZON = "https://horizon-testnet.stellar.org";

export type IntelResult = { status: number; body: Record<string, unknown> };

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

async function horizonJson(url: string, f: typeof fetch): Promise<{ status: number; data?: Rec }> {
  const res = await f(url);
  if (res.status === 404) return { status: 404 };
  if (!res.ok) return { status: 502 };
  return { status: 200, data: asRec(await res.json()) };
}

function assetRecord(data: Rec): Rec | undefined {
  const records = asRec(data["_embedded"])["records"];
  return Array.isArray(records) && records.length > 0 ? asRec(records[0]) : undefined;
}

export async function fetchAssetSummary(code: string, issuer: string, f: typeof fetch = fetch): Promise<IntelResult> {
  const url = `${HORIZON}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`;
  const { status, data } = await horizonJson(url, f);
  if (status !== 200 || !data) return { status: status === 404 ? 404 : 502, body: { error: "horizon_unavailable" } };
  const rec = assetRecord(data);
  if (!rec) return { status: 404, body: { error: "asset_not_found", code, issuer } };
  return {
    status: 200,
    body: {
      code,
      issuer,
      supply: str(rec["amount"]) ?? "—",
      holders: typeof rec["num_accounts"] === "number" ? rec["num_accounts"] : null,
      flags: asRec(rec["flags"]),
      source: "horizon-testnet, live",
    },
  };
}

export async function fetchAssetReport(code: string, issuer: string, f: typeof fetch = fetch): Promise<IntelResult> {
  const summary = await fetchAssetSummary(code, issuer, f);
  if (summary.status !== 200) return summary;
  const assetType = code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";
  const obUrl =
    `${HORIZON}/order_book?selling_asset_type=${assetType}` +
    `&selling_asset_code=${encodeURIComponent(code)}&selling_asset_issuer=${encodeURIComponent(issuer)}` +
    `&buying_asset_type=native`;
  const ob = await horizonJson(obUrl, f);
  const bids = ob.data?.["bids"];
  const asks = ob.data?.["asks"];
  const top = (side: unknown): string | null => (Array.isArray(side) && side.length > 0 ? (str(asRec(side[0])["price"]) ?? null) : null);
  return {
    status: 200,
    body: {
      ...summary.body,
      market:
        ob.status === 200
          ? { bestBidXlm: top(bids), bestAskXlm: top(asks), note: "top of the XLM order book, live" }
          : { note: "order book unavailable" },
    },
  };
}

export async function fetchAccountDeepDive(account: string, f: typeof fetch = fetch): Promise<IntelResult> {
  const acct = await horizonJson(`${HORIZON}/accounts/${encodeURIComponent(account)}`, f);
  if (acct.status !== 200 || !acct.data) {
    return { status: acct.status === 404 ? 404 : 502, body: { error: acct.status === 404 ? "account_not_found" : "horizon_unavailable" } };
  }
  const pays = await horizonJson(`${HORIZON}/accounts/${encodeURIComponent(account)}/payments?limit=10&order=desc`, f);
  const payRecords = asRec(pays.data?.["_embedded"])["records"];
  const recent = Array.isArray(payRecords)
    ? payRecords.map((p) => {
        const r = asRec(p);
        return { type: str(r["type"]) ?? "—", amount: str(r["amount"]) ?? "—", at: str(r["created_at"]) ?? "—", tx: str(r["transaction_hash"]) ?? null };
      })
    : [];
  return {
    status: 200,
    body: {
      account,
      balances: Array.isArray(acct.data["balances"]) ? acct.data["balances"] : [],
      subentries: acct.data["subentry_count"] ?? null,
      flags: asRec(acct.data["flags"]),
      recentPayments: recent,
      source: "horizon-testnet, live",
    },
  };
}
```

Run — Expected: PASS.

- [ ] **Step 6: env + server + main**

`examples/express-api/src/env.ts`:

```ts
// Node 22 built-in .env loader — same ENOENT-guarded pattern as scripts/smoke.ts:39-44.
try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

export type Env = {
  payTo: string;
  mppSecret: string;
  facilitatorKey: string | undefined;
  sponsorSecret: string | undefined;
  dashboardUrl: string | undefined;
  ingestSecret: string | undefined;
  port: number;
};

/** Reads env; on missing required vars prints their NAMES only (never values) and exits. */
export function readEnv(): Env {
  const required = ["DEMO_PAYTO", "DEMO_MPP_SECRET"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(", ")} — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return {
    payTo: process.env["DEMO_PAYTO"] as string,
    mppSecret: process.env["DEMO_MPP_SECRET"] as string,
    facilitatorKey: process.env["DEMO_FACILITATOR_KEY"] || undefined,
    sponsorSecret: process.env["DEMO_SPONSOR_SECRET"] || undefined,
    dashboardUrl: process.env["DASHBOARD_URL"] || undefined,
    ingestSecret: process.env["INGEST_SECRET"] || undefined,
    port: Number(process.env["PORT"] ?? 4601),
  };
}
```

`examples/express-api/src/server.ts`:

```ts
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

  const send = (res: express.Response, out: IntelResult): void => {
    res.status(out.status).json(out.body);
  };

  app.get("/", (_req, res) => {
    res.json({
      name: "Stellar Intel — express-api",
      network: "stellar:testnet",
      routes: {
        "GET /summary/:code/:issuer": { price: "free", what: "asset teaser: supply, holders, flags" },
        "GET /report/:code/:issuer": { price: PRICES.report, scheme: "x402", what: "full asset report + live order-book" },
        "GET /deep-dive/:account": { price: PRICES.deepDive, scheme: "mpp-charge", what: "balances, flags, recent payments" },
      },
      hint: "curl a paid route to receive a 402 challenge; pay it with @stellarpay-sdk/client.",
    });
  });
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/summary/:code/:issuer", async (req, res) => send(res, await fetchAssetSummary(req.params.code, req.params.issuer)));
  app.get("/report/:code/:issuer", async (req, res) => send(res, await fetchAssetReport(req.params.code, req.params.issuer)));
  app.get("/deep-dive/:account", async (req, res) => send(res, await fetchAccountDeepDive(req.params.account)));
  return app;
}
```

`examples/express-api/src/main.ts`:

```ts
import { readEnv } from "./env.js";
import { buildApp } from "./server.js";

const env = readEnv();
buildApp(env).listen(env.port, () => {
  console.log(`stellarpay express-api (Stellar Intel) listening on :${env.port}`);
});
```

- [ ] **Step 7: Verify locally**

Run: `pnpm --filter @stellarpay-examples/express-api test && pnpm --filter @stellarpay-examples/express-api typecheck && pnpm test`
Then boot it against the real testnet config from the repo `.env` values (map `SMOKE_PAYTO→DEMO_PAYTO`, `SMOKE_MPP_SECRET→DEMO_MPP_SECRET` in `examples/express-api/.env` — never commit it):

```bash
cd examples/express-api && pnpm start &
sleep 2
curl -s localhost:4601/ | head -c 300; echo
curl -s -o /dev/null -w '%{http_code}\n' localhost:4601/report/USDC/GANYISSUER    # expect 402
curl -s -D - -o /dev/null localhost:4601/report/USDC/GANYISSUER | grep -i payment-required | head -c 80; echo  # challenge header present
kill %1
```

- [ ] **Step 8: README + module doc + commit**

`examples/express-api/README.md`: what it sells, route/price table, env vars, `pnpm dev`, "pay it with `@stellarpay-sdk/client`" snippet using `createPayingFetch`. Update `docs/modules/examples.md`.

```bash
git add examples/express-api docs/modules/examples.md pnpm-lock.yaml
git commit -m "feat(examples): express-api flagship — x402 report + sponsored mpp deep-dive"
```

---

### Task 5: hono-api — whale alerts + the 6-line-diff README

**Files:**
- Create: `examples/hono-api/{package.json,tsconfig.json,vitest.config.ts,.env.example,README.md}`
- Create: `examples/hono-api/src/{env,reportReceipt,whales,server,main}.ts`
- Create: `examples/hono-api/test/whales.test.ts`
- Modify: `docs/modules/examples.md`

**Interfaces:**
- Consumes: `stellarpayHono` (`packages/hono/src/index.ts:5`, mount pattern `app.use("*", ...)` per `scripts/smoke.ts:277`), dashboard ingest contract.
- Produces (HTTP, consumed by agent): free `GET /`, `GET /healthz`; paid `GET /alerts/whales` (x402 $0.01, exact route key).

- [ ] **Step 1: Scaffold**

`package.json` — same shape as Task 4's with `"name": "@stellarpay-examples/hono-api"` and dependencies `{ "@stellarpay-sdk/core": "workspace:*", "@stellarpay-sdk/hono": "workspace:*", "@hono/node-server": "^2.0.12", "hono": "^4", "tsx": "^4.19.0" }` (devDependencies as Task 2, no `@types/express`). `tsconfig.json`/`vitest.config.ts` as Task 2. `.env.example`:

```
DEMO_PAYTO=G...
# Free: curl https://channels.openzeppelin.com/testnet/gen
DEMO_FACILITATOR_KEY=
DASHBOARD_URL=
INGEST_SECRET=
PORT=4602
```

Copy `src/reportReceipt.ts` verbatim from Task 4. `src/env.ts`: same pattern as Task 4's with required vars `["DEMO_PAYTO"]`, fields `payTo`, `facilitatorKey`, `dashboardUrl`, `ingestSecret`, `port` (default 4602). Run `pnpm install`.

- [ ] **Step 2: Failing whale-extraction test**

`examples/hono-api/test/whales.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractWhales } from "../src/whales.js";

const pay = (amount: string, extra: Record<string, unknown> = {}) => ({
  type: "payment",
  asset_type: "native",
  amount,
  from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFROM",
  to: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATO",
  created_at: "2026-08-03T00:00:00Z",
  transaction_hash: "deadbeef",
  ...extra,
});

describe("extractWhales", () => {
  it("keeps only native payments at/above the threshold, sorted desc, capped", () => {
    const records = [pay("50"), pay("99999"), pay("20000"), pay("70000"), { type: "create_account" }, pay("30000", { asset_type: "credit_alphanum4" })];
    const whales = extractWhales(records, 10_000, 2);
    expect(whales.map((w) => w.amountXlm)).toEqual(["99999", "70000"]);
    expect(whales[0]).toMatchObject({
      asset: "XLM",
      tx: "deadbeef",
      link: "https://stellar.expert/explorer/testnet/tx/deadbeef",
    });
  });

  it("survives malformed records", () => {
    expect(extractWhales([null, 42, {}, { type: "payment" }], 1, 5)).toEqual([]);
  });
});
```

Run: `pnpm --filter @stellarpay-examples/hono-api test` — Expected: FAIL.

- [ ] **Step 3: Implement whales + server**

`examples/hono-api/src/whales.ts`:

```ts
/** One large native payment, ready to render. */
export type Whale = { amountXlm: string; from: string; to: string; asset: "XLM"; at: string; tx: string; link: string };

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Filters Horizon payment-operation records down to big native payments. Pure — tested directly. */
export function extractWhales(records: unknown[], minXlm: number, limit: number): Whale[] {
  const out: Whale[] = [];
  for (const raw of records) {
    const rec = asRec(raw);
    if (rec["type"] !== "payment" || rec["asset_type"] !== "native") continue;
    const amount = str(rec["amount"]);
    const from = str(rec["from"]);
    const to = str(rec["to"]);
    const at = str(rec["created_at"]);
    const tx = str(rec["transaction_hash"]);
    if (!amount || !from || !to || !at || !tx) continue;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < minXlm) continue;
    out.push({ amountXlm: amount, from, to, asset: "XLM", at, tx, link: `https://stellar.expert/explorer/testnet/tx/${tx}` });
  }
  return out.sort((a, b) => Number(b.amountXlm) - Number(a.amountXlm)).slice(0, limit);
}

const HORIZON = "https://horizon-testnet.stellar.org";

/** Scans the most recent 200 payment operations for whales (live testnet data). */
export async function fetchWhales(f: typeof fetch = fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await f(`${HORIZON}/payments?order=desc&limit=200`);
  if (!res.ok) return { status: 502, body: { error: "horizon_unavailable" } };
  const data = asRec(await res.json());
  const records = asRec(data["_embedded"])["records"];
  const whales = extractWhales(Array.isArray(records) ? records : [], 10_000, 10);
  return { status: 200, body: { thresholdXlm: 10_000, count: whales.length, whales, source: "horizon-testnet, live" } };
}
```

`examples/hono-api/src/server.ts`:

```ts
import { Hono } from "hono";
import { stellarpayHono } from "@stellarpay-sdk/hono";
import type { StellarpayConfig } from "@stellarpay-sdk/core";
import { fetchWhales } from "./whales.js";
import { createReceiptReporter } from "./reportReceipt.js";
import type { Env } from "./env.js";

export function buildApp(env: Env): Hono {
  const report = createReceiptReporter({ service: "hono-api", dashboardUrl: env.dashboardUrl, ingestSecret: env.ingestSecret });

  const config: StellarpayConfig = {
    network: "stellar:testnet",
    payTo: env.payTo,
    ...(env.facilitatorKey ? { facilitatorApiKey: env.facilitatorKey } : {}),
    routes: { "GET /alerts/whales": { price: "$0.01", description: "Whale alerts (x402)" } },
    onPayment: (receipt) => report({ kind: "receipt", receipt: receipt as unknown as Record<string, unknown> }),
  };

  const app = new Hono();
  app.use("*", stellarpayHono(config));
  app.get("/", (c) =>
    c.json({
      name: "Stellar Intel — hono-api",
      routes: { "GET /alerts/whales": { price: "$0.01", scheme: "x402", what: "10 largest recent native payments on testnet" } },
      diff: "this whole paywall is a 6-line diff — see the README",
    }),
  );
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/alerts/whales", async (c) => {
    const out = await fetchWhales();
    return c.json(out.body, out.status as 200 | 502);
  });
  return app;
}
```

`examples/hono-api/src/main.ts`: same pattern as the dashboard's — `readEnv()`, `serve({ fetch: buildApp(env).fetch, port: env.port }, ...)` with a listening log line.

- [ ] **Step 4: Tests + typecheck pass, verify locally**

Run: `pnpm --filter @stellarpay-examples/hono-api test && pnpm --filter @stellarpay-examples/hono-api typecheck`
Boot with a local `.env` and confirm: `curl -s localhost:4602/` (index), `curl -s -o /dev/null -w '%{http_code}\n' localhost:4602/alerts/whales` → `402`.

- [ ] **Step 5: The 6-line-diff README**

`examples/hono-api/README.md` must center this diff (the judging criterion — "paywall added in minutes"), matching the real `server.ts`:

````markdown
# hono-api — whale alerts, paywalled in a 6-line diff

The entire difference between this API being open and being paid:

```diff
 import { Hono } from "hono";
+import { stellarpayHono } from "@stellarpay-sdk/hono";

 const app = new Hono();
+app.use("*", stellarpayHono({
+  network: "stellar:testnet",
+  payTo: process.env.DEMO_PAYTO!,
+  facilitatorApiKey: process.env.DEMO_FACILITATOR_KEY,
+  routes: { "GET /alerts/whales": { price: "$0.01" } },
+}));
 app.get("/alerts/whales", async (c) => c.json(await whales()));
```

No accounts, no API keys for your users, no billing integration: agents pay
per request over the x402 protocol and settlement lands on Stellar testnet.
````

plus the usual sections (routes/prices, env vars, `pnpm dev`).

- [ ] **Step 6: Module doc + commit**

```bash
git add examples/hono-api docs/modules/examples.md pnpm-lock.yaml
git commit -m "feat(examples): hono-api whale alerts — the 6-line-diff paywall proof"
```

---

### Task 6: fastify-api — fee & network stats

**Files:**
- Create: `examples/fastify-api/{package.json,tsconfig.json,.env.example,README.md}`
- Create: `examples/fastify-api/src/{env,reportReceipt,fees,server,main}.ts`
- Modify: `docs/modules/examples.md`

**Interfaces:**
- Consumes: `stellarpayFastify` — an async plugin registered via `await app.register(stellarpayFastify, { config })` BEFORE declaring routes (`packages/fastify/src/index.ts:53`, usage per `packages/fastify/test`).
- Produces (HTTP, consumed by agent): free `GET /`, `GET /healthz`; paid `GET /stats/fees` (mpp-charge $0.005, exact key).

No test suite: this service owns no logic beyond a single guarded Horizon mapping (spec §9 names fastify-api as the no-owned-logic example); the copied `reportReceipt` is already covered by Task 4's tests.

- [ ] **Step 1: Scaffold + implement**

`package.json`: name `@stellarpay-examples/fastify-api`, dependencies `{ "@stellarpay-sdk/core": "workspace:*", "@stellarpay-sdk/fastify": "workspace:*", "fastify": "^4", "tsx": "^4.19.0" }`, scripts as Task 4 minus `test`. `tsconfig.json` as Task 2 (include `["src"]`). `.env.example`:

```
DEMO_PAYTO=G...
DEMO_MPP_SECRET=change-me
DASHBOARD_URL=
INGEST_SECRET=
PORT=4603
```

`src/reportReceipt.ts`: copy from Task 4. `src/env.ts`: Task 4 pattern, required `["DEMO_PAYTO", "DEMO_MPP_SECRET"]`, fields `payTo`, `mppSecret`, `dashboardUrl`, `ingestSecret`, `port` (default 4603).

`src/fees.ts`:

```ts
const HORIZON = "https://horizon-testnet.stellar.org";
type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});

/** Live /fee_stats read with a human congestion verdict. */
export async function fetchFeeStats(f: typeof fetch = fetch): Promise<{ status: number; body: Rec }> {
  const res = await f(`${HORIZON}/fee_stats`);
  if (!res.ok) return { status: 502, body: { error: "horizon_unavailable" } };
  const data = asRec(await res.json());
  const usage = Number(data["ledger_capacity_usage"]);
  const congestion = !Number.isFinite(usage) ? "unknown" : usage < 0.5 ? "low" : usage < 0.8 ? "moderate" : "high";
  return {
    status: 200,
    body: {
      lastLedger: data["last_ledger"] ?? null,
      ledgerCapacityUsage: data["ledger_capacity_usage"] ?? null,
      congestion,
      feeCharged: asRec(data["fee_charged"]),
      maxFee: asRec(data["max_fee"]),
      source: "horizon-testnet, live",
    },
  };
}
```

`src/server.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { stellarpayFastify } from "@stellarpay-sdk/fastify";
import type { StellarpayConfig } from "@stellarpay-sdk/core";
import { fetchFeeStats } from "./fees.js";
import { createReceiptReporter } from "./reportReceipt.js";
import type { Env } from "./env.js";

export async function buildApp(env: Env): Promise<FastifyInstance> {
  const report = createReceiptReporter({ service: "fastify-api", dashboardUrl: env.dashboardUrl, ingestSecret: env.ingestSecret });

  const config: StellarpayConfig = {
    network: "stellar:testnet",
    payTo: env.payTo,
    mppSecretKey: env.mppSecret,
    routes: { "GET /stats/fees": { price: "$0.005", scheme: "mpp-charge", description: "Fee & congestion stats (MPP)" } },
    onPayment: (receipt) => report({ kind: "receipt", receipt: receipt as unknown as Record<string, unknown> }),
  };

  const app = Fastify();
  await app.register(stellarpayFastify, { config }); // must precede route declarations (adapter contract)
  app.get("/", async () => ({
    name: "Stellar Intel — fastify-api",
    routes: { "GET /stats/fees": { price: "$0.005", scheme: "mpp-charge", what: "live fee stats + congestion verdict" } },
  }));
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/stats/fees", async (_req, reply) => {
    const out = await fetchFeeStats();
    return reply.status(out.status).send(out.body);
  });
  return app;
}
```

`src/main.ts`:

```ts
import { readEnv } from "./env.js";
import { buildApp } from "./server.js";

const env = readEnv();
const app = await buildApp(env);
await app.listen({ port: env.port, host: "0.0.0.0" }); // 0.0.0.0: Railway routes to the container IP
console.log(`stellarpay fastify-api (Stellar Intel) listening on :${env.port}`);
```

- [ ] **Step 2: Verify**

Run: `pnpm install && pnpm --filter @stellarpay-examples/fastify-api typecheck && pnpm test`
Boot locally, then: `curl -s localhost:4603/` and `curl -s -o /dev/null -w '%{http_code}\n' localhost:4603/stats/fees` → `402`.

- [ ] **Step 3: README + module doc + commit**

```bash
git add examples/fastify-api docs/modules/examples.md pnpm-lock.yaml
git commit -m "feat(examples): fastify-api fee stats — minimal third-framework demo"
```

---

### Task 7: mcp-server — "Stellar Intel MCP"

**Files:**
- Create: `examples/mcp-server/{package.json,tsconfig.json,.env.example,README.md}`
- Create: `examples/mcp-server/src/{env,reportReceipt,intel,mcp,main}.ts`
- Modify: `docs/modules/examples.md`

**Interfaces:**
- Consumes: `toolPayments` (`packages/mcp/src/server.ts:88` — `guard(toolName, handler)` wraps `(args, extra)` handlers; unpaid calls throw the MPP McpError −32042), `McpServer.registerTool` (`packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:150`), `StreamableHTTPServerTransport` stateless mode (`.../server/streamableHttp.d.ts:38,58,107` — `sessionIdGenerator: undefined`, `handleRequest(req, res, body)`).
- Produces (MCP over `POST /mcp`, consumed by agent): free tool `network_status`; paid tools `account_summary` ($0.01), `asset_stats` ($0.01), `whale_watch` ($0.02). Plus `GET /` JSON index and `GET /healthz`.

**Critical invariant:** the `toolPayments(...)` instance is created ONCE at module scope — its in-memory replay store must survive across requests; only the `McpServer`/transport pair is per-request (stateless streamable HTTP pattern).

- [ ] **Step 1: Scaffold**

`package.json`: name `@stellarpay-examples/mcp-server`, dependencies `{ "@modelcontextprotocol/sdk": "^1.30.0", "@stellarpay-sdk/mcp": "workspace:*", "express": "^4", "tsx": "^4.19.0", "zod": "^4" }`, devDependencies add `@types/express`. Scripts as Task 4 minus `test` (this service's logic is thin Horizon mappings + SDK wiring already covered by `packages/mcp` tests; the live paid-call path is exercised in Tasks 8 and 13). `tsconfig.json` as Task 6. `.env.example`:

```
DEMO_PAYTO=G...
DEMO_MPP_SECRET=change-me
DASHBOARD_URL=
INGEST_SECRET=
PORT=4604
```

`src/reportReceipt.ts`: copy from Task 4. `src/env.ts`: Task 6's exact pattern (same vars, port default 4604).

- [ ] **Step 2: Intel helpers**

`examples/mcp-server/src/intel.ts` — reuse the shapes already written and tested in Tasks 4–5 (asset stats mirrors `fetchAssetSummary`; whale scan mirrors `fetchWhales`; account summary is a single `/accounts/{id}` read):

```ts
const HORIZON = "https://horizon-testnet.stellar.org";
type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

async function horizonJson(url: string, f: typeof fetch): Promise<Rec | undefined> {
  const res = await f(url);
  if (!res.ok) return undefined;
  return asRec(await res.json());
}

export async function networkStatus(f: typeof fetch = fetch): Promise<Rec> {
  const [root, fees] = await Promise.all([horizonJson(`${HORIZON}/`, f), horizonJson(`${HORIZON}/fee_stats`, f)]);
  return {
    network: "stellar:testnet",
    horizonVersion: root?.["horizon_version"] ?? null,
    latestLedger: root?.["history_latest_ledger"] ?? null,
    ledgerCapacityUsage: fees?.["ledger_capacity_usage"] ?? null,
    source: "horizon-testnet, live",
  };
}

export async function accountSummary(account: string, f: typeof fetch = fetch): Promise<Rec> {
  const acct = await horizonJson(`${HORIZON}/accounts/${encodeURIComponent(account)}`, f);
  if (!acct) return { error: "account_not_found_or_horizon_unavailable", account };
  return {
    account,
    balances: Array.isArray(acct["balances"]) ? acct["balances"] : [],
    subentries: acct["subentry_count"] ?? null,
    flags: asRec(acct["flags"]),
    source: "horizon-testnet, live",
  };
}

export async function assetStats(code: string, issuer: string, f: typeof fetch = fetch): Promise<Rec> {
  const data = await horizonJson(`${HORIZON}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`, f);
  const records = asRec(data?.["_embedded"])["records"];
  const rec = Array.isArray(records) && records.length > 0 ? asRec(records[0]) : undefined;
  if (!rec) return { error: "asset_not_found", code, issuer };
  return { code, issuer, supply: str(rec["amount"]) ?? "—", holders: rec["num_accounts"] ?? null, flags: asRec(rec["flags"]), source: "horizon-testnet, live" };
}

export async function whaleWatch(f: typeof fetch = fetch): Promise<Rec> {
  const data = await horizonJson(`${HORIZON}/payments?order=desc&limit=200`, f);
  const records = asRec(data?.["_embedded"])["records"];
  const whales = (Array.isArray(records) ? records : [])
    .map(asRec)
    .filter((r) => r["type"] === "payment" && r["asset_type"] === "native" && Number(str(r["amount"])) >= 10_000)
    .map((r) => ({
      amountXlm: str(r["amount"]),
      from: str(r["from"]),
      to: str(r["to"]),
      at: str(r["created_at"]),
      link: `https://stellar.expert/explorer/testnet/tx/${str(r["transaction_hash"]) ?? ""}`,
    }))
    .slice(0, 10);
  return { thresholdXlm: 10_000, count: whales.length, whales, source: "horizon-testnet, live" };
}
```

- [ ] **Step 3: MCP wiring**

`examples/mcp-server/src/mcp.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolPayments } from "@stellarpay-sdk/mcp";
import { z } from "zod";
import { accountSummary, assetStats, networkStatus, whaleWatch } from "./intel.js";
import type { IngestEvent } from "./reportReceipt.js";
import type { Env } from "./env.js";

export const PRICES = { account_summary: "$0.01", asset_stats: "$0.01", whale_watch: "$0.02" } as const;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/**
 * The payments guard is built ONCE per process — its in-memory replay store must span
 * requests. Only McpServer instances are per-request (stateless streamable HTTP).
 */
export function buildPayments(env: Env, report: (e: IngestEvent) => void) {
  return toolPayments({
    payTo: env.payTo,
    network: "stellar:testnet",
    mppSecretKey: env.mppSecret,
    prices: PRICES,
    onPayment: (r) =>
      report({
        kind: "receipt",
        // Adapt ToolPaymentReceipt → the dashboard's loose receipt rendering (route/scheme/amount/asset).
        receipt: { route: r.tool, scheme: "mpp-charge", amount: r.amount, asset: "USDC", timestamp: r.timestamp, ...(r.raw ? { raw: r.raw } : {}) },
      }),
  });
}

export function buildMcpServer(payments: ReturnType<typeof buildPayments>): McpServer {
  const server = new McpServer({ name: "stellar-intel", version: "0.1.0" });

  server.registerTool(
    "network_status",
    { description: "Live Stellar testnet status: latest ledger, fee pressure. FREE." },
    async () => text(await networkStatus()),
  );
  server.registerTool(
    "account_summary",
    {
      description: `Balances, flags and subentries for a Stellar account. Paid: ${PRICES.account_summary} (MPP).`,
      inputSchema: { account: z.string().describe("Stellar account id (G...)") },
    },
    payments.guard("account_summary", async ({ account }: { account: string }) => text(await accountSummary(account))),
  );
  server.registerTool(
    "asset_stats",
    {
      description: `Supply, holders and flags for an issued asset. Paid: ${PRICES.asset_stats} (MPP).`,
      inputSchema: { code: z.string(), issuer: z.string().describe("Issuer account id (G...)") },
    },
    payments.guard("asset_stats", async ({ code, issuer }: { code: string; issuer: string }) => text(await assetStats(code, issuer))),
  );
  server.registerTool(
    "whale_watch",
    { description: `The 10 largest recent native payments on testnet. Paid: ${PRICES.whale_watch} (MPP).` },
    payments.guard("whale_watch", async () => text(await whaleWatch())),
  );
  return server;
}
```

`examples/mcp-server/src/main.ts`:

```ts
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { readEnv } from "./env.js";
import { createReceiptReporter } from "./reportReceipt.js";
import { buildMcpServer, buildPayments, PRICES } from "./mcp.js";

const env = readEnv();
const report = createReceiptReporter({ service: "mcp-server", dashboardUrl: env.dashboardUrl, ingestSecret: env.ingestSecret });
const payments = buildPayments(env, report); // once per process — replay store must persist

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "Stellar Intel MCP",
    endpoint: "POST /mcp (MCP streamable HTTP)",
    tools: { network_status: "free", ...PRICES },
    hint: "connect with any MCP client; pay tool charges with @stellarpay-sdk/client + @stellarpay-sdk/mcp.",
  });
});
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// Stateless streamable HTTP: fresh server+transport per request, torn down on close —
// the documented sessionless pattern (@modelcontextprotocol/sdk streamableHttp.d.ts:36-44).
app.post("/mcp", async (req, res) => {
  const server = buildMcpServer(payments);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(env.port, () => {
  console.log(`stellarpay mcp-server (Stellar Intel MCP) listening on :${env.port}`);
});
```

- [ ] **Step 4: Verify**

Run: `pnpm install && pnpm --filter @stellarpay-examples/mcp-server typecheck && pnpm test`
Boot locally with a `.env`, then verify the MCP handshake + free/paid split with curl (initialize → list → free call → paid call unpaid ⇒ −32042):

```bash
curl -s localhost:4604/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
# tools/list must show all four tools; tools/call network_status must return live data;
# tools/call account_summary (no credential) must return an error with code -32042.
```

- [ ] **Step 5: README + module doc + commit**

README: tool table with prices, "connect from Claude/MCP clients" note, the free/paid coexistence point.

```bash
git add examples/mcp-server docs/modules/examples.md pnpm-lock.yaml
git commit -m "feat(examples): Stellar Intel MCP server — free + per-tool paid intel"
```

---

### Task 8: agent — the autonomous buyer

**Files:**
- Create: `examples/agent/{package.json,tsconfig.json,vitest.config.ts,.env.example,README.md}`
- Create: `examples/agent/src/{env,reportReceipt,narrate,economy,claude,run,server,main}.ts` (the scripted tour lives in `economy.ts`; there is no separate `scripted.ts`)
- Create: `examples/agent/test/run.test.ts`
- Modify: `docs/modules/examples.md`

**Interfaces:**
- Consumes: `createPayingFetch` + `SpendLimitExceeded` + `PayEvent` (`packages/client/src/index.ts:100`, `limits.ts:5`, `events.ts:2-7` — events carry type/protocol/url, NO amounts: narration counts `paid` events, it does not sum dollars), `wrapPaidMcpClient`/`payingHttpTransport` (`packages/mcp/src/client.ts:36,55`), `Client` from `@modelcontextprotocol/sdk/client/index.js`, the four demo services' HTTP/MCP surfaces (Tasks 4–7), dashboard ingest contract (`agent-log` events).
- Produces: `POST /run` (Bearer `INGEST_SECRET`; `202` started / `409` already running / `401`), `GET /healthz`. Boot-time run after 5 s (spec §4.6).

- [ ] **Step 1: Scaffold + verify the Anthropic SDK surface**

`package.json`: name `@stellarpay-examples/agent`, dependencies `{ "@anthropic-ai/sdk": "^0.57.0", "@hono/node-server": "^2.0.12", "@modelcontextprotocol/sdk": "^1.30.0", "@stellarpay-sdk/client": "workspace:*", "@stellarpay-sdk/core": "workspace:*", "@stellarpay-sdk/mcp": "workspace:*", "@stellar/stellar-sdk": "16.2.0", "hono": "^4", "tsx": "^4.19.0" }`, devDependencies as Task 2. `tsconfig.json`/`vitest.config.ts` as Task 2. Run `pnpm install`.

**Then verify against the installed `.d.ts` before writing `claude.ts`** (Global Constraints): open `examples/agent/node_modules/@anthropic-ai/sdk/` and confirm: the default-export client class and constructor option `apiKey`; `client.messages.create({ model, max_tokens, system, messages, tools })`; content block types `"text"`/`"tool_use"` and `stop_reason === "tool_use"`; the `tool_result` user-message shape. If any name differs from the code below, adapt the code to the installed reality (never the reverse) and note it in the task report. If `^0.57.0` does not resolve, install the current latest and pin what got installed.

`.env.example`:

```
# Funded buyer account (S...). Signs real testnet payments — never commit or print.
DEMO_BUYER_SECRET=S...
# Anthropic API key for the Claude-driven mission path. On failure the scripted tour runs instead.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
# Where to buy (public base URLs, no trailing slash).
EXPRESS_API_URL=http://localhost:4601
HONO_API_URL=http://localhost:4602
FASTIFY_API_URL=http://localhost:4603
MCP_SERVER_URL=http://localhost:4604
# Dashboard narration + run authorization.
DASHBOARD_URL=http://localhost:4600
INGEST_SECRET=change-me
PORT=4605
```

`src/env.ts`: Task 4 pattern; required `["DEMO_BUYER_SECRET", "INGEST_SECRET", "EXPRESS_API_URL", "HONO_API_URL", "FASTIFY_API_URL", "MCP_SERVER_URL"]`; optional `anthropicApiKey`, `anthropicModel` (default `"claude-sonnet-5"`), `dashboardUrl`, port default 4605.

- [ ] **Step 2: Failing orchestration tests**

`examples/agent/test/run.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runMission } from "../src/run.js";

const deps = (overrides: Partial<Parameters<typeof runMission>[0]>) => ({
  mission: "test mission",
  narrate: vi.fn(),
  runClaude: vi.fn().mockResolvedValue(undefined),
  runScripted: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("runMission", () => {
  it("uses the Claude path when it succeeds and never runs the scripted tour", async () => {
    const d = deps({});
    expect(await runMission(d)).toEqual({ mode: "claude" });
    expect(d.runScripted).not.toHaveBeenCalled();
  });

  it("falls back to the scripted tour when the Claude path throws", async () => {
    const d = deps({ runClaude: vi.fn().mockRejectedValue(new Error("api down")) });
    expect(await runMission(d)).toEqual({ mode: "scripted" });
    expect(d.runScripted).toHaveBeenCalledOnce();
    const lines = (d.narrate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("scripted"))).toBe(true);
  });

  it("skips Claude entirely when no runner is provided (no API key)", async () => {
    const d = deps({ runClaude: undefined });
    expect(await runMission(d)).toEqual({ mode: "scripted" });
  });

  it("surfaces a scripted-tour failure as a narrated error, not a crash", async () => {
    const d = deps({ runClaude: undefined, runScripted: vi.fn().mockRejectedValue(new Error("all down")) });
    expect(await runMission(d)).toEqual({ mode: "scripted" });
    const lines = (d.narrate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.toLowerCase().includes("failed"))).toBe(true);
  });
});
```

Run: `pnpm --filter @stellarpay-examples/agent test` — Expected: FAIL.

- [ ] **Step 3: Implement narration, economy, runners**

`src/narrate.ts`:

```ts
import { createReceiptReporter } from "./reportReceipt.js"; // copied from Task 4 in this step

export type Narrator = (message: string) => void;

/** Posts agent narration to the dashboard feed and mirrors it to stdout. */
export function createNarrator(opts: { dashboardUrl: string | undefined; ingestSecret: string | undefined }): Narrator {
  const report = createReceiptReporter({ service: "agent", dashboardUrl: opts.dashboardUrl, ingestSecret: opts.ingestSecret });
  return (message) => {
    console.log(`[agent] ${message}`);
    report({ kind: "agent-log", message });
  };
}
```

(Also copy `src/reportReceipt.ts` from Task 4 in this step.)

`src/economy.ts`:

```ts
import type { Narrator } from "./narrate.js";

/** One thing the agent can buy. `buy` returns the (parsed) intel for the Claude loop to read. */
export type Buyable = { name: string; description: string; buy: () => Promise<unknown> };

type Urls = { express: string; hono: string; fastify: string };

async function paidJson(payingFetch: typeof fetch, url: string): Promise<unknown> {
  const res = await payingFetch(url);
  const body: unknown = await res.json().catch(() => ({ error: "non-json response" }));
  if (!res.ok) throw new Error(`paid GET ${url} → ${res.status}`);
  return body;
}

/**
 * Discovers a live USDC issuer on testnet from Horizon (free) so the asset-report buy
 * never depends on a hardcoded issuer address.
 */
export async function discoverUsdcIssuer(rawFetch: typeof fetch = fetch): Promise<string> {
  const res = await rawFetch("https://horizon-testnet.stellar.org/assets?asset_code=USDC&limit=1");
  if (!res.ok) throw new Error("could not discover a USDC issuer from Horizon");
  const data = (await res.json()) as { _embedded?: { records?: Array<{ asset_issuer?: string }> } };
  const issuer = data._embedded?.records?.[0]?.asset_issuer;
  if (!issuer) throw new Error("no USDC asset found on testnet Horizon");
  return issuer;
}

export function buildEconomy(deps: {
  payingFetch: typeof fetch;
  rawFetch?: typeof fetch;
  urls: Urls;
  mcpCall: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  buyerPublicKey: string;
}): Buyable[] {
  const raw = deps.rawFetch ?? fetch;
  return [
    {
      name: "buy_asset_report",
      description: "Full USDC asset report incl. live order book, from express-api. Costs $0.02 (x402).",
      buy: async () => paidJson(deps.payingFetch, `${deps.urls.express}/report/USDC/${await discoverUsdcIssuer(raw)}`),
    },
    {
      name: "buy_account_deep_dive",
      description: "Deep-dive on my own wallet account, from express-api. Costs $0.02 (MPP, gas-sponsored).",
      buy: async () => paidJson(deps.payingFetch, `${deps.urls.express}/deep-dive/${deps.buyerPublicKey}`),
    },
    {
      name: "buy_whale_alerts",
      description: "The 10 largest recent native payments on testnet, from hono-api. Costs $0.01 (x402).",
      buy: async () => paidJson(deps.payingFetch, `${deps.urls.hono}/alerts/whales`),
    },
    {
      name: "buy_fee_stats",
      description: "Live fee & congestion stats, from fastify-api. Costs $0.005 (MPP).",
      buy: async () => paidJson(deps.payingFetch, `${deps.urls.fastify}/stats/fees`),
    },
    {
      name: "buy_mcp_account_summary",
      description: "MCP tool account_summary on my own wallet. Costs $0.01 (MPP over MCP).",
      buy: async () => deps.mcpCall("account_summary", { account: deps.buyerPublicKey }),
    },
    {
      name: "buy_mcp_whale_watch",
      description: "MCP tool whale_watch: biggest recent testnet payments. Costs $0.02 (MPP over MCP).",
      buy: async () => deps.mcpCall("whale_watch", {}),
    },
  ];
}

/** Deterministic tour: one buy per service + two MCP tools, narrated. Never throws per-item. */
export async function scriptedTour(economy: Buyable[], narrate: Narrator): Promise<void> {
  for (const item of economy) {
    narrate(`Buying: ${item.name} — ${item.description}`);
    try {
      await item.buy();
      narrate(`✔ ${item.name} delivered.`);
    } catch (err) {
      narrate(`✖ ${item.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

`src/scripted.ts` is not needed as a separate file — `scriptedTour` lives in `economy.ts` (keep the file list accurate: drop `src/scripted.ts`, its content is above).

`src/claude.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { Buyable } from "./economy.js";
import type { Narrator } from "./narrate.js";

const MAX_TURNS = 8;

/**
 * Mission-driven buying loop: Claude picks which intel to buy via tool use. Each Buyable
 * becomes a no-argument tool (the economy closes over its own parameters). Verified
 * against the installed @anthropic-ai/sdk .d.ts per this task's Step 1.
 */
export async function runClaudeMission(opts: {
  apiKey: string;
  model: string;
  mission: string;
  economy: Buyable[];
  narrate: Narrator;
}): Promise<void> {
  const anthropic = new Anthropic({ apiKey: opts.apiKey });
  const tools = opts.economy.map((b) => ({
    name: b.name,
    description: b.description,
    input_schema: { type: "object" as const, properties: {} },
  }));
  const byName = new Map(opts.economy.map((b) => [b.name, b]));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `${opts.mission}\n\nBuy only what the mission needs — every tool call spends real (testnet) money from your budget. When done, reply with a short plain-text brief of your findings.` },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system:
        "You are a autonomous market-intel buyer on the Stellar testnet with a funded wallet and hard spend limits. You pay per API/tool call via the x402 and MPP payment protocols (handled automatically).",
      messages,
      tools,
    });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const finalText = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(" ");
      opts.narrate(`Brief: ${finalText.slice(0, 400) || "(no text returned)"}`);
      return;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const buyable = byName.get(use.name);
      opts.narrate(`Claude buys: ${use.name}`);
      try {
        const bought = buyable ? await buyable.buy() : { error: "unknown tool" };
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(bought).slice(0, 4000) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.narrate(`Purchase refused/failed: ${message}`);
        results.push({ type: "tool_result", tool_use_id: use.id, content: `Purchase failed: ${message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  opts.narrate("Mission hit the turn limit — wrapping up.");
}
```

`src/run.ts`:

```ts
import type { Narrator } from "./narrate.js";

export type MissionResult = { mode: "claude" | "scripted" };

/**
 * One mission run. The judge's button must always produce visible payments (spec §4.6):
 * Claude-path failure of ANY kind degrades to the deterministic scripted tour, and a
 * scripted failure is narrated rather than thrown.
 */
export async function runMission(deps: {
  mission: string;
  narrate: Narrator;
  runClaude: (() => Promise<void>) | undefined;
  runScripted: () => Promise<void>;
}): Promise<MissionResult> {
  deps.narrate(`Mission: ${deps.mission}`);
  if (deps.runClaude) {
    try {
      await deps.runClaude();
      deps.narrate("Mission complete (mode: claude).");
      return { mode: "claude" };
    } catch (err) {
      deps.narrate(`Claude path failed (${err instanceof Error ? err.message : String(err)}) — running the scripted tour instead.`);
    }
  } else {
    deps.narrate("No ANTHROPIC_API_KEY configured — running the scripted tour.");
  }
  try {
    await deps.runScripted();
    deps.narrate("Mission complete (mode: scripted).");
  } catch (err) {
    deps.narrate(`Scripted tour failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { mode: "scripted" };
}

export const MISSIONS = [
  "Produce a market brief on USDC on Stellar testnet: supply, holders, market depth, and current network conditions.",
  "Assess my own wallet's position and the current whale activity on testnet — anything notable moving?",
  "How congested is the Stellar testnet right now, and what are the biggest payments flowing through it?",
] as const;
```

- [ ] **Step 4: Run orchestration tests — pass**

Run: `pnpm --filter @stellarpay-examples/agent test` — Expected: PASS.

- [ ] **Step 5: Wire the service**

`src/server.ts`:

```ts
import { Hono } from "hono";

/** Minimal run-trigger API. `startRun` returns false when a run is already in flight. */
export function buildApp(deps: { ingestSecret: string; startRun: () => boolean }): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.post("/run", (c) => {
    if (c.req.header("authorization") !== `Bearer ${deps.ingestSecret}`) return c.json({ error: "unauthorized" }, 401);
    if (!deps.startRun()) return c.json({ error: "run_in_progress" }, 409);
    return c.json({ status: "started" }, 202);
  });
  return app;
}
```

`src/main.ts`:

```ts
import { serve } from "@hono/node-server";
import { Keypair } from "@stellar/stellar-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createPayingFetch, type PayEvent } from "@stellarpay-sdk/client";
import { payingHttpTransport, wrapPaidMcpClient } from "@stellarpay-sdk/mcp";
import { NETWORKS } from "@stellarpay-sdk/core";
import { readEnv } from "./env.js";
import { createNarrator } from "./narrate.js";
import { buildEconomy, scriptedTour } from "./economy.js";
import { runClaudeMission } from "./claude.js";
import { MISSIONS, runMission } from "./run.js";
import { buildApp } from "./server.js";

const env = readEnv();
const narrate = createNarrator({ dashboardUrl: env.dashboardUrl, ingestSecret: env.ingestSecret });
const buyerPublicKey = Keypair.fromSecret(env.buyerSecret).publicKey();
const rpcUrl = NETWORKS["stellar:testnet"].rpcUrl;

const LIMITS = { maxPerCall: "$0.05", maxTotal: "$0.25" } as const; // per run — load-bearing demo copy (spec §4.6)

let running = false;
let missionCounter = 0;

async function oneRun(): Promise<void> {
  const mission = MISSIONS[missionCounter % MISSIONS.length] as string;
  missionCounter += 1;
  let paidCount = 0;
  // Fresh payingFetch per run: spend limits reset each mission (spec §4.6 "per run").
  const payingFetch = createPayingFetch({
    secret: env.buyerSecret,
    network: "stellar:testnet",
    rpcUrl,
    limits: LIMITS,
    onEvent: (e: PayEvent) => {
      if (e.type === "paid") {
        paidCount += 1;
        narrate(`Payment settled (${e.protocol}) — ${paidCount} paid calls this run.`);
      }
      if (e.type === "blocked") narrate(`Spend limit refused a payment (${e.reason}) — the guardrails work.`);
    },
  });

  // MCP client over the paying transport; JSON-RPC -32042 challenges paid via wrapPaidMcpClient.
  const mcpBase = new Client({ name: "stellarpay-agent", version: "0.1.0" });
  await mcpBase.connect(payingHttpTransport(`${env.mcpServerUrl}/mcp`, payingFetch));
  const mcp = wrapPaidMcpClient(mcpBase, { secret: env.buyerSecret, network: "stellar:testnet" });

  const economy = buildEconomy({
    payingFetch,
    urls: { express: env.expressApiUrl, hono: env.honoApiUrl, fastify: env.fastifyApiUrl },
    mcpCall: (name, args) => mcp.callTool({ name, arguments: args }),
    buyerPublicKey,
  });

  narrate(`Budget this run: ${LIMITS.maxPerCall}/call, ${LIMITS.maxTotal} total (testnet USDC).`);
  await runMission({
    mission,
    narrate,
    runClaude: env.anthropicApiKey
      ? () => runClaudeMission({ apiKey: env.anthropicApiKey as string, model: env.anthropicModel, mission, economy, narrate })
      : undefined,
    runScripted: () => scriptedTour(economy, narrate),
  });
  await mcpBase.close();
}

function startRun(): boolean {
  if (running) return false;
  running = true;
  void oneRun()
    .catch((err) => narrate(`Run crashed: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => {
      running = false;
    });
  return true;
}

serve({ fetch: buildApp({ ingestSecret: env.ingestSecret, startRun }).fetch, port: env.port }, (info) => {
  console.log(`stellarpay agent listening on :${info.port}`);
});

// Boot-time run so the feed is never empty when judges first open the dashboard (spec §4.6).
setTimeout(() => {
  startRun();
}, 5000);
```

(`src/env.ts` gains the camel-cased fields used above: `buyerSecret`, `anthropicApiKey`, `anthropicModel`, `expressApiUrl`, `honoApiUrl`, `fastifyApiUrl`, `mcpServerUrl`, `dashboardUrl`, `ingestSecret`, `port`. `Client.close()` and `Client.connect(transport)` are on the installed `@modelcontextprotocol/sdk/client/index.d.ts` — confirm while writing, same file as `callTool`.)

- [ ] **Step 6: Full local verification (the whole economy on localhost)**

Run: `pnpm --filter @stellarpay-examples/agent typecheck && pnpm test`
Then the full local rehearsal — every service in one shell, real testnet settlement (uses the funded `.env` values; skip `ANTHROPIC_API_KEY` to exercise the scripted path):

```bash
# terminal 1..5: dashboard, express-api, hono-api, fastify-api, mcp-server (pnpm dev, each with its .env)
# terminal 6:
cd examples/agent && pnpm start
# expect: boot run after 5s; narration lines + receipts appearing at http://localhost:4600
curl -s -X POST localhost:4605/run -H 'authorization: Bearer <INGEST_SECRET value>' -o /dev/null -w '%{http_code}\n'   # 202 (or 409 if boot run still in flight)
```

Confirm on the dashboard: agent-log lines interleaved with receipts from all four selling services, and stellar.expert links resolving.

- [ ] **Step 7: README + module doc + commit**

README: mission list, budget, fallback behavior, env vars; explicitly note the wallet signs real testnet transactions.

```bash
git add examples/agent docs/modules/examples.md pnpm-lock.yaml
git commit -m "feat(examples): autonomous buying agent — Claude-driven with scripted fallback"
```

---

### Task 9: `scripts/setup-demo.ts` — demo identity provisioning

**Files:**
- Create: `scripts/setup-demo.ts`
- Modify: root `package.json` (add script `"setup-demo": "tsx scripts/setup-demo.ts"`), `.env.example` (append `DEMO_USDC_ISSUER=` with comment), `docs/modules/examples.md`

**Interfaces:**
- Consumes: `submitViaChannels` (`packages/shared/src/channels.ts:22` — `{channelsUrl, apiKey, signedXdr, rpcUrl, maxPoolRetries?, networkPassphrase?} → Promise<hash>`), `USDC_SAC_TESTNET` from `@stellar/mpp`, `@stellar/stellar-sdk` `Keypair`/`TransactionBuilder`/`Operation.changeTrust`/`Asset`, the facilitator `/gen` endpoint (pattern: `scripts/smoke.ts:84-103`).

- [ ] **Step 1: Write the script**

`scripts/setup-demo.ts`:

```ts
/**
 * Idempotent demo-identity provisioning/verification (spec §6). Reads the same .env the
 * smoke test uses (SMOKE_* names — the demo services map them to DEMO_* at deploy time).
 * NEVER prints a secret: accounts are only ever referenced by public key.
 *
 * - Ensures buyer + payTo accounts exist (friendbot-funds missing ones).
 * - Reports XLM and USDC balances per account.
 * - If DEMO_USDC_ISSUER is set and the buyer lacks that trustline: builds a ChangeTrust,
 *   signs with the buyer, submits fee-free via OZ Channels (submitViaChannels).
 * - The USDC faucet step cannot be automated: a zero balance prints instructions instead.
 */
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { submitViaChannels } from "@stellarpay-sdk/shared";

try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

const HORIZON = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const CHANNELS_URL = "https://channels.openzeppelin.com/testnet";

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});

type AccountState = { exists: boolean; xlm: string; usdcLines: Array<{ issuer: string; balance: string }> };

async function loadAccount(pub: string): Promise<AccountState> {
  const res = await fetch(`${HORIZON}/accounts/${pub}`);
  if (res.status === 404) return { exists: false, xlm: "0", usdcLines: [] };
  if (!res.ok) throw new Error(`Horizon error ${res.status} for ${pub}`);
  const data = asRec(await res.json());
  const balances = Array.isArray(data["balances"]) ? data["balances"].map(asRec) : [];
  const native = balances.find((b) => b["asset_type"] === "native");
  const usdcLines = balances
    .filter((b) => b["asset_code"] === "USDC" && typeof b["asset_issuer"] === "string")
    .map((b) => ({ issuer: b["asset_issuer"] as string, balance: String(b["balance"] ?? "0") }));
  return { exists: true, xlm: String(native?.["balance"] ?? "0"), usdcLines };
}

async function friendbot(pub: string): Promise<void> {
  console.log(`  funding ${pub.slice(0, 6)}… via friendbot`);
  const res = await fetch(`https://friendbot.stellar.org?addr=${pub}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot failed (${res.status})`); // 400 = already funded
}

async function facilitatorKey(): Promise<string> {
  const fromEnv = process.env["SMOKE_FACILITATOR_KEY"] || process.env["DEMO_FACILITATOR_KEY"];
  if (fromEnv) return fromEnv;
  const res = await fetch(`${CHANNELS_URL}/gen`);
  if (!res.ok) throw new Error(`facilitator /gen failed (${res.status})`);
  const body = (await res.json()) as { apiKey?: string };
  if (!body.apiKey) throw new Error("facilitator /gen returned no apiKey");
  return body.apiKey;
}

async function establishTrustline(buyer: Keypair, issuer: string): Promise<void> {
  console.log(`  establishing USDC trustline (issuer ${issuer.slice(0, 6)}…) via OZ Channels`);
  const res = await fetch(`${HORIZON}/accounts/${buyer.publicKey()}`);
  const data = asRec(await res.json());
  const account = new Account(buyer.publicKey(), String(data["sequence"]));
  const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", issuer) }))
    .setTimeout(30) // Channels rejects longer timebounds (INVALID_TIME_BOUNDS)
    .build();
  tx.sign(buyer);
  const hash = await submitViaChannels({ channelsUrl: CHANNELS_URL, apiKey: await facilitatorKey(), signedXdr: tx.toXDR(), rpcUrl: RPC_URL });
  console.log(`  trustline established: https://stellar.expert/explorer/testnet/tx/${hash}`);
}

async function main(): Promise<void> {
  const buyerSecret = process.env["SMOKE_BUYER_SECRET"] || process.env["DEMO_BUYER_SECRET"];
  const payTo = process.env["SMOKE_PAYTO"] || process.env["DEMO_PAYTO"];
  if (!buyerSecret || !payTo) {
    console.error("Missing SMOKE_BUYER_SECRET/SMOKE_PAYTO (or DEMO_* equivalents) — copy .env.example to .env first.");
    process.exit(1);
  }
  const buyer = Keypair.fromSecret(buyerSecret);
  const rows: Array<{ name: string; pub: string; state: AccountState }> = [];

  for (const [name, pub] of [
    ["buyer", buyer.publicKey()],
    ["payTo", payTo],
  ] as const) {
    let state = await loadAccount(pub);
    if (!state.exists) {
      await friendbot(pub);
      state = await loadAccount(pub);
    }
    rows.push({ name, pub, state });
  }

  const buyerState = rows[0]!.state;
  const issuer = process.env["DEMO_USDC_ISSUER"];
  if (issuer && !buyerState.usdcLines.some((l) => l.issuer === issuer)) {
    await establishTrustline(buyer, issuer);
    rows[0]!.state = await loadAccount(buyer.publicKey());
  }

  console.log("\n=== demo identities ===");
  for (const { name, pub, state } of rows) {
    const usdc = state.usdcLines.map((l) => `${l.balance} USDC (${l.issuer.slice(0, 6)}…)`).join(", ") || "no USDC trustline";
    console.log(`  ${state.exists ? "✅" : "⚠️"} ${name.padEnd(6)} ${pub}  XLM: ${state.xlm}  ${usdc}`);
  }

  const funded = rows[0]!.state.usdcLines.some((l) => Number(l.balance) > 0);
  if (!funded) {
    console.log(`
⚠️  The buyer holds no testnet USDC — the paid demos need some. This step is manual (spec §6):
  1. If it lacks a trustline: set DEMO_USDC_ISSUER in .env to your chosen testnet USDC issuer
     and re-run this script (it will establish the trustline fee-free via OZ Channels).
  2. Mint/receive testnet USDC from that issuer's faucet flow.
  The SEP-41 contract the SDK settles against (USDC_SAC_TESTNET): ${USDC_SAC_TESTNET}
`);
  } else {
    console.log("\nAll set — run `pnpm smoke` for a full paid round-trip before demoing.");
  }
}

await main();
```

- [ ] **Step 2: Verify against the real testnet**

Run: `pnpm setup-demo`
Expected with the existing funded `.env`: two ✅ rows, buyer shows a positive USDC balance, "All set" closing line. Confirm no secret appears anywhere in the output.

- [ ] **Step 3: Append to `.env.example`, update module doc, commit**

Append to root `.env.example`:

```
# Optional: classic-asset issuer (G...) for the buyer's testnet USDC trustline.
# Only needed by `pnpm setup-demo` when provisioning a fresh buyer account.
DEMO_USDC_ISSUER=
```

```bash
git add scripts/setup-demo.ts package.json .env.example docs/modules/examples.md
git commit -m "feat(scripts): setup-demo — idempotent demo identity provisioning"
```

---

### Task 10: Cross-service integration test (receipt → ingest → SSE)

**Files:**
- Create: `examples/dashboard/test/integration.sse.test.ts`
- Modify: `docs/modules/examples.md`

**Interfaces:**
- Consumes: `buildApp` (Task 2), `createReceiptReporter` (Task 4 — imported across examples via a relative path; both are workspace-internal test subjects), `serve` on port 0 (`@hono/node-server` — the listen callback's `info.port` carries the ephemeral port, pattern `scripts/smoke.ts:229`).

This is the spec §9 "local integration" requirement: the demo-owned pipeline (forwarder → ingest auth → buffer → SSE) proven over real HTTP sockets. Settlement itself is deliberately out of scope — the SDK's own integration test (`packages/core/test/integration.x402-loop.test.ts`) covers the paid loop; re-mocking it here would test the SDK twice and the demos not at all. The full paid path over live testnet is Task 13.

- [ ] **Step 1: Write the test**

`examples/dashboard/test/integration.sse.test.ts`:

```ts
import { serve, type ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
// Cross-example import is deliberate: this test IS the integration point between the
// two demo-owned pieces (reporter and dashboard). Examples are private; no package
// boundary is being violated for consumers.
import { createReceiptReporter } from "../../express-api/src/reportReceipt.js";

const SECRET = "integration-secret";
let server: ServerType;
let baseUrl: string;

beforeAll(async () => {
  const app = buildApp({ ingestSecret: SECRET, html: "<h1>t</h1>" });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://localhost:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe("receipt → ingest → SSE, over real HTTP", () => {
  it("a reported receipt arrives on the event stream", async () => {
    const report = createReceiptReporter({ service: "express-api", dashboardUrl: baseUrl, ingestSecret: SECRET });
    report({ kind: "receipt", receipt: { scheme: "x402", route: "GET /report/*", amount: "0.02", asset: "USDC" } });

    // Wait for ingestion, then read the replayed buffer from a fresh SSE connection.
    await new Promise((r) => setTimeout(r, 300));
    const res = await fetch(`${baseUrl}/events`, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(3000) });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const frame = new TextDecoder().decode(value);
    const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
    expect(dataLine).toBeDefined();
    const event = JSON.parse((dataLine as string).slice(5)) as Record<string, unknown>;
    expect(event).toMatchObject({ service: "express-api", kind: "receipt" });
    expect((event["receipt"] as Record<string, unknown>)["amount"]).toBe("0.02");
    expect(typeof event["at"]).toBe("string");
  });

  it("an unauthorized reporter's receipt never reaches the stream", async () => {
    const report = createReceiptReporter({ service: "evil", dashboardUrl: baseUrl, ingestSecret: "wrong-secret" });
    report({ kind: "receipt", receipt: { amount: "999" } });
    await new Promise((r) => setTimeout(r, 300));
    const res = await fetch(`${baseUrl}/events`, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(3000) });
    const { value } = await res.body!.getReader().read();
    expect(new TextDecoder().decode(value)).not.toContain('"evil"');
  });
});
```

- [ ] **Step 2: Run to green, full suite, commit**

Run: `pnpm --filter @stellarpay-examples/dashboard test` — Expected: PASS (both tests).
Run: `pnpm test && pnpm typecheck` — Expected: everything green.

```bash
git add examples/dashboard/test/integration.sse.test.ts docs/modules/examples.md
git commit -m "test(examples): end-to-end receipt→ingest→SSE integration over real HTTP"
```

---

### Task 11: Railway — project + dashboard (CONTROLLER TASK)

> **Controller-executed.** Tasks 11–13 are NOT implementer-subagent tasks: they drive railway MCP tools against live infrastructure and include user pause points for secret entry. The session controller executes the steps directly and records outcomes in the ledger. Railway MCP tool schemas are loaded on demand via ToolSearch; if a listed tool's parameters differ from these steps, adapt to the real schema (the step names the intent).

**Railway service config used by every service (Tasks 11–12–13):**
- Source: GitHub `yripper/stellarpay`, branch `main`, NO root directory (shared-monorepo pattern).
- Build command: `pnpm run build` (builds `packages/*`; examples run from source via tsx).
- Start command: `pnpm --filter @stellarpay-examples/<name> start`.
- Every service must respect Railway's injected `PORT` (all mains already do).

- [ ] **Step 1: Create the project and the dashboard service**

Using railway MCP: `create_project` (name `stellarpay-demo`, default workspace) → `create_service` (name `dashboard`, source_repo `yripper/stellarpay`, branch `main`) → set build/start commands per the block above (`update_service` / `get_service_config` to confirm).

- [ ] **Step 2: Secrets and variables**

Generate a fresh ingest secret locally WITHOUT echoing it: `openssl rand -hex 32 | pbcopy` (value lands on the clipboard only). Then:
- `set_variables` on dashboard: `INGEST_SECRET` (paste), `PORT` is Railway-injected — do not set. `AGENT_URL` is set later (Task 13 Step 2).
- Append the same `INGEST_SECRET` value to the local `.env` (manually, by the user or via `pbpaste >> .env` editing — never through chat output).

- [ ] **Step 3: Domain + deploy + verify**

`generate_domain` for dashboard → note the URL (public, goes in the README later). `deploy` if not auto-triggered; watch `list_deployments`/`get_logs` until healthy. Verify: `curl -s https://<dashboard-domain>/healthz` → `{"ok":true}`; open the page once — MISSION CONTROL renders, button shows the "unavailable" path (no agent yet).

- [ ] **Step 4: Ledger entry**

Record in the SDD ledger: project id, dashboard domain, "INGEST_SECRET set (value in Railway + local .env only)". Commit nothing (no repo changes this task).

---

### Task 12: Railway — the four selling services (CONTROLLER TASK)

- [ ] **Step 1: Create services**

`create_service` ×4 from `yripper/stellarpay` branch `main`: `express-api`, `hono-api`, `fastify-api`, `mcp-server`, each with the Task 11 build/start-command block (`<name>` substituted).

- [ ] **Step 2: Variables (no real seeds through agent context)**

Auto-generate the two shared server-side secrets fresh (they are NOT the local smoke values — demo infra gets its own):
- `DEMO_MPP_SECRET`: `openssl rand -hex 32 | pbcopy` → `set_variables` via paste on express-api, fastify-api, mcp-server (same value everywhere — it's one seller identity).
- `DEMO_FACILITATOR_KEY`: `curl -s https://channels.openzeppelin.com/testnet/gen` piped straight to clipboard (`| python3 -c 'import sys,json;print(json.load(sys.stdin)["apiKey"],end="")' | pbcopy`) → set on express-api and hono-api.

Set via `set_variables` per service (public/non-secret values inline):
- All four: `DASHBOARD_URL=https://<dashboard-domain>`, `INGEST_SECRET` (paste from Task 11), `DEMO_PAYTO=<the G... public key from .env — public value>`.
- **USER PAUSE POINT:** ask the user to add `DEMO_SPONSOR_SECRET` on express-api via the Railway dashboard UI (optional — skipping just disables gas sponsorship on the deep-dive route; the route still works).

- [ ] **Step 3: Domains + verify each service**

`generate_domain` ×4, then for each:
- `curl -s https://<domain>/healthz` → `{"ok":true}` (`GET /` for mcp-server also returns its index).
- Free routes live: express `/summary/...` (use the USDC issuer discovered from Horizon), hono `/` index, fastify `/` index.
- Paid routes challenge: `curl -s -o /dev/null -w '%{http_code}' https://<express-domain>/report/USDC/<issuer>` → `402`; same for hono `/alerts/whales` and fastify `/stats/fees`. mcp-server: the Task 7 Step 4 curl sequence against `https://<mcp-domain>/mcp` — paid tool unpaid ⇒ `-32042`.

- [ ] **Step 4: Ledger entry**

Record all four domains + which vars are set where.

---

### Task 13: Railway — agent + live end-to-end (CONTROLLER TASK)

**Files:**
- Create: `scripts/verify-live.ts`
- Modify: root `package.json` (script `"verify-live": "tsx scripts/verify-live.ts"`), `docs/modules/examples.md`

- [ ] **Step 1: Deploy the agent service**

`create_service` (name `agent`, same repo/branch/commands, `<name>`=`agent`). `set_variables`: `EXPRESS_API_URL`/`HONO_API_URL`/`FASTIFY_API_URL`/`MCP_SERVER_URL`/`DASHBOARD_URL` (the Task 11–12 domains), `INGEST_SECRET` (paste), `ANTHROPIC_MODEL=claude-sonnet-5`.
**USER PAUSE POINT:** the user adds `DEMO_BUYER_SECRET` (the funded buyer seed) and `ANTHROPIC_API_KEY` via the Railway dashboard UI. Do not proceed until confirmed.

- [ ] **Step 2: Wire the button**

`set_variables` on dashboard: `AGENT_URL=https://<agent-domain>` (after `generate_domain` for the agent) → redeploy dashboard. Within ~10 s of the agent's boot deploy, its boot run should already be narrating — check the live feed.

- [ ] **Step 3: `scripts/verify-live.ts`**

```ts
/**
 * Live-deployment verification (spec §9): free routes, one real paid x402 call, and a
 * dashboard health read against the Railway domains. Uses the funded buyer from .env.
 * Run before declaring README links final, and again before judging.
 */
import { createPayingFetch } from "@stellarpay-sdk/client";
import { NETWORKS } from "@stellarpay-sdk/shared";

try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

const required = ["LIVE_DASHBOARD_URL", "LIVE_EXPRESS_URL", "LIVE_HONO_URL", "LIVE_FASTIFY_URL", "LIVE_MCP_URL"] as const;
const missing = required.filter((n) => !process.env[n]);
const buyerSecret = process.env["SMOKE_BUYER_SECRET"] || process.env["DEMO_BUYER_SECRET"];
if (missing.length > 0 || !buyerSecret) {
  console.error(`Missing env: ${[...missing, ...(buyerSecret ? [] : ["SMOKE_BUYER_SECRET"])].join(", ")} — add LIVE_* URLs to .env.`);
  process.exit(1);
}
const urls = Object.fromEntries(required.map((n) => [n, (process.env[n] as string).replace(/\/$/, "")])) as Record<(typeof required)[number], string>;

let failures = 0;
async function check(name: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    const ok = await fn();
    console.log(`  ${ok ? "✅" : "❌"} ${name}`);
    if (!ok) failures += 1;
  } catch (err) {
    console.log(`  ❌ ${name} — ${err instanceof Error ? err.message : String(err)}`);
    failures += 1;
  }
}

const status = async (url: string): Promise<number> => (await fetch(url, { signal: AbortSignal.timeout(10_000) })).status;

await check("dashboard /healthz", async () => (await status(`${urls.LIVE_DASHBOARD_URL}/healthz`)) === 200);
await check("express /healthz", async () => (await status(`${urls.LIVE_EXPRESS_URL}/healthz`)) === 200);
await check("hono /healthz", async () => (await status(`${urls.LIVE_HONO_URL}/healthz`)) === 200);
await check("fastify /healthz", async () => (await status(`${urls.LIVE_FASTIFY_URL}/healthz`)) === 200);
await check("mcp /healthz", async () => (await status(`${urls.LIVE_MCP_URL}/healthz`)) === 200);
await check("hono paid route challenges (402)", async () => (await status(`${urls.LIVE_HONO_URL}/alerts/whales`)) === 402);

await check("REAL PAID CALL: hono whale alerts via createPayingFetch", async () => {
  const payingFetch = createPayingFetch({
    secret: buyerSecret,
    network: "stellar:testnet",
    rpcUrl: NETWORKS["stellar:testnet"].rpcUrl,
    limits: { maxPerCall: "$0.05", maxTotal: "$0.05" },
  });
  const res = await payingFetch(`${urls.LIVE_HONO_URL}/alerts/whales`);
  const body = (await res.json()) as { whales?: unknown[] };
  return res.ok && Array.isArray(body.whales);
});

console.log(failures === 0 ? "\nAll live checks passed." : `\n${failures} live check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
```

Append to root `.env.example`:

```
# Live Railway domains, for `pnpm verify-live` (filled after Plan B deployment).
LIVE_DASHBOARD_URL=
LIVE_EXPRESS_URL=
LIVE_HONO_URL=
LIVE_FASTIFY_URL=
LIVE_MCP_URL=
```

- [ ] **Step 4: Run the live E2E**

1. `pnpm verify-live` (with LIVE_* URLs in local `.env`) — all checks ✅, including the real paid call; the paid receipt must appear on the live dashboard feed.
2. Press UNLEASH on the live dashboard (or `curl -X POST https://<dashboard-domain>/unleash`) → watch the feed: narration + receipts from all four services; confirm a stellar.expert link opens a real settled transaction; press again inside 2 min → visible cooldown countdown.
3. `get_logs` on agent: mission ran; note whether mode was claude or scripted (claude expected when the key is set).

- [ ] **Step 5: Commit + ledger**

```bash
git add scripts/verify-live.ts package.json .env.example docs/modules/examples.md
git commit -m "feat(scripts): verify-live — deployed-demo end-to-end checks"
```

Ledger: all six domains, verify-live output summary (pass/fail per check — no secrets).

---

### Task 14: README demo links + publish-readiness pass

**Files:**
- Modify: `README.md:244-249` (the six `<!-- filled by Plan B -->` placeholders), plus a "Try it in 10 seconds" block
- Modify: `PUBLISHING.md` (final walkthrough re-verification), each `examples/*/README.md` (live URL added), `docs/modules/examples.md`

- [ ] **Step 1: Fill the placeholders**

Replace each `<!-- filled by Plan B -->` at `README.md:244-249` with the live Railway URL for that service. Directly below the list, add:

````markdown
**Try it in 10 seconds:**

```bash
# Free intel:
curl https://<hono-domain>/
# Paid intel — watch the 402 challenge come back:
curl -i https://<hono-domain>/alerts/whales | head -20
```

Then open the **[live dashboard](https://<dashboard-domain>)** and press
**UNLEASH THE AGENT** to watch an autonomous buyer pay its way across the
whole economy — every settlement lands on Stellar testnet.
````

(substituting real domains). Add each example's own live URL at the top of its README.

- [ ] **Step 2: Publish-readiness verification**

Re-run the Plan A publish gate now that manifests carry `repository`: `pnpm -r --filter "./packages/*" exec pnpm pack --pack-destination /tmp/stellarpay-pack` and confirm each tarball's `package.json` contains the repository field (`tar -xOf <tarball> package/package.json | grep -A2 repository`). Read `PUBLISHING.md` top to bottom against the current repo state; fix any step that drifted. The user runs the actual `npm publish` personally — no plan task executes it.

- [ ] **Step 3: Full suite + commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add README.md PUBLISHING.md examples/*/README.md docs/modules/examples.md
git commit -m "docs: live demo links, try-it-now quickstart, publish-readiness pass"
```

---

### Task 15: `docs/demo-video.md` — judge-video shot list

**Files:**
- Create: `docs/demo-video.md`

- [ ] **Step 1: Write the guide**

`docs/demo-video.md` — complete content:

```markdown
# Demo video — shot list (~3 minutes)

Target: hackathon judges, "Agentic Payments x402/MPP" lane. One take per shot is fine;
record against the LIVE Railway deployment (never localhost), early enough to re-shoot.
Suggested tool: QuickTime/OBS screen capture at 1080p; narrate over each shot.

## Shot 1 — The pitch (0:00–0:20)
Screen: repo README hero snippet.
Say: "stellarpay is one config object that turns any Express, Hono, or Fastify route —
or any MCP tool — into a paid endpoint on Stellar. Two protocols, x402 and MPP, one SDK.
Everything you're about to see is live on testnet."

## Shot 2 — The 6-line diff (0:20–0:45)
Screen: examples/hono-api/README.md diff block.
Say: "This is the entire integration: six lines. No user accounts, no API keys, no
billing system — agents pay per request and settlement lands on-chain."

## Shot 3 — A raw 402 challenge (0:45–1:10)
Screen: terminal. Run: `curl -i https://<hono-domain>/alerts/whales | head -20`
Say: "Unpaid requests get a standard 402 with a machine-readable challenge — that's the
x402 protocol. Any paying client can settle it; ours does it in one line."

## Shot 4 — Mission control + UNLEASH (1:10–2:15) — the centerpiece
Screen: the live dashboard. Press UNLEASH THE AGENT. Let narration + receipts stream in.
Say: "This button hands a funded wallet to a Claude-driven agent with a hard spend limit —
five cents a call, twenty-five cents a run. It's deciding what intel to buy right now:
four services, two payment protocols, including paid MCP tools. Every row is a real
settlement." Point out an agent-log line and a spend-limit mention.

## Shot 5 — On-chain proof (2:15–2:40)
Screen: click a "settlement ↗" link → stellar.expert transaction page.
Say: "Not a simulation — here's the transaction on Stellar testnet, fee-sponsored through
OpenZeppelin's facilitator."

## Shot 6 — Close (2:40–3:00)
Screen: README landscape table + npm package list.
Say: "Seven packages, published on npm under @stellarpay. Express, Hono, Fastify, an
auto-paying client, and paid MCP tools — the missing monetization layer for the agent
economy, on Stellar."

## Re-shoot checklist
- `pnpm verify-live` green immediately before recording.
- Dashboard feed non-empty (boot run) but not cluttered — redeploy the dashboard to clear
  the buffer if needed.
- Unleash cooldown expired (>2 min since last run).
- Browser zoom ~125%; hide bookmarks bar; dark OS theme (matches the dashboard).
```

- [ ] **Step 2: Commit**

```bash
git add docs/demo-video.md
git commit -m "docs: demo-video shot list for judges"
```

---

## Stretch tasks (deliberately not planned here)

Spec §10 lists two stretch items (mpp-channel feed demo; agent treasury with policy signers). They are **not** given tasks in this plan on purpose: both depend on upstream surfaces never verified in this workspace (the `one-way-channel` Soroban contract deployment flow; smart-account-kit policy signers), and this plan's accuracy constraint forbids writing unverifiable code into tasks. If all core tasks complete before the deadline with time to spare, write a separate mini-plan for one stretch item at that point, starting with a verification spike against the installed/held artifacts. `docs/ROADMAP.md` already records both.

## Execution notes for the controller

- Task order is strict: 2 → 3 (UI needs the server), 4 → 5/6/7 (they copy Task 4's reporter), 8 needs 4–7 locally, 11 → 12 → 13 (URL dependencies). Tasks 1, 9, 15 are order-flexible; 10 needs 2 + 4; 14 needs 13.
- Tasks 11–13 are controller tasks (live infra + secret pause points) — do not dispatch implementer subagents for them.
- Implementer dispatches for Tasks 2–10: repeat the attribution prohibition verbatim; each task's local paid-route verification needs the repo `.env` values mapped into `examples/<name>/.env` — instruct implementers to create those files locally and never commit them (`examples/*/.env` must be gitignored — confirm the root `.gitignore` covers `.env` in subdirectories in Task 2, and add `examples/*/.env` if not).
- The final whole-branch review should include: no secret in any tracked file or example README, no `Co-Authored-By` in `git log`, `pnpm test`/`pnpm typecheck` green at HEAD, live domains resolving.
```
