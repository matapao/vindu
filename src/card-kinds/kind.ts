// What a kind of card does, from its data to what the window draws and the model is told. Each built-in card is one
// (rows.ts, charts.ts, values.ts, frames.ts), and so is every card a host adds (host.ts). The view, the compiler, the
// account, the window's read-back and a host's own drawing ask a panel's kind (registry.ts), never its card's name;
// a hook a kind leaves out does what a card of rows does.
import type { Component, Probe } from '../a2ui.js';
import type { CardDef, CardFileRead, PanelSpec, Resolved, Suggestion, ViewSpec } from '../cards.js';
import { plainList } from '../format.js';
import type { PanelPresentation } from '../presentation.js';
import type { Entry, Row } from '../results.js';
import { Refusal, type ViewContext } from '../view-context.js';
import type { ViewWords } from '../view-words.js';
import type { DrawnCells } from './cells.js';

/** What a card draws itself with: its part of the data model, components it adds below its title, the window it is for. */
export type DrawKit = {
  pid: string;                                           // the id its components and its data live under
  model: Record<string, unknown>;                        // its part of the data model, at /panels/<pid>
  add: (c: Component) => string;                         // a component; its id, made unique
  text: (id: string, t: unknown, variant?: string, weight?: number) => string;
  list: (cells: string[], item?: 'Row' | 'Column') => string; // its rows (at /panels/<pid>/rows), each drawn with these cells
  cell: (v: unknown, field?: string) => string;          // a value as the person reads it, in the window's locale
  compact: boolean; locale: string; timeZone: string;
  words: ViewWords;                                      // the words the view is drawn in (view-words.ts)
};
/** What a card's account is read from: its part of the data model, as drawn wide and as drawn narrow. */
export type AccountKit = { model: Record<string, unknown>; narrow: Record<string, unknown> };
/** A value the window reads back after it draws (a2ui.ts), without the tab, which the view says. */
export type CardProbe = Omit<Probe, 'tab'>;
/** What a card shows of the rows once they are shaped, when not the rows themselves, and the step that made it. */
type CardResult = Pick<Resolved, 'rows' | 'record' | 'value'> & { step?: Record<string, unknown> };

