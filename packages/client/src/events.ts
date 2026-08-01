/** Lifecycle events emitted while `createPayingFetch` probes and pays a challenged request. */
export type PayEvent =
  | { type: "challenge"; protocol: "x402" | "mpp"; url: string }
  | { type: "paying"; protocol: "x402" | "mpp"; url: string }
  | { type: "paid"; protocol: "x402" | "mpp"; url: string }
  | { type: "blocked"; reason: "per-call-limit" | "total-limit" | "unparseable-amount"; url: string }
  | { type: "error"; message: string; url: string };

/**
 * Wraps a user-supplied `onEvent` hook so a bug in it can never interrupt the payment flow.
 * Every `emit` call is best-effort: exceptions thrown by the hook are swallowed.
 */
export class Emitter {
  constructor(private readonly onEvent?: (event: PayEvent) => void) {}

  emit(event: PayEvent): void {
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch {
      // A user's onEvent hook must never break the payment flow.
    }
  }
}
