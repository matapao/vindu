// What the system refuses to read of a workbook or a Word document, each refusal saying why: macros; an archive over
// any of its limits (entries, the bytes it inflates to, an entry's compression ratio, a part larger than it says); a name
// that leaves the archive; a document type or an entity declared, or an entity it never defines; and a damaged archive.
// Over real MCP, and the zip and XML readers on their own. All data is synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults } from '../src/index.js';
import { xmlTree } from '../src/xml-read.js';
import { bytesZip, ZIP_LIMITS } from '../src/zip-read.js';
import { mcpClient } from './helpers.js';
import { sheetXml, stringsXml, workbook, wordDocument, zipOf } from './office-fixtures.js';

const SHEET = sheetXml(
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>2</v></c></row>',
);
const book = (
  o: Parameters<typeof workbook>[1] = {},
  sheets: Parameters<typeof workbook>[0] = [{ name: 'Ark1', xml: SHEET }],
) => workbook(sheets, { strings: ['Navn', 'Ola'], ...o });

/** Where each entry of a zip archive's central directory starts, by its name. */
function directory(zip: Uint8Array): Map<string, number> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  const out = new Map<string, number>();
  for (let at = view.getUint32(end + 16, true), n = view.getUint16(end + 10, true); n > 0; n--) {
    const name = Buffer.from(zip.subarray(at + 46, at + 46 + view.getUint16(at + 28, true))).toString('utf8');
    out.set(name, at);
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}
/** A copy of a zip archive whose directory says something else of an entry: its size inflated (24), or its checksum (16). */
function patched(zip: Uint8Array, name: string, field: 16 | 24, value: number): Uint8Array {
  const copy = Uint8Array.from(zip),
    at = directory(copy).get(name)!;
  new DataView(copy.buffer).setUint32(at + field, value >>> 0, true);
  return copy;
}
const sizeOf = (zip: Uint8Array, name: string) =>
  new DataView(zip.buffer, zip.byteOffset).getUint32(directory(zip).get(name)! + 24, true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-safety-')),
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'office-safety-work-'));
const vindu = await startVindu({ waitMs: 300 });
const ui = vindu.open({ results: memoryResults(dir), dir, work }, {});
const { mcp, call } = await mcpClient(ui.url);
afterAll(async () => {
  await mcp.close();
  ui.close();
  await vindu.close();
});
/** Why a panel showing this file is refused: written to the working folder, and shown in a sheet (or a document). */
async function refusal(name: string, bytes: Uint8Array | string, card = 'sheet'): Promise<string> {
  fs.writeFileSync(path.join(work, name), bytes);
  const r = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', card, path: name }] });
  assert.equal(r.ok, false, name);
  return r.text.replace(/^not shown: panel p: /, '');
}

test('a workbook made here is read, so each refusal below is for what it says alone', async () => {
  fs.writeFileSync(path.join(work, 'ok.xlsx'), book());
  const r = await call('show_view', { name: 'ok', title: 'OK', panels: [{ id: 'p', card: 'sheet', path: 'ok.xlsx' }] });
  assert.equal(r.ok, true, r.text);
});

test('macros are refused: a workbook with macros by its name, a vbaProject.bin part, and an Excel 4.0 macro sheet', async () => {
  assert.equal(
    await refusal('makro.xlsm', book()),
    '"makro.xlsm" is a workbook with macros (.xlsm); the system reads workbooks without them: .xlsx',
  );
  assert.equal(
    await refusal('vba.xlsx', book({ more: { 'xl/vbaProject.bin': new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) } })),
    '"vba.xlsx" holds macros (its part xl/vbaProject.bin); the system reads workbooks and documents without them: .xlsx and .docx',
  );
  const sheet = book({
    more: {
      'xl/_rels/workbook.xml.rels':
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet" Target="macrosheets/sheet1.xml"/></Relationships>',
    },
  });
  assert.equal(
    await refusal('xlm.xlsx', sheet),
    '"xlm.xlsx" holds macros (its Excel 4.0 macro sheet Ark1); the system reads workbooks without them: .xlsx',
  );
});

