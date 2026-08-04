# @stellarpay-sdk/shared (internal)

Private, unpublished workspace package. Its network-preset and price/base-unit conversion
helpers moved into [`@stellarpay-sdk/core`](../core/README.md)'s public exports (`packages/core/src/internal/`)
so the publishable packages that need them don't depend on this unpublishable package at
runtime — this package re-exports them unchanged for backward compatibility. What's left here
is `submitViaChannels`, OpenZeppelin Channels submission logic — no publishable package imports
it; its one caller is the repo-local ops script `scripts/setup-demo.ts:72`, which uses it to
establish the demo buyer's USDC trustline without the buyer paying fees. Not published to npm —
see [`docs/modules/shared.md`](../../docs/modules/shared.md) for its API.

[Back to root README](../../README.md)
