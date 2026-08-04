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
      // 127.0.0.1, not "localhost": resolving "localhost" can take seconds on some machines
      // (a documented macOS/Node DNS-resolution quirk) — a real but irrelevant source of
      // flakiness this test has no business being sensitive to.
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

/** Races `promise` against a timer, rejecting with a message naming what it was waiting for
 *  rather than letting a stuck read hang the test (or, worse, pass on incomplete data). */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Parses every `data:` line seen so far into its JSON payload, skipping non-JSON frames (the
 *  `ping` heartbeat's `data` is empty — src/server.ts:67). */
function extractEvents(raw: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as Record<string, unknown>);
    } catch {
      // Not a FeedEvent JSON frame — ignore rather than throw.
    }
  }
  return events;
}

/**
 * Reads `res`'s SSE body, accumulating chunks, until `isDone` is satisfied by the parsed
 * events seen so far. Never assumes a single `.read()` carries the whole payload — a chunk
 * boundary can split or coalesce frames arbitrarily, so checking only the first read (as the
 * sibling `app.request()`-level test's *absence* of a loop would) can miss an event that
 * lands in a later chunk and produce a false pass on whatever "not present" assertion runs
 * against it. Bounded by `timeoutMs`, failing loudly and by name rather than hanging or
 * (worse) passing silently. Always cancels the reader before returning or throwing, on every
 * path, so no test leaves a live SSE connection — and the server's 25s ping `setInterval`
 * that rides on it (src/server.ts:66-68) — running past itself. That interval is only cleared
 * (src/server.ts:70) once the stream's `closed` promise resolves, which `stream.onAbort()`
 * (src/server.ts:64) triggers on client disconnect — i.e. on `reader.cancel()`.
 */
async function collectSseUntil(
  res: Response,
  isDone: (events: Record<string, unknown>[]) => boolean,
  label: string,
  // Deliberately under vitest's default 5s per-test timeout, so this timeout's descriptive
  // "waiting for X" message is what surfaces in a failure — not a generic "Test timed out".
  timeoutMs = 4000,
): Promise<Record<string, unknown>[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  try {
    return await withTimeout(
      (async () => {
        for (;;) {
          const events = extractEvents(raw);
          if (isDone(events)) return events;
          const { value, done } = await reader.read();
          if (done) throw new Error(`SSE stream closed before ${label} arrived (saw ${extractEvents(raw).length} event(s) total)`);
          raw += decoder.decode(value, { stream: true });
        }
      })(),
      timeoutMs,
      label,
    );
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

describe("receipt → ingest → SSE, over real HTTP", () => {
  it("a reported receipt arrives on the event stream", async () => {
    // Connect BEFORE reporting: /events replays the current buffer and then stays subscribed
    // for live pushes (src/server.ts:51-73), so a connection opened first observes the event
    // either way it lands — no "did the POST land yet" guess required.
    const res = await fetch(`${baseUrl}/events`, { headers: { accept: "text/event-stream" } });
    expect(res.status).toBe(200);

    const report = createReceiptReporter({ service: "express-api", dashboardUrl: baseUrl, ingestSecret: SECRET });
    report({ kind: "receipt", receipt: { scheme: "x402", route: "GET /report/*", amount: "0.02", asset: "USDC" } });

    const events = await collectSseUntil(res, (evs) => evs.some((e) => e["service"] === "express-api"), "the express-api receipt event");
    const event = events.find((e) => e["service"] === "express-api") as Record<string, unknown>;
    expect(event).toMatchObject({ service: "express-api", kind: "receipt" });
    expect((event["receipt"] as Record<string, unknown>)["amount"]).toBe("0.02");
    expect(typeof event["at"]).toBe("string");
  });

  it("an unauthorized reporter's receipt never reaches the stream", async () => {
    const res = await fetch(`${baseUrl}/events`, { headers: { accept: "text/event-stream" } });
    expect(res.status).toBe(200);

    const badReport = createReceiptReporter({ service: "evil", dashboardUrl: baseUrl, ingestSecret: "wrong-secret" });
    badReport({ kind: "receipt", receipt: { amount: "999" } });

    // createReceiptReporter is fire-and-forget by design (reportReceipt.ts:15,25-28) — there is
    // no promise to await to learn the unauthorized POST has actually been handled. Sleeping a
    // guessed duration before asserting absence can pass *before* the server has even looked at
    // the evil event — a false pass on exactly the invariant this test exists to catch. Instead,
    // report a second, AUTHORIZED event right after and wait for *that* one to show up on the
    // feed. The evil POST is issued first and its auth check is a synchronous header compare
    // with no further I/O (src/server.ts:25,31); by the time the strictly more expensive
    // authorized path (body parse -> validate -> buffer push -> subscriber fan-out) has
    // completed and is visible on the wire, the server has certainly already finished with the
    // evil request too. Waiting for the sentinel turns the absence check into a real
    // observation instead of a race against an arbitrary clock.
    const sentinelReport = createReceiptReporter({ service: "sentinel", dashboardUrl: baseUrl, ingestSecret: SECRET });
    sentinelReport({ kind: "agent-log", message: "sentinel-after-evil" });

    const events = await collectSseUntil(res, (evs) => evs.some((e) => e["service"] === "sentinel"), "the sentinel event confirming the pipeline flushed");
    expect(events.some((e) => e["service"] === "evil")).toBe(false);
  });
});
