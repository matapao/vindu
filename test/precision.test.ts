// How data goes in, and how the person answers, over real MCP and with no browser: each account names where every
// value came from (a reference into the result), how it was seen, each step applied and the rule it was written by;
// ctx_read reads any value back exactly; operations are tools named by what they do, and only the person answers them.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, type Operation, type Shown } from '../src/index.js';
import { get, mcpClient, sleep } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const invoices = [
  { id: 'INV-2026-0398', customer: 'Brattli Verksted', days_overdue: 12, amount_nok: 18400, status: 'overdue' },
  { id: 'INV-2026-0405', customer: 'Lysvik Retail', days_overdue: 0, amount_nok: 9900, status: 'open' },
  { id: 'INV-2026-0412', customer: 'Havgap Media', days_overdue: 53, amount_nok: 48200, status: 'overdue' },
];
const paid: unknown[] = [];
const OPS: Operation[] = [
  { name: 'approve_payment', description: 'Ask the person to approve paying an invoice; returns their decision and any note.', effect: 'write',
    input: { invoice: z.string().describe('the invoice id') },
    ask: input => ({ title: `Pay ${String(input.invoice)}?`, fields: { decision: { type: 'string', enum: ['pay', 'hold'] }, note: { type: 'string' } }, required: ['decision'] }),
    run: (input, answer) => { if (answer?.decision === 'pay') paid.push(input.invoice); return { paid: answer?.decision === 'pay' }; } },
  { name: 'send_reminder', description: 'Send the customer a payment reminder by email.', effect: 'external', input: { invoice: z.string() }, run: input => ({ sent: input.invoice }) },
  { name: 'count_open', description: 'How many invoices are open.', effect: 'read', run: () => ({ open: 1 }) },
];

const dir = tmp('prec-');
const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', value: invoices });
(results.all()[0] as { fidelity?: string; digest?: string }).fidelity = 'exact'; // as a host's record says it
(results.all()[0] as { fidelity?: string; digest?: string }).digest = 'sha256:4f2a9c1d0e7b3a5c';
const vindu = await startVindu({ operations: OPS, locale: 'nb-NO', timeZone: 'Europe/Oslo', waitMs: 400 });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });
const askShown = async () => { for (let i = 0; i < 100 && !shown.some(v => v.ask); i++) await sleep(10); return shown.splice(0).filter(v => v.ask).at(-1)!; };

