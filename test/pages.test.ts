// Page panels in a real headless Chromium: a website the process builds (live), a game tested with steps,
// pages that break or reach for the network, and views written with ECharts, Chart.js and three.js over process data.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults } from '../src/index.js';
import { playwrightDriver } from '../src/drivers/playwright.js';
import { chromium, get, getRaw, mcpClient, sleep } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const workOf = (pages: string) => pages.replace('http://', 'http://work-'); // where pages from the working folder run
const write = (root: string, files: Record<string, string>) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); } };

const invoices = [
  { id: 'INV-2026-0241', customer: 'Vik Data', amount_nok: 31050, status: 'overdue' },
  { id: 'INV-2026-0259', customer: 'Strand Bygg', amount_nok: 35740, status: 'overdue' },
  { id: 'INV-2026-0270', customer: 'Strand Bygg', amount_nok: 35400, status: 'overdue' },
  { id: 'INV-2026-0300', customer: 'Nordlys Retail', amount_nok: 49520, status: 'open' },
];
const work = tmp('work-');
write(work, {
  'index.html': '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fjord Cabins</title><link rel="stylesheet" href="style.css"></head><body><header><h1>Fjord Cabins</h1><nav><a href="about.html">About</a></nav></header><main><img src="img/cabin.svg" alt="cabin"><p id="status">Loading</p></main><script src="app.js"></script></body></html>',
  'style.css': 'body { font-family: sans-serif; margin: 0; background: rgb(255, 255, 255); } main { padding: 16px; } img { max-width: 100%; }',
  'app.js': 'document.getElementById("status").textContent = "Open all year";',
  'img/cabin.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#7a5"/></svg>',
  'about.html': '<!doctype html><title>About</title><p>Since 1998.</p>',
  'wide.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Wide</title></head><body><div style="width:1200px">A fixed-width layout</div></body></html>',
  '.env': 'SECRET=never-served',
  'a11y.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Booking</title></head><body><main><h1>Book a cabin</h1><img src="img/cabin.svg"><button></button><p style="color:#bbb;background:#fff">Light grey on white</p><label>Name <input id="who"></label></main></body></html>',
  'menu.html': `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Menu</title>
<style>#toggle { display: none } #nav { display: flex } @media (max-width: 600px) { #toggle { display: block } #nav { display: none } #nav.open { display: block } }</style></head>
<body><button id="toggle" onclick="document.getElementById('nav').classList.toggle('open')">Menu</button><nav id="nav">
  <a href="#">Home</a>
  <a href="#book">Book</a>
</nav><input id="name"></body></html>`,
  'game/index.html': `<!doctype html><html><head><title>Dot</title></head><body>
<button id="start">Start</button><div>Score: <span id="score">0</span></div><canvas id="c" width="200" height="200"></canvas>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  window.game = { x: 0, y: 0, running: false, score: 0 };
  const draw = () => { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 200, 200); ctx.fillStyle = '#c44'; ctx.fillRect(100, 100, 20, 20); ctx.fillStyle = '#4c4'; ctx.fillRect(game.x * 20, game.y * 20, 20, 20); };
  document.getElementById('start').onclick = () => { game.running = true; draw(); };
  addEventListener('keydown', e => {
    const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!game.running || !d) return;
    game.x += d[0]; game.y += d[1];
    if (game.x === 5 && game.y === 5) { game.score++; document.getElementById('score').textContent = game.score; }
    draw();
  });
  draw();
</script></body></html>`,
  'broken/index.html': `<!doctype html><html><head><title>Broken</title><script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script></head><body>
<img src="missing.png"><script type="module">import * as d3 from 'd3';</script><script>undefinedFunction();</script>
<script>fetch('https://api.example.com/rates').catch(() => {});</script></body></html>`,
  'tiny.html': `<!doctype html><title>Tiny</title><script type="module">import { greet } from 'tiny'; document.body.textContent = greet('fjord');</script>`,
  'noheader.html': `<!doctype html><script type="module">import * as e from 'echarts'; document.title = 'ok ' + typeof e.init;</script><header><h1>Hi</h1></header>`,
  'big.html': `<!doctype html><html><head><title>${'T'.repeat(5000)}</title></head><body><h1>${'H'.repeat(50000)}</h1>
<script type="module">import * as echarts from 'echarts';
for (let c = 0; c < 30; c++) { const d = document.createElement('div'); d.style.cssText = 'width:200px;height:100px'; document.body.appendChild(d);
  echarts.init(d).setOption({ animation: false, xAxis: { type: 'category', data: Array.from({ length: 50 }, (_, i) => 'label-' + 'x'.repeat(100) + i) }, yAxis: {}, series: Array.from({ length: 10 }, (_, s) => ({ type: 'bar', name: 'series-' + 'y'.repeat(200) + s, data: Array.from({ length: 200 }, (_, i) => i * 1.5) })) }); }
for (let i = 0; i < 100; i++) setTimeout(() => { throw new Error('boom ' + i + ' ' + 'z'.repeat(5000)); });
for (let i = 0; i < 50; i++) { const im = new Image(); im.src = 'missing-' + 'w'.repeat(1000) + i + '.png'; document.body.appendChild(im); }
for (let i = 0; i < 300; i++) setTimeout(() => { throw new Error('the same error'); });
for (let i = 0; i < 30; i++) document.body.insertAdjacentHTML('beforeend', '<h2>' + 'heading ' + i + '</h2><canvas width="10" height="10"></canvas>');
</script>
<script type="module">import * as THREE from 'three';
const r = new THREE.WebGLRenderer(); r.setSize(100, 100); document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); m.type = 'Q'.repeat(20000); scene.add(m);
r.render(scene, new THREE.PerspectiveCamera());
</script></body></html>`,
});
// links: one to a dotfile, one to a dot folder, one out of the folder; none of them is served
fs.mkdirSync(path.join(work, '.git')); fs.writeFileSync(path.join(work, '.git', 'config'), '[core]');
fs.symlinkSync('.env', path.join(work, 'notes.txt')); fs.symlinkSync('.git', path.join(work, 'gitlink'));
const outsideFile = path.join(tmp('outside-'), 'secret.txt'); fs.writeFileSync(outsideFile, 'outside'); fs.symlinkSync(outsideFile, path.join(work, 'outside.txt'));
// a library the host adds, served offline like the built-in ones
const tinyDir = tmp('tiny-'); fs.writeFileSync(path.join(tinyDir, 'tiny.js'), "export const greet = n => 'hello ' + n;");
const tiny = { name: 'tiny', version: '1.0.0', license: 'MIT', dir: tinyDir, imports: { tiny: 'tiny.js' } };

