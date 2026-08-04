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
