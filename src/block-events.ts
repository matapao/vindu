// The events block: an agenda by day, a week of columns by hour, or the free time between them; events moved by hand
// in the window are a plan, not saved, whose clashes the system finds.
import { z } from 'zod';
import { block, needOne, type Roles } from './block-kit.js';
import { SOURCE, sourceRow, type CardAction, type CardDef, type PanelSpec } from './cards.js';
import type { Row } from './results.js';
import { rowAt, rowKey, rowLabel } from './row-keys.js';
import { asText } from './format.js';

const EV: Roles = { title: /^(title|summary|subject|name|event|what)$/i, start: /^(start|starts|from|begin|begins|dtstart|start_?time|when|date|time)$/i, end: /^(end|ends|to|until|dtend|end_?time)$/i,
  where: /^(location|where|place|room|theatre|theater)$/i, who: /^(attendees|who|people|participants|organizer|staff|owner)$/i, status: /^(status|state)$/i };
const minutes = (s: string) => { const m = /^(\d+)\s*(m|min|minutes?|h|hours?)?$/i.exec(s.trim()); if (!m) return null; return Number(m[1]) * (/^h/i.test(m[2] ?? 'm') ? 60 : 1); };
/** The longest range free time is looked for in, in days: a year, looked at day by day. */
const FREE_DAYS = 366;
const HOUR = /^(?:([01]?\d|2[0-3]):[0-5]\d|24:00)$/;
/** Free time between busy events, within a range and day hours, at least a length long: computed by the system, in UTC
 *  minutes of each day (times are compared as the instants they are). */
export function freeSlots(busy: { start: number; end: number }[], from: number, to: number, hours: [string, string], len: number): { start: string; end: string }[] {
  if (!(to - from <= FREE_DAYS * 86_400_000)) throw new RangeError(`within: at most ${FREE_DAYS} days to look for free time in`);
  if (!HOUR.test(hours[0]) || !HOUR.test(hours[1])) throw new RangeError('hours: two times of day, as HH:MM, e.g. ["08:00", "16:00"]');
  const [h0, m0] = hours[0].split(':').map(Number), [h1, m1] = hours[1].split(':').map(Number);
  const spans = [...busy].filter(b => b.end > from && b.start < to).sort((a, b) => a.start - b.start);
  const out: { start: string; end: string }[] = [];
  for (let d = new Date(new Date(from).toISOString().slice(0, 10) + 'T00:00:00Z').getTime(); d < to; d += 86_400_000) {
    const day0 = Math.max(d + (h0 * 60 + m0) * 60_000, from), day1 = Math.min(d + (h1 * 60 + m1) * 60_000, to);
    let t = day0;
    for (const b of spans) { if (b.end <= t || b.start >= day1) continue; if (b.start - t >= len * 60_000) out.push({ start: new Date(t).toISOString(), end: new Date(b.start).toISOString() }); t = Math.max(t, b.end); }
    if (day1 - t >= len * 60_000) out.push({ start: new Date(t).toISOString(), end: new Date(day1).toISOString() });
  }
  return out;
}
/** Events moved by hand (planned: key → new start, and end): each a copy at its new time that remembers where it was
 *  (planned_from) and the row it was made from; with clashes, the events it now overlaps. The rows themselves are kept. */
