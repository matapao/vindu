// A week that carries its weather, drawn in Chromium in Bokmål: each day its symbol, lowest and highest temperature,
// precipitation and wind, worked out by the system from a forecast's instants wherever they sit in it; the warnings as
// a strip in their level's colour over the columns of the days they cover; the tasks on the day each is due; the hours
// still lined up with the days; and the account saying what the system worked out, from what. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page as BrowserPage } from 'playwright';
import { memoryResults, startVindu, VIEW_WORDS_NB, type Shown } from '../src/index.js';
import { chromium, mcpClient, shellServer } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'week-'));
const results = memoryResults(dir);
const events = results.add({ server: 'calendar', tool: 'list_events', value: [
  { title: 'Befaring', start: '2030-03-04T08:00:00+01:00', end: '2030-03-04T09:00:00+01:00' },
  { title: 'Levering av takstein', start: '2030-03-05T10:00:00+01:00', end: '2030-03-05T11:30:00+01:00' },
  { title: 'Sluttkontroll', start: '2030-03-07T13:00:00+01:00', end: '2030-03-07T14:00:00+01:00' },
] }).id;
const instant = (time: string, air: number, wind: number, symbol: string, rain: number) =>
  ({ time, data: { instant: { details: { air_temperature: air, wind_speed: wind } }, next_1_hours: { summary: { symbol_code: symbol }, details: { precipitation_amount: rain } } } });
const forecast = results.add({ server: 'weather', tool: 'forecast', value: { type: 'Feature', properties: { timeseries: [
  instant('2030-03-04T05:00:00Z', 2.2, 3.1, 'cloudy', 0.4),
  instant('2030-03-04T11:00:00Z', 6.8, 5.4, 'partlycloudy_day', 0),
  instant('2030-03-04T17:00:00Z', 4.1, 4.0, 'rain', 1.1),
  instant('2030-03-05T11:00:00Z', 9, 2, 'clearsky_day', 0),
  instant('2030-03-06T11:00:00Z', -1.4, 7.2, 'snow', 3),
] } } }).id;
const warnings = results.add({ server: 'weather', tool: 'warnings', value: { features: [
  { type: 'Feature', properties: { awareness_level: '3; orange; Severe', event: 'regn', area: 'Vestland', onset: '2030-03-04T07:00:00+01:00', expires: '2030-03-05T18:00:00+01:00' } },
  { type: 'Feature', properties: { awareness_level: '2; yellow; Moderate', event: 'vind', area: 'Hordaland', onset: '2030-03-06T12:00:00+01:00', expires: '2030-03-06T20:00:00+01:00' } },
] } }).id;
const tasks = results.add({ server: 'work', tool: 'todo', value: [
  { title: 'Bestill stillas', due: '2030-03-05', status: 'open' },
  { title: 'Send tilbud', due: '2030-03-05T15:00:00+01:00', status: 'open' },
  { title: 'Kjøp takstein', due: '2030-03-06', status: 'done' },
] }).id;

const vindu = await startVindu({ waitMs: 300 });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), locale: 'nb-NO', timeZone: 'Europe/Oslo', viewWords: VIEW_WORDS_NB });
const { mcp, json } = await mcpClient(ui.url);
const server = await shellServer(import.meta.dirname, 'app.html'), browser = await chromium.launch();
afterAll(async () => { await browser.close(); server.close(); await mcp.close(); ui.close(); await vindu.close(); });
const last = (name: string) => shown.filter(v => v.name === name).at(-1)!;
const PANEL = { id: 'week', card: 'events', from: events, forecast, warnings, tasks };

async function drawn(view: Shown): Promise<BrowserPage> {
  const page: BrowserPage = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  await page.goto(server.url);
  await page.evaluate(v => { (window as any).app.width(1040); (window as any).app.catalog('view', v, { theme: true }); }, view);
  await page.locator('vindu-events .vb-dayhead').first().waitFor();
  return page;
}
const plain = (s: string) => s.replace(/[  ]/g, ' ').replace(/−/g, '-');

