# @stellarpay-sdk/core — Config, Router, Scheme Modules, and the `stellarpay()` Orchestrator

**Last verified:** 2026-08-04

## Purpose

The public SDK package. Validates a `StellarpayConfig`, compiles a route table, dispatches
matched requests to the configured payment scheme (`x402`, `mpp-charge`, or `mpp-channel`),
and wraps the whole thing in an error boundary so paywall bugs never turn into leaked
internals or unhandled rejections for the host app.

## Structure

- `src/types.ts` — Public type surface: `NetworkId`, `Scheme`, `PriceInput`, `RouteRule`,
  `Receipt`, `StellarpayConfig`, `SchemeOutcome`, `SchemeModule`, `StellarpayConfigError`.
- `src/config.ts` — `parseConfig`: Zod validation of an unknown value into `StellarpayConfig`.
- `src/router.ts` — `compileRoutes` / `matchRoute`: route-table compilation and request matching.
- `src/schemes/mppCharge.ts` — `createMppChargeModule`: per-request MPP charge scheme.
- `src/schemes/mppChannel.ts` — `createMppChannelModule`: MPP payment-channel scheme.
- `src/schemes/x402.ts` — `createX402Module`: x402 scheme via facilitator settlement.
- `src/schemes/webAdapter.ts` — `webAdapter`: adapts a web-standard `Request` to x402's `HTTPAdapter`.
- `src/stellarpay.ts` — `stellarpay()`: ties config + router + scheme modules into the public API.
- `src/internal/price.ts` — `dollarToDecimal`, `decimalToBaseUnits`, `InvalidPriceError`:
  price/amount conversion helpers. Moved here from the (now-unused-by-this-package) private
  `@stellarpay-sdk/shared`, 2026-08-03 — see Dependencies below.
- `src/internal/networks.ts` — `NETWORKS`, `NetworkPreset`: per-network URL/passphrase
  presets. Same move as `price.ts`; imports `NetworkId` from `../types.ts` rather than
  redeclaring it.
- `src/internal/index.ts` — barrel re-exporting `price.ts` + `networks.ts`, used by this
  package's own internal imports (`config.ts`, `schemes/*.ts`).
- `src/index.ts` — Public re-exports, including `dollarToDecimal`/`decimalToBaseUnits`/
  `NETWORKS`/`NetworkPreset` as plain utility exports (see Public exports below).

## Public Surface

### Orchestrator (Task 9)

- `type Stellarpay` — the package's public API surface (`packages/core/src/stellarpay.ts:9-24`):
  - `handle(req: Request): Promise<Response | undefined>` — documented public entry point;
    resolves `undefined` when no configured route matches (`stellarpay.ts:14`).
  - `handleWithMeta(req: Request): Promise<{ response?: Response; passHeaders?: Record<string, string> }>`
    — adapter-facing variant distinguishing no-match (`{}`), pass-through
    (`{ passHeaders }`), and direct-response (`{ response }`) (`stellarpay.ts:21`).
  - `ready(): Promise<void>` — runs every instantiated scheme module's optional `init()`
    (`stellarpay.ts:23`).
- `function stellarpay(config: unknown): Stellarpay` — validates `config` via `parseConfig`
  (throws `StellarpayConfigError` synchronously on invalid input), instantiates only the
  scheme modules the configured routes actually reference, compiles the route table, and
  returns the `Stellarpay` handle (`packages/core/src/stellarpay.ts:73-124`).

### Types (`packages/core/src/types.ts`)

- `type NetworkId = "stellar:testnet" | "stellar:pubnet"` (`types.ts:13`)
- `type Scheme = "x402" | "mpp-charge" | "mpp-channel"` (`types.ts:16`)
- `type PriceInput = string | { asset: string; amount: string }` (`types.ts:19`)
- `type RouteRule = { price: PriceInput; scheme?: Scheme; sponsorGas?: boolean; description?: string }` (`types.ts:22`)
- `type Receipt` — settlement receipt shape emitted to `onPayment` (`types.ts:25-45`). Its
  `amount` field's unit depends on the route's price form — decimal for dollar prices, raw
  base units for x402's explicit-asset prices (`types.ts:29-35`; see Gotchas below).