test('result image names use a file-safe media subtype', () => {
  const dir = tmp('vindu-image-');
  try {
    const contents = new Uint8Array([1, 2, 3]);
    const result = memoryResults(dir).add({ server: 'photos', tool: 'thumbnail', images: [
      { data: contents, mime: 'image/png; test=1' }, { data: contents, mime: 'image/not\\a-subtype' },
    ] });
    assert.deepEqual(result.images.map(image => image.file), [path.join(dir, 'r1-1.png'), path.join(dir, 'r1-2.bin')]);
    assert.deepEqual(fs.readFileSync(result.images[0].file), Buffer.from(contents));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an account says how each value went in: its reference, how it was seen, the steps, and the rule it was written by', async () => {
  const a = await json('show_view', { name: 'overdue', title: 'Overdue', panels: [{ card: 'table', from: 'r1', where: { status: 'overdue' }, sort: 'days_overdue desc', columns: ['id', 'customer', 'amount_nok'] }] });
  const p = a.panels[0];
  assert.equal(p.ref, 'ctx:r1'); assert.equal(p.seen, 'exact'); assert.equal(p.digest, 'sha256:4f2a9c1d0e7b');
  assert.deepEqual(p.steps, [{ where: { status: 'overdue' }, kept: 2, of: 3 }, { sort: 'days_overdue desc' }]);
  assert.equal(p.first_row, `INV-2026-0412 | Havgap Media | ${(48200).toLocaleString('nb-NO')}`); // written as the locale writes it
  assert.deepEqual(p.first_refs, { id: 'ctx:r1#/2/id', customer: 'ctx:r1#/2/customer', amount_nok: 'ctx:r1#/2/amount_nok' }); // row 2 of the result, after the steps
  assert.deepEqual({ locale: a.format.locale, timeZone: a.format.timeZone }, { locale: 'nb-NO', timeZone: 'Europe/Oslo' });
  assert.match(a.format.cells, /numbers grouped as the locale writes them/);
  const typed = await json('show_view', { name: 'mine', title: 'Mine', panels: [{ card: 'kpi', title: 'Guess', data: 76600 }] });
  assert.equal(typed.panels[0].seen, 'typed by you');
});

test('ctx_read reads a value back exactly by its reference, and says why when it cannot', async () => {
  assert.deepEqual(await json('ctx_read', { ref: 'ctx:r1#/2/amount_nok' }), { ref: 'ctx:r1#/2/amount_nok', value: 48200 });
  assert.deepEqual((await json('ctx_read', { ref: 'ctx:r1#/0' })).value, invoices[0]);
  const cut = await json('ctx_read', { ref: 'ctx:r1', max: 40 });
  assert.match(cut.cut, /^40 of \d+ characters/);
  const bad = await call('ctx_read', { ref: 'ctx:r1#/9/amount_nok' });
  assert.equal(bad.ok, false); assert.match(bad.text, /r1 has nothing at \/9\/amount_nok \(it stops before "9"\)/);
});

test('operations are tools named by what they do, with their effect as hints; the model never sees the form', async () => {
  const { tools } = await mcp.listTools();
  const t = tools.find(x => x.name === 'approve_payment')!;
  assert.match(t.description!, /^Ask the person to approve paying an invoice/);
  assert.doesNotMatch(JSON.stringify(t), /form|button|ChoicePicker|TextField/i);
  assert.deepEqual(t.annotations, { readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  assert.equal(tools.find(x => x.name === 'send_reminder')!.annotations!.openWorldHint, true);
  assert.equal(tools.find(x => x.name === 'count_open')!.annotations!.readOnlyHint, true);
});

test('the person answers in the window, checked against what they were asked; the answer is kept as a p-id', async () => {
  const pending = json('approve_payment', { invoice: 'INV-2026-0412' });
  const ask = await askShown();
  assert.equal(ask.name, 'ask-k1'); assert.equal(ask.ask!.title, 'Pay INV-2026-0412?');
  assert.ok(JSON.stringify(ask.wide).includes('"ChoicePicker"')); // the default binding: a form from the fields
  assert.equal(ui.event({ type: 'action', view: 'ask-k2', name: 'answer', context: { ticket: 'k1', 'f:decision': ['pay'] } }), false); // only from its own pane
  assert.equal(ui.event({ type: 'action', view: 'ask-k1', name: 'answer', context: { ticket: 'k1', 'f:note': 'no decision' } }), true);
  const again = await askShown();
  assert.ok(JSON.stringify(again.wide).includes('decision is needed')); // back to the person, never to the model
  ui.event({ type: 'action', view: 'ask-k1', name: 'answer', context: { ticket: 'k1', 'f:decision': ['pay'], 'f:note': 'approved by finance' } });
  const r = await pending;
  assert.deepEqual(r, { op: 'approve_payment', id: 'p1', answer: { decision: 'pay', note: 'approved by finance' }, output: { paid: true } });
  assert.deepEqual(paid, ['INV-2026-0412']);
  assert.match((await call('results', {})).text, /p1: the person answered approve_payment → fields decision, note; with output/);
  assert.equal(ui.shell().views.some(v => v.name === 'ask-k1'), false); // the ask's pane is gone once answered
  const view = await json('show_view', { name: 'answer', title: 'Answer', panels: [{ card: 'record', from: 'p1', fields: ['decision', 'note'] }] });
  assert.equal(view.panels[0].seen, 'person'); // it shows like any result
  assert.deepEqual(await json('ctx_read', { ref: 'ctx:p1#/output/paid' }), { ref: 'ctx:p1#/output/paid', value: true });
});

test('a write, external or destructive operation without a form is confirmed first; a read just runs', async () => {
  assert.deepEqual(await json('count_open', {}), { op: 'count_open', id: 'p2', output: { open: 1 } });
  const pending = json('send_reminder', { invoice: 'INV-2026-0398' });
  const ask = await askShown();
  assert.equal(ask.ask!.confirm, true);
  ui.event({ type: 'action', view: ask.name, name: 'decline', context: { ticket: ask.ask!.ticket } });
  assert.deepEqual(await pending, { op: 'send_reminder', id: 'p3', declined: true });
});

test('a slow answer comes back as pending with a ticket, and await_answer gets it later', async () => {
  const first = await json('approve_payment', { invoice: 'INV-2026-0398' }); // waitMs is 400 here
  assert.equal(first.pending, true); assert.equal(first.ticket, 'k3');
  const look = await json('look', {});
  assert.deepEqual(look.waiting_for_the_person, [{ ticket: 'k3', op: 'approve_payment' }]);
  const later = json('await_answer', { ticket: 'k3' });
  await sleep(50);
  ui.event({ type: 'action', view: 'ask-k3', name: 'answer', context: { ticket: 'k3', 'f:decision': ['hold'] } });
  assert.deepEqual(await later, { op: 'approve_payment', id: 'p4', answer: { decision: 'hold' }, output: { paid: false } });
  assert.deepEqual(await json('await_answer', { ticket: 'k3' }), { op: 'approve_payment', id: 'p4', answer: { decision: 'hold' }, output: { paid: false } }); // kept
});

test('a form a server asks for goes through the same binding; the person can run an operation themselves', async () => {
  shown.length = 0; ui.delta(); // what came before is told
  const answer = ui.ask({ message: 'Which account should the refund go to?', schema: { type: 'object', properties: { account: { type: 'string', title: 'Account' } }, required: ['account'] } });
  const ask = await askShown();
  assert.equal(ask.ask!.kind, 'elicitation');
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, 'f:account': '1920.10.12345' } });
  assert.deepEqual(await answer, { action: 'accept', content: { account: '1920.10.12345' } });
  assert.equal(ui.event({ type: 'operation', name: 'count_open' }), true);
  await sleep(20);
  const delta = ui.delta();
  assert.match(delta, /^\[the window, revision \d+: /);
  assert.match(delta, /the person answered the question "Which account should the refund go to\?"/);
  assert.match(delta, /the person answered count_open/);
  assert.equal(ui.delta(), ''); // told once
});

test('the harness\'s permission ask is drawn as it asks it: its options in its order and words, the call\'s tool, input and diff', async () => {
  shown.length = 0; const kept = ui.answers().length;
  const pick = ui.permission({ title: 'Edit invoices.csv', tool: 'Edit', input: { file_path: '/work/invoices.csv' },
    content: [{ type: 'diff', path: '/work/invoices.csv', oldText: 'id,amount\nINV-1,100\nINV-2,80', newText: 'id,amount\nINV-1,120\nINV-2,80' }], locations: [{ path: '/work/invoices.csv', line: 2 }],
    options: [{ name: 'Yes' }, { name: "Yes, and don't ask again this session" }, { name: 'No' }] });
  const ask = await askShown();
  assert.equal(ask.ask!.kind, 'permission'); assert.equal(ask.ask!.title, 'Edit invoices.csv');
  assert.deepEqual(ask.ask!.choices, ['Yes', "Yes, and don't ask again this session", 'No']); // its words, its order
  const drawn = JSON.stringify(ask.wide);
  for (const t of ['@@ line 2', '- INV-1,100', '+ INV-1,120', '/work/invoices.csv:2', '\\"file_path\\": \\"/work/invoices.csv\\"', 'change to /work/invoices.csv']) assert.ok(drawn.includes(t), t);
  assert.ok(!drawn.includes('INV-2,80')); // the lines that do not change are left out
  assert.equal(ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, choice: 'No', n: 1 } }), true); // a choice and a place that disagree
  assert.match(JSON.stringify((await askShown()).wide), /pick one of the choices/);
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, choice: "Yes, and don't ask again this session", n: 1 } });
  assert.equal(await pick, 1); // the option's place: the host maps it back to the processor's own option
  assert.equal(ui.answers().length, kept); // the answer goes to the processor, which keeps it; not kept here
});

