# @stellarpay/mcp — Paid MCP Tools (Server Guard + Paying Client)

## Purpose

Applies stellarpay's payment model to the Model Context Protocol (MCP): a server-side
per-tool payment guard (`toolPayments`) that turns an unpaid priced tool call into a
`-32042` JSON-RPC payment-required error and decorates a paid call's result with a
receipt, plus a client-side wrapper (`wrapPaidMcpClient`) that automatically pays those
challenges via `@stellar/mpp`'s `stellar.charge` client method. Built entirely on mppx's
own `Transport.mcpSdk()` / `mppx/mcp-sdk/client` `McpClient.wrap` primitives — this
package supplies the stellarpay-specific configuration and price bookkeeping around them,
not a new payment protocol.

## Structure

- `src/server.ts` — `toolPayments(config)`: builds an `mppx/server` `Mppx.create(...)`
  instance wired to `Transport.mcpSdk()` and a single `stellar.charge` method, and returns
  `{ guard, priceOf }`.
- `src/client.ts` — `wrapPaidMcpClient(client, opts)`: a thin adapter over
  `mppx/mcp-sdk/client`'s `McpClient.wrap`; `payingHttpTransport(url, payFetch)`: builds a
  `StreamableHTTPClientTransport` whose requests go through a caller-supplied paying
  `fetch`, for HTTP-level (x402-gated) MCP servers.
- `src/index.ts` — re-exports both modules (`export * from "./server.js"` /
  `"./client.js"`, `index.ts:1-2`).
- `test/mcp.test.ts` — the brief's Step 2 tests verbatim.
- `test/onPaymentIsolation.test.ts` — a post-review addition (see Gotchas) proving a
  throwing `onPayment` hook doesn't turn an already-paid tool call into a hard error;
  stubs the `mppx/server` module boundary to reach the `status: 200` path offline.

## Public Surface

- `type ToolPaymentReceipt` (`server.ts:30-39`) — `{ tool, amount, raw?, timestamp }`,
  the shape passed to `ToolPaymentsConfig.onPayment`.
- `type ToolPaymentsConfig` (`server.ts:42-57`) — `recipient`, `network:
  "stellar:testnet" | "stellar:pubnet"`, `mppSecretKey`, `sponsorSecret?`, `rpcUrl?`,
  `prices: Record<string, string>` (tool name → `"$0.02"`-style dollar string),
  `onPayment?`.
- `type ToolPayments` (`server.ts:60-71`) — `guard<A, R>(toolName, handler): (args: A,
  extra: unknown) => Promise<R>` and `priceOf(toolName): string | undefined`.
- `function toolPayments(config: ToolPaymentsConfig): ToolPayments` (`server.ts:88-144`)
  — the package's server-side entry point.
- `type PaidMcpClientOptions` (`client.ts:7-23`) — `secret`, `network:
  "stellar:testnet" | "stellar:pubnet"` (see Gotchas — currently unused for wiring),
  `rpcUrl?`.
- `function wrapPaidMcpClient<const client extends Pick<Client, "callTool">>(client,
  opts): McpClient.wrap.McpClient<client, readonly [ReturnType<typeof
  stellarChargeClient>]>` (`client.ts:36-43`) — the package's client-side entry point.
- `function payingHttpTransport(url: string, payFetch: typeof fetch):
  StreamableHTTPClientTransport` (`client.ts:55-57`).

### Internal (not exported from `index.ts`)

- `type McpToolExtra = Transport.InputOf<Transport.McpSdk>` (`server.ts:17`) — the MCP
  SDK tool-call `extra` shape, derived structurally rather than importing mppx's internal
  `Extra` type by name (see Upstream-API evidence).
- `type McpToolResult = Transport.ReceiptResponseOf<Transport.McpSdk>` (`server.ts:27`)
  — the `CallToolResult` shape `withReceipt()` expects/returns for this transport.

This mirrors `@stellarpay/client`'s convention (`docs/modules/client.md`'s Public
Surface section): the package's contract is a small number of top-level functions, not
their internal type plumbing.

## Key Methods (`file:line`)

- `toolPayments(config)` (`server.ts:88-144`) — builds one `Mppx.create({ secretKey:
  config.mppSecretKey, transport: Transport.mcpSdk(), methods: [stellar.charge({...})]
  })` instance (`server.ts:89-108`) per call, then returns `priceOf` (`server.ts:111`)
  and `guard` (`server.ts:112-142`).
