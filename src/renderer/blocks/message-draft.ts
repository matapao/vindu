// A mail drafted for the person to send (a message block's draft), drawn so they can change every part of it in place:
// To and Cc as addresses, the subject, the body (plain text, or Markdown drawn as elements, with its source to edit),
// and the files it attaches, which they may take off. What they change goes to the UI server as they go, at most as
// often as message-draft.ts allows, so a redraw and a checkpoint keep it. Send is theirs alone: only their own click
// sends the mail as they see it, which is their yes, and the host sends it. While it goes and once it is sent, every
// field is read-only. Copy puts the whole mail on the clipboard as plain text, with no host. The mail it replies to is
// shown quoted below it, as text: never run or fetched.
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { bytesIn, whenIn } from '../../format.js';
import { parseMarkdown } from '../../markdown.js';
import { checkDraftEdit, DRAFT_LIMITS, draftProblems, fieldsWithin, splitAddresses, type DraftFields, type DraftOriginal, type DraftPart, type DraftSending, type DraftState } from '../../message-draft.js';
import { VIEW_WORDS, type MessageWords } from '../../view-words.js';
import { sendBlockAction } from '../dom.js';
import { markdownBlocks } from './markdown.js';
import { plainText, rowContainer, type RowBlockProps } from './shared.js';

type File = { path: string; name: string; size: number; missing?: boolean };
/** The draft as the UI server draws it (block-drafts.ts). */
type Look = { token: string; state: DraftState; rev: number; reason?: string; fields: DraftFields; format: string; original?: DraftOriginal; files: File[]; sending: DraftSending };
/** The draft as the person changes it here: To and Cc as they type them, until the UI server draws another draft
 *  (another token); whether a Markdown body shows its source; the drawing's rev when they pressed Send, and when, for
 *  "Sending…" until the UI server says more; what was last told to it, and when, for the bound on edits. */
type Local = {
  token: string; to: string; cc: string; subject: string; body: string; attachments: string[]; editing: boolean;
  look?: Look; pressed?: { rev: number; at: number }; copied?: ReturnType<typeof setTimeout>; flush?: ReturnType<typeof setTimeout>; told: string; edits: number[];
  drawn?: { source: string; blocks: unknown }; // a Markdown body as last drawn, so a keystroke elsewhere does not parse it again
};
const locals = new WeakMap<HTMLElement, Local>();
/** How long the window shows "Sending…" by itself, for a Send the UI server has not answered. */
const PRESSED_MS = 15_000;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texts = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const said = (v: unknown) => (typeof v === 'string' ? v : '');
/** What the window offers in place of Send, as the UI server sent it: Send itself, a host's action, or nothing. */
function sendingOf(v: unknown): DraftSending {
  if (v === 'send') return 'send';
  return isObject(v) && typeof v.action === 'string' ? { action: v.action } : 'none';
}
/** The draft the UI server sent, read as untrusted: what is not of its shape is left out. */
function lookOf(v: unknown): Look | undefined {
  if (!isObject(v) || !isObject(v.fields)) return undefined;
  const f = v.fields, state = ['draft', 'sending', 'sent', 'failed', 'unknown'].includes(said(v.state)) ? said(v.state) as DraftState : 'draft';
  const sending = sendingOf(v.sending);
  const files = (Array.isArray(v.files) ? v.files : []).filter(isObject).map(x => ({ path: said(x.path), name: said(x.name), size: Number(x.size) || 0, missing: x.missing === true }));
  const o = isObject(v.original) ? v.original : undefined;
  return {
    token: said(v.token), state, rev: Number(v.rev) || 0, reason: said(v.reason), format: said(v.format), files, sending,
    fields: { to: texts(f.to), cc: texts(f.cc), subject: said(f.subject), body: said(f.body), attachments: texts(f.attachments) },
    ...(o ? { original: { from: said(o.from), time: said(o.time), subject: said(o.subject), body: said(o.body) } } : {}),
  };
}
/** The words it draws: the view's, where the surface gives them, and English for each one it does not. */
const wordsOf = (given: unknown): MessageWords => {
  const words = isObject(given) ? given : {};
  return Object.fromEntries(Object.entries(VIEW_WORDS.message).map(([k, english]) => [k, typeof words[k] === 'string' ? words[k] : english])) as MessageWords;
};
const localOf = (element: HTMLElement, look: Look): Local => {
  const had = locals.get(element);
  if (had?.token === look.token) return had;
  const f = look.fields;
  const made: Local = { token: look.token, to: f.to.join(', '), cc: f.cc.join(', '), subject: f.subject, body: f.body, attachments: [...f.attachments], editing: false, told: JSON.stringify(f), edits: [] };
  locals.set(element, made);
  return made;
};
const fieldsOf = (l: Local): DraftFields => ({ to: splitAddresses(l.to), cc: splitAddresses(l.cc), subject: l.subject, body: l.body, attachments: [...l.attachments] });
const pressed = (l: Local, look: Look) => !!l.pressed && l.pressed.rev === look.rev && Date.now() - l.pressed.at < PRESSED_MS;

