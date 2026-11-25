// A checkpoint keeps where each result came from, never what it held: on restore the host reads each one again
// (refetch), and the views are drawn from what came. A panel whose result was not read again waits for it, saying
// why, and fills in when the call comes again; without the host's refetch, every panel on a result restores waiting.
// All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, VIEW_WORDS_NB, VIEW_WORDS_NN, type ResultPointer, type Shown, type ViewCheckpoint, type ViewPresentation } from '../src/index.js';
import { mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const invoices = (status: string) => [{ number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050, status }];
/** What the servers say of their tools: lists and reads only read, creating and sending change things. */
const isRead = (_server: string, tool: string): boolean | undefined => {
  if (/^(list|read)_/.test(tool)) return true;
  if (/^(create|send)_/.test(tool)) return false;
  return undefined;
};
const photoFile = path.join(tmp('vindu-person-'), 'site.png');
fs.writeFileSync(photoFile, PNG); // a file the person gave

const VIEWS = [
  { name: 'inv', title: 'Invoices', panels: [
    { id: 'rows', card: 'table', title: 'Open', from: 'r1', columns: ['number', 'status'] },
    { id: 'total', card: 'kpi', title: 'Owed', from: 'r1', value: 'sum(amount) * $share', inputs: { share: { value: 1, label: 'Share' } } },
    { id: 'plan', card: 'text', text: 'Chase them before Friday.' },
  ] },
  { name: 'cust', title: 'Customers', panels: [{ id: 'list', card: 'table', from: 'r2' }] },
  { name: 'made', title: 'Made', panels: [{ id: 'one', card: 'record', from: 'r3' }] },
  { name: 'sent', title: 'Sent', panels: [{ id: 'one', card: 'record', from: 'r4' }] },
  { name: 'note', title: 'Note', panels: [{ id: 'body', card: 'text', from: 'r5' }] },
  { name: 'photo', title: 'Photo', panels: [{ id: 'shot', card: 'media', media: 'r6' }, { id: 'given', card: 'media', media: 'a1' }] },
];

/** The first task: its results (what the connectors returned, and a file the person gave), its views, the person's
 *  what-if and answer, and its checkpoint, taken just before it closes. */
async function firstTask() {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 0, reminders: true });
  const results = memoryResults();
  results.add({ server: 'accounts', tool: 'list_invoices', input: { status: 'open' }, value: invoices('overdue') });
  results.add({ server: 'crm', tool: 'list_customers', input: {}, value: [{ customer: 'Havgap Media', city: 'Bergen' }] });
  results.add({ server: 'accounts', tool: 'create_invoice', input: { customer: 'Brattli Verksted' }, value: { number: 'INV-2026-0418', total: 19800 } });
  results.add({ server: 'accounts', tool: 'send_invoice', input: { number: 'INV-2026-0418' }, ref: 'sent-0418', value: { number: 'INV-2026-0418', sent: 'yes' } });
  results.add({ server: 'notes', tool: 'read_note', input: { id: 7 }, text: 'Quarterly note: Fjordline ferries are late.' });
  results.add({ server: 'camera', tool: 'snapshot', input: { site: 'Voss' }, images: [{ data: PNG, mime: 'image/png' }] });
  results.attach('site.png', 'image/png', photoFile);
  const shown: Shown[] = [];
  const ui = vindu.open({ results }, { onView: v => shown.push(v), isRead });
  const { mcp, json } = await mcpClient(ui.url);
  try {
    for (const v of VIEWS) await json('show_view', v);
    assert.equal(ui.event({ type: 'action', view: 'inv', name: 'set_inputs', context: { panel: 'total', 'in:share': '0.5' } }), true);
    await until(() => ui.answers().length === 1);
    const asked = json('ask', { question: 'Which customer first?', choices: ['Vik Data', 'Strand Bygg'] });
    await until(() => shown.some(v => v.ask));
    const ask = shown.find(v => v.ask)!;
    ui.event({ type: 'action', view: ask.name, name: 'answer', context: { ticket: ask.ask!.ticket, choice: 'Strand Bygg', n: 1 } });
    const answer = await asked;
    await json('show_view', { name: 'picked', title: 'Picked', panels: [{ id: 'choice', card: 'record', from: answer.id }] });
    await json('remind', { what: 'Call Strand Bygg', when: 'tomorrow at 08:30' });
    return ui.checkpoint();
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
}

