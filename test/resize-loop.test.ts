// A week whose titles are fitted to their slots and a chart drawn at its pane's width, in a pane resized again and
// again, as a host's layout does: each is drawn again on the frame after its box changes size, and the window reports
// no ResizeObserver loop. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, VIEW_WORDS_NB, type Shown } from '../src/index.js';
import { chromium, mcpClient, shellServer } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resize-loop-'));
const results = memoryResults(dir);
const days = ['23', '24', '25', '26', '27', '28', '29'];
const titles = ['Levering av takstein til byggeplassen', 'Befaring hos kunde i Fana', 'Montering av takrenner og nedløp', 'Levering', 'Møte med arkitekt om tilbygget', 'Rydding av byggeplass etter jobben', 'Sluttkontroll med byggherre'];
const week = results.add({ server: 'calendar', tool: 'list_events', value: days.flatMap((d, i) => [
  { title: titles[i], start: `2026-11-${d}T08:00:00+01:00`, end: `2026-11-${d}T09:30:00+01:00` },
  { title: titles[(i + 3) % 7], start: `2026-11-${d}T11:00:00+01:00`, end: `2026-11-${d}T12:00:00+01:00` },
]) }).id;
const temps = results.add({ server: 'weather', tool: 'forecast', value: days.map((d, i) => ({ day: `2026-11-${d}`, temp: [3, 1, -2, -4, 0, 2, 5][i] })) }).id;
const vindu = await startVindu({ waitMs: 300, locale: 'nb-NO', timeZone: 'Europe/Oslo', viewWords: VIEW_WORDS_NB });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
const { mcp, json } = await mcpClient(ui.url);
const server = await shellServer(import.meta.dirname, 'app.html'), browser = await chromium.launch();
afterAll(async () => { await browser.close(); server.close(); await mcp.close(); ui.close(); await vindu.close(); });

/** What a pane shows: each slot's title as cut and whether it fits its width, and the chart's image. */
const look = () => ({
  titles: [...document.querySelectorAll<HTMLElement>('vindu-events .vb-slot')].map(s => s.querySelector('.vb-slottitle')?.textContent ?? ''),
  wide: [...document.querySelectorAll<HTMLElement>('vindu-events .vb-slot')].filter(s => s.scrollWidth > s.clientWidth + 1).length,
  chart: document.querySelector<HTMLImageElement>('vindu-chart img')?.getAttribute('src') ?? '',
});

/** A page with the view drawn at a width, listening for the window's errors from before it is drawn. */
async function drawnAt(view: Shown, width: number) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1400 } });
  await page.addInitScript(() => {
    (window as any).errors = [];
    window.addEventListener('error', (e) => { (window as any).errors.push(e.message); });
  });
  await page.goto(server.url);
  await page.evaluate(([v, w]: readonly [Shown, number]) => { (window as any).app.width(w); (window as any).app.catalog('view', v, { theme: true }); }, [view, width] as const);
  await page.locator('vindu-events .vb-slot').first().waitFor();
  return page;
}
const frames = (n: number) => `new Promise(r => { let i = ${n}; const next = () => (--i ? requestAnimationFrame(next) : r(0)); requestAnimationFrame(next); })`;

test('a fitted week and a chart at its width, in a pane resized ten times, report no ResizeObserver loop and end as drawn at the last width', async () => {
  await json('show_view', { name: 'week', title: 'Uke 48', panels: [
    { id: 'jobs', card: 'events', from: week, layout: 'week' },
    { id: 'temp', card: 'line-chart', from: temps, x: 'day', y: ['temp'] },
  ] });
  const view = shown.filter(v => v.name === 'week').at(-1)!;
  const resized = await drawnAt(view, 1200), fresh = await drawnAt(view, 640);
  try {
    for (const width of [460, 900, 380, 1200, 520, 1000, 300, 760, 460, 640]) {
      await resized.evaluate((w: number) => (window as any).app.width(w), width);
      await resized.evaluate(frames(2));
    }
    await resized.evaluate(frames(4)); await fresh.evaluate(frames(4));
    assert.deepEqual(await resized.evaluate(() => (window as any).errors), [], 'no ResizeObserver loop');
    const [after, direct] = [await resized.evaluate(look), await fresh.evaluate(look)];
    assert.equal(after.wide, 0, 'every title fits its slot');
    assert.ok(direct.titles.some((t: string) => t.endsWith('…')) && direct.titles.some((t: string) => t.length > 1), JSON.stringify(direct.titles)); // some cut, some words kept
    assert.deepEqual(after.titles, direct.titles, 'cut as when drawn at that width');
    assert.ok(direct.chart.length > 0);
    assert.equal(after.chart, direct.chart, 'the chart drawn at that width');
  } finally { await resized.close(); await fresh.close(); }
});
