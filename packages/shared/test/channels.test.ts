import { describe, it, expect, vi } from "vitest";
import { PluginExecutionError } from "@openzeppelin/relayer-plugin-channels";
import { submitViaChannels } from "../src/index.js";

const base = { channelsUrl: "https://channels.openzeppelin.com/testnet", apiKey: "k", signedXdr: "AAAA", rpcUrl: "http://rpc" };
const execError = (code: string) => Object.assign(Object.create(PluginExecutionError.prototype), { errorDetails: { code } });

describe("submitViaChannels", () => {
  it("returns hash on success", async () => {
    const client = { submitTransaction: vi.fn().mockResolvedValue({ hash: "abc" }) };
    await expect(submitViaChannels({ ...base, _client: client })).resolves.toBe("abc");
  });
  it("retries POOL_CAPACITY then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const client = { submitTransaction: vi.fn().mockRejectedValueOnce(execError("POOL_CAPACITY")).mockResolvedValue({ hash: "ok" }) };
      const promise = submitViaChannels({ ...base, _client: client });
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toBe("ok");
      expect(client.submitTransaction).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("falls back to direct submit ONLY on FEE_LIMIT_EXCEEDED", async () => {
    const client = { submitTransaction: vi.fn().mockRejectedValue(execError("FEE_LIMIT_EXCEEDED")) };
    const direct = vi.fn().mockResolvedValue("direct-hash");
    await expect(submitViaChannels({ ...base, _client: client, _directSubmit: direct })).resolves.toBe("direct-hash");
    expect(direct).toHaveBeenCalledWith("AAAA", "http://rpc", "Test SDF Network ; September 2015");
  });
  it("surfaces other errors without falling back", async () => {
    const client = { submitTransaction: vi.fn().mockRejectedValue(execError("SIMULATION_FAILED")) };
    const direct = vi.fn();
    await expect(submitViaChannels({ ...base, _client: client, _directSubmit: direct })).rejects.toBeTruthy();
    expect(direct).not.toHaveBeenCalled();
  });
  it("honors networkPassphrase option in directSubmit", async () => {
    const customPassphrase = "Custom Network";
    const client = { submitTransaction: vi.fn().mockRejectedValue(execError("FEE_LIMIT_EXCEEDED")) };
    const direct = vi.fn().mockResolvedValue("direct-hash");
    await submitViaChannels({ ...base, networkPassphrase: customPassphrase, _client: client, _directSubmit: direct });
    expect(direct).toHaveBeenCalledWith("AAAA", "http://rpc", customPassphrase);
  });
});
