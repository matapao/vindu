// Pointing at things. Everything the window draws has a JSON form, so what the person points at (a click, a drag
// across panes, a text span, a region of a photo, an element of a browser page, lines of a terminal, what a page or
// an app reports) becomes exact context: references into the results and the values there, never a picture. The
// window says what was under the pointer by the marks it drew itself (data-panel, data-row; A2UI's own data paths);
// this file turns that into references, from what the system resolved for the view.
import {
  panelsOf,
  pidFor,
  recordFields,
  shownFields,
  type CardDef,
  type PanelSpec,
  type Resolved,
  type ViewSpec,
} from './cards.js';
import { refOf, pointerStep, type Row } from './results.js';
import type { PointItem } from './window-reports.js';
import { asText } from './format.js';

export type { PointItem } from './window-reports.js';

const panelOf = (spec: ViewSpec, it: PointItem): PanelSpec | undefined =>
  panelsOf(spec).find((p) => p.id === it.panel || pidFor(p.id) === it.pid);
const fieldsShown = (p: PanelSpec, d: Resolved, def?: CardDef): string[] => {
  if (def) return [...new Set(Object.values((d.shaped?.props?.map ?? p.map ?? {}) as Record<string, string>))].slice(0, 8); // a block's roles
  return d.rows ? shownFields(p, d.rows) : [];
};
const pick = (r: Row, fields: string[]) =>
  Object.fromEntries(
    (fields.length ? fields : Object.keys(r).slice(0, 8))
      .filter((f) => Object.hasOwn(r, f) && !f.startsWith('__'))
      .map((f) => [f, r[f]]),
  );

// A panel's rows are numbered under the pointer of the list they are in; an object or value read whole is its only row,
// and its pointer says so by ending in #whole.
const WHOLE = '#whole';
/** The pointer of rows read from one object or value, which is their only row. */
export const wholePointer = (pointer: string): string => `${pointer}${WHOLE}`;
/** The pointer of what a panel's rows were read from: their list, or the object or value read whole. */
export const basePointer = (src: { pointer: string }): string =>
  src.pointer.endsWith(WHOLE) ? src.pointer.slice(0, -WHOLE.length) : src.pointer;
/** The pointer of the row at a place in its list, or of the object or value read whole. */
export const rowPointer = (src: { pointer: string }, i: number): string =>
  src.pointer.endsWith(WHOLE) ? basePointer(src) : `${src.pointer}${pointerStep(i)}`;

/** A row's reference into its result, if it came from one (and was not made by a group). */
export function rowRef(d: Resolved, r: Row): string | undefined {
  const i = d.src?.index.get(r);
  if (!d.src || i === undefined) return undefined;
  return refOf(d.src.id, rowPointer(d.src, i));
}

type PointLocation = { view: string; kind?: string };
type PanelLocation = PointLocation & { panel: string; card: string; title?: string };

function browserPoint(point: PointItem, location: PointLocation) {
  if (!point.role && !point.element) return null;
  const element = {
    ...location,
    ...(point.url ? { url: point.url } : {}),
    ...(point.element ? { element: point.element } : {}),
    role: point.role ?? 'element',
    ...(point.name ? { name: point.name } : {}),
    ...(point.secret ? { secret: true } : {}),
  };
  if (point.shared === false) {
    return {
      ...element,
      note: 'the person has not shared this page with you: you cannot read or act on it; this is what they pointed at',
    };
  }
  if (point.secret) return { ...element, note: 'a secret field: the person fills it in themselves' };
  const note = point.element
    ? 'its reference in your latest snapshot of the page'
    : 'not in your latest snapshot of the page: read_view, then find it by its role and name';
  return { ...element, note };
}

function terminalPoint(point: PointItem, location: PointLocation) {
  if (!point.text) return null;
  return {
    ...location,
    ...(point.lines ? { lines: point.lines } : {}),
    text: point.text.slice(0, 4000),
    ...(point.command ? { command: point.command } : {}),
  };
}

function rowPoint(
  index: number,
  location: PanelLocation,
  panel: PanelSpec,
  data: Resolved,
  definition?: CardDef,
) {
  const sourceRow = data.rows?.[index];
  if (!sourceRow) return null;
  const row = pick(sourceRow, fieldsShown(panel, data, definition));
  if (panel.group && data.behind) {
    const key = String(sourceRow[panel.group]);
    const indices = data.behind.get(key) ?? [];
    const refs = indices.map((index) => refOf(data.src!.id, rowPointer(data.src!, index)));
    return {
      ...location,
      group: { [panel.group]: key },
      row,
      rows_behind: refs.slice(0, 50),
      ...(refs.length > 50 ? { more: refs.length - 50 } : {}),
      computed: `by the system: ${panel.value ?? 'count()'} of these rows`,
    };
  }
  const ref = rowRef(data, sourceRow);
  return {
    ...location,
    row: { ...(ref ? { ref } : {}), ...row },
    ...(ref ? {} : { seen: seenOf(data, sourceRow) }),
  };
}
/** How a row with no reference into a result was seen: read from a data file (its own row there, row 1 its header),
 *  computed by the system, or typed by the model. */
