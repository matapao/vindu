// A static page panel over real MCP, then drawn in Chromium through the fixtures shell: a page the model writes, or a
// page from the working folder, served as it is written (no import map, no boot script) under a policy that runs none
// of it, in a frame drawn with sandbox="". Its stylesheet, pictures and fonts beside it still load; its scripts and
// handlers never run; it reads no data, so uses is refused; and its check says only that it loaded, and its size. A
// page that is not static is served as before. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, get, mcpClient, componentIn, panelsIn } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, files: Record<string, string>) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); } };
const STATIC_CSP = "default-src 'self' data:; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; font-src 'self' data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'; sandbox";
const RAN = `<img src="missing.png" alt="" onerror="document.body.dataset.onerror = 'ran'"><script>document.body.dataset.script = 'ran'; document.title = 'ran';</script>`;
const SITE = `<!doctype html><html><head><meta charset="utf-8"><title>Brochure</title><link rel="stylesheet" href="style.css"></head><body><h1>Fjord Cabins</h1><img id="cabin" src="cabin.svg" alt="cabin">${RAN}</body></html>`;
const NOTE = `<!doctype html><html><head><meta charset="utf-8"><title>Note</title><link rel="stylesheet" href="/work/site/style.css"></head><body><h1>Open all year</h1><img id="cabin" src="/work/site/cabin.svg" alt="cabin">${RAN}</body></html>`;
const work = tmp('static-work-'), dir = tmp('static-');
write(work, {
  'site/index.html': SITE,
  'site/style.css': '@font-face { font-family: Probe; src: url(probe.woff2) format("woff2"); } h1 { color: rgb(1, 2, 3); font-family: Probe, serif; }',
  'site/cabin.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#7a5"/></svg>',
  'site/probe.woff2': 'not a font: only whether it may load is looked at',
});
const results = memoryResults(dir);
const rows = results.add({ server: 'db', tool: 'query', input: {}, value: [{ id: 1 }] }).id;
const vindu = await startVindu({ waitMs: 300 }); // no page driver: a static page's check is the page host's own
const shown: Shown[] = []; let state: ShellState | undefined;
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v), onState: s => { state = s; } });
const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); });
const urlOf = (view: string, pid: string) => panelsIn(shown.filter(v => v.name === view).at(-1)!.wide)[pid].url as string;
const pageOf = (view: string) => componentIn(shown.filter(v => v.name === view).at(-1)!.wide, c => c.component === 'Page');
const CHECKED = 'nothing in it runs, so it was not run: only whether it loaded, and its size';

test('a static page you write: served as it is written, with no import map or boot script, under a policy that runs none of it; its check says it loaded and its size', async () => {
  const a = await json('show_view', { name: 'note', title: 'Note', panels: [{ id: 'note', card: 'page', static: true, html: NOTE }] });
  const p = a.panels[0];
  assert.equal(p.from, 'a static page you wrote');
  assert.match(p.static, /^nothing runs in it: no script, no task API and no data/);
  assert.deepEqual(p.page, { page: 'a static page you wrote', static: CHECKED, loaded: true, bytes: Buffer.byteLength(NOTE) });
  assert.equal(p.window, undefined); // nothing to wait for from the window: a static page has nothing that would tell
  assert.equal(pageOf('note').static, true);
  const url = urlOf('note', 'p_note');
  assert.equal(url, `${ui.pages}/view/p_note__note.html?v=1&static=1`);
  const r = await get(url);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['content-security-policy'], STATIC_CSP);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.body, NOTE); // as written: nothing put in it
  assert.doesNotMatch(r.body, /importmap|__vindu/);
  assert.deepEqual(await json('check_page', { panel: 'note', steps: [{ click: 'h1' }] }), { page: 'a static page you wrote', static: CHECKED, loaded: true, bytes: Buffer.byteLength(NOTE),
    steps: 'not done: a static page runs nothing, so there is nothing to press, click or read in it' });
});

