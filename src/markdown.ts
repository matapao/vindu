// Markdown read into a document's structure, by the system: its headings become sections, each with its level and an
// anchor, and each section's body is a list of blocks (paragraphs, lists, quotes, code, tables, rules), their text
// marked up inline (markdown-inline.ts). What it makes is data, never markup: raw HTML is a paragraph of text like any
// other. It is not all of CommonMark: there are no reference links, footnotes or HTML blocks, and a list of one kind
// goes on whatever its marker.
import { parseInline, plainOf, type Inline } from './markdown-inline.js';

type Align = 'left' | 'center' | 'right' | null;
type ListItem = { blocks: MarkdownBlock[]; checked?: boolean };
export type MarkdownBlock =
  | { paragraph: Inline[] }
  | { heading: Inline[]; level: number; anchor?: string } // in a quote or a list, or one folded into its section
  | { list: ListItem[]; ordered?: true; start?: number }
  | { quote: MarkdownBlock[] }
  | { code: string; language: string }
  | { table: { align: Align[]; head: Inline[][]; rows: Inline[][][] } }
  | { rule: true };
/** A part of the document: what comes after a heading, up to the next (the start, before any heading, has none). */
type MarkdownSection = { level: number; heading?: string; title?: Inline[]; anchor?: string; blocks: MarkdownBlock[] };
export type MarkdownDocument = { sections: MarkdownSection[]; headings: number; cut: boolean };

