# hono-api — whale alerts, paywalled in a 6-line diff

The entire difference between this API being open and being paid:

```diff
 import { Hono } from "hono";
+import { stellarpayHono } from "@stellarpay/hono";

 const app = new Hono();
+app.use("*", stellarpayHono({
+  network: "stellar:testnet",
+  payTo: process.env.DEMO_PAYTO!,
+  facilitatorApiKey: process.env.DEMO_FACILITATOR_KEY,
+  routes: { "GET /alerts/whales": { price: "$0.01" } },
+}));
 app.get("/alerts/whales", async (c) => c.json(await whales()));
```

No accounts, no API keys for your users, no billing integration: agents pay
per request over the x402 protocol and settlement lands on Stellar testnet.

That's [`src/server.ts`](./src/server.ts) in essence — the real file additionally wires the
dashboard receipt reporter and a `description` on the route, but the paywall itself is exactly
those four config keys behind one middleware call, mounted with `app.use("*", ...)` **before**
the route it protects.

Part of the [stellarpay](../../README.md) SDK's `examples/` directory. See
[`docs/modules/examples.md`](../../docs/modules/examples.md) for the full module doc.

## Routes

| Route | Price | Scheme | What you get |
| --- | --- | --- | --- |
| `GET /` | free | — | JSON service index: the route, its price, and its scheme |
| `GET /healthz` | free | — | `{ "ok": true }` |
| `GET /alerts/whales` | **$0.01** | `x402` | The 10 largest native-XLM payments among the most recent 200 payment operations on testnet, at/above a 10,000 XLM threshold |

The paywall's route table uses the exact key `"GET /alerts/whales"` — stellarpay route keys
are `"METHOD /exact/path"` or `"METHOD /prefix/*"` and have no `:param` syntax
(`packages/core/src/config.ts:7`, `packages/core/src/router.ts:14-19`); since this route has
no path parameters, an exact key is enough.

A scan that finds nothing above the threshold is not an error — it's a real, live answer
(`{ "thresholdXlm": 10000, "count": 0, "whales": [], "source": "horizon-testnet, live" }`).
Testnet payment volume is bursty; whether any single-payment whale shows up depends entirely
on what's moved through the network in the last 200 payment operations at request time.

## Try it

```bash
cp .env.example .env   # fill in DEMO_PAYTO at minimum
pnpm dev                # or: pnpm start
```

Free routes need no payment:

```bash
curl localhost:4602/
curl localhost:4602/healthz
```

The paid route answers `402` with an x402 challenge header:

```bash
curl -i localhost:4602/alerts/whales
```

## Pay it with `@stellarpay/client`

`createPayingFetch` is a drop-in `fetch` that answers the x402 challenge, signs, settles, and
replays the request:

```ts
import { createPayingFetch } from "@stellarpay/client";

const payingFetch = createPayingFetch({
  secret: process.env.BUYER_SECRET,          // Stellar secret seed (S…), funded with testnet USDC
  network: "stellar:testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  limits: { maxPerCall: "$0.05", maxTotal: "$0.20" },
  onEvent: (e) => console.log(e),            // challenge → paying → paid
});

const alerts = await payingFetch("http://localhost:4602/alerts/whales");
console.log(alerts.status, await alerts.json());   // 200, with live whale data
```

The buyer account needs testnet XLM for fees and a funded testnet USDC trustline — see
`scripts/smoke.ts`'s setup instructions for the full walkthrough.

## Env vars

See [`.env.example`](./.env.example). Nothing here is ever logged or echoed — a missing
required var is reported by **name** only.

| Var | Required | Purpose |
| --- | --- | --- |
| `DEMO_PAYTO` | yes | Stellar account (`G…`) that receives payments. Public value. |
| `DEMO_FACILITATOR_KEY` | no | x402 facilitator bearer token. Free: `curl https://channels.openzeppelin.com/testnet/gen`. |
| `DASHBOARD_URL` | no | Dashboard base URL, no trailing slash. |
| `INGEST_SECRET` | no | Bearer secret for the dashboard's `/ingest`. |
| `PORT` | no | Listen port. Defaults to `4602`. |

Receipt reporting is entirely optional: with `DASHBOARD_URL` or `INGEST_SECRET` unset, the
reporter is a no-op and the API is unaffected. Even when configured, reporting is
fire-and-forget with a 3s timeout — a dashboard that is down, slow, or misconfigured can
never fail a paid request.

## Tests

```bash
pnpm --filter @stellarpay-examples/hono-api test
pnpm --filter @stellarpay-examples/hono-api typecheck
```

`test/whales.test.ts` drives the pure `extractWhales` filter directly: threshold/sort/cap
behavior and survival of malformed records — no network involved.