const dir = tmp('task-');
const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', value: invoices });

const browser = await chromium.launch();
const vindu = await startVindu({ driver: playwrightDriver(browser), libraries: [tiny] });
const ui = vindu.open({ results, dir, work });
const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); await browser.close(); });
const page = (a: { panels: { page: Record<string, unknown> }[] }) => a.panels[0].page as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test('a website the task builds: shown live from the working folder, and the account says how it loaded', async () => {
  const a = await json('show_view', { name: 'site', title: 'Fjord Cabins', panels: [{ card: 'page', path: 'index.html', title: 'Site' }] });
  assert.equal(a.panels[0].from, 'work/index.html');
  const r = page(a);
  assert.equal(r.loaded, true); assert.equal(r.title, 'Fjord Cabins');
  assert.equal(r.errors, undefined); assert.equal(r.failed_requests, undefined); assert.equal(r.blocked, undefined);
  assert.deepEqual(r.text.headings, ['Fjord Cabins']); assert.match(r.text.starts, /Open all year/); // the script ran
  assert.deepEqual(r.phone, { width: 390, overflow_px: 0 });
  const wide = await json('check_page', { path: 'wide.html' });
  assert.ok(wide.phone.overflow_px > 700, JSON.stringify(wide.phone)); // a fixed 1200 px layout overflows a phone
});

test('live: a change to the page reloads it; a change to CSS alone swaps the styles and keeps the page state', async () => {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.goto(`${workOf(ui.pages)}/work/index.html`);
  await p.waitForFunction(() => document.getElementById('status')?.textContent === 'Open all year');
  assert.equal(await p.evaluate(() => {
    const page = window as Window & { vindu?: { select?: unknown; ask?: unknown } };
    return typeof page.vindu?.select === 'function' && typeof page.vindu.ask === 'function';
  }), true, 'generated pages have the Vindu interaction API');
  fs.writeFileSync(path.join(work, 'app.js'), 'document.getElementById("status").textContent = "Closed for winter";');
  await p.waitForFunction(() => document.getElementById('status')?.textContent === 'Closed for winter', null, { timeout: 5000 });
  await p.evaluate(() => { (window as unknown as { kept: number }).kept = 42; });
  await sleep(300);
  fs.writeFileSync(path.join(work, 'style.css'), 'body { font-family: sans-serif; margin: 0; background: rgb(10, 20, 30); }');
  await p.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(10, 20, 30)', null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => (window as unknown as { kept?: number }).kept), 42); // not reloaded
  await ctx.close();
});

