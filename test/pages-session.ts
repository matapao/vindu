// One task's session for the page tests (pages.test.ts, pages-host.test.ts): a working folder with a website, a game
// and pages that break, a library the host adds, Chromium driving the page checks, and a page's check as reported.
import { afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults } from '../src/index.js';
import { playwrightDriver } from '../src/drivers/playwright.js';
import type { PageReport } from '../src/page-check.js';
import { chromium, mcpClient } from './helpers.js';

export const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const workOf = (pages: string) => pages.replace('http://', 'http://work-'); // where pages from the working folder run
export const write = (root: string, files: Record<string, string>) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); } };

export const invoices = [
  { id: 'INV-2026-0241', customer: 'Vik Data', amount_nok: 31050, status: 'overdue' },
  { id: 'INV-2026-0259', customer: 'Strand Bygg', amount_nok: 35740, status: 'overdue' },
  { id: 'INV-2026-0270', customer: 'Strand Bygg', amount_nok: 35400, status: 'overdue' },
  { id: 'INV-2026-0300', customer: 'Nordlys Retail', amount_nok: 49520, status: 'open' },
];
export const work = tmp('work-');
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
export const tiny = { name: 'tiny', version: '1.0.0', license: 'MIT', dir: tinyDir, imports: { tiny: 'tiny.js' } };

const dir = tmp('task-');
export const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', value: invoices });

export const browser = await chromium.launch();
export const vindu = await startVindu({ driver: playwrightDriver(browser), libraries: [tiny] });
export const ui = vindu.open({ results, dir, work });
export const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => { await mcp.close(); ui.close(); await vindu.close(); await browser.close(); });
/** A page's check as show_view reports it (page-check.ts), each part the tests read taken as there: a test fails where it is not. */
type Checked = Required<Omit<PageReport, 'text' | 'charts' | 'three' | 'canvases'>> & {
  text: Required<NonNullable<PageReport['text']>>;
  charts: { library: string; type: string; series: { values: number[]; [field: string]: unknown }[]; [field: string]: unknown }[];
  three: { frames: number; [field: string]: unknown }[];
  canvases: { context: string; draw_calls: number; [field: string]: unknown }[];
};
export const page = (a: { panels: { page: Checked }[] }) => a.panels[0].page;
