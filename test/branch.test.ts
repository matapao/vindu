// A new process from a view: the view as the person left it (their changes inside it, its marks, the layout, what they
// point at), on the entries it points at, carried exactly under the new process's ids; the first prompt's note says where
// it came from and what was done in it, so a fresh run starts from the view, not from the earlier conversation. All
// synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startVindu,
  memoryResults,
  resultRef,
  shorthand,
  VINDU_CATALOG,
  z,
  type Shown,
  type ShellState,
} from '../src/index.js';
import type { PointItem } from '../src/pointing.js';
import { mcpClient, sleep, panelsIn, type Row } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(20);
  }
};
const invoices = [
  { number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050 },
  { number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: 19800 },
  { number: 'INV-2026-0431', customer: 'Havgap Media', amount: 17160 },
];
const tasks = [
  { id: 't1', title: 'Chase Havgap Media', due: '2026-11-12' },
  { id: 't2', title: 'Book the auditor', due: '2026-11-20' },
];

test('a new task from a view: carried exactly under new ids, as the person left it; the first note says where it came from', async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const a = memoryResults(tmp('a-'));
  a.add({ server: 'accounts', tool: 'list_invoices', value: invoices });
  a.add({ server: 'tasks', tool: 'list', value: tasks });
  const shownA: Shown[] = [];
  const stA: { s?: ShellState } = {};
  const uiA = vindu.open(
    { results: a, dir: tmp('a-dir-') },
    {
      onView: (v) => shownA.push(v),
      onState: (s) => {
        stA.s = s;
      },
    },
  );
  const ca = await mcpClient(uiA.url);
  const shownB: Shown[] = [];
  const stB: { s?: ShellState } = {};
  let uiB: ReturnType<typeof vindu.open> | undefined;
  try {
    // process A: invoices the person sorts, tasks, the person's own answer, and a text that cites a value by reference
    const asked = uiA.ask(
      {
        message: 'Who follows up?',
        schema: { type: 'object', required: ['who'], properties: { who: { type: 'string', title: 'Who' } } },
      },
      new AbortController().signal,
    );
    await until(() => shownA.some((v) => v.ask));
    const k = shownA.find((v) => v.ask)!;
    uiA.event({ type: 'action', view: k.name, name: 'answer', context: { ticket: k.ask!.ticket, 'f:who': 'Kari' } });
    await asked;
    await ca.json('show_view', {
      name: 'inv',
      title: 'Invoices',
      panels: [{ id: 'rows', card: 'table', from: 'r1', columns: ['number', 'amount'] }],
    });
    await ca.json('show_view', {
      name: 'todo',
      title: 'To do',
      panels: [{ id: 't', card: 'tasks', from: 'r2' }],
      place: { beside: 'inv', side: 'below' },
    });
    await ca.json('show_view', {
      name: 'who',
      title: 'Who follows up',
      panels: [
        { id: 'w', card: 'record', from: 'p1' },
        { id: 'note', card: 'text', text: 'The largest is ctx:r1#/0/amount.' },
      ],
    });
    const n = shownA.length;
    uiA.event({
      type: 'action',
      view: 'inv',
      name: 'view_action',
      context: { action: 'sort', panel: 'rows', field: 'amount' },
    });
    await until(() => shownA.length > n && stA.s!.views.find((v) => v.name === 'inv')?.mark !== undefined);
    await sleep(30);
    uiA.event({ type: 'select', items: [{ view: 'todo', panel: 't', row: 1 }] });
    const snap = uiA.snapshot();
    assert.deepEqual(
      snap.views.map((v) => v.name),
      ['inv', 'todo', 'who'],
    );
    assert.deepEqual(snap.ids.sort(), ['r1', 'r2']);
    assert.deepEqual(
      snap.answers.map((x) => x.id),
      ['p1'],
    );
    assert.deepEqual(snap.changes, ['the person sorted Invoices by amount, smallest or earliest first']);
    assert.deepEqual(snap.views[0].mark, { text: 'Sorted by amount, smallest or earliest first', by: 'person' });

    // process B: a fresh run with a result of its own first, so the carried ones get other ids there
    const b = memoryResults(tmp('b-'));
    b.add({ server: 'notes', tool: 'get', value: { text: 'unrelated' } });
    const carried = {
      r1: b.add({ server: 'accounts', tool: 'list_invoices', value: invoices }).id,
      r2: b.add({ server: 'tasks', tool: 'list', value: tasks }).id,
    }; // as a host carries them
    assert.deepEqual(carried, { r1: 'r2', r2: 'r3' });
    uiB = vindu.open(
      { results: b, dir: tmp('b-dir-') },
      {
        onView: (v) => shownB.push(v),
        onState: (s) => {
          stB.s = s;
        },
      },
    );
    const got = await uiB.startFrom(JSON.parse(JSON.stringify(snap)), carried);
    assert.deepEqual(got.shown, ['inv', 'todo', 'who']);
    assert.deepEqual(got.refused, {});
    assert.deepEqual(got.map, { r1: 'r2', r2: 'r3', p1: 'p1' });
    const restoredTasks = shownB.find((v) => v.name === 'todo')!;
    for (const surface of [restoredTasks.wide, restoredTasks.compact]) {
      const create = surface.find((message) => message.createSurface)!.createSurface;
      assert.deepEqual(create, { surfaceId: 'todo', catalogId: VINDU_CATALOG });
    }
    const model = (name: string) => panelsIn(shownB.filter((v) => v.name === name).at(-1)!.wide);
    assert.deepEqual(
      model('inv').p_rows.rows.map((r) => r.c0),
      ['INV-2026-0431', 'INV-2026-0418', 'INV-2026-0412'],
    ); // as the person sorted it
    assert.deepEqual(stB.s!.views.find((v) => v.name === 'inv')!.mark, {
      text: 'Sorted by amount, smallest or earliest first',
      by: 'person',
    });
    assert.ok(
      JSON.stringify(shownB.filter((v) => v.name === 'who').at(-1)!.wide).includes('The largest is ctx:r2#/0/amount.'),
    ); // its references, this process's
    assert.deepEqual(shorthand(stB.s!.tree), snap.layout); // in the layout the person left
    assert.deepEqual(
      ((stB.s!.pointing?.picked ?? []) as PointItem[]).map((it) => [it.view, it.row]),
      [['todo', 1]],
    ); // what the person pointed at, still
    assert.match(
      uiB.note,
      /This task starts from a view of an earlier task, as the person left it: "Invoices", "To do", "Who follows up", on what that task got, carried here exactly under this task's ids: r2 \(was r1\), r3 \(was r2\), p1 \(was p1\)\. Done in it: the person sorted Invoices by amount, smallest or earliest first\. The earlier task's conversation is not part of this one/,
    );
    const cb = await mcpClient(uiB.url);
    assert.equal((await cb.json('ctx_read', { ref: 'ctx:r2#/0/number' })).value, 'INV-2026-0412'); // the model there reads them by the new ids
    await cb.mcp.close();
    // a view whose entries were not carried is left out, and says why
    const c = memoryResults(tmp('c-'));
    const uiC = vindu.open({ results: c, dir: tmp('c-dir-') });
    const partial = await uiC.startFrom(snap, {
      r1: c.add({ server: 'accounts', tool: 'list_invoices', value: invoices }).id,
    });
    assert.deepEqual(partial.shown, ['inv', 'who']);
    assert.deepEqual(partial.refused, { todo: 'it points at r2, which were not carried' });
    uiC.close();
  } finally {
    await ca.mcp.close();
    uiA.close();
    uiB?.close();
    await vindu.close();
  }
});

