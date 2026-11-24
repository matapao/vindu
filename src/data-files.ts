// A data file shown as rows by a table or a sheet: a CSV, TSV or JSON file the person attached (from: a1) or one in the
// working folder (path). The system reads and parses it, so every value is the file's own and none is typed by the
// model. A cell of a CSV or TSV file that is a number exactly as written (31050, -2.5) is that number; every other
// cell is its text as written ("007", "1.50", "").
import type { DataFileRead, PanelSpec } from './cards.js';
import { parseDelimited } from './delimited.js';
import { extensionOf } from './file-types.js';
import { asText } from './format.js';
import { readText } from './page-head.js';
import type { Entry, Row } from './results.js';
import { Refusal, type ViewContext } from './view-context.js';

/** The largest data file a table or a sheet reads. */
const DATA_MAX = 5_000_000;
export type DataFormat = 'csv' | 'tsv' | 'json';
const BY_TYPE: Record<string, DataFormat> = { 'text/csv': 'csv', 'text/tab-separated-values': 'tsv', 'application/json': 'json' };
const BY_EXTENSION: Record<string, DataFormat> = { csv: 'csv', tsv: 'tsv', json: 'json' };

/** A file's data format by its type (text/csv, text/tab-separated-values, application/json), or else by its name's
 *  extension (.csv, .tsv, .json); undefined for any other file. */
export function dataFormat(name: string, mime = ''): DataFormat | undefined {
  const type = mime.split(';')[0].trim().toLowerCase();
  return Object.hasOwn(BY_TYPE, type) ? BY_TYPE[type] : Object.hasOwn(BY_EXTENSION, extensionOf(name)) ? BY_EXTENSION[extensionOf(name)] : undefined;
}
/** An attachment a table or a sheet reads as rows: a CSV, TSV or JSON file. */
const isDataAttachment = (e: Entry | undefined): e is Extract<Entry, { kind: 'attachment' }> =>
  e?.kind === 'attachment' && dataFormat(e.name, e.mime) !== undefined;

/** A data file's rows and their columns in order, and each row's own row in the file (row 1 is the header). */
type DataTable = { rows: Row[]; columns: string[]; lines: number[] };

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** A cell as written, or the number it is when the number is written exactly so. */
const cellValue = (s: string): string | number => (NUMBER.test(s) && String(Number(s)) === s ? Number(s) : s);

/** The header's names, each once: an empty one named by its place (c3), one written twice with its count ("total (2)"). */
function headerOf(names: string[], said: string[]): string[] {
  const seen = new Map<string, number>(); const out: string[] = [];
  for (const [i, raw] of names.entries()) {
    const base = raw.trim() === '' ? `c${i + 1}` : raw;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    out.push(n > 1 ? `${base} (${n})` : base);
  }
  const renamed = out.filter((x, i) => x !== names[i]);
  if (renamed.length) said.push(`named ${renamed.length} column${renamed.length > 1 ? 's' : ''} of the header that ${renamed.length > 1 ? 'were' : 'was'} empty or written twice: ${renamed.slice(0, 6).join(', ')}`);
  return out;
}
/** Records under a header row: one row each, a cell past the header named by its place. */
function underHeader(records: unknown[][], toValue: (x: unknown) => unknown, said: string[]): DataTable {
  const columns = headerOf((records[0] ?? []).map(x => asText(x ?? '')), said);
  const width = records.reduce((n, r) => Math.max(n, r.length), columns.length);
  for (let i = columns.length; i < width; i++) columns.push(`c${i + 1}`);
  const rows = records.slice(1).map(r => Object.fromEntries(columns.map((c, i) => [c, i < r.length ? toValue(r[i]) : ''])));
  return { rows, columns, lines: rows.map((_, i) => i + 2) };
}

/** What a JSON value is, for a refusal that names it. */
const whatItHolds = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'a list of plain values, or of records and other values mixed' : typeof v === 'string' ? 'one string' : typeof v === 'object' ? 'an object' : `one ${typeof v}`;
const isRecord = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON as rows: a list of records as they are; a list of lists under its first, the header; one object as a row
 *  for each field (Key, Value). pick: the list or object inside it to show, e.g. "items". */
