// What the server does when things happen at once or after the end, over real MCP: a task closed while asks, waits and
// a client are still open; a view shown again while it is checked; what a page says through its bridge, how much and
// how often; several yeses to one thing; what counts as the person's answer; a checkpoint that is not one; reminders
// the model sets and drops; live sources read once; reads that are too long; a change a view cannot be drawn with.
// All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, type Shown, type ShellState, type Operation, type ViewCheckpoint } from '../src/index.js';
import { answerOf, mcpClient, sleep } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const rows = [{ number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050 }, { number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: 19800 }];
const pay: Operation = { name: 'pay', description: 'Pay an invoice.', effect: 'external', approve: 2, input: { number: z.string() },
  ask: { title: 'Pay it?', choices: ['Pay now', 'Pay later'] }, run: () => ({ paid: true }) };
const countTwice: Operation = { name: 'count_stock', description: 'Count the stock.', effect: 'read', approve: 2, input: {}, run: () => ({ counted: 3 }) };

test('a task closed while it asks, waits and is drawn: each ask leaves and the host is told, every wait ends, nothing is thrown later', async () => {
  const vindu = await startVindu({ waitMs: 20_000, verifyMs: 20_000, operations: [pay] });
  const dir = tmp('life-close-'), results = memoryResults(dir); results.add({ server: 'accounts', tool: 'list_invoices', value: rows });
  const gone: [string, string][] = [];
  const ui = vindu.open({ results, dir }, { onView: () => undefined, onAskGone: (view, action) => gone.push([view, action]) });
  const { mcp, call } = await mcpClient(ui.url);
  const stray: unknown[] = []; const onStray = (e: unknown) => stray.push(e); process.on('unhandledRejection', onStray);
  try {
    const signal = new AbortController().signal;
    const confirmed = ui.confirm({ title: 'Go on?' }, signal);
    const asked = call('pay', { number: 'INV-2026-0412' });
    const waits = call('await_answer', {}); // for what a page sends next
    const drawn = call('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r1' }] }); // waits for the window to read it back
    // every call is waiting on the server before the task closes: a call that arrives after it finds no task (404)
    await until(() => ui.shell().views.filter(v => v.name.startsWith('ask-')).length === 2 && ui.shell().views.some(v => v.name === 'inv'));
    await sleep(300); // await_answer has no mark of its own in the window: time for its request to arrive
    assert.equal(getEventListeners(signal, 'abort').length, 1);
    const t0 = Date.now();
    ui.close();
    fs.rmSync(dir, { recursive: true, force: true }); // the host takes the task's folder away with it
    assert.equal(await confirmed, false);
    assert.equal(getEventListeners(signal, 'abort').length, 0); // nothing listens for a task that is gone
    for (const r of await Promise.all([asked, waits, drawn])) assert.equal(r.ok, true);
    assert.ok(Date.now() - t0 < 5000, 'every call that waited was answered at once');
    assert.deepEqual(gone.map(([, a]) => a), ['cancel', 'cancel']);
    await sleep(100);
    assert.deepEqual(stray, []);
    // the provider closes at once, though a client still holds its connection open
    const t1 = Date.now(); await vindu.close(); assert.ok(Date.now() - t1 < 3000);
  } finally { process.off('unhandledRejection', onStray); await mcp.close().catch(() => undefined); }
});

