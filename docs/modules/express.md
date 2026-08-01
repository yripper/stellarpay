# @stellarpay/express — Express Middleware Adapter

## Purpose

Express middleware adapter for the Stellarpay payment SDK. Wraps `@stellarpay/core`'s
`Stellarpay` orchestrator as a one-line Express middleware: `app.use(stellarpayExpress(config))`.
Converts Express Request/Response to/from Web standard types, dispatches each request to the
core paywall handler, and manages the routing: direct response (402 challenge, error), pass-through
with settlement headers, or next().

## Structure

- `src/index.ts` — `toWebRequest()`, `writeResponse()`, `stellarpayExpress()`.
- `test/express.test.ts` — middleware dispatch tests.

## Public Surface

- `function stellarpayExpress(configOrInstance: unknown): RequestHandler`
  (`packages/express/src/index.ts:36-48`) — accepts either a raw config object (which is
  passed to `stellarpay()` for validation and instantiation) or a pre-built `Stellarpay`
  instance; returns an Express `RequestHandler` that converts the incoming request to Web
  standard form, calls `pay.handleWithMeta()`, and dispatches on the outcome: writes a
  `Response` directly, sets pass-through headers and calls `next()`, or calls `next(err)`
  on rejection.

## Key Methods (`file:line`)

- `toWebRequest(req: ExReq): Request` — constructs URL from Express Request's protocol,
  host, and originalUrl; copies headers as a Web standard `Headers` object. Bodies are
  intentionally omitted since payment verification is header-based
  (`packages/express/src/index.ts:9-18`).
- `writeResponse(res: ExRes, web: Response): Promise<void>` — copies all headers from the
  Web standard Response to the Express Response, with special handling for multi-value
  Set-Cookie headers via `getSetCookie()` to preserve all cookie values; writes the status
  and body to the Express Response (`packages/express/src/index.ts:24-33`).
- `stellarpayExpress` closure — binds a `Stellarpay` instance to middleware logic that
  handles async dispatch, outcome routing, and error propagation
  (`packages/express/src/index.ts:36-48`).

## Dependencies

- `@stellarpay/core` (workspace) — `stellarpay()` function and `Stellarpay` type.
- `express` (peerDependency >=4) — `RequestHandler`, `Request`, `Response`, `NextFunction`
  type signatures; dev-installed for tests.
- `supertest` (dev-only) — HTTP testing against Express apps.

## Gotchas & Invariants

- **One-line integration.** `stellarpayExpress()` is middleware, not a full app. It must be
  mounted via `app.use()` before route definitions, so it can intercept all paths and gate
  paid routes. Routes registered after it have no paywall protection.
- **Config or instance.** `configOrInstance` is type-checked at runtime: if it's an object
  with a `handleWithMeta` property, it's treated as a pre-built `Stellarpay` instance;
  otherwise, it's passed to `stellarpay()` for validation and construction. This allows
  callers to either hand a raw config or reuse an instance across multiple app instances.
- **Async dispatch in middleware.** The middleware returns immediately after calling
  `pay.handleWithMeta(...).then(...).catch(next)`, not awaiting. This is idiomatic Express
  — errors are passed to `next(err)` for the error-handling middleware to consume. The
  handler avoids `await` so the middleware chain doesn't block.
- **Header-based payment verification.** Both the Web Request built from Express and the
  Web Response written back use only headers and status — request/response bodies are never
  read or copied. This is by design: payment challenges, receipts, and verification are
  header-based in both x402, mpp-charge, and mpp-channel schemes.
- **No body passthrough.** This adapter does not buffer or forward the request body to
  `stellarpay.handle()` or the response body from the route handler. It is for header-based
  payment gating only; if a route needs to read the body, the request still arrives at that
  handler after the middleware's `next()` call, and it can read from `req` normally.
- **Multi-value Set-Cookie headers.** Web standard Response headers map multi-value headers
  (like Set-Cookie) to multiple iterations, but iterating headers with `forEach()` yields
  only the last value per key (Express's `res.setHeader(key, val)` replaces rather than
  appends). `writeResponse` special-cases Set-Cookie: it calls `web.headers.getSetCookie()`
  to retrieve the array of all cookies at once, then passes that array to `res.setHeader()`
  to preserve all values (`packages/express/src/index.ts:30-31`).

## Testing

- `packages/express/test/express.test.ts` — middleware dispatch tests
  (`packages/express/test/express.test.ts:20-50`):
  - "lets free routes through" — unmatched routes pass through to the handler (200, correct body)
  - "gates paid routes with 402 + challenge headers" — matched paid routes return 402
  - "preserves multi-value set-cookie headers" — verifies that multiple Set-Cookie header
    values from a Response are preserved (not dropped) when written to the Express response
- Run: `pnpm --filter @stellarpay/express test` (or `pnpm test` from repo root).

## Verified Against

- Source read and line numbers confirmed 2026-08-01 against the current working tree
  (`packages/express/src/index.ts`, `packages/express/test/express.test.ts`).
- `writeResponse` updated to handle multi-value Set-Cookie headers via `getSetCookie()`;
  new test "preserves multi-value set-cookie headers" added.
- All tests pass (3 tests in express.test.ts), typecheck and build succeed, root suite
  passes (52 tests across 11 files).
