// CSV, TSV and JSON files shown as a table or a sheet, read exactly by the system from an attachment or from the
// working folder, and the model's notes on cells by A1 address: over real MCP, as a processor calls show_view, then a
// sheet drawn in Chromium. All data is synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState, type ViewPresentation } from '../src/index.js';
import { chromium, mcpClient } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('data-files-'), work = tmp('data-work-');
fs.mkdirSync(path.join(work, 'data'));
const results = memoryResults(dir);
const png = path.join(dir, 'shot.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
results.attach('shot.png', 'image/png', png); // a1

// each file as written, where it is put, and the rows the system must read from it
const FILES = {
  csv: { name: 'invoices.csv', mime: 'text/csv',
    text: '\uFEFFid,customer,note,amount\r\nINV-1,"Vik Data, AS","Line one\nline two",31050\r\nINV-2,Strand Bygg,"He said ""pay""",35740.5\r\nINV-3,Nordlys,,007\r\n',
    rows: [{ id: 'INV-1', customer: 'Vik Data, AS', note: 'Line one\nline two', amount: 31050 }, { id: 'INV-2', customer: 'Strand Bygg', note: 'He said "pay"', amount: 35740.5 }, { id: 'INV-3', customer: 'Nordlys', note: '', amount: '007' }] },
  tsv: { name: 'stock.tsv', mime: 'text/tab-separated-values',
    text: 'name\tqty\tprice\nBolts, M8\t100\t2.5\nNuts\t250\t0.80\n',
    rows: [{ name: 'Bolts, M8', qty: 100, price: 2.5 }, { name: 'Nuts', qty: 250, price: '0.80' }] },
  records: { name: 'records.json', mime: 'application/json', text: JSON.stringify([{ sku: 'A-1', stock: 12 }, { sku: 'B-2', stock: 0, bin: 'K4' }]),
    rows: [{ sku: 'A-1', stock: 12 }, { sku: 'B-2', stock: 0, bin: 'K4' }] },
  lists: { name: 'lists.json', mime: 'application/json', text: JSON.stringify([['sku', 'stock'], ['A-1', 12], ['B-2', 0]]),
    rows: [{ sku: 'A-1', stock: 12 }, { sku: 'B-2', stock: 0 }] },
  object: { name: 'target.json', mime: 'application/json', text: JSON.stringify({ region: 'Nord', target: 125000, owner: 'Kari' }),
    rows: [{ Key: 'region', Value: 'Nord' }, { Key: 'target', Value: 125000 }, { Key: 'owner', Value: 'Kari' }] },
};
const attached: Record<string, string> = {};
for (const [k, f] of Object.entries(FILES)) {
  fs.writeFileSync(path.join(work, 'data', f.name), f.text);
  const file = path.join(dir, f.name); fs.writeFileSync(file, f.text);
  attached[k] = results.attach(f.name, f.mime, file).id;
}
// a sheet wider and longer than it draws, and a file over the limit
const wide = [Array.from({ length: 210 }, (_, i) => `f${i + 1}`).join(','), ...Array.from({ length: 1200 }, (_, r) => Array.from({ length: 210 }, (_, i) => String(r * 1000 + i)).join(','))].join('\n');
fs.writeFileSync(path.join(work, 'data', 'wide.csv'), wide);
fs.writeFileSync(path.join(work, 'data', 'big.csv'), `a,b\n${'1,2\n'.repeat(1_500_000)}`); // 6 MB
fs.writeFileSync(path.join(work, 'data', 'text.json'), '"just a string"');
fs.writeFileSync(path.join(work, 'data', 'plain.json'), '[1, 2, 3]');

const shown: Shown[] = [], presented: ViewPresentation[] = []; let state: ShellState | undefined;
const vindu = await startVindu();
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onState: s => { state = s; }, onPresentation: v => presented.push(v) });
const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });

test('a CSV, TSV or JSON file is read exactly by the system, as a table and as a sheet, from an attachment and from the working folder', async () => {
  for (const [k, f] of Object.entries(FILES)) {
    const columns = Object.keys(f.rows.reduce((all, r) => ({ ...all, ...r }), {})).length;
    for (const card of ['table', 'sheet']) {
      for (const source of [{ from: attached[k] }, { path: `data/${f.name}` }]) {
        const a = await json('show_view', { name: 'file', title: 'File', panels: [{ id: 'rows', card, ...source }] });
        const at = `${k} as a ${card} from ${JSON.stringify(source)}`;
        assert.deepEqual(presented.at(-1)!.panels[0].rows, f.rows, at); // the file's own values: none typed by the model
        const p = a.panels[0];
        assert.equal(p.from, source.from ?? `work/data/${f.name}`, at);
        assert.equal(p.seen, 'exact: the file, read by the system', at);
        assert.deepEqual({ ...p.file, cells: undefined }, { name: source.from ? f.name : `data/${f.name}`, format: k === 'csv' || k === 'tsv' ? k : 'json', rows: f.rows.length, columns, cells: undefined }, at);
        assert.equal(p.marked, undefined, at); assert.equal(a.typed_numbers_not_in_any_result, undefined, at);
      }
    }
  }
  const t = await json('show_view', { name: 'file', title: 'File', panels: [{ card: 'table', path: 'data/invoices.csv', sort: 'amount desc' }] });
  assert.equal(t.panels[0].first_row, 'INV-2 | Strand Bygg | He said "pay" | 35,740.5');
  assert.equal(t.panels[0].file.cells, 'a number written exactly as a number is that number; every other cell is its text as written');
  const j = await json('show_view', { name: 'file', title: 'File', panels: [{ card: 'table', path: 'data/target.json' }] });
  assert.ok(j.corrections.some((c: string) => /showed the object in "data\/target.json" as one row for each of its 3 fields \(Key, Value\)/.test(c)), JSON.stringify(j.corrections));
});

test('a sheet from a file draws its first 1,000 rows and 200 columns, a table its first 100 with its suggestion; the account says how many there are', async () => {
  const s = await json('show_view', { name: 'wide', title: 'Wide', panels: [{ id: 'sheet', card: 'sheet', path: 'data/wide.csv' }, { id: 'table', card: 'table', path: 'data/wide.csv' }] });
  assert.deepEqual([s.panels[0].file.rows, s.panels[0].file.columns, s.panels[0].rows, s.panels[0].shown_rows, s.panels[0].shown_columns], [1200, 210, 1200, 1000, 200]);
  assert.deepEqual([s.panels[1].file.rows, s.panels[1].rows, s.panels[1].shown_rows, s.panels[1].fields.length], [1200, 1200, 100, 6]);
  assert.ok(s.suggestions.some((x: { label: string }) => x.label === 'Show all 1200 rows'), JSON.stringify(s.suggestions));
  const model = (shown.at(-1)!.wide.find(m => m.updateDataModel) as any).updateDataModel.value.panels.p_sheet;
  assert.equal(model.rows.length, 1000); assert.deepEqual(JSON.parse(model.rows[999]).slice(0, 2), [999000, 999001]);
  assert.deepEqual([model.props.cells.fields.length, model.props.cells.rows, model.props.cells.columns], [200, 1200, 210]);
});