test('an ask whoever asked stops waiting for leaves the window unanswered', async () => {
  shown.length = 0; const stop = new AbortController();
  const pick = ui.permission({ title: 'npm test', tool: 'Bash', options: [{ name: 'Yes' }, { name: 'No' }] }, stop.signal);
  const ask = await askShown();
  assert.ok(ui.shell().views.some(v => v.name === ask.name));
  stop.abort(); // the turn was cancelled
  assert.equal(await pick, null);
  assert.equal(ui.shell().views.some(v => v.name === ask.name), false);
  assert.equal(ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, choice: 'Yes', n: 0 } }), false); // too late: nothing to answer
});

test('a page to open is shown with the harness\'s words and its full address; open or decline it, collapsed or not', async () => {
  shown.length = 0; ui.delta();
  const url = 'https://ledger.example/oauth/authorize?state=x1';
  const opened = ui.link({ message: 'Sign in to the ledger service', url });
  const ask = await askShown();
  assert.equal(ask.ask!.kind, 'link'); assert.equal(ask.ask!.link, url);
  assert.ok(JSON.stringify(ask.wide).includes(url)); assert.ok(JSON.stringify(ask.wide).includes('Sign in to the ledger service'));
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket } });
  assert.equal(await opened, 'accept');
  const parked = ui.link({ message: 'Sign in again', url });
  const again = await askShown();
  assert.equal(ui.event({ type: 'collapse', view: again.name }), true); // into the shelf: still asked
  assert.deepEqual((await json('look', {})).waiting_for_the_person, [{ ticket: again.ask!.ticket, op: 'a page to open' }]);
  ui.event({ type: 'action', view: again.name, name: 'decline', context: { ticket: again.ask!.ticket } });
  assert.equal(await parked, 'decline');
  const delta = ui.delta();
  assert.match(delta, /the request to open a page at ledger\.example/); assert.ok(!delta.includes('state=x1')); // the host, not the address
});

