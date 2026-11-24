// Dates and plans, by the system: a deadline worked out from a date in each row (days, weeks, months, working days),
// and a calendar the person and the model plan in, by moving events to new times. A plan is the view's own, not saved:
// the account gives it as a change set (before and after) an operation can take, with the clashes the system found.
// In Chromium: an event dragged to another time, and moved with Alt and the arrows. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, addDates, addTime, dayOf, parseDateExpr, whenIn, applyAction, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };

test('a date worked out for each row, exactly: days, weeks, months to the last day, working days past weekends and holidays', () => {
  assert.equal(addTime('2026-11-13', { sign: 1, n: 1, unit: 'working day' }), '2026-11-16'); // a Friday: the next working day is Monday
  assert.equal(addTime('2026-11-16', { sign: -1, n: 1, unit: 'working day' }), '2026-11-13');
  assert.equal(addTime('2026-12-23', { sign: 1, n: 2, unit: 'working day' }, new Set(['2026-12-24', '2026-12-25'])), '2026-12-29');
  assert.equal(addTime('2026-01-31', { sign: 1, n: 1, unit: 'month' }), '2026-02-28');
  assert.equal(addTime('2028-01-31', { sign: 1, n: 1, unit: 'month' }), '2028-02-29'); // a leap year
  assert.equal(addTime('2026-03-31', { sign: -1, n: 1, unit: 'month' }), '2026-02-28');
  assert.equal(addTime('2026-12-28', { sign: 1, n: 2, unit: 'week' }), '2027-01-11');
  assert.deepEqual(parseDateExpr('invoice_date + 30 working days'), { from: 'invoice_date', sign: 1, n: 30, unit: 'working day' });
  assert.throws(() => parseDateExpr('invoice_date + 30 fortnights'), /a date field or today, then \+ or - a number of days, weeks, months or working days/);
  const rows = [{ number: 'INV-2026-0412', invoice_date: '2026-10-15' }, { number: 'INV-2026-0418', invoice_date: '2026-10-31T23:30:00Z' }, { number: 'INV-2026-0431', invoice_date: 'unknown' }];
  const got = addDates(rows, { due: 'invoice_date + 30 days', remind: 'invoice_date + 10 working days' }, { timeZone: 'Europe/Oslo', holidays: ['2026-10-26'] });
  assert.deepEqual(got.rows.map(r => [r.due, r.remind]), [['2026-11-14', '2026-10-30'], ['2026-12-01', '2026-11-13'], [null, null]]); // 23:30 UTC is Sunday 1 November in Oslo
  assert.deepEqual(got.empty, { due: 1, remind: 1 });
  assert.deepEqual(rows[0], { number: 'INV-2026-0412', invoice_date: '2026-10-15' }); // the rows themselves are kept
});

test('a day the calendar does not have is no day: never rolled over into the next month', () => {
  assert.equal(dayOf('2026-02-30'), null);
  assert.equal(dayOf('2026-02-30T10:00:00Z'), null); // a time on it, too
  assert.equal(dayOf('2026-02-28T23:30:00Z', 'Europe/Oslo'), '2026-03-01'); // a real time, on the day it is in the time zone
  assert.equal(whenIn('2026-02-30', 'en-GB', 'UTC', false), '2026-02-30'); // shown as written
  assert.equal(whenIn('2026-03-02', 'en-GB', 'UTC', false), '2 Mar 2026');
  const got = addDates([{ sent: '2026-02-30T10:00:00Z' }, { sent: '2026-02-27' }], { reply_by: 'sent + 1 day' });
  assert.deepEqual(got.rows.map(r => r.reply_by), [null, '2026-02-28']);
  assert.deepEqual(got.empty, { reply_by: 1 });
});