test("carried too: the ids in every field that holds them, as each card marks its own (a batch's run of calls, a host card's field)", async () => {
  const pair = {
    name: 'pair',
    about: 'a result beside another',
    component: 'VPair',
    fields: { other: resultRef(z.string().optional().describe('pair: the other result')) },
  };
  const vindu = await startVindu({ waitMs: 300, cards: [pair] });
  const a = memoryResults(tmp('ids-a-'));
  for (const to of ['k1', 'k2', 'k3'])
    a.add({ server: 'mail', tool: 'send_reply', input: { to: `${to}@kunde.example` }, value: { status: 'sent' } });
  const uiA = vindu.open({ results: a, dir: tmp('ids-a-dir-') });
  const ca = await mcpClient(uiA.url);
  const b = memoryResults(tmp('ids-b-'));
  b.add({ server: 'notes', tool: 'get', value: { text: 'unrelated' } });
  const uiB = vindu.open({ results: b, dir: tmp('ids-b-dir-') });
  try {
    await ca.json('show_view', {
      name: 'calls',
      title: 'Replies sent',
      panels: [{ id: 'sent', card: 'batch', results: ['r1-r3'] }],
    });
    await ca.json('show_view', {
      name: 'pair',
      title: 'Pair',
      panels: [{ id: 'p', card: 'pair', from: 'r1', other: 'r3' }],
    });
    await ca.json('show_view', {
      name: 'one',
      title: 'One reply',
      panels: [{ id: 'r', card: 'record', source: 'r2' }],
    }); // another library's name for from
    const snap = uiA.snapshot();
    assert.deepEqual(snap.ids.sort(), ['r1', 'r2', 'r3']); // each call of the run, and the host card's own field
    const carried = Object.fromEntries(
      ['r1', 'r2', 'r3'].map((id) => {
        const e = a.get(id)!;
        return [
          id,
          b.add({
            server: 'mail',
            tool: 'send_reply',
            input: e.kind === 'result' ? e.input : {},
            value: { status: 'sent' },
          }).id,
        ];
      }),
    );
    assert.deepEqual(carried, { r1: 'r2', r2: 'r3', r3: 'r4' });
    const got = await uiB.startFrom(JSON.parse(JSON.stringify(snap)), carried);
    assert.deepEqual(got.refused, {});
    assert.deepEqual(got.shown, ['calls', 'pair', 'one']);
    const args = (name: string) => uiB.snapshot().views.find((v) => v.name === name)!.args as { panels: Row[] };
    assert.deepEqual(args('calls').panels[0].results, ['r2', 'r3', 'r4']); // the run, written out under this task's ids
    assert.deepEqual([args('pair').panels[0].from, args('pair').panels[0].other], ['r2', 'r4']);
    assert.equal(args('one').panels[0].source, 'r3');
  } finally {
    await ca.mcp.close();
    uiA.close();
    uiB.close();
    await vindu.close();
  }
});
