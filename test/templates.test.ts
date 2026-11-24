// Static and dynamic views, over real MCP: a template checked when it loads (a source must only read); slots placed in
// its layout; its inputs asked; sources read by the host before the model starts; the model fills only slots, with the
// slot's block and fixed options; the person fills theirs (a capture) and approves what must be approved, changing it if
// need be; arrange and operations outside the template are refused; the view can turn dynamic, and a dynamic view can
// be pinned as a template. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, checkTemplate, pinTemplate, type Shown, type Operation } from '../src/index.js';
import { fitSlot } from '../src/templates.js';
import { mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const invoices = [{ number: 'INV-2026-0412', due: '2026-09-15', amount: 31050, status: 'overdue' }, { number: 'INV-2026-0431', due: '2026-09-30', amount: 17160, status: 'overdue' }];
const reminder: Operation = { name: 'send_reminder', description: 'Send a payment reminder.', effect: 'external', input: { to: z.string() }, run: () => ({ sent: true }) };
const writeOff: Operation = { name: 'write_off', description: 'Write an invoice off.', effect: 'destructive', input: { number: z.string() }, run: () => ({ written_off: true }) };
const vindu = await startVindu({ waitMs: 300, operations: [reminder, writeOff] });
afterAll(async () => { await vindu.close(); });
const isRead = (server: string, tool: string) => (server === 'accounts' ? tool.startsWith('list_') || tool.startsWith('get_') : undefined);
const TEMPLATE = {
  name: 'Invoice follow-up', about: 'One customer\'s overdue invoices, what happened, and the next step', version: 3,
  inputs: { customer: { type: 'string', title: 'Customer' } },
  slots: {
    overdue: { title: 'Overdue', block: 'kpi', needs: 'the total overdue, in the invoices\' currency', required: true },
    invoices: { title: 'Invoices', block: 'table', columns: ['number', 'due', 'amount'], sort: 'due', source: { server: 'accounts', tool: 'list_invoices', args: { customer: '$customer', status: 'overdue' } } },
    next: { title: 'Next step', block: 'free', needs: 'whatever helps decide what to do next' },
    photos: { title: 'Photos', block: 'media', by: 'person', ask: { capture: 'photo', min: 1 } },
    // oxlint-disable-next-line unicorn/no-thenable -- a slot's then, as templates take it: an object, never a function
    letter: { title: 'Letter', block: 'text', needs: 'the reminder letter', then: { by: 'person', edit: true } },
  },
  layout: { column: [{ row: [{ slot: 'overdue', size: 0.3 }, 'next'] }, 'invoices', { row: ['photos', 'letter'] }] },
  operations: ['send_reminder'],
};

test('a template is checked when it loads: its blocks, its layout, and that every source only reads', () => {
  const cards = new Set(['kpi', 'table', 'media', 'text']);
  assert.deepEqual(checkTemplate(TEMPLATE, { cards, operations: ['send_reminder'], isRead }).problems, []);
  const bad = checkTemplate({ ...TEMPLATE, slots: { ...TEMPLATE.slots, a: { title: 'A', block: 'gauge' }, b: { title: 'B', block: 'choose' }, c: { title: 'C', block: 'table', source: { server: 'accounts', tool: 'send_mail' } }, d: { title: 'D', block: 'table', source: { server: 'crm', tool: 'list_x' } } }, layout: ['zzz'] }, { cards, operations: [], isRead });
  assert.deepEqual(bad.problems, [
    'slot a: no block "gauge" here; blocks: kpi, table, media, text, or free, choose, page, app',
    'slot b: "choose" needs "of": the blocks to choose from',
    'slot c: its source accounts.send_mail can change things; a source may only read',
    'slot d: its source crm.list_x is not known to only read (its server does not say so); a source may only read',
    'layout: no slot "zzz"',
  ]);
});

test('a static view: sources read before the model starts; the model fills slots only, as they are; the person captures and approves', async () => {
  const dir = tmp('tpl-'), shown: Shown[] = []; const results = memoryResults(dir);
  const png = path.join(dir, 'dent.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  const read: unknown[] = [];
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v),
    isRead,
    source: async src => { read.push(src); return results.add({ server: src.server, tool: src.tool ?? "resources/read", input: src.args, value: invoices }).id; },
    capture: async () => ({ ids: [results.attach('dent.png', 'image/png', png).id], by: { name: 'Kari', window: 'phone' } }), // taken on the phone
  });
  const { mcp, call, json } = await mcpClient(ui.url);
  try {
    const started = await ui.useTemplate(TEMPLATE, { customer: 'Havgap Media' });
    assert.equal(started.started, true);
    assert.deepEqual(read, [{ server: 'accounts', tool: 'list_invoices', args: { customer: 'Havgap Media', status: 'overdue' } }]); // the input went into the source
    assert.deepEqual(ui.shell().views.map(v => v.name).sort(), ['invoices', 'letter', 'next', 'overdue', 'photos']);
    await until(() => ui.mode().kind === 'static' && (JSON.stringify(ui.shell()).includes('photos')));
    const look = await json('look', {});
    assert.match(look.static, /^the template "Invoice follow-up": fill its slots/);
    assert.match(look.slots.find((x: any) => x.slot === 'invoices').filled, /^by its source \(r1\)$/);
    assert.equal(look.slots.find((x: any) => x.slot === 'overdue').required, true);
    assert.match(ui.note, /This task uses the static view "Invoice follow-up". Fill each slot with show_view and "slot": overdue \(kpi\): the total overdue/);
    // the model: a slot, as the slot takes it
    const kpi = await json('show_view', { slot: 'overdue', panels: [{ card: 'kpi', from: 'r1', value: 'sum(amount)' }] });
    assert.equal(kpi.slot, 'overdue'); assert.equal(kpi.panels[0].shows, '48,210');
    assert.match((await call('show_view', { slot: 'overdue', panels: [{ card: 'table', from: 'r1' }] })).text, /not shown: slot overdue takes kpi, not table/);
    assert.match((await call('show_view', { name: 'mine', title: 'Mine', panels: [{ card: 'text', text: 'x' }] })).text, /fill one of its slots \(slot: …\): overdue, invoices, next, photos, letter/);
    assert.match((await call('show_view', { slot: 'photos', panels: [{ card: 'text', text: 'x' }] })).text, /the person fills slot photos/);
    // a slot its source fills is the system's: the model's own is refused; a slot's fixed options win over what is sent
    assert.match((await call('show_view', { slot: 'invoices', panels: [{ card: 'table', from: 'r1', columns: ['number', 'status'] }] })).text, /not shown: slot invoices \(Invoices\) is filled from its source, which the system reads/);
    const fixed = fitSlot('invoices', TEMPLATE.slots.invoices, { panels: [{ card: 'table', from: 'r1', columns: ['number', 'status'] }] }) as any;
    assert.deepEqual(fixed.args.panels[0].columns, ['number', 'due', 'amount']); assert.match(fixed.notes.join(' '), /slot invoices fixes columns: the template's values were used/);
    assert.match((await call('arrange', { layout: ['overdue', 'next'] })).text, /not arranged: this task uses the static view "Invoice follow-up"/);
    assert.match((await call('write_off', { number: 'INV-2026-0412' })).text, /not run: the static view "Invoice follow-up" offers send_reminder/);
    // the person's capture filled their slot
    await until(() => ui.answers().some((a: any) => a.to === 'slot photos'));
    assert.deepEqual((ui.answers().find((a: any) => a.to === 'slot photos') as any).who, ['Kari (phone)']); // who took it, and where
    // the letter: the model fills it, the person changes it and approves; the slot then shows theirs
    await json('show_view', { slot: 'letter', panels: [{ card: 'text', text: 'Dear Havgap Media, two invoices are overdue.' }] });
    await until(() => shown.some(v => v.ask?.op === 'approve letter'));
    const a = shown.filter(v => v.ask?.op === 'approve letter').at(-1)!;
    assert.equal(a.ask!.fields.text.default, 'Dear Havgap Media, two invoices are overdue.');
    ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:text': 'Dear Havgap Media, two invoices (48 210 kr) are overdue.' }, by: { name: 'Kari', window: 'main' } });
    await until(() => ui.answers().some((x: any) => x.to === 'slot letter'));
    await until(() => JSON.stringify(shown.filter(v => v.name === 'letter').at(-1)!.wide).includes('48 210 kr'));
    assert.doesNotMatch(JSON.stringify(shown.filter(v => v.name === 'letter').at(-1)!.wide), /Written by the model/); // the person's version, as theirs
    const after = await json('look', {});
    assert.deepEqual(after.slots.find((x: any) => x.slot === 'letter').approved_by, ['Kari']);
    assert.match(after.slots.find((x: any) => x.slot === 'letter').filled, /by the person/);
    assert.equal(after.slots.find((x: any) => x.slot === 'photos').filled, 'by the person');
    // the person lets the model change the view: dynamic again, arrange works
    assert.equal(ui.letModelChange(), true);
    assert.equal(ui.mode().kind, 'dynamic');
    assert.equal((await call('arrange', { layout: ['overdue', 'invoices'] })).ok, true);
  } finally { await mcp.close(); ui.close(); }
});

