// What the model hears of a mail the person sent from a draft (message-drafts.ts): each send's outcome once, in Vindu's
// own words, with the mail as it was sent, kept as the person's answer (a p-id) for ctx_read; and once more when the
// host settles a send it could not say had gone. The host's reason is the person's, shown in the window, and never told:
// the only text of the host's the model hears is its forModel, as plain text. The host's ref to the mail a draft replies
// to is never told either.
import type { DraftFields, DraftFormat, DraftOriginal, SendResult } from '../message-draft.js';
import type { MessageDraft } from './contracts.js';
import { keep, log } from './records.js';
import type { Session } from './state.js';

/** The most characters of the host's words for the model. */
const FOR_MODEL_MOST = 500;
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cs}]/gu; // control and format characters, and half of a pair of surrogates
/** The host's words for the model about a send (forModel), as plain text: each run of white space one space, every
 *  control and invisible format character taken out, trimmed, and at most 500 characters; undefined where nothing is
 *  left. */
export function forModelOf(said: unknown): string | undefined {
  if (typeof said !== 'string') return undefined;
  const plain = said.replace(/\s+/g, ' ').replace(UNSEEN, '').trim();
  const cut = plain.slice(0, FOR_MODEL_MOST).replace(UNSEEN, '').trim();
  return cut || undefined;
}

/** How a send went, in Vindu's words. */
const OUTCOME: Record<SendResult['outcome'], string> = {
  sent: 'the host sent it',
  failed: 'the host could not send it: it did not go, and the person may change it and send it again',
  unknown: 'the host cannot say whether it went: it may not have arrived, and the person checks before sending it again',
};
/** How a send the host could not say had gone was settled, in Vindu's words. */
const SETTLED = {
  sent: 'the host now says it went',
  failed: 'the host now says it did not go: the person may change it and send it again',
};
/** The host's own words for the model, where it gave some, quoted as its. */
const hostSays = (forModel: string | undefined) => (forModel ? `; the host says: ${JSON.stringify(forModel)}` : '');

/** The mail as it was sent, for the model: its fields, and the mail it replies to without the host's ref. */
type AsSent = Omit<DraftFields, 'attachments'> & { format: DraftFormat; in_reply_to?: DraftOriginal; attachments: (string | { path: string; size: number })[] };
const withoutRef = (original: DraftOriginal | undefined) => {
  if (!original) return {};
  const { ref: _ref, ...told } = original;
  return Object.keys(told).length ? { in_reply_to: told } : {};
};
/** The parts of the mail the model is told in a line: to whom, the subject, the body's start, and what it attaches. */
function partsOf(mail: AsSent): string {
  const body = mail.body.length > 200 ? `${JSON.stringify(mail.body.slice(0, 199))}…` : JSON.stringify(mail.body);
  const attached = mail.attachments.map((f) => (typeof f === 'string' ? f : `${f.path} (${f.size} bytes)`));
  return [
    `to ${mail.to.join(', ')}`, mail.cc.length ? `cc ${mail.cc.join(', ')}` : '', `subject ${JSON.stringify(mail.subject)}`,
    `body (${mail.body.length} characters${mail.format === 'markdown' ? ', Markdown' : ''}) ${body}`,
    attached.length ? `attached ${attached.join(', ')}` : '',
    mail.in_reply_to?.subject ? `in reply to ${JSON.stringify(mail.in_reply_to.subject)}` : '',
  ].filter(Boolean).join('; ');
}
/** The mail as it was sent, kept as an answer about the draft in view: the person's, who pressed Send (who), or the
 *  host's, which settled it. Told with it, and not again as an answer. */
function kept(session: Session, view: string, values: Record<string, unknown>, who?: string) {
  const e = keep(session, { to: `Send on the mail drafted in view "${view}"`, by: who ? 'person' : 'host', values, ...(who ? { who: [who] } : {}) });
  session.heard.add(e.id);
  return e.id;
}
const titleOf = (session: Session, view: string) => session.shown.get(view)?.title ?? view;

/** What the model hears of a Send, once, with the next message: how it went in Vindu's words (and the host's forModel),
 *  and the fields as they were sent (the body's start), with all of them kept as the person's answer for ctx_read. */
export function toldSent(session: Session, draft: MessageDraft, result: SendResult) {
  const { id, view, panel, by, in_reply_to, ...fields } = draft;
  const mail = { ...fields, ...withoutRef(in_reply_to) };
  const entry = kept(session, view, { outcome: result.outcome, ...(result.forModel ? { host_says: result.forModel } : {}), ...mail }, by.name);
  const who = by.name === 'the person' ? 'the person' : `${by.name} (${by.window})`;
  session.shell.say(`${who} pressed Send on the mail drafted in "${titleOf(session, view)}" (${panel}), and ${OUTCOME[result.outcome]}${hostSays(result.forModel)}; as it was sent: ${partsOf(mail)} (all of it: ctx_read ${entry})`);
  log(session, { drafts: { draft: id, view, panel, outcome: result.outcome, ...('reason' in result && result.reason ? { reason: result.reason } : {}), entry } });
}

/** A draft whose send the host settled, as the model is told it. */
type Settled = { id: string; view: string; panel: string; fields: DraftFields; format: DraftFormat; original?: DraftOriginal };
/** What the model hears, once, when the host settles a send it could not say had gone: sent, or it did not go, in
 *  Vindu's words (and the host's forModel), with the mail as it was sent, kept as an answer for ctx_read. */
export function toldSettled(session: Session, d: Settled, result: SendResult & { outcome: 'sent' | 'failed' }) {
  const mail = { ...d.fields, format: d.format, ...withoutRef(d.original) };
  const entry = kept(session, d.view, { outcome: result.outcome, settled: 'by the host, after a send it could not say had gone', ...(result.forModel ? { host_says: result.forModel } : {}), ...mail });
  session.shell.say(`the mail the person sent from "${titleOf(session, d.view)}" (${d.panel}), of which the host could not say whether it went: ${SETTLED[result.outcome]}${hostSays(result.forModel)}; as it was sent: ${partsOf(mail)} (all of it: ctx_read ${entry})`);
  log(session, { drafts: { draft: d.id, view: d.view, panel: d.panel, settled: result.outcome, ...('reason' in result && result.reason ? { reason: result.reason } : {}), entry } });
}
