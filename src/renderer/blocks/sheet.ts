// A sheet: its rows as cells by A1 address (columns lettered A, B, …, rows numbered, row 1 the header), each computed
// column with its formula, the model's notes on cells, and totals for each scenario side by side.
import { html, nothing } from 'lit';
import { columnName } from '../../cell-address.js';
import { dataCell, headCell, noteAt, notesByCell, notesList, type Cells } from './cells.js';
import { defineBlock, formatCell, type BlockProps, type BlockRow } from './shared.js';

type Sheet = {
  formulas?: Record<string, string>;
  totals?: { label: string; expr: string; values: { scenario: string | null; value: number | null }[] }[];
  scenarios?: string[];
};

/** A row's values in the order of the columns: one JSON list as the server sends them (cells), or a row's fields. */
function valuesOf(row: unknown, columns: string[]): unknown[] {
  if (typeof row !== 'string') return columns.map((c) => (row as BlockRow | undefined)?.[c]);
  try {
    const values: unknown = JSON.parse(row);
    return Array.isArray(values) ? values : [];
  } catch {
    return [];
  }
}
/** The fields of rows sent as objects, in the order they first appear, without the system's own (__). */
const fieldsOf = (rows: unknown[]) => [
  ...new Set(rows.flatMap((row) => (row && typeof row === 'object' ? Object.keys(row).filter((k) => !k.startsWith('__')) : []))),
];
/** What a sheet says when it draws fewer rows or columns than there are. */
function cutOf(rows: number, columns: number, cells: Cells, props: BlockProps) {
  const count = (n: number) => formatCell(props, n);
  const cut = [
    cells.rows !== undefined && rows < cells.rows ? `the first ${count(rows)} of ${count(cells.rows)} rows` : '',
    cells.columns !== undefined && columns < cells.columns ? `the first ${count(columns)} of ${count(cells.columns)} columns` : '',
  ].filter(Boolean);
  return cut.length ? html`<p class="vb-muted vb-small">Shows ${cut.join(' and ')}.</p>` : nothing;
}
function totalsOf(sheet: Sheet, props: BlockProps) {
  if (!sheet.totals?.length) return nothing;
  return html`<table class="vb-totals"><thead><tr><th></th>${(sheet.scenarios?.length ? sheet.scenarios : ['']).map(
    (s) => html`<th class="vb-num">${s}</th>`,
  )}</tr></thead><tbody>${sheet.totals.map(
    (t) =>
      html`<tr><td title=${`= ${t.expr}`}><span class="vb-fx">ƒ</span> ${t.label}</td>${t.values.map(
        (v) => html`<td class="vb-num">${formatCell(props, v.value)}</td>`,
      )}</tr>`,
  )}</tbody></table>`;
}

export const VSheet = defineBlock('VSheet', 'vindu-sheet', { sheet: 'value', cells: 'value' }, (props) => {
  const rows = props.rows as unknown[];
  const sheet = (props.sheet ?? {}) as Sheet;
  const cells = (props.cells ?? {}) as Cells;
  const columns = cells.fields ?? fieldsOf(rows);
  const formulas = sheet.formulas ?? {};
  const notes = notesByCell(cells.notes);
  const values = rows.map((row) => valuesOf(row, columns));
  const head = (c: string, i: number) =>
    headCell(html`${formulas[c] ? html`<span class="vb-fx">ƒ</span> ` : nothing}${c}`, {
      note: noteAt(notes, -1, i),
      className: formulas[c] ? 'vb-num vb-f' : typeof values[0]?.[i] === 'number' ? 'vb-num' : '',
      title: formulas[c] ? `= ${formulas[c]}, computed by the system` : c,
    });
  return html`<div class="vb-sheet"><table><thead><tr class="vb-letters"><th class="vb-rownum"></th>${columns.map(
    (_, i) => html`<th class="vb-letter" scope="col">${columnName(i)}</th>`,
  )}</tr><tr><th class="vb-rownum" scope="row">1</th>${columns.map(head)}</tr></thead>
<tbody>${values.map(
    (row, index) =>
      html`<tr data-panel=${props.panel ?? ''} data-row=${String(index)}><th class="vb-rownum" scope="row">${index + 2}</th>${columns.map(
        (c, i) =>
          dataCell(formatCell(props, row[i], c), {
            note: noteAt(notes, index, i),
            className: typeof row[i] === 'number' ? 'vb-num' : '',
            title: formulas[c] ? `= ${formulas[c]}` : '',
            field: c,
          }),
      )}</tr>`,
  )}</tbody></table>
${cutOf(rows.length, columns.length, cells, props)}${notesList(cells.notes)}${totalsOf(sheet, props)}</div>`;
});