test('accessibility: the page is audited (axe-core, WCAG 2 A and AA): each rule it fails, how bad, and where', async () => {
  const r = await json('check_page', { path: 'a11y.html' });
  assert.equal(r.accessibility.engine, 'axe-core 4.14.0');
  const rules = Object.fromEntries(r.accessibility.violations.map((v: { rule: string }) => [v.rule, v]));
  assert.deepEqual(Object.keys(rules).sort(), ['button-name', 'color-contrast', 'image-alt']);
  assert.deepEqual([rules['image-alt'].impact, rules['image-alt'].elements, rules['image-alt'].at], ['critical', 1, ['img']]);
  assert.equal(rules['color-contrast'].impact, 'serious');
  assert.equal(r.accessibility.violations[0].impact, 'critical'); // the worst first
  assert.ok(r.accessibility.passed > 5);
  const off = await json('check_page', { path: 'a11y.html', accessibility: false });
  assert.equal(off.accessibility, undefined);
});

test('a game, tested with steps: keys and clicks go in, values come out', async () => {
  const r = await json('check_page', { path: 'game/', steps: [{ click: '#start' }, { press: 'ArrowRight', times: 5 }, { press: 'ArrowDown', times: 5 }, { click: '#missing' }], read: ['#score', 'js:game', 'js:game.nothere'] });
  assert.equal(r.page, 'work/game/index.html');
  assert.deepEqual(r.steps.map((s: { ok: boolean }) => s.ok), [true, true, true, false]);
  assert.match(r.steps[3].note, /#missing/);
  assert.equal(r.read['#score'], '1');
  assert.deepEqual(JSON.parse(r.read['js:game']), { x: 5, y: 5, running: true, score: 1 });
  assert.equal(r.read['js:game.nothere'], null);
  assert.deepEqual(r.canvases, [{ size: '200×200', context: '2d', painted: '100%', colors: 2 }]); // the board, and the player now covering the target
});

test('steps can run at phone size; a click on something hidden at that size says so', async () => {
  const desk = await json('check_page', { path: 'menu.html', steps: [{ click: '#toggle' }] });
  assert.equal(desk.steps[0].ok, false); assert.equal(desk.steps[0].note, '#toggle is there but not visible 1024 px wide');
  const nav = 'js:getComputedStyle(document.getElementById("nav")).display';
  const phone = await json('check_page', { path: 'menu.html', size: 'phone', steps: [{ click: '#toggle' }, { type: 'Kari', into: '#name' }], read: [nav, '#nav', '#name'] });
  assert.equal(phone.size, '390×844'); assert.deepEqual(phone.steps.map((s: { ok: boolean }) => s.ok), [true, true]);
  assert.equal(phone.read[nav], 'block'); // the menu opened
  assert.equal(phone.read['#nav'], 'Home Book'); assert.equal(phone.read['#name'], 'Kari'); // text as read, a field's value
  assert.deepEqual(phone.phone, { width: 390, overflow_px: 0 });
});

test('a page that breaks or reaches for the network: errors, blocked and failed requests, and what is pinned instead', async () => {
  const r = await json('check_page', { path: 'broken/index.html' });
  assert.ok(r.errors.some((e: string) => e.endsWith('undefinedFunction is not defined (index.html:2)')), JSON.stringify(r.errors)); // the page's own line numbers
  assert.ok(r.errors.some((e: string) => /resolve module specifier "d3"/.test(e)), JSON.stringify(r.errors));
  assert.ok(r.blocked.some((b: string) => b.startsWith('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js')), JSON.stringify(r.blocked));
  assert.ok(r.blocked.some((b: string) => b.startsWith('https://api.example.com/rates (connect-src)')), JSON.stringify(r.blocked));
  assert.deepEqual(r.failed_requests, ['/work/broken/missing.png']);
  assert.ok(r.pinned.some((l: string) => /^three, three\/addons\/…: three 0\.187\.0$/.test(l)), JSON.stringify(r.pinned));
  assert.ok(r.pinned.includes('tiny: tiny 1.0.0'), JSON.stringify(r.pinned)); // and what the host added
});

test('a view written with ECharts over the task\'s data: the account says what it plotted, and the numbers come from the record', async () => {
  const html = `<!doctype html><html><head><title>Overdue</title></head><body><h2>Overdue per customer</h2><div id="c" style="width:600px;height:300px"></div><p id="total"></p>
<script type="module">
import * as echarts from 'echarts';
const rows = task.data.r1.filter(r => r.status === 'overdue');
const per = task.group(rows, 'customer', 'sum(amount_nok)');
echarts.init(document.getElementById('c')).setOption({ animation: false, xAxis: { type: 'category', data: per.map(p => p.customer) }, yAxis: { type: 'value' }, series: [{ type: 'bar', name: 'Overdue', data: per.map(p => p.sum_amount_nok) }] });
document.getElementById('total').textContent = 'Total ' + task.value(rows, 'sum(amount_nok)').toLocaleString('en-GB') + ' NOK';
</script></body></html>`;
  const a = await json('show_view', { name: 'overdue', title: 'Overdue', panels: [{ card: 'page', title: 'Per customer', html, uses: ['r1'] }] });
  assert.deepEqual(a.panels[0].uses, ['r1']);
  const r = page(a);
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.deepEqual(r.libraries, ['echarts 6.1.0']);
  assert.deepEqual(r.charts, [{ library: 'echarts', type: 'bar', labels: ['Vik Data', 'Strand Bygg'], series: [{ name: 'Overdue', points: 2, values: [31050, 71140] }] }]);
  assert.match(r.text.starts, /Total 102,190 NOK/);
  assert.equal(r.numbers_not_in_any_result, undefined); // 71,140 and 102,190 were computed by task.group and task.value
  const typed = page(await json('show_view', { name: 'typed', title: 'Typed', panels: [{ card: 'page', html: '<p>Expected 99999 NOK, of which 31050 from Vik Data</p>', uses: ['r1'] }] }));
  assert.deepEqual(typed.numbers_not_in_any_result, [99999]); // 31050 is in r1; 99999 is in no result
});

test('a view written with Chart.js, reading its data over fetch: the values plotted and the results fetched', async () => {
  const html = `<!doctype html><html><head><title>Amounts</title></head><body><canvas id="c" width="500" height="250"></canvas>
<script type="module">
import Chart from 'chart.js/auto';
const rows = await (await fetch('/data/r1.json')).json();
new Chart(document.getElementById('c'), { type: 'line', data: { labels: rows.map(r => r.id), datasets: [{ label: 'NOK', data: rows.map(r => r.amount_nok) }] }, options: { animation: false, responsive: false } });
</script></body></html>`;
  const r = page(await json('show_view', { name: 'amounts', title: 'Amounts', panels: [{ card: 'page', html, uses: ['r1'] }] }));
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.deepEqual(r.libraries, ['chart.js 4.6.1']);
  assert.equal(r.charts[0].library, 'chart.js'); assert.equal(r.charts[0].type, 'line');
  assert.deepEqual(r.charts[0].series[0].values, [31050, 35740, 35400, 49520]);
  assert.deepEqual(r.data_fetched, ['r1']);
});

test('a 3D view with three.js and an addon: the scene, frames and draw calls, from WebGL in the headless browser', async () => {
  const html = `<!doctype html><html><head><title>3D</title></head><body style="margin:0">
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const renderer = new THREE.WebGLRenderer(); renderer.setSize(400, 300); document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100); camera.position.set(0, 3, 8);
new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
task.data.r1.forEach((r, i) => { const h = r.amount_nok / 10000; const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), new THREE.MeshStandardMaterial({ color: 0x3b82f6 })); m.position.set(i * 1.2 - 2, h / 2, 0); m.name = r.id; scene.add(m); });
renderer.setAnimationLoop(() => renderer.render(scene, camera));
</script></body></html>`;
  const r = page(await json('show_view', { name: 'bars3d', title: 'Invoices in 3D', panels: [{ card: 'page', html, uses: ['r1'], height: 320 }] }));
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.deepEqual(r.libraries, ['three 0.187.0']);
  // a slow machine draws fewer frames before the first look: the page is looked at again until its loop has drawn more
  let s = r.three[0];
  for (let n = 0; s.frames <= 3 && n < 10; n++) s = (await json('check_page', { panel: 'bars3d' })).three[0];
  assert.ok(s.frames > 3, JSON.stringify(s)); assert.equal(s.draw_calls, 4); assert.equal(s.triangles, 48);
  assert.deepEqual(s.objects, { AmbientLight: 1, Mesh: 4 }); assert.deepEqual(s.named, invoices.map(i => i.id)); assert.equal(s.camera, 'PerspectiveCamera');
  assert.equal(r.canvases[0].context, 'webgl2'); assert.ok(r.canvases[0].draw_calls > 0);
  assert.equal(r.data_fetched, undefined); // the Chart.js page before it fetched r1; this page did not
});

test('refusals for pages say what to send instead', async () => {
  const both = await call('show_view', { name: 'x', title: 'x', panels: [{ card: 'page', path: 'index.html', html: '<p>x</p>' }] });
  assert.match(both.text, /"path" .* or "html" .*, not both/);
  const none = await call('show_view', { name: 'x', title: 'x', panels: [{ card: 'page', path: 'shop.html' }] });
  assert.match(none.text, /no page "shop.html" in the working folder; pages there: a11y.html, about.html, big.html, broken\/index.html, game\/index.html, index.html, menu.html, noheader.html, tiny.html, wide.html/);
  const data = await call('show_view', { name: 'x', title: 'x', panels: [{ card: 'page', html: '<p>x</p>', uses: ['r7'] }] });
  assert.match(data.text, /no result "r7" to give the page/);
  const unseen = await call('check_page', { panel: 'nope' });
  assert.equal(unseen.ok, false); assert.match(unseen.text, /no page panel "nope" has been shown; shown: .*per-customer \(in view overdue\)/);
  const byView = await json('check_page', { panel: 'overdue' }); // the view's name, as a model may well say it
  assert.equal(byView.loaded, true); assert.equal(byView.page, 'a page you wrote');
});

test('each task is its own origin: no dotfiles, no way out of the folder, no other task\'s data', async () => {
  assert.equal((await get(`${ui.pages}/work/index.html`)).headers['content-security-policy']?.includes("connect-src 'self'"), true);
  assert.match(String((await get(`${ui.pages}/work/index.html`)).headers['content-security-policy']), /; sandbox$/); // a file of the folder never runs beside the data
  assert.doesNotMatch(String((await get(`${workOf(ui.pages)}/work/index.html`)).headers['content-security-policy']), /sandbox/);
  for (const p of ['/data/r1.json', '/view/', '/media/r1']) assert.equal((await get(`${workOf(ui.pages)}${p}`)).status, 404, p); // the work origin has none of it
  assert.equal((await get(`${ui.pages}/work/.env`)).status, 404);
  assert.equal((await get(`${ui.pages}/data/r1.json`)).status, 200);
  const otherWork = tmp('other-work-'); fs.writeFileSync(path.join(otherWork, 'index.html'), '<title>Other</title>');
  const other = vindu.open({ results: memoryResults(tmp('other-')), dir: tmp('other-'), work: otherWork });
  assert.notEqual(new URL(other.pages).host, new URL(ui.pages).host);
  assert.equal((await get(`${other.pages}/data/r1.json`)).status, 404); // the other process has no r1, and cannot reach this one's
  assert.equal((await get(`${other.pages}/work/index.html`)).status, 200);
  other.close();
  assert.equal((await get(`${other.pages}/work/index.html`)).status, 404); // closed: gone
});

test('nothing leaves the page during a check: a navigation and a popup to another server never reach it', async () => {
  let hits = 0;
  const outside = http.createServer((_q, s) => { hits++; s.end('reached'); });
  await new Promise<void>(r => outside.listen(0, '127.0.0.1', r));
  const port = (outside.address() as { port: number }).port;
  write(work, { 'leave.html': `<!doctype html><title>Leave</title><script>window.open('http://127.0.0.1:${port}/popup'); setTimeout(() => { location.href = 'http://127.0.0.1:${port}/?leak=' + encodeURIComponent(document.title); }, 50);</script>` });
  const r = await json('check_page', { path: 'leave.html' });
  assert.equal(hits, 0);
  assert.equal(r.title, 'Leave'); // the page stayed where it was
  assert.ok(r.blocked.includes(`http://127.0.0.1:${port}/?leak=Leave (outside this page's origin)`), JSON.stringify(r.blocked));
  assert.ok(r.blocked.includes(`http://127.0.0.1:${port}/popup (outside this page's origin)`), JSON.stringify(r.blocked));
  outside.close();
});

test('no dotfile or dot folder through a link, no link out of the folder, no path out of it', async () => {
  assert.equal(fs.readFileSync(path.join(work, 'notes.txt'), 'utf8'), 'SECRET=never-served'); // the links are real
  for (const p of ['/work/notes.txt', '/work/gitlink/config', '/work/outside.txt', '/work/.env', '/work/..%2f..%2fetc%2fpasswd', '/work//etc/passwd', '/work/%2e%2e/%2e%2e/etc/passwd', '/work/game/..%5c..%5cindex.html'])
    assert.equal(await getRaw(ui.pages, p), 404, p);
  assert.equal(await getRaw(ui.pages, '/work/game/%2e%2e/index.html'), 200); // inside the folder, still served
});

test('a library the host adds is imported by name, offline; the tags go before anything the page runs', async () => {
  const t = await json('check_page', { path: 'tiny.html' });
  assert.equal(t.errors, undefined, JSON.stringify(t.errors)); assert.equal(t.text.starts, 'hello fjord');
  const h = await json('check_page', { path: 'noheader.html' }); // no <head>, a module script first, then a <header>
  assert.equal(h.errors, undefined, JSON.stringify(h.errors)); assert.equal(h.title, 'ok function');
  await assert.rejects(startVindu({ libraries: [{ ...tiny, name: 'three' }] }), /is not a plain name, or is taken/);
  await assert.rejects(startVindu({ libraries: [{ ...tiny, name: 'tiny2', imports: { echarts: 'tiny.js' } }] }), /"echarts" is already pinned/);
  await assert.rejects(startVindu({ libraries: [tiny, { ...tiny, name: 'tiny2' }] }), /"tiny" is already pinned/); // and across the host's own
});

test('the report stays small however much the page throws at it', async () => {
  const r = await json('check_page', { path: 'big.html' });
  const bytes = JSON.stringify(r).length;
  assert.ok(bytes < 12_000, `${bytes} bytes`);
  assert.equal(r.title.length, 120); assert.ok(r.text.characters >= 50_000, String(r.text.characters)); assert.equal(r.text.starts.length, 160);
  assert.equal(r.charts.length, 4); assert.equal(r.totals.charts, 30);
  assert.equal(r.charts[0].series.length, 4); assert.equal(r.charts[0].series_total, 10); assert.equal(r.charts[0].series[0].points, 200);
  assert.equal(r.errors.length, 10); assert.equal(r.totals.errors, 400); assert.ok(r.errors.every((e: string) => e.length <= 300)); // 100 different ones and one 300 times: every time is counted
  assert.equal(r.canvases.length, 8); assert.equal(r.totals.canvases, 61); // 30 charts, 30 plain canvases, one 3D scene
  assert.equal(r.text.headings.length, 8); assert.equal(r.totals.headings, 31);
  assert.ok(Object.keys(r.three[0].objects).every(k => k.length <= 40), JSON.stringify(r.three[0].objects).slice(0, 80)); // even a type name is cut
  assert.equal(r.failed_requests.length, 10); assert.equal(r.totals.failed_requests, 50); // each missing file once, its name kept
  assert.ok(r.failed_requests.every((f: string) => f.length <= 200 && /missing-w+…w+\d+\.png$/.test(f)), JSON.stringify(r.failed_requests.slice(0, 2)));
});

test('steps for games and slow pages: keys held as a game reads them, JavaScript run, promises awaited, long values cut and said', async () => {
  write(work, { 'orb/index.html': `<!doctype html><title>Orb</title><p id="y">0</p><script>
  // the orb moves while ArrowUp is held, read each frame, as games do: a press too short for a frame moves it not at all
  const held = new Set(); addEventListener('keydown', e => held.add(e.key)); addEventListener('keyup', e => held.delete(e.key));
  window.orb = { y: 0, speed: Number(new URLSearchParams(location.search).get('speed') ?? 1), at: location.hash,
    later: () => new Promise(r => setTimeout(() => r({ ready: true }), 200)), reset() { this.y = 0; return 'reset'; } };
  const tick = () => { if (held.has('ArrowUp')) orb.y += orb.speed; document.getElementById('y').textContent = orb.y; requestAnimationFrame(tick); }; tick();
</script>` });
  const tapped = await json('check_page', { path: 'orb/', steps: [{ press: 'ArrowUp', times: 40 }], read: ['js:orb.y'] });
  const held = await json('check_page', { path: 'orb/index.html?speed=2#go', steps: [{ hold: 'ArrowUp', ms: 400 }, { down: 'ArrowUp' }, { wait: 200 }, { up: 'ArrowUp' }, { js: 'orb.reset()' }, { hold: 'ArrowUp', ms: 300 }],
    read: ['js:orb.y', 'js:orb.speed', 'js:orb.at', 'js:orb.later()', 'js:"x".repeat(5000)', 'js:Object.keys(task.data)'], uses: ['r1'] });
  assert.ok(Number(tapped.read['js:orb.y']) < 10, `taps barely move it: ${tapped.read['js:orb.y']}`);
  assert.equal(held.page, 'work/orb/index.html?speed=2#go');
  assert.deepEqual(held.steps.map((x: { step: string; ok: boolean }) => [x.step, x.ok]), [['hold ArrowUp 400 ms', true], ['down ArrowUp', true], ['wait 200 ms', true], ['up ArrowUp', true], ['js orb.reset()', true], ['hold ArrowUp 300 ms', true]]);
  assert.equal(held.steps[4].note, 'reset');
  assert.ok(Number(held.read['js:orb.y']) > 10, `held, it moves: ${held.read['js:orb.y']}`); // more than taps; a CI runner draws fewer frames
  assert.equal(held.read['js:orb.speed'], '2'); assert.equal(held.read['js:orb.at'], '#go'); // the address's query and hash reach the page
  assert.equal(held.read['js:orb.later()'], '{"ready":true}'); // a promise, awaited
  assert.match(held.read['js:"x".repeat(5000)'], /^x{2000}… \(cut: 2000 of 5000 characters; read something narrower for the rest\)$/);
  assert.equal(held.read['js:Object.keys(task.data)'], '["r1"]'); // uses: the data a page panel would get
  const broken = await json('check_page', { path: 'orb/', steps: [{ js: 'nope.nothing' }, { js: 'new Promise(() => {})' }], read: [] });
  assert.deepEqual(broken.steps.map((x: { ok: boolean }) => x.ok), [false, false]);
  assert.match(broken.steps[0].note, /^error: .*nope/); assert.equal(broken.steps[1].note, 'error: still pending after 5 s');
  // a page written, checked before it is shown: a report, never a picture
  const r = await mcp.callTool({ name: 'check_page', arguments: { html: '<!doctype html><title>Draft</title><h1>Draft</h1>' } }) as { content: { type: string; text?: string }[] };
  assert.deepEqual(r.content.map(c => c.type), ['text']);
  const report = JSON.parse(r.content[0].text!);
  assert.equal(report.page, 'a page you wrote, not shown yet'); assert.equal(report.title, 'Draft');
  assert.match((await call('check_page', { path: 'orb/', html: '<p>x</p>' })).text, /give one of "path"/);
  assert.match((await call('check_page', { path: 'orb/', uses: ['r9'] })).text, /no result "r9" to give the page/);
});

test('live: a page reloads only for the files it loaded; a new file elsewhere does not, nor a file it fetched while it listens for changes', async () => {
  write(work, {
    'feed/index.html': '<!doctype html><title>Feed</title><p id="log">-</p><p id="said">-</p><script src="app.js"></script>',
    'feed/app.js': `document.getElementById('said').textContent = 'one';
const read = () => fetch('log.txt', { cache: 'no-store' }).then(r => r.text()).then(t => { document.getElementById('log').textContent = t; });
read(); task.on('change', paths => { if (paths.includes('feed/log.txt')) read(); });`,
    'feed/log.txt': 'started',
  });
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.goto(`${workOf(ui.pages)}/work/feed/`);
  await p.waitForFunction(() => document.getElementById('log')?.textContent === 'started');
  await p.evaluate(() => {
    const w = window as unknown as { kept: number; changes: string[]; task: { on(name: string, handler: (paths: string[]) => void): void } };
    w.kept = 7; w.changes = [];
    w.task.on('change', paths => w.changes.push(...paths));
  });
  write(work, { 'unrelated-test.html': '<!doctype html><title>A test page</title>' }); // the model writes a page of its own: not this page's
  await p.waitForFunction(() => (window as unknown as { changes?: string[] }).changes?.includes('unrelated-test.html'));
  assert.equal(await p.evaluate(() => (window as unknown as { kept?: number }).kept), 7);
  write(work, { 'feed/log.txt': 'started\nbuilt in 2.1 s' }); // what it fetched: it reads it again itself
  await p.waitForFunction(() => document.getElementById('log')?.textContent?.includes('built in 2.1 s'), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => (window as unknown as { kept?: number }).kept), 7);
  write(work, { 'feed/app.js': "document.getElementById('said').textContent = 'two';" }); // its own script: it reloads
  await p.waitForFunction(() => document.getElementById('said')?.textContent === 'two', null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => (window as unknown as { kept?: number }).kept), undefined);
  await ctx.close();
});