- `type StellarpayConfig` — top-level SDK config (`types.ts:48-68`), including
  `facilitatorApiKey?: string` (`types.ts:60`) — bearer token for the x402 facilitator's
  `verify`/`settle`/`supported` endpoints; semi-sensitive, never logged or echoed in error
  messages, same handling as `mppSecretKey`/`sponsorSecret`
- `type SchemeOutcome = { type: "pass"; receipt?: Receipt; headers?: Record<string, string> } | { type: "respond"; response: Response }` (`types.ts:71-73`)
- `type SchemeModule = { scheme: Scheme; init?(): Promise<void>; handle(req, match): Promise<SchemeOutcome> }` (`types.ts:76-80`)
- `class StellarpayConfigError extends Error` — thrown by `parseConfig` (`types.ts:83`)

### Config

- `function parseConfig(input: unknown): StellarpayConfig` — Zod-validates config, cross-checks
  that `mppSecretKey`/`sponsorSecret`/`channel` are present when routes need them; throws
  `StellarpayConfigError` with a field-naming (never value-echoing) message on failure
  (`packages/core/src/config.ts`). `facilitatorApiKey` is validated as a plain optional
  string (`config.ts`'s `configSchema`, next to `mppSecretKey`) — no format constraint (it's an
  opaque bearer token, not a Stellar key) and no cross-field requirement: unlike
  `mppSecretKey`/`sponsorSecret`/`channel`, omitting it never fails validation, since the x402
  facilitator auth requirement is a live-network concern `parseConfig` can't see at config time.
  `channel.commitmentPublicKey` must match `/^[0-9a-fA-F]{64}$/` — a raw ed25519 public key,
  hex-encoded, not a Stellar `G...` strkey (see Gotchas below). `parseConfig` also rejects two
  scheme/config combinations that would otherwise silently misbehave at request time (both
  added in the final fix wave, 2026-08-03 — see Gotchas): an explicit-asset `{asset, amount}`
  price on an `mpp-charge`/`mpp-channel` route, and any `mpp-*` route when `network` is
  `"stellar:pubnet"`.

### Router

- `function compileRoutes(routes: Record<string, RouteRule>): CompiledRoute[]` — sorts exact
  routes before wildcards, longest-prefix-first among wildcards (`packages/core/src/router.ts:22-73`).
- `function matchRoute(compiled, method, pathname): { pattern: string; rule: RouteRule } | undefined`
  (`packages/core/src/router.ts:85-109`).

### Scheme modules (internal — not exported from `index.ts`)

- `createMppChargeModule(cfg): SchemeModule` — per-request MPP settlement via `mppx` +
  `@stellar/mpp/charge/server`, in-memory replay store (`packages/core/src/schemes/mppCharge.ts:55-89`).
  On a successful settlement, populates `receipt.txHash` from the mpp `Payment-Receipt`
  header via `txHashFromReceiptHeader` (`mppCharge.ts:28-39`, wired at `mppCharge.ts:79,84-85`)
  — see Gotchas and "Confirmed Wire Shapes" below. Does **not** populate `receipt.payer`: the
  mppx `Receipt` schema (`method`, `reference`, `externalId`, `subscriptionId`, `status`,
  `timestamp` — `node_modules/mppx/dist/Receipt.d.ts`) has no payer-equivalent field to read.
- `createMppChannelModule(cfg): SchemeModule` — voucher-based MPP payment channel via
  `@stellar/mpp/channel/server`, in-memory state (`packages/core/src/schemes/mppChannel.ts:37-71`).
  Also re-exports `close`, `getChannelState`, `watchChannel` for ops tooling (`mppChannel.ts:9`).
