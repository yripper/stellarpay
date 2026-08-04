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
