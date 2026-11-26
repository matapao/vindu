import assert from 'node:assert/strict';
import { test } from 'vitest';
import { moveLine } from '../src/renderer/shell-dividers.js';

test("a divider stops at each pane's minimum, and stays put where the two minimums no longer fit", () => {
  assert.deepEqual(moveLine([300, 300], [100, 100], 0, 500), [500, 100]);
  assert.deepEqual(moveLine([300, 300], [100, 100], 0, -500), [100, 500]);
  assert.deepEqual(moveLine([300, 300, 300], [100, 100, 100], 1, 40), [300, 340, 260]);
  // narrower than both minimums: before, the second pane went to -80
  assert.deepEqual(moveLine([10, 10], [100, 100], 0, 30), [10, 10]);
  assert.deepEqual(moveLine([80, 90], [100, 100], 0, -30), [80, 90]);
});
