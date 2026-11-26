// CSV, TSV and JSON files shown as a table or a sheet, read exactly by the system from an attachment or from the
// working folder, and the model's notes on cells by A1 address: over real MCP, as a processor calls show_view, then a
// sheet drawn in Chromium. All data is synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { componentsIn, panelsIn } from './helpers.js';
import { work, FILES, attached, shown, presented, call, json } from './data-files-session.js';

test('a CSV, TSV or JSON file is read exactly by the system, as a table and as a sheet, from an attachment and from the working folder', async () => {
  for (const [k, f] of Object.entries(FILES)) {
    const columns = Object.keys(f.rows.reduce((all, r) => ({ ...all, ...r }), {})).length;
    for (const card of ['table', 'sheet']) {
      for (const source of [{ from: attached[k] }, { path: `data/${f.name}` }]) {
        const a = await json('show_view', { name: 'file', title: 'File', panels: [{ id: 'rows', card, ...source }] });
        const at = `${k} as a ${card} from ${JSON.stringify(source)}`;
        assert.deepEqual(presented.at(-1)!.panels[0].rows, f.rows, at); // the file's own values: none typed by the model
        const p = a.panels[0];
        assert.equal(p.from, source.from ?? `work/data/${f.name}`, at);
        assert.equal(p.seen, 'exact: the file, read by the system', at);
        assert.deepEqual(
          { ...p.file, cells: undefined },
          {
            name: source.from ? f.name : `data/${f.name}`,
            format: k === 'csv' || k === 'tsv' ? k : 'json',
            rows: f.rows.length,
            columns,
            cells: undefined,
          },
          at,
        );
        assert.equal(p.marked, undefined, at);
        assert.equal(a.typed_numbers_not_in_any_result, undefined, at);
      }
    }
  }
  const t = await json('show_view', {
    name: 'file',
    title: 'File',
    panels: [{ card: 'table', path: 'data/invoices.csv', sort: 'amount desc' }],
  });
  assert.equal(t.panels[0].first_row, 'INV-2 | Strand Bygg | He said "pay" | 35,740.5');
  assert.equal(
    t.panels[0].file.cells,
    'a number written exactly as a number is that number; every other cell is its text as written',
  );
  const j = await json('show_view', {
    name: 'file',
    title: 'File',
    panels: [{ card: 'table', path: 'data/target.json' }],
  });
  assert.ok(
    j.corrections.some((c: string) =>
      /showed the object in "data\/target.json" as one row for each of its 3 fields \(Key, Value\)/.test(c),
    ),
    JSON.stringify(j.corrections),
  );
});

test('a sheet from a file draws its first 1,000 rows and 200 columns, a table its first 100 with its suggestion; the account says how many there are', async () => {
  const s = await json('show_view', {
    name: 'wide',
    title: 'Wide',
    panels: [
      { id: 'sheet', card: 'sheet', path: 'data/wide.csv' },
      { id: 'table', card: 'table', path: 'data/wide.csv' },
    ],
  });
  assert.deepEqual(
    [
      s.panels[0].file.rows,
      s.panels[0].file.columns,
      s.panels[0].rows,
      s.panels[0].shown_rows,
      s.panels[0].shown_columns,
    ],
    [1200, 210, 1200, 1000, 200],
  );
  assert.deepEqual(
    [s.panels[1].file.rows, s.panels[1].rows, s.panels[1].shown_rows, s.panels[1].fields.length],
    [1200, 1200, 100, 6],
  );
  assert.ok(
    s.suggestions.some((x: { label: string }) => x.label === 'Show all 1200 rows'),
    JSON.stringify(s.suggestions),
  );
  const model = panelsIn<{ rows: string[]; props: { cells: { fields: string[]; rows: number; columns: number } } }>(
    shown.at(-1)!.wide,
  ).p_sheet;
  assert.equal(model.rows.length, 1000);
  assert.deepEqual(JSON.parse(model.rows[999]).slice(0, 2), [999000, 999001]);
  assert.deepEqual(
    [model.props.cells.fields.length, model.props.cells.rows, model.props.cells.columns],
    [200, 1200, 210],
  );
});

