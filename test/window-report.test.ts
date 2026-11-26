// How a page runs in the person's window, as that window says it (page-report.ts, pages.ts, the shell's renderer): the
// page itself only, kinds, places, counts and sizes, never its text, values or messages; and the model gets it with
// the view's account, and from check_page, where the host has no browser to check pages in.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, type Shown, type ShellState } from '../src/index.js';
import { windowReport } from '../src/page-report.js';
import { chromium, mcpClient } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('a window report keeps the page itself: kinds, places, counts and sizes; text, values, messages and addresses are dropped', () => {
  const posted = {
    loaded: true,
    ms: 412.6,
    visible: true,
    width: 800,
    height: 600,
    overflow: { x: 0, y: 120, text: 'x' },
    elements: 37,
    errors: 3,
    warnings: 1,
    dialogs: 0,
    charts: 1,
    places: [
      { kind: 'ReferenceError', at: 'p_demo.html:12' },
      { kind: 'console.error', at: 'p_demo.html:20' },
      { kind: 'Error: Ola Nordmann owes 31050', at: 'x' },
      { kind: 'unhandled rejection: TypeError', at: 'a place with spaces:3' },
    ],
    failed: [
      { tag: 'script', in: 'lib', path: '/lib/three/addons/controls/OrbitControl.js' },
      { tag: 'img', in: 'work', path: '/work/photos/ola.png', ext: 'png' },
      { tag: 'img', in: 'somewhere', ext: 'png' },
    ],
    blocked: [
      { directive: 'connect-src', what: 'elsewhere', url: 'https://evil.example/?d=secret' },
      { directive: 'connect-src', what: 'https://evil.example' },
    ],
    canvases: [
      { context: 'webgl2', width: 800, height: 600, drawn: true, pixels: [1, 2, 3] },
      { context: 'paint', width: 1, height: 1 },
    ],
    three: [
      {
        frames: 60,
        draw_calls: 5,
        triangles: 3456,
        objects: { Mesh: 4, 'Ola Nordmann': 1, GridHelper: 1 },
        named: ['secret'],
      },
    ],
    libraries: ['three 0.170.0', 'secret value here'],
    text: 'Ola Nordmann, 31050 NOK',
    values: [31050],
    typed: 'my password',
  };
  const r = windowReport(posted)!;
  assert.deepEqual(r, {
    by: "the person's window",
    loaded: true,
    ms: 413,
    visible: true,
    width: 800,
    height: 600,
    overflow: { x: 0, y: 120 },
    elements: 37,
    errors: 3,
    places: [
      { kind: 'ReferenceError', at: 'p_demo.html:12' },
      { kind: 'console.error', at: 'p_demo.html:20' },
      { kind: 'unhandled rejection: TypeError' },
    ],
    warnings: 1,
    failed: [
      { tag: 'script', in: 'lib', path: '/lib/three/addons/controls/OrbitControl.js' },
      { tag: 'img', in: 'work', ext: 'png' },
    ],
    blocked: [{ directive: 'connect-src', what: 'elsewhere' }],
    canvases: [{ context: 'webgl2', width: 800, height: 600, drawn: true }],
    three: [{ frames: 60, draw_calls: 5, triangles: 3456, objects: { Mesh: 4, GridHelper: 1 } }],
    charts: 1,
    libraries: ['three 0.170.0'],
    dialogs: 0,
  });
  assert.doesNotMatch(JSON.stringify(r), /Ola|31050|secret|password|evil/);
  for (const not of ['a string', null, [1, 2], {}]) assert.equal(windowReport(not), undefined);
});

test('in Chromium: a page in the window tells how it runs there, the page itself only, and the model gets it with no browser of its own', async () => {
  const vindu = await startVindu({ verifyMs: 1500 }); // no page driver: nothing on this side checks pages
  const dir = tmp('wrep-'),
    results = memoryResults(dir);
  const shown: Shown[] = [];
  const st: { s?: ShellState } = {};
  const ui = vindu.open(
    { results, dir },
    {
      onView: (v) => shown.push(v),
      onState: (s) => {
        st.s = s;
      },
    },
  );
  const c = await mcpClient(ui.url);
  const app = http.createServer((req, res) => {
    const f =
      req.url === '/app.bundle.js'
        ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js')
        : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  let pump: ReturnType<typeof setInterval> | undefined;
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
    await page.evaluate(() => window.app.shell('light'));
    // the host's part: what is shown goes to the window, and what the window says goes to the UI server
    let drawn = 0,
      state: ShellState | undefined,
      busy = false;
    pump = setInterval(() => {
      if (busy) return;
      busy = true;
      void (async () => {
        for (const v of shown.slice(drawn)) if (!v.ask) await page.evaluate((x: Shown) => window.app.view(x), v);
        drawn = shown.length;
        if (st.s && st.s !== state) {
          state = st.s;
          await page.evaluate((s: ShellState) => window.app.state(s), state);
        }
        for (const e of (await page.evaluate(() => window.app.events())) as Record<string, unknown>[]) ui.event(e);
      })()
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, 50);
    // a page the model writes: a name and a sum on it, a canvas it paints, an error it logs with that text, one it throws
    const html = [
      '<!doctype html><html><head><title>Demo</title></head><body>',
      '<p id="who">Ola Nordmann owes 31050 NOK</p>',
      '<canvas id="c" width="120" height="80"></canvas>',
      '<script>',
      "const g = document.getElementById('c').getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 60, 40);",
      "console.error('the secret is', document.getElementById('who').textContent);",
      'setTimeout(() => { notDefinedAnywhere(); }, 0);',
      '</script></body></html>',
    ].join('\n');
    const acc = await c.json('show_view', {
      name: 'demo',
      title: 'Demo',
      panels: [{ id: 'pg', card: 'page', html, height: 300 }],
    });
    const w = acc.panels[0].window;
    assert.equal(acc.panels[0].page, 'not checked: this host has no page driver');
    assert.equal(w?.by, "the person's window", JSON.stringify(acc.panels[0]));
    assert.equal(w.loaded, true);
    assert.ok(w.errors >= 2, JSON.stringify(w));
    assert.ok(
      w.places.some(
        (p: { kind: string; at?: string }) => p.kind === 'console.error' && (p.at ?? '').endsWith('.html:6'),
      ),
      JSON.stringify(w.places),
    );
    assert.ok(
      w.places.some(
        (p: { kind: string; at?: string }) => p.kind === 'ReferenceError' && (p.at ?? '').endsWith('.html:7'),
      ),
      JSON.stringify(w.places),
    );
    assert.equal(w.canvases.length, 1);
    assert.equal(w.canvases[0].context, '2d');
    assert.equal(w.canvases[0].drawn, true);
    assert.ok(w.canvases[0].painted > 15 && w.canvases[0].painted < 35, String(w.canvases[0].painted));
    assert.doesNotMatch(JSON.stringify(w), /Ola|31050|secret/); // what the page holds stays in the window
    // check_page on that panel, by its id or its view's name: the window's word, and no steps done in the person's window
    const k = await c.json('check_page', { panel: 'demo', read: ['#who'] });
    assert.equal(k.checked, 'not checked: this host has no page driver');
    assert.equal(k.window.loaded, true);
    assert.match(k.steps, /^not done/);
    assert.doesNotMatch(JSON.stringify(k), /Ola|31050|secret/);
  } finally {
    if (pump) clearInterval(pump);
    await browser.close();
    app.close();
    await c.mcp.close();
    ui.close();
    await vindu.close();
  }
});
