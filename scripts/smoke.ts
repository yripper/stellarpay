/**
 * Testnet smoke test for stellarpay.
 *
 * Boots a REAL `@hono/node-server` HTTP server (not a mocked `app.request()` call — this
 * is the one place in the SDK that talks to a live Stellar testnet facilitator + Soroban
 * RPC) exposing one x402 route and one mpp-charge route, then drives both legs end-to-end
 * through `createPayingFetch`. Every `PayEvent` and the server's `onPayment` receipts are
 * printed verbatim — that is this task's whole purpose: confirming the shape of the two
 * "opaque until the smoke run confirms them" wire payloads referenced in
 * `packages/core/src/schemes/x402.ts` (the x402 facilitator `SettleResponse`) and
 * `packages/core/src/schemes/mppCharge.ts` (the mppx `Payment-Receipt` header).
 *
 * Server choice: `@hono/node-server`'s `serve({ fetch: app.fetch, port })` over hand-rolled
 * `node:http`, because it already turns Node's `IncomingMessage`/`ServerResponse` into the
 * web-standard `Request`/`Response` pair `stellarpayHono` (and the rest of this SDK) is
 * built on — reimplementing that translation in this script would just be a worse copy of
 * what `@hono/node-server` already does. It ships in this monorepo's lockfile already, as
 * a transitive dependency of `@modelcontextprotocol/sdk` (see `pnpm-lock.yaml`), pinned to
 * `hono@4.12.33`; it is added here as an explicit root devDependency rather than relying on
 * that transitive pin.
 *
 * DO NOT run this against secrets you don't control: `SMOKE_BUYER_SECRET` signs and
 * broadcasts real testnet transactions, and (if set) `SMOKE_SPONSOR_SECRET` pays their fees.
 */
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { stellarpayHono } from "@stellarpay/hono";
import { createPayingFetch, type PayEvent } from "@stellarpay/client";
import type { Receipt, StellarpayConfig } from "@stellarpay/core";
import { NETWORKS } from "@stellarpay/shared";

// --- env ---------------------------------------------------------------------------------

// Node 22+ built-in `.env` loader — no `dotenv` dependency. Guarded: a missing `.env` is
// fine (CI/shell-exported env vars still work), anything else would be surprising so it
// is re-thrown. Runs before any env var is read below, so a `.env`-provided SMOKE_PORT (or
// any other var) is visible everywhere.
try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

const NETWORK = "stellar:testnet" as const;
const DEFAULT_PORT = 4402;

/** Parses `SMOKE_PORT`; falls back to `DEFAULT_PORT` (with a warning) for anything invalid. */
function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.error(`Invalid SMOKE_PORT "${raw}" — must be an integer between 1 and 65535. Falling back to ${DEFAULT_PORT}.`);
    return DEFAULT_PORT;
  }
  return parsed;
}

const PORT = parsePort(process.env["SMOKE_PORT"]);
const BASE_URL = `http://localhost:${PORT}`;
// Wired explicitly (not left to library defaults) per this task's brief: the x402 leg's
// `ExactStellarScheme` and the mpp leg's `stellar.charge` client both need Soroban RPC —
// see `packages/client/src/x402Leg.ts:12` and `packages/client/src/mppLeg.ts:108`.
const RPC_URL = NETWORKS[NETWORK].rpcUrl;

type SmokeEnv = {
  buyerSecret: string;
  payTo: string;
  mppSecret: string;
  sponsorSecret: string | undefined;
};

/** Reads and validates the required env vars. `undefined` means "print setup instructions and stop". */
function readEnv(): SmokeEnv | undefined {
  const buyerSecret = process.env["SMOKE_BUYER_SECRET"];
  const payTo = process.env["SMOKE_PAYTO"];
  const mppSecret = process.env["SMOKE_MPP_SECRET"];
  if (!buyerSecret || !payTo || !mppSecret) return undefined;
  return { buyerSecret, payTo, mppSecret, sponsorSecret: process.env["SMOKE_SPONSOR_SECRET"] || undefined };
}

