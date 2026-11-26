// Pinned and kept fresh, over real MCP: a view in a frame of its own is a free slot; a dynamic view becomes a template;
// a source the host reads again, shown in its slot and told once; a read that changed since, marked not up to date; and a
// source that is a resource. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { memoryResults, checkTemplate, pinTemplate, type Shown } from '../src/index.js';
import { mcpClient, sleep } from './helpers.js';
import { tmp, until, invoices, vindu, isRead } from './templates-session.js';

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
    assert.match((await mcp.callTool({ name: 'results', arguments: {} }) as { content: { text: string }[] }).content[0].text, /r1[^\n]*\(read again since: r3 says something else\)/);
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
