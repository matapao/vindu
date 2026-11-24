// Cells by A1 address in the window, for a sheet and a table with notes: the model's notes as the server placed them
// (card-kinds/cells.ts). A noted cell is marked with its note's number, takes the focus with Tab, and has the note as
// its title and its accessible description; the notes follow, numbered, as a list. A cell's text keeps its own line
// breaks and wraps at its spaces, never inside a word such as INV-1 or 2026-11-03.
import { html, nothing } from 'lit';

/** A note as the server placed it: its number, its address and text, and its row (-1 the header) and column. */
export type CellNote = { n: number; cell: string; note: string; row: number; column: number };
/** What the server says of the cells it sends: their fields, the notes on them, how many rows and columns there are
 *  (a sheet), and how the table is sorted and the columns of each row that hold a number (a table, whose cells come
 *  as text). */
export type Cells = { fields?: string[]; notes?: CellNote[]; rows?: number; columns?: number; sort?: string; numbers?: number[][] };

/** A browser breaks a word after a hyphen, a dash or a slash. */
const BREAKS_INSIDE = /[-\u2010\u2013\u2014/]/;
/** The longest word kept on one line: a code, a date, an id. A longer one may break where a browser breaks it. */
const WORD_MOST = 40;
/** A value's text in a cell: each word a browser would break inside kept on one line, so that the text wraps at its
 *  spaces and at its own line breaks (white-space: pre-line) alone. The text itself is as it was. */
export function unbroken(text: string): unknown {
  if (!BREAKS_INSIDE.test(text)) return text;
  return text.split(/(\s+)/).map(word => (word.length <= WORD_MOST && BREAKS_INSIDE.test(word) ? html`<span class="vb-nobr">${word}</span>` : word));
}

/** The notes by the cell they are on. */
export const notesByCell = (notes: readonly CellNote[] = []): ReadonlyMap<string, CellNote> =>
  new Map(notes.map((x) => [`${x.row}:${x.column}`, x]));
export const noteAt = (notes: ReadonlyMap<string, CellNote>, row: number, column: number) => notes.get(`${row}:${column}`);

/** The class a cell has: its own, and vb-noted when it has a note. */
const noteClass = (className: string, note: CellNote | undefined) =>
  note ? `${className} vb-noted`.trim() : className;
/** The mark on a noted cell: its note's number, which assistive technology skips (the note is its description). */
const noteMark = (note: CellNote | undefined) =>
  note ? html`<sup class="vb-notemark" aria-hidden="true">${note.n}</sup>` : nothing;
/** How a cell is drawn besides its value: its note, its class, its title when it has no note, and its field. */
type CellLook = { note?: CellNote; className?: string; title?: string; field?: string };
/** A data cell: its value (text kept whole, word by word), marked, focusable and described by its note when it has one. */
export const dataCell = (content: unknown, { note, className = '', title = '', field }: CellLook) =>
  html`<td class=${noteClass(className, note)} data-col=${field ?? nothing} tabindex=${note ? '0' : nothing} title=${
    note ? note.note : title || nothing
  } aria-description=${note ? note.note : nothing}>${typeof content === 'string' ? unbroken(content) : content}${noteMark(note)}</td>`;
/** A header cell, the same way. */
export const headCell = (content: unknown, { note, className = '', title = '' }: CellLook) =>
  html`<th scope="col" class=${noteClass(className, note)} tabindex=${note ? '0' : nothing} title=${
    note ? note.note : title || nothing
  } aria-description=${note ? note.note : nothing}>${content}${noteMark(note)}</th>`;
/** The numbered list of the notes, below the cells. */
export const notesList = (notes: readonly CellNote[] = []) =>
  notes.length
    ? html`<ol class="vb-cellnotes">${notes.map(
        (x) => html`<li><span class="vb-cellref">${x.cell}</span> ${x.note}</li>`,
      )}</ol>`
    : nothing;