test('a form keeps the schema\'s own words: titled choices with their descriptions, several picks, and each question', async () => {
  shown.length = 0;
  const schema = { type: 'object', properties: { // as claude-agent-acp sends Claude Code's AskUserQuestion
    question_0: { type: 'string', title: 'Cache', description: 'Which cache should the service use?', oneOf: [{ const: 'Redis', title: 'Redis', description: 'in memory, shared' }, { const: 'None', title: 'None' }] },
    question_0_custom: { type: 'string', title: 'Other', description: 'Type your own answer (optional).' },
    question_1: { type: 'array', title: 'Checks', description: 'Which checks should run?', items: { anyOf: [{ const: 'lint', title: 'Lint' }, { const: 'unit', title: 'Unit tests' }, { const: 'e2e', title: 'End to end' }] } },
  } };
  const answer = ui.ask({ message: 'Please answer the following questions.', schema });
  const ask = await askShown();
  assert.deepEqual(ask.ask!.fields.question_1, { type: 'string', multi: true, title: 'Checks', description: 'Which checks should run?', enum: ['lint', 'unit', 'e2e'], labels: ['Lint', 'Unit tests', 'End to end'] });
  const drawn = JSON.stringify(ask.wide);
  for (const t of ['Which cache should the service use?', 'Redis — in memory, shared', 'multipleSelection', 'Unit tests', 'Type your own answer (optional).']) assert.ok(drawn.includes(t), t);
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, 'f:question_0': ['Redis'], 'f:question_1': ['lint', 'nope'] } });
  assert.match(JSON.stringify((await askShown()).wide), /nope is not one of lint, unit, e2e/);
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, 'f:question_0': ['Redis'], 'f:question_0_custom': '', 'f:question_1': ['lint', 'e2e'] } });
  assert.deepEqual(await answer, { action: 'accept', content: { question_0: 'Redis', question_1: ['lint', 'e2e'] } }); // the schema's own values
});

