// The cell rule in Norwegian: a whole number in a field whose name ends in år, nr, nummer, kode, postnr, orgnr, kid,
// konto, telefon or versjon is a name, not an amount, and is written as it is, never grouped, as Norwegian compounds
// end in them (byggeår, varenr); amounts and counts are grouped as nb-NO groups them. The account states the rule the
// model reads, in the same words. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cellIn, CELL_RULE, memoryResults, startVindu, type Shown } from '../src/index.js';
import { mcpClient, panelsIn } from './helpers.js';

const NAMES = {
  byggeår: 1978,
  _år: 2024,
  År: 1999,
  regnskapsår: 2025,
  varenr: 1001,
  kundenummer: 20451,
  postnr: 5003,
  orgnr: 912345678,
  kid: 1234567,
  bankkonto: 12345678903,
  telefon: 55512345,
  mobiltelefon: 41234567,
  versjon: 2024,
  artikkelkode: 4711,
};

test('in nb-NO, a whole number in a field named by a Norwegian ending is written as it is; an amount is grouped', () => {
  for (const [field, n] of Object.entries(NAMES)) assert.equal(cellIn(n, field, 'nb-NO'), String(n), field);
  for (const field of ['beløp', 'antall', 'sum', 'timer'])
    assert.equal(cellIn(1978, field, 'nb-NO'), '1\u00a0978', field);
  assert.equal(cellIn(1978.5, 'byggeår', 'nb-NO'), '1\u00a0978,5'); // a fraction is a number, whatever the field
  assert.equal(cellIn(1978, 'bygge_a\u030ar', 'nb-NO'), '1978'); // å written as a and its ring
  for (const [field, n] of [
    ['year', 2026],
    ['invoice_no', 10233],
    ['zip', 5003],
    ['amount', 1978],
  ] as const)
    // English, as before
    assert.equal(cellIn(n, field, 'nb-NO'), field === 'amount' ? '1\u00a0978' : String(n), field);
  assert.match(
    CELL_RULE,
    /or whose names end in år, nr, nummer, kode, postnr, orgnr, kid, konto, telefon or versjon \(byggeår, varenr\), as written/,
  );
});

test("a table of a Norwegian firm's rows in nb-NO: its cells follow the rule its account states", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cell-rule-')),
    results = memoryResults(dir);
  results.add({
    server: 'register',
    tool: 'buildings',
    value: [{ adresse: 'Strandgaten 12', byggeår: 1978, varenr: 1001, beløp: 48250 }],
  });
  const vindu = await startVindu({ waitMs: 300, locale: 'nb-NO' });
  const shown: Shown[] = [];
  const ui = vindu.open({ results, dir }, { onView: (v) => shown.push(v) });
  const c = await mcpClient(ui.url);
  try {
    const a = await c.json('show_view', { name: 'b', title: 'Bygg', panels: [{ id: 't', card: 'table', from: 'r1' }] });
    assert.equal(a.format.cells, CELL_RULE);
    const model = panelsIn(shown.at(-1)!.wide);
    assert.deepEqual(model.p_t.rows[0], { c0: 'Strandgaten 12', c1: '1978', c2: '1001', c3: '48\u00a0250' });
  } finally {
    await c.mcp.close();
    ui.close();
    await vindu.close();
  }
});
