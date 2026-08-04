import type { FeedEvent } from "./buffer.js";

/**
 * Validates an /ingest body. Hand-rolled (no zod) on purpose: two shapes, and the
 * dashboard treats receipt payloads as opaque — deep receipt validation would couple
 * demo infra to the SDK's Receipt type for no gain.
 */
export function parseIngestBody(body: unknown): Omit<FeedEvent, "seq" | "at"> | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b["service"] !== "string" || b["service"] === "") return undefined;
  if (b["kind"] === "receipt") {
    if (typeof b["receipt"] !== "object" || b["receipt"] === null || Array.isArray(b["receipt"])) return undefined;
    return { service: b["service"], kind: "receipt", receipt: b["receipt"] as Record<string, unknown> };
  }
  if (b["kind"] === "agent-log") {
    if (typeof b["message"] !== "string" || b["message"] === "") return undefined;
    return { service: b["service"], kind: "agent-log", message: b["message"] };
  }
  return undefined;
}