- `guard(toolName, handler)` (`server.ts:112-142`):
  1. Looks up `config.prices[toolName]`; if unset, **returns `handler` unwrapped**
     (`server.ts:114`) — an unpriced tool never touches mppx at all, not merely "always
     succeeds."
  2. Otherwise converts the price via `@stellarpay/shared`'s `dollarToDecimal`
     (`server.ts:115`) and returns an async wrapper that:
     - Calls `payment.charge({ amount, description })(extra as McpToolExtra)`
       (`server.ts:121`) — the single explicit cast from the guard's public `extra:
       unknown` boundary into the shape mppx's transport actually reads.
     - On `result.status === 402`, `throw result.challenge` (`server.ts:122`) — this is
       already a live `McpError` instance (code `-32042`), not a plain object; see
       Upstream-API evidence.
     - On success, calls `config.onPayment?.(...)` inside its own `try/catch`
       (`server.ts:123-132` — see Gotchas), runs the wrapped `handler`
       (`server.ts:133`), then `return result.withReceipt(response as unknown as
       McpToolResult) as unknown as R` (`server.ts:140`) — see Upstream-API evidence for
       why the double cast is necessary.
- `wrapPaidMcpClient(client, opts)` (`client.ts:36-43`) — `McpClient.wrap(client, {
  methods: [stellarChargeClient({ secretKey: opts.secret, mode: "pull", rpcUrl:
  opts.rpcUrl })] })` (`client.ts:40-42`); `client` is constrained to `Pick<Client,
  "callTool">`, matching `McpClient.wrap`'s own generic bound exactly.
- `payingHttpTransport(url, payFetch)` (`client.ts:55-57`) — `new
  StreamableHTTPClientTransport(new URL(url), { fetch: payFetch })`.

## Dependencies

- `mppx` — pinned **exact** `0.6.31` (controller ruling, matches `@stellarpay/core` and
  `@stellarpay/client`); `mppx/server` (`Mppx`, `Store`, `Transport`) and
  `mppx/mcp-sdk/client` (`McpClient`).
- `@stellar/mpp` (`^0.7.1`) — `@stellar/mpp/charge/server`'s `stellar.charge` (server
  method) and `@stellar/mpp/charge/client`'s `stellar` (client method, aliased
  `stellarChargeClient` in `client.ts`); `USDC_SAC_TESTNET` from the package root.
- `@stellar/stellar-sdk` (`15.1.0`, exact) — `Keypair.fromSecret` for the optional
  `sponsorSecret` fee-payer.
- `@stellarpay/shared` (workspace) — `dollarToDecimal`, used internally in `server.ts`
  only; never appears in a public type signature (`ToolPaymentsConfig.prices` and
  `ToolPaymentReceipt.amount` are plain `string`/`Record<string, string>`).
- `@modelcontextprotocol/sdk` — **peerDependency** (`>=1.25.0`, matching mppx's own peer
  spec, `mppx/package.json`'s `peerDependencies`), dev-installed (`^1.30.0`) for
  typechecking/tests. `client.ts` imports `Client` (type-only) and
  `StreamableHTTPClientTransport` from it directly; `server.ts` never imports it
  directly — mppx's own `Transport.mcpSdk()` dynamically `import()`s
  `@modelcontextprotocol/sdk/types.js` internally only when a 402 actually needs to be
  built (`mppx/dist/mcp-sdk/server/Transport.js:48-59`), which is why the peer is
  required at runtime for the guard's unhappy path even though `server.ts`'s own source
  never names the package.

## Gotchas & Invariants

- **`result.challenge` is already a throwable `McpError`, not a plain object needing
  wrapping.** `Transport.mcpSdk()`'s `respondChallenge` (`mppx/dist/mcp-sdk/server/
  Transport.js:48-65`) constructs `new McpError(core_Mcp.paymentRequiredCode, ...)`
  (dynamically importing the class from `@modelcontextprotocol/sdk/types.js` on first
  use) and returns it directly as the 402 branch's `challenge` field
  (`ChallengeOutputOf<McpSdk> = McpError`, per `McpSdk = Transport.Transport<Extra,
  McpError, CallToolResult>`, `mppx/dist/mcp-sdk/server/Transport.d.ts:16`). `McpError`
  itself has a `readonly code: number` field set from its constructor's first argument
  (`@modelcontextprotocol/sdk/dist/esm/types.d.ts:7924-7927`: `class McpError extends
  Error { readonly code: number; ...; constructor(code: number, message: string, data?:
  unknown); }`), and `paymentRequiredCode = -32042`
  (`mppx/dist/Mcp.d.ts:7`/`Mcp.js:2`). So `throw result.challenge` (`server.ts:122`) is a
  direct, un-adapted `throw` — no extraction of a `.challenge` sub-field or
  reconstruction into a different error class was needed; the brief's own inline comment
  ("challenge in error.data") describes `McpError.data`'s *contents* (`{ httpStatus,
  challenges: [challenge], problem? }`, `Transport.js:60-64`), not a wrapper the code has
  to unwrap.
- **`withReceipt()` decorates the tool result's `_meta`, it doesn't replace it.**
  `respondReceipt` (`mppx/dist/mcp-sdk/server/Transport.js:66-81`) spreads the caller's
  response (`{ ...normalizedResponse }`) and merges `_meta: { ...normalizedResponse._meta,
  [receiptMetaKey]: mcpReceipt }` — `receiptMetaKey = "org.paymentauth/receipt"`
  (`Mcp.js:8`). A `Response` instance (not a plain object) is special-cased to `{ content:
  [] }` first, which doesn't apply here since `handler`'s result is always a plain object.
- **A throwing `config.onPayment` hook is isolated from the paid tool call — it cannot
  turn an already-settled charge into a hard error for the caller.** `guard` wraps the
  `config.onPayment?.(...)` call in its own `try/catch` (`server.ts:123-132`), logging via
  `console.error("[stellarpay/mcp] onPayment hook threw; ignoring", hookError)` and
  swallowing the error rather than letting it propagate — the charge has already been
  accepted by `payment.charge(...)` at that point, so a metrics/DB write failure inside
  the hook must not deny the client its paid-for tool result. Mirrors
  `@stellarpay/core`'s identical isolation for its own `onPayment` hook
  (`packages/core/src/stellarpay.ts:96-101`, same swallow-and-log pattern). Proven by
  `test/onPaymentIsolation.test.ts`, which stubs the `mppx/server` module boundary (real
  `mppx` engine can't reach `status: 200` offline — see Testing) to drive a throwing
  `onPayment` through the guard and assert the handler's result still resolves.
- **`ToolPaymentReceipt.raw` is currently never populated.** The receipt object passed to
  `config.onPayment` is built directly in `guard` as `{ tool: toolName, amount,
  timestamp: new Date().toISOString() }` (`server.ts:124`) — `raw` is never set, because
  the actual settlement receipt (which may carry a raw reference such as a tx hash) only
  materializes later, inside `result.withReceipt(...)`'s own receipt object
  (`respondReceipt`, `Transport.js:66-81`), after `onPayment` has already fired. `raw?:
  string` remains on the type for produced-interface parity and as a placeholder for a
  future revision that reorders the call or threads the settlement receipt back into
  `onPayment`'s payload — not functional today.
- **`Store.memory()` (`server.ts:104`) is single-process, in-memory replay protection —
  restated here, not just cross-referenced, since a reader of this doc alone must see
  it.** It is a plain in-process `Map`: state is lost on restart (a spent challenge could
  be re-verified after a redeploy or crash) and is not shared across processes or
  instances, so in a horizontally-scaled or serverless deployment a credential spent
  against one instance can still replay against a sibling. Identical to
  `@stellarpay/core`'s `createMppChargeModule` caveat
  (`packages/core/src/schemes/mppCharge.ts`'s own doc comment) — single-process
  deployments are the supported v0.1 topology for `toolPayments` too; a pluggable
  `Store.AtomicStore` (e.g. Redis-backed) is on the roadmap for multi-instance
  deployments, not implemented here.
- **The generic `guard<A, R>`'s `R` is bridged into mppx's concrete `McpToolResult`
  (`CallToolResult`) with an explicit double cast (`server.ts:140`), not a generic
  constraint.** The brief's produced interface specifies `guard<A, R>` with `R` fully
  free; but `Transport.WithReceipt<Transport.McpSdk>` narrows its parameter to
  `CallToolResult` (`mppx/dist/server/Transport.d.ts:71`'s `WithReceipt` alias, resolving
  to `WithReceiptOverloads` at `Transport.d.ts:109-112`, distributed over
  `ReceiptResponseOf<McpSdk> = CallToolResult`). Constraining `R extends
  CallToolResult` in `guard`'s signature would have deviated from the brief's literal
  contract; the double cast (`response as unknown as McpToolResult`, then the returned
  value `as unknown as R`) keeps the public signature exactly as specified while still
  compiling under `strict` — `tsc -p tsconfig.json --noEmit` confirms zero diagnostics.
  This relies on MCP tool handlers conventionally returning `CallToolResult`-shaped
  values, which is not enforced by `guard`'s own generic signature.
- **Unpriced tools bypass mppx entirely — `handler` is returned unwrapped, not called
  through a permissive branch.** `guard` (`server.ts:112-114`) returns the caller's
  `handler` function reference directly when `config.prices[toolName]` is unset — the
  second brief test (`"passes through tools without a configured price"`) asserts the
  original mock `handler` was called, which only holds because no wrapper intercepts it.
- **`currency` is fixed to `USDC_SAC_TESTNET` regardless of `config.network`.** Mirrors
  `@stellarpay/core`'s `createMppChargeModule` precedent
  (`packages/core/src/schemes/mppCharge.ts:33`, same fixed-currency choice with the same
  comment pattern). The brief's produced `ToolPaymentsConfig` has no per-tool asset
  override field, so there's no non-fabricated way to select a different SAC address for
  `"stellar:pubnet"` without inventing a new field outside the brief's contract — a real
  limitation for pubnet deployments wanting a different asset, not silently patched over.
- **`PaidMcpClientOptions.network` and `ToolPaymentsConfig`'s parity with it is
  currently inert on the client side.** `@stellar/mpp/charge/client`'s `stellar()`
  (`Charge.Parameters`, `@stellar/mpp/dist/charge/client/Charge.d.ts:60-91`) has no
  `network` field at all — verified against the compiled source
  (`@stellar/mpp/dist/charge/client/Charge.js:74`): `const network =
  resolveNetworkId(request.methodDetails?.network);` inside `createCredential`, i.e. the
  network is read from the *server-issued challenge itself*, not from any client-side
  configuration. `wrapPaidMcpClient` keeps `network` in `PaidMcpClientOptions` per the
  brief's produced interface (and tightened its type from the brief's loose `string` to
  the literal `"stellar:testnet" | "stellar:pubnet"` union, matching
  `ToolPaymentsConfig.network`), but it is not threaded into `stellarChargeClient(...)`'s
  parameters — reserved for interface parity / a future network-aware client leg (e.g.
  `mpp-channel`), not functional today.
- **`toolPayments` builds exactly one `stellar.charge` method for every priced tool.**
  All tools configured in `prices` share the same `recipient`/`network`/`rpcUrl`/
  `sponsorSecret` — there is no per-tool method configuration in the brief's contract.
  A deployment needing different recipients per tool would need multiple `toolPayments(...)`
  instances (one per distinct recipient), each wrapping its own subset of tools.
- **`@modelcontextprotocol/sdk` is a peer, not a bundled, dependency — and is required at
  runtime for the 402 path even though `server.ts` never imports it.** Omitting it from a
  consuming app's own dependencies makes every priced-tool 402 throw mppx's own "Missing
  optional dependency" error instead (`Transport.js:54-58`), not a TypeScript error —
  this only surfaces once a 402 is actually hit, since the `import()` is lazy.

## Testing

- `test/mcp.test.ts` — the brief's Step 2 tests verbatim (`describe("toolPayments.guard")`):
  an unpaid priced tool call rejects with `{ code: -32042 }`; an unpriced tool call passes
  through to the real handler; `priceOf` reports configured/unconfigured prices. Fully
  offline — `Mppx.create`'s `stellar.charge` method never makes a network call unless a
  credential is actually verified, and these tests never supply one.
- `test/onPaymentIsolation.test.ts` — a post-review addition (see Gotchas). Stubs
  `mppx/server`'s `Mppx.create` at the module boundary (`vi.mock`, mirroring
  `@stellarpay/core`'s `test/stellarpayErrorBoundary.test.ts`) to force a `status: 200`
  response — unreachable offline against the real engine, which requires a genuinely
  signed credential verified via Soroban RPC — then asserts a throwing `onPayment` hook
  still lets the guarded call resolve with the handler's own result.
- Run: `pnpm --filter @stellarpay/mcp test` (or `pnpm test` from repo root).

## Verified Against

- Source read and line numbers confirmed 2026-08-01 against the current working tree
  (`packages/mcp/src/*.ts`, `packages/mcp/test/*.ts`), recounted after the
  `onPayment`-isolation fix round shifted `server.ts` line numbers below the `guard`
  function's `payment.charge`/`throw` lines.
- mppx / `@stellar/mpp` / `@modelcontextprotocol/sdk` API shapes verified against
  installed `.d.ts` and, for the challenge/receipt shapes and the `network`-resolution
  gotcha, the compiled `.js` under `packages/mcp/node_modules/` (`mppx@0.6.31`,
  `@stellar/mpp@0.7.1`, `@modelcontextprotocol/sdk@1.30.0`) — not just the `.d.ts`, which
  doesn't show the dynamic-import fallback or the challenge/receipt construction logic.
- All 4 mcp-package tests (2 files) pass; `pnpm --filter @stellarpay/mcp typecheck`/`build`
  both exit 0 with zero diagnostics; root suite (18 files / 76 tests) passes; root
  `typecheck`/`build` succeed across all 7 packages.