test('the inputs are asked when the task starts, and a source that fails says so in its slot', async () => {
  const dir = tmp('tpl2-'), shown: Shown[] = []; const results = memoryResults(dir);
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), isRead, source: async () => { throw new Error('accounts: timeout'); } });
  try {
    const starting = ui.useTemplate({ ...TEMPLATE, slots: { invoices: TEMPLATE.slots.invoices, next: TEMPLATE.slots.next }, layout: undefined });
    await until(() => shown.some(v => v.ask?.op === 'start Invoice follow-up'));
    const a = shown.find(v => v.ask?.op === 'start Invoice follow-up')!;
    assert.deepEqual(Object.keys(a.ask!.fields), ['customer']);
    ui.event({ type: 'action', view: a.name, name: 'answer', context: { ticket: a.ask!.ticket, 'f:customer': 'Lysvik Retail' } });
    const r = await starting;
    assert.deepEqual(r.failed, ['invoices: accounts: timeout']);
    assert.match(JSON.stringify(shown.filter(v => v.name === 'invoices').at(-1)!.wide), /Its source failed \(accounts: timeout\); the model may fill it/);
  } finally { ui.close(); }
});

test('declining or cancelling template inputs keeps the active panes and their subscriptions', async () => {
  const dir = tmp('template-inputs-'), results = memoryResults(dir), shown: Shown[] = [];
  let reads = 0, watches = 0, stops = 0;
  const ui = vindu.open({ results, dir }, {
    onView: view => shown.push(view), isRead,
    source: async () => { reads++; return results.add({ server: 'accounts', tool: 'list_invoices', value: invoices }).id; },
    watch: () => { watches++; return () => { stops++; }; },
  });
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
      else ui.event({ type: 'action', view: ask.name, name: 'decline', context: { ticket: ask.ask!.ticket } });
      assert.deepEqual(await pending, { started: false, action });
      assert.deepEqual(ui.arrangement(), previous);
      assert.equal(shown.some(view => view.name === 'replacement'), false);
      assert.deepEqual([reads, watches, stops], [1, 1, 0]);
    }
    const pending = ui.useTemplate(replacement);
    ui.close();
    assert.deepEqual(await pending, { started: false, action: 'cancel' });
    assert.deepEqual([reads, watches, stops], [1, 1, 1]);
  } finally { ui.close(); }
});

