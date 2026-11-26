// Live panels and hooks: what the system does by itself in a view the model wrote once, without the model. A live
// panel's source is read again by the host (only a tool that only reads), and a read that differs is shown, marked and
// told once; a view comes to the front and its live panels that say so are read again. Hooks run on what happens: a
// read changed, a value crossed a line, a pick, an answer, a due reminder; they offer a prompt, tell the person, read a
// panel again, or start a job, which is off until the person turns it on, and has a budget. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { mcpClient, sleep, panelsIn, type HostJob, type HostNotice, type HostSource, type HostWatch } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const invoices = (a: number, b: number) => [{ number: 'INV-2026-0412', customer: 'Havgap Media', amount: a }, { number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: b }];

async function windowWith(o: { jobs?: boolean; perDay?: number } = {}) {
  const vindu = await startVindu({ waitMs: 300, decisions: true, jobs: { perDay: o.perDay ?? 3 } });
  const dir = tmp('hooks-'), results = memoryResults(dir);
  results.add({ server: 'accounts', tool: 'list_invoices', input: { status: 'overdue' }, value: invoices(31050, 19800) }); // r1
  results.add({ server: 'accounts', tool: 'send_reminder', input: { number: 'INV-2026-0412' }, value: { sent: true } }); // r2
  const watches: { what: HostWatch; seconds: number; onRead: (id: string) => void }[] = []; const notices: HostNotice[] = []; const jobs: HostJob[] = []; const sourced: HostSource[] = [];
  const more = {
    isRead: (_server: string, tool: string) => tool === 'list_invoices',
    watch: (what: HostWatch, seconds: number, onRead: (id: string) => void) => { watches.push({ what, seconds, onRead }); return () => undefined; },
    source: async (what: HostSource) => { sourced.push(what); return results.add({ server: what.server, tool: what.tool ?? '', input: what.args, value: invoices(31050, 19800) }).id; },
    onNotice: (n: HostNotice) => notices.push(n),
    onJob: async (j: HostJob) => { jobs.push(j); return { id: `job-${jobs.length}` }; },
    ...(o.jobs === false ? { jobs: false } : {}),
  };
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { ...more, onView: v => shown.push(v), onState: s => { st.s = s; } });
  const c = await mcpClient(ui.url);
  const model = (name: string) => panelsIn(shown.filter(v => v.name === name).at(-1)!.wide);
  const drawn = (name: string) => JSON.stringify(shown.filter(v => v.name === name).at(-1)?.wide ?? null);
  /** The host reads the source again: a new result, given to the window as a watch does. */
  const reread = (a: number, b: number) => { const r = results.add({ server: 'accounts', tool: 'list_invoices', input: { status: 'overdue' }, value: invoices(a, b) }); watches[0].onRead(r.id); return r.id; };
  return { vindu, ui, results, watches, notices, jobs, sourced, reread, ...c, shown, st, model, drawn, close: async () => { await c.mcp.close(); ui.close(); await vindu.close(); } };
}
const VIEW = { name: 'overdue', title: 'Overdue', panels: [
  { id: 'inv', card: 'table', title: 'Invoices', from: 'r1', live: { every: 30, front: true }, columns: ['number', 'amount'] },
  { id: 'total', card: 'kpi', title: 'Total overdue', from: 'r1', live: { every: 30 }, value: 'sum(amount)' },
  { id: 'one', card: 'record', title: 'Invoice', detail: { of: 'inv' } },
], hooks: [
  { label: 'Changes', when: { changed: 'inv' }, do: { notify: 'Overdue invoices changed', cue: { label: 'What changed?', prompt: 'The overdue invoices changed. What changed, and who should be chased first?' } } },
  { when: { crosses: { panel: 'total', above: 60000 } }, do: { notify: 'More than 60 000 is overdue' } },
  { label: 'Chase', when: { picked: 'inv' }, do: { job: { prompt: 'Draft a reminder for the invoice picked in Overdue.' } } },
] };

