import { serve } from "@hono/node-server";
import { Keypair } from "@stellar/stellar-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createPayingFetch, type PayEvent } from "@stellarpay-sdk/client";
import { payingHttpTransport, wrapPaidMcpClient } from "@stellarpay-sdk/mcp";
import { NETWORKS } from "@stellarpay-sdk/core";
import { readEnv } from "./env.js";
import { createNarrator } from "./narrate.js";
import { buildEconomy, scopeEconomy, scriptedTour, type Scope } from "./economy.js";
import { runClaudeMission } from "./claude.js";
import { missionFor, runMission } from "./run.js";
import { buildApp } from "./server.js";

const env = readEnv();
const narrate = createNarrator({ dashboardUrl: env.dashboardUrl, ingestSecret: env.ingestSecret });

/**
 * Parses DEMO_BUYER_SECRET behind a guarded path, same posture as readEnv()'s presence
 * check: on a malformed secret (wrong length, bad checksum, not S...), name the offending
 * var and exit 1 — never let @stellar/stellar-sdk's bare "invalid encoded string" crash-loop
 * the service with no indication of which env var to fix. Never logs the value itself.
 */
function readBuyerKeypair(secret: string): Keypair {
  try {
    return Keypair.fromSecret(secret);
  } catch {
    console.error("DEMO_BUYER_SECRET is not a valid Stellar secret key — check the value in your env and try again.");
    process.exit(1);
  }
}

const buyerPublicKey = readBuyerKeypair(env.buyerSecret).publicKey();
const rpcUrl = NETWORKS["stellar:testnet"].rpcUrl;

const LIMITS = { maxPerCall: "$0.05", maxTotal: "$0.25" } as const; // per run — load-bearing demo copy (spec §4.6)

let running = false;
let missionCounter = 0;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** The path a PayEvent's URL points at — the readable half of a settlement line. */
const routeOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

type McpLeg = { call: (tool: string, args: Record<string, unknown>) => Promise<unknown>; close: () => Promise<void> };

/**
 * Connects the paying MCP client for one run. A connection failure degrades the run to the
 * three HTTP sellers instead of ending it — `buildEconomy` then omits the MCP buyables
 * entirely, so neither Claude nor the scripted tour is offered a tool that cannot work.
 */
async function connectMcp(payingFetch: typeof fetch): Promise<McpLeg | undefined> {
  const base = new Client({ name: "stellarpay-agent", version: "0.1.0" });
  try {
    // JSON-RPC -32042 challenges are paid by wrapPaidMcpClient; payingHttpTransport only
    // carries the HTTP leg (this server has no HTTP-level paywall).
    await base.connect(payingHttpTransport(`${env.mcpServerUrl}/mcp`, payingFetch));
  } catch (err) {
    narrate(`MCP server unreachable (${message(err)}) — buying from the HTTP services only this run.`);
    return undefined;
  }
  const paid = wrapPaidMcpClient(base, { secret: env.buyerSecret, network: "stellar:testnet", rpcUrl });
  return { call: (tool, args) => paid.callTool({ name: tool, arguments: args }), close: () => base.close() };
}

/**
 * One mission. `scope` narrows which sellers the agent may buy from; `ask` replaces the
 * rotating mission with a visitor's own question (the /chat path). Returns Claude's closing
 * text so /chat can answer with it — /run ignores the return value and lets the feed narrate.
 */
async function oneRun(opts: { scope: Scope; ask?: string }): Promise<string | undefined> {
  const mission = opts.ask ?? missionFor(opts.scope, missionCounter);
  if (!opts.ask) missionCounter += 1;
  let paidCount = 0;
  // Fresh payingFetch per run: spend limits reset each mission (spec §4.6 "per run").
  const payingFetch = createPayingFetch({
    secret: env.buyerSecret,
    network: "stellar:testnet",
    rpcUrl,
    limits: LIMITS,
    onEvent: (e: PayEvent) => {
      if (e.type === "paid") {
        paidCount += 1;
        narrate(`Settled on-chain via ${e.protocol}: ${routeOf(e.url)} — ${paidCount} paid HTTP calls this run.`);
      }
      if (e.type === "blocked") narrate(`Spend limit refused a payment (${e.reason}) for ${routeOf(e.url)} — the guardrails are real.`);
    },
  });

  // Scoped runs that exclude mcp-server skip the MCP connection entirely — it costs a network
  // round-trip and a "MCP server unreachable" feed line that has nothing to do with the run.
  const needsMcp = opts.scope === "all" || opts.scope === "mcp-server";
  const mcp = needsMcp ? await connectMcp(payingFetch) : undefined;
  const economy = scopeEconomy(
    buildEconomy({
      payingFetch,
      urls: { express: env.expressApiUrl, hono: env.honoApiUrl, fastify: env.fastifyApiUrl },
      ...(mcp ? { mcpCall: mcp.call } : {}),
      buyerPublicKey,
    }),
    opts.scope,
  );
  if (economy.length === 0) {
    narrate(`Nothing to buy from ${opts.scope} this run — its paid endpoints are unavailable.`);
    if (mcp) await mcp.close().catch(() => undefined);
    return undefined;
  }

  // Truthful scope: the limits are enforced by @stellarpay-sdk/client, which sees the HTTP
  // purchases only — MCP tool payments settle through the MCP client's own leg.
  narrate(`Budget this run: ${LIMITS.maxPerCall} per paid HTTP call, ${LIMITS.maxTotal} total (testnet USDC).`);
  if (opts.scope !== "all") narrate(`Scoped to ${opts.scope}: ${economy.length} paid ${economy.length === 1 ? "endpoint" : "endpoints"} available.`);
  const apiKey = env.anthropicApiKey;
  const result = await runMission({
    mission,
    narrate,
    runClaude: apiKey ? () => runClaudeMission({ apiKey, model: env.anthropicModel, mission, economy, narrate }) : undefined,
    runScripted: () => scriptedTour(economy, narrate),
  });
  narrate(`Run finished in ${result.mode} mode: ${paidCount} paid HTTP calls settled on Stellar testnet.`);
  if (mcp) await mcp.close().catch(() => undefined);
  return result.brief;
}

/** Fire-and-forget: the caller gets 202 and watches the feed. One run at a time, process-wide. */
function startRun(scope: Scope): boolean {
  if (running) return false;
  running = true;
  void oneRun({ scope })
    .catch((err) => narrate(`Run crashed: ${message(err)}`))
    .finally(() => {
      running = false;
    });
  return true;
}

/**
 * Awaited variant behind /chat: the visitor's question IS the mission, and they get the answer
 * back in the response body. Shares the same single-run mutex as {@link startRun} so a chat and
 * a button press can never spend from the same wallet concurrently.
 */
async function askAgent(opts: { scope: Scope; question: string }): Promise<{ reply: string } | { busy: true }> {
  if (running) return { busy: true };
  running = true;
  try {
    const brief = await oneRun({ scope: opts.scope, ask: opts.question });
    return { reply: brief ?? "I ran the mission but didn't produce a written answer — the feed shows what I bought." };
  } catch (err) {
    narrate(`Chat run crashed: ${message(err)}`);
    return { reply: `That run failed: ${message(err)}` };
  } finally {
    running = false;
  }
}

serve({ fetch: buildApp({ ingestSecret: env.ingestSecret, startRun, askAgent }).fetch, port: env.port }, (info) => {
  console.log(`stellarpay agent listening on :${info.port}`);
});

// Boot-time run so the feed is never empty when judges first open the dashboard (spec §4.6).
setTimeout(() => {
  startRun("all");
}, 5000);
