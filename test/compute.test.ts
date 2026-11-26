// Arithmetic by the system: what a view computes is as exact as what it reads, and the account says how each value
// came about. Per row (hours * rate), over rows (sum(hours * rate), sum(amount) - sum(paid)), with inputs the person
// changes in the window (what-ifs), and in pages (task.compute), never counted as numbers the model typed.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { BrowserType } from 'playwright';
import { startVindu, memoryResults, type Shown } from '../src/index.js';
import { parse, rowValue, setValue, addFields, computedName, round } from '../src/compute.js';
import { playwrightDriver } from '../src/drivers/playwright.js';
import { mcpClient, sleep, answerOf, componentIn, componentsIn, panelsIn, type SurfaceComponent } from './helpers.js';

const chromium: BrowserType = createRequire(import.meta.url)('playwright').chromium;
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const hours = [ // synthetic: a freelancer's hours this month
  { client: 'Havgap Media', hours: 32.5, rate: 950 }, { client: 'Brattli Verksted', hours: 12, rate: 1100 },
  { client: 'Lysvik Retail', hours: 7.25, rate: 950 }, { client: 'Kobberdal Bygg', hours: null, rate: 1100 },
];
const browser = await chromium.launch();
const vindu = await startVindu({ driver: playwrightDriver(browser), waitMs: 400 });
afterAll(async () => { await browser.close(); await vindu.close(); });

test('expressions: per row, over rows, inputs; empty where a value is missing; float noise gone; half away from zero', () => {
  const row = hours[0];
  assert.equal(rowValue(parse('hours * rate'), row), 30875);
  assert.equal(rowValue(parse('round(hours * rate * 1.25, 2)'), row), 38593.75);
  assert.equal(rowValue(parse('hours * rate'), hours[3]), null);                     // no hours: empty, not 0
  assert.equal(rowValue(parse('rate / (hours - hours)'), row), null);                // a division by zero: empty
  assert.equal(setValue(parse('sum(hours * rate)'), hours), 30875 + 13200 + 6887.5); // the empty row is skipped
  assert.equal(setValue(parse('count()'), hours), 4);
  assert.equal(setValue(parse('count(hours)'), hours), 3);
  assert.equal(setValue(parse('sum(hours * rate) * (1 + $vat)'), hours, { vat: 0.25 }), 63703.125);
  assert.equal(setValue(parse('max(hours) - min(hours)'), hours), 25.25);
  assert.equal(rowValue(parse('0.1 + 0.2'), {}), 0.3);
  assert.deepEqual([round(1.005, 2), round(2.5), round(-2.5), round(1234567890.125, 2)], [1.01, 3, -3, 1234567890.13]);
  assert.equal(rowValue(parse('"unit price" * qty'), { 'unit price': 12.5, qty: 3 }), 37.5);
  assert.equal(computedName('sum(hours * rate)'), 'sum_hours_rate'); assert.equal(computedName('sum(amount_nok)'), 'sum_amount_nok'); assert.equal(computedName('count()'), 'count');
  assert.deepEqual(addFields(hours, { amount: 'hours * rate' }).empty, { amount: 1 });
  assert.throws(() => setValue(parse('hours * 2'), hours), /"hours" is a field of each row: over rows, say how to combine it, e.g. sum\(hours\)/);
  assert.throws(() => rowValue(parse('sum(hours)'), row), /over rows/);
  assert.throws(() => parse('sqrt(hours)'), /no function sqrt/);
  assert.throws(() => parse('hours rate'), /something is left over/);
  assert.throws(() => setValue(parse('sum(hours) * $growth'), hours), /no input \$growth/);
  assert.throws(() => parse('process.exit()'), /no function process\.exit|left over|not something/); // never code
});

test('what cannot be computed is refused at once: too deep, too long, a function without its values; no -0; min and max of many rows', () => {
  assert.throws(() => parse(`${'('.repeat(100)}1${')'.repeat(100)}`), /more than 64 levels deep/);
  assert.throws(() => parse(`${'-'.repeat(100)}1`), /more than 64 levels deep/);
  assert.throws(() => parse(`1${' + 1'.repeat(600)}`), /at most 2000 characters/);
  assert.throws(() => parse('round()'), /round\(x, n\) takes a value/);
  assert.throws(() => parse('sum()'), /sum\(…\) takes one value/);
  assert.throws(() => parse('count(hours, rate)'), /count\(\) takes no value, or one/);
  assert.throws(() => setValue({ k: 'call', fn: 'round', args: [] }, hours), /round\(x, n\) takes a value/); // made by hand, not parsed
  assert.throws(() => setValue({ k: 'call', fn: 'sum', args: [] }, hours), /sum\(…\) takes one value/);
  assert.ok(Object.is(round(-0.001, 2), 0)); assert.ok(Object.is(rowValue(parse('-x'), { x: 0 }), 0)); assert.ok(Object.is(rowValue(parse('ceil(-0.5)'), {}), 0));
  const many = Array.from({ length: 300_000 }, (_, i) => ({ x: i - 7 })); // more than a call's arguments can hold
  assert.equal(setValue(parse('min(x)'), many), -7); assert.equal(setValue(parse('max(x)'), many), 299_992);
  assert.equal(rowValue(parse('max(1, x, 3)'), { x: 9 }), 9);
});

