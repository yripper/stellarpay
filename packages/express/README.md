# @stellarpay/express

One-line Express middleware adapter for [`@stellarpay/core`](../core/README.md). Converts
Express `Request`/`Response` to/from web-standard types, runs the core paywall handler, and
dispatches: writes a `402`/error response directly, passes settlement headers through and calls
`next()`, or falls through untouched for unmatched routes.

Part of the [stellarpay](../../README.md) SDK.

## Install

Not yet published — see [PUBLISHING.md](../../PUBLISHING.md). Once published:

```sh
npm install @stellarpay/express @stellarpay/core express
```

## Minimal working example

Adapted from `test/express.test.ts` (same config, same routes — `app.listen` added so it runs
as a standalone server):

```ts
import express from "express";
import { stellarpayExpress } from "@stellarpay/express";

const cfg = {
  network: "stellar:testnet",
  payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

const app = express();
app.use(stellarpayExpress(cfg)); // mount before routes — see Gotchas
app.get("/paid", (_req, res) => res.json({ secret: 42 }));
app.get("/free", (_req, res) => res.json({ ok: true }));
app.listen(3000);

// GET /free  -> 200 { ok: true }        (unmatched by the paywall, passes through)
// GET /paid  -> 402 (payment challenge) until a valid payment is presented
```

## API

Public export, from `src/index.ts`.

| Export | Signature | Description |
|---|---|---|
| `stellarpayExpress` | `(configOrInstance: unknown) => RequestHandler` | Accepts a raw `StellarpayConfig` (built into a `Stellarpay` instance internally) or a pre-built `Stellarpay` instance (reuse across apps). Returns an Express middleware. |

## Gotchas

- **Mount before routes.** `app.use(stellarpayExpress(cfg))` must come before your route
  definitions so it can intercept every path.
- **Header-based only.** Request/response bodies are never read or copied — payment
  verification is header-based in every scheme.

Full details, including multi-value `Set-Cookie` header handling:
[`docs/modules/express.md`](../../docs/modules/express.md).

[Back to root README](../../README.md)
