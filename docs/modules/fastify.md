# @stellarpay-sdk/fastify — Fastify Plugin Adapter

## Purpose

Fastify plugin adapter for the Stellarpay payment SDK. Wraps `@stellarpay-sdk/core`'s
`Stellarpay` orchestrator as a one-line Fastify plugin: `fastify.register(stellarpayFastify, { config })`.
Converts Fastify Request/Reply to/from Web standard types, dispatches each request to the
core paywall handler via an `onRequest` hook, and manages the routing: direct response (402
challenge, error), pass-through with settlement headers, or falling through to the route handler.

## Structure

- `src/index.ts` — `stellarpayFastify()`.
- `test/fastify.test.ts` — plugin dispatch/gating test (via `fastify.inject()`).

## Public Surface

- `function stellarpayFastify(fastify: FastifyInstance, opts: { config: unknown | Stellarpay }): Promise<void>`
  (`packages/fastify/src/index.ts:53-71`) — a plain async Fastify plugin function. `opts.config`
  accepts either a raw config object (passed to `stellarpay()` for validation and instantiation)
  or a pre-built `Stellarpay` instance; registers an `onRequest` hook that calls
  `pay.handleWithMeta()` with the request's Web standard `Request` form, and dispatches on the
  outcome: writes a `Response` directly, sets pass-through headers, or implicitly falls through
  to the route handler on no gating.

## Key Methods (`file:line`)

- `toWebRequest(req: FastifyRequest): Request` — constructs URL from `req.protocol`,
  `req.hostname`, and `req.url`; copies headers as a Web standard `Headers` object. Bodies are
  intentionally omitted since payment verification is header-based
  (`packages/fastify/src/index.ts:9-16`).
- `toReplyHeaders(web: Response): Record<string, string | string[]>` — builds a
  Fastify-compatible headers record from a Web standard Response, special-casing multi-value
  Set-Cookie headers via `getSetCookie()` into a `string[]` (Fastify's `reply.headers()` accepts
  array values natively) (`packages/fastify/src/index.ts:23-31`).
- `writeResponse(reply: FastifyReply, web: Response): Promise<void>` — writes status, headers,
  and body from a Web standard Response onto the Fastify Reply
  (`packages/fastify/src/index.ts:34-36`).
- `stellarpayFastify` closure — binds a `Stellarpay` instance to an `onRequest` hook that
  handles async dispatch, outcome routing, and header management
  (`packages/fastify/src/index.ts:53-71`).
- `Object.defineProperty(stellarpayFastify, Symbol.for("skip-override"), { value: true })`
  — marks the plugin function so Fastify skips creating a new encapsulation context for it
  (`packages/fastify/src/index.ts:75`); see Gotchas below.

## Dependencies

- `@stellarpay-sdk/core` (workspace) — `stellarpay()` function and `Stellarpay` type.
- `fastify` (peerDependency >=4) — `FastifyInstance`, `FastifyRequest`, `FastifyReply` type
  signatures; dev-installed (`^4`, resolved to `4.29.1` in this workspace) for tests.
- No `fastify-plugin` dependency — see Gotchas.

## Gotchas & Invariants

- **Fastify's default plugin encapsulation would break app-wide gating.** By default, every
  `fastify.register()` call creates a new, isolated context: hooks and decorators added inside
  a plugin are visible only to that plugin's own scope and to any children registered from
  within it — they do **not** propagate to routes declared directly on the parent instance
  after registration. This was verified empirically (see the Task 12 implementation report at
  `.superpowers/sdd/2026-07-31-stellarpay-sdk/task-12-report.md`) and is documented in Fastify's own source at
  `fastify/docs/Reference/Plugins.md` under "Handle the scope": *"Do not forget that `register`
  will always create a new Fastify scope... if you are using `register` only for extending the
  functionality of the server, it is your responsibility to tell Fastify not to create a new
  scope. Otherwise, your changes will not be accessible by the user in the upper scope."*