test('a live panel: its source read again by the host; a read that says the same is nothing, one that differs is shown and told once, and its hooks run', async () => {
  const w = await windowWith();
  try {
    const acc = await w.json('show_view', VIEW);
    assert.equal(acc.live, undefined); // both live, on one source: one watch
    assert.deepEqual(w.watches.map(x => [x.what.server, x.what.tool, x.what.args, x.what.after, x.seconds]), [['accounts', 'list_invoices', { status: 'overdue' }, 'r1', 30]]);
    assert.deepEqual(acc.hooks.map((h: { state: string }) => h.state), ['on: the system does it by itself', 'on: the system does it by itself', 'off until the person turns it on, in the window']);
    assert.match(acc.hooks[2].does, /^Chase: When you pick a row in Invoices, start a job: Draft a reminder/);
    assert.ok(w.drawn('overdue').includes('Chase: When you pick a row in Invoices, start a job: Draft a reminder for the invoice picked in Overdue. · off'));
    const n = w.shown.length;
    w.reread(31050, 19800); await sleep(80); // the same: nothing to show or tell
    assert.equal(w.shown.length, n); assert.equal(w.notices.length, 0);
    const id = w.reread(31050, 42000); // differs: shown, followed, told, and its hooks run
    await until(() => w.notices.length >= 2);
    assert.deepEqual(w.model('overdue').p_inv.rows.map(r => r.c1), ['31,050', '42,000']);
    assert.equal(w.model('overdue').p_total.value, '73,050');
    assert.deepEqual(w.notices.map(x => x.text), ['Overdue invoices changed', 'More than 60 000 is overdue']); // the change, and the line crossed
    assert.ok(w.drawn('overdue').includes('What changed? (the system)'));
    const said = w.ui.delta();
    assert.match(said, new RegExp(`accounts\\.list_invoices was read again by the system \\(${id}\\) and says something else now`));
    assert.match(said, /in Overdue, the system offered "What changed\?" on its pane; told the person: Overdue invoices changed \(hook 0/);
    w.reread(31050, 43000); await until(() => w.notices.length >= 3);
    assert.deepEqual(w.notices.slice(2).map(x => x.text), ['Overdue invoices changed']); // above the line still: not again
    w.reread(1000, 2000); await until(() => w.notices.length >= 4); w.reread(31050, 44000); await until(() => w.notices.length >= 6);
    assert.equal(w.notices.filter(x => x.text === 'More than 60 000 is overdue').length, 2); // below it, then above again: once more
    // its view comes to the front: the panel that says so is read again, at most once in 10 seconds
    w.ui.event({ type: 'focus', view: 'overdue' }); await sleep(50);
    assert.equal(w.sourced.length, 0); // read at its start just now: not again so soon
  } finally { await w.close(); }
});

test('only a tool that only reads is read again; a job is off until the person turns it on, then runs within its budget, from the view as it is', async () => {
  const w = await windowWith({ perDay: 1 });
  try {
    const bad = await w.json('show_view', { name: 'sent', title: 'Sent', panels: [{ id: 'r', card: 'record', from: 'r2', live: {} }] });
    assert.deepEqual(bad.live, ['r: live: accounts.send_reminder is not marked by its server as only reading, so the app does not read it again']);
    await w.json('show_view', VIEW);
    w.ui.event({ type: 'view', view: 'overdue', action: 'select', panel: 'p_inv', from: 0 });
    await until(() => /did not start its job: the person has not turned it on/.test(w.ui.delta()));
    assert.equal(w.jobs.length, 0);
    assert.equal(w.ui.event({ type: 'action', view: 'overdue', name: 'hook', context: { n: 0, on: true } }), false); // a hook with no job has no switch
    assert.equal(w.ui.event({ type: 'action', view: 'overdue', name: 'hook', context: { n: 2, on: true } }), true);
    await until(() => w.drawn('overdue').includes('· on'));
    assert.match(w.ui.delta(), /the person turned on the job of hook 2 in Overdue: Chase/);
    w.ui.event({ type: 'view', view: 'overdue', action: 'select', panel: 'p_inv', from: 1 });
    await until(() => w.jobs.length === 1);
    const j = w.jobs[0];
    assert.deepEqual([j.view, j.hook, j.label, j.prompt, j.writes], ['overdue', 2, 'Chase', 'Draft a reminder for the invoice picked in Overdue.', false]);
    assert.deepEqual(j.snapshot.views.map(v => v.name).sort(), ['overdue', 'sent']); assert.deepEqual([...j.snapshot.ids].sort(), ['r1', 'r2']); // the window as it is, and what it points at
    assert.match(w.ui.delta(), /started its job, as the task job-1 \(it only reads\)/);
    w.ui.event({ type: 'view', view: 'overdue', action: 'select', panel: 'p_inv', from: 0 });
    await until(() => /it has run 1 times in the last day, its budget \(1\)/.test(w.ui.delta()));
    assert.equal(w.jobs.length, 1);
  } finally { await w.close(); }
});

test('where jobs are off (a job\'s own task), a job hook says so and has no switch; the other hooks still run', async () => {
  const w = await windowWith({ jobs: false });
  try {
    const acc = await w.json('show_view', VIEW);
    assert.equal(acc.hooks[2].state, 'off: jobs are off in this app');
    assert.ok(w.drawn('overdue').includes('off: jobs are off in this app') && !w.drawn('overdue').includes('hook_2_switch'));
    assert.equal(w.ui.event({ type: 'action', view: 'overdue', name: 'hook', context: { n: 2, on: true } }), false);
    w.reread(31050, 42000); await until(() => w.notices.length >= 1);
    assert.equal(w.notices[0].text, 'Overdue invoices changed');
  } finally { await w.close(); }
});