test('an operation added mid-task is reached through invoke, since the tool list holds still within a session', async () => {
  ui.register({ name: 'export_csv', description: 'Write the overdue invoices to a CSV file in the working folder.', effect: 'read', run: () => ({ file: 'overdue.csv' }) });
  const look = await json('look', {});
  assert.deepEqual(look.added_operations, [{ name: 'export_csv', does: 'Write the overdue invoices to a CSV file in the working folder.', effect: 'read', input: [] }]);
  assert.deepEqual((await json('invoke', { name: 'export_csv' })).output, { file: 'overdue.csv' });
  assert.equal((await call('invoke', { name: 'nope' })).ok, false);

  const received: unknown[] = [];
  ui.register({ name: 'item_count', description: 'Count items.', effect: 'read',
    input: { quantity: z.string().regex(/^\d+$/).transform(Number) },
    run: input => { received.push(input.quantity); return input.quantity; } });
  assert.equal((await call('invoke', { name: 'item_count', input: { quantity: false } })).ok, false);
  assert.equal(ui.event({ type: 'operation', name: 'item_count', input: {} }), false);
  assert.equal((await json('invoke', { name: 'item_count', input: { quantity: '12' } })).output, 12);
  assert.equal(ui.event({ type: 'operation', name: 'item_count', input: { quantity: '23' } }), true);
  assert.deepEqual(received, [12, 23]);
});

test('the person comes first: a change the model has not read stops its arrange once; suggest and off', async () => {
  await json('show_view', { name: 'second', title: 'Second', panels: [{ card: 'table', from: 'r1' }] });
  ui.event({ type: 'collapse', view: 'second' });
  const stopped = await call('arrange', { layout: ['overdue', 'second'] });
  assert.equal(stopped.ok, false); assert.match(stopped.text, /the person changed the window since you last read it \(collapsed "second" into the shelf\)/);
  assert.equal((await call('arrange', { layout: ['overdue', 'second'] })).ok, true); // told now: it goes ahead
  const v2 = await startVindu({ modelArrange: 'suggest' }); const states: { suggestion: unknown }[] = [];
  const t = v2.open({ results, dir: tmp('sug-') }, { onState: st => states.push(st) });
  const c = await mcpClient(t.url);
  await c.json('show_view', { name: 'a', title: 'A', panels: [{ card: 'table', from: 'r1' }] });
  await c.json('show_view', { name: 'b', title: 'B', panels: [{ card: 'table', from: 'r1' }] });
  const s = await c.json('arrange', { layout: { column: ['a', 'b'] } });
  assert.match(s.notes.join(), /suggested to the person/); assert.deepEqual(s.layout, { row: ['a', 'b'] }); // nothing moved
  assert.ok(states.at(-1)!.suggestion);
  assert.equal(t.event({ type: 'take-suggestion' }), true);
  const look = await c.json('look', {});
  assert.deepEqual(look.layout, { column: ['a', 'b'] }); assert.match(look.person[0], /took the layout you suggested/);
  await c.mcp.close(); t.close(); await v2.close();
  const v3 = await startVindu({ modelArrange: 'off' });
  const t3 = v3.open({ results, dir: tmp('off-') });
  const c3 = await mcpClient(t3.url);
  assert.match((await c3.call('arrange', { focus: 'x' })).text, /the person arranges this window themselves/);
  await c3.mcp.close(); t3.close(); await v3.close();
});

