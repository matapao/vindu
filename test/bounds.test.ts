// What the model, a server or the window sends is bounded before any work is done on it: a time written to make a
// regular expression backtrack, a length of time past the calendar, free time looked for over centuries, a run of
// result ids in the billions, an elicitation's pattern that nests its quantifiers, a text attachment of any size, and
// names such as __proto__ or constructor, which are names like any other and never what objects inherit. Each is
// refused or left out at once. All synthetic; no window.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addDates,
  addTime,
  BATCH,
  checkValue,
  EVENTS,
  fieldsOf,
  freeSlots,
  memoryResults,
  parseDateExpr,
  readRef,
  whenOf,
} from '../src/index.js';
import { countIds, resultIds } from '../src/cards.js';
import { addFields, parse, rowValue, setValue } from '../src/compute.js';
import { patternOf } from '../src/field-patterns.js';
import { typeOfFile } from '../src/file-types.js';
import { measuredFromWindow } from '../src/shell-resize.js';
import { pageName } from '../src/view-files.js';
import { textOf } from '../src/view-rows.js';

/** How long a call takes, in milliseconds. */
const timed = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};
const QUICK = 250; // what took seconds before takes well under this, even on a machine running other tests

test('a time written to backtrack is read at once: each part matches one way, and what is longer than any time is not read', () => {
  const now = new Date('2026-11-12T09:00:00Z');
  for (const spaces of [190, 400, 100_000]) {
    // under the length read, at the review's 400, and far past it
    const src = `today + 1 ${' '.repeat(spaces)}!`;
    assert.ok(timed(() => whenOf(src, { timeZone: 'UTC', now })) < QUICK, `whenOf with ${spaces} spaces`);
    assert.ok(
      timed(() => assert.throws(() => parseDateExpr(src), /a date field or today/)) < QUICK,
      `parseDateExpr with ${spaces} spaces`,
    );
    assert.ok('refusal' in whenOf(src, { timeZone: 'UTC', now }));
  }
  assert.ok(timed(() => whenOf(`ctx:${'+1a'.repeat(60)}!`, { timeZone: 'UTC', now })) < QUICK);
  // what it read before, it reads still
  const w = whenOf('ctx:r1#/0/due - 2 working days at 10:00', {
    timeZone: 'UTC',
    now,
    read: () => ({ ok: true, value: '2026-11-30' }),
  });
  assert.ok(!('refusal' in w) && new Date(w.ms).toISOString() === '2026-11-26T10:00:00.000Z');
  assert.deepEqual(parseDateExpr('due  +  3   working   days'), { from: 'due', sign: 1, n: 3, unit: 'working day' });
});

test('a length of time past the calendar is refused before it is counted, and a date past year 9999 is empty', () => {
  const now = new Date('2026-11-12T09:00:00Z');
  assert.throws(() => parseDateExpr('today + 70000000 working days'), /too far: at most 2500 working days/);
  assert.throws(() => parseDateExpr('today + 99999999999999999999 days'), /too far/);
  assert.ok(
    timed(() =>
      assert.throws(() => addTime('2026-01-01', { sign: 1, n: 70_000_000, unit: 'working day' }), RangeError),
    ) < QUICK,
  );
  assert.equal(addTime('2026-01-01', { sign: 1, n: 2500, unit: 'working day' }), '2035-08-02'); // the most, at once
  for (const q of ['today + 70000000 working days', 'now + 999999999999 minutes', 'today + 99999 months']) {
    const r = whenOf(q, { timeZone: 'UTC', now });
    assert.ok('refusal' in r && /too far/.test(r.refusal), q);
  }
  assert.match(
    (whenOf('9999-12-30 + 3 days', { timeZone: 'UTC', now }) as { refusal: string }).refusal,
    /outside the years 0000 to 9999/,
  );
  const got = addDates([{ d: '9999-12-01' }, { d: '2026-01-31' }], { next: 'd + 1 month' });
  assert.deepEqual(
    got.rows.map((r) => r.next),
    [null, '2026-02-28'],
  );
  assert.deepEqual(got.empty, { next: 1 });
  // free time: at most a year, looked at day by day; hours left out are their defaults
  assert.throws(
    () => freeSlots([], Date.parse('0001-01-01'), Date.parse('9999-12-31'), ['08:00', '16:00'], 30),
    /at most 366 days/,
  );
  assert.throws(() => freeSlots([], 0, 86_400_000, ['8', '16:00'], 30), /two times of day/);
  const free = EVENTS.rows!(
    [{ title: 'Standup', start: '2026-11-16T08:00:00Z', end: '2026-11-16T09:00:00Z' }],
    { id: 'f', card: 'events', layout: 'free', within: { from: '2026-11-16', to: '2026-11-16' }, hours: [] },
    () => undefined,
    { inputs: {} },
  );
  assert.deepEqual((free as { rows: unknown[] }).rows, [
    { free: true, start: '2026-11-16T09:00:00.000Z', end: '2026-11-16T16:00:00.000Z' },
  ]);
});

test('a run of result ids is counted before it is written out: a billion is refused at once', () => {
  assert.equal(countIds(['r1-r999999999', 'r3']), 1_000_000_000);
  assert.ok(timed(() => assert.throws(() => resultIds(['r1-r999999999']), /at most 500/)) < QUICK);
  assert.ok(
    timed(() =>
      assert.throws(
        () => BATCH.source!({ id: 'b', card: 'batch', results: ['r1-r999999999'] }, () => undefined),
        /999999999 calls: show at most 500 in one batch/,
      ),
    ) < QUICK,
  );
  assert.deepEqual(resultIds(['r5-r7', 'r9']), ['r5', 'r6', 'r7', 'r9']);
});

