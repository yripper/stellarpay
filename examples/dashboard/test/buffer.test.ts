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

  it("list() returns a snapshot, not a live view of the backing array", () => {
    const buf = createFeedBuffer(2);
    buf.push({ at: "t", service: "s", kind: "agent-log", message: "1" });
    const snapshot = buf.list();
    expect(snapshot.map((e) => e.message)).toEqual(["1"]);

    // Push past capacity so the backing array is mutated by eviction (events.shift()).
    // A live view would reflect this mutation; a snapshot must not.
    buf.push({ at: "t", service: "s", kind: "agent-log", message: "2" });
    buf.push({ at: "t", service: "s", kind: "agent-log", message: "3" });

    expect(snapshot.map((e) => e.message)).toEqual(["1"]);
    expect(buf.list().map((e) => e.message)).toEqual(["2", "3"]);
  });
});
