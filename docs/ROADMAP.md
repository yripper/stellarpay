# Roadmap

Stretch goals beyond this hackathon submission. Verbatim from the design spec's §8
(`docs/superpowers/specs/2026-07-31-stellarpay-design.md`), in the spec's own order.

- **mpp-channel hosted feed demo** — per-tick priced data feed over a channel session; requires
  deploying the `one-way-channel` Soroban contract. Weekend attempt if the core suite is solid.
- **Agent treasury with policy signers** — smart-account agent wallet (smart-account-kit) whose
  policy signer enforces a daily spend cap + contract allow-list; payment inside policy
  succeeds, outside policy refused on-chain. Attempt only if time remains before Wednesday
  (submission deadline: Wednesday 2026-08-05, per the spec's header).
- Redis `Store` adapter for MPP replay protection.
- Mainnet preset hardening.

## Context

`@stellarpay-sdk/core`'s `mpp-charge` and `mpp-channel` scheme modules currently use `Store.memory()`
for replay/voucher state — an in-process `Map`, fine for a single-instance demo but not for a
horizontally-scaled or serverless deployment (state is lost on restart and not shared across
instances). This is the gap the Redis `Store` adapter item above would close; see
[`docs/modules/core.md`](./modules/core.md)'s Gotchas for the current single-process caveat.

The `stellar:pubnet` network preset already exists structurally
(`packages/core/src/internal/networks.ts`), but mainnet hardening — real facilitator/RPC
endpoints exercised end-to-end, real-money error handling, production-grade replay storage,
and asset selection for the `mpp-*` schemes (currently rejected on `stellar:pubnet` — see
`docs/modules/core.md`'s Gotchas) — is unverified and out of scope for this submission (see
the spec's §12, "Out of scope").

[Back to root README](../README.md)
