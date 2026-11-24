// A checkpoint keeps where each result came from, never what it held: on restore the host reads each one again
// (refetch), and the views are drawn from what came. A panel whose result was not read again waits for it, saying
// why, and fills in when the call comes again; without the host's refetch, every panel on a result restores waiting.
// All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type ResultPointer, type Shown, type ViewCheckpoint } from '../src/index.js';
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
    assert.ok(drawnOf(shown, 'photo').includes('Not read again: the host could not. It showed what camera.snapshot gave.')); // its picture too
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
    const next = ui.checkpoint(); // what it waits for is kept as a wait, still with no result in it
    assert.ok(!JSON.stringify(next).includes('overdue'));
  } finally { ui.close(); await vindu.close(); }
});
