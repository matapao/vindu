// A mail for the person to send, as a message block's draft (blocks.ts): its fields as the person sees them, the
// limits each is held to, the addresses it takes, and how often the window may tell the UI server what the person
// changed. Shared by the UI server and the window, so nothing else here.

/** What a draft takes at most: addresses in to and cc together, the characters of one address as written, of the
 *  subject and of the body, attachments, and their bytes in all. */
export const DRAFT_LIMITS = { addresses: 50, address: 320, subject: 500, body: 100_000, attachments: 20, bytes: 25 * 1024 * 1024, path: 1000 };
/** How the body is written: plain text, or Markdown, which the window draws as elements. */
export type DraftFormat = 'text' | 'markdown';
/** The mail a draft replies to, as the model gives it: each part as text, and its id where the mail has one. */
export type DraftOriginal = { id?: string; from?: string; time?: string; subject?: string; body?: string };
/** A draft's fields as the person sees them: each address as written ("Kari Nordmann <kari@example.com>"), and the
 *  attachments by their paths in the working folder. */
export type DraftFields = { to: string[]; cc: string[]; subject: string; body: string; attachments: string[] };
/** A file a draft attaches, as the system read it: its path in the working folder, its name and its size in bytes. */
export type DraftFile = { path: string; name: string; size: number };
/** How a send went, as the host says: sent; failed, and why; or unknown, when it may not have arrived. */
export type SendResult = { outcome: 'sent' } | { outcome: 'failed'; reason: string } | { outcome: 'unknown'; reason?: string };
/** Where a draft is: as drafted, being sent, sent (and then read-only), or after a send that failed or may not have
 *  arrived, when the person may change it and send it again. */
export type DraftState = 'draft' | 'sending' | 'sent' | 'failed' | 'unknown';
/** What a draft offers in place of Send: Send itself, the host's own action (its label), or nothing (Copy alone). */
export type DraftSending = 'send' | { action: string } | 'none';
/** The parts of a draft a problem is in. */
export type DraftPart = 'to' | 'cc' | 'subject' | 'body' | 'attachments';

/** The addresses a line holds, as the person writes them: split at commas and semicolons outside quotes and <>, each
 *  trimmed, the empty ones left out. */
export function splitAddresses(line: string): string[] {
  const out: string[] = [];
  let at = '', quoted = false, angled = false;
  for (const c of line) {
    if (c === '"' && !angled) quoted = !quoted;
    else if (c === '<' && !quoted) angled = true;
    else if (c === '>' && !quoted) angled = false;
    if ((c === ',' || c === ';') && !quoted && !angled) {
      if (at.trim()) out.push(at.trim());
      at = '';
    } else at += c;
  }
  if (at.trim()) out.push(at.trim());
  return out;
}

