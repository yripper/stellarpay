/** One large native payment, ready to render. */
export type Whale = { amountXlm: string; from: string; to: string; asset: "XLM"; at: string; tx: string; link: string };

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Sorts native Horizon payment-operation records by amount descending and takes the top
 * `limit` — no size floor. Testnet payment volume is small and bursty; a fixed XLM threshold
 * (the original design) made the paid route return an empty list almost always. Pure —
 * tested directly.
 */
export function extractWhales(records: unknown[], limit: number): Whale[] {
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
    if (!Number.isFinite(Number(amount))) continue;
    out.push({ amountXlm: amount, from, to, asset: "XLM", at, tx, link: `https://stellar.expert/explorer/testnet/tx/${tx}` });
  }
  return out.sort((a, b) => Number(b.amountXlm) - Number(a.amountXlm)).slice(0, limit);
}

const HORIZON = "https://horizon-testnet.stellar.org";
const WINDOW_DESCRIPTION = "200 most recent payment ops";
const WINDOW_SIZE = 200;
const LIMIT = 10;

/**
 * Scans the most recent 200 payment operations and returns the top 10 largest native
 * payments in that window (live testnet data) — self-describing so an empty or thin window
 * never looks fabricated. `largestXlm` is `null` when the window has no native payments at
 * all; `count` always reflects how many records are actually returned.
 */
export async function fetchWhales(f: typeof fetch = fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await f(`${HORIZON}/payments?order=desc&limit=${WINDOW_SIZE}`);
  if (!res.ok) return { status: 502, body: { error: "horizon_unavailable" } };
  const data = asRec(await res.json());
  const records = asRec(data["_embedded"])["records"];
  const whales = extractWhales(Array.isArray(records) ? records : [], LIMIT);
  return {
    status: 200,
    body: {
      window: WINDOW_DESCRIPTION,
      count: whales.length,
      largestXlm: whales[0]?.amountXlm ?? null,
      whales,
      source: "horizon-testnet, live",
    },
  };
}