- **`'skip-override'` instead of `fastify-plugin`.** The brief disallows a `fastify-plugin`
  dependency. Fastify's docs name two ways to opt out of the new-scope behavior: the
  `fastify-plugin` module, or setting the hidden `Symbol.for('skip-override')` property
  directly on the plugin function — the exact mechanism `fastify-plugin` uses internally
  (confirmed by reading `fastify-plugin`'s own source: it does nothing more than
  `fn[Symbol.for('skip-override')] = true`). `stellarpayFastify` sets this property via
  `Object.defineProperty` (`packages/fastify/src/index.ts:75`) so `tsc --strict` doesn't flag
  the symbol index as an implicit `any`. This is the one deliberate deviation from a
  byte-for-byte "no fastify-plugin" reading — it reproduces fastify-plugin's effect without
  adding the package, using Fastify's own documented (if "not recommended over fastify-plugin
  for API-stability reasons") escape hatch.
- **Register at the app root, before declaring routes.** Because of `skip-override`, whatever
  scope `fastify.register(stellarpayFastify, { config })` is called in, the `onRequest` hook is
  installed on that scope directly (no new child context). Registering at the root gates the
  whole app; registering inside a sub-plugin/prefixed scope would gate only that scope.
- **Config or instance.** `opts.config` is type-checked at runtime: if it's an object with a
  `handleWithMeta` property, it's treated as a pre-built `Stellarpay` instance; otherwise it's
  passed to `stellarpay()` for validation and construction. This allows callers to either hand a
  raw config or reuse an instance across multiple app instances — the same guard snippet used
  by `@stellarpay-sdk/express` and `@stellarpay-sdk/hono` (`packages/fastify/src/index.ts:58-61`).
- **Header-based payment verification.** Both the Web Request built from Fastify and the Web
  Response written back use only headers and status — request/response bodies are never read or
  copied. This is by design: payment challenges, receipts, and verification are header-based in
  x402, mpp-charge, and mpp-channel schemes.
- **No body passthrough.** This adapter does not buffer or forward the request body to
  `stellarpay.handle()` or the response body from the route handler. It is for header-based
  payment gating only; if a route needs to read the body, the request still reaches that
  handler normally once the hook falls through.
- **Multi-value Set-Cookie headers.** `toReplyHeaders` special-cases Set-Cookie the same way the
  Express adapter does: `web.headers.getSetCookie()` retrieves all cookie values at once, passed
  to Fastify's `reply.headers()` as a `string[]` (Fastify natively supports array header values,
  unlike Node's `res.setHeader` semantics that Express's adapter has to work around)
  (`packages/fastify/src/index.ts:28-29`).

## Testing

- `packages/fastify/test/fastify.test.ts` — plugin gating test
  (`packages/fastify/test/fastify.test.ts:11-19`):
  - "gates and passes appropriately" — registers the plugin at the root, declares routes on the
    same root instance afterward, and asserts free routes pass through (200) while paid routes
    are gated (402) — this is the exact scenario the `skip-override` fix targets.
- Run: `pnpm --filter @stellarpay-sdk/fastify test` (or `pnpm test` from repo root).

## Verified Against

- Source read and line numbers confirmed 2026-08-01 against the current working tree
  (`packages/fastify/src/index.ts`, `packages/fastify/test/fastify.test.ts`).
- Fastify encapsulation behavior confirmed empirically with a standalone Fastify 4.29.1
  script (a plain plugin's `onRequest` hook did not gate root-declared routes without
  `skip-override`; adding `skip-override` fixed it) and against Fastify's own installed docs
  (`node_modules/fastify/docs/Reference/Plugins.md`, "Handle the scope" section) and
  `fastify-plugin`'s installed source (`node_modules/fastify-plugin/plugin.js`).
- All tests pass (1 test in fastify.test.ts), typecheck and build succeed, root suite passes.
