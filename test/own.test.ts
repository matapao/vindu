// A host using the public Vindu SDK, as in examples/: its card and library on the server, its look, words, buttons and
// component in the window. The test plays the model over MCP. A host's look moves nothing: the panes drawn are the
// boxes the model is told, the same as in Vindu's own look. With VINDU_SHOTS=<folder> it also saves the pictures
// for people (never for a model): the same process in Vindu's look, in the host's, and in the host's dark.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { ShellCommand } from '@matapao/vindu';
import { memoryResults, type Shown, type ShellState } from '@matapao/vindu/server';
import { startFjord } from '../examples/own-server.js';
import { chromium, mcpClient, type Look, type Row } from './helpers.js';

const SHOTS = process.env.VINDU_SHOTS;
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('own-'),
  work = tmp('ownwork-');
const results = memoryResults(dir); // synthetic: invented road works, places and numbers
results.add({
  tool: 'list_projects',
  server: 'prosjekt',
  value: [
    { strekning: 'Kvernlia–Bråten', ferdig_m: 2650, total_m: 3100, frist: '2026-12-15', status: 'i rute' },
    { strekning: 'Solberg bru', ferdig_m: 420, total_m: 420, frist: '2026-11-20', status: 'ferdig' },
    { strekning: 'Hagatun–Lid', ferdig_m: 1180, total_m: 2400, frist: '2027-02-01', status: 'i rute' },
    { strekning: 'Myrvoll gang- og sykkelveg', ferdig_m: 300, total_m: 1450, frist: '2026-12-31', status: 'forseinka' },
    { strekning: 'Tjernet kryss', ferdig_m: 90, total_m: 600, frist: '2027-03-15', status: 'i rute' },
    { strekning: 'Øvre Dal rekkverk', ferdig_m: 1720, total_m: 2000, frist: '2026-11-30', status: 'i rute' },
  ],
});
results.add({
  tool: 'list_deviations',
  server: 'kvalitet',
  value: [
    { id: 'AV-112', strekning: 'Kvernlia–Bråten', tema: 'Rekkverk', alvor: 'middels', meldt: '2026-11-02' },
    { id: 'AV-115', strekning: 'Myrvoll gang- og sykkelveg', tema: 'Asfalt', alvor: 'høg', meldt: '2026-11-03' },
    { id: 'AV-117', strekning: 'Hagatun–Lid', tema: 'Grøft', alvor: 'låg', meldt: '2026-11-04' },
    { id: 'AV-118', strekning: 'Myrvoll gang- og sykkelveg', tema: 'Skilt', alvor: 'middels', meldt: '2026-11-05' },
    { id: 'AV-121', strekning: 'Tjernet kryss', tema: 'Arbeidsvarsling', alvor: 'høg', meldt: '2026-11-06' },
    { id: 'AV-122', strekning: 'Øvre Dal rekkverk', tema: 'Rekkverk', alvor: 'låg', meldt: '2026-11-06' },
  ],
});
results.add({
  tool: 'weekly_meters',
  server: 'prosjekt',
  value: [38, 39, 40, 41, 42, 43, 44, 45].map((veke, i) => ({
    veke,
    meter: [310, 280, 395, 420, 360, 455, 510, 470][i],
  })),
});

const app = http.createServer((req, res) => {
  const f =
    req.url === '/app.bundle.js'
      ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js')
      : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const provider = await startFjord();
const all: Shown[] = [];
let fresh: Shown[] = [],
  state: ShellState | undefined;
const ui = provider.open(
  { results, dir, work },
  {
    onView(v) {
      all.push(v);
      fresh.push(v);
    },
    onState(s) {
      state = s;
    },
  },
);
const { mcp, call, json } = await mcpClient(ui.mcpServer.url);
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 800 },
  deviceScaleFactor: SHOTS ? 2 : 1,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const p = await ctx.newPage();
const errors: string[] = [];
p.on('pageerror', (e: Error) => errors.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await p.goto(`http://127.0.0.1:${(app.address() as { port: number }).port}/shell.html`);
afterAll(async () => {
  await mcp.close();
  ui.close();
  await provider.close();
  await browser.close();
  app.close();
});

const relay = async () => {
  for (const e of await p.evaluate(() => window.app.events())) ui.event(e);
};
const push = async (views: Shown[]) => {
  for (const v of views) await p.evaluate((x: Shown) => window.app.view(x), v);
  if (state) await p.evaluate((s: ShellState) => window.app.state(s), state);
};
const sync = async (views?: Shown[]) => {
  await relay();
  await push(views ?? fresh.splice(0));
  await p.waitForTimeout(300);
  await relay();
  await push(fresh.splice(0));
  await p.waitForTimeout(250);
  await relay();
};
const rects = () =>
  p.evaluate(() => {
    const desk = document.querySelector('.vindu-desk')!.getBoundingClientRect();
    const r = (e: Element) => {
      const b = e.getBoundingClientRect();
      return [Math.round(b.left - desk.left), Math.round(b.top - desk.top), Math.round(b.width), Math.round(b.height)];
    };
    return Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('.vindu-pane:not([hidden])')].map((e) => [e.dataset.view!, r(e)]),
    );
  });
