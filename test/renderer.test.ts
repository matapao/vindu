// Vindu's renderer in Chromium, as a host app uses it: the A2UI Lit renderer draws the compiled surface,
// a Page frame loads the process's page from its own origin and reloads it live, and a host's own card draws exact rows.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, type CardDef, type Shown } from '../src/index.js';
import { playwrightDriver } from '../src/drivers/playwright.js';
import { chromium, mcpClient } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const work = tmp('rwork-');
fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><title>Fjord Cabins</title><h1>Fjord Cabins</h1><p id="status">Open all year</p>');
const dir = tmp('rtask-');
const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', value: [
  { id: 'INV-2026-0241', customer: 'Vik Data', amount_nok: 31050, status: 'overdue' },
  { id: 'INV-2026-0259', customer: 'Strand Bygg', amount_nok: 35740, status: 'overdue' },
  { id: 'INV-2026-0270', customer: 'Strand Bygg', amount_nok: 35400, status: 'overdue' },
] });
const png = path.join(dir, 'shot.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
results.attach('screenshot.png', 'image/png', png);

// a card the host adds: vindu resolves and checks its rows; the host's Heat component draws them
const heat: CardDef = {
  name: 'heat', about: 'one cell per row, coloured by value', component: 'Heat',
  fields: { label: z.string().optional().describe('heat: the field each cell is named by') },
  shows: p => p.columns ?? [String(p.label), String(p.y)],
  props: p => ({ label: p.columns?.[0] ?? p.label, value: p.columns?.[1] ?? p.y }),
  account: rows => ({ cells: rows.length }),
};

// the host app, on an origin of its own
const app = http.createServer((req, res) => {
  const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'app.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${(app.address() as { port: number }).port}/`;

const browser = await chromium.launch();
const vindu = await startVindu({ driver: playwrightDriver(browser), cards: [heat] });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v) });
const { mcp, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); await browser.close(); app.close(); });

test('the renderer draws a view with a live page, a host card, a total and an image', async () => {
  const a = await json('show_view', { name: 'cabins', title: 'Cabins and invoices', panels: [
    { card: 'kpi', title: 'Overdue (NOK)', from: 'r1', value: 'sum(amount_nok)' },
    { card: 'heat', title: 'Per customer', from: 'r1', group: 'customer', value: 'sum(amount_nok)' },
    { card: 'media', title: 'Screenshot', media: 'a1' },
    { card: 'page', title: 'Site', path: 'index.html', height: 700 },
  ] });
  assert.equal(a.panels[1].cells, 2); assert.equal(a.panels[3].page.loaded, true);

  const errors: string[] = [];
  const p = await browser.newPage(); p.on('pageerror', (e: Error) => errors.push(e.message)); p.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(appUrl);
  await p.evaluate((v: Shown) => (window as unknown as { app: { mount(v: Shown): void } }).app.mount(v), shown.at(-1));
  await p.waitForFunction(() => document.querySelectorAll('x-heat .cell').length === 2, null, { timeout: 5000 });
  assert.deepEqual(await p.locator('x-heat .cell').allTextContents(), ['Vik Data: 31050', 'Strand Bygg: 71140']); // exact, grouped by vindu
  assert.ok((await p.locator('a2ui-surface').innerText()).includes('102,190'));
  await p.waitForFunction(() => { const img = [...document.querySelectorAll('img')].find(i => i.src.includes('/media/a1')); return !!img && img.complete && img.naturalWidth === 1; }, null, { timeout: 5000 });

  const frame = async () => { for (let i = 0; i < 50; i++) { const f = p.frames().find((x: { url(): string }) => x.url().startsWith(ui.pages.replace('http://', 'http://work-'))); if (f) return f; await new Promise(r => setTimeout(r, 100)); } throw new Error('no page frame'); };
  const f = await frame();
  await f.waitForSelector('#status');
  assert.equal(await f.title(), 'Fjord Cabins');
  const box = await p.evaluate(() => { const f = document.querySelector('vindu-page iframe')!; const s = getComputedStyle(f); return { height: s.height, border: s.borderTopWidth, width: Math.round(f.getBoundingClientRect().width), view: Math.round(document.getElementById('view')!.getBoundingClientRect().width) }; });
  assert.equal(box.height, '700px'); assert.equal(box.border, '0px'); assert.ok(box.width > box.view - 80, JSON.stringify(box)); // the frame fills the panel
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('x-heat .cell')!).marginRight), '7px'); // a host component's own styles apply

  // the process changes its page: the frame in the view reloads by itself
  fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><title>Fjord Cabins</title><h1>Fjord Cabins</h1><p id="status">Closed for winter</p>');
  await p.waitForFunction(() => true);
  const g = await frame();
  await g.waitForFunction(() => document.getElementById('status')?.textContent === 'Closed for winter', null, { timeout: 5000 });

  // a narrow window gets the compact surface, where a page frame is at most 560 px high
  await p.evaluate(() => (window as unknown as { app: { width(px: number): void } }).app.width(390));
  await p.waitForFunction(() => { const f = document.querySelector('vindu-page iframe'); return !!f && getComputedStyle(f).height === '560px'; }, null, { timeout: 5000 });
  assert.deepEqual(errors, []);
  await p.close();
});

