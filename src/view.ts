// show_view, deterministic end to end: read the panels, resolve their data from the process's results,
// check each against its card, compile to A2UI, check the surface, and tell the model what rendered.
// Nothing is done otherwise than asked without saying so: what cannot be shown is refused, every panel's problem in one
// refusal, and a field no card reads is told back as ignored.
import type { ModelDraft } from './block-drafts.js';
import { addDates } from './dates.js';
import { keyField, rowKey } from './row-keys.js';
import type { Entry, Row } from './results.js';
import { panelTitle, panelsOf, sourceRow, type PanelSpec, type Resolved, type ViewSpec } from './cards.js';
import { compile, type Surface } from './a2ui.js';
import { account, type Account } from './account.js';
import { check, kindOf } from './card-kinds/registry.js';
import { addFields } from './compute.js';
import { dataFileOf } from './data-files.js';
import { groupsBehind } from './pointing.js';
import { fillWith, hookWords } from './gates.js';
import { checkSurface } from './surface-check.js';
import { Refusal, listing, type ViewContext } from './view-context.js';
import { rowsOf, shape, matcher } from './view-rows.js';
import { asText } from './format.js';
import { read } from './view-read.js';

export type Shown = { account: Account; wide: Surface; compact: Surface; spec: ViewSpec; data: Record<string, Resolved> };

