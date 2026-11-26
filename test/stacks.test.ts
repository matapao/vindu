// Stacks: views in one place, one in front and the others as tabs. The model puts a view into a stack (place.into),
// and the person stacks a split, brings a tab in front and spreads a stack out again; the account says what is in front
// and what is behind (and not in sight); what asks the person is never behind; with no room, a new view joins a stack
// instead of hiding another. In Chromium: the strip of tabs, a tab that changed while behind, Spread out, Stack.
// All synthetic.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, sleep, type LookPane } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(20);
  }
};
const invoices = [
  { number: 'INV-2026-0412', customer: 'Havgap Media', amount: 31050 },
  { number: 'INV-2026-0418', customer: 'Brattli Verksted', amount: 19800 },
];
const view = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  title: name[0].toUpperCase() + name.slice(1),
  panels: [{ id: 't', card: 'table', from: 'r1', columns: ['number', 'amount'] }],
  ...extra,
});

async function windowWith() {
  const vindu = await startVindu({ waitMs: 300 });
  const dir = tmp('stacks-'),
    results = memoryResults(dir);
  results.add({ server: 'accounts', tool: 'list_invoices', value: invoices });
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
  ui.event({ type: 'window', w: 1440, h: 876 });
  return {
    vindu,
    ui,
    ...c,
    shown,
    st,
    close: async () => {
      await c.mcp.close();
      ui.close();
      await vindu.close();
    },
  };
}

test('the model stacks a view with another; the person brings a tab in front and spreads them out; look says what is behind', async () => {
  const w = await windowWith();
  try {
    await w.json('show_view', view('invoices'));
    await w.json('show_view', view('summary'));
    const r = await w.json('show_view', view('details', { place: { into: 'summary' } }));
    assert.deepEqual(r.shell.layout, { row: ['invoices', { stack: ['summary', 'details'], front: 'details' }] });
    assert.ok(
      r.shell.notes.includes(
        '"details" is in a stack with "summary", in front; the person brings either to the front with its tab',
      ),
      r.shell.notes.join('; '),
    );
    const look = await w.json('look', {});
    const pane = (v: string) => look.panes.find((x: LookPane) => x.view === v);
    assert.match(look.mode, /^tiled: 2 panes, 1 px lines between; 1 stack, with 1 behind as tabs$/);
    assert.deepEqual(pane('summary').at, 'behind "Details" in a stack: tab 1 of 2, not drawn until it is in front');
    assert.equal(pane('summary').in_sight, undefined);
    assert.deepEqual(pane('details').stack, { front: 'details', tabs: ['summary', 'details'] });
    assert.deepEqual(pane('details').box, [721, 28, 719, 848]); // under the strip of tabs
    // the person brings the other tab in front: told to the model once, as their change
    assert.equal(w.ui.event({ type: 'front', path: [1], index: 0 }), true);
    assert.equal(w.ui.event({ type: 'front', path: [1], index: 0 }), false); // in front already: nothing changed
    const after = await w.json('look', {});
    assert.deepEqual(after.layout, { row: ['invoices', { stack: ['summary', 'details'], front: 'summary' }] });
    assert.deepEqual(after.person, ['brought "summary" to the front of the stack summary, details']);
    // spread out again; and stacked again, from a pane's button
    assert.equal(w.ui.event({ type: 'spread', path: [1] }), true);
    assert.deepEqual((await w.json('look', {})).person, [
      'spread "summary", "details" out again, side by side as their split says',
    ]);
    assert.equal(w.ui.event({ type: 'stack', path: [1] }), true);
    assert.deepEqual((await w.json('look', {})).person, [
      'stacked "summary", "details": one in front, the others as tabs',
    ]);
    assert.equal(w.ui.event({ type: 'stack', path: [0] }), false); // a pane is not a split
    // the arrange form takes stacks too
    const ar = await w.json('arrange', {
      layout: { column: [{ stack: ['invoices', 'summary'], front: 'invoices' }, 'details'] },
    });
    assert.deepEqual(ar.layout, { column: [{ stack: ['invoices', 'summary'], front: 'invoices' }, 'details'] });
  } finally {
    await w.close();
  }
});

