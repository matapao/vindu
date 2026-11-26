// Page panels in a real headless Chromium, as the host serves them: a library it adds, a report that stays small, steps
// for games and slow pages, live reloads, post-processing in 3D, results heard as they come, the embedding policy and
// what the page host serves from disk.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startVindu, memoryResults } from '../src/index.js';
import { get } from './helpers.js';
import { tmp, workOf, write, work, tiny, results, browser, vindu, ui, mcp, call, json } from './pages-session.js';

test('a library the host adds is imported by name, offline; the tags go before anything the page runs', async () => {
  const t = await json('check_page', { path: 'tiny.html' });
  assert.equal(t.errors, undefined, JSON.stringify(t.errors));
  assert.equal(t.text.starts, 'hello fjord');
  const h = await json('check_page', { path: 'noheader.html' }); // no <head>, a module script first, then a <header>
  assert.equal(h.errors, undefined, JSON.stringify(h.errors));
  assert.equal(h.title, 'ok function');
  await assert.rejects(startVindu({ libraries: [{ ...tiny, name: 'three' }] }), /is not a plain name, or is taken/);
  await assert.rejects(
    startVindu({ libraries: [{ ...tiny, name: 'tiny2', imports: { echarts: 'tiny.js' } }] }),
    /"echarts" is already pinned/,
  );
  await assert.rejects(startVindu({ libraries: [tiny, { ...tiny, name: 'tiny2' }] }), /"tiny" is already pinned/); // and across the host's own
});

test('the report stays small however much the page throws at it', async () => {
  const r = await json('check_page', { path: 'big.html' });
  const bytes = JSON.stringify(r).length;
  assert.ok(bytes < 12_000, `${bytes} bytes`);
  assert.equal(r.title.length, 120);
  assert.ok(r.text.characters >= 50_000, String(r.text.characters));
  assert.equal(r.text.starts.length, 160);
  assert.equal(r.charts.length, 4);
  assert.equal(r.totals.charts, 30);
  assert.equal(r.charts[0].series.length, 4);
  assert.equal(r.charts[0].series_total, 10);
  assert.equal(r.charts[0].series[0].points, 200);
  assert.equal(r.errors.length, 10);
  assert.equal(r.totals.errors, 400);
  assert.ok(r.errors.every((e: string) => e.length <= 300)); // 100 different ones and one 300 times: every time is counted
  assert.equal(r.canvases.length, 8);
  assert.equal(r.totals.canvases, 61); // 30 charts, 30 plain canvases, one 3D scene
  assert.equal(r.text.headings.length, 8);
  assert.equal(r.totals.headings, 31);
  assert.ok(
    Object.keys(r.three[0].objects).every((k) => k.length <= 40),
    JSON.stringify(r.three[0].objects).slice(0, 80),
  ); // even a type name is cut
  assert.equal(r.failed_requests.length, 10);
  assert.equal(r.totals.failed_requests, 50); // each missing file once, its name kept
  assert.ok(
    r.failed_requests.every((f: string) => f.length <= 200 && /missing-w+…w+\d+\.png$/.test(f)),
    JSON.stringify(r.failed_requests.slice(0, 2)),
  );
});

