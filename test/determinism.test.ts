// The tests run in UTC (vitest.config.ts sets TZ for every test process), so a date reads the same on every machine.
import { test } from 'vitest';
import assert from 'node:assert/strict';

test('the tests run in UTC', () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC');
});
