import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Typed wrapper around the `spp` CLI (Stellar Private Payments), which is how this example
 * touches the shielded pool. There is no usable Node SDK: the published `stellar-private-payments`
 * package is a *browser* build — its storage and prover run in Web Workers and its wasm targets
 * the web, so a server process cannot drive it. The native CLI can, and it speaks `--json`.
 *
 * Every call is serialized through {@link SppCli.queue}: the CLI keeps its wallet state in one
 * SQLite file (`<data-dir>/spp.db`), and two concurrent invocations race on it.
 */
export type SppConfig = {
  /** Path to the `spp` binary. */
  bin: string;
  /** `stellar keys` alias this process acts as. */
  account: string;
  /**
   * Path to a deployments.json listing ONLY pools whose history is still inside the Soroban
   * RPC's event-retention window. This is load-bearing: the CLI syncs every enabled pool as one
   * set, so a single pool deployed outside the window fails the whole sync with
   * "RPC sync gap: main RPC lacks history" — including pools that would otherwise sync fine.
   */
  deployment: string;
  /** Directory holding `policy_tx_2_2*.{wasm,r1cs}` — required for proving. */
  circuitsDir: string;
  /** Pool contract id (C…) this seller is paid in. */
  pool: string;
  /** Hard cap per CLI call; proving plus submission measured ~16s, so this is generous. */
  timeoutMs?: number;
};

export type SppKeys = { account: string; notePublicKey: string; encryptionPublicKey: string };

export function createSppCli(config: SppConfig) {
  const timeout = config.timeoutMs ?? 180_000;
  let queue: Promise<unknown> = Promise.resolve();

  /** Serializes CLI calls; see the note on `spp.db` above. */
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    // Keep the chain alive even when a call rejects, without swallowing the caller's rejection.
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function json<T>(args: string[]): Promise<T> {
    const { stdout } = await run(
      config.bin,
      [...args, "--account", config.account, "--deployment", config.deployment, "--circuits-dir", config.circuitsDir, "--json"],
      { timeout, maxBuffer: 8 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as T;
  }

  return {
    /** This identity's public note + encryption keys — what a payer needs to address a note. */
    keys(): Promise<SppKeys> {
      return serialize(async () => {
        const raw = await json<{ account: string; note_public_key: string; encryption_public_key: string }>(["keys"]);
        return { account: raw.account, notePublicKey: raw.note_public_key, encryptionPublicKey: raw.encryption_public_key };
      });
    },

    /**
     * Shielded balance in this pool, as a decimal XLM string. Returns `"0"` when the pool is
     * present but empty; throws when the pool could not be synced at all, because a sync failure
     * reported as a zero balance would look exactly like "the buyer hasn't paid yet" and hang
     * every line forever.
     */
    balance(): Promise<string> {
      return serialize(async () => {
        const raw = await json<{
          pools?: { pool_contract_id: string; balance: string }[];
          errors?: { pool_contract_id: string; error: string }[];
        }>(["overview"]);
        const pool = (raw.pools ?? []).find((p) => p.pool_contract_id === config.pool);
        if (!pool) {
          const failure = (raw.errors ?? []).find((e) => e.pool_contract_id === config.pool);
          throw new Error(failure ? `pool ${config.pool} did not sync: ${failure.error}` : `pool ${config.pool} not in this deployment`);
        }
        // "1.0000173 XLM" / "1.0000173" → "1.0000173"
        return (pool.balance.split(" ")[0] ?? "0").trim();
      });
    },

    /** Sends a private note of `amountXlm` to a recipient's note/encryption keys. */
    transfer(opts: { amountXlm: string; notePublicKey: string; encryptionPublicKey: string }): Promise<void> {
      return serialize(async () => {
        await run(
          config.bin,
          [
            "transfer",
            config.pool,
            opts.amountXlm,
            "--note-key",
            opts.notePublicKey,
            "--encryption-key",
            opts.encryptionPublicKey,
            "--account",
            config.account,
            "--deployment",
            config.deployment,
            "--circuits-dir",
            config.circuitsDir,
          ],
          { timeout, maxBuffer: 8 * 1024 * 1024 },
        );
      });
    },
  };
}

export type SppCli = ReturnType<typeof createSppCli>;
