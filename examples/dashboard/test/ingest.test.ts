import { describe, expect, it } from "vitest";
import { parseIngestBody } from "../src/ingest.js";

describe("parseIngestBody", () => {
  it("accepts a receipt event", () => {
    expect(parseIngestBody({ service: "express-api", kind: "receipt", receipt: { route: "GET /report/*" } })).toEqual({
      service: "express-api",
      kind: "receipt",
      receipt: { route: "GET /report/*" },
    });
  });

  it("accepts an agent-log event", () => {
    expect(parseIngestBody({ service: "agent", kind: "agent-log", message: "hi" })).toEqual({
      service: "agent",
      kind: "agent-log",
      message: "hi",
    });
  });

  it.each([
    null,
    "string",
    {},
    { service: "", kind: "receipt", receipt: {} },
    { service: "s", kind: "receipt", receipt: "not-an-object" },
    { service: "s", kind: "agent-log", message: "" },
    { service: "s", kind: "unknown" },
  ])("rejects malformed body %#", (body) => {
    expect(parseIngestBody(body)).toBeUndefined();
  });
});