const week = [
  { id: 'e1', title: 'Standup', start: '2026-11-16T08:00:00Z', end: '2026-11-16T08:15:00Z' },
  { id: 'e2', title: 'Havgap review', start: '2026-11-16T10:00:00Z', end: '2026-11-16T11:00:00Z', where: 'Room 2' },
  { id: 'e3', title: 'Audit prep', start: '2026-11-17T09:00:00Z', end: '2026-11-17T10:30:00Z' },
];
async function windowWith() {
  const vindu = await startVindu({ waitMs: 300, timeZone: 'UTC', holidays: ['2026-10-26'] });
  const dir = tmp('plan-'), results = memoryResults(dir);
  results.add({ server: 'calendar', tool: 'list_events', value: week });
  results.add({ server: 'accounts', tool: 'list_invoices', value: [{ number: 'INV-2026-0412', invoice_date: '2026-10-15' }] });
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { st.s = s; } });
  const c = await mcpClient(ui.url);
  const last = (name: string) => shown.filter(v => v.name === name).at(-1)!;
  const rowsOf = (name: string, pid: string) => ((last(name).wide.find((m: any) => m.updateDataModel) as any).updateDataModel.value.panels[pid].rows as any[]);
  const markOf = (name: string) => st.s!.views.find(v => v.name === name)?.mark;
  return { vindu, ui, ...c, shown, st, last, rowsOf, markOf, close: async () => { await c.mcp.close(); ui.close(); await vindu.close(); } };
}

test("a deadline in a view is the system's: worked out for each row, with the host's holidays, and the account says how", async () => {
  const w = await windowWith();
  try {
    const acc = await w.json('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r2', dates: { remind: 'invoice_date + 10 working days' } }] });
    const p = acc.panels.find((x: any) => x.id === 'rows');
    assert.deepEqual(p.steps.find((x: any) => x.dates), { dates: { remind: 'invoice_date + 10 working days' }, holidays: 1 });
    assert.ok(JSON.stringify(w.last('inv').wide).includes('2026-10-30')); // 15 October + 10 working days, past 26 October
  } finally { await w.close(); }
});

test('a calendar to plan in: the model moves an event, the system marks the clash, the account has the change set; undone, and the person moves one', async () => {
  const w = await windowWith();
  try {
    await w.json('show_view', { name: 'cal', title: 'This week', panels: [{ id: 'wk', card: 'events', from: 'r1', layout: 'week' }] });
    const r = await w.json('act_in_view', { view: 'cal', action: 'plan', key: 'e2', start: '2026-11-17T09:30:00Z' });
    assert.equal(r.did, 'moved Havgap review to 2026-11-17T09:30:00Z in This week (a plan, not saved)');
    const p = r.view.panels.find((x: any) => x.id === 'wk');
    assert.match(p.planned, /^1 moved by hand in the window, not saved: to save, run the operation that saves events with these changes, which asks the person$/);
    assert.deepEqual(p.changes, [{ key: 'e2', title: 'Havgap review', before: { start: '2026-11-16T10:00:00Z' }, after: { start: '2026-11-17T09:30:00Z', end: '2026-11-17T10:30:00.000Z' } }]); // its length kept
    assert.deepEqual(p.clashes, ['Havgap review overlaps Audit prep']);
    assert.deepEqual(r.view.suggestions, [{ label: 'Find a free time', by: 'system' }]); // a cue, offered on the pane
    assert.ok(JSON.stringify(w.last('cal').wide).includes('In This week, Havgap review now overlaps Audit prep. Find a time for it that clashes with nothing.'));
    assert.deepEqual(w.markOf('cal'), { text: 'Planned by hand, not saved', by: 'model', undo: true });
    const sent = JSON.stringify(w.last('cal').wide);
    assert.ok(sent.includes('"planned_from":"2026-11-16T10:00:00Z"') && sent.includes('"clashes":["Audit prep"]'));
    // what cannot be planned is refused, with why
    assert.match((await w.call('act_in_view', { view: 'cal', action: 'plan', key: 'e9', start: '2026-11-17T09:30:00Z' })).text, /no event "e9" in This week; its events: e1, e3, e2/); // as shown: by time, the planned one where it is now
    assert.match((await w.call('act_in_view', { view: 'cal', action: 'plan', key: 'e1', start: 'Tuesday' })).text, /plan needs start, a time/);
    await w.json('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r2' }] });
    assert.match((await w.call('act_in_view', { view: 'inv', action: 'plan', key: 'INV-2026-0412', start: '2026-11-17T09:30:00Z' })).text, /Invoices is not events: plan moves events in a calendar/);
    // the model undoes its own plan
    assert.equal((await w.json('act_in_view', { view: 'cal', action: 'undo' })).did, 'undid "moved Havgap review to 2026-11-17T09:30:00Z in This week (a plan, not saved)"');
    assert.equal(JSON.stringify(w.last('cal').wide).includes('planned_from'), false);
    // the person drags the standup half an hour on: the window sends the place and the new time, and the model is told
    const n = w.shown.length;
    assert.equal(w.ui.event({ type: 'view', view: 'cal', action: 'plan', panel: 'wk', from: 0, start: '2026-11-16T08:30:00.000Z', end: '2026-11-16T08:45:00.000Z' }), true);
    await until(() => w.shown.length > n && JSON.stringify(w.last('cal').wide).includes('planned_from')); await sleep(30);
    assert.deepEqual(w.markOf('cal'), { text: 'Planned by hand, not saved', by: 'person', undo: true });
    // the person's change the model has not been told of comes first: the model's next plan waits
    assert.match((await w.call('act_in_view', { view: 'cal', action: 'plan', key: 'e3', start: '2026-11-18T09:00:00Z' })).text, /the person changed "cal" since you were last told \(the person moved Standup/);
    assert.match(w.ui.delta(), /the person moved Standup to 2026-11-16T08:30:00.000Z in This week \(a plan, not saved\)/);
    // plan needs an events panel, in the pure function too
    assert.deepEqual(applyAction({ panels: [{ id: 'x', card: 'table', from: 'r1' }] }, { x: { rows: week } }, { action: 'plan', key: 'e1', start: '2026-11-17T09:30:00Z' }, 'T'), { refusal: 'T is not events: plan moves events in a calendar' });
  } finally { await w.close(); }
});