- `createX402Module(cfg): SchemeModule` — x402 verification + settlement through the
  configured facilitator (`packages/core/src/schemes/x402.ts:28-70`). When
  `cfg.facilitatorApiKey` is set, wires `HTTPFacilitatorClient`'s `createAuthHeaders` via
  `authHeadersFor` (`x402.ts:21-25`) so every `verify`/`settle`/`supported` call carries
  `Authorization: Bearer <key>` — required by the OZ testnet facilitator, which 401s without
  it.
- `webAdapter(req: Request): HTTPAdapter` — adapts a `Request` for `@x402/core/server`
  (`packages/core/src/schemes/webAdapter.ts:4-14`).

These factories are **intentionally not re-exported from `src/index.ts`**: the public
contract is `stellarpay()` + `Stellarpay`, not the individual scheme constructors. Tests
that need them import directly from `src/schemes/*.ts`.

### Public exports (`packages/core/src/index.ts`)

`stellarpay`, `type Stellarpay`, everything from `types.ts`, `parseConfig`, `compileRoutes`,
`matchRoute`, `type CompiledRoute`, plus plain utility exports `dollarToDecimal`,
`decimalToBaseUnits`, `NETWORKS`, `type NetworkPreset` (from `src/internal/`, see Structure
above) — not part of the orchestrator's own contract, but exported since `client`/`mcp` (and
any consumer building custom price/asset logic) need them and can no longer import them from
the private `@stellarpay-sdk/shared`.

## Key Methods (`file:line`)

- `stellarpay()` orchestration: `packages/core/src/stellarpay.ts:73-124`
- `handleWithMeta` (closure inside `stellarpay()`): `packages/core/src/stellarpay.ts:81-112`
- `effectiveScheme(rule)` — a route's scheme, defaulting to `"x402"` when unset: `packages/core/src/stellarpay.ts:27-29`
- `createSchemeModule(scheme, cfg)` — exhaustive switch instantiating one scheme module: `packages/core/src/stellarpay.ts:32-45`
- `isNetworkError(err)` — `TypeError` or `cause.code === "ECONNREFUSED"` heuristic: `packages/core/src/stellarpay.ts:53-59`
- `errorResponse(status, body)` — fixed-shape JSON error response builder: `packages/core/src/stellarpay.ts:62-64`
- `authHeadersFor(facilitatorApiKey)` — builds the per-path `createAuthHeaders` hook
  (`{ verify, settle, supported }`, each `{ Authorization: "Bearer <key>" }`) for
  `HTTPFacilitatorClient`; returns `undefined` (no auth) when `facilitatorApiKey` is unset:
  `packages/core/src/schemes/x402.ts:21-25`

## Dependencies

- `zod` — config schema validation (`config.ts`).
- `mppx`, `@stellar/mpp`, `@stellar/stellar-sdk` — MPP charge/channel schemes.
- `@x402/core` (pinned `~2.20.0`, not `^` — a looser range risks a second, incompatible copy
  resolving alongside `@stellarpay-sdk/client`'s own `@x402/core` dependency, breaking
  `instanceof` checks across the two installed copies), `@x402/stellar` — x402 scheme +
  facilitator client.

No dependency on `@stellarpay-sdk/shared`: `NETWORKS`, `dollarToDecimal`, and `decimalToBaseUnits`
live in this package's own `src/internal/` (see Structure above) and are re-exported as plain
utilities from `src/index.ts` — see Public exports below. This move (part of the final fix
wave, 2026-08-03) is what unblocks `npm install`ing this package standalone: `@stellarpay-sdk/shared`
is `"private": true` and can never be published, so a publishable package can never declare it
as a runtime `dependency`.

## Gotchas & Invariants

- **Only referenced schemes are instantiated.** `stellarpay()` computes the set of schemes
  actually used across `cfg.routes` (defaulting unset `scheme` to `"x402"`, matching the
  same default `createX402Module` uses internally to build its own route subset — see
  `packages/core/src/schemes/x402.ts:37`) and only calls the matching factory for each. A
  config with no `mpp-channel` routes never touches `cfg.channel`, so it's safe to omit.
