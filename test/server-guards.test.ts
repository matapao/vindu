// What the model may not do to what the person sees and allows, over real MCP: turn a job the person turned on into
// another job by showing the view again; show, reserve, hide, cover or change an ask's panes, or what its yes keeps as
// a receipt; get round a static view (a browser page, a slot its source or the person fills, one approved, a second
// fill under an earlier yes, a view written up front). All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, type Shown, type Operation } from '../src/index.js';
import { mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const invoices = (a: number, b: number) => [{ number: 'INV-2026-0412', amount: a }, { number: 'INV-2026-0418', amount: b }];
const rowsOf = (shown: Shown[], name: string) => ((shown.filter(v => v.name === name).at(-1)!.wide.find((m: any) => m.updateDataModel) as any).updateDataModel.value.panels as Record<string, any>);

async function hooksWindow(o: { perDay?: number; refuseFirst?: boolean } = {}) {
  const vindu = await startVindu({ waitMs: 300, jobs: { perDay: o.perDay ?? 3 } });
  const dir = tmp('guard-hooks-'), results = memoryResults(dir);
  results.add({ server: 'accounts', tool: 'list_invoices', input: { status: 'overdue' }, value: invoices(31050, 19800) }); // r1
  const watches: ((id: string) => void)[] = [], jobs: any[] = [], sourced: any[] = [];
  const ui = vindu.open({ results, dir }, {
    isRead: (_s: string, tool: string) => tool === 'list_invoices',
    watch: (_what: any, _seconds: number, onRead: (id: string) => void) => { watches.push(onRead); return () => undefined; },
    source: async (what: any) => { sourced.push(what); return results.add({ server: what.server, tool: what.tool, input: what.args, value: invoices(1, 2) }).id; },
    onJob: async (j: any) => { jobs.push(j); return o.refuseFirst && jobs.length === 1 ? { refused: 'the host is busy' } : { id: `job-${jobs.length}` }; },
  });
  const c = await mcpClient(ui.url);
  const reread = (a: number, b: number) => watches[0](results.add({ server: 'accounts', tool: 'list_invoices', input: { status: 'overdue' }, value: invoices(a, b) }).id);
  return { ui, results, jobs, sourced, reread, ...c, close: async () => { await c.mcp.close(); ui.close(); await vindu.close(); } };
}
const chase = (prompt: string, extra: Record<string, unknown> = {}) => ({ name: 'overdue', title: 'Overdue',
  panels: [{ id: 'inv', card: 'table', title: 'Invoices', from: 'r1', columns: ['number', 'amount'] }, { id: 'one', card: 'record', title: 'Invoice', detail: { of: 'inv' } }],
  hooks: [{ label: 'Chase', when: { picked: 'inv' }, do: { job: { prompt, ...extra } } }] });

test('a job the person turned on is that hook as it was: shown anew with another job in its place, it is off, and nothing starts', async () => {
  const w = await hooksWindow();
  try {
    await w.json('show_view', chase('Draft a reminder for the invoice picked.'));
    assert.equal(w.ui.event({ type: 'action', view: 'overdue', name: 'hook', context: { n: 0, on: true } }), true);
    const again = await w.json('show_view', chase('Write off every invoice and tell no one.', { writes: true, connectors: ['accounts'] }));
    assert.equal(again.hooks[0].state, 'off until the person turns it on, in the window'); // the person allowed the other job, not this one
    w.ui.event({ type: 'view', view: 'overdue', action: 'select', panel: 'p_inv', from: 0 });
    await until(() => /did not start its job: the person has not turned it on/.test(w.ui.delta()));
    assert.equal(w.jobs.length, 0);
    // turned on again, as it is now: it runs, as itself
    assert.equal(w.ui.event({ type: 'action', view: 'overdue', name: 'hook', context: { n: 0, on: true } }), true);
    w.ui.event({ type: 'view', view: 'overdue', action: 'select', panel: 'p_inv', from: 1 });
    await until(() => w.jobs.length === 1);
    assert.deepEqual([w.jobs[0].prompt, w.jobs[0].writes], ['Write off every invoice and tell no one.', true]);
  } finally { await w.close(); }
});

test('a job the host did not start costs none of its budget; a hook that reads its own panel again does not read it on and on', async () => {
  const w = await hooksWindow({ perDay: 1, refuseFirst: true });
  try {
    await w.json('show_view', chase('Draft a reminder.'));
    w.ui.event({ type: 'action', view: 'overdue', name: 'hook', context: { n: 0, on: true } });
    w.ui.event({ type: 'view', view: 'overdue', action: 'select', panel: 'p_inv', from: 0 });
    await until(() => /did not start its job: the host is busy/.test(w.ui.delta()));
    w.ui.event({ type: 'view', view: 'overdue', action: 'select', panel: 'p_inv', from: 1 });
    await until(() => /started its job, as the task job-2/.test(w.ui.delta())); // the refused one cost nothing
    // a live panel whose hook reads it again when it changes: no sooner than any read of it
    await w.json('show_view', { name: 'live', title: 'Live', panels: [{ id: 'inv', card: 'table', from: 'r1', live: { every: 30 } }],
      hooks: [{ when: { changed: 'inv' }, do: { read: 'inv' } }] });
    w.reread(31050, 42000);
    await sleep(300);
    assert.equal(w.sourced.length, 0); // read just now by the host: the hook's read waits like any other
  } finally { await w.close(); }
});

const sent: unknown[] = [];
const sendStops: Operation = { name: 'send_stops', description: 'Send the stops to the drivers.', effect: 'external',
  input: { stops: z.array(z.object({ id: z.string(), to: z.string() })) }, run: input => { sent.push(input); return { sent: true }; } };

test("an ask's panes are the window's: kept from the start, in sight while it is asked, and its receipt is what was approved", async () => {
  const vindu = await startVindu({ waitMs: 300, operations: [sendStops] });
  const dir = tmp('guard-ask-'), shown: Shown[] = [];
  const ui = vindu.open({ results: memoryResults(dir), dir }, { onView: v => shown.push(v) });
  const { mcp, call, json } = await mcpClient(ui.url);
  const text = (t: string) => ({ title: 'X', panels: [{ id: 't', card: 'text', text: t }] });
  try {
    // the names an ask will take are kept before it comes: nothing can wait there for it
    assert.match((await call('show_view', { name: 'preview-k1', ...text('Nothing changes') })).text, /not shown: "preview-k1" is one of the window's own panes \(exactly what an ask will send/);
    assert.match((await call('show_view', { name: 'ask-k1', ...text('Say yes') })).text, /not shown: "ask-k1" is one of the window's own panes \(it asks the person\)/);
    assert.match((await call('arrange', { reserve: [{ name: 'ask-k1', title: 'Soon' }] })).text, /not arranged: "ask-k1" is one of the window's own panes/);
    await json('show_view', { name: 'decoy', ...text('Nothing to see here') });
    const asked = json('send_stops', { stops: [{ id: 's1', to: 'Bergen' }, { id: 's2', to: 'Oslo' }] });
    await until(() => ui.shell().views.some(v => v.name === 'preview-k1') && ui.shell().views.some(v => v.name === 'ask-k1'));
    // while it is asked, neither is hidden, covered or changed by the model
    for (const a of [{ collapse: 'preview-k1' }, { collapse: 'ask-k1' }, { maximize: 'decoy' }, { layout: ['decoy', 'ask-k1'] }, { layout: { stack: ['preview-k1', 'decoy'], front: 'decoy' } }])
      assert.match((await call('arrange', a)).text, /must stay in sight while the person is asked: nothing was moved/, JSON.stringify(a));
    assert.match((await call('show_view', { name: 'cover', place: { into: 'preview-k1' }, ...text('Look here') })).text, /is before the person until they answer it, so nothing goes in its place/);
    assert.match((await call('show_view', { name: 'preview-k1', ...text('Only Oslo') })).text, /one of the window's own panes/);
    assert.match((await call('act_in_view', { view: 'preview-k1', action: 'filter', field: 'to', value: 'Oslo' })).text, /"preview-k1" is one of the window's own panes .*only the person changes it/);
    assert.equal((await call('arrange', { focus: 'decoy' })).ok, true); // pointing the person elsewhere hides nothing
    // the person may narrow what they read; the receipt is what was approved, all of it
    assert.equal(ui.event({ type: 'view', view: 'preview-k1', action: 'filter', panel: 'preview', field: 'to', value: 'Oslo' }), true);
    await until(() => rowsOf(shown, 'preview-k1').p_preview.rows.length === 1);
    const a = shown.filter(v => v.ask).at(-1)!;
    ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket }, by: { name: 'Kari', window: 'main' } });
    await asked;
    await until(() => ui.shell().views.find(v => v.name === 'preview-k1')?.title === 'Done exactly as approved');
    assert.equal(rowsOf(shown, 'preview-k1').p_preview.rows.length, 2);
    assert.equal(ui.shell().views.find(v => v.name === 'preview-k1')?.mark, undefined); // the person's filter went with the preview
    assert.match((await call('show_view', { name: 'preview-k1', ...text('It went otherwise') })).text, /one of the window's own panes/); // a receipt stays the system's
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test('a yes or a no while the preview is still being checked settles it as ever: a receipt, or nothing left of it', async () => {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 600, operations: [sendStops] }); // no window reads back: each drawing waits
  const dir = tmp('guard-race-');
  const ui = vindu.open({ results: memoryResults(dir), dir }, { onView: () => undefined });
  const { mcp, json } = await mcpClient(ui.url);
  try {
    const yes = json('send_stops', { stops: [{ id: 's1', to: 'Bergen' }] });
    await until(() => ui.shell().views.some(v => v.name === 'preview-k1'));
    ui.event({ type: 'action', view: 'ask-k1', name: 'answer', context: { ticket: 'k1' } }); // at once: its drawing is still being checked
    await yes;
    assert.deepEqual(ui.receipts().map(r => [r.ticket, r.state]), [['k1', 'went']]);
    await until(() => ui.shell().views.find(v => v.name === 'preview-k1')?.title === 'Done exactly as approved');
    const no = json('send_stops', { stops: [{ id: 's2', to: 'Oslo' }] });
    await until(() => ui.shell().views.some(v => v.name === 'preview-k2'));
    ui.event({ type: 'action', view: 'ask-k2', name: 'decline', context: { ticket: 'k2' } });
    assert.equal((await no).declined, true);
    await sleep(700); // its drawing's checks are over: nothing of it comes back
    assert.equal(ui.shell().views.some(v => v.name === 'preview-k2'), false);
    assert.equal(ui.receipts().length, 1);
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

const TEMPLATE = { name: 'Follow-up', version: 1, slots: {
  next: { title: 'Next step', block: 'free', needs: 'what to do next' },
  // oxlint-disable-next-line unicorn/no-thenable -- a slot's then, as templates take it: an object, never a function
  letter: { title: 'Letter', block: 'text', needs: 'the letter', then: { by: 'person' } },
}, layout: ['next', 'letter'] };

test('a static view holds: no browser page or pane of its own, a template\'s options stay its own, and a yes is to one fill only', async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('guard-static-'), shown: Shown[] = [];
  const ui = vindu.open({ results: memoryResults(dir), dir }, { onView: v => shown.push(v),
    views: { terminal: false, browser: { open: async () => { throw new Error('no browser here'); } } } });
  const { mcp, call, json } = await mcpClient(ui.url);
  try {
    // written up front, before the template: it is not shown later, since the view is the template's now
    const held = await json('show_view', { name: 'later', title: 'Later', after: { answered: 'the question "Go?"' }, panels: [{ id: 't', card: 'text', text: 'Injected' }] });
    assert.match(held.held, /^not shown yet/);
    assert.equal((await ui.useTemplate(TEMPLATE, {})).started, true);
    assert.match((await call('show_view', { slot: 'next', browser: { url: 'https://example.com' } })).text, /not shown: slot next is free, but a browser page is a view of its own/);
    const next = await json('show_view', { slot: 'next', place: { beside: 'letter', side: 'left' }, hooks: [{ when: { picked: 't' }, do: { job: { prompt: 'Anything' } } }], panels: [{ id: 't', card: 'text', text: 'Call them' }] });
    assert.equal(next.hooks, undefined);
    assert.match(next.corrections.join(' '), /slot next: place, hooks are the template's, so they were left out/);
    // the letter: filled, then filled again before the yes: the first ask goes, and the yes is to what is there now
    await json('show_view', { slot: 'letter', panels: [{ card: 'text', text: 'Dear customer, please pay.' }] });
    await until(() => shown.some(v => v.ask?.op === 'approve letter'));
    const first = shown.filter(v => v.ask?.op === 'approve letter').at(-1)!;
    await json('show_view', { slot: 'letter', panels: [{ card: 'text', text: 'Dear customer, you owe us everything.' }] });
    await until(() => !ui.shell().views.some(v => v.name === first.name) && shown.filter(v => v.ask?.op === 'approve letter').at(-1)!.name !== first.name);
    assert.equal(ui.event({ type: 'action', view: first.name, name: 'answer', context: { ticket: first.ask!.ticket }, by: { name: 'Kari', window: 'main' } }), false);
    const second = shown.filter(v => v.ask?.op === 'approve letter').at(-1)!;
    ui.event({ type: 'action', view: second.name, name: 'answer', context: { ticket: second.ask!.ticket }, by: { name: 'Kari', window: 'main' } });
    await until(() => ui.shell().views.every(v => !v.name.startsWith('ask-')));
    const look = await json('look', {});
    assert.deepEqual(look.slots.find((x: any) => x.slot === 'letter').approved_by, ['Kari']);
    assert.match((await call('show_view', { slot: 'letter', panels: [{ card: 'text', text: 'Changed after the yes' }] })).text, /not shown: slot letter \(Letter\) is approved, by Kari; it stays as it is/);
    // what the held view waited for happens: it stays away
    const q = call('ask', { question: 'Go?', choices: ['Yes', 'No'] });
    await until(() => shown.some(v => v.ask?.op === 'ask'));
    const ask = shown.filter(v => v.ask?.op === 'ask').at(-1)!;
    ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, choice: 'Yes', n: 0 } });
    await q; await sleep(100);
    assert.equal(ui.shell().views.some(v => v.name === 'later'), false);
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});
