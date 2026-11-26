// The host's part, over real MCP and with no browser: operations it adds mid-task, how far the model arranges the
// window, MCP Apps and the app tools a native host submits, asks it draws itself, the model's own questions, and the
// host's own panes and yes-or-no. The session is precision.test.ts's, with its view of what is overdue shown.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { startVindu, type Shown } from '../src/index.js';
import { get, mcpClient, sleep } from './helpers.js';
import { askShown, call, json, results, shown, tmp, ui } from './precision-session.js';

// what the account test in precision.test.ts shows first, which the arranging and the host's panes below refer to
await json('show_view', {
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

test('an operation added mid-task is reached through invoke, since the tool list holds still within a session', async () => {
  ui.register({
    name: 'export_csv',
    description: 'Write the overdue invoices to a CSV file in the working folder.',
    effect: 'read',
    run: () => ({ file: 'overdue.csv' }),
  });
  const look = await json('look', {});
  assert.deepEqual(look.added_operations, [
    {
      name: 'export_csv',
      does: 'Write the overdue invoices to a CSV file in the working folder.',
      effect: 'read',
      input: [],
    },
  ]);
  assert.deepEqual((await json('invoke', { name: 'export_csv' })).output, { file: 'overdue.csv' });
  assert.equal((await call('invoke', { name: 'nope' })).ok, false);

  const received: unknown[] = [];
  ui.register({
    name: 'item_count',
    description: 'Count items.',
    effect: 'read',
    input: { quantity: z.string().regex(/^\d+$/).transform(Number) },
    run: (input) => {
      received.push(input.quantity);
      return input.quantity;
    },
  });
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
  assert.equal(stopped.ok, false);
  assert.match(
    stopped.text,
    /the person changed the window since you last read it \(collapsed "second" into the shelf\)/,
  );
  assert.equal((await call('arrange', { layout: ['overdue', 'second'] })).ok, true); // told now: it goes ahead
  const v2 = await startVindu({ modelArrange: 'suggest' });
  const states: { suggestion: unknown }[] = [];
  const t = v2.open({ results, dir: tmp('sug-') }, { onState: (st) => states.push(st) });
  const c = await mcpClient(t.url);
  await c.json('show_view', { name: 'a', title: 'A', panels: [{ card: 'table', from: 'r1' }] });
  await c.json('show_view', { name: 'b', title: 'B', panels: [{ card: 'table', from: 'r1' }] });
  const s = await c.json('arrange', { layout: { column: ['a', 'b'] } });
  assert.match(s.notes.join(), /suggested to the person/);
  assert.deepEqual(s.layout, { row: ['a', 'b'] }); // nothing moved
  assert.ok(states.at(-1)!.suggestion);
  assert.equal(t.event({ type: 'take-suggestion' }), true);
  const look = await c.json('look', {});
  assert.deepEqual(look.layout, { column: ['a', 'b'] });
  assert.match(look.person[0], /took the layout you suggested/);
  await c.mcp.close();
  t.close();
  await v2.close();
  const v3 = await startVindu({ modelArrange: 'off' });
  const t3 = v3.open({ results, dir: tmp('off-') });
  const c3 = await mcpClient(t3.url);
  assert.match((await c3.call('arrange', { focus: 'x' })).text, /the person arranges this window themselves/);
  await c3.mcp.close();
  t3.close();
  await v3.close();
});

test('MCP Apps are off unless the host turns them on, and a host can offer fewer cards', async () => {
  const off = await call('show_view', { name: 'app', title: 'App', panels: [{ card: 'app', from: 'r1' }] });
  assert.match(off.text, /there is no "app" card here/);
  const v4 = await startVindu({ kinds: ['table', 'kpi'] });
  const t4 = v4.open({ results, dir: tmp('kinds-') });
  const c4 = await mcpClient(t4.url);
  const { tools } = await c4.mcp.listTools();
  assert.doesNotMatch(JSON.stringify(tools.find((x) => x.name === 'show_view')!.inputSchema), /bar-chart/);
  assert.match(
    (
      await c4.call('show_view', {
        name: 'c',
        title: 'C',
        panels: [{ card: 'bar-chart', from: 'r1', x: 'customer', y: 'amount_nok' }],
      })
    ).text,
    /no "bar-chart" card here; cards: table, kpi/,
  );
  await c4.mcp.close();
  t4.close();
  await v4.close();
});

test('a native host submits the current app tool and its exact input; frame messages still ask', async () => {
  const host = await startVindu({ apps: 'on', asks: 'host' });
  let frame = '';
  const calls: unknown[] = [],
    asks: Shown[] = [];
  let visibility = ['app'];
  const result = { structuredContent: { count: 1 }, content: [] };
  const session = host.open(
    { results, dir: tmp('submitted-') },
    {
      onView: (item) => {
        if (item.ask) asks.push(item);
      },
      apps: {
        tools: () => [{ name: 'query', _meta: { ui: { resourceUri: 'ui://db/search', visibility } } }],
        read: async () => ({ contents: [] }),
        call: async (...args) => {
          calls.push(args);
          return result;
        },
      },
      onPresentation: (v) => {
        frame = v.panels[0]?.frame?.url ?? '';
      },
    },
  );
  const client = await mcpClient(session.url);
  const spec = { name: 'search', title: 'Search', panels: [{ card: 'app', id: 'form', from: 'r1' }] };
  try {
    await client.json('show_view', spec);
    assert.ok(frame);
    const fields = JSON.parse('{"term":"invoice","filters":["open"],"__proto__":"field"}') as Record<string, unknown>;
    const input = { view: 'search', panel: 'form', frame, name: 'query', arguments: fields };
    assert.deepEqual(
      await session.submitAppTool(input, async (...args) => {
        calls.push(args);
        return result;
      }),
      result,
    );
    assert.deepEqual(calls, [['db', 'query', fields]]);
    assert.equal(asks.length, 0);

    const rpc = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'query', arguments: input.arguments } };
    assert.equal(
      session.event({
        type: 'app',
        view: 'search',
        panel: 'form',
        resource: new URL(frame).hostname,
        mount: 'a'.repeat(32),
        msg: rpc,
      }),
      true,
    );
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
  } finally {
    await client.mcp.close();
    session.close();
    await host.close();
  }
});

