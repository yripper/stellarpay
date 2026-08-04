# fastify-api — fee & network stats, the third-framework demo

The third framework in the stellarpay demo lineup, after Express
([`examples/express-api`](../express-api)) and Hono ([`examples/hono-api`](../hono-api)). It
sells one thing: live Stellar testnet fee/congestion stats, paywalled over the **mpp-charge**
scheme — so between the three example services, two of the three payment schemes stellarpay
supports (`packages/core/src/types.ts:16`: `x402`, `mpp-charge`, `mpp-channel` — the demo
does not use `mpp-channel`) show up side by side: x402 on express-api and hono-api,
mpp-charge on express-api and here.

Registering the paywall on a Fastify app is one `await app.register(...)` call before any
routes are declared:

```ts
import Fastify from "fastify";
import { stellarpayFastify } from "@stellarpay-sdk/fastify";

const app = Fastify();
await app.register(stellarpayFastify, {
  config: {
    network: "stellar:testnet",
    payTo: process.env.DEMO_PAYTO!,
    mppSecretKey: process.env.DEMO_MPP_SECRET!,
    routes: { "GET /stats/fees": { price: "$0.005", scheme: "mpp-charge" } },
  },
});
app.get("/stats/fees", async (_req, reply) => reply.send(await feeStats()));
```

That's [`src/server.ts`](./src/server.ts) in essence — the real file additionally wires the
dashboard receipt reporter and a `description` on the route.

Part of the [stellarpay](../../README.md) SDK's `examples/` directory. See
[`docs/modules/examples.md`](../../docs/modules/examples.md) for the full module doc.

## Routes

| Route | Price | Scheme | What you get |
| --- | --- | --- | --- |
| `GET /` | free | — | JSON service index: the route, its price, and its scheme |
| `GET /healthz` | free | — | `{ "ok": true }` |
| `GET /stats/fees` | **$0.005** | `mpp-charge` | Live Horizon `/fee_stats`: last ledger, ledger capacity usage, a derived `low`/`moderate`/`high` congestion verdict, and the raw `feeCharged`/`maxFee` percentile blocks |

The paywall's route table uses the exact key `"GET /stats/fees"` — stellarpay route keys are
`"METHOD /exact/path"` or `"METHOD /prefix/*"` and have no `:param` syntax
(`packages/core/src/config.ts:7`, `packages/core/src/router.ts:14-19`); since this route has no
path parameters, an exact key is enough.

The congestion verdict is derived straight from live `ledger_capacity_usage`
(`< 0.5` → `low`, `< 0.8` → `moderate`, otherwise `high`; `unknown` if Horizon ever omits or
malforms the field) — never invented or hardcoded (`src/fees.ts`).

## Try it

```bash
cp .env.example .env   # fill in DEMO_PAYTO and DEMO_MPP_SECRET at minimum
pnpm dev                # or: pnpm start
```

Free routes need no payment:

```bash
curl localhost:4603/
curl localhost:4603/healthz
```

The paid route answers `402` with an MPP challenge header:

```bash
curl -i localhost:4603/stats/fees
```

## Pay it with `@stellarpay-sdk/client`

`createPayingFetch` is a drop-in `fetch` that answers the MPP challenge, signs, settles, and
replays the request:

```ts
import { createPayingFetch } from "@stellarpay-sdk/client";

const payingFetch = createPayingFetch({
  secret: process.env.BUYER_SECRET,          // Stellar secret seed (S…), funded with testnet USDC
  network: "stellar:testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  limits: { maxPerCall: "$0.05", maxTotal: "$0.20" },
  onEvent: (e) => console.log(e),            // challenge → paying → paid
});

const fees = await payingFetch("http://localhost:4603/stats/fees");
console.log(fees.status, await fees.json());   // 200, with live fee stats + a congestion verdict
```

The buyer account needs testnet XLM for fees and a funded testnet USDC trustline — see
`scripts/smoke.ts`'s setup instructions for the full walkthrough.

## Env vars

See [`.env.example`](./.env.example). Nothing here is ever logged or echoed — a missing
required var is reported by **name** only.

| Var | Required | Purpose |
| --- | --- | --- |
| `DEMO_PAYTO` | yes | Stellar account (`G…`) that receives payments. Public value. |
| `DEMO_MPP_SECRET` | yes | HMAC secret for the mpp-charge scheme. Server-side only. |
| `DASHBOARD_URL` | no | Dashboard base URL, no trailing slash. |
| `INGEST_SECRET` | no | Bearer secret for the dashboard's `/ingest`. |
| `PORT` | no | Listen port. Defaults to `4603`. |

Receipt reporting is entirely optional: with `DASHBOARD_URL` or `INGEST_SECRET` unset, the
reporter is a no-op and the API is unaffected. Even when configured, reporting is
fire-and-forget with a 3s timeout — a dashboard that is down, slow, or misconfigured can
never fail a paid request.

## Tests

None — this is the spec's deliberate no-owned-logic example (spec §9): the only logic beyond
the copied, already-tested `reportReceipt.ts` is a single guarded Horizon mapping in
`src/fees.ts`, which takes an injected `fetch` so it *could* be tested without network, but no
test suite is wired up here on purpose. Typecheck only:

```bash
pnpm --filter @stellarpay-examples/fastify-api typecheck
```
