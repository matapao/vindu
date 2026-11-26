// Vindu's blocks over real MCP, then drawn in Chromium: each takes exact rows, finds its roles by their usual names (or
// the model's map), computes what it works out itself (an invoice's total and whether the document agrees, free time,
// tracked changes, where places and nodes go, a batch's outcomes), says so in its account, and draws every row with a
// reference the window can point at. All data is synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { wordDiff, freeSlots, layered, MESSAGE, MONEY_BLOCK, type Shaped } from '../src/index.js';
import type { PanelSpec } from '../src/cards.js';
import { R, json, call, panel } from './blocks-session.js';

test("the system's own arithmetic in blocks: word diffs, free time, layers", () => {
  assert.deepEqual(wordDiff('over 12 m.', 'over 16 m and anchored.'), [
    { op: '=', t: 'over ' },
    { op: '-', t: '12' },
    { op: '+', t: '16' },
    { op: '=', t: ' m' },
    { op: '+', t: ' and anchored' },
    { op: '=', t: '.' },
  ]);
  const busy = [
    ['09:00', '10:00'],
    ['10:15', '11:00'],
    ['12:00', '13:30'],
  ].map(([a, b]) => ({ start: Date.parse(`2026-11-16T${a}:00Z`), end: Date.parse(`2026-11-16T${b}:00Z`) }));
  assert.deepEqual(
    freeSlots(busy, Date.parse('2026-11-16T00:00:00Z'), Date.parse('2026-11-16T23:59:59Z'), ['08:00', '16:00'], 30).map(
      (s) => `${s.start.slice(11, 16)}–${s.end.slice(11, 16)}`,
    ),
    ['08:00–09:00', '11:00–12:00', '13:30–16:00'],
  );
  const l = layered(
    ['a', 'b', 'c', 'd'],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['a', 'd'],
    ],
  );
  assert.deepEqual([l.get('a')!.layer, l.get('b')!.layer, l.get('c')!.layer, l.get('d')!.layer], [0, 1, 2, 1]);
});

test("a block works out what it shows without keeping it on the panel: its rows, its component's props, its account", () => {
  const p: PanelSpec = { id: 'inv', card: 'money', map: { quantity: 'hours', price: 'rate' } };
  const given = structuredClone(p);
  const got = MONEY_BLOCK.rows!([{ description: 'Design work', hours: 2, rate: 950 }], p, () => undefined, {
    inputs: {},
  }) as Shaped;
  assert.deepEqual(p, given); // the model's map stays the model's: nothing it worked out is hidden on the panel
  assert.deepEqual(got.props!.map, { quantity: 'hours', price: 'rate', description: 'description', amount: 'amount' });
  assert.deepEqual(got.props!.totals, { lines: 1900, total: 1900 });
  assert.equal(
    got.account!.totals,
    'computed by the system (each amount = quantity × price): {"lines":1900,"total":1900}',
  );
  const one: PanelSpec = { id: 'm', card: 'message' };
  assert.equal(
    (MESSAGE.rows!([{ subject: 'Hi', body: 'Hello' }], one, () => undefined, { inputs: {} }) as Shaped).props!.layout,
    'one',
  );
  assert.equal(one.layout, undefined);
});

test('messages, documents with tracked changes, events with free time, tasks: roles found, computed by the system, said in the account', async () => {
  const a = await json('show_view', {
    name: 'work',
    title: 'Work',
    panels: [
      { id: 'inbox', card: 'message', from: R.inbox },
      { id: 'one', card: 'message', from: R.inbox, limit: 1 },
      { id: 'contract', card: 'document', from: R.v2, before: R.v1 },
      { id: 'today', card: 'events', from: R.events },
      {
        id: 'free',
        card: 'events',
        from: R.events,
        layout: 'free',
        within: { from: '2026-11-16', to: '2026-11-16' },
        hours: ['08:00', '16:00'],
        length: '30m',
      },
      { id: 'board', card: 'tasks', from: R.tasks, layout: 'board', order: ['todo', 'doing', 'done'] },
      { id: 'typo', card: 'events', from: R.typo },
    ],
  });
  assert.deepEqual(panel(a, 'inbox').roles, {
    from: 'from',
    subject: 'subject',
    body: 'body',
    time: 'time',
    state: 'state',
  });
  assert.equal(panel(a, 'inbox').layout, 'inbox');
  assert.equal(panel(a, 'one').layout, 'one');
  assert.match(
    String(panel(a, 'contract').tracked_changes),
    /^computed by the system, from r2 to r3: \d+ insertions, \d+ deletions, 1 new sections, 1 removed$/,
  );
  assert.equal(panel(a, 'today').events, 3);
  assert.equal(
    panel(a, 'free').free,
    'computed by the system from the busy events: 3 free spans of at least 30m, 08:00–16:00 UTC',
  );
  assert.deepEqual(panel(a, 'board').by_state, { done: 1, doing: 1, todo: 1 });
  assert.equal(a.typed_numbers_not_in_any_result, undefined);
});

