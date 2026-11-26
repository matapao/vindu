// Static and dynamic views, over real MCP: a template checked when it loads (a source must only read); slots placed in
// its layout; its inputs asked; sources read by the host before the model starts; the model fills only slots, with the
// slot's block and fixed options; the person fills theirs (a capture) and approves what must be approved, changing it if
// need be; arrange and operations outside the template are refused; the view can turn dynamic, and a dynamic view can
// be pinned as a template. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { memoryResults, checkTemplate, type Shown } from '../src/index.js';
import { fitSlot } from '../src/templates.js';
import { mcpClient, answerOf, type LookSlot, type Row } from './helpers.js';
import { tmp, until, invoices, vindu, isRead, TEMPLATE } from './templates-session.js';

test('a template is checked when it loads: its blocks, its layout, and that every source only reads', () => {
  const cards = new Set(['kpi', 'table', 'media', 'text']);
  assert.deepEqual(checkTemplate(TEMPLATE, { cards, operations: ['send_reminder'], isRead }).problems, []);
  const bad = checkTemplate(
    {
      ...TEMPLATE,
      slots: {
        ...TEMPLATE.slots,
        a: { title: 'A', block: 'gauge' },
        b: { title: 'B', block: 'choose' },
        c: { title: 'C', block: 'table', source: { server: 'accounts', tool: 'send_mail' } },
        d: { title: 'D', block: 'table', source: { server: 'crm', tool: 'list_x' } },
      },
      layout: ['zzz'],
    },
    { cards, operations: [], isRead },
  );
  assert.deepEqual(bad.problems, [
    'slot a: no block "gauge" here; blocks: kpi, table, media, text, or free, choose, page, app',
    'slot b: "choose" needs "of": the blocks to choose from',
    'slot c: its source accounts.send_mail can change things; a source may only read',
    'slot d: its source crm.list_x is not known to only read (its server does not say so); a source may only read',
    'layout: no slot "zzz"',
  ]);
});

