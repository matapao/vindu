// A week that carries its weather (the events block, block-events.ts): on each day its forecast (the symbol nearest
// midday, the lowest and highest temperature, the precipitation added up, the strongest wind), the warnings over the
// days they cover, and the tasks due that day; so a week needs no chart of temperatures and no list of warnings beside
// it. Each comes as a result id or as rows, in any of the common shapes, read by role names (weather.ts); the days
// are worked out by the system in the view's time zone, and the account says from what.
import { dayOf } from './dates.js';
import { asText } from './format.js';
import type { Entry } from './results.js';
import { dailyWeather, instantsOf, listsIn, warningsOf, type DayWeather, type Warning } from './weather.js';

/** A task due on a day: its title, whether it is done, and where it is in the list it came from. */
type DueTask = { title: string; done?: true; row: number };
/** What a day carries besides its events. */
type WeekDay = { weather?: DayWeather; tasks?: DueTask[] };
/** A warning, with the days it covers (YYYY-MM-DD in the view's time zone). */
type WeekWarning = Warning & { days: string[] };
/** What the week carries, for its component, and what its account says of it. */
export type Week = { days: Record<string, WeekDay>; warnings: WeekWarning[]; account: Record<string, unknown> };

/** At most this many days a warning is drawn over. */
const LONGEST = 31;
const TITLE = /^(title|name|task|summary|what|step)$/i,
  DUE = /^(due|deadline|by|due_?date)$/i,
  STATE = /^(state|status|done|completed|stage)$/i;
const DONE = /^(done|completed?|closed|resolved|true|yes|ferdig|finished)$/i;

/** What a field of the panel holds: a result's value or rows, by its id, or the rows given. */
function given(v: unknown, field: string, read: (id: string) => Entry | undefined): unknown {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return v;
  const e = read(v);
  if (!e || e.kind !== 'result') throw new Error(`${field}: no result "${v}"`);
  return e.value ?? e.rows;
}
/** The days from one day to another, inclusive, at most LONGEST of them. */
function daysFrom(first: string, last: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${first}T00:00:00Z`), end = Date.parse(`${last}T00:00:00Z`);
    t <= end && out.length < LONGEST;
    t += 86_400_000
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
/** The tasks in a value (a list of rows with a title and a due date), by the day each is due. */
function tasksByDay(value: unknown, timeZone: string): Map<string, DueTask[]> {
  const list =
    listsIn(value).find((l) => l.some((x) => x && typeof x === 'object' && Object.keys(x).some((k) => DUE.test(k)))) ??
    [];
  const out = new Map<string, DueTask[]>();
  list.forEach((x, row) => {
    if (!x || typeof x !== 'object') return;
    const r = x as Record<string, unknown>,
      keys = Object.keys(r);
    const due = keys.find((k) => DUE.test(k)),
      title = keys.find((k) => TITLE.test(k)),
      state = keys.find((k) => STATE.test(k));
    const day = due ? dayOf(asText(r[due] ?? ''), timeZone) : null;
    if (!day || !title) return;
    const task: DueTask = {
      title: asText(r[title] ?? ''),
      row,
      ...(state && DONE.test(asText(r[state] ?? '')) ? { done: true as const } : {}),
    };
    out.set(day, [...(out.get(day) ?? []), task]);
  });
  return out;
}

/** What a week's panel carries (forecast, warnings, tasks), worked out by day; undefined when it carries none. */
export function weekOf(
  p: Record<string, unknown>,
  read: (id: string) => Entry | undefined,
  timeZone: string,
): Week | undefined {
  const forecast = given(p.forecast, 'forecast', read),
    warned = given(p.warnings, 'warnings', read),
    due = given(p.tasks, 'tasks', read);
  if (forecast === undefined && warned === undefined && due === undefined) return undefined;
  const days: Record<string, WeekDay> = {},
    account: Record<string, unknown> = {};
  const day = (d: string) => (days[d] ??= {});
  if (forecast !== undefined) {
    const instants = instantsOf(forecast);
    if (!instants.length)
      throw new Error(
        'forecast: no time series of instants in it, each with a time and a temperature (or a symbol with precipitation or wind)',
      );
    const weather = dailyWeather(instants, timeZone);
    for (const [d, w] of weather) day(d).weather = w;
    account.weather = `computed by the system from ${instants.length} instants${typeof p.forecast === 'string' ? ` of ${p.forecast}` : ''}, by day in ${timeZone}: the symbol nearest midday, the lowest and highest temperature, the precipitation added up and the strongest wind, on ${weather.size} days`;
  }
  const warnings: WeekWarning[] = [];
  if (warned !== undefined) {
    for (const w of warningsOf(warned)) {
      const first = w.from ? dayOf(w.from, timeZone) : null,
        last = w.to ? dayOf(w.to, timeZone) : first;
      warnings.push({ ...w, days: first ? daysFrom(first, last ?? first) : [] });
    }
    account.warnings = warnings.map((w) =>
      [w.level, w.title, w.area, w.days.length ? `${w.days[0]} to ${w.days[w.days.length - 1]}` : 'no days']
        .filter(Boolean)
        .join(' · '),
    );
  }
  if (due !== undefined) {
    const byDay = tasksByDay(due, timeZone);
    for (const [d, tasks] of byDay) day(d).tasks = tasks;
    account.tasks = `${[...byDay.values()].flat().length} due on ${byDay.size} days, each on the day it is due`;
  }
  return { days, warnings, account };
}