test('a static page from the working folder: on the process\'s own origin, as written, its styles and fonts beside it served; the same page not static runs as before', async () => {
  const a = await json('show_view', { name: 'site', title: 'Site', panels: [{ id: 'site', card: 'page', static: true, path: 'site/index.html' }] });
  assert.equal(a.panels[0].from, 'work/site/index.html');
  assert.deepEqual(a.panels[0].page, { page: 'work/site/index.html', static: CHECKED, loaded: true, bytes: Buffer.byteLength(SITE) });
  const url = urlOf('site', 'p_site');
  assert.equal(url, `${ui.pages}/work/site/index.html?static=1`);
  const r = await get(url);
  assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['content-security-policy'], STATIC_CSP);
  assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.body, SITE);
  const css = await get(`${ui.pages}/work/site/style.css`);
  assert.equal(css.status, 200); assert.equal(css.headers['content-type'], 'text/css');
  const font = await get(`${ui.pages}/work/site/probe.woff2`);
  assert.equal(font.headers['content-type'], 'font/woff2'); assert.equal(font.headers['access-control-allow-origin'], '*'); // a sandboxed page has no origin, and a font loads only with CORS
  assert.equal(css.headers['access-control-allow-origin'], undefined);
  // the same page, not static: on a work origin, with the import map and the boot script, as before
  await json('show_view', { name: 'live', title: 'Live', panels: [{ id: 'live', card: 'page', path: 'site/index.html' }] });
  const live = urlOf('live', 'p_live');
  assert.equal(live, `${ui.pages.replace('http://', 'http://work-')}/work/site/index.html`);
  const ran = await get(live);
  assert.match(ran.body, /^<!doctype html><script type="importmap">.*<script src="\/__vindu\/boot\.js\?live=1"><\/script><html>/);
  assert.match(String(ran.headers['content-security-policy']), /^default-src 'self'; script-src 'self' 'unsafe-inline'/);
  assert.equal(pageOf('live').static, undefined);
});

test('a static page reads no data: uses (or from) is refused, with what to send instead', async () => {
  const r = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', card: 'page', static: true, html: '<p>Hi</p>', uses: [rows] }] });
  assert.equal(r.ok, false);
  assert.equal(r.text, `not shown: panel p: a static page runs nothing, so it reads no data: leave out "uses" (${rows}), or leave out "static" for a page that runs and reads them`);
  const from = await call('show_view', { name: 'x', title: 'X', panels: [{ id: 'p', card: 'page', static: true, path: 'site/index.html', from: rows }] });
  assert.match(from.text, /panel p: a static page runs nothing, so it reads no data: leave out "from" and "uses" \(r1\)/);
  const table = await json('show_view', { name: 'x', title: 'X', panels: [{ id: 't', card: 'table', from: rows, static: true }] });
  assert.deepEqual(table.ignored, ['panel t: "static" does nothing on a table (page reads it)']);
});

test('in Chromium: a static page\'s frame is sandbox="", its script and onerror handler never run, its stylesheet beside it applies, its pictures and font load', async () => {
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors: string[] = [], requested: string[] = [], failed: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    page.on('request', r => requested.push(new URL(r.url()).pathname));
    page.on('requestfailed', r => failed.push(new URL(r.url()).pathname));
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => window.app.shell('light'));
    for (const name of ['note', 'site']) await page.evaluate((x: Shown) => window.app.view(x), shown.filter(v => v.name === name).at(-1)!);
    await page.evaluate((s: ShellState) => window.app.state({ ...s, maximized: null }), state!);
    for (const [name, url] of [['note', urlOf('note', 'p_note')], ['site', urlOf('site', 'p_site')]]) {
      const frame = page.locator(`.vindu-pane[data-view="${name}"] iframe[data-page-panel="${name}"]`);
      await frame.and(page.locator('[data-loaded="1"]')).waitFor({ timeout: 10_000 });
      assert.equal(await frame.getAttribute('sandbox'), '', name);
      assert.equal(await frame.getAttribute('src'), url, name);
      const inner = page.frames().find(f => f.url() === url);
      assert.ok(inner, `${name}: its frame`);
      // asked from here, as the page itself runs nothing that could wait: both its pictures settled
      for (let i = 0; i < 50 && !(await inner.evaluate(() => [...document.querySelectorAll('img')].every(x => x.complete))); i++) await page.waitForTimeout(100);
      assert.deepEqual(await inner.evaluate(() => {
        const [cabin, missing] = [...document.querySelectorAll('img')];
        return { script: document.body.dataset.script ?? null, onerror: document.body.dataset.onerror ?? null, title: document.title, color: getComputedStyle(document.querySelector('h1')!).color, cabin: cabin.naturalWidth, missing: missing.naturalWidth };
      }), { script: null, onerror: null, title: name === 'note' ? 'Note' : 'Brochure', color: 'rgb(1, 2, 3)', cabin: 40, missing: 0 }, name);
    }
    await page.waitForTimeout(300);
    assert.ok(requested.includes('/work/site/probe.woff2'), 'its font is asked for');
    assert.deepEqual(failed.filter(p => p.startsWith('/work/site/') && !p.endsWith('missing.png')), []); // and loads: no CORS refusal
    assert.deepEqual(errors, []);
  } finally { await browser.close(); app.close(); }
});
