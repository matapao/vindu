import { keep, log, stableJson } from './records.js';
import type { Pending, Receipt, Session } from './state.js';
import { forget } from './view-state.js';
import { asText } from '../format.js';

export const clock = (session: Session, iso: string) =>
  new Date(iso).toLocaleTimeString(session.runtime.format.locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: session.runtime.format.timeZone,
  });
const own = (o: Record<string, unknown>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);
/** Each field where what went is not what was approved: field, before (approved) and after (went), a few levels in. */
const differences = (a: unknown, b: unknown, at = '', depth = 0): Record<string, unknown>[] => {
  if (stableJson(a) === stableJson(b)) return [];
  const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  if (depth < 3 && obj(a) && obj(b))
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      differences(own(a, k), own(b, k), at ? `${at}.${k}` : k, depth + 1),
    );
  return [{ field: at || 'the input', before: a ?? null, after: b ?? null }];
};
/** The preview of a yes, kept as its receipt: approved, by whom and when; waiting for the call to go, or done. */
export const receiptFor = async (session: Session, p: Pending) => {
  const view = p.ask.preview!;
  const args = session.drawn.get(view); // as the system drew it: what was changed inside it is not what was approved
  if (!args) return;
  const panel = ((args.panels ?? []) as Record<string, unknown>[])[0];
  const entry = asText(panel?.from ?? '');
  const who = p.approvals.map((a) => `${a.name} (${a.window})`).join(', ') || 'the person';
  const at = new Date().toISOString();
  const label = p.call?.label ?? p.ask.op;
  const r: Receipt = {
    view,
    ticket: p.ask.ticket,
    call: p.call,
    input: p.call?.input ?? p.ask.input,
    entry,
    who,
    at,
    label,
    state: p.call ? 'waiting' : 'done',
  };
  session.receipts.push(r);
  await drawReceipt(session, view, {
    ...args,
    title: p.call ? 'Approved: waiting for it to go' : 'Approved',
    subtitle: `${label}: approved by ${who} at ${clock(session, at)}; exactly this (${entry})`,
  });
  log(session, { receipt: { ticket: r.ticket, state: r.state, who } });
};
/** A receipt drawn in its pane, by the system: kept as drawn, and nothing done inside the pane before carries over.
 *  said: what is told of it, as soon as it is drawn (what the model is told never waits on the window's checks). */
export const drawReceipt = async (
  session: Session,
  view: string,
  args: Record<string, unknown>,
  said?: () => void,
) => {
  await session.present(args, true, false, () => {
    session.drawn.set(view, args);
    forget(session, view);
    said?.();
  });
};
/** A result the host kept (the processor's call, exact on the wire): the waiting receipt for the same call is settled by
 *  it. What went is compared with what was approved, field by field, and the model is told how it went. */
export const settle = async (session: Session, id: string) => {
  const e = session.results.get(id);
  if (!e || e.kind !== 'result') return;
  const r = session.receipts.find(
    (x) => x.state === 'waiting' && x.call && x.call.server === e.server && x.call.tool === e.tool,
  );
  if (!r) return;
  const args = session.drawn.get(r.view);
  if (!args) {
    r.state = 'done';
    return;
  }
  const diff = differences(r.input ?? {}, e.input ?? {});
  const failed = !!e.error; // a call that failed may still have gone otherwise than approved: what differs is shown either way
  r.state = diff.length ? 'differs' : failed ? 'failed' : 'went';
  r.went = id;
  const base = ((args.panels ?? []) as Record<string, unknown>[]).slice(0, 1);
  let panels = base;
  if (r.state === 'differs') {
    const d = keep(session, {
      to: `what went with ${id}, against what was approved (${r.entry})`,
      by: 'host',
      values: { rows: diff },
    });
    panels = [
      ...base,
      {
        id: 'differs',
        card: 'changes',
        from: d.id,
        pick: 'rows',
        title: 'What went is not what was approved',
      },
    ];
  }
  const title =
    r.state === 'went'
      ? 'Went exactly as approved'
      : r.state === 'differs'
        ? failed
          ? 'Not as approved, and it failed'
          : 'Went, but not as approved'
        : 'Approved, but it failed';
  if (r.state !== 'went')
    session.cues.set(r.view, [
      r.state === 'differs'
        ? {
            label: 'Why does it differ?',
            prompt: `${id} is not what I approved (${r.entry}): ${diff.map((x) => String(x.field)).join(', ')} differ. What happened, and what should be done?`,
          }
        : {
            label: 'Why did it fail?',
            prompt: `${id} failed after my yes (${r.entry}). Why, and what should be done?`,
          },
    ]);
  const told = () => {
    session.shell.say(
      r.state === 'went'
        ? `${id} went exactly as the person approved it (${r.entry})`
        : r.state === 'differs'
          ? `${id} is not what the person approved (${r.entry}): ${diff.map((x) => String(x.field)).join(', ')} differ${failed ? ', and the call failed' : ''}; the window shows both`
          : `${id} failed, after the person's yes (${r.entry})`,
    );
    log(session, {
      receipt: {
        ticket: r.ticket,
        state: r.state,
        went: id,
        ...(diff.length ? { differs: diff.map((x) => x.field) } : {}),
      },
    });
  };
  const subtitle = `${r.label}: approved by ${r.who} at ${clock(session, r.at)}; ${failed ? `the call failed (${id})` : `it went as ${id}`}`;
  await drawReceipt(session, r.view, { ...args, title, subtitle, panels }, told);
};
