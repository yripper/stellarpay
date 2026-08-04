import { describe, expect, it, vi } from "vitest";
import { runMission } from "../src/run.js";
import {
  scriptedTour,
  summarizeAccount,
  summarizeAssetReport,
  summarizeFeeStats,
  summarizeWhales,
  type Buyable,
} from "../src/economy.js";

const deps = (overrides: Partial<Parameters<typeof runMission>[0]>) => ({
  mission: "test mission",
  narrate: vi.fn(),
  runClaude: vi.fn().mockResolvedValue(undefined),
  runScripted: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("runMission", () => {
  it("uses the Claude path when it succeeds and never runs the scripted tour", async () => {
    const d = deps({});
    expect(await runMission(d)).toEqual({ mode: "claude" });
    expect(d.runScripted).not.toHaveBeenCalled();
  });

  it("falls back to the scripted tour when the Claude path throws", async () => {
    const d = deps({ runClaude: vi.fn().mockRejectedValue(new Error("api down")) });
    expect(await runMission(d)).toEqual({ mode: "scripted" });
    expect(d.runScripted).toHaveBeenCalledOnce();
    const lines = (d.narrate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("scripted"))).toBe(true);
  });

  it("skips Claude entirely when no runner is provided (no API key)", async () => {
    const d = deps({ runClaude: undefined });
    expect(await runMission(d)).toEqual({ mode: "scripted" });
  });

  it("surfaces a scripted-tour failure as a narrated error, not a crash", async () => {
    const d = deps({ runClaude: undefined, runScripted: vi.fn().mockRejectedValue(new Error("all down")) });
    expect(await runMission(d)).toEqual({ mode: "scripted" });
    const lines = (d.narrate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.toLowerCase().includes("failed"))).toBe(true);
  });
});

/** A minimal Buyable whose `buy` result and outcome the test controls. */
const buyable = (name: string, buy: () => Promise<unknown>): Buyable => ({
  name,
  description: `${name} description`,
  service: "test-service",
  price: "$0.01",
  buy,
  summarize: (intel) => `saw ${JSON.stringify(intel)}`,
});

describe("scriptedTour", () => {
  it("buys every item in order and narrates the price, seller, and what came back", async () => {
    const lines: string[] = [];
    await scriptedTour(
      [buyable("first", async () => ({ ok: 1 })), buyable("second", async () => ({ ok: 2 }))],
      (m) => lines.push(m),
    );
    expect(lines).toEqual([
      "Buying first from test-service for $0.01…",
      '✔ Paid $0.01 to test-service for first — saw {"ok":1}',
      "Buying second from test-service for $0.01…",
      '✔ Paid $0.01 to test-service for second — saw {"ok":2}',
    ]);
  });

  it("narrates a failed purchase and still buys the rest of the economy", async () => {
    const lines: string[] = [];
    const bought: string[] = [];
    await scriptedTour(
      [
        buyable("broken", () => Promise.reject(new Error("seller down"))),
        buyable("working", async () => {
          bought.push("working");
          return { ok: true };
        }),
      ],
      (m) => lines.push(m),
    );
    expect(lines).toContain("✖ broken not delivered — seller down");
    expect(bought).toEqual(["working"]);
  });

  it("marks a settled payment whose seller answered with an error as ⚠, not ✔", async () => {
    const lines: string[] = [];
    await scriptedTour(
      [
        // A bare-string intel is what unwrapMcpIntel returns for an MCP isError result — the
        // payment settled (buy() resolved, no throw), but describeIntel reads it as an error.
        buyable("mcp_tool", async () => "fetch failed"),
      ],
      (m) => lines.push(m),
    );
    expect(lines[1]).toBe('⚠ Paid $0.01 to test-service for mcp_tool — saw "fetch failed"');
    expect(lines[1]).not.toContain("✔");
  });

  it("marks a settled payment whose JSON body carries an error field as ⚠, not ✔", async () => {
    const lines: string[] = [];
    await scriptedTour([buyable("http_route", async () => ({ error: "horizon_unavailable" }))], (m) => lines.push(m));
    expect(lines[1]).toBe('⚠ Paid $0.01 to test-service for http_route — saw {"error":"horizon_unavailable"}');
  });
});

describe("purchase summaries", () => {
  it("reads the real numbers out of an asset report", () => {
    expect(
      summarizeAssetReport({
        code: "USDC",
        authorizedSupply: "99950.0000000",
        holders: 2,
        market: { bestBidXlm: "0.1", bestAskXlm: null },
      }),
    ).toBe("USDC authorized supply 99950.0000000 held by 2 accounts; XLM book 0.1 bid / — ask");
  });

  it("says so plainly when the order book is missing rather than inventing a price", () => {
    expect(summarizeAssetReport({ code: "USDC", authorizedSupply: "1.0", holders: null, market: { note: "order book unavailable" } })).toBe(
      "USDC authorized supply 1.0 held by — accounts; no live XLM order book",
    );
  });

  it("renders balances and recent-payment counts from the account payload", () => {
    expect(
      summarizeAccount({
        balances: [
          { balance: "19.9970000", asset_code: "USDC", asset_type: "credit_alphanum4" },
          { balance: "9.9999", asset_type: "native" },
        ],
        recentPayments: [{}, {}],
      }),
    ).toBe("wallet holds 19.9970000 USDC, 9.9999 XLM; 2 recent payments on record");
  });

  it("reports an empty whale window as empty instead of claiming a largest payment", () => {
    expect(summarizeWhales({ window: "200 most recent payment ops", count: 0, largestXlm: null })).toBe(
      "no native payments found in 200 most recent payment ops",
    );
  });

  it("quotes the largest payment when the window has one", () => {
    expect(summarizeWhales({ window: "200 most recent payment ops", count: 10, largestXlm: "2.0000000" })).toBe(
      "10 largest native payments from 200 most recent payment ops; biggest 2.0000000 XLM",
    );
  });

  it("renders live fee stats with the seller's own congestion verdict", () => {
    expect(summarizeFeeStats({ lastLedger: 3966232, ledgerCapacityUsage: "0.09", congestion: "low" })).toBe(
      "ledger 3966232, capacity usage 0.09 → congestion low",
    );
  });

  it("quotes a seller error instead of describing the empty payload as data", () => {
    expect(summarizeAccount({ error: "account_not_found_or_horizon_unavailable" })).toBe(
      "the seller answered with an error: account_not_found_or_horizon_unavailable",
    );
    expect(summarizeWhales("fetch failed")).toBe("the seller answered: fetch failed");
  });
});
