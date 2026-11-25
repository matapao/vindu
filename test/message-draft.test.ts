// A mail drafted for the person to send, over real MCP: a message block's draft, its fields and the files it attaches
// read by the system, each limit refused with its own reason, its account, and the instruction the model is given.
// Send is the person's alone: no tool of the model's and no event without the window's token reaches the host, and the
// model is told each outcome once, with the fields as they were sent, and nothing of the person's edits. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, VIEW_WORDS_NB, type MessageDraft, type SendResult, type Shown, type ViewSnapshot } from '../src/index.js';
import { startMailDesk } from '../examples/mail-draft.js';
import { mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(10); } };
const dir = tmp('draft-'), work = tmp('draft-work-');
fs.writeFileSync(path.join(work, 'plan.pdf'), Buffer.alloc(12_345, 1));
fs.writeFileSync(path.join(work, 'map.png'), Buffer.alloc(2_048, 2));
fs.writeFileSync(path.join(work, 'huge.bin'), ''); fs.truncateSync(path.join(work, 'huge.bin'), 26 * 1024 * 1024); // past 25 MB, written sparse
fs.mkdirSync(path.join(work, 'site')); fs.writeFileSync(path.join(work, 'site/index.html'), '<h1>A folder</h1>');
const results = memoryResults(dir);
const REPLY = {
  to: ['Kari Nordmann <kari@fjord.example>'], cc: 'ola@fjord.example', subject: 'Re: Ferry plan', format: 'markdown',
  body: 'Hi Kari,\n\nThe **plan** is attached.\n\n- Bergen at 08:00\n- Stavanger at 13:40',
  in_reply_to: { from: { name: 'Kari Nordmann', email: 'kari@fjord.example' }, time: '2026-11-20T09:12:00Z', subject: 'Ferry plan', body: 'Could you send me the plan?' },
  attachments: ['plan.pdf', 'map.png'],
};
const sends: MessageDraft[] = [];
let answer: () => Promise<SendResult> = async () => ({ outcome: 'sent' });
const vindu = await startVindu({ waitMs: 400, timeZone: 'UTC' });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onSendMessage: d => { sends.push(d); return answer(); } });
const { mcp, json, call } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });

