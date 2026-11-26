// How data goes in, and how the person answers, over real MCP and with no browser: each account names where every
// value came from (a reference into the result), how it was seen, each step applied and the rule it was written by;
// ctx_read reads any value back exactly; operations are tools named by what they do, and only the person answers them.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { memoryResults } from '../src/index.js';
import { sleep } from './helpers.js';
import { askShown, call, invoices, json, mcp, paid, shown, tmp, ui } from './precision-session.js';

test('result image names use a file-safe media subtype', () => {
  const dir = tmp('vindu-image-');
  try {
    const contents = new Uint8Array([1, 2, 3]);
    const result = memoryResults(dir).add({
      server: 'photos',
      tool: 'thumbnail',
      images: [
        { data: contents, mime: 'image/png; test=1' },
        { data: contents, mime: 'image/not\\a-subtype' },
      ],
    });
    assert.deepEqual(
      result.images.map((image) => image.file),
      [path.join(dir, 'r1-1.png'), path.join(dir, 'r1-2.bin')],
    );
    assert.deepEqual(fs.readFileSync(result.images[0].file), Buffer.from(contents));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an account says how each value went in: its reference, how it was seen, the steps, and the rule it was written by', async () => {
  const a = await json('show_view', {
    name: 'overdue',
    title: 'Overdue',
    panels: [
      {
        card: 'table',
        from: 'r1',
        where: { status: 'overdue' },
        sort: 'days_overdue desc',
        columns: ['id', 'customer', 'amount_nok'],
      },
    ],
  });
  const p = a.panels[0];
  assert.equal(p.ref, 'ctx:r1');
  assert.equal(p.seen, 'exact');
  assert.equal(p.digest, 'sha256:4f2a9c1d0e7b');
  assert.deepEqual(p.steps, [{ where: { status: 'overdue' }, kept: 2, of: 3 }, { sort: 'days_overdue desc' }]);
  assert.equal(p.first_row, `INV-2026-0412 | Havgap Media | ${(48200).toLocaleString('nb-NO')}`); // written as the locale writes it
  assert.deepEqual(p.first_refs, {
    id: 'ctx:r1#/2/id',
    customer: 'ctx:r1#/2/customer',
    amount_nok: 'ctx:r1#/2/amount_nok',
  }); // row 2 of the result, after the steps
  assert.deepEqual(
    { locale: a.format.locale, timeZone: a.format.timeZone },
    { locale: 'nb-NO', timeZone: 'Europe/Oslo' },
  );
  assert.match(a.format.cells, /numbers grouped as the locale writes them/);
  const typed = await json('show_view', {
    name: 'mine',
    title: 'Mine',
    panels: [{ card: 'kpi', title: 'Guess', data: 76600 }],
  });
  assert.equal(typed.panels[0].seen, 'typed by you');
});

test('ctx_read reads a value back exactly by its reference, and says why when it cannot', async () => {
  assert.deepEqual(await json('ctx_read', { ref: 'ctx:r1#/2/amount_nok' }), {
    ref: 'ctx:r1#/2/amount_nok',
    value: 48200,
  });
  assert.deepEqual((await json('ctx_read', { ref: 'ctx:r1#/0' })).value, invoices[0]);
  const cut = await json('ctx_read', { ref: 'ctx:r1', max: 40 });
  assert.match(cut.cut, /^40 of \d+ characters/);
  const bad = await call('ctx_read', { ref: 'ctx:r1#/9/amount_nok' });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /r1 has nothing at \/9\/amount_nok \(it stops before "9"\)/);
});

