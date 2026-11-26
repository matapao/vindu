// A workbook (.xlsx) shown in a sheet, read exactly by the system from an attachment and from the working folder: a tab
// for each sheet that is not hidden, each value as Excel last saved it (shared and inline strings, numbers, a date and a
// time, percentages, a formula's cached value with its formula, an error, booleans), a merged header, Norwegian text,
// and its edges trimmed; over real MCP in English and in Norwegian, then drawn in Chromium. All data is synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startVindu,
  memoryResults,
  VIEW_WORDS_NB,
  type Shown,
  type ShellState,
  type ViewPresentation,
} from '../src/index.js';
import { chromium, mcpClient, shellServer, panelsIn } from './helpers.js';
import { formatCode, lookOf, serialDate } from '../src/xlsx-formats.js';
import { sheetXml, stylesXml, workbook } from './office-fixtures.js';

const STRINGS = [
  'Post',
  'Første kvartal',
  'Dato',
  'Sum',
  'Godkjent',
  'Kontorrekvisita',
  'Feil',
  'Navn',
  'Født',
  'Aktiv',
  'Åse Øvrebø',
  'Bjørn Ærø',
];
// cell styles: 1 is 0%, 2 is 0.00%, 3 a date (built-in 14), 4 a date and time of the workbook's own, 5 #,##0.00
const STYLES = stylesXml({ 164: 'dd.mm.yyyy hh:mm' }, [0, 9, 10, 14, 164, 4]);
// the budget starts at B2, past an empty row and column, and a styled cell with no value lies outside it, at H7
const BUDGET = sheetXml(
  '<row r="2"><c r="B2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c><c r="D2" s="1"/><c r="E2" t="s"><v>2</v></c><c r="F2" t="s"><v>3</v></c><c r="G2" t="s"><v>4</v></c></row>' +
    '<row r="3"><c r="B3" t="s"><v>5</v></c><c r="C3" s="5"><v>1234.5</v></c><c r="D3" s="1"><v>0.25</v></c><c r="E3" s="3"><v>45000</v></c><c r="F3"><f t="shared" ref="F3:F4" si="0">C3*2</f><v>2469</v></c><c r="G3" t="b"><v>1</v></c></row>' +
    '<row r="4"><c r="B4" t="inlineStr"><is><t>Reise Tromsø–Ålesund</t></is></c><c r="C4"><v>800</v></c><c r="D4" s="2"><v>0.125</v></c><c r="E4" s="4"><v>45366.5</v></c><c r="F4"><f t="shared" si="0"/><v>1600</v></c><c r="G4" t="b"><v>0</v></c></row>' +
    '<row r="5"><c r="B5" t="s"><v>6</v></c><c r="C5" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>' +
    '<row r="6"><c r="B6" t="inlineStr"><is><t>Notat</t></is></c></row>' + // a row whose cells have no look of their own
    '<row r="7"><c r="H7" s="1"/></row>',
  ['C2:D2'],
);
const PEOPLE = sheetXml(
  '<row r="1"><c r="A1" t="s"><v>7</v></c><c r="B1" t="s"><v>8</v></c><c r="C1" t="s"><v>9</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>10</v></c><c r="B2" s="3"><v>32874</v></c><c r="C2" t="b"><v>1</v></c></row>' +
    '<row r="3"><c r="A3" t="s"><v>11</v></c><c r="B3" s="3"><v>36526</v></c><c r="C3" t="b"><v>0</v></c></row>',
);
const HIDDEN = sheetXml('<row r="1"><c r="A1" t="inlineStr"><is><t>secret</t></is></c></row>');
const BOOK = workbook(
  [
    { name: 'Budsjett', xml: BUDGET },
    { name: 'Ansatte', xml: PEOPLE },
    { name: 'Skjult', xml: HIDDEN, state: 'hidden' },
  ],
  { strings: STRINGS, styles: STYLES },
);

const BUDGET_ROWS = [
  { Post: 'Kontorrekvisita', 'Første kvartal': 1234.5, c3: 0.25, Dato: '2023-03-15', Sum: 2469, Godkjent: true },
  {
    Post: 'Reise Tromsø–Ålesund',
    'Første kvartal': 800,
    c3: 0.125,
    Dato: '2024-03-15T12:00',
    Sum: 1600,
    Godkjent: false,
  },
  { Post: 'Feil', 'Første kvartal': '#DIV/0!', c3: '', Dato: '', Sum: '', Godkjent: '' },
  { Post: 'Notat', 'Første kvartal': '', c3: '', Dato: '', Sum: '', Godkjent: '' },
];
const PEOPLE_ROWS = [
  { Navn: 'Åse Øvrebø', Født: '1990-01-01', Aktiv: true },
  { Navn: 'Bjørn Ærø', Født: '2000-01-01', Aktiv: false },
];

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('workbook-'),
  work = tmp('workbook-work-');