export function showView(input: Record<string, unknown>, ctx: ViewContext): Shown {
  const notes: string[] = [], ignored: string[] = [], problems: string[] = [];
  const spec = read(input, notes, ctx, problems, ignored);
  const data: Record<string, Resolved> = {};
  const refused = new Set(problems.map(x => /^panel (\S+):/.exec(x)?.[1]));
  for (const p of linkedOrder(panelsOf(spec).filter(p => !refused.has(p.id)))) {
    try {
      // a panel that waits: the result that came is its source; until then (or after a failed call) it says so, in words
      const g = (p.awaits || p.after) ? ctx.gate?.(spec.name, p, spec) ?? { wait: 'Waiting.' } : undefined;
      if (g?.from && !g.failed) fillWith(p, g.from, g.fills); // in from, or in the field its wait fills (a restored picture's media)
      if (g?.wait || g?.failed) {
        const card = p.card; p.card = 'text'; p.text = g.failed ?? g.wait; delete p.from;
        data[p.id] = { text: p.text, waiting: { card, for: g.failed ?? g.wait!, ...(g.again && !g.failed ? { again: true as const } : {}) }, ...(g.failed ? { failed: g.failed } : {}) };
        continue;
      }
      // a read the app keeps fresh: a panel that follows it shows the newest read; one that does not is marked if it changed
      const given = p.from; const newest = given ? ctx.newest?.(given) : undefined;
      if (p.follow && given && newest === undefined) notes.push(`panel ${p.id}: follow keeps nothing fresh here: ${given} is not a read the app keeps fresh`);
      if ((p.follow || p.live) && newest && newest !== given) p.from = newest; // a live panel follows its own reads
      // a linked panel without a result of its own shows what is picked in the panel it follows: while that one waits
      // (for its call, or for its result read again on restore), it waits too, for the same, and its view is drawn
      const followed = p.detail && !p.from ? data[(p.detail as { of: string }).of] : undefined;
      if (followed?.waiting) {
        const card = p.card; p.card = 'text'; p.text = followed.waiting.for;
        data[p.id] = { text: p.text, waiting: { card, for: followed.waiting.for } };
        continue;
      }
      const link = p.detail ? linkOf(p, spec, data) : undefined; // a linked panel: what is picked in the panel it follows
      if (link && !p.from) { p.from = link.panel.from; if (link.panel.pick) p.pick = link.panel.pick; } // the followed panel's result: read, not typed
      const d = resolve(link ? link.panel : p, spec, ctx, notes);
      if (link) {
        d.picked = link.picked; (d.steps ??= []).unshift({ detail: link.picked.of, picked: link.picked.label }); p.title = p.title ? `${p.title}: ${link.picked.label}` : link.picked.label; // its title says what it shows
        if (d.rows && !d.rows.length) { p.card = 'text'; d.text = `None for ${link.picked.label}: no rows where ${link.picked.by} is ${link.picked.value}.`; delete d.rows; } // nothing for this pick is an answer too, drawn as such
      }
      if ((p.follow || p.live) && newest && newest !== given) d.follows = given;
      else if (!p.follow && !p.live && newest && newest !== given) d.newer = newest;
      const kind = kindOf(p.card, ctx.cards)!;
      if (!p.from && !d.file && kind.typed !== false && !kind.source && ctx.marks !== false) d.typed = true; // the model's own words and numbers
      if (p.from && ctx.classify) { const e = ctx.results.get(p.from); const label = e ? ctx.classify(e) : undefined; if (label) d.label = label; }
      const problem = check(p, d, ctx.cards);
      if (problem) { problems.push(`panel ${p.id}: ${problem}`); continue; }
      data[p.id] = d;
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      problems.push(e.message.startsWith('panel ') ? e.message : `panel ${p.id}: ${e.message}`);
    }
  }
  if (problems.length) throw new Refusal(problems.length === 1 ? problems[0] : `${problems.length} panels need changes, so nothing was shown: ${problems.map((x, i) => `(${i + 1}) ${x}`).join(' ')}`);
  // steps: its panels one at a time; every panel is resolved and checked now, the later ones drawn as the person goes on
  if (spec.steps && spec.panels?.length) {
    const of = spec.panels.length, at = Math.min(of, Math.max(1, ctx.step?.(spec.name) ?? 1));
    spec.step = { at, of };
  }
  if (spec.hooks?.length) spec.hookStates = spec.hooks.map((h, i) => {
    const st = ctx.hookState?.(spec.name, i);
    if (st === 'idle') return 'idle';
    return h.do.job ? st ?? 'unavailable' : 'system';
  });
  spec.suggestions = (spec.suggestions ?? []).slice(0, 3).map(sg => ({ ...sg, by: 'model' as const }));
  // cues: what the system noticed that usually means a next step, offered as a prompt the person may take; no model is
  // asked: what a card noticed in its rows (more rows than it shows, a plan that clashes), then a read that changed since
  for (const p of panelsOf(spec)) for (const sg of kindOf(p.card, ctx.cards)?.suggest?.(data[p.id].rows ?? [], p, p.title ?? spec.title) ?? []) spec.suggestions.push({ ...sg, by: 'system' });
  for (const p of panelsOf(spec)) {
    const d = data[p.id];
    if (d.newer) spec.suggestions.push({ label: 'What changed?', prompt: `${p.title ?? spec.title} shows ${p.from}, and its source has been read again since: ${d.newer}. What changed between them?`, by: 'system' });
  }
  for (const c of ctx.cues?.(spec.name) ?? []) spec.suggestions.push({ label: c.label, prompt: c.prompt, by: 'system' });
  const build = () => {
    const drawing = { cards: ctx.cards, locale: ctx.format?.locale, timeZone: ctx.format?.timeZone, words: ctx.words };
    const wide = compile(spec, data, { compact: false, ...drawing });
    const compact = compile(spec, data, { compact: true, ...drawing });
    const broken = [...checkSurface(wide), ...checkSurface(compact)];
    if (broken.length) throw new Error(`the view could not be built (${broken[0]}); a fault in the UI server, not in the view`);
    return { wide, compact, account: account(spec, data, wide, compact, ctx, notes, ignored) };
  };
  let b = build();
  if (b.account.typed_numbers_not_in_any_result?.length) { // the system's own suggestion: what to check, shown to the person too
    spec.suggestions.push({ label: 'Check the typed numbers', prompt: `In ${spec.title}, these numbers are in no result: ${b.account.typed_numbers_not_in_any_result.join(', ')}. Where do they come from?`, by: 'system' });
    b = build();
  }
  if (spec.suggestions.length) (b.account as Account & { suggestions?: unknown }).suggestions = spec.suggestions.map(sg => ({ label: sg.label, by: sg.by }));
  if (spec.hooks?.length) (b.account as Account & { hooks?: unknown }).hooks = spec.hooks.map((h, i) => ({ n: i, does: hookWords(h, id => panelTitle(spec, id)),
    state: HOOK_STATES[spec.hookStates![i]] }));
  return { ...b, spec, data };
}

/** Each hook's state as the account says it. */
const HOOK_STATES: Record<NonNullable<ViewSpec['hookStates']>[number], string> = {
  system: 'on: the system does it by itself', on: 'on: the person turned this job on', off: 'off until the person turns it on, in the window',
  idle: 'off: this is a job\'s own task, which runs no hooks', unavailable: 'off: jobs are off in this app',
};

/** How a result was seen: as its store says, an answer by who gave it, or an attachment. */
function fidelityOf(e: Entry): string {
  if (e.kind === 'result') return e.fidelity ?? 'reported';
  if (e.kind !== 'answer') return 'attachment';
  if (e.by === 'app') return 'app-reported';
  return e.by === 'host' || e.by === 'page' ? e.by : 'person';
}

/** A panel's data: from the results (exact), or typed by the model (labelled as typed in the account). What a card
 *  draws instead of rows, or makes of them, is its kind's (card-kinds/). */
