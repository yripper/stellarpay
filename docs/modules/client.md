# @stellarpay/client — Auto-Paying Fetch (x402 + MPP)

## Purpose

Consumer-side SDK: `createPayingFetch(config)` returns a `fetch`-compatible function that
transparently pays 402 challenges. It probes a request, and on a 402 response, detects
whether the challenge is x402 or MPP, enforces caller-configured spend limits, then
replays the request through the matching payment leg — x402 via `@x402/fetch`, MPP via
`mppx/client` + `@stellar/mpp/{charge,channel}/client`. Emits lifecycle events (`PayEvent`)
throughout so a host app can log/observe payment activity.

## Structure

- `src/detect.ts` — `detectProtocol`: classifies a 402 response as `"x402"` / `"mpp"` / `undefined`.
- `src/limits.ts` — `SpendTracker`, `SpendLimitExceeded`: dollar-limit enforcement in bigint base units.
- `src/events.ts` — `PayEvent`, `Emitter`: the lifecycle-event union and a try/catch-wrapped emitter.
- `src/url.ts` — `toUrlString`: normalizes a fetch `input` to its URL string.
- `src/x402Leg.ts` — `buildX402Fetch`: wraps a fetch with `@x402/fetch`'s payment handling.
- `src/mppLeg.ts` — `createMppLeg`: the MPP payment leg, including its `onChallenge` limit gate.
- `src/index.ts` — `createPayingFetch`: the unified entry point tying probe → detection →
  limit gate → leg dispatch together.
- `test/detect.test.ts`, `test/limits.test.ts`, `test/payingFetch.test.ts` — per-module and
  end-to-end tests.

## Public Surface

- `type PayEvent` — lifecycle event union (`packages/client/src/events.ts:2-7`):
  `"challenge"`, `"paying"`, `"paid"`, `"blocked"`, `"error"`.
- `class SpendLimitExceeded extends Error` — thrown by `SpendTracker.checkAndReserve`
  (`packages/client/src/limits.ts:5`).
- `class UnsupportedChallenge extends Error` — thrown for a 402 whose protocol
  `detectProtocol` can't classify beyond `"x402"`/`"mpp"` today (`packages/client/src/index.ts:14`);
  reserved for a future third protocol — neither leg throws it currently.
- `type PayingFetchConfig` (`packages/client/src/index.ts:17-39`):
  - `secret?: string` / `keypair?: unknown` — one required; `keypair` is narrowed internally
    via `instanceof Keypair` (`index.ts:58`).
  - `network: "stellar:testnet" | "stellar:pubnet"`
  - `limits?: { maxPerCall?: string; maxTotal?: string; allowUnknownAmount?: boolean }` — `"$0.05"`-style strings.
  - `onEvent?: (e: PayEvent) => void`
  - `rpcUrl?: string`
  - `channelCommitmentSecret?: string` (`index.ts:26-28`) — enables the `mpp-channel`
    client method; omitted → only `mpp-charge` is registered for MPP challenges.
  - `allowedChannels?: string[]` (`index.ts:29-38`) — channel contract IDs (C...) to pin
    the channel client to, when `channelCommitmentSecret` is set. Recommended: the
    underlying `@stellar/mpp` channel client refuses to construct at all without either
    this or an explicit unpinned opt-in (see Gotchas) — omitted, `createMppLeg` falls back
    to the unpinned opt-in automatically rather than let construction fail.
- `function createPayingFetch(config: PayingFetchConfig): typeof fetch`
  (`packages/client/src/index.ts:97-147`) — the package's sole public function.

### Internal (not exported from `index.ts`)

- `detectProtocol(res): "x402" | "mpp" | undefined` (`detect.ts:5-8`).
- `SpendTracker` (`limits.ts:17-78`) — `checkAndReserve(baseUnits, url): void`
  (`limits.ts:39-52`), `release(baseUnits): void` (`limits.ts:68-72`).
- `Emitter` (`events.ts:13-24`).
- `toUrlString(input): string` (`url.ts:6-10`).
- `buildX402Fetch(raw, opts): typeof fetch` (`x402Leg.ts:6-14`).
- `createMppLeg(config): Mppx.Mppx<...>` (`mppLeg.ts:76-165`).

This mirrors `@stellarpay/core`'s convention (see `docs/modules/core.md`'s "Scheme modules"
section): the public contract is one function (`createPayingFetch`), not its internals.
Tests import internals directly from `src/*.ts`.

## Key Methods (`file:line`)

