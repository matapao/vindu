// What is where, kept the same on both sides: the window reads what of each panel is in sight from the marks it drew
// itself (the same marks pointing reads), never from the screen, and the model is told it in look, by panel, with the
// rows' own names. Scrolled, it changes. In Chromium. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const invoices = Array.from({ length: 40 }, (_, i) => ({ number: `INV-2026-${String(400 + i).padStart(4, '0')}`, customer: i % 2 ? 'Havgap Media' : 'Brattli Verksted', amount: 1000 + i * 37 }));
const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `t${i + 1}`, title: `Task ${i + 1}`, due: '2026-11-20' }));

test("in Chromium: what of each panel is in sight, read from the window's own marks; scrolled, it changes; the model reads it in look", async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('sight-'), results = memoryResults(dir);
  results.add({ server: 'accounts', tool: 'list_invoices', value: invoices }); results.add({ server: 'tasks', tool: 'list', value: tasks });
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { st.s = s; } });
  const c = await mcpClient(ui.url);
  await c.json('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r1', columns: ['number', 'customer', 'amount'] }] });
  await c.json('show_view', { name: 'todo', title: 'To do', panels: [{ id: 't', card: 'tasks', from: 'r2' }] });
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => (window as any).app.shell('light'));
    const latest = new Map<string, Shown>(); for (const v of shown) latest.set(v.name, v);
    for (const v of latest.values()) await page.evaluate((x: Shown) => (window as any).app.view(x), v);
    await page.evaluate((s: ShellState) => (window as any).app.state(s), st.s!);
    // what the window reports goes to the UI server, as an app's IPC would carry it
    const pass = async () => { for (const e of (await page.evaluate(() => (window as any).app.events())) as any[]) ui.event(e); };
    const lookAt = async (pred: (a: any) => boolean) => { for (let i = 0; i < 60; i++) { await page.waitForTimeout(100); await pass(); const a = await c.json('look', {}); if (pred(a)) return a; } throw new Error('the window did not say'); };
    const inv = (a: any) => a.panes.find((p: any) => p.view === 'inv')?.in_sight?.rows as string | undefined;
    const top = await lookAt(a => /^rows 1 to \d+ of 40: INV-2026-0400 to INV-2026-0\d{3}$/.test(inv(a) ?? ''));
    const shownAtTop = Number(/^rows 1 to (\d+)/.exec(inv(top)!)![1]);
    assert.ok(shownAtTop > 3 && shownAtTop < 40, `some rows, not all: ${inv(top)}`);
    assert.match(top.panes.find((p: any) => p.view === 'todo').in_sight.t, /^rows 1 to \d+ of 30: Task 1 to Task \d+$/); // a block's rows, by their own marks
    // the person scrolls to the end of the invoices
    await page.evaluate(() => { const b = document.querySelector('.vindu-pane[data-view="inv"] .vindu-pane-body') as HTMLElement; b.scrollTop = b.scrollHeight; });
    const end = await lookAt(a => / to 40 of 40: INV-2026-\d{4} to INV-2026-0439$/.test(inv(a) ?? ''));
    assert.match(inv(end)!, /^rows (\d+) to 40 of 40/);
    assert.ok(Number(/^rows (\d+)/.exec(inv(end)!)![1]) > 1, 'the first rows are out of sight now');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); await c.mcp.close(); ui.close(); await vindu.close(); }
});
