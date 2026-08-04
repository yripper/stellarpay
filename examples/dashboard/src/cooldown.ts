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
