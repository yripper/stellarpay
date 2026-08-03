# Publishing stellarpay to npm

Exact steps to publish all `@stellarpay/*` packages under the `@stellarpay` npm scope. Run
these yourself when ready — nothing here is run automatically.

```
1. npm login
2. Create the org once: npm org (or https://www.npmjs.com/org/create) → name: stellarpay
3. pnpm build && pnpm test && pnpm smoke
4. pnpm -r publish --access public --dry-run   # review the file lists
5. pnpm -r publish --access public
```

Notes:

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
- **No `repository` field is set** — this repo has no git remote configured yet
  (`git remote -v` returns nothing) at the time these packages were prepared for publishing.
  Before running step 5, add a `"repository": { "type": "git", "url": "..." }` field to each
  publishable package's `package.json` (and ideally a `"homepage"`/`"bugs"` field too) once the
  repo has a real remote — npm's package page links back to it, and its absence is otherwise
  silently permitted, not an error.

[Back to root README](./README.md)
