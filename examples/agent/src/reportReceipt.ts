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
