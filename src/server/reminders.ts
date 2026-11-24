import { addTime } from '../dates.js';
import { instantOf, localOf, type Reminder, remindersSurface, sayTime, whenOf } from '../reminders.js';
import { readRef } from '../results.js';
import { ROLES } from '../shell-roles.js';
import { drawAsk, openAsk } from './asks.js';
import { writeLine } from './record-files.js';
import { keep, log, unawaited } from './records.js';
import type { Session } from './state.js';
import { asText } from '../format.js';

/** The window's own pane of the process's reminders: its name, held for it from the start, and what it is. */
export const REM_VIEW = 'reminders';
export const REM_PANE = 'the reminders: remind sets one';
/** Whether a view is the Reminders pane, in a window that keeps reminders. */
export const isRemindersPane = (session: Session, view: unknown) =>
  !!session.runtime.options.reminders && view === REM_VIEW;
const keepRem = (session: Session, r: Reminder) => writeLine(session, 'reminders.jsonl', JSON.stringify(r));
export const remCount = (session: Session) => ({
  set: session.reminders.filter((r) => r.state === 'set').length,
  due: session.reminders.filter((r) => r.state === 'due').length,
});
const whoSet = (r: Reminder) => (r.by === 'model' ? 'set by you' : `set by ${r.who ?? 'the person'}`);
/** The bar's chip, and the pane where it is shown (show: bring it before the person). */
export const drawRem = (session: Session, show = false) => {
  if (session.closed) return;
  session.shell.setReminders(remCount(session));
  const shown = session.shell.viewOf(REM_VIEW) !== undefined;
  if (!shown && !show) return;
  const surface = remindersSurface(session.reminders, session.runtime.reminderWords);
  session.onShow({ name: REM_VIEW, wide: surface, compact: surface });
  if (show || !shown)
    session.shell.show(REM_VIEW, {
      title: session.runtime.reminderWords.title,
      fill: false,
      panels: 'reminders',
      role: ROLES.system,
    });
  else session.shell.redrawn(REM_VIEW);
};
const dueRem = (session: Session, r: Reminder, now: number) => {
  const late = now - Date.parse(r.at) >= 60_000; // a minute or more after it came due: the window was not open to say so
  r.state = 'due';
  r.due_at = new Date(now).toISOString();
  keepRem(session, r);
  session.shell.say(
    `reminder ${r.id} is due${late ? ' (it came due while the window was closed)' : ''}: "${r.what}", ${whoSet(r)} for ${r.said}${r.about ? `, about ${r.about}` : ''}`,
  );
  log(session, { reminder: { id: r.id, due: r.at, ...(late ? { late: true } : {}) } });
  try {
    session.more.onReminder?.({ ...r });
  } catch (e) {
    log(session, { reminder: { id: r.id, notice: `failed: ${(e as Error).message}` } });
  }
  if (r.about && session.shown.has(r.about))
    unawaited(session, { reminder: r.id, hook: r.about }, session.fireHooks(r.about, { due: true }));
};
/** The reminders a checkpoint kept, the process's again beside those it has (each by its id): in its record, on the
 *  bar's chip, and due ones due now. */