test('a large connector table renders and the next view can recover after exceeding a surface limit', async () => {
  const columns = Array.from({ length: 12 }, (_, i) => `column_${i}`);
  const rows = Array.from({ length: 150 }, (_, i) => Object.fromEntries(columns.map(k => [k, `${k}-${i}`])));
  const id = results.add({ server: 'db', tool: 'query', value: rows }).id;
  await json('show_view', { name: 'many', title: 'Many rows', panels: [{ card: 'table', from: id, columns }] });
  const view = shown.at(-1)!, p = await browser.newPage();
  try {
    await p.goto(appUrl);
    const mount = (v: Shown) => p.evaluate((x: Shown) => (window as any).app.mount(x), v);
    const overLimit = [{ updateDataModel: { value: Array(8193).fill(0) } }];
    await mount({ ...view, wide: overLimit, compact: overLimit });
    await p.getByText(/This view is too large to display/).waitFor();
    await mount(view);
    await p.getByText('column_0-99', { exact: true }).first().waitFor();
    assert.equal(await p.getByText(/This view is too large to display/).count(), 0);
  } finally { await p.close(); }
});

test('refreshing a compatible surface retains its edited field and tab while replacing authoritative content', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(appUrl);
    const update = async (pass: number, name = 'live') => {
      await page.evaluate(({ pass, name }: { pass: number; name: string }) => {
        const components = [
          { id: 'root', component: 'Tabs', tabs: [{ title: 'Summary', child: 'summary' }, { title: 'Edit', child: 'editor' }] },
          { id: 'summary', component: 'Text', text: 'Summary' },
          { id: 'editor', component: 'Column', children: ['field', 'count', 'send', ...(pass === 1 ? ['retired'] : [])] },
          { id: 'field', component: 'TextField', label: 'Message', value: { path: '/form/draft' } },
          { id: 'count', component: 'Text', text: { path: '/count' } },
          { id: 'send', component: 'Button', child: 'label', action: { event: { name: 'save', context: { input: { path: '/form/draft' } } } } },
          { id: 'label', component: 'Text', text: 'Save' },
          ...(pass === 1 ? [{ id: 'retired', component: 'Text', text: 'Previous result' }] : []),
        ];
        const messages = [
          { version: 'v0.9', createSurface: { surfaceId: name, catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json' } },
          { version: 'v0.9', updateComponents: { surfaceId: name, components } },
          { version: 'v0.9', updateDataModel: { surfaceId: name, path: '/', value: {
            form: { draft: pass < 4 ? '' : 'Server edit' }, count: 'Total ' + pass,
            ...(pass === 1 ? { retired: 'Old value' } : {}),
          } } },
        ];
        const host = document.getElementById('view')!;
        const app = (window as unknown as { app: { drawSurface: typeof import('@matapao/vindu').drawSurface } }).app;
        app.drawSurface(host, { name, wide: messages, compact: messages }, 'wide', {
          onAction: (action) => { host.dataset.action = JSON.stringify({ pass, action }); },
        });
      }, { pass, name });
    };

    await update(1);
    await page.getByText('Edit', { exact: true }).click();
    await page.getByRole('textbox').fill('Unsaved local edit');
    const input = await page.getByRole('textbox').elementHandle();
    const element = await page.locator('a2ui-surface').elementHandle();
    for (const pass of [2, 3]) {
      await update(pass);
      await page.getByText('Total ' + pass).waitFor();
      assert.equal(await input.evaluate((el: HTMLInputElement) => el === document.activeElement && el.value), 'Unsaved local edit');
      assert.equal(await element.evaluate((el: HTMLElement) => el.isConnected), true);
    }
    assert.equal(await page.getByText('Previous result').count(), 0);
    assert.deepEqual(await element.evaluate((el: { surface: { componentsModel: Map<string, unknown>; dataModel: Map<string, unknown> } }) =>
      [el.surface.componentsModel.has('retired'), el.surface.dataModel.get('/retired')]), [false, undefined]);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const sent = JSON.parse(await page.locator('#view').getAttribute('data-action'));
    assert.equal(sent.pass, 3);
    assert.equal(sent.action.context.input, 'Unsaved local edit');
    await update(4);
    await page.waitForFunction(() => document.querySelector('input')?.value === 'Server edit');
    await update(1, 'another-task');
    assert.equal(await element.evaluate((el: HTMLElement) => el.isConnected), false);
    await page.getByText('Edit', { exact: true }).click();
    assert.equal(await page.getByRole('textbox').inputValue(), '');
  } finally {
    await page.close();
  }
});

