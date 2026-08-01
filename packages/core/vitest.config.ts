import { defineConfig } from "vitest/config";

// Local override: the root vitest.config.ts resolves its `include` glob
// relative to `process.cwd()`, which breaks `pnpm --filter @stellarpay/core test`
// (cwd becomes packages/core, so the root's `packages/**` glob matches nothing).
// This config makes package-scoped test runs work without touching the root config.
export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.ts"],
  },
});