- **`mpp-charge`/`mpp-channel` are pinned to testnet USDC (`USDC_SAC_TESTNET`), with no
  per-network asset selection — `parseConfig` rejects them on `"stellar:pubnet"`.** Both
  scheme factories hardcode `currency: USDC_SAC_TESTNET` (`mppCharge.ts`, `mppChannel.ts`)
  regardless of `cfg.network`; there is no config field to pick a different SAC address for
  mainnet. Rather than silently settling a pubnet request against a testnet-only asset,
  `configSchema`'s `superRefine` (`config.ts`) rejects any config combining
  `network: "stellar:pubnet"` with a route whose scheme is `mpp-charge`/`mpp-channel`
  ("mpp schemes currently support stellar:testnet only..."). Only `x402` routes work against
  `"stellar:pubnet"` today; mainnet support for the mpp schemes is a roadmap item.
- **Explicit-asset (`{asset, amount}`) prices are rejected on `mpp-*` routes — a real
  money-correctness bug, not just an inconsistency.** `mpp-charge`/`mpp-channel`'s
  `amountFor()` (their own source files) would pass an explicit-asset price's `amount`
  straight through as if it were a decimal string, but `@stellar/mpp`'s server always
  multiplies the request amount by the configured asset's decimals — and `currency` is fixed
  per-factory with no per-call override (see the bullet above), so the configured asset is
  ignored too. The combination would overcharge by roughly `10^7`x in the wrong asset.
  `configSchema`'s `superRefine` rejects `{asset, amount}` prices on any route whose scheme
  is `mpp-charge`/`mpp-channel` before this can happen; only dollar-string prices are
  accepted there. Plain `x402` routes are unaffected and still accept explicit-asset prices.
- **`channel.commitmentPublicKey` must be 64-hex, not a Stellar address.**
  `createMppChannelModule` (`mppChannel.ts`) decodes it via `Buffer.from(key, "hex")` then
  `StrKey.encodeEd25519PublicKey(...)` — it expects the *raw* ed25519 public key bytes,
  hex-encoded (64 hex chars = 32 bytes), not a `G...` strkey. `channelSchema` in `config.ts`
  enforces `/^[0-9a-fA-F]{64}$/` so a G-strkey (or anything else non-hex) is rejected at
  config time with a message naming the field and the expected format, instead of throwing an
  opaque `Buffer`/`StrKey` error the first time a `mpp-channel` route is hit.
- **The x402 facilitator requires auth, and `parseConfig` can't enforce that.** The OZ
  testnet facilitator's `/verify`, `/settle`, and `/supported` endpoints all require
  `Authorization: Bearer <key>` — omitting `facilitatorApiKey` doesn't fail config
  validation (see Config above), it fails at request time against the live facilitator with
  a 401 that `x402ResourceServer`/`x402HTTPResourceServer` surface as their own error. A free
  testnet key: `curl https://channels.openzeppelin.com/testnet/gen` → `{"apiKey":"..."}`
  (unauthenticated endpoint). Confirmed live: `/supported` returns
  `{"kinds":[{"extra":{"areFeesSponsored":true},"network":"stellar:testnet","scheme":"exact",...}]}`
  with the header, 401 without it.
