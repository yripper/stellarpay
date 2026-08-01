/**
 * Normalizes a fetch `input` (string, `URL`, or `Request`) to its URL string. Shared by
 * `index.ts` (the outer probe) and `mppLeg.ts` (mppx event payloads carry the same
 * `RequestInfo | URL` shape) so both legs report the same `url` value on `PayEvent`s.
 */
export function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
