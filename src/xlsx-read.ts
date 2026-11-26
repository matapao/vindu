// A workbook (.xlsx) read by the system from its parts (office-parts.ts): its worksheets in the workbook's order, by
// name, each a grid of its cells as Excel shows them, without the empty rows and columns at its edges. A cell holds its
// value as last saved in the file: a shared or inline string, a number, a boolean, an error as its text (#DIV/0!), or a
// formula's cached value, never computed again, with the formula itself; a number formatted as a date or a time is that
// date or time in ISO 8601 (xlsx-formats.ts). Hidden sheets and chart sheets are left out, and said to be. A workbook with
// macros (a vbaProject.bin part, or an Excel 4.0 macro sheet) is refused, and so is one larger than MAX_CELLS or MAX_AREA.
import { columnName } from './cell-address.js';
import { mainPart, partTree, readPart, refuseMacros, relatedPart, relationsOf } from './office-parts.js';
import { formatCode, lookOf, serialDate, type NumberLook } from './xlsx-formats.js';
import { attributeOf, elementOf, elementsOf, localName } from './xml-read.js';
import type { ZipArchive } from './zip-read.js';

/** A cell: its value, how its number is drawn (look), and its formula, as written in the file, without its =. */
export type SheetCell = { value: string | number | boolean; look?: NumberLook; formula?: string };
/** Merged cells: the top left one, from 0 in the sheet's grid, and how many rows and columns it spans. */
type Merge = { row: number; column: number; rows: number; columns: number };
/** A worksheet: its name; where its grid starts in the file (row and column from 0); its grid, row by row; its merges. */
export type Worksheet = {
  name: string;
  row: number;
  column: number;
  grid: (SheetCell | undefined)[][];
  merges: Merge[];
};
/** A workbook's worksheets in its order, and the sheets left out, each with why. */
export type Workbook = { sheets: Worksheet[]; left: { name: string; why: string }[] };

/** The cells with values a workbook holds at most, in all its sheets. */
const MAX_CELLS = 1_000_000;
/** The cells its sheets span at most, in all, empty ones included, once their edges are trimmed. */
const MAX_AREA = 2_000_000;
const count = (n: number) => n.toLocaleString('en-GB');

/** A cell's address (B3) as its column and row, from 0; null for one that is not an address. */
function addressOf(ref: string): { column: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref);
  if (!m) return null;
  let column = 0;
  for (const c of m[1].toUpperCase()) column = column * 26 + c.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(m[2]) - 1 };
}

/** Text as Excel escapes what XML cannot hold (_x000D_ for a carriage return, _x005F_ for an underscore before one). */
const unescaped = (s: string) =>
  s.includes('_x') ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : s;

/** The shared strings, in order: each one's text, its runs joined, its phonetic guide (rPh) left out. */
function sharedStrings(zip: ZipArchive, part: string | undefined): string[] {
  const out: string[] = [];
  let current: string | undefined,
    phonetic = 0,
    inText = false;
  readPart(zip, part ?? 'xl/sharedStrings.xml', {
    open: (name) => {
      const n = localName(name);
      if (n === 'si') current = '';
      else if (n === 'rPh') phonetic++;
      else if (n === 't' && !phonetic) inText = true;
    },
    close: (name) => {
      const n = localName(name);
      if (n === 'si') {
        out.push(unescaped(current ?? ''));
        current = undefined;
      } else if (n === 'rPh') phonetic--;
      else if (n === 't') inText = false;
    },
    text: (t) => {
      if (inText && current !== undefined) current += t;
    },
  });
  return out;
}

/** How each cell style (by its place in cellXfs) draws a number: by its number format, the workbook's or a built-in one. */
function cellLooks(zip: ZipArchive, part: string | undefined): (NumberLook | undefined)[] {
  const styles = partTree(zip, part ?? 'xl/styles.xml');
  if (!styles) return [];
  const formats = elementOf(styles, 'numFmts'),
    xfs = elementOf(styles, 'cellXfs');
  const own = new Map(
    (formats ? elementsOf(formats, 'numFmt') : []).map((f) => [
      Number(attributeOf(f, 'numFmtId')),
      attributeOf(f, 'formatCode') ?? 'General',
    ]),
  );
  return (xfs ? elementsOf(xfs, 'xf') : []).map((xf) =>
    lookOf(formatCode(Number(attributeOf(xf, 'numFmtId') ?? 0), own)),
  );
}

/** A shared formula moved from its first cell to another, as Excel fills it: each relative reference (not after a $)
 *  shifted by as many rows and columns; text in quotes and sheet names are left as they are. */