/** The whole mail as plain text, as Copy gives it: its headers, its body, and the mail it replies to, quoted. */
function draftText(f: DraftFields, files: readonly File[], original: DraftOriginal | undefined, w: MessageWords, locale?: string, timeZone?: string): string {
  const attached = files.filter(x => f.attachments.includes(x.path));
  const head = [`${w.to}: ${f.to.join(', ')}`, f.cc.length ? `${w.cc}: ${f.cc.join(', ')}` : '', `${w.subject}: ${f.subject}`,
    attached.length ? `${w.attachments}: ${attached.map(x => `${x.name} (${bytesIn(x.size, locale)})`).join(', ')}` : ''].filter(Boolean);
  const out = [head.join('\n'), f.body];
  if (original) {
    const about = [original.from ? `${w.from}: ${original.from}` : '', original.time ? `${w.date}: ${whenIn(original.time, locale, timeZone)}` : '', original.subject ? `${w.subject}: ${original.subject}` : ''].filter(Boolean);
    const quoted = plainText(original.body ?? '').split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
    out.push([`${w.inReplyTo}:`, ...about].join('\n'), ...(quoted && original.body ? [quoted] : []));
  }
  return out.join('\n\n');
}

/** A Markdown body, drawn as a document's blocks: each heading in it, then what follows it. */
const markdownOf = (l: Local, source: string) => {
  if (l.drawn?.source !== source) l.drawn = { source, blocks: markdownBlocks(parseMarkdown(source).sections.flatMap(s => [...(s.title ? [{ heading: s.title, level: s.level }] : []), ...s.blocks])) };
  return l.drawn.blocks;
};

