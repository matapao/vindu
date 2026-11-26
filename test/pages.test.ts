// Page panels in a real headless Chromium: a website the process builds (live), a game tested with steps,
// pages that break or reach for the network, and views written with ECharts, Chart.js and three.js over process data.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { memoryResults } from '../src/index.js';
import { get, getRaw, sleep } from './helpers.js';
import { tmp, workOf, write, invoices, work, browser, vindu, ui, call, json, page } from './pages-session.js';

test('a website the task builds: shown live from the working folder, and the account says how it loaded', async () => {
  const a = await json('show_view', {
    name: 'site',
    title: 'Fjord Cabins',
    panels: [{ card: 'page', path: 'index.html', title: 'Site' }],
  });
  assert.equal(a.panels[0].from, 'work/index.html');
  const r = page(a);
  assert.equal(r.loaded, true);
  assert.equal(r.title, 'Fjord Cabins');
  assert.equal(r.errors, undefined);
  assert.equal(r.failed_requests, undefined);
  assert.equal(r.blocked, undefined);
  assert.deepEqual(r.text.headings, ['Fjord Cabins']);
  assert.match(r.text.starts, /Open all year/); // the script ran
  assert.deepEqual(r.phone, { width: 390, overflow_px: 0 });
  const wide = await json('check_page', { path: 'wide.html' });
  assert.ok(wide.phone.overflow_px > 700, JSON.stringify(wide.phone)); // a fixed 1200 px layout overflows a phone
});