test("each limit of an archive is refused: its entries, the bytes it says it inflates to, an entry's ratio, a part larger than it says", async () => {
  const many = Object.fromEntries(
    Array.from({ length: ZIP_LIMITS.entries }, (_, i) => [`xl/extra/part${i}.xml`, '<x/>']),
  );
  assert.equal(
    await refusal('many.xlsx', book({ more: many })),
    '"many.xlsx" holds 1,007 parts; the system reads archives of at most 1,000',
  );
  const plain = book();
  assert.equal(
    await refusal('total.xlsx', patched(plain, 'xl/sharedStrings.xml', 24, 70_000_000)),
    '"total.xlsx" says its parts inflate to more than 64 MB in all; the system reads archives up to 64 MB inflated',
  );
  const ratio = await refusal('ratio.xlsx', book({ more: { 'xl/media/zeros.bin': new Uint8Array(2_000_000) } }));
  assert.match(
    ratio,
    /^"ratio.xlsx" holds a part \("xl\/media\/zeros.bin"\) that says it inflates to \d+ times its compressed size; the system reads parts of at most 100 times$/,
  );
  const strings = sizeOf(plain, 'xl/sharedStrings.xml');
  assert.equal(
    await refusal('lies.xlsx', patched(plain, 'xl/sharedStrings.xml', 24, strings - 10)),
    `"lies.xlsx" holds a part ("xl/sharedStrings.xml") that inflates to more than the ${strings - 10} bytes it says, so it is not read`,
  );
  assert.equal(
    await refusal('short.xlsx', patched(plain, 'xl/sharedStrings.xml', 24, strings + 10)),
    '"short.xlsx" is damaged, or not a zip archive as .xlsx and .docx files are: its part "xl/sharedStrings.xml" is shorter than it says',
  );
  // the file itself, and each limit on its own, read here with limits made small
  assert.throws(
    () => bytesZip(plain, { ...ZIP_LIMITS, file: 100 }),
    /^Error: is [\d.]+ MB; the system reads .xlsx and .docx files up to 0 MB$/,
  );
  assert.throws(
    () => bytesZip(plain, { ...ZIP_LIMITS, entries: 3 }),
    /holds 7 parts; the system reads archives of at most 3/,
  );
  assert.throws(() => bytesZip(plain, { ...ZIP_LIMITS, total: 100 }), /says its parts inflate to more than/);
  assert.throws(
    () => bytesZip(plain, { ...ZIP_LIMITS, ratio: 1, ratioFrom: 10 }),
    /times its compressed size; the system reads parts of at most 1 times/,
  );
});

test('a name that leaves the archive is refused, before anything is read; so is a name written twice', async () => {
  for (const name of ['../evil.xml', 'xl/../../evil.xml', '/etc/evil.xml', 'C:/evil.xml', '..\\evil.xml']) {
    assert.equal(
      await refusal('escape.xlsx', book({ more: { [name]: '<x/>' } })),
      `"escape.xlsx" holds a part whose name leaves the archive (${JSON.stringify(name)}), so it is not read`,
    );
  }
  assert.equal(
    await refusal('twice.xlsx', book({ more: { 'XL/workbook.xml': '<x/>' } })),
    '"twice.xlsx" holds two parts named "XL/workbook.xml", so it is not read',
  );
  assert.equal(
    await refusal('escape.docx', wordDocument('<w:p/>', { more: { '../evil.xml': '<x/>' } }), 'document'),
    '"escape.docx" holds a part whose name leaves the archive ("../evil.xml"), so it is not read',
  );
});

