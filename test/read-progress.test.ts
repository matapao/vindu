// How far the person has read each panel, kept for the host alone: the window measures the furthest share of each panel
// it has had in view (a long table as its pane scrolls, a short note once it has been in view 2.5 s, a PDF as its frame
// scrolls), the UI server keeps the furthest, the host hears it grow and reads all of it, and the model is told none of
// it: not in a show_view account, the delta, or look. In Chromium, through the fixtures' shell. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type ReadProgress, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, shellServer, tinyPdf, type Look, paneIn } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const invoices = Array.from({ length: 60 }, (_, i) => ({ number: `INV-2026-${String(400 + i).padStart(4, '0')}`, customer: i % 2 ? 'Havgap Media' : 'Brattli Verksted', amount: 1000 + i * 37 }));

test('in Chromium: how far each panel has been read goes to the host as it grows, to 1; the model is told none of it', async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('read-'), work = tmp('read-work-'), results = memoryResults(dir);
  fs.mkdirSync(path.join(work, 'docs')); fs.writeFileSync(path.join(work, 'docs/report.pdf'), tinyPdf(5));
  results.add({ server: 'accounts', tool: 'list_invoices', value: invoices });
  const shown: Shown[] = [], heard: ReadProgress[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onState: s => { st.s = s; }, onReadProgress: r => heard.push(r) });
  const c = await mcpClient(ui.url);
  const accounts = [
    await c.json('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r1', columns: ['number', 'customer', 'amount'] }] }),
    await c.json('show_view', { name: 'note', title: 'Note', panels: [{ id: 'gist', card: 'text', text: 'Two invoices are late.' }] }),
    await c.json('show_view', { name: 'doc', title: 'Report', panels: [{ id: 'pdf', card: 'pdf', path: 'docs/report.pdf' }] }),
  ];
  const shell = await shellServer(import.meta.dirname);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(shell.url);
    await page.evaluate(() => window.app.shell('light'));
    const latest = new Map<string, Shown>(); for (const v of shown) latest.set(v.name, v);
    for (const v of latest.values()) await page.evaluate((x: Shown) => window.app.view(x), v);
    await page.evaluate((s: ShellState) => window.app.state(s), st.s!);
    const drawnAt = Date.now();
    // what the window reports goes to the UI server, as an app's IPC would carry it
    const pass = async () => { for (const e of await page.evaluate(() => window.app.events())) ui.event(e); };
    const readOf = (view: string, panel: string) => ui.readProgress().find(r => r.view === view && r.panel === panel)?.read;
    const until = async (what: string, ok: () => boolean) => { for (let i = 0; i < 120; i++) { await page.waitForTimeout(100); await pass(); if (ok()) return; } throw new Error(`the window did not say: ${what}; read: ${JSON.stringify(ui.readProgress())}`); };

    // the table is taller than its pane: as far as the pane shows of it, at once
    await until('the table read in part', () => (readOf('inv', 'rows') ?? 0) > 0);
    const first = readOf('inv', 'rows')!;
    assert.ok(first > 0 && first < 0.8, `the top of the table: ${first}`);
    assert.equal(readOf('note', 'gist'), undefined); // the short note is in view, but not long enough yet
    // the person scrolls the table to its end: all of it read, and the host heard it grow, to 1
    await page.evaluate(() => { const b = document.querySelector('.vindu-pane[data-view="inv"] .vindu-pane-body') as HTMLElement; b.scrollTop = b.scrollHeight; });
    await until('the table read to its end', () => readOf('inv', 'rows') === 1);
    const told = heard.filter(r => r.view === 'inv').map(r => r.read);
    assert.equal(told.at(-1), 1);
    assert.ok(told.every((x, i) => i === 0 || x - told[i - 1] >= 0.05 || x === 1), `each told grew by 0.05 at least, or to 1: ${told.join(', ')}`);
    // the note fits in its pane: read once it has been in view about 2.5 s
    await until('the note read', () => readOf('note', 'gist') === 1);
    assert.ok(Date.now() - drawnAt >= 2400, `not before it has been in view 2.5 s: ${Date.now() - drawnAt} ms`);
    // the PDF, scrolled to its end in its frame: read to its end
    const doc = (await (await page.waitForSelector('.vindu-pane[data-view="doc"] iframe[data-page-panel="pdf"]')).contentFrame())!;
    await doc.waitForSelector('body[data-ready="1"]', { timeout: 15_000 });
    await until('the PDF read in part', () => (readOf('doc', 'pdf') ?? 0) > 0);
    assert.ok(readOf('doc', 'pdf')! < 1, `only its first page or so: ${readOf('doc', 'pdf')}`);
    await doc.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await until('the PDF read to its end', () => readOf('doc', 'pdf') === 1);
    assert.equal(await doc.textContent('#at'), 'page 5 of 5');
    assert.deepEqual(heard.filter(r => r.read === 1).map(r => `${r.view}/${r.panel}`).sort(), ['doc/pdf', 'inv/rows', 'note/gist']);

    // the model is told none of it: not in an account, not in what changed, not in look
    const look: Look = await c.json('look', {});
    const again = await c.json('show_view', { name: 'more', title: 'More', panels: [{ card: 'text', text: 'And one more.' }] });
    const delta = ui.delta();
    for (const said of [...accounts, look, again, delta]) assert.doesNotMatch(JSON.stringify(said), /"read"|read_?progress|"share"/i);
    assert.ok(paneIn(look, 'inv').in_sight, 'look still says what is in sight'); // what it said before
    // the model shows the note anew: what was read of it goes with the old, and is read again from nothing
    await c.json('show_view', { name: 'note', title: 'Note', panels: [{ id: 'gist', card: 'text', text: 'Three invoices are late.' }] });
    assert.equal(readOf('note', 'gist'), undefined);
    assert.equal(readOf('inv', 'rows'), 1); // the others keep theirs
    assert.equal(ui.checkpoint().read?.find(([v]) => v === 'inv')?.[1][0][1], 1); // kept with the task, as its what-ifs are
    assert.deepEqual(errors, []);
  } finally { await browser.close(); shell.close(); await c.mcp.close(); ui.close(); await vindu.close(); }
});

