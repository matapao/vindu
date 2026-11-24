// Properties, each checked on a hundred generated inputs (fast-check), seeded anew each run; a failure prints its seed
// and the smallest input that fails. What replaced a regular expression that could backtrack reads every input as that
// expression did, however it is spaced, and a value written into code a page runs reads back as itself, with no "<".
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { MOST, parseDateExpr, UNIT, type DateExpr } from '../src/dates.js';
import { scriptJson } from '../src/escape.js';
import { readLayout } from '../src/layout.js';
import { isEmail } from '../src/operations.js';
import { slotName } from '../src/templates.js';

/** Text made of the few characters that decide what a pattern reads. */
const textOf = (chars: string[], maxLength = 24) => fc.string({ unit: fc.constantFrom(...chars), maxLength });
const spaces = fc.string({ unit: fc.constantFrom(' ', '\t', '\n'), maxLength: 3 });
const refused = (read: () => unknown) => { try { return read(); } catch { return 'refused'; } };

test('an e-mail address is read as the pattern it replaced read it', () => {
  const before = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  fc.assert(fc.property(textOf(['a', '@', '.', ' ', '\t']), t => isEmail(t) === before.test(t)));
});

test("a view's name gives the slot name the trimming pattern gave", () => {
  const before = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'slot';
  fc.assert(fc.property(textOf(['a', 'Z', '1', '-', ' ', '_', 'é']), name => slotName(name) === before(name)));
});

test('a date expression reads the same however it is spaced', () => {
  const move = fc.record({ sign: fc.constantFrom('+', '-'), n: fc.integer({ min: 0, max: 999 }), unit: fc.constantFrom(...UNIT.keys()) });
  const from = fc.constantFrom('today', 'sent', 'invoice_date', 'order.due', '"due date"');
  fc.assert(fc.property(from, fc.option(move, { nil: undefined }), fc.array(spaces, { minLength: 5, maxLength: 5 }), (f, m, [a, b, c, d, z]) => {
    const text = m ? `${a}${f}${b}${m.sign}${c}${m.n}${d}${m.unit.replace(' ', ` ${d}`)}${z}` : `${a}${f}${z}`;
    assert.deepEqual(parseDateExpr(text), { from: f.replace(/^"|"$/g, ''), sign: m?.sign === '-' ? -1 : 1, n: m?.n ?? 0, unit: m ? UNIT.get(m.unit) : 'day' });
  }));
});

test('any text is read as a date expression as the pattern it replaced read it', () => {
  const before = /^\s*(today|[A-Za-z_][\w.]*|"[^"]+")\s*(?:([+-])\s*(\d+)\s*([a-z]+(?:\s+[a-z]+)*))?\s*$/i;
  const readBefore = (src: string): DateExpr | 'refused' => {
    const m = before.exec(src), unit = m?.[2] ? UNIT.get(m[4].toLowerCase().replace(/\s+/g, ' ')) : 'day';
    if (!m || !unit) return 'refused';
    const n = m[3] ? Number(m[3]) : 0;
    return n > MOST[unit] ? 'refused' : { from: m[1].replace(/^"|"$/g, ''), sign: m[2] === '-' ? -1 : 1, n, unit };
  };
  const chars = ['today', 'x', '_', '.', '"', ' ', '\t', '+', '-', '7', 'day', 's', 'working', 'Week'];
  fc.assert(fc.property(textOf(chars, 12), src => assert.deepEqual(refused(() => parseDateExpr(src)), readBefore(src))));
});

test("a pane's size reads the same however it is spaced, and is refused when the pattern it replaced refused it", () => {
  const layout = (size: string) => readLayout({ row: [{ view: 'a', size }, { view: 'b' }] }, new Set(['a', 'b']));
  const size = fc.tuple(fc.integer({ min: 1, max: 99 }), fc.constantFrom('', '.5', '.25'), fc.constantFrom('', '%'));
  fc.assert(fc.property(size, spaces, spaces, spaces, ([n, decimals, pct], a, b, c) =>
    assert.deepEqual(layout(`${a}${n}${decimals}${b}${pct}${c}`), layout(`${n}${decimals}${pct}`))));
  const before = /^\s*(\d+(?:\.\d+)?)\s*(%?)\s*$/;
  fc.assert(fc.property(textOf(['0', '7', '.', '%', ' ', '\t', 'x'], 10), raw => {
    const m = before.exec(raw), read = !layout(raw).notes.includes(`read size ${JSON.stringify(raw)} as an equal share`);
    return read === Boolean(m && parseFloat(m[1]) > 0);
  }));
});

test('a value written into code a page runs reads back as itself, with no "<" in it', () => {
  const markup = textOf(['<', '/', 'script', '>', '!--', 'a', '\u2028']);
  fc.assert(fc.property(fc.oneof(fc.jsonValue(), markup, fc.dictionary(markup, markup)), v => {
    const literal = scriptJson(v);
    assert.ok(!literal.includes('<'), literal);
    assert.deepEqual(JSON.parse(literal), JSON.parse(JSON.stringify(v)));
  }));
});
