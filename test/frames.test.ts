// What frames a change, beyond the yes: a preview of exactly what leaves, beside the ask, from the call's own input
// (for the host's operations and for what the processor asks); a change set the person accepts row by row; a yes from
// several different people, each in their own window; decisions kept as records with who decided; what the model
// wrote marked as such; results labelled as the host classifies them. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, changeSet, describeChange, previewOf, type Shown, type Operation } from '../src/index.js';
import { changedFields } from '../src/changes.js';
import { mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const sent: unknown[] = [], refunded: unknown[] = [];
const sendReply: Operation = { name: 'send_reply', description: 'Send a reply to a customer.', effect: 'external',
  input: { to: z.string(), subject: z.string(), body: z.string() }, run: input => { sent.push(input); return { sent: true }; } };
const transfer: Operation = { name: 'approve_transfer', description: 'Approve a transfer.', effect: 'external', approve: 2,
  input: { amount: z.number(), currency: z.string(), to: z.string() }, run: input => ({ transferred: input.amount }) };
const refunds = changeSet({ name: 'refund_orders', description: 'Refund orders: the person ticks which.', rows: 'orders', run: rows => { refunded.push(...rows); return rows.length; } });
const vindu = await startVindu({ waitMs: 300, operations: [sendReply, transfer, refunds], decisions: true,
  classify: e => (e.kind === 'result' && e.server === 'tax' ? 'Confidential' : undefined) });
afterAll(async () => { await vindu.close(); });

function session() {
  const dir = tmp('frames-'), shown: Shown[] = [], all: Shown[] = []; const results = memoryResults(dir);
  results.add({ server: 'tax', tool: 'assessment', value: [{ line: 'Income', amount: 612_000 }, { line: 'Deductions', amount: -38_500 }] });
  const ui = vindu.open({ results, dir }, { onView: v => { shown.push(v); all.push(v); } });
  const ask = async () => { await until(() => shown.some(v => v.ask)); return shown.splice(0).filter(v => v.ask).at(-1)!; };
  return { ui, shown, all, ask };
}

test('the default preview fits the payload: a message, a payment, changes, rows; nothing else', () => {
  assert.equal(previewOf({ to: 'k@x.example', subject: 'Hi', body: 'Text' })?.card, 'message');
  assert.equal(previewOf({ amount: 34800, currency: 'NOK', iban: 'NO93 8601 1117 947' })?.layout, 'payment');
  assert.deepEqual(previewOf({ orders: [{ order: 'O-1', before: { s: 1 }, after: { s: 2 } }] }), { card: 'changes', pick: 'orders', title: '1 changes, exactly as they will be made' });
  assert.equal(previewOf({ stops: [{ id: 1 }, { id: 2 }] })?.card, 'table');
  assert.deepEqual(previewOf({ number: 'INV-2026-0412', body: { to: 'ingrid@havgap.example', body: 'A friendly reminder.' } }), { card: 'message', layout: 'one', title: 'Exactly what will be sent', pick: 'body' }); // an HTTP API's request: its body
  assert.equal(previewOf({ query: 'overdue' }), undefined);
});

test('a host operation that sends: exactly what will go is shown beside the ask, from its own input; after the yes it stays, as its receipt', async () => {
  const w = session(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    const call = json('send_reply', { to: 'ingrid@havgap.example', subject: 'Your refund', body: 'We refunded order O-1001.' });
    const a = await w.ask();
    await until(() => w.ui.shell().views.some(v => v.name === `preview-${a.ask!.ticket}`));
    const pv = w.all.find(v => v.name === `preview-${a.ask!.ticket}`)!;
    const model = (pv.wide.find((m: any) => m.updateDataModel) as any).updateDataModel.value.panels.p_preview;
    assert.equal(model.rows[0].subject, 'Your refund'); assert.equal(model.props.layout ?? 'one', 'one');
    const payload = w.ui.answers().find((e: any) => e.by === 'host')! as any;
    assert.deepEqual(payload.values, { to: 'ingrid@havgap.example', subject: 'Your refund', body: 'We refunded order O-1001.' }); // kept by reference
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket }, by: { name: 'Kari', window: 'main' } });
    const r = await call;
    assert.deepEqual(r.output, { sent: true });
    await until(() => w.ui.receipts()[0]?.state === 'went');
    const receipt = w.ui.shell().views.find(v => v.name === `preview-${a.ask!.ticket}`)!;
    assert.equal(receipt.title, 'Done exactly as approved'); assert.match(receipt.subtitle!, /^send_reply: approved by Kari \(main\) at \d\d:\d\d; kept as p\d+$/);
    assert.deepEqual((w.ui.answers().at(-1) as any).who, ['Kari (main)']);
  } finally { await mcp.close(); w.ui.close(); }
});

