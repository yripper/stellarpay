# @stellarpay-sdk/shared — Gasless Channels Submission (+ Backward-Compat Re-exports)

**Last verified:** 2026-08-04

## Purpose

Private, unpublished workspace package. Originally held network presets, price/base-unit
conversion helpers, and gasless transaction submission via OpenZeppelin Channels — used across
the stellarpay SDK. The network-preset and price-conversion pieces moved into
[`@stellarpay-sdk/core`](./core.md) (`packages/core/src/internal/`, re-exported as plain utilities
from `@stellarpay-sdk/core`'s public `index.ts`) because three publishable packages (`core`,
`client`, `mcp`) imported them at runtime, and a private/unpublished package can never be a
runtime `dependency` of a package meant to be `npm install`ed standalone — a `pnpm pack`
tarball of any of those three would depend on an `@stellarpay-sdk/shared@0.1.0` that can never be
published, breaking `npm install` for anyone outside this workspace. What remains here directly
is `submitViaChannels`; the moved utilities are still re-exported from this package's
`index.ts` so nothing importing `@stellarpay-sdk/shared` directly breaks.

**`submitViaChannels` has exactly one caller, and it is not a publishable package**:
`scripts/setup-demo.ts:72` submits the demo buyer's USDC trustline transaction through it so
the buyer never pays the fee (`scripts/setup-demo.ts:9`). No package under `packages/` imports
it. Its own test suite (`test/channels.test.ts`) exercises it directly.

## Structure

- `src/channels.ts` — Gasless transaction submission via OpenZeppelin Channels with fallback
- `src/index.ts` — Public re-exports: `submitViaChannels` from `./channels.js`, plus
  `dollarToDecimal`/`decimalToBaseUnits`/`NETWORKS`/`NetworkPreset` re-exported from
  `@stellarpay-sdk/core` for backward compatibility (see Purpose above; the canonical source for
  those is now [`docs/modules/core.md`](./core.md))

## Public Surface

### Functions

- `submitViaChannels(opts: { channelsUrl: string; apiKey: string; signedXdr: string; rpcUrl: string; maxPoolRetries?: number; networkPassphrase?: string; _client?; _directSubmit? }): Promise<string>` — Submits a signed envelope via OpenZeppelin Channels with automatic retry on quota exhaustion and fallback to direct self-pay submission on fee limit errors. Returns the transaction hash. Throws if Channels accepts the transaction but returns no hash. XDR submissions must be built with `.setTimeout(30)`. Supports optional custom network passphrase (defaults to Stellar testnet). (`packages/shared/src/channels.ts:22-43`)

### Re-exported from `@stellarpay-sdk/core` (backward compatibility)

- `type NetworkId`, `interface NetworkPreset`, `NETWORKS: Record<NetworkId, NetworkPreset>`,
  `dollarToDecimal`, `decimalToBaseUnits`, `class InvalidPriceError` — see
  [`docs/modules/core.md`](./core.md) for the canonical documentation and `file:line`
  citations; these now live in `packages/core/src/internal/{price,networks}.ts`.

## Gotchas

- **This package is not a runtime dependency of any publishable package.** `core`, `client`,
  and `mcp` all import `dollarToDecimal`/`decimalToBaseUnits`/`NETWORKS` from
  `@stellarpay-sdk/core` directly, not from here. `@stellarpay-sdk/shared` now depends on
  `@stellarpay-sdk/core` (for its re-exports), not the other way around — the reverse of the
  dependency direction before this package's utilities moved. Since this package stays
  `"private": true` and is never published, its own dependency direction has no effect on
  what the publishable packages' `npm install` pulls in.
- **`submitViaChannels`'s only caller is `scripts/setup-demo.ts:72`** — see Purpose above. Its
  own test suite (`test/channels.test.ts`) also exercises it directly.
- **Channels timeout requirement**: Callers of `submitViaChannels` must build XDR envelopes with `.setTimeout(30)` to ensure compatibility with OZ Channels processing. The function will fall back to direct self-pay submission only on `FEE_LIMIT_EXCEEDED` errors; other errors (e.g., `POOL_CAPACITY` after retries, `SIMULATION_FAILED`) are re-thrown. If Channels accepts the transaction but returns a null hash, an error is thrown immediately.
- **Network passphrase**: The optional `networkPassphrase` parameter defaults to Stellar's testnet passphrase. For public-network submissions, explicitly provide `networkPassphrase: "Public Global Stellar Network ; September 2015"`.

## Verified Against

- Stellar network passphrases and RPC endpoints verified against Stellar documentation as of 2026-08-01
- OpenZeppelin Channels 0.20.0 (`@openzeppelin/relayer-plugin-channels`) for gasless submission
- @stellar/stellar-sdk 16.2.0 (bumped from 15.1.0 on 2026-08-03 — live testnet emits a
  Soroban credentials XDR variant 15.1.0 can't parse; see `docs/modules/core.md`'s
  "stellar-sdk version" section) for transaction envelope parsing and RPC communication
- 2026-08-03 (final fix wave): `price.ts`/`networks.ts` and their tests moved to
  `@stellarpay-sdk/core` (see Purpose above); this doc rewritten to match.
