// What the model is told, once: what the person changed in the window and did in a view, in the next account the
// model reads or the next prompt's note, never in an account no one reads; whose each view is, as the window holds it;
// what a tool's short answers look like in results; and a result said where it comes in. No model; all synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type VinduOptions } from '../src/index.js';
import { get, mcpClient, sleep } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(20);
  }
};
const hours = [
  { client: 'Havgap Media', hours: 12, rate: 1450 },
  { client: 'Brattli Verksted', hours: 20, rate: 1100 },
];

async function windowWith(options: VinduOptions = {}) {
  const vindu = await startVindu(options);
  const dir = tmp('told-'),
    results = memoryResults(dir);
  results.add({ server: 'timesheet', tool: 'list_hours', value: hours });
  const shown: Shown[] = [];
  const ui = vindu.open({ results, dir }, { onView: (v) => shown.push(v) });
  const c = await mcpClient(ui.url);
  return {
    vindu,
    ui,
    results,
    shown,
    ...c,
    close: async () => {
      await c.mcp.close();
      ui.close();
      await vindu.close();
    },
  };
}

test('what the person changed is told with the next account the model reads, not taken by a view the system draws again', async () => {
  const w = await windowWith();
  try {
    await w.json('show_view', { name: 'hours', title: 'Hours', panels: [{ id: 'list', card: 'table', from: 'r1' }] });
    await w.json('show_view', {
      name: 'total',
      title: 'Total',
      panels: [
        {
          id: 'sum',
          card: 'kpi',
          from: 'r1',
          value: 'sum(hours * rate) * (1 + $growth)',
          inputs: { growth: { value: 0.04, label: 'Growth' } },
        },
      ],
    });
    await w.json('look', {}); // read: nothing waits to be told
    assert.equal(w.ui.event({ type: 'collapse', view: 'hours' }), true);
    const n = w.shown.length;
    assert.equal(
      w.ui.event({ type: 'action', view: 'total', name: 'set_inputs', context: { panel: 'sum', 'in:growth': '0,1' } }),
      true,
    ); // drawn again by the system
    await until(() => w.shown.length > n && w.ui.answers().length === 1);
    await sleep(30);
    const look = await w.json('look', {});
    assert.equal(look.person?.[0], 'collapsed "hours" into the shelf'); // the system's drawing took nothing
    assert.match(look.person.join('; '), /set growth to 0\.1 in Total \(sum\)/);
    assert.equal((await w.json('look', {})).person, undefined); // told once
    // shown by the model: the person's change is in the account it reads, as the reply leaves
    assert.equal(w.ui.event({ type: 'open', view: 'hours' }), true);
    const acc = await w.json('show_view', {
      name: 'notes',
      title: 'Notes',
      panels: [{ card: 'text', text: 'Synthetic notes.' }],
    });
    assert.deepEqual(acc.shell.person, ['opened "hours" where it was']);
    assert.equal((await w.json('look', {})).person, undefined);
  } finally {
    await w.close();
  }
});

test('what the person did in a view is said as they do it, however long the view takes to be drawn again', async () => {
  const w = await windowWith({ verifyMs: 700 }); // no window reads back here: every drawing waits that long before its account
  try {
    await w.json('show_view', {
      name: 'onboard',
      title: 'Onboarding',
      steps: true,
      panels: [
        { id: 'one', card: 'text', text: 'First, the hours.' },
        { id: 'two', card: 'table', from: 'r1' },
      ],
    });
    await w.json('show_view', { name: 'hours', title: 'Hours', panels: [{ id: 'list', card: 'table', from: 'r1' }] });
    w.ui.delta();
    let n = w.shown.length;
    assert.equal(w.ui.event({ type: 'action', view: 'onboard', name: 'step', context: { to: 2 } }), true);
    await until(() => w.shown.length > n); // drawn; its account is still to come
    assert.match(w.ui.delta(), /the person went to step 2 of 2 in Onboarding/);
    n = w.shown.length;
    assert.equal(w.ui.event({ type: 'view', view: 'hours', action: 'sort', panel: 'list', field: 'hours' }), true);
    await until(() => w.shown.length > n);
    assert.match(w.ui.delta(), /the person sorted .* by hours/);
    await sleep(800); // the drawings' accounts, done: nothing is said again
    assert.equal(w.ui.delta(), '');
  } finally {
    await w.close();
  }
});

