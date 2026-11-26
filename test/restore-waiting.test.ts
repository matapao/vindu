// A panel whose result the host could not read again keeps its pointer, and the host's ref with it, in every checkpoint;
// ui.refetchWaiting and the person's Try again read it again in place; a panel the model wrote to await a call keeps none.
// All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { startVindu, memoryResults, VIEW_WORDS_NB, VIEW_WORDS_NN, type ViewCheckpoint, type ViewPresentation } from '../src/index.js';
import { mcpClient, sleep } from './helpers.js';
import { firstTask, until, modelOf, drawnOf, hostOf, reopen, keptOf, nameOf, KEPT } from './restore-refetch-session.js';

const saved = await firstTask(); // the checkpoint restore-refetch.test.ts's first test takes

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
