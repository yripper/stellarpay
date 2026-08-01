/**
 * Determines which payment protocol issued a 402 challenge, based on response headers.
 * Non-402 responses never carry a challenge, so they resolve to `undefined`.
 */
export function detectProtocol(res: Response): "x402" | "mpp" | undefined {
  if (res.status !== 402) return undefined;
  return res.headers.get("PAYMENT-REQUIRED") ? "x402" : "mpp";
}
