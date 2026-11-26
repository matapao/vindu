// The person's own draft of each mail drafted for them (a message block's draft, block-drafts.ts), as the window keeps
// it: what they changed, through the system's redraws and in the checkpoint; the files it attaches, read through the
// page host's path guard (their names and sizes, never their contents); and how its send went. The model's showing
// anew starts a new draft. Send is the person's alone: only their click in the window sends the mail, as they see it,
// and the click is their yes; the host sends it and says how it went (onSendMessage). Each event about a draft carries
// the token only the window that draws it has. The model is told each outcome once, with the fields as they were sent,
// and never what the person changes while they draft (draft-told.ts). A send the host could not say had gone, it may
// settle later, as the person learns on their side (settleDraft).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { filesProblem, type DraftLook, type LookedFile, type ModelDraft } from '../block-drafts.js';
import {
  checkDraftEdit,
  draftProblems,
  fieldsWithin,
  type DraftFields,
  type DraftSending,
  type DraftState as DraftWhere,
  type SendResult,
} from '../message-draft.js';
import type { MessageDraft } from './contracts.js';
import { forModelOf, toldSent, toldSettled } from './draft-told.js';
import { log, stableJson, whoOf } from './records.js';
import type { Session } from './state.js';
import { asText } from '../format.js';

/** One draft, as the session keeps it: the view and panel it is in, its id for the host, the token the window's events
 *  about it carry, the model's draft it is of, the person's fields where they changed them, where its send is (and why
 *  it failed), how many times that changed (the window's own "Sending…" waits for the next), and when the window's last
 *  edits came. */
export type KeptDraft = {
  view: string;
  panel: string;
  id: string;
  token: string;
  model: ModelDraft;
  edited?: DraftFields;
  state: DraftWhere;
  reason?: string;
  rev: number;
  edits: number[];
};
/** A draft as a checkpoint keeps it: the person's fields where they changed them and how its send went, and which mail
 *  the model drafted (of: a digest of it), never the mail itself, which may be what a result held. A send under way is
 *  kept as unknown, since its answer is lost with the task. */
export type SavedDraft = Pick<KeptDraft, 'view' | 'panel' | 'id' | 'edited' | 'state' | 'reason'> & { of: string };

const keyOf = (view: string, panel: string) => `${view}/${panel}`;
const newDraft = (view: string, panel: string, model: ModelDraft): KeptDraft => ({
  view,
  panel,
  id: randomUUID(),
  token: randomBytes(16).toString('hex'),
  model,
  state: 'draft',
  rev: 0,
  edits: [],
});
/** Which mail the model drafted, as a checkpoint names it: the same draft is always the same digest. */
export const digestOf = (model: ModelDraft): string => createHash('sha256').update(stableJson(model)).digest('hex');
/** A draft a checkpoint kept, of the mail drawn now: as the person left it, with a token of this window's. */
const fromSaved = (s: SavedDraft, model: ModelDraft): KeptDraft => ({
  view: s.view,
  panel: s.panel,
  id: s.id,
  token: randomBytes(16).toString('hex'),
  model,
  ...(s.edited ? { edited: structuredClone(s.edited) } : {}),
  state: s.state,
  ...(s.reason ? { reason: s.reason } : {}),
  rev: 0,
  edits: [],
});

/** The files a draft attaches, by their paths in the working folder: each one's name and size, read now through the
 *  page host's path guard (inside the folder, never a folder itself), and missing where it is not there. */
function filesOf(session: Session, paths: readonly string[]): (LookedFile & { rel?: string })[] {
  return paths.map((given) => {
    const name = path.posix.basename(given.replace(/\/+$/, ''));
    try {
      const found = session.process.work ? session.runtime.host.workPath(session.key, given) : null;
      const folder = !!found && path.posix.basename(found.rel) === 'index.html' && name !== 'index.html'; // a folder's page
      if (found && !folder)
        return {
          path: given,
          rel: found.rel,
          name: path.posix.basename(found.rel),
          size: fs.statSync(found.file).size,
        };
    } catch {
      // gone while it was read, or not readable: missing, as any file that is not there
    }
    return { path: given, name, size: 0, missing: true as const };
  });
}

/** What the window offers in place of Send, as the host says now: Send where it sends mail, its own action (a label of
 *  at most 60 characters, and a way to run it) where it cannot yet, or nothing. */
function sendingOf(session: Session): DraftSending {
  const more = session.more;
  let said: unknown;
  try {
    said = more.messageSending ? more.messageSending() : true;
  } catch (e) {
    log(session, { drafts: { sending: 'failed', why: String((e as Error).message).slice(0, 200) } });
    return 'none';
  }
  if (said === true) return more.onSendMessage ? 'send' : 'none';
  const action = said && typeof said === 'object' ? (said as { action?: unknown }).action : undefined;
  const label = typeof action === 'string' ? action.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return label && more.onMessageAction ? { action: label } : 'none';
}

