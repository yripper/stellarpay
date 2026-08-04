import Anthropic from "@anthropic-ai/sdk";
import { describeBuyFailure, type Buyable } from "./economy.js";
import type { Narrator } from "./narrate.js";

const MAX_TURNS = 8;
const MAX_BRIEF_LENGTH = 400;

/**
 * Truncates the closing brief to at most `maxLen` characters, breaking on the last word
 * boundary rather than mid-word, and appending an ellipsis when it truncates. A bare
 * `.slice(0, N)` can cut a word — and, since this is the demo's centerpiece closing line on
 * camera, the whole sentence — in half with no indication anything was cut. Pure; unit-tested
 * directly (`test/claude.test.ts`).
 */
export function truncateBrief(text: string, maxLen: number = MAX_BRIEF_LENGTH): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  const boundary = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${boundary}…`;
}

/**
 * Mission-driven buying loop: Claude picks which intel to buy via tool use. Each Buyable
 * becomes a no-argument tool (the economy closes over its own parameters).
 *
 * Verified against the installed `@anthropic-ai/sdk` 0.57.0 `.d.ts` (this task's Step 1):
 * the default export is the `Anthropic` client class taking `{ apiKey }`
 * (`client.d.ts:203,26`); `client.messages.create(body)` without `stream` resolves to the
 * non-streaming overload returning `APIPromise<Message>`
 * (`resources/messages/messages.d.ts:29`); `Message.content` is `Array<ContentBlock>` with
 * `TextBlock`/`ToolUseBlock` members (`messages.d.ts:138,431,651`); and `stop_reason` is
 * `StopReason | null` where `StopReason` is `'end_turn' | 'max_tokens' | 'stop_sequence' |
 * 'tool_use' | 'pause_turn' | 'refusal'` (`messages.d.ts:430`) — only `'tool_use'` continues
 * the loop, every other value (including the two the brief did not anticipate) ends it.
 */
export async function runClaudeMission(opts: {
  apiKey: string;
  model: string;
  mission: string;
  economy: Buyable[];
  narrate: Narrator;
}): Promise<void> {
  const anthropic = new Anthropic({ apiKey: opts.apiKey });
  const tools = opts.economy.map((b) => ({
    name: b.name,
    description: b.description,
    input_schema: { type: "object" as const, properties: {} },
  }));
  const byName = new Map(opts.economy.map((b) => [b.name, b]));

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${opts.mission}\n\nBuy only what the mission needs — every tool call spends real (testnet) money from your budget. When done, reply with a short plain-text brief of your findings.`,
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system:
        "You are an autonomous market-intel buyer on the Stellar testnet with a funded wallet and hard spend limits. You pay per API/tool call via the x402 and MPP payment protocols (handled automatically).",
      messages,
      tools,
    });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ");
      opts.narrate(`Brief: ${finalText ? truncateBrief(finalText) : "(no text returned)"}`);
      return;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const buyable = byName.get(use.name);
      if (!buyable) {
        results.push({ type: "tool_result", tool_use_id: use.id, content: "No such tool in this economy.", is_error: true });
        continue;
      }
      opts.narrate(`Claude decided to buy ${buyable.name} from ${buyable.service} for ${buyable.price}…`);
      try {
        const bought = await buyable.buy();
        opts.narrate(`✔ Paid ${buyable.price} to ${buyable.service} for ${buyable.name} — ${buyable.summarize(bought)}`);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(bought).slice(0, 4000) });
      } catch (err) {
        const message = describeBuyFailure(err);
        opts.narrate(`✖ ${buyable.name} not delivered — ${message}`);
        results.push({ type: "tool_result", tool_use_id: use.id, content: `Purchase failed: ${message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  opts.narrate("Mission hit the turn limit — wrapping up.");
}