test('in Chromium: an event is dragged to another time and day, and moved with Alt and an arrow', async () => {
  const w = await windowWith();
  await w.json('show_view', { name: 'cal', title: 'This week', panels: [{ id: 'wk', card: 'events', from: 'r1', layout: 'week' }] });
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => (window as any).app.shell('light'));
    const draw = async () => {
      const latest = new Map<string, Shown>(); for (const v of w.shown) latest.set(v.name, v);
      for (const v of latest.values()) await page.evaluate((x: Shown) => (window as any).app.view(x), v);
      await page.evaluate((s: ShellState) => (window as any).app.state(s), w.st.s!);
      await page.waitForTimeout(400);
    };
    await draw();
    const events = async () => (await page.evaluate(() => (window as any).app.events())) as any[];
    await events();
    const slots = page.locator('.vindu-pane[data-view="cal"] .vb-slot');
    assert.equal(await slots.count(), 3);
    // Alt and the down arrow: a quarter of an hour later
    await slots.nth(0).focus(); await page.keyboard.press('Alt+ArrowDown');
    assert.deepEqual((await events()).find(e => e.type === 'view'), { type: 'view', action: 'plan', panel: 'wk', from: 0, start: '2026-11-16T08:15:00.000Z', end: '2026-11-16T08:30:00.000Z', view: 'cal' });
    // Alt and the right arrow: a day later
    await slots.nth(1).focus(); await page.keyboard.press('Alt+ArrowRight');
    assert.deepEqual((await events()).find(e => e.type === 'view'), { type: 'view', action: 'plan', panel: 'wk', from: 1, start: '2026-11-17T10:00:00.000Z', end: '2026-11-17T11:00:00.000Z', view: 'cal' });
    // dragged onto the next day, at the same height: the same time, a day on (snapped to a quarter of an hour)
    const days = page.locator('.vindu-pane[data-view="cal"] .vb-daybody');
    const top = await slots.nth(1).evaluate((e: HTMLElement) => e.offsetTop); // where 10:00 is in a day's column
    await slots.nth(1).dragTo(days.nth(1), { sourcePosition: { x: 10, y: 4 }, targetPosition: { x: 20, y: top + 4 } });
    const dragged = (await events()).find(e => e.type === 'view');
    assert.equal(dragged?.action, 'plan'); assert.equal(dragged?.from, 1); assert.equal(dragged?.start, '2026-11-17T10:00:00.000Z');
    // the server plans it, and the window draws the moved event marked, with its clash
    w.ui.event(dragged); await until(() => w.markOf('cal') !== undefined); await sleep(50); await draw();
    assert.equal(await page.locator('.vindu-pane[data-view="cal"] .vb-slot.vb-moved').count(), 1);
    assert.equal(await page.locator('.vindu-pane[data-view="cal"] .vb-slot.vb-clash').count(), 1);
    assert.match(await page.locator('.vindu-pane[data-view="cal"] .vb-slot.vb-moved').getAttribute('title') ?? '', /moved from .*; overlaps Audit prep/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); await w.close(); }
});
