// Cells and events drawn in Chromium in narrow panes, as a host lays out a view alone or seven side by side, in a window
// whose own stylesheet lets text break anywhere (as app stylesheets often do): a number is never wrapped, text wraps at
// its spaces alone, each column is as wide as its widest word, and a pane too narrow for the lines scrolls them
// sideways. A week's events cut their titles at a word's end, each title whole as the event's name. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page as BrowserPage } from 'playwright';
import { startVindu, memoryResults, type Shown } from '../src/index.js';
import { chromium, mcpClient, shellServer } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrow-'));
const results = memoryResults(dir);
const invoice = results.add({ server: 'accounting', tool: 'get_invoice', value: {
  fakturanr: 'INV-2026-0611', kunde: 'Byggmester Haugland AS', dato: '2026-11-20', forfall: '2026-12-04', currency: 'NOK', total: 10773.44,
  lines: [
    { description: 'Membran', timer: 6.375, timepris: 850, quantity: 3, mva: 25 },
    { description: 'Takrenne-montering og beslag', timer: 2.5, timepris: 1280, quantity: 1, mva: 25 },
  ] } }).id;
const days = ['23', '24', '25', '26', '27', '28', '29'];
const titles = ['Levering av takstein', 'Befaring hos kunde', 'Montering av takrenner', 'Levering', 'Møte med arkitekt', 'Rydding av byggeplass', 'Sluttkontroll'];
const week = results.add({ server: 'calendar', tool: 'list_events', value: days.map((d, i) => ({ title: titles[i], start: `2026-11-${d}T08:00:00+01:00`, end: `2026-11-${d}T09:30:00+01:00` })) }).id;

const vindu = await startVindu({ waitMs: 300, locale: 'nb-NO', timeZone: 'Europe/Oslo' });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
const { mcp, json } = await mcpClient(ui.url);
const server = await shellServer(import.meta.dirname, 'app.html'), browser = await chromium.launch();
afterAll(async () => { await browser.close(); server.close(); await mcp.close(); ui.close(); await vindu.close(); });
const last = (name: string) => shown.filter(v => v.name === name).at(-1)!;
/** A host's own stylesheet that lets text break anywhere, which the view's cells must hold against. */
const HOST_CSS = 'body{overflow-wrap:anywhere;word-break:break-word}';

/** A view drawn alone at a pane's width, in the host's window. */
async function drawn(view: Shown, width: number, ready: string): Promise<BrowserPage> {
  const page: BrowserPage = await browser.newPage({ viewport: { width: Math.max(width + 40, 480), height: 1400 } });
  await page.goto(server.url);
  await page.addStyleTag({ content: HOST_CSS });
  await page.evaluate(([v, w]) => { window.app.width(w); window.app.catalog('view', v, { theme: true }); }, [view, width] as const);
  await page.locator(ready).first().waitFor();
  return page;
}
/** Every word in what selector matches that is split across lines: a word ends at a space (a no-break space is in it). */
const splitWords = (page: BrowserPage, selector: string) => page.evaluate(sel => {
  const split: string[] = [];
  for (const box of document.querySelectorAll(sel)) {
    const texts = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let text = texts.nextNode(); text; text = texts.nextNode()) {
      let at = 0;
      for (const part of (text.textContent ?? '').split(/([ \t\n]+)/)) {
        const range = document.createRange(); range.setStart(text, at); range.setEnd(text, at + part.length);
        if (part.trim() && new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size > 1) split.push(part);
        at += part.length;
      }
    }
  }
  return split;
}, selector);