/** The person's draft of a panel, for a drawing of it: the one kept, while the model's draft is the same and this is
 *  not the model's showing anew, or a new one; with the files it attaches as read now. A new draft whose files are not
 *  all there, or too large together, is refused. mounts: where a showing keeps it, once it has passed its checks. */
export function draftLook(
  session: Session,
  view: string,
  panel: string,
  model: ModelDraft,
  anew: boolean,
  mounts?: (() => void)[],
): DraftLook {
  const had = session.drafts.get(keyOf(view, panel)),
    saved = session.savedDrafts.get(keyOf(view, panel));
  let kept: KeptDraft | undefined;
  if (!anew && had && stableJson(had.model) === stableJson(model)) kept = had;
  else if (!anew && saved && saved.of === digestOf(model)) kept = fromSaved(saved, model); // a checkpoint's, drawn again
  const d = kept ?? newDraft(view, panel, model);
  const files = filesOf(session, (d.edited ?? model.fields).attachments);
  const refused = kept ? undefined : filesProblem(files);
  if (refused) throw new Error(refused);
  mounts?.push(() => session.drafts.set(keyOf(view, panel), d));
  const theirs = d.edited ? { fields: d.edited, modelFiles: filesOf(session, model.fields.attachments) } : {}; // the model's account is of its own draft
  return {
    token: d.token,
    state: d.state,
    rev: d.rev,
    ...(d.reason ? { reason: d.reason } : {}),
    ...theirs,
    files,
    sending: sendingOf(session),
  };
}
/** A view's drafts go: before a showing keeps those it draws, and with the view; a checkpoint's with them. */
export const dropDrafts = (session: Session, view: string) => {
  for (const [k, d] of session.drafts) if (d.view === view) session.drafts.delete(k);
  for (const [k, d] of session.savedDrafts) if (d.view === view) session.savedDrafts.delete(k);
};

/** A view with drafts drawn again by the system, where it is, as a restored view is: nothing in it is read again. */
const redraw = (session: Session, view: string) => {
  const args = session.specs.get(view);
  if (args && !session.closed)
    void session
      .present(args, true, true)
      .catch((e) => log(session, { drafts: { redraw: view, failed: String((e as Error).message) } }));
};
/** Every view with a draft, drawn again: the host's messageSending says something else now. */
export const messagesChanged = (session: Session) => {
  for (const view of new Set([...session.drafts.values()].map((d) => d.view))) redraw(session, view);
};

/** Whether an event carries the token of the draft it is about: only the window that draws the draft has it. */
const fromWindow = (d: KeptDraft, token: unknown) => {
  const given = Buffer.from(typeof token === 'string' ? token : ''),
    own = Buffer.from(d.token);
  return given.length === own.length && timingSafeEqual(given, own);
};
/** What the window says of a draft: the person's edit, their Send, or their click on the host's own action. Only from
 *  the window that draws it (its token), for a draft shown; anything else is ignored (false). */
export function draftEvent(session: Session, x: Record<string, unknown>): boolean {
  const d = session.drafts.get(keyOf(asText(x.view ?? ''), asText(x.panel ?? '')));
  if (!d || !session.shown.has(d.view) || !fromWindow(d, x.token)) return false;
  if (x.action === 'edit') return edited(d, x.fields);
  if (x.action === 'send') return sendFromWindow(session, d, x);
  if (x.action === 'host') return hostAction(session, d, whoOf(x));
  return false;
}

/** The person's fields, as they change them: kept for the next drawing and the checkpoint, within a draft's sizes and
 *  as often as the window may say (checkDraftEdit), with only the files the model attached. Never told to the model. */
const edited = (d: KeptDraft, fields: unknown): boolean => {
  if (d.state === 'sending' || d.state === 'sent') return false;
  const { recent, why } = checkDraftEdit(d.edits, fields),
    got = fieldsWithin(fields);
  if (why || !got || !got.attachments.every((p) => d.model.fields.attachments.includes(p))) return false;
  d.edits = [...recent, Date.now()];
  d.edited = got;
  return true;
};

/** The person's Send, with the fields as they see them: checked as a draft is (each address, each limit, each file
 *  still there), sent by the host, and told. A Send that cannot go is drawn again, so the window shows why. */
function sendFromWindow(session: Session, d: KeptDraft, x: Record<string, unknown>): boolean {
  if (d.state === 'sending' || d.state === 'sent' || sendingOf(session) !== 'send') return false;
  const fields = fieldsWithin(x.fields);
  if (!fields || !fields.attachments.every((p) => d.model.fields.attachments.includes(p))) return false;
  const files = filesOf(session, fields.attachments);
  const why =
    draftProblems(fields)
      .map((p) => p.why)
      .join('; ') || filesProblem(files);
  d.edited = fields;
  d.rev++;
  if (why) {
    log(session, { person: { draft: d.id, view: d.view, send: 'refused', why } });
    redraw(session, d.view);
    return false;
  }
  const by = whoOf(x);
  d.state = 'sending';
  delete d.reason;
  redraw(session, d.view);
  log(session, { person: { draft: d.id, view: d.view, panel: d.panel, send: true, by } });
  const { format, original } = d.model;
  const draft: MessageDraft = {
    id: d.id,
    view: d.view,
    panel: d.panel,
    ...fields,
    format,
    ...(original ? { in_reply_to: original } : {}),
    attachments: files.map((f) => ({ path: f.rel ?? f.path, name: f.name, size: f.size })),
    by,
  };
  void sent(session, d, draft);
  return true;
}

