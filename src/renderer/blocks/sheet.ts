// A sheet: its rows as cells by A1 address (columns lettered A, B, …, rows numbered, row 1 the header), each computed
// column with its formula, the model's notes on cells, and totals for each scenario side by side. A workbook's sheets
// come as tabs, each cell as Excel shows it and its merged cells spanning their rows and columns (sheet-workbook.ts).
import { html, nothing } from 'lit';
import { BLOCK_WORDS, wordsGiven, type SheetWords } from '../../block-words.js';
import { columnName } from '../../cell-address.js';
import { dataCell, headCell, noteAt, notesByCell, notesList, unbroken, type CellNote, type Cells } from './cells.js';
import { isWhen, lookText, looksOf, tabList, tabShown, tabsId, tabsOf, type Look, type Tab } from './sheet-workbook.js';
import { defineBlock, formatCell, type BlockProps, type BlockRow } from './shared.js';

type Sheet = {
  formulas?: Record<string, string>;
  totals?: { label: string; expr: string; values: { scenario: string | null; value: number | null }[] }[];
  scenarios?: string[];
};
/** The cells a sheet draws: its fields, each row's values, and where its rows are among the panel's (first); of a
 *  workbook's sheet, each cell's look, its header's, its merges and the view's words too. */
type Grid = {
  fields: string[];
  values: unknown[][];
  first: number;
  book?: { looks: (Look | null)[][]; head: (Look | null)[]; tab: Tab; words: SheetWords };
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
/** A cell of a number, or of a workbook's date or time, is aligned right. */
const numberClass = (value: unknown, look?: Look | null) =>
  typeof value === 'number' || (isWhen(look) && typeof value === 'string') ? 'vb-num' : '';
/** The fields of rows sent as objects, in the order they first appear, without the system's own (__). */
const fieldsOf = (rows: unknown[]) => [
  ...new Set(
    rows.flatMap((row) => (row && typeof row === 'object' ? Object.keys(row).filter((k) => !k.startsWith('__')) : [])),
  ),
];
/** What a sheet says when it draws fewer rows or columns than there are. */
function cutOf(rows: number, columns: number, all: { rows?: number; columns?: number }, props: BlockProps) {
  const count = (n: number) => formatCell(props, n);
  const cut = [
    all.rows !== undefined && rows < all.rows ? `the first ${count(rows)} of ${count(all.rows)} rows` : '',
    all.columns !== undefined && columns < all.columns
      ? `the first ${count(columns)} of ${count(all.columns)} columns`
      : '',
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
/** A cell's title: its formula, the file's or a computed column's, after =; none without one. */
const titleOf = (formula: string | undefined) => (formula === undefined ? '' : `= ${formula}`);
/** A cell's value, with the formula mark before it when the file gives it a formula. */
const withFormula = (text: string, formula: string | undefined) =>
  formula === undefined ? text : html`<span class="vb-fx" aria-hidden="true">ƒ</span> ${unbroken(text)}`;

/** The cells, lettered and numbered: a computed column's head with its formula, a workbook's cells with their own. */
function cellsTable(
  props: BlockProps,
  g: Grid,
  formulas: Record<string, string>,
  notes: ReadonlyMap<string, CellNote>,
) {
  const book = g.book,
    tab = book?.tab;
  const head = (c: string, i: number) => {
    if (tab?.covered.has(`-1:${i}`)) return nothing;
    const formula = book?.head[i]?.formula;
    if (!formulas[c])
      return headCell(formula === undefined ? unbroken(c) : withFormula(c, formula), {
        note: noteAt(notes, -1, i),
        className: [numberClass(g.values[0]?.[i], book?.looks[0]?.[i]), formula === undefined ? '' : 'vb-f']
          .join(' ')
          .trim(),
        title: formula === undefined ? c : `= ${formula}`,
        span: tab?.spans.get(`-1:${i}`),
      });
    return headCell(html`<span class="vb-fx">ƒ</span> ${unbroken(c)}`, {
      note: noteAt(notes, -1, i),
      className: 'vb-num vb-f',
      title: `= ${formulas[c]}, computed by the system`,
    });
  };
  const cell = (row: unknown[], index: number, c: string, i: number) => {
    if (tab?.covered.has(`${index}:${i}`)) return nothing;
    const look = book?.looks[index]?.[i],
      formula = look?.formula;
    const text = book ? lookText(props, row[i], look, c, book.words) : formatCell(props, row[i], c);
    return dataCell(withFormula(text, formula), {
      note: noteAt(notes, index, i),
      className: [numberClass(row[i], look), formula === undefined ? '' : 'vb-f'].join(' ').trim(),
      title: titleOf(formula ?? formulas[c]),
      field: c,
      span: tab?.spans.get(`${index}:${i}`),
    });
  };
  return html`<table><thead><tr class="vb-letters"><th class="vb-rownum"></th>${g.fields.map(
    (_, i) => html`<th class="vb-letter" scope="col">${columnName(i)}</th>`,
  )}</tr><tr><th class="vb-rownum" scope="row">1</th>${g.fields.map(head)}</tr></thead>
<tbody>${g.values.map(
    (row, index) =>
      html`<tr data-panel=${props.panel ?? ''} data-row=${String(g.first + index)}><th class="vb-rownum" scope="row">${index + 2}</th>${g.fields.map(
        (c, i) => cell(row, index, c, i),
      )}</tr>`,
  )}</tbody></table>`;
}

export const VSheet = defineBlock(
  'VSheet',
  'vindu-sheet',
  { sheet: 'value', cells: 'value', words: 'value' },
  (props, element) => {
    const rows = props.rows as unknown[];
    const sheet = (props.sheet ?? {}) as Sheet;
    const cells = (props.cells ?? {}) as Cells;
    const formulas = sheet.formulas ?? {};
    const notes = notesByCell(cells.notes);
    const tabs = tabsOf(cells);
    if (!tabs) {
      const columns = cells.fields ?? fieldsOf(rows);
      const g: Grid = { fields: columns, values: rows.map((row) => valuesOf(row, columns)), first: 0 };
      return html`<div class="vb-sheet">${cellsTable(props, g, formulas, notes)}
${cutOf(rows.length, columns.length, cells, props)}${notesList(cells.notes)}${totalsOf(sheet, props)}</div>`;
    }
    // a workbook: the tab shown, its rows among those drawn, and the notes only where one sheet is shown
    const at = tabShown(element, tabs.length),
      tab = tabs[at],
      words = wordsGiven(props.words, BLOCK_WORDS.sheet);
    const drawn = rows.slice(tab.start, tab.start + tab.count),
      looks = (Array.isArray(cells.looks) ? cells.looks : []).slice(tab.start, tab.start + tab.count);
    const g: Grid = {
      fields: tab.fields,
      values: drawn.map((row) => valuesOf(row, tab.fields)),
      first: tab.first,
      book: { looks: looks.map(looksOf), head: tab.head, tab, words },
    };
    const own = tabs.length === 1 ? notes : new Map<string, CellNote>(),
      id = tabsId(element);
    return html`<div class="vb-workbook">${tabList(element, tabs, at, words)}<div class="vb-sheet" role="tabpanel" id=${`${id}-panel`} aria-labelledby=${`${id}-tab-${at}`}>${cellsTable(
      props,
      g,
      formulas,
      own,
    )}
${cutOf(drawn.length, tab.fields.length, tab, props)}${tabs.length === 1 ? notesList(cells.notes) : nothing}${totalsOf(sheet, props)}</div></div>`;
  },
);
