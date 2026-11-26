// One task's session for the data-files tests (data-files.test.ts, data-files-drawn.test.ts): CSV, TSV and JSON files
// attached and in the working folder, a sheet wider and longer than it draws, and files that cannot be read.
import { afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState, type ViewPresentation } from '../src/index.js';
import { mcpClient } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('data-files-');
export const work = tmp('data-work-');
fs.mkdirSync(path.join(work, 'data'));
const results = memoryResults(dir);
const png = path.join(dir, 'shot.png');
fs.writeFileSync(
  png,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
);
results.attach('shot.png', 'image/png', png); // a1

// each file as written, where it is put, and the rows the system must read from it
export const FILES = {
  csv: {
    name: 'invoices.csv',
    mime: 'text/csv',
    text: '\uFEFFid,customer,note,amount\r\nINV-1,"Vik Data, AS","Line one\nline two",31050\r\nINV-2,Strand Bygg,"He said ""pay""",35740.5\r\nINV-3,Nordlys,,007\r\n',
    rows: [
      { id: 'INV-1', customer: 'Vik Data, AS', note: 'Line one\nline two', amount: 31050 },
      { id: 'INV-2', customer: 'Strand Bygg', note: 'He said "pay"', amount: 35740.5 },
      { id: 'INV-3', customer: 'Nordlys', note: '', amount: '007' },
    ],
  },
  tsv: {
    name: 'stock.tsv',
    mime: 'text/tab-separated-values',
    text: 'name\tqty\tprice\nBolts, M8\t100\t2.5\nNuts\t250\t0.80\n',
    rows: [
      { name: 'Bolts, M8', qty: 100, price: 2.5 },
      { name: 'Nuts', qty: 250, price: '0.80' },
    ],
  },
  records: {
    name: 'records.json',
    mime: 'application/json',
    text: JSON.stringify([
      { sku: 'A-1', stock: 12 },
      { sku: 'B-2', stock: 0, bin: 'K4' },
    ]),
    rows: [
      { sku: 'A-1', stock: 12 },
      { sku: 'B-2', stock: 0, bin: 'K4' },
    ],
  },
  lists: {
    name: 'lists.json',
    mime: 'application/json',
    text: JSON.stringify([
      ['sku', 'stock'],
      ['A-1', 12],
      ['B-2', 0],
    ]),
    rows: [
      { sku: 'A-1', stock: 12 },
      { sku: 'B-2', stock: 0 },
    ],
  },
  object: {
    name: 'target.json',
    mime: 'application/json',
    text: JSON.stringify({ region: 'Nord', target: 125000, owner: 'Kari' }),
    rows: [
      { Key: 'region', Value: 'Nord' },
      { Key: 'target', Value: 125000 },
      { Key: 'owner', Value: 'Kari' },
    ],
  },
};
export const attached: Record<string, string> = {};
for (const [k, f] of Object.entries(FILES)) {
  fs.writeFileSync(path.join(work, 'data', f.name), f.text);
  const file = path.join(dir, f.name);
  fs.writeFileSync(file, f.text);
  attached[k] = results.attach(f.name, f.mime, file).id;
}
// a sheet wider and longer than it draws, and a file over the limit
const wide = [
  Array.from({ length: 210 }, (_, i) => `f${i + 1}`).join(','),
  ...Array.from({ length: 1200 }, (_, r) => Array.from({ length: 210 }, (_, i) => String(r * 1000 + i)).join(',')),
].join('\n');
fs.writeFileSync(path.join(work, 'data', 'wide.csv'), wide);
fs.writeFileSync(path.join(work, 'data', 'big.csv'), `a,b\n${'1,2\n'.repeat(1_500_000)}`); // 6 MB
fs.writeFileSync(path.join(work, 'data', 'text.json'), '"just a string"');
fs.writeFileSync(path.join(work, 'data', 'plain.json'), '[1, 2, 3]');

export const shown: Shown[] = [],
  presented: ViewPresentation[] = [];
export let state: ShellState | undefined;
const vindu = await startVindu();
const ui = vindu.open(
  { results, dir, work },
  {
    onView: (v) => shown.push(v),
    onState: (s) => {
      state = s;
    },
    onPresentation: (v) => presented.push(v),
  },
);
const { mcp, call, json } = await mcpClient(ui.url);
export { call, json };
afterAll(async () => {
  await mcp.close();
  ui.close();
  await vindu.close();
});
