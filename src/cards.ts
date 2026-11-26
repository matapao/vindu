// The cards a view can use, as data. The boundary schema (Zod) says what a panel may contain; what each card does with
// it, from its data to what is drawn and told, is its kind's (card-kinds/), and its check runs after the panel's data
// is resolved, which no input schema can see.
import { z } from 'zod';
import type { ViewAction } from './actions.js';
import type { Panel } from './card-schema.js';
import type { DraftContext } from './block-drafts.js';
import type { Entry, Row } from './results.js';
import type { ViewWords } from './view-words.js';

export const CARDS = ['kpi', 'table', 'list', 'record', 'timeline', 'bar-chart', 'line-chart', 'media', 'gallery', 'text', 'page', 'code', 'diff', 'pdf', 'app'] as const;
export type CardName = (typeof CARDS)[number];

/** A card a host adds. Vindu resolves its rows exactly as for the built-in cards (from, pick, where, group, sort, limit),
 *  runs the row checks and the card's own check, and binds the rows to a component the host's renderer registers. */
export type CardDef = {
  name: string;                                           // the card name the model uses
  about: string;                                          // one line for the model: what it shows
  component: string;                                      // the A2UI component registered with @matapao/vindu/renderer
  fields?: Record<string, z.ZodType>;                     // its own panel fields, each described
  shows?: (panel: PanelSpec) => string[];                 // the row fields it puts on screen, checked like a table's columns
  /** Its own check of the rows, with what its shaping worked out (rows): null when they fit, or what to send instead. */
  check?: (rows: Row[], panel: PanelSpec, shaped?: Omit<Shaped, 'rows'>) => string | null;
  props?: (panel: PanelSpec) => Record<string, unknown>;  // fixed props for the component
  account?: (rows: Row[], panel: PanelSpec) => Record<string, unknown>;
  /** The rows shaped for the card after where, group, sort and limit, with the process's other results at hand (a
   *  document's earlier version, say) and the inputs the values are computed with. What it adds is computed by the
   *  system, and its account says so: the rows, or the rows with what it worked out from them (Shaped). */
  rows?: (rows: Row[], panel: PanelSpec, read: (id: string) => Entry | undefined, context: RowsContext) => Row[] | Shaped;
  /** Rows for a panel with neither from nor data, made from other results (one row per call of a batch, say). */
  source?: (panel: PanelSpec, read: (id: string) => Entry | undefined) => Row[];
  /** Files it shows as they are (a document's Markdown): a panel that names one, with from (an attachment) or path (a
   *  file in the working folder), gets the rows made of its text instead of a result's, and its account says which file
   *  it is and whether only its start is shown. */
  file?: CardFile;
  /** An object it is given is one row, whatever lists it holds (a message with its recipients and attachments). */
  one?: boolean;
  /** Its component takes the window's locale and time zone, and the panel's id (Vindu's own blocks do). */
  context?: boolean;
  /** The words its component draws, from the words the view is drawn in (Vindu's devices: each one's state and switch).
   *  They go to it as its words prop where they are not the English ones, which its component draws by itself. */
  words?: (words: ViewWords) => Record<string, string>;
  /** Its rows are drawn as cells with A1 addresses (a sheet): it reads a data file (CSV, TSV or JSON) as rows, of which
   *  it draws at most these many rows and columns, and takes the model's notes on its cells (notes). Its component
   *  gets the cells it draws as its cells prop: their fields, the notes on them, and how many rows and columns there are. */
  cells?: { rows: number; columns: number };
  /** Actions inside a view only this card takes, by name (a calendar's plan, a deck's slide), for the person and the
   *  model alike: offered in act_in_view where a card that takes them is. */
  actions?: Record<string, CardAction>;
  /** What the system noticed in the rows that usually means a next step (a plan that clashes): offered on the pane as
   *  the system's suggestion, for the person to take into their prompt box or not. where: the panel's title. */
  suggest?: (rows: Row[], panel: PanelSpec, where: string) => { label: string; prompt: string }[];
  /** The fields of each row a host's own drawing gets (presentation.ts), given the component's props; by default those it
   *  shows. Each row is cut to them. */
  presentFields?: (rows: Row[], panel: PanelSpec, props: Record<string, unknown>) => string[];
};
/** At most this many items in a gallery. */
export const GALLERY_MOST = 40;
/** An item a gallery shows: its name, its type, where the window loads it, and what it is (an attachment's id, a
 *  result's, or work/<path>). */
