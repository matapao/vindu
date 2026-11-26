import type { PreviewPanel } from '../frames.js';
import { type Ask, type Form, formBinding } from '../operations.js';
import { ROLES } from '../shell-roles.js';
import { receiptFor } from './receipts.js';
import { keep, log, unawaited } from './records.js';
import type { Outcome, Pending, Session } from './state.js';
import { dropView } from './view-state.js';

/** Put an ask before the person, as a pane drawn by its binding (or for the host to draw); it closes when they answer it. */
export const openAsk = (
  session: Session,
  kind: Ask['kind'],
  op: string,
  form: Form,
  input: unknown,
  confirm: boolean,
  binding = 'form',
  link?: string,
): Pending => {
  const ticket = `k${++session.tickets}`;
  const { fields = {}, required = [] } = form;
  const ask: Ask = {
    ticket,
    kind,
    op,
    title: form.title ?? op.replace(/_/g, ' '),
    ...(form.message ? { message: form.message } : {}),
    ...(form.details?.length ? { details: form.details } : {}),
    fields,
    required,
    ...(form.choices ? { choices: form.choices } : {}),
    ...(confirm ? { confirm } : {}),
    ...(link ? { link } : {}),
    ...(input !== undefined ? { input } : {}),
  };
  let settle!: (x: Outcome) => void;
  const outcome = new Promise<Outcome>((r) => {
    settle = r;
  });
  const p: Pending = {
    ask,
    view: `ask-${ticket}`,
    binding: Object.hasOwn(session.runtime.bindings, binding) ? session.runtime.bindings[binding] : formBinding,
    settle,
    outcome,
    finished: Promise.resolve({}),
    need: 1,
    approvals: [],
  };
  session.asks.set(ticket, p);
  drawAsk(session, p);
  if (session.runtime.options.asks !== 'host' && !session.closed && session.asks.has(ticket))
    session.shell.show(p.view, {
      title: ask.title,
      fill: false,
      panels: `asks the person: ${op}`,
      ask: true,
      role: ROLES.ask,
    });
  log(session, { ask: { ticket, kind, op, input } });
  return p;
};
export const drawAsk = (session: Session, p: Pending) => {
  const surface = p.binding(p.ask, session.runtime.words);
  session.onShow({ name: p.view, wide: surface, compact: surface, ask: p.ask });
};
export const answered = (session: Session, p: Pending, o2: Outcome) => {
  session.asks.delete(p.ask.ticket);
  session.shell.drop(p.view);
  if (p.ask.preview && p.approves?.(o2))
    unawaited(session, { receipt: { ticket: p.ask.ticket } }, receiptFor(session, p)); // a yes: what it lets go stays in view, as a receipt
  else if (p.ask.preview) dropView(session, p.ask.preview); // the preview goes with its ask
  log(session, {
    answer: { ticket: p.ask.ticket, outcome: o2, ...(p.approvals.length ? { by: p.approvals } : {}) },
  });
  gone(session, p, o2.action);
  p.settle(o2);
};
/** The host is told the ask left the window. */
const gone = (session: Session, p: Pending, action: Outcome['action']) => {
  try {
    session.more.onAskGone?.(p.view, action);
  } catch (e) {
    log(session, { ask: { ticket: p.ask.ticket, gone: `failed: ${String((e as Error).message)}` } });
  }
};
/** The task closed: each ask still open leaves the window unanswered, and the host is told. */
export const closeAsks = (session: Session) => {
  for (const p of session.asks.values()) {
    session.asks.delete(p.ask.ticket);
    gone(session, p, 'cancel');
    p.settle({ action: 'cancel' });
  }
};
/** The panes an open ask has before the person, which stay in sight until they answer: its own and its preview. */
export const askPanes = (session: Session): string[] =>
  [...session.asks.values()].flatMap((p) => [p.view, ...(p.ask.preview ? [p.ask.preview] : [])]);

/** When whoever asked stops waiting (a cancelled turn, say), the ask leaves the window unanswered. Once it is
 *  answered, no one listens for that any longer. */
export const until = (session: Session, p: Pending, signal?: AbortSignal) => {
  const stop = () => {
    if (session.asks.get(p.ask.ticket) === p) answered(session, p, { action: 'cancel' });
  };
  if (signal?.aborted) stop();
  else if (signal) {
    signal.addEventListener('abort', stop, { once: true });
    void p.outcome.then(() => signal.removeEventListener('abort', stop));
  }
  return p;
};

/** The answer, or a ticket to wait for it with: whichever comes first, or the ticket at once when the call that waits
 *  is cancelled (signal); the ask stays, and await_answer waits for it again. */
export const within = async (p: Pending, ms: number, signal?: AbortSignal) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const r = await Promise.race([
    p.finished,
    new Promise<null>((r2) => {
      timer = setTimeout(() => r2(null), ms);
      if (signal?.aborted) r2(null);
      stop = () => r2(null);
      signal?.addEventListener('abort', stop, { once: true });
    }),
  ]).finally(() => {
    clearTimeout(timer);
    if (stop) signal?.removeEventListener('abort', stop);
  });
  return (
    r ?? {
      pending: true,
      ticket: p.ask.ticket,
      note: `the person has not answered yet; await_answer with this ticket waits again, and the answer is kept as a p-id when it comes`,
    }
  );
};

/** Exactly what an ask's call will send or change, beside the ask: its payload kept by reference (a host entry), shown
 *  with the block that fits it. A payload no block fits stays in the ask's details, as it always is. */
/** What of a preview's payload its panel shows: a list's rows, or the part the preview names. */
const pickOf = (payload: unknown, pick: PreviewPanel['pick']) => {
  if (Array.isArray(payload)) return { pick: 'rows' };
  return pick ? { pick } : {};
};
export const showPreview = async (
  session: Session,
  p: Pending,
  payload: unknown,
  pv: PreviewPanel | undefined,
  label: string,
) => {
  if (!pv || payload === undefined || payload === null) return;
  const values = Array.isArray(payload) ? { rows: payload } : (payload as Record<string, unknown>);
  const e = keep(session, { to: `the input of ${label}, exactly as it will go`, by: 'host', values });
  const name = `preview-${p.ask.ticket}`;
  session.shell.claim(name, 'exactly what an ask will send'); // the system's pane, beside the ask, then its receipt
  const panel: Record<string, unknown> = {
    id: 'preview',
    card: pv.card,
    from: e.id,
    ...pickOf(payload, pv.pick),
    ...(pv.layout ? { layout: pv.layout } : {}),
    ...(pv.map ? { map: pv.map } : {}),
    ...(pv.columns ? { columns: pv.columns } : {}),
  };
  const args = {
    name,
    title: pv.title ?? 'Exactly what will go',
    subtitle: `${label}: from its own input (${e.id})`,
    panels: [panel],
  };
  let shown = false;
  try {
    // the ask knows its preview as soon as it is shown, so a yes or a no while its checks run settles it as ever
    await session.present({ ...args, place: { beside: p.view, side: 'left' } }, false, false, () => {
      shown = true;
      session.drawn.set(name, args);
      if (session.asks.get(p.ask.ticket) === p) {
        p.ask = { ...p.ask, preview: name };
        drawAsk(session, p);
      } else dropView(session, name); // answered before it could be shown
    });
  } catch (err) {
    if (!shown) session.shell.drop(name); // never shown: the name is no longer held for it
    log(session, { preview: { ticket: p.ask.ticket, refused: String((err as Error).message) } });
  }
};