test('operations are tools named by what they do, with their effect as hints; the model never sees the form', async () => {
  const { tools } = await mcp.listTools();
  const t = tools.find((x) => x.name === 'approve_payment')!;
  assert.match(t.description!, /^Ask the person to approve paying an invoice/);
  assert.doesNotMatch(JSON.stringify(t), /form|button|ChoicePicker|TextField/i);
  assert.deepEqual(t.annotations, { readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  assert.equal(tools.find((x) => x.name === 'send_reminder')!.annotations!.openWorldHint, true);
  assert.equal(tools.find((x) => x.name === 'count_open')!.annotations!.readOnlyHint, true);
});

test('the person answers in the window, checked against what they were asked; the answer is kept as a p-id', async () => {
  const pending = json('approve_payment', { invoice: 'INV-2026-0412' });
  const ask = await askShown();
  assert.equal(ask.name, 'ask-k1');
  assert.equal(ask.ask!.title, 'Pay INV-2026-0412?');
  assert.ok(JSON.stringify(ask.wide).includes('"ChoicePicker"')); // the default binding: a form from the fields
  assert.equal(
    ui.event({ type: 'action', view: 'ask-k2', name: 'answer', context: { ticket: 'k1', 'f:decision': ['pay'] } }),
    false,
  ); // only from its own pane
  assert.equal(
    ui.event({ type: 'action', view: 'ask-k1', name: 'answer', context: { ticket: 'k1', 'f:note': 'no decision' } }),
    true,
  );
  const again = await askShown();
  assert.ok(JSON.stringify(again.wide).includes('decision is needed')); // back to the person, never to the model
  ui.event({
    type: 'action',
    view: 'ask-k1',
    name: 'answer',
    context: { ticket: 'k1', 'f:decision': ['pay'], 'f:note': 'approved by finance' },
  });
  const r = await pending;
  assert.deepEqual(r, {
    op: 'approve_payment',
    id: 'p1',
    answer: { decision: 'pay', note: 'approved by finance' },
    output: { paid: true },
  });
  assert.deepEqual(paid, ['INV-2026-0412']);
  assert.match(
    (await call('results', {})).text,
    /p1: the person answered approve_payment → fields decision, note; with output/,
  );
  assert.equal(
    ui.shell().views.some((v) => v.name === 'ask-k1'),
    false,
  ); // the ask's pane is gone once answered
  const view = await json('show_view', {
    name: 'answer',
    title: 'Answer',
    panels: [{ card: 'record', from: 'p1', fields: ['decision', 'note'] }],
  });
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
  assert.equal(first.pending, true);
  assert.equal(first.ticket, 'k3');
  const look = await json('look', {});
  assert.deepEqual(look.waiting_for_the_person, [{ ticket: 'k3', op: 'approve_payment' }]);
  const later = json('await_answer', { ticket: 'k3' });
  await sleep(50);
  ui.event({ type: 'action', view: 'ask-k3', name: 'answer', context: { ticket: 'k3', 'f:decision': ['hold'] } });
  assert.deepEqual(await later, {
    op: 'approve_payment',
    id: 'p4',
    answer: { decision: 'hold' },
    output: { paid: false },
  });
  assert.deepEqual(await json('await_answer', { ticket: 'k3' }), {
    op: 'approve_payment',
    id: 'p4',
    answer: { decision: 'hold' },
    output: { paid: false },
  }); // kept
});

test('a form a server asks for goes through the same binding; the person can run an operation themselves', async () => {
  shown.length = 0;
  ui.delta(); // what came before is told
  const answer = ui.ask({
    message: 'Which account should the refund go to?',
    schema: { type: 'object', properties: { account: { type: 'string', title: 'Account' } }, required: ['account'] },
  });
  const ask = await askShown();
  assert.equal(ask.ask!.kind, 'elicitation');
  ui.event({
    type: 'action',
    view: ask.name,
    name: 'answer',
    context: { ticket: ask.ask!.ticket, 'f:account': '1920.10.12345' },
  });
  assert.deepEqual(await answer, { action: 'accept', content: { account: '1920.10.12345' } });
  assert.equal(ui.event({ type: 'operation', name: 'count_open' }), true);
  await sleep(20);
  const delta = ui.delta();
  assert.match(delta, /^\[the window, revision \d+: /);
  assert.match(delta, /the person answered the question "Which account should the refund go to\?"/);
  assert.match(delta, /the person answered count_open/);
  assert.equal(ui.delta(), ''); // told once
});

test("the harness's permission ask is drawn as it asks it: its options in its order and words, the call's tool, input and diff", async () => {
  shown.length = 0;
  const kept = ui.answers().length;
  const pick = ui.permission({
    title: 'Edit invoices.csv',
    tool: 'Edit',
    input: { file_path: '/work/invoices.csv' },
    content: [
      {
        type: 'diff',
        path: '/work/invoices.csv',
        oldText: 'id,amount\nINV-1,100\nINV-2,80',
        newText: 'id,amount\nINV-1,120\nINV-2,80',
      },
    ],
    locations: [{ path: '/work/invoices.csv', line: 2 }],
    options: [{ name: 'Yes' }, { name: "Yes, and don't ask again this session" }, { name: 'No' }],
  });
  const ask = await askShown();
  assert.equal(ask.ask!.kind, 'permission');
  assert.equal(ask.ask!.title, 'Edit invoices.csv');
  assert.deepEqual(ask.ask!.choices, ['Yes', "Yes, and don't ask again this session", 'No']); // its words, its order
  const drawn = JSON.stringify(ask.wide);
  for (const t of [
    '@@ line 2',
    '- INV-1,100',
    '+ INV-1,120',
    '/work/invoices.csv:2',
    '\\"file_path\\": \\"/work/invoices.csv\\"',
    'change to /work/invoices.csv',
  ])
    assert.ok(drawn.includes(t), t);
  assert.ok(!drawn.includes('INV-2,80')); // the lines that do not change are left out
  assert.equal(
    ui.event({
      type: 'action',
      view: ask.name,
      name: 'answer',
      context: { ticket: ask.ask!.ticket, choice: 'No', n: 1 },
    }),
    true,
  ); // a choice and a place that disagree
  assert.match(JSON.stringify((await askShown()).wide), /pick one of the choices/);
  ui.event({
    type: 'action',
    view: ask.name,
    name: 'answer',
    context: { ticket: ask.ask!.ticket, choice: "Yes, and don't ask again this session", n: 1 },
  });
  assert.equal(await pick, 1); // the option's place: the host maps it back to the processor's own option
  assert.equal(ui.answers().length, kept); // the answer goes to the processor, which keeps it; not kept here
});

test('an ask whoever asked stops waiting for leaves the window unanswered', async () => {
  shown.length = 0;
  const stop = new AbortController();
  const pick = ui.permission(
    { title: 'npm test', tool: 'Bash', options: [{ name: 'Yes' }, { name: 'No' }] },
    stop.signal,
  );
  const ask = await askShown();
  assert.ok(ui.shell().views.some((v) => v.name === ask.name));
  stop.abort(); // the turn was cancelled
  assert.equal(await pick, null);
  assert.equal(
    ui.shell().views.some((v) => v.name === ask.name),
    false,
  );
  assert.equal(
    ui.event({
      type: 'action',
      view: ask.name,
      name: 'answer',
      context: { ticket: ask.ask!.ticket, choice: 'Yes', n: 0 },
    }),
    false,
  ); // too late: nothing to answer
});

test("a page to open is shown with the harness's words and its full address; open or decline it, collapsed or not", async () => {
  shown.length = 0;
  ui.delta();
  const url = 'https://ledger.example/oauth/authorize?state=x1';
  const opened = ui.link({ message: 'Sign in to the ledger service', url });
  const ask = await askShown();
  assert.equal(ask.ask!.kind, 'link');
  assert.equal(ask.ask!.link, url);
  assert.ok(JSON.stringify(ask.wide).includes(url));
  assert.ok(JSON.stringify(ask.wide).includes('Sign in to the ledger service'));
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket } });
  assert.equal(await opened, 'accept');
  const parked = ui.link({ message: 'Sign in again', url });
  const again = await askShown();
  assert.equal(ui.event({ type: 'collapse', view: again.name }), true); // into the shelf: still asked
  assert.deepEqual((await json('look', {})).waiting_for_the_person, [
    { ticket: again.ask!.ticket, op: 'a page to open' },
  ]);
  ui.event({ type: 'action', view: again.name, name: 'decline', context: { ticket: again.ask!.ticket } });
  assert.equal(await parked, 'decline');
  const delta = ui.delta();
  assert.match(delta, /the request to open a page at ledger\.example/);
  assert.ok(!delta.includes('state=x1')); // the host, not the address
});

