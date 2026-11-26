// Properties of the readers of files the model's tools return, each checked on a hundred generated inputs (fast-check),
// seeded anew each run; a failure prints its seed and the smallest input that fails. Delimited text, a cell's address and
// XML read back what was written, however it was written.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { cellAt, columnName } from '../src/cell-address.js';
import { parseDelimited } from '../src/delimited.js';
import { elementOf, xmlTree } from '../src/xml-read.js';

/** Text of the characters that decide how a field or a value is written: separators, quotes, line ends, markup. */
const tricky = fc.string({
  unit: fc.constantFrom('a', 'Z', '1', ' ', ',', '\t', '"', '\n', '\r', '<', '>', '&', "'", 'é'),
  maxLength: 12,
});

/** A field as RFC 4180 writes one: in double quotes, each quote twice. */
const quoted = (field: string) => `"${field.replaceAll('"', '""')}"`;
/** Text as XML writes it, in an attribute's double quotes or between tags. */
const escaped = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

test('delimited text reads back the records it was written from, quoted, with either line end and a byte order mark or not', () => {
  // a record of one empty field is a line with nothing on it, which is no record
  const record = fc.array(tricky, { minLength: 1, maxLength: 4 }).filter((r) => r.length > 1 || r[0] !== '');
  const written = fc.record({
    records: fc.array(record, { maxLength: 5 }),
    separator: fc.constantFrom<',' | '\t'>(',', '\t'),
    end: fc.constantFrom('\n', '\r\n'),
    bom: fc.boolean(),
    last: fc.boolean(),
  });
  fc.assert(
    fc.property(written, ({ records, separator, end, bom, last }) => {
      const text = records.map((r) => r.map(quoted).join(separator)).join(end) + (last && records.length ? end : '');
      assert.deepEqual(parseDelimited(`${bom ? '\ufeff' : ''}${text}`, separator), records);
    }),
  );
});

test('a field written without quotes reads back as itself when it holds no separator, quote or line end', () => {
  const plain = fc.string({ unit: fc.constantFrom('a', 'Z', '1', ' ', 'é', ';'), minLength: 1, maxLength: 8 });
  fc.assert(
    fc.property(fc.array(plain, { minLength: 1, maxLength: 4 }), (fields) => {
      assert.deepEqual(parseDelimited(fields.join(','), ','), [fields]);
    }),
  );
});

test("a cell's address reads back the column and row it names, for every column from A to ZZZ", () => {
  const lastColumn = 26 + 26 ** 2 + 26 ** 3 - 1; // ZZZ
  fc.assert(
    fc.property(fc.integer({ min: 0, max: lastColumn }), fc.integer({ min: 1, max: 999_999 }), (column, row) => {
      assert.deepEqual(cellAt(`${columnName(column)}${row}`), { column, row });
    }),
  );
  assert.equal(columnName(lastColumn), 'ZZZ');
});

test('an address with a row 0, a lower-case letter or four letters names no cell', () => {
  const letters = (length: number) =>
    fc.string({ unit: fc.constantFrom('A', 'Q', 'Z'), minLength: length, maxLength: length });
  fc.assert(
    fc.property(letters(1), letters(4), fc.integer({ min: 1, max: 99 }), (column, four, row) => {
      assert.equal(cellAt(`${column}0`), null);
      assert.equal(cellAt(`${column.toLowerCase()}${row}`), null);
      assert.equal(cellAt(`${four}${row}`), null);
    }),
  );
});

test('XML reads back the text and attribute values it was written with, escaped or in CDATA', () => {
  fc.assert(
    fc.property(tricky, tricky, fc.boolean(), (value, text, cdata) => {
      const inside = cdata ? `<![CDATA[${text}]]>` : escaped(text);
      const root = xmlTree(`<?xml version="1.0"?><w:p w:val="${escaped(value)}"><w:t>${inside}</w:t></w:p>`);
      assert.deepEqual(root.attributes, { 'w:val': value });
      assert.deepEqual(elementOf(root, 't')?.children, text ? [text] : []);
    }),
  );
});
