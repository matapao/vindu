// The window by keyboard, in Chromium: a stack's tabs are one stop (the arrow keys move between them, Enter brings one
// in front, each names the pane it shows), F6 goes from pane to pane in sight and never to one behind, a bar that opens
// the rows behind it opens on Enter or Space, the keyboard leaves a browser pane drawn as pictures with F6, its focus in
// sight, and Back in the activity gives it to the list. All synthetic: views written here, the shell's state from Shell.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Page } from 'playwright';
import { Shell, type ViewMeta } from '../src/shell.js';
import { VINDU_CATALOG } from '../src/catalog-id.js';
import type { View } from '../src/renderer/index.js';
import { chromium } from './helpers.js';

const site = http.createServer((req, res) => {
  const f =
    req.url === '/app.bundle.js'
      ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js')
      : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
afterAll(async () => {
  await browser.close();
  site.close();
});

const viewOf = (name: string, components: Record<string, unknown>[]): View => {
  const surface = [
    { version: 'v0.9', createSurface: { surfaceId: name, catalogId: VINDU_CATALOG } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: name,
        components: [{ id: 'root', component: 'Column', children: components.map((c) => c.id) }, ...components],
      },
    },
  ];
  return { name, wide: surface, compact: surface };
};
const textView = (name: string) => viewOf(name, [{ id: 't', component: 'Text', text: `The ${name} view` }]);
const meta = (title: string, extra: Partial<ViewMeta> = {}): ViewMeta => ({
  title,
  fill: false,
  panels: 'text',
  ...extra,
});

/** A window with these views and this layout, drawn by the fixture's shell (mount: which of its shells). */
async function windowWith(views: View[], metas: Record<string, ViewMeta>, layout: unknown, mount = 'shell') {
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${(site.address() as { port: number }).port}/shell.html`);
  const shell = new Shell();
  for (const [name, m] of Object.entries(metas)) shell.show(name, m);
  if (layout !== undefined) shell.setLayout(layout);
  await page.evaluate(
    ({ views, state, mount }) => {
      const app = window.app;
      if (mount === 'shell') app.shell('light');
      else app.hostShell();
      for (const v of views) app.view(v);
      app.state(state);
    },
    { views, state: shell.state(), mount },
  );
  await page.waitForTimeout(300);
  await page.evaluate(() => window.app.events());
  return { page, errors, events: () => page.evaluate(() => window.app.events()) };
}
const focusedView = (page: Page) =>
  page.evaluate(() => (document.activeElement?.closest('.vindu-pane') as HTMLElement | null)?.dataset.view ?? null);

test("a stack's tabs: one stop, the arrow keys between them, Enter in front, each naming its pane; F6 never lands behind", async () => {
  const { page, errors, events } = await windowWith(
    ['a', 'b', 'c'].map(textView),
    { a: meta('A'), b: meta('B'), c: meta('C') },
    { row: ['a', { stack: ['b', 'c'], front: 'c' }] },
  );
  try {
    const tabs = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.vindu-stack [role="tablist"] [role="tab"]')].map((t) => ({
          text: t.textContent,
          selected: t.getAttribute('aria-selected'),
          tabIndex: t.tabIndex,
          controls: (t.getAttribute('aria-controls') ?? '')
            .split(' ')
            .map((id) => document.getElementById(id)?.dataset.view ?? null),
        })),
      );
    assert.deepEqual(await tabs(), [
      { text: 'B', selected: 'false', tabIndex: -1, controls: ['b'] },
      { text: 'C', selected: 'true', tabIndex: 0, controls: ['c'] },
    ]);
    assert.equal(
      await page.evaluate(() => !!document.querySelector('.vindu-spread')?.closest('[role="tablist"]')),
      false,
    ); // Spread out is beside the tabs
    await page.locator('.vindu-tab', { hasText: 'C' }).focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'B');
    assert.deepEqual(
      (await tabs()).map((t) => t.tabIndex),
      [0, -1],
    );
    await page.keyboard.press('ArrowLeft'); // round to the last
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'C');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'B');
    await page.keyboard.press('Enter');
    assert.deepEqual(
      (await events()).filter((e) => e.type === 'front'),
      [{ type: 'front', path: [1], index: 0 }],
    );

    // F6 from pane to pane: a and c, in sight; never b, behind c
    await page.evaluate(() =>
      (document.querySelector('.vindu-pane[data-view="a"] .vindu-pane-body') as HTMLElement).focus(),
    );
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('F6');
      seen.push(await focusedView(page));
    }
    await page.keyboard.press('Shift+F6');
    seen.push(await focusedView(page));
    assert.deepEqual(seen, ['a', 'c', 'a', 'c', 'a']);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('a bar that opens the rows behind it is a button: Enter and Space open it, and its focus shows', async () => {
  const chart = viewOf('chart', [
    { id: 'opens', component: 'VChart', url: '', bands: 3, left: 0.1, right: 0.05, panel: 'by-customer', opens: true },
    { id: 'plain', component: 'VChart', url: '', bands: 2, left: 0.1, right: 0.05, panel: 'plain' },
  ]);
  const { page, errors, events } = await windowWith([chart], { chart: meta('Chart') }, undefined);
  try {
    const strips = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.vb-strip')].map((s) => [
        s.dataset.panel,
        s.getAttribute('role'),
        s.getAttribute('tabindex'),
        s.getAttribute('aria-label'),
      ]),
    );
    assert.deepEqual(strips, [
      ['by-customer', 'button', '0', 'Open the rows behind category 1 of 3'],
      ['by-customer', 'button', '0', 'Open the rows behind category 2 of 3'],
      ['by-customer', 'button', '0', 'Open the rows behind category 3 of 3'],
      ['plain', null, null, null],
      ['plain', null, null, null],
    ]);
    await page.evaluate(() => (document.querySelector('.vindu-pane-body') as HTMLElement).focus());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.row), '0');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle), 'solid');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    assert.deepEqual(
      (await events()).filter((e) => e.type === 'drill'),
      [
        { type: 'drill', view: 'chart', panel: 'by-customer', row: 1 },
        { type: 'drill', view: 'chart', panel: 'by-customer', row: 1 },
      ],
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('a browser pane drawn as pictures: keys go to the page, F6 and Shift+F6 leave it, its focus shows, and pointing stops with it', async () => {
  const { page, errors } = await windowWith(
    [textView('notes')],
    { web: meta('Web', { kind: 'browser', panels: '' }), notes: meta('Notes') },
    { row: ['web', 'notes'] },
    'host',
  );
  try {
    const slot = page.locator('.vindu-pane[data-view="web"] .vindu-slot');
    assert.equal(
      await slot.getAttribute('aria-description'),
      'Keys go to the page. F6 moves to the next pane, Shift+F6 to the one before.',
    );
    await slot.click(); // the person clicks into the page: its pane has the focus
    await page.locator('.vindu-pane[data-view="web"] .vindu-point').focus();
    await page.keyboard.press('Tab'); // by keyboard: its focus is drawn
    assert.ok(await slot.evaluate((el) => el === document.activeElement));
    assert.equal(await slot.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
    await page.evaluate(() => window.app.browserCalls());
    await page.keyboard.press('a');
    await page.keyboard.press('Tab'); // the page's own Tab, to its next field
    assert.ok(await slot.evaluate((el) => el === document.activeElement));
    await page.keyboard.press('F6');
    assert.equal(await focusedView(page), 'notes');
    assert.equal(await slot.evaluate((el) => el === document.activeElement), false);
    await page.keyboard.press('Shift+F6');
    assert.equal(await focusedView(page), 'web');
    assert.equal(await slot.evaluate((el) => el === document.activeElement), false); // the pane, not the page: Tab goes on from there
    const keys = (await page.evaluate(() => window.app.browserCalls()))
      .filter((c) => c.type === 'key' && c.event !== 'keyUp')
      .map((c) => c.key);
    assert.deepEqual(keys, ['a', 'Tab']); // F6 never reached the page
    await page.locator('.vindu-pane[data-view="web"] .vindu-point').click(); // pointing at the page, until it is picked or called off
    await page.evaluate(() => window.app.destroy());
    assert.ok((await page.evaluate(() => window.app.browserCalls())).some((c) => c.stopPointing === 'web'));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('the activity: Back gives the keyboard to the list, a message is named by its role, and a host composer may leave context out', async () => {
  const page: Page = await browser.newPage();
  try {
    await page.setContent(
      '<main style="height:600px"></main><form id="f"><textarea></textarea><div id="tools"><button>Go</button></div></form>',
    );
    await page.addScriptTag({ type: 'module', path: path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') });
    await page.waitForFunction(() => !!window.app);
    await page.evaluate(() => {
      const f = document.querySelector('form')!;
      const w = window.app.mountWorkspace(document.querySelector('main')!, {
        elements: {
          composer: {
            element: f,
            input: f.querySelector('textarea')!,
            tools: f.querySelector<HTMLElement>('#tools')!,
            send: f.querySelector('button')!,
            context: undefined,
          },
        },
      });
      w.setTasks([{ id: 't1', title: 'Review' }]);
      w.showThread('Review'); // the host opens the thread itself: no task was clicked
      w.setMessages([{ id: 'm1', role: 'assistant', text: 'Ready for review' }]);
    });
    assert.equal(await page.getByRole('article', { name: 'assistant' }).innerText(), 'Ready for review');
    await page.getByRole('button', { name: 'Back to activity' }).click();
    assert.ok(await page.getByRole('button', { name: 'Review' }).evaluate((el) => el === document.activeElement));
  } finally {
    await page.close();
  }
});
