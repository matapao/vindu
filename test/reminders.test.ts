// Reminders: set by the model or the person, with the time worked out by the system and said how; a due one is told to
// both: the bar's chip, the Reminders pane, the host's own notice, and the model's next prompt. Kept in the task's checkpoint,
// so a window opened again from it has them, and one that came due while it was closed is due at once. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, whenOf, instantOf, localOf, type Shown, type ShellState, type Reminder, type ViewCheckpoint } from '../src/index.js';
import { chromium, mcpClient, sleep, componentsIn, type SurfaceComponent } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const TZ = 'Europe/Oslo';
const iso = (ms: number) => new Date(ms).toISOString();

test('the system works out when, exactly: a time, a day, working days, a value read, minutes before; and says how', () => {
  const now = new Date('2026-11-12T09:00:00Z'); // a Thursday, 10:00 in Oslo
  const values: Record<string, string> = { 'ctx:r1#/0/due': '2026-11-30', 'ctx:r1#/0/start': '2026-11-30T14:00:00+01:00', 'ctx:r1#/0/customer': 'Havgap Media' };
  const read = (ref: string) => (Object.hasOwn(values, ref) ? { ok: true as const, value: values[ref] } : { ok: false as const, why: 'no such value' });
  const at = (q: string, holidays?: string[]) => { const w = whenOf(q, { timeZone: TZ, now, read, holidays }); if ('refusal' in w) throw new Error(w.refusal); return w; };
  assert.equal(iso(at('2026-11-30T14:00').ms), '2026-11-30T13:00:00.000Z'); // in the process's time zone
  assert.equal(iso(at('2026-11-30T13:00:00Z').ms), '2026-11-30T13:00:00.000Z'); // with its own offset
  assert.equal(iso(at('2026-11-30').ms), '2026-11-30T08:00:00.000Z'); assert.match(at('2026-11-30').how, /at 09:00, as a day alone is/);
  assert.equal(iso(at('2026-07-01').ms), '2026-07-01T07:00:00.000Z'); // summer time
  const w3 = at('today + 3 working days');
  assert.equal(iso(w3.ms), '2026-11-17T08:00:00.000Z'); assert.match(w3.how, /^today \(2026-11-12\) \+ 3 working days = 2026-11-17/); assert.match(w3.how, /no holidays given/);
  assert.equal(iso(at('today + 3 working days', ['2026-11-16']).ms), '2026-11-18T08:00:00.000Z'); // a holiday the host gives
  assert.equal(iso(at('tomorrow at 08:30').ms), '2026-11-13T07:30:00.000Z');
  assert.equal(iso(at('now + 2 hours').ms), '2026-11-12T11:00:00.000Z');
  const due = at('ctx:r1#/0/due - 2 working days at 10:00');
  assert.equal(iso(due.ms), '2026-11-26T09:00:00.000Z'); assert.match(due.how, /^ctx:r1#\/0\/due \(2026-11-30\) − 2 working days = 2026-11-26, at 10:00: Thu, 26 Nov 2026, 10:00, Europe\/Oslo/);
  assert.equal(iso(at('ctx:r1#/0/start - 30 minutes').ms), '2026-11-30T12:30:00.000Z');
  assert.equal(iso(at('ctx:r1#/0/start - 1 day').ms), '2026-11-29T13:00:00.000Z'); // a day before, at its own time of day
  assert.equal(iso(at('2026-01-31 + 1 month').ms), '2026-02-28T08:00:00.000Z'); // the month's last day
  // where the clocks change: a time the clock skips moves on by the gap; a time it shows twice is the first
  assert.deepEqual(localOf(instantOf('2026-03-29', '02:30', TZ), TZ), { day: '2026-03-29', hm: '03:30' });
  assert.equal(iso(instantOf('2026-10-25', '02:30', TZ)), '2026-10-25T00:30:00.000Z');
  const no = (q: string) => { const w = whenOf(q, { timeZone: TZ, now, read }); assert.ok('refusal' in w, q); return w.refusal; };
  assert.match(no('next friday'), /is not a time the system can work out/);
  assert.match(no('2026-02-30'), /not a day of the calendar/);
  assert.match(no('2026-11-30T25:00'), /not a time of the calendar/);
  assert.match(no('now + 2 hours at 10:00'), /at goes with days/);
  assert.match(no('today + 2 fortnights'), /"fortnights" is not a length of time/);
  assert.equal(no('ctx:r1#/0/customer + 1 day'), 'ctx:r1#/0/customer holds "Havgap Media", not a day or a time');
  assert.equal(no('ctx:r9#/0 + 1 day'), 'ctx:r9#/0: no such value');
});

async function windowWith(o: { dir?: string; arrange?: 'allow' | 'suggest' | 'off'; notices?: Reminder[] } = {}) {
  const vindu = await startVindu({ waitMs: 300, reminders: true, timeZone: TZ, ...(o.arrange ? { modelArrange: o.arrange } : {}) });
  const dir = o.dir ?? tmp('rem-'), results = memoryResults(dir);
  results.add({ server: 'accounts', tool: 'get_invoice', value: [{ number: 'INV-2026-0412', customer: 'Havgap Media', due: '2028-03-01' }] });
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const suggested: string[] = [];
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { st.s = s; }, onReminder: r => o.notices?.push(r), onSuggest: t => suggested.push(t) });
  const c = await mcpClient(ui.url);
  const last = (name: string) => shown.filter(v => v.name === name).at(-1);
  const texts = (name: string): string[] => {
    const surface = last(name)?.wide;
    return (surface?.some(m => m.updateComponents) ? componentsIn<SurfaceComponent & { text: string }>(surface) : []).filter(x => x.component === 'Text').map(x => x.text);
  };
  return { vindu, ui, dir, ...c, shown, st, last, texts, suggested, close: async () => { await c.mcp.close(); ui.close(); await vindu.close(); } };
}

