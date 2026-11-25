// A picture a tool returned, restored: a media panel whose picture was not read again waits for the same call, its gate
// keeping the pointer where it may be read again, and fills in under the new id on the next restore, on
// ui.refetchWaiting and on the person's Try again; so does a gallery that misses one such picture, whole. A gallery that
// misses more, and a picture or a PDF the person gave, are said in words, as before. All synthetic.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryResults, startVindu, type ResultPointer, type ShellState, type Shown, type ViewCheckpoint, type ViewPresentation } from '../src/index.js';
import { chromium, mcpClient, shellServer, sleep, tinyPdf } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const until = async (f: () => boolean, ms = 8000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await sleep(20); } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const given = fs.mkdtempSync(path.join(os.tmpdir(), 'vindu-given-'));
const photoFile = path.join(given, 'site.png'), pdfFile = path.join(given, 'brief.pdf');
fs.writeFileSync(photoFile, PNG); // files the person gave
fs.writeFileSync(pdfFile, tinyPdf(2));
const vindu = await startVindu({ waitMs: 300, verifyMs: 0 });
afterAll(async () => { await vindu.close(); });

/** A camera's snapshot of a site, as its server returned it. */
const snapshot = (site: string) => ({ server: 'camera', tool: 'snapshot', input: { site }, images: [{ data: PNG, mime: 'image/png' }] });
const MARKS = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.3, label: 'Dent' }];
const VIEWS = [
  { name: 'photo', title: 'Photo', panels: [{ id: 'shot', card: 'media', title: 'Voss', media: 'r1', marks: MARKS }] },
  { name: 'pics', title: 'Sites', panels: [{ id: 'all', card: 'gallery', title: 'Sites', media: ['r3', 'r2', 'r4'] }] },
  { name: 'both', title: 'Both', panels: [{ id: 'all', card: 'gallery', title: 'Both', media: ['r1-r2'] }] },
  { name: 'given', title: 'Given', panels: [{ id: 'own', card: 'media', title: 'Site', media: 'a1' }] },
  { name: 'brief', title: 'Brief', panels: [{ id: 'doc', card: 'pdf', title: 'Brief', media: 'a2' }] },
];

/** The first task: snapshots of four sites (r1 Voss, r2 Bergen, r3 Alta, r4 Odda), a picture and a PDF the person gave
 *  (a1, a2), the views given, and its checkpoint as the host's store keeps it. */
async function firstTask(views: Record<string, unknown>[] = VIEWS): Promise<ViewCheckpoint> {
  const results = memoryResults();
  for (const site of ['Voss', 'Bergen', 'Alta', 'Odda']) results.add(snapshot(site));
  results.attach('site.png', 'image/png', photoFile);
  results.attach('brief.pdf', 'application/pdf', pdfFile);
  const ui = vindu.open({ results }, {});
  const { mcp, json } = await mcpClient(ui.url);
  try {
    for (const v of views) await json('show_view', v);
    return JSON.parse(JSON.stringify(ui.checkpoint())) as ViewCheckpoint;
  } finally { await mcp.close(); ui.close(); }
}
/** A host that reads Alta and Odda again always; Voss and Bergen only online; never a file the person gave. */
const hostOf = () => {
  const results = memoryResults();
  const calls: ResultPointer[] = [];
  const host = {
    results, calls, online: false,
    refetch: async (p: ResultPointer) => {
      calls.push(p);
      if (p.kind === 'attachment') throw new Error('the file is not on this computer');
      const site = (p.input as { site: string }).site;
      if (!host.online && !['Alta', 'Odda'].includes(site)) throw new Error('the computer is offline');
      return results.add(snapshot(site)).id;
    },
    /** The id of the newest snapshot of a site this host read. */
    idOf: (site: string) => results.all().findLast(e => e.kind === 'result' && (e.input as { site: string }).site === site)!.id,
  };
  return host;
};
type Host = ReturnType<typeof hostOf>;
/** A task opened again from a checkpoint by this host: what it drew and presented, and the task. */
async function reopen(cp: ViewCheckpoint, host: Host, more: Record<string, unknown> = {}) {
  const shown: Shown[] = [], presented: ViewPresentation[] = [];
  const ui = vindu.open({ results: host.results }, { onView: v => shown.push(v), onPresentation: v => presented.push(v), refetch: host.refetch, ...more });
  assert.deepEqual(await ui.restore(cp), []);
  const drawn = (view: string) => JSON.stringify(shown.filter(v => v.name === view).at(-1)?.wide ?? null);
  const panelOf = (view: string) => presented.filter(v => v.name === view).at(-1)!.panels[0];
  return { ui, shown, drawn, panelOf, close: () => ui.close() };
}
/** What each gate of a checkpoint keeps to read again, and the field it fills, by view/panel. */
const keptOf = (cp: ViewCheckpoint) => Object.fromEntries(cp.gates.flatMap(([k, g]) => (g.pointer ? [[k, { pointer: g.pointer, fills: g.fills }]] : [])));
const VOSS = { id: 'r1', kind: 'result', server: 'camera', tool: 'snapshot', input: { site: 'Voss' } };
const BERGEN = { id: 'r2', kind: 'result', server: 'camera', tool: 'snapshot', input: { site: 'Bergen' } };
const WAITING = 'Not read again: the host could not (the computer is offline). Waiting for camera.snapshot: it fills in here when it comes.';

