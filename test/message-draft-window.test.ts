// A mail drafted for the person to send, drawn in Chromium through the fixtures' shell, with the window's events carried
// to the UI server as a host carries them: the person changes the subject, the body and the files, and presses Send;
// the host gets the mail as they see it, the draft says "Sending…", then "Sent", and locks. A send that failed says why
// and may go again; one that may not have arrived says so, until the host settles it. A host that cannot send yet
// offers its own action in place of Send, and Copy puts the whole mail on the clipboard. The host's ref to the mail
// replied to is never drawn. Drawn in Bokmål and Nynorsk too. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  startVindu,
  memoryResults,
  VIEW_WORDS_NB,
  VIEW_WORDS_NN,
  bytesIn,
  whenIn,
  type MessageDraft,
  type SendResult,
  type Shown,
  type ShellState,
} from '../src/index.js';
import { chromium, mcpClient, sleep, type Row } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const settle = async (f: () => boolean | Promise<boolean>, what: string, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(25);
  }
};
const dir = tmp('draft-window-'),
  work = tmp('draft-window-work-');
fs.writeFileSync(path.join(work, 'plan.pdf'), Buffer.alloc(12_345, 1));
fs.writeFileSync(path.join(work, 'map.png'), Buffer.alloc(2_048, 2));
const REPLY = {
  to: ['Kari Nordmann <kari@fjord.example>'],
  cc: 'ola@fjord.example',
  subject: 'Re: Ferry plan',
  format: 'markdown',
  body: 'Hi Kari,\n\nThe **plan** is attached.',
  in_reply_to: {
    from: { name: 'Kari Nordmann', email: 'kari@fjord.example' },
    time: '2026-11-20T09:12:00Z',
    subject: 'Ferry plan',
    body: 'Could you send me the plan?\n\nKari',
    ref: 'host-thread-window-91',
  },
  attachments: ['plan.pdf', 'map.png'],
};
const person = { name: 'Ola', window: 'main' };
const sends: MessageDraft[] = [],
  actions: unknown[] = [];
let answer: () => Promise<SendResult> = async () => ({ outcome: 'sent' });
let sending: true | { action: string } = true;
const vindu = await startVindu({ waitMs: 400, timeZone: 'UTC' });
const shown: Shown[] = [];
let state: ShellState | undefined;
const ui = vindu.open(
  { results: memoryResults(dir), dir, work },
  {
    onView: (v) => shown.push(v),
    onState: (s) => {
      state = s;
    },
    onSendMessage: (d) => {
      sends.push(d);
      return answer();
    },
    messageSending: () => sending,
    onMessageAction: (a) => actions.push(a),
  },
);
const { mcp, json } = await mcpClient(ui.url);

