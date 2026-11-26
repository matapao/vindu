import { checkSend } from '../page-send.js';
import type { AnswerEntry } from '../results.js';
import { keep, log } from './records.js';
import { setPicked } from './selection.js';
import type { Session } from './state.js';
import { asText } from '../format.js';

/** The longest follow-up a page proposes (vindu.ask), and the longest note with what the person picked in it. */
const PROMPT_MAX = 2000;
const NOTE_MAX = 500;

/** What pages sent that the model has not heard yet, oldest first: from one view's pages, or from any. */
export const unheard = (session: Session, view?: string) =>
  session.own.filter((a) => a.from && !session.heard.has(a.id) && (view === undefined || a.from.view === view));
/** The next thing sent that has not been heard, at once when there is one; undefined when ms pass first, or the call is cancelled. */
export const nextSent = (session: Session, view: string | undefined, ms: number, signal?: AbortSignal) =>
  new Promise<AnswerEntry | undefined>((resolve) => {
    const now = unheard(session, view)[0];
    if (now || signal?.aborted) {
      resolve(now);
      return;
    }
    const done = (a?: AnswerEntry) => {
      clearTimeout(timer);
      session.listeners.delete(check);
      signal?.removeEventListener('abort', stop);
      resolve(a);
    };
    const check = () => {
      const a = unheard(session, view)[0];
      if (a || session.closed) done(a); // the task closed: nothing more is sent
    };
    const stop = () => done();
    const timer = setTimeout(stop, ms);
    session.listeners.add(check);
    signal?.addEventListener('abort', stop, { once: true });
  });
/** For look: what was sent and not heard, now heard; each value up to 500 characters, as ctx_read reads it whole. */
export const sentNow = (session: Session) => {
  const xs = unheard(session);
  if (!xs.length) return {};
  for (const a of xs) session.heard.add(a.id);
  const short = (v: unknown) => {
    const t = JSON.stringify(v) ?? 'null';
    return t.length > 500 ? `${t.slice(0, 499)}…` : v;
  };
  return {
    sent_from_pages: xs.slice(-10).map((a) => ({
      id: a.id,
      view: a.from!.view,
      panel: a.from!.panel,
      sent: short(a.values?.sent),
      at: a.at,
    })),
    ...(xs.length > 10 ? { sent_earlier: `${xs.length - 10} more before these: results lists them` } : {}),
  };
};
/** What a page sent while the person used it (the window checks that, and how often): kept as an answer by the page,
 *  not the person, since the page's script chose the value and the person only clicked or pressed a key. For whoever
 *  waits for it, the host, and the next prompt. */
export const sent = (session: Session, x: Record<string, unknown>): boolean => {
  const view = asText(x.view ?? ''),
    panel = asText(x.panel ?? '');
  if (!session.views.get(view)?.includes(panel)) return false; // a page panel of a view that was shown
  const now = Date.now(),
    { recent, why } = checkSend(session.sentAt.get(view) ?? [], x.value, now);
  if (why) return false;
  recent.push(now);
  session.sentAt.set(view, recent);
  const e = keep(session, {
    to: `the page panel "${panel}" in view "${view}"`,
    by: 'page',
    values: { sent: x.value },
    from: { view, panel },
  });
  log(session, { sent: { id: e.id, view, panel, value: x.value } });
  for (const w of session.listeners) w();
  session.more.onSend?.(view, e);
  return true;
};
/** What a page the model wrote says through its bridge, as the window passes it on: what the person picked in it
 *  (vindu.select: a chip above the prompt) or a follow-up it proposes (vindu.ask: the prompt box, unsent). Only from a
 *  page panel of a view shown, no longer than a send and no more often (page-send.ts), each page's say on its own. */
export const pageSaid = (session: Session, x: Record<string, unknown>): boolean => {
  const view = asText(x.view ?? ''),
    panel = asText(x.panel ?? '');
  if (!session.views.get(view)?.includes(panel)) return false; // a page panel of a view that was shown
  const note = typeof x.note === 'string' ? x.note : undefined;
  let said: { items: unknown; note?: string } | string | undefined; // a selection, or a prompt to propose
  if (x.kind === 'select') said = { items: x.items, ...(note !== undefined ? { note } : {}) };
  else if (x.kind === 'ask' && typeof x.prompt === 'string') said = x.prompt;
  if (said === undefined || (note?.length ?? 0) > NOTE_MAX) return false;
  if (typeof said === 'string' && (!said.trim() || said.length > PROMPT_MAX)) return false;
  const now = Date.now(),
    { recent, why } = checkSend(session.saidAt.get(view) ?? [], said, now);
  if (why) {
    log(session, { page: { view, panel, [String(x.kind)]: 'refused', why } });
    return false;
  }
  recent.push(now);
  session.saidAt.set(view, recent);
  if (typeof said === 'string') {
    session.more.onSuggest?.(said);
    log(session, { page: { view, panel, ask: said.slice(0, 200) } });
    return true;
  }
  setPicked(session, [
    ...session.picked.filter((it) => !(it.view === view && it.panel === panel && it.page !== undefined)),
    { view, panel, page: said.items, ...(note !== undefined ? { note } : {}) },
  ]);
  return true;
};
