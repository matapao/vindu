// Actions inside a view, the same for the person and the model: sort, filter, move a task, put rows in an order, go to
// a slide, undo. They change how a view shows what it shows, never what it shows. The person's change is told to the
// model, and comes first; the model's is marked on the pane with an undo, or only suggested, or not allowed, as the
// person's switch says. In Chromium: a column's head sorts, a task is dragged, a slide is stepped, a mark is undone.
// All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, applyAction, BLOCKS, type Shown, type ShellState } from '../src/index.js';
import { actInViewFor, cardActsFor } from '../src/server/view-schemas.js';
import { chromium, mcpClient, sleep, componentIn, panelsIn, type SurfaceComponent } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const invoices = [
  { number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050, due: '2026-09-14' }, { number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: 19800, due: '2026-10-02' },
  { number: 'INV-2026-0431', customer: 'Havgap Media', amount: 17160, due: '2026-09-30' },
];
const tasks = [
  { id: 't1', title: 'Chase Havgap Media', due: '2026-11-12', priority: 'high' }, { id: 't2', title: 'Book the auditor', due: '2026-11-20', priority: 'low' },
  { id: 't3', title: 'Send the VAT report', due: '2026-11-10', priority: 'high' },
];
const slides = [{ title: 'Overdue', figure: '68 010', points: ['three invoices'] }, { title: 'Next', points: ['chase the largest first'] }];

async function windowWith(arrange?: 'allow' | 'suggest' | 'off') {
  const vindu = await startVindu({ waitMs: 300, ...(arrange ? { modelArrange: arrange } : {}) });
  const dir = tmp('act-'), results = memoryResults(dir);
  results.add({ server: 'accounts', tool: 'list_invoices', value: invoices }); results.add({ server: 'tasks', tool: 'list', value: tasks }); results.add({ server: 'deck', tool: 'get', value: slides });
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { st.s = s; } });
  const c = await mcpClient(ui.url);
  await c.json('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r1', columns: ['number', 'customer', 'amount', 'due'] }] });
  await c.json('show_view', { name: 'todo', title: 'To do', panels: [{ id: 't', card: 'tasks', from: 'r2' }] });
  await c.json('show_view', { name: 'deck', title: 'Deck', panels: [{ id: 's', card: 'slides', from: 'r3' }] });
  const last = (name: string) => shown.filter(v => v.name === name).at(-1)!;
  const rowsOf = (name: string, pid: string) => panelsIn(last(name).wide)[pid].rows;
  const markOf = (name: string) => st.s!.views.find(v => v.name === name)?.mark;
  return { vindu, ui, ...c, shown, st, last, rowsOf, markOf, close: async () => { await c.mcp.close(); ui.close(); await vindu.close(); } };
}

test('a plan or a slide is the action of the card that takes it: offered only where such a card is', () => {
  const args = { panels: [{ id: 'deck', card: 'slides', from: 'r1' }] }; const data = { deck: { rows: [{ title: 'One' }, { title: 'Two' }] } };
  assert.deepEqual(applyAction(args, data, { action: 'slide', to: 1 }, 'Deck'), { args: { panels: [{ id: 'deck', card: 'slides', from: 'r1', at: 1 }] }, panel: 'deck', what: 'went to slide 2 of 2 in Deck', mark: 'Slide 2' });
  assert.deepEqual(applyAction(args, data, { action: 'plan', key: 'One', start: '2026-11-17T09:30:00Z' }, 'Deck'), { refusal: 'Deck is not events: plan moves events in a calendar' });
  assert.match((applyAction(args, data, { action: 'slide', to: 1 }, 'Deck', new Map()) as { refusal: string }).refusal, /^no action "slide"/); // no card here takes it
  const has = { terminals: false, pages: false, run: false };
  assert.deepEqual(actInViewFor(has, []).shape.action.options, ['sort', 'filter', 'clear', 'move', 'order', 'select', 'undo']);
  assert.equal('start' in actInViewFor(has, []).shape, false); assert.doesNotMatch(cardActsFor([]), /slide|plan/);
  assert.deepEqual(actInViewFor(has, BLOCKS).shape.action.options, ['sort', 'filter', 'clear', 'move', 'order', 'slide', 'plan', 'select', 'undo']);
});

