import { describe, it, expect, vi } from "vitest";
import { SpendTracker } from "../src/limits.js";
import { SpendLimitExceeded } from "../src/index.js";

describe("SpendTracker", () => {
  it("allows under per-call limit", () => {
    const t = new SpendTracker({ maxPerCall: "$0.05" }, vi.fn());
    expect(() => t.checkAndReserve(100_000n, "http://x")).not.toThrow(); // $0.01
  });
  it("blocks over per-call limit", () => {
    const t = new SpendTracker({ maxPerCall: "$0.05" }, vi.fn());
    expect(() => t.checkAndReserve(1_000_000n, "http://x")).toThrow(SpendLimitExceeded); // $0.10
  });
  it("blocks when cumulative total exceeded", () => {
    const t = new SpendTracker({ maxTotal: "$0.02" }, vi.fn());
    t.checkAndReserve(100_000n, "http://x"); // $0.01 ok
    t.checkAndReserve(100_000n, "http://x"); // $0.02 ok (reaches cap exactly)
    expect(() => t.checkAndReserve(1n, "http://x")).toThrow(SpendLimitExceeded);
  });
  it("blocks unknown amounts by default, allows with allowUnknownAmount", () => {
    const events = vi.fn();
    const strict = new SpendTracker({ maxPerCall: "$1" }, events);
    expect(() => strict.checkAndReserve(undefined, "http://x")).toThrow(SpendLimitExceeded);
    const lax = new SpendTracker({ maxPerCall: "$1", allowUnknownAmount: true }, events);
    expect(() => lax.checkAndReserve(undefined, "http://x")).not.toThrow();
  });
  it("no limits configured → everything passes", () => {
    const t = new SpendTracker({}, vi.fn());
    expect(() => t.checkAndReserve(10n ** 12n, "http://x")).not.toThrow();
  });
});
