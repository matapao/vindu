// What a page of the model's reaches on other sites, in a real Chromium: its frames, images, fetches and redirects wait
// for the person's yes for each site, asked once per site and one question at a time; a no refuses the site and quiets
// the page until the model acts in it again. The person's own pages are theirs. And what a script draws after an action
// or a load is there when the model reads the page.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Views, type PageNode, type ViewHost } from '../src/index.js';
import { cdpOf, chromium, sleep } from './helpers.js';

const reached: string[] = []; // host and path of every request the sites got
const reachedAt: number[] = []; // and when each came
const PAGES = new Map<string, (port: number) => string>(Object.entries({ // a Map: a request's path is only ever a key
  '/embeds': p => `<!doctype html><title>Embeds</title><iframe src="http://frames.test:${p}/inner"></iframe>
    <img src="http://frames.test:${p}/pixel?d=1"><script>fetch("http://frames.test:${p}/api?d=2").catch(() => {});</script>`,
  '/leaky': p => `<!doctype html><title>Leaky</title><img src="/hop"><iframe src="http://second.test:${p}/f"></iframe>
    <script>fetch("http://second.test:${p}/x?d=3").catch(() => {});</script>`,
  '/progressive': () => `<!doctype html><title>Progressive</title><ul></ul><button onclick="draw()">Draw</button><script>
    function draw() { let n = 0; const t = setInterval(() => { document.querySelector("ul").append(Object.assign(document.createElement("li"), { textContent: "item " + ++n }));
      if (n === 10) clearInterval(t); }, 60); }
    addEventListener("load", draw);</script>`,
}));
const site = http.createServer((req, res) => {
  const host = String(req.headers.host).replace(/:\d+$/, '');
  if (host !== '127.0.0.1') { reached.push(host + req.url); reachedAt.push(Date.now()); }
  const page = PAGES.get(req.url ?? '');
  if (host === '127.0.0.1' && req.url === '/hop') res.writeHead(302, { Location: `http://first.test:${port}/a?d=secret` }).end(); // a redirect to another site
  else if (host === '127.0.0.1' && typeof page === 'function') res.writeHead(200, { 'Content-Type': 'text/html' }).end(page(port));
  else res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
});
await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
const port = (site.address() as { port: number }).port, base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.test 127.0.0.1'] }); // other sites, served here
afterAll(async () => { await browser.close(); site.close(); });

/** A window with browser pages: the person answers each question as answer says, after a moment. */
function window(answer: (title: string) => boolean) {
  const asked: string[] = [], answered: number[] = [];
  const confirm: ViewHost['confirm'] = async q => { asked.push(q.title); await sleep(150); answered.push(Date.now()); return answer(q.title); };
  const views = new Views({ terminal: false, browser: { open: async () => {
    const tab = await browser.newPage(); const s = await tab.context().newCDPSession(tab);
    return cdpOf(s);
  } } }, { cwd: '.', dir: '.', confirm, pane: () => [], unpane() {}, tell() {}, log() {} });
  return { views, asked, answered };
}
const find = (nodes: PageNode[], f: (n: PageNode) => boolean): PageNode | undefined => { for (const n of nodes) { if (f(n)) return n; const c = n.children && find(n.children, f); if (c) return c; } return undefined; };
const until = async (f: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(25); } };

test('what a page of the model\'s loads from another site waits for the person\'s yes, asked once for the site', async () => {
  const { views, asked, answered } = window(() => true);
  try {
    reached.length = 0; reachedAt.length = 0;
    const started = Date.now();
    const shown = await views.show('embeds', 'Embeds', `${base}/embeds`); // this machine: opened without asking
    assert.equal((shown.snapshot as { title: string }).title, 'Embeds');
    await until(() => reached.length === 3);
    assert.deepEqual(asked, [`Let the model's page reach frames.test:${port}?`]); // a frame, an image and a fetch: one question
    assert.deepEqual(reached.sort(), ['frames.test/api?d=2', 'frames.test/inner', 'frames.test/pixel?d=1']);
    assert.ok(answered[0] - started >= 150 && Math.min(...reachedAt) >= answered[0]); // each only after the yes
    await views.act('embeds', { action: 'reload' });
    assert.equal(asked.length, 1); // the site is allowed until the task ends
  } finally { views.close(); }
});

test('a no refuses the site, redirects too, and quiets the page until the model acts in it again', async () => {
  const { views, asked } = window(() => false);
  try {
    reached.length = 0;
    await views.show('leaky', 'Leaky', `${base}/leaky`);
    await sleep(300);
    assert.equal(asked.length, 1); // the first site asked about; after the no, the page asks nothing more
    assert.match(asked[0], /^Let the model's page reach (first|second)\.test:\d+\?$/);
    await views.act('leaky', { action: 'reload' }); // the model acts in it: the other site may be asked about again
    await sleep(300);
    assert.equal(asked.length, 2);
    assert.notEqual(asked[1], asked[0]); // the site refused stays refused, unasked
    assert.deepEqual(reached, []); // nothing reached either site: no frame, no fetch, not through the redirect either
    assert.equal(views.allowedNow(`http://first.test:${port}/`), false);
  } finally { views.close(); }
});

test('the person\'s own page loads what it loads, unasked', async () => {
  const { views, asked } = window(() => false);
  try {
    reached.length = 0;
    await views.openPage(`${base}/embeds`);
    await until(() => reached.length === 3);
    assert.deepEqual(asked, []);
  } finally { views.close(); }
});

test('what a script draws after a load or an action is there when the model reads the page', async () => {
  const { views } = window(() => false);
  const items = (r: Record<string, unknown>) => JSON.stringify(r.snapshot).match(/item \d+/g)?.length ?? 0;
  try {
    const shown = await views.show('drawing', 'Drawing', `${base}/progressive`); // it draws for 600 ms after its load
    assert.equal(items(shown), 10);
    const button = find((shown.snapshot as { tree: PageNode[] }).tree, n => n.role === 'button')!;
    const clicked = await views.act('drawing', { action: 'click', ref: button.ref }); // it draws again, for longer than the action's own wait
    assert.equal(items(clicked), 20);
    assert.equal(items(await views.act('drawing', { action: 'reload' })), 10);
  } finally { views.close(); }
});
