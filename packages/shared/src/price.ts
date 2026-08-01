export class InvalidPriceError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidPriceError"; }
}

/** Parse a "$1.23" dollar string into its positive decimal part ("1.23"). */
export function dollarToDecimal(price: string): string {
  const match = /^\$(\d+(?:\.\d+)?)$/.exec(price);
  if (!match) throw new InvalidPriceError(`Invalid dollar price: ${price}`);
  const decimal = match[1]!;
  if (Number(decimal) <= 0) throw new InvalidPriceError(`Price must be positive: ${price}`);
  return decimal;
}

/** Convert a decimal amount string into token base units for the given decimals. */
export function decimalToBaseUnits(decimal: string, decimals = 7): bigint {
  const [whole = "0", frac = ""] = decimal.split(".");
  if (frac.length > decimals) throw new InvalidPriceError(`Too many decimal places for ${decimals}-decimal asset: ${decimal}`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}
