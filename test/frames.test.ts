// What frames a change, beyond the yes: a preview of exactly what leaves, beside the ask, from the call's own input
// (for the host's operations and for what the processor asks); a change set the person accepts row by row; a yes from
// several different people, each in their own window; decisions kept as records with who decided; what the model
// wrote marked as such; results labelled as the host classifies them. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { memoryResults, describeChange, previewOf, type Shown } from '../src/index.js';
import { changedFields } from '../src/changes.js';
import { mcpClient, answerOf, componentIn, panelsIn, type SurfaceComponent } from './helpers.js';
import { tmp, until, vindu, session } from './frames-session.js';


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
    const model = panelsIn(pv.wide).p_preview;
    assert.equal(model.rows[0].subject, 'Your refund'); assert.equal(model.props.layout ?? 'one', 'one');
    const payload = answerOf(w.ui.answers().find(e => answerOf(e)?.by === 'host'));
    assert.deepEqual(payload?.values, { to: 'ingrid@havgap.example', subject: 'Your refund', body: 'We refunded order O-1001.' }); // kept by reference
    w.ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket }, by: { name: 'Kari', window: 'main' } });
    const r = await call;
    assert.deepEqual(r.output, { sent: true });
    await until(() => w.ui.receipts()[0]?.state === 'went');
    const receipt = w.ui.shell().views.find(v => v.name === `preview-${a.ask!.ticket}`)!;
    assert.equal(receipt.title, 'Done exactly as approved'); assert.match(receipt.subtitle!, /^send_reply: approved by Kari \(main\) at \d\d:\d\d; kept as p\d+$/);
    assert.deepEqual(answerOf(w.ui.answers().at(-1))?.who, ['Kari (main)']);
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
    const rows = panelsIn(drawn.wide).p_differs.rows;
    assert.deepEqual(rows.map(r => r.field), ['body']);
    assert.match(ui.delta(), /r3 is not what the person approved \(p\d+\): body differ; the window shows both/);
    const cue = componentIn<SurfaceComponent & { action: { event: { context: { prompt: string } } } }>(drawn.wide, x => x.id === 'suggest_0');
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
