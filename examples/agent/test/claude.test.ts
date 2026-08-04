import { describe, expect, it } from "vitest";
import { truncateBrief } from "../src/claude.js";

describe("truncateBrief", () => {
  it("returns text under the limit unchanged", () => {
    expect(truncateBrief("short brief", 400)).toBe("short brief");
  });

  it("returns text exactly at the limit unchanged", () => {
    const text = "a".repeat(400);
    expect(truncateBrief(text, 400)).toBe(text);
  });

  it("truncates on the last word boundary rather than mid-word, and appends an ellipsis", () => {
    // slice(0, 38) lands mid-word inside "this" ("...and thi") — must back up to the space before it.
    const text = "The agent bought four services and this chopped";
    const out = truncateBrief(text, 38);
    expect(out).toBe("The agent bought four services and…");
    expect(text.startsWith(out.slice(0, -1))).toBe(true); // never invents words
    expect(out.slice(0, -1).endsWith(" ")).toBe(false); // boundary text has no trailing space before the ellipsis
  });

  it("still appends an ellipsis when there is no space to back up to (one long word)", () => {
    const text = "a".repeat(500);
    const out = truncateBrief(text, 400);
    expect(out).toBe(`${"a".repeat(400)}…`);
  });

  it("never cuts a real sentence mid-word at the production default (400 chars)", () => {
    const sentence = "The agent purchased asset intel, a wallet deep-dive, whale alerts, and fee stats across four services, settling two payment protocols on Stellar testnet within the configured per-run spend limit, and it did so without ever exceeding the twenty-five cent budget ceiling that guards every run from spending more than the demo allows, no matter how many tools it decides to call, and it narrated every settlement to the dashboard feed in real time as judges watched.";
    expect(sentence.length).toBeGreaterThan(400);
    const out = truncateBrief(sentence, 400);
    expect(out.endsWith("…")).toBe(true);
    const withoutEllipsis = out.slice(0, -1);
    expect(sentence.startsWith(withoutEllipsis)).toBe(true);
    expect(sentence[withoutEllipsis.length]).toBe(" "); // cut fell exactly on a word boundary
  });
});
