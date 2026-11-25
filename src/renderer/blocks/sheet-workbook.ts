// A workbook's sheets in a sheet card, in the window (workbook-file.ts sends them): a tab for each sheet, in a tab list
// the arrow keys, Home and End move along, and each cell as Excel shows it: a date, a time or both as the window's
// locale writes them, a percentage or a number with its decimals, a boolean in the view's words, and a formula's value
// with the formula itself as its title. Merged cells span their rows and columns. What the server sends is read as
// untrusted JSON: anything else is left out.
import { html } from 'lit';
import type { SheetWords } from '../../block-words.js';
import { formatCell, type BlockProps } from './shared.js';

/** How a cell is drawn besides its value, as the server sends it. */
export type Look = { format?: string; decimals?: number; seconds?: boolean; formula?: string };
/** A span of merged cells: how many rows and columns its top left cell takes. */
type Span = { rows: number; columns: number };
/** A sheet as a tab: its name, its fields, where its rows are among those drawn (start, count) and among the panel's
 *  (first), how many rows and columns it has, its header's looks, and its merged cells by "row:column" (-1 the header):
 *  the spans of their top left cells, and the cells they cover, which are not drawn. */
export type Tab = { name: string; fields: string[]; start: number; count: number; first: number; rows: number; columns: number; head: (Look | null)[];
  spans: Map<string, Span>; covered: Set<string> };
type TabbedElement = HTMLElement & { requestUpdate(): void; updateComplete: Promise<unknown> };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
function parsed(v: unknown): unknown {
  if (typeof v !== 'string') return undefined;
  try { return JSON.parse(v); } catch { return undefined; }
}
/** A row's looks: a JSON list with a look or null for each of its cells. */
export function looksOf(v: unknown): (Look | null)[] {
  const list = parsed(v);
  return Array.isArray(list) ? list.map(x => (isObject(x) ? x as Look : null)) : [];
}
/** The merges of a tab, as [row, column, rows, columns] lists in JSON. */
function mergesOf(v: unknown): { spans: Map<string, Span>; covered: Set<string> } {
  const spans = new Map<string, Span>(), covered = new Set<string>(), list = parsed(v);
  for (const m of Array.isArray(list) ? list : []) {
    if (!Array.isArray(m) || m.length !== 4 || !m.every(n => Number.isInteger(n))) continue;
    const [row, column, rows, columns] = m as number[];
    if (rows < 1 || columns < 1 || rows * columns > 100_000) continue;
    spans.set(`${row}:${column}`, { rows, columns });
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) if (r || c) covered.add(`${row + r}:${column + c}`);
  }
  return { spans, covered };
}
/** The tabs of a workbook's cells, or undefined for cells that are not a workbook's. */
export function tabsOf(cells: { sheets?: unknown }): Tab[] | undefined {
  if (!Array.isArray(cells.sheets) || !cells.sheets.length) return undefined;
  return cells.sheets.filter(isObject).map(s => ({
    name: typeof s.name === 'string' ? s.name : '', fields: Array.isArray(s.fields) ? s.fields.map(String) : [],
    start: count(s.start), count: count(s.count), first: count(s.first), rows: count(s.rows), columns: count(s.columns),
    head: looksOf(s.head), ...mergesOf(s.merges),
  }));
}

const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
/** A date, a time or both as the locale writes them: as they are in the file, in no time zone. */
function whenText(v: string, look: Look, locale: string): string {
  const time = { timeStyle: look.seconds ? 'medium' : 'short', timeZone: 'UTC' } as const;
  const t = TIME.exec(v), d = DAY.exec(v);
  try {
    if (t) return new Intl.DateTimeFormat(locale, time).format(Date.UTC(1970, 0, 1, Number(t[1]), Number(t[2]), Number(t[3] ?? 0)));
    if (!d) return v;
    const at = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(d[4] ?? 0), Number(d[5] ?? 0), Number(d[6] ?? 0));
    return new Intl.DateTimeFormat(locale, d[4] ? { dateStyle: 'medium', ...time } : { dateStyle: 'medium', timeZone: 'UTC' }).format(at);
  } catch { return v; }
}
/** Whether a look draws its value as a date or a time. */
export const isWhen = (look: Look | null | undefined) => look?.format === 'date' || look?.format === 'time' || look?.format === 'datetime';
/** A workbook's cell as Excel shows it, in the window's locale and the view's words. */
export function lookText(props: BlockProps, v: unknown, look: Look | null | undefined, field: string, words: SheetWords): string {
  const locale = props.locale ?? 'en-GB', decimals = Math.min(Math.max(count(look?.decimals), 0), 10);
  if (typeof v === 'boolean') return v ? words.true : words.false;
  if (look && isWhen(look) && typeof v === 'string') return whenText(v, look, locale);
  if (look?.format === 'percent' && typeof v === 'number') return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
  if (look?.format === 'fixed' && typeof v === 'number') return v.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return formatCell(props, v, field);
}

/** The tab each sheet card shows, by its element; the first to start with. */
const chosen = new WeakMap<HTMLElement, number>();
const ids = new WeakMap<HTMLElement, string>();
let made = 0;
/** The id a sheet card's tabs and their panel go by, its own in the document. */
export function tabsId(element: HTMLElement): string {
  let id = ids.get(element);
  if (!id) { id = `vb-sheet-${++made}`; ids.set(element, id); }
  return id;
}
/** The tab shown of a sheet card with this many. */
export const tabShown = (element: HTMLElement, tabs: number) => Math.min(chosen.get(element) ?? 0, Math.max(0, tabs - 1));

/** The tab list: a button for each sheet, by its name; the one shown is selected and takes the focus with Tab. */
export function tabList(element: HTMLElement, tabs: Tab[], at: number, words: SheetWords) {
  const id = tabsId(element), card = element as TabbedElement;
  const show = (k: number, focus: boolean) => {
    chosen.set(element, k);
    card.requestUpdate();
    if (focus) void card.updateComplete.then(() => element.querySelector<HTMLElement>(`#${id}-tab-${k}`)?.focus());
  };
  const key = (e: KeyboardEvent) => {
    const n = tabs.length, moves: Record<string, number> = { ArrowRight: (at + 1) % n, ArrowLeft: (at - 1 + n) % n, Home: 0, End: n - 1 };
    if (!Object.hasOwn(moves, e.key)) return;
    e.preventDefault();
    show(moves[e.key], true);
  };
  return html`<div class="vb-sheettabs" role="tablist" aria-label=${words.sheets} @keydown=${key}>${tabs.map((t, k) =>
    html`<button type="button" role="tab" class="vb-sheettab" id=${`${id}-tab-${k}`} aria-selected=${k === at ? 'true' : 'false'} aria-controls=${`${id}-panel`}
      tabindex=${k === at ? '0' : '-1'} @click=${() => show(k, false)}>${t.name}</button>`)}</div>`;
}
