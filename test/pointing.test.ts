// Pointing at things: what the person marks becomes exact context (references and values from what the system
// resolved), never a picture. A bar stands for the rows behind it; opening it shows them in the same pane, exactly; a
// pane can go "in the chat"; suggestions and a page's proposed follow-up go to the prompt box, unsent. In Chromium,
// Alt-click and Alt-drag mark what the window drew, by its own marks. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { resolvePoint, type PointItem } from '../src/pointing.js';
import { chromium, mcpClient, sleep, answerOf, componentIn, eventsOf, panelsIn, type SurfaceComponent } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const invoices = [
  { number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050 }, { number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: 19800 },
  { number: 'INV-2026-0431', customer: 'Havgap Media', amount: 17160 }, { number: 'INV-2026-0455', customer: 'Lysvik Retail', amount: 12650 },
];
const vindu = await startVindu({ waitMs: 300 });
const suggested: string[] = [];
const dir = tmp('point-'), results = memoryResults(dir); results.add({ server: 'accounts', tool: 'list_invoices', value: invoices });
const shown: Shown[] = []; let state: ShellState | undefined;
const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { state = s; }, onSuggest: p => suggested.push(p) });
const { mcp, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });

test('browser pointing includes only element metadata and honors the sharing and secret-field notices', () => {
  const point = {
    view: 'browser', role: 'textbox', name: 'Password', secret: true, text: 'private value',
    page: { unexpected: 'private context' }, start: 0, end: 7,
  };
  const context = { kind: 'browser' };
  const element = { view: 'browser', kind: 'browser', role: 'textbox', name: 'Password', secret: true };
  assert.deepEqual(resolvePoint({ ...point, shared: false }, context), {
    ...element, note: 'the person has not shared this page with you: you cannot read or act on it; this is what they pointed at',
  });
  assert.deepEqual(resolvePoint({ ...point, shared: true }, context), {
    ...element, note: 'a secret field: the person fills it in themselves',
  });
  assert.equal(resolvePoint({ view: 'browser', text: 'unmarked' }, context), null);
});

