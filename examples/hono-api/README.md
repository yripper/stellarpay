# hono-api — whale alerts, paywalled in a 6-line diff

The entire difference between this API being open and being paid:

```diff
 import { Hono } from "hono";
+import { stellarpayHono } from "@stellarpay-sdk/hono";

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
| `GET /alerts/whales` | **$0.01** | `x402` | The top 10 largest native-XLM payments among the most recent 200 payment operations on testnet — no size floor |

The paywall's route table uses the exact key `"GET /alerts/whales"` — stellarpay route keys
are `"METHOD /exact/path"` or `"METHOD /prefix/*"` and have no `:param` syntax
(`packages/core/src/config.ts:7`, `packages/core/src/router.ts:14-19`); since this route has
no path parameters, an exact key is enough.

There is no fixed XLM threshold: testnet payment volume is small and bursty (single-payment
transfers of a few XLM are typical), so a fixed floor would make the paid route return an
empty list almost every time a judge tried it. Instead the response always returns the top
10 largest native payments it found in the 200-op window, however large or small those
actually were, and says so explicitly:

```json
{
  "window": "200 most recent payment ops",
  "count": 10,
  "largestXlm": "2.0000000",
  "whales": [
    { "amountXlm": "2.0000000", "from": "G…", "to": "G…", "asset": "XLM", "at": "2026-08-04T…", "tx": "…", "link": "https://stellar.expert/explorer/testnet/tx/…" }
  ],
  "source": "horizon-testnet, live"
}
```

`count` always matches the number of records actually returned (fewer than 10 when the
window has fewer than 10 native payments); `largestXlm` is `null` on the one edge case
where the window has no native payments at all — never fabricated to look busier.

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

## Pay it with `@stellarpay-sdk/client`

`createPayingFetch` is a drop-in `fetch` that answers the x402 challenge, signs, settles, and
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

const alerts = await payingFetch("http://localhost:4602/alerts/whales");
console.log(alerts.status, await alerts.json());   // 200, with the top 10 live payments in the window
```

The buyer account needs testnet XLM for fees and a funded testnet USDC trustline — see
`scripts/smoke.ts`'s setup instructions for the full walkthrough.

## Env vars

See [`.env.example`](./.env.example). Nothing here is ever logged or echoed — a missing
required var is reported by **name** only.

| Var | Required | Purpose |
| --- | --- | --- |
| `DEMO_PAYTO` | yes | Stellar account (`G…`) that receives payments. Public value. |
| `DEMO_FACILITATOR_KEY` | **yes, in practice** | x402 facilitator bearer token. Free: `curl https://channels.openzeppelin.com/testnet/gen`. Not required by `parseConfig` itself (`packages/core/src/types.ts:54-58`), but the OZ testnet facilitator's `/verify`/`/settle` endpoints require it — this service's only paid route, `GET /alerts/whales`, is x402, so without this var it 401s on every payment attempt instead of settling. |
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

`test/whales.test.ts` drives the pure `extractWhales` sort/cap directly: descending order,
capping to the limit, an empty window, a window with fewer native payments than the limit,
and survival of malformed records — no network involved.