test('a 3D view with a post-processing pass: the scene with the most in it is described, and a frame counts every render', async () => {
  const html = `<!doctype html><html><head><title>Glow</title></head><body style="margin:0"><script type="module">
import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer(); renderer.setSize(300, 200); renderer.autoClear = false; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100); camera.position.z = 6;
for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); m.position.x = i * 1.5 - 1.5; m.name = 'node ' + i; scene.add(m); }
// a pass after the scene, as an effect composer draws one: a quad over the whole view, with a camera of its own
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2 })), flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
renderer.setAnimationLoop(() => { renderer.clear(); renderer.render(scene, camera); renderer.render(quad, flat); });
</script></body></html>`;
  // a slow machine draws fewer frames in a page's first moments: the page then runs a while longer before it is read
  let s = (await json('check_page', { html })).three[0];
  for (let n = 0; s.frames <= 3 && n < 5; n++) s = (await json('check_page', { html, steps: [{ wait: 1500 }] })).three[0];
  assert.deepEqual(s.objects, { Mesh: 3 }, JSON.stringify(s)); assert.deepEqual(s.named, ['node 0', 'node 1', 'node 2']); assert.equal(s.camera, 'PerspectiveCamera');
  assert.equal(s.renders_per_frame, 2); assert.equal(s.scenes, 2); assert.match(s.note, /post-processing/);
  assert.equal(s.draw_calls, 4); assert.equal(s.triangles, 3 * 12 + 2); // the boxes and the quad, in one frame
  assert.ok(s.frames > 3 && s.frames < 200, `frames, not renders: ${s.frames}`);
});