function jsonTable(text: string, name: string, pick: string | undefined, said: string[]): DataTable {
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { throw new Error(`"${name}" is not JSON: ${(e as Error).message}`); }
  if (pick) for (const k of pick.split('.')) {
    if (!isRecord(v) || !Object.hasOwn(v, k)) throw new Error(`"${name}" has no "${pick}"`);
    v = v[k];
  }
  if (Array.isArray(v) && v.every(isRecord)) {
    const columns = [...new Set(v.flatMap(r => Object.keys(r)))];
    return { rows: v, columns, lines: v.map((_, i) => i + 2) };
  }
  if (Array.isArray(v) && v.length && v.every(Array.isArray)) return underHeader(v as unknown[][], x => x, said);
  if (isRecord(v)) {
    said.push(`showed the object in "${name}" as one row for each of its ${Object.keys(v).length} fields (Key, Value)`);
    const rows = Object.entries(v).map(([Key, Value]) => ({ Key, Value }));
    return { rows, columns: ['Key', 'Value'], lines: rows.map((_, i) => i + 2) };
  }
  throw new Error(`"${name}"${pick ? ` at "${pick}"` : ''} holds ${whatItHolds(v)}, not rows: a JSON file shows as a list of records, a list of lists (the first its header) or one object`);
}

/** A data file's text as rows. Throws, saying why, when it holds no rows that can be shown. */
function tableOf(text: string, format: DataFormat, name: string, pick: string | undefined, said: string[]): DataTable {
  if (format === 'json') return jsonTable(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, name, pick, said);
  if (pick) throw new Error(`pick reads inside a JSON file; "${name}" is one table, shown whole`);
  let records: string[][];
  try { records = parseDelimited(text, format === 'tsv' ? '\t' : ','); } catch (e) { throw new Error(`"${name}" is not ${format.toUpperCase()} the system can read: ${(e as Error).message}`); }
  return underHeader(records, x => cellValue(x as string), said);
}

/** A file's bytes as text, read no further than DATA_MAX allows. */
function textOfFile(file: string, name: string): string {
  const { size, bytes } = readText(file, DATA_MAX);
  if (!bytes) throw new Error(`"${name}" is ${(size / 1e6).toFixed(1)} MB; a table or a sheet reads data files up to ${DATA_MAX / 1e6} MB`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error(`"${name}" is not UTF-8 text`); }
}

/** Where a data file is: an attachment, or a file in the working folder (path), with its name and format. */
type Source = { name: string; from: string; file: string; format: DataFormat };
function sourceOf(p: PanelSpec, e: Entry | undefined, ctx: ViewContext): Source {
  if (p.path !== undefined && p.from !== undefined) throw new Error(`a ${p.card} shows from (a result or an attachment) or path (a file in the working folder), not both`);
  if (isDataAttachment(e)) return { name: e.name, from: e.id, file: e.file, format: dataFormat(e.name, e.mime)! };
  const want = String(p.path), notData = `"${want}" is not a data file: a ${p.card} reads .csv, .tsv and .json files`;
  if (!dataFormat(want)) throw new Error(notData);
  if (!ctx.pages?.workPath) throw new Error('this host reads no files from a working folder');
  const found = ctx.pages.workPath(want);
  if (!found) throw new Error(`no file "${want}" in the working folder`);
  const format = dataFormat(found.rel);
  if (!format) throw new Error(notData);
  return { name: found.rel, from: `work/${found.rel}`, file: found.file, format };
}

/** The rows a table or a sheet shows from a data file, and what the file is: an attachment that is CSV, TSV or JSON
 *  (from), or a file of these in the working folder (path). Undefined when the panel names neither. */
export function dataFileOf(p: PanelSpec, e: Entry | undefined, ctx: ViewContext, said: string[]): { rows: Row[]; file: DataFileRead } | undefined {
  if (p.path === undefined && !isDataAttachment(e)) return undefined;
  const notes: string[] = [];
  let at: Source, table: DataTable;
  try {
    at = sourceOf(p, e, ctx);
    table = tableOf(textOfFile(at.file, at.name), at.format, at.name, p.pick, notes);
  } catch (x) { throw new Refusal(`panel ${p.id}: ${(x as Error).message}`); }
  for (const n of notes) said.push(`panel ${p.id}: ${n}`);
  const index = new Map(table.rows.map((r, i) => [r, table.lines[i]]));
  return { rows: table.rows, file: { name: at.name, from: at.from, format: at.format, rows: table.rows.length, columns: table.columns.length, index } };
}