test('the model sets a reminder from a value read: the system works out when, the person sees it, and the model only changes its own', async () => {
  const w = await windowWith();
  try {
    const r = await w.json('remind', { what: 'Chase Havgap Media for INV-2026-0412', when: 'ctx:r1#/0/due - 2 working days at 10:00', about: 'ctx:r1#/0' });
    assert.equal(r.set.id, 'm1'); assert.equal(r.set.at, '2028-02-28T09:00:00.000Z'); // Wednesday 1 March, less two working days: Monday, at 10:00 in Oslo
    assert.match(r.set.how, /^ctx:r1#\/0\/due \(2028-03-01\) − 2 working days = 2028-02-28, at 10:00/);
    assert.match(r.the_person, /in the Reminders pane/);
    assert.deepEqual(w.st.s!.reminders, { set: 1, due: 0 }); // the bar's chip
    assert.ok(w.st.s!.views.some(v => v.name === 'reminders')); // the model's shows, as far as the person lets it arrange
    assert.ok(w.texts('reminders').includes('Chase Havgap Media for INV-2026-0412'));
    assert.ok(w.texts('reminders').some(t => /^Set · Mon, 28 Feb 2028, 10:00 · set by the model · ctx:r1#\/0$/.test(t)));
    const look = await w.json('look', {});
    assert.deepEqual(look.reminders, [{ id: 'm1', what: 'Chase Havgap Media for INV-2026-0412', when: 'Mon, 28 Feb 2028, 10:00', at: '2028-02-28T09:00:00.000Z', state: 'set', by: 'you', about: 'ctx:r1#/0' }]);
    // what cannot be: refused, with why
    assert.match((await w.call('remind', { what: 'Yesterday', when: 'today - 1 day' })).text, /^not set: that is not to come: today \(.*\) − 1 day = .*; it is .* now$/);
    assert.match((await w.call('remind', { when: 'tomorrow' })).text, /needs what to come back to/);
    assert.match((await w.call('remind', { what: 'x', when: 'next friday' })).text, /is not a time the system can work out/);
    assert.equal((await w.call('show_view', { name: 'reminders', title: 'Mine', panels: [] })).ok, false); // the window's own pane
    // the person sets one of their own, in a form: what, and when, with a date and time input
    assert.equal(w.ui.event({ type: 'action', view: 'reminders', name: 'reminder_new', context: {} }), true);
    await until(() => w.shown.some(v => v.ask?.op === 'remind'));
    const a = w.shown.filter(v => v.ask?.op === 'remind').at(-1)!;
    const comps = componentsIn(a.wide);
    assert.deepEqual(comps.filter(x => x.component === 'DateTimeInput').map(x => [x.enableDate, x.enableTime]), [[true, true]]);
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:what': 'Too late', 'f:when': '2020-01-01T10:00' } });
    await until(() => w.shown.filter(v => v.ask?.op === 'remind').at(-1)!.ask!.error !== undefined);
    assert.match(w.shown.filter(v => v.ask?.op === 'remind').at(-1)!.ask!.error!, /^When: a time .* or later$/); // back to the person, never to the model
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:what': 'Call the auditor', 'f:when': '2028-05-02T08:15' }, by: { name: 'Kari', window: 'main' } });
    await until(() => w.ui.reminders().length === 2);
    const m2 = w.ui.reminders()[1];
    assert.deepEqual([m2.id, m2.by, m2.who, m2.at, m2.state], ['m2', 'person', 'Kari', '2028-05-02T06:15:00.000Z', 'set']); // 08:15 in Oslo, summer time
    assert.ok(w.texts('reminders').some(t => /^Set · Tue, 2 May 2028, 08:15 · set by Kari$/.test(t)));
    assert.match(w.ui.delta(), /Kari set reminder m2 \(p1\): "Call the auditor" for Tue, 2 May 2028, 08:15/);
    // the model changes only its own
    assert.match((await w.call('remind', { drop: 'm2' })).text, /m2 is the person's reminder: only they change it/);
    assert.deepEqual(await w.json('remind', { drop: 'm1' }), { did: 'dropped', reminder: { id: 'm1', what: 'Chase Havgap Media for INV-2026-0412' } });
    assert.deepEqual(w.st.s!.reminders, { set: 1, due: 0 });
    assert.equal((await w.json('look', {})).reminders_done, 1);
  } finally { await w.close(); }
});

test('a reminder comes due: the host is told (its notice), the bar and the pane say so, the model is told; the person puts it off or marks it done', async () => {
  const dir = tmp('due-'); const now = Date.now(); const notices: Reminder[] = [];
  const kept = (id: string, at: number, what: string): Reminder => ({ id, what, at: iso(at), said: 'then', how: 'given', by: id === 'm1' ? 'model' : 'person', state: 'set', set_at: iso(now - 86_400_000) });
  fs.writeFileSync(path.join(dir, 'reminders.jsonl'), [kept('m1', now + 600, 'Send the VAT report'), kept('m2', now - 7_200_000, 'Book the auditor')].map(r => JSON.stringify(r)).join('\n') + '\n');
  const w = await windowWith({ dir, notices });
  let saved: ViewCheckpoint | undefined;
  try {
    assert.deepEqual(notices.map(r => [r.id, r.state]), [['m2', 'due']]); // due while the window was closed: at once
    await until(() => notices.length === 2, 5000);                           // and the other on its time
    assert.equal(notices[1].id, 'm1');
    await until(() => w.st.s?.reminders?.due === 2);
    const told = w.ui.delta();
    assert.match(told, /reminder m2 is due \(it came due while the window was closed\): "Book the auditor", set by the person for then/);
    assert.match(told, /reminder m1 is due: "Send the VAT report", set by you for then/);
    assert.equal(w.ui.event({ type: 'reminders' }), true); // the bar's chip: the pane comes
    await until(() => !!w.last('reminders'));
    assert.deepEqual(w.texts('reminders').filter(t => t.startsWith('Due now')).length, 2);
    const buttons = componentsIn<SurfaceComponent & { action: { event: { context: Record<string, unknown> } } }>(w.last('reminders')!.wide).filter(x => x.component === 'Button').map(x => x.action.event);
    assert.deepEqual(buttons.filter(b => b.context.id === 'm1').map(b => b.context.do), ['done', 'hour', 'tomorrow', 'ask']);
    assert.equal(w.ui.event({ type: 'action', view: 'reminders', name: 'reminder', context: { id: 'm1', do: 'ask' } }), true); // into the prompt box, unsent
    assert.deepEqual(w.suggested, ['Reminder m1 is due: "Send the VAT report". What should be done now?']);
    assert.equal(w.ui.event({ type: 'action', view: 'reminders', name: 'reminder', context: { id: 'm1', do: 'done' } }), true);
    assert.equal(w.ui.event({ type: 'action', view: 'reminders', name: 'reminder', context: { id: 'm2', do: 'hour' } }), true);
    assert.equal(w.ui.event({ type: 'action', view: 'reminders', name: 'reminder', context: { id: 'm1', do: 'done' } }), false); // done already
    const [m1, m2] = w.ui.reminders();
    assert.equal(m1.state, 'done'); assert.equal(m1.done_by, 'person');
    assert.equal(m2.state, 'set'); assert.ok(Math.abs(Date.parse(m2.at) - Date.now() - 3_600_000) < 5000); assert.match(m2.how, /^put off at .*: an hour$/);
    assert.deepEqual(w.st.s!.reminders, { set: 1, due: 0 });
    assert.match(w.ui.delta(), /the person marked reminder m1 \("Send the VAT report"\) done; the person put off reminder m2 \("Book the auditor"\) to /);
    saved = w.ui.checkpoint();
  } finally { await w.close(); }
  assert.equal(fs.existsSync(path.join(dir, 'reminders.jsonl')), false); // the record went with the session
  // kept in the checkpoint: a task opened again from it has them, as they were
  const again = await windowWith();
  try {
    assert.deepEqual(await again.ui.restore(saved), []);
    assert.deepEqual(again.ui.reminders().map(r => [r.id, r.state]), [['m1', 'done'], ['m2', 'set']]);
    assert.deepEqual(again.st.s!.reminders, { set: 1, due: 0 });
    assert.equal(again.ui.delta(), ''); // nothing came due while it was closed
  } finally { await again.close(); }
});

test("where the person keeps the layout, the model's reminder waits in the bar", async () => {
  const w = await windowWith({ arrange: 'off' });
  try {
    const r = await w.json('remind', { what: 'Check the bank feed', when: 'tomorrow at 08:30' });
    assert.match(r.the_person, /in the bar/);
    assert.deepEqual(w.st.s!.reminders, { set: 1, due: 0 });
    assert.equal(w.st.s!.views.some(v => v.name === 'reminders'), false);
  } finally { await w.close(); }
});

test('in Chromium: the bar has a chip for the reminders, the pane has their buttons', async () => {
  const dir = tmp('chip-'); const now = Date.now();
  fs.writeFileSync(path.join(dir, 'reminders.jsonl'), JSON.stringify({ id: 'm1', what: 'Send the VAT report', at: iso(now - 60_000), said: 'today', how: 'given', by: 'person', state: 'set', set_at: iso(now - 86_400_000) }) + '\n');
  const w = await windowWith({ dir });
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => window.app.shell('light'));
    const draw = async () => {
      const latest = new Map<string, Shown>(); for (const v of w.shown) latest.set(v.name, v);
      for (const v of latest.values()) await page.evaluate((x: Shown) => window.app.view(x), v);
      await page.evaluate((s: ShellState) => window.app.state(s), w.st.s!);
      await page.waitForTimeout(300);
    };
    await draw();
    const events = async () => page.evaluate(() => window.app.events());
    await events();
    const chip = page.locator('.vindu-bar-rem');
    assert.equal(await chip.textContent(), '1 reminder due'); assert.equal(await chip.evaluate((e: Element) => e.classList.contains('is-due')), true);
    await chip.click();
    const shown = (await events()).find(e => e.type === 'reminders');
    assert.deepEqual(shown, { type: 'reminders' });
    w.ui.event(shown); await until(() => !!w.last('reminders')); await draw();
    const pane = page.locator('.vindu-pane[data-view="reminders"]');
    assert.equal(await pane.locator('.vindu-pane-title').textContent(), 'Reminders');
    await pane.getByRole('button', { name: 'Done' }).click();
    assert.deepEqual((await events()).find(e => e.type === 'action'), { type: 'action', view: 'reminders', name: 'reminder', context: { id: 'm1', do: 'done' } });
    await pane.getByRole('button', { name: 'New reminder' }).click();
    assert.deepEqual((await events()).find(e => e.type === 'action'), { type: 'action', view: 'reminders', name: 'reminder_new', context: {} });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); await w.close(); }
});