test('what the person points at: a bar is the rows behind it; a row is its reference and values; it goes with the next message, kept as theirs', async () => {
  await json('show_view', { name: 'overdue', title: 'Overdue', panels: [{ id: 'by-customer', card: 'bar-chart', from: 'r1', group: 'customer', value: 'sum(amount)' }],
    suggestions: [{ label: 'Who to remind first', prompt: 'Which customer should I remind first, and why?' }] });
  await json('show_view', { name: 'invoices', title: 'Invoices', panels: [{ id: 'list', card: 'table', from: 'r1', columns: ['number', 'customer', 'amount'] }] });
  assert.equal(ui.event({ type: 'select', by: 'drag', items: [{ view: 'overdue', panel: 'by-customer', row: 0 }, { view: 'invoices', pid: 'p_list', row: 1 }, { view: 'nope', row: 1 }] }), true);
  const sel = ui.selection();
  assert.equal(sel.length, 2); // a view that is not there is left out
  assert.deepEqual(sel[0], { view: 'overdue', panel: 'by-customer', card: 'bar-chart', group: { customer: 'Havgap Media' }, row: { customer: 'Havgap Media', sum_amount: 48210 }, rows_behind: ['ctx:r1#/0', 'ctx:r1#/2'], computed: 'by the system: sum(amount) of these rows' });
  assert.deepEqual(sel[1], { view: 'invoices', panel: 'list', card: 'table', row: { ref: 'ctx:r1#/1', number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: 19800 } });
  assert.deepEqual(state!.pointing!.picked.length, 2); // every window marks the same
  ui.event({ type: 'attach', view: 'invoices', on: true });
  const c = ui.context();
  assert.match(c.text, /^\[the window: \{"pointed_at":"p\d+","items":\[/); assert.match(c.text, /"in_the_chat":\[\{"view":"invoices"/);
  const items = answerOf(ui.answers().find(a => a.id === c.id))?.values?.items;
  assert.ok(Array.isArray(items)); assert.deepEqual(items.length, 2);
  assert.deepEqual(ui.selection(), []); // taken with the message; the pane stays in the chat
  assert.match(ui.context().text, /"in_the_chat"/); assert.doesNotMatch(ui.context().text, /pointed_at/);
  ui.event({ type: 'attach', view: 'invoices', on: false });
  assert.equal(ui.context().text, '');
});

test('opening a bar shows the rows behind it in the same pane, exactly; back returns; the model is told', async () => {
  assert.equal(ui.event({ type: 'drill', view: 'overdue', panel: 'by-customer', row: 0 }), true);
  await until(() => JSON.stringify(shown.filter(v => v.name === 'overdue').at(-1)!.wide).includes('Havgap Media › ') === false && shown.filter(v => v.name === 'overdue').length > 1);
  const last = shown.filter(v => v.name === 'overdue').at(-1)!;
  assert.equal(componentIn(last.wide, x => x.id === 'path_text').text, 'Overdue › Havgap Media');
  const rows = panelsIn(last.wide);
  assert.equal(Object.values(rows)[0] && Object.values(rows)[0].rows.length, 2); // INV-2026-0412 and -0431
  assert.match(ui.delta(), /opened Havgap Media in Overdue \(by-customer\): the 2 rows behind it/);
  const n = shown.length;
  assert.equal(ui.event({ type: 'action', view: 'overdue', name: 'drill_back', context: { depth: 1 } }), true);
  await until(() => shown.length > n);
  assert.equal(JSON.stringify(shown.at(-1)!.wide).includes('path_text'), false);
  assert.equal(ui.event({ type: 'drill', view: 'invoices', panel: 'list', row: 0 }), true); // not grouped: nothing to open
});

test('suggestions go to the prompt box, unsent; a page proposes and reports through its bridge', async () => {
  const s = shown.filter(v => v.name === 'overdue').at(-1)!;
  const btn = componentIn<SurfaceComponent & { action: { event: { context: Record<string, unknown> } } }>(s.wide, x => x.id === 'suggest_0');
  assert.deepEqual(btn.action.event.context, { n: 0, label: 'Who to remind first', prompt: 'Which customer should I remind first, and why?' });
  assert.equal(ui.event({ type: 'action', view: 'overdue', name: 'suggest', context: btn.action.event.context }), true);
  assert.deepEqual(suggested, ['Which customer should I remind first, and why?']);
  assert.equal(ui.event({ type: 'action', view: 'overdue', name: 'suggest', context: { prompt: 'something the view never offered' } }), false);
  await json('show_view', { name: 'model3d', title: 'Model', panels: [{ id: 'scene', card: 'page', html: '<!doctype html><p>3D</p>' }] });
  ui.event({ type: 'page', kind: 'select', view: 'model3d', panel: 'scene', items: [{ part: 'rear axle', ref: 'ctx:r1#/0' }], note: 'clicked in the scene' });
  assert.deepEqual(ui.selection().at(-1), { view: 'model3d', panel: 'scene', card: 'page', page: [{ part: 'rear axle', ref: 'ctx:r1#/0' }], note: 'clicked in the scene', seen: 'as the page reported it' });
  ui.event({ type: 'page', kind: 'ask', view: 'model3d', panel: 'scene', prompt: 'Show the parts of the rear axle' });
  assert.equal(suggested.at(-1), 'Show the parts of the rear axle');
  ui.event({ type: 'select', items: [] });
});

test('in Chromium: Alt-click marks a row, Alt-drag marks bars, a plain click opens a bar, and a pane goes in the chat', async () => {
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => window.app.shell('light'));
    const latest = new Map<string, Shown>(); for (const v of shown) if (!v.ask) latest.set(v.name, v);
    for (const v of latest.values()) await page.evaluate((x: Shown) => window.app.view(x), v);
    await page.evaluate((s: ShellState) => window.app.state(s), state!);
    await page.waitForTimeout(900);
    const center = (sel: string) => page.evaluate((q: string) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);
    const rowOf = () => page.evaluate(() => { const all = [...document.querySelectorAll<Element & { context?: { dataContext?: { path?: string } } }>('.vindu-pane[data-view="invoices"] *')]; const e = all.find(x => x.context?.dataContext?.path === '/panels/p_list/rows/1'); if (!e) throw new Error('no element is bound to row 1'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.evaluate(() => window.app.events()); // drop what drawing reported
    const row = await rowOf();
    await page.keyboard.down('Alt'); await page.mouse.click(row.x, row.y); await page.keyboard.up('Alt');
    let ev = await page.evaluate(() => window.app.events());
    assert.deepEqual(ev.find(e => e.type === 'select'), { type: 'select', by: 'click', items: [{ view: 'invoices', pid: 'p_list', row: 1 }] });
    const s0 = await center('.vindu-pane[data-view="overdue"] .vb-strip[data-row="0"]'), s2 = await center('.vindu-pane[data-view="overdue"] .vb-strip[data-row="2"]');
    assert.ok(s0 && s2);
    await page.keyboard.down('Alt'); await page.mouse.move(s0.x - s0.w / 2 + 3, s0.y - 40); await page.mouse.down(); await page.mouse.move(s0.x + 20, s0.y, { steps: 4 }); await page.mouse.move(s2.x - s2.w / 2 - 3, s2.y + 40, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Alt');
    ev = await page.evaluate(() => window.app.events());
    const drag = eventsOf(ev, 'select').at(-1);
    assert.ok(drag);
    assert.equal(drag.by, 'drag'); assert.deepEqual((drag.items as PointItem[]).filter(i => i.view === 'overdue').map(i => i.row).sort((a, b) => Number(a) - Number(b)), [0, 1]);
    await page.mouse.click(s2.x, s2.y);
    ev = await page.evaluate(() => window.app.events());
    assert.deepEqual(ev.find(e => e.type === 'drill'), { type: 'drill', view: 'overdue', panel: 'by-customer', row: 2 });
    const chat = await center('.vindu-pane[data-view="invoices"] .vindu-chat');
    await page.mouse.click(chat!.x, chat!.y);
    ev = await page.evaluate(() => window.app.events());
    assert.deepEqual(ev.find(e => e.type === 'attach'), { type: 'attach', view: 'invoices', on: true });
    // the server's state marks what is picked, in every window
    ui.event({ type: 'select', items: [{ view: 'overdue', panel: 'by-customer', row: 1 }] });
    await page.evaluate((s: ShellState) => window.app.state(s), state!);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.vindu-pane[data-view="overdue"] .vb-strip.vb-picked').length), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
