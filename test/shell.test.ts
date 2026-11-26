// The shell over real MCP, as a processor calls it, with the host's side (window size, the person's changes) fed in
// as the window would report it. No model and no browser.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startVindu, memoryResults, viewsOf, type ShellState } from '../src/index.js';
import { Shell } from '../src/shell.js';
import { mcpClient } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-'));
const results = memoryResults(dir);
results.add({
  tool: 'query',
  server: 'db',
  value: [
    { customer: 'Brattli Verksted', amount_nok: 31050 },
    { customer: 'Havgap Media', amount_nok: 71140 },
  ],
});
results.add({
  tool: 'list_messages',
  server: 'mail',
  value: [{ from: 'kari@brattli.example', subject: 'Invoice 241', received: '2026-11-02' }],
});
const states: ShellState[] = [];
const vindu = await startVindu();
const ui = vindu.open({ results, dir }, { onState: (s) => states.push(s) });
const { mcp, call, json } = await mcpClient(ui.url);
afterAll(async () => {
  await mcp.close();
  ui.close();
  await vindu.close();
});
const show = (name: string, extra: Record<string, unknown> = {}) =>
  json('show_view', { name, title: name.replace(/-/g, ' '), panels: [{ card: 'table', from: 'r1' }], ...extra });

test('each view gets a pane: the first sits in the middle, the next take half of the largest pane, and the account says where', async () => {
  const a = await show('overdue');
  assert.equal(typeof a.shell.rev, 'number');
  delete a.shell.rev; // the window's revision: one more on every change
  assert.deepEqual(a.shell, {
    window: '1280 × 800, assumed: no window has reported its size',
    mode: 'single: one view, in the middle',
    layout: 'overdue',
    this: {
      view: 'overdue',
      at: 'centre',
      room: [120, 24, 1040, 752],
      surface: 'wide',
      height: 'as tall as its content, centred, at most 752 px',
    },
  });
  ui.event({ type: 'window', w: 1440, h: 876 });
  const b = await show('mail', { panels: [{ card: 'table', from: 'r2' }] });
  assert.deepEqual(b.shell.this, { view: 'mail', at: 'right, full height', box: [721, 0, 719, 876], surface: 'wide' });
  assert.deepEqual(b.shell.layout, { row: ['overdue', 'mail'] });
  const c = await show('chart', { panels: [{ card: 'bar-chart', from: 'r1', x: 'customer', y: 'amount_nok' }] });
  assert.deepEqual(c.shell.layout, { row: ['overdue', { column: ['mail', 'chart'] }] });
  assert.equal(c.shell.this.at, 'bottom right');
  const again = await show('overdue'); // showing a name again keeps its pane
  assert.deepEqual(again.shell.layout, c.shell.layout);
  assert.deepEqual(states.at(-1)!.tree, {
    dir: 'row',
    size: 1,
    children: [
      { view: 'overdue', size: 0.5 },
      {
        dir: 'column',
        size: 0.5,
        children: [
          { view: 'mail', size: 0.5 },
          { view: 'chart', size: 0.5 },
        ],
      },
    ],
  });
  assert.deepEqual(
    states.at(-1)!.views.map((v) => [v.name, v.panels]),
    [
      ['overdue', 'table'],
      ['mail', 'table'],
      ['chart', 'bar-chart'],
    ],
  );
});

test('arrange sets rows and columns of views; names it does not know are refused with the views there are', async () => {
  const a = await json('arrange', { layout: { column: [{ row: ['overdue', 'chart'], size: '60%' }, 'mail'] } });
  assert.equal(a.mode, 'tiled: 3 panes, 1 px lines between');
  assert.deepEqual(
    a.panes.map((p: { view: string; box: number[]; at: string }) => [p.view, p.at, p.box]),
    [
      ['overdue', 'top left', [0, 0, 720, 525]],
      ['chart', 'top right', [721, 0, 719, 525]],
      ['mail', 'bottom, full width', [0, 526, 1440, 350]],
    ],
  );
  assert.deepEqual(a.layout, {
    column: [
      { row: ['overdue', 'chart'], size: 0.6 },
      { view: 'mail', size: 0.4 },
    ],
  });
  const bad = await call('arrange', { layout: ['overdue', 'charts'] });
  assert.equal(bad.ok, false);
  assert.equal(bad.text, 'not arranged: no view "charts" has been shown; views shown: overdue, mail, chart');
  const left = await json('arrange', { layout: ['chart', 'overdue'] });
  assert.deepEqual(left.collapsed, [{ view: 'mail', title: 'mail', by: 'you' }]);
  assert.match(left.notes[0], /left out of the layout, so collapsed in the shelf: mail/);
  const max = await json('arrange', { maximize: 'chart', focus: 'chart' });
  assert.equal(max.mode, 'maximized: "chart" fills the window; the other panes are behind it');
  assert.deepEqual(
    max.panes.map((p: { view: string; box: number[] }) => [p.view, p.box]),
    [['chart', [0, 0, 1440, 876]]],
  );
  assert.equal(max.focus, 'chart');
  assert.equal((await json('arrange', { maximize: null })).mode, 'tiled: 2 panes, 1 px lines between');
  assert.equal((await call('arrange', {})).ok, false);
});

