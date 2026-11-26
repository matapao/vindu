// The shell drawn in Chromium, as a host app uses it: the UI server's views and shell state go to mountShell, the
// window's events go back to the UI server. What the model reads (look) must be what is drawn, to the pixel.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, type Look } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const work = tmp('swork-'); fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><title>Site</title><body style="margin:0"><h1>Site</h1>');
const dir = tmp('stask-');
const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', value: Array.from({ length: 40 }, (_, i) => ({ id: `INV-${1000 + i}`, customer: ['Brattli Verksted', 'Havgap Media', 'Lysvik Retail'][i % 3], due: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, amount_nok: 10000 + i * 731, status: i % 4 ? 'open' : 'overdue' })) });

const app = http.createServer((req, res) => {
  const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const vindu = await startVindu();
let views: Shown[] = [], state: ShellState | undefined;
const ui = vindu.open({ results, dir, work }, { onView: v => views.push(v), onState: s => { state = s; } });
const { mcp, call, json } = await mcpClient(ui.url);
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
p.on('pageerror', (e: Error) => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
await p.evaluate(() => window.app.shell('light'));
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); await browser.close(); app.close(); });

/** What the host does: views and state from the UI server to the window, the window's events to the UI server. */
const relay = async () => { for (const e of await p.evaluate(() => window.app.events())) ui.event(e); };
const push = async () => {
  for (const v of views.splice(0)) await p.evaluate((x: Shown) => window.app.view(x), v);
  if (state) await p.evaluate((s: ShellState) => window.app.state(s), state);
};
const sync = async () => { await relay(); await push(); await p.waitForTimeout(250); await relay(); await push(); await p.waitForTimeout(200); await relay(); };
const rects = (page = p) => page.evaluate(() => {
  const desk = document.querySelector('.vindu-desk')!.getBoundingClientRect();
  const r = (e: Element) => { const b = e.getBoundingClientRect(); return [Math.round(b.left - desk.left), Math.round(b.top - desk.top), Math.round(b.width), Math.round(b.height)]; };
  return {
    panes: Object.fromEntries([...document.querySelectorAll<HTMLElement>('.vindu-pane:not([hidden])')].map(e => [e.dataset.view!, r(e)])),
    lines: [...document.querySelectorAll('.vindu-line')].map(r),
    mode: (document.querySelector('.vindu-shell') as HTMLElement).dataset.mode,
  };
});
const boxes = (look: Look) => Object.fromEntries(look.panes.map(x => [x.view, x.box]));
const table = (name: string, extra: Record<string, unknown> = {}) => ({ name, title: name.replace(/-/g, ' '), panels: [{ card: 'table', from: 'r1', columns: ['id', 'customer', 'due', 'amount_nok', 'status'] }], ...extra });

test('the panes drawn are the boxes the model is told, with 1 px lines between', async () => {
  await p.waitForTimeout(200); await relay(); // the window's size
  await json('show_view', table('invoices'));
  await json('show_view', { name: 'totals', title: 'Totals', panels: [{ card: 'kpi', title: 'Overdue', from: 'r1', where: { status: 'overdue' }, value: 'sum(amount_nok)' }, { card: 'kpi', title: 'Open', from: 'r1', where: { status: 'open' }, value: 'sum(amount_nok)' }] });
  await json('show_view', { name: 'per-customer', title: 'Per customer', panels: [{ card: 'bar-chart', from: 'r1', group: 'customer', value: 'sum(amount_nok)' }] });
  await sync();
  const look: Look = await json('look', {});
  assert.equal(look.window, '1440 × 876');
  const drawn = await rects();
  assert.equal(drawn.mode, 'tiled');
  assert.deepEqual(drawn.panes, boxes(look));
  assert.deepEqual(drawn.lines, [[720, 0, 1, 876], [721, 438, 719, 1]]);
  const line = await p.evaluate(() => getComputedStyle(document.querySelector('.vindu-desk')!).backgroundColor); // the gaps are the lines
  assert.equal(line, 'rgb(214, 213, 207)');
  assert.ok(look.panes.every(x => x.content), 'each pane says whether its content fits');
  assert.match(look.panes[0].content, /^scrolls: /); // 40 rows do not fit 848 px
});

