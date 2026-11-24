// Cells by A1 address, for a table and a sheet: the cells a card draws of its rows (its columns' fields, in order, and
// how many rows, below the header, which is row 1), and the model's notes on them: checked against what is drawn,
// placed, and told back in the account. The person adds none.
import { cellAt, columnName } from '../cell-address.js';
import type { PanelSpec, Resolved } from '../cards.js';
import { asText } from '../format.js';

/** The most notes a panel takes, and the most characters a note has. */
const MAX_NOTES = 20;
const NOTE_MAX = 200;

/** The cells a card draws: the fields of its columns, in order, and how many rows besides the header. */
export type DrawnCells = { fields: string[]; rows: number };
/** A note placed on a cell: its number in the list, its address and text, and where it is drawn: the row (-1 is the
 *  header) and the column, each from 0. */
export type PlacedNote = { n: number; cell: string; note: string; row: number; column: number };

const notesOf = (p: PanelSpec) => ((p.notes ?? []) as { cell?: unknown; note?: unknown }[]).map(x => ({ cell: asText(x?.cell ?? ''), note: asText(x?.note ?? '') }));
/** How many characters a text has, as a person counts them. */
const charactersIn = (text: string) => Array.from(new Intl.Segmenter().segment(text)).length;

/** Why the model's notes cannot be placed on the cells drawn, or null when they can (or there are none). */
export function notesProblem(p: PanelSpec, drawn: DrawnCells): string | null {
  const notes = notesOf(p);
  if (!notes.length) return null;
  if (notes.length > MAX_NOTES) return `notes: ${notes.length} notes; a ${p.card} takes at most ${MAX_NOTES}`;
  const lastColumn = columnName(Math.max(0, drawn.fields.length - 1)), lastRow = drawn.rows + 1;
  const seen = new Set<string>();
  for (const { cell, note } of notes) {
    const at = cellAt(cell);
    if (!at) return `notes: "${cell.slice(0, 20)}" is not a cell address: write the column's letters, then the row's number, as B3 (row 1 is the header row)`;
    if (at.column >= drawn.fields.length || at.row > lastRow) {
      const columns = `${drawn.fields.slice(0, 8).join(', ')}${drawn.fields.length > 8 ? ', …' : ''}`;
      return `notes: there is no cell ${cell} here: the cells drawn are A1 to ${lastColumn}${lastRow} (row 1 is the header and ${drawn.rows} row${drawn.rows === 1 ? '' : 's'} follow it; columns A to ${lastColumn} are ${columns})`;
    }
    if (!note.trim()) return `notes: the note on ${cell} is empty`;
    const length = charactersIn(note);
    if (length > NOTE_MAX) return `notes: the note on ${cell} is ${length} characters; a note has at most ${NOTE_MAX}`;
    if (seen.has(cell)) return `notes: ${cell} has two notes; write them as one`;
    seen.add(cell);
  }
  return null;
}

/** The notes placed, in the order given and numbered so: each where its address is. Only after notesProblem passes. */
export const placedNotes = (p: PanelSpec): PlacedNote[] =>
  notesOf(p).map(({ cell, note }, i) => { const at = cellAt(cell)!; return { n: i + 1, cell, note, row: at.row - 2, column: at.column }; });

/** What the account says of the notes placed: each one's number and cell, the field it is in, and the value there as
 *  the rows hold it (a header: its field's name). */
export function notesAccount(o: Record<string, unknown>, p: PanelSpec, d: Resolved, drawn: DrawnCells) {
  const placed = placedNotes(p);
  if (!placed.length) return;
  o.notes = placed.map(x => { const field = drawn.fields[x.column];
    return { n: x.n, cell: x.cell, field, ...(x.row < 0 ? { header: true } : { value: asText(d.rows![x.row]?.[field] ?? '') }) }; });
}
