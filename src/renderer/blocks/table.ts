// A table with the model's notes on its cells (card-kinds/rows.ts): its cells as the server wrote them, its head sorting
// by each column as a table's does, every row drawn with data-panel and data-row, each noted cell marked, and the notes
// following, numbered. A cell of a number is aligned right, as in a sheet, so that the same data reads the same in both.
import { html } from 'lit';
import { sendBlockAction } from '../dom.js';
import { dataCell, headCell, noteAt, notesByCell, notesList, unbroken, type Cells } from './cells.js';
import { defineBlock } from './shared.js';

export const VNotedTable = defineBlock('VNotedTable', 'vindu-noted-table', { cells: 'value' }, (props) => {
  const cells = (props.cells ?? {}) as Cells;
  const fields = cells.fields ?? [];
  const notes = notesByCell(cells.notes);
  const [sorted, direction] = (cells.sort ?? '').split(/\s+/);
  const arrow = (field: string) => {
    if (sorted !== field) return '';
    return /desc/i.test(direction ?? '') ? ' ↓' : ' ↑';
  };
  // the server says which cells hold a number; a column's head goes as its first row's cell does, as a sheet's
  const numberClass = (row: number, column: number) => (cells.numbers?.[row]?.includes(column) ? 'vb-num' : '');
  const sortBy = (field: string) => (e: Event) =>
    sendBlockAction(e.currentTarget as HTMLElement, { type: 'view', action: 'sort', panel: props.panel, field });
  return html`<div class="vb-sheet vb-noted-table"><table><thead><tr>${fields.map((field, i) =>
    headCell(html`<button class="vb-sort" @click=${sortBy(field)}>${unbroken(field)}${arrow(field)}</button>`, { note: noteAt(notes, -1, i), className: numberClass(0, i) }),
  )}</tr></thead>
<tbody>${props.rows.map(
    (row, index) =>
      html`<tr data-panel=${props.panel ?? ''} data-row=${String(index)}>${fields.map((field, i) =>
        dataCell(row[`c${i}`] ?? '', { note: noteAt(notes, index, i), className: numberClass(index, i), field }),
      )}</tr>`,
  )}</tbody></table>${notesList(cells.notes)}</div>`;
});
