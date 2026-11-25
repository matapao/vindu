// A card a host adds, and each of Vindu's blocks (blocks.ts): its rows resolved as for any card, its own shaping and
// checks, and the rows, exact, bound to the component the host's renderer registers. A card of cells (a sheet) draws
// its rows as cells by A1 address, with the model's notes on them.
import { MAX_ROWS, PANEL_FIELDS, rowFields, type CardDef, type PanelSpec, type Resolved } from '../cards.js';
import { pointerStep, type Row } from '../results.js';
import { VIEW_WORDS, type ViewWords } from '../view-words.js';
import { notesAccount, notesProblem, placedNotes, type DrawnCells } from './cells.js';
import { cardFileOf } from '../view-files.js';
import { workbookAccount, workbookDrawing } from '../workbook-file.js';
import { drawnFrom, type CardKind } from './kind.js';

/** The fields of rows as cells: in the order they first appear, without those the system keeps to itself (__). */
const cellFields = (rows: Row[]) => rowFields(rows).filter(k => !k.startsWith('__'));
/** The cells a card of cells draws: of a data file, its first rows and columns, as many as the card says; of other
 *  rows, as many rows as any card draws, with all their fields. */
const cellsOf = (most: NonNullable<CardDef['cells']>) => (_p: PanelSpec, d: Resolved): DrawnCells => {
  const rows = d.rows!.slice(0, d.file ? most.rows : MAX_ROWS), fields = cellFields(rows);
  return { fields: d.file ? fields.slice(0, most.columns) : fields, rows: rows.length };
};

export function hostKind(def: CardDef): CardKind {
  // its component's props: its fixed ones, what its shaping worked out, and the file it shows itself (its name, and whether
  // only its start is); a data file read as rows is the system's, and goes as rows
  const own = (d: Resolved) => (d.file && !('format' in d.file) ? d.file : undefined);
  const file = (d: Resolved) => { const f = own(d); return f ? { file: { name: f.name, cut: !!f.cut } } : {}; };
  const props = (p: PanelSpec, d: Resolved) => (def.props || d.shaped?.props || own(d) ? { ...def.props?.(p), ...d.shaped?.props, ...file(d) } : undefined);
  const how = def.file;
  // its component's words, where the view is drawn in other words than English, which its component has of its own
  const words = (w: ViewWords) => {
    if (!def.words) return {};
    const own = def.words(w);
    return JSON.stringify(own) === JSON.stringify(def.words(VIEW_WORDS)) ? {} : { words: own };
  };
  const cells = def.cells ? cellsOf(def.cells) : undefined;
  // the model's notes: a card of cells places them on its cells, and any other takes none
  const notesCheck = (p: PanelSpec, d: Resolved) => {
    if (cells && d.rows) return notesProblem(p, cells(p, d));
    return p.notes?.length && !def.fields?.notes ? `notes go on the cells of a table or a sheet; a ${p.card} takes none` : null;
  };
  return {
    reads: [...PANEL_FIELDS, ...Object.keys(def.fields ?? {})], // a host's card may read any shared field, besides its own
    ...(def.one ? { one: true } : {}), ...(def.rows ? { rows: def.rows } : {}), ...(def.source ? { source: def.source } : {}),
    ...(cells ? { cells, workbooks: true as const } : {}),
    ...(how ? { file: (p, e, ctx) => cardFileOf(p, e, ctx, how) } : {}),
    check: (p, d) => (d.rows && def.check ? def.check(d.rows, p, d.shaped) : null) ?? notesCheck(p, d),
    props,
    draw: (p, d, k) => {
      const all = drawnFrom(p, d, 'rows'), drawn = cells?.(p, d), rows = all.slice(0, drawn?.rows ?? MAX_ROWS);
      // cells go as one JSON list of values a row, so that a sheet of 1,000 rows and 200 columns stays within a surface's
      // limits; a workbook's, a tab after another, with each row's looks and each tab's own fields
      const book = def.cells ? workbookDrawing(d, def.cells) : undefined;
      k.model.rows = book?.rows ?? (drawn ? rows.map(r => JSON.stringify(drawn.fields.map(f => r[f] ?? null))) : rows);
      const of = drawn && { fields: drawn.fields, notes: placedNotes(p), rows: all.length, columns: cellFields(rows).length, ...(book ? { sheets: book.sheets, looks: book.looks } : {}) };
      // A2UI takes plain values as they are and anything else bound by path: a block's maps and lists go in the data model
      const bound = Object.fromEntries(Object.entries({ ...props(p, d), ...words(k.words), ...(of ? { cells: of } : {}) }).map(([name, v]) => {
        if (v === null || typeof v !== 'object') return [name, v];
        const held = (k.model.props ??= {}) as Record<string, unknown>; held[name] = v; return [name, { path: `/panels/${k.pid}/props${pointerStep(name)}` }];
      }));
      return [k.add({ id: `${k.pid}__custom`, component: def.component, rows: { path: `/panels/${k.pid}/rows` }, ...(def.context ? { locale: k.locale, timeZone: k.timeZone, panel: p.id } : {}), ...bound })];
    },
    account: (o, p, d) => {
      const drawn = cells?.(p, d), most = drawn?.rows ?? MAX_ROWS;
      o.rows = d.rows!.length; if (d.rows!.length > most) o.shown_rows = most;
      if (drawn && drawn.fields.length < cellFields(d.rows!.slice(0, most)).length) o.shown_columns = drawn.fields.length;
      Object.assign(o, def.account?.(d.rows!, p), d.shaped?.account);
      if (drawn) notesAccount(o, p, d, drawn);
      if (def.cells) workbookAccount(o, d, def.cells);
    },
    ...(def.presentFields ? { presentFields: (rows, p, d) => def.presentFields!(rows, p, props(p, d) ?? {}) } : {}),
    ...(def.suggest ? { suggest: def.suggest } : {}),
  };
}