const modelOf = (shown: Shown[], view: string) => (shown.filter(v => v.name === view).at(-1)!.wide.find((m: any) => m.updateDataModel) as any).updateDataModel.value.panels;
const drawnOf = (shown: Shown[], view: string) => JSON.stringify(shown.filter(v => v.name === view).at(-1)?.wide ?? null);

let saved: ViewCheckpoint;
test('the checkpoint names each result by where it came from and keeps the person\'s own state, never what a result held', async () => {
  saved = await firstTask();
  const byId = (xs: ResultPointer[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(saved.pointers!), [
    { id: 'a1', kind: 'attachment', name: 'site.png', mime: 'image/png', file: photoFile }, // the person's own file, by where it is
    { id: 'r1', kind: 'result', server: 'accounts', tool: 'list_invoices', input: { status: 'open' } },
    { id: 'r2', kind: 'result', server: 'crm', tool: 'list_customers', input: {} },
    { id: 'r3', kind: 'result', server: 'accounts', tool: 'create_invoice', input: { customer: 'Brattli Verksted' } },
    { id: 'r4', kind: 'result', server: 'accounts', tool: 'send_invoice', ref: 'sent-0418' }, // the host's own reference, in place of its input
    { id: 'r5', kind: 'result', server: 'notes', tool: 'read_note', input: { id: 7 } },
    { id: 'r6', kind: 'result', server: 'camera', tool: 'snapshot', input: { site: 'Voss' } },
  ]);
  const text = JSON.stringify(saved);
  for (const held of ['Havgap Media', '31050', 'overdue', 'Bergen', 'INV-2026-0412', '19800', 'Fjordline', PNG.toString('base64'), 'r6-1.png'])
    assert.ok(!text.includes(held), `the checkpoint holds "${held}"`);
  // the person's own state: their what-if, their answer that a view shows, their reminder
  assert.deepEqual(saved.inputs.find(([k]) => k === 'inv/total')?.[1].set, { share: 0.5 });
  assert.deepEqual(saved.answers!.map(a => [a.to, a.values]), [['the question "Which customer first?"', { choice: 'Strand Bygg' }]]);
  assert.deepEqual(saved.reminders!.map(r => r.what), ['Call Strand Bygg']);
});

test('restoring calls the host with each pointer and draws the views from what came: a value changed since shows as it is now; a pointer that fails waits, saying why, and fills in when the call comes', async () => {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 0, reminders: true });
  const results = memoryResults();
  results.attach('earlier.png', 'image/png', photoFile); // a1 here is another file: the photo given again is a2
  const calls: ResultPointer[] = [];
  const refetch = async (p: ResultPointer) => {
    calls.push(p);
    if (p.kind === 'attachment') return results.attach(p.name, p.mime, p.file).id;
    if (p.server === 'crm') throw new Error('crm is offline');
    if (p.tool === 'list_invoices') return results.add({ server: p.server, tool: p.tool, input: p.input, value: invoices('paid') }).id; // paid since
    if (p.ref === 'sent-0418') return results.add({ server: p.server, tool: p.tool, ref: p.ref, value: { number: 'INV-2026-0418', sent: 'on Monday' } }).id;
    return undefined; // the note and the photo: this host cannot read them again
  };
  const shown: Shown[] = [];
  const ui = vindu.open({ results }, { onView: v => shown.push(v), refetch, isRead });
  try {
    assert.deepEqual(await ui.restore(saved), []); // every view is drawn
    assert.deepEqual(calls.map(p => `${p.kind === 'result' ? `${p.server}.${p.tool}` : p.name}`).sort(), ['accounts.list_invoices', 'accounts.send_invoice', 'crm.list_customers', 'notes.read_note', 'camera.snapshot', 'site.png'].sort());
    assert.deepEqual(calls.find(p => p.kind === 'result' && p.tool === 'list_invoices'), { id: 'r1', kind: 'result', server: 'accounts', tool: 'list_invoices', input: { status: 'open' } });
    // drawn from what came, as it is now
    const inv = JSON.stringify(modelOf(shown, 'inv').p_rows);
    assert.ok(inv.includes('paid') && !inv.includes('overdue'), inv);
    assert.equal(modelOf(shown, 'inv').p_total.value, '15,525'); // the person's what-if, kept: half of what is owed
    assert.ok(drawnOf(shown, 'inv').includes('Chase them before Friday.')); // the model's own words, as they were
    assert.ok(drawnOf(shown, 'sent').includes('on Monday')); // the host's ref, read again although the tool changes things
    assert.ok(drawnOf(shown, 'picked').includes('Strand Bygg')); // the person's answer, theirs again
    assert.ok(drawnOf(shown, 'photo').includes('/media/a2') && !drawnOf(shown, 'photo').includes('/media/a1')); // the person's file, given again
    // what was not read again waits, saying why
    assert.ok(drawnOf(shown, 'cust').includes('Not read again: the host could not (crm is offline). Waiting for crm.list_customers: it fills in here when it comes.'));
    assert.ok(drawnOf(shown, 'made').includes('Not called again: accounts.create_invoice changes things, as its server says.'));
    assert.ok(drawnOf(shown, 'note').includes('Not read again: the host could not. Waiting for notes.read_note'));
    assert.ok(drawnOf(shown, 'photo').includes('Not read again: the host could not. Waiting for camera.snapshot: it fills in here when it comes.')); // its picture too
    assert.match(ui.delta(), /opened again where the person left it[\s\S]*4 panels wait for their results: cust \(list\): Not read again: the host could not \(crm is offline\)\./);
    assert.deepEqual(ui.reminders().map(r => r.what), ['Call Strand Bygg']);
    // the call comes again: the panel fills in, exactly as it came
    const n = shown.length;
    const again = results.add({ server: 'crm', tool: 'list_customers', input: {}, value: [{ customer: 'Havgap Media', city: 'Stavanger' }] });
    ui.result(again.id);
    await until(() => shown.length > n && drawnOf(shown, 'cust').includes('Stavanger'));
  } finally { ui.close(); await vindu.close(); }
});