function session() {
  const dir = tmp('task-'), shown: Shown[] = [];
  const results = memoryResults(dir);
  results.add({ server: 'timesheet', tool: 'hours_this_month', input: { month: '2026-11' }, value: hours });
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
  return { ui, shown };
}

test('a view computes per row and over rows; the account says each computed value is the system\'s, with no typed numbers', async () => {
  const w = session(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    const a = await json('show_view', { name: 'invoicing', title: 'To invoice', panels: [
      { id: 'total', card: 'kpi', title: 'To invoice (NOK)', from: 'r1', value: 'sum(hours * rate)' },
      { id: 'lines', card: 'table', from: 'r1', compute: { amount: 'hours * rate' }, columns: ['client', 'hours', 'rate', 'amount'], sort: 'amount desc' },
    ] });
    const [total, lines] = a.panels;
    assert.equal(total.shows, '50,962.5');
    assert.deepEqual(lines.steps[0], { compute: { amount: 'hours * rate' }, rows: 4, empty: { amount: 1 } });
    assert.equal(lines.first_row, 'Havgap Media | 32.5 | 950 | 30,875');
    assert.equal(lines.first_refs.amount, 'computed by the system: hours * rate');
    assert.equal(lines.first_refs.client, 'ctx:r1#/0/client');
    assert.equal(a.typed_numbers_not_in_any_result, undefined);
    assert.match(a.corrections.join(' '), /amount is empty in 1 of 4 rows/);
  } finally { await mcp.close(); w.ui.close(); }
});

test('what-ifs: the person changes an input in the window; the system computes again, keeps it as theirs, tells the model; a new value from the model wins', async () => {
  const w = session(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    const spec = { name: 'next-year', title: 'Next year', panels: [{ id: 'total', card: 'kpi', title: 'Next year (NOK)', from: 'r1', value: 'sum(hours * rate) * (1 + $growth)', inputs: { growth: { value: 0.04, label: 'Growth' } } }] };
    const a = await json('show_view', spec);
    assert.equal(a.panels[0].shows, '53,001'); assert.deepEqual(a.panels[0].inputs, { growth: 0.04 });
    const first = w.shown.at(-1)!;
    type Control = SurfaceComponent & { label?: string; action?: { event?: { name?: string; context?: unknown } } };
    const comps = componentsIn<Control>(first.wide);
    assert.ok(comps.some(c => c.component === 'TextField' && c.label === 'Growth'));
    assert.deepEqual(componentIn<Control>(first.wide, c => c.component === 'Button' && c.action?.event?.name === 'set_inputs').action?.event?.context, { panel: 'total', 'in:growth': { path: '/panels/p_total/inputs/growth' } });
    // the person types 0,1 (a comma, as many locales write it) and presses Recompute
    assert.equal(w.ui.event({ type: 'action', view: 'next-year', name: 'set_inputs', context: { panel: 'total', 'in:growth': '0,1' } }), true);
    await until(() => w.shown.length > 1);
    const model = panelsIn<{ value: string; inputs: Record<string, string> }>(w.shown.at(-1)!.wide).p_total;
    assert.equal(model.value, '56,058.75'); assert.equal(model.inputs.growth, '0.1');
    await until(() => w.ui.answers().length === 1);
    assert.deepEqual(answerOf(w.ui.answers()[0])?.values, { growth: 0.1 });
    assert.match(w.ui.delta(), /set growth to 0\.1 in Next year \(total\); it shows 56,058\.75 now/);
    assert.equal(w.ui.event({ type: 'action', view: 'next-year', name: 'set_inputs', context: { panel: 'nope', 'in:growth': '1' } }), false); // no such panel
    assert.equal(w.ui.event({ type: 'action', view: 'next-year', name: 'set_inputs', context: { panel: 'total', 'in:other': '1' } }), false); // no such input
    const again = await json('show_view', spec); // the model shows it again with the same value: the person's stays
    assert.deepEqual(again.panels[0].inputs, { growth: 0.1 });
    const theirs = await json('show_view', { ...spec, panels: [{ ...spec.panels[0], inputs: { growth: 0.06 } }] }); // a new value of the model's own wins
    assert.deepEqual(theirs.panels[0].inputs, { growth: 0.06 });
  } finally { await mcp.close(); w.ui.close(); }
});

test('a page computes with task.compute and task.value: its numbers count as computed, not typed', async () => {
  const w = session(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    const html = `<!doctype html><meta charset="utf-8"><body><p id="t"></p><ul id="l"></ul><script type="module">
const rows = task.compute(task.data.r1, { amount: 'hours * rate' });
document.getElementById('t').textContent = 'Total ' + task.value(rows, 'round(sum(amount) * (1 + $vat), 2)', { vat: 0.25 }).toFixed(2) + ' NOK';
document.getElementById('l').innerHTML = rows.filter(r => r.amount !== null).map(r => '<li>' + r.client + ': ' + r.amount + '</li>').join('');
</script>`;
    const a = await json('show_view', { name: 'page', title: 'Page', panels: [{ card: 'page', html, uses: ['r1'] }] });
    const report = a.panels[0].page;
    assert.deepEqual(report.errors ?? [], []);
    assert.match(report.text.starts, /Total 63703\.13 NOK/);
    assert.equal(report.numbers_not_in_any_result, undefined); // 30875, 13200, 6887.5 and 63703.13 were computed by the system
  } finally { await mcp.close(); w.ui.close(); }
});