test('MCP Apps are off unless the host turns them on, and a host can offer fewer cards', async () => {
  const off = await call('show_view', { name: 'app', title: 'App', panels: [{ card: 'app', from: 'r1' }] });
  assert.match(off.text, /there is no "app" card here/);
  const v4 = await startVindu({ kinds: ['table', 'kpi'] });
  const t4 = v4.open({ results, dir: tmp('kinds-') });
  const c4 = await mcpClient(t4.url);
  const { tools } = await c4.mcp.listTools();
  assert.doesNotMatch(JSON.stringify(tools.find(x => x.name === 'show_view')!.inputSchema), /bar-chart/);
  assert.match((await c4.call('show_view', { name: 'c', title: 'C', panels: [{ card: 'bar-chart', from: 'r1', x: 'customer', y: 'amount_nok' }] })).text, /no "bar-chart" card here; cards: table, kpi/);
  await c4.mcp.close(); t4.close(); await v4.close();
});

test('a native host submits the current app tool and its exact input; frame messages still ask', async () => {
  const host = await startVindu({ apps: 'on', asks: 'host' });
  let frame = '';
  const calls: unknown[] = [], asks: Shown[] = [];
  let visibility = ['app'];
  const result = { structuredContent: { count: 1 }, content: [] };
  const session = host.open({ results, dir: tmp('submitted-') }, { onView: item => { if (item.ask) asks.push(item); },
    apps: {
      tools: () => [{ name: 'query', _meta: { ui: { resourceUri: 'ui://db/search', visibility } } }],
      read: async () => ({ contents: [] }),
      call: async (...args) => { calls.push(args); return result; },
    },
    onPresentation: v => { frame = v.panels[0]?.frame?.url ?? ''; },
  });
  const client = await mcpClient(session.url);
  const spec = { name: 'search', title: 'Search', panels: [{ card: 'app', id: 'form', from: 'r1' }] };
  try {
    await client.json('show_view', spec);
    assert.ok(frame);
    const fields = JSON.parse('{"term":"invoice","filters":["open"],"__proto__":"field"}') as Record<string, unknown>;
    const input = { view: 'search', panel: 'form', frame, name: 'query', arguments: fields };
    assert.deepEqual(await session.submitAppTool(input, async (...args) => { calls.push(args); return result; }), result);
    assert.deepEqual(calls, [['db', 'query', fields]]);
    assert.equal(asks.length, 0);

    const rpc = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'query', arguments: input.arguments } };
    assert.equal(session.event({ type: 'app', view: 'search', panel: 'form', resource: new URL(frame).hostname, mount: 'a'.repeat(32), msg: rpc }), true);
    const approval = asks.at(-1);
    assert.ok(approval?.ask);
    session.event({ type: 'action', view: approval.name, name: 'decline', context: { ticket: approval.ask.ticket } });
    await assert.rejects(session.submitAppTool({ ...input, name: 'different' }), /unavailable/);
    visibility = ['model'];
    await assert.rejects(session.submitAppTool(input), /unavailable/);
    visibility = ['app'];
    await client.json('show_view', spec);
    assert.notEqual(input.frame, frame);
    await assert.rejects(session.submitAppTool(input), /no longer open/);
    assert.deepEqual(await session.submitAppTool({ ...input, frame }), result);
    await client.json('show_view', { ...spec, panels: [{ card: 'table', id: 'form', from: 'r1' }] });
    await assert.rejects(session.submitAppTool({ ...input, frame }), /no longer open/);
    assert.equal(calls.length, 2);
  } finally { await client.mcp.close(); session.close(); await host.close(); }
});