test('what the harness asks before a tool call gets the same preview, from the call\'s input', async () => {
  const w = session();
  try {
    const asked = w.ui.permission({ title: 'Allow mcp__mail__send?', tool: 'mcp__mail__send', input: { to: ['a@x.example', 'b@x.example'], subject: 'New times', body: 'Your delivery moved to 14:00.' }, options: [{ name: 'Allow once' }, { name: 'Deny' }] });
    const a = await w.ask();
    await until(() => w.ui.shell().views.some(v => v.name === `preview-${a.ask!.ticket}`));
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, choice: 'Allow once', n: 0 } });
    assert.equal(await asked, 0);
    assert.equal(w.ui.shell().views.some(v => v.name.startsWith('preview-')), false);
  } finally { w.ui.close(); }
});

test("a yes to the harness's call keeps its preview as a receipt: settled by what the record says went, field by field", async () => {
  const dir = tmp('receipt-'), shown: Shown[] = []; const results = memoryResults(dir);
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
  const askOf = async () => { await until(() => shown.some(v => v.ask)); return shown.splice(0).filter(v => v.ask).at(-1)!; };
  const options = [{ name: 'Yes', kind: 'allow_once' }, { name: 'No', kind: 'reject_once' }];
  const letter = { to: 'ingrid@havgap.example', subject: 'Reminder: INV-2026-0412', body: 'Dear Ingrid,\n\nINV-2026-0412 is 57 days overdue.\n\nKind regards' };
  try {
    const asked = ui.permission({ title: 'Send it?', tool: 'accounts: send_reminder', server: 'accounts', name: 'send_reminder', input: letter, options }, new AbortController().signal);
    const a = await askOf(); const view = `preview-${a.ask!.ticket}`;
    await until(() => ui.shell().views.some(v => v.name === view));
    ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, choice: 'Yes', n: 0 }, by: { name: 'Kari', window: 'main' } });
    assert.equal(await asked, 0);
    await until(() => ui.shell().views.find(v => v.name === view)?.title === 'Approved: waiting for it to go');
    assert.deepEqual(ui.receipts().map(r => [r.state, r.who]), [['waiting', 'Kari (main)']]);
    results.add({ server: 'accounts', tool: 'other_tool', input: letter, value: { ok: true } }); ui.result('r1'); // another call: not this one
    const went = results.add({ server: 'accounts', tool: 'send_reminder', input: { ...letter }, value: { id: 'rem-1', sent: true } });
    ui.result(went.id);
    await until(() => ui.shell().views.find(v => v.name === view)?.title === 'Went exactly as approved');
    assert.match(ui.shell().views.find(v => v.name === view)!.subtitle!, /approved by Kari \(main\) at \d\d:\d\d; it went as r2/);
    assert.match(ui.delta(), /r2 went exactly as the person approved it \(p\d+\)/);

    // approved, and then something else went: both are shown, and the model is told what differs
    const asked2 = ui.permission({ title: 'Send it?', tool: 'accounts: send_reminder', server: 'accounts', name: 'send_reminder', input: letter, options }, new AbortController().signal);
    const b = await askOf(); const view2 = `preview-${b.ask!.ticket}`;
    await until(() => ui.shell().views.some(v => v.name === view2));
    ui.event({ type: 'action', view: b.name, name: 'answer', context: { ticket: b.ask!.ticket, choice: 'Yes', n: 0 } });
    await asked2;
    const other = results.add({ server: 'accounts', tool: 'send_reminder', input: { ...letter, body: letter.body.replace('57 days', '75 days') }, value: { id: 'rem-2', sent: true } });
    ui.result(other.id);
    await until(() => ui.shell().views.find(v => v.name === view2)?.title === 'Went, but not as approved');
    const drawn = shown.filter(v => v.name === view2).at(-1)!;
    const rows = (drawn.wide.find((m: any) => m.updateDataModel) as any).updateDataModel.value.panels.p_differs.rows;
    assert.deepEqual(rows.map((r: any) => r.field), ['body']);
    assert.match(ui.delta(), /r3 is not what the person approved \(p\d+\): body differ; the window shows both/);
    const cue = ((drawn.wide.find((m: any) => m.updateComponents) as any).updateComponents.components as any[]).find(x => x.id === 'suggest_0');
    assert.match(cue.action.event.context.prompt, /^r3 is not what I approved \(p\d+\): body differ\. What happened, and what should be done\?$/); // a cue: the system's, for the person to take or not

    // a no: the preview goes with its ask, and nothing waits
    const asked3 = ui.permission({ title: 'Send it?', tool: 'accounts: send_reminder', server: 'accounts', name: 'send_reminder', input: letter, options }, new AbortController().signal);
    const c = await askOf(); const view3 = `preview-${c.ask!.ticket}`;
    await until(() => ui.shell().views.some(v => v.name === view3));
    ui.event({ type: 'action', view: c.name, name: 'answer', context: { ticket: c.ask!.ticket, choice: 'No', n: 1 } });
    assert.equal(await asked3, 1);
    await until(() => !ui.shell().views.some(v => v.name === view3));
    assert.equal(ui.receipts().length, 2);
  } finally { ui.close(); }
});