test('app calls stay with the requesting window and resource across approval, replacement and task close', async () => {
  const host = await startVindu({ apps: 'on', asks: 'host' });
  const fallback: unknown[] = [],
    replies: Record<string, unknown>[] = [],
    calls: string[] = [];
  let pendingRead: (() => void) | undefined,
    frame = '',
    offered = true,
    asked: Shown | undefined;
  const session = host.open(
    { results, dir: tmp('app-lifetime-') },
    {
      onView: (v) => {
        if (v.ask) asked = v;
      },
      apps: {
        tools: () => [
          { name: 'query', _meta: { ui: { resourceUri: 'ui://db/search' } } },
          ...(offered ? [{ name: 'save' }] : []),
        ],
        read: async (_, uri) => {
          if (uri.endsWith('/pending'))
            await new Promise<void>((ok) => {
              pendingRead = ok;
            });
          return { contents: [{ uri, text: 'resource' }] };
        },
        call: async (_, name) => {
          calls.push(name);
          return {};
        },
      },
      onPresentation: (view) => {
        frame = view.panels[0]?.frame?.url ?? '';
      },
      onApp: (...args) => fallback.push(args),
    },
  );
  const client = await mcpClient(session.url);
  const spec = { name: 'results', title: 'Results', panels: [{ card: 'app', id: 'panel', from: 'r1' }] };
  const event = (method: string, params: unknown = {}) => ({
    type: 'app',
    view: spec.name,
    panel: 'panel',
    resource: new URL(frame).hostname,
    mount: 'b'.repeat(32),
    msg: { jsonrpc: '2.0', id: 1, method, params },
  });
  const reply = (_v: string, _p: string, msg: Record<string, unknown>) => replies.push(msg);
  try {
    await client.json('show_view', spec);
    const firstFrame = frame,
      ping = event('ping');
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
    pendingRead();
    await sleep(0);
    assert.equal(replies.length, count);
    assert.equal(session.event(ping, reply), false);
    assert.equal((await get(firstFrame)).status, 404);
    assert.equal((await get(frame)).status, 200);
    await client.mcp.close();
    session.close();
    assert.equal((await get(frame)).status, 404);
  } finally {
    await client.mcp.close();
    session.close();
    await host.close();
  }
});

test('a host that draws asks itself: no pane for them, answered by ticket from its own place, and told when each one leaves', async () => {
  const v5 = await startVindu({ asks: 'host' });
  const got: Shown[] = [];
  const gone: [string, string][] = [];
  const t5 = v5.open(
    { results, dir: tmp('host-') },
    { onView: (s) => got.push(s), onAskGone: (view, action) => gone.push([view, action]) },
  );
  try {
    const pick = t5.permission({ title: 'npm test', tool: 'Bash', options: [{ name: 'Yes' }, { name: 'No' }] });
    const ask = got.find((s) => s.ask)!;
    assert.equal(
      t5.shell().views.some((x) => x.name === ask.name),
      false,
    ); // the host draws it; the window's panes are for views
    assert.equal(
      t5.event({
        type: 'action',
        view: ask.name,
        name: 'answer',
        context: { ticket: ask.ask!.ticket, choice: 'No', n: 1 },
      }),
      true,
    );
    assert.equal(await pick, 1);
    assert.deepEqual(gone, [[ask.name, 'accept']]);
    const stop = new AbortController();
    const form = t5.ask(
      {
        message: 'Which suite should run again?',
        schema: { type: 'object', properties: { suite: { type: 'string' } } },
      },
      stop.signal,
    );
    stop.abort(); // the turn was cancelled: the host takes the form away
    assert.deepEqual(await form, { action: 'cancel' });
    assert.deepEqual(gone.at(-1), [got.at(-1)!.name, 'cancel']);
  } finally {
    t5.close();
    await v5.close();
  }
});