test("a form keeps the schema's own words: titled choices with their descriptions, several picks, and each question", async () => {
  shown.length = 0;
  const schema = {
    type: 'object',
    properties: {
      // as claude-agent-acp sends Claude Code's AskUserQuestion
      question_0: {
        type: 'string',
        title: 'Cache',
        description: 'Which cache should the service use?',
        oneOf: [
          { const: 'Redis', title: 'Redis', description: 'in memory, shared' },
          { const: 'None', title: 'None' },
        ],
      },
      question_0_custom: { type: 'string', title: 'Other', description: 'Type your own answer (optional).' },
      question_1: {
        type: 'array',
        title: 'Checks',
        description: 'Which checks should run?',
        items: {
          anyOf: [
            { const: 'lint', title: 'Lint' },
            { const: 'unit', title: 'Unit tests' },
            { const: 'e2e', title: 'End to end' },
          ],
        },
      },
    },
  };
  const answer = ui.ask({ message: 'Please answer the following questions.', schema });
  const ask = await askShown();
  assert.deepEqual(ask.ask!.fields.question_1, {
    type: 'string',
    multi: true,
    title: 'Checks',
    description: 'Which checks should run?',
    enum: ['lint', 'unit', 'e2e'],
    labels: ['Lint', 'Unit tests', 'End to end'],
  });
  const drawn = JSON.stringify(ask.wide);
  for (const t of [
    'Which cache should the service use?',
    'Redis — in memory, shared',
    'multipleSelection',
    'Unit tests',
    'Type your own answer (optional).',
  ])
    assert.ok(drawn.includes(t), t);
  ui.event({
    type: 'action',
    view: ask.name,
    name: 'answer',
    context: { ticket: ask.ask!.ticket, 'f:question_0': ['Redis'], 'f:question_1': ['lint', 'nope'] },
  });
  assert.match(JSON.stringify((await askShown()).wide), /nope is not one of lint, unit, e2e/);
  ui.event({
    type: 'action',
    view: ask.name,
    name: 'answer',
    context: {
      ticket: ask.ask!.ticket,
      'f:question_0': ['Redis'],
      'f:question_0_custom': '',
      'f:question_1': ['lint', 'e2e'],
    },
  });
  assert.deepEqual(await answer, { action: 'accept', content: { question_0: 'Redis', question_1: ['lint', 'e2e'] } }); // the schema's own values
});
