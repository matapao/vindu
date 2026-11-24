// The UI server over real MCP (streamable HTTP), as a processor would call it. No model and no browser involved.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, checkSurface, type Shown } from '../src/index.js';
import { mcpClient, get } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'));
const results = memoryResults(dir);
const invoices = [
  { id: 'INV-2026-0241', customer: 'Vik Data', due: '2026-09-30', amount_nok: 31050, status: 'overdue' },
  { id: 'INV-2026-0259', customer: 'Strand Bygg', due: '2026-10-16', amount_nok: 35740, status: 'overdue' },
  { id: 'INV-2026-0270', customer: 'Strand Bygg', due: '2026-10-28', amount_nok: 35400, status: 'overdue' },
  { id: 'INV-2026-0300', customer: 'Nordlys Retail', due: '2026-12-07', amount_nok: 49520, status: 'open' },
];
results.add({ tool: 'query', server: 'db', value: invoices });
results.add({ tool: 'get_incident', server: 'ops', value: { id: 'INC-77', title: 'Checkout errors', services: ['checkout', 'payments'], timeline: [{ at: '21:10', event: 'deploy d-17' }, { at: '21:25', event: 'alert firing' }] } });
const png = path.join(dir, 'shot.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
results.attach('customer-screenshot.png', 'image/png', png);

const shown: Shown[] = [];
const vindu = await startVindu(); // no page driver: pages are shown, not checked
const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
const { mcp, call } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });

test('results lists what the task got, by id', async () => {
  const r = await call('results', {});
  assert.equal(r.text.split('\n')[0], 'r1: db.query → 4 rows with fields id, customer, due, amount_nok, status');
  assert.match(r.text, /a1: attachment customer-screenshot.png/);
});

test('a view that points at the results: exact rows, a total computed by the system, an account read from the surface', async () => {
  const r = await call('show_view', { name: 'overdue', title: 'Overdue invoices', panels: [
    { card: 'kpi', title: 'Total overdue (NOK)', from: 'r1', where: { status: 'overdue' }, value: 'sum(amount_nok)' },
    { card: 'table', title: 'Invoices', from: 'r1', where: { status: 'overdue' }, sort: 'amount_nok desc' },
    { card: 'record', title: 'Incident', from: 'r2', fields: ['id', 'title', 'services'] },
    { card: 'timeline', title: 'Timeline', from: 'r2', pick: 'timeline' },
    { card: 'media', title: 'What the customer saw', media: 'a1' },
  ] });
  assert.ok(r.ok, r.text);
  const a = JSON.parse(r.text);
  assert.equal(a.layout, 'one page, 5 panels');
  assert.equal(a.panels[0].shows, '102,190');                       // 31050 + 35740 + 35400, by the system
  assert.equal(a.panels[1].first_row, 'INV-2026-0259 | Strand Bygg | 2026-10-16 | 35,740 | overdue');
  assert.equal(a.panels[1].phone, 'a list: id, with customer, due, amount_nok, status beneath');
  assert.equal(a.panels[2].values, 'INC-77 · Checkout errors · checkout, payments'); // a plain list reads as words
  assert.equal(a.panels[3].first_row, 'deploy d-17 | 21:10');
  assert.equal(a.typed_numbers_not_in_any_result, undefined);
  const v = shown.at(-1)!;
  assert.deepEqual(checkSurface(v.wide), []); assert.deepEqual(checkSurface(v.compact), []);
  // media comes from the process's own page origin over http, the only media URLs an A2UI renderer loads
  const model = (v.wide.find(m => m.updateDataModel) as { updateDataModel: { value: { panels: Record<string, { url?: string }> } } }).updateDataModel.value.panels;
  assert.equal(model.p_what_the_customer_saw.url, `${ui.pages}/media/a1`);
  const img = await get(`${ui.pages}/media/a1`);
  assert.equal(img.status, 200); assert.equal(img.headers['content-type'], 'image/png');
});

test('a total per customer is computed by the system, not typed', async () => {
  const r = await call('show_view', { name: 'per-customer', title: 'Overdue per customer', panels: [
    { card: 'bar-chart', title: 'Overdue (NOK)', from: 'r1', where: { status: 'overdue' }, group: 'customer', value: 'sum(amount_nok)', y: 'amount_nok' },
  ] });
  assert.ok(r.ok, r.text);
  const a = JSON.parse(r.text);
  assert.equal(a.panels[0].shows, 'Vik Data 31050 · Strand Bygg 71140');
  assert.equal(a.typed_numbers_not_in_any_result, undefined);
  assert.match(a.corrections.join(' '), /grouped 3 rows by customer into 2, sum_amount_nok computed for each/);
  assert.match(a.corrections.join(' '), /charted sum_amount_nok \(the computed value\) for y/);
});

