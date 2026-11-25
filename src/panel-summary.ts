// What a panel holds, in one line, for a window that shows views as cards (the shell's own, or a host's): a kpi's value,
// a table's rows and what they add up to (the totals the panel declares, else its amounts: a column it computes before
// one it was given, and never a rate or a price per unit), a record's name or number, a mail's To and subject, a calendar's
// next event and how many there are, a list of tasks' open ones and the next due, an invoice's total due, a chart's
// last value and its direction, a forecast's next day, the most severe of some warnings, a PDF's pages once known.
// Written in the view's words and its locale, as its cards are drawn; worked out by the system from what the panel shows.
import { wordWith } from './block-words.js';
import type { PanelSpec, Resolved } from './cards.js';
import { dayOf } from './dates.js';
import { asText, cellIn, ellipsis, moneyIn, whenIn } from './format.js';
import type { Row } from './results.js';
import type { ViewWords } from './view-words.js';
import { dailyWeather, instantsOf, warningsOf, weatherSign, worstWarning } from './weather.js';

/** A panel as its card says it: what it is (its card), its title, one line of what it holds, and a picture where one
 *  says more (a media panel's, or a gallery's first), at the address the window loads it from. */
export type PanelSummary = { kind: string; title: string; line: string; thumbnail?: string };
/** What a line is written with: the view's locale, time zone and words, the view's own title for a panel without one,
 *  and the time it is now (the next event is the first from then on). */
export type SummaryKit = { locale: string; timeZone: string; words: ViewWords; title: string; now?: number };
type Line = (p: PanelSpec, d: Resolved, kit: SummaryKit) => string | undefined;

const DONE = /^(done|completed?|closed|resolved|true|yes|ferdig|finished)$/i;
/** A field of amounts, which add up: amount, total, sum, balance, cost, paid, beløp, saldo, kostnad, betalt. */
const AMOUNT = /(amount|total|sum(?![a-z])|balance|cost|paid|bel[øo]p|saldo|kostnad|betalt)/i;
/** A field of rates or prices per unit, which never add up (a price alone is not an amount either): rate, sats, per_…,
 *  unit price, enhetspris, timepris, timesats. */
const RATE = /(rate|sats|(^|_)per(_|$)|unit|enhet|time(pris|sats))/i;
const RATE_CAMEL = /Per([A-Z]|$)/;
const isAmount = (field: string) => AMOUNT.test(field) && !RATE.test(field) && !RATE_CAMEL.test(field);
const CURRENCY = /^(currency|ccy|valuta)$/i;
const SUFFIX = /_(nok|sek|dkk|eur|usd|gbp|chf|jpy|isk|pln|cad|aud)$/i;
const NAME = /(^|_)(name|title|navn|tittel|subject|label)$/i;
const NUMBER = /((^|_)(no|nr|number|nummer|id|ref)$|nr$)/i;

/** "12 rows", or "1 row": a count in the view's words, its number as the locale writes it. */
const counted = (kit: SummaryKit, n: number, many: string, one: string) => (n === 1 ? one : wordWith(many, { count: cellIn(n, undefined, kit.locale) }));
const roleOf = (d: Resolved, role: string): string | undefined => ((d.shaped?.props?.map ?? {}) as Record<string, string>)[role];
const timeOf = (v: unknown) => Date.parse(asText(v ?? ''));
const firstLine = (text: string) => ellipsis(text.trim().split(/\n/)[0] ?? '', 100);
const degrees = (kit: SummaryKit, n: number) => `${cellIn(Math.round(n), undefined, kit.locale)}°`;

/** The day a forecast or a list of events is next on, as the locale names it: "Thu 26 Nov". */
const dayName = (kit: SummaryKit, day: string) =>
  new Intl.DateTimeFormat(kit.locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** A forecast's next day (from today on, in the view's time zone): its symbol, and its lowest and highest temperature. */
function forecastLine(value: unknown, kit: SummaryKit): string | undefined {
  const days = [...dailyWeather(instantsOf(value), kit.timeZone)].sort(([a], [b]) => a.localeCompare(b));
  if (!days.length) return undefined;
  const today = dayOf(new Date(kit.now ?? Date.now()).toISOString(), kit.timeZone) ?? '';
  const [day, weather] = days.find(([d]) => d >= today) ?? days[days.length - 1];
  const sign = weather.symbol ? weatherSign(weather.symbol) : '';
  const span = weather.min !== undefined && weather.max !== undefined
    ? wordWith(kit.words.summary.span, { min: degrees(kit, weather.min), max: degrees(kit, weather.max) })
    : '';
  return `${dayName(kit, day)}: ${[sign, span].filter(Boolean).join(' ')}`;
}
/** The most severe of some warnings: its level, its area and when it begins. */
function warningLine(value: unknown, kit: SummaryKit): string | undefined {
  const worst = worstWarning(warningsOf(value));
  if (!worst) return undefined;
  const w = kit.words.summary;
  const from = worst.from ? wordWith(w.from, { when: whenIn(worst.from, kit.locale, kit.timeZone) }) : '';
  return [w[worst.level], worst.area ?? worst.title ?? '', from].filter(Boolean).join(' · ');
}
/** The currency of a money column: the rows' own (one for all), or the one its name ends in (amount_nok). */
function currencyOf(rows: Row[], field: string): string | undefined {
  const named = Object.keys(rows[0] ?? {}).find(k => CURRENCY.test(k));
  const given = named ? new Set(rows.map(r => asText(r[named] ?? ''))) : new Set<string>();
  if (given.size === 1) { const [c] = given; if (/^[A-Z]{3}$/.test(c)) return c; }
  return SUFFIX.exec(field)?.[1].toUpperCase();
}
/** A table's amounts added up, with their currency: the first field named as an amount whose values are numbers, one
 *  the panel computes before one it was given. */
