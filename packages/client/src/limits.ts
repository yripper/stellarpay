import { dollarToDecimal, decimalToBaseUnits } from "@stellarpay/shared";
import type { PayEvent } from "./events.js";

/** Thrown by `SpendTracker.checkAndReserve` when a payment would exceed a configured spend limit. */
export class SpendLimitExceeded extends Error {}

/** Dollar-denominated spend limits, as configured by `PayingFetchConfig.limits`. */
export type SpendLimits = { maxPerCall?: string; maxTotal?: string; allowUnknownAmount?: boolean };

/**
 * Tracks and enforces per-call and cumulative spend limits across payment attempts, in
 * bigint base-unit math throughout (no floats). `checkAndReserve` validates and reserves
 * in the same call: an amount that fails validation is never added to the cumulative
 * total, and a cap is reached inclusively (an amount that lands exactly on `maxTotal`
 * passes; the next call to add anything further does not).
 */
export class SpendTracker {
  private readonly maxPerCallBaseUnits: bigint | undefined;
  private readonly maxTotalBaseUnits: bigint | undefined;
  private readonly allowUnknownAmount: boolean;
  private cumulativeBaseUnits = 0n;

  constructor(
    limits: SpendLimits,
    private readonly emit: (event: PayEvent) => void,
  ) {
    this.maxPerCallBaseUnits =
      limits.maxPerCall !== undefined ? decimalToBaseUnits(dollarToDecimal(limits.maxPerCall)) : undefined;
    this.maxTotalBaseUnits =
      limits.maxTotal !== undefined ? decimalToBaseUnits(dollarToDecimal(limits.maxTotal)) : undefined;
    this.allowUnknownAmount = limits.allowUnknownAmount ?? false;
  }

  /**
   * Validates `baseUnits` (the amount a challenge is asking for) against the configured
   * limits and, only if it passes every check, reserves it against the cumulative total.
   * Throws `SpendLimitExceeded` (after emitting a `"blocked"` event) on any violation.
   */
  checkAndReserve(baseUnits: bigint | undefined, url: string): void {
    if (baseUnits === undefined) {
      if (this.allowUnknownAmount) return;
      this.block("unparseable-amount", url);
    }
    if (this.maxPerCallBaseUnits !== undefined && baseUnits > this.maxPerCallBaseUnits) {
      this.block("per-call-limit", url);
    }
    const nextTotal = this.cumulativeBaseUnits + baseUnits;
    if (this.maxTotalBaseUnits !== undefined && nextTotal > this.maxTotalBaseUnits) {
      this.block("total-limit", url);
    }
    this.cumulativeBaseUnits = nextTotal;
  }

  private block(reason: "per-call-limit" | "total-limit" | "unparseable-amount", url: string): never {
    this.emit({ type: "blocked", reason, url });
    throw new SpendLimitExceeded(`Payment blocked (${reason}) for ${url}`);
  }
}
