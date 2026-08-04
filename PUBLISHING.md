# Publishing stellarpay to npm

All six publishable packages are live at `0.1.0` under the **`@stellarpay-sdk`** scope
(published 2026-08-04). The bare `@stellarpay` scope on npm belongs to an unrelated account —
that is why the scope carries the `-sdk` suffix.

Steps to cut a release. Run these yourself — nothing here runs automatically.

```
1. npm login
2. Bump the version in every packages/*/package.json (they move in lockstep)
3. pnpm build && pnpm test && pnpm smoke
4. pnpm -r publish --access public --dry-run   # review the file lists
5. pnpm -r publish --access public
```

Notes:

- **Publish with `pnpm -r publish`, not `npm publish`.** The repo root is `"private": true` and
  is not an npm-workspaces root, so `npm publish` at the root does nothing; `pnpm -r publish`
  walks the workspace and rewrites each `workspace:*` dependency to a real version range at
  pack time.
- The `stellarpay-sdk` npm org already exists and owns the scope. If you ever need a new one,
  create it at <https://www.npmjs.com/org/create> — **there is no `npm org create` command**
  (`npm org` only supports `set`/`rm`/`ls`).

- Step 3's `pnpm smoke` runs the real end-to-end testnet smoke script (`scripts/smoke.ts`) — it
  needs a funded testnet buyer account and the vars in `.env.example`. Run it before publishing
  and before any live demo.
- `packages/shared` is marked `"private": true` in its `package.json` and will **not** be
  published — `pnpm -r publish` automatically skips private packages, so step 5 publishes the
  other six (`core`, `express`, `hono`, `fastify`, `client`, `mcp`) without any extra flag.
- All packages are versioned in lockstep at `0.1.0` (`packages/*/package.json`).
- Every publishable package's `package.json` already sets `"publishConfig": { "access": "public" }`
  — the `--access public` flag on the `publish` commands above is the belt-and-suspenders
  confirmation npm requires for a new scoped package's first publish.
- Every publishable package's `package.json` sets `"license": "MIT"`, `"engines": { "node":
  ">=22" }`, a `"description"`, and `"keywords"`; a root `LICENSE` (MIT) is copied into each
  publishable package's directory so it's included in the published tarball.
- Every publishable package's `package.json` has a `"prepack": "pnpm build"` script, so `npm
  pack`/`npm publish` (and `pnpm -r publish` above) always rebuild `dist/` from current source
  before packing — you never publish a stale build by forgetting a manual `pnpm build` first.
- **`repository` fields are set** — all six publishable manifests point at
  `https://github.com/yripper/stellarpay` with per-package `directory` entries, so npm's
  package pages link back to the monorepo.
- **Verify with `npm view`, not `curl`.** The registry's CDN can serve a stale 404 for a
  freshly published package for a few minutes; `npm view @stellarpay-sdk/core version` is
  authoritative. A real end-to-end check is `npm i @stellarpay-sdk/express` in an empty
  directory — it should pull `@stellarpay-sdk/core` in transitively.

[Back to root README](./README.md)
