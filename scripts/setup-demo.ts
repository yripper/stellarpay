/**
 * Idempotent demo-identity provisioning/verification (spec §6). Reads the same .env the
 * smoke test uses (SMOKE_* names — the demo services map them to DEMO_* at deploy time).
 * NEVER prints a secret: accounts are only ever referenced by public key.
 *
 * - Ensures buyer + payTo accounts exist (friendbot-funds missing ones).
 * - Reports XLM and USDC balances per account.
 * - If DEMO_USDC_ISSUER is set and the buyer lacks that trustline: builds a ChangeTrust,
 *   signs with the buyer, submits fee-free via OZ Channels (submitViaChannels).
 * - The USDC faucet step cannot be automated: a zero balance prints instructions instead.
 */
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { submitViaChannels } from "@stellarpay-sdk/shared";

try {
  process.loadEnvFile();
} catch (err) {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  if (code !== "ENOENT") throw err;
}

const HORIZON = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const CHANNELS_URL = "https://channels.openzeppelin.com/testnet";

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});

type AccountState = { exists: boolean; xlm: string; usdcLines: Array<{ issuer: string; balance: string }> };

async function loadAccount(pub: string): Promise<AccountState> {
  const res = await fetch(`${HORIZON}/accounts/${pub}`);
  if (res.status === 404) return { exists: false, xlm: "0", usdcLines: [] };
  if (!res.ok) throw new Error(`Horizon error ${res.status} for ${pub}`);
  const data = asRec(await res.json());
  const balances = Array.isArray(data["balances"]) ? data["balances"].map(asRec) : [];
  const native = balances.find((b) => b["asset_type"] === "native");
  const usdcLines = balances
    .filter((b) => b["asset_code"] === "USDC" && typeof b["asset_issuer"] === "string")
    .map((b) => ({ issuer: b["asset_issuer"] as string, balance: String(b["balance"] ?? "0") }));
  return { exists: true, xlm: String(native?.["balance"] ?? "0"), usdcLines };
}

async function friendbot(pub: string): Promise<void> {
  console.log(`  funding ${pub.slice(0, 6)}… via friendbot`);
  const res = await fetch(`https://friendbot.stellar.org?addr=${pub}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot failed (${res.status})`); // 400 = already funded
}

async function facilitatorKey(): Promise<string> {
  const fromEnv = process.env["SMOKE_FACILITATOR_KEY"] || process.env["DEMO_FACILITATOR_KEY"];
  if (fromEnv) return fromEnv;
  const res = await fetch(`${CHANNELS_URL}/gen`);
  if (!res.ok) throw new Error(`facilitator /gen failed (${res.status})`);
  const body = (await res.json()) as { apiKey?: string };
  if (!body.apiKey) throw new Error("facilitator /gen returned no apiKey");
  return body.apiKey;
}

async function establishTrustline(buyer: Keypair, issuer: string): Promise<void> {
  console.log(`  establishing USDC trustline (issuer ${issuer.slice(0, 6)}…) via OZ Channels`);
  const res = await fetch(`${HORIZON}/accounts/${buyer.publicKey()}`);
  if (!res.ok) throw new Error(`Horizon error ${res.status} for ${buyer.publicKey()}`);
  const data = asRec(await res.json());
  const account = new Account(buyer.publicKey(), String(data["sequence"]));
  const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", issuer) }))
    .setTimeout(30) // Channels rejects longer timebounds (INVALID_TIME_BOUNDS)
    .build();
  tx.sign(buyer);
  const hash = await submitViaChannels({ channelsUrl: CHANNELS_URL, apiKey: await facilitatorKey(), signedXdr: tx.toXDR(), rpcUrl: RPC_URL });
  console.log(`  trustline established: https://stellar.expert/explorer/testnet/tx/${hash}`);
}

async function main(): Promise<void> {
  const buyerSecret = process.env["SMOKE_BUYER_SECRET"] || process.env["DEMO_BUYER_SECRET"];
  const payTo = process.env["SMOKE_PAYTO"] || process.env["DEMO_PAYTO"];
  if (!buyerSecret || !payTo) {
    console.error("Missing SMOKE_BUYER_SECRET/SMOKE_PAYTO (or DEMO_* equivalents) — copy .env.example to .env first.");
    process.exit(1);
  }
  const buyer = Keypair.fromSecret(buyerSecret);
  const rows: Array<{ name: string; pub: string; state: AccountState }> = [];

  for (const [name, pub] of [
    ["buyer", buyer.publicKey()],
    ["payTo", payTo],
  ] as const) {
    let state = await loadAccount(pub);
    if (!state.exists) {
      await friendbot(pub);
      state = await loadAccount(pub);
    }
    rows.push({ name, pub, state });
  }

  const buyerState = rows[0]!.state;
  const issuer = process.env["DEMO_USDC_ISSUER"];
  // Only a genuine establishTrustline failure sets this — not env-gated, and trustline already
  // present, are both success (skipping isn't failing). Mirrors scripts/smoke.ts's exitCode
  // pattern (smoke.ts:298-302): the shell must see a real failure even though the operator
  // already saw the full picture printed below.
  let trustlineFailed = false;
  if (issuer && !buyerState.usdcLines.some((l) => l.issuer === issuer)) {
    // Same degrade-gracefully pattern as scripts/smoke.ts's runLeg (smoke.ts:194-209): a
    // live OZ Channels submission is exactly the kind of risky network call that shouldn't
    // crash the whole script with a raw stack trace — print what's wrong and keep going so
    // the balances table (and the manual-faucet fallback below) still render.
    try {
      await establishTrustline(buyer, issuer);
      rows[0]!.state = await loadAccount(buyer.publicKey());
    } catch (err) {
      // Deliberate: log only err.message, never the raw error object. A PluginTransportError
      // from @openzeppelin/relayer-plugin-channels can carry the underlying axios error on
      // errorDetails, which embeds the Channels API key in config.headers.Authorization —
      // logging the raw error would leak that credential.
      console.error(`  trustline establishment failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(
        "  Re-run to retry. If it keeps failing, check https://status.channels.openzeppelin.com, or establish\n" +
          "  the trustline yourself (e.g. `stellar tx new change-trust`) — the buyer's secret never leaves this machine.",
      );
      trustlineFailed = true;
    }
  }

  console.log("\n=== demo identities ===");
  for (const { name, pub, state } of rows) {
    const usdc = state.usdcLines.map((l) => `${l.balance} USDC (${l.issuer.slice(0, 6)}…)`).join(", ") || "no USDC trustline";
    console.log(`  ${state.exists ? "✅" : "⚠️"} ${name.padEnd(6)} ${pub}  XLM: ${state.xlm}  ${usdc}`);
  }

  const funded = rows[0]!.state.usdcLines.some((l) => Number(l.balance) > 0);
  if (!funded) {
    console.log(`
⚠️  The buyer holds no testnet USDC — the paid demos need some. This step is manual (spec §6):
  1. If it lacks a trustline: set DEMO_USDC_ISSUER in .env to your chosen testnet USDC issuer
     and re-run this script (it will establish the trustline fee-free via OZ Channels).
  2. Mint/receive testnet USDC from that issuer's faucet flow.
  The SEP-41 contract the SDK settles against (USDC_SAC_TESTNET): ${USDC_SAC_TESTNET}
`);
  } else {
    console.log("\nAll set — run `pnpm smoke` for a full paid round-trip before demoing.");
  }

  process.exit(trustlineFailed ? 1 : 0);
}

await main();
