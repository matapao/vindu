// Cards of rows: a table, a list (a line per row) and a timeline (rows in time order). Each shows the rows as they are,
// a value of each field in a cell, and its account gives the fields, the first row and where each of its values is.
import { GUIDE, MAX_ROWS, rowFields, shownFields, type PanelSpec, type Resolved } from '../cards.js';
import { asText, ellipsis } from '../format.js';
import { basePointer, rowPointer } from '../pointing.js';
import { pointerStep, refOf, type Row } from '../results.js';
import { isWrapped } from '../view-rows.js';
import { rowsAsTheyAre, type AccountKit, type CardKind, type CardProbe, type DrawKit } from './kind.js';

/** The account of a card of rows: how many, the fields, empty cells, the first row as drawn, and a reference for each
 *  of its values: under the list's pointer, at its row, then its field; in columns, at its field, then its row; a list
 *  of plain values is its item itself; a field the system computed says so. */
function rowsAccount(o: Record<string, unknown>, p: PanelSpec, d: Resolved, kit: AccountKit) {
  const rows = kit.model.rows as Record<string, string>[] | undefined; if (!rows) return;
  const made = p.compute ?? {};
  const f = shownFields(p, d.rows!);
  o.rows = d.rows!.length; if (d.rows!.length > MAX_ROWS) o.shown_rows = MAX_ROWS; o.fields = f;
  const cells = (r: Record<string, string>) => Object.values(r);
  const empty = f.map((k, i) => [k, rows.filter(r => cells(r)[i] === '').length] as const).filter(([, n]) => n);
  if (empty.length) o.empty_cells = Object.fromEntries(empty);
  if (rows[0]) o.first_row = cells(rows[0]).map(c => ellipsis(c, 40)).join(' | ');
  const first = d.rows![0]; const i = first && d.src?.index.get(first);
  const at = (k: string) => { const s = d.src!;
    return refOf(s.id, s.columns ? `${basePointer(s)}${pointerStep(k)}${pointerStep(i!)}` : `${rowPointer(s, i!)}${isWrapped(first) && k === 'value' ? '' : pointerStep(k)}`); };
  if (first && d.src && i !== undefined && !p.group) o.first_refs = Object.fromEntries(f.filter(k => k in first).map(k => [k, k in made ? `computed by the system: ${made[k]}` : at(k)]));
  else if (first && p.group) o.first_refs = 'computed by the system: see steps';
}
/** The first row's values, as the window should read them back: each cell of a table, or a line's label and meta. */
function rowProbes(p: PanelSpec, d: Resolved, m: Record<string, unknown>, pid: string): CardProbe[] {
  const rows = m.rows as Record<string, string>[] | undefined; const at = `/panels/${pid}/rows/0`;
  if (!rows?.[0]) return [];
  if ('c0' in rows[0]) { const f = shownFields(p, d.rows!); return Object.values(rows[0]).map((v, i) => ({ component: `${pid}__c${i}`, path: at, expect: v, panel: p.id, field: f[i] })); }
  return [{ component: `${pid}__label`, path: at, expect: rows[0].label ?? '', panel: p.id }, ...(rows[0].meta ? [{ component: `${pid}__meta`, path: at, expect: rows[0].meta, panel: p.id }] : [])];
}

/** The rows as a table: a head that sorts by each column, then a row of cells for each; on a narrow window with more
 *  than three columns, a line per row, the first field above the rest. */