test('dragging a line, or the arrow keys on it, resizes; the model hears of it once', async () => {
  await p.mouse.move(720.5, 400); await p.mouse.down(); await p.mouse.move(920.5, 400, { steps: 4 }); await p.mouse.up();
  await sync();
  let look: Look = await json('look', {});
  assert.deepEqual(look.person, ['resized: "invoices" 64 %, "totals" + "per-customer" 36 %']);
  assert.deepEqual((await rects()).panes, boxes(look));
  assert.equal(look.panes[0].box[2], 920);
  await p.focus('.vindu-line[data-dir="row"]'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  await sync();
  look = await json('look', {});
  assert.equal(look.panes[0].box[2], 872);
  assert.deepEqual((await rects()).panes, boxes(look));
  await p.dblclick('.vindu-line[data-dir="row"]', { position: { x: 0, y: 200 } }); // a double-click evens the two sides (away from where lines meet)
  await sync();
  assert.deepEqual((await json('look', {})).layout, { row: ['invoices', { column: ['totals', 'per-customer'] }] });
});

test('a narrow pane gets the compact surface; maximize, Esc, collapse and the shelf work', async () => {
  await json('arrange', { layout: ['invoices', 'totals', 'per-customer'] });
  await sync();
  const look: Look = await json('look', {});
  assert.deepEqual(look.panes.map(x => x.surface), ['compact', 'compact', 'compact']); // 480 px wide each
  assert.equal(await p.locator('.vindu-pane[data-view="invoices"] a2ui-basic-row').count(), 0); // the table as a list, no head row
  await p.dblclick('.vindu-pane[data-view="invoices"] .vindu-pane-title');
  await sync();
  const max: Look = await json('look', {});
  assert.equal(max.mode, 'maximized: "invoices" fills the window; the other panes are behind it');
  assert.deepEqual((await rects()).panes, boxes(max));
  assert.deepEqual(boxes(max), { invoices: [0, 0, 1440, 876] });
  assert.equal(await p.locator('.vindu-pane[data-view="invoices"] a2ui-basic-row').count() > 0, true); // wide again: the head row
  await p.keyboard.press('Escape');
  await sync();
  assert.equal((await rects()).mode, 'tiled');
  const restored: Look = await json('look', {});
  assert.deepEqual((await rects()).panes, boxes(restored));
  assert.deepEqual(restored.person, ['restored the layout ("invoices" was maximized)']);
  await p.hover('.vindu-pane[data-view="totals"]'); await p.click('.vindu-pane[data-view="totals"] button[aria-label="Collapse"]');
  await sync();
  let l: Look = await json('look', {});
  assert.deepEqual((await rects()).panes, boxes(l));
  assert.deepEqual(l.collapsed, [{ view: 'totals', title: 'Totals', by: 'the person' }]);
  assert.deepEqual(l.person, ['collapsed "totals" into the shelf']);
  assert.equal(await p.locator('.vindu-bar-shelf .vindu-bar-view.is-collapsed').innerText(), 'Totals');
  await p.click('.vindu-bar-view.is-collapsed');
  await sync();
  l = await json('look', {});
  assert.deepEqual(l.person, ['opened "totals" where it was']);
  assert.deepEqual(l.layout, { row: ['invoices', 'totals', 'per-customer'] }); // back between the two it was between
  await p.keyboard.press('F6'); // from the focused pane to the next, in reading order
  await sync();
  const order = l.panes.map(x => x.view), want = order[(order.indexOf('totals') + 1) % order.length];
  assert.equal((await json('look', {})).focus, want);
  assert.deepEqual((await rects()).panes, boxes(l));
  assert.equal(l.focus, 'totals');
});

test('one view sits in the middle; one page fills its pane; a phone-width window stacks the panes', async () => {
  const t = vindu.open({ results, dir: tmp('stask2-'), work }, { onView: v => views.push(v), onState: s => { state = s; } });
  const c = await mcpClient(t.url);
  await p.evaluate(() => window.app.shell('light'));
  const relay2 = async () => { for (const e of await p.evaluate(() => window.app.events())) t.event(e); };
  const push2 = async () => { for (const v of views.splice(0)) await p.evaluate((x: Shown) => window.app.view(x), v); await p.evaluate((s: ShellState) => window.app.state(s), state!); };
  const sync2 = async () => { await relay2(); await push2(); await p.waitForTimeout(300); await relay2(); await push2(); await p.waitForTimeout(200); await relay2(); };
  await p.waitForTimeout(200); await relay2();
  await c.json('show_view', { name: 'totals', title: 'Totals', panels: [{ card: 'kpi', title: 'Overdue', from: 'r1', where: { status: 'overdue' }, value: 'sum(amount_nok)' }] });
  await sync2();
  let look = await c.json('look', {});
  let d = await rects();
  assert.equal(d.mode, 'single');
  const [x, y, w, h] = d.panes.totals, [bx, by, bw, bh] = look.panes[0].box, room = look.panes[0].room;
  assert.deepEqual([x, w], [bx, bw]); // x and width as told
  assert.ok(Math.abs(y - by) <= 1 && Math.abs(h - bh) <= 1, JSON.stringify({ d, look })); // as tall as its content, in the middle, as told once measured
  assert.ok(bh < room[3] && Math.abs(by - (876 - bh) / 2) <= 1);
  await c.json('show_view', { name: 'site', title: 'Site', panels: [{ card: 'page', path: 'index.html' }], place: { beside: 'totals', side: 'right', size: 0.7 } });
  await sync2();
  look = await c.json('look', {});
  d = await rects();
  assert.deepEqual(d.panes, boxes(look));
  const frame = await p.evaluate(() => { const b = document.querySelector('.vindu-pane[data-view="site"] .vindu-pane-body')!.getBoundingClientRect(); const f = document.querySelector('.vindu-pane[data-view="site"] iframe')!.getBoundingClientRect(); return { body: Math.round(b.bottom), frame: Math.round(f.bottom), width: Math.round(f.width), bw: Math.round(b.width) }; });
  assert.ok(Math.abs(frame.body - frame.frame) <= 1 && frame.width === frame.bw, JSON.stringify(frame)); // the page fills its pane
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300); await relay2(); await sync2();
  look = await c.json('look', {});
  assert.equal(look.mode, 'stacked: the window is phone-width, so the panes are one after another, full width');
  d = await rects();
  assert.equal(d.mode, 'stacked');
  assert.deepEqual(Object.keys(d.panes), ['totals', 'site']);
  assert.ok(Object.values<number[]>(d.panes).every(r => r[0] === 0 && r[2] === 390) && d.panes.site[1] > d.panes.totals[1]);
  // stacked, every pane is in sight, full width, and none is maximized: the command has nothing to do, a pane has no
  // Maximize button, a double-click on its title changes nothing, and the UI server takes no maximize from the window
  assert.equal(await p.evaluate(() => window.app.command({ type: 'maximize', view: 'site' })), false);
  assert.equal(await p.evaluate(() => window.app.command({ type: 'maximize' })), false);
  assert.equal(await p.locator('.vindu-pane[data-view="site"] .vindu-pane-tools button[aria-label="Maximize"]').isHidden(), true);
  await p.dblclick('.vindu-pane[data-view="site"] .vindu-pane-title');
  await sync2();
  assert.equal((await rects()).mode, 'stacked');
  assert.equal(t.event({ type: 'maximize', view: 'totals' }), false);
  look = await c.json('look', {});
  assert.equal(look.mode, 'stacked: the window is phone-width, so the panes are one after another, full width');
  assert.equal(look.person, undefined); // nothing changed
  await p.setViewportSize({ width: 1440, height: 900 });
  await c.mcp.close(); t.close();
  assert.deepEqual(errors, []);
});