test('without the host\'s refetch, every panel on a result restores waiting, saying why; the model\'s own words are drawn as they were', async () => {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 0 });
  const shown: Shown[] = [];
  const ui = vindu.open({ results: memoryResults() }, { onView: v => shown.push(v) });
  try {
    assert.deepEqual(await ui.restore(saved), []);
    assert.ok(drawnOf(shown, 'inv').includes('Not read again: this host reads nothing again for a task restored. Waiting for accounts.list_invoices'));
    assert.ok(drawnOf(shown, 'inv').includes('Chase them before Friday.'));
    assert.ok(drawnOf(shown, 'photo').includes('Not read again: this host reads nothing again for a task restored. It showed site.png, which the person gave.'));
    assert.ok(!JSON.stringify(shown).includes('overdue'));
    assert.ok(!drawnOf(shown, 'inv').includes('try_again')); // nothing here reads it again
    const next = ui.checkpoint(); // what it waits for is kept as a wait, still with no result in it
    assert.ok(!JSON.stringify(next).includes('overdue'));
    assert.deepEqual(keptOf(next)['inv/rows'], { id: 'r1', kind: 'result', server: 'accounts', tool: 'list_invoices', input: { status: 'open' } }); // for a host that reads again
  } finally { ui.close(); await vindu.close(); }
});