test('refusals say what to send instead', async () => {
  const held = await call('show_view', { name: 'x', title: 'x', panels: [{ card: 'record', from: 'r2', fields: ['id', 'timeline'] }] });
  assert.equal(held.ok, false); assert.match(held.text, /"timeline" holds rows or an object, not one value; show it in its own panel with "pick"/);
  const missing = await call('show_view', { name: 'x', title: 'x', panels: [{ card: 'table', from: 'r9' }] });
  assert.match(missing.text, /no result "r9". This task has: r1: db.query/);
  const image = await call('show_view', { name: 'x', title: 'x', panels: [{ card: 'table', from: 'a1' }] });
  assert.match(image.text, /a1 is an attachment \(image\/png\); show it with a media panel/);
});

test('common shapes are read, with a note; a card there is not is refused, with what to send instead', async () => {
  const gauge = await call('show_view', { name: 'diff', title: 'Export vs database', panels: [{ card: 'gauge', title: 'Difference', value: 'count()', rows: [{ a: 1 }] }] });
  assert.equal(gauge.ok, false);
  assert.equal(gauge.text, 'not shown: panel difference: there is no "gauge" card: draw it in a page (ECharts, Chart.js and three.js are pinned), or use the nearest card for what you sent: kpi. The cards: kpi, table, list, record, timeline, bar-chart, line-chart, media, gallery, text, page, code, diff, message, document, events, tasks, money, files, map, contacts, sheet, slides, signature, diagram, devices, batch, changes, decision'); // the blocks too
  const pie = await call('show_view', { name: 'diff', title: 'Shares', panels: [{ card: 'pie-chart', value: 'sum(amount_nok)', group: 'customer', from: 'r1' }] });
  assert.match(pie.text, /there is no "pie-chart" card: for parts of a whole, a bar-chart with the same group and value shows the same numbers/);
  const r = await call('show_view', { name: 'diff', title: 'Export vs database', panels: [
    { card: 'table', title: 'Differences', data: { columns: ['order', 'export_nok', 'db_nok'], rows: [['SO-58295', 34940, 33140]] } },
  ] });
  assert.ok(r.ok, r.text);
  const a = JSON.parse(r.text);
  assert.deepEqual(a.corrections, ['read {columns, rows} as 1 rows']);
  assert.deepEqual(a.typed_numbers_not_in_any_result, [34940, 33140]); // typed, and in no result: listed, not judged
});

test('nothing is done otherwise than asked in silence: every problem at once, what no card reads is ignored and said', async () => {
  const bad = await call('show_view', { name: 'many', title: 'Many', panels: [
    { card: 'kpi', id: 'k', from: 'r1', value: 'sum(amount_nok)', group: 'customer' },
    { card: 'table', id: 't', from: 'r1', sort: 'value desc' },
    { card: 'table', id: 'w', from: 'r1', where: { custmer: 'Havgap Media' } },
  ] });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /^not shown: 3 panels need changes, so nothing was shown: \(1\) panel k: a kpi shows one number, and group makes one row per value of "customer"/);
  assert.match(bad.text, /\(2\) panel t: no field "value" to sort by; fields: /);
  assert.match(bad.text, /\(3\) panel w: no field "custmer" to keep rows by \(where\); fields: /);
  const ok = JSON.parse((await call('show_view', { name: 'many', title: 'Many', colour: 'teal', panels: [
    { card: 'table', id: 't', from: 'r1', value: 'sum(amount_nok)', group: 'customer', sort: 'value desc', x: 'customer' },
    { card: 'kpi', id: 'k', from: 'r1', value: 'median(amount_nok)', where: { amount_nok: '>= 30000' }, limit: 1 },
  ] })).text);
  assert.deepEqual(ok.ignored, ['the view: "colour" is not a field of a view (its fields: name, title, subtitle, panels or tabs, suggestions, after, hooks, steps, place)', 'panel t: "x" does nothing on a table (bar-chart, line-chart read it)', 'panel k: "limit" does nothing on a kpi (table, list, timeline, bar-chart, line-chart read it)']);
  assert.ok(ok.corrections.includes('panel t: sorted by sum_amount_nok, the value computed for each customer'));
  assert.equal(ok.panels[1].steps[0].kept > 0, true);
  assert.match(ok.corrections.find((c: string) => c.startsWith('panel k: kept')), /where amount_nok >= 30000/);
});

test('years, ids and codes are written as they are; amounts are grouped; kpis sit side by side', async () => {
  const r = await call('show_view', { name: 'papers', title: 'Papers', panels: [
    { card: 'kpi', title: 'Papers', data: 2 }, { card: 'kpi', title: 'Citations', data: 1067 },
    { card: 'table', rows: [{ id: 4101, title: 'Dense passages for open questions', year: 2021, citations: 1655 }, { id: 4102, title: 'When retrieval hurts', year: 2023, citations: 133 }] },
  ] });
  assert.ok(r.ok, r.text);
  const a = JSON.parse(r.text);
  assert.equal(a.panels[2].first_row, '4101 | Dense passages for open questions | 2021 | 1,655');
  assert.equal(a.layout, 'one page, 3 panels; 2 kpis side by side (one above another when narrow)');
  const comps = (shown.at(-1)!.wide.find(m => m.updateComponents) as { updateComponents: { components: { id: string; weight?: number }[] } }).updateComponents.components;
  const w = ['hb0', 'hb1', 'hb2', 'hb3'].map(h => comps.find(c => c.id.endsWith(`__${h}`))!.weight); // each head is a button that sorts its column
  assert.deepEqual(w, [4, 27, 4, 6]); // a column's weight follows the length of its text, so the title gets the room
  const cells = ['c0', 'c1', 'c2', 'c3'].map(c => comps.find(x => x.id.endsWith(`__${c}`))!.weight);
  assert.deepEqual(cells, w); // and every row's cells have the same weights, so the columns line up with the head
  assert.equal((comps.find(x => x.id.endsWith('__item')) as unknown as { component: string }).component, 'Row');
});

