const HORIZON = "https://horizon-testnet.stellar.org";
type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});

/** Live /fee_stats read with a human congestion verdict. */
export async function fetchFeeStats(f: typeof fetch = fetch): Promise<{ status: number; body: Rec }> {
  const res = await f(`${HORIZON}/fee_stats`);
  if (!res.ok) return { status: 502, body: { error: "horizon_unavailable" } };
  const data = asRec(await res.json());
  const usage = Number(data["ledger_capacity_usage"]);
  const congestion = !Number.isFinite(usage) ? "unknown" : usage < 0.5 ? "low" : usage < 0.8 ? "moderate" : "high";
  return {
    status: 200,
    body: {
      lastLedger: data["last_ledger"] ?? null,
      ledgerCapacityUsage: data["ledger_capacity_usage"] ?? null,
      congestion,
      feeCharged: asRec(data["fee_charged"]),
      maxFee: asRec(data["max_fee"]),
      source: "horizon-testnet, live",
    },
  };
}