test('steps for games and slow pages: keys held as a game reads them, JavaScript run, promises awaited, long values cut and said', async () => {
  write(work, {
    'orb/index.html': `<!doctype html><title>Orb</title><p id="y">0</p><script>
  // the orb moves while ArrowUp is held, read each frame, as games do: a press too short for a frame moves it not at all
  const held = new Set(); addEventListener('keydown', e => held.add(e.key)); addEventListener('keyup', e => held.delete(e.key));
  window.orb = { y: 0, speed: Number(new URLSearchParams(location.search).get('speed') ?? 1), at: location.hash,
    later: () => new Promise(r => setTimeout(() => r({ ready: true }), 200)), reset() { this.y = 0; return 'reset'; } };
  const tick = () => { if (held.has('ArrowUp')) orb.y += orb.speed; document.getElementById('y').textContent = orb.y; requestAnimationFrame(tick); }; tick();
</script>`,
  });
  const tapped = await json('check_page', {
    path: 'orb/',
    steps: [{ press: 'ArrowUp', times: 40 }],
    read: ['js:orb.y'],
  });
  const held = await json('check_page', {
    path: 'orb/index.html?speed=2#go',
    steps: [
      { hold: 'ArrowUp', ms: 400 },
      { down: 'ArrowUp' },
      { wait: 200 },
      { up: 'ArrowUp' },
      { js: 'orb.reset()' },
      { hold: 'ArrowUp', ms: 300 },
    ],
    read: [
      'js:orb.y',
      'js:orb.speed',
      'js:orb.at',
      'js:orb.later()',
      'js:"x".repeat(5000)',
      'js:Object.keys(task.data)',
    ],
    uses: ['r1'],
  });
  assert.ok(Number(tapped.read['js:orb.y']) < 10, `taps barely move it: ${tapped.read['js:orb.y']}`);
  assert.equal(held.page, 'work/orb/index.html?speed=2#go');
  assert.deepEqual(
    held.steps.map((x: { step: string; ok: boolean }) => [x.step, x.ok]),
    [
      ['hold ArrowUp 400 ms', true],
      ['down ArrowUp', true],
      ['wait 200 ms', true],
      ['up ArrowUp', true],
      ['js orb.reset()', true],
      ['hold ArrowUp 300 ms', true],
    ],
  );
  assert.equal(held.steps[4].note, 'reset');
  assert.ok(Number(held.read['js:orb.y']) > 10, `held, it moves: ${held.read['js:orb.y']}`); // more than taps; a CI runner draws fewer frames
  assert.equal(held.read['js:orb.speed'], '2');
  assert.equal(held.read['js:orb.at'], '#go'); // the address's query and hash reach the page
  assert.equal(held.read['js:orb.later()'], '{"ready":true}'); // a promise, awaited
  assert.match(
    held.read['js:"x".repeat(5000)'],
    /^x{2000}… \(cut: 2000 of 5000 characters; read something narrower for the rest\)$/,
  );
  assert.equal(held.read['js:Object.keys(task.data)'], '["r1"]'); // uses: the data a page panel would get
  const broken = await json('check_page', {
    path: 'orb/',
    steps: [{ js: 'nope.nothing' }, { js: 'new Promise(() => {})' }],
    read: [],
  });
  assert.deepEqual(
    broken.steps.map((x: { ok: boolean }) => x.ok),
    [false, false],
  );
  assert.match(broken.steps[0].note, /^error: .*nope/);
  assert.equal(broken.steps[1].note, 'error: still pending after 5 s');
  // a page written, checked before it is shown: a report, never a picture
  const r = (await mcp.callTool({
    name: 'check_page',
    arguments: { html: '<!doctype html><title>Draft</title><h1>Draft</h1>' },
  })) as { content: { type: string; text?: string }[] };
  assert.deepEqual(
    r.content.map((c) => c.type),
    ['text'],
  );
  const report = JSON.parse(r.content[0].text!);
  assert.equal(report.page, 'a page you wrote, not shown yet');
  assert.equal(report.title, 'Draft');
  assert.match((await call('check_page', { path: 'orb/', html: '<p>x</p>' })).text, /give one of "path"/);
  assert.match((await call('check_page', { path: 'orb/', uses: ['r9'] })).text, /no result "r9" to give the page/);
});

