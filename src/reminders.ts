// Reminders: something to come back to at a time, set by the person or the model, kept with the process. When one is due,
// the person sees it (the bar's chip, the Reminders pane, and the host's own notice, such as the system's notification)
// and the model is told with the next prompt. The time is the system's, never the model's arithmetic: a time, a day (at
// 09:00), or worked out from a day or a value read, in the process's time zone, and the reminder says how:
//   "2026-11-30T14:00"   "2026-11-30"   "today + 3 working days"   "tomorrow at 08:30"   "now + 2 hours"
//   "ctx:r3#/0/due - 2 working days at 10:00"   "ctx:r5#/0/start - 30 minutes"
// Working days skip Saturdays, Sundays and the holidays the host gives; public holidays are not known otherwise.
import { addTime, dayOf, holidaySet, LONGEST, MOST, UNIT as DATE_UNIT, type DateExpr } from './dates.js';
import { BASIC_CATALOG, componentList, surfaceOf } from './catalog-id.js';
import type { Surface } from './a2ui.js';

export type Reminder = {
  id: string;                         // m1, m2, …
  what: string;                       // what to come back to, in the words of whoever set it
  at: string;                         // when, exactly (ISO 8601, UTC)
  said: string;                       // when, as the person reads it, in the process's time zone
  how: string;                        // how the time was worked out
  by: 'person' | 'model'; who?: string; // who set it (the person's name as their window gives it; not verified)
  about?: string;                     // what it is about: a view, or a reference (ctx:r3#/0)
  state: 'set' | 'due' | 'done';
  set_at: string; due_at?: string; done_at?: string; done_by?: 'person' | 'model';
};
export const DEFAULT_TIME = '09:00'; // a day alone: its morning
const UNIT: ReadonlyMap<string, DateExpr['unit'] | 'minute' | 'hour'> = new Map([...Object.entries({ minute: 'minute', minutes: 'minute', min: 'minute', mins: 'minute', hour: 'hour', hours: 'hour' } as const), ...DATE_UNIT]);
const MOST_CLOCK = { minute: 52_560_000, hour: 876_000 }; // a hundred years, as for days (dates.ts)
const ISO_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const pad = (n: number) => String(n).padStart(2, '0');

/** A wall-clock time's parts in a time zone. */
function wall(ms: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)])) as Record<string, number>;
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}
const offsetAt = (ms: number, tz: string) => { const w = wall(ms, tz); return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000; };
/** The instant a day's time stands for in a time zone. Where the clocks change: a time the clock shows twice (autumn)
 *  is the first of the two; a time it skips (spring) is moved on by the gap, as Temporal's "compatible" does. */
export function instantOf(day: string, hm: string, timeZone: string): number {
  const [y, m, d] = day.split('-').map(Number); const [h, mi] = hm.split(':').map(Number);
  const w = Date.UTC(y, m - 1, d, h, mi);
  const before = w - offsetAt(w - 43_200_000, timeZone), after = w - offsetAt(w + 43_200_000, timeZone); // the offsets half a day either side
  const shows = (ms: number) => { const l = localOf(ms, timeZone); return l.day === day && l.hm === `${pad(h)}:${pad(mi)}`; };
  const real = [before, after].filter(shows).sort((a, b) => a - b);
  return real[0] ?? before;
}
/** An instant's day and time of day in a time zone. */
export function localOf(ms: number, timeZone: string): { day: string; hm: string } {
  const w = wall(ms, timeZone); return { day: `${w.y}-${pad(w.mo)}-${pad(w.d)}`, hm: `${pad(w.h)}:${pad(w.mi)}` };
}
/** An instant as the person reads it. */
export const sayTime = (ms: number, locale: string, timeZone: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(ms));