test('a static view: sources read before the model starts; the model fills slots only, as they are; the person captures and approves', async () => {
  const dir = tmp('tpl-'),
    shown: Shown[] = [];
  const results = memoryResults(dir);
  const png = path.join(dir, 'dent.png');
  fs.writeFileSync(
    png,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const read: unknown[] = [];
  const ui = vindu.open(
    { results, dir },
    {
      onView: (v) => shown.push(v),
      isRead,
      source: async (src) => {
        read.push(src);
        return results.add({ server: src.server, tool: src.tool ?? 'resources/read', input: src.args, value: invoices })
          .id;
      },
      capture: async () => ({
        ids: [results.attach('dent.png', 'image/png', png).id],
        by: { name: 'Kari', window: 'phone' },
      }), // taken on the phone
    },
  );
  const { mcp, call, json } = await mcpClient(ui.url);
  try {
    const started = await ui.useTemplate(TEMPLATE, { customer: 'Havgap Media' });
    assert.equal(started.started, true);
    assert.deepEqual(read, [
      { server: 'accounts', tool: 'list_invoices', args: { customer: 'Havgap Media', status: 'overdue' } },
    ]); // the input went into the source
    assert.deepEqual(
      ui
        .shell()
        .views.map((v) => v.name)
        .sort(),
      ['invoices', 'letter', 'next', 'overdue', 'photos'],
    );
    await until(() => ui.mode().kind === 'static' && JSON.stringify(ui.shell()).includes('photos'));
    const look = await json('look', {});
    assert.match(look.static, /^the template "Invoice follow-up": fill its slots/);
    assert.match(look.slots.find((x: LookSlot) => x.slot === 'invoices').filled, /^by its source \(r1\)$/);
    assert.equal(look.slots.find((x: LookSlot) => x.slot === 'overdue').required, true);
    assert.match(
      ui.note,
      /This task uses the static view "Invoice follow-up". Fill each slot with show_view and "slot": overdue \(kpi\): the total overdue/,
    );
    // the model: a slot, as the slot takes it
    const kpi = await json('show_view', {
      slot: 'overdue',
      panels: [{ card: 'kpi', from: 'r1', value: 'sum(amount)' }],
    });
    assert.equal(kpi.slot, 'overdue');
    assert.equal(kpi.panels[0].shows, '48,210');
    assert.match(
      (await call('show_view', { slot: 'overdue', panels: [{ card: 'table', from: 'r1' }] })).text,
      /not shown: slot overdue takes kpi, not table/,
    );
    assert.match(
      (await call('show_view', { name: 'mine', title: 'Mine', panels: [{ card: 'text', text: 'x' }] })).text,
      /fill one of its slots \(slot: …\): overdue, invoices, next, photos, letter/,
    );
    assert.match(
      (await call('show_view', { slot: 'photos', panels: [{ card: 'text', text: 'x' }] })).text,
      /the person fills slot photos/,
    );
    // a slot its source fills is the system's: the model's own is refused; a slot's fixed options win over what is sent
    assert.match(
      (
        await call('show_view', {
          slot: 'invoices',
          panels: [{ card: 'table', from: 'r1', columns: ['number', 'status'] }],
        })
      ).text,
      /not shown: slot invoices \(Invoices\) is filled from its source, which the system reads/,
    );
    const fixed = fitSlot('invoices', TEMPLATE.slots.invoices, {
      panels: [{ card: 'table', from: 'r1', columns: ['number', 'status'] }],
    });
    assert.ok('args' in fixed, JSON.stringify(fixed));
    assert.deepEqual((fixed.args.panels as Row[])[0].columns, ['number', 'due', 'amount']);
    assert.match(fixed.notes.join(' '), /slot invoices fixes columns: the template's values were used/);
    assert.match(
      (await call('arrange', { layout: ['overdue', 'next'] })).text,
      /not arranged: this task uses the static view "Invoice follow-up"/,
    );
    assert.match(
      (await call('write_off', { number: 'INV-2026-0412' })).text,
      /not run: the static view "Invoice follow-up" offers send_reminder/,
    );
    // the person's capture filled their slot
    await until(() => ui.answers().some((a) => answerOf(a)?.to === 'slot photos'));
    assert.deepEqual(answerOf(ui.answers().find((a) => answerOf(a)?.to === 'slot photos'))?.who, ['Kari (phone)']); // who took it, and where
    // the letter: the model fills it, the person changes it and approves; the slot then shows theirs
    await json('show_view', {
      slot: 'letter',
      panels: [{ card: 'text', text: 'Dear Havgap Media, two invoices are overdue.' }],
    });
    await until(() => shown.some((v) => v.ask?.op === 'approve letter'));
    const a = shown.filter((v) => v.ask?.op === 'approve letter').at(-1)!;
    assert.equal(a.ask!.fields.text.default, 'Dear Havgap Media, two invoices are overdue.');
    ui.event({
      type: 'action',
      view: a.name,
      name: 'answer',
      context: { ticket: a.ask!.ticket, 'f:text': 'Dear Havgap Media, two invoices (48 210 kr) are overdue.' },
      by: { name: 'Kari', window: 'main' },
    });
    await until(() => ui.answers().some((x) => answerOf(x)?.to === 'slot letter'));
    await until(() => JSON.stringify(shown.filter((v) => v.name === 'letter').at(-1)!.wide).includes('48 210 kr'));
    assert.doesNotMatch(JSON.stringify(shown.filter((v) => v.name === 'letter').at(-1)!.wide), /Written by the model/); // the person's version, as theirs
    const after = await json('look', {});
    assert.deepEqual(after.slots.find((x: LookSlot) => x.slot === 'letter').approved_by, ['Kari']);
    assert.match(after.slots.find((x: LookSlot) => x.slot === 'letter').filled, /by the person/);
    assert.equal(after.slots.find((x: LookSlot) => x.slot === 'photos').filled, 'by the person');
    // the person lets the model change the view: dynamic again, arrange works
    assert.equal(ui.letModelChange(), true);
    assert.equal(ui.mode().kind, 'dynamic');
    assert.equal((await call('arrange', { layout: ['overdue', 'invoices'] })).ok, true);
  } finally {
    await mcp.close();
    ui.close();
  }
});

test('the inputs are asked when the task starts, and a source that fails says so in its slot', async () => {
  const dir = tmp('tpl2-'),
    shown: Shown[] = [];
  const results = memoryResults(dir);
  const ui = vindu.open(
    { results, dir },
    {
      onView: (v) => shown.push(v),
      isRead,
      source: async () => {
        throw new Error('accounts: timeout');
      },
    },
  );
  try {
    const starting = ui.useTemplate({
      ...TEMPLATE,
      slots: { invoices: TEMPLATE.slots.invoices, next: TEMPLATE.slots.next },
      layout: undefined,
    });
    await until(() => shown.some((v) => v.ask?.op === 'start Invoice follow-up'));
    const a = shown.find((v) => v.ask?.op === 'start Invoice follow-up')!;
    assert.deepEqual(Object.keys(a.ask!.fields), ['customer']);
    ui.event({
      type: 'action',
      view: a.name,
      name: 'answer',
      context: { ticket: a.ask!.ticket, 'f:customer': 'Lysvik Retail' },
    });
    const r = await starting;
    assert.deepEqual(r.failed, ['invoices: accounts: timeout']);
    assert.match(
      JSON.stringify(shown.filter((v) => v.name === 'invoices').at(-1)!.wide),
      /Its source failed \(accounts: timeout\); the model may fill it/,
    );
  } finally {
    ui.close();
  }
});

test('declining or cancelling template inputs keeps the active panes and their subscriptions', async () => {
  const dir = tmp('template-inputs-'),
    results = memoryResults(dir),
    shown: Shown[] = [];
  let reads = 0,
    watches = 0,
    stops = 0;
  const ui = vindu.open(
    { results, dir },
    {
      onView: (view) => shown.push(view),
      isRead,
      source: async () => {
        reads++;
        return results.add({ server: 'accounts', tool: 'list_invoices', value: invoices }).id;
      },
      watch: () => {
        watches++;
        return () => {
          stops++;
        };
      },
    },
  );
  try {
    const slot = { ...TEMPLATE.slots.invoices, source: { server: 'accounts', tool: 'list_invoices', every: 60 } };
    await ui.useTemplate({ name: 'Current', slots: { invoices: slot } });
    const previous = ui.arrangement();
    const replacement = { name: 'Replacement', inputs: TEMPLATE.inputs, slots: { replacement: slot } };
    for (const action of ['decline', 'cancel'] as const) {
      const pending = ui.useTemplate(replacement);
      const ask = shown.at(-1)!;
      assert.equal(ask.ask?.op, 'start Replacement');
      assert.equal((await ui.useTemplate(replacement)).started, false);
      if (action === 'cancel') ui.event({ type: 'close', view: ask.name });
      else ui.event({ type: 'action', view: ask.name, name: 'decline', context: { ticket: ask.ask.ticket } });
      assert.deepEqual(await pending, { started: false, action });
      assert.deepEqual(ui.arrangement(), previous);
      assert.equal(
        shown.some((view) => view.name === 'replacement'),
        false,
      );
      assert.deepEqual([reads, watches, stops], [1, 1, 0]);
    }
    const pending = ui.useTemplate(replacement);
    ui.close();
    assert.deepEqual(await pending, { started: false, action: 'cancel' });
    assert.deepEqual([reads, watches, stops], [1, 1, 1]);
  } finally {
    ui.close();
  }
});