export function messageDraft(props: RowBlockProps, element: HTMLElement) {
  const look = lookOf(props.draft);
  if (!look) return nothing;
  const w = wordsOf(props.words), local = localOf(element, look);
  local.look = look;
  const redraw = () => (element as HTMLElement & { requestUpdate?: () => void }).requestUpdate?.();
  const sending = look.state === 'sending' || pressed(local, look), sent = look.state === 'sent', locked = sent || sending;
  const shown = sent ? look.fields : fieldsOf(local);
  const files = look.files.filter(f => shown.attachments.includes(f.path));
  const problems = new Set<DraftPart>(draftProblems(shown).map(p => p.part));
  if (files.some(f => f.missing) || files.reduce((n, f) => n + f.size, 0) > DRAFT_LIMITS.bytes) problems.add('attachments');

  // what the person changed goes to the UI server a moment after they stop, and again later when it may not go yet
  const flush = () => {
    local.flush = undefined;
    const now = local.look, fields = fieldsOf(local), told = JSON.stringify(fields);
    if (!now || now.state === 'sending' || now.state === 'sent' || told === local.told || !fieldsWithin(fields)) return;
    const { recent, why } = checkDraftEdit(local.edits, fields);
    if (why) { local.flush = setTimeout(flush, 1500); return; }
    local.edits = [...recent, Date.now()];
    local.told = told;
    sendBlockAction(element, { type: 'message', action: 'edit', panel: props.panel, token: local.token, fields });
  };
  const changed = () => { clearTimeout(local.flush); local.flush = setTimeout(flush, 600); redraw(); };
  const typed = (part: 'to' | 'cc' | 'subject' | 'body') => (e: Event) => { local[part] = (e.target as HTMLInputElement | HTMLTextAreaElement).value; changed(); };
  // Send: the person's own click, never a script's; the mail goes as they see it
  const send = (e: MouseEvent) => {
    if (!e.isTrusted || locked || problems.size) return;
    clearTimeout(local.flush);
    local.flush = undefined;
    const fields = fieldsOf(local);
    local.told = JSON.stringify(fields);
    local.pressed = { rev: look.rev, at: Date.now() };
    setTimeout(redraw, PRESSED_MS + 100);
    sendBlockAction(element, { type: 'message', action: 'send', panel: props.panel, token: local.token, fields });
    redraw();
  };
  const hostAction = (e: MouseEvent) => { if (e.isTrusted) sendBlockAction(element, { type: 'message', action: 'host', panel: props.panel, token: local.token }); };
  const copy = () => {
    const text = draftText(shown, look.files, look.original, w, props.locale, props.timeZone);
    void element.ownerDocument.defaultView?.navigator.clipboard?.writeText(text).then(() => {
      clearTimeout(local.copied);
      local.copied = setTimeout(() => { local.copied = undefined; redraw(); }, 2000);
      redraw();
    }, () => {});
  };

  const field = (part: 'to' | 'cc' | 'subject', value: string) => html`<label class="vb-dfield"><span class="vb-dlabel">${w[part]}</span><input type="text" data-part=${part} .value=${live(value)} ?readonly=${locked} aria-invalid=${problems.has(part) ? 'true' : 'false'} maxlength=${part === 'subject' ? DRAFT_LIMITS.subject : DRAFT_LIMITS.addresses * DRAFT_LIMITS.address} autocomplete="off" spellcheck=${part === 'subject' ? 'true' : 'false'} @input=${typed(part)}></label>`;
  const markdown = look.format === 'markdown';
  const source = html`<textarea class="vb-dbody" data-part="body" aria-label=${w.body} .value=${live(sent ? shown.body : local.body)} ?readonly=${locked} aria-invalid=${problems.has('body') ? 'true' : 'false'} maxlength=${DRAFT_LIMITS.body} @input=${typed('body')}></textarea>`;
  const toggle = (editing: boolean) => () => { local.editing = editing; redraw(); };
  // the body to edit; a Markdown one drawn, or its source while the person edits it
  let body = source;
  if (markdown && local.editing && !locked) body = html`${source}<div class="vb-dtools"><button type="button" class="vb-btn" @click=${toggle(false)}>${w.preview}</button></div>`;
  else if (markdown) body = html`<div class="vb-mdbody vb-dpreview" data-part="body" role="region" aria-label=${w.body}>${markdownOf(local, shown.body)}</div>${locked ? nothing : html`<div class="vb-dtools"><button type="button" class="vb-btn" @click=${toggle(true)}>${w.edit}</button></div>`}`;
  const chip = (f: File) => html`<span class=${f.missing ? 'vb-chip vb-dfile vb-warn' : 'vb-chip vb-dfile'}>${f.name}<span class="vb-muted"> · ${f.missing ? w.missing : bytesIn(f.size, props.locale)}</span>${locked ? nothing
    : html`<button type="button" class="vb-dremove" aria-label=${`${w.remove} ${f.name}`} @click=${() => { local.attachments = local.attachments.filter(p => p !== f.path); changed(); }}>×</button>`}</span>`;
  const attachments = files.length ? html`<div class=${problems.has('attachments') ? 'vb-dfiles vb-dinvalid' : 'vb-dfiles'}><span class="vb-dlabel">${w.attachments}</span><span class="vb-chips">${files.map(chip)}</span></div>` : nothing;
  const o = look.original;
  const original = o ? html`<div class="vb-dquote"><div class="vb-dlabel">${w.inReplyTo}</div><div class="vb-meta">${o.from ? html`<b>${o.from}</b>` : nothing}${o.time ? html`<span class="vb-when">${whenIn(o.time, props.locale, props.timeZone)}</span>` : nothing}</div>${
    o.subject ? html`<div class="vb-title">${o.subject}</div>` : nothing}${o.body ? html`<blockquote class="vb-body">${plainText(o.body)}</blockquote>` : nothing}</div>` : nothing;

  const statusOf = (): string => {
    if (sending) return w.sending;
    if (sent) return `✓ ${w.sent}`;
    if (look.state === 'failed') return `${w.failed}: ${look.reason ?? ''}`;
    if (look.state === 'unknown') return look.reason ? `${w.unknown} (${look.reason})` : w.unknown;
    return problems.size ? w.check : '';
  };
  const status = statusOf();
  // what the window offers in place of Send: Send itself, the host's own action, or nothing once the mail is sent
  const actionOf = () => {
    if (sent) return nothing;
    if (look.sending === 'send') return html`<button type="button" class="vb-btn vb-primary" data-send ?disabled=${sending || problems.size > 0} @click=${send}>${w.send}</button>`;
    return typeof look.sending === 'object' ? html`<button type="button" class="vb-btn vb-primary" data-host-action @click=${hostAction}>${look.sending.action}</button>` : nothing;
  };
  const action = actionOf();
  return rowContainer(props, 0, sent ? 'vb-draft vb-dsent' : 'vb-draft', html`<div class="vb-dhead">${field('to', sent ? shown.to.join(', ') : local.to)}${field('cc', sent ? shown.cc.join(', ') : local.cc)}${
    field('subject', sent ? shown.subject : local.subject)}</div>${body}${attachments}${original}<div class="vb-dactions"><span class=${look.state === 'failed' || look.state === 'unknown' ? 'vb-dstatus vb-warn' : 'vb-dstatus'} role="status" aria-live="polite">${status}</span><button type="button" class="vb-btn" data-copy @click=${copy}>${local.copied ? w.copied : w.copy}</button>${action}</div>`);
}