test("an elicitation's pattern is tested only when that is safe; one that nests its quantifiers is the server's to check", () => {
  for (const unsafe of [
    '(a+)+$',
    '^(a|ab)*$',
    '(x?){3}',
    '^(\\d{1,3})*$',
    '^\\d*\\d*\\d*\\d*x$',
    '^(a)\\1$',
    '^(a|a)(a|a)(a|a)(a|a)b$',
    'a'.repeat(201),
  ]) {
    assert.equal(patternOf(unsafe), undefined, unsafe);
    assert.ok(
      timed(() => assert.equal(checkValue({ type: 'string', pattern: unsafe }, `${'a'.repeat(40)}!`), undefined)) <
        QUICK,
      unsafe,
    );
  }
  for (const safe of [
    '^INV-\\d{4}-\\d{4}$',
    '^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$',
    '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    '^(cat|dog|bird)$',
    '^\\p{L}+$',
  ])
    assert.ok(patternOf(safe), safe);
  const { fields } = fieldsOf({
    properties: { code: { type: 'string', pattern: '(a+)+$' }, ref: { type: 'string', pattern: '^R-\\d+$' } },
  });
  assert.equal(fields.code.pattern, undefined);
  assert.equal(fields.ref.pattern, '^R-\\d+$');
  assert.equal(checkValue(fields.ref, `R-${'1'.repeat(600)}`), 'at most 500 characters'); // the value tested is bounded too
  assert.equal(checkValue(fields.ref, 'R-12'), undefined);
});

test('names are names: __proto__, constructor and toString are what was sent, never what objects inherit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-'));
  try {
    const results = memoryResults(dir);
    results.add({ server: 'db', tool: 'q', value: [{ amount: 5 }] });
    assert.deepEqual(readRef(results, 'ctx:r1#/0/constructor'), {
      ok: false,
      why: 'r1 has nothing at /0/constructor (it stops before "constructor")',
    });
    assert.equal(readRef(results, 'ctx:r1#/0/__proto__').ok, false);
    assert.deepEqual(readRef(results, 'ctx:r1#/0/amount'), { ok: true, id: 'r1', value: 5 });
    // an elicitation's fields, as a server sends them in JSON
    const s = fieldsOf(
      JSON.parse(
        '{"properties": {"__proto__": {"type": "string", "title": "Proto"}, "name": {"type": "string"}}, "required": ["__proto__", "toString", "name"]}',
      ),
    );
    assert.equal(Object.getPrototypeOf(s.fields), Object.prototype);
    assert.deepEqual(Object.keys(s.fields), ['__proto__', 'name']);
    assert.deepEqual(s.required, ['__proto__', 'name']);
    // computed fields, dates and inputs
    assert.throws(() => addFields([{ a: 1 }], JSON.parse('{"__proto__": "a * 2"}')), /cannot be named __proto__/);
    assert.equal(rowValue(parse('constructor'), {}), null);
    assert.throws(() => setValue(parse('count() * $constructor'), [{}]), /no input \$constructor/);
    assert.throws(() => parseDateExpr('today + 1 constructor'), /a date field or today/);
    assert.match(
      (whenOf('today + 1 toString', { timeZone: 'UTC' }) as { refusal: string }).refusal,
      /"toString" is not a length of time/,
    );
    assert.throws(() => addDates([{}], JSON.parse('{"__proto__": "today"}')), /cannot be named __proto__/);
    // what the window measured, by panel; a file's type by its extension
    const [[, m]] = measuredFromWindow(
      { v: { content: 1, visible: 1, sight: JSON.parse('{"__proto__": {"first": 0, "last": 0, "n": 1, "of": 1}}') } },
      () => true,
    );
    assert.deepEqual(Object.keys(m.sight!), ['__proto__']);
    assert.equal(typeOfFile('clip.constructor'), undefined);
    assert.equal(typeOfFile('Photo.JPG'), 'image/jpeg');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a text attachment is read no further than a text panel shows, and a panel's page file is its own", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounds-'));
  try {
    const file = path.join(dir, 'big.txt');
    fs.writeFileSync(file, `${'é'.repeat(3000)}${'x'.repeat(5_000_000)}`);
    const results = memoryResults(dir);
    const a = results.attach('big.txt', 'text/plain', file);
    const whole = vi.spyOn(fs, 'readFileSync');
    try {
      assert.equal(textOf(a, { id: 't', card: 'text' }), `${'é'.repeat(3000)}${'x'.repeat(1000)}`);
    } finally {
      whole.mockRestore();
    }
    assert.equal(whole.mock.calls.length, 0); // only its first bytes are read
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // view sales-q1's chart and view sales's q1-chart, or a name with __ in it: each its own file
  const names = [
    pageName('sales-q1', 'chart'),
    pageName('sales', 'q1-chart'),
    pageName('sales_q1', 'chart'),
    pageName('sales', 'q1__chart'),
    pageName('sales__q1', 'chart'),
  ];
  assert.equal(new Set(names).size, names.length);
  assert.equal(pageName('sales', 'chart'), 'p_sales__chart');
  const long = pageName('a view with a very long name, written in words '.repeat(4), 'chart');
  assert.ok(long.length <= 120 && /^[A-Za-z0-9_-]+$/.test(long));
  assert.notEqual(long, pageName('a view with a very long name, written in words '.repeat(5), 'chart'));
});
