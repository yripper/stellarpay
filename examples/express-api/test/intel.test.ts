import { describe, expect, it, vi } from "vitest";
import { fetchAssetSummary, fetchAssetReport, fetchAccountDeepDive } from "../src/intel.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ASSET_RECORD = { asset_code: "USDC", asset_issuer: "GISSUER", amount: "1000.5", num_accounts: 42, flags: { auth_required: false } };

// The shape live Horizon 2.x actually returns from /assets — verified 2026-08-04 against
// https://horizon-testnet.stellar.org/assets?asset_code=USDC: no flat `amount`/`num_accounts`,
// supply and holder count live under the `balances`/`accounts` objects instead.
const LIVE_ASSET_RECORD = {
  asset_code: "USDC",
  asset_issuer: "GISSUER",
  accounts: { authorized: 2, authorized_to_maintain_liabilities: 0, unauthorized: 0 },
  balances: { authorized: "18501850000.0000000", authorized_to_maintain_liabilities: "0.0000000", unauthorized: "0.0000000" },
  flags: { auth_required: false },
};

describe("intel fetchers", () => {
  it("summary returns curated fields for a known asset", async () => {
    const f = vi.fn().mockResolvedValue(json({ _embedded: { records: [ASSET_RECORD] } }));
    const out = await fetchAssetSummary("USDC", "GISSUER", f as unknown as typeof fetch);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ code: "USDC", issuer: "GISSUER", supply: "1000.5", holders: 42 });
  });

  it("summary reads supply/holders from the live Horizon 2.x balances+accounts shape", async () => {
    const f = vi.fn().mockResolvedValue(json({ _embedded: { records: [LIVE_ASSET_RECORD] } }));
    const out = await fetchAssetSummary("USDC", "GISSUER", f as unknown as typeof fetch);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ supply: "18501850000.0000000", holders: 2 });
  });

  it("summary maps an empty record set to 404", async () => {
    const f = vi.fn().mockResolvedValue(json({ _embedded: { records: [] } }));
    expect((await fetchAssetSummary("NOPE", "GX", f as unknown as typeof fetch)).status).toBe(404);
  });

  it("report merges summary and order-book top levels", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ _embedded: { records: [ASSET_RECORD] } }))
      .mockResolvedValueOnce(json({ bids: [{ price: "0.51" }], asks: [{ price: "0.55" }] }));
    const out = await fetchAssetReport("USDC", "GISSUER", f as unknown as typeof fetch);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ market: { bestBidXlm: "0.51", bestAskXlm: "0.55" } });
  });

  it("deep-dive maps a Horizon 404 through", async () => {
    const f = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    expect((await fetchAccountDeepDive("GNOBODY", f as unknown as typeof fetch)).status).toBe(404);
  });

  it("horizon 5xx maps to 502", async () => {
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    expect((await fetchAssetSummary("USDC", "GX", f as unknown as typeof fetch)).status).toBe(502);
  });
});