export type GalleryItem = { name: string; mime: string; url: string; from: string };
/** The files a card shows as they are, read by the system: which it takes (by name, and an attachment's type), at most
 *  how many bytes of one it reads (the start of a longer one), and the rows its text makes; cut says, in words, what of
 *  that text the rows leave out (the sections past the first 100, say), and told what the panel's account says of the
 *  file besides. An error it throws is the panel's refusal. */
export type CardFile = {
  kinds: string;                                          // the files it takes, in words, for a refusal
  takes: (name: string, mime?: string) => boolean;
  most: number;
  rows: (text: string, panel: PanelSpec) => CardFileRows;
  /** Of the files it takes, those it reads whole and not as text (a Word document): which, and the rows it makes of
   *  one, given where it is on disk and its name; it reads the file itself, within limits of its own. */
  binary?: { takes: (name: string, mime?: string) => boolean; rows: (file: string, name: string, panel: PanelSpec) => CardFileRows };
};
/** The rows a card makes of a file, what of the file they leave out, and what the panel's account says of it besides. */
export type CardFileRows = { rows: Row[]; cut?: string; told?: Record<string, unknown> };
/** What a card's rows are shaped with besides them: the inputs the values are computed with, the person's own draft
 *  of the panel, where the window keeps one (a message block's draft: block-drafts.ts), and the view's time zone. */
type RowsContext = { inputs: Record<string, number>; draft?: DraftContext; timeZone?: string }; // timeZone: the view's, for what falls on which day
/** What a card's own shaping worked out besides its rows, so nothing is kept on the panel: props for its component (an
 *  invoice's totals, where nodes go), what its account adds, and the rows its check reads when not these (free time is
 *  checked against the events it was found between). */
export type Shaped = { rows: Row[]; props?: Record<string, unknown>; account?: Record<string, unknown>; checkRows?: Row[] };
/** An action a card takes: the panel's arguments changed in place, and what it did, in words for the person and the
 *  model and for the mark on the pane; or why not. about: what it does, for a panel whose card does not take it. */
export type CardAction = { about?: string; run: (panel: Record<string, unknown>, rows: Row[], a: ViewAction, where: string) => { what: string; mark: string } | { refusal: string } };

/** What every card of rows also reads: fields the system computes for each row (compute, with inputs; dates, with
 *  holidays), an order set by hand, and the row picked for the panels that follow it, or the panel it follows (detail). */
const ROWS = ['compute', 'inputs', 'dates', 'holidays', 'ordered', 'detail', 'selected'];
const chartFields = (p: PanelSpec) => [p.x!, ...[p.y!].flat()];
/** Each card: what it shows, the fields it reads and what each holds, for the model; those fields, by name; and of a
 *  card of rows, the fields it puts on screen, as the compiler chooses them. A field a card does not read is told back
 *  as ignored, never dropped in silence. What each card does is its kind's (card-kinds/). */