function drawTable(p: PanelSpec, d: Resolved, k: DrawKit): string[] {
  const f = shownFields(p, d.rows!); const pid = k.pid;
  if (k.compact && f.length > 3) {
    k.model.rows = d.rows!.slice(0, MAX_ROWS).map(r => ({ label: k.cell(r[f[0]], f[0]), meta: f.slice(1).map(x => `${x}: ${k.cell(r[x], x)}`).join(' · ') }));
    return [k.list([k.text(`${pid}__label`, { path: 'label' }, 'body'), k.text(`${pid}__meta`, { path: 'meta' }, 'caption')])];
  }
  const shown = d.rows!.slice(0, MAX_ROWS).map(r => f.map(x => k.cell(r[x], x)));
  k.model.rows = shown.map(r => Object.fromEntries(r.map((c, i) => [`c${i}`, c])));
  // the head and every row are rows of cells with the same weights, so the columns line up; a column's weight
  // follows how long its text is (4 to 28), so a long name gets room and a short number does not
  const w = f.map((x, i) => Math.max(4, Math.min(28, Math.round(Math.max(shown.reduce((a, r) => a + r[i].length, 0) / Math.max(1, shown.length), x.length * 0.7)))));
  // each column's head sorts by it, the same action the model has (actions.ts); the arrow says how it is sorted now
  const [sf, sd] = String(p.sort ?? '').split(/\s+/);
  return [
    k.add({ id: `${pid}__head`, component: 'Row', children: f.map((x, i) => k.add({ id: `${pid}__hb${i}`, component: 'Button', variant: 'borderless', weight: w[i],
      child: k.text(`${pid}__h${i}`, `${x}${sf === x ? (/desc/i.test(sd ?? '') ? ' ↓' : ' ↑') : ''}`, 'caption'),
      action: { event: { name: 'view_action', context: { action: 'sort', panel: p.id, field: x } } } })) }),
    k.list(f.map((_, i) => k.text(`${pid}__c${i}`, { path: `c${i}` }, undefined, w[i])), 'Row'),
  ];
}
/** The rows as lines: each its label, and its time above it. */
function drawLines(p: PanelSpec, d: Resolved, k: DrawKit): string[] {
  k.model.rows = d.rows!.slice(0, MAX_ROWS).map(r => ({ label: k.cell(r[p.label!], p.label), meta: p.time ? k.cell(r[p.time], p.time) : '' }));
  return [k.list([k.text(`${k.pid}__meta`, { path: 'meta' }, 'caption'), k.text(`${k.pid}__label`, { path: 'label' }, 'body')])];
}

/** The label of a line, when none is given: a field named like one, or else the first with text. */
function inferLabel(p: PanelSpec, rows: Row[], notes: string[]) {
  if (p.label) return;
  const fields = rowFields(rows);
  p.label = fields.find(f => /^(label|event|title|name|subject|summary|description)$/i.test(f)) ?? fields.find(f => f !== p.time && rows.some(r => typeof r[f] === 'string'));
  if (p.label) notes.push(`panel ${p.id}: used "${p.label}" as the label`);
}

export const TABLE: CardKind = {
  reads: GUIDE.table.fields, draw: drawTable, probes: rowProbes,
  account: (o, p, d, kit) => {
    rowsAccount(o, p, d, kit);
    const f = (o.fields ?? []) as string[]; const nr = kit.narrow.rows as Record<string, string>[] | undefined;
    if (nr?.[0] && 'meta' in nr[0]) o.phone = `a list: ${f[0]}, with ${f.slice(1).join(', ')} beneath`;
  },
  suggest: (rows, _p, where) => (rows.length > MAX_ROWS ? [{ label: `Show all ${rows.length} rows`, prompt: `${where} shows the first ${MAX_ROWS} of ${rows.length} rows. Show the rest, or sum them up.` }] : []),
};
export const LIST: CardKind = { reads: GUIDE.list.fields, noGroup: rowsAsTheyAre, infer: inferLabel, draw: drawLines, account: rowsAccount, probes: rowProbes };
export const TIMELINE: CardKind = {
  reads: GUIDE.timeline.fields, noGroup: rowsAsTheyAre, draw: drawLines, account: rowsAccount, probes: rowProbes,
  infer: (p, rows, notes) => { // first: a timeline is sorted by its time
    if (!p.time) { p.time = rowFields(rows).find(f => /^(time|at|when|date|timestamp|opened|created)/i.test(f)); if (p.time) notes.push(`panel ${p.id}: used "${p.time}" as the time`); }
    inferLabel(p, rows, notes);
  },
  // in time order: numbers by size, dates and times as written (ISO 8601 sorts in time)
  order: (rows, p) => {
    const f = p.time; if (!f) return rows;
    const nums = rows.every(r => Number.isFinite(Number(r[f])) && r[f] !== '' && r[f] !== null);
    return [...rows].sort((a, b) => nums ? Number(a[f]) - Number(b[f]) : asText(a[f] ?? '').localeCompare(asText(b[f] ?? '')));
  },
};
