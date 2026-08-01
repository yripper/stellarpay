import { describe, it, expect } from "vitest";
import { compileRoutes, matchRoute } from "../src/index.js";

const rule = { price: "$0.01" } as const;
const compiled = compileRoutes({ "GET /a": rule, "GET /api/*": rule, "POST /a": rule });

describe("matchRoute", () => {
  it("matches exact method+path", () => expect(matchRoute(compiled, "GET", "/a")?.pattern).toBe("GET /a"));
  it("is method-sensitive", () => expect(matchRoute(compiled, "DELETE", "/a")).toBeUndefined());
  it("distinguishes methods on same path", () => expect(matchRoute(compiled, "POST", "/a")?.pattern).toBe("POST /a"));
  it("matches trailing wildcard", () => expect(matchRoute(compiled, "GET", "/api/deep/thing")?.pattern).toBe("GET /api/*"));
  it("wildcard does not match bare prefix parent", () => expect(matchRoute(compiled, "GET", "/api")).toBeUndefined());
  it("prefers exact over wildcard", () => {
    const c = compileRoutes({ "GET /api/*": rule, "GET /api/special": { price: "$0.05" } });
    expect(matchRoute(c, "GET", "/api/special")?.rule.price).toBe("$0.05");
  });
  it("prefers most-specific wildcard (longest prefix first)", () => {
    // Declare broader wildcard BEFORE more-specific one: /api/* declared before /api/admin/*
    const c = compileRoutes({ "GET /api/*": { price: "$0.01" }, "GET /api/admin/*": { price: "$0.05" } });
    expect(matchRoute(c, "GET", "/api/admin/users")?.rule.price).toBe("$0.05");
    expect(matchRoute(c, "GET", "/api/public/files")?.rule.price).toBe("$0.01");
  });
  it("returns undefined for unlisted", () => expect(matchRoute(compiled, "GET", "/free")).toBeUndefined());
  it("ignores query strings (caller passes pathname)", () => expect(matchRoute(compiled, "GET", "/a")).toBeTruthy());
});