test("the person's changes inside a view: a column's head sorts, a task moves, a slide; told to the model, and theirs to undo", async () => {
  const w = await windowWith();
  try {
    const head = componentIn<SurfaceComponent & { action: { event: { name: string; context: Record<string, unknown> } } }>(w.last('inv').wide, x => x.id === 'p_rows__hb2');
    assert.deepEqual(head.action.event, { name: 'view_action', context: { action: 'sort', panel: 'rows', field: 'amount' } });
    const n = w.shown.length;
    assert.equal(w.ui.event({ type: 'action', view: 'inv', name: 'view_action', context: head.action.event.context, by: { name: 'Kari', window: 'main' } }), true);
    await until(() => w.shown.length > n && w.rowsOf('inv', 'p_rows')[0].c2 === '17,160');
    assert.deepEqual(w.rowsOf('inv', 'p_rows').map(r => r.c0), ['INV-2026-0431', 'INV-2026-0418', 'INV-2026-0412']);
    assert.equal(componentIn(w.last('inv').wide, x => x.id === 'p_rows__h2').text, 'amount ↑');
    assert.deepEqual(w.markOf('inv'), { text: 'Sorted by amount, smallest or earliest first', by: 'person', undo: true });
    w.ui.event({ type: 'action', view: 'inv', name: 'view_action', context: head.action.event.context }); // again: the other way round
    await until(() => w.rowsOf('inv', 'p_rows')[0].c2 === '31,050' && w.markOf('inv')?.text === 'Sorted by amount, largest or latest first'); await sleep(30);
    assert.match(w.ui.delta(), /Kari \(main\) sorted Invoices by amount, smallest or earliest first[\s\S]*the person sorted Invoices by amount, largest or latest first/);

    const m = w.shown.length; // a task dragged from third to first
    assert.equal(w.ui.event({ type: 'view', view: 'todo', action: 'move', panel: 't', from: 2, to: 0 }), true);
    await until(() => w.shown.length > m && w.markOf('todo')?.text === 'Order set by hand, not saved');
    const look = await w.json('look', {});
    assert.ok(JSON.stringify(look).length > 0);
    const r = await w.call('act_in_view', { view: 'todo', action: 'move', key: 't2', to: 0 }); // the person's change is told first
    assert.equal(r.ok, false); assert.match(r.text, /the person changed "todo" since you were last told \(the person moved Send the VAT report to place 1 of 3 in To do/);
    const ok = await w.json('act_in_view', { view: 'todo', action: 'move', key: 't2', to: 0 }); // told now: it goes ahead
    assert.match(ok.did, /moved Book the auditor to place 1 of 3 in To do \(an order set by hand, not saved\)/);
    assert.equal(ok.view.panels[0].order, 'set by hand in the window, not saved: an operation that saves it asks the person');
    assert.deepEqual(w.markOf('todo'), { text: 'Order set by hand, not saved', by: 'model', undo: true });
    const undo = await w.json('act_in_view', { view: 'todo', action: 'undo' });
    assert.match(undo.did, /undid "moved Book the auditor/);
    const mine = await w.call('act_in_view', { view: 'todo', action: 'undo' }); // the one before is the person's
    assert.equal(mine.ok, false); assert.match(mine.text, /is the person's \(moved Send the VAT report to place 1 of 3 in To do .*\): only they undo it/);
    assert.equal(w.ui.event({ type: 'view', view: 'todo', action: 'undo' }), true);
    await until(() => w.markOf('todo') === undefined);

    assert.equal(w.ui.event({ type: 'view', view: 'deck', action: 'slide', panel: 's', to: 1 }), true);
    await until(() => w.markOf('deck')?.text === 'Slide 2');
    const deck = componentIn(w.last('deck').wide, x => x.component === 'VSlides');
    assert.equal(deck.at, 1); // every window shows the same slide

    const none = await w.call('act_in_view', { view: 'inv', action: 'filter', field: 'customer', value: 'Nobody AS' });
    assert.match(none.text, /no row of Invoices has customer "Nobody AS"; its values: Havgap Media, Brattli Verksted/);
    const f = await w.json('act_in_view', { view: 'inv', action: 'filter', field: 'customer', value: 'Havgap Media' });
    assert.match(f.did, /showed only the rows of Invoices where customer is "Havgap Media"/);
    assert.equal(w.rowsOf('inv', 'p_rows').length, 2);
    await w.json('act_in_view', { view: 'inv', action: 'clear', field: 'customer' });
    assert.equal(w.rowsOf('inv', 'p_rows').length, 3); // the rows are still exactly the result's
    await w.json('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r1' }] }); // shown anew: its changes go with the old one
    assert.equal(w.markOf('inv'), undefined);
  } finally { await w.close(); }
});

test('in a view of tabs, an action reaches a panel in any tab, by the id show_view gave it; a second filter that keeps nothing is refused', async () => {
  const w = await windowWith();
  try {
    await w.json('show_view', { name: 'books', title: 'Books', tabs: [{ title: 'Open', panels: [{ card: 'kpi', title: 'Count', from: 'r1', value: 'count()' }] },
      { title: 'All', panels: [{ title: 'All invoices', card: 'table', from: 'r1', columns: ['number', 'amount'] }] }] });
    const sorted = await w.json('act_in_view', { view: 'books', action: 'sort', panel: 'all-invoices', field: 'amount', dir: 'asc' });
    assert.match(sorted.did, /sorted Books \(all-invoices\) by amount, smallest or earliest first/);
    assert.deepEqual(w.rowsOf('books', 'p_all_invoices').map(r => r.c0), ['INV-2026-0431', 'INV-2026-0418', 'INV-2026-0412']);
    assert.match((await w.json('act_in_view', { view: 'books', action: 'filter', panel: 'all-invoices', field: 'customer', value: 'Havgap Media' })).did, /showed only the rows/);
    const none = await w.call('act_in_view', { view: 'books', action: 'filter', panel: 'all-invoices', field: 'number', value: 'INV-2026-0418' });
    assert.equal(none.ok, false); assert.match(none.text, /no row of Books \(all-invoices\) has number "INV-2026-0418"; its values: INV-2026-0431, INV-2026-0412/);
    assert.equal(w.rowsOf('books', 'p_all_invoices').length, 2); // as it was
    const other = await w.call('act_in_view', { view: 'books', action: 'sort', panel: 'nope', field: 'amount' });
    assert.match(other.text, /"Books" has no panel "nope"; its panels: count, all-invoices/);
  } finally { await w.close(); }
});