test('what cannot be read is refused, saying why; an image is still refused as it was', async () => {
  const refused = async (panel: Record<string, unknown>) => { const r = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', ...panel }] }); assert.equal(r.ok, false, JSON.stringify(panel)); return r.text; };
  assert.equal(await refused({ card: 'table', path: 'data/big.csv' }), 'not shown: panel p: "data/big.csv" is 6.0 MB; a table or a sheet reads data files up to 5 MB');
  assert.equal(await refused({ card: 'sheet', path: 'data/text.json' }), 'not shown: panel p: "data/text.json" holds one string, not rows: a JSON file shows as a list of records, a list of lists (the first its header) or one object');
  assert.match(await refused({ card: 'table', path: 'data/plain.json' }), /"data\/plain.json" holds a list of plain values, or of records and other values mixed, not rows/);
  assert.match(await refused({ card: 'table', from: 'a1' }), /^not shown: panel p: a1 is an attachment \(image\/png\); show it with a media panel, or point at the result where you read it$/);
  assert.match(await refused({ card: 'sheet', from: 'a1' }), /a1 is an attachment \(image\/png\); show it with a media panel/);
  assert.equal(await refused({ card: 'bar-chart', from: attached.csv, x: 'id', y: 'amount' }), `not shown: panel p: ${attached.csv} is a CSV file (invoices.csv); a table or a sheet shows its rows, read by the system`);
  assert.equal(await refused({ card: 'table', path: 'data/missing.csv' }), 'not shown: panel p: no file "data/missing.csv" in the working folder');
  assert.equal(await refused({ card: 'table', path: 'notes.txt' }), 'not shown: panel p: "notes.txt" is not a data file: a table reads .csv, .tsv and .json files');
  assert.equal(await refused({ card: 'table', from: attached.csv, path: 'data/invoices.csv' }), 'not shown: panel p: a table shows from (a result or an attachment) or path (a file in the working folder), not both');
  fs.writeFileSync(path.join(work, 'data', 'open.csv'), 'a,b\n1,"never closed\n2,3\n');
  assert.equal(await refused({ card: 'table', path: 'data/open.csv' }), 'not shown: panel p: "data/open.csv" is not CSV the system can read: a quoted field that starts on line 2 is never closed');
});

test('notes on cells by A1 address: placed and told back, on a table and a sheet', async () => {
  const notes = [{ cell: 'B3', note: 'Pays late every quarter' }, { cell: 'A1', note: 'Invoice numbers from the ledger' }, { cell: 'D2', note: 'Disputed' }];
  const a = await json('show_view', { name: 'noted', title: 'Noted', panels: [
    { id: 'table', card: 'table', path: 'data/invoices.csv', notes },
    { id: 'sheet', card: 'sheet', from: attached.csv, notes },
    { id: 'typed', card: 'table', rows: [{ a: 'x', b: 1 }], notes: [{ cell: 'B2', note: 'One' }] },
  ] });
  const told = [{ n: 1, cell: 'B3', field: 'customer', value: 'Strand Bygg' }, { n: 2, cell: 'A1', field: 'id', header: true }, { n: 3, cell: 'D2', field: 'amount', value: '31050' }];
  assert.deepEqual(a.panels[0].notes, told);
  assert.deepEqual(a.panels[1].notes, told);
  assert.deepEqual(a.panels[2].notes, [{ n: 1, cell: 'B2', field: 'b', value: '1' }]);
  const comps = (shown.at(-1)!.wide.find(m => m.updateComponents) as any).updateComponents.components as { id: string; component: string }[];
  assert.equal(comps.find(c => c.id === 'p_table__cells')?.component, 'VNotedTable'); // a noted table keeps its A1 addresses, wide and narrow
  const model = (shown.at(-1)!.compact.find(m => m.updateDataModel) as any).updateDataModel.value.panels;
  assert.deepEqual(model.p_table.cells.notes[0], { n: 1, cell: 'B3', note: 'Pays late every quarter', row: 1, column: 1 });
  assert.deepEqual(model.p_sheet.props.cells.notes[1], { n: 2, cell: 'A1', note: 'Invoice numbers from the ledger', row: -1, column: 0 });
  const listed = await json('show_view', { name: 'noted', title: 'Noted', panels: [{ id: 'l', card: 'list', path: 'data/invoices.csv', rows: [{ label: 'a' }], notes }] });
  assert.ok(listed.ignored.includes('panel l: "notes" does nothing on a list (table reads it)'), JSON.stringify(listed.ignored));
});

test('a note that cannot be placed is refused, each for its own reason', async () => {
  const refused = async (card: string, notes: unknown[]) => {
    const r = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', card, path: 'data/invoices.csv', notes }] });
    assert.equal(r.ok, false, JSON.stringify(notes)); return r.text;
  };
  for (const card of ['table', 'sheet']) {
    for (const cell of ['b3', 'B0', 'AAAA1', '3B', 'B 3']) assert.equal(await refused(card, [{ cell, note: 'x' }]), `not shown: panel p: notes: "${cell}" is not a cell address: write the column's letters, then the row's number, as B3 (row 1 is the header row)`);
    assert.equal(await refused(card, [{ cell: 'E2', note: 'x' }]), 'not shown: panel p: notes: there is no cell E2 here: the cells drawn are A1 to D4 (row 1 is the header and 3 rows follow it; columns A to D are id, customer, note, amount)');
    assert.equal(await refused(card, [{ cell: 'A5', note: 'x' }]), 'not shown: panel p: notes: there is no cell A5 here: the cells drawn are A1 to D4 (row 1 is the header and 3 rows follow it; columns A to D are id, customer, note, amount)');
    assert.equal(await refused(card, Array.from({ length: 21 }, (_, i) => ({ cell: `A${i + 1}`, note: 'x' }))), `not shown: panel p: notes: 21 notes; a ${card} takes at most 20`);
    assert.equal(await refused(card, [{ cell: 'B2', note: 'x'.repeat(201) }]), 'not shown: panel p: notes: the note on B2 is 201 characters; a note has at most 200');
    assert.equal(await refused(card, [{ cell: 'B2', note: '  ' }]), 'not shown: panel p: notes: the note on B2 is empty');
    assert.equal(await refused(card, [{ cell: 'B2', note: 'x' }, { cell: 'B2', note: 'y' }]), 'not shown: panel p: notes: B2 has two notes; write them as one');
  }
  const narrower = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', card: 'table', path: 'data/invoices.csv', columns: ['id', 'amount'], notes: [{ cell: 'C2', note: 'x' }] }] });
  assert.match(narrower.text, /there is no cell C2 here: the cells drawn are A1 to B4 \(row 1 is the header and 3 rows follow it; columns A to B are id, amount\)/); // the columns drawn, as chosen
  const message = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', card: 'message', rows: [{ subject: 'Hi', body: 'Text' }], notes: [{ cell: 'A1', note: 'x' }] }] });
  assert.equal(message.text, 'not shown: panel p: notes go on the cells of a table or a sheet; a message takes none');
});

test('drawn in Chromium: a sheet from a CSV has A1 letters, a marked cell described by its note, and the notes listed; no page errors', async () => {
  await json('show_view', { name: 'sheet', title: 'Invoices', panels: [{ id: 'inv', card: 'sheet', path: 'data/invoices.csv', notes: [{ cell: 'B3', note: 'Pays late every quarter' }, { cell: 'D2', note: 'Disputed' }] }] });
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => (window as any).app.shell('light'));
    await page.evaluate((x: Shown) => (window as any).app.view(x), shown.filter(v => v.name === 'sheet').at(-1)!);
    await page.evaluate((s: ShellState) => (window as any).app.state(s), state!);
    const sheet = page.locator('vindu-sheet');
    await sheet.locator('td.vb-noted').first().waitFor();
    assert.deepEqual(await sheet.locator('.vb-letter').allTextContents(), ['A', 'B', 'C', 'D']);
    assert.deepEqual(await sheet.locator('tbody .vb-rownum').allTextContents(), ['2', '3', '4']);
    assert.equal(await page.locator('[data-panel="inv"][data-row]').count(), 3);
    const noted = sheet.locator('tr[data-row="1"] td.vb-noted');
    assert.equal(await noted.getAttribute('title'), 'Pays late every quarter');
    assert.equal(await noted.locator('.vb-notemark').textContent(), '1');
    // the accessible description, as Chromium computes it
    const cdp = await page.context().newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'vindu-sheet tr[data-row="1"] td.vb-noted' });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    assert.equal(nodes[0].description?.value, 'Pays late every quarter');
    // focusable with Tab: the first noted cell in the order of the page, then the next
    await page.evaluate(() => { const start = document.querySelector<HTMLElement>('vindu-sheet tr[data-row="0"] th')!; start.tabIndex = -1; start.focus(); });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-description')), 'Disputed');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-description')), 'Pays late every quarter');
    assert.deepEqual(await sheet.locator('ol.vb-cellnotes li').allTextContents(), ['B3 Pays late every quarter', 'D2 Disputed']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