test('live: a page reloads only for the files it loaded; a new file elsewhere does not, nor a file it fetched while it listens for changes', async () => {
  write(work, {
    'feed/index.html':
      '<!doctype html><title>Feed</title><p id="log">-</p><p id="said">-</p><script src="app.js"></script>',
    'feed/app.js': `document.getElementById('said').textContent = 'one';
const read = () => fetch('log.txt', { cache: 'no-store' }).then(r => r.text()).then(t => { document.getElementById('log').textContent = t; });
read(); task.on('change', paths => { if (paths.includes('feed/log.txt')) read(); });`,
    'feed/log.txt': 'started',
  });
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${workOf(ui.pages)}/work/feed/`);
  await p.waitForFunction(() => document.getElementById('log')?.textContent === 'started');
  await p.evaluate(() => {
    const w = window as unknown as {
      kept: number;
      changes: string[];
      task: { on(name: string, handler: (paths: string[]) => void): void };
    };
    w.kept = 7;
    w.changes = [];
    w.task.on('change', (paths) => w.changes.push(...paths));
  });
  write(work, { 'unrelated-test.html': '<!doctype html><title>A test page</title>' }); // the model writes a page of its own: not this page's
  await p.waitForFunction(() => (window as unknown as { changes?: string[] }).changes?.includes('unrelated-test.html'));
  assert.equal(await p.evaluate(() => (window as unknown as { kept?: number }).kept), 7);
  write(work, { 'feed/log.txt': 'started\nbuilt in 2.1 s' }); // what it fetched: it reads it again itself
  await p.waitForFunction(() => document.getElementById('log')?.textContent?.includes('built in 2.1 s'), null, {
    timeout: 5000,
  });
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
  for (let n = 0; s.frames <= 3 && n < 5; n++)
    s = (await json('check_page', { html, steps: [{ wait: 1500 }] })).three[0];
  assert.deepEqual(s.objects, { Mesh: 3 }, JSON.stringify(s));
  assert.deepEqual(s.named, ['node 0', 'node 1', 'node 2']);
  assert.equal(s.camera, 'PerspectiveCamera');
  assert.equal(s.renders_per_frame, 2);
  assert.equal(s.scenes, 2);
  assert.match(s.note, /post-processing/);
  assert.equal(s.draw_calls, 4);
  assert.equal(s.triangles, 3 * 12 + 2); // the boxes and the quad, in one frame
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
  const r = await json('check_page', {
    html,
    steps: [{ click: '#go' }, { wait: 2500 }],
    read: ['js:window.got', 'js:window.missing', '#heard', 'js:window.answer', 'js:window.wrong'],
  });
  assert.equal(r.errors, undefined, JSON.stringify(r.errors));
  assert.equal(r.read['js:window.got'], '4');
  assert.equal(r.read['js:window.missing'], 'no result "r404"');
  assert.match(r.read['#heard'], /^r\d+ db\.later$/); // added after the page loaded: heard as it came
  assert.equal(r.read['js:window.answer'], '{"sent":false,"checked":true}');
  assert.equal(r.read['js:window.wrong'], 'task.on takes "result" or "change"');
  assert.deepEqual(r.sent.values, ['{"picked":"INV-2026-0241"}']);
  assert.match(r.sent.note, /sends nothing/);
  assert.deepEqual(r.data_fetched, ['r1', 'r404']);
});

test('generated pages use the embedding policy for the current host and send selections to that host', async () => {
  let url = '';
  const parent = http.createServer((_req, res) =>
    res
      .setHeader('content-type', 'text/html')
      .end(
        `<script>onmessage = e => { if (e.data.vindu === 'select') document.title = e.data.items[0] };</script><iframe referrerpolicy="origin" src="${url}"></iframe>`,
      ),
  );
  await new Promise<void>((resolve) => parent.listen(0, '127.0.0.1', resolve));
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
    await ctx.close();
    session.close();
    await host.close();
    await new Promise<void>((resolve) => parent.close(() => resolve()));
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
      assert.equal(head.status, 200);
      assert.equal(head.headers['content-length'], '10');
      assert.equal(head.body, '');
      const partial = await get(url, { headers: { range: 'bytes=3-6' } });
      assert.equal(partial.status, 206);
      assert.equal(partial.headers['content-range'], 'bytes 3-6/10');
      assert.equal(partial.body, '3456');
      assert.equal((await get(url, { headers: { range: 'bytes=-2' } })).body, '89');
      assert.equal((await get(url, { headers: { range: 'bytes=6-' } })).body, '6789');
      assert.equal((await get(url, { headers: { range: 'bytes=10-' } })).status, 416);
    }
    assert.equal((await get(session.pages + '/work/empty.txt')).body, '');
    assert.equal((await get(workOf(session.pages) + '/work/big.html')).status, 413); // as a page: on the work origin
    assert.equal((await get(session.pages + '/work/big.html')).status, 200); // as a file, never run
  } finally {
    session.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
