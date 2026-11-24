// What the model gets back after a show: a JSON account of what rendered, read from the compiled
// surface (cells, values, layout), with where each panel's data came from and how it went in: a reference into the
// entry (ctx:<id>#<pointer>), how it was seen (exact, reported, typed), each step the system applied, the rule each
// value was written by, and a reference for every value of the first row. Never pixels, never advice.
// A page panel's account is completed by the page check (page-check.ts), which loads the page; whether the window
// drew the values is told by the window itself (verified), after it draws.
import { amountsIn, unknownAmounts } from './amounts.js';
import { amountsOf, refOf } from './results.js';
import type { Component, Surface } from './a2ui.js';
import { kindOf } from './card-kinds/registry.js';
import { panelsOf, pidFor, type Resolved, type ViewSpec } from './cards.js';
import { componentsOf, dataModelOf } from './catalog-id.js';
import { CELL_RULE } from './format.js';
import { basePointer } from './pointing.js';
import type { ViewContext } from './view-context.js';

export type Account = {
  view: string; shown: true; layout: string;
  ignored?: string[];              // what was sent that no card reads: left out, so it did nothing
  format?: { locale: string; timeZone: string; cells: string };
  panels: Record<string, unknown>[];
  verified?: unknown;              // what the window read back from what it drew (server.ts)
  corrections?: string[];
  typed_numbers_not_in_any_result?: number[];
  shell?: Record<string, unknown>; // where the view's pane is, from the shell (server.ts)
};

export function account(view: ViewSpec, data: Record<string, Resolved>, wide: Surface, compact: Surface, ctx: ViewContext, notes: string[], ignored: string[] = []): Account {
  const comps = (componentsOf(wide) ?? []) as Component[];
  const model = (s: Surface) => (dataModelOf(s)?.panels ?? {}) as Record<string, Record<string, unknown>>;
  const shown = model(wide), narrow = model(compact);
  const typed: string[] = []; // the text of what the model typed, read for amounts no result holds

  const panels = panelsOf(view).map(p => {
    const pid = pidFor(p.id); const m = shown[pid] ?? {}; const d = data[p.id]; const kind = kindOf(p.card, ctx.cards)!;
    const o: Record<string, unknown> = { id: p.id, card: p.card, from: p.from ?? d.file?.from ?? kind.origin ?? 'typed' };
    if (d.src) {
      o.ref = refOf(d.src.id, basePointer(d.src)); o.seen = d.src.fidelity;
      if (d.src.digest) o.digest = d.src.digest.slice(0, 19); // sha256: and 12 hex
    } else if (d.file) {
      o.seen = 'exact: the file, read by the system';
      o.file = { name: d.file.name, format: d.file.format, rows: d.file.rows, columns: d.file.columns, ...(d.file.format === 'json' ? {} : { cells: 'a number written exactly as a number is that number; every other cell is its text as written' }) };
    } else if (o.from === 'typed') o.seen = 'typed by you';
    if (d.steps?.length) o.steps = d.steps;
    if (d.inputs && Object.keys(d.inputs).length) o.inputs = d.inputs; // what the values were computed with
    if (d.label) o.label = d.label;
    if (d.typed) o.marked = 'Written by the model';
    if (p.ordered?.length) o.order = 'set by hand in the window, not saved: an operation that saves it asks the person';
    if (d.newer) o.not_up_to_date = `it shows ${d.src?.id ?? p.from}; its source has been read again since and says something else (${d.newer}): show it from ${d.newer}, or with follow: true to keep it on the newest read`;
    if (d.follows) o.follows = `its source's newest read: given ${d.follows}, it shows ${p.from}`;
    if (d.waiting) { o.card = d.waiting.card; o.from = 'waiting'; o.waiting = d.failed ? 'the call it waited for failed: it shows the server\'s own answer' : `${d.waiting.for} The system fills it when that happens, without you`; delete o.seen; }
    if (d.picked) o.linked = `follows ${d.picked.of}: its rows where ${d.picked.by} is ${JSON.stringify(d.picked.value)}, as ${d.picked.label} is picked there; the person picks another with a click there, without you`;
    kind.account?.(o, p, d, { model: m, narrow: narrow[pid] ?? {} }); // what its card's kind says of it
    if (o.from === 'typed') typed.push(JSON.stringify(d.rows ?? d.record ?? d.value ?? d.text ?? ''));
    return o;
  });
  typed.push(view.title, view.subtitle ?? '');
  const computed = new Set(panelsOf(view).filter(p => p.from && (data[p.id].value !== undefined || p.group || p.compute)).flatMap(p => amountsIn(JSON.stringify(data[p.id].value ?? data[p.id].rows)))); // computed by the system
  const known = amountsOf(ctx.results);
  const unknown = [...new Set(typed.flatMap(t => unknownAmounts(t, n => known.has(n) || computed.has(n))))];
  const kpiRows = comps.filter(c => /_kpis_\d+$/.test(c.id)).map(c => (c.children as string[]).length);
  const sideBySide = kpiRows.length ? `; ${kpiRows.map(k => `${k} kpis side by side`).join(', ')} (one above another when narrow)` : '';
  const n = (k: number) => `${k} panel${k === 1 ? '' : 's'}`;
  return {
    view: view.name, shown: true,
    layout: (view.tabs ? `${view.tabs.length} tabs: ${view.tabs.map(t => `${t.title} (${t.panels.length})`).join(', ')}` : `one page, ${n(view.panels!.length)}`) + sideBySide,
    ...(ignored.length ? { ignored } : {}),
    format: { locale: ctx.format?.locale ?? 'en-GB', timeZone: ctx.format?.timeZone ?? 'UTC', cells: CELL_RULE },
    panels,
    ...(notes.length ? { corrections: [...new Set(notes)] } : {}),
    ...(unknown.length ? { typed_numbers_not_in_any_result: unknown.slice(0, 12) } : {}),
  };
}