- **`@x402/core`'s `createAuthHeaders` must return a *per-path* object, not flat headers.**
  `FacilitatorConfig.createAuthHeaders` (the installed `@x402/core`'s own doc comment, and
  `chunk-4Y6I6537.mjs`'s runtime `createAuthHeaders()`) requires
  `{ verify?, settle?, supported?, bazaar? }`, each a headers object — passing a flat
  `{ Authorization: "..." }` throws at call time (a deliberate guard against silently
  dropping auth on every request). `authHeadersFor` (`x402.ts:21-25`) returns the same
  headers object for all three paths stellarpay uses, since the OZ facilitator's requirement
  is uniform across them.
- **Two nested try/catch layers.** The outer boundary in `handleWithMeta`
  (`stellarpay.ts:82-111`) covers route matching and `mod.handle()`; it maps unexpected
  errors to a fixed-shape response and always `console.error`s the real error server-side
  only — the response body is never the raw error. A separate inner try/catch
  (`stellarpay.ts:96-101`) isolates `cfg.onPayment?.(receipt)` so a throwing user hook logs
  and is swallowed rather than turning a successful payment into a 500.
- **`onPayment` only fires when there's a receipt.** `SchemeOutcome`'s `pass` variant has an
  optional `receipt` (e.g. x402's "no payment required" case passes without one — see
  `packages/core/src/schemes/x402.ts:53`); `handleWithMeta` skips the hook call entirely in
  that case rather than invoking it with `undefined`.
- **`isNetworkError`'s `TypeError` check is broad by design, per spec.** Any `TypeError`
  thrown anywhere inside route matching or scheme `handle()` — not just from `fetch()` —
  is classified as `503 settlement_unavailable`. In practice this also covers `new
  URL(req.url)` throwing on a malformed URL (the `URL` constructor throws `TypeError`),
  which would map to 503 rather than 500. This is the detection heuristic specified for
  this task (fetch failures surface as `TypeError` per the WHATWG spec); it is a known
  imprecision, not a bug.
- **The brief's third `stellarpay.test.ts` case is a conditional no-op against `mppx`
  0.6.31.** The test hands `pay.handle()` a plain object shaped like a `Request` (real
  `url`/`method`/`headers`, no other `Request` methods) to try to force an internal error.
  Verified directly: `mppx`'s charge flow tolerates this shape — it logs `[mppx] Could not
  clone server event input; omitting `context.input`. Use `capturedRequest` for request
  correlation.` to stderr and still returns a normal 402 challenge, so `res.status === 402`
  and the test's `if (res && res.status !== 402)` body never runs. The 500/503 error-boundary
  paths themselves are exercised (and correct) — confirmed by manual probes forcing a
  generic thrown error (→ 500, `{ error: "paywall_internal" }`, no leak) and a `TypeError`
  (→ 503, `{ error: "settlement_unavailable", retryable: true }`) — just not by this
  particular test input against this particular scheme module.
- **Scheme module state is in-process only.** `mpp-charge` and `mpp-channel` use
  `Store.memory()` for replay/voucher state (see their own doc comments); this is a v0.1,
  single-process limitation, not something `stellarpay()` changes.

## Testing

- `packages/core/test/stellarpay.test.ts` — orchestrator: unmatched routes, `mpp-charge`
  dispatch to 402, the conditional error-mapping case discussed above, `handleWithMeta`
  shape, and synchronous `StellarpayConfigError` on bad config.
- `packages/core/test/config.test.ts`, `router.test.ts`, `mppCharge.test.ts`,
  `mppChannel.test.ts`, `x402.test.ts` — per-module unit tests for Tasks 4–8.
- `packages/core/test/price.test.ts`, `networks.test.ts` — unit tests for the
  `src/internal/` price/network utilities, moved here from `@stellarpay-sdk/shared` in the final
  fix wave (2026-08-03) along with the source files themselves.
- `config.test.ts` — `"accepts an optional facilitatorApiKey"`: `parseConfig` round-trips the
  field unchanged. Final fix wave additions: explicit-asset prices rejected on `mpp-charge`/
  `mpp-channel` routes but still accepted on plain `x402` routes; `stellar:pubnet` rejected
  when any `mpp-*` route is configured but accepted for `x402`-only configs; a G-strkey
  `commitmentPublicKey` rejected, a 64-hex one accepted.
- `mppCharge.test.ts` — `"converts dollar price to decimal amount for mppx, not the raw
  \"$0.01\" string"`: decodes the actual 402 `WWW-Authenticate` challenge via mppx's own
  `Challenge.fromResponse` and asserts the wire `request.amount` equals
  `decimalToBaseUnits("0.01")` in base units — not just that the response type is `"respond"`
  — making the `dollarToDecimal`/`toBaseUnits` conversion pipeline load-bearing instead of
  merely implied by a non-throw. `describe("txHashFromReceiptHeader", ...)` (8 cases) feeds
  the real production `Payment-Receipt` header quoted in "Confirmed Wire Shapes" below through
  the helper directly and asserts the tx hash comes out, plus the negative cases: missing
  header, undecodable base64url, valid-base64-but-not-JSON, JSON with no `reference`,
  non-hex/wrong-length `reference`, non-string `reference` — every one must yield `undefined`.
- `x402.test.ts` — `"sends a Bearer Authorization header to the facilitator when
  facilitatorApiKey is set"` / `"sends no Authorization header when facilitatorApiKey is not
  set"`: both capture the mocked fetch's `init.headers` on the `/supported` call and assert
  on the `Authorization` header directly, proving `authHeadersFor` actually reaches the
  outbound request rather than just that config accepts the field.
- Run: `pnpm --filter @stellarpay-sdk/core test` (or `pnpm test` from repo root for the full
  workspace suite).

## Confirmed Wire Shapes (live testnet smoke, 2026-08-03)

`pnpm smoke` (`scripts/smoke.ts`) was run end-to-end against live testnet infrastructure
(OZ x402 facilitator + Soroban RPC). Both legs **PASS**. This confirms the two "opaque until
the smoke run confirms them" shapes referenced elsewhere in this doc and in `x402.ts`/`mppCharge.ts`:

- **x402 `settle` raw** (`packages/core/src/schemes/x402.ts:61`, `receipt.raw`) — confirmed
  observed shape:
  ```json
  {
    "success": true,
    "payer": "GDB4W7YOHCURLG6RBI3QTPIKOW5PQQ5YB6X5EA4GCBTK5V637UMDFFEY",
    "transaction": "47c7eeab699e24eee7abb1d60aaccafca0bc102d9bddb2ec0de7b22b8ed06136",
    "network": "stellar:testnet",
    "headers": { "PAYMENT-RESPONSE": "<base64url-encoded copy of success/payer/transaction/network>" },
    "requirements": { "scheme": "exact", "network": "stellar:testnet", "amount": "10000", "asset": "<SAC address>", "payTo": "<G...>", "maxTimeoutSeconds": 300, "extra": { "areFeesSponsored": true } }
  }
  ```
  The defensive `s["transaction"]` / `s["payer"]` string-narrowing at `x402.ts:64-66` is
  **confirmed correct**: both fields are present as top-level strings on the real facilitator
  response, and `receipt.txHash` / `receipt.payer` were populated exactly as expected in the
  smoke run.
- **mpp-charge `Payment-Receipt` header** (`packages/core/src/schemes/mppCharge.ts:79`,
  `receipt.raw`) — the header value is a base64url-encoded (unpadded) JSON string. Decoding
  the smoke run's captured value gives:
  ```json
  {
    "method": "stellar",
    "reference": "9f8292f40ae2b7dadeae9d7f4ee4e6f8bf92bab42047b490e197d55cae11dd0b",
    "status": "success",
    "timestamp": "2026-08-03T18:40:40.097Z"
  }
  ```
  Documented as **opaque-but-observed**: this is `mppx`/`@stellar/mpp`'s own header format,
  not something `@stellarpay-sdk/core` controls or has a published schema for — `mppCharge.ts`
  still stores the raw header string as-is (`receipt.raw`), unparsed and unchanged.
  **Correction (2026-08-04):** an earlier version of this doc claimed `reference` was "an
  mppx-internal challenge/payment id, not a verified on-chain tx hash" and that it was
  deliberately not mapped onto `Receipt.txHash`. That was wrong — verified by reading
  `@stellar/mpp@0.7.1`'s own server source
  (`node_modules/@stellar/mpp/dist/charge/server/Charge.js`): all three credential flows
  (`signedHash`, `hash`, `transaction`) set `reference: hash` / `reference: sendResult.hash`
  to the actual broadcast transaction's hash — the `hash` credential flow even calls
  `rpcServer.getTransaction(hash)` to confirm it landed on-chain before building the receipt.
  The above `9f8292f4...` reference independently resolves on Horizon
  (`https://horizon-testnet.stellar.org/transactions/9f8292f4...`) as a successful transaction
  in ledger 3952505, same as a second, separately-captured production receipt whose
  `reference` (`20e4b38c2d8589b01ab1069209448bb653ce7650ecc9edbb33f6d103f0c9d05a`) resolves as
  a successful transaction in ledger 3968442 — both re-confirmed live on 2026-08-04. `mppCharge.ts` now decodes the header and, when
  `reference` is present and hash-shaped (64-char lowercase hex), sets `receipt.txHash` from
  it via `txHashFromReceiptHeader` (`mppCharge.ts:16-39`, wired at `mppCharge.ts:84-85`) — the
  same shape the dashboard already renders as a `stellar.expert` link for x402 receipts
  (`examples/dashboard/public/index.html:103,112`; see `docs/modules/examples.md`'s dashboard
  section). The header's schema is still not owned by this package, so the decode is
  defensive end to end: a missing header, undecodable base64url, non-JSON payload, missing
  `reference`, or a `reference` that isn't hash-shaped all yield `undefined` rather than a
  guessed value — never surface a wrong explorer link. `receipt.payer` is **not** populated
  for mpp-charge: the mppx `Receipt` schema it decodes from has no payer-equivalent field
  (`method`, `reference`, `externalId`, `subscriptionId`, `status`, `timestamp` only —
  `node_modules/mppx/dist/Receipt.d.ts`), unlike the x402 leg's `settle.payer`.

## stellar-sdk version (2026-08-03)

`@stellar/stellar-sdk` moved from an exact `15.1.0` pin to an exact `16.2.0` pin (root
`pnpm.overrides` + every package manifest). Why: live Stellar testnet emits a Soroban
credentials variant in simulation/auth XDR that `15.1.0`'s bundled XDR definitions don't know
(`XDR Read Error: unknown SorobanCredentialsType member for value 2`, hit by the `mpp-charge`
leg via `@stellar/mpp`'s auth-building path) — `16.2.0`'s XDR defines all four
`SorobanCredentialsType` variants (`sorobanCredentialsSourceAccount` = 0,
`sorobanCredentialsAddress` = 1, `sorobanCredentialsAddressV2` = 2,
`sorobanCredentialsAddressWithDelegates` = 3; confirmed by grepping the installed
`node_modules/.pnpm/@stellar+stellar-sdk@16.2.0/.../dist/stellar-sdk.js`), so value 2 parses
correctly. `@stellar/mpp@0.7.1`'s own `peerDependencies` still declare
`"@stellar/stellar-sdk": "^15.1.0"` (its `package.json`) — pnpm resolves this peer against the
overridden `16.2.0` without a hard failure (no `strict-peer-dependencies` in this repo's
`.npmrc`); `pnpm why @stellar/stellar-sdk` and `pnpm-lock.yaml` both confirm every consumer
(including `@stellar/mpp`'s own dependency graph) resolves to the single `16.2.0` copy, not a
nested/duplicate one. This mismatch is accepted deliberately per this task's brief. No source
changes were needed elsewhere in the SDK for the bump: `Keypair`/`Transaction`/`StrKey`
(re-exported from `./base/index.js`) and the `rpc` namespace export
(`export * as rpc from "./rpc/index.js"`) are unchanged in `16.2.0`'s
`lib/esm/index.d.ts`/`lib/esm/base/index.d.ts` — confirmed against the installed package's own
`.d.ts` files, and `pnpm typecheck` (7/7) / `pnpm build` (7/7) / `pnpm test` (19 files, 80
tests) all pass unmodified.

## Verified Against

- Source read and line numbers confirmed 2026-08-01 against the current working tree
  (`packages/core/src/*.ts`).
- `mppx@0.6.31` behavior on a non-standard `Request`-like object confirmed by direct
  invocation (`createMppChargeModule(cfg).handle(broken, match)`) and via the full
  `stellarpay()` orchestrator, both producing a 402 with the stderr warning quoted above.
- 2026-08-02 (`facilitatorApiKey` fix round): line numbers recounted against the current
  working tree after adding `facilitatorApiKey` to `types.ts`/`config.ts` and `authHeadersFor`
  to `schemes/x402.ts`. The OZ facilitator's bearer-auth requirement and the `/gen` endpoint
  were confirmed live: with `Authorization: Bearer <key>`, `/supported` returns
  `{"kinds":[{"extra":{"areFeesSponsored":true},"network":"stellar:testnet","scheme":"exact",...}]}`;
  without it, 401. `@x402/core`'s per-path `createAuthHeaders` contract (flat headers object
  throws) verified against the installed package's own doc comment
  (`node_modules/@x402/core/dist/esm/x402Client-0g4vl2En.d.mts:60-85`) and its runtime
  implementation (`chunk-4Y6I6537.mjs`'s `createAuthHeaders()`/`getSupported()`).
- 2026-08-03 (final fix wave): `price.ts`/`networks.ts` (+tests) moved in from
  `@stellarpay-sdk/shared` into `src/internal/`, re-exported as plain utilities from
  `index.ts`; `config.ts` gained the explicit-asset/mpp-*, pubnet/mpp-*, and 64-hex
  `commitmentPublicKey` rejections (with new tests); `types.ts`'s doc comments recounted
  (`Receipt.amount`'s doc grew from 1 line to 7, the top-of-file comment shrank by 1 —
  everything from `Receipt` onward in `types.ts` shifted `+4`, reflected in the citations
  above). `pnpm typecheck` (7/7) / `pnpm build` (7/7) / `pnpm test` (19 files, 88 tests, up
  from 80 — the ten new tests are `price.test.ts` (arriving with 10 of its own, moved
  as-is), `networks.test.ts` (2, moved as-is), and 8 new `config.test.ts` cases; net package
  count for `pnpm test`/`pnpm build`/`pnpm typecheck` is still 7, `@stellarpay-sdk/shared` was
  already counted before this move) all pass. `pnpm pack` of `core`/`client`/`mcp`, `npm
  install` of the `core` tarball in a directory outside this workspace, and `node -e
  "import('@stellarpay-sdk/core').then(m => console.log(typeof m.stellarpay))"` printing
  `"function"` were all re-verified against the moved layout — see the root fix-wave report
  for full command output.
- 2026-08-04 (mpp-charge `txHash`): `txHashFromReceiptHeader` (`mppCharge.ts:16-39`) added
  and wired at `mppCharge.ts:79,84-85`; line numbers throughout this doc recounted against the
  current file. `@stellar/mpp@0.7.1`'s server source
  (`node_modules/@stellar/mpp/dist/charge/server/Charge.js`) read directly to confirm
  `reference` is the real settlement hash across all three credential flows (see "Confirmed
  Wire Shapes" above); two independently-captured `reference` values re-verified live against
  Horizon testnet the same day (ledgers 3952505 and 3968442). mppx's `Receipt` schema
  (`node_modules/mppx/dist/Receipt.d.ts`) read to confirm it has no payer-equivalent field, so
  `receipt.payer` is correctly left unset for mpp-charge. `pnpm --filter @stellarpay-sdk/core test`
  passes 63/63 (was 55, +8 for `txHashFromReceiptHeader`'s test suite); `pnpm typecheck` clean.