export const GUIDE: Record<CardName, { about: string; fields: string[]; shows?: (p: PanelSpec, rows: Row[]) => string[] }> = {
  kpi: { about: 'kpi: one number. value: count(), sum(f), avg(f), median(f), min(f) or max(f) over the rows (after where); or data: a number you worked out', fields: ['value', 'where', ...ROWS] },
  table: { about: 'table: rows. columns: the fields to show, in order (else the first 6). group + value: one row per value of a field, with value computed for each. sort, limit. A CSV, TSV or JSON file as rows: from, its attachment id, or path, the file in the working folder; the system reads it. notes: your notes on its cells, by A1 address', fields: ['columns', 'group', 'value', 'where', 'sort', 'limit', 'path', 'notes', ...ROWS],
    shows: (p, rows) => (p.columns?.length ? [...new Set(p.columns)] : rowFields(rows).slice(0, 6)) },
  list: { about: 'list: one line per row. label: a field with text', fields: ['label', 'where', 'sort', 'limit', ...ROWS], shows: p => [p.label!] },
  record: { about: 'record: one object, a line per field (the first row, after where and sort). fields: the fields to show (else the first 12)', fields: ['fields', 'where', 'sort', ...ROWS] },
  timeline: { about: 'timeline: rows in time order, oldest first. label: a field with text; time: a field with a date or time (ISO 8601, as 2026-11-02 or 2026-11-02T09:00, is in time order) or a number (in order by size). sort: "<time> desc" for newest first', fields: ['label', 'time', 'where', 'sort', 'limit', ...ROWS],
    shows: p => [p.label!, p.time!] },
  'bar-chart': { about: 'bar-chart: x, the category field, and y, a numeric field or a list of them; or group + value: one bar per value of a field', fields: ['x', 'y', 'group', 'value', 'where', 'sort', 'limit', ...ROWS], shows: chartFields },
  'line-chart': { about: 'line-chart: x, the field along the axis (dates, numbers or categories, in row order: sort by it), and y, a numeric field or a list of them; or group + value', fields: ['x', 'y', 'group', 'value', 'where', 'sort', 'limit', ...ROWS], shows: chartFields },
  media: { about: 'media: an image, video or audio. media: an attachment id, a result id that holds an image, or a file in the working folder. marks: regions of a picture or moments of a recording, each with a label', fields: ['media', 'marks'] },
  gallery: { about: `gallery: many pictures and videos at once, as tiles with their names; the person opens any one large and steps through them. media: a list of what media takes (attachment ids, result ids that hold an image, files in the working folder), at most ${GALLERY_MOST}`, fields: ['media'] },
  text: { about: 'text: plain short paragraphs. text, or from: a result that is text', fields: ['text'] },
  page: { about: 'page: a web page. path: a file in the working folder (it may end in ?query or #hash), or html: a page you write; uses: the result ids it reads; static: true for a page that runs nothing (markup, styles and pictures only; it reads no data); height in px (a page alone in its view, or alone in each tab, fills its pane)', fields: ['path', 'html', 'uses', 'static', 'height'] },
  code: { about: 'code: a file in the working folder, as code in Monaco (the VS Code editor), read-only and live as the file changes. path; line: the line to show first; height in px', fields: ['path', 'line', 'height'] },
  diff: { about: 'diff: what changed in a file in the working folder since the last commit (git HEAD), side by side in Monaco, read-only and live. path; height in px', fields: ['path', 'height'] },
  pdf: { about: 'pdf: a PDF, shown inline in its own viewer, page by page, as wide as the pane. media: a PDF attachment id (a1), or path: a PDF in the working folder; up to 50 MB; height in px', fields: ['media', 'path', 'height'] },
  app: { about: 'app: the MCP App a tool links, showing that tool\'s result. from: the result; height in px', fields: ['height'] },
};
/** The fields every card reads: where its data comes from, and its title. */
export const COMMON_FIELDS = ['card', 'title', 'id', 'from', 'pick', 'rows', 'data', 'live', 'awaits', 'after', 'follow']; // and where it waits, or reads again
/** Names other UI libraries give "from": a panel that sends one instead is read as if it said from. */
export const FROM_ALIASES = ['ref', 'source', 'result', 'record'];
const RUN = /^r(\d+)\s*-\s*r(\d+)$/;
/** How many result ids a panel lists, each run (r5-r44) counted without writing it out. */
export const countIds = (list: readonly string[]): number =>
  list.reduce((n, x) => { const m = RUN.exec(x.trim()); return n + (m ? Math.max(0, Number(m[2]) - Number(m[1]) + 1) : 1); }, 0);
/** Result ids as a panel lists them, each run written out: at most most of them, counted first, so a run too long is
 *  refused before any of it is made. */
export const resultIds = (list: readonly string[], most = 500): string[] => {
  const n = countIds(list); if (!(n <= most)) throw new RangeError(`${n} result ids: at most ${most}`);
  return list.flatMap(x => { const m = RUN.exec(x.trim()); return m ? Array.from({ length: Math.max(0, Number(m[2]) - Number(m[1]) + 1) }, (_, i) => `r${Number(m[1]) + i}`) : [x.trim()]; });
};

export type PanelSpec = z.infer<typeof Panel> & { id: string };
export type Suggestion = { label: string; prompt: string; refs?: string[]; by?: 'model' | 'system' };
export type Await = { tool: string; server?: string; input?: Record<string, unknown> };
export type After = { answered?: string; picked?: string; filled?: string };
/** What the system does by itself when something happens in a view (server.ts runs them; jobs only once the person turns them on). */
export type Hook = { label?: string;
  when: { changed?: string; crosses?: { panel: string; above?: number; below?: number }; picked?: string; answered?: string; due?: boolean };
  do: { cue?: { label: string; prompt: string }; notify?: string; read?: string; job?: { prompt: string; connectors?: string[]; writes?: boolean } } };
