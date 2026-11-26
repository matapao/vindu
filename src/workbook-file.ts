// A workbook (.xlsx) shown in a sheet card: each worksheet that is not hidden is a tab of its own, in the workbook's
// order and by its name, its first row its header (row 1, as a CSV file's) and its other rows under it. The system reads
// the file (zip-read.ts, xlsx-read.ts), so every value is the file's own, as Excel last saved it, and no formula is
// computed again. pick names one sheet, which is then shown alone and is read as any data file's rows (where, sort,
// compute, notes); a workbook of several sheets shows them all, each as it is, and a merged cell spans its rows and
// columns where the rows are drawn in the file's order.
import { columnName } from './cell-address.js';
import {
  rowFields,
  type CellLook,
  type CellMerge,
  type DataFileRead,
  type PanelSpec,
  type Resolved,
  type SheetRead,
} from './cards.js';
import { headerOf } from './header-row.js';
import type { Row } from './results.js';
import { readWorkbook, type SheetCell, type Worksheet } from './xlsx-read.js';
import { withZipFile } from './zip-read.js';

/** What the window is told a sheet's cells are, and what the account says each value is. */
const CELLS =
  "each value as Excel last saved it in the file: text, numbers, booleans, and errors as their text (#DIV/0!); a formula's cached value, never computed again, with its formula marked on its cell; dates and times in ISO 8601 (2026-03-14, 09:30, 2026-03-14T09:30), which the card writes as the locale does; a percentage as its fraction (0.25 is drawn 25 %)";
/** What a workbook of several sheets does not take, since each sheet has its own columns: they work on one sheet, by pick. */
const ONE_SHEET = [
  'where',
  'sort',
  'limit',
  'group',
  'compute',
  'dates',
  'ordered',
  'notes',
  'totals',
  'scenarios',
  'detail',
];
/** The cells, and rows, a sheet card draws of a workbook in all, at most, so that a window holds them. */
const DRAWN_CELLS = 200_000,
  DRAWN_ROWS = 8000;