const app = http.createServer((req, res) => {
  const f =
    req.url === '/app.bundle.js'
      ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js')
      : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(`${origin}/shell.html`);
await page.evaluate(() => window.app.shell('light'));
// as a host does: each view the UI server draws goes to the window, and what the person does in a draft comes back with who
let carried = 0,
  stopped = false;
const pump = (async () => {
  while (!stopped) {
    const events: Row[] = await page.evaluate(() => window.app.events()).catch(() => []); // a draft's own actions among them
    for (const e of events) if (e.type === 'message') ui.event({ ...e, by: person });
    while (carried < shown.length)
      await page.evaluate((v: Shown) => window.app.view(v), shown[carried++]).catch(() => undefined);
    await sleep(25);
  }
})();
afterAll(async () => {
  stopped = true;
  await pump;
  await browser.close();
  app.close();
  await mcp.close();
  ui.close();
  await vindu.close();
});

const draftIn = (view: string) => page.locator(`.vindu-pane[data-view="${view}"] .vb-draft`);
const status = (view: string) => draftIn(view).locator('.vb-dstatus').innerText();
const drafted = (view: string) => ui.checkpoint().drafts!.find((d) => d.view === view)!;
/** A draft shown by the model, alone in the window. */
async function shownAlone(view: string, data: Record<string, unknown>) {
  await json('show_view', {
    name: view,
    title: `Mail ${view}`,
    panels: [{ id: 'draft', card: 'message', layout: 'draft', data }],
  });
  await settle(() => carried === shown.length, 'the view in the window');
  await page.evaluate((s: ShellState) => window.app.state(s), { ...state!, tree: { view, size: 1 }, maximized: null });
  await draftIn(view).waitFor();
  return draftIn(view);
}

test('the person edits the subject, the body and the files, and presses Send: the host gets the mail as they see it, "Sending…", then "Sent", and every field locked', async () => {
  const d = await shownAlone('reply', REPLY);
  assert.deepEqual(await d.locator('.vb-dlabel').allInnerTexts(), [
    'To',
    'Cc',
    'Subject',
    'Attachments',
    'In reply to',
  ]);
  assert.deepEqual(await d.locator('.vb-dhead input').evaluateAll((xs: HTMLInputElement[]) => xs.map((x) => x.value)), [
    'Kari Nordmann <kari@fjord.example>',
    'ola@fjord.example',
    'Re: Ferry plan',
  ]);
  assert.equal(await d.locator('.vb-dpreview strong').innerText(), 'plan'); // the Markdown body, drawn as it reads
  assert.deepEqual(await d.locator('.vb-dfile').allInnerTexts(), [
    `plan.pdf · ${bytesIn(12_345)}×`,
    `map.png · ${bytesIn(2_048)}×`,
  ]);
  assert.equal(await d.locator('.vb-dquote blockquote').innerText(), 'Could you send me the plan?\n\nKari');
  assert.match(
    await page.locator('.vindu-pane[data-view="reply"] .vindu-pane-body').innerText(),
    /Written by the model/,
  );
  assert.ok(!(await page.content()).includes('host-thread-window-91')); // the host's, never drawn
  await d.locator('input[data-part="subject"]').fill('Re: Ferry plan, as agreed');
  await d.locator('button', { hasText: 'Edit' }).click();
  assert.equal(await d.locator('textarea[data-part="body"]').inputValue(), REPLY.body);
  await d.locator('textarea[data-part="body"]').fill('Hi Kari,\n\nHere it is, **as agreed**.');
  await d.locator('button', { hasText: 'Preview' }).click();
  assert.equal(await d.locator('.vb-dpreview strong').innerText(), 'as agreed');
  await d.locator('button[aria-label="Remove map.png"]').click();
  assert.deepEqual(await d.locator('.vb-dfile').allInnerTexts(), [`plan.pdf · ${bytesIn(12_345)}×`]);
  await settle(
    () =>
      drafted('reply').edited?.subject === 'Re: Ferry plan, as agreed' &&
      drafted('reply').edited?.attachments.length === 1,
    'the edit at the UI server',
  );
  assert.equal(ui.delta(), ''); // the person's edits are theirs
  let resolve!: (r: SendResult) => void;
  answer = () =>
    new Promise((r) => {
      resolve = r;
    });
  await d.locator('button[data-send]').click();
  await settle(async () => (await status('reply')) === 'Sending…', 'Sending…');
  await settle(() => sends.length === 1, 'the host called');
  assert.deepEqual(
    await d.locator('.vb-dhead input').evaluateAll((xs: HTMLInputElement[]) => xs.map((x) => x.readOnly)),
    [true, true, true],
  );
  assert.equal(await d.locator('button[data-send]').isDisabled(), true);
  const sent = sends[0];
  assert.match(sent.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    [sent.to, sent.cc, sent.subject, sent.body, sent.format, sent.attachments, sent.by],
    [
      ['Kari Nordmann <kari@fjord.example>'],
      ['ola@fjord.example'],
      'Re: Ferry plan, as agreed',
      'Hi Kari,\n\nHere it is, **as agreed**.',
      'markdown',
      [{ path: 'plan.pdf', name: 'plan.pdf', size: 12_345 }],
      person,
    ],
  );
  assert.equal(sent.in_reply_to?.ref, 'host-thread-window-91'); // handed back, for the host to thread the reply
  resolve({ outcome: 'sent' });
  await settle(async () => (await status('reply')) === '✓ Sent', 'Sent');
  assert.deepEqual(
    await d.locator('.vb-dhead input').evaluateAll((xs: HTMLInputElement[]) => xs.map((x) => [x.readOnly, x.value])),
    [
      [true, 'Kari Nordmann <kari@fjord.example>'],
      [true, 'ola@fjord.example'],
      [true, 'Re: Ferry plan, as agreed'],
    ],
  );
  assert.equal(await d.locator('button[data-send], .vb-dremove, .vb-dtools button').count(), 0); // nothing left to change or send
  assert.equal(await d.locator('.vb-dpreview strong').innerText(), 'as agreed');
  assert.match(
    ui.delta(),
    /Ola \(main\) pressed Send on the mail drafted in "Mail reply" \(draft\), and the host sent it; as it was sent: to Kari Nordmann <kari@fjord.example>; cc ola@fjord.example; subject "Re: Ferry plan, as agreed"/,
  );
  assert.equal(ui.delta(), '');
  assert.deepEqual(errors, []);
});

test('a send that failed says why, and may go again after a change; one that may not have arrived says so; a field that is not an address is marked', async () => {
  const d = await shownAlone('again', { to: 'kari@fjord.example', subject: 'Plan', body: 'Here it is.' });
  assert.equal(await d.locator('textarea[data-part="body"]').inputValue(), 'Here it is.'); // plain text: its own text to change
  await d.locator('input[data-part="to"]').fill('kari@');
  assert.equal(await d.locator('input[data-part="to"]').getAttribute('aria-invalid'), 'true');
  assert.equal(await status('again'), 'Check the marked fields');
  assert.equal(await d.locator('button[data-send]').isDisabled(), true);
  await d.locator('input[data-part="to"]').fill('kari@fjord.example, "Nordmann, Per" <per@fjord.example>');
  assert.equal(await d.locator('input[data-part="to"]').getAttribute('aria-invalid'), 'false');
  answer = async () => ({ outcome: 'failed', reason: 'mailbox full' });
  await d.locator('button[data-send]').click();
  await settle(async () => (await status('again')) === 'Failed: mailbox full', 'Failed');
  assert.deepEqual(sends.at(-1)!.to, ['kari@fjord.example', '"Nordmann, Per" <per@fjord.example>']);
  assert.equal(await d.locator('input[data-part="subject"]').evaluate((x: HTMLInputElement) => x.readOnly), false);
  assert.equal(await d.locator('button[data-send]').isDisabled(), false);
  await d.locator('textarea[data-part="body"]').fill('Here it is, again.');
  answer = async () => ({ outcome: 'unknown' });
  await d.locator('button[data-send]').click();
  await settle(
    async () => (await status('again')) === 'It may not have arrived. Check before you send it again.',
    'unknown',
  );
  assert.equal(sends.at(-1)!.body, 'Here it is, again.');
  assert.equal(sends.at(-1)!.id, sends.at(-2)!.id); // the same draft, sent again
  const told = ui.delta(5000);
  assert.match(told, /could not send it: it did not go.*the host cannot say whether it went: it may not have arrived/);
  assert.ok(!told.includes('mailbox full')); // the person's reason, never the model's
  assert.deepEqual(errors, []);
});

test('a send that may not have arrived, settled by the host as the person learned it: failed says why and Send is there again; sent locks every field', async () => {
  answer = async () => ({ outcome: 'unknown' });
  const unknown = 'It may not have arrived. Check before you send it again.';
  const d = await shownAlone('settled', { to: 'kari@fjord.example', subject: 'Settle', body: 'Did it go?' });
  await d.locator('button[data-send]').click();
  await settle(async () => (await status('settled')) === unknown, 'unknown');
  assert.equal(ui.settleDraft(drafted('settled').id, 'failed', 'it bounced'), true);
  await settle(async () => (await status('settled')) === 'Failed: it bounced', 'settled as failed');
  assert.equal(await d.locator('input[data-part="subject"]').evaluate((x: HTMLInputElement) => x.readOnly), false);
  assert.equal(await d.locator('button[data-send]').isDisabled(), false);
  await d.locator('input[data-part="subject"]').fill('Settle, again');
  await d.locator('button[data-send]').click();
  await settle(
    async () => sends.at(-1)!.subject === 'Settle, again' && (await status('settled')) === unknown,
    'unknown again',
  );
  assert.equal(ui.settleDraft(drafted('settled').id, 'sent'), true);
  await settle(async () => (await status('settled')) === '\u2713 Sent', 'settled as sent');
  assert.deepEqual(
    await d.locator('.vb-dhead input').evaluateAll((xs: HTMLInputElement[]) => xs.map((x) => [x.readOnly, x.value])),
    [
      [true, 'kari@fjord.example'],
      [true, ''],
      [true, 'Settle, again'],
    ],
  );
  assert.equal(await d.locator('button[data-send], .vb-dremove, .vb-dtools button').count(), 0);
  assert.equal(ui.settleDraft(drafted('settled').id, 'failed', 'too late'), false); // sent: settled
  assert.match(
    ui.delta(5000),
    /of which the host could not say whether it went: the host now says it did not go.*of which the host could not say whether it went: the host now says it went/,
  );
  answer = async () => ({ outcome: 'sent' });
  assert.deepEqual(errors, []);
});

test('a host that cannot send yet: its own action in place of Send, run on the click; Copy puts the whole mail on the clipboard as plain text', async () => {
  sending = { action: 'Connect mail' };
  const d = await shownAlone('later', REPLY);
  assert.equal(await d.locator('button[data-send]').count(), 0);
  await d.locator('button[data-host-action]', { hasText: 'Connect mail' }).click();
  await settle(() => actions.length === 1, "the host's action");
  assert.deepEqual(actions[0], { id: drafted('later').id, view: 'later', panel: 'draft', by: person });
  await d.locator('button[data-copy]').click();
  await settle(async () => (await d.locator('button[data-copy]').innerText()) === 'Copied', 'Copied');
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    [
      'To: Kari Nordmann <kari@fjord.example>\nCc: ola@fjord.example\nSubject: Re: Ferry plan',
      `Attachments: plan.pdf (${bytesIn(12_345)}), map.png (${bytesIn(2_048)})`,
    ].join('\n') +
      `\n\nHi Kari,\n\nThe **plan** is attached.\n\nIn reply to:\nFrom: Kari Nordmann <kari@fjord.example>\nDate: ${whenIn('2026-11-20T09:12:00Z', 'en-GB', 'UTC')}\nSubject: Ferry plan\n\n> Could you send me the plan?\n>\n> Kari`,
  );
  sending = true;
  ui.messagesChanged(); // the host has a connection now
  await settle(async () => (await d.locator('button[data-send]').count()) === 1, 'Send in its place');
  assert.equal(await d.locator('button[data-host-action]').count(), 0);
  assert.deepEqual(errors, []);
});

test('drawn in Bokmål and Nynorsk: each label, the buttons, and how a send went', async () => {
  answer = async () => ({ outcome: 'failed', reason: 'mailbox full' });
  const d = await shownAlone('words', REPLY);
  await d.locator('button[data-send]').click();
  await settle(async () => (await status('words')) === 'Failed: mailbox full', 'Failed');
  const words = async () => [
    ...(await d.locator('.vb-dlabel').allInnerTexts()),
    ...(await d.locator('button:not(.vb-dremove)').allInnerTexts()),
    await status('words'),
  ];
  await ui.setViewWords(VIEW_WORDS_NB);
  await settle(async () => (await words())[0] === 'Til', 'Bokmål');
  assert.deepEqual(await words(), [
    'Til',
    'Kopi',
    'Emne',
    'Vedlegg',
    'Svar på',
    'Rediger',
    'Kopier',
    'Send',
    'Ikke sendt: mailbox full',
  ]);
  assert.deepEqual(
    await d.locator('.vb-dremove').evaluateAll((xs: Element[]) => xs.map((x) => x.getAttribute('aria-label'))),
    ['Fjern plan.pdf', 'Fjern map.png'],
  );
  await d.locator('button', { hasText: 'Rediger' }).click();
  assert.equal(await d.locator('.vb-dtools button').innerText(), 'Forhåndsvis');
  await d.locator('button[data-copy]').click();
  await settle(async () => (await d.locator('button[data-copy]').innerText()) === 'Kopiert', 'Kopiert');
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /^Til: Kari Nordmann <kari@fjord\.example>\nKopi: ola@fjord\.example\nEmne: Re: Ferry plan\nVedlegg: plan\.pdf .*\n\nSvar på:\nFra: Kari Nordmann/s,
  );
  answer = async () => ({ outcome: 'unknown' });
  await d.locator('button[data-send]').click();
  await settle(
    async () => (await status('words')) === 'Det er usikkert om meldingen kom fram. Sjekk det før du sender på nytt.',
    'unknown in Bokmål',
  );
  await ui.setViewWords(VIEW_WORDS_NN);
  await settle(async () => (await status('words')).startsWith('Det er usikkert om meldinga'), 'Nynorsk');
  assert.equal(await status('words'), 'Det er usikkert om meldinga kom fram. Sjekk det før du sender på nytt.');
  assert.deepEqual((await words()).slice(0, 5), ['Til', 'Kopi', 'Emne', 'Vedlegg', 'Svar på']);
  assert.equal(await d.locator('.vb-dtools button').innerText(), 'Førehandsvis');
  answer = async () => ({ outcome: 'failed', reason: 'mailbox full' });
  await d.locator('button[data-send]').click();
  await settle(async () => (await status('words')) === 'Ikkje sendt: mailbox full', 'failed in Nynorsk');
  answer = async () => ({ outcome: 'sent' });
  await d.locator('button[data-send]').click();
  await settle(async () => (await status('words')) === '✓ Sendt', 'sent in Nynorsk');
  await d.locator('button[data-copy]').click();
  await settle(
    async () =>
      /\n\nSvar på:\nFrå: Kari Nordmann <kari@fjord\.example>\nDato: /.test(
        await page.evaluate(() => navigator.clipboard.readText()),
      ),
    'copied in Nynorsk',
  );
  await ui.setViewWords();
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(() => document.body.innerText.includes('which this window has not registered')),
    false,
  );
});