test('a view shown again while its drawing is checked: what the person did meanwhile is kept, and the older account says it was drawn again', async () => {
  const vindu = await startVindu({ waitMs: 300, verifyMs: 600 });
  const dir = tmp('life-twice-'), results = memoryResults(dir); results.add({ server: 'accounts', tool: 'list_invoices', value: rows });
  const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { onView: () => undefined, onState: s => { st.s = s; } });
  const { mcp, json } = await mcpClient(ui.url);
  const view = { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r1', columns: ['number', 'amount'] }] };
  try {
    await json('show_view', view);
    const again = json('show_view', { ...view, subtitle: 'Shown again' });
    await sleep(100); // while it waits for the window to read it back, the person sorts it
    assert.equal(ui.event({ type: 'view', view: 'inv', action: 'sort', panel: 'rows', field: 'amount' }), true);
    const acc = await again;
    assert.match(String(acc.verified), /^drawn again since, while this showing was checked/);
    await until(() => st.s!.views.find(v => v.name === 'inv')?.mark?.by === 'person'); // the person's sort, and its undo, are still there
    assert.equal(ui.event({ type: 'view', view: 'inv', action: 'undo' }), true);
    await until(() => st.s!.views.find(v => v.name === 'inv')?.mark === undefined);
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test('what a page says through its bridge counts only from a page panel shown, within a send\'s size and as often', async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('life-page-'), suggested: string[] = [];
  const ui = vindu.open({ results: memoryResults(dir), dir }, { onView: () => undefined, onSuggest: p => suggested.push(p) });
  const { mcp, json } = await mcpClient(ui.url);
  try {
    await json('show_view', { name: 'scene', title: 'Scene', panels: [{ id: 'pg', card: 'page', html: '<!doctype html><p>3D</p>' }, { id: 'note', card: 'text', text: 'x' }] });
    const say = (x: Record<string, unknown>) => ui.event({ type: 'page', view: 'scene', panel: 'pg', ...x });
    assert.equal(ui.event({ type: 'page', view: 'nowhere', panel: 'pg', kind: 'ask', prompt: 'Delete it all?' }), false);
    assert.equal(ui.event({ type: 'page', view: 'scene', panel: 'note', kind: 'ask', prompt: 'Delete it all?' }), false); // not a page
    assert.equal(say({ kind: 'ask', prompt: 'x'.repeat(2001) }), false);
    assert.equal(say({ kind: 'select', items: ['y'.repeat(9000)] }), false);
    assert.equal(say({ kind: 'select', items: [{ part: 'rear axle' }], note: 'n'.repeat(501) }), false);
    assert.equal(say({ kind: 'select', items: [{ part: 'rear axle' }], note: 'clicked' }), true);
    assert.deepEqual(ui.selection().at(-1)?.page, [{ part: 'rear axle' }]);
    for (let i = 0; i < 4; i++) assert.equal(say({ kind: 'ask', prompt: `Follow up ${i}?` }), true);
    assert.equal(say({ kind: 'ask', prompt: 'And again?' }), false); // five in ten seconds, at most
    assert.equal(suggested.length, 4);
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test('several yeses are to one thing: each after the first approves what it chose, one name is one person, and a read needs them too', async () => {
  const vindu = await startVindu({ waitMs: 300, operations: [pay, countTwice] });
  const dir = tmp('life-yes-'), shown: Shown[] = [];
  const ui = vindu.open({ results: memoryResults(dir), dir }, { onView: v => shown.push(v) });
  const { mcp, json } = await mcpClient(ui.url);
  const lastAsk = () => shown.filter(v => v.ask).at(-1)!;
  try {
    const paid = json('pay', { number: 'INV-2026-0412' });
    await until(() => shown.some(v => v.ask?.op === 'pay'));
    const t = lastAsk().ask!.ticket, view = lastAsk().name;
    const answer = (choice: string, n: number, name: string, window: string) => ui.event({ type: 'action', view, name: 'answer', context: { ticket: t, choice, n }, by: { name, window } });
    answer('Pay later', 1, 'Kari', 'main');
    await until(() => (lastAsk().ask!.approvals ?? []).length === 1);
    answer('Pay now', 0, 'Ola', 'phone');
    await until(() => /Kari chose "Pay later": approve exactly that, or decline/.test(lastAsk().ask!.error ?? ''));
    answer('Pay later', 1, '  Kari ', 'phone'); // the same name, with spaces round it
    await until(() => /has said yes already/.test(lastAsk().ask!.error ?? ''));
    answer('Pay later', 1, 'Ola', 'phone');
    const r = await paid;
    assert.deepEqual(r.answer, { choice: 'Pay later' });
    assert.deepEqual(answerOf(ui.answers().at(-1))?.who, ['Kari (main)', 'Ola (phone)']);
    const counted = await json('count_stock', {}); // it only reads, but two must say yes: it asks
    assert.equal(counted.pending, true);
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test("a receipt shows what went otherwise though the call failed; only the person's answers count as answered", async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('life-receipt-'), results = memoryResults(dir), shown: Shown[] = [];
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v) });
  const { mcp, json } = await mcpClient(ui.url);
  const letter = { to: 'ingrid@havgap.example', subject: 'Reminder', body: 'Please pay INV-2026-0412.' };
  try {
    const asked = ui.permission({ title: 'Send it?', tool: 'mail: send', server: 'mail', name: 'send', input: letter, options: [{ name: 'Yes', kind: 'allow_once' }, { name: 'No', kind: 'reject_once' }] }, new AbortController().signal);
    await until(() => ui.shell().views.some(v => v.name === 'preview-k1'));
    ui.event({ type: 'action', view: 'ask-k1', name: 'answer', context: { ticket: 'k1', choice: 'Yes', n: 0 } });
    assert.equal(await asked, 0);
    const went = results.add({ server: 'mail', tool: 'send', input: { ...letter, to: 'someone@else.example' }, value: { error: 'bounced' } });
    went.error = true;
    ui.result(went.id);
    await until(() => ui.shell().views.find(v => v.name === 'preview-k1')?.title === 'Not as approved, and it failed');
    assert.deepEqual(ui.receipts().map(r => r.state), ['differs']);
    assert.match(ui.delta(), /r1 is not what the person approved \(p\d+\): to differ, and the call failed; the window shows both/);
    // a view written to wait for an answer: what a page's script sends is kept, but it is not the person's answer
    await json('show_view', { name: 'scene', title: 'Scene', panels: [{ id: 'pg', card: 'page', html: '<!doctype html><p>Send</p>' }] });
    const held = await json('show_view', { name: 'found', title: 'Found', after: { answered: 'the page panel "pg" in view "scene"' }, panels: [{ id: 't', card: 'text', text: 'Found it' }] });
    assert.match(held.held, /^not shown yet/);
    assert.equal(ui.event({ type: 'send', view: 'scene', panel: 'pg', value: { go: true } }), true);
    await until(() => ui.answers().some(a => a.kind === 'answer' && a.by === 'page')); await sleep(100);
    assert.equal(ui.shell().views.some(v => v.name === 'found'), false);
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test('the model suggests its undo where the person takes its changes; a checkpoint that is not one is refused', async () => {
  const vindu = await startVindu({ waitMs: 300, modelArrange: 'suggest' });
  const dir = tmp('life-undo-'), results = memoryResults(dir); results.add({ server: 'accounts', tool: 'list_invoices', value: rows });
  const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { onView: () => undefined, onState: s => { st.s = s; } });
  const { mcp, call, json } = await mcpClient(ui.url);
  try {
    await json('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r1' }] });
    assert.match((await call('act_in_view', { view: 'inv', action: 'sort', panel: 'rows', field: 'amount' })).text, /^suggested to the person/);
    assert.equal(ui.event({ type: 'view', view: 'inv', action: 'take' }), true);
    await until(() => st.s!.views.find(v => v.name === 'inv')?.mark?.undo === true);
    const undo = await call('act_in_view', { view: 'inv', action: 'undo' });
    assert.match(undo.text, /suggested to the person, who takes it or not: undo "sorted/);
    assert.equal(st.s!.views.find(v => v.name === 'inv')?.mark?.suggestion, true); // nothing undone yet: the person takes it, or not
    const other = vindu.open({ results: memoryResults(tmp('life-restore-')), dir: tmp('life-restore-') }, { onView: () => undefined });
    const notOne: unknown = { views: 'all of them' }; // as a host might read back a file that is not a checkpoint
    await assert.rejects(Promise.resolve().then(() => other.restore(notOne as ViewCheckpoint)), /Not a task checkpoint/);
    const real = ui.checkpoint();
    await assert.rejects(Promise.resolve().then(() => other.restore({ ...real, views: [{ ...real.views[0], name: 'reminders' }] })), /shown under another name/);
    other.close();
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test('reminders the model sets and drops are so many a day; two live panels on reads of one call share one source; reads have a cap', async () => {
  const vindu = await startVindu({ waitMs: 300, reminders: { max: 1 } });
  const dir = tmp('life-rem-'), results = memoryResults(dir);
  results.add({ server: 'accounts', tool: 'list_invoices', input: { status: 'overdue' }, value: rows }); // r1
  results.add({ server: 'accounts', tool: 'list_invoices', input: { status: 'overdue' }, value: rows }); // r2: the same call, read again
  const stopped: number[] = []; let watches = 0;
  const ui = vindu.open({ results, dir }, { onView: () => undefined, isRead: () => true,
    watch: () => { const n = ++watches; return () => stopped.push(n); } });
  const { mcp, call, json } = await mcpClient(ui.url);
  try {
    for (let i = 0; i < 3; i++) {
      const set = await json('remind', { what: `Chase ${i}`, when: 'now + 2 hours' });
      await json('remind', { drop: set.set.id });
    }
    assert.match((await call('remind', { what: 'Once more', when: 'now + 2 hours' })).text, /not set: you have set 3 reminders in the last day, the most a day/);
    await json('show_view', { name: 'a', title: 'A', panels: [{ id: 'one', card: 'table', from: 'r1', live: {} }, { id: 'two', card: 'table', from: 'r2', live: {} }] });
    assert.equal(watches, 1);
    await json('show_view', { name: 'a', title: 'A', panels: [{ id: 'one', card: 'text', text: 'not live' }] });
    assert.deepEqual(stopped, [1]); // its last panel went: the one source stopped
    assert.equal((await call('ctx_read', { ref: 'ctx:r1', max: 10_000_000 })).ok, false);
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test('a static view\'s source stops refilling its slot once the model may change the view; closing an ask in the shelf answers it', async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('life-fresh-'), results = memoryResults(dir); const stops: (string | undefined)[] = [];
  const ui = vindu.open({ results, dir }, { onView: () => undefined, isRead: () => true,
    source: async src => results.add({ server: src.server, tool: src.tool ?? '', input: src.args, value: rows }).id,
    watch: what => () => stops.push(what.tool) });
  try {
    const t = { name: 'Fresh', version: 1, slots: { inv: { title: 'Invoices', block: 'table', source: { server: 'accounts', tool: 'list_invoices', every: 30 } } }, layout: ['inv'] };
    assert.equal((await ui.useTemplate(t, {})).started, true);
    assert.equal(ui.letModelChange(), true);
    assert.deepEqual(stops, ['list_invoices']);
    const open = ui.confirm({ title: 'Go on?' }, new AbortController().signal);
    await until(() => ui.shell().views.some(v => v.name === 'ask-k1'));
    ui.delta();
    assert.equal(ui.event({ type: 'close', view: 'ask-k1' }), true); // closed: no answer, and no layout change of the person's
    assert.equal(await open, false);
    assert.doesNotMatch(ui.delta(), /collapsed/);
    const shelved = ui.confirm({ title: 'Go on, then?' }, new AbortController().signal);
    await until(() => ui.shell().views.some(v => v.name === 'ask-k2'));
    assert.equal(ui.event({ type: 'collapse', view: 'ask-k2' }), true); // in the shelf it is still asked
    assert.equal(ui.event({ type: 'close', view: 'ask-k2' }), true); // and closed there, it is answered no
    assert.equal(await shelved, false);
  } finally { ui.close(); await vindu.close(); }
});

test('a change a view cannot be drawn with is no change: refused, and not kept to undo; a view written up front writes nothing yet', async () => {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('life-act-'), results = memoryResults(dir); results.add({ server: 'accounts', tool: 'list_invoices', value: rows });
  const ui = vindu.open({ results, dir }, { onView: () => undefined });
  const { mcp, call, json } = await mcpClient(ui.url);
  try {
    await json('show_view', { name: 'inv', title: 'Invoices', panels: [{ id: 'rows', card: 'table', from: 'r1' }] });
    await json('act_in_view', { view: 'inv', action: 'filter', field: 'customer', value: 'Havgap Media' });
    const none = await call('act_in_view', { view: 'inv', action: 'filter', field: 'amount', value: 19800 }); // with the first: no row is left
    assert.equal(none.ok, false); assert.match(none.text, /keeps none of the 2 rows|no row of Invoices has amount 19800/); // refused when applied, or when drawn
    const undo = await json('act_in_view', { view: 'inv', action: 'undo' });
    assert.match(undo.did, /undid "showed only the rows of Invoices where customer is "Havgap Media""/);
    assert.equal(undo.view.panels[0].rows, 2);
    const held = await json('show_view', { name: 'later', title: 'Later', after: { answered: 'the question "Go?"' }, panels: [{ id: 'pg', card: 'page', html: '<!doctype html><p>Later</p>' }] });
    assert.match(held.held, /^not shown yet/);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'views')).filter(f => f.includes('later')), []); // checked, not written
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});