/** A host that reads again what it can now: the person's file always; online, the results and the picture, but never
 *  the note. */
const hostOf = () => {
  const results = memoryResults();
  const calls: ResultPointer[] = [];
  const host = {
    results, calls, online: false,
    refetch: async (p: ResultPointer) => {
      calls.push(p);
      if (p.kind === 'attachment') return results.attach(p.name, p.mime, p.file).id;
      if (!host.online) throw new Error('the computer is offline');
      if (p.tool === 'list_invoices') return results.add({ server: p.server, tool: p.tool, input: p.input, value: invoices('paid') }).id;
      if (p.tool === 'list_customers') return results.add({ server: p.server, tool: p.tool, input: p.input, value: [{ customer: 'Havgap Media', city: 'Alta' }] }).id;
      if (p.tool === 'snapshot') return results.add({ server: p.server, tool: p.tool, input: p.input, images: [{ data: PNG, mime: 'image/png' }] }).id;
      if (p.ref === 'sent-0418') return results.add({ server: p.server, tool: p.tool, ref: p.ref, value: { number: 'INV-2026-0418', sent: 'on Tuesday' } }).id;
      return undefined;
    },
  };
  return host;
};
type Host = ReturnType<typeof hostOf>;
/** A task opened again from a checkpoint, by a host that reads again (or one that does not): what it drew, and the task. */
async function reopen(cp: ViewCheckpoint, host?: Host, more: { onPresentation?: (v: ViewPresentation) => void } = {}) {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 0, reminders: true });
  const shown: Shown[] = [];
  const ui = vindu.open({ results: host?.results ?? memoryResults() }, { onView: v => shown.push(v), isRead, ...(host ? { refetch: host.refetch } : {}), ...more });
  const refused = await ui.restore(cp);
  return { ui, shown, refused, close: async () => { ui.close(); await vindu.close(); } };
}
/** The pointer each gate of a checkpoint keeps, by view/panel. */
function keptOf(cp: ViewCheckpoint) { return Object.fromEntries(cp.gates.flatMap(([k, g]) => (g.pointer ? [[k, g.pointer]] : []))); }
const nameOf = (p: ResultPointer) => (p.kind === 'result' ? `${p.server}.${p.tool}` : p.name);
const R1 = { id: 'r1', kind: 'result', server: 'accounts', tool: 'list_invoices', input: { status: 'open' } };
const KEPT = {
  'inv/rows': R1, 'inv/total': R1,
  'cust/list': { id: 'r2', kind: 'result', server: 'crm', tool: 'list_customers', input: {} },
  'sent/one': { id: 'r4', kind: 'result', server: 'accounts', tool: 'send_invoice', ref: 'sent-0418' }, // by the host's ref
  'note/body': { id: 'r5', kind: 'result', server: 'notes', tool: 'read_note', input: { id: 7 } },
  'photo/shot': { id: 'r6', kind: 'result', server: 'camera', tool: 'snapshot', input: { site: 'Voss' } }, // the picture a tool returned
};

