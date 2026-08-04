import { SpendLimitExceeded } from "@stellarpay/client";
import type { Narrator } from "./narrate.js";

/**
 * One thing the agent can buy. `buy` returns the (parsed) intel for the Claude loop to read;
 * `summarize` turns that same intel into the one honest sentence the dashboard feed shows.
 *
 * `price`/`service` live here because `PayEvent` carries neither (`packages/client/src/events.ts:2-7`)
 * — every dollar figure the agent narrates is attributed from this table, never guessed from an event.
 */
export type Buyable = {
  name: string;
  /** Claude-facing tool description: what it returns, who sells it, what it costs. */
  description: string;
  /** Selling demo service, for narration. */
  service: string;
  /** Price as advertised by the seller's own route/tool config. */
  price: string;
  buy: () => Promise<unknown>;
  summarize: (intel: unknown) => string;
};

type Urls = { express: string; hono: string; fastify: string };

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
/** Renders a field the response may not carry as an em dash — never as "undefined"/"null". */
const shown = (v: unknown): string => str(v) ?? (num(v) !== undefined ? String(v) : "—");

async function paidJson(payingFetch: typeof fetch, url: string): Promise<unknown> {
  const res = await payingFetch(url);
  const body: unknown = await res.json().catch(() => ({ error: "non-json response" }));
  if (!res.ok) throw new Error(`paid GET ${url} → ${res.status}`);
  return body;
}

/**
 * Unwraps the JSON intel an MCP tool returns inside its first text content block, so the
 * Claude loop and the summarizers both see the data rather than the MCP envelope. A tool
 * error (`isError: true`) carries a plain message, not JSON — that falls through as the
 * raw string, which {@link describeIntel} reports verbatim instead of misreading as data.
 */
