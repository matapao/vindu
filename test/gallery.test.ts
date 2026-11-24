// The gallery card over real MCP, then drawn in Chromium through the fixtures shell: many pictures and videos at once,
// each found as media finds one (an attachment, a file in the working folder, a result's image), at most 40, and every
// item that is not a picture or a video refused with its own reason; the account says how many and their names. In the
// window: tiles marked for pointing and sight, one opened large over the pane with Previous and Next and where it is of
// how many, closed with Escape, with focus kept inside while it is open. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, get, mcpClient } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const dir = tmp('gallery-'), work = tmp('gallery-work-');
const results = memoryResults(dir);
const attach = (name: string, mime: string, bytes: Uint8Array | string) => { const f = path.join(dir, name); fs.writeFileSync(f, bytes); return results.attach(name, mime, f).id; };
const A = {
  dent: attach('dent.png', 'image/png', PNG),
  scratch: attach('scratch.png', 'image/png', PNG),
  clip: attach('clip.mp4', 'video/mp4', Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])),
  song: attach('song.mp3', 'audio/mpeg', Buffer.from([0xff, 0xfb, 0x90, 0x00])),
  notes: attach('notes.txt', 'text/plain', 'Call the customer back.'),
};
const R = {
  snapshot: results.add({ server: 'camera', tool: 'snapshot', input: {}, images: [{ data: PNG, mime: 'image/png' }] }).id,
  rows: results.add({ server: 'db', tool: 'query', input: {}, value: [{ id: 1, status: 'open' }] }).id,
};
fs.writeFileSync(path.join(work, 'shot.png'), PNG);

const vindu = await startVindu({ waitMs: 300 });
const shown: Shown[] = []; let state: ShellState | undefined;
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onState: s => { state = s; } });
const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });
const PHOTOS = { name: 'photos', title: 'Site photos', panels: [{ id: 'pics', card: 'gallery', title: 'Photos', media: [A.dent, 'shot.png', R.snapshot, A.clip, A.scratch] }] };
const modelOf = (v: Shown) => (v.wide.find(m => m.updateDataModel) as any).updateDataModel.value.panels;

test('a gallery of attachments, a file in the working folder and a result\'s image: each served by the page host, and the account says how many and their names', async () => {
  const a = await json('show_view', PHOTOS);
  const p = a.panels[0];
  assert.equal(p.card, 'gallery');
  assert.equal(p.shows, '5 items: 4 images, 1 video');
  assert.deepEqual(p.items, ['dent.png', 'shot.png', `${R.snapshot} image`, 'clip.mp4', 'scratch.png']);
  assert.equal(p.from, `${A.dent}, work/shot.png, ${R.snapshot}, ${A.clip}, ${A.scratch}`);
  assert.equal(a.panels[0].marked, undefined); // the files themselves, never the model's words
  const items = modelOf(shown.at(-1)!).p_pics.items;
  assert.deepEqual(items.map((i: any) => [i.kind, i.url, i.at]), [
    ['image', `${ui.pages}/media/${A.dent}`, '1 of 5'], ['image', `${ui.pages}/work/shot.png`, '2 of 5'], ['image', `${ui.pages}/media/${R.snapshot}`, '3 of 5'],
    ['video', `${ui.pages}/media/${A.clip}`, '4 of 5'], ['image', `${ui.pages}/media/${A.scratch}`, '5 of 5'],
  ]);
  for (const [url, type] of [[items[0].url, 'image/png'], [items[1].url, 'image/png'], [items[2].url, 'image/png'], [items[3].url, 'video/mp4']]) {
    const r = await get(url); assert.equal(r.status, 200, url); assert.equal(r.headers['content-type'], type, url);
  }
});

