// Pictures a host serves through a scheme of its own (media:), drawn in Chromium: a photo with marks, a gallery's tiles
// and a signature take their address once the host names the scheme to drawSurface, mountView or mountShell; sound and
// video keep their own rule (http or https alone); and a scheme that is none, or one that runs code or is data, is
// refused before anything is drawn. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page as BrowserPage } from 'playwright';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, shellServer } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pictures-')), work = fs.mkdtempSync(path.join(os.tmpdir(), 'pictures-work-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(path.join(work, 'photo.png'), png);
fs.writeFileSync(path.join(dir, 'clip.mp4'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]));
const results = memoryResults(dir);
const clip = results.attach('clip.mp4', 'video/mp4', path.join(dir, 'clip.mp4')).id;
const vindu = await startVindu({ waitMs: 300 });
const shown: Shown[] = []; const st: { s?: ShellState } = {};
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onState: s => { st.s = s; } });
const { mcp, json } = await mcpClient(ui.url);
const browser = await chromium.launch();
const one = await shellServer(import.meta.dirname, 'app.html'), shell = await shellServer(import.meta.dirname);
afterAll(async () => { await browser.close(); one.close(); shell.close(); await mcp.close(); ui.close(); await vindu.close(); });

await json('show_view', { name: 'roof', title: 'Roof', panels: [
  { id: 'photo', card: 'media', media: 'photo.png', marks: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, label: 'leak' }] },
  { id: 'clip', card: 'media', media: clip, marks: [{ start: 3, label: 'drip' }] },
  { id: 'all', card: 'gallery', media: ['photo.png'] },
] });
/** The view as the host gives it to its window: its pictures and media at the host's own scheme, as it serves them. */
const hosted = (): Shown => JSON.parse(JSON.stringify(shown.at(-1)!).replaceAll(`${ui.pages}/`, 'media://task/'));
/** The address each picture and recording is drawn from. */
const sources = (page: BrowserPage) => page.evaluate(() => ({
  marked: document.querySelector('vindu-media-marks img')?.getAttribute('src'),
  video: document.querySelector('vindu-media-marks video')?.getAttribute('src'),
  tiles: [...document.querySelectorAll('vindu-gallery .vb-thumb img')].map(img => img.getAttribute('src')),
}));

test('a photo with marks and a gallery\'s tiles at the host\'s own scheme are drawn once it names it, and video stays at http(s)', async () => {
  const view = hosted();
  assert.match(JSON.stringify(view), /media:\/\/task\/work\/photo\.png/);
  const page: BrowserPage = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  try {
    await page.goto(one.url);
    const draw = (options: Record<string, unknown>) => page.evaluate(([v, o]) => { (window as any).app.catalog('view', v, { theme: true, ...o }); }, [view, options] as const);
    await draw({});
    await page.locator('vindu-media-marks img').waitFor({ state: 'attached' });
    assert.deepEqual(await sources(page), { marked: '', video: '', tiles: [''] }); // a scheme it was not told of: nothing drawn from it
    await draw({ sources: ['media:'] });
    await page.waitForFunction(() => !!document.querySelector('vindu-media-marks img')?.getAttribute('src'), null, { timeout: 5000 });
    assert.deepEqual(await sources(page), { marked: 'media://task/work/photo.png', video: '', tiles: ['media://task/work/photo.png'] });
    assert.equal(await page.locator('vindu-media-marks .vb-region').count(), 1); // its mark over it
  } finally { await page.close(); }
});

test('mountShell takes the same sources for every pane it draws', async () => {
  const page: BrowserPage = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  try {
    await page.goto(shell.url);
    await page.evaluate(() => (window as any).app.shell('light', false, undefined, undefined, ['media:']));
    await page.evaluate((v: Shown) => (window as any).app.view(v), hosted());
    await page.evaluate((s: ShellState) => (window as any).app.state(s), st.s!);
    await page.waitForFunction(() => !!document.querySelector('vindu-media-marks img')?.getAttribute('src'), null, { timeout: 5000 });
    assert.deepEqual(await sources(page), { marked: 'media://task/work/photo.png', video: '', tiles: ['media://task/work/photo.png'] });
  } finally { await page.close(); }
});

test('sources are schemes alone, lowercase and ending in ":", and never javascript: or data:', async () => {
  const page: BrowserPage = await browser.newPage();
  try {
    const refused = (sources: unknown, where: 'view' | 'shell') => page.evaluate(([s, w]) => {
      try {
        if (w === 'view') (window as any).app.catalog('view', { name: 'x', wide: [], compact: [] }, { sources: s });
        else (window as any).app.shell('light', false, undefined, undefined, s);
        return null;
      } catch (e) { return (e as Error).message; }
    }, [sources, where] as const);
    for (const where of ['view', 'shell'] as const) {
      await page.goto(where === 'view' ? one.url : shell.url); // mountView's page, and mountShell's
      assert.match(String(await refused(['Media:'], where)), /"Media:" is not a scheme/);
      assert.match(String(await refused(['media'], where)), /"media" is not a scheme/);
      assert.match(String(await refused(['media://task'], where)), /is not a scheme/);
      assert.match(String(await refused(['javascript:'], where)), /javascript: is never a source of pictures/);
      assert.match(String(await refused(['data:'], where)), /data: is never a source of pictures/);
      assert.match(String(await refused('media:', where)), /a list of schemes/);
      assert.equal(await refused(['media:', 'app-assets:'], where), null);
    }
  } finally { await page.close(); }
});