test('what cannot be read is refused, saying why; an image is still refused as it was', async () => {
  const refused = async (panel: Record<string, unknown>) => {
    const r = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', ...panel }] });
    assert.equal(r.ok, false, JSON.stringify(panel));
    return r.text;
  };
  assert.equal(
    await refused({ card: 'table', path: 'data/big.csv' }),
    'not shown: panel p: "data/big.csv" is 6.0 MB; a table or a sheet reads data files up to 5 MB',
  );
  assert.equal(
    await refused({ card: 'sheet', path: 'data/text.json' }),
    'not shown: panel p: "data/text.json" holds one string, not rows: a JSON file shows as a list of records, a list of lists (the first its header) or one object',
  );
  assert.match(
    await refused({ card: 'table', path: 'data/plain.json' }),
    /"data\/plain.json" holds a list of plain values, or of records and other values mixed, not rows/,
  );
  assert.match(
    await refused({ card: 'table', from: 'a1' }),
    /^not shown: panel p: a1 is an attachment \(image\/png\); show it with a media panel, or point at the result where you read it$/,
  );
  assert.match(
    await refused({ card: 'sheet', from: 'a1' }),
    /a1 is an attachment \(image\/png\); show it with a media panel/,
  );
  assert.equal(
    await refused({ card: 'bar-chart', from: attached.csv, x: 'id', y: 'amount' }),
    `not shown: panel p: ${attached.csv} is a CSV file (invoices.csv); a table or a sheet shows its rows, read by the system`,
  );
  assert.equal(
    await refused({ card: 'table', path: 'data/missing.csv' }),
    'not shown: panel p: no file "data/missing.csv" in the working folder',
  );
  assert.equal(
    await refused({ card: 'table', path: 'notes.txt' }),
    'not shown: panel p: "notes.txt" is not a data file: a table reads .csv, .tsv and .json files',
  );
  assert.equal(
    await refused({ card: 'table', from: attached.csv, path: 'data/invoices.csv' }),
    'not shown: panel p: a table shows from (a result or an attachment) or path (a file in the working folder), not both',
  );
  fs.writeFileSync(path.join(work, 'data', 'open.csv'), 'a,b\n1,"never closed\n2,3\n');
  assert.equal(
    await refused({ card: 'table', path: 'data/open.csv' }),
    'not shown: panel p: "data/open.csv" is not CSV the system can read: a quoted field that starts on line 2 is never closed',
  );
});

test('notes on cells by A1 address: placed and told back, on a table and a sheet', async () => {
  const notes = [
    { cell: 'B3', note: 'Pays late every quarter' },
    { cell: 'A1', note: 'Invoice numbers from the ledger' },
    { cell: 'D2', note: 'Disputed' },
  ];
  const a = await json('show_view', {
    name: 'noted',
    title: 'Noted',
    panels: [
      { id: 'table', card: 'table', path: 'data/invoices.csv', notes },
      { id: 'sheet', card: 'sheet', from: attached.csv, notes },
      { id: 'typed', card: 'table', rows: [{ a: 'x', b: 1 }], notes: [{ cell: 'B2', note: 'One' }] },
    ],
  });
  const told = [
    { n: 1, cell: 'B3', field: 'customer', value: 'Strand Bygg' },
    { n: 2, cell: 'A1', field: 'id', header: true },
    { n: 3, cell: 'D2', field: 'amount', value: '31050' },
  ];
  assert.deepEqual(a.panels[0].notes, told);
  assert.deepEqual(a.panels[1].notes, told);
  assert.deepEqual(a.panels[2].notes, [{ n: 1, cell: 'B2', field: 'b', value: '1' }]);
  const comps = componentsIn(shown.at(-1)!.wide);
  assert.equal(comps.find((c) => c.id === 'p_table__cells')?.component, 'VNotedTable'); // a noted table keeps its A1 addresses, wide and narrow
  const model = panelsIn<{ cells: { notes: unknown[] }; props: { cells: { notes: unknown[] } } }>(
    shown.at(-1)!.compact,
  );
  assert.deepEqual(model.p_table.cells.notes[0], {
    n: 1,
    cell: 'B3',
    note: 'Pays late every quarter',
    row: 1,
    column: 1,
  });
  assert.deepEqual(model.p_sheet.props.cells.notes[1], {
    n: 2,
    cell: 'A1',
    note: 'Invoice numbers from the ledger',
    row: -1,
    column: 0,
  });
  const listed = await json('show_view', {
    name: 'noted',
    title: 'Noted',
    panels: [{ id: 'l', card: 'list', path: 'data/invoices.csv', rows: [{ label: 'a' }], notes }],
  });
  assert.ok(
    listed.ignored.includes('panel l: "notes" does nothing on a list (table reads it)'),
    JSON.stringify(listed.ignored),
  );
});

