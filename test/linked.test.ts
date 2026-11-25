// Linked panels: the model writes a view once, and a list drives the panels that follow it, without the model: a plain
// click on a customer, and its invoices and its card show what was picked, exactly, from their results. The model is
// told what the person picked, and can pick too. A panel that follows one that waits waits too. In Chromium: the click.
// All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const customers = [{ customer: 'Havgap Media', city: 'Bergen', owner: 'Kari' }, { customer: 'Brattli Verksted', city: 'Voss', owner: 'Ola' }, { customer: 'Fjord Bakeri', city: 'Odda', owner: 'Kari' }, { customer: 'Nordlys AS', city: 'Tromsø', owner: 'Ola' }];
const invoices = [
  { number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050 }, { number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: 19800 },
  { number: 'INV-2026-0431', customer: 'Havgap Media', amount: 17160 }, { number: 'INV-2026-0440', customer: 'Fjord Bakeri', amount: 4200 },
];
const VIEW = { name: 'crm', title: 'Customers', panels: [
  { id: 'cust', card: 'table', from: 'r1', title: 'Customers', columns: ['customer', 'city'] },
  { id: 'inv', card: 'table', from: 'r2', title: 'Invoices', columns: ['number', 'amount'], detail: { of: 'cust', by: 'customer' } },
  { id: 'card', card: 'record', title: 'Customer', detail: { of: 'cust' } },
] };

async function windowWith() {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('linked-'), results = memoryResults(dir);
  results.add({ server: 'crm', tool: 'list_customers', value: customers }); results.add({ server: 'accounts', tool: 'list_invoices', value: invoices });
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { st.s = s; } });
  const c = await mcpClient(ui.url);
  const model = (name: string) => (shown.filter(v => v.name === name).at(-1)!.wide.find((m: any) => m.updateDataModel) as any).updateDataModel.value.panels;
  return { vindu, ui, ...c, shown, st, model, close: async () => { await c.mcp.close(); ui.close(); await vindu.close(); } };
}

test('a list drives the panels that follow it: the first row to start with, a click picks another, the system shows exactly what is picked', async () => {
  const w = await windowWith();
  try {
    const acc = await w.json('show_view', VIEW);
    const inv = acc.panels.find((p: any) => p.id === 'inv'), card = acc.panels.find((p: any) => p.id === 'card');
    assert.equal(inv.linked, 'follows cust: its rows where customer is "Havgap Media", as Havgap Media is picked there; the person picks another with a click there, without you');
    assert.equal(inv.rows, 2);
    const drawn = () => JSON.stringify(w.shown.filter(v => v.name === 'crm').at(-1)!.wide);
    assert.ok(drawn().includes('"Invoices: Havgap Media"')); // its title says what it shows
    assert.deepEqual([card.from, card.values, card.marked], ['r1', 'Havgap Media · Bergen · Kari', undefined]); // the picked row itself, from the list's own result: read, not typed
    assert.deepEqual(w.st.s!.views.find(v => v.name === 'crm')!.masters, ['cust', 'p_cust']); // the window knows which rows a click picks
    assert.deepEqual(w.model('crm').p_inv.rows.map((r: any) => r.c0), ['INV-2026-0412', 'INV-2026-0431']);
    // the person clicks Brattli Verksted: the system shows its invoices and its card; the model is told, once
    const n = w.shown.length;
    assert.equal(w.ui.event({ type: 'view', view: 'crm', action: 'select', panel: 'p_cust', from: 1, by: { name: 'Kari', window: 'main' } }), true);
    await until(() => w.shown.length > n && w.model('crm').p_inv.rows.length === 1); await sleep(30);
    assert.deepEqual(w.model('crm').p_inv.rows.map((r: any) => r.c0), ['INV-2026-0418']);
    assert.equal(w.st.s!.views.find(v => v.name === 'crm')!.mark, undefined); // a pick is no change to mark
    assert.match(w.ui.delta(), /Kari \(main\) picked Brattli Verksted in Customers \(cust\), which Invoices and Customer follow/);
    // the model picks too, by key; and is told what cannot be
    const r = await w.json('act_in_view', { view: 'crm', action: 'select', panel: 'cust', key: 'Fjord Bakeri' });
    assert.match(r.view.panels.find((p: any) => p.id === 'inv').linked, /where customer is "Fjord Bakeri"/); assert.ok(drawn().includes('"Invoices: Fjord Bakeri"'));
    assert.match((await w.call('act_in_view', { view: 'crm', action: 'select', panel: 'inv', from: 0 })).text, /no panel of Customers \(inv\) follows what is picked in it: give a panel detail/);
    assert.match((await w.call('act_in_view', { view: 'crm', action: 'select', panel: 'cust', key: 'Fjord Bakeri' })).text, /Fjord Bakeri is picked in Customers \(cust\) already/);
    await w.json('act_in_view', { view: 'crm', action: 'select', panel: 'cust', key: 'Nordlys AS' }); // nothing for this pick: said in words, not refused
    assert.ok(drawn().includes('None for Nordlys AS: no rows where customer is Nordlys AS.'));
    // what cannot be linked is refused when it is shown
    assert.match((await w.call('show_view', { name: 'x', title: 'X', panels: [{ id: 'a', card: 'table', from: 'r1', detail: { of: 'b' } }, { id: 'b', card: 'table', from: 'r2', detail: { of: 'a' } }] })).text, /panels a, b follow each other in a circle/);
    assert.match((await w.call('show_view', { name: 'y', title: 'Y', panels: [{ id: 'a', card: 'table', from: 'r1' }, { id: 'b', card: 'table', from: 'r2', detail: { of: 'a', by: 'region' } }] })).text, /detail\.by "region" is not a field of a/);
  } finally { await w.close(); }
});

