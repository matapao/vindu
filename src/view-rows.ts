import { rowKey } from './row-keys.js';
import fs from 'node:fs';
import type { CardKind } from './card-kinds/kind.js';
import { rowFields, type PanelSpec } from './cards.js';
import { computedName, parse, setValue } from './compute.js';
import { dataFormat } from './data-files.js';
import { wholePointer } from './pointing.js';
import { dataOf, pointerStep, type Entry, type Row } from './results.js';
import { Refusal } from './view-context.js';
import { asText } from './format.js';

/** Rows made from a list of plain values ({ value: x }): a reference to their value is the list's item itself. */
const wrapped = new WeakSet<Row>();
export const isWrapped = (r: Row) => wrapped.has(r);
const wrap = (x: unknown): Row => { const r = { value: x }; wrapped.add(r); return r; };

/** The rows a panel reads from an entry, and the JSON Pointer of the list they are in (rows are numbered under it; for
 *  an object of equal lists, read as columns, each value is at pointer/field/row). whole: an object is one row, whatever
 *  lists it holds. */
export function rowsOf(e: Entry, p: PanelSpec, notes: string[], whole = false): { rows: Row[]; pointer: string; columns?: boolean } {
  if (e.kind === 'attachment') {
    const format = dataFormat(e.name, e.mime);
    if (format) throw new Refusal(`panel ${p.id}: ${e.id} is a ${format.toUpperCase()} file (${e.name}); a table or a sheet shows its rows, read by the system`);
    throw new Refusal(`panel ${p.id}: ${e.id} is an attachment (${e.mime}); show it with a media panel, or point at the result where you read it`);
  }
  let v: unknown = e.kind === 'answer' ? dataOf(e) : e.value ?? (e.rows?.length ? e.rows : undefined);
  if (v === undefined && e.kind === 'result' && e.images.length) throw new Refusal(`panel ${p.id}: ${e.id} is an image, not data; show it with a media panel ("media": "${e.id}"), or type the rows you read from it`);
  let pointer = '';
  if (p.pick) { for (const k of p.pick.split('.')) { v = v && typeof v === 'object' && Object.hasOwn(v, k) ? (v as Record<string, unknown>)[k] : undefined; pointer += pointerStep(k); } if (v === undefined) throw new Refusal(`panel ${p.id}: ${e.id} has no "${p.pick}"`); }
  if (v === undefined || v === null) throw new Refusal(`panel ${p.id}: ${e.id} ${e.kind === 'answer' ? 'was declined, so it holds no values' : 'is text, not rows; show it in a text panel, or type the rows you read from it'}`);
  if (Array.isArray(v)) return { rows: v.map(x => x && typeof x === 'object' && !Array.isArray(x) ? x as Row : wrap(x)), pointer };
  if (typeof v === 'object') {
    if (whole) return { rows: [v as Row], pointer: wholePointer(pointer) };
    const o = v as Row, lists = Object.keys(o).filter(k => Array.isArray(o[k]));
    if (lists.length === 1) { notes.push(`panel ${p.id}: showed the list "${lists[0]}" of ${e.id}`); return { rows: (o[lists[0]] as unknown[]).map(x => x && typeof x === 'object' && !Array.isArray(x) ? x as Row : wrap(x)), pointer: pointer + pointerStep(lists[0]) }; }
    const n = lists.length ? (o[lists[0]] as unknown[]).length : 0;
    if (lists.length > 1 && n > 0 && lists.every(k => (o[k] as unknown[]).length === n && (o[k] as unknown[]).every(x => x === null || typeof x !== 'object'))) { // columns, one list each
      notes.push(`panel ${p.id}: read the lists ${lists.join(', ')} of ${e.id}${p.pick ? `.${p.pick}` : ''} as the columns of ${n} rows`);
      return { rows: Array.from({ length: n }, (_, i) => Object.fromEntries(lists.map(k => [k, (o[k] as unknown[])[i]]))), pointer, columns: true };
    }
    if (lists.length > 1) throw new Refusal(`panel ${p.id}: ${e.id}${p.pick ? `.${p.pick}` : ''} holds several lists (${lists.join(', ')}) of different lengths or with objects in them; say which with "pick"`);
    return { rows: [o], pointer: wholePointer(pointer) };
  }
  return { rows: [wrap(v)], pointer: wholePointer(pointer) };
}