test('app calls stay with the requesting window and resource across approval, replacement and task close', async () => {
  const host = await startVindu({ apps: 'on', asks: 'host' });
  const fallback: unknown[] = [], replies: Record<string, unknown>[] = [], calls: string[] = [];
  let pendingRead: (() => void) | undefined, frame = '', offered = true, asked: Shown | undefined;
  const session = host.open({ results, dir: tmp('app-lifetime-') }, { onView: v => { if (v.ask) asked = v; },
    apps: {
      tools: () => [{ name: 'query', _meta: { ui: { resourceUri: 'ui://db/search' } } }, ...(offered ? [{ name: 'save' }] : [])],
      read: async (_, uri) => {
        if (uri.endsWith('/pending')) await new Promise<void>(ok => { pendingRead = ok; });
        return { contents: [{ uri, text: 'resource' }] };
      },
      call: async (_, name) => { calls.push(name); return {}; },
    },
    onPresentation: view => { frame = view.panels[0]?.frame?.url ?? ''; },
    onApp: (...args) => fallback.push(args),
  });
  const client = await mcpClient(session.url);
  const spec = { name: 'results', title: 'Results', panels: [{ card: 'app', id: 'panel', from: 'r1' }] };
  const event = (method: string, params: unknown = {}) => ({ type: 'app', view: spec.name, panel: 'panel',
    resource: new URL(frame).hostname, mount: 'b'.repeat(32), msg: { jsonrpc: '2.0', id: 1, method, params } });
  const reply = (_v: string, _p: string, msg: Record<string, unknown>) => replies.push(msg);
  try {
    await client.json('show_view', spec);
    const firstFrame = frame, ping = event('ping');
    assert.equal((await get(firstFrame)).status, 200);
    assert.equal(session.event(ping, reply), true);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].vinduMount, ping.mount);
    assert.deepEqual(fallback, []);

    const note = 'a'.repeat(500) + 'tail';
    session.event(event('tools/call', { name: 'save', arguments: { note } }), reply);
    assert.ok(asked?.ask?.message?.includes(note));
    offered = false;
    session.event({ type: 'action', view: asked!.name, name: 'answer', context: { ticket: asked!.ask!.ticket } });
    await sleep(0);
    assert.ok(replies.at(-1)?.error);
    assert.deepEqual(calls, []);

    const count = replies.length;
    session.event(event('resources/read', { uri: 'ui://db/pending' }), reply);
    assert.ok(pendingRead);
    await client.json('show_view', spec);
    pendingRead(); await sleep(0);
    assert.equal(replies.length, count);
    assert.equal(session.event(ping, reply), false);
    assert.equal((await get(firstFrame)).status, 404);
    assert.equal((await get(frame)).status, 200);
    await client.mcp.close(); session.close();
    assert.equal((await get(frame)).status, 404);
  } finally { await client.mcp.close(); session.close(); await host.close(); }
});

test('a host that draws asks itself: no pane for them, answered by ticket from its own place, and told when each one leaves', async () => {
  const v5 = await startVindu({ asks: 'host' }); const got: Shown[] = []; const gone: [string, string][] = [];
  const t5 = v5.open({ results, dir: tmp('host-') }, { onView: s => got.push(s), onAskGone: (view, action) => gone.push([view, action]) });
  try {
    const pick = t5.permission({ title: 'npm test', tool: 'Bash', options: [{ name: 'Yes' }, { name: 'No' }] });
    const ask = got.find(s => s.ask)!;
    assert.equal(t5.shell().views.some(x => x.name === ask.name), false); // the host draws it; the window's panes are for views
    assert.equal(t5.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, choice: 'No', n: 1 } }), true);
    assert.equal(await pick, 1); assert.deepEqual(gone, [[ask.name, 'accept']]);
    const stop = new AbortController();
    const form = t5.ask({ message: 'Which suite should run again?', schema: { type: 'object', properties: { suite: { type: 'string' } } } }, stop.signal);
    stop.abort(); // the turn was cancelled: the host takes the form away
    assert.deepEqual(await form, { action: 'cancel' }); assert.deepEqual(gone.at(-1), [got.at(-1)!.name, 'cancel']);
  } finally { t5.close(); await v5.close(); }
});