test('a week in Bokmål carries each day\'s weather, the warnings over the days they cover and the tasks due on each day', async () => {
  const account = await json('show_view', { name: 'week', title: 'Uke 10', panels: [{ ...PANEL, layout: 'week' }] });
  const page = await drawn(last('week'));
  try {
    const days = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('vindu-events .vb-day')].map(day => {
      const head = day.querySelector('.vb-dayhead')!;
      return {
        sign: head.querySelector('.vb-wsign')?.textContent ?? '', said: head.querySelector('.vb-wsign')?.getAttribute('aria-label') ?? '',
        temps: head.querySelector('.vb-temps')?.textContent ?? '', rain: head.querySelector('.vb-rain')?.textContent ?? '', wind: head.querySelector('.vb-wind')?.textContent ?? '',
        tasks: [...head.querySelectorAll('.vb-duetasks li')].map(li => [(li.textContent ?? '').trim(), li.classList.contains('vb-done'), li.getAttribute('aria-label')]),
        box: (() => { const b = day.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; })(),
      };
    }));
    assert.equal(days.length, 7, 'seven days in a row, from the first event\'s');
    assert.deepEqual(days.slice(0, 3).map(d => [d.sign, d.said, plain(d.temps), plain(d.rain), plain(d.wind)]), [
      ['⛅', 'partly cloudy, day', '2° / 7°', '1,5 mm', '5,4 m/s'],
      ['☀', 'clearsky, day', '9° / 9°', '0 mm', '2 m/s'],
      ['❄', 'snow', '-1° / -1°', '3 mm', '7,2 m/s'],
    ]);
    assert.deepEqual(days[3].temps, '', 'no forecast for that day: nothing said of it');
    assert.deepEqual(days[1].tasks, [['☐ Bestill stillas', false, 'Frist: Bestill stillas'], ['☐ Send tilbud', false, 'Frist: Send tilbud']]);
    assert.deepEqual(days[2].tasks, [['☑ Kjøp takstein', true, 'Frist: Kjøp takstein']]);
    const strips = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('vindu-events .vb-warnband .vb-warn')].map(w => {
      const b = w.getBoundingClientRect();
      return { level: [...w.classList].find(c => c.startsWith('vb-level-')), text: w.textContent ?? '', box: [Math.round(b.left), Math.round(b.right)], colour: getComputedStyle(w).borderLeftColor };
    }));
    assert.equal(strips.length, 2);
    assert.equal(strips[0].level, 'vb-level-orange');
    assert.match(plain(strips[0].text), /^Oransje farevarsel · regn · Vestland · 4\. mars 2030.*07:00 – 5\. mars 2030.*18:00$/);
    assert.deepEqual(strips[0].box, [days[0].box[0], days[1].box[1]], 'over the columns of the two days it covers');
    assert.deepEqual([strips[1].level, strips[1].box], ['vb-level-yellow', [days[2].box[0], days[2].box[1]]]);
    assert.notEqual(strips[0].colour, strips[1].colour);
    // the hours still line up with the days, however tall their heads are
    const lined = await page.evaluate(() => {
      const hours = document.querySelector('vindu-events .vb-hours div')!.getBoundingClientRect().top;
      return [...document.querySelectorAll('vindu-events .vb-daybody')].map(b => Math.round(b.getBoundingClientRect().top - hours));
    });
    assert.deepEqual([...new Set(lined)], [0]);
    // its account says what the system worked out, from what
    const panel = account.panels[0];
    assert.match(panel.weather, new RegExp(`^computed by the system from 5 instants of ${forecast}, by day in Europe/Oslo: the symbol nearest midday, the lowest and highest temperature, the precipitation added up and the strongest wind, on 3 days$`));
    assert.deepEqual(panel.warnings, ['orange · regn · Vestland · 2030-03-04 to 2030-03-05', 'yellow · vind · Hordaland · 2030-03-06 to 2030-03-06']);
    assert.equal(panel.tasks, '3 due on 2 days, each on the day it is due');
  } finally { await page.close(); }
});

test('an agenda carries the same: each day with its weather and tasks, and the warnings that cover it under its date', async () => {
  await json('show_view', { name: 'agenda', title: 'Uke 10', panels: [PANEL] });
  const page = await drawn(last('agenda'));
  try {
    const heads = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('vindu-events .vb-agenda > .vb-dayhead')].map(h => ({
      temps: h.querySelector('.vb-temps')?.textContent ?? '',
      warned: (() => { const out: string[] = []; for (let n = h.nextElementSibling; n?.classList.contains('vb-warn'); n = n.nextElementSibling) out.push(n.className); return out; })(),
    })));
    assert.deepEqual(heads.map(h => plain(h.temps)), ['2° / 7°', '9° / 9°', '-1° / -1°', '']);
    assert.deepEqual(heads.map(h => h.warned), [['vb-warn vb-level-orange'], ['vb-warn vb-level-orange'], ['vb-warn vb-level-yellow'], []]);
  } finally { await page.close(); }
});

test('a forecast with no instants in it is refused, with what it needs', async () => {
  const bad = results.add({ server: 'weather', tool: 'forecast', value: { note: 'no data' } }).id;
  const r = await mcp.callTool({ name: 'show_view', arguments: { name: 'none', title: 'None', panels: [{ card: 'events', from: events, forecast: bad }] } }) as { content: { text: string }[] };
  assert.match(r.content[0].text, /panel events: forecast: no time series of instants in it/);
});

test('show_view tells the model to compose a week this way when it has forecast or warning data', async () => {
  const { tools } = await mcp.listTools();
  const show = tools.find(t => t.name === 'show_view')!;
  assert.match(show.description ?? '', /A week with forecast or warning data is one events panel that carries them/);
  assert.match(JSON.stringify(show.inputSchema), /A week carries its weather: with forecast \(a time series of instants with temperature, precipitation and wind\), warnings/);
  assert.match(JSON.stringify(show.inputSchema), /no line chart of temperatures by date and no list of warnings beside it/);
});