test('XML that declares a document type or an entity, or refers to an entity it never defines, is refused; nothing is expanded', async () => {
  const laughs =
    '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>&lol2;</t></si></sst>';
  assert.equal(
    await refusal('doctype.xlsx', book({ more: { 'xl/sharedStrings.xml': laughs } })),
    '"doctype.xlsx" has a part (xl/sharedStrings.xml) that declares a document type (<!DOCTYPE), which the system never reads, so that no entity is defined',
  );
  const entity = '<?xml version="1.0"?><!ENTITY secret SYSTEM "file:///etc/passwd"><sst><si><t>&secret;</t></si></sst>';
  assert.equal(
    await refusal('entity.xlsx', book({ more: { 'xl/sharedStrings.xml': entity } })),
    '"entity.xlsx" has a part (xl/sharedStrings.xml) that declares an entity (<!ENTITY), which the system never reads or expands',
  );
  const reference = stringsXml(['x']).replace('>x<', '>&secret;<');
  assert.equal(
    await refusal('reference.xlsx', book({ more: { 'xl/sharedStrings.xml': reference } })),
    '"reference.xlsx" has a part (xl/sharedStrings.xml) that refers to an entity (&secret;) that XML does not define, and the system expands none',
  );
  const word = wordDocument('<w:p/>', {
    more: {
      'word/document.xml': '<?xml version="1.0"?><!DOCTYPE w:document SYSTEM "http://example.com/x.dtd"><w:document/>',
    },
  });
  assert.equal(
    await refusal('doctype.docx', word, 'document'),
    '"doctype.docx" has a part (word/document.xml) that declares a document type (<!DOCTYPE), which the system never reads, so that no entity is defined',
  );
  // the reader on its own: the five predefined entities and character references, and nothing else
  assert.deepEqual(
    xmlTree('<a b="&lt;&amp;&quot;">&gt;&apos;&#229;&#x00F8;<![CDATA[&raw;<x>]]><!-- left out --></a>'),
    { name: 'a', attributes: { b: '<&"' }, children: [">'åø&raw;<x>"] },
  );
  for (const [xml, why] of [
    ['<a>&amp</a>', /an & that begins no reference/],
    ['<a><b></a>', /<\/a> closes <b>/],
    ['<a>', /<a> is never closed/],
    ['<a/><b/>', /a second root element/],
    ['<!DOCTYPE a><a/>', /declares a document type/],
    ['<!ENTITY x "y"><a/>', /declares an entity/],
    ['<a>&nbsp;</a>', /refers to an entity \(&nbsp;\)/],
    ['<a b=1/>', /without a quoted value/],
  ] as const) {
    assert.throws(() => xmlTree(xml), why, xml);
  }
});

test('a damaged archive is refused: not a zip at all, cut short, or a part that does not match its checksum', async () => {
  const damaged = '" is damaged, or not a zip archive as .xlsx and .docx files are: ';
  assert.equal(await refusal('text.xlsx', 'Navn,Ola\n'), `"text.xlsx${damaged}it is too short to be one`);
  assert.equal(
    await refusal(
      'random.xlsx',
      Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251),
    ),
    `"random.xlsx${damaged}it has no central directory`,
  );
  const whole = book();
  assert.equal(
    await refusal('cut.xlsx', whole.subarray(0, Math.floor(whole.length / 2))),
    `"cut.xlsx${damaged}it has no central directory`,
  );
  assert.equal(
    await refusal('checksum.xlsx', patched(whole, 'xl/workbook.xml', 16, 0x12345678)),
    `"checksum.xlsx${damaged}its part "xl/workbook.xml" does not match its checksum`,
  );
  const flipped = Uint8Array.from(whole),
    at = directory(flipped).get('xl/sharedStrings.xml')!;
  const local = new DataView(flipped.buffer).getUint32(at + 42, true);
  flipped[local + 30 + new DataView(flipped.buffer).getUint16(local + 26, true) + 2] ^= 0xff; // a byte of its compressed data
  assert.match(
    await refusal('flipped.xlsx', flipped),
    /^"flipped.xlsx" (is damaged, or not a zip archive as .xlsx and .docx files are: its part "xl\/sharedStrings.xml"|holds a part \("xl\/sharedStrings.xml"\) that inflates to more)/,
  );
  assert.equal(
    await refusal('nobook.xlsx', zipOf({ 'docProps/app.xml': '<x/>' })),
    '"nobook.xlsx" is not a workbook: it has no workbook part (xl/workbook.xml)',
  );
  assert.equal(
    await refusal('nodoc.docx', zipOf({ 'docProps/app.xml': '<x/>' }), 'document'),
    '"nodoc.docx" is not a Word document: it has no document part (word/document.xml)',
  );
});
