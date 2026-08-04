/** One large native payment, ready to render. */
export type Whale = { amountXlm: string; from: string; to: string; asset: "XLM"; at: string; tx: string; link: string };

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Filters Horizon payment-operation records down to big native payments. Pure — tested directly. */
export function extractWhales(records: unknown[], minXlm: number, limit: number): Whale[] {
  const out: Whale[] = [];
  for (const raw of records) {
    const rec = asRec(raw);
    if (rec["type"] !== "payment" || rec["asset_type"] !== "native") continue;
    const amount = str(rec["amount"]);
    const from = str(rec["from"]);
    const to = str(rec["to"]);
    const at = str(rec["created_at"]);
    const tx = str(rec["transaction_hash"]);
    if (!amount || !from || !to || !at || !tx) continue;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < minXlm) continue;
    out.push({ amountXlm: amount, from, to, asset: "XLM", at, tx, link: `https://stellar.expert/explorer/testnet/tx/${tx}` });
  }
  return out.sort((a, b) => Number(b.amountXlm) - Number(a.amountXlm)).slice(0, limit);
}

const HORIZON = "https://horizon-testnet.stellar.org";

/** Scans the most recent 200 payment operations for whales (live testnet data). */
export async function fetchWhales(f: typeof fetch = fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await f(`${HORIZON}/payments?order=desc&limit=200`);
  if (!res.ok) return { status: 502, body: { error: "horizon_unavailable" } };
  const data = asRec(await res.json());
  const records = asRec(data["_embedded"])["records"];
  const whales = extractWhales(Array.isArray(records) ? records : [], 10_000, 10);
  return { status: 200, body: { thresholdXlm: 10_000, count: whales.length, whales, source: "horizon-testnet, live" } };
}