export type CardKind = {
  /** The fields of a panel it reads, besides where its data comes from; any other is told back as ignored. */
  reads: string[];
  /** A card that draws something other than rows (a picture, a page, a file, an app): what it shows, before any result is read. */
  own?: (p: PanelSpec, view: ViewSpec, ctx: ViewContext) => Resolved;
  /** A card of one value: what it shows straight from its result or the panel (text; a number typed), when it can. */
  direct?: (p: PanelSpec, e: Entry | undefined) => Resolved | undefined;
  /** An object it is given is one row, whatever lists it holds. */
  one?: boolean;
  /** Its data is the one object it shows, as sent: never read as {columns, rows}. */
  keepsData?: boolean;
  /** Why it cannot show one row per group, where it cannot. */
  noGroup?: (p: PanelSpec) => string;
  /** After a group: the panel set to show the value computed for each (a chart's x and y; by default, a table's columns). */
  grouped?: (p: PanelSpec, group: string, field: string, notes: string[]) => void;
  /** Fields it finds itself before its rows are shaped (a list's label, a timeline's time). */
  infer?: (p: PanelSpec, rows: Row[], notes: string[]) => void;
  /** Its rows in its own order, when no sort is given (a timeline's: in time). */
  order?: (rows: Row[], p: PanelSpec) => Row[];
  /** What it shows of the shaped rows, when not the rows themselves (a record's first row, a kpi's value). */
  result?: (rows: Row[], p: PanelSpec, inputs: Record<string, number>) => CardResult;
  /** Rows shaped by the card itself (a host's card or a block), and rows it makes without a source (see CardDef). */
  rows?: CardDef['rows'];
  source?: CardDef['source'];
  /** It draws its rows as cells by A1 address (a table, a sheet): the cells it draws of the resolved rows. A card that
   *  has it reads a data file (CSV, TSV or JSON) as rows, and takes the model's notes on its cells. */
  cells?: (p: PanelSpec, d: Resolved) => DrawnCells;
  /** It reads a workbook (.xlsx) too, a tab for each of its sheets (a sheet). */
  workbooks?: true;
  /** A file the panel names that the card reads itself (a document's Markdown): its rows, and which file it is;
   *  undefined when the panel names none. */
  file?: (p: PanelSpec, e: Entry | undefined, ctx: ViewContext) => { rows: Row[]; file: CardFileRead } | undefined;
  /** Its own check of the resolved data, after the checks every card of rows has: null when it fits. */
  check?: (p: PanelSpec, d: Resolved) => string | null;
  /** What the model sent without a source is its own, and marked so; false for what is never the model's words (a file,
   *  a picture, a page or an app it points at). */
  typed?: false;
  /** Drawn in a frame of its own (a page, a file, an app), which fills its pane when it is alone there. */
  framed?: true;
  /** Drawn side by side with the cards of its kind next to it, on a wide window (kpis). */
  sideBySide?: true;
  /** What the account says its data is from when the panel names no result (media: an attachment). */
  origin?: string;
  /** The props a host's component is drawn with: its fixed ones, and what its shaping worked out. */
  props?: (p: PanelSpec, d: Resolved) => Record<string, unknown> | undefined;
  /** The components it adds below its title, in order. */
  draw: (p: PanelSpec, d: Resolved, kit: DrawKit) => string[];
  /** What its account says, besides what every panel's says. */
  account?: (o: Record<string, unknown>, p: PanelSpec, d: Resolved, kit: AccountKit) => void;
  /** The values the window reads back after it draws. */
  probes?: (p: PanelSpec, d: Resolved, model: Record<string, unknown>, pid: string) => CardProbe[];
  /** At most this many rows go to a host's own drawing (presentation.ts). */
  maxRows?: number;
  /** The fields a host's own drawing gets of each row, when not the fields it shows; each row is cut to them. */
  presentFields?: (rows: Row[], p: PanelSpec, d: Resolved) => string[];
  /** What else a host's own drawing gets of it (a chart's axes). */
  present?: (out: PanelPresentation, p: PanelSpec, d: Resolved) => void;
  /** What the system noticed in its rows that usually means a next step, offered to the person. */
  suggest?: (rows: Row[], p: PanelSpec, where: string) => Omit<Suggestion, 'by'>[];
};

/** The parts of a panel's resolved data a card is drawn from, each as its own() or the resolving of its rows gives it. */
const PARTS = {
  rows: 'its rows, a list of objects',
  record: 'the one object it shows',
  media: 'the file it shows or plays, {name, mime, url}',
  gallery: 'its pictures and videos, a list of {name, mime, url}',
  page: 'the page in its frame, {url, label, uses, height}',
  code: 'the file it shows, {path, language, lines}',
  pdf: 'the PDF it shows, {name, bytes}',
  app: 'the MCP App in its frame, {server, tool, result, uri, url, height}',
} as const;
type DrawnPart = keyof typeof PARTS;
const LISTS: ReadonlySet<DrawnPart> = new Set(['rows', 'gallery']);
/** The part of its resolved data a card draws. Data resolved for another card, or by a host in another shape, is
 *  refused with what the card needs, rather than failing deep in its drawing. */
export function drawnFrom<K extends DrawnPart>(p: PanelSpec, d: Resolved, part: K): NonNullable<Resolved[K]> {
  const v: unknown = d[part];
  const fits = LISTS.has(part) ? Array.isArray(v) : !!v && typeof v === 'object' && !Array.isArray(v);
  if (!fits) throw new Refusal(`panel ${p.id}: a ${p.card} needs "${part}" in its resolved data: ${PARTS[part]}`);
  return v as NonNullable<Resolved[K]>;
}

/** A value that holds lists or objects, which a cell would show as raw text. */
export const nested = (v: unknown) => v !== null && typeof v === 'object' && !plainList(v);
/** Why a card that shows its rows as they are cannot show one per group. */
export const rowsAsTheyAre = (p: PanelSpec) =>
  `a ${p.card} shows rows as they are, and group makes one row per value of "${p.group}" with a number computed for each: send a table or a bar-chart with the same group and value`;