function resolve(p: PanelSpec, view: ViewSpec, ctx: ViewContext, notes: string[]): Resolved {
  const kind = kindOf(p.card, ctx.cards)!;
  if (kind.own) return kind.own(p, view, ctx);
  const e = p.from ? ctx.results.get(p.from) : undefined;
  if (p.from && !e) throw new Refusal(`panel ${p.id}: no result "${p.from}". This task has: ${listing(ctx.results)}`);
  const direct = kind.direct?.(p, e); if (direct) return direct;
  let rows: Row[]; let src: Resolved['src'];
  const read = kind.cells ? dataFileOf(p, e, ctx, notes, !!kind.workbooks) : undefined; // a CSV, TSV or JSON file (or a workbook), read by the system
  const own = read ? undefined : kind.file?.(p, e, ctx); // a file the card reads itself (a document's Markdown), by the system
  if (read) rows = read.rows;
  else if (own) rows = own.rows;
  else if (e) {
    const got = rowsOf(e, p, notes, !!kind.one); rows = got.rows;
    src = { id: e.id, pointer: got.pointer, index: new Map(rows.map((r, i) => [r, i])), of: rows.length,
      fidelity: fidelityOf(e),
      ...(e.kind === 'result' && e.digest ? { digest: e.digest } : {}), ...(got.columns ? { columns: true } : {}) };
  }
  else if (Array.isArray(p.data)) rows = p.data as Row[];
  else if (p.data && typeof p.data === 'object') rows = [p.data as Row];
  else if (kind.source) { try { rows = kind.source(p, id => ctx.results.get(id)); } catch (x) { throw new Refusal(`panel ${p.id}: ${(x as Error).message}`); } }
  else throw new Refusal(`panel ${p.id}: ${p.card} needs "from" (a result id such as r3) or rows you worked out`);
  const file = read?.file, at = src ?? file; // where each row is in what it was read from
  const steps: Record<string, unknown>[] = [];
  const inputs = inputsOf(p, view, ctx);
  const given: Pick<Resolved, 'inputs'> = Object.keys(inputs).length ? { inputs } : {}; // what the values were computed with, if anything
  if (p.compute && Object.keys(p.compute).length) { // fields computed for each row, by the system: kept with the row they came from
    let got: ReturnType<typeof addFields>;
    try { got = addFields(rows, p.compute, inputs); } catch (e) { throw new Refusal(`panel ${p.id}: compute: ${(e as Error).message}`); }
    reindex(at, rows, got.rows);
    rows = got.rows;
    steps.push({ compute: p.compute, rows: rows.length, ...(Object.keys(got.empty).length ? { empty: got.empty } : {}) });
    for (const [k, n] of Object.entries(got.empty)) notes.push(`panel ${p.id}: ${k} is empty in ${n} of ${rows.length} rows (a field missing or not a number, or a division by zero)`);
  }
  if (p.dates && Object.keys(p.dates).length) { // dates computed for each row by the system: deadlines, kept with the row they came from
    let got: ReturnType<typeof addDates>;
    const holidays = [...(ctx.holidays ?? []), ...(p.holidays ?? [])]; // the host's, and the panel's own
    try { got = addDates(rows, p.dates, { timeZone: ctx.format?.timeZone, holidays }); } catch (e) { throw new Refusal(`panel ${p.id}: dates: ${(e as Error).message}`); }
    reindex(at, rows, got.rows);
    rows = got.rows;
    steps.push({ dates: p.dates, ...(holidays.length ? { holidays: holidays.length } : {}), ...(Object.keys(got.empty).length ? { empty: got.empty } : {}) });
    for (const [k, n] of Object.entries(got.empty)) notes.push(`panel ${p.id}: ${k} is empty in ${n} of ${rows.length} rows (its date field holds no date)`);
  }
  let before: Row[] | undefined; // what is grouped, for the groups' pointers to the rows behind them
  if (p.group && src) before = p.where ? rows.filter(r => Object.entries(p.where!).every(([k, x]) => matcher(k, x).test(r[k]))) : rows;
  kind.infer?.(p, rows, notes); // first: a timeline is sorted by its time
  rows = shape(rows, p, notes, steps, inputs, kind); // where, then group, then sort and limit
  const behind = before && src ? groupsBehind(before, p.group!, src.index) : undefined;
  if (kind.result) { const { step, ...shown } = kind.result(rows, p, inputs); return { ...shown, src, steps: step ? [...steps, step] : steps, ...given }; }
  let shaped: Resolved['shaped'];
  if (kind.rows && rows.length) { // a block's own shaping (totals, free slots, tracked changes, a layout), by the system
    const before = rows; let made: ReturnType<NonNullable<typeof kind.rows>>;
    const draft = ctx.draft && ((model: ModelDraft) => ctx.draft!(view.name, p.id, model)); // the person's own draft of it, where the window keeps one
    try { made = kind.rows(rows, p, id => ctx.results.get(id), { inputs, ...(draft ? { draft } : {}), ...(ctx.format ? { timeZone: ctx.format.timeZone } : {}) }); } catch (x) { throw new Refusal(`panel ${p.id}: ${(x as Error).message}`); }
    const { rows: out, ...worked } = Array.isArray(made) ? { rows: made } : made;
    rows = out; if (Object.keys(worked).length) shaped = worked;
    if (rows !== before && !behind) reindex(at, before, rows); // a group's rows stand for the rows behind them
  }
  const shownFile = file ?? own?.file; // a data file read as rows, or the file the card read itself
  return { rows, src, steps, ...(behind ? { behind } : {}), ...given, ...(shaped ? { shaped } : {}), ...(shownFile ? { file: shownFile } : {}) };
}