test('a panel that follows one that waits waits too, and fills in with it: its view is drawn, and restored', async () => {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 0 });
  const results = memoryResults(), shown: Shown[] = [];
  const ui = vindu.open({ results }, { onView: v => shown.push(v) });
  const { mcp, json } = await mcpClient(ui.url);
  const drawn = (view: string) => JSON.stringify(shown.filter(v => v.name === view).at(-1)?.wide ?? null);
  const follows = { id: 'card', card: 'record', title: 'Customer', detail: { of: 'cust' } };
  try {
    // the list waits for its call: the card that follows it waits for the same, and the view is drawn
    const waits = await json('show_view', { name: 'crm', title: 'Customers', panels: [{ id: 'cust', card: 'table', title: 'Customers', awaits: { server: 'crm', tool: 'list_customers' } }, follows] });
    assert.deepEqual(waits.panels.map((p: any) => [p.id, p.card, p.from]), [['cust', 'table', 'waiting'], ['card', 'record', 'waiting']]);
    const n = shown.length;
    ui.result(results.add({ server: 'crm', tool: 'list_customers', value: customers }).id);
    await until(() => shown.length > n && drawn('crm').includes('Customer: Havgap Media')); // the call came: the card shows the first row
    assert.ok(drawn('crm').includes('Bergen'));
    // restored where the host reads nothing again: the list and its card wait, and the view is drawn
    await json('show_view', { name: 'list', title: 'List', panels: [{ id: 'cust', card: 'table', title: 'Customers', from: results.all()[0].id }, follows] });
    const saved = ui.checkpoint();
    const again: Shown[] = [];
    const restored = vindu.open({ results: memoryResults() }, { onView: v => again.push(v) });
    try {
      assert.deepEqual(await restored.restore(saved), []); // no view is refused
      const list = JSON.stringify(again.filter(v => v.name === 'list').at(-1)!.wide);
      assert.equal(list.split('Not read again: this host reads nothing again for a task restored.').length - 1, 2, list); // the list, and its card
    } finally { restored.close(); }
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test('in Chromium: a plain click on a row of the list picks it; elsewhere a click picks nothing', async () => {
  const w = await windowWith();
  await w.json('show_view', VIEW);
  await w.json('show_view', { name: 'plain', title: 'Plain', panels: [{ id: 'all', card: 'table', from: 'r2' }] });
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => (window as any).app.shell('light'));
    const latest = new Map<string, Shown>(); for (const v of w.shown) latest.set(v.name, v);
    for (const v of latest.values()) await page.evaluate((x: Shown) => (window as any).app.view(x), v);
    await page.evaluate((s: ShellState) => (window as any).app.state(s), w.st.s!);
    await page.waitForTimeout(400);
    const events = async () => (await page.evaluate(() => (window as any).app.events())) as any[];
    await events();
    await page.locator('.vindu-pane[data-view="crm"]').getByText('Fjord Bakeri', { exact: true }).first().click();
    const picked = (await events()).filter(e => e.type === 'view');
    assert.deepEqual(picked, [{ type: 'view', view: 'crm', action: 'select', panel: 'p_cust', from: 2 }]);
    await page.locator('.vindu-pane[data-view="plain"]').getByText('INV-2026-0418', { exact: true }).first().click();
    assert.deepEqual((await events()).filter(e => e.type === 'view'), []); // a list no panel follows: a click picks nothing
    assert.equal(w.ui.event(picked[0]), true);
    await until(() => w.model('crm').p_inv.rows.length === 1 && w.model('crm').p_inv.rows[0].c0 === 'INV-2026-0440');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); await w.close(); }
});
