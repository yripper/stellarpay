# Stellar Intel — express-api

The flagship paid API of the stellarpay demo. It sells **live Stellar testnet intelligence**:
asset authorized-supply and holder counts, top-of-book market data, and account forensics — all read
straight from Horizon at request time. Nothing is cached, mocked, or seeded; if the ledger
moves between two calls, the answers move with it.

Two of its routes are paywalled with [`@stellarpay-sdk/express`](../../packages/express), one per
payment scheme, so a single service demonstrates both halves of the SDK:

- `GET /report/*` settles over **x402** (facilitator-verified `PAYMENT-SIGNATURE`).
- `GET /deep-dive/*` settles over **MPP charge** (`WWW-Authenticate: Payment`), gas-sponsored
  when a sponsor account is configured.

Every settled payment fires `onPayment`, and the receipt is forwarded fire-and-forget to the
[dashboard](../dashboard)'s `/ingest` endpoint, where it shows up live in the judges' feed.

Part of the [stellarpay](../../README.md) SDK's `examples/` directory. See
[`docs/modules/examples.md`](../../docs/modules/examples.md) for the full module doc.

## Routes

| Route | Price | Scheme | What you get |
| --- | --- | --- | --- |
| `GET /` | free | — | JSON service index: every route, its price, and its scheme |
| `GET /healthz` | free | — | `{ "ok": true }` |
| `GET /summary/:code/:issuer` | free | — | Asset teaser: authorized supply (`balances.authorized`, not total circulating supply), holder count, issuer flags |
| `GET /report/:code/:issuer` | **$0.02** | `x402` | Everything in `/summary`, plus the live top of the asset's XLM order book |
| `GET /deep-dive/:account` | **$0.02** | `mpp-charge` | Account balances, subentry count, flags, and its 10 most recent payments |

The paywall's route table uses wildcard prefixes (`"GET /report/*"`, `"GET /deep-dive/*"`) —
stellarpay route keys are `"METHOD /exact/path"` or `"METHOD /prefix/*"` and have no `:param`
syntax (`packages/core/src/config.ts:7`, `packages/core/src/router.ts:14-19`). The Express
routes themselves still use `:params`; the two match the same request paths.

Both intel endpoints map Horizon's failures through: an unknown account or an empty asset
record set becomes `404`, and any other non-OK Horizon response becomes `502
{"error":"horizon_unavailable"}`.

## Try it

```bash
cp .env.example .env   # fill in DEMO_PAYTO and DEMO_MPP_SECRET at minimum
pnpm dev               # or: pnpm start
```

Free routes need no payment:

```bash
curl localhost:4601/
curl localhost:4601/summary/USDC/GD47GCJEFID5BZUWJHSKQR22LEIQJI55FFK3S6V4DSINUET76GRXTSEP
```

A paid route answers `402` with a challenge header — `payment-required` for the x402 route,
`WWW-Authenticate: Payment …` for the MPP one:

```bash
curl -i localhost:4601/report/USDC/GD47GCJEFID5BZUWJHSKQR22LEIQJI55FFK3S6V4DSINUET76GRXTSEP
```

## Pay it with `@stellarpay-sdk/client`

`createPayingFetch` is a drop-in `fetch` that answers the challenge, signs, settles, and
replays the request — both schemes, auto-detected from the response headers:

```ts
import { createPayingFetch } from "@stellarpay-sdk/client";

const payingFetch = createPayingFetch({
  secret: process.env.BUYER_SECRET,          // Stellar secret seed (S…), funded with testnet USDC
  network: "stellar:testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  limits: { maxPerCall: "$0.05", maxTotal: "$0.20" },
  onEvent: (e) => console.log(e),            // challenge → paying → paid
});

const issuer = "GD47GCJEFID5BZUWJHSKQR22LEIQJI55FFK3S6V4DSINUET76GRXTSEP";
const report = await payingFetch(`http://localhost:4601/report/USDC/${issuer}`);
console.log(report.status, await report.json());   // 200, with a live `market` block

const deepDive = await payingFetch(`http://localhost:4601/deep-dive/${issuer}`);
console.log(deepDive.status, await deepDive.json());
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
| `DEMO_FACILITATOR_KEY` | **yes, for `/report/*`** | x402 facilitator bearer token. Free: `curl https://channels.openzeppelin.com/testnet/gen`. Not required by `parseConfig` itself (`packages/core/src/types.ts:54-58`), but the OZ testnet facilitator's `/verify`/`/settle` endpoints require it — without this var, the x402 route (`GET /report/*`) 401s instead of settling; `GET /deep-dive/*` (mpp-charge) is unaffected. |
| `DEMO_SPONSOR_SECRET` | no | Sponsor account seed (`S…`). When set, `/deep-dive/*` becomes gas-sponsored (`sponsorGas: true`). |
| `DASHBOARD_URL` | no | Dashboard base URL, no trailing slash. |
| `INGEST_SECRET` | no | Bearer secret for the dashboard's `/ingest`. |
| `PORT` | no | Listen port. Defaults to `4601`. |

Receipt reporting is entirely optional: with `DASHBOARD_URL` or `INGEST_SECRET` unset, the
reporter is a no-op and the API is unaffected. Even when configured, reporting is
fire-and-forget with a 3s timeout — a dashboard that is down, slow, or misconfigured can
never fail a paid request.

## Tests

```bash
pnpm --filter @stellarpay-examples/express-api test
pnpm --filter @stellarpay-examples/express-api typecheck
```

`test/intel.test.ts` drives the Horizon fetchers through an injected `fetch`, so the suite is
fast and offline; `test/reportReceipt.test.ts` covers the reporter's wire format, its
unset-dashboard no-op, and that a rejecting `fetch` is swallowed rather than escaping as an
unhandled rejection.