test('pin: a view in a frame of its own (a page, code, a diff, an app) is a free slot; a card\'s options are fixed, as each marks them', () => {
  const view = (name: string, panel: Record<string, unknown>) => ({ name, title: name, args: { panels: [panel] } });
  const { template } = pinTemplate({ name: 'Kit', layout: ['src', 'deck', 'cash', 'plan'], resultOf: () => undefined, views: [
    view('src', { card: 'code', path: 'src/app.ts' }), view('deck', { card: 'slides', from: 'r1', at: 2 }),
    view('cash', { card: 'sheet', from: 'r2', compute: { budget: 'actual * 1.04' }, scenarios: { low: { growth: 0.02 } }, totals: { Budget: 'sum(budget)' } }),
    view('plan', { card: 'tasks', from: 'r3', layout: 'board', order: ['todo', 'done'], map: { title: 'name' }, dates: { by: 'due - 2 days' } }),
  ] });
  assert.equal(template.slots.src.block, 'free');
  assert.deepEqual(Object.keys(template.slots.deck).sort(), ['block', 'needs', 'title']); // the slide shown is the view's own, not an option
  assert.deepEqual(Object.keys(template.slots.cash).sort(), ['block', 'compute', 'needs', 'scenarios', 'title', 'totals']);
  assert.deepEqual(Object.keys(template.slots.plan).sort(), ['block', 'layout', 'map', 'needs', 'order', 'title']);
});