const MAX_DEPTH = 4; // quotes and lists inside each other, at most: a deeper marker is text
const BLANK = /^[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const DELIMITER = /^[ \t]*:?-+:?[ \t]*$/;

/** The width of a line's leading spaces and tabs, a tab going on to the next multiple of 4. */
function indentOf(line: string): number {
  let width = 0;
  for (const c of line) { if (c === ' ') width++; else if (c === '\t') width += 4 - (width % 4); else break; }
  return width;
}
/** A line without its first n columns of indentation; a tab that spans the cut leaves the spaces past it. */
function outdent(line: string, n: number): string {
  let width = 0, i = 0;
  for (; i < line.length && width < n; i++) {
    if (line[i] === ' ') width++;
    else if (line[i] === '\t') { const next = width + 4 - (width % 4); if (next > n) return ' '.repeat(next - n) + line.slice(i + 1); width = next; }
    else break;
  }
  return line.slice(i);
}

type Fence = { indent: number; mark: string; size: number; language: string };
function fenceAt(line: string): Fence | null {
  const m = FENCE.exec(line); if (!m) return null;
  const info = m[3].trim(); if (m[2][0] === '`' && info.includes('`')) return null;
  const word = info.split(/\s+/)[0] ?? '';
  return { indent: m[1].length, mark: m[2][0], size: m[2].length, language: /^[\w#+.-]{1,32}$/.test(word) ? word : '' };
}
type Marker = { ordered: boolean; start: number; content: number; first: string };
/** A list item's marker at the start of a line: its kind, its number, the column its text starts at, its first line. */
function itemAt(line: string): Marker | null {
  const m = ITEM.exec(line); if (!m) return null;
  const marker = m[0].length, rest = line.slice(marker), text = rest.replace(/^[ \t]+/, '');
  const ordered = /\d/.test(m[2]), widened = ' '.repeat(marker) + rest; // the marker as spaces, so outdent can take it off
  const at = indentOf(widened.slice(0, widened.length - text.length));
  const content = !text || at - marker > 4 ? marker + 1 : at; // past four spaces, the text is code in the item
  return { ordered, start: ordered ? Number(m[2].slice(0, -1)) : 1, content, first: outdent(widened, content) };
}
/** Whether a line starts a block of its own, and so ends a paragraph above it. */
function interrupts(line: string, depth: number): boolean {
  if (fenceAt(line) || ATX.test(line) || RULE.test(line)) return true;
  if (depth >= MAX_DEPTH) return false;
  if (QUOTE.test(line)) return true;
  const m = itemAt(line);
  return !!m && m.first.trim() !== '' && (!m.ordered || m.start === 1);
}

/** A table row's cells: split at each | a backslash does not escape, its outer pipes left off. */
function cellsOf(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = []; let cell = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cell += '|'; i++; } else if (s[i] === '|') { cells.push(cell.trim()); cell = ''; } else cell += s[i];
  }
  cells.push(cell.trim());
  return cells;
}
/** Whether a table starts at line i: a row with pipes, then a row of as many delimiters (---, :--, --:, :-:), with
 *  pipes too, so that a line of text above --- is a heading. */
function tableAt(lines: string[], i: number): boolean {
  const head = lines[i], under = lines[i + 1];
  if (under === undefined || !head.includes('|') || !under.includes('|') || indentOf(head) >= 4) return false;
  const marks = cellsOf(under);
  return marks.every(c => DELIMITER.test(c)) && marks.length === cellsOf(head).length;
}

/** The blocks of a run of lines (a document, or what a quote or a list item holds), depth containers in. */
function blocksOf(lines: string[], depth: number): MarkdownBlock[] {
  const out: MarkdownBlock[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (BLANK.test(line)) { i++; continue; }
    const fence = fenceAt(line);
    if (fence) { i = codeFence(lines, i, fence, out); continue; }
    if (indentOf(line) >= 4) { i = indentedCode(lines, i, out); continue; }
    const atx = ATX.exec(line);
    if (atx) { out.push(headingOf(atx[2].replace(/[ \t]+#+[ \t]*$/, '').replace(/^[ \t]*#+[ \t]*$/, '').trim(), atx[1].length)); i++; continue; }
    if (RULE.test(line)) { out.push({ rule: true }); i++; continue; }
    if (depth < MAX_DEPTH && QUOTE.test(line)) { i = quote(lines, i, depth, out); continue; }
    if (depth < MAX_DEPTH && itemAt(line)) { i = list(lines, i, depth, out); continue; }
    if (tableAt(lines, i)) { i = table(lines, i, depth, out); continue; }
    i = paragraph(lines, i, depth, out);
  }
  return out;
}
const headingOf = (text: string, level: number): MarkdownBlock => ({ heading: parseInline(text), level });

function codeFence(lines: string[], i: number, f: Fence, out: MarkdownBlock[]): number {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- built from constants only: the fence's own mark, one of two, and its length, a number
  const close = new RegExp(`^ {0,3}${f.mark === '`' ? '`' : '~'}{${f.size},}[ \\t]*$`);
  const body: string[] = []; let j = i + 1;
  for (; j < lines.length && !close.test(lines[j]); j++) body.push(outdent(lines[j], f.indent));
  out.push({ code: body.join('\n'), language: f.language });
  return j + 1; // past its closing fence; a fence never closed runs to the end
}
function indentedCode(lines: string[], i: number, out: MarkdownBlock[]): number {
  const body: string[] = []; let j = i;
  for (; j < lines.length && (BLANK.test(lines[j]) || indentOf(lines[j]) >= 4); j++) body.push(outdent(lines[j], 4));
  while (BLANK.test(body[body.length - 1])) body.pop();
  out.push({ code: body.join('\n'), language: '' });
  return j;
}
function quote(lines: string[], i: number, depth: number, out: MarkdownBlock[]): number {
  const inner: string[] = []; let j = i;
  for (; j < lines.length; j++) {
    const line = lines[j];
    if (QUOTE.test(line)) { inner.push(line.replace(QUOTE, '')); continue; }
    // a lazy line: text that goes on with the quote's last paragraph, without its >
    if (BLANK.test(line) || BLANK.test(inner[inner.length - 1]) || interrupts(line, depth)) break;
    inner.push(line);
  }
  out.push({ quote: blocksOf(inner, depth + 1) });
  return j;
}
function list(lines: string[], i: number, depth: number, out: MarkdownBlock[]): number {
  const first = itemAt(lines[i])!; const items: ListItem[] = []; let j = i;
  for (let m = first as Marker | null; m && m.ordered === first.ordered && !RULE.test(lines[j]); m = j < lines.length ? itemAt(lines[j]) : null) {
    const body = [m.first]; j++;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (BLANK.test(line)) { body.push(''); continue; }
      if (indentOf(line) >= m.content) { body.push(outdent(line, m.content)); continue; }
      // a lazy line: text that goes on with the item's last paragraph
      if (BLANK.test(body[body.length - 1]) || interrupts(line, depth) || itemAt(line)) break;
      body.push(line);
    }
    while (body.length > 1 && BLANK.test(body[body.length - 1])) body.pop();
    const task = /^\[([ xX])\][ \t]+(?=\S)/.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    items.push({ blocks: blocksOf(body, depth + 1), ...(task ? { checked: task[1] !== ' ' } : {}) });
  }
  out.push({ list: items, ...(first.ordered ? { ordered: true as const } : {}), ...(first.ordered && first.start !== 1 ? { start: first.start } : {}) });
  return j;
}
/** A delimiter cell's alignment: a colon at its start, its end, or both. */
function alignOf(cell: string): Align {
  const left = cell.startsWith(':'), right = cell.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  return right ? 'right' : null;
}
function table(lines: string[], i: number, depth: number, out: MarkdownBlock[]): number {
  const head = cellsOf(lines[i]);
  const align = cellsOf(lines[i + 1]).map(alignOf);
  const rows: Inline[][][] = []; let j = i + 2;
  for (; j < lines.length && !BLANK.test(lines[j]) && !interrupts(lines[j], depth); j++) {
    const cells = cellsOf(lines[j]);
    rows.push(head.map((_, k) => parseInline(cells[k] ?? ''))); // as many cells as the head: more are left out, fewer are empty
  }
  out.push({ table: { align, head: head.map(c => parseInline(c)), rows } });
  return j;
}
function paragraph(lines: string[], i: number, depth: number, out: MarkdownBlock[]): number {
  const text = [lines[i].replace(/^[ \t]+/, '')]; let j = i + 1;
  for (; j < lines.length; j++) {
    const line = lines[j];
    if (BLANK.test(line)) break;
    const under = SETEXT.exec(line);
    if (under) { out.push(headingOf(text.join('\n').trim(), under[1][0] === '=' ? 1 : 2)); return j + 1; }
    if (interrupts(line, depth) || tableAt(lines, j)) break;
    text.push(line.replace(/^[ \t]+/, ''));
  }
  out.push({ paragraph: parseInline(text.join('\n').replace(/[ \t]+$/, '')) });
  return j;
}

/** A heading's anchor, as GitHub makes one: lowercase, punctuation left out, spaces as dashes, and -1, -2, … after a
 *  name already used. */
function anchorOf(text: string, used: Map<string, number>): string {
  const base = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-') || 'section';
  let anchor = base;
  while (used.has(anchor)) { const n = used.get(base)! + 1; used.set(base, n); anchor = `${base}-${n}`; }
  used.set(anchor, 0);
  return anchor;
}

/** The values in a piece of the document, as surface-limits.ts counts them; a list longer than LONGEST is too many. */
const LONGEST = 4000;
function valuesIn(v: unknown): number {
  if (!v || typeof v !== 'object') return 1;
  const parts = Array.isArray(v) ? v : Object.values(v);
  if (parts.length > LONGEST) return Infinity;
  let n = 1; for (const x of parts) n += valuesIn(x);
  return n;
}
/** As much of a list as fits in left values: its first parts, whole. */
function startOf<T>(parts: readonly T[], left: number): T[] {
  const kept: T[] = [];
  for (const x of parts) { const n = valuesIn(x); if (n > left || kept.length >= LONGEST) break; kept.push(x); left -= n; }
  return kept;
}
/** As much of a block as fits in left values: the first lines of a table, items of a list, words of a paragraph. */
function blockStart(b: MarkdownBlock, left: number): MarkdownBlock | null {
  const room = left - 8; // the block's own values, around its parts
  if ('paragraph' in b) { const kept = startOf(b.paragraph, room); return kept.length ? { paragraph: kept } : null; }
  if ('list' in b) { const kept = startOf(b.list, room); return kept.length ? { ...b, list: kept } : null; }
  if ('quote' in b) { const kept = startOf(b.quote, room); return kept.length ? { quote: kept } : null; }
  if ('table' in b) { const rows = startOf(b.table.rows, room - valuesIn(b.table.head) - valuesIn(b.table.align)); return rows.length ? { table: { ...b.table, rows } } : null; }
  return null;
}
/** The sections, cut where they would go over most values: what the window is given stays within its bounds. */
function fit(sections: MarkdownSection[], most: number): { sections: MarkdownSection[]; cut: boolean } {
  let left = most; const out: MarkdownSection[] = [];
  for (const s of sections) {
    const own = valuesIn({ ...s, blocks: [] }); if (own > left) return { sections: out, cut: true };
    left -= own; const blocks: MarkdownBlock[] = []; out.push({ ...s, blocks });
    for (const b of s.blocks) {
      const n = valuesIn(b);
      if (n <= left) { blocks.push(b); left -= n; continue; }
      const part = blockStart(b, left); if (part) blocks.push(part);
      return { sections: out, cut: true };
    }
  }
  return { sections: out, cut: false };
}

/** A Markdown text as sections: one for each heading of the levels that keep to at most `sections` of them (a deeper
 *  heading is then a heading inside its section), cut where the window would be given more than `values` values. */
export function parseMarkdown(source: string, o: { sections?: number; values?: number } = {}): MarkdownDocument {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\0/g, '�');
  const lines = text.split('\n');
  const front: MarkdownBlock[] = [];
  if (lines[0] === '---' && /^[A-Za-z_][\w-]*[ \t]*:/.test(lines[1] ?? '')) { // front matter, as a static site generator reads it: shown as the YAML it is
    const end = lines.slice(1, 200).findIndex(l => l === '---' || l === '...');
    if (end >= 0) { front.push({ code: lines.slice(1, end + 1).join('\n'), language: 'yaml' }); lines.splice(0, end + 2); }
  }
  return documentOf([...front, ...blocksOf(lines, 0)], o);
}

/** Blocks as a document's sections (from Markdown, or a Word document): one for each heading of the levels that keep to
 *  at most `sections` of them, each heading with its anchor, cut where the window would be given more than `values`. */
export function documentOf(blocks: MarkdownBlock[], o: { sections?: number; values?: number } = {}): MarkdownDocument {
  const most = o.sections ?? 100;
  const used = new Map<string, number>(); const headings: { heading: Inline[]; level: number; anchor?: string }[] = [];
  for (const b of blocks) if ('heading' in b) { b.anchor = anchorOf(plainOf(b.heading), used); headings.push(b); }
  // the deepest level that still keeps to most sections: a heading below it goes into the section above it
  const opening = blocks.length && !('heading' in blocks[0]) ? 1 : 0;
  const levels = [...new Set(headings.map(h => h.level))].sort((a, b) => b - a);
  const deepest = levels.find(l => opening + headings.filter(h => h.level <= l).length <= most) ?? levels.at(-1) ?? 6;
  const sections: MarkdownSection[] = [];
  for (const b of blocks) {
    if ('heading' in b && b.level <= deepest) sections.push({ level: b.level, heading: plainOf(b.heading), title: b.heading, anchor: b.anchor, blocks: [] });
    else { if (!sections.length) sections.push({ level: 0, blocks: [] }); sections[sections.length - 1].blocks.push(b); }
  }
  const fitted = fit(sections.slice(0, most), o.values ?? 30_000);
  const shown = fitted.sections.reduce((n, s) => n + (s.heading !== undefined ? 1 : 0) + s.blocks.filter(b => 'heading' in b).length, 0);
  return { sections: fitted.sections, headings: shown, cut: fitted.cut || sections.length > most };
}
