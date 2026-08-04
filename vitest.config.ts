import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.{test,spec}.ts', 'examples/**/*.{test,spec}.ts'],
  },
});