test('a note that cannot be placed is refused, each for its own reason', async () => {
  const refused = async (card: string, notes: unknown[]) => {
    const r = await call('show_view', {
      name: 'x',
      title: 'X',
      panels: [{ id: 'p', card, path: 'data/invoices.csv', notes }],
    });
    assert.equal(r.ok, false, JSON.stringify(notes));
    return r.text;
  };
  for (const card of ['table', 'sheet']) {
    for (const cell of ['b3', 'B0', 'AAAA1', '3B', 'B 3'])
      assert.equal(
        await refused(card, [{ cell, note: 'x' }]),
        `not shown: panel p: notes: "${cell}" is not a cell address: write the column's letters, then the row's number, as B3 (row 1 is the header row)`,
      );
    assert.equal(
      await refused(card, [{ cell: 'E2', note: 'x' }]),
      'not shown: panel p: notes: there is no cell E2 here: the cells drawn are A1 to D4 (row 1 is the header and 3 rows follow it; columns A to D are id, customer, note, amount)',
    );
    assert.equal(
      await refused(card, [{ cell: 'A5', note: 'x' }]),
      'not shown: panel p: notes: there is no cell A5 here: the cells drawn are A1 to D4 (row 1 is the header and 3 rows follow it; columns A to D are id, customer, note, amount)',
    );
    assert.equal(
      await refused(
        card,
        Array.from({ length: 21 }, (_, i) => ({ cell: `A${i + 1}`, note: 'x' })),
      ),
      `not shown: panel p: notes: 21 notes; a ${card} takes at most 20`,
    );
    assert.equal(
      await refused(card, [{ cell: 'B2', note: 'x'.repeat(201) }]),
      'not shown: panel p: notes: the note on B2 is 201 characters; a note has at most 200',
    );
    assert.equal(
      await refused(card, [{ cell: 'B2', note: '  ' }]),
      'not shown: panel p: notes: the note on B2 is empty',
    );
    assert.equal(
      await refused(card, [
        { cell: 'B2', note: 'x' },
        { cell: 'B2', note: 'y' },
      ]),
      'not shown: panel p: notes: B2 has two notes; write them as one',
    );
  }
  const narrower = await call('show_view', {
    name: 'x',
    title: 'X',
    panels: [
      {
        id: 'p',
        card: 'table',
        path: 'data/invoices.csv',
        columns: ['id', 'amount'],
        notes: [{ cell: 'C2', note: 'x' }],
      },
    ],
  });
  assert.match(
    narrower.text,
    /there is no cell C2 here: the cells drawn are A1 to B4 \(row 1 is the header and 3 rows follow it; columns A to B are id, amount\)/,
  ); // the columns drawn, as chosen
  const message = await call('show_view', {
    name: 'x',
    title: 'X',
    panels: [{ id: 'p', card: 'message', rows: [{ subject: 'Hi', body: 'Text' }], notes: [{ cell: 'A1', note: 'x' }] }],
  });
  assert.equal(message.text, 'not shown: panel p: notes go on the cells of a table or a sheet; a message takes none');
});
