// Vindu's blocks over real MCP, then drawn in Chromium: each takes exact rows, finds its roles by their usual names (or
// the model's map), computes what it works out itself (an invoice's total and whether the document agrees, free time,
// tracked changes, where places and nodes go, a batch's outcomes), says so in its account, and draws every row with a
// reference the window can point at. All data is synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, wordDiff, freeSlots, layered, MESSAGE, MONEY_BLOCK, type Shaped, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('blocks-');
const results = memoryResults(dir);
const add = (tool: string, value: unknown, input: unknown = {}) => results.add({ server: 'synthetic', tool, input, value }).id;
const R = {
  inbox: add('search_mail', [
    { from: 'ingrid@havgap.example', subject: 'Re: INV-2026-0412', time: '2026-11-10T09:12:00Z', state: 'unread', body: 'We will pay after our board meeting.' },
    { from: 'kari@nordlys.example', subject: 'Reminder: INV-2026-0412', time: '2026-11-09T14:40:00Z', state: 'read', body: '<p>Following up on the <b>September</b> invoice.</p>' },
  ]),
  v1: add('read_contract', [{ id: '4.1', heading: 'Guardrail ends', text: 'Ends shall be ramped down over 12 m.' }, { id: '4.2', heading: 'Inspection', text: 'The contractor inspects weekly.' }, { id: '4.3', heading: 'Old', text: 'A clause that goes.' }], { version: 1 }),
  v2: add('read_contract', [{ id: '4.1', heading: 'Guardrail ends', text: 'Ends shall be ramped down over 16 m and anchored.' }, { id: '4.2', heading: 'Inspection', text: 'The contractor inspects weekly.' }, { id: '4.4', heading: 'Deviations', text: 'Deviations are reported within 3 days.' }], { version: 2 }),
  events: add('list_events', [
    { title: 'Theatre 2: hip replacement', start: '2026-11-16T09:00:00Z', end: '2026-11-16T10:00:00Z', location: 'Theatre 2' },
    { title: 'Theatre 2: knee', start: '2026-11-16T10:15:00Z', end: '2026-11-16T11:00:00Z', location: 'Theatre 2' },
    { title: 'Theatre 3: emergency', start: '2026-11-16T12:00:00Z', end: '2026-11-16T13:30:00Z', location: 'Theatre 3' },
  ]),
  tasks: add('list_tasks', [{ title: 'Stop batch 2026-311', status: 'done', assignee: 'Line lead' }, { title: 'Find the cause', status: 'doing', assignee: 'Quality', due: '2026-11-13' }, { title: '8D report', status: 'todo', assignee: 'Quality' }]),
  invoice: add('get_invoice', { number: 'INV-2026-0520', customer: 'Havgap Media', date: '2026-11-11', due: '2026-12-11', currency: 'NOK', total: 37475, lines: [{ description: 'Design work', hours: 32.5, rate: 950 }, { description: 'Workshop', hours: 6, rate: 1100 }] }),
  wrong: add('get_invoice', { number: 'INV-2026-0521', customer: 'Lysvik Retail', currency: 'NOK', total: 38000, lines: [{ description: 'Design work', hours: 32.5, rate: 950 }, { description: 'Workshop', hours: 6, rate: 1100 }] }),
  files: add('list_files', [{ name: 'contract-v2.pdf', mime: 'application/pdf', size: 248_312, modified: '2026-11-10T08:00:00Z', owner: 'Legal' }, { name: 'site-photos.zip', mime: 'application/zip', size: 18_874_368, modified: '2026-11-09T15:30:00Z' }]),
  places: add('fleet_now', [{ name: 'Truck 7 (broken)', lat: 59.9139, lon: 10.7522, status: 'stopped' }, { name: 'Truck 3', lat: 59.95, lon: 10.8, status: 'driving' }, { name: 'Drammen depot', lat: 59.7439, lon: 10.2045, status: 'depot' }]),
  contacts: add('directory', [{ name: 'Ingrid Havgap', title: 'CFO', company: 'Havgap Media', email: 'ingrid@havgap.example', phone: '+47 400 00 000' }]),
  sends: ['k1', 'k2', 'k3', 'k4', 'k5'].map((to, i) => add('send_reply', i === 2 ? { status: 'failed', error: 'mailbox full' } : { status: 'sent', id: `m${i}` }, { to: `${to}@kunde.example` })),
  changes: add('propose_refunds', [{ order: 'O-1001', before: { status: 'late', refund: 0 }, after: { status: 'refunded', refund: 149 } }, { order: 'O-1002', before: { status: 'late', refund: 0 }, after: { status: 'late', refund: 0 } }]),
  links: add('accounts_graph', [{ from: 'ACC-1', to: 'ACC-2', label: '9 500' }, { from: 'ACC-2', to: 'ACC-3', label: '9 400' }, { from: 'ACC-1', to: 'ACC-4', label: '200' }]),
  budget: add('actuals', [{ dept: 'Sales', actual: 1_200_000 }, { dept: 'Ops', actual: 800_000 }]),
  dropped: add('propose_changes', [{ key: 'C-7', before: { status: 'open', note: 'call back' }, after: { status: 'open' } }]),
  typo: add('list_events', [{ title: 'Board meeting', start: '2026-03-02T09:00:00Z' }, { title: 'Typed on no day', start: '2026-02-30T10:00:00Z' }]),
};
const vindu = await startVindu({ waitMs: 400, timeZone: 'UTC' });
const shown: Shown[] = []; let state: ShellState | undefined;
const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { state = s; } });
const { mcp, json, call } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });
const panel = (a: any, id: string) => a.panels.find((p: any) => p.id === id);

