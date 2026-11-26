// What a week carries besides its events, drawn (block-week.ts works it out): under each day's date its weather (the
// symbol, the lowest and highest temperature, precipitation and wind) and the tasks due on it; and the warnings as a
// strip in their level's colour over the columns of the days they cover, or on each day they cover in an agenda.
import { html, nothing } from 'lit';
import { wordWith, type EventWords } from '../../block-words.js';
import { symbolWords, weatherSign, type DayWeather } from '../../weather.js';
import { formatCell, formatTime, type BlockProps } from './shared.js';

type DueTask = { title: string; done?: boolean; row: number };
type WeekDay = { weather?: DayWeather; tasks?: DueTask[] };
type WeekWarning = { level: string; from?: string; to?: string; area?: string; title?: string; days: string[] };

const daysOf = (props: BlockProps): Record<string, WeekDay> =>
  (props.days && typeof props.days === 'object' && !Array.isArray(props.days) ? props.days : {}) as Record<
    string,
    WeekDay
  >;
const warningsOf = (props: BlockProps): WeekWarning[] =>
  (Array.isArray(props.warnings) ? props.warnings : []).filter(
    (w): w is WeekWarning => !!w && Array.isArray((w as WeekWarning).days),
  );
/** A level as a class name: its letters alone. */
const levelClass = (level: string) => `vb-level-${level.replace(/[^a-z]/g, '')}`;
const levelWord = (words: EventWords, level: string) =>
  level === 'yellow' || level === 'orange' || level === 'red' ? words[level] : '';
const DAY = 86_400_000;

/** Whether the week carries anything besides its events. */
export const carries = (props: BlockProps) => Object.keys(daysOf(props)).length > 0 || warningsOf(props).length > 0;

/** The days a week shows: those its events are on, or, where it carries weather, warnings or tasks, seven days in a
 *  row from its first event's day (its first carried day, without events). */
export function weekDays(props: BlockProps, eventDays: string[]): string[] {
  const own = [...new Set(eventDays)].sort();
  if (!carries(props)) return own.slice(0, 7);
  const first = own[0] ?? [...Object.keys(daysOf(props)), ...warningsOf(props).flatMap((w) => w.days)].sort()[0];
  if (!first) return [];
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(`${first}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10),
  );
}
/** The days an agenda shows: those its events are on, and those that carry weather or tasks. */
export const agendaDays = (props: BlockProps, eventDays: string[]): string[] =>
  [...new Set([...eventDays, ...Object.keys(daysOf(props))])].sort();

/** A day's weather and the tasks due on it, drawn under its date. */
export function dayCarries(props: BlockProps, words: EventWords, day: string) {
  const carried = daysOf(props)[day];
  if (!carried) return nothing;
  const w = carried.weather,
    degrees = (n: number) => `${formatCell(props, Math.round(n))}°`;
  const weather = w
    ? html`<div class="vb-weather">${
        w.symbol
          ? html`<span class="vb-wsign" role="img" aria-label=${symbolWords(w.symbol)} title=${symbolWords(w.symbol)}>${weatherSign(w.symbol)}</span>`
          : nothing
      }${w.min !== undefined && w.max !== undefined ? html`<span class="vb-temps">${degrees(w.min)} / ${degrees(w.max)}</span>` : nothing}${
        w.precipitation !== undefined
          ? html`<span class="vb-rain">${wordWith(words.rain, { amount: formatCell(props, w.precipitation) })}</span>`
          : nothing
      }${w.wind !== undefined ? html`<span class="vb-wind">${wordWith(words.wind, { speed: formatCell(props, w.wind) })}</span>` : nothing}</div>`
    : nothing;
  const tasks = carried.tasks?.length
    ? html`<ul class="vb-duetasks">${carried.tasks.map(
        (t) =>
          html`<li class=${t.done ? 'vb-done' : ''} aria-label=${wordWith(words.due, { title: t.title })}><span aria-hidden="true">${t.done ? '☑' : '☐'}</span> ${t.title}</li>`,
      )}</ul>`
    : nothing;
  return html`${weather}${tasks}`;
}

/** A warning in words: its level, what it is, its area, and from when to when. */
const warningText = (props: BlockProps, words: EventWords, w: WeekWarning) =>
  [
    levelWord(words, w.level),
    w.title,
    w.area,
    [w.from, w.to]
      .filter(Boolean)
      .map((t) => formatTime(props, t))
      .join(' – '),
  ]
    .filter(Boolean)
    .join(' · ');

/** The warnings over a week's days: each a strip in its level's colour, over the columns of the days it covers. */
export function warningBand(props: BlockProps, words: EventWords, days: string[]) {
  const shown = warningsOf(props).filter((w) => w.days.some((d) => days.includes(d)));
  if (!shown.length) return nothing;
  return html`<div class="vb-warnband" style=${`--days:${days.length}`}>${shown.map((w) => {
    const first = days.findIndex((d) => w.days.includes(d)),
      last = days.length - 1 - [...days].reverse().findIndex((d) => w.days.includes(d));
    const text = warningText(props, words, w);
    return html`<div class=${`vb-warn ${levelClass(w.level)}`} role="note" title=${text} style=${`grid-column:${first + 2} / ${last + 3}`}>${text}</div>`;
  })}</div>`;
}
/** The warnings that cover a day, for an agenda: a strip each, under its date. */
export function dayWarnings(props: BlockProps, words: EventWords, day: string) {
  const shown = warningsOf(props).filter((w) => w.days.includes(day));
  return shown.length
    ? shown.map(
        (w) => html`<div class=${`vb-warn ${levelClass(w.level)}`} role="note">${warningText(props, words, w)}</div>`,
      )
    : nothing;
}