test('ask: the model asks the person something in the window; the answer is kept as a p-id', async () => {
  shown.length = 0;
  const answer = json('ask', { question: 'Which customer first?', choices: ['Vik Data', 'Strand Bygg'] });
  const ask = await askShown();
  assert.equal(ask.ask!.kind, 'question'); assert.deepEqual(ask.ask!.choices, ['Vik Data', 'Strand Bygg']);
  assert.equal(ask.ask!.message, 'Which customer first?');
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, choice: 'Strand Bygg', n: 1 } });
  const got = await answer;
  assert.deepEqual(got.answer, { choice: 'Strand Bygg' }); assert.match(got.id, /^p\d+$/);
  assert.match((await call('results', {})).text, new RegExp(`${got.id}: the person answered the question "Which customer first\\?"`));
  const free = json('ask', { question: 'Anything else before I send it?' }); // nothing to pick: a written answer
  const q = await askShown();
  assert.deepEqual(Object.keys(q.ask!.fields), ['answer']); assert.deepEqual(q.ask!.required, ['answer']);
  ui.event({ type: 'action', view: q.name, name: 'decline', context: { ticket: q.ask!.ticket } });
  assert.equal((await free).declined, true);
  const slow = await json('ask', { question: 'Ready?', fields: { ok: { type: 'boolean', title: 'Ready' } } }); // waitMs is 400 here
  assert.equal(slow.pending, true);
  const later = json('await_answer', { ticket: slow.ticket });
  ui.event({ type: 'action', view: `ask-${slow.ticket}`, name: 'answer', context: { ticket: slow.ticket, 'f:ok': true } });
  assert.deepEqual((await later).answer, { ok: true });
});

test('the host\'s own panes sit in the layout with the views; the host says what each is; what the person did there is told once', async () => {
  await json('look', {}); ui.delta(); // read: nothing the person changed is waiting
  const notes = ui.pane({ name: 'terminal-1', title: 'Terminal 1', kind: 'terminal', about: () => ({ cwd: '/work', shared: true, last: { command: 'npm test', exit: 1 } }) });
  assert.ok(Array.isArray(notes));
  assert.ok(ui.shell().views.some(v => v.name === 'terminal-1' && v.kind === 'terminal' && v.fill));
  const look = await json('look', {});
  const pane = look.panes.find((p: { view: string }) => p.view === 'terminal-1');
  assert.equal(pane.kind, 'terminal'); assert.deepEqual(pane.about, { cwd: '/work', shared: true, last: { command: 'npm test', exit: 1 } });
  assert.equal(pane.cards, undefined); // not a view of cards
  assert.match((await call('show_view', { name: 'terminal-1', title: 'X', panels: [{ card: 'text', text: 'x' }] })).text, /"terminal-1" is one of the window's own panes \(terminal\); show the view under another name/);
  ui.tell('ran `npm test` in Terminal 1 (exit 1)');
  const arranged = await call('arrange', { focus: 'terminal-1' }); // not a change to the window: the arrange goes ahead
  assert.equal(arranged.ok, true);
  assert.deepEqual(JSON.parse(arranged.text).person, ['ran `npm test` in Terminal 1 (exit 1)']); // told here,
  assert.doesNotMatch(ui.delta(), /npm test/); // so not again
  ui.tell('opened http://127.0.0.1:5173/ in Browser 1');
  assert.match(ui.delta(), /the person opened http:\/\/127\.0\.0\.1:5173\/ in Browser 1/); // or in the next prompt's note, once
  assert.doesNotMatch((await json('look', {})).person?.join(' ') ?? '', /5173/);
  assert.throws(() => ui.pane({ name: 'overdue', title: 'X', kind: 'browser' }), /is a view the model showed/);
  ui.unpane('terminal-1');
  assert.equal(ui.shell().views.some(v => v.name === 'terminal-1'), false);
});

test('a yes or no of the host\'s own shows what it is about, and only a yes from its pane counts', async () => {
  shown.length = 0;
  const yes = ui.confirm({ title: 'Run this in Terminal 1?', message: 'It runs as you, outside the harness\'s sandbox.', details: [{ label: 'command', text: 'npm run build' }] });
  const ask = await askShown();
  assert.equal(ask.ask!.confirm, true); assert.deepEqual(ask.ask!.details, [{ label: 'command', text: 'npm run build' }]);
  assert.ok(JSON.stringify(ask.wide).includes('npm run build'));
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket } });
  assert.equal(await yes, true);
  const no = ui.confirm({ title: 'Run this?' }); const a2 = await askShown();
  ui.event({ type: 'close', view: a2.name }); // closed: no
  assert.equal(await no, false);
});
