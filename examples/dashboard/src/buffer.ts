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
      // Snapshot, not a live view: /events (src/server.ts:54) iterates this across `await`
      // boundaries during SSE replay, and a concurrent /ingest's capacity eviction
      // (events.shift() above) mutating the same backing array mid-iteration would skip an
      // element or end the loop early, silently dropping events from the replay.
      return [...events];
    },
  };
}

export type FeedBuffer = ReturnType<typeof createFeedBuffer>;
