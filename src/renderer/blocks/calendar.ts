import { html, nothing } from 'lit';
import { BLOCK_WORDS, wordsGiven, wordWith, type EventWords } from '../../block-words.js';
import { dayOf } from '../../dates.js';
import { asText } from '../../format.js';
import { fitted } from './fit-words.js';
import {
  type BlockProps,
  type RowBlockProps,
  fieldValue,
  formatCell,
  formatTime,
  rowContainer,
  displayNames,
  emptyMessage,
  defineBlock,
} from './shared.js';
import { sendBlockAction } from '../dom.js';
import { agendaDays, carries, dayCarries, dayWarnings, warningBand, weekDays } from './calendar-week.js';

/** What a dragged event carries: its own type, so a task dropped on a day is not taken for an event. */
const EVENT_ROW = 'text/x-vindu-event';

// the day an event is on, in the window's time zone (as its clock is); a value that is no day is its own group, as written
const dayKey = (props: BlockProps, v: unknown) =>
  dayOf(v, props.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone) ?? String(v);
const clock = (props: BlockProps, v: unknown) => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) || /^\d{4}-\d{2}-\d{2}$/.test(String(v))
    ? ''
    : new Intl.DateTimeFormat(props.locale, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: props.timeZone,
      }).format(d);
};
/** The hour an event ends at on its day: half an hour on with no end, the day's end when it ends at midnight. */
const endHourOf = (startHour: number, end: number) => {
  if (!Number.isFinite(end)) return startHour + 0.5;
  return end === 0 && startHour > 0 ? 24 : end;
};
const hourOf = (props: BlockProps, v: unknown) => {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return NaN; // no time: nowhere on the day's hours
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: props.timeZone,
  })
    .format(d)
    .split(':')
    .map(Number);
  return h + m / 60;
};
export const VEvents = defineBlock('VEvents', 'vindu-events', { words: 'value', days: 'value', warnings: 'value' }, (props) => {
  const rows = props.rows;
  const words = wordsGiven(props.words, BLOCK_WORDS.events);
  if (!rows.length) return emptyMessage(props.layout === 'free' ? words.noFree : words.none);
  if (props.layout === 'free') return freeTime(props, words);
  if (props.layout === 'week') return weekCalendar(props, words);
  return agenda(props, words);
});

/** A length of time in hours and minutes, in the view's words, its numbers as the locale writes them. */
function lengthOf(props: RowBlockProps, words: EventWords, minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const h = hours ? wordWith(words.hours, { hours: formatCell(props, hours) }) : '';
  const m = rest || !hours ? wordWith(words.minutes, { minutes: formatCell(props, rest) }) : '';
  return [h, m].filter(Boolean).join(' ');
}

function freeTime(props: RowBlockProps, words: EventWords) {
  const rows = props.rows;
  return html`<div class="vb-list">${rows.map((row, index) => {
    const minutes = (Date.parse(String(row.end)) - Date.parse(String(row.start))) / 60000;
    return rowContainer(
      props,
      index,
      'vb-item vb-ev',
      html`<span class="vb-time">${formatTime(props, row.start)} – ${clock(props, row.end)}</span><span class="vb-free">${
        wordWith(words.free, { time: lengthOf(props, words, minutes) })
      }</span>`,
    );
  })}</div>`;
}

