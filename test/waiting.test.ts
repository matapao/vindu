// Views written up front, filled and shown by the system as things happen, without the model: a panel that awaits a
// result this process does not have yet (filled exactly when it comes; a failed call shows the server's own answer), a
// panel after the person's answer or pick, a view held until then, and a view of steps the person goes through with
// Next and Back. The model is told once. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { mcpClient, sleep, panelsIn, type AccountPanel } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const customers = [{ customer: 'Havgap Media', city: 'Bergen' }, { customer: 'Brattli Verksted', city: 'Voss' }];
const invoices = [{ number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050 }, { number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: 19800 }];

async function windowWith() {
  const vindu = await startVindu({ waitMs: 300, decisions: true });
  const dir = tmp('waiting-'), results = memoryResults(dir);
  results.add({ server: 'crm', tool: 'list_customers', value: customers });
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { st.s = s; } });
  const c = await mcpClient(ui.url);
  const model = (name: string) => panelsIn(shown.filter(v => v.name === name).at(-1)!.wide);
  const drawn = (name: string) => JSON.stringify(shown.filter(v => v.name === name).at(-1)?.wide ?? null);
  const arrive = (x: Parameters<typeof results.add>[0]) => { const r = results.add(x); ui.result(r.id); return r; }; // as a host reports each result captured
  return { vindu, ui, results, arrive, ...c, shown, st, model, drawn, close: async () => { await c.mcp.close(); ui.close(); await vindu.close(); } };
}

test('a panel that awaits a result: it says what it waits for, and the system fills it exactly when the call comes; a failed call shows the server\'s answer', async () => {
  const w = await windowWith();
  try {
    const acc = await w.json('show_view', { name: 'chase', title: 'Chase overdue invoices', panels: [
      { id: 'cust', card: 'table', from: 'r1' },
      { id: 'inv', card: 'table', title: 'Invoices', awaits: { server: 'accounts', tool: 'list_invoices' }, columns: ['number', 'amount'] },
      { id: 'mail', card: 'table', title: 'Sent', awaits: { tool: 'send_reminders' } },
    ] });
    const inv = acc.panels.find((p: AccountPanel) => p.id === 'inv');
    assert.deepEqual([inv.card, inv.from, inv.waiting], ['table', 'waiting', 'Waiting for accounts.list_invoices: it fills in here when it comes. The system fills it when that happens, without you']);
    assert.ok(w.drawn('chase').includes('Waiting for accounts.list_invoices: it fills in here when it comes.'));
    w.arrive({ server: 'other', tool: 'list_invoices', value: [] }); // another server's tool of the same name: not it
    await sleep(80);
    assert.ok(w.drawn('chase').includes('Waiting for accounts.list_invoices'));
    const n = w.shown.length;
    const r = w.arrive({ server: 'accounts', tool: 'list_invoices', input: { status: 'overdue' }, value: invoices });
    await until(() => w.shown.length > n && !!w.model('chase').p_inv?.rows);
    assert.deepEqual(w.model('chase').p_inv.rows.map(x => x.c0), ['INV-2026-0412', 'INV-2026-0418']); // exactly as it came
    const look = await w.json('look', {});
    assert.ok(JSON.stringify(look).length > 0);
    assert.match(w.ui.delta(), new RegExp(`Chase overdue invoices \\(inv\\): filled from ${r.id}, exactly as it came`));
    // a call that fails: the panel shows the server's own answer
    const failed = w.results.add({ server: 'mailer', tool: 'send_reminders', text: 'SMTP 550: mailbox unavailable', value: undefined });
    failed.error = true; w.ui.result(failed.id);
    await until(() => w.drawn('chase').includes('send_reminders failed'));
    assert.ok(w.drawn('chase').includes(`send_reminders failed (${failed.id}): SMTP 550: mailbox unavailable`));
    // shown again by the model with the same awaits: still filled from the same result
    await w.json('show_view', { name: 'chase', title: 'Chase overdue invoices', panels: [{ id: 'inv', card: 'table', title: 'Invoices', awaits: { server: 'accounts', tool: 'list_invoices' } }] });
    assert.deepEqual(w.model('chase').p_inv.rows.length, 2);
  } finally { await w.close(); }
});