function shifted(formula: string, rows: number, columns: number): string {
  if (!rows && !columns) return formula;
  return formula
    .split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            /(^|[^A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)([1-9]\d{0,6})(?![A-Za-z0-9_(])/g,
            (_, before: string, fixColumn: string, letters: string, fixRow: string, digits: string) => {
              const at = addressOf(`${letters}${digits}`)!;
              const column = fixColumn ? at.column : at.column + columns,
                row = fixRow ? at.row : at.row + rows;
              return column < 0 || row < 0
                ? `${before}#REF!`
                : `${before}${fixColumn}${columnName(column)}${fixRow}${row + 1}`;
            },
          ),
    )
    .join('');
}

type Raw = {
  type: string;
  style: number;
  value: string;
  inline: string;
  formula?: string;
  formulaAttributes?: Record<string, string>;
};
/** A cell's value as Excel shows it, from what the file holds; undefined for a cell with neither a value nor a formula. */
function cellOf(
  raw: Raw,
  strings: string[],
  looks: (NumberLook | undefined)[],
  from1904: boolean,
): SheetCell | undefined {
  const formula = raw.formula ? { formula: raw.formula } : {};
  if (raw.type === 'inlineStr') return { value: unescaped(raw.inline), ...formula };
  if (raw.value === '') return raw.formula ? { value: '', ...formula } : undefined;
  if (raw.type === 's') return { value: strings[Number(raw.value)] ?? '', ...formula };
  if (raw.type === 'str' || raw.type === 'e') return { value: unescaped(raw.value), ...formula };
  if (raw.type === 'b') return { value: raw.value === '1' || raw.value === 'true', ...formula };
  if (raw.type === 'd')
    return {
      value: raw.value.replace(/Z$/, '').replace(/T00:00(:00(\.0+)?)?$/, ''),
      look: { format: raw.value.includes('T') ? 'datetime' : 'date' },
      ...formula,
    };
  const n = Number(raw.value),
    look = looks[raw.style];
  if (!Number.isFinite(n)) return { value: raw.value, ...formula };
  if (look && (look.format === 'date' || look.format === 'time' || look.format === 'datetime')) {
    const when = serialDate(n, look, from1904);
    return when === null ? { value: n, ...formula } : { value: when, look, ...formula };
  }
  return { value: n, ...(look ? { look } : {}), ...formula };
}

/** A worksheet's cells by row and column (from 0), and its merges as written, read as the part goes. */
function cellsOf(
  zip: ZipArchive,
  part: string,
  strings: string[],
  looks: (NumberLook | undefined)[],
  from1904: boolean,
  budget: { cells: number },
) {
  const cells = new Map<number, Map<number, SheetCell>>(),
    merges: string[] = [];
  const masters = new Map<string, { text: string; row: number; column: number }>();
  let inData = false,
    row = -1,
    column = -1,
    raw: Raw | undefined,
    at: { row: number; column: number } | undefined;
  let collecting: 'value' | 'formula' | 'inline' | undefined,
    inInline = false,
    phonetic = 0;
  const found = readPart(zip, part, {
    open: (name, attributes) => {
      const n = localName(name);
      if (n === 'sheetData') inData = true;
      else if (n === 'mergeCell' && attributes.ref) merges.push(attributes.ref);
      if (!inData) return;
      if (n === 'row') {
        row = attributes.r ? Number(attributes.r) - 1 : row + 1;
        column = -1;
      } else if (n === 'c') {
        const ref = attributes.r ? addressOf(attributes.r) : null;
        at = ref ?? { row, column: column + 1 };
        column = at.column;
        raw = { type: attributes.t ?? 'n', style: Number(attributes.s ?? 0), value: '', inline: '' };
      } else if (raw && n === 'v') {
        collecting = 'value';
      } else if (raw && n === 'f') {
        collecting = 'formula';
        raw.formula = '';
        raw.formulaAttributes = attributes;
      } else if (raw && n === 'is') inInline = true;
      else if (inInline && n === 'rPh') phonetic++;
      else if (inInline && n === 't' && !phonetic) collecting = 'inline';
    },
    text: (t) => {
      if (!raw || !collecting) return;
      raw[collecting] = (raw[collecting] ?? '') + t;
    },
    close: (name) => {
      const n = localName(name);
      if (n === 'sheetData') inData = false;
      else if (n === 'v' || n === 'f' || n === 't') collecting = undefined;
      else if (n === 'is') inInline = false;
      else if (n === 'rPh') phonetic--;
      else if (n === 'c' && raw && at) {
        const f = raw.formulaAttributes,
          si = f?.si;
        if (f?.t === 'shared' && si !== undefined) {
          if (raw.formula) masters.set(si, { text: raw.formula, row: at.row, column: at.column });
          else {
            const m = masters.get(si);
            raw.formula = m ? shifted(m.text, at.row - m.row, at.column - m.column) : undefined;
          }
        }
        const cell = cellOf(raw, strings, looks, from1904);
        if (cell) {
          if (cell.value !== '' && --budget.cells < 0)
            throw new Error(
              `holds more than ${count(MAX_CELLS)} cells with values; a sheet reads workbooks of at most that many`,
            );
          let line = cells.get(at.row);
          if (!line) cells.set(at.row, (line = new Map()));
          line.set(at.column, cell);
        }
        raw = undefined;
      }
    },
  });
  if (!found) throw new Error(`has no part ${part}, which its workbook names as a worksheet`);
  return { cells, merges };
}

