import { describe, it, expect } from "vitest";
import { dollarToDecimal, decimalToBaseUnits, InvalidPriceError } from "../src/internal/price.js";

describe("dollarToDecimal", () => {
  it("parses dollar strings", () => expect(dollarToDecimal("$0.01")).toBe("0.01"));
  it("parses whole dollars", () => expect(dollarToDecimal("$2")).toBe("2"));
  it("rejects missing $", () => expect(() => dollarToDecimal("0.01")).toThrow(InvalidPriceError));
  it("rejects negatives", () => expect(() => dollarToDecimal("$-1")).toThrow(InvalidPriceError));
  it("rejects zero", () => expect(() => dollarToDecimal("$0")).toThrow(InvalidPriceError));
  it("rejects garbage", () => expect(() => dollarToDecimal("$abc")).toThrow(InvalidPriceError));
});

describe("decimalToBaseUnits", () => {
  it("converts with default 7 decimals", () => expect(decimalToBaseUnits("0.01")).toBe(100_000n));
  it("converts whole numbers", () => expect(decimalToBaseUnits("1")).toBe(10_000_000n));
  it("respects custom decimals", () => expect(decimalToBaseUnits("1.5", 2)).toBe(150n));
  it("rejects excess precision", () => expect(() => decimalToBaseUnits("0.00000001", 7)).toThrow(InvalidPriceError));
});