test('after the person picks or answers: a panel shown then, and a view written up front, held until then and shown by the system', async () => {
  const w = await windowWith();
  try {
    w.results.add({ server: 'accounts', tool: 'list_invoices', value: invoices }); // r2
    const acc = await w.json('show_view', { name: 'crm', title: 'Customers', panels: [
      { id: 'cust', card: 'table', from: 'r1', columns: ['customer', 'city'] },
      { id: 'inv', card: 'table', from: 'r2', detail: { of: 'cust', by: 'customer' }, after: { picked: 'cust' } },
    ] });
    assert.equal(acc.panels.find((p: AccountPanel) => p.id === 'inv').waiting, 'After you pick a row in cust. The system fills it when that happens, without you');
    // a view written up front, after the person picks: held, not shown
    const held = await w.json('show_view', { name: 'next', title: 'Next steps', after: { picked: 'crm/cust' }, panels: [{ card: 'text', text: 'Call them before Friday.' }], place: { into: 'crm' } });
    assert.match(held.held, /^not shown yet: the system shows it, without you, after you pick a row in cust; then you are told once$/);
    assert.ok(!w.st.s!.views.some(v => v.name === 'next'));
    const n = w.shown.length;
    w.ui.event({ type: 'view', view: 'crm', action: 'select', panel: 'p_cust', from: 1 });
    await until(() => w.shown.length > n && !!w.model('crm').p_inv?.rows && w.st.s!.views.some(v => v.name === 'next'));
    assert.deepEqual(w.model('crm').p_inv.rows.map(x => x.c0), ['INV-2026-0418']);
    const look = await w.json('look', {});
    assert.deepEqual(look.layout, { stack: ['crm', 'next'], front: 'next' }); // where it was written to go: in front of crm
    assert.match(w.ui.delta(), /Next steps is shown now, by the system/);
    // after the person answers an operation the model put before them: a view held until then
    const held2 = await w.json('show_view', { name: 'owner', title: 'Decided', after: { answered: 'record_decision' }, panels: [{ card: 'text', text: 'Now tell the customer.' }] });
    assert.match(held2.held, /after you answer "record decision"/);
    const call = w.json('record_decision', { subject: 'credit for INV-2026-0418', outcome: 'A credit note is issued.', grounds: 'The delivery was late.', sources: ['ctx:r2#/1'] });
    await until(() => w.shown.some(v => v.ask)); const k = w.shown.find(v => v.ask)!;
    assert.ok(!w.st.s!.views.some(v => v.name === 'owner'));
    w.ui.event({ type: 'action', view: k.name, name: 'answer', context: { ticket: k.ask!.ticket, 'f:outcome': 'A credit note is issued.', 'f:grounds': 'The delivery was late.', 'f:sources': 'ctx:r2#/1' } });
    await call;
    await until(() => w.st.s!.views.some(v => v.name === 'owner'));
    assert.match(w.ui.delta(), /Decided is shown now, by the system/);
  } finally { await w.close(); }
});

test('a view of steps: one panel at a time, the person goes on with Next and back with Back, without the model', async () => {
  const w = await windowWith();
  try {
    const acc = await w.json('show_view', { name: 'onboard', title: 'Onboarding', steps: true, panels: [
      { id: 'one', card: 'text', text: 'First, the customers.' }, { id: 'two', card: 'table', from: 'r1' }, { id: 'three', card: 'text', text: 'Then send the welcome letter.' },
    ] });
    assert.equal(acc.panels.length, 3); // every panel checked now
    const ids = () => JSON.stringify(w.shown.filter(v => v.name === 'onboard').at(-1)!.wide);
    assert.ok(ids().includes('First, the customers.') && !ids().includes('Then send the welcome letter.') && ids().includes('Step 1 of 3'));
    assert.equal(w.ui.event({ type: 'action', view: 'onboard', name: 'step', context: { to: 2 } }), true);
    await until(() => ids().includes('Step 2 of 3'));
    assert.ok(ids().includes('Havgap Media') && !ids().includes('Then send'));
    assert.equal(w.ui.event({ type: 'action', view: 'onboard', name: 'step', context: { to: 9 } }), false);
    w.ui.event({ type: 'action', view: 'onboard', name: 'step', context: { to: 3 } });
    await until(() => ids().includes('Step 3 of 3') && ids().includes('Then send the welcome letter.') && !ids().includes('step_next'));
    assert.match(w.ui.delta(), /the person went to step 2 of 3 in Onboarding[\s\S]*the person went to step 3 of 3 in Onboarding/);
  } finally { await w.close(); }
});