test('what asks the person is never behind; with no room left, a new view joins a stack instead of hiding one', async () => {
  const w = await windowWith();
  try {
    w.ui.event({ type: 'window', w: 700, h: 400 });
    for (const n of ['a', 'b', 'c', 'd']) await w.json('show_view', view(n));
    const r = await w.json('show_view', view('e'));
    assert.ok(
      r.shell.notes.some((n: string) =>
        /no room for another pane at 700 × 400 \(a pane needs 300 × 180\): stacked with "\w", in front; "\w" is a tab behind it/.test(
          n,
        ),
      ),
      r.shell.notes.join('; '),
    );
    const look = await w.json('look', {});
    assert.equal(look.hidden, undefined); // nothing hidden: every view is a pane or a tab
    assert.deepEqual(look.panes.filter((x: LookPane) => x.at.startsWith('behind')).length, 1);
    // an ask stacked behind comes to the front by itself, and the account says why
    w.ui.event({ type: 'window', w: 1440, h: 876 });
    await w.json('arrange', { layout: ['a', { stack: ['b', 'c'], front: 'c' }, 'd', 'e'] });
    const asked = w.ui.ask(
      {
        message: 'Who follows up?',
        schema: { type: 'object', required: ['who'], properties: { who: { type: 'string', title: 'Who' } } },
      },
      new AbortController().signal,
    );
    await until(() => w.shown.some((v) => v.ask));
    const k = w.shown.find((v) => v.ask)!;
    await w.json('arrange', { layout: ['a', { stack: ['b', k.name], front: 'b' }, 'd', 'e'] });
    const l2 = await w.json('look', {});
    const ask = l2.panes.find((x: LookPane) => x.view === k.name);
    assert.equal(ask.stack.in_front, 'it asks the person, so it is in front');
    assert.match(l2.panes.find((x: LookPane) => x.view === 'b').at, /^behind/);
    w.ui.event({ type: 'action', view: k.name, name: 'answer', context: { ticket: k.ask!.ticket, 'f:who': 'Kari' } });
    await asked;
  } finally {
    await w.close();
  }
});

test("in Chromium: the strip of tabs; a click brings a tab in front; a view drawn again while behind is marked; Spread out; a pane's Stack", async () => {
  const w = await windowWith();
  const app = http.createServer((req, res) => {
    const f =
      req.url === '/app.bundle.js'
        ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js')
        : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => window.app.shell('light'));
    const relay = async () => {
      for (const e of await page.evaluate(() => window.app.events())) w.ui.event(e);
    };
    const push = async () => {
      for (const v of w.shown.splice(0)) await page.evaluate((x: Shown) => window.app.view(x), v);
      if (w.st.s) await page.evaluate((s: ShellState) => window.app.state(s), w.st.s);
    };
    const sync = async () => {
      await relay();
      await push();
      await page.waitForTimeout(250);
      await relay();
      await push();
      await page.waitForTimeout(150);
    };
    await page.waitForTimeout(200);
    await relay();
    await w.json('show_view', view('invoices'));
    await w.json('show_view', view('summary'));
    await w.json('show_view', view('details', { place: { into: 'summary' } }));
    await sync();
    const tabs = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.vindu-tab')].map((t) => [
          t.textContent,
          t.getAttribute('aria-selected'),
          'changed' in t.dataset,
        ]),
      );
    assert.deepEqual(await tabs(), [
      ['Summary', 'false', false],
      ['Details', 'true', false],
    ]);
    // laid out again with nothing changed in it: the same strip, and the keyboard stays on its tab
    await page.locator('.vindu-tab', { hasText: 'Summary' }).focus();
    await page.evaluate(() => {
      window.strip = document.querySelector('.vindu-stack');
    });
    await page.evaluate((s: ShellState) => window.app.state(s), w.st.s!);
    assert.deepEqual(
      await page.evaluate(() => [
        window.strip === document.querySelector('.vindu-stack'),
        document.activeElement?.textContent,
      ]),
      [true, 'Summary'],
    );
    assert.deepEqual(
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.vindu-pane')]
          .filter((e) => !e.hidden)
          .map((e) => e.dataset.view ?? '')
          .sort(),
      ),
      ['details', 'invoices'],
    );
    const strip = await page.evaluate(() => {
      const r = document.querySelector('.vindu-stack')!.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.width), Math.round(r.height)];
    });
    const look = await w.json('look', {});
    assert.deepEqual(
      [strip[0], strip[1], strip[2]],
      [look.panes.find((x: LookPane) => x.view === 'details').box[0], 719, 28],
    ); // drawn where the model is told
    // the model draws the one behind again: its tab says so, until it is in front
    await w.json('show_view', view('summary', { title: 'Summary, again' }));
    await sync();
    assert.deepEqual(await tabs(), [
      ['Summary, again', 'false', true],
      ['Details', 'true', false],
    ]);
    await page.locator('.vindu-tab', { hasText: 'Summary, again' }).click();
    await sync();
    assert.deepEqual(await tabs(), [
      ['Summary, again', 'true', false],
      ['Details', 'false', false],
    ]);
    assert.deepEqual((await w.json('look', {})).layout, {
      row: ['invoices', { stack: ['summary', 'details'], front: 'summary' }],
    });
    // Spread out, and a pane's Stack button
    await page.locator('.vindu-spread').click();
    await sync();
    assert.deepEqual(await tabs(), []);
    assert.deepEqual((await w.json('look', {})).layout, { row: ['invoices', { column: ['summary', 'details'] }] });
    await page.locator('.vindu-pane[data-view="details"]').hover();
    await page.locator('.vindu-pane[data-view="details"] .vindu-stack-pane').click();
    await sync();
    assert.deepEqual((await w.json('look', {})).layout.row[1].stack, ['summary', 'details']);
    assert.equal(await page.locator('.vindu-pane[data-view="invoices"] .vindu-stack-pane').isHidden(), false); // its split can be stacked too
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    app.close();
    await w.close();
  }
});