/** Each picture a view draws now: a media panel's, or a gallery's in order, by where the page host serves it. */
const picturesOf = (t: Awaited<ReturnType<typeof reopen>>, view: string): string[] => {
  const p = t.panelOf(view);
  if (p.gallery) return p.gallery.map(item => item.url);
  return p.media ? [p.media.url] : [];
};
const served = (t: Awaited<ReturnType<typeof reopen>>, ...ids: string[]) => ids.map(id => `${t.ui.pages}/media/${id}`);

let saved: ViewCheckpoint;
let waiting: ViewCheckpoint;
test('restored offline: a media panel on a tool\'s picture waits for the same call, offering Try again, its gate keeping the pointer; a gallery missing one picture waits whole; one missing two, and what the person gave, are said in words', async () => {
  saved = await firstTask();
  const host = hostOf();
  const t = await reopen(saved, host);
  try {
    // the picture waits for the same call, its card and title kept, and the person may try again
    assert.ok(t.drawn('photo').includes(WAITING) && t.drawn('photo').includes('"name":"try_again"'), t.drawn('photo'));
    const shot = t.panelOf('photo');
    assert.deepEqual([shot.card, shot.title, shot.state, shot.message, shot.again], ['media', 'Voss', 'waiting', WAITING, { event: 'try_again', context: { panel: 'shot' } }]);
    assert.ok(!t.drawn('photo').includes('/media/'));
    // the gallery waits whole for the one picture it misses
    assert.ok(t.drawn('pics').includes(WAITING) && t.drawn('pics').includes('try_again'));
    assert.deepEqual([t.panelOf('pics').card, t.panelOf('pics').state], ['gallery', 'waiting']);
    // a gallery that misses two pictures, and a picture or a PDF the person gave, are said in words, with no Try again
    assert.ok(t.drawn('both').includes('Not read again: the host could not (the computer is offline). It showed what camera.snapshot gave.'));
    assert.ok(t.drawn('given').includes('Not read again: the host could not (the file is not on this computer). It showed site.png, which the person gave.'));
    assert.ok(t.drawn('brief').includes('Not read again: the host could not (the file is not on this computer). It showed brief.pdf, which the person gave.'));
    for (const view of ['both', 'given', 'brief']) assert.deepEqual([t.panelOf(view).card, t.panelOf(view).state, t.panelOf(view).again], ['text', 'ready', undefined], view);
    assert.match(t.ui.delta(), /5 panels wait for their results: photo \(shot\): Not read again: the host could not \(the computer is offline\)\./);
    // a checkpoint taken while they wait keeps each pointer and the field it fills, and never the picture
    waiting = JSON.parse(JSON.stringify(t.ui.checkpoint())) as ViewCheckpoint;
    assert.deepEqual(keptOf(waiting), { 'photo/shot': { pointer: VOSS, fills: { field: 'media' } }, 'pics/all': { pointer: BERGEN, fills: { field: 'media', at: 1 } } });
    assert.ok(!JSON.stringify(waiting).includes(PNG.toString('base64')));
    const pics = waiting.views.find(v => v.name === 'pics')!.args.panels as any[];
    assert.deepEqual(pics[0].media, [host.idOf('Alta'), host.idOf('Odda')]); // the pictures it has, on their new ids
    const photo = (waiting.views.find(v => v.name === 'photo')!.args.panels as any[])[0];
    assert.deepEqual([photo.card, photo.title, photo.media, photo.marks, photo.awaits], ['media', 'Voss', undefined, MARKS, { tool: 'snapshot', server: 'camera', input: { site: 'Voss' } }]);
  } finally { t.close(); }
});