test("money: amounts as quantity × price when missing, totals by the system, and whether the document's own total agrees", async () => {
  const a = await json('show_view', {
    name: 'invoices',
    title: 'Invoices',
    panels: [
      {
        id: 'right',
        card: 'money',
        from: R.invoice,
        pick: 'lines',
        layout: 'invoice',
        map: { quantity: 'hours', price: 'rate' },
      },
      { id: 'wrong', card: 'money', from: R.wrong, pick: 'lines', layout: 'invoice' },
    ],
  });
  assert.equal(
    panel(a, 'right').totals,
    'computed by the system (each amount = quantity × price): {"lines":37475,"total":37475,"stated":37475,"agrees":true}',
  );
  assert.equal(panel(a, 'right').mismatch, undefined);
  assert.equal(panel(a, 'wrong').mismatch, "the document's own total is not what its lines add up to"); // hours and rate found by their names
});

test('files, a map, contacts, a batch, changes, a diagram, a sheet with scenarios', async () => {
  const a = await json('show_view', {
    name: 'more',
    title: 'More',
    panels: [
      { id: 'files', card: 'files', from: R.files },
      { id: 'fleet', card: 'map', from: R.places },
      { id: 'people', card: 'contacts', from: R.contacts },
      { id: 'sent', card: 'batch', results: [`${R.sends[0]}-${R.sends[4]}`] },
      { id: 'refunds', card: 'changes', from: R.changes },
      { id: 'dropped', card: 'changes', from: R.dropped },
      { id: 'money-flow', card: 'diagram', from: R.links },
      {
        id: 'budget',
        card: 'sheet',
        from: R.budget,
        compute: { budget: 'round(actual * (1 + $growth), 0)' },
        inputs: { growth: 0.04 },
        scenarios: { low: { growth: 0.02 }, base: { growth: 0.04 }, high: { growth: 0.06 } },
        totals: { 'Next year': 'sum(budget)' },
      },
    ],
  });
  assert.equal(panel(a, 'files').files, 2);
  assert.equal(panel(a, 'fleet').places, 3);
  assert.match(String(panel(a, 'fleet').drawn), /no map tiles/);
  assert.deepEqual(panel(a, 'people').roles, {
    name: 'name',
    role: 'title',
    org: 'company',
    email: 'email',
    phone: 'phone',
  });
  assert.deepEqual([panel(a, 'sent').calls, panel(a, 'sent').ok, panel(a, 'sent').failed], [5, 4, [R.sends[2]]]);
  assert.deepEqual(panel(a, 'refunds').fields_changed, ['status', 'refund']);
  assert.deepEqual(panel(a, 'dropped').fields_changed, ['note']); // a field left out of after is a change too
  assert.equal(panel(a, 'money-flow').nodes, 4);
  assert.deepEqual(panel(a, 'budget').values, [
    {
      label: 'Next year',
      expr: 'sum(budget)',
      values: [
        { scenario: 'low', value: 2_040_000 },
        { scenario: 'base', value: 2_080_000 },
        { scenario: 'high', value: 2_120_000 },
      ],
    },
  ]);
  assert.equal(a.typed_numbers_not_in_any_result, undefined);
});

test('a block says what it needs when the rows do not have it, and never draws a guess', async () => {
  const noRoles = await call('show_view', {
    name: 'x',
    title: 'X',
    panels: [{ card: 'message', data: [{ a: 1, b: 2 }] }],
  });
  assert.equal(noRoles.ok, false);
  assert.match(noRoles.text, /a message needs one of subject, body; fields here: a, b; say which with map/);
  const badMap = await call('show_view', {
    name: 'x',
    title: 'X',
    panels: [{ card: 'map', from: R.places, map: { lat: 'nope' } }],
  });
  assert.match(badMap.text, /map: no field "nope" for lat/);
  const badLayout = await call('show_view', {
    name: 'x',
    title: 'X',
    panels: [{ card: 'tasks', from: R.tasks, layout: 'kanban' }],
  });
  assert.match(badLayout.text, /tasks has no layout "kanban"; layouts: checklist, board, steps/);
});