/** Rows made from the rows before (fields computed for each, a block's own shaping), each kept at its place in its
 *  result or data file: the same row (a block that sorts), the row it was made from (SOURCE), or, for rows made one for
 *  one in the same order (an invoice's lines with their amounts), the row at its place. */
function reindex(at: { index: Map<Row, number> } | undefined, before: Row[], rows: Row[]) {
  if (!at) return;
  const idx = at.index;
  at.index = new Map(rows.map((r, i) => [r, idx.get(r) ?? idx.get(sourceRow(r)) ?? idx.get(before[i]) ?? i]));
}

/** An input's number: a number, an input's own { value }, or what Number makes of it. */
function inputNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  return typeof v === 'object' && v && typeof (v as { value?: unknown }).value === 'number' ? (v as { value: number }).value : Number(v);
}

/** A panel's inputs (what-ifs): the model's values, unless the person set one in the window. */
function inputsOf(p: PanelSpec, view: ViewSpec, ctx: ViewContext): Record<string, number> {
  const raw = (p.inputs ?? {}) as Record<string, unknown>;
  const defaults: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = inputNumber(v);
    if (!Number.isFinite(n)) throw new Refusal(`panel ${p.id}: input ${k} needs a number`);
    defaults[k] = n;
  }
  return ctx.inputs ? ctx.inputs(view.name, p.id, defaults) : defaults;
}

/** Panels in the order they are resolved: one a linked panel follows comes before it (its picked row is needed). */
function linkedOrder(panels: PanelSpec[]): PanelSpec[] {
  const out: PanelSpec[] = []; const left = [...panels];
  for (let pass = 0; left.length && pass <= panels.length; pass++) {
    // oxlint-disable-next-line unicorn/no-useless-spread -- a copy: the pass takes panels out of left as it goes
    for (const p of [...left]) { const of = (p.detail as { of?: string } | undefined)?.of; if (!of || out.some(x => x.id === of) || !panels.some(x => x.id === of)) { out.push(p); left.splice(left.indexOf(p), 1); } }
  }
  if (left.length) throw new Refusal(`panels ${left.map(p => p.id).join(', ')} follow each other in a circle (detail)`);
  return out;
}
/** A linked panel as it resolves now: the row picked in the panel it follows (its first row to start with), and the
 *  panel's own spec with that row's value as a where: from its own result, or else the followed panel's. */
function linkOf(p: PanelSpec, view: ViewSpec, data: Record<string, Resolved>): { panel: PanelSpec; picked: NonNullable<Resolved['picked']> } | undefined {
  const det = p.detail as { of: string; by?: string };
  const m = panelsOf(view).find(x => x.id === det.of);
  if (!m || m.id === p.id) throw new Refusal(`panel ${p.id}: detail.of "${det.of}" is no other panel of this view; its panels: ${panelsOf(view).map(x => x.id).join(', ')}`);
  const rows = (data[m.id]?.rows ?? []).map(sourceRow);
  if (!rows.length) return undefined; // nothing to pick: shown as it is
  const kf = keyField(rows); const key = rowKey(rows);
  const at = m.selected !== undefined ? rows.findIndex(r => key(r) === String(m.selected)) : 0;
  const row = rows[at < 0 ? 0 : at];
  const by = det.by ?? kf;
  if (!by) throw new Refusal(`panel ${p.id}: detail: say which field ${m.title ?? m.id} and this panel share (by); its rows have no field that tells them apart`);
  if (!(by in row)) throw new Refusal(`panel ${p.id}: detail.by "${by}" is not a field of ${m.title ?? m.id}; its fields: ${Object.keys(row).join(', ')}`);
  if (!p.from && !m.from) throw new Refusal(`panel ${p.id}: detail without from shows the picked row of ${m.id}, which needs from (a result id)`);
  const label = asText(row.title ?? row.name ?? row[by] ?? key(row));
  const panel = { ...p, ...(p.from ? {} : { from: m.from, ...(m.pick ? { pick: m.pick } : {}) }), where: { ...p.where, [by]: row[by] } } as PanelSpec;
  return { panel, picked: { of: m.id, key: key(row), label, by, value: String(row[by]) } };
}
