import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['out/test/*.test.js'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // The files in a random order on every run, and the tests in each file in order, as they share one session: Vitest
    // prints the seed it used ("Running tests with seed"), and `pnpm test --sequence.seed=<seed>` repeats the order.
    sequence: { shuffle: { files: true, tests: false } },
    // Every test process in UTC, so that dates read the same on every machine (test/determinism.test.ts).
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['out/src/**/*.js'],
      reporter: ['text-summary'],
      // `pnpm test:coverage`: the floors, at what the suite measured when they were set (lines 68.9, branches 64.1 and
      // functions 69.4), rounded down, below the standard's 80, 70 and 75: what the renderer does in Chromium is outside
      // what V8 counts in Node.
      thresholds: { lines: 68, branches: 64, functions: 69 },
    },
  },
});
