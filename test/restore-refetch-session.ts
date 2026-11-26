// What the restore tests share (restore-refetch.test.ts, restore-waiting.test.ts): the first task, whose checkpoint they
// restore, a host that reads again what it can (or not), a task opened again from a checkpoint, and what each kept.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type ResultPointer, type Shown, type ViewCheckpoint, type ViewPresentation } from '../src/index.js';
import { mcpClient, sleep, panelsIn } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
export const invoices = (status: string) => [{ number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050, status }];
/** What the servers say of their tools: lists and reads only read, creating and sending change things. */
export const isRead = (_server: string, tool: string): boolean | undefined => {
  if (/^(list|read)_/.test(tool)) return true;
  if (/^(create|send)_/.test(tool)) return false;
  return undefined;
};
export const photoFile = path.join(tmp('vindu-person-'), 'site.png');
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
export async function firstTask() {
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

export const modelOf = (shown: Shown[], view: string) => panelsIn(shown.filter(v => v.name === view).at(-1)!.wide);
export const drawnOf = (shown: Shown[], view: string) => JSON.stringify(shown.filter(v => v.name === view).at(-1)?.wide ?? null);

/** A host that reads again what it can now: the person's file always; online, the results and the picture, but never
 *  the note. */
export const hostOf = () => {
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
export async function reopen(cp: ViewCheckpoint, host?: Host, more: { onPresentation?: (v: ViewPresentation) => void } = {}) {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 0, reminders: true });
  const shown: Shown[] = [];
  const ui = vindu.open({ results: host?.results ?? memoryResults() }, { onView: v => shown.push(v), isRead, ...(host ? { refetch: host.refetch } : {}), ...more });
  const refused = await ui.restore(cp);
  return { ui, shown, refused, close: async () => { ui.close(); await vindu.close(); } };
}
/** The pointer each gate of a checkpoint keeps, by view/panel. */
export function keptOf(cp: ViewCheckpoint) { return Object.fromEntries(cp.gates.flatMap(([k, g]) => (g.pointer ? [[k, g.pointer]] : []))); }
export const nameOf = (p: ResultPointer) => (p.kind === 'result' ? `${p.server}.${p.tool}` : p.name);
const R1 = { id: 'r1', kind: 'result', server: 'accounts', tool: 'list_invoices', input: { status: 'open' } };
export const KEPT = {
  'inv/rows': R1, 'inv/total': R1,
  'cust/list': { id: 'r2', kind: 'result', server: 'crm', tool: 'list_customers', input: {} },
  'sent/one': { id: 'r4', kind: 'result', server: 'accounts', tool: 'send_invoice', ref: 'sent-0418' }, // by the host's ref
  'note/body': { id: 'r5', kind: 'result', server: 'notes', tool: 'read_note', input: { id: 7 } },
  'photo/shot': { id: 'r6', kind: 'result', server: 'camera', tool: 'snapshot', input: { site: 'Voss' } }, // the picture a tool returned
};