type From = { kind: 'instant'; ms: number; said: string } | { kind: 'day'; day: string; said: string };
/** When a reminder is: the exact instant, and how it was worked out; or why it cannot be. */
export function whenOf(src: string, o: { timeZone: string; locale?: string; now?: Date; holidays?: string[]; read?: (ref: string) => { ok: true; value: unknown } | { ok: false; why: string } }): { ms: number; how: string } | { refusal: string } {
  const tz = o.timeZone, now = (o.now ?? new Date()).getTime();
  // each part is matched one way only (words of letters, the spaces between them, "at" after a space), so a long input
  // cannot make it backtrack; and what is longer than any time written is not read
  const text = String(src ?? '');
  const m = text.length <= LONGEST ? /^\s*(now|today|tomorrow|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?|ctx:\S+?)(?:\s*([+-])\s*(\d+)\s*([a-z]+(?:\s+[a-z]+)*?))?(?:\s+at\s+(\d{1,2}):(\d{2}))?\s*$/i.exec(text) : null;
  const form = '"2026-11-30T14:00", "2026-11-30", "today + 3 working days", "tomorrow at 08:30", "now + 2 hours" or "ctx:r3#/0/due - 2 working days at 10:00"';
  if (!m) return { refusal: `"${text.slice(0, 80)}" is not a time the system can work out: ${form}` };
  const unit = m[2] ? UNIT.get(m[4].toLowerCase().replace(/\s+/g, ' ')) : undefined;
  if (m[2] && !unit) return { refusal: `"${m[4]}" is not a length of time: minutes, hours, days, weeks, months or working days` };
  const most = unit === 'minute' || unit === 'hour' ? MOST_CLOCK[unit] : unit ? MOST[unit] : Infinity;
  if (Number(m[3]) > most) return { refusal: `${m[3]} ${unit}s is too far: at most ${most} ${unit}s` };
  if (m[5] !== undefined && (Number(m[5]) > 23 || Number(m[6]) > 59)) return { refusal: `${m[5]}:${m[6]} is not a time of day` };
  const at = m[5] !== undefined ? `${pad(Number(m[5]))}:${m[6]}` : undefined;
  if (at && (unit === 'minute' || unit === 'hour')) return { refusal: 'at goes with days: a time worked out in minutes or hours has its own time of day' };
  // where it starts
  const fromText = (t: string, said: string, name = said): From | { refusal: string } => {
    const iso = ISO_TIME.exec(t);
    if (iso) {
      const ms = iso[5] ? Date.parse(`${iso[1]}T${iso[2]}:${iso[3]}:${iso[4] ?? '00'}${/^z$/i.test(iso[5]) ? 'Z' : iso[5].length === 5 ? `${iso[5].slice(0, 3)}:${iso[5].slice(3)}` : iso[5]}`) : instantOf(iso[1], `${iso[2]}:${iso[3]}`, tz);
      if (!Number.isFinite(ms) || dayOf(iso[1]) === null || Number(iso[2]) > 23 || Number(iso[3]) > 59) return { refusal: `${t} is not a time of the calendar` };
      return { kind: 'instant', ms, said: `${said}${iso[5] ? '' : ` (${tz})`}` };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return dayOf(t) ? { kind: 'day', day: t, said } : { refusal: `${t} is not a day of the calendar` };
    return { refusal: `${name} holds ${JSON.stringify(t).slice(0, 60)}, not a day or a time` };
  };
  const head = m[1];
  let from: From | { refusal: string };
  if (/^now$/i.test(head)) from = { kind: 'instant', ms: now, said: `now (${sayTime(now, o.locale ?? 'en-GB', tz)})` };
  else if (/^(today|tomorrow)$/i.test(head)) { const today = localOf(now, tz).day; const day = /^tomorrow$/i.test(head) ? addTime(today, { sign: 1, n: 1, unit: 'day' }) : today; from = { kind: 'day', day, said: `${head.toLowerCase()} (${day})` }; }
  else if (/^ctx:/i.test(head)) {
    if (!o.read) return { refusal: 'a reference cannot be read here' };
    const r = o.read(head); if (!r.ok) return { refusal: `${head}: ${r.why}` };
    if (typeof r.value !== 'string') return { refusal: `${head} holds ${JSON.stringify(r.value)?.slice(0, 60)}, not a day or a time` };
    from = fromText(r.value.trim(), `${head} (${r.value.trim()})`, head);
  } else from = fromText(head, head);
  if ('refusal' in from) return from;
  // what is added or taken away, and the time of day
  const n = m[3] ? Number(m[3]) : 0, sign = m[2] === '-' ? -1 : 1;
  const step = m[2] ? ` ${sign < 0 ? '−' : '+'} ${n} ${unit}${n === 1 ? '' : 's'}` : '';
  if (unit === 'minute' || unit === 'hour') {
    const base = from.kind === 'instant' ? from.ms : instantOf(from.day, DEFAULT_TIME, tz);
    const ms = base + sign * n * (unit === 'minute' ? 60_000 : 3_600_000);
    return { ms, how: `${from.said}${from.kind === 'day' ? ` at ${DEFAULT_TIME}, as a day alone is` : ''}${step} = ${sayTime(ms, o.locale ?? 'en-GB', tz)}, ${tz}` };
  }
  const startDay = from.kind === 'instant' ? localOf(from.ms, tz).day : from.day;
  let day = startDay;
  try { if (unit) day = addTime(startDay, { sign, n, unit }, holidaySet(o.holidays)); } catch (e) { return { refusal: `${from.said}${step}: ${(e as Error).message}` }; }
  const hm = at ?? (from.kind === 'instant' ? localOf(from.ms, tz).hm : DEFAULT_TIME);
  const ms = from.kind === 'instant' && !unit && !at ? from.ms : instantOf(day, hm, tz);
  const timeSaid = at ? `at ${at}` : from.kind === 'instant' ? (unit ? `at ${hm}, its own time of day` : '') : `at ${DEFAULT_TIME}, as a day alone is`;
  return { ms, how: [`${from.said}${step}${unit ? ` = ${day}` : ''}`, timeSaid].filter(Boolean).join(', ') + `: ${sayTime(ms, o.locale ?? 'en-GB', tz)}, ${tz}${unit === 'working day' && !(o.holidays ?? []).length ? ' (Saturdays and Sundays skipped; no holidays given)' : ''}` };
}

/** The reminders, as they are now: the last line kept for each. */
export function remindersFrom(lines: string[]): Reminder[] {
  const by = new Map<string, Reminder>();
  for (const l of lines) { try { const r = JSON.parse(l) as Reminder; if (r && typeof r.id === 'string' && typeof r.at === 'string') by.set(r.id, r); } catch { /* a line cut short */ } }
  return [...by.values()];
}

export type ReminderWords = { title: string; none: string; add: string; done: string; hour: string; tomorrow: string; drop: string; ask: string;
  state: (r: Reminder) => string; byWho: (r: Reminder) => string };
export const REMINDER_WORDS: ReminderWords = {
  title: 'Reminders', none: 'No reminders. The model can set one, and so can you.', add: 'New reminder', done: 'Done', hour: 'In an hour', tomorrow: 'Tomorrow', drop: 'Drop', ask: 'Ask about it',
  state: r => (r.state === 'due' ? 'Due now' : r.state === 'done' ? 'Done' : 'Set'),
  byWho: r => (r.by === 'model' ? 'set by the model' : `set by ${r.who ?? 'you'}`),
};

/** The Reminders pane: due ones first, then the ones to come, then the last ones done; each with what the person can do. */
export function remindersSurface(rs: Reminder[], w: ReminderWords = REMINDER_WORDS): Surface {
  const { components, add, text, button } = componentList(); const kids: string[] = [];
  const order = [...rs.filter(r => r.state === 'due').sort((a, b) => a.at.localeCompare(b.at)), ...rs.filter(r => r.state === 'set').sort((a, b) => a.at.localeCompare(b.at)),
    ...rs.filter(r => r.state === 'done').sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')).slice(0, 5)];
  if (!order.length) kids.push(text('none', w.none, 'caption'));
  for (const r of order) {
    const i = r.id;
    const acts = r.state === 'due' ? [button(`${i}_done`, w.done, 'reminder', { id: r.id, do: 'done' }, true), button(`${i}_hour`, w.hour, 'reminder', { id: r.id, do: 'hour' }), button(`${i}_tomorrow`, w.tomorrow, 'reminder', { id: r.id, do: 'tomorrow' }), button(`${i}_ask`, w.ask, 'reminder', { id: r.id, do: 'ask' })]
      : r.state === 'set' ? [button(`${i}_drop`, w.drop, 'reminder', { id: r.id, do: 'drop' })] : [];
    const line = add({ id: `${i}_text`, component: 'Column', children: [text(`${i}_what`, r.what, r.state === 'done' ? 'caption' : 'body'), text(`${i}_when`, `${w.state(r)} · ${r.said} · ${w.byWho(r)}${r.about ? ` · ${r.about}` : ''}`, 'caption')] });
    kids.push(add({ id: i, component: 'Row', children: acts.length ? [line, add({ id: `${i}_acts`, component: 'Row', children: acts })] : [line] }));
  }
  kids.push(add({ id: 'new', component: 'Row', children: [button('add', w.add, 'reminder_new', {})] }));
  add({ id: 'root', component: 'Column', children: kids });
  return surfaceOf('reminders', BASIC_CATALOG, components);
}