test('what the person changes reaches the model once, with the next account', async () => {
  await json('arrange', { layout: ['overdue', { column: ['mail', 'chart'] }] });
  assert.equal(ui.event({ type: 'resize', path: [], sizes: [0.64, 0.36] }), true);
  assert.equal(ui.event({ type: 'resize', path: [], sizes: [0.7, 0.3] }), true); // the same line again: one change
  assert.equal(ui.event({ type: 'collapse', view: 'mail' }), true);
  assert.equal(ui.event({ type: 'maximize', view: 'chart' }), true);
  assert.equal(ui.event({ type: 'maximize', view: null }), true);
  assert.equal(ui.event({ type: 'open', view: 'mail' }), true);
  assert.equal(ui.event({ type: 'collapse', view: 'nope' }), false); // what does not fit what is shown is ignored
  assert.equal(ui.event({ type: 'resize', path: [9], sizes: [1, 1] }), false);
  assert.equal(ui.event({ type: 'resize', path: ['0'], sizes: [1, 1] }), false); // only integer paths locate a divider
  assert.equal(ui.event({ type: 'resize', path: [], sizes: '1,1' }), false);
  assert.equal(ui.event({ type: 'bogus' }), false);
  const look = await json('look', {});
  assert.deepEqual(look.person, [
    'resized: "overdue" 70 %, "mail" + "chart" 30 %',
    'collapsed "mail" into the shelf',
    'maximized "chart"',
    'restored the layout ("chart" was maximized)',
    'opened "mail" where it was',
  ]);
  assert.deepEqual(look.layout, {
    row: [
      { view: 'overdue', size: 0.7 },
      { column: ['mail', 'chart'], size: 0.3 },
    ],
  }); // as it was, to the share
  assert.equal(look.focus, 'mail');
  assert.equal((await json('look', {})).person, undefined); // told once
  const lines = fs
    .readFileSync(path.join(dir, 'ui-calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.deepEqual(
    lines.filter((l) => l.person).map((l) => l.person.type),
    ['resize', 'resize', 'collapse', 'maximize', 'maximize', 'open'],
  );
});

test('look reports whether each view fits its pane, from the heights the window measured', async () => {
  const before = await json('look', {});
  const [p0, p1] = before.panes;
  ui.event({
    type: 'measure',
    views: {
      [p0.view]: { content: 1240, visible: p0.box[3] - 28 },
      [p1.view]: { content: 300, visible: p1.box[3] - 28 },
    },
  });
  const look = await json('look', {});
  assert.equal(look.panes[0].content, `scrolls: 1,240 px of content in ${(p0.box[3] - 28).toLocaleString('en-GB')}`);
  assert.equal(look.panes[1].content, 'fits');
  assert.equal(look.panes[0].cards, 'table');
  await json('arrange', { focus: p1.view });
  assert.equal((await json('look', {})).panes[0].content, undefined); // a change of layout makes old measurements stale
});

test('a view can be placed beside another, and a phone-width window stacks the panes', async () => {
  const a = await show('notes', {
    panels: [{ card: 'text', text: 'Synthetic notes.' }],
    place: { beside: 'overdue', side: 'below', size: 0.3 },
  });
  assert.equal(a.shell.this.at, 'bottom centre'); // below "overdue", which is 70 % wide
  assert.equal(a.shell.this.box[3], 262); // 30 % of 875
  ui.event({ type: 'window', w: 390, h: 780 });
  const look = await json('look', {});
  assert.equal(look.mode, 'stacked: the window is phone-width, so the panes are one after another, full width');
  assert.deepEqual(
    look.panes.map((p: { view: string; at: string; surface: string; width: number }) => [
      p.view,
      p.at,
      p.surface,
      p.width,
    ]),
    [
      ['overdue', '1 of 4, top to bottom', 'compact', 390],
      ['notes', '2 of 4, top to bottom', 'compact', 390],
      ['mail', '3 of 4, top to bottom', 'compact', 390],
      ['chart', '4 of 4, top to bottom', 'compact', 390],
    ],
  );
  assert.deepEqual(look.person, ['the window is now 390 × 780: stacked']);
});

test('a view that is one page takes its whole pane', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shellwork-'));
  fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><title>Site</title><h1>Site</h1>');
  const t = vindu.open({ results: memoryResults(), dir: fs.mkdtempSync(path.join(os.tmpdir(), 'shell2-')), work });
  const c = await mcpClient(t.url);
  t.event({ type: 'window', w: 1440, h: 876 });
  const a = await c.json('show_view', { name: 'site', title: 'Site', panels: [{ card: 'page', path: 'index.html' }] });
  assert.deepEqual(a.shell.this, { view: 'site', at: 'centre', box: [24, 24, 1392, 828], surface: 'wide' });
  assert.equal(t.shell().views[0].fill, true);
  await c.mcp.close();
  t.close();
});

