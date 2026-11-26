// Charts as the person reads them: the legend names each series in words, with a unit it ends in kept readable; a date
// on the x axis is the locale's short date, and a large number the locale's compact one; and in Chromium the chart
// fills its pane's width, drawn again there at that width, its strips over its categories. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page as BrowserPage } from 'playwright';
import { startVindu, memoryResults, readableName, type Shown } from '../src/index.js';
import { chartSvg } from '../src/chart-svg.js';
import { chromium, mcpClient, shellServer } from './helpers.js';

/** The SVG of a chart's data: URL, as text. */
const svgOf = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8');
/** The text of each <text> in an SVG, in order. */
const textsOf = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const weather = ['23', '24', '25', '26', '27'].map((d, i) => ({
  dag: `2026-11-${d}`,
  vind_ms: 4 + i * 1.5,
  nedbør_mm: [0, 2.5, 7, 1, 0][i],
}));

test('a name as a person reads it: its words, and the unit it ends in, if any, in parentheses', () => {
  assert.deepEqual(
    ['vind_ms', 'nedbør_mm', 'windSpeedMs', 'amount_nok', 'temp_c', 'send_reminder', 'invoiceTotal', 'mm'].map(
      readableName,
    ),
    [
      'vind (m/s)',
      'nedbør (mm)',
      'wind speed (m/s)',
      'amount (NOK)',
      'temp (°C)',
      'send reminder',
      'invoice total',
      'mm',
    ],
  );
});

test("a line chart's legend says what each series is, and its x axis says each day in the locale's short date", () => {
  for (const [locale, day] of [
    ['nb-NO', '23.11.2026'],
    ['nn-NO', '23.11.2026'],
    ['en-GB', '23/11/2026'],
  ] as const) {
    const texts = textsOf(svgOf(chartSvg('line-chart', weather, 'dag', ['vind_ms', 'nedbør_mm'], 900, locale)));
    assert.ok(texts.includes('vind (m/s)') && texts.includes('nedbør (mm)'), `${locale}: ${texts.join(' | ')}`);
    assert.ok(!texts.includes('vind_ms') && !texts.includes('2026-11-23'), `${locale}: no raw key, no ISO date`);
    assert.ok(texts.includes(day), `${locale}: ${texts.join(' | ')}`);
  }
  // a label is never cut by its neighbour's room: as many are drawn as there is room for, each whole
  const narrow = textsOf(svgOf(chartSvg('line-chart', weather, 'dag', ['vind_ms'], 360, 'nb-NO')));
  assert.ok(
    narrow.filter((t) => /^\d\d\.11\.2026$/.test(t)).length >= 2 && !narrow.some((t) => t.endsWith('…')),
    narrow.join(' | '),
  );
  // a large number in the locale's compact form
  const big = textsOf(
    svgOf(
      chartSvg(
        'bar-chart',
        [
          { m: 'jan', kr: 12_000 },
          { m: 'feb', kr: 18_000 },
        ],
        'm',
        ['kr'],
        640,
        'nb-NO',
      ),
    ),
  );
  assert.ok(big.includes('10k') && !big.includes('10K'), big.join(' | '));
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charts-'));
const results = memoryResults(dir);
const read = results.add({ server: 'weather', tool: 'forecast', value: weather }).id;
const vindu = await startVindu({ waitMs: 300, locale: 'nb-NO' });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir }, { onView: (v) => shown.push(v) });
const { mcp, json } = await mcpClient(ui.url);
const server = await shellServer(import.meta.dirname, 'app.html'),
  browser = await chromium.launch();
afterAll(async () => {
  await browser.close();
  server.close();
  await mcp.close();
  ui.close();
  await vindu.close();
});

test('in a pane of 900 px the chart fills its width, drawn there at that width, with its strips over the plot', async () => {
  await json('show_view', {
    name: 'weather',
    title: 'Vær',
    panels: [{ id: 'wind', card: 'line-chart', from: read, x: 'dag', y: ['vind_ms', 'nedbør_mm'] }],
  });
  const page: BrowserPage = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  try {
    await page.goto(server.url);
    await page.evaluate((v) => {
      window.app.width(900);
      window.app.catalog('view', v, { theme: true });
    }, shown.at(-1)!);
    const box = () =>
      page.evaluate(() => {
        const chart = document.querySelector<HTMLElement>('vindu-chart .vb-chart')!,
          img = chart.querySelector('img')!,
          strips = chart.querySelector<HTMLElement>('.vb-strips')!;
        const c = chart.getBoundingClientRect(),
          i = img.getBoundingClientRect(),
          s = strips.getBoundingClientRect();
        return {
          pane: document.getElementById('view')!.clientWidth,
          chart: c.width,
          image: i.width,
          natural: img.naturalWidth,
          left: s.left - i.left,
          right: i.right - s.right,
        };
      });
    await page.waitForFunction(
      () => {
        const img = document.querySelector<HTMLImageElement>('vindu-chart img');
        return !!img && img.complete && img.naturalWidth > 700;
      },
      null,
      { timeout: 5000 },
    );
    const b = await box();
    assert.ok(b.chart >= b.pane * 0.95, JSON.stringify(b)); // its box: the pane's width, but for the card's own padding
    assert.ok(Math.abs(b.image - b.chart) <= 1 && Math.abs(b.natural - b.chart) <= 1, JSON.stringify(b)); // drawn at that width, not scaled
    assert.ok(Math.abs(b.left - 56) <= 1 && Math.abs(b.right - 24) <= 1, JSON.stringify(b)); // the strips over the plot
    // narrower, it is drawn again narrower
    await page.evaluate(() => window.app.width(700));
    await page.waitForFunction(
      () => {
        const img = document.querySelector<HTMLImageElement>('vindu-chart img');
        return !!img && img.naturalWidth < 700 && img.naturalWidth > 600;
      },
      null,
      { timeout: 5000 },
    );
  } finally {
    await page.close();
  }
});