function moneyTotal(rows: Row[], p: PanelSpec, kit: SummaryKit): string | undefined {
  const computed = Object.keys(p.compute ?? {});
  const fields = [...new Set([...computed, ...rows.flatMap(r => Object.keys(r))])];
  const field = fields.find(f => isAmount(f) && rows.some(r => typeof r[f] === 'number') && rows.every(r => r[f] === undefined || r[f] === null || typeof r[f] === 'number'));
  if (!field) return undefined;
  const sum = Number(rows.reduce((a, r) => a + (typeof r[field] === 'number' ? r[field] : 0), 0).toPrecision(15));
  return wordWith(kit.words.summary.total, { amount: moneyIn(sum, currencyOf(rows, field), kit.locale) });
}
type DeclaredTotal = { label: string; values: { scenario: string | null; value: unknown }[] };
/** The first total a panel declares (a sheet's totals), as it labels it: its value, or each scenario's. */
function declaredTotal(d: Resolved, kit: SummaryKit): string | undefined {
  const totals = (d.shaped?.props?.sheet as { totals?: DeclaredTotal[] } | undefined)?.totals ?? [];
  const first = totals.find(t => t.values.some(v => typeof v.value === 'number'));
  if (!first) return undefined;
  const each = first.values
    .filter(v => typeof v.value === 'number')
    .map(v => [v.scenario, cellIn(v.value, first.label, kit.locale)].filter(Boolean).join(' '));
  return `${first.label} ${each.join(' / ')}`;
}
/** Rows: a forecast, some warnings, or how many there are and what they add up to: the totals the panel declares, else
 *  its amounts. */
function rowsLine(rows: Row[], p: PanelSpec, d: Resolved, kit: SummaryKit): string {
  const told = forecastLine(rows, kit) ?? warningLine(rows, kit);
  if (told) return told;
  const w = kit.words.summary;
  return [counted(kit, rows.length, w.rows, w.row), declaredTotal(d, kit) ?? moneyTotal(rows, p, kit)].filter(Boolean).join(' · ');
}
/** A record's name, else its number, else its first value. */
function recordLine(record: Row, kit: SummaryKit): string {
  const fields = Object.keys(record).filter(k => record[k] !== null && record[k] !== undefined && record[k] !== '');
  const field = fields.find(k => NAME.test(k)) ?? fields.find(k => NUMBER.test(k)) ?? fields[0];
  return field ? cellIn(record[field], field, kit.locale) : '';
}
/** Which way a line went at its end: up, down or level. */
function direction(kit: SummaryKit, last: number, before: number | undefined): string {
  const w = kit.words.summary;
  if (before === undefined || last === before) return w.level;
  return last > before ? w.up : w.down;
}