test('the shelf: what the person collapses stays there when shown again, marked; the model collapses and opens views', async () => {
  const t = vindu.open({ results, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-')) });
  const c = await mcpClient(t.url);
  t.event({ type: 'window', w: 1440, h: 876 });
  const put = (name: string) => c.json('show_view', { name, title: name, panels: [{ card: 'table', from: 'r1' }] });
  await put('a');
  await put('b');
  await put('c');
  const before = (await c.json('look', {})).layout;
  assert.deepEqual(before, { row: ['a', { column: ['b', 'c'] }] });
  assert.equal(t.event({ type: 'collapse', view: 'b' }), true);
  const again = await put('b'); // the person put it there: it stays, updated and marked
  assert.deepEqual(again.shell.this, { view: 'b', at: 'collapsed in the shelf, by the person' });
  assert.match(
    again.shell.notes[0],
    /^"b" is collapsed in the shelf, where the person put it: it is updated there and marked as new/,
  );
  assert.deepEqual(again.shell.person, ['collapsed "b" into the shelf']);
  assert.deepEqual((await c.json('look', {})).collapsed, [
    { view: 'b', title: 'b', by: 'the person', updated: 'shown again while collapsed: marked as new' },
  ]);
  assert.equal(t.shell().shelf.b.updated, true);
  const opened = await c.json('arrange', { open: 'b' });
  assert.deepEqual(opened.layout, before); // where it was
  assert.deepEqual(opened.notes, ['opened "b" where it was']);
  const folded = await c.json('arrange', { collapse: ['b', 'c'] });
  assert.equal(folded.layout, 'a');
  assert.deepEqual(
    folded.collapsed.map((x: { view: string; by: string }) => [x.view, x.by]),
    [
      ['b', 'you'],
      ['c', 'you'],
    ],
  );
  assert.match((await put('c')).shell.notes.join(), /"c" was collapsed in the shelf; it opened/); // the model's own: shown again, it opens
  // a layout sent as JSON text is read as JSON, and a new layout restores a maximized pane
  await c.json('arrange', { maximize: 'a' });
  const text = await c.json('arrange', { layout: JSON.stringify(['a', 'c']) });
  assert.deepEqual(text.layout, { row: ['a', 'c'] });
  assert.equal(text.mode, 'tiled: 2 panes, 1 px lines between');
  assert.deepEqual(text.notes, [
    'read the layout from a JSON string',
    'left out of the layout, so collapsed in the shelf: b (open brings one back where it was; the person can too)',
    '"a" was maximized; the new layout is shown in its place',
  ]);
  // the person drags a pane beside another, and a view from the shelf beside a pane
  assert.equal(t.event({ type: 'move', view: 'c', place: { beside: 'a', side: 'above' } }), true);
  assert.equal(t.event({ type: 'open', view: 'b', place: { beside: 'c', side: 'right' } }), true);
  assert.equal(t.event({ type: 'move', view: 'c', place: { beside: 'c' } }), false);
  const dragged = await c.json('look', {});
  assert.deepEqual(dragged.person, ['moved "c" above "a"', 'opened "b" right of "c"']);
  assert.deepEqual(dragged.layout, { column: [{ row: ['c', 'b'] }, 'a'] });
  await c.mcp.close();
  t.close();
});

test('a reservation returns computed geometry without readback and fills at the current placement', async () => {
  const place = await startVindu({ verifyMs: 5_000 });
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-reserve-'));
  const states: ShellState[] = [];
  const local = place.open(
    { results, dir: localDir },
    {
      onView: (v) => {
        // Only an actual view gets a readback event. Reservations have no view data yet.
        queueMicrotask(() =>
          local.event({
            type: 'rendered',
            view: v.name,
            seq: v.seq,
            surface: 'wide',
            got: (v.probes?.wide ?? []).map((probe, i) => ({ i, text: probe.expect, visible: true })),
          }),
        );
      },
      onState: (state) => states.push(state),
    },
  );
  const client = await mcpClient(local.url);
  try {
    await client.json('show_view', {
      name: 'existing',
      title: 'Existing',
      panels: [{ card: 'text', text: 'Already drawn' }],
    });
    assert.equal(
      (
        await client.call('arrange', {
          reserve: [{ name: 'summary', title: 'Summary' }],
          layout: ['summary', 'unknown'],
        })
      ).ok,
      false,
    );
    assert.deepEqual(
      states.at(-1)?.views.map((view) => view.name),
      ['existing'],
    );
    local.event({ type: 'window', w: 1440, h: 876 });
    const before = states.length;
    const plan = await client.json('arrange', {
      reserve: [
        { name: 'summary', title: 'Summary' },
        { name: 'details', title: 'Details' },
      ],
      layout: ['existing', { column: ['summary', 'details'] }],
    });
    assert.equal(states.length, before + 1, 'the entire layout arrives in one state');
    assert.deepEqual(plan.geometry, {
      viewport: 'reported',
      measurement: 'computed layout; content has not been read back',
    });
    assert.deepEqual(
      plan.panes.map((pane: { view: string; box: number[]; state?: string }) => [pane.view, pane.box, pane.state]),
      [
        ['existing', [0, 0, 720, 876], undefined],
        ['summary', [721, 0, 719, 438], 'loading'],
        ['details', [721, 439, 719, 437], 'loading'],
      ],
    );
    const read = await client.json('read_view', { view: 'summary' });
    assert.equal(read.state, 'loading');
    assert.equal(
      (await client.call('show_view', { name: 'summary', title: 'Summary', panels: [{ card: 'table', from: 'r999' }] }))
        .ok,
      false,
    );
    assert.equal(states.at(-1)?.views.find((view) => view.name === 'summary')?.loading, true);
    assert.equal(local.event({ type: 'collapse', view: 'summary' }), true);
    await client.json('show_view', {
      name: 'summary',
      title: 'Summary',
      panels: [{ card: 'text', text: 'Ready' }],
      place: { beside: 'existing', side: 'left' },
    });
    assert.equal(states.at(-1)?.views.find((view) => view.name === 'summary')?.loading, undefined);
    assert.equal(states.at(-1)?.shelf.summary.by, 'person');
    assert.equal((await client.call('arrange', { release: ['summary'] })).ok, false);
    const released = await client.json('arrange', { release: ['details'] });
    assert.deepEqual(
      released.panes.map((pane: { view: string }) => pane.view),
      ['existing'],
    );
    assert.deepEqual(
      states.at(-1)?.views.map((view) => view.name),
      ['existing', 'summary'],
    );
  } finally {
    await client.mcp.close();
    local.close();
    await place.close();
    fs.rmSync(localDir, { force: true, recursive: true });
  }
});

test('a layout the model suggested, taken after a view in it was dropped, leaves that view out', () => {
  const shell = new Shell({ arrange: 'suggest' });
  shell.show('inv', { title: 'Invoices', fill: false, panels: 'table' });
  shell.show('ask-k1', { title: 'A question', fill: false, panels: 'form', ask: true });
  assert.equal(shell.arrange({ layout: { column: ['ask-k1', 'inv'] } }).suggested, true);
  shell.drop('ask-k1'); // answered: gone for good
  assert.deepEqual(viewsOf(shell.state().suggestion!.tree), ['inv']);
  assert.equal(shell.event({ type: 'take-suggestion' }), true);
  assert.deepEqual(viewsOf(shell.state().tree), ['inv']);
  assert.doesNotThrow(() => shell.account({ full: true }));
});