const LOCAL = /^[^\s@<>()[\],;:"\\]{1,64}$/;
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;
const TOP = /^(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu;
/** Whether an address is plausible, as written alone or with a name ("Kari Nordmann <kari@example.com>", a name
 *  with a comma in quotes): one @, a local part without spaces or quotes, and a domain of at least two labels. */
function plausibleAddress(mailbox: string): boolean {
  if (mailbox.length > DRAFT_LIMITS.address) return false;
  const named = /^([^<>]*)<([^<>]*)>$/.exec(mailbox.trim());
  const name = named ? named[1].trim() : '';
  if (name.includes('"') && !/^"[^"]*"$/.test(name)) return false;
  const address = (named ? named[2] : mailbox).trim();
  const at = address.indexOf('@');
  if (at < 1 || address.lastIndexOf('@') !== at || address.length > 254) return false;
  const labels = address.slice(at + 1).split('.');
  return LOCAL.test(address.slice(0, at)) && labels.length >= 2 && labels.every(l => LABEL.test(l)) && TOP.test(labels.at(-1)!);
}

const counted = (n: number) => n.toLocaleString('en-GB');
/** What in a draft is past its limits, or not an address, each with why, in the words the model is told: the
 *  addresses (at least one in to), the subject, the body and how many files it attaches. */
export function draftProblems(f: DraftFields): { part: DraftPart; why: string }[] {
  const out: { part: DraftPart; why: string }[] = [];
  if (!f.to.length) out.push({ part: 'to', why: 'to: a draft needs one or more addresses' });
  const all = f.to.length + f.cc.length;
  if (all > DRAFT_LIMITS.addresses) out.push({ part: f.cc.length > f.to.length ? 'cc' : 'to', why: `${all} addresses in to and cc: at most ${DRAFT_LIMITS.addresses}` });
  for (const part of ['to', 'cc'] as const) {
    const bad = f[part].filter(a => !plausibleAddress(a));
    if (bad.length) out.push({ part, why: `${part}: ${bad.slice(0, 5).map(a => `"${a.length > 80 ? `${a.slice(0, 79)}…` : a}"`).join(', ')} ${bad.length > 1 ? 'are not addresses' : 'is not an address'}${bad.length > 5 ? ` (and ${bad.length - 5} more)` : ''}` });
  }
  if (f.subject.length > DRAFT_LIMITS.subject) out.push({ part: 'subject', why: `subject: ${counted(f.subject.length)} characters; at most ${counted(DRAFT_LIMITS.subject)}` });
  if (f.body.length > DRAFT_LIMITS.body) out.push({ part: 'body', why: `body: ${counted(f.body.length)} characters; at most ${counted(DRAFT_LIMITS.body)}` });
  if (f.attachments.length > DRAFT_LIMITS.attachments) out.push({ part: 'attachments', why: `${f.attachments.length} attachments: at most ${DRAFT_LIMITS.attachments}` });
  return out;
}
/** Bytes in words, for a refusal: "26.2 MB". */
export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A draft's fields as the window sends them, when they are that shape and within the sizes a draft holds (any text
 *  while it is being written: an address need not be whole yet); undefined otherwise. */
export function fieldsWithin(value: unknown): DraftFields | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const texts = (x: unknown, most: number, each: number) =>
    Array.isArray(x) && x.length <= most && x.every(s => typeof s === 'string' && s.length <= each) ? (x as string[]) : undefined;
  const to = texts(v.to, DRAFT_LIMITS.addresses, DRAFT_LIMITS.address), cc = texts(v.cc, DRAFT_LIMITS.addresses, DRAFT_LIMITS.address);
  const attachments = texts(v.attachments, DRAFT_LIMITS.attachments, DRAFT_LIMITS.path);
  if (!to || !cc || !attachments || to.length + cc.length > DRAFT_LIMITS.addresses) return undefined;
  if (typeof v.subject !== 'string' || v.subject.length > DRAFT_LIMITS.subject) return undefined;
  if (typeof v.body !== 'string' || v.body.length > DRAFT_LIMITS.body) return undefined;
  return { to: [...to], cc: [...cc], subject: v.subject, body: v.body, attachments: [...attachments] };
}

/** At most this many edits of one draft within EDIT_WINDOW_MS, from the window to the UI server. */
const EDITS_AT_ONCE = 10;
const EDIT_WINDOW_MS = 10_000;
/** One more edit of a draft, as the window tells it: the draft's edits still within the window (the caller adds this
 *  one to them when it goes), and why it may not go, if it may not: too many at once, or fields that are not a
 *  draft's. The window holds an edit back until it may go; the UI server refuses one that comes sooner. */
export function checkDraftEdit(editedAt: readonly number[], fields: unknown, now = Date.now()): { recent: number[]; why?: string } {
  const recent = editedAt.filter(t => now - t < EDIT_WINDOW_MS);
  if (recent.length >= EDITS_AT_ONCE) return { recent, why: `too many: ${EDITS_AT_ONCE} edits in ${EDIT_WINDOW_MS / 1000} seconds at most` };
  return fieldsWithin(fields) ? { recent } : { recent, why: 'not the fields of a draft, within its limits' };
}
