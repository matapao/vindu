// How the shell shows what a turn made, drawn in Chromium as a host's window does: one view whole; several as cards,
// a grid when wide and a list when narrow, with a switch between cards and content where the window is not narrow; a
// card opened alone with a click or Enter, and Back; what waits for the person always whole, above the cards; the way
// chosen at open and changed while the window runs; and look saying what is drawn. A small view has no maximize, and
// a notice is a strip. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { memoryResults, startVindu, type ShellEvent, type ShellState, type Shown } from '../src/index.js';
import { chromium, mcpClient, shellServer, paneIn, type Look, type LookPane, type McpJson } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
const results = memoryResults(dir);
const invoices = results.add({
  server: 'accounts',
  tool: 'invoices',
  value: [
    { id: 'INV-1', customer: 'Brattli Verksted', amount_nok: 1200.5, status: 'overdue' },
    { id: 'INV-2', customer: 'Havgap Media', amount_nok: 3000, status: 'open' },
  ],
}).id;
const vindu = await startVindu({ waitMs: 300 });
const server = await shellServer(import.meta.dirname),
  browser = await chromium.launch();
afterAll(async () => {
  await browser.close();
  server.close();
  await vindu.close();
});

/** A window of its own size for a session opened with these options: the host relays views, state and events. */
async function windowWith(options: Record<string, unknown>, width = 1280) {
  let views: Shown[] = [],
    state: ShellState | undefined;
  const ui = vindu.open(
    { results, dir },
    {
      onView: (v) => views.push(v),
      onState: (s) => {
        state = s;
      },
      ...options,
    },
  );
  const { mcp, json } = await mcpClient(ui.url);
  const page: Page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(server.url);
  await page.evaluate(() => window.app.shell('light'));
  const kept: ShellEvent[] = []; // what the host hears of the person's choices
  const relay = async () => {
    for (const e of await page.evaluate(() => window.app.events())) {
      kept.push(e);
      ui.event(e);
    }
  };
  const push = async () => {
    for (const v of views.splice(0)) await page.evaluate((x: Shown) => window.app.view(x), v);
    if (state) await page.evaluate((s: ShellState) => window.app.state(s), state);
  };
  const sync = async () => {
    await relay();
    await push();
    await page.waitForTimeout(200);
    await relay();
    await push();
    await page.waitForTimeout(150);
  };
  const close = async () => {
    await page.close();
    await mcp.close();
    ui.close();
  };
  return { ui, json, page, sync, close, errors, kept };
}
const show = (json: McpJson, name: string, panels: Record<string, unknown>[]) =>
  json('show_view', { name, title: name[0].toUpperCase() + name.slice(1), panels });
const TABLE = { id: 'all', card: 'table', from: invoices };
const CHART = { card: 'bar-chart', from: invoices, x: 'customer', y: 'amount_nok' };
/** What the window draws: the shell's mode, the cards (by view), the panes in sight, and the switch. */
const drawn = (page: Page) =>
  page.evaluate(() => ({
    mode: (document.querySelector('.vindu-shell') as HTMLElement).dataset.mode,
    cards: [...document.querySelectorAll<HTMLElement>('.vindu-cards:not([hidden]) .vindu-card')].map(
      (c) => c.dataset.view ?? '',
    ),
    panes: [...document.querySelectorAll<HTMLElement>('.vindu-pane:not([hidden])')].map((p) => p.dataset.view ?? ''),
    list: !!document.querySelector('.vindu-cards.is-list'),
    toggle: !(document.querySelector('.vindu-bar-present') as HTMLElement).hidden,
  }));

test('auto: one view is drawn whole, in its pane; several are cards in a grid, with the switch; look says so', async () => {
  const w = await windowWith({ presentation: 'auto' });
  try {
    await show(w.json, 'invoices', [TABLE]);
    await w.sync();
    let now = await drawn(w.page);
    assert.deepEqual([now.mode, now.cards, now.panes], ['single', [], ['invoices']]);
    await show(w.json, 'customers', [CHART]);
    await show(w.json, 'notes', [{ card: 'text', text: 'Call Havgap Media about INV-2.\nThey asked for a new date.' }]);
    await w.sync();
    now = await drawn(w.page);
    assert.deepEqual(
      [now.mode, now.cards, now.panes, now.list, now.toggle],
      ['cards', ['invoices', 'customers', 'notes'], [], false, true],
    );
    // a grid: cards side by side, each saying what it holds
    const boxes = await w.page.locator('.vindu-card').evaluateAll((cs) =>
      cs.map((c) => {
        const b = c.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top)];
      }),
    );
    assert.equal(new Set(boxes.map((b) => b[1])).size, 1, 'three cards in one row');
    assert.match(
      (await w.page.locator('.vindu-card[data-view="invoices"]').innerText()).replace(/\u00a0/g, ' '),
      /table[\s\S]*Invoices[\s\S]*2 rows · total NOK 4,200\.50/,
    );
    const look: Look = await w.json('look', {});
    assert.match(look.mode, /^cards: 3 views as cards in a grid/);
    assert.deepEqual(
      [look.shows.as, look.shows.chosen, look.shows.cards],
      ['cards', 'auto', ['invoices', 'customers', 'notes']],
    );
    assert.equal(paneIn(look, 'customers').at, 'card 2 of 3, in a grid');
    assert.equal(paneIn(look, 'customers').box, undefined);
    assert.deepEqual(w.errors, []);
  } finally {
    await w.close();
  }
});

