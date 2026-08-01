import { describe, it, expect } from "vitest";
import { detectProtocol } from "../src/detect.js";

describe("detectProtocol", () => {
  it("x402 when PAYMENT-REQUIRED header present", () => {
    const res = new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": "eyJ4NDAyIjp7fX0=" } });
    expect(detectProtocol(res)).toBe("x402");
  });
  it("mpp for other 402s", () => {
    expect(detectProtocol(new Response(null, { status: 402, headers: { "accept-payment": "..." } }))).toBe("mpp");
  });
  it("undefined for non-402", () => {
    expect(detectProtocol(new Response(null, { status: 200 }))).toBeUndefined();
  });
});