test('a page reads any result, hears each new one as it comes, and in a check what it sends is listed, not sent', async () => {
  const html = `<!doctype html><title>Live</title><button id="go">Send</button><p id="heard">none</p><script>
window.got = null; const heard = [];
task.get('r1').then(rows => { window.got = rows.length; });
task.get('r404').catch(e => { window.missing = e.message; });
task.on('result', r => { heard.push(r.id + ' ' + r.server + '.' + r.tool); document.getElementById('heard').textContent = heard.join(', '); });
document.getElementById('go').onclick = () => task.send({ picked: 'INV-2026-0241' }).then(r => { window.answer = r; });
try { task.on('click', () => {}); } catch (e) { window.wrong = e.message; }
</script>`;
  setTimeout(() => results.add({ tool: 'later', server: 'db', value: [{ n: 1 }] }), 1500);
  const r = await json('check_page', { html, steps: [{ click: '#go' }, { wait: 2500 }], read: ['js:window.got', 'js:window.missing', '#heard', 'js:window.answer', 'js:window.wrong'] });
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.equal(r.read['js:window.got'], '4'); assert.equal(r.read['js:window.missing'], 'no result "r404"');
  assert.match(r.read['#heard'], /^r\d+ db\.later$/); // added after the page loaded: heard as it came
  assert.equal(r.read['js:window.answer'], '{"sent":false,"checked":true}');
  assert.equal(r.read['js:window.wrong'], 'task.on takes "result" or "change"');
  assert.deepEqual(r.sent.values, ['{"picked":"INV-2026-0241"}']); assert.match(r.sent.note, /sends nothing/);
  assert.deepEqual(r.data_fetched, ['r1', 'r404']);
});

