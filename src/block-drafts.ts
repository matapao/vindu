// A message block's draft (blocks.ts): a mail the model wrote for the person to send. Its fields are read from its row
// by their roles, held to a draft's limits (message-draft.ts) and refused with why, every problem at once. What is
// drawn is the person's own draft of it, which the window keeps (server/message-drafts.ts): its fields as they changed
// them, the files it attaches as the system read them (names and sizes, never their contents), how its send went, and
// what the window offers in place of Send. The model is told what it wrote, never what the person changed.
import type { Shaped } from './cards.js';
import { DRAFT_LIMITS, draftProblems, megabytes, splitAddresses, type DraftFields, type DraftFile, type DraftFormat, type DraftOriginal, type DraftSending, type DraftState } from './message-draft.js';
import type { Row } from './results.js';

/** The draft as the model wrote it: its fields, how its body is written, and the mail it replies to. */
export type ModelDraft = { fields: DraftFields; format: DraftFormat; original?: DraftOriginal };
/** A file a draft attaches, as read for a drawing: missing once it is no longer in the working folder. */
export type LookedFile = DraftFile & { missing?: true };
/** The person's draft of a panel, as the window keeps it: the token the window's events about it carry, where it is,
 *  how many times it changed there, why its send failed, the fields as the person changed them (none: as the model
 *  wrote them), the files those attach, the files the model's attaches where the person changed them (for its
 *  account), and what the window offers in place of Send. */
export type DraftLook = { token: string; state: DraftState; rev: number; reason?: string; fields?: DraftFields; files: LookedFile[]; modelFiles?: LookedFile[]; sending: DraftSending };
/** The person's draft of a panel, given the model's: a refusal, thrown, when a file it attaches is not in the working
 *  folder or they are too large together, for a draft the model has just shown. */
export type DraftContext = (model: ModelDraft) => DraftLook;

function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}
/** A mailbox as the model gives it: written out ("Kari Nordmann <kari@example.com>"), or an object with its name and
 *  address, written out the same way (a name with a comma in quotes). */
const mailbox = (x: unknown): string => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return text(x).trim();
  const o = x as Record<string, unknown>;
  const address = text(o.email ?? o.address ?? o.mail).trim(), name = text(o.name).replace(/"/g, '').trim();
  return name ? `${/[,;<>@]/.test(name) ? `"${name}"` : name} <${address}>` : address;
};
function mailboxes(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  if (typeof v === 'string') return splitAddresses(v);
  return [v].flat().map(mailbox).filter(Boolean);
}
const FORMATS: Record<string, DraftFormat> = { text: 'text', plain: 'text', markdown: 'markdown', md: 'markdown' };
const ORIGINAL_MOST = { id: 500, from: DRAFT_LIMITS.address, time: 100, subject: DRAFT_LIMITS.subject, body: DRAFT_LIMITS.body };
/** The other names a part of the original mail goes by. */
const ORIGINAL_ALSO: Partial<Record<keyof typeof ORIGINAL_MOST, readonly string[]>> = { time: ['date', 'sent'], id: ['message_id'] };

/** The mail it replies to: its parts as text, each within what a draft holds; or why not. */
function originalOf(v: unknown, problems: string[]): DraftOriginal | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    problems.push('in_reply_to: the original mail, as an object {from, time, subject, body}');
    return undefined;
  }
  const o = v as Record<string, unknown>, out: DraftOriginal = {};
  for (const part of ['id', 'from', 'time', 'subject', 'body'] as const) {
    const said = [part, ...(ORIGINAL_ALSO[part] ?? [])].map(name => o[name]).find(x => x !== undefined && x !== null);
    if (said === undefined || said === null || said === '') continue;
    const t = part === 'from' ? mailboxes(said).join(', ') : text(said);
    if (t.length > ORIGINAL_MOST[part]) problems.push(`in_reply_to.${part}: ${t.length.toLocaleString('en-GB')} characters; at most ${ORIGINAL_MOST[part].toLocaleString('en-GB')}`);
    else out[part] = t;
  }
  return out;
}
/** The paths of the files it attaches, each once. */
function pathsOf(v: unknown, problems: string[]): string[] {
  const list: unknown[] = v === undefined || v === null ? [] : [v].flat();
  const paths = list.map(x => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>).path : x));
  if (paths.some(x => typeof x !== 'string' || !x.trim() || x.length > DRAFT_LIMITS.path)) {
    problems.push('attachments: paths of files in the working folder, e.g. ["report.pdf"]');
    return [];
  }
  return [...new Set((paths as string[]).map(x => x.trim()))];
}

