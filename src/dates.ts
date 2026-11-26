// Dates by the system, so a deadline is as exact as a value read: a date and a length of time, the same everywhere.
//   "sent + 14 days"   "decided + 3 weeks"   "invoice_date + 30 working days"   "today + 1 month"   "due - 2 working days"
// A field holds a date (YYYY-MM-DD) or a time (ISO 8601; its date is taken in the process's time zone). Months keep the day,
// or the month's last day (31 January + 1 month is 28 or 29 February). Working days skip Saturdays and Sundays, and the
// holidays given; public holidays are not known to the system unless given.
import { isCalendarDay } from './format.js';

type Row = Record<string, unknown>;
export type DateExpr = { from: string; sign: 1 | -1; n: number; unit: 'day' | 'week' | 'month' | 'working day' };
/** The lengths of time a date moves by, as they are written: each name and its unit. */
export const UNIT: ReadonlyMap<string, DateExpr['unit']> = new Map(
  Object.entries({
    day: 'day',
    days: 'day',
    week: 'week',
    weeks: 'week',
    month: 'month',
    months: 'month',
    'working day': 'working day',
    'working days': 'working day',
    workday: 'working day',
    workdays: 'working day',
    'business day': 'working day',
    'business days': 'working day',
  } as const),
);
/** The most a date moves by: a hundred years of days, weeks or months, and ten years of working days, which are
 *  counted one day at a time. */
export const MOST: Readonly<Record<DateExpr['unit'], number>> = {
  day: 36_500,
  week: 5_200,
  month: 1_200,
  'working day': 2_500,
};
/** The longest expression read: a field's name, a sign, a number and a unit fit many times over. */
export const LONGEST = 200;
/** Why a length of time is too long to move by, or nothing. */
const tooFar = (n: number, unit: DateExpr['unit']): string | undefined =>
  n > MOST[unit] ? `${n} ${unit}s is too far: at most ${MOST[unit]} ${unit}s` : undefined;

export function parseDateExpr(src: string): DateExpr {
  const form = `"${String(src).slice(0, 60)}": a date field or today, then + or - a number of days, weeks, months or working days`;
  // trimmed first, so no two runs of spaces meet: each part is matched one way only, and a long input cannot make it backtrack
  const m =
    String(src).length <= LONGEST
      ? /^(today|[A-Za-z_][\w.]*|"[^"]+")(?:\s*([+-])\s*(\d+)\s*([a-z]+(?:\s+[a-z]+)*))?$/i.exec(String(src).trim())
      : null;
  const unit = m?.[2] ? UNIT.get(m[4].toLowerCase().replace(/\s+/g, ' ')) : 'day';
  if (!m || !unit) throw new Error(form);
  const n = m[3] ? Number(m[3]) : 0,
    far = tooFar(n, unit);
  if (far) throw new Error(`"${src}": ${far}`);
  return { from: m[1].replace(/^"|"$/g, ''), sign: m[2] === '-' ? -1 : 1, n, unit };
}

/** The day a value stands for, as YYYY-MM-DD: a date as it is, a time's date in the time zone; null when it is neither
 *  (a date or a time on a day the calendar does not have, such as 2026-02-30, included). */
export function dayOf(v: unknown, timeZone = 'UTC'): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = v.trim();
  const written = /^\d{4}-\d{2}-\d{2}/.exec(t)?.[0];
  if (written && !isCalendarDay(written)) return null;
  if (written === t) return t;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  );
}
export const today = (timeZone = 'UTC', now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** The holidays given, as days: what is not written YYYY-MM-DD is left out. */
export const holidaySet = (list: readonly string[] = []): Set<string> =>
  new Set(list.filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h)));

/** A day as written (YYYY-MM-DD), or why it cannot be: the calendar's years run from 0000 to 9999 here. */
const dayText = (d: Date): string => {
  if (!Number.isFinite(d.getTime())) throw new RangeError('not a day of the calendar');
  const t = d.toISOString();
  if (!/^\d{4}-/.test(t)) throw new RangeError('the date falls outside the years 0000 to 9999');
  return t.slice(0, 10);
};
/** A day moved by a length of time, exactly. */
export function addTime(
  day: string,
  e: Pick<DateExpr, 'sign' | 'n' | 'unit'>,
  holidays: ReadonlySet<string> = new Set(),
): string {
  const far = tooFar(e.n, e.unit);
  if (far) throw new RangeError(far);
  const d = new Date(`${day}T00:00:00Z`);
  if (e.unit === 'day' || e.unit === 'week') {
    d.setUTCDate(d.getUTCDate() + e.sign * e.n * (e.unit === 'week' ? 7 : 1));
    return dayText(d);
  }
  if (e.unit === 'month') {
    const y = d.getUTCFullYear(),
      mo = d.getUTCMonth() + e.sign * e.n,
      day0 = d.getUTCDate();
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return dayText(new Date(Date.UTC(y, mo, Math.min(day0, last))));
  }
  const off = new Set([...holidays].map((h) => Date.parse(`${h}T00:00:00Z`))); // compared as instants: no text made per day
  let left = Number.isFinite(d.getTime()) ? e.n : 0; // a day that is none: dayText says so
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + e.sign);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !off.has(d.getTime())) left--;
  }
  return dayText(d);
}

/** Rows with dates computed for each by the system, and how many came out empty (a field that holds no date), by field. */
export function addDates(
  rows: Row[],
  dates: Record<string, string>,
  o: { timeZone?: string; holidays?: string[]; now?: Date } = {},
): { rows: Row[]; empty: Record<string, number> } {
  const parsed = Object.entries(dates).map(([k, src]) => {
    if (k === '__proto__') throw new Error('a date field cannot be named __proto__');
    return [k, parseDateExpr(src)] as const;
  });
  const holidays = holidaySet(o.holidays);
  const now = today(o.timeZone, o.now);
  const empty: Record<string, number> = {};
  const out = rows.map((r) => {
    const x = { ...r };
    for (const [k, e] of parsed) {
      const start =
        e.from.toLowerCase() === 'today' ? now : dayOf(Object.hasOwn(x, e.from) ? x[e.from] : undefined, o.timeZone);
      let day: string | null = null;
      try {
        day = start ? addTime(start, e, holidays) : null;
      } catch {
        /* past the calendar's years: empty, as a missing date is */
      }
      x[k] = day;
      if (!day) empty[k] = (empty[k] ?? 0) + 1;
    }
    return x;
  });
  return { rows: out, empty };
}
