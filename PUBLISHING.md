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

[Back to root README](./README.md)
