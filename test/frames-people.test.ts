// What frames a change, beyond the yes, for the people who decide: a change set the person accepts row by row, a yes from
// several different people, each in their own window, decisions kept as records with who decided, what the model wrote
// marked as such, results labelled as the host classifies them, and the window's own tools. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { changeSet } from '../src/index.js';
import { mcpClient, sleep, answerOf, componentsIn } from './helpers.js';
import { refunded, session } from './frames-session.js';

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
    assert.deepEqual(answerOf(w.ui.answers().at(-1))?.who, ['Kari (main)', 'Ola (phone-1)']);
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
    const comps = componentsIn(w.shown.at(-1)!.wide);
    assert.ok(comps.some(c => c.id === 'p_lines__label' && c.text === 'Confidential · classified by the host'));
    assert.ok(comps.some(c => c.id === 'p_note__made' && c.text === 'Written by the model'));
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