function unwrapMcpIntel(result: unknown): unknown {
  const content = asRec(result)["content"];
  const text = Array.isArray(content) ? str(asRec(content[0])["text"]) : undefined;
  if (text === undefined) return result;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Shared front for every summarizer: a seller that answered with an error, or with a bare
 * string, is quoted verbatim rather than described as if it were data. Without this, an
 * `{ "error": "horizon_unavailable" }` body would narrate as "wallet holds no balances" —
 * a fabricated claim about a purchase that returned nothing.
 */
function describeIntel(intel: unknown, describe: (r: Rec) => string): string {
  if (typeof intel === "string") return `the seller answered: ${intel.slice(0, 160)}`;
  const r = asRec(intel);
  const err = str(r["error"]);
  if (err) return `the seller answered with an error: ${err}`;
  return describe(r);
}

/** e.g. "USDC authorized supply 99950.0000000 held by 2 accounts; no live XLM order book". */
export function summarizeAssetReport(intel: unknown): string {
  return describeIntel(intel, (r) => {
    const market = asRec(r["market"]);
    const bid = str(market["bestBidXlm"]);
    const ask = str(market["bestAskXlm"]);
    const quoted = bid !== undefined || ask !== undefined;
    const book = quoted ? `XLM book ${bid ?? "—"} bid / ${ask ?? "—"} ask` : "no live XLM order book";
    // "authorized supply", not "supply" — express-api's /report route only ever reports
    // balances.authorized (examples/express-api/src/intel.ts's assetSupply), so the narration
    // must not claim more than the field actually is.
    return `${shown(r["code"])} authorized supply ${shown(r["authorizedSupply"])} held by ${shown(r["holders"])} accounts; ${book}`;
  });
}

/** e.g. "wallet holds 9.9999 XLM, 19.9970000 USDC; 10 recent payments on record". */
export function summarizeAccount(intel: unknown): string {
  return describeIntel(intel, (r) => {
    const raw = Array.isArray(r["balances"]) ? r["balances"] : [];
    const lines = raw.map(balanceLine).filter((line): line is string => line !== undefined);
    const held = lines.length > 0 ? lines.slice(0, 3).join(", ") : "no balances";
    const payments = Array.isArray(r["recentPayments"]) ? r["recentPayments"].length : undefined;
    return `wallet holds ${held}${payments === undefined ? "" : `; ${payments} recent payments on record`}`;
  });
}

/** One Horizon balance entry as "19.9970000 USDC", or `undefined` if it isn't readable. */
function balanceLine(raw: unknown): string | undefined {
  const b = asRec(raw);
  const amount = str(b["balance"]);
  const code = b["asset_type"] === "native" ? "XLM" : str(b["asset_code"]);
  return amount && code ? `${amount} ${code}` : undefined;
}

/** e.g. "10 largest native payments from 200 most recent payment ops; biggest 2.0000000 XLM". */
export function summarizeWhales(intel: unknown): string {
  return describeIntel(intel, (r) => {
    const window = str(r["window"]) ?? "the scanned payment window";
    const count = num(r["count"]);
    const largest = str(r["largestXlm"]);
    if (count === undefined || count === 0 || largest === undefined) return `no native payments found in ${window}`;
    return `${count} largest native payments from ${window}; biggest ${largest} XLM`;
  });
}

/** e.g. "ledger 3966232, capacity usage 0.09 → congestion low". */
export function summarizeFeeStats(intel: unknown): string {
  return describeIntel(intel, (r) => {
    return `ledger ${shown(r["lastLedger"])}, capacity usage ${shown(r["ledgerCapacityUsage"])} → congestion ${shown(r["congestion"])}`;
  });
}

/**
 * One honest sentence about why a purchase did not happen. A `SpendLimitExceeded`
 * (`packages/client/src/limits.ts:5`) is called out as a refusal rather than a failure —
 * on camera it is the guardrail working, not the demo breaking.
 */
export function describeBuyFailure(err: unknown): string {
  if (err instanceof SpendLimitExceeded) return `refused by the client-side spend limit (${err.message})`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Discovers a live USDC issuer on testnet from Horizon (free) so the asset-report buy
 * never depends on a hardcoded issuer address.
 */
export async function discoverUsdcIssuer(rawFetch: typeof fetch = fetch): Promise<string> {
  const res = await rawFetch("https://horizon-testnet.stellar.org/assets?asset_code=USDC&limit=1");
  if (!res.ok) throw new Error("could not discover a USDC issuer from Horizon");
  const data = (await res.json()) as { _embedded?: { records?: Array<{ asset_issuer?: string }> } };
  const issuer = data._embedded?.records?.[0]?.asset_issuer;
  if (!issuer) throw new Error("no USDC asset found on testnet Horizon");
  return issuer;
}

export function buildEconomy(deps: {
  payingFetch: typeof fetch;
  rawFetch?: typeof fetch;
  urls: Urls;
  /**
   * Omitted when the MCP connection could not be established: the two MCP buyables are then
   * absent from the economy entirely, rather than present and guaranteed to fail. A judge's
   * button press still buys from the three HTTP services (spec §8, "the button never fizzles").
   */
  mcpCall?: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  buyerPublicKey: string;
}): Buyable[] {
  const raw = deps.rawFetch ?? fetch;
  const mcpCall = deps.mcpCall;
  return [
    {
      name: "buy_asset_report",
      description: "Full USDC asset report incl. live order book, from express-api. Costs $0.02 (x402).",
      service: "express-api",
      price: "$0.02",
      buy: async () => paidJson(deps.payingFetch, `${deps.urls.express}/report/USDC/${await discoverUsdcIssuer(raw)}`),
      summarize: summarizeAssetReport,
    },
    {
      name: "buy_account_deep_dive",
      description: "Deep-dive on my own wallet account, from express-api. Costs $0.02 (MPP, gas-sponsored).",
      service: "express-api",
      price: "$0.02",
      buy: () => paidJson(deps.payingFetch, `${deps.urls.express}/deep-dive/${deps.buyerPublicKey}`),
      summarize: summarizeAccount,
    },
    {
      name: "buy_whale_alerts",
      description: "The 10 largest recent native payments on testnet, from hono-api. Costs $0.01 (x402).",
      service: "hono-api",
      price: "$0.01",
      buy: () => paidJson(deps.payingFetch, `${deps.urls.hono}/alerts/whales`),
      summarize: summarizeWhales,
    },
    {
      name: "buy_fee_stats",
      description: "Live fee & congestion stats, from fastify-api. Costs $0.005 (MPP).",
      service: "fastify-api",
      price: "$0.005",
      buy: () => paidJson(deps.payingFetch, `${deps.urls.fastify}/stats/fees`),
      summarize: summarizeFeeStats,
    },
    ...(mcpCall
      ? [
          {
            name: "buy_mcp_account_summary",
            description: "MCP tool account_summary on my own wallet. Costs $0.01 (MPP over MCP).",
            service: "mcp-server",
            price: "$0.01",
            buy: async () => unwrapMcpIntel(await mcpCall("account_summary", { account: deps.buyerPublicKey })),
            summarize: summarizeAccount,
          },
          {
            name: "buy_mcp_whale_watch",
            description: "MCP tool whale_watch: biggest recent testnet payments. Costs $0.02 (MPP over MCP).",
            service: "mcp-server",
            price: "$0.02",
            buy: async () => unwrapMcpIntel(await mcpCall("whale_watch", {})),
            summarize: summarizeWhales,
          },
        ]
      : []),
  ];
}

/**
 * True when `intel` is what {@link describeIntel} would report as an error rather than data —
 * a bare string (an MCP `isError` result unwrapped by {@link unwrapMcpIntel}) or a JSON
 * payload carrying an `error` field. In both cases the payment already settled; only the
 * seller's delivery failed, and the narration marker should say so instead of claiming a
 * clean success.
 */
function isFailedDelivery(intel: unknown): boolean {
  if (typeof intel === "string") return true;
  return typeof asRec(intel)["error"] === "string";
}

/** Deterministic tour: every buyable in the economy, in order, narrated. Never throws per-item. */
export async function scriptedTour(economy: Buyable[], narrate: Narrator): Promise<void> {
  for (const item of economy) {
    narrate(`Buying ${item.name} from ${item.service} for ${item.price}…`);
    try {
      const intel = await item.buy();
      // ✔ means "paid and delivered"; a seller error after a successful payment is neither
      // a failed purchase (✖, which describeBuyFailure/the catch below reserve for that) nor
      // a clean success — ⚠ marks that distinction instead of reading as broken on camera.
      const marker = isFailedDelivery(intel) ? "⚠" : "✔";
      narrate(`${marker} Paid ${item.price} to ${item.service} for ${item.name} — ${item.summarize(intel)}`);
    } catch (err) {
      narrate(`✖ ${item.name} not delivered — ${describeBuyFailure(err)}`);
    }
  }
}
