import type { Narrator } from "./narrate.js";

export type MissionResult = { mode: "claude" | "scripted" };

/**
 * One mission run. The judge's button must always produce visible payments (spec §4.6):
 * Claude-path failure of ANY kind degrades to the deterministic scripted tour, and a
 * scripted failure is narrated rather than thrown.
 */
export async function runMission(deps: {
  mission: string;
  narrate: Narrator;
  runClaude: (() => Promise<void>) | undefined;
  runScripted: () => Promise<void>;
}): Promise<MissionResult> {
  deps.narrate(`Mission: ${deps.mission}`);
  if (deps.runClaude) {
    try {
      await deps.runClaude();
      deps.narrate("Mission complete (mode: claude).");
      return { mode: "claude" };
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
