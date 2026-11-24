// A host that lets the person send a mail the model drafted, with no mail service of its own: its onSendMessage waits
// a moment and answers "sent", as a host would once its mail service had taken the mail. Nothing is sent anywhere.
// The model shows the draft as any view (played here by a client of the task's own MCP endpoint): a reply, with the
// mail it answers quoted under it and a file from the working folder attached. The person may change any of it in the
// window, and their click on Send is their yes: no approval follows it. The model never presses Send; it is told how
// the send went, with the mail as it went.
import fs from 'node:fs';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { memoryResults, startVindu, type MessageDraft, type SendResult, type VinduSessionOptions } from '@matapao/vindu/server';

/** The reply the model drafts: to whom, what about, its body in Markdown, the mail it answers, and a file it attaches. */
export const REPLY_DRAFT = {
  name: 'reply',
  title: 'Reply to Kari',
  panels: [{
    id: 'draft', card: 'message', layout: 'draft',
    data: {
      to: ['Kari Nordmann <kari@fjord.example>'],
      cc: ['ola@fjord.example'],
      subject: 'Re: Ferry timetable for Thursday',
      format: 'markdown',
      body: 'Hi Kari,\n\nThe timetable for Thursday is attached. In short:\n\n- **08:00** from Bergen\n- **13:40** in Stavanger\n\nBest regards,\nOla',
      in_reply_to: {
        from: { name: 'Kari Nordmann', email: 'kari@fjord.example' },
        time: '2026-11-20T09:12:00Z',
        subject: 'Ferry timetable for Thursday',
        body: 'Hi Ola,\n\nCould you send me the timetable for Thursday?\n\nKari',
      },
      attachments: ['timetable.csv'],
    },
  }],
};

/** What this host does with a mail the person sends: it waits a moment, and says it went. No mail leaves. */
export const sendNowhere = (ms = 800) => (_draft: MessageDraft): Promise<SendResult> =>
  new Promise(resolve => setTimeout(() => resolve({ outcome: 'sent' }), ms));

/** A task whose window shows the reply drafted: its working folder holds the file the draft attaches. onView gets each
 *  view as the window draws it; sent, each mail the person sent, as the host got it. */
export async function startMailDesk(o: { dir: string; work: string; onView?: VinduSessionOptions['onView'] }) {
  fs.writeFileSync(path.join(o.work, 'timetable.csv'), 'departs,from,arrives,to\n08:00,Bergen,13:40,Stavanger\n');
  const vindu = await startVindu({ timeZone: 'Europe/Oslo' });
  const sent: MessageDraft[] = [];
  const answer = sendNowhere();
  const ui = vindu.open({ results: memoryResults(o.dir), dir: o.dir, work: o.work }, {
    onView: o.onView,
    onSendMessage: draft => { sent.push(draft); return answer(draft); },
  });
  const model = new Client({ name: 'mail-desk', version: '1' });
  await model.connect(new StreamableHTTPClientTransport(new URL(ui.url)));
  await model.callTool({ name: 'show_view', arguments: REPLY_DRAFT });
  return {
    ui,
    sent,
    async close() {
      await model.close();
      ui.close();
      await vindu.close();
    },
  };
}
