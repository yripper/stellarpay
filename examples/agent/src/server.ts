import { Hono } from "hono";
import { SCOPES, isScope, type Scope } from "./economy.js";

/** Longest visitor question accepted by /chat — a bound on what reaches the Claude loop. */
const MAX_QUESTION_LENGTH = 500;

/** Reads an optional scope out of an already-parsed body, defaulting to the full economy. */
function scopeIn(fields: Record<string, unknown>): Scope {
  const raw = fields["scope"];
  return isScope(raw) ? raw : "all";
}

/**
 * Parses a JSON body into a plain record. A body that is absent or malformed yields `{}` rather
 * than an error for `/run`: the original endpoint took no body at all, and the dashboard's
 * UNLEASH button still sends none, so this keeps that path behaving exactly as it did before
 * scopes existed. `/chat` validates its own required fields separately.
 */
async function fieldsOf(req: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Run-trigger + chat API. `startRun` returns false when a run is already in flight. */
export function buildApp(deps: {
  ingestSecret: string;
  startRun: (scope: Scope) => boolean;
  askAgent: (opts: { scope: Scope; question: string }) => Promise<{ reply: string } | { busy: true }>;
}): Hono {
  const app = new Hono();
  const authorized = (header: string | undefined): boolean => header === `Bearer ${deps.ingestSecret}`;

  app.get("/healthz", (c) => c.json({ ok: true }));

  /** The scopes a caller may run or chat against — the dashboard builds its tabs from this. */
  app.get("/scopes", (c) => c.json({ scopes: SCOPES }));

  app.post("/run", async (c) => {
    if (!authorized(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);
    const scope = scopeIn(await fieldsOf(c.req));
    if (!deps.startRun(scope)) return c.json({ error: "run_in_progress" }, 409);
    return c.json({ status: "started", scope }, 202);
  });

  app.post("/chat", async (c) => {
    if (!authorized(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);
    const fields = await fieldsOf(c.req);
    const question = typeof fields["message"] === "string" ? fields["message"].trim() : "";
    if (!question) return c.json({ error: "empty_message" }, 400);
    if (question.length > MAX_QUESTION_LENGTH) return c.json({ error: "message_too_long", maxLength: MAX_QUESTION_LENGTH }, 400);

    // Awaited, unlike /run: a chat turn's whole point is the answer in the response body.
    const result = await deps.askAgent({ scope: scopeIn(fields), question });
    if ("busy" in result) return c.json({ error: "run_in_progress" }, 409);
    return c.json({ reply: result.reply, scope: scopeIn(fields) });
  });

  return app;
}