fs.mkdirSync(path.join(work, 'data'));
fs.writeFileSync(path.join(work, 'data', 'budsjett.xlsx'), BOOK);
const results = memoryResults(dir);
fs.writeFileSync(path.join(dir, 'budsjett.xlsx'), BOOK);
const attached = results.attach(
  'budsjett.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  path.join(dir, 'budsjett.xlsx'),
).id;

const vindu = await startVindu({ waitMs: 300, timeZone: 'UTC' });
/** A window in English (the provider's en-GB), and one in Norwegian Bokmål, each with what it showed. */
function windowIn(options: Record<string, unknown>) {
  const shown: Shown[] = [],
    presented: ViewPresentation[] = [];
  let state: ShellState | undefined;
  const ui = vindu.open(
    { results, dir, work },
    {
      onView: (v) => shown.push(v),
      onState: (s) => {
        state = s;
      },
      onPresentation: (v) => presented.push(v),
      ...options,
    },
  );
  return { ui, shown, presented, state: () => state! };
}
const en = windowIn({}),
  nb = windowIn({ locale: 'nb-NO', viewWords: VIEW_WORDS_NB });
const clients = { en: await mcpClient(en.ui.url), nb: await mcpClient(nb.ui.url) };
afterAll(async () => {
  await clients.en.mcp.close();
  await clients.nb.mcp.close();
  en.ui.close();
  nb.ui.close();
  await vindu.close();
});
/** A sheet's part of a view's data model: its rows (each row's values, as JSON), its words, each row's looks and its tabs. */
type SheetModel = {
  rows: string[];
  props: {
    words?: Record<string, string>;
    cells: {
      looks: string[];
      sheets: {
        name: string;
        fields: string[];
        start: number;
        count: number;
        first: number;
        rows: number;
        columns: number;
        at: string;
        merges: string;
      }[];
    };
  };
};
const modelOf = (shown: Shown[], name: string, pid: string) =>
  panelsIn<SheetModel>(shown.filter((v) => v.name === name).at(-1)!.wide)[pid];