test('pin: a dynamic view becomes a template; a panel read from a read is its slot\'s source, the rest the model fills', async () => {
  const dir = tmp('pin-'), results = memoryResults(dir);
  results.add({ server: 'accounts', tool: 'list_invoices', input: { status: 'overdue' }, value: invoices });
  results.add({ server: 'mail', tool: 'search', input: { q: 'Havgap' }, value: [{ subject: 'Re: INV', from: 'ingrid@havgap.example' }] });
  const ui = vindu.open({ results, dir }, { isRead });
  const { mcp, json } = await mcpClient(ui.url);
  try {
    await json('show_view', { name: 'invoices', title: 'Invoices', panels: [{ card: 'table', from: 'r1', columns: ['number', 'amount'], sort: 'amount desc' }] });
    await json('show_view', { name: 'mail', title: 'Mail', panels: [{ card: 'message', from: 'r2' }] });
    await json('show_view', { name: 'notes', title: 'Notes', panels: [{ card: 'text', text: 'Call Ingrid' }, { card: 'kpi', data: 2 }] });
    const { template, notes } = ui.pin('Invoice follow-up');
    assert.deepEqual(template.slots.invoices, { title: 'Invoices', block: 'table', columns: ['number', 'amount'], sort: 'amount desc', source: { server: 'accounts', tool: 'list_invoices', args: { status: 'overdue' } } });
    assert.equal(template.slots.mail.block, 'message'); assert.match(template.slots.mail.needs!, /mail\.search, which is not known to only read/);
    assert.equal(template.slots.notes.block, 'free');
    assert.deepEqual(notes, ['mail: mail.search is not known to only read, so the model fills it each time']);
    assert.deepEqual(checkTemplate(template, { cards: new Set(['table', 'message', 'text', 'kpi']), operations: [], isRead }).problems, []); // what was pinned loads again
  } finally { await mcp.close(); ui.close(); }
});

