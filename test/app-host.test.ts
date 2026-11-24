// What the window tells an MCP App as its host, in Chromium: its host context as it changes (the window's language, the
// theme, its frame's width, and nothing of a height the app asked for), and its teardown before its frame goes, which
// the window waits for when the app's pane leaves it. All synthetic: apps served here, at frames.localhost.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Frame, Page } from 'playwright';
import { Shell } from '../src/shell.js';
import { VINDU_CATALOG } from '../src/catalog-id.js';
import type { View } from '../src/renderer/index.js';
import { chromium, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
// An app keeps what the window posts it (said), and tells the server here of each teardown it hears. answerAfter: how
// long it takes to answer one, in ms; without it, it never answers, and sends a response of another id instead.
const appPage = (answerAfter?: number) => `<!doctype html><p>app</p><script>
const said = []; let n = 0; const waiting = new Map(); window.said = said;
addEventListener('message', e => {
  if (e.source !== parent) return;
  said.push(e.data); waiting.get(e.data?.id)?.(e.data);
  if (e.data?.method !== 'ui/resource-teardown') return;
  fetch('/heard', { method: 'POST', mode: 'no-cors', body: JSON.stringify({ app: location.pathname, ...e.data }) });
  const id = ${answerAfter === undefined ? "e.data.id + '-other'" : 'e.data.id'};
  setTimeout(() => parent.postMessage({ jsonrpc: '2.0', id, result: {} }, '*'), ${answerAfter ?? 0});
});
window.call = (method, params) => new Promise(done => { const id = ++n; waiting.set(id, done); parent.postMessage({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }, '*'); });
window.tell = (method, params) => parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
window.init = () => call('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'test', version: '1' }, appCapabilities: {} });
</script>`;
// the same app everywhere, but one that answers its teardown; idle and alone are never initialized here
const FILES: Record<string, string> = { '/app.html': appPage(), '/answers.html': appPage(150), '/idle.html': appPage(), '/alone.html': appPage() };
const heard: Record<string, unknown>[] = [];
const frames = http.createServer((req, res) => {
  const at = new URL(req.url ?? '/', 'http://x').pathname;
  if (req.method === 'POST' && at === '/heard') {
    let body = ''; req.setEncoding('utf8'); req.on('data', c => { body += c; });
    req.on('end', () => { heard.push(JSON.parse(body)); res.writeHead(204).end(); });
    return;
  }
  res.writeHead(FILES[at] ? 200 : 404, { 'Content-Type': 'text/html' }).end(FILES[at] ?? '');
});
const site = http.createServer((req, res) => {
  const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await Promise.all([frames, site].map(server => new Promise<void>(r => server.listen(0, '127.0.0.1', r))));
const port = (server: http.Server) => (server.address() as { port: number }).port;
const framesAt = `http://frames.localhost:${port(frames)}`, siteAt = `http://127.0.0.1:${port(site)}`;
const browser = await chromium.launch();
afterAll(async () => { await browser.close(); frames.close(); site.close(); });

/** A view of MCP Apps, one for each panel, each the app at its file. */
const appView = (name: string, apps: { panel: string; file: string }[]): View => {
  const components = apps.map(a => ({ id: a.panel, component: 'McpApp', url: `${framesAt}${a.file}`, resource: `ui://test${a.file}`, height: 200, panel: a.panel, title: a.panel }));
  const surface = [
    { version: 'v0.9', createSurface: { surfaceId: name, catalogId: VINDU_CATALOG } },
    { version: 'v0.9', updateComponents: { surfaceId: name, components: [{ id: 'root', component: 'Column', children: components.map(c => c.id) }, ...components] } },
  ];
  return { name, wide: surface, compact: surface };
};
async function windowWith(views: View[], o: { locale?: string; width?: number } = {}) {
  const page: Page = await browser.newPage({ viewport: { width: o.width ?? 1280, height: 800 }, locale: 'de-DE', colorScheme: 'light' });
  const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(`${siteAt}/shell.html`);
  const shell = new Shell();
  for (const view of views) shell.show(view.name, { title: view.name, fill: false, panels: 'app' });
  await page.evaluate(({ views, state, locale }) => {
    const app = (window as any).app;
    app.shell('light', false, undefined, locale);
    for (const view of views) app.view(view);
    app.state(state);
  }, { views, state: shell.state(), locale: o.locale });
  return { page, errors, shell };
}
const frameAt = async (page: Page, file: string): Promise<Frame> => {
  for (let i = 0; i < 100; i++) { const f = page.frames().find(x => x.url().endsWith(file)); if (f) { await f.waitForLoadState('load'); return f; } await sleep(50); }
  throw new Error(`no frame for ${file}`);
};
/** What the app was told of its host context since it initialized, change by change. */
const changes = (app: Frame): Promise<Record<string, unknown>[]> =>
  app.evaluate(() => (window as any).said.filter((m: any) => m.method === 'ui/notifications/host-context-changed').map((m: any) => m.params));
const changed = (app: Frame, key: string, count: number) =>
  app.waitForFunction(([key, count]) => (window as any).said.filter((m: any) => m.params && key in m.params).length >= count, [key, count] as const);

test('an app hears the window\'s language: the host\'s at initialize, and again each time it changes', async () => {
  const { page, errors } = await windowWith([appView('language', [{ panel: 'app', file: '/app.html' }])], { locale: 'nb-no' });
  try {
    const app = await frameAt(page, '/app.html');
    const init = await app.evaluate(() => (window as any).init());
    assert.equal(init.result.hostContext.locale, 'nb-NO'); // the host's tag, in its canonical form
    await page.evaluate(() => (window as any).app.locale('en-GB'));
    await changed(app, 'locale', 1);
    await page.evaluate(() => { (window as any).app.locale('en-GB'); (window as any).app.locale('not a tag'); }); // the same again tells nothing
    await changed(app, 'locale', 2);
    assert.deepEqual((await changes(app)).filter(p => 'locale' in p), [{ locale: 'en-GB' }, { locale: 'de-DE' }]); // what is not a tag is the browser's
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('an app hears the theme: the shell\'s own as it changes, and the system\'s while the shell has none', async () => {
  const { page, errors } = await windowWith([appView('theme', [{ panel: 'app', file: '/app.html' }])]);
  try {
    const app = await frameAt(page, '/app.html');
    assert.equal((await app.evaluate(() => (window as any).init())).result.hostContext.theme, 'light');
    const theme = (t: string) => page.evaluate(t => (window as any).app.theme(t), t);
    await theme('dark'); await changed(app, 'theme', 1);
    await theme('dark'); await theme('auto'); await changed(app, 'theme', 2); // the system's: light
    await page.emulateMedia({ colorScheme: 'dark' }); await changed(app, 'theme', 3);
    await theme('dark'); await page.emulateMedia({ colorScheme: 'light' }); await sleep(200); // the shell's own holds
    await theme('light'); await changed(app, 'theme', 4);
    assert.deepEqual((await changes(app)).filter(p => 'theme' in p), [{ theme: 'dark' }, { theme: 'light' }, { theme: 'dark' }, { theme: 'light' }]);

    // the whole shell goes: hidden at once, and its app hears its teardown before its frame goes
    assert.deepEqual(await page.evaluate(() => { (window as any).app.destroy(); return [document.querySelector<HTMLElement>('.vindu-shell')!.style.display, !!document.querySelector('iframe')]; }), ['none', true]);
    await app.waitForFunction(() => (window as any).said.at(-1)?.method === 'ui/resource-teardown');
    await page.waitForFunction(() => !document.querySelector('.vindu-shell'), undefined, { timeout: 2000 });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('an app hears its frame\'s new width, and nothing of a height it asked for', async () => {
  const { page, errors } = await windowWith([appView('width', [{ panel: 'app', file: '/app.html' }])], { width: 760 });
  try {
    const app = await frameAt(page, '/app.html');
    const width = () => page.evaluate(() => document.querySelector('iframe')!.clientWidth);
    const before = await width();
    assert.deepEqual((await app.evaluate(() => (window as any).init())).result.hostContext.containerDimensions, { width: before, maxHeight: 2000 });
    await page.setViewportSize({ width: 1100, height: 800 }); // the lone pane widens with the window
    await changed(app, 'containerDimensions', 1);
    const after = await width();
    assert.ok(after > before, `${after} > ${before}`);
    const told = await changes(app);
    assert.ok(told.every(p => Object.keys(p).join() === 'containerDimensions'), JSON.stringify(told)); // only what changed
    assert.deepEqual(told.at(-1), { containerDimensions: { width: after, maxHeight: 2000 } });

    const count = await app.evaluate(() => (window as any).said.length);
    await app.evaluate(() => (window as any).tell('ui/notifications/size-changed', { height: 300 }));
    await page.waitForFunction(() => document.querySelector('iframe')!.clientHeight === 300);
    await sleep(300);
    assert.equal(await app.evaluate(() => (window as any).said.length), count);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('an app hears its teardown before its pane goes: it goes once the app answers, or after the wait; a frame that never initialized is not asked', async () => {
  const { page, errors, shell } = await windowWith([
    appView('answers', [{ panel: 'a', file: '/answers.html' }]),
    appView('silent', [{ panel: 's', file: '/app.html' }, { panel: 'i', file: '/idle.html' }]),
    appView('alone', [{ panel: 'l', file: '/alone.html' }]),
  ]);
  try {
    const [answers, silent, idle] = await Promise.all(['/answers.html', '/app.html', '/idle.html', '/alone.html'].map(file => frameAt(page, file)));
    for (const app of [answers, silent]) await app.evaluate(() => (window as any).init());
    await page.evaluate(() => (window as any).app.events());
    heard.length = 0;

    // a pane whose frame never initialized goes at once
    shell.drop('alone');
    assert.equal(await page.evaluate(state => {
      const frame = document.querySelector('iframe[data-app-panel="l"]')!;
      (window as any).app.state(state);
      return frame.isConnected;
    }, shell.state()), false);

    // one whose app answers: hidden at once, and gone once it has answered, 150 ms on
    const goneAfter = (state: unknown, panel: string) => page.evaluate(({ state, panel }) => {
      const frame = document.querySelector(`iframe[data-app-panel="${panel}"]`)!, pane = frame.closest('.vindu-pane')!, start = performance.now();
      const w = window as any; w.gone = undefined;
      new MutationObserver((_, watch) => { if (!frame.isConnected) { watch.disconnect(); w.gone = performance.now() - start; } }).observe(document.body, { childList: true, subtree: true });
      w.app.state(state);
      return frame.isConnected && getComputedStyle(pane).display === 'none';
    }, { state, panel });
    const gone = () => page.waitForFunction(() => (window as any).gone, undefined, { timeout: 3000 }).then(h => h.jsonValue() as Promise<number>);
    shell.drop('answers');
    assert.equal(await goneAfter(shell.state(), 'a'), true);
    const answered = await gone();
    assert.ok(answered >= 150 && answered < 450, `${answered} ms`);

    // one whose app answers nothing of its own (a response of another id): gone once the wait is over; the frame beside
    // it, which never initialized, is not asked
    shell.drop('silent');
    assert.equal(await goneAfter(shell.state(), 's'), true);
    await silent.waitForFunction(() => (window as any).said.some((m: any) => m.method === 'ui/resource-teardown'));
    const asked = await silent.evaluate(() => (window as any).said.find((m: any) => m.method === 'ui/resource-teardown'));
    assert.deepEqual({ ...asked, id: typeof asked.id }, { jsonrpc: '2.0', id: 'string', method: 'ui/resource-teardown', params: {} });
    assert.deepEqual(await idle.evaluate(() => (window as any).said), []);
    const waited = await gone();
    assert.ok(waited >= 490 && waited < 1500, `${waited} ms`);

    assert.deepEqual(heard.map(h => [h.app, h.method]), [['/answers.html', 'ui/resource-teardown'], ['/app.html', 'ui/resource-teardown']]);
    assert.deepEqual(await page.evaluate(() => (window as any).app.events().filter((e: any) => e.type === 'app')), []); // answers are the window's own
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
