// What the host says of a send, over real MCP: the model hears the host's forModel and never its reason; a send that
// ended unknown is settled as the person learned it; the host's own reference to the mail answered is kept for it; a
// window started from a snapshot gets each draft back; a host that cannot send offers its own action; and the example's
// host. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { memoryResults, type SendResult, type Shown, type ViewSnapshot, type MessageDraft } from '../src/index.js';
import { startMailDesk } from '../examples/mail-draft.js';
import { mcpClient, sleep, panelsIn } from './helpers.js';
import { draftSession, tmp, until, REPLY, person, edits, type Drawn } from './message-draft-session.js';

let answer: () => Promise<SendResult> = async () => ({ outcome: 'sent' }); // how the host answers the next send
const { work, sends, vindu, shown, ui, call, drawn, show, event } = await draftSession(() => answer());

test("the model hears the host's forModel and never its reason; without forModel, Vindu's words alone; forModel is bounded and cleaned", async () => {
  await show('heard', { to: 'kari@fjord.example', subject: 'Plan', body: 'Here.' });
  ui.delta();
  const fields = edits({ to: ['kari@fjord.example'], cc: [], subject: 'Plan', body: 'Here.', attachments: [] });
  answer = async () => ({
    outcome: 'failed',
    reason: 'PERSON-ONLY: quota of 5 GB used',
    forModel: `  The mailbox\n is\u0007 full\u200b\t(quota).  ${'x'.repeat(600)}`,
  });
  assert.equal(event('heard', 'send', { fields }), true);
  await until(() => drawn('heard').state === 'failed');
  assert.equal(drawn('heard').reason, 'PERSON-ONLY: quota of 5 GB used'); // the person's, in the window
  const failed = ui.delta(5000);
  assert.match(
    failed,
    /and the host could not send it: it did not go, and the person may change it and send it again; the host says: "The mailbox is full \(quota\)\. x+"; as it was sent: to kari@fjord\.example/,
  );
  const says = JSON.parse(/the host says: ("[^"]*")/.exec(failed)![1]) as string;
  assert.deepEqual([says, says.length], [`The mailbox is full (quota). ${'x'.repeat(471)}`, 500]); // plain, trimmed, and bounded
  const entry = /ctx_read (p\d+)/.exec(failed)![1];
  const all = JSON.parse((await call('ctx_read', { ref: `ctx:${entry}` })).text).value;
  assert.deepEqual([all.outcome, all.host_says, Object.hasOwn(all, 'reason')], ['failed', says, false]);
  answer = async () => ({ outcome: 'unknown', reason: 'PERSON-ONLY: the server timed out' });
  assert.equal(event('heard', 'send', { fields }), true);
  await until(() => drawn('heard').state === 'unknown');
  const unknown = ui.delta(5000);
  assert.match(
    unknown,
    /and the host cannot say whether it went: it may not have arrived, and the person checks before sending it again; as it was sent: to kari@fjord\.example/,
  );
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
  for (const told of [
    (await call('read_view', { view: 'heard' })).text,
    (await call('look', {})).text,
    JSON.stringify(all),
  ])
    assert.ok(!told.includes('PERSON-ONLY'));
  answer = async () => ({ outcome: 'sent' });
});

test('settleDraft settles a send that ended unknown, as the person learned it: failed shows why and may go again, sent locks; the model told once; refused otherwise', async () => {
  await show('settle', { to: 'kari@fjord.example', subject: 'Settle', body: 'Did it go?' });
  await show('untried', { to: 'ola@fjord.example', subject: 'Not sent', body: 'Hi' });
  ui.delta();
  const idOf = (view: string) => ui.checkpoint().drafts!.find((d) => d.view === view)!.id;
  const fields = edits({ to: ['kari@fjord.example'], cc: [], subject: 'Settle', body: 'Did it go?', attachments: [] });
  assert.equal(ui.settleDraft(idOf('untried'), 'sent'), false); // never sent
  assert.equal(ui.settleDraft('no-such-draft', 'sent'), false);
  let resolve!: (r: SendResult) => void;
  answer = () =>
    new Promise((r) => {
      resolve = r;
    });
  assert.equal(event('settle', 'send', { fields }), true);
  await until(() => drawn('settle').state === 'sending');
  assert.equal(ui.settleDraft(idOf('settle'), 'sent'), false); // under way: the host's answer settles it
  resolve({ outcome: 'unknown', reason: 'PERSON-ONLY: timed out' });
  await until(() => drawn('settle').state === 'unknown');
  ui.delta();
  assert.equal(ui.settleDraft(idOf('settle'), 'unknown' as 'sent'), false); // sent or failed alone
  assert.equal(
    ui.settleDraft(idOf('settle'), 'failed', 'PERSON-ONLY: it bounced', '  It bounced:\u0007 no such address. '),
    true,
  );
  assert.deepEqual([drawn('settle').state, drawn('settle').reason], ['failed', 'PERSON-ONLY: it bounced']); // drawn again, with the person's reason
  const failed = ui.delta(5000);
  assert.match(
    failed,
    /the mail the person sent from "Mail settle" \(draft\), of which the host could not say whether it went: the host now says it did not go: the person may change it and send it again; the host says: "It bounced: no such address\."; as it was sent: to kari@fjord\.example; subject "Settle"/,
  );
  assert.equal(ui.delta(), ''); // once
  assert.equal(ui.settleDraft(idOf('settle'), 'sent'), false); // settled already
  answer = async () => ({ outcome: 'unknown' });
  assert.equal(event('settle', 'send', { fields: { ...fields, subject: 'Settle, again' } }), true); // it may go again
  await until(() => drawn('settle').state === 'unknown');
  ui.delta();
  assert.equal(ui.settleDraft(idOf('settle'), 'sent', 'PERSON-ONLY: not for a mail that went'), true);
  assert.deepEqual(
    [drawn('settle').state, drawn('settle').reason, drawn('settle').fields.subject],
    ['sent', undefined, 'Settle, again'],
  );
  const went = ui.delta(5000);
  assert.match(
    went,
    /of which the host could not say whether it went: the host now says it went; as it was sent: to kari@fjord\.example; subject "Settle, again"/,
  );
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

test("in_reply_to.ref is the host's: kept through edits and the checkpoint, handed back with the mail sent, and never told to the model or drawn", async () => {
  const REF = 'host-thread-7f3a<msg-41@fjord.example>';
  const a = await show('threaded', { ...REPLY, attachments: [], in_reply_to: { ...REPLY.in_reply_to, ref: REF } });
  ui.delta();
  assert.deepEqual(drawn('threaded').original, {
    from: 'Kari Nordmann <kari@fjord.example>',
    time: '2026-11-20T09:12:00Z',
    subject: 'Ferry plan',
    body: 'Could you send me the plan?',
  });
  const changed = edits({ subject: 'Re: Ferry plan, threaded', attachments: [] });
  assert.equal(event('threaded', 'edit', { fields: changed }), true);
  const told = [
    JSON.stringify(a),
    (await call('read_view', { view: 'threaded' })).text,
    (await call('look', {})).text,
    JSON.stringify(shown),
  ];
  const sentThere: MessageDraft[] = [],
    there: Shown[] = [];
  const restored = vindu.open(
    { results: memoryResults(tmp('draft-ref-')), dir: tmp('draft-ref-'), work },
    {
      onView: (v) => there.push(v),
      onSendMessage: async (d) => {
        sentThere.push(d);
        return { outcome: 'sent' };
      },
    },
  );
  try {
    assert.deepEqual(await restored.restore(JSON.parse(JSON.stringify(ui.checkpoint()))), []); // as a host keeps it
    const d = drawn('threaded', 'draft', there);
    assert.deepEqual(d.fields, changed);
    assert.equal(
      restored.event({
        type: 'message',
        action: 'send',
        view: 'threaded',
        panel: 'draft',
        token: d.token,
        fields: changed,
        by: person,
      }),
      true,
    );
    await until(() => drawn('threaded', 'draft', there).state === 'sent');
    assert.deepEqual([sentThere[0].in_reply_to?.ref, sentThere[0].subject], [REF, 'Re: Ferry plan, threaded']);
    told.push(JSON.stringify(there), restored.delta(5000));
  } finally {
    restored.close();
  }
  assert.equal(event('threaded', 'send', { fields: changed }), true);
  await until(() => drawn('threaded').state === 'sent');
  assert.deepEqual([sends.at(-1)!.in_reply_to?.ref, sends.at(-1)!.in_reply_to?.subject], [REF, 'Ferry plan']);
  const heard = ui.delta(5000);
  assert.match(heard, /in reply to "Ferry plan"/);
  const entry = /ctx_read (p\d+)/.exec(heard)![1];
  told.push(
    heard,
    (await call('ctx_read', { ref: `ctx:${entry}` })).text,
    (await call('read_view', { view: 'threaded' })).text,
    JSON.stringify(shown),
  );
  for (const t of told) assert.ok(!t.includes('host-thread-7f3a'), t.slice(0, 120));
  const bad = (
    await call('show_view', {
      name: 'refs',
      title: 'Refs',
      panels: [
        {
          id: 'number',
          card: 'message',
          layout: 'draft',
          data: { to: 'kari@fjord.example', body: 'Hi', in_reply_to: { subject: 'Plan', ref: 41 } },
        },
        {
          id: 'long',
          card: 'message',
          layout: 'draft',
          data: { to: 'kari@fjord.example', body: 'Hi', in_reply_to: { subject: 'Plan', ref: 'r'.repeat(501) } },
        },
      ],
    })
  ).text;
  assert.match(
    bad,
    /panel number: a draft needs a change: in_reply_to\.ref: the host's reference to the original mail, as a string, exactly as a result gave it/,
  );
  assert.match(bad, /panel long: a draft needs a change: in_reply_to\.ref: 501 characters; at most 500/);
});

test('a window started from a snapshot gets each draft back as restore does: a sent one sent and locked under its id, one under way as unknown', async () => {
  await show('went', { to: 'kari@fjord.example', subject: 'Went', body: 'Sent before.' });
  await show('going', { to: 'kari@fjord.example', subject: 'Going', body: 'Under way.' });
  ui.delta();
  const fieldsOf = (subject: string, body: string) =>
    edits({ to: ['kari@fjord.example'], cc: [], subject, body, attachments: [] });
  assert.equal(event('went', 'send', { fields: fieldsOf('Went', 'Sent before.') }), true);
  await until(() => drawn('went').state === 'sent');
  let resolve!: (r: SendResult) => void;
  answer = () =>
    new Promise((r) => {
      resolve = r;
    });
  assert.equal(event('going', 'send', { fields: fieldsOf('Going, as sent', 'Under way.') }), true);
  await until(() => drawn('going').state === 'sending');
  ui.delta();
  const snap = JSON.parse(JSON.stringify(ui.snapshot())) as ViewSnapshot; // as a host keeps it
  const was = (view: string) => snap.drafts!.find((d) => d.view === view)!;
  assert.deepEqual([was('went').state, was('going').state], ['sent', 'unknown']);
  const here: Shown[] = [],
    next = vindu.open(
      { results: memoryResults(tmp('draft-from-')), dir: tmp('draft-from-'), work },
      {
        onView: (v) => here.push(v),
        onSendMessage: async (d) => {
          sends.push(d);
          return { outcome: 'sent' };
        },
      },
    );
  try {
    const started = await next.startFrom(snap, {});
    assert.ok(started.shown.includes('went') && started.shown.includes('going'));
    const id = (view: string) => next.checkpoint().drafts!.find((d) => d.view === view)!.id;
    const look = (view: string) => drawn(view, 'draft', here);
    assert.deepEqual([look('went').state, look('went').fields.subject, id('went')], ['sent', 'Went', was('went').id]);
    assert.deepEqual(
      [look('going').state, look('going').fields.subject, id('going')],
      ['unknown', 'Going, as sent', was('going').id],
    );
    const at = (view: string) => ({ type: 'message', view, panel: 'draft', token: look(view).token, by: person });
    const count = sends.length;
    assert.equal(next.event({ ...at('went'), action: 'send', fields: fieldsOf('Went', 'Again?') }), false); // sent: read-only
    assert.equal(next.event({ ...at('went'), action: 'edit', fields: fieldsOf('Went', 'Again?') }), false);
    assert.equal(next.settleDraft(id('going'), 'sent'), true); // unknown there too, for the host to settle
    assert.equal(look('going').state, 'sent');
    await sleep(50);
    assert.equal(sends.length, count); // nothing went again
    assert.throws(
      () =>
        next.startFrom({ ...snap, drafts: [{ view: 'went', panel: 'draft', id: 'x', state: 'sending' }] as never }, {}),
      /Not a view snapshot: its drafts/,
    );
  } finally {
    next.close();
  }
  resolve({ outcome: 'unknown' });
  await until(() => drawn('going').state === 'unknown');
  answer = async () => ({ outcome: 'sent' });
});

test("a host that cannot send says so ahead: its own action in place of Send, run on the person's click, and drawn again when that changes", async () => {
  let connected = false;
  const actions: unknown[] = [],
    sentHere: MessageDraft[] = [],
    here: Shown[] = [];
  const other = vindu.open(
    { results: memoryResults(tmp('draft-host-')), dir: tmp('draft-host-'), work },
    {
      onView: (v) => here.push(v),
      messageSending: () => (connected ? true : { action: '  Connect   mail ' }),
      onMessageAction: (a) => actions.push(a),
      onSendMessage: async (d) => {
        sentHere.push(d);
        return { outcome: 'sent' };
      },
    },
  );
  const client = await mcpClient(other.url);
  try {
    const a = JSON.parse(
      (
        await client.call('show_view', {
          name: 'later',
          title: 'Later',
          panels: [{ id: 'draft', card: 'message', layout: 'draft', data: { to: 'kari@fjord.example', body: 'Hi' } }],
        })
      ).text,
    );
    assert.match(
      a.panels[0].send,
      /this window cannot send mail yet: in place of Send it offers the host's own "Connect mail"; the person may copy it/,
    );
    const look = () => panelsIn<{ props: { draft: Drawn } }>(here.at(-1)!.wide).p_draft.props.draft;
    assert.deepEqual(look().sending, { action: 'Connect mail' });
    const at = { type: 'message', view: 'later', panel: 'draft', token: look().token, by: person };
    assert.equal(
      other.event({ ...at, action: 'send', fields: edits({ to: ['kari@fjord.example'], cc: [], attachments: [] }) }),
      false,
    ); // no Send here yet
    assert.equal(other.event({ ...at, action: 'host' }), true);
    assert.deepEqual(actions, [{ id: other.checkpoint().drafts![0].id, view: 'later', panel: 'draft', by: person }]);
    connected = true;
    other.messagesChanged();
    await until(() => look().sending === 'send');
    assert.equal(other.event({ ...at, action: 'host' }), false);
    assert.equal(
      other.event({ ...at, action: 'send', fields: edits({ to: ['kari@fjord.example'], cc: [], attachments: [] }) }),
      true,
    );
    await until(() => sentHere.length === 1);
  } finally {
    await client.mcp.close();
    other.close();
  }
});

test("the example's host: a reply with the mail it answers and a file attached, which its onSendMessage says went, after a moment, sending nothing", async () => {
  const here: Shown[] = [];
  const desk = await startMailDesk({
    dir: tmp('draft-desk-'),
    work: tmp('draft-desk-work-'),
    onView: (v) => here.push(v),
  });
  try {
    const d = drawn('reply', 'draft', here);
    assert.deepEqual(
      [d.state, d.sending, d.files],
      ['draft', 'send', [{ path: 'timetable.csv', rel: 'timetable.csv', name: 'timetable.csv', size: 53 }]],
    );
    assert.equal(
      desk.ui.event({
        type: 'message',
        action: 'send',
        view: 'reply',
        panel: 'draft',
        token: d.token,
        fields: d.fields,
        by: person,
      }),
      true,
    );
    await until(() => drawn('reply', 'draft', here).state === 'sent');
    assert.deepEqual(
      [desk.sent.length, desk.sent[0].in_reply_to?.subject, desk.sent[0].attachments],
      [1, 'Ferry timetable for Thursday', [{ path: 'timetable.csv', name: 'timetable.csv', size: 53 }]],
    );
    assert.match(
      desk.ui.delta(),
      /pressed Send on the mail drafted in "Reply to Kari" \(draft\), and the host sent it/,
    );
  } finally {
    await desk.close();
  }
});