test('a source kept fresh: the host reads it again; a change is shown in the slot and told once; the same answer changes nothing', async () => {
  const dir = tmp('fresh-'), shown: Shown[] = []; const results = memoryResults(dir);
  let tick: ((id: string) => void) | undefined; let stopped = false; const asked: unknown[] = [];
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), isRead,
    source: async src => results.add({ server: src.server, tool: src.tool ?? "resources/read", input: src.args, value: invoices }).id,
    watch: (src, seconds, onRead) => { asked.push({ ...src, seconds }); tick = onRead; return () => { stopped = true; }; } });
  const { mcp, json } = await mcpClient(ui.url);
  try {
    const t = { name: 'Overdue now', slots: { invoices: { title: 'Invoices', block: 'table', columns: ['number', 'amount'], source: { server: 'accounts', tool: 'list_invoices', args: { status: 'overdue' }, every: 60 } } } };
    const r = await ui.useTemplate(t);
    assert.deepEqual(r.read, ['invoices from accounts.list_invoices (r1), kept fresh (read again every 60 s)']);
    assert.deepEqual(asked, [{ server: 'accounts', tool: 'list_invoices', args: { status: 'overdue' }, after: 'r1', seconds: 60 }]);
    ui.delta(); // what was told so far
    tick!(results.add({ server: 'accounts', tool: 'list_invoices', value: invoices }).id); // the same answer again
    await sleep(100); assert.equal(ui.delta(), '');
    const paid = invoices.slice(1);
    tick!(results.add({ server: 'accounts', tool: 'list_invoices', value: paid }).id);
    await until(() => JSON.stringify(shown.filter(v => v.name === 'invoices').at(-1)!.wide).includes('INV-2026-0412') === false);
    assert.match(ui.delta(), /Invoices changed: read again from accounts\.list_invoices, it now shows r3/);
    assert.match((await json('look', {})).slots[0].filled, /^by its source \(r3\)$/);
  } finally { await mcp.close(); ui.close(); }
  assert.equal(stopped, true); // the window closed: the reads stop
});

test('a read that changed since: a panel on it is marked not up to date, in the window and the account; one that follows it is computed again; the model is told which', async () => {
  const dir = tmp('newer-'), shown: Shown[] = []; const results = memoryResults(dir);
  let tick: ((id: string) => void) | undefined;
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), isRead,
    source: async src => results.add({ server: src.server, tool: src.tool ?? 'resources/read', input: src.args, value: invoices }).id,
    watch: (_src, _seconds, onRead) => { tick = onRead; return () => undefined; } });
  const { mcp, json } = await mcpClient(ui.url);
  const last = (name: string) => JSON.stringify(shown.filter(v => v.name === name).at(-1)!.wide);
  try {
    const t = { name: 'Overdue now', slots: {
      invoices: { title: 'Invoices', block: 'table', columns: ['number', 'amount'], source: { server: 'accounts', tool: 'list_invoices', args: { status: 'overdue' }, every: 60 } },
      overdue: { title: 'Overdue', block: 'kpi' }, following: { title: 'Overdue, kept up to date', block: 'kpi' }, older: { title: 'Overdue at the start', block: 'kpi' } } };
    await ui.useTemplate(t);
    results.add({ server: 'notes', tool: 'get_total', value: [{ amount: 5 }] }); // r2: a read the app does not keep fresh
    const plain = await json('show_view', { slot: 'older', panels: [{ card: 'kpi', from: 'r2', value: 'sum(amount)', follow: true }] });
    assert.match(plain.corrections.join(' '), /follow keeps nothing fresh here: r2 is not a read the app keeps fresh/);
    assert.equal((await json('show_view', { slot: 'overdue', panels: [{ card: 'kpi', from: 'r1', value: 'sum(amount)' }] })).panels[0].shows, '48,210');
    assert.equal((await json('show_view', { slot: 'following', panels: [{ card: 'kpi', from: 'r1', value: 'sum(amount)', follow: true }] })).panels[0].shows, '48,210');
    ui.event({ type: 'close', view: 'overdue' }); // the person closes it: it stays hidden, and is still drawn right
    ui.delta();
    tick!(results.add({ server: 'accounts', tool: 'list_invoices', value: invoices.slice(1) }).id); // r3: one invoice paid
    await until(() => last('following').includes('17,160') && last('overdue').includes('Not up to date'));
    assert.match(last('overdue'), /Not up to date: this shows r1, and its source has changed since \(r3\)/);
    assert.match(last('overdue'), /48,210/); // what it shows is still exactly what r1 says, marked
    assert.match(last('overdue'), /"prompt":"Overdue shows r1, and its source has been read again since: r3\. What changed between them\?"/); // a cue, offered on the pane
    assert.doesNotMatch(last('following'), /Not up to date/);
    assert.doesNotMatch(last('older'), /Not up to date/); // r2 is not read again: nothing to mark
    const told = ui.delta();
    assert.match(told, /Invoices changed: read again from accounts\.list_invoices, it now shows r3; still on an earlier read, so marked "not up to date" in the window: overdue\/[\w-]+ \(r1\)\. Show them from the newest read, or with follow: true to keep them on it; following it, computed again: following\/[\w-]+/);
    const look = await json('look', {});
    assert.match(JSON.stringify(look.hidden ?? look), /overdue/); // drawn again, but not brought back
    assert.match((await mcp.callTool({ name: 'results', arguments: {} }) as any).content[0].text, /r1[^\n]*\(read again since: r3 says something else\)/);
    const again = await json('show_view', { slot: 'overdue', panels: [{ card: 'kpi', from: 'r1', value: 'sum(amount)' }] }); // the model, from the older read
    assert.match(again.panels[0].not_up_to_date, /it shows r1; its source has been read again since and says something else \(r3\)/);
    const fresh = await json('show_view', { slot: 'overdue', panels: [{ card: 'kpi', from: 'r3', value: 'sum(amount)' }] });
    assert.equal(fresh.panels[0].shows, '17,160'); assert.equal(fresh.panels[0].not_up_to_date, undefined);
    assert.doesNotMatch(last('overdue'), /Not up to date/);
    const follows = await json('show_view', { slot: 'following', panels: [{ card: 'kpi', from: 'r1', value: 'sum(amount)', follow: true }] });
    assert.equal(follows.panels[0].from, 'r3'); assert.match(follows.panels[0].follows, /given r1, it shows r3/);
  } finally { await mcp.close(); ui.close(); }
});

