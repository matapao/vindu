// What the blocks say of their rows in the view's words: an invoice's head, lines and totals, free time, a batch's
// counts, how a map was drawn, when a task is due, the page a PDF is at, and what a document's contents are headed; in
// English as before, and in Bokmål and Nynorsk drawn in Chromium, their numbers and dates as the locale writes them.
// What the model is told stays English. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page as BrowserPage } from 'playwright';
import { BLOCK_WORDS, startVindu, memoryResults, VIEW_WORDS_NB, VIEW_WORDS_NN, wordWith, type Shown, type ShellState, type ViewWords } from '../src/index.js';
import { chromium, mcpClient, shellServer, tinyPdf } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** A window in a language: its task's results, and every block that says something of its own, in one view. */
async function windowIn(words?: ViewWords, locale = 'en-GB') {
  const dir = tmp('block-words-'), results = memoryResults(dir);
  const add = (tool: string, value: unknown, input: unknown = {}) => results.add({ server: 'synthetic', tool, input, value }).id;
  const invoice = add('get_invoice', { number: 'INV-2026-0611', customer: 'Byggmester Haugland AS', date: '2026-11-20', due: '2026-12-04', currency: 'NOK', total: 11000,
    lines: [{ description: 'Membran', hours: 6, rate: 850, vat: 25 }, { description: 'Takrenne', hours: 4, rate: 850, vat: 25 }] });
  const busy = add('list_events', [{ title: 'Befaring', start: '2026-11-23T09:00:00Z', end: '2026-11-23T10:00:00Z' }, { title: 'Levering', start: '2026-11-23T11:30:00Z', end: '2026-11-23T12:00:00Z' }]);
  const sends = [10231, 10232, 10233, 10234, 10235].map((n, i) => add('send_reminder', i === 2 ? { ok: false, error: 'mailbox full' } : { ok: true }, { invoice: n }));
  const places = add('sites', [{ name: 'Lager', lat: 60.39, lon: 5.32 }]);
  const tasks = add('list_tasks', [{ title: 'Bestill takstein', due: '2026-12-04' }]);
  const pdf = results.attach('tilbud.pdf', 'application/pdf', path.join(dir, 'tilbud.pdf'));
  fs.writeFileSync(pdf.file, tinyPdf(1));
  const notes = results.attach('plan.md', 'text/markdown', path.join(dir, 'plan.md'));
  fs.writeFileSync(notes.file, '# Plan\n\nDag en.\n\n## Steg\n\nBestill.\n\n## Pris\n\n450 kr.\n');
  const vindu = await startVindu({ waitMs: 300, timeZone: 'UTC', ...(words ? { viewWords: words } : {}), locale });
  const shown: Shown[] = []; const st: { s?: ShellState } = {};
  const ui = vindu.open({ results, dir }, { onView: v => shown.push(v), onState: s => { st.s = s; } });
  const c = await mcpClient(ui.url);
  const account = await c.json('show_view', { name: 'all', title: 'All', panels: [
    { id: 'inv', card: 'money', from: invoice, pick: 'lines', layout: 'invoice' },
    { id: 'free', card: 'events', from: busy, layout: 'free', within: { from: '2026-11-23', to: '2026-11-23' } },
    { id: 'sent', card: 'batch', results: [`${sends[0]}-${sends[4]}`] },
    { id: 'where', card: 'map', from: places },
    { id: 'todo', card: 'tasks', from: tasks },
    { id: 'offer', card: 'pdf', media: pdf.id },
    { id: 'plan', card: 'document', from: notes.id },
  ] });
  const view = shown.filter(v => v.name === 'all').at(-1)!;
  const model = (view.wide.find(m => (m as any).updateDataModel) as any).updateDataModel.value.panels;
  return { account, view, model, st, close: async () => { await c.mcp.close(); ui.close(); await vindu.close(); } };
}

test('in English, the blocks draw their own words, and the surface carries none', async () => {
  const w = await windowIn();
  try {
    for (const pid of ['p_inv', 'p_free', 'p_sent', 'p_where', 'p_todo', 'p_plan']) assert.equal(w.model[pid].props?.words, undefined, pid);
    assert.equal(w.account.panels.find((p: any) => p.id === 'inv').mismatch, 'the document\'s own total is not what its lines add up to'); // the model's, in English
    assert.equal(wordWith(BLOCK_WORDS.batch.ok, { count: '4' }), '4 ok');
  } finally { await w.close(); }
});