const boxes = (look: Look) => Object.fromEntries(look.panes.map((x) => [x.view, x.box]));
const tokens = () =>
  p.evaluate(() => {
    const r = getComputedStyle(document.querySelector('.vindu-shell')!),
      pane = document.querySelector('.vindu-pane');
    return {
      accent: r.getPropertyValue('--v-accent').trim(),
      primary: r.getPropertyValue('--a2ui-color-primary').trim(),
      font: r.fontFamily,
      radius: r.getPropertyValue('--v-radius').trim(),
      pane: pane ? getComputedStyle(pane).backgroundColor : '',
    };
  });
const shot = async (name: string) => {
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  }
};

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>body{margin:0;padding:14px 16px;font:13px/1.45 system-ui,sans-serif;color:#3d5045}b{display:block;font-size:22px;font-weight:600;color:#0f1f17}@media (prefers-color-scheme: dark){body{color:#b4c4ba}b{color:#e6efe9}}#s{margin-top:10px;color:#0f7b5f}@media (prefers-color-scheme: dark){#s{color:#3fbf95}}</style>
<b id="last"></b><span>meter lagt per veke, veke 38–45 (syntetisk)</span><div id="s"></div>
<script type="module">
import { sparkline } from 'sparkline';
const rows = task.data.r3, last = rows.at(-1);
document.getElementById('last').textContent = last.meter + ' m i veke ' + last.veke;
document.getElementById('s').innerHTML = sparkline(rows.map(r => r.meter), { width: Math.min(640, innerWidth - 32), height: 100 });
</script>`;

test("a host's own card, library and look: the panes drawn are where the model is told, as in vindu's look", async () => {
  await p.evaluate(() => window.app.shell('light')); // vindu's own look first
  await p.waitForTimeout(200);
  await relay();
  await json('show_view', {
    name: 'nokkeltal',
    title: 'Nøkkeltal',
    panels: [
      { card: 'kpi', title: 'Meter ferdig', from: 'r1', value: 'sum(ferdig_m)' },
      { card: 'kpi', title: 'Opne avvik', from: 'r2', value: 'count()' },
      { card: 'kpi', title: 'Høg alvor', from: 'r2', where: { alvor: 'høg' }, value: 'count()' },
    ],
  });
  const page = await json('show_view', {
    name: 'veke',
    title: 'Meter per veke',
    panels: [{ card: 'page', html: PAGE, uses: ['r3'] }],
  });
  assert.equal(page.ok ?? true, true);
  const told: { panels: Row[] } = await json('show_view', {
    name: 'framdrift',
    title: 'Framdrift',
    subtitle: 'seks strekningar · syntetiske data',
    panels: [{ card: 'progress', from: 'r1', label: 'strekning', done: 'ferdig_m', total: 'total_m' }],
  });
  assert.equal(told.panels[0].rows, 6);
  assert.equal(told.panels[0].complete, 1); // the card's own account, to the model
  await json('show_view', {
    name: 'avvik',
    title: 'Opne avvik',
    subtitle: 'kvalitet · 6 meldingar',
    panels: [{ card: 'table', from: 'r2', columns: ['id', 'strekning', 'tema', 'alvor', 'meldt'] }],
  });
  const bad = await call('show_view', {
    name: 'feil',
    title: 'Feil',
    panels: [{ card: 'progress', from: 'r1', label: 'strekning', done: 'status', total: 'total_m' }],
  });
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(
      path.join(SHOTS, 'own-accounts.json'),
      JSON.stringify({ progress: told, refused: bad.text }, null, 2),
    );
  }
  assert.equal(bad.ok, false);
  assert.match(
    bad.text,
    /^not shown: .*"status" and "total_m" must be numbers, the whole above 0, in every row; 6 rows are not/,
  ); // the card's own check, in words
  await json('arrange', {
    layout: {
      column: [
        { row: ['nokkeltal', 'veke'], size: 0.3 },
        { row: ['framdrift', 'avvik'], size: 0.7 },
      ],
    },
  });
  await sync();
  const look = await json('look', {});
  assert.deepEqual(await rects(), boxes(look));
  const gap = await p.locator('.vindu-pane[data-view="framdrift"] .vindu-pane-body').innerText(); // a window without the host's component
  assert.equal(gap.trim(), 'This card needs the component "Progress", which this window has not registered.');
  await p.evaluate(() => window.app.nynorsk()); // the same note, in the host's words
  await sync(all);
  assert.equal(
    (await p.locator('.vindu-pane[data-view="framdrift"] .vindu-pane-body').innerText()).trim(),
    'Dette kortet treng komponenten «Progress», som ikkje er registrert i dette vindauget.',
  );

  await p.evaluate(() => window.app.shell('light', true)); // vindu's look, with the host's component
  await sync(all);
  assert.deepEqual(await rects(), boxes(look));
  assert.equal(await p.locator('.vindu-pane[data-view="framdrift"] x-progress .row').count(), 6);
  await shot('own-0-vindu-look');

  await p.evaluate(() => window.app.fjord('light')); // the host's look, the same process
  assert.equal(await p.locator('.vindu-empty').innerText(), 'Visingar kjem her når oppgåva viser dei.');
  await sync(all);
  const look2 = await json('look', {});
  assert.deepEqual(await rects(), boxes(look2));
  assert.deepEqual(boxes(look2), boxes(look)); // the look moved nothing
  assert.equal(await p.locator('.vindu-pane[data-view="framdrift"] x-progress .row').count(), 6);
  const broken = await p.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.vindu-pane[data-view="avvik"] a2ui-basic-row .a2ui-text')]
      .filter(
        (e) =>
          !/\s/.test(e.innerText.trim()) &&
          e.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(e).lineHeight),
      )
      .map((e) => e.innerText),
  );
  assert.deepEqual(broken, []); // in a wider font too, no word in the table is broken across lines
  const full = await p.evaluate(() => {
    const r = [...document.querySelectorAll('x-progress .row')].find((e) => e.textContent.includes('Solberg bru'))!;
    return [
      r.querySelector('.fill')!.getBoundingClientRect().width,
      r.querySelector('.track')!.getBoundingClientRect().width,
    ];
  });
  assert.ok(full[0] > 0 && Math.abs(full[0] - full[1]) < 0.5, JSON.stringify(full)); // 420 of 420
  const f = p.frames().find((x) => x.url().startsWith(ui.pages));
  assert.ok(f, 'the page frame');
  await f.waitForFunction(() => document.querySelector('#s svg polyline') !== null, null, { timeout: 5000 }); // the host's library, imported by name
  assert.equal(await f.locator('#last').innerText(), '470 m i veke 45');
  assert.equal(await f.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true); // the page fits its pane
  await shot('own-1-host-look');
});

test("the host's tokens hold in light and dark, through the theme and through the system's preference", async () => {
  const light = await tokens();
  assert.deepEqual(light, {
    accent: '#0f7b5f',
    primary: '#0f7b5f',
    font: 'Poppins, Inter, system-ui, sans-serif',
    radius: '10px',
    pane: 'rgb(255, 255, 255)',
  });
  await p.evaluate(() => window.app.theme('dark'));
  assert.deepEqual(await tokens(), { ...light, accent: '#3fbf95', primary: '#3fbf95', pane: 'rgb(18, 27, 22)' });
  assert.deepEqual(await rects(), boxes(await json('look', {}))); // dark moves nothing either
  await p.evaluate(() => window.app.theme('auto'));
  await p.emulateMedia({ colorScheme: 'dark' });
  assert.equal((await tokens()).accent, '#3fbf95');
  assert.deepEqual(await rects(), boxes(await json('look', {})));
  await shot('own-2-host-look-dark');
  await p.emulateMedia({ colorScheme: 'light' });
  assert.equal((await tokens()).accent, '#0f7b5f');
});

test("the host's words, and its buttons: on the panes they are for, and in the bar", async () => {
  assert.equal(await p.locator('.vindu-bar-mode').innerText(), '4 ruter');
  const tools = p.locator('.vindu-pane[data-view="avvik"] .vindu-pane-tools');
  assert.equal(await tools.locator('button[aria-label="Legg vekk"]').count(), 1); // the host's own buttons, then collapse and maximize, in its words
  assert.equal(await tools.locator('button[aria-label="Maksimer"]').count(), 1);
  assert.equal(
    await p.locator('.vindu-line').first().getAttribute('aria-label'),
    'Endre storleik på Nøkkeltal og Meter per veke',
  );
  const acts = await p.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('.vindu-pane')].map((e) => [
        e.dataset.view,
        [...e.querySelectorAll<HTMLElement>('[data-action]')].map((b) => b.dataset.action),
      ]),
    ),
  );
  assert.deepEqual(acts, { nokkeltal: ['ask'], veke: ['ask'], framdrift: ['copy', 'ask'], avvik: ['copy', 'ask'] }); // copy only where there are rows
  await p.hover('.vindu-pane[data-view="avvik"]');
  await p.click('.vindu-pane[data-view="avvik"] [data-action="copy"]');
  const copied = await p.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /AV-115/);
  assert.match(copied, /Arbeidsvarsling/);
  await p.hover('.vindu-pane[data-view="framdrift"]');
  await p.click('.vindu-pane[data-view="framdrift"] [data-action="ask"]');
  assert.deepEqual(await p.evaluate(() => window.app.asked()), ['Om «Framdrift»: ']);
  await p.click('.vindu-bar-actions [data-action="next"]'); // Neste rute: the same as F6
  await sync();
  assert.equal((await json('look', {})).focus, 'avvik');
});

test("the person's moves by name, for an app's menus: each is drawn and the model hears of it, as if done by hand", async () => {
  const cmd = (c: ShellCommand) => p.evaluate((x: ShellCommand) => window.app.command(x), c);
  assert.equal(await cmd({ type: 'maximize' }), true); // the focused pane
  await sync();
  let look = await json('look', {});
  assert.equal(look.mode, 'maximized: "avvik" fills the window; the other panes are behind it');
  assert.deepEqual(look.person, ['maximized "avvik"']);
  assert.deepEqual(await rects(), boxes(look));
  assert.equal(await cmd({ type: 'restore' }), true);
  assert.equal(await cmd({ type: 'restore' }), false); // nothing is maximized now
  assert.equal(await cmd({ type: 'collapse', view: 'veke' }), true);
  assert.equal(await cmd({ type: 'close', view: 'nope' }), false); // "close" is read as collapse
  await sync();
  look = await json('look', {});
  assert.deepEqual(look.person, ['restored the layout ("avvik" was maximized)', 'collapsed "veke" into the shelf']);
  assert.deepEqual(look.collapsed, [{ view: 'veke', title: 'Meter per veke', by: 'the person' }]);
  assert.equal(
    await p.locator('.vindu-bar-shelf .vindu-bar-view.is-collapsed').getAttribute('title'),
    'Meter per veke (lagd vekk – klikk for å opne visinga der ho var)',
  );
  assert.equal(await cmd({ type: 'open', view: 'veke' }), true);
  assert.equal(await cmd({ type: 'previous' }), true);
  await sync();
  look = await json('look', {});
  assert.deepEqual(look.person, ['opened "veke" where it was']);
  assert.notEqual(look.focus, 'veke'); // brought back with the focus, then Shift+F6's move
  assert.deepEqual(await rects(), boxes(look));
  assert.deepEqual(errors, []);
});

test('a pane maximized by name has the focus, and the bar marks it: as drawn, and in the state the UI server sends back', async () => {
  const cmd = (c: ShellCommand) => p.evaluate((x: ShellCommand) => window.app.command(x), c);
  const marked = () => p.locator('.vindu-bar-views .vindu-bar-view.is-focus').allInnerTexts();
  assert.equal(await cmd({ type: 'show', view: 'nokkeltal' }), true);
  await sync();
  assert.deepEqual(await marked(), ['Nøkkeltal']);
  assert.equal(await cmd({ type: 'maximize', view: 'veke' }), true);
  assert.deepEqual(await marked(), ['Meter per veke']);
  await sync();
  assert.deepEqual(await marked(), ['Meter per veke']);
  const look = await json('look', {});
  assert.equal(look.mode, 'maximized: "veke" fills the window; the other panes are behind it');
  assert.equal(look.focus, 'veke');
  assert.equal(await p.locator('.vindu-pane[data-view="veke"]').getAttribute('data-focus'), '');
  assert.equal(await cmd({ type: 'restore' }), true);
  await sync();
  assert.deepEqual(await marked(), ['Meter per veke']); // restored, it keeps the focus
  assert.equal((await json('look', {})).focus, 'veke');
  assert.deepEqual(errors, []);
});
