// What frames in the window may do, in Chromium: a page's vindu.select and vindu.ask go only while the person uses the
// page, within task.send's limits; an MCP App's mount is the document's that initialized it, and the window answers its
// display methods itself; a frame's address must be one, and never the window's own origin; what a host gives the shell
// (its look, an action's icon) draws and does nothing else. All synthetic: pages and apps served here.
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
const rpc = `const said = []; let n = 0; const waiting = new Map();
addEventListener('message', e => { if (e.source !== parent) return; said.push(e.data); waiting.get(e.data?.id)?.(e.data); });
window.said = said;
window.call = (method, params) => new Promise(done => { const id = ++n; waiting.set(id, done); parent.postMessage({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }, '*'); });
window.tell = (method, params) => parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
const init = () => call('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'test', version: '1' }, appCapabilities: {} });`;
const FILES: Record<string, string> = {
  // a page the model wrote: it picks on load (no person) and on each click
  '/page.html': `<!doctype html><button id="pick">Pick</button><button id="ask">Ask</button><button id="big">Big</button><script>
const say = m => parent.postMessage(m, '*');
say({ vindu: 'select', items: ['on its own'] });
pick.onclick = () => say({ vindu: 'select', items: ['picked'], note: 'by a click' });
ask.onclick = () => say({ vindu: 'ask', prompt: 'Why is it late?' });
big.onclick = () => say({ vindu: 'select', items: ['x'.repeat(9000)] });</script>`,
  // an app that initializes when asked (after its load), one that does at once (before it), and a page that never does
  '/app.html': `<!doctype html><p>app</p><script>${rpc} window.init = init;</script>`,
  '/again.html': `<!doctype html><p>again</p><script>${rpc} init(); onload = () => setTimeout(() => call('tools/call', { name: 'after load' }), 200);</script>`,
  '/other.html': `<!doctype html><p>other</p><script>${rpc} onload = () => setTimeout(() => call('tools/call', { name: 'never initialized' }), 200);</script>`,
};
const frames = http.createServer((req, res) => {
  const body = FILES[new URL(req.url ?? '/', 'http://x').pathname];
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html' }).end(body ?? '');
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

const viewOf = (name: string, components: Record<string, unknown>[]): View => {
  const surface = [
    { version: 'v0.9', createSurface: { surfaceId: name, catalogId: VINDU_CATALOG } },
    { version: 'v0.9', updateComponents: { surfaceId: name, components: [{ id: 'root', component: 'Column', children: components.map(c => c.id) }, ...components] } },
  ];
  return { name, wide: surface, compact: surface };
};
async function windowWith(view: View, o: { hostShell?: { tokens?: unknown; icon?: string } } = {}) {
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(`${siteAt}/shell.html`);
  const shell = new Shell(); shell.show(view.name, { title: 'Frames', fill: false, panels: 'page' });
  await page.evaluate(({ view, state, host }) => {
    const app = (window as any).app;
    if (host) app.hostShell(host); else app.shell('light');
    app.view(view); app.state(state);
  }, { view, state: shell.state(), host: o.hostShell });
  const events = async (type: string) => (await page.evaluate(() => (window as any).app.events())).filter((e: any) => e.type === type);
  return { page, errors, events };
}
const frameAt = async (page: Page, file: string): Promise<Frame> => {
  for (let i = 0; i < 100; i++) { const f = page.frames().find(x => x.url().endsWith(file)); if (f) { await f.waitForLoadState('load'); return f; } await sleep(50); }
  throw new Error(`no frame for ${file}`);
};

test('a page picks and asks only while the person uses it, as often and as much as it may send', async () => {
  const { page, errors, events } = await windowWith(viewOf('frames', [{ id: 'pg', component: 'Page', url: `${framesAt}/page.html`, height: 200, panel: 'pick', title: 'Pick' }]));
  try {
    const frame = page.frameLocator('iframe[data-page-panel="pick"]');
    await frame.locator('#pick').waitFor();
    await sleep(300);
    assert.deepEqual(await events('page'), []); // what it picked on its own, with no person, never went
    await frame.locator('#big').click(); // too much at once
    for (let i = 0; i < 6; i++) await frame.locator('#pick').click(); // the sixth within ten seconds is one too many
    await frame.locator('#ask').click(); // counted on its own
    await sleep(200);
    const asked = await events('page');
    assert.deepEqual(asked.filter((e: any) => e.kind === 'select'), Array(5).fill({ type: 'page', kind: 'select', view: 'frames', panel: 'pick', items: ['picked'], note: 'by a click' }));
    assert.deepEqual(asked.filter((e: any) => e.kind === 'ask'), [{ type: 'page', kind: 'ask', view: 'frames', panel: 'pick', prompt: 'Why is it late?' }]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('an MCP App: the window answers its display, and its mount is the document\'s that initialized it', async () => {
  const { page, errors, events } = await windowWith(viewOf('frames', [{ id: 'ap', component: 'McpApp', url: `${framesAt}/app.html`, resource: 'ui://test/app', height: 200, panel: 'app', title: 'App' }]));
  try {
    const app = await frameAt(page, '/app.html');
    const answers = await app.evaluate(async () => {
      const w = window as any;
      const init = await w.init();
      return { init, ping: await w.call('ping'), mode: await w.call('ui/request-display-mode', { mode: 'pip' }), badMode: await w.call('ui/request-display-mode', { mode: 'tab' }),
        asRequest: await w.call('ui/notifications/size-changed', { height: 300 }) };
    });
    assert.equal(answers.init.result.protocolVersion, '2026-01-26');
    assert.deepEqual(answers.init.result.hostInfo, { name: 'vindu', version: '0.3.0' });
    assert.deepEqual(Object.keys(answers.init.result).sort(), ['hostCapabilities', 'hostContext', 'hostInfo', 'protocolVersion']);
    assert.deepEqual([answers.ping.result, answers.mode.result], [{}, { mode: 'inline' }]);
    assert.deepEqual([answers.badMode.error, answers.asRequest.error], [{ code: -32602, message: 'Invalid params for ui/request-display-mode: mode: Invalid input' }, { code: -32601, message: 'Method not found' }]);
    await app.evaluate(() => (window as any).tell('ui/notifications/size-changed', { height: 300 }));
    await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('iframe[data-app-panel]')!.style.height === '300px');
    const carried = await events('app');
    assert.deepEqual(carried.map((e: any) => e.msg.method), ['ui/initialize', 'ui/notifications/size-changed', 'ui/notifications/size-changed']); // the display's own requests stay here
    const first = carried[0].mount;

    // it goes to a document that initializes at once: a mount of its own, which lasts past its load
    await app.evaluate(() => { location.href = '/again.html'; });
    const again = await frameAt(page, '/again.html');
    await again.waitForFunction(() => (window as any).said.length >= 1);
    await sleep(400);
    const second = await events('app');
    assert.deepEqual(second.map((e: any) => e.msg.method), ['ui/initialize', 'tools/call']);
    assert.notEqual(second[0].mount, first);
    assert.equal(second[1].mount, second[0].mount);

    // and on to a page that never initializes: it has no mount, so what it sends is not carried, nor anything for the last
    await again.evaluate(() => { location.href = '/other.html'; });
    const other = await frameAt(page, '/other.html');
    await sleep(500);
    await page.evaluate((mount: string) => (window as any).app.app('frames', 'app', { vinduMount: mount, jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {} }), second[0].mount);
    await sleep(200);
    assert.deepEqual(await events('app'), []);
    assert.deepEqual(await other.evaluate(() => (window as any).said), []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a frame\'s address must be one, never the window\'s own origin; a frame without one breaks nothing', async () => {
  const { page, errors } = await windowWith(viewOf('frames', [
    { id: 'bad', component: 'Page', url: 'http://', panel: 'bad' },
    { id: 'own', component: 'Page', url: `${siteAt}/shell.html`, panel: 'own' },
    { id: 'app', component: 'McpApp', url: 'https://', resource: 'ui://test/app', panel: 'app' },
  ]));
  try {
    await page.waitForFunction(() => document.querySelectorAll('.vindu-pane p').length === 3);
    assert.deepEqual(await page.locator('.vindu-pane p').allTextContents(), ['No page to show.',
      'This page has the window\'s own origin, so it is not shown: it would have the window\'s rights.', 'No app to show.']);
    assert.equal(await page.locator('iframe').count(), 0);
    await page.evaluate(() => { // a host's own frame with no address says something: nothing breaks
      const f = document.createElement('iframe'); f.dataset.pagePanel = 'x'; f.setAttribute('src', 'https://');
      document.querySelector('.vindu-pane-body')!.append(f);
      dispatchEvent(new MessageEvent('message', { data: { vindu: 'report', report: {} }, origin: 'http://x.test', source: f.contentWindow }));
    });
    await sleep(200);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a host\'s look and icon: values only, never what loads; the icon\'s drawing only, never what runs', async () => {
  const icon = '<svg viewBox="0 0 16 16"><script>window.ran = 1</script><path d="M2 2h8" onclick="window.ran = 2"/>'
    + '<image href="https://x.test/i.png"/><a href="javascript:void 0"><path d="M3 3h4"/></a><circle r="2" fill="url(https://x.test/f)" stroke="url(#own)"/></svg>';
  const tokens = { ink: 'red', accent: 'url(https://x.test/a)', pane: 'u\\72l(https://x.test/b)', hair: '#fff/* x */', font: '"Inter", system-ui', line: '"open' };
  const { page, errors } = await windowWith(viewOf('frames', [{ id: 't', component: 'Text', text: 'Look' }]), { hostShell: { tokens, icon } });
  try {
    const skin = await page.evaluate(() => document.querySelector('style[data-vindu="skin"]')!.textContent);
    assert.match(skin, /--v-ink:red;--v-font:"Inter", system-ui\}/);
    assert.doesNotMatch(skin, /url|72l|\/\*|--v-line/);
    const drawn = await page.evaluate(() => {
      const b = document.querySelector('button[data-action="mine"]')!;
      return { label: b.getAttribute('aria-label'), html: b.innerHTML, ran: (window as any).ran ?? null };
    });
    assert.equal(drawn.label, 'Mine');
    assert.equal(drawn.ran, null);
    assert.equal(drawn.html, '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h8"></path><circle r="2" stroke="url(#own)"></circle></svg>');
    await page.evaluate(() => (window as any).app.hostShell({ icon: '<img src=x onerror="window.ran = 3">' }));
    await sleep(100);
    assert.deepEqual(await page.evaluate(() => [document.querySelector('button[data-action="mine"]')!.textContent, (window as any).ran ?? null]), ['Mine', null]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
