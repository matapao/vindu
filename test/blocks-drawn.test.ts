// Vindu's blocks drawn in Chromium: every block draws each of its rows with a reference the window can point at, and
// slides, a signature, devices with their switch and marks on a photo, each pointed at by reference. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { type Shown, type ShellState } from '../src/index.js';
import { chromium, eventsOf } from './helpers.js';
import { dir, results, add, R, shown, state, ui, json, panel } from './blocks-session.js';

// the views blocks.test.ts shows, as it shows them: what the window draws below
await json('show_view', { name: 'work', title: 'Work', panels: [
  { id: 'inbox', card: 'message', from: R.inbox },
  { id: 'one', card: 'message', from: R.inbox, limit: 1 },
  { id: 'contract', card: 'document', from: R.v2, before: R.v1 },
  { id: 'today', card: 'events', from: R.events },
  { id: 'free', card: 'events', from: R.events, layout: 'free', within: { from: '2026-11-16', to: '2026-11-16' }, hours: ['08:00', '16:00'], length: '30m' },
  { id: 'board', card: 'tasks', from: R.tasks, layout: 'board', order: ['todo', 'doing', 'done'] },
  { id: 'typo', card: 'events', from: R.typo },
] });
await json('show_view', { name: 'invoices', title: 'Invoices', panels: [
  { id: 'right', card: 'money', from: R.invoice, pick: 'lines', layout: 'invoice', map: { quantity: 'hours', price: 'rate' } },
  { id: 'wrong', card: 'money', from: R.wrong, pick: 'lines', layout: 'invoice' },
] });
await json('show_view', { name: 'more', title: 'More', panels: [
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
    await page.evaluate(() => window.app.shell('light'));
    const latest = new Map<string, Shown>(); for (const v of shown) if (!v.ask) latest.set(v.name, v);
    for (const v of latest.values()) await page.evaluate((x: Shown) => window.app.view(x), v);
    await page.evaluate((s: ShellState) => window.app.state(s), state!);
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
    await page.evaluate(() => window.app.shell('light'));
    await page.evaluate((x: Shown) => window.app.view(x), shown.filter(v => v.name === 'kit').at(-1)!);
    await page.evaluate((s: ShellState) => window.app.state({ ...s, tree: { view: 'kit', size: 1 }, maximized: null }), state!);
    await page.waitForTimeout(900);
    const pane = page.locator('.vindu-pane[data-view="kit"]');
    const text = await pane.innerText();
    for (const t of ['November in brief', '37,475', 'invoiced (NOK)', 'Kari Nordmann', 'Contract v2', 'Line 3 conveyor', 'Oven B']) assert.ok(text.includes(t), t);
    assert.equal(await pane.locator('[data-panel="line"][data-row]').count(), 2);
    assert.equal(await pane.locator('.vb-region[data-panel="photo"]').count(), 2);
    await page.evaluate(() => window.app.events());
    await pane.locator('[data-panel="line"][data-row="0"] button').click(); // the person turns the conveyor off: an operation, asked as any is
    const ev = await page.evaluate(() => window.app.events());
    assert.deepEqual(ev.find(e => e.type === 'operation'), { type: 'operation', name: 'switch_device', input: { id: 'L3', state: 'off' } });
    const region = await pane.locator('.vb-region[data-panel="photo"][data-row="1"]').boundingBox();
    await page.keyboard.down('Alt'); await page.mouse.click(region!.x + region!.width / 2, region!.y + region!.height / 2); await page.keyboard.up('Alt');
    const sel = eventsOf(await page.evaluate(() => window.app.events()), 'select')[0];
    assert.deepEqual(sel.items, [{ view: 'kit', panel: 'photo', row: 1 }]);
    ui.event(sel);
    assert.deepEqual(ui.selection().at(-1), { view: 'kit', panel: 'photo', card: 'media', media: 'dent.png', mark: { x: 0.6, y: 0.5, w: 0.2, h: 0.2, label: 'scratch' } });
    ui.event({ type: 'select', items: [] });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
