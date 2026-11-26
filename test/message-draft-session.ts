// One task's session for the message-draft tests (message-draft.test.ts, message-draft-host.test.ts): a working folder
// with the files a draft attaches, a reply to draft, and the host's onSendMessage, which answers as the test file says.
import { afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type MessageDraft, type SendResult, type Shown } from '../src/index.js';
import type { DraftLook } from '../src/block-drafts.js';
import type { DraftFields, DraftOriginal } from '../src/message-draft.js';
import { mcpClient, panelsIn, sleep } from './helpers.js';

export const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const until = async (f: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(10);
  }
};
export const REPLY = {
  to: ['Kari Nordmann <kari@fjord.example>'],
  cc: 'ola@fjord.example',
  subject: 'Re: Ferry plan',
  format: 'markdown',
  body: 'Hi Kari,\n\nThe **plan** is attached.\n\n- Bergen at 08:00\n- Stavanger at 13:40',
  in_reply_to: {
    from: { name: 'Kari Nordmann', email: 'kari@fjord.example' },
    time: '2026-11-20T09:12:00Z',
    subject: 'Ferry plan',
    body: 'Could you send me the plan?',
  },
  attachments: ['plan.pdf', 'map.png'],
};
export const person = { name: 'Kari', window: 'main' };
export const edits = (f: Record<string, unknown>) => ({
  to: ['Kari Nordmann <kari@fjord.example>'],
  cc: ['ola@fjord.example'],
  subject: 'Re: Ferry plan',
  body: 'Hi',
  attachments: ['plan.pdf', 'map.png'],
  ...f,
});
/** A message block's draft as the window draws it (renderer/blocks/message-draft.ts): the person's, with its fields. */
export type Drawn = Omit<DraftLook, 'fields'> & { fields: DraftFields; format: string; original?: DraftOriginal };

/** The session: what the host is sent, the views shown and the model's client, and the draft as the window draws it.
 *  answer is how the host's onSendMessage answers each send, read at the send. */
export async function draftSession(answer: () => Promise<SendResult>) {
  const dir = tmp('draft-'),
    work = tmp('draft-work-');
  fs.writeFileSync(path.join(work, 'plan.pdf'), Buffer.alloc(12_345, 1));
  fs.writeFileSync(path.join(work, 'map.png'), Buffer.alloc(2_048, 2));
  fs.writeFileSync(path.join(work, 'huge.bin'), '');
  fs.truncateSync(path.join(work, 'huge.bin'), 26 * 1024 * 1024); // past 25 MB, written sparse
  fs.mkdirSync(path.join(work, 'site'));
  fs.writeFileSync(path.join(work, 'site/index.html'), '<h1>A folder</h1>');
  const results = memoryResults(dir);
  const sends: MessageDraft[] = [];
  const vindu = await startVindu({ waitMs: 400, timeZone: 'UTC' });
  const shown: Shown[] = [];
  const ui = vindu.open(
    { results, dir, work },
    {
      onView: (v) => shown.push(v),
      onSendMessage: (d) => {
        sends.push(d);
        return answer();
      },
    },
  );
  const { mcp, json, call } = await mcpClient(ui.url);
  afterAll(async () => {
    await mcp.close();
    ui.close();
    await vindu.close();
  });
  /** The draft as the window draws it, from a view's latest surface: its props, with the token only the window has. */
  const drawn = (view: string, panel = 'draft', views = shown) => {
    const v = views.filter((x) => x.name === view).at(-1)!;
    return panelsIn<{ props: { draft: Drawn } }>(v.wide)[`p_${panel}`].props.draft;
  };
  const show = (name: string, data: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    json('show_view', {
      name,
      title: `Mail ${name}`,
      panels: [{ id: 'draft', card: 'message', layout: 'draft', data, ...more }],
    });
  const event = (view: string, action: string, more: Record<string, unknown> = {}) =>
    ui.event({ type: 'message', action, view, panel: 'draft', token: drawn(view).token, by: person, ...more });
  return { dir, work, results, sends, vindu, shown, ui, mcp, json, call, drawn, show, event };
}
