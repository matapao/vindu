// What Vindu reads: a process's results by id, from any store. A host's record of a process is one; memoryResults is another.
// Vindu never writes results and never needs to know which route brought them. It keeps one store of its own: what
// the person answered in the window (p1, p2, …), which views can show like any result.
// A value inside an entry is named by a reference: ctx:<id>#<JSON Pointer>, e.g. ctx:r3#/0/amount.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { amountsIn } from './amounts.js';

export type Row = Record<string, unknown>;
export interface ResultEntry {
  id: string; kind: 'result'; tool: string; server: string; input?: unknown;
  text: string; value?: unknown; rows?: Row[]; images: { file: string; mime: string }[];
  fidelity?: string; digest?: string; model?: string; // how it was seen, when the store says (exact or reported, say)
  error?: boolean;       // the call failed: the server said so (MCP's isError)
}
export interface AttachmentEntry { id: string; kind: 'attachment'; name: string; mime: string; file: string }
/** What the person answered in the window, or what an MCP App reported: kept by Vindu, exact as given. A page's
 *  task.send, while the person used it, is one too, by the page (its script chose the value): from names the page,
 *  and values holds what it sent ({sent}). */
export interface AnswerEntry { id: string; kind: 'answer'; to: string; by: 'person' | 'app' | 'host' | 'page'; values: Record<string, unknown> | null; output?: unknown; at: string; who?: string[]; from?: { view: string; panel: string } }
export type Entry = ResultEntry | AttachmentEntry | AnswerEntry;
/** Entries are only ever added, in order: r1, r2, … and a1, a2, … */
export interface ResultSource { get(id: string): Entry | undefined; all(): readonly Entry[] }

/** Results held in memory, for a host that feeds Vindu itself (another agent loop, a test). */
export function memoryResults(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vindu-'))) {
  const order: Entry[] = []; const byId = new Map<string, Entry>(); let r = 0, a = 0;
  const keep = <E extends Entry>(e: E): E => { order.push(e); byId.set(e.id, e); return e; };
  return {
    get: (id: string) => byId.get(id),
    all: (): readonly Entry[] => order,
    add(x: { tool: string; server: string; input?: unknown; text?: string; value?: unknown; images?: { data: Uint8Array; mime: string }[] }): ResultEntry {
      const id = `r${++r}`;
      const rows = Array.isArray(x.value) && x.value.length && x.value.every(v => v && typeof v === 'object' && !Array.isArray(v)) ? x.value as Row[] : undefined;
      const images = (x.images ?? []).map((im, i) => {
        const subtype = /^[a-z\d.+-]+\/([a-z\d.+-]{1,64})(?:\s*;|$)/i.exec(im.mime)?.[1] ?? 'bin';
        const file = path.join(dir, `${id}-${i + 1}.${subtype}`);
        // a host's results are its own: readable by this user only, wherever the folder is (and kept so if it was there)
        fs.writeFileSync(file, im.data, { mode: 0o600 });
        fs.chmodSync(file, 0o600);
        return { file, mime: im.mime };
      });
      return keep({ id, kind: 'result', tool: x.tool, server: x.server, input: x.input, text: x.text ?? '', value: rows ? undefined : x.value, rows, images });
    },
    attach(name: string, mime: string, file: string): AttachmentEntry { return keep({ id: `a${++a}`, kind: 'attachment', name, mime, file }); },
  };
}

/** One line per entry for the model: its id, where it came from, and the shape a view can use. */
export function brief(e: Entry): string {
  if (e.kind === 'attachment') return `${e.id}: attachment ${e.name} (${e.mime})`;
  if (e.kind === 'answer' && e.from) { const v = JSON.stringify(e.values?.sent) ?? 'null'; return `${e.id}: the page panel "${e.from.panel}" in view "${e.from.view}" sent, on the person's click or key (the value is the page's, not the person's words) → ${v.length > 300 ? `${v.slice(0, 299)}… (ctx_read ${e.id} for all of it)` : v}`; }
  if (e.kind === 'answer') return `${e.id}: ${e.by === 'app' ? 'an app reported' : e.by === 'host' ? 'the host ran' : e.by === 'page' ? 'a page sent, from' : 'the person answered'} ${e.to} → ${e.values ? `fields ${Object.keys(e.values).join(', ') || 'none'}` : e.by === 'person' ? 'declined' : 'no values'}${e.output !== undefined ? '; with output' : ''}`;
  return `${e.id}: ${e.server}.${e.tool} → ${shapeOf(e)}${e.fidelity ? ` (${e.fidelity})` : ''}`;
}

