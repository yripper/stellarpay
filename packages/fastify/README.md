# @stellarpay-sdk/fastify

One-line Fastify plugin adapter for [`@stellarpay-sdk/core`](../core/README.md). Registers an
`onRequest` hook that converts Fastify's `Request`/`Reply` to/from web-standard types and
dispatches to the core paywall handler — the same direct-response / pass-through / fall-through
contract as the other adapters.

Part of the [stellarpay](../../README.md) SDK.

## Install

Published on npm at `0.1.0` — see [PUBLISHING.md](../../PUBLISHING.md) for how releases are cut.

```sh
npm install @stellarpay-sdk/fastify @stellarpay-sdk/core fastify
```

## Minimal working example

Adapted from `test/fastify.test.ts` (same config, same routes — `app.listen` added so it runs
as a standalone server):

```ts
import Fastify from "fastify";
import { stellarpayFastify } from "@stellarpay-sdk/fastify";

const cfg = {
  network: "stellar:testnet",
  payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mppSecretKey: "test-secret",
  routes: { "GET /paid": { price: "$0.01", scheme: "mpp-charge" } },
};

const app = Fastify();
await app.register(stellarpayFastify, { config: cfg }); // register at the root, before routes
app.get("/paid", async () => ({ secret: 42 }));
app.get("/free", async () => ({ ok: true }));
await app.listen({ port: 3000 });

// GET /free -> 200 { ok: true }   GET /paid -> 402 (payment challenge)
```

## API

Public export, from `src/index.ts`.

| Export | Signature | Description |
|---|---|---|
| `stellarpayFastify` | `(fastify: FastifyInstance, opts: { config: unknown \| Stellarpay }) => Promise<void>` | A plain async Fastify plugin (`fastify.register(stellarpayFastify, { config })`). `opts.config` accepts a raw `StellarpayConfig` or a pre-built `Stellarpay` instance. |

## Gotchas

- **Register at the app root, before routes.** Fastify's default plugin encapsulation would
  otherwise scope the `onRequest` hook to the plugin only; `stellarpayFastify` sets Fastify's
  `'skip-override'` marker (the same mechanism `fastify-plugin` uses internally, without adding
  that dependency) so it gates the whole app when registered at the root.
- **`register()` returns a promise** — `await` it (or chain `.then()`) before declaring routes
  that need to be gated.

Full details, including why `'skip-override'` is required: [`docs/modules/fastify.md`](../../docs/modules/fastify.md).

[Back to root README](../../README.md)