/** The host's reason for the person, as one line of at most 500 characters. */
const reasonOf = (said: unknown) => (typeof said === 'string' ? said.replace(/\s+/g, ' ').trim().slice(0, 500) : '');
/** How the host said it went, as a send's outcome, with its words for the model cleaned (forModelOf): anything else, or
 *  a throw, is unknown, as it may have gone. */
const outcomeOf = (r: unknown): SendResult => {
  const o = (r && typeof r === 'object' ? r : {}) as { outcome?: unknown; reason?: unknown; forModel?: unknown };
  const reason = reasonOf(o.reason),
    forModel = forModelOf(o.forModel),
    told = forModel ? { forModel } : {};
  if (o.outcome === 'sent') return { outcome: 'sent', ...told };
  if (o.outcome === 'failed') return { outcome: 'failed', reason: reason || 'the host gave no reason', ...told };
  if (o.outcome === 'unknown') return { outcome: 'unknown', ...(reason ? { reason } : {}), ...told };
  return { outcome: 'unknown', reason: 'the host said nothing of how it went' };
};
async function sent(session: Session, d: KeptDraft, draft: MessageDraft) {
  let result: SendResult;
  try {
    result = outcomeOf(await session.more.onSendMessage!(structuredClone(draft)));
  } catch (e) {
    result = { outcome: 'unknown', reason: reasonOf(String((e as Error)?.message ?? e)) };
  }
  if (session.closed) return;
  d.state = result.outcome;
  if ('reason' in result && result.reason) d.reason = result.reason;
  d.rev++;
  toldSent(session, draft, result);
  if (session.drafts.get(keyOf(d.view, d.panel)) === d) redraw(session, d.view); // a draft the model showed anew since is not this one
}

/** The host settles a send it could not say had gone (unknown), as the person learned on their side: sent, and the
 *  draft locks; or failed, with the person's reason, and they may change it and send it again. The draft is drawn
 *  again and the model told once, in Vindu's words and the host's forModel alone. Only for a draft drawn in this window
 *  whose last send ended unknown (or was under way when its task was kept); anything else is refused (false). */
export function settleDraft(
  session: Session,
  id: unknown,
  outcome: unknown,
  reason?: unknown,
  forModel?: unknown,
): boolean {
  if (session.closed || (outcome !== 'sent' && outcome !== 'failed')) return false;
  const d = [...session.drafts.values()].find((x) => x.id === id);
  if (!d || d.state !== 'unknown') return false;
  const result = outcomeOf({ outcome, reason, forModel }) as SendResult & { outcome: typeof outcome };
  d.state = result.outcome;
  delete d.reason;
  if ('reason' in result && result.reason) d.reason = result.reason;
  d.rev++;
  const { format, original } = d.model,
    fields = d.edited ?? d.model.fields; // as it was last sent
  toldSettled(
    session,
    { id: d.id, view: d.view, panel: d.panel, fields, format, ...(original ? { original } : {}) },
    result,
  );
  redraw(session, d.view);
  return true;
}

/** The person clicked the host's own action in place of Send: the host runs it. */
function hostAction(session: Session, d: KeptDraft, by: { name: string; window: string }): boolean {
  const sending = sendingOf(session);
  if (typeof sending !== 'object' || !session.more.onMessageAction) return false;
  try {
    session.more.onMessageAction({ id: d.id, view: d.view, panel: d.panel, by });
  } catch (e) {
    log(session, {
      drafts: { draft: d.id, action: sending.action, failed: String((e as Error).message).slice(0, 200) },
    });
  }
  log(session, { person: { draft: d.id, view: d.view, action: sending.action, by } });
  return true;
}

/** The drafts, for a checkpoint: those drawn, and those a checkpoint kept that no view has drawn again. */
export const savedDrafts = (session: Session): SavedDraft[] => [
  ...[...session.drafts.values()].map((d) => ({
    view: d.view,
    panel: d.panel,
    id: d.id,
    of: digestOf(d.model),
    ...(d.edited ? { edited: d.edited } : {}),
    ...(d.state === 'sending'
      ? { state: 'unknown' as const, reason: 'the task was kept while it was being sent' }
      : { state: d.state, ...(d.reason ? { reason: d.reason } : {}) }),
  })),
  ...[...session.savedDrafts.values()].map((d) => structuredClone(d)),
];
/** The drafts a checkpoint or a snapshot kept (restore, startFrom): each one the person's again, as they left it, once
 *  its view draws the same mail: a sent one sent and read-only, under its id. */
export const restoreDrafts = (session: Session, saved: readonly SavedDraft[] = []) => {
  for (const s of saved) session.savedDrafts.set(keyOf(s.view, s.panel), structuredClone(s));
};
