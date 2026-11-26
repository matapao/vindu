// A page from the working folder in the person's window (the shell, in Chromium): it runs on its work origin, reads
// the result in its uses, and what it sends, picks and reports reaches the UI server as from any page.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, sleep } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean | Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (!(await f())) { if (Date.now() > end) throw new Error('timed out'); await sleep(40); } };
const work = tmp('wwork-'), dir = tmp('wtask-');
fs.writeFileSync(path.join(work, 'pick.html'), `<!doctype html><title>Pick</title><button id="go">Pick</button><p id="out">-</p><script>
document.getElementById('go').onclick = () => {
  vindu.select([{ id: 'INV-1' }], 'picked in the page');
  task.send({ picked: 'INV-1', rows: task.data.r1.length }).then(r => { document.getElementById('out').textContent = JSON.stringify(r); }, e => { document.getElementById('out').textContent = e.message; });
};
</script>`);
// given no results: it tries to reach into the frames beside it, and reaches only its own
fs.writeFileSync(path.join(work, 'peek.html'), `<!doctype html><title>Peek</title><button id="go">Peek</button><p id="out">-</p><script>
document.getElementById('go').onclick = () => {
  const seen = []; for (let i = 0; i < parent.frames.length; i++) { try { seen.push(Object.keys(parent.frames[i].task.data).join(',') || 'none'); } catch (e) { seen.push(e.name); } }
  document.getElementById('out').textContent = seen.sort().join(' ');
};
</script>`);
const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', value: [{ id: 'INV-1', amount_nok: 1200 }] });

const site = http.createServer((req, res) => {
  const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const vindu = await startVindu({ verifyMs: 1500 }); // no page driver: the window says how the page runs
const views: Shown[] = []; let state: ShellState | undefined;
const ui = vindu.open({ results, dir, work }, { onView: v => views.push(v), onState: s => { state = s; } });
const { mcp, call, json } = await mcpClient(ui.url);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(`http://127.0.0.1:${(site.address() as { port: number }).port}/shell.html`);
await page.evaluate(() => window.app.shell('light'));
let running = true;
const pump = (async () => { // the host's part: views and state to the window, the window's events to the UI server
  while (running) {
    for (const e of await page.evaluate(() => window.app.events())) ui.event(e);
    for (const v of views.splice(0)) await page.evaluate((x: Shown) => window.app.view(x), v);
    if (state) { const s = state; state = undefined; await page.evaluate((x: ShellState) => window.app.state(x), s); }
    await sleep(40);
  }
})();
afterAll(async () => { running = false; await pump; await mcp.close(); ui.close(); await vindu.close(); await browser.close(); site.close(); });

test('a working-folder page in the window: on its work origin, its uses read, and its send, pick and report heard', async () => {
  await json('show_view', { name: 'site', title: 'Site', panels: [{ card: 'page', id: 'pick', path: 'pick.html', uses: ['r1'], height: 240 }, { card: 'page', id: 'peek', path: 'peek.html', height: 120 }] });
  const iframe = page.locator('.vindu-pane[data-view="site"] iframe[data-page-panel="pick"]');
  await iframe.waitFor();
  const key = new URL(ui.pages).hostname.split('.')[0];
  assert.match(String(await iframe.getAttribute('src')), new RegExp(`^http://work-${key}-[a-f0-9]{24}\\.localhost:\\d+/work/pick\\.html\\?uses=r1$`));
  const peek = page.frameLocator('.vindu-pane[data-view="site"] iframe[data-page-panel="peek"]');
  await page.frameLocator('.vindu-pane[data-view="site"] iframe[data-page-panel="pick"]').locator('#go').waitFor();
  await peek.locator('#go').click();
  await peek.locator('#out').filter({ hasText: /^(none|SecurityError)/ }).waitFor({ timeout: 5000 });
  assert.equal(await peek.locator('#out').innerText(), 'SecurityError none'); // the page given r1 is on another origin: out of reach
  const frame = page.frameLocator('.vindu-pane[data-view="site"] iframe[data-page-panel="pick"]');
  await frame.locator('#go').click();
  await frame.locator('#out').filter({ hasText: '{"sent":true}' }).waitFor({ timeout: 5000 });
  await until(() => ui.unheard().length === 1);
  assert.deepEqual(ui.unheard()[0].sent, { picked: 'INV-1', rows: 1 });
  const kept = ui.answers().at(-1);
  assert.equal(kept?.kind === 'answer' ? kept.by : undefined, 'page');
  await until(() => ui.selection().some(s => s.view === 'site' && s.panel === 'pick'));
  assert.deepEqual(ui.selection().find(s => s.panel === 'pick')?.page, [{ id: 'INV-1' }]);
  await until(async () => (await call('check_page', { panel: 'pick' })).text.startsWith('{')); // the window has said how it runs there
  const seen = await json('check_page', { panel: 'pick' });
  assert.equal(seen.window.by, "the person's window"); assert.equal(seen.window.loaded, true);
  assert.match((await call('results', {})).text, /the page panel "pick" in view "site" sent/);
});
