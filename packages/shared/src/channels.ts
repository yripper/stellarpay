import { ChannelsClient, PluginExecutionError } from "@openzeppelin/relayer-plugin-channels";
import { Transaction, rpc } from "@stellar/stellar-sdk";

type MinimalClient = { submitTransaction(args: { xdr: string }): Promise<{ hash: string }> };

function code(e: unknown): string | undefined {
  return e instanceof PluginExecutionError ? e.errorDetails?.code : undefined;
}

async function directSubmit(xdr: string, rpcUrl: string, networkPassphrase: string): Promise<string> {
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  // Passphrase is embedded in the signed envelope; SDK requires one to parse.
  const sent = await server.sendTransaction(new Transaction(xdr, networkPassphrase));
  if (sent.status === "ERROR") throw new Error(`Direct submit failed: ${sent.errorResult?.toXDR("base64")}`);
  return sent.hash;
}

/**
 * Submit a signed (non-fee-bump) envelope via OZ Channels; self-pay fallback only on quota exhaustion.
 * Callers must build XDR submissions with `.setTimeout(30)`.
 */
export async function submitViaChannels(opts: {
  channelsUrl: string; apiKey: string; signedXdr: string; rpcUrl: string; maxPoolRetries?: number; networkPassphrase?: string;
  _client?: MinimalClient; _directSubmit?: (xdr: string, rpcUrl: string, networkPassphrase?: string) => Promise<string>;
}): Promise<string> {
  const client: MinimalClient = opts._client ?? new ChannelsClient({ baseUrl: opts.channelsUrl, apiKey: opts.apiKey });
  const retries = opts.maxPoolRetries ?? 3;
  const networkPassphrase = opts.networkPassphrase ?? "Test SDF Network ; September 2015";
  for (let attempt = 0; ; attempt++) {
    try {
      return (await client.submitTransaction({ xdr: opts.signedXdr })).hash;
    } catch (e) {
      if (code(e) === "POOL_CAPACITY" && attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (code(e) === "FEE_LIMIT_EXCEEDED") return (opts._directSubmit ?? directSubmit)(opts.signedXdr, opts.rpcUrl, networkPassphrase);
      throw e;
    }
  }
}
