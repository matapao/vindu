// An invoice in a narrow card, drawn in Chromium in the host's own type size: its cells close up so that its lines
// fit, and lines (or a sheet's rows) that still do not fit fade at the edge they scroll past, which a window with
// overlay scrollbars would otherwise not show. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page as BrowserPage } from 'playwright';
import { startVindu, memoryResults, VIEW_WORDS_NB, type Shown } from '../src/index.js';
import { chromium, mcpClient, shellServer } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'money-narrow-'));
const results = memoryResults(dir);
const invoice = results.add({ server: 'accounting', tool: 'get_invoice', value: {
  number: '10238', customer: 'Kari Nordmann', date: '2026-11-30', due: '2026-12-14', currency: 'NOK', total: 128962.5,
  lines: [
    { description: 'Arbeid tilbygg, november (to snekkere)', quantity: 62, price: 850, vat: 25 },
    { description: 'Arbeid tilbygg, november (lærling)', quantity: 30, price: 550, vat: 25 },
    { description: 'Konstruksjonsvirke og isolasjon', quantity: 1, price: 21720, vat: 25 },
    { description: 'Ekstra vindu mot vest, levert og montert', quantity: 1, price: 12250, vat: 25 },
  ] } }).id;
const vindu = await startVindu({ waitMs: 300, locale: 'nb-NO', timeZone: 'Europe/Oslo', viewWords: VIEW_WORDS_NB });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
const { mcp, json } = await mcpClient(ui.url);
const server = await shellServer(import.meta.dirname, 'app.html'), browser = await chromium.launch();
afterAll(async () => { await browser.close(); server.close(); await mcp.close(); ui.close(); await vindu.close(); });

await json('show_view', { name: 'faktura', title: 'Faktura 10238', panels: [
  { id: 'faktura', card: 'money', title: 'Faktura 10238', from: invoice, pick: 'lines', layout: 'invoice' },
  { id: 'ark', card: 'sheet', from: invoice, pick: 'lines' },
] });
const view = shown.filter(v => v.name === 'faktura').at(-1)!;

/** The view in a pane of a width, in a type size, with its lines drawn. */
async function drawn(width: number, size: number): Promise<BrowserPage> {
  const page: BrowserPage = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await page.goto(server.url);
  await page.addStyleTag({ content: `#view{--v-font-size:${size}px}` });
  await page.evaluate(([v, w]: readonly [Shown, number]) => { (window as any).app.width(w); (window as any).app.catalog('view', v, { theme: true }); }, [view, width] as const);
  await page.locator('vindu-sheet td').first().waitFor();
  return page;
}
/** Each scroll container's width, what it holds, the cells' side padding, and how far each edge fades. */
const measure = (page: BrowserPage) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('vindu-money .vb-scroll, vindu-sheet .vb-sheet')].map(box => {
  const style = getComputedStyle(box), cell = getComputedStyle(box.querySelector('td')!);
  return { width: box.clientWidth, holds: box.scrollWidth, pad: cell.paddingLeft, start: style.getPropertyValue('--vb-fade-start'), end: style.getPropertyValue('--vb-fade-end') };
}));
const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

test('an invoice in a card 411 px wide, in the host\'s larger type, closes up its cells and its lines fit, with no fade', async () => {
  const page = await drawn(437, 16); // the card's box: 411 px
  try {
    const [money] = await measure(page);
    assert.equal(money.width, 411);
    assert.equal(money.pad, '3px', 'closed up in a narrow card');
    assert.ok(money.holds <= money.width, `the lines fit: ${money.holds} in ${money.width}`);
    assert.deepEqual([money.start, money.end], ['0px', '0px'], 'nothing to fade');
  } finally { await page.close(); }
  const wide = await drawn(900, 16);
  try { assert.equal((await measure(wide))[0].pad, '6px', 'a wide card keeps its own spacing'); } finally { await wide.close(); }
});

test('lines and a sheet\'s rows that do not fit fade at the edge they scroll past: the right at first, both midway, the left at the end', async () => {
  const page = await drawn(240, 13);
  try {
    const at = async (where: 'start' | 'middle' | 'end') => {
      await page.evaluate((w: string) => {
        for (const box of document.querySelectorAll<HTMLElement>('vindu-money .vb-scroll, vindu-sheet .vb-sheet')) {
          const most = box.scrollWidth - box.clientWidth;
          box.scrollLeft = w === 'start' ? 0 : w === 'end' ? most : most / 2;
        }
      }, where);
      await page.evaluate(frames);
      return (await measure(page)).map(m => [m.start, m.end]);
    };
    const first = await measure(page);
    assert.ok(first.every(m => m.holds > m.width + 24), JSON.stringify(first)); // both scroll
    assert.deepEqual(await at('start'), [['0px', '24px'], ['0px', '24px']]);
    assert.deepEqual(await at('middle'), [['24px', '24px'], ['24px', '24px']]);
    assert.deepEqual(await at('end'), [['24px', '0px'], ['24px', '0px']]);
  } finally { await page.close(); }
});