test('the chart card: the palette in fixed order, one axis with round ticks, a legend for two series, thin rounded bars', async () => {
  const svgOf = (_panel: Record<string, unknown>) => {
    const surface = shown.at(-1)!.wide;
    const model = (surface.find(m => m.updateDataModel) as { updateDataModel: { value: { panels: Record<string, { chart?: string }> } } }).updateDataModel.value.panels;
    return Buffer.from(Object.values(model).find(m => m.chart)!.chart!.split(',')[1], 'base64').toString('utf8');
  };
  await call('show_view', { name: 'c1', title: 'Chart', panels: [{ card: 'bar-chart', rows: [{ m: 'Jan', a: 12000, b: 9000 }, { m: 'Feb', a: 18000, b: 11000 }], x: 'm', y: ['a', 'b'] }] });
  const two = svgOf({});
  assert.match(two, /\.f0\{fill:#2a78d6\}\.l0\{stroke:#2a78d6\}\.f1\{fill:#eb6834\}/); // slots 1 and 2, light
  assert.match(two, /@media \(prefers-color-scheme: dark\)\{[^}]*\}?.*\.f0\{fill:#3987e5\}/); // and their dark steps
  assert.equal((two.match(/<rect class="f\d" x="[\d.]+" y="8" width="10" height="10" rx="2"\/>/g) ?? []).length, 2); // a legend for two series
  assert.match(two, />20K<\/text>/); // ticks compact once the axis reaches 10,000
  const widths = [...two.matchAll(/<path class="f\d" d="M([\d.]+),[\d.]+V[\d.]+Q[\d.]+,[\d.]+ [\d.]+,[\d.]+H[\d.]+Q([\d.]+),/g)].map(m => Number(m[2]) - Number(m[1]));
  assert.ok(widths.length === 4 && widths.every(x => x <= 24), JSON.stringify(widths)); // bars at most 24 wide, with a rounded end (the Q curves)
  await call('show_view', { name: 'c2', title: 'Chart', panels: [{ card: 'bar-chart', rows: [{ m: 'Jan', a: 1200 }, { m: 'Feb', a: 1800 }], x: 'm', y: 'a' }] });
  const one = svgOf({});
  assert.doesNotMatch(one, /y="8" width="10"/); // one series: no legend box
  assert.match(one, />1,800<\/text>/); // the one direct label, on the highest bar; ticks in full below 10,000
});

test('the boundary schema still applies before any of this', async () => {
  const r = await mcp.callTool({ name: 'show_view', arguments: { title: 'no name' } }) as { isError?: boolean; content: { text: string }[] };
  assert.equal(r.isError, true); assert.match(r.content[0].text, /name/);
});

test('without a page driver a page is shown but not checked, and says so', async () => {
  const r = await call('show_view', { name: 'p', title: 'A page', panels: [{ card: 'page', html: '<h1>Hello</h1>' }] });
  assert.ok(r.ok, r.text);
  const a = JSON.parse(r.text);
  assert.equal(a.panels[0].from, 'a page you wrote'); assert.equal(a.panels[0].page, 'not checked: this host has no page driver');
});

test('a host whose browser will not start shows the page all the same, and says why it was not checked', async () => {
  // as Playwright says it on a computer without its Chromium (a Pi 3's core): a first line, then how to install it
  const broken = await startVindu({ driver: { open: async () => { throw new Error("browserType.launch: Executable doesn't exist at /nowhere/headless_shell\n╔═ run npx playwright install ═╗"); } } });
  const u = broken.open({ results, dir });
  const c = await mcpClient(u.url);
  try {
    const r = await c.call('show_view', { name: 'p', title: 'A page', panels: [{ card: 'page', html: '<h1>Hello</h1>' }] });
    assert.ok(r.ok, r.text);
    assert.equal(JSON.parse(r.text).panels[0].page, "not checked: browserType.launch: Executable doesn't exist at /nowhere/headless_shell");
    const k = await c.call('check_page', { html: '<h1>Hello</h1>' });
    assert.ok(k.ok, k.text); assert.match(k.text, /^not checked: browserType\.launch/);
  } finally { await c.mcp.close(); u.close(); await broken.close(); }
});