function planOf(rows: Row[], p: PanelSpec, m: Record<string, string>): Row[] {
  const plan = (p.planned ?? {}) as Record<string, { start: string; end?: string }>;
  if (!Object.keys(plan).length || !m.start) return rows;
  const key = rowKey(rows);
  const moved = rows.map(r => {
    const pl = plan[key(r)]; if (!pl) return r;
    if (!Number.isFinite(Date.parse(pl.start))) throw new Error(`planned: "${pl.start}" is not a time`);
    const dur = Date.parse(String(r[m.end] ?? r[m.start])) - Date.parse(String(r[m.start]));
    const end = pl.end ?? (Number.isFinite(dur) ? new Date(Date.parse(pl.start) + dur).toISOString() : undefined);
    const x: Row = { ...r, [m.start]: pl.start, ...(m.end && end ? { [m.end]: end } : {}), planned_from: r[m.start] };
    Object.defineProperty(x, SOURCE, { value: r, enumerable: false });
    return x;
  });
  const span = (r: Row) => [Date.parse(String(r[m.start])), Date.parse(String((m.end && r[m.end]) ?? r[m.start]))] as const;
  return moved.map(x => {
    if (x.planned_from === undefined) return x;
    const [a, b] = span(x);
    const clashes = moved.filter(y => y !== x && (() => { const [c, d] = span(y); return a < d && c < b; })()).map(y => asText(y[m.title] ?? key(y)));
    if (clashes.length) x.clashes = clashes;
    return x;
  });
}
/** An event moved by hand to a new time (by its key or place): kept in the panel's plan. */
const plan: CardAction = { about: 'plan moves events in a calendar', run: (p, rows, a, where) => {
  if (!rows.length) return { refusal: `${where} has no events to move` };
  const found = rowAt(rows.map(sourceRow), a, 'event', where); if ('refusal' in found) return found;
  const { at, keys } = found;
  if (!a.start || !Number.isFinite(Date.parse(a.start)) || (a.end !== undefined && !(Date.parse(a.end) > Date.parse(a.start)))) return { refusal: 'plan needs start, a time (ISO 8601), and an end after it if you give one' };
  p.planned = { ...((p.planned ?? {}) as Record<string, unknown>), [keys[at]]: { start: a.start, ...(a.end ? { end: a.end } : {}) } };
  return { what: `moved ${rowLabel(rows[at], keys[at])} to ${a.start} in ${where} (a plan, not saved)`, mark: 'Planned by hand, not saved' };
} };
/** An event a plan made clash: a free time for it is what to look for next. */
const clashCue: CardDef['suggest'] = (rows, _p, where) => {
  const clash = rows.find(r => Array.isArray(r.clashes) && r.clashes.length);
  return clash ? [{ label: 'Find a free time', prompt: `In ${where}, ${asText(clash[Object.keys(clash).find(k => /^(title|summary|subject|name)$/i.test(k)) ?? ''] ?? 'an event moved by hand')} now overlaps ${(clash.clashes as string[]).join(', ')}. Find a time for it that clashes with nothing.` }] : [];
};
/** What a plan changes, as a change set an operation can take (before and after), and where it clashes. */
function planAccount(rows: Row[], m: Record<string, string>): Record<string, unknown> {
  const key = rowKey(rows.map(sourceRow));
  const moved = rows.filter(r => r.planned_from !== undefined);
  return { planned: `${moved.length} moved by hand in the window, not saved: to save, run the operation that saves events with these changes, which asks the person`,
    changes: moved.map(r => ({ key: key(sourceRow(r)), ...(m.title ? { title: r[m.title] } : {}), before: { start: r.planned_from }, after: { start: r[m.start], ...(m.end ? { end: r[m.end] } : {}) } })),
    ...(moved.some(r => r.clashes) ? { clashes: moved.filter(r => r.clashes).map(r => `${asText(r[m.title] ?? '')} overlaps ${(r.clashes as string[]).join(', ')}`) } : {}) };
}

export const EVENTS = block({
  name: 'events', component: 'VEvents', about: 'events: an agenda by day, a week of columns by hour, or the free time between them (layout free, with within and hours)',
  roles: EV, layouts: ['agenda', 'week', 'free'],
  fields: { within: z.object({ from: z.string(), to: z.string() }).optional().describe('events, layout free: the range to find free time in, ISO dates or times'),
    hours: z.array(z.string()).optional().describe('events, layout free: the day\'s hours to look in, e.g. ["08:00", "16:00"] (UTC); default 08:00 to 16:00'),
    length: z.string().optional().describe('events, layout free: the least free time worth showing, e.g. "30m" or "1h"; default 30m') },
  check: (rows, p, m) => needOne(m, ['start'], 'an event', rows) ?? (p.layout === 'free' && !p.within ? 'layout free needs within: {"from": …, "to": …}' : null),
  rows: (rows, p, m) => {
    const out = [...planOf(rows, p, m)].sort((a, b) => String(a[m.start]).localeCompare(String(b[m.start])));
    if (p.layout !== 'free') return out;
    const w = p.within as { from: string; to: string }; const [h0 = '08:00', h1 = '16:00'] = (p.hours as string[] | undefined) ?? []; // each left out: its default
    const length = asText(p.length ?? '30m'), len = minutes(length); if (len === null) throw new Error(`length "${length}": write it as 30m or 1h`);
    const from = Date.parse(w.from), to = Date.parse(w.to.length === 10 ? `${w.to}T23:59:59Z` : w.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('within: from and to must be dates or times, from before to');
    const busy = rows.map(r => ({ start: Date.parse(String(r[m.start])), end: Date.parse(String(r[m.end] ?? r[m.start])) })).filter(b => Number.isFinite(b.start) && Number.isFinite(b.end));
    // the rows it was given are checked, not the free spans
    return { rows: freeSlots(busy, from, to, [h0, h1], len).map(s => ({ free: true, start: s.start, end: s.end })), checkRows: rows };
  },
  props: p => (p.layout === 'free' ? { map: { start: 'start', end: 'end' } } : {}),
  derived: ['planned_from', 'clashes'], actions: { plan }, suggest: clashCue, words: w => ({ ...w.events }),
  account: (rows, p, m) => (p.layout !== 'free' && p.planned && Object.keys(p.planned).length ? { events: rows.length, ...planAccount(rows, m) } : p.layout === 'free' ? { free: `computed by the system from the busy events: ${rows.length} free spans of at least ${asText(p.length ?? '30m')}, ${(p.hours as string[] | undefined)?.join('–') ?? '08:00–16:00'} UTC` } : { events: rows.length }),
});
