# @stellarpay-sdk/hono

One-line Hono middleware adapter for [`@stellarpay-sdk/core`](../core/README.md). Hono already
works with web-standard `Request`/`Response`, so this adapter dispatches directly to the core
paywall handler with no conversion layer — the thinnest of the three framework adapters, and
the one used for the "gated in minutes" demo.

Part of the [stellarpay](../../README.md) SDK.

## Install

Not yet published — see [PUBLISHING.md](../../PUBLISHING.md). Once published:

```sh
npm install @stellarpay-sdk/hono @stellarpay-sdk/core hono
# a Node runtime also needs a server adapter, e.g.:
npm install @hono/node-server
```

## Minimal working example

Adapted from `test/hono.test.ts` (same config, same routes — wrapped in `@hono/node-server`'s
`serve()` so it runs as a standalone server; Hono itself is runtime-agnostic and also runs
directly on Bun/Deno/Cloudflare Workers):

```ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { stellarpayHono } from "@stellarpay-sdk/hono";

const cfg = {
  network: "stellar:testnet",
  payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

const app = new Hono();
app.use("*", stellarpayHono(cfg)); // mount before routes — see Gotchas
app.get("/paid", (c) => c.json({ secret: 42 }));
app.get("/free", (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: 3000 });

// GET /free -> 200 { ok: true }   GET /paid -> 402 (payment challenge)
```

## API

Public export, from `src/index.ts`.

| Export | Signature | Description |
|---|---|---|
| `stellarpayHono` | `(configOrInstance: unknown) => MiddlewareHandler` | Accepts a raw `StellarpayConfig` (built into a `Stellarpay` instance internally) or a pre-built `Stellarpay` instance. Returns a Hono middleware. |

## Gotchas

- **Mount before routes**: `app.use("*", stellarpayHono(cfg))` must come before your route
  definitions.
- **Header-based only** — same as every other adapter in this SDK.

Full details: [`docs/modules/hono.md`](../../docs/modules/hono.md).

[Back to root README](../../README.md)