function seenOf(data: Resolved, row: Row): string {
  const read = data.file && 'format' in data.file ? data.file : undefined; // a data file: each row is one of its own
  const line = read?.index.get(row);
  const sheet = read?.sheets && (read.sheets.length === 1 ? read.sheets[0] : read.sheets.find(s => s.rows.includes(row))); // a workbook's
  if (data.file && line !== undefined) return `read by the system from ${data.file.name}${sheet ? `, its sheet ${sheet.name}` : ''}, its row ${line}`;
  if (data.file) return `computed by the system from ${data.file.name}`;
  return data.src ? 'computed by the system' : 'typed by the model';
}

/** Resolve only the selected part of a card, using the fields and source references visible there. */
function panelPoint(
  point: PointItem,
  location: PanelLocation,
  panel: PanelSpec,
  data: Resolved,
  definition?: CardDef,
) {
  if (point.page !== undefined) {
    return {
      ...location,
      page: point.page,
      ...(point.note ? { note: point.note } : {}),
      seen: 'as the page reported it',
    };
  }
  if (point.text !== undefined) {
    return {
      ...location,
      text: point.text.slice(0, 2000),
      ...(point.start !== undefined ? { start: point.start, end: point.end } : {}),
    };
  }
  if (point.region || point.time) {
    return {
      ...location,
      ...(data.media ? { media: data.media.name } : {}),
      ...(point.region ? { region: point.region } : {}),
      ...(point.time ? { time: point.time } : {}),
    };
  }
  if (data.marks && point.row !== undefined) {
    const mark = data.marks[point.row];
    if (!mark) return null;
    return {
      ...location,
      ...(data.media ? { media: data.media.name } : {}),
      mark,
      ...(typeof panel.marks === 'string' ? { ref: `${refOf(panel.marks)}${pointerStep(point.row)}` } : {}),
    };
  }
  if (point.value && data.value !== undefined) { // a value worked out over the rows (a kpi)
    return {
      ...location,
      value: data.value,
      computed: panel.value ?? 'count()',
      over: data.rows?.length ?? null,
      ...(data.src ? { from: refOf(data.src.id) } : {}),
    };
  }
  if (point.field !== undefined && data.record) {
    const field = recordFields(panel, data.record)[point.field];
    if (field === undefined) return null;
    const ref = data.src && refOf(data.src.id, basePointer(data.src)) + pointerStep(field);
    return { ...location, field, value: data.record[field], ...(data.src ? { ref } : {}) };
  }
  if (data.gallery && point.row !== undefined) { // an item of a gallery: which it is, and what it was found as
    const item = data.gallery[point.row];
    return item ? { ...location, media: item.name, type: item.mime, from: item.from, item: `${point.row + 1} of ${data.gallery.length}` } : null;
  }
  if (point.node !== undefined) return { ...location, node: point.node };
  if (point.row !== undefined && data.rows) return rowPoint(point.row, location, panel, data, definition);
  return { ...location, ...(point.chart ? { whole: 'the chart' } : {}) };
}

/** One pointed-at thing as JSON: its view and kind, and its references and values from what the system resolved. */
export function resolvePoint(
  point: PointItem,
  context: {
    spec?: ViewSpec;
    data?: Record<string, Resolved>;
    kind?: string;
    cards?: Map<string, CardDef>;
  },
): Record<string, unknown> | null {
  const location = {
    view: point.view,
    ...(context.kind && context.kind !== 'cards' ? { kind: context.kind } : {}),
  };
  if (context.kind === 'browser') return browserPoint(point, location);
  if (context.kind === 'terminal') return terminalPoint(point, location);
  if (!context.spec || !context.data) {
    return point.page === undefined
      ? null
      : { ...location, page: point.page, note: 'as the page reported it' };
  }
  const panel = panelOf(context.spec, point);
  if (!panel) return null;
  const at = {
    ...location,
    panel: panel.id,
    card: panel.card,
    ...(panel.title ? { title: panel.title } : {}),
  };
  return panelPoint(point, at, panel, context.data[panel.id], context.cards?.get(panel.card));
}

/** The rows a group stands for: one list of source indices per group value (for drilling, and for pointing at a bar). */
export function groupsBehind(
  rowsBefore: Row[],
  group: string,
  index: Map<Row, number>,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rowsBefore) {
    const i = index.get(r);
    if (i === undefined) continue;
    const k = asText(r[group] ?? '');
    const xs = out.get(k);
    if (xs) xs.push(i);
    else out.set(k, [i]);
  }
  return out;
}