export type ViewSpec = { name: string; title: string; subtitle?: string; panels?: PanelSpec[]; tabs?: { title: string; panels: PanelSpec[] }[];
  after?: After;                // held until this has happened
  hooks?: Hook[];               // what the system does by itself when something happens here
  hookStates?: ('on' | 'off' | 'unavailable' | 'system' | 'idle')[]; // each hook as the person sees it: a job on or off (or jobs are off here), the system's own, or none runs here
  steps?: boolean; step?: { at: number; of: number }; // its panels one at a time: how many are shown, of how many
  suggestions?: Suggestion[];   // what to check or do next: each puts its prompt in the person's prompt box, unsent
  path?: string[];              // where a drill went: the view's own title, then each step in (a group's value), with a way back
};

export const panelsOf = (v: ViewSpec): PanelSpec[] => [...(v.panels ?? []), ...(v.tabs ?? []).flatMap(t => t.panels)];
/** The ids a view's panels go by, in order (as panelsOf lists them): each its own id, else its title, else its card,
 *  lowercase with dashes, at most 28 characters, made unique with -2, -3, …; as show_view gives them. */
export function panelIdsOf(panels: readonly { id?: unknown; title?: unknown; card?: unknown }[]): string[] {
  const used = new Set<string>();
  return panels.map(p => {
    const base = String(p.id ?? p.title ?? p.card).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'panel';
    let id = base; for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id); return id;
  });
}
/** A panel of the view by its title, or its id where it has none (or there is no such panel). */
export const panelTitle = (v: ViewSpec, id: string): string => panelsOf(v).find(p => p.id === id)?.title ?? id;
/** The id a panel's components and data live under in the surface. */
export const pidFor = (id: string) => `p_${id.replace(/[^a-zA-Z0-9]+/g, '_')}`;

/** What a panel shows once resolved, and how its data went in: where from (a reference into an entry, with the
 *  original index of every row), and each step the system applied (where, group, sort, limit), in order. */
/** On a row a block made from another (an event moved in a plan): the row it was made from, so it keeps that row's place. */
export const SOURCE = Symbol('the row this one was made from');
/** The row a row was made from, or the row itself. */
export const sourceRow = (r: Row): Row => (r as Record<symbol, Row>)[SOURCE] ?? r;
export type Resolved = {
  rows?: Row[]; record?: Row; value?: unknown; text?: string;
  media?: { name: string; mime: string; url: string };
  marks?: Row[];                     // marks on the media: regions or moments, each with a label
  gallery?: GalleryItem[];           // a gallery's pictures and videos, in order
  page?: { url: string; label: string; uses: string[]; height: number; static?: true }; // static: it runs nothing
  code?: { path: string; language: string; lines: number; line?: number; against?: string; added?: number; removed?: number; new?: boolean };
  pdf?: { name: string; bytes: number; pages?: number }; // a PDF in Vindu's own viewer (page has its address): its file's name, size and pages, once known
  /** A file the system read for the card, where it is (an attachment's id, or work/<path>) and its name: a data file the
   *  rows were read from (data-files.ts), with its format, how many rows and columns it has, and each row's own row in
   *  it (row 1 its header); or a file the card reads itself (a document's Markdown), with the bytes read of its size,
   *  and what is left out. */
  file?: DataFileRead | CardFileRead;
  app?: { server: string; tool: string; result: string; uri: string; url: string; height: number };
  src?: { id: string; pointer: string; index: Map<Row, number>; of: number; fidelity: string; digest?: string; columns?: boolean };
  steps?: Record<string, unknown>[];
  inputs?: Record<string, number>;   // the inputs the values were computed with (the person's, where they set them)
  typed?: boolean;                   // the model wrote it itself (marked so, in the window and the account)
  behind?: Map<string, number[]>;    // a grouped panel: for each group value, the indices of the source rows it stands for
  label?: string;                    // how the result it shows is classified ("Confidential"), as the host says
  newer?: string;                    // the read it shows has changed since: the newest read of the same source (marked so)
  picked?: { of: string; key: string; label: string; by: string; value: string }; // a linked panel: the row picked in the panel it follows, the field they share and its value
  follows?: string;                  // it follows its source: the read it was given, now shown at the newest
  waiting?: { card: string; for: string; again?: true }; // it waits (awaits a result, or after something): its own card, what it waits for, and whether the person may try reading it again
  failed?: string;                   // the call it waited for failed: the server's own answer
  shaped?: Omit<Shaped, 'rows'>;     // what the card's own shaping worked out besides its rows
};

