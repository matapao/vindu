import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['out/test/*.test.js'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
