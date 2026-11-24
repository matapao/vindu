// A host can draw a resolved view with its own components and still share Vindu's state and actions.
import { kindOf } from './card-kinds/registry.js';
import { MAX_ROWS, panelsOf, recordFields, shownFields, type CardDef, type PanelSpec, type Resolved, type ViewSpec } from './cards.js';
import type { Row } from './results.js';

export type PanelPresentation = {
  id: string;
  card: string;
  title?: string;
  state: 'ready' | 'waiting' | 'error';
  message?: string;
  fields?: string[];
  rows?: Row[];
  availableRows?: number;
  record?: Row;
  value?: unknown;
  text?: string;
  sort?: string;
  selected?: string | number;
  source?: { id: string; pointer: string; fidelity: string };
  inputs?: Record<string, number>;
  typed?: boolean;
  label?: string;
  newer?: string;
  follows?: string;
  chart?: { x: string; y: string[] };
  media?: Resolved['media'];
  marks?: Row[];
  frame?: { kind: 'page' | 'app'; url: string; height: number };
  props?: Record<string, unknown>;
};

export type ViewPresentation = {
  name: string;
  title: string;
  subtitle?: string;
  seq: number;
  panels: PanelPresentation[];
  tabs?: { title: string; panels: string[] }[];
  step?: ViewSpec['step'];
  /** A view drilled into (a bar or a group's row opened in place): the titles from the view down to what is shown. */
  path?: string[];
  /** The way back up one step, as Vindu's own head sends it: a host's own back control sends this action through the
   *  window's events, { type: 'action', view: name, name: back.event, context: back.context }. */
  back?: { event: 'drill_back'; context: { depth: number } };
};

const project = (row: Row, fields: string[]): Row =>
  Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]]));

function panelOf(p: PanelSpec, d: Resolved, cards: ReadonlyMap<string, CardDef>): PanelPresentation {
  const def = cards.get(p.card); const kind = kindOf(p.card, cards);
  const base = { id: p.id, card: d.waiting?.card ?? p.card, ...(p.title === undefined ? {} : { title: p.title }) };
  if (d.failed !== undefined) return { ...base, state: 'error', message: d.failed };
  if (d.waiting) return { ...base, state: 'waiting', message: d.waiting.for };

  const result: PanelPresentation = { ...base, state: 'ready' };
  const props = kind?.props?.(p, d);
  if (d.rows && d.value === undefined) { // the rows a value is worked out over are not what it shows
    const rows = d.rows.slice(0, kind?.maxRows ?? MAX_ROWS);
    const fields = kind?.presentFields ? kind.presentFields(rows, p, d) : shownFields(p, d.rows, def);
    if (fields.length) result.fields = fields;
    result.rows = kind?.presentFields || fields.length ? rows.map(row => project(row, fields)) : rows;
    result.availableRows = d.rows.length;
  }
  if (d.record) {
    const fields = recordFields(p, d.record);
    result.fields = fields;
    result.record = project(d.record, fields);
  }
  if (d.value !== undefined) result.value = d.value;
  if (d.text !== undefined) result.text = d.text;
  if (p.sort !== undefined) result.sort = p.sort;
  if (p.selected !== undefined) result.selected = p.selected;
  if (d.src) result.source = { id: d.src.id, pointer: d.src.pointer, fidelity: d.src.fidelity };
  if (d.inputs) result.inputs = d.inputs;
  if (d.typed) result.typed = true;
  if (d.label) result.label = d.label;
  if (d.newer) result.newer = d.newer;
  if (d.follows) result.follows = d.follows;
  kind?.present?.(result, p, d);
  if (d.media) result.media = d.media;
  if (d.marks) result.marks = d.marks.map(mark => project(mark, ['x', 'y', 'w', 'h', 'start', 'end', 'label']));
  if (d.page) result.frame = { kind: 'page', url: d.page.url, height: d.page.height };
  if (d.app) result.frame = { kind: 'app', url: d.app.url, height: d.app.height };
  if (props) result.props = props;
  return result;
}

export function presentationOf(spec: ViewSpec, data: Record<string, Resolved>, seq: number, cards: ReadonlyMap<string, CardDef>): ViewPresentation {
  const panels = spec.step && spec.panels ? spec.panels.slice(0, spec.step.at) : panelsOf(spec);
  const result: ViewPresentation = {
    name: spec.name, title: spec.title, seq, panels: panels.map(p => panelOf(p, data[p.id], cards)),
    ...(spec.subtitle === undefined ? {} : { subtitle: spec.subtitle }),
    ...(spec.tabs ? { tabs: spec.tabs.map(tab => ({ title: tab.title, panels: tab.panels.map(p => p.id) })) } : {}),
    ...(spec.step ? { step: spec.step } : {}),
    ...(spec.path && spec.path.length > 1 ? { path: spec.path, back: { event: 'drill_back' as const, context: { depth: spec.path.length - 1 } } } : {}), // as a2ui.ts draws the head
  };
  // A host's renderer must not be able to mutate the resolved data used by MCP actions and accounts.
  return structuredClone(result);
}
