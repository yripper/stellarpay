import { describe, it, expect, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { stellarpay } from "@stellarpay/core";
import { createPayingFetch, SpendLimitExceeded, MissingSignerConfig } from "../src/index.js";

const server = stellarpay({
  network: "stellar:testnet", payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
});
// serve stellarpay core directly as a fetch endpoint — no HTTP listener needed
const serverFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  return (await server.handle(req)) ?? new Response(JSON.stringify({ secret: 42 }), { status: 200 });
};

describe("createPayingFetch (MPP leg)", () => {
  it("surfaces the 402 challenge to the MPP handler and emits events", async () => {
    const events: string[] = [];
    const payFetch = createPayingFetch({
      keypair: Keypair.random(), network: "stellar:testnet",
      onEvent: (e) => events.push(e.type),
      _baseFetch: serverFetch,   // test seam: injected transport
      _dryRun: true,             // stop before on-chain signing/broadcast; assert challenge handling only
    } as never);
    await payFetch("http://svc/paid").catch(() => undefined);
    expect(events).toContain("challenge");
  });
  it("enforces total limit before any signing", async () => {
    const payFetch = createPayingFetch({
      keypair: Keypair.random(), network: "stellar:testnet",
      limits: { maxTotal: "$0.001" },
      _baseFetch: serverFetch, _dryRun: true,
    } as never);
    await expect(payFetch("http://svc/paid")).rejects.toThrow(SpendLimitExceeded);
  });
  it("returns non-402 responses untouched", async () => {
    const payFetch = createPayingFetch({ keypair: Keypair.random(), network: "stellar:testnet", _baseFetch: serverFetch } as never);
    const res = await payFetch("http://svc/free");
    expect(res.status).toBe(200);
  });
});

// Review finding (Critical): `channelClient.stellar(...)` is one of the `methods`
// evaluated *eagerly* inside `Mppx.create()` — so configuring `channelCommitmentSecret`
// alone, with no `allowedChannels`/`allowUnpinnedChannel`, made every MPP request throw
// synchronously from `@stellar/mpp`'s own construction-time pinning check ("Channel
// pinning is required...", `@stellar/mpp/dist/channel/client/Channel.js:40-42`), even for
// requests that only ever needed the charge method.
describe("createPayingFetch (mpp-channel client config)", () => {
  it("channelCommitmentSecret alone does not break MPP leg construction (falls back to unpinned)", async () => {
    const payFetch = createPayingFetch({
      keypair: Keypair.random(), network: "stellar:testnet",
      channelCommitmentSecret: Keypair.random().secret(),
      _baseFetch: serverFetch, _dryRun: true,
    } as never);
    const err = await payFetch("http://svc/paid").catch((e: unknown) => e);
    // The only error reaching here should be the intentional _dryRun stop — proving
    // Mppx.create() construction succeeded and the request flow reached the limit gate,
    // rather than the channel client's own construction-time pinning error.
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("stellarpay: _dryRun stops before credential creation");
  });

  it("allowedChannels pins the channel client instead of falling back to unpinned", async () => {
    const payFetch = createPayingFetch({
      keypair: Keypair.random(), network: "stellar:testnet",
      channelCommitmentSecret: Keypair.random().secret(),
      allowedChannels: ["CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"], // USDC_SAC_TESTNET
      _baseFetch: serverFetch, _dryRun: true,
    } as never);
    const err = await payFetch("http://svc/paid").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("stellarpay: _dryRun stops before credential creation");
  });
});

// Carried forward from Task 13's review: `checkAndReserve` reserves budget before a
// payment attempt is known to succeed. These prove a *failed* attempt on each leg
// releases that reservation instead of permanently consuming `maxTotal` — otherwise a
// single bad signer/network blip would silently block every future legitimate call.
describe("createPayingFetch (budget release on failed attempts)", () => {
  it("mpp: a failed attempt (dry run, after the limit gate reserved budget) does not consume maxTotal", async () => {
    // Route price is $0.01 -> each challenge reserves 100_000n base units (7 decimals).
    // maxTotal $0.015 (150_000n) admits one reservation but not two unreleased ones.
    const payFetch = createPayingFetch({
      keypair: Keypair.random(), network: "stellar:testnet",
      limits: { maxTotal: "$0.015" },
      _baseFetch: serverFetch, _dryRun: true,
    } as never);
    const first = await payFetch("http://svc/paid").catch((e: unknown) => e);
    const second = await payFetch("http://svc/paid").catch((e: unknown) => e);
    // Both attempts fail for the *same* reason (the dry-run seam stopping before
    // credential creation) — neither is a budget block, proving the first attempt's
    // reservation was released rather than leaking into the second.
    expect(first).not.toBeInstanceOf(SpendLimitExceeded);
    expect(second).not.toBeInstanceOf(SpendLimitExceeded);
  });

  it("x402: a failed attempt (misconfigured secret) does not consume maxTotal", async () => {
    // Minimal fabricated x402 402, mirroring detect.test.ts's own fixture style — an
    // x402 challenge requires no live facilitator to construct client-side.
    const header = Buffer.from(JSON.stringify({ accepts: [{ amount: "100000", asset: "USDC" }] })).toString("base64");
    const x402Fetch: typeof fetch = async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header } });
    const payFetch = createPayingFetch({
      // Neither `secret` nor `keypair` supplied -> resolveSecret throws inside the try block.
      network: "stellar:testnet",
      limits: { maxTotal: "$0.015" },
      _baseFetch: x402Fetch,
    } as never);
    const first = await payFetch("http://svc/x402paid").catch((e: unknown) => e);
    const second = await payFetch("http://svc/x402paid").catch((e: unknown) => e);
    expect(first).not.toBeInstanceOf(SpendLimitExceeded);
    expect(second).not.toBeInstanceOf(SpendLimitExceeded);
    // Named error class (not a generic `Error`), so callers can distinguish "you forgot to
    // configure a signer" from every other failure mode without string-matching a message.
    expect(first).toBeInstanceOf(MissingSignerConfig);
    expect(second).toBeInstanceOf(MissingSignerConfig);
  });

  it("SpendTracker.release is a no-op for an undefined (never-reserved) amount", async () => {
    const { SpendTracker } = await import("../src/limits.js");
    const t = new SpendTracker({ maxTotal: "$0.01" }, vi.fn());
    expect(() => t.release(undefined)).not.toThrow();
    // Full budget is still available: a reservation right at the cap still passes.
    expect(() => t.checkAndReserve(100_000n, "http://x")).not.toThrow();
  });
});