test('in Chromium: a page the model wrote is read as its document scrolls, and a file in Monaco as Monaco scrolls', async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('read-pages-'), work = tmp('read-pages-work-'), results = memoryResults(dir);
  fs.writeFileSync(path.join(work, 'long.ts'), Array.from({ length: 400 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join('\n') + '\n');
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onState: s => { st.s = s; } });
  const c = await mcpClient(ui.url);
  await c.json('show_view', { name: 'site', title: 'Site', panels: [{ id: 'tall', card: 'page', html: '<!doctype html><meta name="color-scheme" content="light dark"><div style="height:3000px">A tall page</div>' }] });
  await c.json('show_view', { name: 'src', title: 'Source', panels: [{ id: 'file', card: 'code', path: 'long.ts' }] });
  const shell = await shellServer(import.meta.dirname);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await page.goto(shell.url);
    await page.evaluate(() => window.app.shell('light'));
    const latest = new Map<string, Shown>(); for (const v of shown) latest.set(v.name, v);
    for (const v of latest.values()) await page.evaluate((x: Shown) => window.app.view(x), v);
    await page.evaluate((s: ShellState) => window.app.state(s), st.s!);
    const pass = async () => { for (const e of await page.evaluate(() => window.app.events())) ui.event(e); };
    const readOf = (view: string, panel: string) => ui.readProgress().find(r => r.view === view && r.panel === panel)?.read;
    const until = async (what: string, ok: () => boolean) => { for (let i = 0; i < 150; i++) { await page.waitForTimeout(100); await pass(); if (ok()) return; } throw new Error(`the window did not say: ${what}; read: ${JSON.stringify(ui.readProgress())}`); };
    const frameOf = async (view: string, panel: string) => (await (await page.waitForSelector(`.vindu-pane[data-view="${view}"] iframe[data-page-panel="${panel}"]`)).contentFrame())!;
    const site = await frameOf('site', 'tall'), src = await frameOf('src', 'file');
    await until('the page and the file read in part', () => (readOf('site', 'tall') ?? 0) > 0 && (readOf('src', 'file') ?? 0) > 0);
    assert.ok(readOf('site', 'tall')! < 0.5 && readOf('src', 'file')! < 0.5, JSON.stringify(ui.readProgress()));
    await site.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await src.waitForSelector('body[data-ready]');
    await src.evaluate(() => { const e = window.monaco.editor.getEditors()[0]; e.setScrollTop(e.getScrollHeight()); });
    await until('the page and the file read to their ends', () => readOf('site', 'tall') === 1 && readOf('src', 'file') === 1);
  } finally { await browser.close(); shell.close(); await c.mcp.close(); ui.close(); await vindu.close(); }
});

test('the window\'s reads are checked: only for the newest showing of a view, its own panels, and shares from 0 to 1', async () => {
  const vindu = await startVindu({ verifyMs: 0 });
  const dir = tmp('read-checked-'), results = memoryResults(dir);
  const heard: ReadProgress[] = [], seqs = new Map<string, number | undefined>();
  const ui = vindu.open({ results, dir }, { onView: v => seqs.set(v.name, v.seq), onReadProgress: r => heard.push(r) });
  const c = await mcpClient(ui.url);
  try {
    await c.json('show_view', { name: 'n', title: 'N', panels: [{ id: 'a', card: 'text', text: 'One.' }, { id: 'b', card: 'text', text: 'Two.' }] });
    const seq = seqs.get('n')!;
    assert.equal(ui.event({ type: 'read', view: 'n', seq: seq + 1, read: { p_a: 0.5 } }), false); // a showing there is not
    assert.equal(ui.event({ type: 'read', view: 'gone', seq, read: { p_a: 0.5 } }), false);
    assert.equal(ui.event({ type: 'read', view: 'n', seq, read: { p_zz: 0.5, p_a: 1.5, b: -1 } }), false); // no such panel, no such share
    assert.equal(ui.event({ type: 'read', view: 'n', seq, read: { p_a: 0.42, b: 0.991 } }), true);
    assert.deepEqual(ui.readProgress(), [{ view: 'n', panel: 'a', read: 0.42 }, { view: 'n', panel: 'b', read: 1 }]);
    assert.equal(ui.event({ type: 'read', view: 'n', seq, read: { p_a: 0.3 } }), false); // it only grows
    ui.event({ type: 'read', view: 'n', seq, read: { p_a: 0.45 } }); // grown by less than 0.05: kept, not told
    ui.event({ type: 'read', view: 'n', seq, read: { p_a: 0.48 } });
    assert.deepEqual(heard.map(r => `${r.panel} ${r.read}`), ['a 0.42', 'b 1', 'a 0.48']);
    assert.equal(ui.readProgress()[0].read, 0.48);
    // a task restored from its checkpoint has it again, as the host was told of it then: it hears only what grows after
    const back = vindu.open({ results, dir: tmp('read-restored-') }, { onReadProgress: r => heard.push(r) });
    try {
      assert.deepEqual(await back.restore(ui.checkpoint()), []);
      assert.deepEqual(back.readProgress(), ui.readProgress());
      assert.equal(heard.length, 3);
    } finally { back.close(); }
  } finally { await c.mcp.close(); ui.close(); await vindu.close(); }
});