test('ask: the model asks the person something in the window; the answer is kept as a p-id', async () => {
  shown.length = 0;
  const answer = json('ask', { question: 'Which customer first?', choices: ['Vik Data', 'Strand Bygg'] });
  const ask = await askShown();
  assert.equal(ask.ask!.kind, 'question');
  assert.deepEqual(ask.ask!.choices, ['Vik Data', 'Strand Bygg']);
  assert.equal(ask.ask!.message, 'Which customer first?');
  ui.event({
    type: 'action',
    view: ask.name,
    name: 'answer',
    context: { ticket: ask.ask!.ticket, choice: 'Strand Bygg', n: 1 },
  });
  const got = await answer;
  assert.deepEqual(got.answer, { choice: 'Strand Bygg' });
  assert.match(got.id, /^p\d+$/);
  assert.match(
    (await call('results', {})).text,
    new RegExp(`${got.id}: the person answered the question "Which customer first\\?"`),
  );
  const free = json('ask', { question: 'Anything else before I send it?' }); // nothing to pick: a written answer
  const q = await askShown();
  assert.deepEqual(Object.keys(q.ask!.fields), ['answer']);
  assert.deepEqual(q.ask!.required, ['answer']);
  ui.event({ type: 'action', view: q.name, name: 'decline', context: { ticket: q.ask!.ticket } });
  assert.equal((await free).declined, true);
  const slow = await json('ask', { question: 'Ready?', fields: { ok: { type: 'boolean', title: 'Ready' } } }); // waitMs is 400 here
  assert.equal(slow.pending, true);
  const later = json('await_answer', { ticket: slow.ticket });
  ui.event({
    type: 'action',
    view: `ask-${slow.ticket}`,
    name: 'answer',
    context: { ticket: slow.ticket, 'f:ok': true },
  });
  assert.deepEqual((await later).answer, { ok: true });
});

test("the host's own panes sit in the layout with the views; the host says what each is; what the person did there is told once", async () => {
  await json('look', {});
  ui.delta(); // read: nothing the person changed is waiting
  const notes = ui.pane({
    name: 'terminal-1',
    title: 'Terminal 1',
    kind: 'terminal',
    about: () => ({ cwd: '/work', shared: true, last: { command: 'npm test', exit: 1 } }),
  });
  assert.ok(Array.isArray(notes));
  assert.ok(ui.shell().views.some((v) => v.name === 'terminal-1' && v.kind === 'terminal' && v.fill));
  const look = await json('look', {});
  const pane = look.panes.find((p: { view: string }) => p.view === 'terminal-1');
  assert.equal(pane.kind, 'terminal');
  assert.deepEqual(pane.about, { cwd: '/work', shared: true, last: { command: 'npm test', exit: 1 } });
  assert.equal(pane.cards, undefined); // not a view of cards
  assert.match(
    (await call('show_view', { name: 'terminal-1', title: 'X', panels: [{ card: 'text', text: 'x' }] })).text,
    /"terminal-1" is one of the window's own panes \(terminal\); show the view under another name/,
  );
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
  assert.equal(
    ui.shell().views.some((v) => v.name === 'terminal-1'),
    false,
  );
});

test("a yes or no of the host's own shows what it is about, and only a yes from its pane counts", async () => {
  shown.length = 0;
  const yes = ui.confirm({
    title: 'Run this in Terminal 1?',
    message: "It runs as you, outside the harness's sandbox.",
    details: [{ label: 'command', text: 'npm run build' }],
  });
  const ask = await askShown();
  assert.equal(ask.ask!.confirm, true);
  assert.deepEqual(ask.ask!.details, [{ label: 'command', text: 'npm run build' }]);
  assert.ok(JSON.stringify(ask.wide).includes('npm run build'));
  ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket } });
  assert.equal(await yes, true);
  const no = ui.confirm({ title: 'Run this?' });
  const a2 = await askShown();
  ui.event({ type: 'close', view: a2.name }); // closed: no
  assert.equal(await no, false);
});