test('the shell refuses what it cannot place, and says why, in words', async () => {
  const r = await call('arrange', { layout: { column: ['invoices', 'nope'] } });
  assert.equal(r.ok, false);
  assert.match(r.text, /^not arranged: no view "nope" has been shown; views shown: invoices, totals, per-customer$/);
});


test('reserved panes show accessible skeletons at the reported boxes, then fill in place', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const workspace = tmp('reserve-render-');
  const reserveResults = memoryResults(workspace);
  reserveResults.add({ tool: 'read', server: 'example', value: [{ id: 'sample', total: 22 }] });
  const pending: Shown[] = [];
  let shellState: ShellState | undefined;
  const reserveUi = vindu.open({ results: reserveResults, dir: workspace }, { onView: v => pending.push(v), onState: s => { shellState = s; } });
  const client = await mcpClient(reserveUi.url);
  const pageErrors: string[] = [];
  page.on('pageerror', (error: Error) => pageErrors.push(error.message));
  const draw = async () => {
    for (const view of pending.splice(0)) await page.evaluate((v: Shown) => window.app.view(v), view);
    assert.ok(shellState);
    await page.evaluate((s: ShellState) => window.app.state(s), shellState);
  };
  try {
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => window.app.shell('light'));
    const viewport = await page.locator('.vindu-desk').boundingBox();
    assert.ok(viewport);
    reserveUi.event({ type: 'window', w: viewport.width, h: viewport.height });
    const plan = await client.json('arrange', {
      reserve: [{ name: 'planned-summary', title: 'Planned summary' }, { name: 'planned-details', title: 'Planned details' }],
      layout: ['planned-summary', 'planned-details'],
    });
    await draw();
    assert.deepEqual((await rects(page)).panes, boxes(plan));
    assert.equal(await page.locator('.vindu-loading [role="status"]').count(), 2);
    assert.equal(await page.locator('.vindu-skeleton').count(), 6);
    await client.json('show_view', {
      name: 'planned-summary', title: 'Planned summary', panels: [{ card: 'table', from: 'r1' }],
      place: { beside: 'planned-details', side: 'below' },
    });
    await draw();
    assert.deepEqual((await rects(page)).panes, boxes(plan));
    assert.equal(await page.locator('.vindu-loading [role="status"]').count(), 1);
    assert.equal(await page.locator('.vindu-pane[data-view="planned-summary"] .vindu-skeleton').count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await client.mcp.close();
    reserveUi.close();
    fs.rmSync(workspace, { force: true, recursive: true });
  }
});
