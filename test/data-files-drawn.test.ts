// A sheet from a file drawn in Chromium: A1 letters, a marked cell described by its note, the notes listed, and at
// phone width a sheet and a noted table read alike. All data is synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { type Shown, type ShellState } from '../src/index.js';
import type { Page as BrowserPage } from 'playwright';
import { chromium, shellServer } from './helpers.js';
import { work, shown, state, json } from './data-files-session.js';

test('drawn in Chromium: a sheet from a CSV has A1 letters, a marked cell described by its note, and the notes listed; no page errors', async () => {
  await json('show_view', { name: 'sheet', title: 'Invoices', panels: [{ id: 'inv', card: 'sheet', path: 'data/invoices.csv', notes: [{ cell: 'B3', note: 'Pays late every quarter' }, { cell: 'D2', note: 'Disputed' }] }] });
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
    await page.evaluate((x: Shown) => window.app.view(x), shown.filter(v => v.name === 'sheet').at(-1)!);
    await page.evaluate((s: ShellState) => window.app.state(s), state!);
    const sheet = page.locator('vindu-sheet');
    await sheet.locator('td.vb-noted').first().waitFor();
    assert.deepEqual(await sheet.locator('.vb-letter').allTextContents(), ['A', 'B', 'C', 'D']);
    assert.deepEqual(await sheet.locator('tbody .vb-rownum').allTextContents(), ['2', '3', '4']);
    assert.equal(await page.locator('[data-panel="inv"][data-row]').count(), 3);
    const noted = sheet.locator('tr[data-row="1"] td.vb-noted');
    assert.equal(await noted.getAttribute('title'), 'Pays late every quarter');
    assert.equal(await noted.locator('.vb-notemark').textContent(), '1');
    // the accessible description, as Chromium computes it
    const cdp = await page.context().newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'vindu-sheet tr[data-row="1"] td.vb-noted' });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    assert.equal(nodes[0].description?.value, 'Pays late every quarter');
    // focusable with Tab: the first noted cell in the order of the page, then the next
    await page.evaluate(() => { const start = document.querySelector<HTMLElement>('vindu-sheet tr[data-row="0"] th')!; start.tabIndex = -1; start.focus(); });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-description')), 'Disputed');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-description')), 'Pays late every quarter');
    assert.deepEqual(await sheet.locator('ol.vb-cellnotes li').allTextContents(), ['B3 Pays late every quarter', 'D2 Disputed']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});

test('drawn in Chromium at phone width, a sheet and a noted table read alike: a code whole on its line, a value with its own line breaks, numbers on the right', async () => {
  fs.writeFileSync(path.join(work, 'data', 'codes.csv'), 'id,note,amount\nINV-1,"Delivered to the north warehouse on Monday, and signed for by the night shift",31050\nINV-2,"Line one\nline two",007\nINV-3,Paid,35740.5\n');
  const notes = [{ cell: 'A2', note: 'From the ledger' }];
  await json('show_view', { name: 'codes', title: 'Codes', panels: [{ id: 'sheet', card: 'sheet', path: 'data/codes.csv', notes }, { id: 'table', card: 'table', path: 'data/codes.csv', notes }] });
  const shell = await shellServer(import.meta.dirname), browser = await chromium.launch();
  try {
    const page: BrowserPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(shell.url);
    await page.evaluate(() => window.app.shell('light'));
    await page.evaluate((x: Shown) => window.app.view(x), shown.filter(v => v.name === 'codes').at(-1)!);
    await page.evaluate((s: ShellState) => window.app.state(s), state!);
    await page.locator('vindu-noted-table td.vb-noted').waitFor();
    // each cell of a column: its own text (its note's mark aside) and how many lines that takes, its text as shown, how
    // it is aligned, and whether it overflows its column
    const column = (tag: string, n: number) => page.evaluate(([t, i]) => [...document.querySelectorAll<HTMLElement>(`${t} tbody tr td:nth-of-type(${i})`)].map(cell => {
      const tops = new Set<number>(), range = document.createRange(), texts = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let own = '';
      for (let text = texts.nextNode(); text; text = texts.nextNode()) {
        if (text.parentElement?.closest('.vb-notemark')) continue;
        own += text.textContent; range.selectNodeContents(text);
        for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
      }
      return { own, lines: tops.size, shown: cell.innerText, align: getComputedStyle(cell).textAlign, overflows: cell.scrollWidth > cell.clientWidth };
    }), [tag, n] as const);
    for (const tag of ['vindu-sheet', 'vindu-noted-table']) {
      const ids = await column(tag, 1), said = await column(tag, 2), amounts = await column(tag, 3);
      assert.deepEqual(ids.map(c => [c.own, c.lines, c.overflows]), [['INV-1', 1, false], ['INV-2', 1, false], ['INV-3', 1, false]], tag);
      assert.equal(await page.locator(`${tag} tbody tr td.vb-noted .vb-notemark`).textContent(), '1'); // A2, marked
      assert.equal(said[1].shown, 'Line one\nline two', tag); // the value's own line break
      assert.ok(said[0].lines > 1, `${tag}: a long text wraps at its spaces`);
      assert.deepEqual(amounts.map(c => [c.shown, c.align]), [['31,050', 'right'], ['007', 'start'], ['35,740.5', 'right']], tag); // a number on the right; text as written where text goes
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); shell.close(); }
});