/** The draft the model wrote, from its row by its roles (map); a refusal, thrown, with every problem in it. */
function readDraft(row: Row, map: Record<string, string>): ModelDraft {
  const at = (role: string) => (map[role] ? row[map[role]] : undefined);
  const problems: string[] = [];
  const said = text(at('format') ?? 'text').toLowerCase();
  const format = Object.hasOwn(FORMATS, said) ? FORMATS[said] : undefined;
  if (!format) problems.push(`format: "${said}"; a draft's body is "text" or "markdown"`);
  const original = originalOf(at('in_reply_to'), problems);
  const fields: DraftFields = { to: mailboxes(at('to')), cc: mailboxes(at('cc')), subject: text(at('subject')), body: text(at('body')), attachments: pathsOf(at('attachments'), problems) };
  problems.unshift(...draftProblems(fields).map(p => p.why));
  if (problems.length) throw new Error(`a draft ${problems.length > 1 ? `has ${problems.length} problems` : 'needs a change'}: ${problems.join('; ')}`);
  return { fields, format: format!, ...(original && Object.keys(original).length ? { original } : {}) };
}

/** Why the files a draft attaches cannot go, for a draft just shown: one not in the working folder, or all too large. */
export function filesProblem(files: readonly LookedFile[]): string | undefined {
  const missing = files.filter(f => f.missing).map(f => `"${f.path}"`);
  if (missing.length) return `attachments: no file ${missing.join(', ')} in the working folder`;
  const bytes = files.reduce((n, f) => n + f.size, 0);
  return bytes > DRAFT_LIMITS.bytes ? `attachments: ${megabytes(bytes)} in all; at most ${megabytes(DRAFT_LIMITS.bytes)}` : undefined;
}

/** What the account says the window offers in place of Send. */
const SENDING_SAYS = {
  send: 'the person reads it, may change any of it, and sends it from the window: their click on Send is their yes, and the host sends it. You never press Send; you are told once how it went, with the fields as they were sent',
  none: 'this window sends no mail: the person may copy it',
};
/** A draft's rows, the props its component draws it with, and what its account says: the draft as the model wrote it,
 *  never what the person changed. Without a window that keeps the person's draft (look), it is drawn as written, with
 *  Copy alone, and attaches no file. */
export function draftShaped(rows: Row[], map: Record<string, string>, look?: DraftContext): Shaped {
  const model = readDraft(rows[0], map);
  if (!look && model.fields.attachments.length) throw new Error('attachments: this host reads no files from a working folder');
  const seen: DraftLook = look ? look(model) : { token: '', state: 'draft', rev: 0, files: [], sending: 'none' };
  const draft = {
    token: seen.token, state: seen.state, rev: seen.rev, ...(seen.reason ? { reason: seen.reason } : {}),
    fields: seen.fields ?? model.fields, format: model.format, ...(model.original ? { original: model.original } : {}),
    files: seen.files, sending: seen.sending,
  };
  const { to, cc, subject, body, attachments } = model.fields;
  const files = attachments.map(path => { const f = (seen.modelFiles ?? seen.files).find(x => x.path === path); return f && !f.missing ? { path, name: f.name, size: f.size } : { path }; });
  const original = model.original && { ...(model.original.from ? { from: model.original.from } : {}), ...(model.original.time ? { time: model.original.time } : {}), ...(model.original.subject ? { subject: model.original.subject } : {}) };
  return {
    rows,
    props: { draft },
    account: {
      draft: { to, ...(cc.length ? { cc } : {}), subject, body: `${body.length.toLocaleString('en-GB')} characters of ${model.format === 'markdown' ? 'Markdown' : 'plain text'}`,
        ...(original ? { in_reply_to: original } : {}), ...(files.length ? { attachments: files } : {}) },
      send: typeof seen.sending === 'object' ? `this window cannot send mail yet: in place of Send it offers the host's own "${seen.sending.action}"; the person may copy it` : SENDING_SAYS[seen.sending],
    },
  };
}
