import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

/** Builds the x402-paying fetch used after our outer probe confirms an x402 challenge. */
export function buildX402Fetch(
  raw: typeof fetch,
  opts: { secret: string; network: "stellar:testnet" | "stellar:pubnet"; rpcUrl?: string },
): typeof fetch {
  const signer = createEd25519Signer(opts.secret);
  const client = new x402Client();
  client.register(opts.network, new ExactStellarScheme(signer, opts.rpcUrl ? { url: opts.rpcUrl } : undefined));
  return wrapFetchWithPayment(raw, client);
}