test('a rejected snapshot leaves the displayed model intact and catalog changes mount the new source', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(appUrl);
    const result = await page.evaluate(() => {
      type SDK = typeof import('@matapao/vindu');
      const app = (window as unknown as { app: Pick<SDK, 'drawSurface' | 'vinduCatalog'> }).app;
      const host = document.getElementById('view')!;
      const catalog = app.vinduCatalog();
      const id = 'source';
      const create = { version: 'v0.9', createSurface: { surfaceId: id, catalogId: catalog.id } };
      const text = { id: 'root', component: 'Text', text: 'Original' };
      const components = (items: Record<string, unknown>[]) => ({
        version: 'v0.9', updateComponents: { surfaceId: id, components: items },
      });
      const draw = (messages: Record<string, unknown>[]) => app.drawSurface(host, { name: id, wide: messages, compact: messages }, 'wide');
      draw([create, components([text])]);
      const original = host.firstElementChild as import('@a2ui/lit/v0_9').A2uiSurface;
      let rejected = 0;
      for (const messages of [
        [create, components([{ ...text, text: 'Corrupt' }, text])],
        [create, components([{ ...text, text: 'Corrupt' }]), { version: 'unknown', updateDataModel: { surfaceId: id, path: '/', value: {} } }],
      ]) {
        try { draw(messages); } catch { rejected++; }
      }
      const modelIntact = original === host.firstElementChild &&
        original.surface?.componentsModel.get('root')?.properties.text === 'Original';
      const basic = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
      draw([{ ...create, createSurface: { surfaceId: id, catalogId: basic } }, components([text])]);
      const catalogReplaced = host.firstElementChild !== original;
      const override = { ...catalog.components.get('Text')!, tagName: 'custom-text' };
      const custom = app.vinduCatalog([override]);
      return { rejected, modelIntact, catalogReplaced, usesOverride: custom.components.get('Text')?.tagName === 'custom-text' };
    });
    assert.deepEqual(result, { rejected: 2, modelIntact: true, catalogReplaced: true, usesOverride: true });
  } finally {
    await page.close();
  }
});