test('a panel whose result the host could not read again keeps its pointer, the host\'s ref with it, in every checkpoint until a result fills it; each restore reads it again by the same rules', async () => {
  const first = await reopen(saved, hostOf()); // the computer offline as the task is opened
  let cp2: ViewCheckpoint;
  try {
    assert.deepEqual(first.refused, []);
    cp2 = JSON.parse(JSON.stringify(first.ui.checkpoint())) as ViewCheckpoint; // as the host's store keeps it
  } finally { await first.close(); }
  assert.deepEqual(keptOf(cp2), KEPT); // made/one changes things: it is never called again, so it keeps none
  assert.match(cp2.gates.find(([k]) => k === 'made/one')![1].why!, /^Not called again: accounts\.create_invoice changes things/);
  for (const held of ['Havgap Media', 'overdue', 'Fjordline', '19800']) assert.ok(!JSON.stringify(cp2).includes(held), held);

  const offline = hostOf(); // offline again: each read again the same way, and kept again
  const second = await reopen(cp2, offline);
  let cp3: ViewCheckpoint;
  try {
    for (const p of Object.values(KEPT)) assert.ok(offline.calls.some(c => JSON.stringify(c) === JSON.stringify(p)), JSON.stringify(p));
    assert.equal(offline.calls.filter(c => nameOf(c) === 'accounts.list_invoices').length, 1); // two panels, one call
    assert.ok(!offline.calls.some(c => nameOf(c) === 'accounts.create_invoice'));
    assert.ok(drawnOf(second.shown, 'cust').includes('Not read again: the host could not (the computer is offline). Waiting for crm.list_customers'));
    assert.match(second.ui.delta(), /6 panels wait for their results: [^\]]*cust \(list\): Not read again: the host could not \(the computer is offline\)\./);
    cp3 = JSON.parse(JSON.stringify(second.ui.checkpoint())) as ViewCheckpoint;
  } finally { await second.close(); }
  assert.deepEqual(keptOf(cp3), KEPT);

  const online = hostOf(); // back online: the panels fill
  online.online = true;
  const third = await reopen(cp3, online);
  try {
    assert.ok(drawnOf(third.shown, 'cust').includes('Alta'));
    assert.ok(drawnOf(third.shown, 'sent').includes('on Tuesday'));
    const snapshot = online.results.all().find(e => e.kind === 'result' && e.tool === 'snapshot')!.id;
    assert.ok(drawnOf(third.shown, 'photo').includes(`/media/${snapshot}`)); // the picture, under its new id
    assert.equal(modelOf(third.shown, 'inv').p_total.value, '15,525'); // the person's what-if, on what came
    assert.match(third.ui.delta(), /one panel waits for its result: note \(body\): Not read again: the host could not\./);
    const cp4 = JSON.parse(JSON.stringify(third.ui.checkpoint())) as ViewCheckpoint;
    assert.deepEqual(keptOf(cp4), { 'note/body': KEPT['note/body'] }); // the rest have results: their pointers are the checkpoint's own
    const cust = cp4.gates.find(([k]) => k === 'cust/list')![1];
    assert.ok(cp4.pointers!.some(p => p.id === cust.got && nameOf(p) === 'crm.list_customers'));
  } finally { await third.close(); }
});

test('ui.refetchWaiting reads again every panel waiting for its result: those that fill are drawn in place and the model told once; a call while it runs shares it; without refetch it reads nothing', async () => {
  const host = hostOf();
  const t = await reopen(saved, host);
  try {
    t.ui.delta(); // the restore's note, heard
    host.online = true;
    host.calls.length = 0;
    const run = t.ui.refetchWaiting();
    assert.equal(t.ui.refetchWaiting(), run); // one run
    assert.deepEqual(await run, { filled: 5, still: 1 });
    assert.deepEqual(host.calls.map(nameOf).sort(), ['accounts.list_invoices', 'accounts.send_invoice', 'camera.snapshot', 'crm.list_customers', 'notes.read_note']); // each call once
    assert.ok(drawnOf(t.shown, 'cust').includes('Alta') && !drawnOf(t.shown, 'cust').includes('try_again'));
    assert.equal(modelOf(t.shown, 'inv').p_total.value, '15,525');
    assert.ok(drawnOf(t.shown, 'note').includes('Not read again: the host could not. Waiting for notes.read_note'));
    const told = t.ui.delta();
    assert.match(told, /5 panels that waited are drawn from their results read again: inv \(rows\), from r\d+; /);
    assert.match(told, /; one panel waits for its result: note \(body\): Not read again: the host could not\./);
    assert.equal(told.split('drawn from').length, 2, told); // told once
    assert.deepEqual(await t.ui.refetchWaiting(), { filled: 0, still: 1 }); // nothing changed: nothing told
    assert.ok(!t.ui.delta().includes('read again'));
  } finally { await t.close(); }
  const bare = await reopen(saved);
  try {
    assert.deepEqual(await bare.ui.refetchWaiting(), { filled: 0, still: 0 });
  } finally { await bare.close(); }
});