/** A header cell's text, as Excel writes it. */
function headerText(cell: SheetCell | undefined): string {
  if (!cell) return '';
  if (typeof cell.value === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
  return String(cell.value);
}
/** How a cell is drawn besides its value, or undefined when it is drawn as any value is. */
function lookOf(cell: SheetCell | undefined): CellLook | undefined {
  if (!cell || (!cell.look && cell.formula === undefined)) return undefined;
  return { ...cell.look, ...(cell.formula !== undefined ? { formula: cell.formula } : {}) };
}

/** A worksheet as a tab: its header's fields, its rows under it, each row's line in it (row 1 its header), and its looks. */
function sheetRead(sheet: Worksheet, said: string[]): { read: SheetRead; lines: number[] } {
  const [head = [], ...body] = sheet.grid;
  const notes: string[] = [];
  const fields = headerOf(head.map(headerText), notes);
  for (const n of notes) said.push(`${sheet.name}: ${n}`);
  const looks = new Map<number, Record<string, CellLook>>();
  sheet.grid.forEach((line, i) => {
    const own: Record<string, CellLook> = {};
    line.forEach((cell, j) => {
      const look = lookOf(cell);
      if (look) own[fields[j]] = look;
    });
    if (Object.keys(own).length) looks.set(i + 1, own);
  });
  const rows = body.map((line) => Object.fromEntries(fields.map((f, j) => [f, line[j]?.value ?? ''])));
  const merges: CellMerge[] = sheet.merges.map((m) => ({ ...m, row: m.row - 1 }));
  return {
    read: { name: sheet.name, at: `${columnName(sheet.column)}${sheet.row + 1}`, fields, rows, looks, merges },
    lines: rows.map((_, i) => i + 2),
  };
}

/** The sheets a panel shows of a workbook: the one pick names, or all those with cells that are not hidden. */
function shownSheets(
  sheets: Worksheet[],
  left: { name: string; why: string }[],
  name: string,
  p: PanelSpec,
): Worksheet[] {
  if (!sheets.length) throw new Error(`"${name}" has no cells with values in its sheets that are not hidden`);
  if (p.pick === undefined) {
    const shaped = ONE_SHEET.filter((k) => {
      const v = (p as Record<string, unknown>)[k];
      return v !== undefined && !(Array.isArray(v) && !v.length);
    });
    if (sheets.length > 1 && shaped.length) {
      throw new Error(
        `"${name}" has ${sheets.length} sheets (${sheets.map((s) => s.name).join(', ')}), shown as they are, a tab each; ${shaped.join(', ')} ${shaped.length > 1 ? 'work' : 'works'} on one sheet: name it with pick ("pick": ${JSON.stringify(sheets[0].name)})`,
      );
    }
    return sheets;
  }
  const want = String(p.pick).trim().toLowerCase(),
    sheet = sheets.find((s) => s.name.toLowerCase() === want);
  const out = left.find((s) => s.name.toLowerCase() === want);
  if (out)
    throw new Error(
      `"${name}" leaves its sheet ${out.name} out (${out.why}); the sheets it shows: ${sheets.map((s) => s.name).join(', ')}`,
    );
  if (!sheet)
    throw new Error(
      `"${name}" has no sheet ${JSON.stringify(p.pick)}; its sheets: ${sheets.map((s) => s.name).join(', ')}`,
    );
  return [sheet];
}

/** A workbook's rows, as a sheet card shows them, and what the file is: its sheets, a tab each. */
export function workbookOf(
  file: string,
  name: string,
  p: PanelSpec,
  said: string[],
): { rows: Row[]; file: Omit<DataFileRead, 'name' | 'from'> } {
  if (/\.xlsm$/i.test(name))
    throw new Error(`"${name}" is a workbook with macros (.xlsm); the system reads workbooks without them: .xlsx`);
  let book: ReturnType<typeof readWorkbook>;
  try {
    book = withZipFile(file, readWorkbook);
  } catch (x) {
    throw new Error(`"${name}" ${(x as Error).message}`);
  }
  const out = [...book.left, ...book.sheets.filter((s) => !s.grid.length).map((s) => ({ name: s.name, why: 'empty' }))];
  const sheets = shownSheets(
    book.sheets.filter((s) => s.grid.length),
    out,
    name,
    p,
  ).map((s) => sheetRead(s, said));
  const rows = sheets.flatMap((s) => s.read.rows);
  const index = new Map(sheets.flatMap((s) => s.read.rows.map((r, i) => [r, s.lines[i]] as const)));
  const left = out.map((s) => `${s.name} (${s.why})`);
  if (left.length) said.push(`"${name}": left out ${left.length > 1 ? 'the sheets' : 'the sheet'} ${left.join(', ')}`);
  return {
    rows,
    file: {
      format: 'xlsx',
      rows: rows.length,
      columns: Math.max(0, ...sheets.map((s) => s.read.fields.length)),
      index,
      sheets: sheets.map((s) => s.read),
      told: { cells: CELLS, ...(left.length ? { left_out: left } : {}) },
    },
  };
}

/** A sheet as a tab drawn: which of the panel's rows it draws, from where (first), of how many, with which fields. */
type Tab = { sheet: SheetRead; rows: Row[]; first: number; fields: string[]; total: number; columns: number };
/** The fields of rows as cells: in the order they first appear, without those the system keeps to itself (__). */
const cellFields = (rows: Row[]) => rowFields(rows).filter((k) => !k.startsWith('__'));

/** The tabs a workbook draws: one sheet's rows as shaped (pick, or a workbook of one), or each sheet's own rows and
 *  fields; as many rows and columns of each as most allows, and DRAWN_CELLS and DRAWN_ROWS in all. */
function tabsOf(d: Resolved, sheets: SheetRead[], most: { rows: number; columns: number }): Tab[] {
  const all = d.rows ?? [];
  if (sheets.length === 1) {
    const rows = all.slice(0, most.rows);
    return [
      {
        sheet: sheets[0],
        rows,
        first: 0,
        fields: cellFields(rows.length ? rows : all).slice(0, most.columns),
        total: all.length,
        columns: cellFields(all).length || sheets[0].fields.length,
      },
    ];
  }
  let cells = DRAWN_CELLS,
    rowsLeft = DRAWN_ROWS,
    first = 0;
  return sheets.map((sheet) => {
    const fields = sheet.fields.slice(0, most.columns);
    const n = Math.max(
      0,
      Math.min(sheet.rows.length, most.rows, rowsLeft, Math.floor(cells / Math.max(1, fields.length))),
    );
    cells -= n * fields.length;
    rowsLeft -= n;
    const tab = {
      sheet,
      rows: sheet.rows.slice(0, n),
      first,
      fields: sheet.fields.length ? fields : [],
      total: sheet.rows.length,
      columns: sheet.fields.length,
    };
    first += sheet.rows.length;
    return tab;
  });
}

/** The merges a tab draws: within its rows and columns; of its rows, only where they are the file's, in its order. */
function mergesOf(tab: Tab, lines: Map<Row, number>): CellMerge[] {
  const inOrder =
    tab.rows.every((r, i) => lines.get(r) === i + 2) &&
    tab.fields.every((f, j) => j >= tab.sheet.fields.length || f === tab.sheet.fields[j]);
  return tab.sheet.merges
    .filter((m) => (m.row < 0 || inOrder) && m.row < tab.rows.length && m.column < tab.fields.length)
    .map((m) => ({
      ...m,
      rows: Math.min(m.rows, tab.rows.length - m.row),
      columns: Math.min(m.columns, tab.fields.length - m.column),
    }))
    .filter((m) => m.rows * m.columns > 1);
}
/** A row's looks, as one JSON list in the order of its fields (null for a cell drawn as any value is), or '' when it
 *  has none. */
function looksOf(sheet: SheetRead, line: number | undefined, fields: string[]): string {
  const own = line === undefined ? undefined : sheet.looks.get(line);
  if (!own) return '';
  const list = fields.map((f) => own[f] ?? null);
  return list.some(Boolean) ? JSON.stringify(list) : '';
}

/** What a sheet card draws of a workbook: its rows as cells (one JSON list of values each, a tab after another), each
 *  row's looks (a JSON list, or ''), and each tab: its name, fields, where its rows are among those drawn (start) and
 *  among the panel's rows (first), how many it has and draws, where it starts in the file, its header's looks and its
 *  merges (as JSON). Undefined for rows that are not a workbook's. */
export function workbookDrawing(d: Resolved, most: { rows: number; columns: number }) {
  const file = d.file && 'format' in d.file ? d.file : undefined;
  if (!file?.sheets) return undefined;
  const rows: string[] = [],
    looks: string[] = [];
  const sheets = tabsOf(d, file.sheets, most).map((tab) => {
    const start = rows.length;
    for (const r of tab.rows) {
      rows.push(JSON.stringify(tab.fields.map((f) => r[f] ?? null)));
      looks.push(looksOf(tab.sheet, file.index.get(r), tab.fields));
    }
    return {
      name: tab.sheet.name,
      fields: tab.fields,
      start,
      count: tab.rows.length,
      first: tab.first,
      rows: tab.total,
      columns: tab.columns,
      at: tab.sheet.at,
      head: looksOf(tab.sheet, 1, tab.fields),
      merges: JSON.stringify(mergesOf(tab, file.index).map((m) => [m.row, m.column, m.rows, m.columns])),
    };
  });
  return { rows, looks, sheets };
}

/** What the account says of a workbook's sheets: each one's name, rows and columns, where it starts in the file, how
 *  many of its cells hold a formula or a date, and how many rows and columns of it are drawn where not all are. */
export function workbookAccount(
  o: Record<string, unknown>,
  d: Resolved,
  most: { rows: number; columns: number },
): void {
  const file = d.file && 'format' in d.file ? d.file : undefined;
  if (!file?.sheets || !o.file || typeof o.file !== 'object') return;
  const tabs = tabsOf(d, file.sheets, most);
  (o.file as Record<string, unknown>).sheets = tabs.map((tab) => {
    const looks = [...tab.sheet.looks.values()].flatMap(Object.values);
    const formulas = looks.filter((l) => l.formula !== undefined).length,
      dates = looks.filter((l) => /date|time/.test(l.format ?? '')).length;
    return {
      name: tab.sheet.name,
      rows: tab.total,
      columns: tab.columns,
      at: tab.sheet.at,
      ...(formulas ? { formulas } : {}),
      ...(dates ? { dates } : {}),
      ...(tab.sheet.merges.length ? { merged: tab.sheet.merges.length } : {}),
      ...(tab.rows.length < tab.total ? { shown_rows: tab.rows.length } : {}),
      ...(tab.fields.length < tab.columns ? { shown_columns: tab.fields.length } : {}),
    };
  });
  if (file.sheets.length > 1) {
    delete o.shown_rows;
    delete o.shown_columns;
  }
}