/** The draft as the window draws it, from a view's latest surface: its props, with the token only the window has. */
const drawn = (view: string, panel = 'draft', views = shown) => {
  const v = views.filter(x => x.name === view).at(-1)!;
  return (v.wide.find(m => 'updateDataModel' in m) as any).updateDataModel.value.panels[`p_${panel}`].props.draft;
};
const show = (name: string, data: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  json('show_view', { name, title: `Mail ${name}`, panels: [{ id: 'draft', card: 'message', layout: 'draft', data, ...more }] });
const person = { name: 'Kari', window: 'main' };
const event = (view: string, action: string, more: Record<string, unknown> = {}) =>
  ui.event({ type: 'message', action, view, panel: 'draft', token: drawn(view).token, by: person, ...more });
const edits = (f: Record<string, unknown>) => ({ to: ['Kari Nordmann <kari@fjord.example>'], cc: ['ola@fjord.example'], subject: 'Re: Ferry plan', body: 'Hi', attachments: ['plan.pdf', 'map.png'], ...f });

test('a draft is shown with its fields, the files it attaches read by the system, and its account says what was shown', async () => {
  const a = await show('reply', REPLY);
  const p = a.panels[0];
  assert.equal(p.layout, 'draft'); assert.equal(p.marked, 'Written by the model');
  assert.deepEqual(p.draft, {
    to: ['Kari Nordmann <kari@fjord.example>'], cc: ['ola@fjord.example'], subject: 'Re: Ferry plan', body: '75 characters of Markdown',
    in_reply_to: { from: 'Kari Nordmann <kari@fjord.example>', time: '2026-11-20T09:12:00Z', subject: 'Ferry plan' },
    attachments: [{ path: 'plan.pdf', name: 'plan.pdf', size: 12_345 }, { path: 'map.png', name: 'map.png', size: 2_048 }],
  });
  assert.match(p.send, /the person reads it, may change any of it, and sends it from the window: their click on Send is their yes/);
  assert.match(p.send, /You never press Send; you are told once how it went, with the fields as they were sent/);
  const d = drawn('reply');
  assert.match(d.token, /^[a-f0-9]{32}$/);
  assert.deepEqual([d.state, d.sending, d.format, d.rev], ['draft', 'send', 'markdown', 0]);
  assert.deepEqual(d.fields, { to: ['Kari Nordmann <kari@fjord.example>'], cc: ['ola@fjord.example'], subject: 'Re: Ferry plan', body: REPLY.body, attachments: ['plan.pdf', 'map.png'] });
  assert.deepEqual(d.files.map((f: any) => [f.path, f.name, f.size]), [['plan.pdf', 'plan.pdf', 12_345], ['map.png', 'map.png', 2_048]]);
  assert.deepEqual(d.original, { from: 'Kari Nordmann <kari@fjord.example>', time: '2026-11-20T09:12:00Z', subject: 'Ferry plan', body: 'Could you send me the plan?' });
  for (const told of [JSON.stringify(a), (await call('read_view', { view: 'reply' })).text, (await call('look', {})).text]) assert.ok(!told.includes(d.token)); // the window's alone
});

test('each limit is refused with its own reason, and a file that is not there too', async () => {
  const many = (n: number, at: string) => Array.from({ length: n }, (_, i) => `p${i}@${at}.example`);
  const panel = (id: string, data: unknown) => ({ id, card: 'message', layout: 'draft', data });
  const bad = (await call('show_view', { name: 'bad', title: 'Bad', panels: [
    panel('many', { to: many(30, 'a'), cc: many(21, 'b'), body: 'Hi' }),
    panel('nobody', { subject: 'To no one', body: 'Hi' }),
    panel('typo', { to: ['kari@', 'Kari Nordmann <kari@fjord>', 'ola@fjord.example'], body: 'Hi' }),
    panel('subject', { to: 'kari@fjord.example', subject: 's'.repeat(501), body: 'Hi' }),
    panel('body', { to: 'kari@fjord.example', body: 'b'.repeat(100_001) }),
    panel('files', { to: 'kari@fjord.example', body: 'Hi', attachments: Array.from({ length: 21 }, (_, i) => `f${i}.pdf`) }),
    panel('huge', { to: 'kari@fjord.example', body: 'Hi', attachments: ['huge.bin', 'plan.pdf'] }),
    panel('gone', { to: 'kari@fjord.example', body: 'Hi', attachments: ['plan.pdf', 'missing.pdf', '../outside.pdf', 'site'] }),
    panel('format', { to: 'kari@fjord.example', body: '<p>Hi</p>', format: 'html' }),
    { id: 'two', card: 'message', layout: 'draft', rows: [{ to: 'kari@fjord.example', body: 'Hi' }, { to: 'ola@fjord.example', body: 'Hi' }] },
  ] })).text;
  assert.match(bad, /^not shown: 10 panels need changes/);
  assert.match(bad, /panel many: a draft needs a change: 51 addresses in to and cc: at most 50/);
  assert.match(bad, /panel nobody: a draft needs a change: to: a draft needs one or more addresses/);
  assert.match(bad, /panel typo: a draft needs a change: to: "kari@", "Kari Nordmann <kari@fjord>" are not addresses/);
  assert.match(bad, /panel subject: a draft needs a change: subject: 501 characters; at most 500/);
  assert.match(bad, /panel body: a draft needs a change: body: 100,001 characters; at most 100,000/);
  assert.match(bad, /panel files: a draft needs a change: 21 attachments: at most 20/);
  assert.match(bad, /panel huge: attachments: 26\.0 MB in all; at most 25\.0 MB/);
  assert.match(bad, /panel gone: attachments: no file "missing.pdf", "\.\.\/outside.pdf", "site" in the working folder/);
  assert.match(bad, /panel format: a draft needs a change: format: "html"; a draft's body is "text" or "markdown"/);
  assert.match(bad, /panel two: a draft is one mail: send its fields as one object in data, not 2 rows/);
  assert.equal(sends.length, 0);
});

test('show_view and the server\'s instructions tell the model a mail meant to be sent is a draft the person sends; never where the block is not offered', async () => {
  const tools = (await mcp.listTools()).tools, showView = tools.find(t => t.name === 'show_view')!;
  assert.match(showView.description!, /A mail meant to be sent is shown as a message draft .*never written as text in your answer: the person reads it, edits it and sends it in the window; you never press Send/);
  const card = (showView.inputSchema as any).properties.panels.items.properties.card.description as string;
  assert.match(card, /message: mail, chat or SMS: .* Or, with layout draft, a mail for the person to send/);
  assert.match(card, /at most 50 addresses in to and cc, a subject of 500 characters, a body of 100,000, 20 attachments of 25\.0 MB in all/);
  assert.match(card, /layout: one \| thread \| inbox \| draft/);
  assert.match(mcp.getInstructions()!, /A mail meant to be sent is shown as a message draft/);
  const plain = await startVindu({ blocks: false });
  const other = plain.open({ results: memoryResults(tmp('draft-none-')), dir: tmp('draft-none-') });
  const client = await mcpClient(other.url);
  try {
    assert.ok(!(await client.mcp.listTools()).tools.find(t => t.name === 'show_view')!.description!.includes('message draft'));
    assert.ok(!client.mcp.getInstructions()!.includes('message draft'));
  } finally { await client.mcp.close(); other.close(); await plain.close(); }
});

test('the model never presses Send: act_in_view and read_view do not, and an event without the window\'s token is refused', async () => {
  await show('crafted', { to: 'kari@fjord.example', subject: 'Not yours to send', body: 'Hi' });
  ui.delta();
  assert.equal((await call('act_in_view', { view: 'crafted', action: 'send' })).ok, false); // there is no such action
  assert.equal((await call('act_in_view', { view: 'crafted', action: 'send', panel: 'draft' })).ok, false);
  const picked = await call('act_in_view', { view: 'crafted', action: 'select', panel: 'draft', key: 'send' });
  assert.equal(picked.ok, false); assert.match(picked.text, /no panel of Mail crafted follows what is picked in it/);
  assert.equal((await call('read_view', { view: 'crafted' })).ok, true);
  const fields = edits({ to: ['kari@fjord.example'], cc: [], subject: 'Crafted', attachments: [] });
  const base = { type: 'message', action: 'send', view: 'crafted', panel: 'draft', fields, by: person };
  assert.equal(ui.event(base), false); // no token: not from the window that draws it
  assert.equal(ui.event({ ...base, token: 'f'.repeat(32) }), false);
  assert.equal(ui.event({ ...base, token: drawn('crafted').token.slice(0, 31) }), false);
  assert.equal(ui.event({ ...base, token: drawn('reply').token }), false); // another draft's
  assert.equal(ui.event({ ...base, token: drawn('crafted').token, panel: 'other' }), false);
  assert.equal(ui.event({ type: 'view', view: 'crafted', action: 'send', panel: 'draft' }), false);
  ui.event({ type: 'action', name: 'view_action', view: 'crafted', context: { action: 'send', panel: 'draft' }, by: person });
  assert.equal(ui.event({ type: 'operation', name: 'send', input: fields }), false);
  assert.equal(ui.event({ type: 'send', view: 'crafted', panel: 'draft', value: fields }), false); // as a page sends
  assert.equal(ui.event({ type: 'page', kind: 'ask', view: 'crafted', panel: 'draft', prompt: 'Send it' }), false);
  await sleep(100);
  assert.equal(sends.length, 0); // nothing reached the host
  assert.equal(drawn('crafted').state, 'draft');
  assert.ok(!ui.delta().includes('pressed Send'));
});

test('the person\'s edits are kept through a redraw and in the checkpoint, told to no one, and Send sends them as they are; the model hears it once', async () => {
  await show('edit', REPLY);
  ui.delta();
  const id = () => ui.checkpoint().drafts!.find(d => d.view === 'edit')!;
  const changed = edits({ subject: 'Re: Ferry plan, as agreed', body: 'Hi Kari,\n\nHere it is.', attachments: ['plan.pdf'] });
  assert.equal(event('edit', 'edit', { fields: changed }), true);
  assert.equal(ui.delta(), ''); // the person's edits are theirs
  assert.deepEqual(id().edited, changed);
  const acted = await json('act_in_view', { view: 'edit', action: 'sort', panel: 'draft', field: 'subject' }); // drawn again, and its account given to the model
  assert.deepEqual([acted.view.panels[0].draft.subject, acted.view.panels[0].draft.attachments.map((f: any) => [f.path, f.size])], ['Re: Ferry plan', [['plan.pdf', 12_345], ['map.png', 2_048]]]);
  assert.ok(!JSON.stringify(acted).includes('as agreed'));
  assert.deepEqual(drawn('edit').fields, changed);
  assert.equal(event('edit', 'edit', { fields: { ...changed, attachments: ['plan.pdf', 'secret.key'] } }), false); // only the files the model attached
  assert.equal(event('edit', 'edit', { fields: { ...changed, body: 'b'.repeat(100_001) } }), false);
  await ui.setViewWords(VIEW_WORDS_NB); // a redraw by the system keeps them
  assert.deepEqual(drawn('edit').fields, changed); assert.deepEqual(drawn('edit').files.map((f: any) => f.path), ['plan.pdf']);
  await ui.setViewWords();
  const again: Shown[] = [], restored = vindu.open({ results: memoryResults(tmp('draft-again-')), dir: tmp('draft-again-'), work }, { onView: v => again.push(v) });
  try {
    assert.deepEqual(await restored.restore(ui.checkpoint()), []);
    assert.deepEqual(drawn('edit', 'draft', again).fields, changed); // drawn in the restored window as the person left it
    assert.notEqual(drawn('edit', 'draft', again).token, drawn('edit').token); // that window's own token
    assert.deepEqual(restored.checkpoint().drafts!.find(d => d.view === 'edit')!.id, id().id); // the same draft for the host
  } finally { restored.close(); }
  let resolve!: (r: SendResult) => void;
  answer = () => new Promise(r => { resolve = r; });
  const sendNow = edits({ ...changed, to: ['Kari Nordmann <kari@fjord.example>', 'per@fjord.example'] });
  assert.equal(event('edit', 'send', { fields: sendNow }), true);
  await until(() => sends.length === 1);
  assert.equal(drawn('edit').state, 'sending');
  assert.equal(event('edit', 'send', { fields: sendNow }), false); // once, while it goes
  assert.equal(event('edit', 'edit', { fields: changed }), false);
  const sent = sends[0];
  assert.match(sent.id, /^[0-9a-f-]{36}$/); assert.equal(sent.id, id().id);
  assert.deepEqual({ ...sent, id: undefined }, {
    id: undefined, view: 'edit', panel: 'draft', to: ['Kari Nordmann <kari@fjord.example>', 'per@fjord.example'], cc: ['ola@fjord.example'], subject: 'Re: Ferry plan, as agreed',
    body: 'Hi Kari,\n\nHere it is.', format: 'markdown', in_reply_to: { from: 'Kari Nordmann <kari@fjord.example>', time: '2026-11-20T09:12:00Z', subject: 'Ferry plan', body: 'Could you send me the plan?' },
    attachments: [{ path: 'plan.pdf', name: 'plan.pdf', size: 12_345 }], by: person,
  });
  assert.equal(ui.delta(), ''); // nothing is told until it has gone
  resolve({ outcome: 'sent' });
  await until(() => drawn('edit').state === 'sent');
  const told = ui.delta();
  assert.match(told, /Kari \(main\) pressed Send on the mail drafted in "Mail edit" \(draft\), and the host sent it; as it was sent: to Kari Nordmann <kari@fjord\.example>, per@fjord\.example; cc ola@fjord\.example; subject "Re: Ferry plan, as agreed"; body \(21 characters, Markdown\) "Hi Kari,\\n\\nHere it is\."; attached plan\.pdf \(12345 bytes\); in reply to "Ferry plan" \(all of it: ctx_read (p\d+)\)/);
  const entry = /ctx_read (p\d+)/.exec(told)![1];
  const all = JSON.parse((await call('ctx_read', { ref: `ctx:${entry}` })).text).value;
  assert.deepEqual([all.outcome, all.subject, all.body, all.attachments], ['sent', 'Re: Ferry plan, as agreed', 'Hi Kari,\n\nHere it is.', [{ path: 'plan.pdf', name: 'plan.pdf', size: 12_345 }]]);
  assert.equal(ui.delta(), ''); // once
  assert.equal(event('edit', 'send', { fields: sendNow }), false); // sent: read-only
  assert.equal(sends.length, 1);
  await show('edit', REPLY); // the model's showing anew is a new draft, as the model wrote it
  assert.deepEqual([drawn('edit').state, drawn('edit').fields.subject], ['draft', 'Re: Ferry plan']);
  assert.notEqual(ui.checkpoint().drafts!.find(d => d.view === 'edit')!.id, sent.id);
});

test('failed says why and may be sent again; unknown, or a host that throws, may not have arrived; each told once', async () => {
  await show('fails', { to: 'kari@fjord.example', subject: 'Plan', body: 'Here.' });
  ui.delta();
  const fields = edits({ to: ['kari@fjord.example'], cc: [], subject: 'Plan', body: 'Here.', attachments: [] });
  answer = async () => ({ outcome: 'failed', reason: 'mailbox full' });
  assert.equal(event('fails', 'send', { fields }), true);
  await until(() => drawn('fails').state === 'failed');
  assert.equal(drawn('fails').reason, 'mailbox full');
  const failed = ui.delta();
  assert.match(failed, /Kari \(main\) pressed Send on the mail drafted in "Mail fails" \(draft\), and the host could not send it: it did not go, and the person may change it and send it again; as it was sent: to kari@fjord\.example; subject "Plan"/);
  assert.ok(!failed.includes('mailbox full')); // the person's reason, shown in the window, never the model's
  assert.equal(ui.delta(), '');
  answer = async () => ({ outcome: 'unknown' });
  assert.equal(event('fails', 'send', { fields: { ...fields, subject: 'Plan (again)' } }), true); // after failed, again
  await until(() => drawn('fails').state === 'unknown');
  assert.match(ui.delta(), /and the host cannot say whether it went: it may not have arrived, and the person checks before sending it again; as it was sent: to kari@fjord\.example; subject "Plan \(again\)"/);
  answer = async () => { throw new Error('connection reset'); };
  assert.equal(event('fails', 'send', { fields }), true); // after unknown, again
  await until(() => drawn('fails').rev === 6);
  assert.deepEqual([drawn('fails').state, drawn('fails').reason], ['unknown', 'connection reset']);
  const thrown = ui.delta();
  assert.match(thrown, /the host cannot say whether it went: it may not have arrived/);
  assert.ok(!thrown.includes('connection reset'));
  const ids = sends.slice(-3).map(s => s.id);
  assert.equal(new Set(ids).size, 1); // the same draft each time
  answer = async () => ({ outcome: 'sent' });
});

test('the model hears the host\'s forModel and never its reason; without forModel, Vindu\'s words alone; forModel is bounded and cleaned', async () => {
  await show('heard', { to: 'kari@fjord.example', subject: 'Plan', body: 'Here.' });
  ui.delta();
  const fields = edits({ to: ['kari@fjord.example'], cc: [], subject: 'Plan', body: 'Here.', attachments: [] });
  answer = async () => ({ outcome: 'failed', reason: 'PERSON-ONLY: quota of 5 GB used', forModel: `  The mailbox\n is\u0007 full\u200b\t(quota).  ${'x'.repeat(600)}` });
  assert.equal(event('heard', 'send', { fields }), true);
  await until(() => drawn('heard').state === 'failed');
  assert.equal(drawn('heard').reason, 'PERSON-ONLY: quota of 5 GB used'); // the person's, in the window
  const failed = ui.delta(5000);
  assert.match(failed, /and the host could not send it: it did not go, and the person may change it and send it again; the host says: "The mailbox is full \(quota\)\. x+"; as it was sent: to kari@fjord\.example/);
  const says = JSON.parse(/the host says: ("[^"]*")/.exec(failed)![1]) as string;
  assert.deepEqual([says, says.length], [`The mailbox is full (quota). ${'x'.repeat(471)}`, 500]); // plain, trimmed, and bounded
  const entry = /ctx_read (p\d+)/.exec(failed)![1];
  const all = JSON.parse((await call('ctx_read', { ref: `ctx:${entry}` })).text).value;
  assert.deepEqual([all.outcome, all.host_says, Object.hasOwn(all, 'reason')], ['failed', says, false]);
  answer = async () => ({ outcome: 'unknown', reason: 'PERSON-ONLY: the server timed out' });
  assert.equal(event('heard', 'send', { fields }), true);
  await until(() => drawn('heard').state === 'unknown');
  const unknown = ui.delta(5000);
  assert.match(unknown, /and the host cannot say whether it went: it may not have arrived, and the person checks before sending it again; as it was sent: to kari@fjord\.example/);
  const sentWith = async (r: unknown) => {
    answer = async () => r as SendResult;
    const rev = drawn('heard').rev;
    assert.equal(event('heard', 'send', { fields }), true);
    await until(() => drawn('heard').rev === rev + 2);
    return ui.delta(5000);
  };
  const blank = await sentWith({ outcome: 'unknown', forModel: '\u0000\u200b \n\t' }); // nothing in it is text
  const notText = await sentWith({ outcome: 'sent', forModel: 42 });
  assert.match(notText, /and the host sent it; as it was sent: to kari@fjord\.example/);
  for (const told of [failed, unknown, blank, notText]) assert.ok(!told.includes('PERSON-ONLY'));
  for (const told of [unknown, blank, notText]) assert.ok(!told.includes('the host says'));
  for (const told of [(await call('read_view', { view: 'heard' })).text, (await call('look', {})).text, JSON.stringify(all)]) assert.ok(!told.includes('PERSON-ONLY'));
  answer = async () => ({ outcome: 'sent' });
});

test('settleDraft settles a send that ended unknown, as the person learned it: failed shows why and may go again, sent locks; the model told once; refused otherwise', async () => {
  await show('settle', { to: 'kari@fjord.example', subject: 'Settle', body: 'Did it go?' });
  await show('untried', { to: 'ola@fjord.example', subject: 'Not sent', body: 'Hi' });
  ui.delta();
  const idOf = (view: string) => ui.checkpoint().drafts!.find(d => d.view === view)!.id;
  const fields = edits({ to: ['kari@fjord.example'], cc: [], subject: 'Settle', body: 'Did it go?', attachments: [] });
  assert.equal(ui.settleDraft(idOf('untried'), 'sent'), false); // never sent
  assert.equal(ui.settleDraft('no-such-draft', 'sent'), false);
  let resolve!: (r: SendResult) => void;
  answer = () => new Promise(r => { resolve = r; });
  assert.equal(event('settle', 'send', { fields }), true);
  await until(() => drawn('settle').state === 'sending');
  assert.equal(ui.settleDraft(idOf('settle'), 'sent'), false); // under way: the host's answer settles it
  resolve({ outcome: 'unknown', reason: 'PERSON-ONLY: timed out' });
  await until(() => drawn('settle').state === 'unknown');
  ui.delta();
  assert.equal(ui.settleDraft(idOf('settle'), 'unknown' as 'sent'), false); // sent or failed alone
  assert.equal(ui.settleDraft(idOf('settle'), 'failed', 'PERSON-ONLY: it bounced', '  It bounced:\u0007 no such address. '), true);
  assert.deepEqual([drawn('settle').state, drawn('settle').reason], ['failed', 'PERSON-ONLY: it bounced']); // drawn again, with the person's reason
  const failed = ui.delta(5000);
  assert.match(failed, /the mail the person sent from "Mail settle" \(draft\), of which the host could not say whether it went: the host now says it did not go: the person may change it and send it again; the host says: "It bounced: no such address\."; as it was sent: to kari@fjord\.example; subject "Settle"/);
  assert.equal(ui.delta(), ''); // once
  assert.equal(ui.settleDraft(idOf('settle'), 'sent'), false); // settled already
  answer = async () => ({ outcome: 'unknown' });
  assert.equal(event('settle', 'send', { fields: { ...fields, subject: 'Settle, again' } }), true); // it may go again
  await until(() => drawn('settle').state === 'unknown');
  ui.delta();
  assert.equal(ui.settleDraft(idOf('settle'), 'sent', 'PERSON-ONLY: not for a mail that went'), true);
  assert.deepEqual([drawn('settle').state, drawn('settle').reason, drawn('settle').fields.subject], ['sent', undefined, 'Settle, again']);
  const went = ui.delta(5000);
  assert.match(went, /of which the host could not say whether it went: the host now says it went; as it was sent: to kari@fjord\.example; subject "Settle, again"/);
  const entry = /ctx_read (p\d+)/.exec(went)![1];
  const all = JSON.parse((await call('ctx_read', { ref: `ctx:${entry}` })).text).value;
  assert.deepEqual([all.outcome, all.subject, Object.hasOwn(all, 'reason')], ['sent', 'Settle, again', false]);
  for (const told of [failed, went, JSON.stringify(all)]) assert.ok(!told.includes('PERSON-ONLY'));
  assert.ok(!went.includes('the host says'));
  assert.equal(ui.delta(), '');
  assert.equal(ui.settleDraft(idOf('settle'), 'failed', 'too late'), false); // sent: read-only
  assert.equal(event('settle', 'send', { fields }), false);
  answer = async () => ({ outcome: 'sent' });
});

test('in_reply_to.ref is the host\'s: kept through edits and the checkpoint, handed back with the mail sent, and never told to the model or drawn', async () => {
  const REF = 'host-thread-7f3a<msg-41@fjord.example>';
  const a = await show('threaded', { ...REPLY, attachments: [], in_reply_to: { ...REPLY.in_reply_to, ref: REF } });
  ui.delta();
  assert.deepEqual(drawn('threaded').original, { from: 'Kari Nordmann <kari@fjord.example>', time: '2026-11-20T09:12:00Z', subject: 'Ferry plan', body: 'Could you send me the plan?' });
  const changed = edits({ subject: 'Re: Ferry plan, threaded', attachments: [] });
  assert.equal(event('threaded', 'edit', { fields: changed }), true);
  const told = [JSON.stringify(a), (await call('read_view', { view: 'threaded' })).text, (await call('look', {})).text, JSON.stringify(shown)];
  const sentThere: MessageDraft[] = [], there: Shown[] = [];
  const restored = vindu.open({ results: memoryResults(tmp('draft-ref-')), dir: tmp('draft-ref-'), work }, { onView: v => there.push(v), onSendMessage: async d => { sentThere.push(d); return { outcome: 'sent' }; } });
  try {
    assert.deepEqual(await restored.restore(JSON.parse(JSON.stringify(ui.checkpoint()))), []); // as a host keeps it
    const d = drawn('threaded', 'draft', there);
    assert.deepEqual(d.fields, changed);
    assert.equal(restored.event({ type: 'message', action: 'send', view: 'threaded', panel: 'draft', token: d.token, fields: changed, by: person }), true);
    await until(() => drawn('threaded', 'draft', there).state === 'sent');
    assert.deepEqual([sentThere[0].in_reply_to?.ref, sentThere[0].subject], [REF, 'Re: Ferry plan, threaded']);
    told.push(JSON.stringify(there), restored.delta(5000));
  } finally { restored.close(); }
  assert.equal(event('threaded', 'send', { fields: changed }), true);
  await until(() => drawn('threaded').state === 'sent');
  assert.deepEqual([sends.at(-1)!.in_reply_to?.ref, sends.at(-1)!.in_reply_to?.subject], [REF, 'Ferry plan']);
  const heard = ui.delta(5000);
  assert.match(heard, /in reply to "Ferry plan"/);
  const entry = /ctx_read (p\d+)/.exec(heard)![1];
  told.push(heard, (await call('ctx_read', { ref: `ctx:${entry}` })).text, (await call('read_view', { view: 'threaded' })).text, JSON.stringify(shown));
  for (const t of told) assert.ok(!t.includes('host-thread-7f3a'), t.slice(0, 120));
  const bad = (await call('show_view', { name: 'refs', title: 'Refs', panels: [
    { id: 'number', card: 'message', layout: 'draft', data: { to: 'kari@fjord.example', body: 'Hi', in_reply_to: { subject: 'Plan', ref: 41 } } },
    { id: 'long', card: 'message', layout: 'draft', data: { to: 'kari@fjord.example', body: 'Hi', in_reply_to: { subject: 'Plan', ref: 'r'.repeat(501) } } },
  ] })).text;
  assert.match(bad, /panel number: a draft needs a change: in_reply_to\.ref: the host's reference to the original mail, as a string, exactly as a result gave it/);
  assert.match(bad, /panel long: a draft needs a change: in_reply_to\.ref: 501 characters; at most 500/);
});

test('a window started from a snapshot gets each draft back as restore does: a sent one sent and locked under its id, one under way as unknown', async () => {
  await show('went', { to: 'kari@fjord.example', subject: 'Went', body: 'Sent before.' });
  await show('going', { to: 'kari@fjord.example', subject: 'Going', body: 'Under way.' });
  ui.delta();
  const fieldsOf = (subject: string, body: string) => edits({ to: ['kari@fjord.example'], cc: [], subject, body, attachments: [] });
  assert.equal(event('went', 'send', { fields: fieldsOf('Went', 'Sent before.') }), true);
  await until(() => drawn('went').state === 'sent');
  let resolve!: (r: SendResult) => void;
  answer = () => new Promise(r => { resolve = r; });
  assert.equal(event('going', 'send', { fields: fieldsOf('Going, as sent', 'Under way.') }), true);
  await until(() => drawn('going').state === 'sending');
  ui.delta();
  const snap = JSON.parse(JSON.stringify(ui.snapshot())) as ViewSnapshot; // as a host keeps it
  const was = (view: string) => snap.drafts!.find(d => d.view === view)!;
  assert.deepEqual([was('went').state, was('going').state], ['sent', 'unknown']);
  const here: Shown[] = [], next = vindu.open({ results: memoryResults(tmp('draft-from-')), dir: tmp('draft-from-'), work }, { onView: v => here.push(v), onSendMessage: async d => { sends.push(d); return { outcome: 'sent' }; } });
  try {
    const started = await next.startFrom(snap, {});
    assert.ok(started.shown.includes('went') && started.shown.includes('going'));
    const id = (view: string) => next.checkpoint().drafts!.find(d => d.view === view)!.id;
    const look = (view: string) => drawn(view, 'draft', here);
    assert.deepEqual([look('went').state, look('went').fields.subject, id('went')], ['sent', 'Went', was('went').id]);
    assert.deepEqual([look('going').state, look('going').fields.subject, id('going')], ['unknown', 'Going, as sent', was('going').id]);
    const at = (view: string) => ({ type: 'message', view, panel: 'draft', token: look(view).token, by: person });
    const count = sends.length;
    assert.equal(next.event({ ...at('went'), action: 'send', fields: fieldsOf('Went', 'Again?') }), false); // sent: read-only
    assert.equal(next.event({ ...at('went'), action: 'edit', fields: fieldsOf('Went', 'Again?') }), false);
    assert.equal(next.settleDraft(id('going'), 'sent'), true); // unknown there too, for the host to settle
    assert.equal(look('going').state, 'sent');
    await sleep(50);
    assert.equal(sends.length, count); // nothing went again
    assert.throws(() => next.startFrom({ ...snap, drafts: [{ view: 'went', panel: 'draft', id: 'x', state: 'sending' }] as never }, {}), /Not a view snapshot: its drafts/);
  } finally { next.close(); }
  resolve({ outcome: 'unknown' });
  await until(() => drawn('going').state === 'unknown');
  answer = async () => ({ outcome: 'sent' });
});

test('a host that cannot send says so ahead: its own action in place of Send, run on the person\'s click, and drawn again when that changes', async () => {
  let connected = false; const actions: unknown[] = [], sentHere: MessageDraft[] = [], here: Shown[] = [];
  const other = vindu.open({ results: memoryResults(tmp('draft-host-')), dir: tmp('draft-host-'), work }, {
    onView: v => here.push(v), messageSending: () => (connected ? true : { action: '  Connect   mail ' }),
    onMessageAction: a => actions.push(a), onSendMessage: async d => { sentHere.push(d); return { outcome: 'sent' }; },
  });
  const client = await mcpClient(other.url);
  try {
    const a = JSON.parse((await client.call('show_view', { name: 'later', title: 'Later', panels: [{ id: 'draft', card: 'message', layout: 'draft', data: { to: 'kari@fjord.example', body: 'Hi' } }] })).text);
    assert.match(a.panels[0].send, /this window cannot send mail yet: in place of Send it offers the host's own "Connect mail"; the person may copy it/);
    const look = () => (here.at(-1)!.wide.find(m => 'updateDataModel' in m) as any).updateDataModel.value.panels.p_draft.props.draft;
    assert.deepEqual(look().sending, { action: 'Connect mail' });
    const at = { type: 'message', view: 'later', panel: 'draft', token: look().token, by: person };
    assert.equal(other.event({ ...at, action: 'send', fields: edits({ to: ['kari@fjord.example'], cc: [], attachments: [] }) }), false); // no Send here yet
    assert.equal(other.event({ ...at, action: 'host' }), true);
    assert.deepEqual(actions, [{ id: other.checkpoint().drafts![0].id, view: 'later', panel: 'draft', by: person }]);
    connected = true; other.messagesChanged();
    await until(() => look().sending === 'send');
    assert.equal(other.event({ ...at, action: 'host' }), false);
    assert.equal(other.event({ ...at, action: 'send', fields: edits({ to: ['kari@fjord.example'], cc: [], attachments: [] }) }), true);
    await until(() => sentHere.length === 1);
  } finally { await client.mcp.close(); other.close(); }
});

test('the example\'s host: a reply with the mail it answers and a file attached, which its onSendMessage says went, after a moment, sending nothing', async () => {
  const here: Shown[] = [];
  const desk = await startMailDesk({ dir: tmp('draft-desk-'), work: tmp('draft-desk-work-'), onView: v => here.push(v) });
  try {
    const d = drawn('reply', 'draft', here);
    assert.deepEqual([d.state, d.sending, d.files], ['draft', 'send', [{ path: 'timetable.csv', rel: 'timetable.csv', name: 'timetable.csv', size: 53 }]]);
    assert.equal(desk.ui.event({ type: 'message', action: 'send', view: 'reply', panel: 'draft', token: d.token, fields: d.fields, by: person }), true);
    await until(() => drawn('reply', 'draft', here).state === 'sent');
    assert.deepEqual([desk.sent.length, desk.sent[0].in_reply_to?.subject, desk.sent[0].attachments], [1, 'Ferry timetable for Thursday', [{ path: 'timetable.csv', name: 'timetable.csv', size: 53 }]]);
    assert.match(desk.ui.delta(), /pressed Send on the mail drafted in "Reply to Kari" \(draft\), and the host sent it/);
  } finally { await desk.close(); }
});
