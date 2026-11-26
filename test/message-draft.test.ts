// A mail drafted for the person to send, over real MCP: a message block's draft, its fields and the files it attaches
// read by the system, each limit refused with its own reason, its account, and the instruction the model is given.
// Send is the person's alone: no tool of the model's and no event without the window's token reaches the host, and the
// model is told each outcome once, with the fields as they were sent, and nothing of the person's edits. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { memoryResults, VIEW_WORDS_NB, startVindu, type SendResult, type Shown } from '../src/index.js';
import { mcpClient, schemaOf, sleep } from './helpers.js';
import { draftSession, tmp, until, REPLY, person, edits } from './message-draft-session.js';

let answer: () => Promise<SendResult> = async () => ({ outcome: 'sent' }); // how the host answers the next send
const { work, sends, vindu, ui, mcp, json, call, drawn, show, event } = await draftSession(() => answer());

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
  assert.deepEqual(d.files.map(f => [f.path, f.name, f.size]), [['plan.pdf', 'plan.pdf', 12_345], ['map.png', 'map.png', 2_048]]);
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
  const card = schemaOf(showView).properties.panels.items.properties.card.description;
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
  assert.deepEqual([acted.view.panels[0].draft.subject, acted.view.panels[0].draft.attachments.map((f: { path: string; size: number }) => [f.path, f.size])], ['Re: Ferry plan', [['plan.pdf', 12_345], ['map.png', 2_048]]]);
  assert.ok(!JSON.stringify(acted).includes('as agreed'));
  assert.deepEqual(drawn('edit').fields, changed);
  assert.equal(event('edit', 'edit', { fields: { ...changed, attachments: ['plan.pdf', 'secret.key'] } }), false); // only the files the model attached
  assert.equal(event('edit', 'edit', { fields: { ...changed, body: 'b'.repeat(100_001) } }), false);
  await ui.setViewWords(VIEW_WORDS_NB); // a redraw by the system keeps them
  assert.deepEqual(drawn('edit').fields, changed); assert.deepEqual(drawn('edit').files.map(f => f.path), ['plan.pdf']);
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