test('whose each view is: the model, the system, the host or an ask, in the state, and what no one else may show under its name', async () => {
  const w = await windowWith({ reminders: true, modelArrange: 'allow' });
  try {
    await w.json('show_view', {
      name: 'hours',
      title: 'Hours',
      panels: [
        { id: 'list', card: 'table', from: 'r1' },
        { card: 'text', text: 'Synthetic.' },
      ],
    });
    w.ui.pane({ name: 'terminal-1', title: 'Terminal 1', kind: 'terminal' });
    w.ui.pane({ name: 'notes-1', title: 'Notes', kind: 'notes' });
    w.ui.showReminders();
    const roles = Object.fromEntries(w.ui.shell().views.map((v) => [v.name, v.role]));
    assert.deepEqual(roles.hours, { owner: 'model', checkpointed: true, pointable: true, chat: true });
    assert.deepEqual(roles['terminal-1'], { owner: 'host', checkpointed: false, pointable: true, chat: false }); // it points its own way
    assert.deepEqual(roles['notes-1'], { owner: 'host', checkpointed: false, pointable: true, chat: true });
    assert.deepEqual(roles.reminders, { owner: 'system', checkpointed: false, pointable: true, chat: true });
    assert.deepEqual(w.ui.shell().views.find((v) => v.name === 'hours')?.cards, ['table', 'text']); // its cards, one by one
    assert.match(
      (await w.call('show_view', { name: 'reminders', title: 'Mine', panels: [{ card: 'text', text: 'x' }] })).text,
      /"reminders" is one of the window's own panes \(the reminders: remind sets one\)/,
    );
    assert.match(
      (await w.call('show_view', { name: 'notes-1', title: 'Mine', panels: [{ card: 'text', text: 'x' }] })).text,
      /"notes-1" is one of the window's own panes \(notes\)/,
    );
    assert.match(
      (await w.call('arrange', { reserve: [{ name: 'reminders', title: 'Mine' }] })).text,
      /"reminders" is one of the window's own panes/,
    );
    assert.equal((await w.call('arrange', { reserve: [{ name: 'later', title: 'Later' }] })).ok, true);
    assert.deepEqual(w.ui.shell().views.find((v) => v.name === 'later')?.role, {
      owner: 'model',
      checkpointed: false,
      pointable: false,
      chat: false,
    });
    assert.throws(() => w.ui.pane({ name: 'later', title: 'X', kind: 'browser' }), /is a view the model showed/); // reserved by the model
    assert.throws(() => w.ui.pane({ name: 'reminders', title: 'X', kind: 'notes' }), /one of the window's own panes/);
    // an ask is the ask's own: not the model's to show, and not kept in a snapshot
    const asked = w.call('ask', { question: 'Which client first?', choices: ['Havgap Media', 'Brattli Verksted'] });
    await until(() => w.shown.some((v) => v.ask));
    const ask = w.shown.find((v) => v.ask)!;
    assert.deepEqual(w.ui.shell().views.find((v) => v.name === ask.name)?.role.owner, 'ask');
    assert.match(
      (await w.call('show_view', { name: ask.name, title: 'Mine', panels: [{ card: 'text', text: 'x' }] })).text,
      /one of the window's own panes \(it asks the person\)/,
    );
    assert.deepEqual(
      w.ui.snapshot().views.map((v) => v.name),
      ['hours'],
    );
    w.ui.event({ type: 'close', view: ask.name });
    await asked;
  } finally {
    await w.close();
  }
});

test("only a pane whose role says so goes in the chat: not an ask's, a reserved one, a terminal, or one that is not there", async () => {
  const w = await windowWith({ modelArrange: 'allow' });
  try {
    await w.json('show_view', { name: 'hours', title: 'Hours', panels: [{ id: 'list', card: 'table', from: 'r1' }] });
    w.ui.pane({ name: 'terminal-1', title: 'Terminal 1', kind: 'terminal' });
    assert.equal((await w.call('arrange', { reserve: [{ name: 'later', title: 'Later' }] })).ok, true);
    const asked = w.call('ask', { question: 'Which client first?', choices: ['Havgap Media', 'Brattli Verksted'] });
    await until(() => w.shown.some((v) => v.ask));
    const ask = w.shown.find((v) => v.ask)!.name;
    // a host's own window sends what it likes: the server holds to each pane's role, whatever the window draws
    for (const view of [ask, 'later', 'terminal-1', 'nowhere'])
      assert.equal(w.ui.event({ type: 'attach', view, on: true }), false, view);
    assert.equal(w.ui.context().text, '');
    assert.equal(w.ui.event({ type: 'attach', view: 'hours', on: true }), true);
    const told = JSON.parse(/^\[the window: (\{.*\})\]/s.exec(w.ui.context().text)![1]) as {
      in_the_chat: { view: string }[];
    };
    assert.deepEqual(
      told.in_the_chat.map((v) => v.view),
      ['hours'],
    );
    assert.equal(w.ui.event({ type: 'attach', view: 'hours', on: false }), true); // out of the chat, always
    assert.equal(w.ui.context().text, '');
    w.ui.event({ type: 'close', view: ask });
    await asked;
  } finally {
    await w.close();
  }
});

test("a tool's short answers share one line in results, by tool; anything else keeps its own", async () => {
  const w = await windowWith();
  try {
    for (const file of ['a.ts', 'b.ts', 'c.ts'])
      w.results.add({ server: 'files', tool: 'write', input: { file }, text: `Wrote ${file}` });
    w.results.add({ server: 'shell', tool: 'run', text: 'done' });
    w.results.add({ server: 'files', tool: 'write', input: { file: 'd.ts' }, text: 'Wrote d.ts' });
    w.results.add({ server: 'files', tool: 'read', text: 'x'.repeat(400) });
    const lines = (await w.call('results', {})).text.split('\n');
    assert.deepEqual(lines, [
      'r1: timesheet.list_hours → 2 rows with fields client, hours, rate',
      'r2–r4, r6: files.write → 4 results, each a short text alone (at most 200 characters)',
      'r5: shell.run → text, 4 characters',
      'r7: files.read → text, 400 characters',
    ]);
  } finally {
    await w.close();
  }
});

test('a result the host says has come is heard by its pages at once; once a host says so, they ask the store only now and then', async () => {
  const w = await windowWith();
  try {
    w.ui.result(w.results.add({ server: 'timesheet', tool: 'list_hours', value: hours }).id); // r2, said: the pages are told from now on
    let heard: { n: number; results: { id: string }[] } | undefined;
    const events = get(`${w.ui.pages}/__vindu/events?v=0&n=2`).then((r) => {
      heard = JSON.parse(r.body);
    });
    await sleep(150); // the page waits to hear
    const unsaid = w.results.add({ server: 'timesheet', tool: 'list_hours', value: [] }); // r3, not said
    await sleep(700);
    assert.equal(heard, undefined); // nothing asked the store for it
    w.ui.result(w.results.add({ server: 'timesheet', tool: 'list_hours', value: [] }).id); // r4, said
    await events;
    assert.deepEqual(
      heard!.results.map((r) => r.id),
      [unsaid.id, 'r4'],
    );
    // a result the host never says is still heard, within the slow asking (2 s)
    let late: { results: { id: string }[] } | undefined;
    const more = get(`${w.ui.pages}/__vindu/events?v=0&n=4`).then((r) => {
      late = JSON.parse(r.body);
    });
    const never = w.results.add({ server: 'timesheet', tool: 'list_hours', value: [] }); // r5, never said
    const t0 = Date.now();
    await more;
    assert.deepEqual(
      late!.results.map((r) => r.id),
      [never.id],
    );
    assert.ok(Date.now() - t0 < 3000, 'heard within the slow asking');
  } finally {
    await w.close();
  }
});