test('the system\'s own arithmetic in blocks: word diffs, free time, layers', () => {
  assert.deepEqual(wordDiff('over 12 m.', 'over 16 m and anchored.'), [{ op: '=', t: 'over ' }, { op: '-', t: '12' }, { op: '+', t: '16' }, { op: '=', t: ' m' }, { op: '+', t: ' and anchored' }, { op: '=', t: '.' }]);
  const busy = [['09:00', '10:00'], ['10:15', '11:00'], ['12:00', '13:30']].map(([a, b]) => ({ start: Date.parse(`2026-11-16T${a}:00Z`), end: Date.parse(`2026-11-16T${b}:00Z`) }));
  assert.deepEqual(freeSlots(busy, Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-16T23:59:59Z'), ['08:00', '16:00'], 30).map(s => `${s.start.slice(11, 16)}–${s.end.slice(11, 16)}`), ['08:00–09:00', '11:00–12:00', '13:30–16:00']);
  const l = layered(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['a', 'd']]);
  assert.deepEqual([l.get('a')!.layer, l.get('b')!.layer, l.get('c')!.layer, l.get('d')!.layer], [0, 1, 2, 1]);
});

test('a block works out what it shows without keeping it on the panel: its rows, its component\'s props, its account', () => {
  const p = { id: 'inv', card: 'money', map: { quantity: 'hours', price: 'rate' } } as any; const given = structuredClone(p);
  const got = MONEY_BLOCK.rows!([{ description: 'Design work', hours: 2, rate: 950 }], p, () => undefined, { inputs: {} }) as Shaped;
  assert.deepEqual(p, given); // the model's map stays the model's: nothing it worked out is hidden on the panel
  assert.deepEqual(got.props!.map, { quantity: 'hours', price: 'rate', description: 'description', amount: 'amount' });
  assert.deepEqual(got.props!.totals, { lines: 1900, total: 1900 });
  assert.equal(got.account!.totals, 'computed by the system (each amount = quantity × price): {"lines":1900,"total":1900}');
  const one = { id: 'm', card: 'message' } as any;
  assert.equal((MESSAGE.rows!([{ subject: 'Hi', body: 'Hello' }], one, () => undefined, { inputs: {} }) as Shaped).props!.layout, 'one');
  assert.equal(one.layout, undefined);
});

test('messages, documents with tracked changes, events with free time, tasks: roles found, computed by the system, said in the account', async () => {
  const a = await json('show_view', { name: 'work', title: 'Work', panels: [
    { id: 'inbox', card: 'message', from: R.inbox },
    { id: 'one', card: 'message', from: R.inbox, limit: 1 },
    { id: 'contract', card: 'document', from: R.v2, before: R.v1 },
    { id: 'today', card: 'events', from: R.events },
    { id: 'free', card: 'events', from: R.events, layout: 'free', within: { from: '2026-11-16', to: '2026-11-16' }, hours: ['08:00', '16:00'], length: '30m' },
    { id: 'board', card: 'tasks', from: R.tasks, layout: 'board', order: ['todo', 'doing', 'done'] },
    { id: 'typo', card: 'events', from: R.typo },
  ] });
  assert.deepEqual(panel(a, 'inbox').roles, { from: 'from', subject: 'subject', body: 'body', time: 'time', state: 'state' });
  assert.equal(panel(a, 'inbox').layout, 'inbox'); assert.equal(panel(a, 'one').layout, 'one');
  assert.match(panel(a, 'contract').tracked_changes, /^computed by the system, from r2 to r3: \d+ insertions, \d+ deletions, 1 new sections, 1 removed$/);
  assert.equal(panel(a, 'today').events, 3);
  assert.equal(panel(a, 'free').free, 'computed by the system from the busy events: 3 free spans of at least 30m, 08:00–16:00 UTC');
  assert.deepEqual(panel(a, 'board').by_state, { done: 1, doing: 1, todo: 1 });
  assert.equal(a.typed_numbers_not_in_any_result, undefined);
});

test('money: amounts as quantity × price when missing, totals by the system, and whether the document\'s own total agrees', async () => {
  const a = await json('show_view', { name: 'invoices', title: 'Invoices', panels: [
    { id: 'right', card: 'money', from: R.invoice, pick: 'lines', layout: 'invoice', map: { quantity: 'hours', price: 'rate' } },
    { id: 'wrong', card: 'money', from: R.wrong, pick: 'lines', layout: 'invoice' },
  ] });
  assert.equal(panel(a, 'right').totals, 'computed by the system (each amount = quantity × price): {"lines":37475,"total":37475,"stated":37475,"agrees":true}');
  assert.equal(panel(a, 'right').mismatch, undefined);
  assert.equal(panel(a, 'wrong').mismatch, 'the document\'s own total is not what its lines add up to'); // hours and rate found by their names
});

test('files, a map, contacts, a batch, changes, a diagram, a sheet with scenarios', async () => {
  const a = await json('show_view', { name: 'more', title: 'More', panels: [
    { id: 'files', card: 'files', from: R.files },
    { id: 'fleet', card: 'map', from: R.places },
    { id: 'people', card: 'contacts', from: R.contacts },
    { id: 'sent', card: 'batch', results: [`${R.sends[0]}-${R.sends[4]}`] },
    { id: 'refunds', card: 'changes', from: R.changes },
    { id: 'dropped', card: 'changes', from: R.dropped },
    { id: 'money-flow', card: 'diagram', from: R.links },
    { id: 'budget', card: 'sheet', from: R.budget, compute: { budget: 'round(actual * (1 + $growth), 0)' }, inputs: { growth: 0.04 },
      scenarios: { low: { growth: 0.02 }, base: { growth: 0.04 }, high: { growth: 0.06 } }, totals: { 'Next year': 'sum(budget)' } },
  ] });
  assert.equal(panel(a, 'files').files, 2);
  assert.equal(panel(a, 'fleet').places, 3); assert.match(panel(a, 'fleet').drawn, /no map tiles/);
  assert.deepEqual(panel(a, 'people').roles, { name: 'name', role: 'title', org: 'company', email: 'email', phone: 'phone' });
  assert.deepEqual([panel(a, 'sent').calls, panel(a, 'sent').ok, panel(a, 'sent').failed], [5, 4, [R.sends[2]]]);
  assert.deepEqual(panel(a, 'refunds').fields_changed, ['status', 'refund']);
  assert.deepEqual(panel(a, 'dropped').fields_changed, ['note']); // a field left out of after is a change too
  assert.equal(panel(a, 'money-flow').nodes, 4);
  assert.deepEqual(panel(a, 'budget').values, [{ label: 'Next year', expr: 'sum(budget)', values: [{ scenario: 'low', value: 2_040_000 }, { scenario: 'base', value: 2_080_000 }, { scenario: 'high', value: 2_120_000 }] }]);
  assert.equal(a.typed_numbers_not_in_any_result, undefined);
});

test('a block says what it needs when the rows do not have it, and never draws a guess', async () => {
  const noRoles = await call('show_view', { name: 'x', title: 'X', panels: [{ card: 'message', data: [{ a: 1, b: 2 }] }] });
  assert.equal(noRoles.ok, false); assert.match(noRoles.text, /a message needs one of subject, body; fields here: a, b; say which with map/);
  const badMap = await call('show_view', { name: 'x', title: 'X', panels: [{ card: 'map', from: R.places, map: { lat: 'nope' } }] });
  assert.match(badMap.text, /map: no field "nope" for lat/);
  const badLayout = await call('show_view', { name: 'x', title: 'X', panels: [{ card: 'tasks', from: R.tasks, layout: 'kanban' }] });
  assert.match(badLayout.text, /tasks has no layout "kanban"; layouts: checklist, board, steps/);
});

test('drawn in Chromium: every block draws each of its rows with a reference to point at, no missing component, no page errors', async () => {
  await json('show_view', { name: 'marks', title: 'Marks', panels: [{ card: 'media', media: 'a1', marks: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, label: 'dent' }] }] }).catch(() => undefined); // no attachment here: refused, fine
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 2400 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => (window as any).app.shell('light'));
    const latest = new Map<string, Shown>(); for (const v of shown) if (!v.ask) latest.set(v.name, v);
    for (const v of latest.values()) await page.evaluate((x: Shown) => (window as any).app.view(x), v);
    await page.evaluate((s: ShellState) => (window as any).app.state(s), state!);
    await page.waitForTimeout(1200);
    const counts = await page.evaluate(() => { const c: Record<string, number> = {}; for (const e of document.querySelectorAll('[data-panel][data-row]')) { const k = (e as HTMLElement).dataset.panel!; c[k] = (c[k] ?? 0) + 1; } return c; });
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('which this window has not registered')), false);
    for (const [id, n] of Object.entries({ inbox: 2, one: 1, contract: 4, today: 3, free: 3, board: 3, typo: 2, right: 2, wrong: 2, files: 2, fleet: 3, people: 1, sent: 5, refunds: 2, dropped: 1, budget: 2 })) assert.equal(counts[id], n, `${id}: ${counts[id]} rows drawn, ${n} expected`);
    assert.match(await page.evaluate(() => document.querySelector('[data-panel="dropped"][data-row="0"]')?.textContent ?? ''), /note call back → $/);
    // a start on a day the calendar does not have is its own day, as written: never rolled over into the day after
    assert.deepEqual(await page.evaluate(() => [...document.querySelector('[data-panel="typo"]')!.closest('.vb-agenda')!.querySelectorAll('.vb-dayhead')].map(e => e.textContent)), ['2026-02-30T10:00:00Z', '2 Mar 2026']);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-panel="money-flow"][data-node]').length), 4);
    assert.match(await page.evaluate(() => document.body.innerText), /✓ the document's own total, NOK\s37,475\.00, is what its lines add up to/);
    assert.match(await page.evaluate(() => document.body.innerText), /⚠ the document says NOK\s38,000\.00; its lines add up to NOK\s37,475\.00/);
    assert.equal(await page.evaluate(() => document.querySelector('[data-panel="contract"] ins')?.textContent), '16');
    assert.match(await page.evaluate(() => document.querySelector('[data-panel="inbox"][data-row="1"]')?.textContent ?? ''), /Reminder: INV-2026-0412/);
    if (process.env.BLOCKS_SHOT) await page.screenshot({ path: process.env.BLOCKS_SHOT, fullPage: true });
  } finally { await browser.close(); app.close(); }
});

