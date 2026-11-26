// A2UI's Zod 3 checks a bounded collection's size before its members (GHSA-mrhx-c7xc-m3w5): here through the workspace's
// patch of the locked copy (patches/), in a host through the guard the renderer installs when it starts. On a stock
// Zod 3 (Vindu's own zod/v3, unpatched), the guard does for arrays what the patch does, from when it is called.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';
import { DynamicStringSchema } from '@a2ui/web_core/v0_9';
import { z as stockZod } from 'zod/v3';
import { guardA2uiArrays, guardArrays } from '../src/renderer/a2ui-limits.js';

test('the shared A2UI schemas check collection bounds before members, synchronously and asynchronously', async () => {
  guardA2uiArrays();
  let visits = 0;
  const member = DynamicStringSchema.transform((value) => {
    visits++;
    return value;
  });
  for (const [schema, valid, over] of [
    [member.array().max(1, 'one item'), ['a'], ['a', 'b']],
    [member.array().length(1, 'one item'), ['a'], ['a', 'b']],
  ] as const) {
    assert.deepEqual(schema.parse(valid), valid);
    assert.deepEqual(await schema.parseAsync(valid), valid);
    assert.equal(visits, 2);
    visits = 0;
    for (const result of [schema.safeParse(over), await schema.safeParseAsync(over)]) {
      assert.equal(result.success, false);
      assert.equal(result.error.issues[0].code, 'too_big');
      assert.equal(result.error.issues[0].message, 'one item');
    }
    assert.equal(visits, 0);
  }
});

test('the source patch also stops bounded sets before member validation in the upstream CommonJS package', async () => {
  const a2uiRequire = createRequire(import.meta.resolve('@a2ui/web_core/v0_9'));
  const { z } = a2uiRequire('zod') as typeof import('zod/v3');
  let visits = 0;
  const schema = z
    .set(
      z.string().transform((value) => {
        visits++;
        return value;
      }),
    )
    .max(1);
  assert.deepEqual(schema.parse(new Set(['a'])), new Set(['a']));
  assert.equal(visits, 1);
  assert.equal(schema.safeParse(new Set(['a', 'b'])).success, false);
  assert.equal((await schema.safeParseAsync(new Set(['a', 'b']))).success, false);
  assert.equal(visits, 1);
});

test('on a stock Zod 3 the guard stops bounded arrays before their members, from when it is called, once', async () => {
  let visits = 0;
  const bounded = stockZod
    .string()
    .transform((value) => {
      visits++;
      return value;
    })
    .array()
    .max(1, 'one item');
  assert.equal(bounded.safeParse(['a', 'b']).success, false);
  assert.equal(visits, 2, 'stock: the members first');
  guardArrays(stockZod.string());
  guardArrays(stockZod.string()); // once: a second call finds it guarded
  visits = 0;
  for (const result of [bounded.safeParse(['a', 'b']), await bounded.safeParseAsync(['a', 'b'])]) {
    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0].code, 'too_big');
    assert.equal(result.error?.issues[0].message, 'one item');
  }
  assert.equal(visits, 0);
  assert.deepEqual(bounded.parse(['a']), ['a']);
  assert.equal(visits, 1);
});