test('what a change changes: the fields whose values differ, a field left out of before or after included', () => {
  assert.deepEqual(changedFields({ status: 'late', refund: 0, note: 'call' }, { status: 'refunded', refund: 0, by: 'Kari' }), [['status', 'late', 'refunded'], ['note', 'call', undefined], ['by', undefined, 'Kari']]);
  assert.deepEqual(changedFields({ status: 'late' }, { status: 'late' }), []);
  assert.equal(describeChange({ before: { status: 'open', note: 'call back' }, after: { status: 'open' } }), 'note call back → —');
  assert.equal(describeChange({ before: { status: 'open' }, after: { status: 'open' } }), 'no change');
});

test('a change set: each row its own tick; only the ticked ones are made', async () => {
  const w = session(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    refunded.length = 0;
    const orders = [{ order: 'O-1001', before: { status: 'late', refund: 0 }, after: { status: 'refunded', refund: 149 } }, { order: 'O-1002', before: { status: 'late', refund: 0 }, after: { status: 'refunded', refund: 99 } }];
    const call = json('refund_orders', { orders });
    const a = await w.ask();
    assert.deepEqual(Object.values(a.ask!.fields).map(f => f.title), ['O-1001: status late → refunded; refund 0 → 149', 'O-1002: status late → refunded; refund 0 → 99']);
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:row_0': true, 'f:row_1': false } });
    const r = await call;
    assert.deepEqual(r.output, { made: 1, of: 2, result: 1 });
    assert.deepEqual(refunded, [orders[0]]);
  } finally { await mcp.close(); w.ui.close(); }
});

test('a change set whose run is async gives its result, once it is there', async () => {
  const tag = changeSet({ name: 'tag_orders', description: 'Tag orders: the person ticks which.', rows: 'orders', run: async rows => { await sleep(5); return rows.map(r => r.order); } });
  assert.deepEqual(await tag.run!({ orders: [{ order: 'O-1001' }, { order: 'O-1002' }] }, { row_0: true, row_1: false }), { made: 1, of: 2, result: ['O-1001'] });
});