test('the next restore, with the host online, draws the picture under its new id and the gallery whole, in order; a checkpoint after keeps it filled', async () => {
  const host = hostOf();
  host.online = true;
  const t = await reopen(waiting, host);
  let filled: ViewCheckpoint;
  try {
    assert.deepEqual(picturesOf(t, 'photo'), served(t, host.idOf('Voss')));
    assert.deepEqual(t.panelOf('photo').marks, MARKS); // the rest of its spec, as it was
    assert.deepEqual(picturesOf(t, 'pics'), served(t, host.idOf('Alta'), host.idOf('Bergen'), host.idOf('Odda')));
    assert.ok(!t.drawn('photo').includes('try_again'));
    filled = JSON.parse(JSON.stringify(t.ui.checkpoint())) as ViewCheckpoint;
    assert.deepEqual(keptOf(filled), {}); // filled: each result is the checkpoint's own pointer
  } finally { t.close(); }
  const again = hostOf();
  again.online = true;
  const next = await reopen(filled, again);
  try {
    assert.deepEqual(picturesOf(next, 'photo'), served(next, again.idOf('Voss')));
    assert.deepEqual(picturesOf(next, 'pics'), served(next, again.idOf('Alta'), again.idOf('Bergen'), again.idOf('Odda')));
  } finally { next.close(); }
});

test('ui.refetchWaiting and the person\'s Try again fill a waiting picture in place, under its new id', async () => {
  const host = hostOf();
  const t = await reopen(saved, host);
  try {
    t.ui.delta(); // the restore's note, heard
    host.online = true;
    host.calls.length = 0;
    assert.equal(t.ui.event({ type: 'action', view: 'photo', name: 'try_again', context: { panel: 'shot' } }), true);
    await until(() => picturesOf(t, 'photo').length > 0);
    assert.deepEqual(picturesOf(t, 'photo'), served(t, host.idOf('Voss')));
    assert.deepEqual(host.calls, [VOSS]); // that panel alone
    assert.equal(t.panelOf('pics').state, 'waiting');
    assert.match(t.ui.delta(), /one panel that waited is drawn from its result read again: photo \(shot\), from r\d+/);
    assert.deepEqual(await t.ui.refetchWaiting(), { filled: 1, still: 0 });
    assert.deepEqual(picturesOf(t, 'pics'), served(t, host.idOf('Alta'), host.idOf('Bergen'), host.idOf('Odda')));
    assert.match(t.ui.delta(), /one panel that waited is drawn from its result read again: pics \(all\), from r\d+/);
    assert.equal(t.ui.event({ type: 'action', view: 'given', name: 'try_again', context: { panel: 'own' } }), false); // the person's file: no Try again
  } finally { t.close(); }
});

test('in Chromium: the waiting picture says why with Try again, and the person\'s click draws the picture', async () => {
  const cp = await firstTask([VIEWS[0]]);
  const host = hostOf();
  let state: ShellState | undefined;
  const t = await reopen(cp, host, { onState: (s: ShellState) => { state = s; } });
  const server = await shellServer(import.meta.dirname), browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(server.url);
    await page.evaluate(() => (window as any).app.shell('light'));
    const push = async () => {
      for (const v of t.shown.splice(0)) await page.evaluate((x: Shown) => (window as any).app.view(x), v);
      if (state) await page.evaluate((s: ShellState) => (window as any).app.state(s), state);
    };
    await push();
    const pane = page.locator('.vindu-pane[data-view="photo"]');
    await pane.getByText('Waiting for camera.snapshot').waitFor();
    assert.equal(await pane.locator('img').count(), 0);
    host.online = true;
    await pane.getByRole('button', { name: 'Try again' }).click();
    for (const e of await page.evaluate(() => (window as any).app.events())) t.ui.event(e);
    await until(() => t.shown.some(v => JSON.stringify(v.wide).includes(`/media/${host.idOf('Voss')}`)));
    await push();
    const img = pane.locator('img');
    await img.first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.vindu-pane[data-view="photo"] img')].some(i => i.complete && i.naturalWidth > 0));
    assert.equal(await img.first().getAttribute('src'), `${t.ui.pages}/media/${host.idOf('Voss')}`);
    assert.equal(await pane.getByText('Waiting for camera.snapshot').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); t.close(); }
});