test('a source may be a resource (a resource only reads): its address takes the inputs; pinned, a resource read is its slot\'s source again', async () => {
  const policy = { name: 'Policy check', inputs: { customer: { type: 'string' } }, slots: { terms: { title: 'Terms', block: 'document', source: { server: 'docs', resource: 'docs://terms/$customer', every: 30 } } } };
  assert.deepEqual(checkTemplate(policy, { cards: new Set(['document']), operations: [], isRead: () => undefined }).problems, []); // no isRead needed
  assert.match(checkTemplate({ ...policy, slots: { terms: { ...policy.slots.terms, source: { server: 'docs', resource: 'docs://terms/$nobody' } } } }, { cards: new Set(['document']), operations: [] }).problems.join(' '), /\$nobody is no input/);
  assert.match(checkTemplate({ ...policy, slots: { terms: { ...policy.slots.terms, source: { server: 'docs', tool: 'x', resource: 'docs://a' } } } }, { cards: new Set(['document']), operations: [] }).problems.join(' '), /one of "tool" and "resource"/);
  const dir = tmp('res-'), results = memoryResults(dir); const asked: unknown[] = [], watched: unknown[] = [];
  const ui = vindu.open({ results, dir }, {
    source: async src => { asked.push(src); return results.add({ server: src.server, tool: 'resources/read', input: { uri: src.resource }, value: [{ section: '§ 1', text: 'Payment within 14 days.' }] }).id; },
    watch: (src, seconds) => { watched.push({ ...src, seconds }); return () => undefined; } });
  try {
    const r = await ui.useTemplate(policy, { customer: 'Havgap Media' });
    assert.deepEqual(asked, [{ server: 'docs', resource: 'docs://terms/Havgap%20Media', args: {} }]);
    assert.deepEqual(r.read, ['terms from docs docs://terms/Havgap%20Media (r1), kept fresh (on its server\'s word, or every 30 s)']);
    assert.deepEqual(watched, [{ server: 'docs', resource: 'docs://terms/Havgap%20Media', args: {}, after: 'r1', seconds: 30 }]);
    ui.letModelChange();
    const { template } = ui.pin('Policy check again');
    assert.deepEqual(template.slots.terms.source, { server: 'docs', resource: 'docs://terms/Havgap%20Media' });
  } finally { ui.close(); }
});
