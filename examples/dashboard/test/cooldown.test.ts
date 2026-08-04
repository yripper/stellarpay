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