test('a workbook is read exactly by the system into a sheet: a tab for each sheet in order, its values as Excel saved them, in English and in Norwegian', async () => {
  for (const [language, w] of [
    ['en', en],
    ['nb', nb],
  ] as const) {
    for (const source of [{ from: attached }, { path: 'data/budsjett.xlsx' }]) {
      const a = await clients[language].json('show_view', {
        name: 'book',
        title: 'Budsjett',
        panels: [{ id: 'book', card: 'sheet', ...source }],
      });
      const at = `${language} from ${JSON.stringify(source)}`,
        p = a.panels[0];
      assert.deepEqual(w.presented.at(-1)!.panels[0].rows, [...BUDGET_ROWS, ...PEOPLE_ROWS], at); // the file's own values, none typed
      assert.equal(p.seen, 'exact: the file, read by the system', at);
      assert.equal(p.from, source.from ?? 'work/data/budsjett.xlsx', at);
      assert.deepEqual(
        { ...p.file, cells: undefined },
        {
          name: source.from ? 'budsjett.xlsx' : 'data/budsjett.xlsx',
          format: 'xlsx',
          rows: 6,
          columns: 6,
          cells: undefined,
          left_out: ['Skjult (hidden)'],
          sheets: [
            { name: 'Budsjett', rows: 4, columns: 6, at: 'B2', formulas: 3, dates: 2, merged: 1 },
            { name: 'Ansatte', rows: 2, columns: 3, at: 'A1', dates: 2 },
          ],
        },
        at,
      );
      assert.match(p.file.cells, /a formula's cached value, never computed again/);
      assert.equal(a.format.locale, language === 'en' ? 'en-GB' : 'nb-NO');
      assert.equal(p.marked, undefined);
      assert.equal(a.typed_numbers_not_in_any_result, undefined);
      assert.ok(
        a.corrections.includes(
          'panel book: Budsjett: named 1 column of the header that was empty or written twice: c3',
        ),
        JSON.stringify(a.corrections),
      );
      assert.ok(
        a.corrections.includes('panel book: "budsjett.xlsx": left out the sheet Skjult (hidden)') ||
          a.corrections.includes('panel book: "data/budsjett.xlsx": left out the sheet Skjult (hidden)'),
        JSON.stringify(a.corrections),
      );
    }
    // the window is sent each tab's cells, each row's looks (formulas and formats), and the merged header
    const model = modelOf(w.shown, 'book', 'p_book');
    const sheets = model.props.cells.sheets;
    assert.deepEqual(
      sheets.map((s) => [s.name, s.fields, s.start, s.count, s.first, s.rows, s.columns, s.at]),
      [
        ['Budsjett', ['Post', 'Første kvartal', 'c3', 'Dato', 'Sum', 'Godkjent'], 0, 4, 0, 4, 6, 'B2'],
        ['Ansatte', ['Navn', 'Født', 'Aktiv'], 4, 2, 4, 2, 3, 'A1'],
      ],
    );
    assert.equal(model.props.cells.looks[3], ''); // a row drawn as its values are
    assert.deepEqual(JSON.parse(sheets[0].merges), [[-1, 1, 1, 2]]);
    assert.deepEqual(JSON.parse(model.rows[1]), ['Reise Tromsø–Ålesund', 800, 0.125, '2024-03-15T12:00', 1600, false]);
    assert.deepEqual(JSON.parse(model.props.cells.looks[0]), [
      null,
      { format: 'fixed', decimals: 2 },
      { format: 'percent', decimals: 0 },
      { format: 'date' },
      { formula: 'C3*2' },
      null,
    ]);
    assert.deepEqual(JSON.parse(model.props.cells.looks[1])[4], { formula: 'C4*2' }); // a shared formula, as Excel fills it down
    assert.deepEqual(JSON.parse(model.props.cells.looks[2])[1], { formula: '1/0' });
    assert.equal(model.props.words?.true, language === 'en' ? undefined : 'SANN'); // the words, where they are not English
  }
});

test("pick shows one sheet alone, as a data file's rows: sorted and noted; several sheets are shown as they are, and what a sheet does not read is refused", async () => {
  const { json, call } = clients.en;
  const a = await json('show_view', {
    name: 'people',
    title: 'Ansatte',
    panels: [
      {
        id: 'people',
        card: 'sheet',
        path: 'data/budsjett.xlsx',
        pick: 'ansatte',
        sort: 'Født desc',
        notes: [{ cell: 'A2', note: 'Starts in May' }],
      },
    ],
  });
  assert.deepEqual(en.presented.at(-1)!.panels[0].rows, [...PEOPLE_ROWS].reverse());
  assert.deepEqual(a.panels[0].file.sheets, [{ name: 'Ansatte', rows: 2, columns: 3, at: 'A1', dates: 2 }]);
  assert.deepEqual(a.panels[0].notes, [{ n: 1, cell: 'A2', field: 'Navn', value: 'Bjørn Ærø' }]);
  const refused = async (panel: Record<string, unknown>) => {
    const r = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', ...panel }] });
    assert.equal(r.ok, false, JSON.stringify(panel));
    return r.text;
  };
  assert.equal(
    await refused({ card: 'sheet', path: 'data/budsjett.xlsx', sort: 'Sum desc' }),
    'not shown: panel p: "data/budsjett.xlsx" has 2 sheets (Budsjett, Ansatte), shown as they are, a tab each; sort works on one sheet: name it with pick ("pick": "Budsjett")',
  );
  assert.equal(
    await refused({ card: 'sheet', path: 'data/budsjett.xlsx', pick: 'Skjult' }),
    'not shown: panel p: "data/budsjett.xlsx" leaves its sheet Skjult out (hidden); the sheets it shows: Budsjett, Ansatte',
  );
  assert.equal(
    await refused({ card: 'sheet', path: 'data/budsjett.xlsx', pick: 'Salg' }),
    'not shown: panel p: "data/budsjett.xlsx" has no sheet "Salg"; its sheets: Budsjett, Ansatte',
  );
  assert.equal(
    await refused({ card: 'table', path: 'data/budsjett.xlsx' }),
    'not shown: panel p: "data/budsjett.xlsx" is a workbook; a table reads .csv, .tsv and .json files: show a workbook in a sheet, a tab for each of its sheets',
  );
  assert.equal(
    await refused({ card: 'bar-chart', from: attached, x: 'Post', y: 'Sum' }),
    `not shown: panel p: ${attached} is a workbook (budsjett.xlsx); a sheet shows it, a tab for each of its sheets, read by the system`,
  );
  assert.equal(
    await refused({ card: 'sheet', path: 'data/notes.txt' }),
    'not shown: panel p: "data/notes.txt" is not a data file: a sheet reads .csv, .tsv, .json and .xlsx files',
  );
});

test("a workbook's sheet draws its first 1,000 rows, and the account says how many of each sheet are drawn", async () => {
  const long = sheetXml(
    [
      '<row r="1"><c r="A1" t="inlineStr"><is><t>n</t></is></c><c r="B1" t="inlineStr"><is><t>sq</t></is></c></row>',
      ...Array.from(
        { length: 1200 },
        (_, i) =>
          `<row r="${i + 2}"><c r="A${i + 2}"><v>${i + 1}</v></c><c r="B${i + 2}"><f>A${i + 2}^2</f><v>${(i + 1) ** 2}</v></c></row>`,
      ),
    ].join(''),
  );
  fs.writeFileSync(
    path.join(work, 'data', 'long.xlsx'),
    workbook(
      [
        { name: 'Long', xml: long },
        { name: 'Ansatte', xml: PEOPLE },
      ],
      { strings: STRINGS, styles: STYLES },
    ),
  );
  const a = await clients.en.json('show_view', {
    name: 'long',
    title: 'Long',
    panels: [{ id: 'long', card: 'sheet', path: 'data/long.xlsx' }],
  });
  assert.deepEqual(a.panels[0].file.sheets, [
    { name: 'Long', rows: 1200, columns: 2, at: 'A1', formulas: 1200, shown_rows: 1000 },
    { name: 'Ansatte', rows: 2, columns: 3, at: 'A1', dates: 2 },
  ]);
  const model = modelOf(en.shown, 'long', 'p_long');
  assert.equal(model.rows.length, 1002);
  assert.deepEqual(
    model.props.cells.sheets.map((s) => [s.start, s.count, s.first, s.rows]),
    [
      [0, 1000, 0, 1200],
      [1000, 2, 1200, 2],
    ],
  );
  assert.deepEqual(JSON.parse(model.rows[999]), [1000, 1_000_000]);
});

test('number formats: dates and times by their y, m, d, h and s, percentages and decimals; the serial numbers of both date systems', () => {
  const looks: [string, ReturnType<typeof lookOf>][] = [
    ['General', undefined],
    ['@', undefined],
    ['0', undefined],
    ['#,##0', undefined],
    ['0.000', { format: 'fixed', decimals: 3 }],
    ['#,##0.00 "kr"', { format: 'fixed', decimals: 2 }],
    ['0%', { format: 'percent', decimals: 0 }],
    ['0.0%;[Red]-0.0%', { format: 'percent', decimals: 1 }],
    ['[$-414]d. mmmm yyyy', { format: 'date' }],
    ['mmm-yy', { format: 'date' }],
    ['h:mm AM/PM', { format: 'time' }],
    ['mm:ss', { format: 'time', seconds: true }],
    ['dd.mm.yyyy hh:mm:ss', { format: 'datetime', seconds: true }],
    ['[h]:mm', undefined],
    ['"Uke" 0', undefined],
    ['\\d0', undefined],
  ];
  for (const [code, look] of looks) assert.deepEqual(lookOf(code), look, code);
  assert.deepEqual(
    [formatCode(14, new Map()), formatCode(164, new Map([[164, 'yyyy']])), formatCode(999, new Map())],
    ['m/d/yyyy', 'yyyy', 'General'],
  );
  const day = { format: 'date' } as const,
    both = { format: 'datetime', seconds: true } as const;
  assert.deepEqual(
    [1, 59, 60, 61, 45000].map((n) => serialDate(n, day, false)),
    ['1900-01-01', '1900-02-28', '1900-02-28', '1900-03-01', '2023-03-15'],
  ); // day 60 never was
  assert.equal(serialDate(0, day, true), '1904-01-01');
  assert.equal(serialDate(45366.75, both, false), '2024-03-15T18:00:00');
  assert.equal(serialDate(0.3854166667, { format: 'time' }, false), '09:15');
  assert.deepEqual([serialDate(-1, day, false), serialDate(3e6, day, false)], [null, null]);
});

/** A cell's text as drawn, its spaces (no-break ones too, as the locale writes them) as one space each. */
const plain = (s: string) => s.replace(/\s+/g, ' ').trim();

test("drawn in Chromium, in English and in Norwegian: tabs for the sheets, the merged header across its columns, the formula's value and mark, dates and numbers as the locale writes them", async () => {
  const shell = await shellServer(import.meta.dirname),
    browser = await chromium.launch();
  try {
    for (const [language, w] of [
      ['en', en],
      ['nb', nb],
    ] as const) {
      await clients[language].json('show_view', {
        name: 'book',
        title: 'Budsjett',
        panels: [{ id: 'book', card: 'sheet', path: 'data/budsjett.xlsx' }],
      });
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1000 },
        locale: language === 'en' ? 'en-GB' : 'nb-NO',
      });
      const errors: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(e.message));
      await page.goto(shell.url);
      await page.evaluate(() => window.app.shell('light'));
      await page.evaluate((x: Shown) => window.app.view(x), w.shown.filter((v) => v.name === 'book').at(-1)!);
      await page.evaluate((s: ShellState) => window.app.state(s), w.state());
      const sheet = page.locator('vindu-sheet');
      await sheet.locator('[role="tab"]').first().waitFor();
      assert.deepEqual(await sheet.locator('[role="tab"]').allTextContents(), ['Budsjett', 'Ansatte'], language);
      assert.equal(
        await sheet.locator('[role="tablist"]').getAttribute('aria-label'),
        language === 'en' ? 'Sheets' : 'Ark',
      );
      assert.deepEqual(
        await sheet
          .locator('[role="tab"]')
          .evaluateAll((tabs: Element[]) => tabs.map((t) => t.getAttribute('aria-selected'))),
        ['true', 'false'],
      );
      assert.deepEqual(await sheet.locator('.vb-letter').allTextContents(), ['A', 'B', 'C', 'D', 'E', 'F']);
      // the merged header spans its two columns, and the cell it covers is not drawn
      const merged = sheet.locator('thead tr:nth-of-type(2) th[colspan="2"]');
      assert.equal(plain(await merged.innerText()), 'Første kvartal');
      assert.equal(await sheet.locator('thead tr:nth-of-type(2) th').count(), 6); // the row number and five heads, one of them two wide
      const row = async (n: number) => (await sheet.locator(`tbody tr[data-row="${n}"] td`).allInnerTexts()).map(plain);
      assert.deepEqual(
        await row(0),
        language === 'en'
          ? ['Kontorrekvisita', '1,234.50', '25%', '15 Mar 2023', 'ƒ 2,469', 'TRUE']
          : ['Kontorrekvisita', '1 234,50', '25 %', '15. mars 2023', 'ƒ 2 469', 'SANN'],
        language,
      );
      assert.deepEqual(
        await row(1),
        language === 'en'
          ? ['Reise Tromsø–Ålesund', '800', '12.50%', '15 Mar 2024, 12:00', 'ƒ 1,600', 'FALSE']
          : ['Reise Tromsø–Ålesund', '800', '12,50 %', '15. mars 2024, 12:00', 'ƒ 1 600', 'USANN'],
        language,
      );
      assert.deepEqual((await row(2)).slice(0, 2), ['Feil', 'ƒ #DIV/0!']);
      assert.deepEqual(await row(3), ['Notat', '', '', '', '', '']);
      // the formula's mark, and the formula as its title: its cached value, never computed again
      const formula = sheet.locator('tbody tr[data-row="0"] td.vb-f');
      assert.equal(await formula.getAttribute('title'), '= C3*2');
      assert.equal(await formula.locator('.vb-fx').textContent(), 'ƒ');
      assert.equal(await sheet.locator('tbody tr[data-row="1"] td.vb-f').getAttribute('title'), '= C4*2');
      assert.deepEqual(await sheet.locator('tbody .vb-rownum').allTextContents(), ['2', '3', '4', '5']);
      // the other tab, by a click, and back with the arrow keys, which move the focus with it
      await sheet.locator('[role="tab"]', { hasText: 'Ansatte' }).click();
      await sheet.locator('tbody tr[data-row="4"]').waitFor(); // each row by its place among the panel's rows
      assert.deepEqual(
        await row(4),
        language === 'en' ? ['Åse Øvrebø', '1 Jan 1990', 'TRUE'] : ['Åse Øvrebø', '1. jan. 1990', 'SANN'],
      );
      assert.deepEqual(await sheet.locator('tbody .vb-rownum').allTextContents(), ['2', '3']);
      assert.deepEqual(
        await sheet
          .locator('[role="tab"]')
          .evaluateAll((tabs: Element[]) => tabs.map((t) => t.getAttribute('aria-selected'))),
        ['false', 'true'],
      );
      assert.equal(
        await sheet.locator('[role="tabpanel"]').getAttribute('aria-labelledby'),
        await sheet.locator('[role="tab"][aria-selected="true"]').getAttribute('id'),
      );
      await page.keyboard.press('ArrowLeft');
      await sheet.locator('tbody tr[data-row="0"]').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Budsjett');
      assert.equal(await page.locator('[data-panel="book"][data-row]').count(), 4);
      assert.deepEqual(errors, [], language);
      await page.close();
    }
  } finally {
    await browser.close();
    shell.close();
  }
});
