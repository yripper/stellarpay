# @stellarpay/core

The paywall engine. Validates a config, compiles a route table, and dispatches matched
requests to one of three payment schemes — **x402**, **mpp-charge**, or **mpp-channel** — all
behind one web-standard `Request → Response` interface that every adapter in this repo builds
on. Errors from misconfiguration or unreachable settlement infrastructure are normalized into
fixed-shape responses (`402`/`500`/`503`) instead of leaking internals or crashing the host app.

Part of the [stellarpay](../../README.md) SDK.

## Install

Not yet published — see [PUBLISHING.md](../../PUBLISHING.md). Once published:

```sh
npm install @stellarpay/core
```

## Minimal working example

Taken directly from `test/stellarpay.test.ts`:

```ts
import { stellarpay } from "@stellarpay/core";

const paywall = stellarpay({
  network: "stellar:testnet",
  payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret", // required: the mpp-charge route below needs it
  routes: {
    "GET /free-ish": { price: "$0.01", scheme: "mpp-charge" },
    "GET /x": { price: "$0.01" }, // defaults to x402
  },
});

const response = await paywall.handle(new Request("http://x/free-ish"));
console.log(response?.status); // 402 — payment required

const unmatched = await paywall.handle(new Request("http://x/not-listed"));
console.log(unmatched); // undefined — no configured route matched
```

Run it against a real HTTP server via one of the framework adapters —
[`@stellarpay/express`](../express/README.md), [`@stellarpay/hono`](../hono/README.md), or
[`@stellarpay/fastify`](../fastify/README.md) — rather than calling `paywall.handle()` directly.

## API

Public exports, from `src/index.ts`.

| Export | Signature | Description |
|---|---|---|
| `stellarpay` | `(config: unknown) => Stellarpay` | Validates `config`, instantiates only the scheme modules the routes reference, returns the request handler. Throws `StellarpayConfigError` synchronously on bad config. |
| `Stellarpay` (type) | `{ handle, handleWithMeta, ready }` | `handle(req): Promise<Response \| undefined>` — `undefined` means no route matched. `handleWithMeta(req)` — adapter-facing variant returning `{ response? }` (respond directly) or `{ passHeaders? }` (let the route run, attach these headers). `ready(): Promise<void>` — runs each scheme module's optional `init()`. |
| `parseConfig` | `(input: unknown) => StellarpayConfig` | Zod-validates and cross-checks a config object (e.g. `mppSecretKey` required if any route uses `mpp-*`). Throws `StellarpayConfigError`. |
| `compileRoutes` | `(routes: Record<string, RouteRule>) => CompiledRoute[]` | Compiles route keys into a matchable table (exact routes before wildcards). |
| `matchRoute` | `(compiled, method, pathname) => { pattern, rule } \| undefined` | Matches a method + path against the compiled table. |
| `NetworkId` (type) | `"stellar:testnet" \| "stellar:pubnet"` | Network identifier. |
| `Scheme` (type) | `"x402" \| "mpp-charge" \| "mpp-channel"` | Supported payment schemes. |
| `PriceInput` (type) | `string \| { asset: string; amount: string }` | A dollar string (`"$0.01"`) or explicit asset + base units. |
| `RouteRule` (type) | `{ price, scheme?, sponsorGas?, description? }` | Per-route config. |
| `Receipt` (type) | `{ scheme, route, network, amount, asset, payer?, txHash?, raw?, timestamp }` | Normalized settlement receipt passed to `onPayment`. |
| `StellarpayConfig` (type) | `{ network, payTo, routes, facilitatorUrl?, facilitatorApiKey?, mppSecretKey?, sponsorSecret?, channel?, rpcUrl?, onPayment? }` | Top-level SDK config. `facilitatorApiKey` is the bearer token for the x402 facilitator's `verify`/`settle`/`supported` endpoints (semi-sensitive — never logged). |
| `StellarpayConfigError` | `class extends Error` | Thrown by `parseConfig` on invalid input. |

Field-level requirements: `mppSecretKey` is required if any route uses an `mpp-*` scheme,
`sponsorSecret` if any route sets `sponsorGas`, and `channel` if any route uses `mpp-channel`
(`src/config.ts`).

`channel.commitmentPublicKey` must be a 64-character hex string — the raw ed25519 public key
bytes, not a Stellar `G...` address; `parseConfig` rejects anything else.

**`mpp-charge`/`mpp-channel` routes are pinned to testnet USDC** (`USDC_SAC_TESTNET`) and are
rejected by `parseConfig` when `network` is `"stellar:pubnet"` — mainnet support for those
schemes isn't implemented yet, only `x402` currently works against `"stellar:pubnet"`.

If your own `onPayment` hook throws, `stellarpay()` catches it, logs the real error server-side
only (`console.error`), and still lets the already-successful request through — don't put
secrets in your hook's own error messages, since they're logged verbatim.

Full API surface, gotchas, and file:line citations: [`docs/modules/core.md`](../../docs/modules/core.md).

[Back to root README](../../README.md)