const LINES: Record<string, Line> = {
  kpi: (p, d, kit) => cellIn(d.value, (p.value ?? '').replace(/[()]/g, ' ').trim().replace(/\s+/g, '_'), kit.locale),
  'line-chart': (p, d, kit) => {
    const rows = d.rows ?? [], y = [p.y ?? ''].flat()[0];
    const weather = forecastLine(rows, kit);
    if (weather) return weather;
    const values = rows.map(r => r[y]).filter((v): v is number => typeof v === 'number');
    if (!values.length) return undefined;
    const last = values[values.length - 1];
    return `${wordWith(kit.words.summary.last, { value: cellIn(last, y, kit.locale) })} · ${direction(kit, last, values.at(-2))}`;
  },
  'bar-chart': (p, d, kit) => {
    const x = p.x ?? '', y = [p.y ?? ''].flat()[0];
    const top = [...(d.rows ?? [])].filter(r => typeof r[y] === 'number').sort((a, b) => (b[y] as number) - (a[y] as number))[0];
    return top ? wordWith(kit.words.summary.highest, { what: `${asText(top[x])} ${cellIn(top[y], y, kit.locale)}` }) : undefined;
  },
  events: (_p, d, kit) => {
    const rows = d.rows ?? [], start = roleOf(d, 'start'), title = roleOf(d, 'title'), w = kit.words.summary;
    const count = counted(kit, rows.length, w.events, w.event);
    if (!start || d.shaped?.props?.layout === 'free') return count;
    const now = kit.now ?? Date.now();
    const next = [...rows].sort((a, b) => timeOf(a[start]) - timeOf(b[start])).find(r => timeOf(r[start]) >= now);
    if (!next) return count;
    const what = [title ? asText(next[title] ?? '') : '', whenIn(next[start], kit.locale, kit.timeZone)].filter(Boolean).join(', ');
    return `${wordWith(w.next, { what })} · ${count}`;
  },
  tasks: (_p, d, kit) => {
    const rows = d.rows ?? [], state = roleOf(d, 'state'), due = roleOf(d, 'due'), title = roleOf(d, 'title') ?? '', w = kit.words.summary;
    const open = rows.filter(r => !state || !DONE.test(asText(r[state] ?? '')));
    if (!open.length) return w.allDone;
    const next = due ? [...open].filter(r => r[due]).sort((a, b) => asText(a[due]).localeCompare(asText(b[due])))[0] : undefined;
    const nextDue = next && due ? wordWith(w.nextDue, { date: whenIn(next[due], kit.locale, kit.timeZone, false), what: asText(next[title] ?? '') }) : '';
    return [wordWith(w.open, { count: cellIn(open.length, undefined, kit.locale) }), nextDue].filter(Boolean).join(' · ');
  },
  message: (_p, d, kit) => {
    const w = kit.words.summary, draft = d.shaped?.props?.draft as { state?: string; fields?: { to?: string[]; subject?: string } } | undefined;
    if (draft) {
      const to = wordWith(w.to, { to: (draft.fields?.to ?? []).join(', ') });
      return [to, draft.fields?.subject || w.noSubject, draft.state === 'sent' ? w.sent : ''].filter(Boolean).join(' · ');
    }
    const rows = d.rows ?? [], subject = roleOf(d, 'subject') ?? roleOf(d, 'body') ?? '';
    const first = ellipsis(asText(rows[0]?.[subject] ?? ''), 80);
    return rows.length === 1 ? first : [counted(kit, rows.length, w.messages, w.message), first].filter(Boolean).join(' · ');
  },
  money: (_p, d, kit) => {
    const props = d.shaped?.props ?? {}, currency = asText(props.currency ?? '') || undefined;
    if (props.layout === 'payment') { const amount = roleOf(d, 'amount'); return amount ? moneyIn(d.rows?.[0]?.[amount], currency, kit.locale) : undefined; }
    const total = (props.totals as { total?: number } | undefined)?.total;
    return total === undefined ? undefined : wordWith(kit.words.summary.due, { amount: moneyIn(total, currency, kit.locale) });
  },
  batch: (_p, d, kit) => {
    const rows = d.rows ?? [], n = (outcome: string) => cellIn(rows.filter(r => r.outcome === outcome).length, undefined, kit.locale);
    return [wordWith(kit.words.batch.ok, { count: n('ok') }), wordWith(kit.words.batch.failed, { count: n('failed') })].join(' · ');
  },
  notice: (_p, d, kit) => warningLine(d.rows ?? [], kit) ?? firstLine(asText(d.rows?.[0]?.[roleOf(d, 'text') ?? ''] ?? '')),
};

/** The picture a panel's card shows: a media panel's own, or a gallery's first picture. */
function thumbnailOf(d: Resolved): string | undefined {
  if (d.media && d.media.mime.startsWith('image/')) return d.media.url;
  return d.gallery?.find(item => item.mime.startsWith('image/'))?.url;
}
/** One line of what a panel's data says, as its kind says it, or as any card of rows, a record, text or a file does. */
function lineOf(p: PanelSpec, d: Resolved, kit: SummaryKit): string {
  const w = kit.words.summary;
  if (d.failed !== undefined) return wordWith(w.failed, { why: ellipsis(d.failed, 80) });
  if (d.waiting) return w.waiting;
  const own = Object.hasOwn(LINES, p.card) ? LINES[p.card](p, d, kit) : undefined;
  if (own !== undefined) return own;
  if (d.rows) return rowsLine(d.rows, p, d, kit);
  if (d.record) return recordLine(d.record, kit);
  if (d.text !== undefined) return firstLine(d.text);
  if (d.value !== undefined) return cellIn(d.value, undefined, kit.locale);
  if (d.gallery) return counted(kit, d.gallery.length, w.items, w.item);
  if (d.pdf) return d.pdf.pages ? counted(kit, d.pdf.pages, w.pages, w.page) : d.pdf.name;
  if (d.media) return d.media.name;
  if (d.code) return d.code.path;
  if (d.app) return d.app.tool;
  return d.page?.label ?? '';
}

/** A panel as its card says it, in a line. */
export function panelSummaryOf(p: PanelSpec, d: Resolved, kit: SummaryKit): PanelSummary {
  const thumbnail = d.failed === undefined && !d.waiting ? thumbnailOf(d) : undefined;
  return { kind: d.waiting?.card ?? p.card, title: p.title ?? kit.title, line: lineOf(p, d, kit), ...(thumbnail ? { thumbnail } : {}) };
}