test('generated pages use the embedding policy for the current host and send selections to that host', async () => {
  let url = '';
  const parent = http.createServer((_req, res) => res.setHeader('content-type', 'text/html').end(
    `<script>onmessage = e => { if (e.data.vindu === 'select') document.title = e.data.items[0] };</script><iframe referrerpolicy="origin" src="${url}"></iframe>`));
  await new Promise<void>(resolve => parent.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(parent.address() as { port: number }).port}`;
  let allowed = [origin];
  const host = await startVindu({ pageParentOrigins: () => allowed });
  const taskDir = tmp('vindu-page-policy-');
  const session = host.open({ results: memoryResults(taskDir), dir: taskDir, work: taskDir });
  const ctx = await browser.newContext();
  try {
    write(taskDir, { 'index.html': '<button onclick="vindu.select([\'picked\'])">Select</button>' });
    url = workOf(session.pages) + '/work/index.html';
    assert.ok((await get(url)).headers['content-security-policy']?.includes('frame-ancestors ' + origin));
    const page = await ctx.newPage();
    await page.goto(origin);
    await page.frameLocator('iframe').getByText('Select').click();
    await page.waitForFunction(() => document.title === 'picked');
    allowed = [];
    assert.ok((await get(url)).headers['content-security-policy']?.includes("frame-ancestors 'none'"));
    await page.reload();
    assert.equal(await page.frameLocator('iframe').getByText('Select').count(), 0);
  } finally {
    await ctx.close(); session.close(); await host.close();
    await new Promise<void>(resolve => parent.close(() => resolve()));
    fs.rmSync(taskDir, { recursive: true, force: true });
  }
});

test('disk-backed media and work files handle HEAD, byte ranges, empty files and oversized HTML', async () => {
  const folder = tmp('vindu-page-files-');
  const store = memoryResults(folder);
  write(folder, { 'sample.txt': '0123456789', 'empty.txt': '', 'big.html': '' });
  fs.truncateSync(path.join(folder, 'big.html'), 8 * 1024 * 1024 + 1);
  const attachment = store.attach('sample.txt', 'text/plain', path.join(folder, 'sample.txt'));
  const session = vindu.open({ results: store, dir: folder, work: folder });
  try {
    for (const resource of ['/work/sample.txt', '/work/sample.txt?raw=1', '/media/' + attachment.id]) {
      const url = session.pages + resource;
      const head = await get(url, { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(head.headers['content-length'], '10'); assert.equal(head.body, '');
      const partial = await get(url, { headers: { range: 'bytes=3-6' } });
      assert.equal(partial.status, 206); assert.equal(partial.headers['content-range'], 'bytes 3-6/10'); assert.equal(partial.body, '3456');
      assert.equal((await get(url, { headers: { range: 'bytes=-2' } })).body, '89');
      assert.equal((await get(url, { headers: { range: 'bytes=6-' } })).body, '6789');
      assert.equal((await get(url, { headers: { range: 'bytes=10-' } })).status, 416);
    }
    assert.equal((await get(session.pages + '/work/empty.txt')).body, '');
    assert.equal((await get(workOf(session.pages) + '/work/big.html')).status, 413); // as a page: on the work origin
    assert.equal((await get(session.pages + '/work/big.html')).status, 200); // as a file, never run
  } finally { session.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