test('slides, a signature, devices with their switch, and marks on a photo: drawn in Chromium, each pointed at by reference', async () => {
  const png = path.join(dir, 'dent.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  const photo = results.attach('dent.png', 'image/png', png).id;
  const deck = add('deck', [{ title: 'November in brief', figure: 37475, label: 'invoiced (NOK)', points: ['Two invoices', 'One overdue'] }, { title: 'Next', points: 'Chase INV-2026-0412' }]);
  const signed = add('signature', { signer: 'Kari Nordmann', signed_at: '2026-11-11T10:00:00Z', document: 'Contract v2', sha256: 'sha256:9f2c4e1a7b3d5f6e8a9c0b1d2e3f4a5b' });
  const devices = add('devices', [{ name: 'Line 3 conveyor', state: 'on', id: 'L3', kind: 'motor' }, { name: 'Oven B', state: 'off', id: 'OB' }]);
  const a = await json('show_view', { name: 'kit', title: 'Kit', panels: [
    { id: 'deck', card: 'slides', from: deck }, { id: 'signed', card: 'signature', from: signed }, { id: 'line', card: 'devices', from: devices, operation: 'switch_device' },
    { id: 'photo', card: 'media', media: photo, marks: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, label: 'dent' }, { x: 0.6, y: 0.5, w: 0.2, h: 0.2, label: 'scratch' }] },
  ] });
  assert.deepEqual(panel(a, 'signed').roles, { who: 'signer', when: 'signed_at', what: 'document', digest: 'sha256' });
  assert.equal(a.typed_numbers_not_in_any_result, undefined); // the slide's figure is the invoice's own total
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
    await page.evaluate((x: Shown) => (window as any).app.view(x), shown.filter(v => v.name === 'kit').at(-1)!);
    await page.evaluate((s: ShellState) => (window as any).app.state({ ...s, tree: { view: 'kit' }, maximized: null }), state!);
    await page.waitForTimeout(900);
    const pane = page.locator('.vindu-pane[data-view="kit"]');
    const text = await pane.innerText();
    for (const t of ['November in brief', '37,475', 'invoiced (NOK)', 'Kari Nordmann', 'Contract v2', 'Line 3 conveyor', 'Oven B']) assert.ok(text.includes(t), t);
    assert.equal(await pane.locator('[data-panel="line"][data-row]').count(), 2);
    assert.equal(await pane.locator('.vb-region[data-panel="photo"]').count(), 2);
    await page.evaluate(() => (window as any).app.events());
    await pane.locator('[data-panel="line"][data-row="0"] button').click(); // the person turns the conveyor off: an operation, asked as any is
    const ev = await page.evaluate(() => (window as any).app.events());
    assert.deepEqual(ev.find((e: any) => e.type === 'operation'), { type: 'operation', name: 'switch_device', input: { id: 'L3', state: 'off' } });
    const region = await pane.locator('.vb-region[data-panel="photo"][data-row="1"]').boundingBox();
    await page.keyboard.down('Alt'); await page.mouse.click(region!.x + region!.width / 2, region!.y + region!.height / 2); await page.keyboard.up('Alt');
    const sel = (await page.evaluate(() => (window as any).app.events())).find((e: any) => e.type === 'select');
    assert.deepEqual(sel.items, [{ view: 'kit', panel: 'photo', row: 1 }]);
    ui.event(sel);
    assert.deepEqual(ui.selection().at(-1), { view: 'kit', panel: 'photo', card: 'media', media: 'dent.png', mark: { x: 0.6, y: 0.5, w: 0.2, h: 0.2, label: 'scratch' } });
    ui.event({ type: 'select', items: [] });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
