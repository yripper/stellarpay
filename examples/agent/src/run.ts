import type { Narrator } from "./narrate.js";
import type { Scope } from "./economy.js";

export type MissionResult = {
  mode: "claude" | "scripted";
  /** Claude's closing text, when the Claude path ran and produced one. `/chat` replies with it. */
  brief?: string;
};

/**
 * One mission run. The judge's button must always produce visible payments (spec §4.6):
 * Claude-path failure of ANY kind degrades to the deterministic scripted tour, and a
 * scripted failure is narrated rather than thrown.
 */
export async function runMission(deps: {
  mission: string;
  narrate: Narrator;
  runClaude: (() => Promise<string | undefined>) | undefined;
  runScripted: () => Promise<void>;
}): Promise<MissionResult> {
  deps.narrate(`Mission: ${deps.mission}`);
  if (deps.runClaude) {
    try {
      const brief = await deps.runClaude();
      deps.narrate("Mission complete (mode: claude).");
      return brief === undefined ? { mode: "claude" } : { mode: "claude", brief };
    } catch (err) {
      deps.narrate(`Claude path failed (${err instanceof Error ? err.message : String(err)}) — running the scripted tour instead.`);
    }
  } else {
    deps.narrate("No ANTHROPIC_API_KEY configured — running the scripted tour.");
  }
  try {
    await deps.runScripted();
    deps.narrate("Mission complete (mode: scripted).");
  } catch (err) {
    deps.narrate(`Scripted tour failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { mode: "scripted" };
}

export const MISSIONS = [
  "Produce a market brief on USDC on Stellar testnet: supply, holders, market depth, and current network conditions.",
  "Assess my own wallet's position and the current whale activity on testnet — anything notable moving?",
  "How congested is the Stellar testnet right now, and what are the biggest payments flowing through it?",
] as const;

/**
 * Per-service missions for a scoped run. A scoped run can only buy from one seller, so the
 * unscoped MISSIONS above (which ask for market depth *and* congestion *and* whales) would
 * send Claude looking for tools that aren't in its scoped economy. Each mission here asks only
 * for what its own service actually sells — see `buildEconomy`'s descriptions.
 */
const SCOPED_MISSIONS: Record<Exclude<Scope, "all">, string> = {
  "express-api": "Profile USDC on testnet and my own wallet account, using only express-api's paid endpoints.",
  "hono-api": "What are the largest payments moving on Stellar testnet right now?",
  "fastify-api": "How congested is Stellar testnet right now, and what does it cost to transact?",
  "mcp-server": "Summarize my wallet and recent whale activity using the paid MCP tools.",
};

/** The mission for a run. Unscoped runs rotate through MISSIONS; scoped runs get their own. */
export function missionFor(scope: Scope, rotation: number): string {
  if (scope === "all") return MISSIONS[rotation % MISSIONS.length] as string;
  return SCOPED_MISSIONS[scope];
}
