# @stellarpay/shared — Network Presets, Price Helpers, and Channels Submission

## Purpose

Provides reusable types, constants, and utilities for working with Stellar networks, price conversions, and gasless transaction submission across the stellarpay SDK. This is a private package bundled by consumers.

## Structure

- `src/networks.ts` — Network presets and types for Stellar testnet and public network
- `src/price.ts` — Dollar and decimal to base-unit conversion helpers
- `src/channels.ts` — Gasless transaction submission via OpenZeppelin Channels with fallback
- `src/index.ts` — Public re-exports

## Public Surface

### Types and Constants

- `type NetworkId = "stellar:testnet" | "stellar:pubnet"` — Network identifier union type
- `interface NetworkPreset` — Configuration for a Stellar network, with fields: `networkId`, `facilitatorUrl`, `rpcUrl`, `horizonUrl`, `networkPassphrase`, `channelsUrl`
- `NETWORKS: Record<NetworkId, NetworkPreset>` — Network presets for testnet and public network (`packages/shared/src/networks.ts:11-29`)

### Functions

- `dollarToDecimal(price: string): string` — Parses a dollar string (e.g., `"$0.01"`) into its positive decimal part (`"0.01"`). Throws `InvalidPriceError` if malformed, missing `$`, or not positive. (`packages/shared/src/price.ts:6-13`)

- `decimalToBaseUnits(decimal: string, decimals?: number): bigint` — Converts a decimal amount (e.g., `"0.01"`) into token base units for the given decimal precision. Defaults to 7 decimals. Throws `InvalidPriceError` if precision exceeds the allowed decimals. (`packages/shared/src/price.ts:15-19`)

- `submitViaChannels(opts: { channelsUrl: string; apiKey: string; signedXdr: string; rpcUrl: string; maxPoolRetries?: number; networkPassphrase?: string; _client?; _directSubmit? }): Promise<string>` — Submits a signed envelope via OpenZeppelin Channels with automatic retry on quota exhaustion and fallback to direct self-pay submission on fee limit errors. Returns the transaction hash. XDR submissions must be built with `.setTimeout(30)`. Supports optional custom network passphrase (defaults to Stellar testnet). (`packages/shared/src/channels.ts:18-35`)

### Errors

- `class InvalidPriceError extends Error` — Thrown by price conversion functions on invalid input (`packages/shared/src/price.ts:1-2`)

## Gotchas

- **BigInt arithmetic, no floats**: `decimalToBaseUnits` returns `bigint`, not `number`, to avoid floating-point precision loss in financial calculations. Always use bigint arithmetic downstream.
- **Dollar validation**: Prices must be positive and in the format `$X.XX` or `$X`; zero is explicitly rejected.
- **Precision limits**: `decimalToBaseUnits` will throw if the fractional part of the decimal has more digits than the requested decimals parameter.
- **Channels timeout requirement**: Callers of `submitViaChannels` must build XDR envelopes with `.setTimeout(30)` to ensure compatibility with OZ Channels processing. The function will fall back to direct self-pay submission only on `FEE_LIMIT_EXCEEDED` errors; other errors (e.g., `POOL_CAPACITY` after retries, `SIMULATION_FAILED`) are re-thrown.
- **Network passphrase**: The optional `networkPassphrase` parameter defaults to Stellar's testnet passphrase. For public-network submissions, explicitly provide `networkPassphrase: "Public Global Stellar Network ; September 2015"`.

## Verified Against

- Stellar network passphrases and RPC endpoints verified against Stellar documentation as of 2026-08-01
- OpenZeppelin Channels 0.20.0 (`@openzeppelin/relayer-plugin-channels`) for gasless submission
- @stellar/stellar-sdk 15.1.0 for transaction envelope parsing and RPC communication
