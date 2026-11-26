// A page check against pages that work against it, in a real headless Chromium: one that stops answering, one that
// brings its own axe, service workers and WebSockets; a check's own copy of a page, gone once checked; the boot script
// first in a page that hides a "<head>"; and a window loaded from a file (Electron's), which frames pages by its scheme.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPage, memoryResults, startPageHost, startVindu } from '../src/index.js';
import { LIMITS } from '../src/page-steps.js';
import { playwrightDriver } from '../src/drivers/playwright.js';
import { chromium, mcpClient, sleep } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const work = tmp('limits-work-'), dir = tmp('limits-task-');
const pages: Record<string, string> = {
  'loop.html': '<!doctype html><title>Loop</title><script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 50));</script>',
  'stub.html': '<!doctype html><html lang="en"><title>Stub</title><main><img src="pic.png"></main><script>window.axe = { run: async () => ({ violations: [], passes: [], incomplete: [] }) };</script>',
  'locked.html': '<!doctype html><html lang="en"><title>Locked</title><main><img src="pic.png"></main><script>Object.defineProperty(window, "axe", { value: { run: () => new Promise(() => {}) }, writable: false, configurable: false });</script>',
  'reach.html': `<!doctype html><title>Reach</title><script>
    window.sw = Promise.race([navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => new Promise(r => setTimeout(r, 300)))
      .then(() => fetch('probe.txt')).then(r => r.text()), new Promise(r => setTimeout(() => r('never ready'), 2000))]);
    window.ws = new Promise(r => { const s = new WebSocket('ws://' + location.host + '/socket'); s.onopen = () => r('open'); s.onclose = s.onerror = () => r('closed'); });
  </script>`,
  'sw.js': 'self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", e => e.waitUntil(clients.claim())); self.addEventListener("fetch", e => { if (e.request.url.endsWith("/probe.txt")) e.respondWith(new Response("from the worker")); });',
  'probe.txt': 'from the host',
  'hidden-head.html': '<!doctype html><!-- <head> --><script>document.title = typeof window.__task + " " + (() => { try { new RTCPeerConnection(); return "rtc"; } catch (e) { return e.name; } })();</script><head></head><body>x</body>',
  'pick.html': '<!doctype html><title>Pick</title><button onclick="vindu.select([\'picked\'])">Pick</button>',
};
for (const [f, html] of Object.entries(pages)) fs.writeFileSync(path.join(work, f), html);
const browser = await chromium.launch();
const driver = playwrightDriver(browser);
const host = await startPageHost();
const key = host.add({ results: memoryResults(dir), dir, work });
afterAll(async () => { host.remove(key); await host.close(); await browser.close(); });

test('a page that stops answering is closed after the host\'s own time, and the check says so', async () => {
  const was = LIMITS.call; LIMITS.call = 1500;
  const t0 = Date.now();
  try {
    await assert.rejects(checkPage(driver, host.workUrl(key, 'loop.html'), { phone: false, accessibility: false, settleMs: 300 }), /the page stopped answering: nothing came back for 1\.5 s/);
    assert.ok(Date.now() - t0 < 10_000, `${Date.now() - t0} ms`);
  } finally { LIMITS.call = was; }
});

test('the audit is axe-core\'s own, loaded fresh: a page\'s window.axe can neither hide what fails nor hang the check', async () => {
  const stub = await checkPage(driver, host.workUrl(key, 'stub.html'), { phone: false });
  assert.ok(stub.accessibility?.violations?.some(v => v.rule === 'image-alt'), JSON.stringify(stub.accessibility));
  const locked = await checkPage(driver, host.workUrl(key, 'locked.html'), { phone: false });
  assert.ok(locked.accessibility?.violations?.some(v => v.rule === 'image-alt') || /did not run/.test(String(locked.accessibility?.note)), JSON.stringify(locked.accessibility));
});

test('no service worker stands between a check and the host, and no WebSocket opens', async () => {
  const r = await checkPage(driver, host.workUrl(key, 'reach.html'), { phone: false, accessibility: false, read: ['js:window.sw', 'js:window.ws'] });
  assert.equal(r.read?.['js:window.sw'], 'never ready'); // a worker the page registers never starts (allowed, it answers "from the worker")
  assert.equal(r.read?.['js:window.ws'], 'closed');
  assert.ok(r.blocked?.some(b => b.startsWith('ws://') && b.endsWith('/socket (outside this page\'s origin)')), JSON.stringify(r.blocked));
});

test('a page a check writes is gone once it is checked', async () => {
  const vindu = await startVindu({ driver });
  const taskDir = tmp('limits-check-');
  const ui = vindu.open({ results: memoryResults(taskDir), dir: taskDir });
  const { mcp, json } = await mcpClient(ui.url);
  try {
    for (let i = 0; i < 3; i++) assert.equal((await json('check_page', { html: `<!doctype html><title>Draft ${i}</title>`, accessibility: false })).title, `Draft ${i}`);
    assert.deepEqual(fs.readdirSync(path.join(taskDir, 'views')).filter(f => f.startsWith('check_')), []);
  } finally { await mcp.close(); ui.close(); await vindu.close(); }
});

test('the boot script runs first in a page that hides a "<head>" in a comment before its own script', async () => {
  const ctx = await browser.newContext();
  try {
    const p = await ctx.newPage();
    await p.goto(host.workUrl(key, 'hidden-head.html'));
    assert.equal(await p.title(), 'object NotAllowedError');
  } finally { await ctx.close(); }
});

test('a window loaded from a file frames pages by its scheme ("file:"), and hears what they pick; no other window does', async () => {
  const framed = await startPageHost({ pageParentOrigins: ['file:'] }), strict = await startPageHost({ pageParentOrigins: ['http://localhost:1'] });
  const ctx = await browser.newContext();
  try {
    const parentFile = (url: string) => {
      const f = path.join(tmp('limits-window-'), 'index.html');
      fs.writeFileSync(f, `<!doctype html><title>Window</title><script>addEventListener('message', e => { if (e.data?.vindu === 'select') document.title = 'heard ' + e.data.items[0]; });</script><iframe src="${url}"></iframe>`);
      return pathToFileURL(f).href;
    };
    const k = framed.add({ results: memoryResults(dir), dir: tmp('limits-f-'), work });
    const p = await ctx.newPage();
    await p.goto(parentFile(framed.workUrl(k, 'pick.html')));
    await p.frameLocator('iframe').getByText('Pick').click();
    await p.waitForFunction(() => document.title === 'heard picked');
    const s = strict.add({ results: memoryResults(dir), dir: tmp('limits-s-'), work });
    await p.goto(parentFile(strict.workUrl(s, 'pick.html')));
    await sleep(500);
    assert.equal(await p.frameLocator('iframe').getByText('Pick').count(), 0); // frame-ancestors: not this window
  } finally { await ctx.close(); await framed.close(); await strict.close(); }
});