test('the person\'s Try again reads that panel\'s result alone again, in place; no tool of the model\'s reaches it', async () => {
  const host = hostOf();
  const presented: ViewPresentation[] = [];
  const t = await reopen(saved, host, { onPresentation: v => presented.push(v) });
  const { mcp, call } = await mcpClient(t.ui.url);
  try {
    assert.ok(drawnOf(t.shown, 'cust').includes('"name":"try_again"') && drawnOf(t.shown, 'cust').includes('Try again'));
    assert.ok(!drawnOf(t.shown, 'made').includes('try_again')); // a tool that changes things is never called again
    assert.deepEqual(presented.filter(v => v.name === 'cust').at(-1)!.panels[0].again, { event: 'try_again', context: { panel: 'list' } });
    host.online = true;
    host.calls.length = 0;
    const tools = (await mcp.listTools()).tools.map(x => x.name);
    assert.ok(!tools.some(n => /again|refetch/.test(n)), tools.join(', '));
    const refused = async (name: string, args: Record<string, unknown>) => { try { return !(await call(name, args)).ok; } catch { return true; } };
    assert.ok(await refused('act_in_view', { view: 'cust', action: 'try_again', panel: 'list' }));
    assert.ok(await refused('invoke', { name: 'try_again', input: { view: 'cust', panel: 'list' } }));
    await sleep(50);
    assert.deepEqual(host.calls, []);
    t.ui.delta();
    assert.equal(t.ui.event({ type: 'action', view: 'cust', name: 'try_again', context: { panel: 'list' } }), true);
    await until(() => drawnOf(t.shown, 'cust').includes('Alta'));
    assert.deepEqual(host.calls.map(nameOf), ['crm.list_customers']); // that panel alone
    assert.ok(drawnOf(t.shown, 'inv').includes('Waiting for accounts.list_invoices'));
    assert.match(t.ui.delta(), /one panel that waited is drawn from its result read again: cust \(list\), from r\d+/);
    for (const [view, panel] of [['cust', 'list'], ['made', 'one'], ['inv', 'plan'], ['gone', 'list']]) // filled now, never read again, no wait, not shown
      assert.equal(t.ui.event({ type: 'action', view, name: 'try_again', context: { panel } }), false, `${view}/${panel}`);
    t.ui.setViewWords(VIEW_WORDS_NN);
    assert.ok(drawnOf(t.shown, 'note').includes('Prøv igjen'));
    assert.equal(VIEW_WORDS_NB.tryAgain, 'Prøv igjen');
  } finally { await mcp.close(); await t.close(); }
});

test('a panel the model wrote to await a call keeps no pointer, and is not read again', async () => {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 0 });
  const ui = vindu.open({ results: memoryResults() }, {});
  const { mcp, json } = await mcpClient(ui.url);
  let cp: ViewCheckpoint;
  try {
    await json('show_view', { name: 'due', title: 'Due', panels: [{ id: 'list', card: 'table', awaits: { server: 'crm', tool: 'list_customers' } }] });
    cp = JSON.parse(JSON.stringify(ui.checkpoint())) as ViewCheckpoint;
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
  assert.deepEqual(cp.gates.map(([k, g]) => [k, g.pointer]), [['due/list', undefined]]);
  const host = hostOf();
  host.online = true;
  const t = await reopen(cp, host);
  try {
    assert.deepEqual(host.calls, []);
    assert.ok(drawnOf(t.shown, 'due').includes('Waiting for crm.list_customers') && !drawnOf(t.shown, 'due').includes('try_again'));
    assert.deepEqual(await t.ui.refetchWaiting(), { filled: 0, still: 0 });
    assert.equal(t.ui.event({ type: 'action', view: 'due', name: 'try_again', context: { panel: 'list' } }), false);
  } finally { await t.close(); }
});