test('two people must say yes, each in their own window: the same person twice is not two', async () => {
  const w = session(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    const call = json('approve_transfer', { amount: 250_000, currency: 'NOK', to: 'Kobberdal Bygg' });
    const a = await w.ask();
    assert.equal(a.ask!.need, 2);
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket }, by: { name: 'Kari', window: 'main' } });
    const again = await w.ask();
    assert.deepEqual(again.ask!.approvals!.map(x => x.name), ['Kari']);
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket }, by: { name: 'Kari N', window: 'main' } }); // same window
    assert.match((await w.ask()).ask!.error!, /has said yes already; another person, in another window, must/);
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket }, by: { name: 'Ola', window: 'phone-1' } });
    const r = await call;
    assert.deepEqual(r.output, { transferred: 250_000 });
    assert.deepEqual((w.ui.answers().at(-1) as any).who, ['Kari (main)', 'Ola (phone-1)']);
  } finally { await mcp.close(); w.ui.close(); }
});

test('a decision drafted by the model, changed and taken by the person, kept as a record, and shown from it', async () => {
  const w = session(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    const call = json('record_decision', { subject: 'tax assessment 2025, case 26/0412', outcome: 'The assessment is corrected.', grounds: 'Deductions of 38 500 were left out.', sources: ['ctx:r1#/1', 'Tax Administration Act § 12-1'], appeal: 'Appeal within 6 weeks.' });
    const a = await w.ask();
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:outcome': 'The assessment is corrected.', 'f:grounds': 'Deductions of 38 500 were documented and left out.', 'f:sources': 'ctx:r1#/1\nTax Administration Act § 12-1', 'f:appeal': 'Appeal within 6 weeks.' }, by: { name: 'Case officer A', window: 'main' } });
    const r = await call;
    assert.deepEqual(r.output.changed_by_the_person, ['grounds']);
    assert.deepEqual(r.output.decided_by, ['Case officer A']); assert.equal(r.output.identities, 'named in the window, not verified');
    const v = await json('show_view', { name: 'decision', title: 'Decision', panels: [{ id: 'd', card: 'decision', from: r.id, pick: 'output', map: { by: 'decided_by' } }] });
    assert.equal(v.panels[0].seen, 'person'); assert.equal(v.panels[0].marked, undefined);
  } finally { await mcp.close(); w.ui.close(); }
});

test('what the model wrote is marked; a classified result carries its label wherever it is shown', async () => {
  const w = session(); const { mcp, json } = await mcpClient(w.ui.url);
  try {
    const v = await json('show_view', { name: 'case', title: 'Case', panels: [{ id: 'lines', card: 'table', from: 'r1' }, { id: 'note', card: 'text', text: 'Deductions were left out.' }] });
    assert.equal(v.panels[0].label, 'Confidential'); assert.equal(v.panels[0].marked, undefined);
    assert.equal(v.panels[1].marked, 'Written by the model');
    const comps = (w.shown.at(-1)!.wide.find((m: any) => m.updateComponents) as any).updateComponents.components;
    assert.ok(comps.some((c: any) => c.id === 'p_lines__label' && c.text === 'Confidential · classified by the host'));
    assert.ok(comps.some((c: any) => c.id === 'p_note__made' && c.text === 'Written by the model'));
  } finally { await mcp.close(); w.ui.close(); }
});

test('a call to the window\'s own tools is asked without a preview: it shows itself in the window', async () => {
  const w = session();
  try {
    const own = w.ui.permission({ title: 'mcp__ui__show_view', tool: 'ui: show_view', input: { name: 'v', panels: [{ card: 'table', from: 'r1', where: { status: 'open' } }] }, options: [{ name: 'Yes' }, { name: 'No' }], own: true });
    const a = await w.ask();
    await sleep(300);
    assert.equal(w.all.some(v => v.name.startsWith('preview-')), false);
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, choice: 'Yes', n: 0 } });
    assert.equal(await own, 0);
  } finally { w.ui.close(); }
});