test('a card opens alone with a click or Enter, as tall as the window, and Back or Esc goes back to the cards; the model hears of it', async () => {
  const w = await windowWith({ presentation: 'cards' });
  try {
    await show(w.json, 'invoices', [TABLE]);
    await show(w.json, 'customers', [CHART]);
    await w.sync();
    await w.page.click('.vindu-card[data-view="customers"]');
    await w.sync();
    let now = await drawn(w.page);
    assert.deepEqual([now.cards, now.panes], [[], ['customers']]);
    const pane = w.page.locator('.vindu-pane[data-view="customers"]');
    assert.ok(
      await pane.evaluate(
        (p) =>
          p.classList.contains('is-alone') &&
          p.getBoundingClientRect().height >= (document.querySelector('.vindu-desk') as HTMLElement).clientHeight - 1,
      ),
    );
    assert.ok((await pane.locator('a2ui-surface, vindu-chart, [data-panel]').count()) > 0, 'its content is drawn');
    let look = await w.json('look', {});
    assert.equal(look.shows.alone, 'customers');
    assert.deepEqual(look.person, ['opened "customers" from its card, alone in the window']);
    await pane.locator('.vindu-card-back').click();
    await w.sync();
    now = await drawn(w.page);
    assert.deepEqual([now.cards, now.panes], [['invoices', 'customers'], []]);
    await w.page.locator('.vindu-card[data-view="invoices"]').focus();
    await w.page.keyboard.press('Enter');
    await w.sync();
    assert.deepEqual((await drawn(w.page)).panes, ['invoices']);
    await w.page.keyboard.press('Escape');
    await w.sync();
    assert.deepEqual((await drawn(w.page)).cards, ['invoices', 'customers']);
    look = await w.json('look', {});
    assert.deepEqual(look.person, [
      'went back from "customers" to the cards',
      'opened "invoices" from its card, alone in the window',
      'went back from "invoices" to the cards',
    ]);
    assert.equal(
      await w.page.evaluate(() => (document.activeElement as HTMLElement).dataset.view),
      'invoices',
      'the keyboard is back on its card',
    );
    assert.deepEqual(w.errors, []);
  } finally {
    await w.close();
  }
});

test('cards with one view is one card; content draws every view in its pane as before; the switch changes it, and the host hears it', async () => {
  const w = await windowWith({ presentation: 'cards' });
  try {
    await show(w.json, 'invoices', [TABLE]);
    await w.sync();
    assert.deepEqual((await drawn(w.page)).cards, ['invoices']);
    w.ui.setPresentation('content');
    await show(w.json, 'customers', [CHART]);
    await w.sync();
    let now = await drawn(w.page);
    assert.deepEqual(
      [now.mode, now.cards, now.panes.sort(), now.toggle],
      ['tiled', [], ['customers', 'invoices'], true],
    );
    assert.equal((await w.json('look', {})).shows.as, 'content');
    await w.page.click('.vindu-bar-present button[data-as="cards"]');
    await w.sync();
    now = await drawn(w.page);
    assert.deepEqual([now.mode, now.cards], ['cards', ['invoices', 'customers']]);
    assert.deepEqual(
      w.kept.filter((e) => e.type === 'presentation'),
      [{ type: 'presentation', as: 'cards' }],
    ); // for the host to keep
    const tiles: unknown = 'tiles'; // as a host might pass what it read
    assert.throws(
      () => w.ui.setPresentation(tiles as Parameters<typeof w.ui.setPresentation>[0]),
      /presentation: "tiles" is none/,
    );
  } finally {
    await w.close();
  }
});

