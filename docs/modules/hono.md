# @stellarpay-sdk/hono — Hono Middleware Adapter

**Last verified:** 2026-08-01

## Purpose

Hono middleware adapter for the Stellarpay payment SDK. Wraps `@stellarpay-sdk/core`'s
`Stellarpay` orchestrator as a one-line Hono middleware: `app.use("*", stellarpayHono(config))`.
Hono apps already work with Web standard Request/Response types, so the adapter directly dispatches
each request to the core paywall handler and manages the routing: direct response (402 challenge, error),
pass-through with settlement headers, or next().

## Structure

- `src/index.ts` — `stellarpayHono()`.
- `test/hono.test.ts` — middleware dispatch tests.

## Public Surface

- `function stellarpayHono(configOrInstance: unknown): MiddlewareHandler`
  (`packages/hono/src/index.ts:5-15`) — accepts either a raw config object (which is
  passed to `stellarpay()` for validation and instantiation) or a pre-built `Stellarpay`
  instance; returns a Hono `MiddlewareHandler` that calls `pay.handleWithMeta()` with the
  request's raw Web standard Request object, and dispatches on the outcome: returns a
  `Response` directly, proceeds to `next()` with pass-through headers set, or implicitly
  passes control forward on no gating.

## Key Methods (`file:line`)

- `stellarpayHono` closure — binds a `Stellarpay` instance to middleware logic that
  handles async dispatch, outcome routing, and header management
  (`packages/hono/src/index.ts:9-14`).
- Direct use of `c.req.raw` — Hono's context exposes the underlying Web standard Request
  object, so no conversion is needed; the response from `handleWithMeta()` is already a Web
  standard Response and can be returned directly.
- Header management via `c.res.headers.set()` — pass-through headers are applied directly
  to the Hono response object after calling `next()`.

## Dependencies

- `@stellarpay-sdk/core` (workspace) — `stellarpay()` function and `Stellarpay` type.
- `hono` (peerDependency >=4) — `MiddlewareHandler`, context type signatures; dev-installed
  for tests.

## Gotchas & Invariants

- **One-line integration.** `stellarpayHono()` is middleware, not a full app. It must be
  mounted via `app.use("*", ...)` before route definitions, so it can intercept all paths
  and gate paid routes. Routes registered after it have no paywall protection.
- **Config or instance.** `configOrInstance` is type-checked at runtime: if it's an object
  with a `handleWithMeta` property, it's treated as a pre-built `Stellarpay` instance;
  otherwise, it's passed to `stellarpay()` for validation and construction. This allows
  callers to either hand a raw config or reuse an instance across multiple app instances.
- **Web standard Request/Response.** Hono's context exposes `c.req.raw` as the underlying
  Web standard Request object and `c.res` as a Web standard Response-like object. The
  adapter works directly with these without any conversion layer.
- **Header-based payment verification.** Both the incoming request and the response use only
  headers and status — request/response bodies are never read or copied. This is by design:
  payment challenges, receipts, and verification are header-based in both x402, mpp-charge,
  and mpp-channel schemes.
- **No body passthrough.** This adapter does not buffer or forward the request body to
  `stellarpay.handle()` or the response body from the route handler. It is for header-based
  payment gating only; if a route needs to read the body, the request still arrives at that
  handler after the middleware's `next()` call, and it can read from `c.req` normally.

## Testing

- `packages/hono/test/hono.test.ts` — middleware dispatch tests
  (`packages/hono/test/hono.test.ts:11-19`):
  - "free passes" — unmatched routes pass through to the handler (200, correct body)
  - "paid gates 402" — matched paid routes return 402
- Run: `pnpm --filter @stellarpay-sdk/hono test` (or `pnpm test` from repo root).

## Verified Against

- Source read and line numbers confirmed 2026-08-01 against the current working tree
  (`packages/hono/src/index.ts:5-15`, `packages/hono/test/hono.test.ts:11-19`).
- All tests pass (2 tests in hono.test.ts), typecheck and build succeed, root suite
  passes (54 tests across 12 files).