- `createPayingFetch` (`index.ts:97-147`) — probes via `_baseFetch ?? fetch`
  (`index.ts:99,106`, the `_baseFetch` test seam is never part of `PayingFetchConfig`, only
  `InternalPayingFetchConfig`, `index.ts:47-53`); non-402 or undetectable-protocol
  responses pass through untouched (`index.ts:107,110`); emits `"challenge"`
  (`index.ts:112`); for `"mpp"`, lazily builds (and caches) a single `createMppLeg`
  instance per `payingFetch` closure and delegates the *original* request to
  `mppLeg.fetch` — which re-probes and pays (`index.ts:118-129`); for `"x402"`, parses
  the amount, calls `tracker.checkAndReserve`, then builds and calls the x402 leg
  (`index.ts:132-145`).
- `resolveSecret(config)` (`index.ts:56-60`) — narrows `secret`/`keypair` to a raw seed;
  shared by both legs (the mpp leg's `secret` field, `mppLeg.ts:13`, is always this
  function's output — never resolved independently).
- `parseX402Amount(res)` (`index.ts:73-84`) — `PAYMENT-REQUIRED` header → base64 → JSON →
  `accepts[0].amount`; already atomic base units on the wire (Task 13 finding), so a plain
  `BigInt(amount)`, not `dollarToDecimal`/`decimalToBaseUnits`.
- `createMppLeg(config)` (`mppLeg.ts:76-165`) — `Mppx.create({ polyfill: false, fetch:
  config.baseFetch, methods: [...], onChallenge })` (`mppLeg.ts:104-142`); `methods` always
  includes `chargeClient.stellar({ keypair, mode: "pull", rpcUrl })` and conditionally
  `channelClient.stellar({ commitmentSecret, network, rpcUrl, ...pinning })` when
  `channelCommitmentSecret` is configured (`mppLeg.ts:107-127`) — see Gotchas for the
  `...pinning` spread (`allowedChannels` vs. `allowUnpinnedChannel`).
- `onChallenge` (the limit gate, inline in `createMppLeg`, `mppLeg.ts:128-141`) —
  `extractChallengeAmount(challenge)` → `tracker.checkAndReserve(amount, url)` (throws
  `SpendLimitExceeded` on violation, reserving nothing) → pushes the reserved amount onto
  the per-challenge-id reservation stack (`mppLeg.ts:135-137`) → emits `"paying"` →
  `_dryRun` throws instead of creating a credential → otherwise `return
  helpers.createCredential()`.
- `extractChallengeAmount(challenge)` (`mppLeg.ts:57-66`) — reads `challenge.request.amount`
  (already atomic base units — see Gotchas) via `BigInt(...)`, guarded.
- `popReservation(id)` (`mppLeg.ts:97-102`) — pops one entry off the reservation stack for
  a challenge id, deleting the map entry once its stack empties; see the `reservations`
  map's own doc comment (`mppLeg.ts:79-94`) for why it's a stack, not a single value.
- Event wiring (`mppLeg.ts:144-162`): `onChallengeReceived` → `"challenge"`;
  `onCredentialCreated` → pops (discards) the reservation, then `"paid"`;
  `onPaymentFailed` → pops and releases the reservation via `SpendTracker.release`, then
  `"error"`.
- `SpendTracker.release(baseUnits)` (`limits.ts:68-72`) — reverses a prior
  `checkAndReserve`; no-op for `undefined`; clamps the cumulative total at `0n` (never
  negative — see Gotchas).

## Dependencies

- `@stellar/stellar-sdk` — `Keypair`.
- `@stellarpay/shared` (workspace, private/bundled) — `dollarToDecimal`, `decimalToBaseUnits`
  (used only by `SpendTracker`'s `maxPerCall`/`maxTotal` conversion — never for parsing an
  on-wire challenge amount, which is already atomic on both legs).
- `@x402/core`, `@x402/fetch`, `@x402/stellar` — the x402 leg.
- `mppx`, `@stellar/mpp` — the MPP leg (`mppx/client`, `@stellar/mpp/charge/client`,
  `@stellar/mpp/channel/client`). Pinned `mppx@0.6.31` exact (controller ruling, `progress.md`).
- `@stellarpay/core` (devDependency only — **not** a runtime dependency) — `test/payingFetch.test.ts`
  builds a real in-process `stellarpay()` server as a fetch endpoint to generate real MPP
  challenges; `createPayingFetch` itself never imports `@stellarpay/core`.

## Gotchas & Invariants

- **Budget is reserved before signing, released on failure, kept on success.** A failed
  payment attempt — bad signer, network error, misconfigured secret — must not
  permanently consume `maxTotal` (this was a carried-forward finding from Task 13's
  review: the original x402-only flow reserved unconditionally with no rollback). The fix
  keeps "reserve before signing" for the success path but adds `SpendTracker.release` on
  every failure path: the x402 leg's `catch` block (`index.ts:141-145`) and the mpp leg's
  `onPaymentFailed` handler (`mppLeg.ts:158-162`, via `popReservation`, `mppLeg.ts:97-102`).
  A reservation that never landed (blocked by `checkAndReserve` itself, or an unknown
  amount under `allowUnknownAmount`) has nothing to release — `release(undefined)` and "no
  stack entry" are both no-ops.
- **Reservation tracking is best-effort under a `challenge.id` collision, not fully
  isolated — only the sequential (non-concurrent) path is test-proven.** A prior version
  of this doc overstated this: it described a single-entry-per-id map as isolating
  "overlapping in-flight challenges" from each other. That claim didn't hold — a review
  caught that `challenge.id` is an HMAC over the challenge's content *including* a
  millisecond-precision `expires`, so two requests issued within the same millisecond for
  the same route/amount can legitimately produce the same id, and a single mutable
  per-id slot would let the second request's `onChallenge` silently overwrite the first's
  in-flight reservation — permanently leaking it (never released) if that first request
  later failed. The fix (`mppLeg.ts:79-102`) makes `reservations` a
  `Map<challengeId, (bigint | undefined)[]>` — a stack per id, pushed in `onChallenge`
  once a reservation lands, popped by whichever terminal event (`onCredentialCreated` /
  `onPaymentFailed`) fires next for that id. Under a genuine collision this is still only
  best-effort — a pop can be attributed to the "wrong" one of two colliding requests — but
  it can no longer silently drop a reservation the way overwriting a single slot could:
  every push gets its own array slot until something pops it. No test exercises actual
  concurrent requests sharing a colliding id (the existing suite awaits each `payFetch`
  call sequentially); the stack design is reasoned about, not measured, for that specific
  scenario.
- **`SpendTracker.release` clamps at `0n` instead of ever going negative
  (`limits.ts:68-72`).** Independent of the collision scenario above, `release` must
  never let `cumulativeBaseUnits` go negative — a negative cumulative would silently
  *raise* the effective `maxTotal` ceiling for every subsequent call (the opposite of
  what a spend limit is for). Unit-tested directly in `limits.test.ts` by reserving a
  small amount, releasing far more than was reserved, and asserting the tracker still
  enforces the original cap rather than a raised one.
- **`channelCommitmentSecret` alone would previously make every MPP request throw,
  synchronously, before any network call.** `Mppx.create`'s `methods` array
  (`mppLeg.ts:107-127`) is evaluated *eagerly* at construction time, regardless of which
  challenge type a request actually receives — so `channelClient.stellar({
  commitmentSecret, ... })` runs immediately. `@stellar/mpp`'s channel client itself
  refuses to construct without either `allowedChannels` (non-empty) or
  `allowUnpinnedChannel: true`, throwing `StellarMppError("Channel pinning is
  required...")` otherwise (`@stellar/mpp/dist/channel/client/Channel.js:40-46`,
  verified against the compiled source, not just the `.d.ts`). The fix
  (`mppLeg.ts:121-123`): pass `allowedChannels` when the caller supplied a non-empty
  `PayingFetchConfig.allowedChannels`; otherwise fall back to `allowUnpinnedChannel:
  true` rather than let construction fail outright. Pinning is recommended (see
  `PayingFetchConfig.allowedChannels`'s doc comment) but never required to avoid this
  crash.
- **`onChallenge` returning `undefined` does NOT stop mppx from creating a credential.**
  The brief's Step 3 prose describes the `_dryRun` seam as "`onChallenge` returns
  `undefined` ... mppx then surfaces the 402" — verified against the installed
  `mppx@0.6.31` compiled source (`mppx/dist/client/internal/Fetch.js`), this is not what
  happens: `const credential = onChallengeCredential ?? (await createCredential())` means
  an `undefined` return falls through to mppx's *own* default credential creation
  (signing, and for the charge method, RPC access to build/simulate the transaction) —
  the opposite of "stop." Only a **thrown** error inside `onChallenge` prevents that
  fallback (it's caught by the wrapper's surrounding try/catch, which emits
  `payment.failed` and rethrows, without ever reaching `createCredential()`). `_dryRun`
  therefore throws after the limit gate runs (`mppLeg.ts:139`), not returns `undefined` —
  this is the adaptation, not what the brief's prose literally says.
- **Challenge amounts are already atomic base units on the wire, for both legs.**
  x402's `accepts[0].amount` (Task 13 finding) and MPP's `challenge.request.amount`
  (verified against `@stellar/mpp/dist/{charge,channel}/server/*.js`'s `request()` hooks,
  which run the configured decimal amount through `toBaseUnits()` before it's embedded in
  the issued challenge, and `doVerify`'s `BigInt(challengeRequest.amount)`) are integer
  strings, not decimal dollar strings. Both `parseX402Amount` and
  `extractChallengeAmount` therefore use a plain guarded `BigInt(...)`, never
  `dollarToDecimal`/`decimalToBaseUnits` (that pair converts *limit* strings like
  `"$0.05"`, a different unit-conversion direction).
- **`"challenge"` fires twice per MPP attempt.** `index.ts`'s top-level probe emits
  `"challenge"` once it detects the protocol (`index.ts:112`, shared with the x402 path),
  then delegates the *original* request to `mppLeg.fetch`, which independently re-probes
  and hits its own 402 — its `onChallengeReceived` handler emits `"challenge"` again
  (`mppLeg.ts:146`). This mirrors the x402 leg's already-accepted "one extra request"
  re-probe cost (Task 13); no test asserts an exact count, only `toContain("challenge")`.
- **`extractChallengeAmount` has exactly one verified candidate field (`amount`), not
  several.** The brief describes "known candidate fields checked in order" — both
  `stellar.charge` and `stellar.channel` client request schemas
  (`@stellar/mpp/dist/{charge,channel}/client/{Charge,Channel}.d.ts`) declare only
  `amount` as the per-request charge; there is no second verified field name to add
  without guessing (channel's `methodDetails.cumulativeAmount` is a different quantity —
  the channel's running total, not this request's amount — so it would be actively wrong
  as a fallback, not merely redundant).
- **`InternalPayingFetchConfig`'s `_baseFetch`/`_dryRun` are not part of the public
  contract.** They exist only so this package's own tests can inject a transport and stop
  before RPC; `test/payingFetch.test.ts` reaches them via an `as never` cast, matching the
  brief's own test code. `channelCommitmentSecret` is different — it *is* public, added to
  `PayingFetchConfig` itself.
- **`SpendTracker` is shared between both legs within one `createPayingFetch` call.**
  `maxTotal` is enforced across x402 and MPP payments made through the *same*
  `payingFetch` instance, not per-protocol.

## Testing

- `test/detect.test.ts` — per-module unit tests (Task 13).
- `test/limits.test.ts` — `SpendTracker` unit tests (Task 13's brief tests, plus a
  post-review addition proving `release` clamps at `0n` rather than letting the
  cumulative total go negative).
- `test/payingFetch.test.ts` — end-to-end against a real in-process `@stellarpay/core`
  server (`stellarpay(...)` served via `server.handle(req)`, no HTTP listener):
  - `describe("createPayingFetch (MPP leg)")` — the brief's Step 1 tests verbatim: 402
    surfaces to the MPP handler and emits `"challenge"`; `maxTotal` is enforced before any
    signing (`SpendLimitExceeded`); non-402 responses pass through untouched.
  - `describe("createPayingFetch (mpp-channel client config)")` — a post-review addition
    proving `channelCommitmentSecret` (with or without `allowedChannels`) no longer
    breaks `Mppx.create()`'s eager construction: both cases reach the `_dryRun` seam's
    own thrown error rather than `@stellar/mpp`'s "Channel pinning is required" error —
    verified to correctly go red (reproducing that exact pinning error) when the
    `allowedChannels`/`allowUnpinnedChannel` fallback is reverted, see task-14-report.md.
  - `describe("createPayingFetch (budget release on failed attempts)")` — the
    carried-forward fix: an mpp `_dryRun` failure and an x402 misconfigured-secret failure
    each leave `maxTotal` budget intact for the next call (proven by making the *same*
    call twice and asserting neither rejection is `SpendLimitExceeded` — verified to
    correctly go red when the `release()` calls are removed, see task-14-report.md); plus
    a direct `SpendTracker.release(undefined)` no-op check.
- Run: `pnpm --filter @stellarpay/client test` (or `pnpm test` from repo root).

## Verified Against

- Source read and line numbers confirmed 2026-08-01 against the current working tree
  (`packages/client/src/*.ts`, `packages/client/test/*.ts`), including a recount after a
  post-review fix round (channel-client pinning, budget-release clamping and
  collision-safety) that shifted line numbers across `index.ts`, `mppLeg.ts`, and
  `limits.ts`.
- mppx/`@stellar/mpp` API shapes verified against installed `.d.ts` and, for both the
  `onChallenge`-fallback behavior and the channel client's construction-time pinning
  check, the compiled `.js` (`mppx@0.6.31`, `@stellar/mpp@0.7.1`) under
  `packages/client/node_modules/` — not just the `.d.ts`, which doesn't show the throw.
- All 17 client-package tests pass; typecheck and build succeed (`tsc` exit 0, zero
  diagnostics); root suite (16 files / 72 tests) passes; root typecheck/build succeed
  across all 6 packages.