/** Lists exactly which required vars are missing, without ever echoing a set secret's value. */
function missingVars(): string[] {
  const required = ["SMOKE_BUYER_SECRET", "SMOKE_PAYTO", "SMOKE_MPP_SECRET"];
  return required.filter((name) => !process.env[name]);
}

function printSetupInstructions(): void {
  console.error(`stellarpay testnet smoke test — missing required environment variable(s): ${missingVars().join(", ")}

Copy .env.example to .env and fill it in, then re-run \`pnpm smoke\`:
  SMOKE_BUYER_SECRET   Stellar secret seed (S...) for the paying account.
  SMOKE_PAYTO          Stellar public key (G...) that receives payments.
  SMOKE_MPP_SECRET     HMAC secret for the mpp-charge server (any string).
  SMOKE_SPONSOR_SECRET Optional: secret seed (S...) of a sponsor account that pays the
                        mpp leg's transaction fee (adds sponsorGas to the /mpp route).

Setup for a fresh buyer account:
  1. Generate a keypair, e.g. \`stellar keys generate smoke-buyer --network testnet\` or
     \`Keypair.random()\` from @stellar/stellar-sdk. Use its secret as SMOKE_BUYER_SECRET.
  2. Fund it with testnet XLM via friendbot (needed for tx fees and to open the account):
       https://friendbot.stellar.org?addr=G...   (use your buyer's public key)
  3. The buyer also needs testnet USDC: both routes below are priced in dollars, settled
     in the testnet USDC SEP-41 token contract (Stellar Asset Contract). Its address —
     @stellar/mpp's USDC_SAC_TESTNET — is:
       ${USDC_SAC_TESTNET}
     Establish a trustline to it and fund the account (check your testnet USDC issuer's
     faucet docs for the trustline + minting flow; a classic-asset trustline via the
     issuer is typically required upstream of the SAC wrapper).
  4. SMOKE_PAYTO can be any Stellar account (G...) you want to receive the payment — it
     does not need to be pre-funded to receive one.
`);
}

// --- printing ------------------------------------------------------------------------------

/** Every PayEvent field is protocol/url/reason/message metadata — never a secret. */
function printEvent(who: "buyer", e: PayEvent): void {
  console.log(`  [${who}] ${JSON.stringify(e)}`);
}

/**
 * Prints a settlement receipt's known fields plus the RAW upstream payload verbatim.
 * `raw` is public, post-settlement chain data (a facilitator SettleResponse / an mppx
 * Payment-Receipt header) — never a secret — and printing it verbatim is this task's point.
 */
function printReceipt(receipt: Receipt | undefined): void {
  if (!receipt) {
    console.log("  receipt: (none — onPayment did not fire for this route)");
    return;
  }
  console.log(`  receipt.scheme:  ${receipt.scheme}`);
  console.log(`  receipt.route:   ${receipt.route}`);
  console.log(`  receipt.amount:  ${receipt.amount} ${receipt.asset}`);
  console.log(`  receipt.txHash:  ${receipt.txHash ?? "(absent)"}`);
  console.log(`  receipt.payer:   ${receipt.payer ?? "(absent)"}`);
  console.log("  receipt.raw (verbatim):");
  console.log(`    ${receipt.raw ?? "(absent)"}`);
}

// --- leg runner ------------------------------------------------------------------------------

type LegResult = { name: string; pass: boolean };

/**
 * Runs one paid GET through `payingFetch`, prints its outcome, and reports pass/fail.
 * A "pass" requires both a 2xx response AND a captured server-side receipt for `routePattern`
 * — a 2xx with no receipt would mean the request slipped through without actually paying.
 */