/** A pane's text as read, its spaces (no-break ones too) as plain spaces. */
const read = (page: BrowserPage, selector: string) => page.locator(selector).innerText().then(t => t.replace(/[\s\u00a0\u202f]+/g, ' '));

for (const [language, words, locale, said] of [
  ['Bokmål', VIEW_WORDS_NB, 'nb-NO', { head: ['Nummer INV-2026-0611', 'Kunde Byggmester Haugland AS', 'Dato 20. nov. 2026', 'Forfall 4. des. 2026', 'Valuta NOK'], lines: 'Beskrivelse Antall Pris Beløp', sums: 'Sum linjer 8 500,00 kr · Mva. 2 125,00 kr', total: 'Totalt 10 625,00 kr',
    differs: '⚠ dokumentet oppgir 11 000,00 kr, men linjene blir til sammen 10 625,00 kr', free: ['ledig 1 t', 'ledig 1 t 30 min', 'ledig 4 t'], batch: '4 ok · 1 feilet av 5',
    map: 'Posisjonene er tegnet av systemet, uten kartfliser.', due: 'frist 4. des. 2026', pdf: 'side 1 av 1', contents: 'Innhold' }],
  ['Nynorsk', VIEW_WORDS_NN, 'nn-NO', { head: ['Nummer INV-2026-0611', 'Kunde Byggmester Haugland AS', 'Dato 20. nov. 2026', 'Forfall 4. des. 2026', 'Valuta NOK'], lines: 'Skildring Antal Pris Beløp', sums: 'Sum linjer 8 500,00 kr · Mva. 2 125,00 kr', total: 'Totalt 10 625,00 kr',
    differs: '⚠ dokumentet oppgir 11 000,00 kr, men linjene blir til saman 10 625,00 kr', free: ['ledig 1 t', 'ledig 1 t 30 min', 'ledig 4 t'], batch: '4 ok · 1 feila av 5',
    map: 'Posisjonane er teikna av systemet, utan kartfliser.', due: 'frist 4. des. 2026', pdf: 'side 1 av 1', contents: 'Innhald' }],
] as const) {
  test(`in ${language}, drawn in Chromium: every block's own words, with numbers and dates as ${locale} writes them`, async () => {
    const w = await windowIn(words, locale);
    const shell = await shellServer(import.meta.dirname), browser = await chromium.launch();
    try {
      assert.deepEqual(w.model.p_inv.props.words, words.money);
      assert.deepEqual([w.model.p_free.props.words, w.model.p_sent.props.words, w.model.p_where.props.words, w.model.p_todo.props.words, w.model.p_plan.props.words], [words.events, words.batch, words.map, words.tasks, words.document]);
      assert.equal(w.account.panels.find((p: any) => p.id === 'inv').mismatch, 'the document\'s own total is not what its lines add up to'); // the model's stays English
      const page: BrowserPage = await browser.newPage({ viewport: { width: 1200, height: 3000 } });
      const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
      await page.goto(shell.url);
      await page.evaluate(() => (window as any).app.shell('light'));
      await page.evaluate((x: Shown) => (window as any).app.view(x), w.view);
      await page.evaluate((s: ShellState) => (window as any).app.state({ ...s, tree: { view: 'all' }, maximized: null }), w.st.s!);
      await page.locator('vindu-tasks .vb-item').waitFor();
      const money = await read(page, 'vindu-money');
      for (const t of [...said.head, said.lines, said.sums, said.total, said.differs]) assert.ok(money.includes(t), `"${t}" in: ${money}`);
      const free = await read(page, 'vindu-events');
      for (const t of said.free) assert.ok(free.includes(t), `"${t}" in: ${free}`);
      assert.ok((await read(page, 'vindu-batch')).startsWith(said.batch), await read(page, 'vindu-batch'));
      assert.ok((await read(page, 'vindu-map')).includes(said.map));
      assert.ok((await read(page, 'vindu-tasks')).includes(said.due), await read(page, 'vindu-tasks'));
      assert.deepEqual([await page.locator('vindu-document .vb-toc').getAttribute('aria-label'), await page.locator('vindu-document .vb-tochead').textContent()], [said.contents, said.contents]);
      const frame = await page.waitForSelector('iframe[data-page-panel="offer"]');
      const doc = (await frame.contentFrame())!;
      await doc.waitForSelector('body[data-ready="1"]', { timeout: 15_000 });
      assert.equal(await doc.textContent('#at'), said.pdf);
      assert.equal(await doc.getAttribute('.page', 'aria-label'), 'Side 1 av 1');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); shell.close(); await w.close(); }
  });
}