test("the person's switch: the model's change only suggested, taken or not; or not allowed at all", async () => {
  const w = await windowWith('suggest');
  try {
    const s = await w.call('act_in_view', { view: 'inv', action: 'sort', field: 'due' });
    assert.equal(s.ok, true); assert.match(s.text, /suggested to the person, who takes it or not: sorted Invoices by due/);
    assert.deepEqual(w.markOf('inv'), { text: 'Sorted by due, smallest or earliest first', by: 'model', suggestion: true });
    assert.equal(w.rowsOf('inv', 'p_rows')[0].c0, 'INV-2026-0412'); // nothing moved yet
    assert.equal(w.ui.event({ type: 'view', view: 'inv', action: 'take' }), true);
    await until(() => w.markOf('inv')?.undo === true); await sleep(30);
    assert.deepEqual(w.rowsOf('inv', 'p_rows').map(r => r.c0), ['INV-2026-0412', 'INV-2026-0431', 'INV-2026-0418']);
    assert.match(w.ui.delta(), /the person took your suggestion in "inv": sorted Invoices by due/);
    assert.match((await w.call('act_in_view', { view: 'todo', action: 'order', keys: ['t3', 't1', 't2'] })).text, /suggested to the person/);
    assert.equal(w.ui.event({ type: 'view', view: 'todo', action: 'dismiss' }), true);
    assert.match(w.ui.delta(), /the person did not take your suggestion in "todo"/);
  } finally { await w.close(); }
  const off = await windowWith('off');
  try {
    const r = await off.call('act_in_view', { view: 'inv', action: 'sort', field: 'due' });
    assert.equal(r.ok, false); assert.match(r.text, /the person changes how views show themselves in this window/);
  } finally { await off.close(); }
});

test('in Chromium: a column head sorts, a task is dragged and moved with Alt and an arrow, a slide is stepped, a mark is undone', async () => {
  const w = await windowWith();
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
    const draw = async () => {
      const latest = new Map<string, Shown>(); for (const v of w.shown) if (!v.ask) latest.set(v.name, v);
      for (const v of latest.values()) await page.evaluate((x: Shown) => window.app.view(x), v);
      await page.evaluate((s: ShellState) => window.app.state(s), w.st.s!);
      await page.waitForTimeout(400);
    };
    await draw();
    await page.evaluate(() => window.app.events());
    const events = async () => page.evaluate(() => window.app.events());
    // the head of "amount" is a button: a plain click sorts
    await page.locator('.vindu-pane[data-view="inv"]').getByRole('button', { name: 'amount' }).click();
    const sort = (await events()).find(e => e.type === 'action' && e.name === 'view_action');
    assert.deepEqual(sort, { type: 'action', view: 'inv', name: 'view_action', context: { action: 'sort', panel: 'rows', field: 'amount' } });
    // a task dragged onto the first
    const rows = page.locator('.vindu-pane[data-view="todo"] .vb-task');
    await rows.nth(2).dragTo(rows.nth(0));
    const moved = (await events()).find(e => e.type === 'view');
    assert.deepEqual(moved, { type: 'view', action: 'move', panel: 't', from: 2, to: 0, view: 'todo' });
    await rows.nth(1).focus(); await page.keyboard.press('Alt+ArrowUp');
    assert.deepEqual((await events()).find(e => e.type === 'view'), { type: 'view', action: 'move', panel: 't', from: 1, to: 0, view: 'todo' });
    // the next slide
    await page.locator('.vindu-pane[data-view="deck"] .vb-nav button').last().click();
    assert.deepEqual((await events()).find(e => e.type === 'view'), { type: 'view', action: 'slide', panel: 's', to: 1, view: 'deck' });
    // the server does them, and the window shows its mark, with an undo
    w.ui.event(sort); w.ui.event(moved);
    await until(() => w.markOf('todo') !== undefined && w.markOf('inv') !== undefined);
    await draw();
    assert.equal(await page.locator('.vindu-pane[data-view="todo"] .vindu-pane-mark').textContent(), 'Order set by hand, not savedUndo');
    assert.deepEqual(await rows.evaluateAll((es: Element[]) => es.map(e => e.textContent.slice(1, 14))), ['Send the VAT ', 'Chase Havgap ', 'Book the audi']);
    await page.locator('.vindu-pane[data-view="todo"] .vindu-pane-mark button').click();
    assert.deepEqual((await events()).find(e => e.type === 'view'), { type: 'view', view: 'todo', action: 'undo' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); await w.close(); }
});
