import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { x402Version } from "@x402/core";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import type { Receipt } from "../src/index.js";
import { stellarpay } from "../src/index.js";

const FACILITATOR_URL = "https://mock-facilitator.test/x402";

const cfg = {
  network: "stellar:testnet" as const,
  payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  routes: { "GET /paid": { price: "$0.01" } },
  facilitatorUrl: FACILITATOR_URL,
};

// Same rationale as packages/core/test/x402.test.ts: `@x402/core/schemas`'s public exports do not
// include a `SupportedResponse` zod schema (verified: no "Supported" symbol in
// node_modules/@x402/core/dist/esm/schemas/index.d.mts's export list), so this stub is typed
// against the public `SupportedResponse` TS type from `@x402/core/types` instead of hand-crafted JSON.
const supportedResponse: SupportedResponse = {
  kinds: [{ x402Version, scheme: "exact", network: cfg.network }],
  extensions: [],
  signers: {},
};

const FAKE_TX_HASH = "fake-settlement-tx-hash-0001";

describe("x402 end-to-end (mocked settlement)", () => {
  let payerAddress: string;
  let verifyResponse: VerifyResponse;
  let settleResponse: SettleResponse;

  beforeEach(() => {
    payerAddress = Keypair.random().publicKey();

    // `@x402/core/schemas` also does not export zod schemas for `/verify` or `/settle` response
    // bodies (verified: no "Verify"/"Settle" symbol in the same export list). The schemas actually
    // used at runtime (`verifyResponseSchema`, `settleResponseSchema`) live in
    // node_modules/@x402/core/dist/esm/chunk-4Y6I6537.mjs:774-792 and are internal, not exported
    // from any subpath. So, like the `/supported` stub above, these are typed against the public
    // `VerifyResponse`/`SettleResponse` TS types from `@x402/core/types` — the mock can't drift
    // from upstream shapes even without a zod schema to parse against.
    verifyResponse = { isValid: true, payer: payerAddress };
    settleResponse = { success: true, transaction: FAKE_TX_HASH, network: cfg.network, payer: payerAddress };

    // Intercept only facilitator-URL requests; anything else fails loudly (no silent network).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(FACILITATOR_URL)) throw new Error(`unexpected fetch in test: ${url}`);
        if (url.endsWith("/supported")) return new Response(JSON.stringify(supportedResponse), { status: 200 });
        if (url.endsWith("/verify")) return new Response(JSON.stringify(verifyResponse), { status: 200 });
        if (url.endsWith("/settle")) return new Response(JSON.stringify(settleResponse), { status: 200 });
        throw new Error(`unexpected fetch in test: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unpaid → 402 challenge; header-carrying retry → verified, settled, passed", async () => {
    const onPayment = vi.fn<(receipt: Receipt) => void>();
    const pay = stellarpay({ ...cfg, onPayment });

    const first = await pay.handle(new Request("http://svc/paid"));
    expect(first?.status).toBe(402);
    const header = first!.headers.get("PAYMENT-REQUIRED")!;
    expect(header).toBeTruthy();

    const paymentRequired: PaymentRequired = decodePaymentRequiredHeader(header);
    const requirements = paymentRequired.accepts[0];
    if (!requirements) throw new Error("test setup: challenge declared no accepted payment requirements");

    // Build a syntactically valid PAYMENT-SIGNATURE using @x402/stellar's building blocks (a
    // random Ed25519 signer), without driving the real client scheme's `createPaymentPayload()`.
    // That method (@x402/stellar/dist/esm/chunk-SOJRTSRS.mjs:36-94, reached via
    // `ExactStellarScheme` from `@x402/stellar/exact/client`) calls Soroban RPC
    // (`getLatestLedger`/`simulateTransaction` through `contract.AssembledTransaction.build`) to
    // assemble and simulate the transfer transaction. This installed `@stellar/stellar-sdk` build
    // always routes RPC calls through axios rather than the global `fetch` this test stubs (see
    // `node_modules/@stellar/stellar-sdk/lib/no-eventsource/http-client/index.js`'s unconditional
    // `if (true)` branch selecting `axios-client.js`), so that call can't be intercepted the same
    // way as the facilitator without pulling in an axios-mocking dependency. Per the task brief
    // this falls back to approach (b): construct the `PaymentPayload` directly. That's safe here
    // because nothing on the resource-server side inspects `payload` content —
    // `decodePaymentSignatureHeader` is a bare base64+JSON.parse (chunk-4Y6I6537.mjs:1245-1250),
    // and verification/settlement are both fully delegated to the (mocked) facilitator HTTP client
    // (server/index.mjs's `verifyPayment`/`settlePayment`, ~723-1009) with no local scheme-specific
    // crypto check. Only `accepted` must structurally match a requirement the challenge declared —
    // which it does here by construction, reusing the requirement verbatim.
    const signer = createEd25519Signer(Keypair.random().secret());
    const paymentPayload: PaymentPayload = {
      x402Version,
      accepted: requirements,
      payload: { transaction: `stub-signed-xdr:${signer.address}` },
    };

    const second = await pay.handle(
      new Request("http://svc/paid", {
        headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(paymentPayload) },
      }),
    );

    expect(second).toBeUndefined();
    expect(onPayment).toHaveBeenCalledTimes(1);
    const receipt = onPayment.mock.calls[0]?.[0];
    expect(receipt).toBeDefined();
    expect(receipt?.scheme).toBe("x402");
    expect(receipt?.route).toBe("GET /paid");
    expect(receipt?.network).toBe("stellar:testnet");
    expect(receipt?.amount).toBe("0.01");
    expect(receipt?.asset).toBe("USDC");
    // Settlement fields are read straight off the (mocked) facilitator's /settle response body —
    // see packages/core/src/schemes/x402.ts:45-48.
    expect(receipt?.txHash).toBe(FAKE_TX_HASH);
    expect(receipt?.payer).toBe(payerAddress);
    const raw = JSON.parse(receipt?.raw ?? "{}") as Record<string, unknown>;
    expect(raw["success"]).toBe(true);
    expect(raw["transaction"]).toBe(FAKE_TX_HASH);
  });
});
