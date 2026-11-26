// A batch's rows as the person reads them: what each call was about, from its input by the names of its fields (the
// thing it gives by its number, and who or what it names), or the tool's own name made readable; never a result id or
// a tool's full name as the row's text. The ids stay in the rows the window points at, and in the account. All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page as BrowserPage } from 'playwright';
import { callLabel, memoryResults, startVindu, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, shellServer, panelsIn } from './helpers.js';

test("a call's label: its number and its name, by the names of its fields, else the tool's name in words", () => {
  for (const [input, tool, label] of [
    [{ invoice_number: 10233 }, 'send_reminder', 'invoice 10233'],
    [{ invoice: 10233, customer: 'Vik Data' }, 'send_reminder', 'invoice 10233 · Vik Data'],
    [{ invoiceId: 7, to: 'kari@kunde.example' }, 'send_reminder', 'invoice 7 · kari@kunde.example'],
    [{ fakturanr: '10233', kunde: 'Havgap Media' }, 'send_reminder', 'faktura 10233 · Havgap Media'],
    [{ order_no: 'O-1001', reason: 'late' }, 'refund', 'order O-1001'],
    [{ id: 'INV-7' }, 'void', 'INV-7'],
    [{ to: 'k1@kunde.example', body: 'Thanks' }, 'send_reply', 'k1@kunde.example'],
    [{ title: 'Quarterly report' }, 'publish', 'Quarterly report'],
    [{ amount: 5, nested: { id: 1 } }, 'accounting.sendReminder', 'send reminder'],
    [{}, 'send_reminder', 'send reminder'],
  ] as const)
    assert.equal(callLabel(input, tool), label, JSON.stringify(input));
});

test('drawn in Chromium, each row of a batch says what its call was about, and the result ids stay in its rows and its account', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-labels-')),
    results = memoryResults(dir);
  const ids = [10231, 10232, 10233].map(
    (n, i) =>
      results.add({
        server: 'accounting',
        tool: 'send_reminder',
        input: { invoice: n },
        value: i === 1 ? { ok: false, error: 'mailbox full' } : { ok: true },
      }).id,
  );
  const vindu = await startVindu({ waitMs: 300 });
  const shown: Shown[] = [];
  const st: { s?: ShellState } = {};
  const ui = vindu.open(
    { results, dir },
    {
      onView: (v) => shown.push(v),
      onState: (s) => {
        st.s = s;
      },
    },
  );
  const c = await mcpClient(ui.url);
  const shell = await shellServer(import.meta.dirname),
    browser = await chromium.launch();
  try {
    const a = await c.json('show_view', {
      name: 'sent',
      title: 'Reminders',
      panels: [{ id: 'sent', card: 'batch', results: ids }],
    });
    assert.deepEqual([a.panels[0].calls, a.panels[0].ok, a.panels[0].failed], [3, 2, [ids[1]]]); // the account, by id
    const model = panelsIn(shown.at(-1)!.wide);
    assert.deepEqual(
      model.p_sent.rows.map((r) => [r.id, r.for]),
      ids.map((id, i) => [id, `invoice ${10231 + i}`]),
    ); // pointed at by id
    const page: BrowserPage = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.goto(shell.url);
    await page.evaluate(() => window.app.shell('light'));
    await page.evaluate((x: Shown) => window.app.view(x), shown.at(-1)!);
    await page.evaluate((s: ShellState) => window.app.state(s), st.s!);
    await page.locator('[data-panel="sent"][data-row="2"]').waitFor();
    const rows = await page.locator('vindu-batch .vb-call').allInnerTexts();
    assert.deepEqual(
      rows.map((r) => r.replace(/\s+/g, ' ').trim()),
      ['✓ invoice 10231', '✗ invoice 10232 mailbox full', '✓ invoice 10233'],
    );
    for (const r of rows) assert.doesNotMatch(r, /\br\d+\b|accounting\.|send_reminder/);
  } finally {
    await browser.close();
    shell.close();
    await c.mcp.close();
    ui.close();
    await vindu.close();
  }
});