/** A worksheet's grid without the empty rows and columns at its edges, and its merges within it. */
function gridOf(name: string, read: ReturnType<typeof cellsOf>, budget: { area: number }): Worksheet {
  let top = Infinity,
    bottom = -1,
    left = Infinity,
    right = -1;
  for (const [r, line] of read.cells)
    for (const [c, cell] of line) {
      if (cell.value === '') continue;
      top = Math.min(top, r);
      bottom = Math.max(bottom, r);
      left = Math.min(left, c);
      right = Math.max(right, c);
    }
  if (bottom < 0) return { name, row: 0, column: 0, grid: [], merges: [] };
  const width = right - left + 1,
    height = bottom - top + 1;
  budget.area -= width * height;
  if (budget.area < 0)
    throw new Error(
      `has sheets that span more than ${count(MAX_AREA)} cells in all (${name} is ${count(width)} columns by ${count(height)} rows); a sheet reads workbooks up to that`,
    );
  const grid = Array.from({ length: height }, (_, i) => {
    const line = read.cells.get(top + i);
    return Array.from({ length: width }, (_, j) => line?.get(left + j));
  });
  const merges: Merge[] = [];
  for (const ref of read.merges) {
    const [a, b] = ref.split(':').map(addressOf);
    if (!a || !b || a.row < top || a.column < left || a.row > bottom || a.column > right) continue; // its value is outside the grid
    const rows = Math.min(b.row, bottom) - a.row + 1,
      columns = Math.min(b.column, right) - a.column + 1;
    if (rows * columns > 1) merges.push({ row: a.row - top, column: a.column - left, rows, columns });
  }
  return { name, row: top, column: left, grid, merges };
}

/** A workbook's worksheets, in its order. Throws, saying why, for a workbook the system does not read. */
export function readWorkbook(zip: ZipArchive): Workbook {
  refuseMacros(zip);
  const book = mainPart(zip, 'xl/workbook.xml');
  const root = partTree(zip, book);
  if (!root || localName(root.name) !== 'workbook')
    throw new Error('is not a workbook: it has no workbook part (xl/workbook.xml)');
  const relations = relationsOf(zip, book);
  const properties = elementOf(root, 'workbookPr'),
    date1904 = properties && attributeOf(properties, 'date1904');
  const from1904 = date1904 === '1' || date1904 === 'true';
  const strings = sharedStrings(zip, relatedPart(relations, 'sharedStrings'));
  const looks = cellLooks(zip, relatedPart(relations, 'styles'));
  const sheets: Worksheet[] = [],
    left: Workbook['left'] = [],
    budget = { cells: MAX_CELLS, area: MAX_AREA };
  const listed = elementOf(root, 'sheets');
  for (const sheet of listed ? elementsOf(listed, 'sheet') : []) {
    const name = attributeOf(sheet, 'name') ?? '',
      state = attributeOf(sheet, 'state') ?? 'visible';
    const relation = relations.get(attributeOf(sheet, 'id') ?? '');
    if (/macrosheet$/i.test(relation?.kind ?? ''))
      throw new Error(
        `holds macros (its Excel 4.0 macro sheet ${name}); the system reads workbooks without them: .xlsx`,
      );
    if (state !== 'visible') {
      left.push({ name, why: state === 'veryHidden' ? 'very hidden' : 'hidden' });
      continue;
    }
    if (relation?.kind !== 'worksheet' || relation.external) {
      left.push({ name, why: relation?.kind === 'chartsheet' ? 'a chart sheet' : 'not a worksheet' });
      continue;
    }
    sheets.push(gridOf(name, cellsOf(zip, relation.target, strings, looks, from1904, budget), budget));
  }
  return { sheets, left };
}