function weekCalendar(props: RowBlockProps, words: EventWords) {
  const rows = props.rows;
  const days = weekDays(props, rows.map((row) => dayKey(props, fieldValue(props, row, 'start')))); // with its weather: seven in a row
  const startHours = rows.map((row) => hourOf(props, fieldValue(props, row, 'start'))).filter(Number.isFinite),
    endHours = rows
      .map((row) => hourOf(props, fieldValue(props, row, 'end') ?? fieldValue(props, row, 'start')))
      .filter(Number.isFinite);
  const firstHour = Math.floor(Math.min(8, ...startHours)),
    lastHour = Math.ceil(Math.max(firstHour + 1, 16, ...endHours));
  // an event is planned by hand: dragged to another day or time, or moved with Alt and the arrows (15 minutes, a day);
  // the window sends the new time as an action inside the view, and the system keeps the plan and finds clashes
  const plan = (e: Event, index: number, offsetMs: number) => {
    const row = rows[index];
    const originalStart = Date.parse(String(fieldValue(props, row, 'start'))),
      originalEnd = Date.parse(String(fieldValue(props, row, 'end') ?? fieldValue(props, row, 'start')));
    if (!Number.isFinite(originalStart) || !offsetMs) return;
    sendBlockAction(e.currentTarget as HTMLElement, {
      type: 'view',
      action: 'plan',
      panel: props.panel,
      from: index,
      start: new Date(originalStart + offsetMs).toISOString(),
      ...(Number.isFinite(originalEnd) && fieldValue(props, row, 'end') !== undefined
        ? { end: new Date(originalEnd + offsetMs).toISOString() }
        : {}),
    });
  };
  const dayOffsetMs = (a: string, b: string) => Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  const dropOn = (d: string) => ({
    over: (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(EVENT_ROW)) e.preventDefault();
    },
    drop: (e: DragEvent) => {
      e.preventDefault();
      const [index, grab] = String(e.dataTransfer?.getData(EVENT_ROW) ?? '')
        .split(':')
        .map(Number);
      const row = rows[index];
      if (!row) return;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const hourHeight = box.height / (lastHour - firstHour);
      if (!hourHeight) return;
      const hour = Math.max(firstHour, Math.round((firstHour + (e.clientY - box.top - (grab || 0)) / hourHeight) * 4) / 4);
      plan(
        e,
        index,
        dayOffsetMs(dayKey(props, fieldValue(props, row, 'start')), d) +
          (hour - hourOf(props, fieldValue(props, row, 'start'))) * 3_600_000,
      );
    },
  });
  const grab = (index: number) => (e: DragEvent) => {
    const eventBounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
    e.dataTransfer?.setData(EVENT_ROW, `${index}:${Math.round(e.clientY - eventBounds.top)}`);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };
  const keys = (index: number) => (e: KeyboardEvent) => {
    if (!e.altKey) return;
    const step = { ArrowUp: -900_000, ArrowDown: 900_000, ArrowLeft: -86_400_000, ArrowRight: 86_400_000 }[
      e.key
    ];
    if (!step) return;
    e.preventDefault();
    plan(e, index, step);
  };
  return html`${warningBand(props, words, days)}<div class=${carries(props) ? 'vb-week vb-carries' : 'vb-week'} style=${`--days:${days.length}`}><div class="vb-hours">${
    Array.from(
      { length: lastHour - firstHour },
      (_, index) =>
        html`<div style="height:var(--vb-hour,30px)">${
          String(firstHour + index).padStart(2, '0')
        }:00</div>`,
    )
  }</div>${
    days.map((d) => {
      const dropHandlers = dropOn(d);
      return html`<div class="vb-day"><div class="vb-dayhead">${formatTime(props, d, false)}${dayCarries(props, words, d)}</div><div class="vb-daybody" style=${
        `height:calc(var(--vb-hour,30px) * ${lastHour - firstHour})`
      } data-day=${d} @dragover=${dropHandlers.over} @drop=${dropHandlers.drop}>${
        rows.map((row, index) => {
          if (dayKey(props, fieldValue(props, row, 'start')) !== d) return nothing;
          const startHour = hourOf(props, fieldValue(props, row, 'start')),
            end = hourOf(props, fieldValue(props, row, 'end') ?? fieldValue(props, row, 'start')),
            endHour = endHourOf(startHour, end);
          if (!Number.isFinite(startHour)) return nothing;
          const moved = row.planned_from !== undefined,
            clash = Array.isArray(row.clashes) && row.clashes.length > 0;
          const overlaps = clash ? `; overlaps ${(row.clashes as unknown[]).map((c) => asText(c)).join(', ')}` : '';
          const note = moved ? `moved from ${clock(props, row.planned_from)}${overlaps}` : '';
          // its title and place cut at a word's end to fit the slot; the whole title is its name and its tooltip
          const title = formatCell(props, fieldValue(props, row, 'title')),
            where = fieldValue(props, row, 'where') !== undefined ? ` · ${formatCell(props, fieldValue(props, row, 'where'))}` : '';
          return html`<div class=${
            `vb-slot${moved ? ' vb-moved' : ''}${clash ? ' vb-clash' : ''}`
          } title=${[title, note].filter(Boolean).join('\n')} aria-label=${title} aria-description=${note || nothing} data-panel=${props.panel ?? ''} data-row=${String(index)} draggable="true" tabindex="0" role="group" aria-roledescription="event you can move" @dragstart=${grab(index)} @keydown=${keys(index)} style=${
            `top:calc(var(--vb-hour,30px) * ${startHour - firstHour});height:max(calc(var(--vb-hour,30px) * .6),calc(var(--vb-hour,30px) * ${Math.max(endHour - startHour, 0.25)} - 2px))`
          } ${fitted()}><b>${
            clock(props, fieldValue(props, row, 'start'))
          }</b> <span class="vb-slottitle" data-full=${title} .textContent=${title}></span>${
            where ? html`<span class="vb-muted" data-full=${where} .textContent=${where}></span>` : nothing
          }</div>`;
        })
      }</div></div>`;
    })
  }</div>`;
}

function agenda(props: RowBlockProps, words: EventWords) {
  const rows = props.rows;
  const byDay = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const day = dayKey(props, fieldValue(props, row, 'start'));
    byDay.set(day, [...(byDay.get(day) ?? []), index]);
  });
  // the days with events, in the order the events come, or every day with events, weather or tasks, in order
  const days: [string, number[]][] = carries(props) ? agendaDays(props, [...byDay.keys()]).map((d) => [d, byDay.get(d) ?? []]) : [...byDay];
  return html`<div class="vb-agenda">${days.map(
    ([d, rowIndices]) =>
      html`<div class="vb-dayhead">${formatTime(props, d, false)}${dayCarries(props, words, d)}</div>${dayWarnings(props, words, d)}${rowIndices.map((index) => {
        const row = rows[index];
        return rowContainer(
          props,
          index,
          'vb-item vb-ev',
          html`<span class="vb-time">${
            clock(props, fieldValue(props, row, 'start'))
          }${
            fieldValue(props, row, 'end') !== undefined
              ? html`–${
                  clock(props, fieldValue(props, row, 'end'))
                }`
              : nothing
          }</span><span>${
            formatCell(props, fieldValue(props, row, 'title'))
          }${
            fieldValue(props, row, 'where') !== undefined
              ? html`<span class="vb-muted"> · ${
                  formatCell(props, fieldValue(props, row, 'where'))
                }</span>`
              : nothing
          }${
            fieldValue(props, row, 'who') !== undefined
              ? html`<div class="vb-muted">${
                  displayNames(fieldValue(props, row, 'who')).join(', ')
                }</div>`
              : nothing
          }</span>${
            fieldValue(props, row, 'status') !== undefined
              ? html`<span class="vb-chip">${
                  formatCell(props, fieldValue(props, row, 'status'))
                }</span>`
              : nothing
          }`,
        );
      })}`,
  )}</div>`;
}