/** A where condition: a value (equal), a list (any of them), or a string with an operator (>, >=, <, <=, !=). */
const OP = /^\s*(>=|<=|!=|>|<)\s*(.*?)\s*$/;
export function matcher(field: string, x: unknown): { test: (v: unknown) => boolean; says: string } {
  if (Array.isArray(x)) { const any = new Set(x.map(asText)); return { test: v => any.has(asText(v)), says: `${field} is one of ${x.map(asText).join(', ')}` }; }
  const m = typeof x === 'string' ? OP.exec(x) : null;
  if (!m) return { test: v => asText(v) === asText(x), says: `${field} = ${asText(x)}` };
  const [, op, rhs] = m, n = Number(rhs), num = rhs !== '' && Number.isFinite(n);
  const cmp = (v: unknown) => { const a = Number(v); return num && v !== null && v !== '' && Number.isFinite(a) ? a - n : asText(v ?? '').localeCompare(rhs); };
  const test = op === '!=' ? (v: unknown) => asText(v) !== rhs : (v: unknown) => { if (v === undefined || v === null || v === '') return false; const c = cmp(v); return op === '>' ? c > 0 : op === '>=' ? c >= 0 : op === '<' ? c < 0 : c <= 0; };
  return { test, says: `${field} ${op} ${rhs}` };
}
const valuesOf = (rows: Row[], f: string) => { const vs = [...new Set(rows.map(r => asText(r[f] ?? '')))]; return `${vs.slice(0, 8).join(', ')}${vs.length > 8 ? `, … (${vs.length} values)` : ''}`; };

/** What a card's kind says of how its rows are shaped: after a group, and in its own order. */
type Shaping = Pick<CardKind, 'grouped' | 'order'>;
/** where / group / sort / limit, applied by the system so the values stay exact; each step is kept for the account. */
export function shape(rows: Row[], p: PanelSpec, notes: string[], steps: Record<string, unknown>[] = [], inputs: Record<string, number> = {}, kind: Shaping = {}): Row[] {
  let out = rows;
  if (p.where) {
    const conds = Object.entries(p.where).map(([k, x]) => ({ k, ...matcher(k, x) }));
    const missing = conds.filter(c => !rows.some(r => Object.hasOwn(r, c.k))).map(c => c.k);
    if (missing.length) throw new Refusal(`panel ${p.id}: no field ${missing.map(f => `"${f}"`).join(', ')} to keep rows by (where); fields: ${rowFields(rows).slice(0, 15).join(', ')}`);
    out = out.filter(r => conds.every(c => c.test(Object.hasOwn(r, c.k) ? r[c.k] : undefined)));
    const says = conds.map(c => c.says).join(' and ');
    if (!out.length && !p.detail) throw new Refusal(`panel ${p.id}: where ${says} keeps none of the ${rows.length} rows; ${conds.map(c => `${c.k} has ${valuesOf(rows, c.k)}`).join('; ')}`); // a linked panel: none for the pick is its answer
    notes.push(`panel ${p.id}: kept ${out.length} of ${rows.length} rows where ${says}`); steps.push({ where: p.where, kept: out.length, of: rows.length });
  }
  if (p.group) { const before = out.length; out = groupRows(out, p, notes, inputs, kind); steps.push({ group: p.group, value: p.value ?? 'count()', rows: before, into: out.length }); }
  if (p.sort) {
    const m = /^\s*(-?)([^\s]+)(?:\s+(asc|desc|ascending|descending))?\s*$/i.exec(p.sort);
    if (!m) throw new Refusal(`panel ${p.id}: sort is a field and asc or desc, e.g. "amount desc"; got "${p.sort}"`);
    let f = m[2]; const desc = m[1] === '-' || /^desc/i.test(m[3] ?? '');
    const have = rowFields(out);
    if (!have.includes(f) && p.group && /^value$/i.test(f)) { f = computedName(p.value ?? 'count()'); notes.push(`panel ${p.id}: sorted by ${f}, the value computed for each ${p.group}`); }
    if (!have.includes(f)) throw new Refusal(`panel ${p.id}: no field "${f}" to sort by; fields${p.group ? ' after group' : ''}: ${have.slice(0, 15).join(', ')}`);
    const s = desc ? -1 : 1;
    const blank = (v: unknown) => v === undefined || v === null || v === '';
    const nums = out.every(r => blank(r[f]) || Number.isFinite(Number(r[f])));
    const rank = (v: unknown) => (blank(v) ? -Infinity : Number(v)); // a blank is below every number, and two blanks are even
    const byNumber = (x: unknown, y: unknown) => { const a = rank(x), b = rank(y); return a === b ? 0 : a < b ? -1 : 1; };
    out = [...out].sort((a, b) => s * (nums ? byNumber(a[f], b[f]) : asText(a[f] ?? '').localeCompare(asText(b[f] ?? ''))));
    steps.push({ sort: `${f} ${desc ? 'desc' : 'asc'}` });
  } else if (kind.order) out = kind.order(out, p); // the card's own order (a timeline's: in time)
  if (p.ordered?.length) { // an order set by hand: the rows listed first, in that order; the rest follow as they were
    const key = rowKey(out); const pos = new Map(p.ordered.map((k, i) => [String(k), i]));
    out = [...out.filter(r => pos.has(key(r))).sort((a, b) => pos.get(key(a))! - pos.get(key(b))!), ...out.filter(r => !pos.has(key(r)))];
    steps.push({ ordered: p.ordered.length, by: 'hand' });
  }
  if (p.limit) { const before = out.length; out = out.slice(0, p.limit); if (out.length < before) steps.push({ limit: p.limit, of: before }); }
  return out;
}