for (const width of [200, 420, 640]) {
  test(`at ${width} px, money, a sheet and a noted table in Bokmål: numbers whole, text wrapped at its spaces, columns as wide as their widest word, the rest scrolled`, async () => {
    await json('show_view', { name: 'invoice', title: 'Faktura', panels: [
      { id: 'inv', card: 'money', from: invoice, pick: 'lines', layout: 'invoice', map: { quantity: 'timer', price: 'timepris' } },
      { id: 'sheet', card: 'sheet', from: invoice, pick: 'lines' },
      { id: 'noted', card: 'table', from: invoice, pick: 'lines', notes: [{ cell: 'B2', note: 'Ført på timelisten' }] },
    ] });
    const page = await drawn(last('invoice'), width, 'vindu-noted-table td');
    try {
      const cells = 'vindu-money td, vindu-money th, vindu-money .vb-kv span, vindu-sheet td, vindu-sheet th, vindu-noted-table td, vindu-noted-table th';
      assert.deepEqual(await splitWords(page, cells), []);
      // each cell: its text, whether it holds a number, how many lines its own text takes (a note's mark aside), and
      // whether anything in it goes past its column
      const look = await page.evaluate(sel => [...document.querySelectorAll<HTMLElement>(sel)].map(cell => {
        const tops = new Set<number>(), range = document.createRange(), texts = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let text = texts.nextNode(); text; text = texts.nextNode()) {
          if (text.parentElement?.closest('.vb-notemark')) continue;
          range.selectNodeContents(text);
          for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
        }
        return { text: cell.innerText, number: cell.classList.contains('vb-num'), lines: tops.size, overflows: cell.scrollWidth > cell.clientWidth + 1 };
      }), cells);
      assert.deepEqual(look.filter(c => c.overflows), [], 'no word or number goes past its column'); // each column is as wide as its widest word
      assert.deepEqual(look.filter(c => c.number && c.lines > 1), [], 'a number on one line');
      assert.ok(look.some(c => c.text.includes('6,38')) && look.some(c => c.text.includes('5\u00a0418,75')), JSON.stringify(look.map(c => c.text))); // in nb-NO
      const scroll = await page.evaluate(() => ({
        lines: [...document.querySelectorAll<HTMLElement>('vindu-money .vb-scroll, vindu-sheet .vb-sheet, vindu-noted-table .vb-sheet')].map(e => e.scrollWidth > e.clientWidth),
        page: document.getElementById('view')!.scrollWidth - document.getElementById('view')!.clientWidth,
      }));
      assert.equal(scroll.page, 0, 'the pane itself is never widened: what does not fit scrolls inside its card');
      if (width === 200) assert.deepEqual(scroll.lines, [true, true, true], 'seven side by side: each card scrolls sideways');
    } finally { await page.close(); }
  });
}

test('a week in a pane of 460 px cuts each title at a word\'s end, with an ellipsis, and keeps it whole as the event\'s name and title', async () => {
  await json('show_view', { name: 'week', title: 'Uke 48', panels: [{ id: 'jobs', card: 'events', from: week, layout: 'week' }] });
  for (const [width, cut] of [[460, true], [1400, false]] as const) {
    const page = await drawn(last('week'), width, 'vindu-events .vb-slot');
    try {
      await page.waitForTimeout(150); // fitted as the slots are drawn and measured
      const slots = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('vindu-events .vb-slot')].map(slot => ({
        name: slot.getAttribute('aria-label'), title: slot.title, shown: slot.querySelector('.vb-slottitle')?.textContent ?? '',
        overflows: slot.scrollWidth > slot.clientWidth + 1,
      })));
      assert.deepEqual(slots.map(s => s.name), titles);
      assert.deepEqual(slots.map(s => s.title), titles);
      for (const s of slots) {
        const kept = s.shown.endsWith('…') ? s.shown.slice(0, -1) : s.shown;
        assert.ok(s.shown === s.name || (s.shown.endsWith('…') && s.name!.startsWith(kept) && (kept === '' || s.name![kept.length] === ' ')), `${width} px: "${s.shown}" is "${s.name}" cut at a word's end`);
        assert.equal(s.overflows, false, `${width} px: "${s.shown}" fits its slot`);
      }
      assert.deepEqual(await splitWords(page, 'vindu-events .vb-slot'), [], `${width} px: no word split across lines`);
      if (cut) assert.ok(slots.some(s => s.shown.endsWith('…')), 'narrow: some titles are cut');
      else assert.ok(slots.some(s => s.shown === 'Levering'), 'wide: a short title whole');
    } finally { await page.close(); }
  }
});