test('live: a change to the page reloads it; a change to CSS alone swaps the styles and keeps the page state', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${workOf(ui.pages)}/work/index.html`);
  await p.waitForFunction(() => document.getElementById('status')?.textContent === 'Open all year');
  assert.equal(
    await p.evaluate(() => {
      const page = window as Window & { vindu?: { select?: unknown; ask?: unknown } };
      return typeof page.vindu?.select === 'function' && typeof page.vindu.ask === 'function';
    }),
    true,
    'generated pages have the Vindu interaction API',
  );
  fs.writeFileSync(path.join(work, 'app.js'), 'document.getElementById("status").textContent = "Closed for winter";');
  await p.waitForFunction(() => document.getElementById('status')?.textContent === 'Closed for winter', null, {
    timeout: 5000,
  });
  await p.evaluate(() => {
    (window as unknown as { kept: number }).kept = 42;
  });
  await sleep(300);
  fs.writeFileSync(
    path.join(work, 'style.css'),
    'body { font-family: sans-serif; margin: 0; background: rgb(10, 20, 30); }',
  );
  await p.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(10, 20, 30)', null, {
    timeout: 5000,
  });
  assert.equal(await p.evaluate(() => (window as unknown as { kept?: number }).kept), 42); // not reloaded
  await ctx.close();
});

test('accessibility: the page is audited (axe-core, WCAG 2 A and AA): each rule it fails, how bad, and where', async () => {
  const r = await json('check_page', { path: 'a11y.html' });
  assert.equal(r.accessibility.engine, 'axe-core 4.14.0');
  const rules = Object.fromEntries(r.accessibility.violations.map((v: { rule: string }) => [v.rule, v]));
  assert.deepEqual(Object.keys(rules).sort(), ['button-name', 'color-contrast', 'image-alt']);
  assert.deepEqual(
    [rules['image-alt'].impact, rules['image-alt'].elements, rules['image-alt'].at],
    ['critical', 1, ['img']],
  );
  assert.equal(rules['color-contrast'].impact, 'serious');
  assert.equal(r.accessibility.violations[0].impact, 'critical'); // the worst first
  assert.ok(r.accessibility.passed > 5);
  const off = await json('check_page', { path: 'a11y.html', accessibility: false });
  assert.equal(off.accessibility, undefined);
});

test('a game, tested with steps: keys and clicks go in, values come out', async () => {
  const r = await json('check_page', {
    path: 'game/',
    steps: [
      { click: '#start' },
      { press: 'ArrowRight', times: 5 },
      { press: 'ArrowDown', times: 5 },
      { click: '#missing' },
    ],
    read: ['#score', 'js:game', 'js:game.nothere'],
  });
  assert.equal(r.page, 'work/game/index.html');
  assert.deepEqual(
    r.steps.map((s: { ok: boolean }) => s.ok),
    [true, true, true, false],
  );
  assert.match(r.steps[3].note, /#missing/);
  assert.equal(r.read['#score'], '1');
  assert.deepEqual(JSON.parse(r.read['js:game']), { x: 5, y: 5, running: true, score: 1 });
  assert.equal(r.read['js:game.nothere'], null);
  assert.deepEqual(r.canvases, [{ size: '200×200', context: '2d', painted: '100%', colors: 2 }]); // the board, and the player now covering the target
});

test('steps can run at phone size; a click on something hidden at that size says so', async () => {
  const desk = await json('check_page', { path: 'menu.html', steps: [{ click: '#toggle' }] });
  assert.equal(desk.steps[0].ok, false);
  assert.equal(desk.steps[0].note, '#toggle is there but not visible 1024 px wide');
  const nav = 'js:getComputedStyle(document.getElementById("nav")).display';
  const phone = await json('check_page', {
    path: 'menu.html',
    size: 'phone',
    steps: [{ click: '#toggle' }, { type: 'Kari', into: '#name' }],
    read: [nav, '#nav', '#name'],
  });
  assert.equal(phone.size, '390×844');
  assert.deepEqual(
    phone.steps.map((s: { ok: boolean }) => s.ok),
    [true, true],
  );
  assert.equal(phone.read[nav], 'block'); // the menu opened
  assert.equal(phone.read['#nav'], 'Home Book');
  assert.equal(phone.read['#name'], 'Kari'); // text as read, a field's value
  assert.deepEqual(phone.phone, { width: 390, overflow_px: 0 });
});

test('a page that breaks or reaches for the network: errors, blocked and failed requests, and what is pinned instead', async () => {
  const r = await json('check_page', { path: 'broken/index.html' });
  assert.ok(
    r.errors.some((e: string) => e.endsWith('undefinedFunction is not defined (index.html:2)')),
    JSON.stringify(r.errors),
  ); // the page's own line numbers
  assert.ok(
    r.errors.some((e: string) => /resolve module specifier "d3"/.test(e)),
    JSON.stringify(r.errors),
  );
  assert.ok(
    r.blocked.some((b: string) => b.startsWith('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js')),
    JSON.stringify(r.blocked),
  );
  assert.ok(
    r.blocked.some((b: string) => b.startsWith('https://api.example.com/rates (connect-src)')),
    JSON.stringify(r.blocked),
  );
  assert.deepEqual(r.failed_requests, ['/work/broken/missing.png']);
  assert.ok(
    r.pinned.some((l: string) => /^three, three\/addons\/…: three 0\.187\.0$/.test(l)),
    JSON.stringify(r.pinned),
  );
  assert.ok(r.pinned.includes('tiny: tiny 1.0.0'), JSON.stringify(r.pinned)); // and what the host added
});

test("a view written with ECharts over the task's data: the account says what it plotted, and the numbers come from the record", async () => {
  const html = `<!doctype html><html><head><title>Overdue</title></head><body><h2>Overdue per customer</h2><div id="c" style="width:600px;height:300px"></div><p id="total"></p>
<script type="module">
import * as echarts from 'echarts';
const rows = task.data.r1.filter(r => r.status === 'overdue');
const per = task.group(rows, 'customer', 'sum(amount_nok)');
echarts.init(document.getElementById('c')).setOption({ animation: false, xAxis: { type: 'category', data: per.map(p => p.customer) }, yAxis: { type: 'value' }, series: [{ type: 'bar', name: 'Overdue', data: per.map(p => p.sum_amount_nok) }] });
document.getElementById('total').textContent = 'Total ' + task.value(rows, 'sum(amount_nok)').toLocaleString('en-GB') + ' NOK';
</script></body></html>`;
  const a = await json('show_view', {
    name: 'overdue',
    title: 'Overdue',
    panels: [{ card: 'page', title: 'Per customer', html, uses: ['r1'] }],
  });
  assert.deepEqual(a.panels[0].uses, ['r1']);
  const r = page(a);
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.deepEqual(r.libraries, ['echarts 6.1.0']);
  assert.deepEqual(r.charts, [
    {
      library: 'echarts',
      type: 'bar',
      labels: ['Vik Data', 'Strand Bygg'],
      series: [{ name: 'Overdue', points: 2, values: [31050, 71140] }],
    },
  ]);
  assert.match(r.text.starts, /Total 102,190 NOK/);
  assert.equal(r.numbers_not_in_any_result, undefined); // 71,140 and 102,190 were computed by task.group and task.value
  const typed = page(
    await json('show_view', {
      name: 'typed',
      title: 'Typed',
      panels: [{ card: 'page', html: '<p>Expected 99999 NOK, of which 31050 from Vik Data</p>', uses: ['r1'] }],
    }),
  );
  assert.deepEqual(typed.numbers_not_in_any_result, [99999]); // 31050 is in r1; 99999 is in no result
});

test('a view written with Chart.js, reading its data over fetch: the values plotted and the results fetched', async () => {
  const html = `<!doctype html><html><head><title>Amounts</title></head><body><canvas id="c" width="500" height="250"></canvas>
<script type="module">
import Chart from 'chart.js/auto';
const rows = await (await fetch('/data/r1.json')).json();
new Chart(document.getElementById('c'), { type: 'line', data: { labels: rows.map(r => r.id), datasets: [{ label: 'NOK', data: rows.map(r => r.amount_nok) }] }, options: { animation: false, responsive: false } });
</script></body></html>`;
  const r = page(
    await json('show_view', { name: 'amounts', title: 'Amounts', panels: [{ card: 'page', html, uses: ['r1'] }] }),
  );
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.deepEqual(r.libraries, ['chart.js 4.6.1']);
  assert.equal(r.charts[0].library, 'chart.js');
  assert.equal(r.charts[0].type, 'line');
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
  const r = page(
    await json('show_view', {
      name: 'bars3d',
      title: 'Invoices in 3D',
      panels: [{ card: 'page', html, uses: ['r1'], height: 320 }],
    }),
  );
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.deepEqual(r.libraries, ['three 0.187.0']);
  // a slow machine draws fewer frames before the first look: the page is looked at again until its loop has drawn more
  let s = r.three[0];
  for (let n = 0; s.frames <= 3 && n < 10; n++) s = (await json('check_page', { panel: 'bars3d' })).three[0];
  assert.ok(s.frames > 3, JSON.stringify(s));
  assert.equal(s.draw_calls, 4);
  assert.equal(s.triangles, 48);
  assert.deepEqual(s.objects, { AmbientLight: 1, Mesh: 4 });
  assert.deepEqual(
    s.named,
    invoices.map((i) => i.id),
  );
  assert.equal(s.camera, 'PerspectiveCamera');
  assert.equal(r.canvases[0].context, 'webgl2');
  assert.ok(r.canvases[0].draw_calls > 0);
  assert.equal(r.data_fetched, undefined); // the Chart.js page before it fetched r1; this page did not
});

test('refusals for pages say what to send instead', async () => {
  const both = await call('show_view', {
    name: 'x',
    title: 'x',
    panels: [{ card: 'page', path: 'index.html', html: '<p>x</p>' }],
  });
  assert.match(both.text, /"path" .* or "html" .*, not both/);
  const none = await call('show_view', { name: 'x', title: 'x', panels: [{ card: 'page', path: 'shop.html' }] });
  assert.match(
    none.text,
    /no page "shop.html" in the working folder; pages there: a11y.html, about.html, big.html, broken\/index.html, game\/index.html, index.html, menu.html, noheader.html, tiny.html, wide.html/,
  );
  const data = await call('show_view', {
    name: 'x',
    title: 'x',
    panels: [{ card: 'page', html: '<p>x</p>', uses: ['r7'] }],
  });
  assert.match(data.text, /no result "r7" to give the page/);
  const unseen = await call('check_page', { panel: 'nope' });
  assert.equal(unseen.ok, false);
  assert.match(unseen.text, /no page panel "nope" has been shown; shown: .*per-customer \(in view overdue\)/);
  const byView = await json('check_page', { panel: 'overdue' }); // the view's name, as a model may well say it
  assert.equal(byView.loaded, true);
  assert.equal(byView.page, 'a page you wrote');
});

test("each task is its own origin: no dotfiles, no way out of the folder, no other task's data", async () => {
  assert.equal(
    (await get(`${ui.pages}/work/index.html`)).headers['content-security-policy']?.includes("connect-src 'self'"),
    true,
  );
  assert.match(String((await get(`${ui.pages}/work/index.html`)).headers['content-security-policy']), /; sandbox$/); // a file of the folder never runs beside the data
  assert.doesNotMatch(
    String((await get(`${workOf(ui.pages)}/work/index.html`)).headers['content-security-policy']),
    /sandbox/,
  );
  for (const p of ['/data/r1.json', '/view/', '/media/r1'])
    assert.equal((await get(`${workOf(ui.pages)}${p}`)).status, 404, p); // the work origin has none of it
  assert.equal((await get(`${ui.pages}/work/.env`)).status, 404);
  assert.equal((await get(`${ui.pages}/data/r1.json`)).status, 200);
  const otherWork = tmp('other-work-');
  fs.writeFileSync(path.join(otherWork, 'index.html'), '<title>Other</title>');
  const other = vindu.open({ results: memoryResults(tmp('other-')), dir: tmp('other-'), work: otherWork });
  assert.notEqual(new URL(other.pages).host, new URL(ui.pages).host);
  assert.equal((await get(`${other.pages}/data/r1.json`)).status, 404); // the other process has no r1, and cannot reach this one's
  assert.equal((await get(`${other.pages}/work/index.html`)).status, 200);
  other.close();
  assert.equal((await get(`${other.pages}/work/index.html`)).status, 404); // closed: gone
});

test('nothing leaves the page during a check: a navigation and a popup to another server never reach it', async () => {
  let hits = 0;
  const outside = http.createServer((_q, s) => {
    hits++;
    s.end('reached');
  });
  await new Promise<void>((r) => outside.listen(0, '127.0.0.1', r));
  const port = (outside.address() as { port: number }).port;
  write(work, {
    'leave.html': `<!doctype html><title>Leave</title><script>window.open('http://127.0.0.1:${port}/popup'); setTimeout(() => { location.href = 'http://127.0.0.1:${port}/?leak=' + encodeURIComponent(document.title); }, 50);</script>`,
  });
  const r = await json('check_page', { path: 'leave.html' });
  assert.equal(hits, 0);
  assert.equal(r.title, 'Leave'); // the page stayed where it was
  assert.ok(
    r.blocked.includes(`http://127.0.0.1:${port}/?leak=Leave (outside this page's origin)`),
    JSON.stringify(r.blocked),
  );
  assert.ok(
    r.blocked.includes(`http://127.0.0.1:${port}/popup (outside this page's origin)`),
    JSON.stringify(r.blocked),
  );
  outside.close();
});

test('no dotfile or dot folder through a link, no link out of the folder, no path out of it', async () => {
  assert.equal(fs.readFileSync(path.join(work, 'notes.txt'), 'utf8'), 'SECRET=never-served'); // the links are real
  for (const p of [
    '/work/notes.txt',
    '/work/gitlink/config',
    '/work/outside.txt',
    '/work/.env',
    '/work/..%2f..%2fetc%2fpasswd',
    '/work//etc/passwd',
    '/work/%2e%2e/%2e%2e/etc/passwd',
    '/work/game/..%5c..%5cindex.html',
  ])
    assert.equal(await getRaw(ui.pages, p), 404, p);
  assert.equal(await getRaw(ui.pages, '/work/game/%2e%2e/index.html'), 200); // inside the folder, still served
});