/** The data a reference points into: a result's rows or value (or its text), an answer's values. */
export function dataOf(e: Entry): unknown {
  if (e.kind === 'attachment') return { name: e.name, mime: e.mime };
  if (e.kind === 'answer') return e.values || e.output !== undefined ? { ...e.values, ...(e.output !== undefined ? { output: e.output } : {}) } : null;
  return e.rows ?? e.value ?? e.text;
}
export const refOf = (id: string, pointer = '') => `ctx:${id}${pointer ? `#${pointer}` : ''}`;
const unescape = (t: string) => t.replace(/~1/g, '/').replace(/~0/g, '~');
export const pointerStep = (k: string | number) => `/${String(k).replace(/~/g, '~0').replace(/\//g, '~1')}`;
/** The value a reference names, exactly, or why there is none. */
export function readRef(src: ResultSource, ref: string): { ok: true; id: string; value: unknown } | { ok: false; why: string } {
  const m = /^ctx:([a-z]\d+)(?:#(.*))?$/.exec(ref.trim());
  if (!m) return { ok: false, why: `"${ref}" is not a reference: write ctx:<id>#<JSON Pointer>, e.g. ctx:r3#/0/amount` };
  const e = src.get(m[1]); if (!e) return { ok: false, why: `no entry ${m[1]}` };
  let v: unknown = dataOf(e);
  for (const t of (m[2] ?? '').split('/').slice(1).map(unescape)) {
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- it only reads, and only own values; nothing is written
    if (v && typeof v === 'object' && Object.hasOwn(v, t)) v = (v as Record<string, unknown>)[t]; // its own values: never what objects inherit
    else return { ok: false, why: `${m[1]} has nothing at ${m[2]} (it stops before "${t}")` };
  }
  return { ok: true, id: m[1], value: v };
}

/** The process's results and Vindu's own answers as one source, in arrival order and only ever added to. */
export function withOwn(src: ResultSource, own: { all(): readonly Entry[] }): ResultSource {
  const order: Entry[] = []; const byId = new Map<string, Entry>(); let a = 0, b = 0;
  const catchUp = () => {
    const xs = src.all(), ys = own.all();
    for (; a < xs.length; a++) { order.push(xs[a]); byId.set(xs[a].id, xs[a]); }
    for (; b < ys.length; b++) { order.push(ys[b]); byId.set(ys[b].id, ys[b]); }
  };
  return { get: id => { catchUp(); return byId.get(id); }, all: () => { catchUp(); return order; } };
}

/** The first n distinct fields of the rows, in the order they first appear: the rows are read only until there are n. */
const fieldsOf = (rows: readonly Row[], n: number): string[] => {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) { seen.add(k); if (seen.size === n) return [...seen]; }
  return [...seen];
};
export function shapeOf(e: ResultEntry): string {
  if (e.rows?.length) return `${e.rows.length} rows with fields ${fieldsOf(e.rows, 10).join(', ')}`;
  if (Array.isArray(e.value)) return `a list of ${e.value.length} value${e.value.length === 1 ? '' : 's'}${e.value.length ? `, such as ${String(JSON.stringify(e.value[0])).slice(0, 40)}` : ''}`;
  if (e.value && typeof e.value === 'object') {
    const o = e.value as Row, lists = Object.keys(o).filter(k => Array.isArray(o[k])), n = lists.length ? (o[lists[0]] as unknown[]).length : 0;
    const columns = lists.length > 1 && n > 0 && lists.every(k => (o[k] as unknown[]).length === n && (o[k] as unknown[]).every(x => x === null || typeof x !== 'object')); // as a view reads them
    return `one object with fields ${Object.keys(o).slice(0, 10).join(', ')}${lists.length ? `; lists inside: ${lists.join(', ')} (${columns ? `the same length: shown as the columns of ${n} rows, or one with "pick"` : 'show one with "pick"'})` : ''}`;
  }
  if (e.images.length) return `${e.images.length} image${e.images.length > 1 ? 's' : ''}`;
  return `text, ${e.text.length} characters`;
}

/** Amounts that appear in any result, indexed once per entry as entries arrive (for the typed-number hint). */
const indexes = new WeakMap<ResultSource, { seen: number; amounts: Set<number> }>();
export function amountsOf(src: ResultSource): Set<number> {
  const ix = indexes.get(src) ?? { seen: 0, amounts: new Set<number>() };
  const all = src.all();
  for (let i = ix.seen; i < all.length; i++) {
    const e = all[i];
    if (e.kind === 'answer') { for (const n of amountsIn(JSON.stringify(dataOf(e)))) ix.amounts.add(n); continue; }
    if (e.kind === 'result') for (const n of amountsIn(e.rows || e.value !== undefined ? JSON.stringify(e.rows ?? e.value) : e.text)) ix.amounts.add(n);
  }
  ix.seen = all.length; indexes.set(src, ix);
  return ix.amounts;
}

/** The file behind an attachment, or a result's first image. */
export function fileOf(src: ResultSource, id: string): { file: string; mime: string } | undefined {
  const e = src.get(id);
  return e?.kind === 'attachment' ? { file: e.file, mime: e.mime } : e?.kind === 'result' ? e.images[0] : undefined;
}