/** A data file the system read as rows (data-files.ts): where it is (an attachment's id, or work/<path>), its name, its
 *  format, how many rows and columns it has, and each row's own row in it (row 1 its header). Of a workbook (.xlsx,
 *  workbook-file.ts): the worksheets shown, each a tab of the sheet card, and what its account says of the file besides. */
export type DataFileRead = { name: string; from: string; format: string; rows: number; columns: number; index: Map<Row, number>; sheets?: SheetRead[]; told?: Record<string, unknown> };
/** A worksheet a sheet card shows: its name; where its first cell, the card's A1, is in the file ("B3"); its header's
 *  fields and its rows, in order; how its cells are drawn besides their values, by their row in it (row 1 its header)
 *  and their field; and its merged cells. */
export type SheetRead = { name: string; at: string; fields: string[]; rows: Row[]; looks: Map<number, Record<string, CellLook>>; merges: CellMerge[] };
/** How a cell of a worksheet is drawn besides its value: as a date, a time or both (seconds: whether it shows them), as a
 *  percentage or a number with fixed decimals; and its formula as the file writes it, never computed again. */
export type CellLook = { format?: 'date' | 'time' | 'datetime' | 'percent' | 'fixed'; decimals?: number; seconds?: true; formula?: string };
/** Merged cells: the top left one, by its row (-1 the header, 0 the first row under it) and its column (from 0), and
 *  how many rows and columns they span. */
export type CellMerge = { row: number; column: number; rows: number; columns: number };
/** A file a card reads itself (a document's Markdown or Word document): where it is, its name, the bytes read of its
 *  size, what is left out, and what the panel's account says of it besides its card's own (a Word document's
 *  paragraphs and tables, and what of it is not drawn). */
export type CardFileRead = { from: string; name: string; bytes: number; size: number; cut?: string; told?: Record<string, unknown> };

/** Every field the rows have, in the order they first appear. */
export const rowFields = (rows: Row[]) => [...new Set(rows.flatMap(r => Object.keys(r ?? {})))];
/** The fields a record card shows: the ones it names, each once, or else the record's first 12. */
export const recordFields = (p: PanelSpec, record: Row): string[] => (p.fields?.length ? [...new Set(p.fields)] : Object.keys(record).slice(0, 12));
/** The rows a card draws, at most; and a chart, one band each. */
export const MAX_ROWS = 100;
export const MAX_CHART_ROWS = 24;

/** The fields a card puts on screen, as the compiler chooses them. */
export const shownFields = (p: PanelSpec, rows: Row[], def?: CardDef): string[] =>
  (Object.hasOwn(GUIDE, p.card) ? GUIDE[p.card as CardName].shows?.(p, rows) : def?.shows?.(p)) ?? [];

/** The card nearest to what a panel sent, for a refusal of a card that does not exist to suggest. */
function nearestCard(p: Record<string, unknown>): CardName {
  if (p.html || p.path) return 'page';
  if ((p.x && p.y) || p.group) return 'bar-chart';
  if (p.value !== undefined || typeof p.data === 'number') return 'kpi';
  if (p.text) return 'text';
  if (p.time) return 'timeline';
  if (Array.isArray(p.media)) return 'gallery';
  if (p.media) return 'media';
  return p.data && !Array.isArray(p.data) ? 'record' : 'table';
}
/** Why there is no such card, and what to send instead. */
export function noCard(card: string, p: Record<string, unknown>, offered: string[]): string {
  const near = [nearestCard(p), 'table', ...offered].find(k => offered.includes(k)); const page = offered.includes('page');
  let parts: string;
  if (/^(pie|donut|doughnut|treemap|sunburst|funnel|waffle)/i.test(card)) parts = `for parts of a whole, a bar-chart with the same group and value shows the same numbers${page ? '; or draw it in a page (ECharts and Chart.js are pinned)' : ''}`;
  else if (page) parts = `draw it in a page (ECharts, Chart.js and three.js are pinned), or use the nearest card for what you sent: ${near}`;
  else parts = `the nearest card for what you sent: ${near}`;
  return `there is no "${card}" card: ${parts}. The cards: ${offered.join(', ')}`;
}
/** The cards that read a field, for a field sent to a card that does not. */
export const cardsReading = (field: string, offered: string[]) => offered.filter(k => GUIDE[k as CardName]?.fields.includes(field));
