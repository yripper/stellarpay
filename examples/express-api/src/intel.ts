/**
 * Live Horizon-testnet intel. All endpoints are public and keyless. Field names below
 * were confirmed against live Horizon responses (curl the endpoints once if in doubt —
 * they are versioned and stable); every read is defensive because the payload is external.
 */
const HORIZON = "https://horizon-testnet.stellar.org";

export type IntelResult = { status: number; body: Record<string, unknown> };

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

async function horizonJson(url: string, f: typeof fetch): Promise<{ status: number; data?: Rec }> {
  const res = await f(url);
  if (res.status === 404) return { status: 404 };
  if (!res.ok) return { status: 502 };
  return { status: 200, data: asRec(await res.json()) };
}

function assetRecord(data: Rec): Rec | undefined {
  const records = asRec(data["_embedded"])["records"];
  return Array.isArray(records) && records.length > 0 ? asRec(records[0]) : undefined;
}

/**
 * Circulating supply of an asset record. Horizon 2.x reports it as `balances.authorized`;
 * the flat `amount` field is the pre-2.x name and is read first only so older/simplified
 * payloads still resolve. Confirmed live: `/assets` records carry `balances`/`accounts`
 * objects, not `amount`/`num_accounts`.
 */
function assetSupply(rec: Rec): string {
  return str(rec["amount"]) ?? str(asRec(rec["balances"])["authorized"]) ?? "—";
}

/** Holder count, same pre-2.x (`num_accounts`) → 2.x (`accounts.authorized`) fallback as {@link assetSupply}. */
function assetHolders(rec: Rec): number | null {
  return num(rec["num_accounts"]) ?? num(asRec(rec["accounts"])["authorized"]) ?? null;
}

export async function fetchAssetSummary(code: string, issuer: string, f: typeof fetch = fetch): Promise<IntelResult> {
  const url = `${HORIZON}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`;
  const { status, data } = await horizonJson(url, f);
  if (status !== 200 || !data) return { status: status === 404 ? 404 : 502, body: { error: "horizon_unavailable" } };
  const rec = assetRecord(data);
  if (!rec) return { status: 404, body: { error: "asset_not_found", code, issuer } };
  return {
    status: 200,
    body: {
      code,
      issuer,
      supply: assetSupply(rec),
      holders: assetHolders(rec),
      flags: asRec(rec["flags"]),
      source: "horizon-testnet, live",
    },
  };
}

export async function fetchAssetReport(code: string, issuer: string, f: typeof fetch = fetch): Promise<IntelResult> {
  const summary = await fetchAssetSummary(code, issuer, f);
  if (summary.status !== 200) return summary;
  const assetType = code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";
  const obUrl =
    `${HORIZON}/order_book?selling_asset_type=${assetType}` +
    `&selling_asset_code=${encodeURIComponent(code)}&selling_asset_issuer=${encodeURIComponent(issuer)}` +
    `&buying_asset_type=native`;
  const ob = await horizonJson(obUrl, f);
  const bids = ob.data?.["bids"];
  const asks = ob.data?.["asks"];
  const top = (side: unknown): string | null => (Array.isArray(side) && side.length > 0 ? (str(asRec(side[0])["price"]) ?? null) : null);
  return {
    status: 200,
    body: {
      ...summary.body,
      market:
        ob.status === 200
          ? { bestBidXlm: top(bids), bestAskXlm: top(asks), note: "top of the XLM order book, live" }
          : { note: "order book unavailable" },
    },
  };
}

export async function fetchAccountDeepDive(account: string, f: typeof fetch = fetch): Promise<IntelResult> {
  const acct = await horizonJson(`${HORIZON}/accounts/${encodeURIComponent(account)}`, f);
  if (acct.status !== 200 || !acct.data) {
    return { status: acct.status === 404 ? 404 : 502, body: { error: acct.status === 404 ? "account_not_found" : "horizon_unavailable" } };
  }
  const pays = await horizonJson(`${HORIZON}/accounts/${encodeURIComponent(account)}/payments?limit=10&order=desc`, f);
  const payRecords = asRec(pays.data?.["_embedded"])["records"];
  const recent = Array.isArray(payRecords)
    ? payRecords.map((p) => {
        const r = asRec(p);
        return { type: str(r["type"]) ?? "—", amount: str(r["amount"]) ?? "—", at: str(r["created_at"]) ?? "—", tx: str(r["transaction_hash"]) ?? null };
      })
    : [];
  return {
    status: 200,
    body: {
      account,
      balances: Array.isArray(acct.data["balances"]) ? acct.data["balances"] : [],
      subentries: acct.data["subentry_count"] ?? null,
      flags: asRec(acct.data["flags"]),
      recentPayments: recent,
      source: "horizon-testnet, live",
    },
  };
}
