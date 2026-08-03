# @stellarpay/shared (internal)

Private, unpublished workspace package. Its network-preset and price/base-unit conversion
helpers moved into [`@stellarpay/core`](../core/README.md)'s public exports (`packages/core/src/internal/`)
so the publishable packages that need them don't depend on this unpublishable package at
runtime — this package re-exports them unchanged for backward compatibility. What's left here
is `submitViaChannels`, OpenZeppelin Channels submission logic — currently **dead code**, not
called anywhere in this SDK yet; it's retained for a future Plan B (demo/ops tooling). Not
published to npm — see [`docs/modules/shared.md`](../../docs/modules/shared.md) for its API.

[Back to root README](../../README.md)
