// How rows are told apart and named: by a field that is filled and unique in every row (an id, a number, a title), or
// else by the whole row. Shared by the actions inside a view, the blocks and linked panels.
import { asText } from './format.js';
type Row = Record<string, unknown>;

/** The field that tells rows apart: the first of these that is filled and unique in every row, if any. */
export function keyField(rows: Row[]): string | undefined {
  for (const f of ['id', 'key', 'number', 'ref', 'code', 'title', 'name', 'customer', 'subject']) {
    const vs = rows.map(r => r[f]);
    if (rows.length && vs.every(v => v !== undefined && v !== null && v !== '' && typeof v !== 'object') && new Set(vs.map(String)).size === rows.length) return f;
  }
  return undefined;
}
/** How rows are told apart in an order set by hand: by their key field, or else the whole row. */
export function rowKey(rows: Row[]): (r: Row) => string {
  const f = keyField(rows);
  return f ? r => String(r[f]) : r => JSON.stringify(r);
}
/** A row as the person reads it: its title, name, subject, number or id, or else its key. */
export const rowLabel = (r: Row | undefined, key: string) => asText(r?.title ?? r?.name ?? r?.subject ?? r?.number ?? r?.id ?? key);
/** A value as it is quoted back: text in quotes, anything else as JSON. */
export const quoted = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
/** The row an action names, by its key or its place (from 0), with the keys of all the rows; or why there is none. */
export function rowAt(rows: Row[], a: { key?: string | number; from?: number }, noun: string, where: string): { at: number; keys: string[] } | { refusal: string } {
  const keys = rows.map(rowKey(rows));
  const at = a.key !== undefined ? keys.indexOf(String(a.key)) : a.from ?? -1;
  if (at < 0 || at >= rows.length) return { refusal: `no ${noun} ${a.key !== undefined ? quoted(a.key) : `at place ${(a.from ?? -1) + 1}`} in ${where}; its ${noun}s: ${keys.slice(0, 12).join(', ')}` };
  return { at, keys };
}
