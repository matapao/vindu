// What each view's card says of what it holds, in one line, in the window's words and locale (English and Bokmål):
// for a host that draws views itself (onPresentation) and in the shell's state (each view's summary); who changed each
// view last, the model or the person; which views wait for the person; and how big each is. A week arriving as four
// views (a calendar, a forecast, warnings and a list of tasks) says something useful on every card. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryResults, startVindu, VIEW_WORDS_NB, whenIn, type ShellState, type ViewPresentation } from '../src/index.js';
import { mcpClient, tinyPdf } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ZONE = 'Europe/Oslo';
const vindu = await startVindu({ waitMs: 300 });
afterAll(() => vindu.close());

/** A window in a locale, with every view below shown in it: what a host's drawing got of each, and the shell's state. */
async function shownIn(locale: 'en-GB' | 'nb-NO') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summaries-')), results = memoryResults(dir);
  const file = (name: string, body: Uint8Array) => { const f = path.join(dir, name); fs.writeFileSync(f, body); return f; };
  const invoices = results.add({ server: 'accounts', tool: 'invoices', value: [
    { id: 'INV-1', customer: 'Brattli Verksted', amount_nok: 1200.5, status: 'overdue' },
    { id: 'INV-2', customer: 'Havgap Media', amount_nok: 3000, status: 'overdue' },
    { id: 'INV-3', customer: 'Lysvik Retail', amount_nok: 800, status: 'open' },
  ] }).id;
  const events = results.add({ server: 'calendar', tool: 'list_events', value: [
    { title: 'Befaring', start: '2030-03-04T08:00:00+01:00', end: '2030-03-04T09:00:00+01:00' },
    { title: 'Levering', start: '2030-03-05T10:00:00+01:00', end: '2030-03-05T11:00:00+01:00' },
    { title: 'Sluttkontroll', start: '2030-03-07T13:00:00+01:00', end: '2030-03-07T14:00:00+01:00' },
  ] }).id;
  const forecast = results.add({ server: 'weather', tool: 'forecast', value: [
    { time: '2030-03-04T05:00:00Z', air_temperature: 2.2, precipitation_amount: 0.4, wind_speed: 3.1, symbol_code: 'cloudy' },
    { time: '2030-03-04T11:00:00Z', air_temperature: 6.8, precipitation_amount: 0, wind_speed: 5.4, symbol_code: 'partlycloudy_day' },
    { time: '2030-03-04T17:00:00Z', air_temperature: 4.1, precipitation_amount: 1.1, wind_speed: 4.0, symbol_code: 'rain' },
    { time: '2030-03-05T11:00:00Z', air_temperature: 9, precipitation_amount: 0, wind_speed: 2, symbol_code: 'clearsky_day' },
  ] }).id;
  const warnings = results.add({ server: 'weather', tool: 'warnings', value: { features: [
    { type: 'Feature', properties: { awareness_level: '2; yellow; Moderate', event: 'wind', area: 'Hordaland', onset: '2030-03-04T12:00:00+01:00', expires: '2030-03-05T06:00:00+01:00' } },
    { type: 'Feature', properties: { awareness_level: '3; orange; Severe', event: 'rain', area: 'Vestland', onset: '2030-03-04T07:00:00+01:00', expires: '2030-03-05T18:00:00+01:00' } },
  ] } }).id;
  const flatWarnings = results.add({ server: 'weather', tool: 'alerts', value: [
    { title: 'Snow', level: 'red', area: 'Finnmark', from: '2030-03-06T00:00:00Z', to: '2030-03-06T12:00:00Z' },
  ] }).id;
  const tasks = results.add({ server: 'work', tool: 'todo', value: [
    { title: 'Bestill stillas', due: '2030-03-05', status: 'open' },
    { title: 'Send tilbud', due: '2030-03-06', status: 'open' },
    { title: 'Kjøp takstein', due: '2030-03-01', status: 'done' },
  ] }).id;
  const invoice = results.add({ server: 'accounts', tool: 'invoice', value: { number: 'F-77', currency: 'NOK', lines: [
    { description: 'Takarbeid', quantity: 2, price: 1000 }, { description: 'Beslag', quantity: 1, price: 500 },
  ] } }).id;
  const brief = results.attach('brief.pdf', 'application/pdf', file('brief.pdf', tinyPdf(3))).id;
  const photo = results.attach('dent.png', 'image/png', file('dent.png', PNG)).id;
  const presented = new Map<string, ViewPresentation>();
  const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { locale, timeZone: ZONE, ...(locale === 'nb-NO' ? { viewWords: VIEW_WORDS_NB } : {}),
    onPresentation: v => presented.set(v.name, v), onState: s => { st.s = s; } });
  const { mcp, json } = await mcpClient(ui.url);
  const show = (name: string, panels: Record<string, unknown>[]) => json('show_view', { name, title: name, panels });
  await show('totals', [{ card: 'kpi', title: 'Overdue', from: invoices, where: { status: 'overdue' }, value: 'sum(amount_nok)' }]);
  await show('invoices', [{ id: 'all', card: 'table', from: invoices }]);
  await show('customer', [{ card: 'record', data: { name: 'Brattli Verksted', org_no: 912345678, city: 'Bergen' } }]);
  await show('reply', [{ card: 'message', layout: 'draft', data: { to: ['kari@example.com'], subject: 'Tilbud på takarbeid', body: 'Hei Kari' } }]);
  await show('calendar', [{ card: 'events', from: events }]);
  await show('forecast', [{ card: 'line-chart', from: forecast, x: 'time', y: 'air_temperature' }]);
  await show('forecast-table', [{ card: 'table', from: forecast }]);
  await show('warnings', [{ card: 'notice', from: warnings, pick: 'features' }]);
  await show('alerts', [{ card: 'list', from: flatWarnings, label: 'title' }]);
  await show('todo', [{ card: 'tasks', from: tasks }]);
  await show('invoice', [{ card: 'money', from: invoice, pick: 'lines', layout: 'invoice' }]);
  await show('trend', [{ card: 'line-chart', rows: [{ month: 'Jan', sales: 10 }, { month: 'Feb', sales: 12.5 }], x: 'month', y: 'sales' }]);
  await show('brief', [{ card: 'pdf', media: brief }]);
  await show('photos', [{ card: 'gallery', media: [photo] }]);
  await show('pending', [{ card: 'table', awaits: { server: 'work', tool: 'profile' } }]);
  const failed = results.add({ server: 'work', tool: 'profile', text: 'The profile could not be loaded' });
  failed.error = true;
  ui.result(failed.id);
  for (let i = 0; i < 100 && presented.get('pending')?.panels[0].state !== 'error'; i++) await new Promise(r => setTimeout(r, 10));
  const line = (view: string) => presented.get(view)!.panels[0].summary.line.replace(/[  ]/g, ' ');
  return { ui, mcp, presented, st, line };
}
const when = (v: string, locale: string, withTime = true) => whenIn(v, locale, ZONE, withTime).replace(/[  ]/g, ' ');
const day = (d: string, locale: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

test('each card says what it holds in one line, in English and in Bokmål, numbers and dates as the locale writes them', async () => {
  const en = await shownIn('en-GB'), nb = await shownIn('nb-NO');
  try {
    const expected = {
      totals: ['4,200.5', '4 200,5'],
      invoices: ['3 rows · total NOK 5,000.50', '3 rader · sum 5 000,50 kr'],
      customer: ['Brattli Verksted', 'Brattli Verksted'],
      reply: ['To kari@example.com · Tilbud på takarbeid', 'Til kari@example.com · Tilbud på takarbeid'],
      calendar: [`next: Befaring, ${when('2030-03-04T08:00:00+01:00', 'en-GB')} · 3 events`, `neste: Befaring, ${when('2030-03-04T08:00:00+01:00', 'nb-NO')} · 3 avtaler`],
      forecast: [`${day('2030-03-04', 'en-GB')}: ⛅ 2° to 7°`, `${day('2030-03-04', 'nb-NO')}: ⛅ 2° til 7°`],
      'forecast-table': [`${day('2030-03-04', 'en-GB')}: ⛅ 2° to 7°`, `${day('2030-03-04', 'nb-NO')}: ⛅ 2° til 7°`],
      warnings: [`Orange · Vestland · from ${when('2030-03-04T07:00:00+01:00', 'en-GB')}`, `Oransje · Vestland · fra ${when('2030-03-04T07:00:00+01:00', 'nb-NO')}`],
      alerts: [`Red · Finnmark · from ${when('2030-03-06T00:00:00Z', 'en-GB')}`, `Rødt · Finnmark · fra ${when('2030-03-06T00:00:00Z', 'nb-NO')}`],
      todo: [`2 open · next due ${when('2030-03-05', 'en-GB', false)}: Bestill stillas`, `2 åpne · neste frist ${when('2030-03-05', 'nb-NO', false)}: Bestill stillas`],
      invoice: ['NOK 2,500.00 due', '2 500,00 kr å betale'],
      trend: ['last 12.5 · up', 'sist 12,5 · opp'],
      brief: ['3 pages', '3 sider'],
      photos: ['1 item', '1 element'],
      pending: ['failed: work.profile failed (r8): The profile could not be loaded', 'feilet: work.profile failed (r8): The profile could not be loaded'],
    };
    for (const [view, [english, bokmal]] of Object.entries(expected)) {
      assert.equal(en.line(view), english, `${view} in English`);
      assert.equal(nb.line(view), bokmal, `${view} in Bokmål`);
    }
    // what it is, and its title; a picture where one says more, at the address the window loads it from
    assert.deepEqual([en.presented.get('totals')!.panels[0].summary.kind, en.presented.get('totals')!.panels[0].summary.title], ['kpi', 'Overdue']);
    assert.deepEqual([en.presented.get('calendar')!.panels[0].summary.kind, en.presented.get('calendar')!.panels[0].summary.title], ['events', 'calendar']);
    assert.match(en.presented.get('photos')!.panels[0].summary.thumbnail ?? '', /^http:\/\/[^/]+\.localhost:\d+\/media\/a2/);
    assert.equal(en.presented.get('invoices')!.panels[0].summary.thumbnail, undefined);
    // the shell's state carries the same lines, view by view
    const shelled = en.st.s!.views.find(v => v.name === 'todo')!.summary!;
    assert.equal(shelled.panels[0].line, en.presented.get('todo')!.panels[0].summary.line);
  } finally {
    for (const w of [en, nb]) { await w.mcp.close(); w.ui.close(); }
  }
});

test('who changed a view last: the model as it shows it, then the person acting in it; what waits for the person, and how big each view is', async () => {
  const en = await shownIn('en-GB');
  try {
    const before = en.presented.get('invoices')!;
    assert.equal(before.changed.by, 'model');
    assert.ok(Date.parse(before.changed.at) <= Date.now());
    assert.ok(en.ui.event({ type: 'view', view: 'invoices', action: 'sort', panel: 'all', field: 'amount_nok', dir: 'desc' }));
    for (let i = 0; i < 100 && en.presented.get('invoices')!.seq === before.seq; i++) await new Promise(r => setTimeout(r, 10));
    const after = en.presented.get('invoices')!;
    assert.equal(after.changed.by, 'person');
    assert.ok(after.changed.at >= before.changed.at);
    assert.deepEqual(en.st.s!.views.find(v => v.name === 'invoices')!.summary!.changed, after.changed);
    // a mail not sent yet and a call that failed wait for the person; nothing else does
    const waiting = [...en.presented.values()].filter(v => v.waits).map(v => v.name).sort();
    assert.deepEqual(waiting, ['pending', 'reply']);
    assert.deepEqual(en.st.s!.views.filter(v => v.summary?.waits).map(v => v.name).sort(), ['pending', 'reply']);
    // a kpi and a short record are small; notices alone are a notice; the rest are neither
    const sizes = Object.fromEntries([...en.presented.values()].filter(v => v.size).map(v => [v.name, v.size]));
    assert.deepEqual(sizes, { totals: 'small', customer: 'small', warnings: 'notice' });
  } finally { await en.mcp.close(); en.ui.close(); }
});

test('an hours sheet says the total it declares, never its hourly rates added up; a computed amount outranks a given one, and rates alone give no total', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summaries-hours-')), results = memoryResults(dir);
  // 24 days: 12 at 650 an hour (94 hours) and 12 at 850 (76 hours), so the rates add up to 18 000 and the hours to 125 700
  const hoursAt = (rate: number, hours: number[]) => hours.map((timer, i) => ({ dato: `2026-11-${String(i + 2).padStart(2, '0')}`, ansatt: rate === 650 ? 'Lærling' : 'Snekker', prosjekt: 'Tilbygg', aktivitet: 'Arbeid', timer, timepris: rate }));
  const hours = results.add({ server: 'work', tool: 'hours', value: [...hoursAt(650, [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7]), ...hoursAt(850, [7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6])] }).id;
  const prices = results.add({ server: 'shop', tool: 'prices', value: [{ vare: 'Takstein', enhetspris: 32, unit_price: 32, rate: 1 }, { vare: 'Lekter', enhetspris: 18, unit_price: 18, rate: 1 }] }).id;
  const given = results.add({ server: 'shop', tool: 'orders', value: [{ vare: 'Takstein', antall: 10, pris: 32, beløp: 320 }, { vare: 'Lekter', antall: 5, pris: 18, beløp: 90 }] }).id;
  const presented = new Map<string, ViewPresentation>();
  const ui = vindu.open({ results, dir }, { locale: 'nb-NO', timeZone: ZONE, viewWords: VIEW_WORDS_NB, onPresentation: v => presented.set(v.name, v) });
  const { mcp, json } = await mcpClient(ui.url);
  try {
    const show = (name: string, panel: Record<string, unknown>) => json('show_view', { name, title: name, panels: [panel] });
    await show('sheet', { card: 'sheet', title: 'Timer', from: hours, compute: { sum: 'timer * timepris' }, totals: { Sum: 'sum(sum)' } });
    await show('computed', { card: 'table', from: hours, compute: { sum: 'timer * timepris' } });
    await show('raw', { card: 'table', from: hours });
    await show('rates', { card: 'table', from: prices });
    await show('given', { card: 'table', from: given, compute: { kostnad: 'antall * pris * 1.25' } });
    const line = (view: string) => presented.get(view)!.panels[0].summary.line.replace(/[  ]/g, ' ');
    assert.equal(line('sheet'), '24 rader · Sum 125 700', 'the total the sheet declares, as it labels it');
    assert.equal(line('computed'), '24 rader · sum 125 700,00', 'the amount the panel computes');
    assert.equal(line('raw'), '24 rader', 'hours and an hourly rate: nothing that adds up as money');
    assert.equal(line('rates'), '2 rader', 'prices per unit and rates are never added up');
    assert.equal(line('given'), '2 rader · sum 512,50', 'a computed amount before the one given');
  } finally { await mcp.close(); ui.close(); }
});