test('narrow: the cards are a list, one under another, and no switch is offered', async () => {
  const w = await windowWith({ presentation: 'auto', narrow: true }, 900);
  try {
    await show(w.json, 'invoices', [TABLE]);
    await show(w.json, 'customers', [CHART]);
    await w.sync();
    const now = await drawn(w.page);
    assert.deepEqual([now.mode, now.cards, now.list, now.toggle], ['cards', ['invoices', 'customers'], true, false]);
    const boxes = await w.page.locator('.vindu-card').evaluateAll((cs) =>
      cs.map((c) => {
        const b = c.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.width)];
      }),
    );
    assert.deepEqual(
      boxes.map((b) => b[0]),
      [0, 0],
    );
    assert.equal(
      boxes[0][1],
      await w.page.evaluate(() => (document.querySelector('.vindu-desk') as HTMLElement).clientWidth),
    );
    const look: Look = await w.json('look', {});
    assert.match(look.mode, /cards in a list/);
    assert.match(look.shows.list, /narrow/);
    w.ui.setPresentation(undefined, { narrow: false });
    await w.sync();
    assert.deepEqual([(await drawn(w.page)).list, (await drawn(w.page)).toggle], [false, true]);
  } finally {
    await w.close();
  }
});

test('what waits for the person is always drawn whole, above the cards: a mail to send, an ask, a call that failed', async () => {
  const w = await windowWith({ presentation: 'auto' });
  try {
    await show(w.json, 'invoices', [TABLE]);
    await show(w.json, 'customers', [CHART]);
    await show(w.json, 'reply', [
      { card: 'message', layout: 'draft', data: { to: ['kari@example.com'], subject: 'INV-2', body: 'Hei Kari' } },
    ]);
    const asking = w
      .json('ask', { question: 'Which customer first?', choices: ['Brattli Verksted', 'Havgap Media'] })
      .catch(() => undefined);
    for (
      let i = 0;
      i < 50 && !(await w.json('look', {})).panes.some((p: LookPane) => String(p.view).startsWith('ask-'));
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
    await w.sync();
    const now = await drawn(w.page);
    assert.deepEqual(now.cards, ['invoices', 'customers']);
    assert.deepEqual(
      now.panes.filter((v) => !v.startsWith('ask-')),
      ['reply'],
    );
    assert.ok(
      now.panes.some((v) => v.startsWith('ask-')),
      'the ask is drawn whole',
    );
    const order = await w.page.evaluate(() => {
      const top = (el: Element | null) => el!.getBoundingClientRect().top;
      return {
        reply: top(document.querySelector('.vindu-pane[data-view="reply"]')),
        cards: top(document.querySelector('.vindu-cards')),
      };
    });
    assert.ok(order.reply < order.cards, 'drawn above the cards');
    assert.ok(
      (await w.page
        .locator(
          '.vindu-pane[data-view="reply"] [contenteditable], .vindu-pane[data-view="reply"] textarea, .vindu-pane[data-view="reply"] input',
        )
        .count()) > 0,
      'the draft itself, to edit and send',
    );
    const look: Look = await w.json('look', {});
    assert.ok(look.shows.whole.includes('reply'));
    assert.equal(paneIn(look, 'reply').at, 'drawn whole, full width, above the cards');
    void asking;
  } finally {
    await w.close();
  }
});

test('a small view has no maximize button and is never fullscreen; a notice is a strip, without a title bar', async () => {
  const w = await windowWith({});
  try {
    await show(w.json, 'invoices', [TABLE]);
    await show(w.json, 'overdue', [
      { card: 'kpi', title: 'Overdue', from: invoices, where: { status: 'overdue' }, value: 'sum(amount_nok)' },
    ]);
    await show(w.json, 'closed', [
      { card: 'notice', rows: [{ text: 'The yard is closed on Friday', level: 'orange', area: 'Bergen' }] },
    ]);
    await w.sync();
    const max = (view: string) =>
      w.page.locator(`.vindu-pane[data-view="${view}"] .vindu-pane-tools button[aria-label="Maximize"]`).isVisible();
    assert.deepEqual([await max('invoices'), await max('overdue'), await max('closed')], [true, false, false]);
    await w.page.dblclick('.vindu-pane[data-view="overdue"] .vindu-pane-title');
    await w.sync();
    const placed = await w.page.evaluate(() => window.app.placement());
    assert.ok(placed, 'the window is placed');
    assert.notEqual(placed.mode, 'maximized');
    assert.equal(await w.page.evaluate(() => window.app.command({ type: 'maximize', view: 'overdue' })), false);
    const refused = await w.json('arrange', { maximize: 'overdue' }).catch((e: Error) => e.message);
    assert.match(String(refused.refusal ?? refused), /"overdue" is not maximized: it is small: never shown fullscreen/);
    const strip = w.page.locator('.vindu-pane[data-view="closed"]');
    assert.ok(await strip.evaluate((p) => p.classList.contains('is-strip')));
    assert.equal(await strip.locator('.vindu-pane-title').isVisible(), false);
    assert.match(
      await strip.locator('.vb-notice').innerText(),
      /Orange warning\s+The yard is closed on Friday · Bergen/,
    );
    assert.ok(
      await strip.locator('.vindu-pane-tools button[aria-label="Collapse"]').isVisible(),
      'it can still be put away',
    );
    assert.deepEqual(w.errors, []);
  } finally {
    await w.close();
  }
});