/** One row per value of the group field, with the value computed for each: the system does the arithmetic. */
function groupRows(rows: Row[], p: PanelSpec, notes: string[], inputs: Record<string, number>, kind: Shaping): Row[] {
  const g = p.group!; const expr = p.value ?? 'count()'; const field = computedName(expr);
  if (!rows.some(r => Object.hasOwn(r, g))) throw new Refusal(`panel ${p.id}: no field "${g}" to group by; fields: ${rowFields(rows).join(', ')}`);
  const groups = new Map<string, Row[]>(); for (const r of rows) { const k = asText(r[g] ?? ''); const xs = groups.get(k); if (xs) xs.push(r); else groups.set(k, [r]); }
  const out = [...groups].map(([k, rs]) => ({ [g]: k, [field]: aggregate(expr, rs, p.id, inputs) }));
  if (kind.grouped) kind.grouped(p, g, field, notes); // the card shows the value computed for each its own way
  else if (!p.columns?.every(c => c === g || c === field)) p.columns = [g, field];
  notes.push(`panel ${p.id}: grouped ${rows.length} rows by ${g} into ${out.length}, ${field} computed for each`);
  return out;
}

/** A value over rows, computed by the system: count(), sum(x), avg(x), min(x), max(x), and arithmetic on them. */
export function aggregate(expr: string, rows: Row[], id: string, inputs: Record<string, number> = {}): number {
  let v: number | null;
  try { v = setValue(parse(expr), rows, inputs); } catch (e) { throw new Refusal(`panel ${id}: value: ${(e as Error).message}`); }
  if (v === null) throw new Refusal(`panel ${id}: ${expr} has no numbers to compute with in these rows`);
  return v;
}

/** The first characters of a text file, read no further than they can be: a character is at most 4 bytes of UTF-8. */
function headOf(file: string, chars: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(chars * 4), n = fs.readSync(fd, buf, 0, buf.length, 0);
    return new TextDecoder().decode(buf.subarray(0, n)).slice(0, chars);
  } finally { fs.closeSync(fd); }
}
/** The plain text of a result, whatever route it came through; refused when the result is data. */
export function textOf(e: Entry, p: PanelSpec): string {
  if (e.kind === 'answer') { // a text the person wrote (a letter they changed and approved): theirs, as they wrote it
    const v = p.pick !== undefined && e.values && typeof e.values === 'object' ? e.values[String(p.pick)] : undefined;
    if (typeof v === 'string') return v.slice(0, 4000);
    throw new Refusal(`panel ${p.id}: ${e.id} holds the person's answer, not text; show it with a record card, or pick its text field`);
  }
  if (e.kind === 'attachment') { if (e.mime.startsWith('text/')) return headOf(e.file, 4000); throw new Refusal(`panel ${p.id}: ${e.name} is ${e.mime}; show it with a media panel`); }
  if (e.value !== undefined || e.rows?.length) throw new Refusal(`panel ${p.id}: ${e.id} holds data, not plain text; show it with a table, list or record card`);
  return e.text.slice(0, 4000);
}