async function runLeg(
  name: string,
  path: string,
  routePattern: string,
  payingFetch: typeof fetch,
  receipts: Receipt[],
): Promise<LegResult> {
  console.log(`\n=== ${name} leg: GET ${path} ===`);
  try {
    const res = await payingFetch(`${BASE_URL}${path}`);
    const body = await res.text();
    console.log(`  response status: ${res.status}`);
    console.log(`  response body:   ${body}`);

    const receipt = receipts.filter((r) => r.route === routePattern).at(-1);
    printReceipt(receipt);

    const pass = res.ok && receipt !== undefined;
    console.log(`  ${name}: ${pass ? "PASS" : "FAIL"}`);
    return { name, pass };
  } catch (err) {
    console.error(`  ${name}: FAIL — ${err instanceof Error ? err.message : String(err)}`);
    return { name, pass: false };
  }
}

// --- server lifecycle ------------------------------------------------------------------------------

/**
 * Starts the smoke server and resolves only once it is actually listening — callers must
 * not fire requests before this resolves, or they'd race the socket accepting connections
 * (the earlier version of this script logged "listening" immediately after calling `serve()`,
 * before the underlying `server.listen()` callback had actually fired).
 *
 * A listen failure — most commonly EADDRINUSE from a stale smoke server left running on the
 * same port from a prior interrupted run — is fatal: printed with an actionable fix and
 * `process.exit(1)`'d directly here (rather than rejecting the promise), so callers don't
 * need their own catch/exit boilerplate. `@hono/node-server`'s `serve()` installs no error
 * listener of its own, so without this an EADDRINUSE would surface as a raw uncaught
 * 'error' event stack instead.
 */
function startServer(app: Hono, port: number): Promise<ServerType> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`stellarpay smoke server listening on http://localhost:${info.port} (network: ${NETWORK}, rpcUrl: ${RPC_URL})`);
      resolve(server);
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `\nPort ${port} is already in use — kill the stale smoke server (or whatever else is bound to it), or set SMOKE_PORT to a free port and retry.`,
        );
      } else {
        console.error(`\nstellarpay smoke server failed to start: ${err.message}`);
      }
      process.exit(1);
    });
  });
}

// --- main ------------------------------------------------------------------------------

async function main(): Promise<void> {
  const env = readEnv();
  if (!env) {
    printSetupInstructions();
    process.exit(1);
  }

  const receipts: Receipt[] = [];

  const config: StellarpayConfig = {
    network: NETWORK,
    payTo: env.payTo,
    mppSecretKey: env.mppSecret,
    rpcUrl: RPC_URL,
    routes: {
      "GET /x402": { price: "$0.001" }, // scheme defaults to "x402"
      "GET /mpp": { price: "$0.001", scheme: "mpp-charge", ...(env.sponsorSecret ? { sponsorGas: true } : {}) },
    },
    ...(env.sponsorSecret ? { sponsorSecret: env.sponsorSecret } : {}),
    onPayment: (receipt) => {
      receipts.push(receipt);
      console.log(`\n  [server] onPayment fired for ${receipt.route}`);
    },
  };

  const app = new Hono();
  app.use("*", stellarpayHono(config));
  app.get("/x402", (c) => c.json({ ok: true, route: "x402" }));
  app.get("/mpp", (c) => c.json({ ok: true, route: "mpp" }));

  const server = await startServer(app, PORT);

  const payingFetch = createPayingFetch({
    secret: env.buyerSecret,
    network: NETWORK,
    rpcUrl: RPC_URL,
    onEvent: (e) => printEvent("buyer", e),
  });

  const results: LegResult[] = [
    await runLeg("x402", "/x402", "GET /x402", payingFetch, receipts),
    await runLeg("mpp", "/mpp", "GET /mpp", payingFetch, receipts),
  ];

  console.log("\n=== Summary ===");
  for (const r of results) console.log(`  ${r.name}: ${r.pass ? "PASS" : "FAIL"}`);

  const exitCode = results.every((r) => r.pass) ? 0 : 1;
  // Explicit exit rather than relying on the event loop draining: fetch's keep-alive
  // connection pool can otherwise hold the process open well past the last `console.log`.
  server.close();
  process.exit(exitCode);
}

await main();