export const restoreRem = (session: Session, kept: readonly Reminder[] = []) => {
  if (!session.runtime.options.reminders || !kept.length) return;
  const had = new Set(session.reminders.map((r) => r.id));
  for (const r of kept)
    if (!had.has(r.id)) {
      const again = { ...r };
      session.reminders.push(again);
      keepRem(session, again);
    }
  session.shell.setReminders(remCount(session));
  armRem(session);
};
/** Due ones now, and a timer for the next. */
export const armRem = (session: Session) => {
  clearTimeout(session.remTimer);
  session.remTimer = undefined;
  if (session.closed) return;
  const now = Date.now();
  let came = 0;
  for (const r of session.reminders)
    if (r.state === 'set' && Date.parse(r.at) <= now) {
      dueRem(session, r, now);
      came++;
    }
  if (came) drawRem(session);
  const next = Math.min(...session.reminders.filter((r) => r.state === 'set').map((r) => Date.parse(r.at)));
  if (Number.isFinite(next)) {
    session.remTimer = setTimeout(() => armRem(session), Math.max(5, Math.min(next - now, 2 ** 31 - 1)));
    session.remTimer.unref?.();
  }
};
export const setRem = (
  session: Session,
  x: { what?: unknown; when?: unknown; about?: unknown },
  by: 'person' | 'model',
  who?: string,
): Reminder | { refusal: string } => {
  const what = asText(x.what ?? '')
    .trim()
    .slice(0, 500);
  if (!what) return { refusal: 'a reminder needs what to come back to' };
  if (!asText(x.when ?? '').trim()) return { refusal: 'a reminder needs when' };
  if (
    by === 'model' &&
    session.reminders.filter((r) => r.by === 'model' && r.state === 'set').length >=
      session.runtime.reminderLimit
  )
    return {
      refusal: `you have ${session.runtime.reminderLimit} reminders set already: drop one first (look lists them)`,
    };
  // each one set is kept for good (reminders.jsonl), dropped or not: so many a day, at most
  const perDay = session.runtime.reminderLimit * 3;
  const since = Date.now() - 86_400_000;
  const today = session.reminders.filter((r) => r.by === 'model' && Date.parse(r.set_at) > since).length;
  if (by === 'model' && today >= perDay)
    return {
      refusal: `you have set ${perDay} reminders in the last day, the most a day: say in the chat what to come back to`,
    };
  const w = whenOf(String(x.when), {
    timeZone: session.runtime.format.timeZone,
    locale: session.runtime.format.locale,
    holidays: session.runtime.options.holidays,
    read: (ref) => {
      const r = readRef(session.results, ref);
      return r.ok ? { ok: true, value: r.value } : { ok: false, why: r.why };
    },
  });
  if ('refusal' in w) return w;
  const now = Date.now();
  if (w.ms <= now)
    return {
      refusal: `that is not to come: ${w.how}; it is ${sayTime(now, session.runtime.format.locale, session.runtime.format.timeZone)} now`,
    };
  if (w.ms > now + 5 * 366 * 86_400_000) return { refusal: `that is more than five years ahead: ${w.how}` };
  const r: Reminder = {
    id: `m${Math.max(0, ...session.reminders.map((y) => Number(y.id.slice(1)) || 0)) + 1}`,
    what,
    at: new Date(w.ms).toISOString(),
    said: sayTime(w.ms, session.runtime.format.locale, session.runtime.format.timeZone),
    how: w.how,
    by,
    ...(who && who !== 'the person' ? { who } : {}),
    ...(x.about ? { about: asText(x.about).slice(0, 200) } : {}),
    state: 'set',
    set_at: new Date(now).toISOString(),
  };
  session.reminders.push(r);
  keepRem(session, r);
  log(session, { reminder: { id: r.id, set: r.at, by, how: r.how } });
  armRem(session);
  drawRem(session, by === 'person' || session.shell.arranges === 'allow'); // the model's shows like a view it shows, as far as the person lets it arrange
  return r;
};
/** Done, dropped, or put off (an hour; tomorrow, at its own time of day). The model changes only its own. */
export const doRem = (
  session: Session,
  id: string,
  d: string,
  by: 'person' | 'model',
  who?: string,
): { did: string; reminder: Reminder } | { refusal: string } => {
  const r = session.reminders.find((x) => x.id === id);
  if (!r)
    return {
      refusal: `no reminder "${id}"; there are ${session.reminders.map((x) => x.id).join(', ') || 'none'}`,
    };
  if (by === 'model' && r.by !== 'model')
    return { refusal: `${id} is the person's reminder: only they change it` };
  if (r.state === 'done') return { refusal: `${id} is done already` };
  const now = Date.now();
  if (d === 'done' || d === 'drop') {
    r.state = 'done';
    r.done_at = new Date(now).toISOString();
    r.done_by = by;
  } else if (d === 'hour' || d === 'tomorrow') {
    const own = localOf(Date.parse(r.at), session.runtime.format.timeZone).hm;
    const ms =
      d === 'hour'
        ? now + 3_600_000
        : instantOf(
            addTime(localOf(now, session.runtime.format.timeZone).day, { sign: 1, n: 1, unit: 'day' }),
            own,
            session.runtime.format.timeZone,
          );
    r.at = new Date(ms).toISOString();
    r.said = sayTime(ms, session.runtime.format.locale, session.runtime.format.timeZone);
    r.state = 'set';
    delete r.due_at;
    r.how = `put off at ${sayTime(now, session.runtime.format.locale, session.runtime.format.timeZone)}: ${d === 'hour' ? 'an hour' : `to tomorrow at ${own}, its own time of day`}`;
  } else return { refusal: `no "${d}": done, drop, hour or tomorrow` };
  keepRem(session, r);
  log(session, { reminder: { id: r.id, [d]: true, by } });
  armRem(session);
  drawRem(session);
  const did = d === 'done' ? 'marked done' : d === 'drop' ? 'dropped' : `put off to ${r.said}`;
  if (by === 'person')
    session.shell.say(
      `${who && who !== 'the person' ? who : 'the person'} ${d === 'done' ? `marked reminder ${r.id} ("${r.what}") done` : d === 'drop' ? `dropped reminder ${r.id} ("${r.what}")` : `put off reminder ${r.id} ("${r.what}") to ${r.said}`}`,
    );
  return { did, reminder: r };
};
/** The person's own new reminder: what, and when, with a date-time input; a time that cannot be comes back to them. */
export const askRem = (session: Session, error?: string, values?: Record<string, unknown>) => {
  const now = localOf(Date.now(), session.runtime.format.timeZone);
  const p = openAsk(
    session,
    'operation',
    'remind',
    {
      title: session.runtime.reminderWords.add,
      fields: {
        what: {
          type: 'string',
          title: 'What',
          maxLength: 500,
          ...(values?.what ? { default: values.what } : {}),
        },
        when: {
          type: 'string',
          format: 'date-time',
          title: 'When',
          min: `${now.day}T${now.hm}`,
          ...(values?.when ? { default: values.when } : {}),
        },
      },
      required: ['what', 'when'],
    },
    undefined,
    false,
  );
  if (error) {
    p.ask = { ...p.ask, error };
    drawAsk(session, p);
  }
  unawaited(session, { reminder: 'the person\'s own' }, p.outcome.then((r) => {
    if (r.action !== 'accept') return;
    const who = p.approvals[0];
    const got = setRem(session, { what: r.values.what, when: r.values.when }, 'person', who?.name);
    if ('refusal' in got) {
      askRem(session, got.refusal, r.values);
      return;
    }
    const e = keep(session, {
      to: 'remind',
      by: 'person',
      values: r.values,
      output: { reminder: got.id, at: got.at, said: got.said },
      ...(who ? { who: [`${who.name} (${who.window})`] } : {}),
    });
    session.shell.say(
      `${who && who.name !== 'the person' ? who.name : 'the person'} set reminder ${got.id} (${e.id}): "${got.what}" for ${got.said}`,
    );
  }));
  return p;
};

export const remindersOf = (session: Session) => {
  if (!session.runtime.options.reminders || !session.reminders.length) return {};
  const open = session.reminders.filter((r) => r.state !== 'done');
  const done = session.reminders.length - open.length;
  return {
    reminders: open.map((r) => ({
      id: r.id,
      what: r.what,
      when: r.said,
      at: r.at,
      state: r.state === 'due' ? 'due now' : 'set',
      by: r.by === 'model' ? 'you' : (r.who ?? 'the person'),
      ...(r.about ? { about: r.about } : {}),
    })),
    ...(done ? { reminders_done: done } : {}),
  };
};
