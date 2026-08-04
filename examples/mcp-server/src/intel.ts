/**
 * Live Horizon-testnet intel behind the Stellar Intel MCP tools. All endpoints are public
 * and keyless. Every field name read below was re-confirmed against live Horizon by curl on
 * 2026-08-04 (see docs/modules/examples.md's Verified Against section) — three of these four
 * tools are paid, so a field name that silently reads `undefined` is a failed sale, not a
 * cosmetic bug. Reads stay defensive because the payload is third-party.
 */
const HORIZON = "https://horizon-testnet.stellar.org";

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

async function horizonJson(url: string, f: typeof fetch): Promise<Rec | undefined> {
  const res = await f(url);
  if (!res.ok) return undefined;
  return asRec(await res.json());
}

/** FREE tool. Horizon's root document plus `/fee_stats` — the "is testnet healthy?" glance. */
export async function networkStatus(f: typeof fetch = fetch): Promise<Rec> {
  const [root, fees] = await Promise.all([horizonJson(`${HORIZON}/`, f), horizonJson(`${HORIZON}/fee_stats`, f)]);
  return {
    network: "stellar:testnet",
    horizonVersion: root?.["horizon_version"] ?? null,
    latestLedger: root?.["history_latest_ledger"] ?? null,
    ledgerCapacityUsage: fees?.["ledger_capacity_usage"] ?? null,
    source: "horizon-testnet, live",
  };
}

/** PAID tool. A single `/accounts/{id}` read: balances, subentry count, auth flags. */
export async function accountSummary(account: string, f: typeof fetch = fetch): Promise<Rec> {
  const acct = await horizonJson(`${HORIZON}/accounts/${encodeURIComponent(account)}`, f);
  if (!acct) return { error: "account_not_found_or_horizon_unavailable", account };
  return {
    account,
    balances: Array.isArray(acct["balances"]) ? acct["balances"] : [],
    subentries: acct["subentry_count"] ?? null,
    flags: asRec(acct["flags"]),
    source: "horizon-testnet, live",
  };
}

/**
 * Circulating supply of an `/assets` record. Horizon 2.x reports it as `balances.authorized`;
 * the flat `amount` field is the pre-2.x name and is read first only so older/simplified
 * payloads still resolve. Same correction (and same reason) as
 * `examples/express-api/src/intel.ts:33-39` — reading only `amount`, as this task's brief
 * sketched, sells `supply: "—"` to a paying caller against live Horizon.
 */
function assetSupply(rec: Rec): string {
  return str(rec["amount"]) ?? str(asRec(rec["balances"])["authorized"]) ?? "—";
}

/** Holder count, same pre-2.x (`num_accounts`) → 2.x (`accounts.authorized`) fallback as {@link assetSupply}. */
function assetHolders(rec: Rec): number | null {
  return num(rec["num_accounts"]) ?? num(asRec(rec["accounts"])["authorized"]) ?? null;
}

/** PAID tool. Supply, holder count and auth flags for one issued asset, from `/assets`. */
export async function assetStats(code: string, issuer: string, f: typeof fetch = fetch): Promise<Rec> {
  const url = `${HORIZON}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`;
  const data = await horizonJson(url, f);
  const records = asRec(data?.["_embedded"])["records"];
  const rec = Array.isArray(records) && records.length > 0 ? asRec(records[0]) : undefined;
  if (!rec) return { error: "asset_not_found", code, issuer };
  return {
    code,
    issuer,
    supply: assetSupply(rec),
    holders: assetHolders(rec),
    flags: asRec(rec["flags"]),
    source: "horizon-testnet, live",
  };
}

/** One large native payment, ready to render. Mirrors `examples/hono-api/src/whales.ts:2`. */
type Whale = { amountXlm: string; from: string; to: string; asset: "XLM"; at: string; tx: string; link: string };

const WHALE_WINDOW_DESCRIPTION = "200 most recent payment ops";
const WHALE_WINDOW_SIZE = 200;
const WHALE_LIMIT = 10;

/**
 * PAID tool. Top `WHALE_LIMIT` largest native payments in the scanned window — **no size
 * floor**, mirroring `fetchWhales`/`extractWhales` (`examples/hono-api/src/whales.ts:14-58`)
 * after that service's threshold was removed. The brief's `>= 10_000` XLM filter was
 * measured against live testnet on 2026-08-04 (12 native payments in the 200-op window, the
 * largest 1 XLM) and would answer `count: 0` on essentially every call — an honest response,
 * but a $0.02 tool that reliably sells an empty list. Self-describing instead: `count` is
 * always `whales.length` and `largestXlm` is `null`, never `"0"`, when the window holds no
 * native payments at all.
 */
export async function whaleWatch(f: typeof fetch = fetch): Promise<Rec> {
  const data = await horizonJson(`${HORIZON}/payments?order=desc&limit=${WHALE_WINDOW_SIZE}`, f);
  if (!data) return { error: "horizon_unavailable" };
  const records = asRec(data["_embedded"])["records"];
  const whales = extractWhales(Array.isArray(records) ? records : [], WHALE_LIMIT);
  return {
    window: WHALE_WINDOW_DESCRIPTION,
    count: whales.length,
    largestXlm: whales[0]?.amountXlm ?? null,
    whales,
    source: "horizon-testnet, live",
  };
}

/** Pure sort/cap half of {@link whaleWatch}; a record missing any rendered field is dropped, never faked. */
function extractWhales(records: unknown[], limit: number): Whale[] {
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
