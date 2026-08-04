# @stellarpay-sdk/client

Agent-side auto-paying `fetch`. `createPayingFetch(config)` returns a `fetch`-compatible
function that probes a request, and on a `402`, detects whether the challenge is **x402** or
**MPP**, enforces your spend limits, then transparently pays and retries — via `@x402/fetch` for
x402, `mppx/client` + `@stellar/mpp/{charge,channel}/client` for MPP. It is an explicit, scoped
wrapper — it never monkey-patches the global `fetch`.

Part of the [stellarpay](../../README.md) SDK.

## Install

Published on npm at `0.1.0` — see [PUBLISHING.md](../../PUBLISHING.md) for how releases are cut.

```sh
npm install @stellarpay-sdk/client
```

## Minimal working example

The config shape (`secret`/`keypair`, `network`, `limits`, `onEvent`) and the `SpendLimitExceeded`
error are exercised directly in `test/payingFetch.test.ts`; this example swaps that test's
injected in-process transport for a real network call so it's runnable standalone against any
server built with an [adapter](../../README.md#packages) from this SDK:

```ts
import { createPayingFetch, SpendLimitExceeded } from "@stellarpay-sdk/client";

const payFetch = createPayingFetch({
  secret: process.env.AGENT_SECRET!, // S... testnet secret key — or pass `keypair` instead
  network: "stellar:testnet",
  limits: { maxTotal: "$0.015" },
  onEvent: (e) => console.log(e.type), // "challenge" -> "paying" -> "paid" / "blocked" / "error"
});

try {
  const res = await payFetch("http://localhost:3000/paid");
  console.log(await res.json());
} catch (err) {
  if (err instanceof SpendLimitExceeded) console.error("over budget:", err.message);
  else throw err;
}
```

## API

Public exports, from `src/index.ts`.

| Export | Signature | Description |
|---|---|---|
| `createPayingFetch` | `(config: PayingFetchConfig) => typeof fetch` | The package's sole entry point — the returned function behaves like `fetch`, transparently paying any `402` it encounters. |
| `PayingFetchConfig` (type) | `{ secret?, keypair?, network, limits?, onEvent?, rpcUrl?, channelCommitmentSecret?, allowedChannels? }` | `secret` or `keypair` is required (one of the two). `network: "stellar:testnet" \| "stellar:pubnet"`. `limits?: { maxPerCall?, maxTotal?, allowUnknownAmount? }` — dollar strings like `"$0.05"`. `channelCommitmentSecret` opts into the `mpp-channel` client method; `allowedChannels` pins it to specific channel contracts (recommended). |
| `PayEvent` (type) | `{ type: "challenge" \| "paying" \| "paid"; protocol; url } \| { type: "blocked"; reason; url } \| { type: "error"; message; url }` | Lifecycle events delivered to `onEvent`. |
| `SpendLimitExceeded` | `class extends Error` | Thrown by the spend-limit gate *before* any signing happens, when a challenge would exceed `maxPerCall`/`maxTotal`. |
| `MissingSignerConfig` | `class extends Error` | Thrown by `createPayingFetch` when a config has neither `secret` nor a valid `keypair`. |
| `UnsupportedChallenge` | `class extends Error` | Reserved for a `402` whose protocol can't be classified as x402 or MPP — currently never thrown; both legs always resolve to `"x402"` or `"mpp"` today. |

**`allowUnknownAmount: true` disables both spend caps for that challenge**, not just the
unparseable-amount block: when a challenge's amount can't be parsed, `SpendTracker` skips the
`maxPerCall`/`maxTotal` checks entirely and reserves nothing for it, rather than treating it as
`0` and still enforcing the caps. Only enable it if you trust the endpoints you're calling with
this `payFetch` instance.

Full details — including the budget reserve/release semantics on failed payment attempts,
channel-pinning gotchas, and the double `"challenge"` event on the MPP leg:
[`docs/modules/client.md`](../../docs/modules/client.md).

[Back to root README](../../README.md)