test('more than 40 items, or a run of ids that makes more, are refused; so is every item that is not a picture or a video, each with its reason', async () => {
  const many = await call('show_view', { name: 'many', title: 'Many', panels: [{ id: 'g', card: 'gallery', media: Array.from({ length: 41 }, () => A.dent) }] });
  assert.equal(many.ok, false);
  assert.equal(many.text, 'not shown: panel g: 41 items: a gallery shows at most 40; show the rest in another gallery');
  const run = await call('show_view', { name: 'many', title: 'Many', panels: [{ id: 'g', card: 'gallery', media: ['r1-r45'] }] });
  assert.match(run.text, /panel g: 45 items: a gallery shows at most 40/);
  const bad = await call('show_view', { name: 'bad', title: 'Bad', panels: [{ id: 'g', card: 'gallery', media: [A.dent, A.song, A.notes, 'nope.png', R.rows, 'plan.docx'] }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.text, `not shown: panel g: 5 of the 6 items cannot be shown in a gallery: item 2: song.mp3 is audio; a gallery shows pictures and videos: play it with a media panel ("media": "${A.song}"); `
    + `item 3: notes.txt is text/plain; a gallery shows pictures and videos; show it with a text panel ("from": "${A.notes}"); item 4: nothing to show as "nope.png": no such file in the working folder; `
    + `item 5: ${R.rows} holds no image: show it with a table or another card of rows; item 6: nothing to show as "plan.docx": .docx is not an image, video or audio file (svg, png, jpg, jpeg, gif, webp, ico, mp3, ogg, wav, mp4, webm). `
    + `Media the task has: ${Object.values(A).join(', ')}, ${R.snapshot}`);
  const none = await call('show_view', { name: 'bad', title: 'Bad', panels: [{ id: 'g', card: 'gallery' }] });
  assert.match(none.text, /panel g: a gallery needs "media": a list of attachment ids/);
  const one = await call('show_view', { name: 'bad', title: 'Bad', panels: [{ id: 'm', card: 'media', media: [A.dent, A.scratch] }] });
  assert.match(one.text, /panel m: media shows one item; for 2 at once, send card "gallery" with the same list/);
});

test('the cards: gallery is one, and the nearest card for a list of media', async () => {
  const r = await call('show_view', { name: 'x', title: 'X', panels: [{ card: 'carousel', media: [A.dent, A.scratch] }] });
  assert.match(r.text, /there is no "carousel" card: .*the nearest card for what you sent: gallery\. The cards: kpi, table, list, record, timeline, bar-chart, line-chart, media, gallery, text, page,/);
});

test('in Chromium: tiles marked for pointing and sight, one opened large over the pane on a click or Enter, stepped through, closed with Escape, focus kept inside', async () => {
  await json('show_view', PHOTOS);
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => (window as any).app.shell('light'));
    await page.evaluate((x: Shown) => (window as any).app.view(x), shown.filter(v => v.name === 'photos').at(-1)!);
    await page.evaluate((s: ShellState) => (window as any).app.state({ ...s, tree: { view: 'photos' }, maximized: null }), state!);
    const pane = page.locator('.vindu-pane[data-view="photos"]');
    await pane.locator('.vb-tile').first().waitFor();
    const tiles = pane.locator('[data-panel="pics"][data-row]');
    assert.equal(await tiles.count(), 5);
    assert.deepEqual(await tiles.evaluateAll((ts: Element[]) => ts.map(t => [t.tagName, (t as HTMLElement).dataset.row, t.querySelector('.vb-tilename')?.textContent])), [
      ['BUTTON', '0', 'dent.png'], ['BUTTON', '1', 'shot.png'], ['BUTTON', '2', 'r1 image'], ['BUTTON', '3', 'clip.mp4'], ['BUTTON', '4', 'scratch.png'],
    ]);
    assert.deepEqual(await pane.locator('.vb-thumb img').evaluateAll((xs: Element[]) => xs.map(i => (i as HTMLImageElement).loading)), ['lazy', 'lazy', 'lazy', 'lazy']);
    assert.deepEqual(await pane.locator('.vb-thumb video').evaluate((v: Element) => [(v as HTMLVideoElement).muted, (v as HTMLVideoElement).paused, (v as HTMLVideoElement).autoplay, (v as HTMLVideoElement).controls]), [true, true, false, false]);
    const box = await pane.locator('.vb-thumb').first().boundingBox();
    assert.ok(box && Math.abs(box.width - box.height) < 1 && box.width >= 170 && box.width <= 260, JSON.stringify(box)); // square, about 180 px
    // what of it is in sight, as the window measured it from the same marks, goes to the UI server as an app carries it
    let sight: string | undefined;
    for (let i = 0; i < 40 && !sight; i++) {
      for (const e of await page.evaluate(() => (window as any).app.events())) ui.event(e);
      sight = (await json('look', {})).panes.find((p: any) => p.view === 'photos')?.in_sight?.pics;
      if (!sight) await page.waitForTimeout(100);
    }
    assert.equal(sight, 'all 5 rows');
    const dialog = pane.locator('dialog.vb-viewer');
    const at = () => dialog.locator('.vb-viewerat').textContent();
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('dialog.vb-viewer[open]'));
    // a click opens it large, over the pane
    await tiles.nth(1).click();
    await dialog.locator('img').waitFor();
    assert.equal(await dialog.evaluate((d: Element) => (d as HTMLDialogElement).open && d.matches(':modal')), true);
    assert.equal(await at(), '2 of 5'); assert.equal(await dialog.locator('.vb-viewername').textContent(), 'shot.png');
    const [over, paneBox] = [await dialog.boundingBox(), await pane.boundingBox()];
    assert.ok(over && paneBox && ['x', 'y', 'width', 'height'].every(k => Math.abs(over[k] - paneBox[k]) < 1.5), JSON.stringify({ over, paneBox }));
    assert.equal(await inside(), true);
    // Previous and Next, going round
    await dialog.getByRole('button', { name: 'Next ›' }).click(); assert.equal(await at(), '3 of 5');
    await dialog.getByRole('button', { name: 'Next ›' }).click(); assert.equal(await at(), '4 of 5');
    assert.equal(await dialog.locator('.vb-stage video').evaluate((v: Element) => (v as HTMLVideoElement).controls), true);
    await page.keyboard.press('ArrowLeft'); assert.equal(await at(), '3 of 5');
    for (let i = 0; i < 3; i++) await dialog.getByRole('button', { name: '‹ Previous' }).click();
    assert.equal(await at(), '5 of 5');
    // focus stays inside, both ways round
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) { await page.keyboard.press(key); assert.equal(await inside(), true, key); }
    // Escape goes back to the gallery, on the tile of the item that was shown
    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate((d: Element) => (d as HTMLDialogElement).open), false);
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.dataset.row === '4', null, { timeout: 2000 }); // once its close is heard
    assert.equal(await dialog.locator('.vb-stage').count(), 0); // nothing is shown large, and its video is gone with it
    // Enter and Space on a focused tile open it too
    await tiles.nth(2).focus(); await page.keyboard.press('Enter');
    await dialog.locator('img').waitFor(); assert.equal(await at(), '3 of 5'); assert.equal(await inside(), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.dataset.row === '2', null, { timeout: 2000 });
    await tiles.nth(0).focus(); await page.keyboard.press(' ');
    await dialog.locator('img').waitFor(); assert.equal(await at(), '1 of 5');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate((d: Element) => (d as HTMLDialogElement).open), false);
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.dataset.row === '0', null, { timeout: 2000 });
    // Alt and a click points at a tile, as at any row, and opens nothing; the model is told which item it is
    await page.evaluate(() => (window as any).app.events());
    await page.keyboard.down('Alt'); await tiles.nth(3).click(); await page.keyboard.up('Alt');
    assert.equal(await dialog.evaluate((d: Element) => (d as HTMLDialogElement).open), false);
    const events = await page.evaluate(() => (window as any).app.events());
    const select = events.find((e: any) => e.type === 'select');
    assert.deepEqual(select.items, [{ view: 'photos', panel: 'pics', row: 3 }]);
    ui.event(select);
    assert.deepEqual(ui.selection().at(-1), { view: 'photos', panel: 'pics', card: 'gallery', title: 'Photos', media: 'clip.mp4', type: 'video/mp4', from: A.clip, item: '4 of 5' });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
