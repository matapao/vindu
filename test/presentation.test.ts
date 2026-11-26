import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { memoryResults, startVindu, type ViewPresentation } from '../src/index.js';
import { mcpClient } from './helpers.js';

test('native renderers receive display data and state from the same MCP views and actions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vindu-presentation-'));
  const results = memoryResults(dir);
  const vindu = await startVindu();
  const views: ViewPresentation[] = [];
  let onView: ((view: ViewPresentation) => void) | undefined;
  const ui = vindu.open({ results, dir }, { onPresentation: view => {
    views.push(view);
    onView?.(view);
  } });
  const { mcp, json } = await mcpClient(ui.url);
  const next = async (count: number) => {
    for (let attempt = 0; views.length < count && attempt < 100; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(views.length, count);
    return views.at(-1)!;
  };

  try {
    await json('show_view', { name: 'activity', title: 'Activity', panels: [
      { id: 'items', card: 'table', awaits: { server: 'work', tool: 'list' }, columns: ['name', 'count'] },
      { id: 'profile', card: 'record', awaits: { server: 'work', tool: 'profile' }, fields: ['name'] },
    ] });
    assert.deepEqual(views[0].panels.map(p => [p.id, p.card, p.state]), [['items', 'table', 'waiting'], ['profile', 'record', 'waiting']]);

    const entry = results.add({ server: 'work', tool: 'list', value: [
      { name: 'Zebra', count: 12, excluded: 'internal' },
      { name: 'Apple', count: 9, excluded: 'internal' },
    ] });
    let accepted: boolean | undefined;
    onView = view => {
      onView = undefined;
      view.panels[0].rows![0].count = 999; // renderer writes cannot alter the shared dataset
      accepted = ui.event({ type: 'view', view: 'activity', action: 'sort', panel: 'items', field: 'name', dir: 'asc' });
    };
    ui.result(entry.id);
    const sorted = await next(3);
    const arrived = views[1];
    const expected = [{ name: 'Zebra', count: 12 }, { name: 'Apple', count: 9 }];
    assert.deepEqual(arrived.panels[0].rows, [{ name: 'Zebra', count: 999 }, expected[1]]);
    assert.equal(accepted, true);
    assert.equal(arrived.panels[0].source?.id, entry.id);
    assert.equal(arrived.panels[1].state, 'waiting');
    assert.equal(sorted.panels[0].sort, 'name asc');
    assert.deepEqual(sorted.panels[0].rows, expected.toReversed());

    const failed = results.add({ server: 'work', tool: 'profile', text: 'The profile could not be loaded' });
    failed.error = true;
    ui.result(failed.id);
    const settled = await next(4);
    assert.equal(settled.panels[1].state, 'error');
    assert.match(settled.panels[1].message!, /could not be loaded/);

    await json('show_view', { name: 'trend', title: 'Trend', panels: [
      { id: 'trend', card: 'bar-chart', from: entry.id, x: 'name', y: 'count' },
      { id: 'count', card: 'kpi', from: entry.id, value: 'sum(count)' },
      { id: 'profile', card: 'record', from: entry.id, fields: ['name'] },
    ] });
    const figures = await next(5);
    assert.deepEqual(figures.panels[0].chart, { x: 'name', y: ['count'] });
    assert.deepEqual(figures.panels[0].rows, expected);
    assert.equal(figures.panels[1].value, 21);
    assert.equal(figures.panels[1].rows, undefined);
    assert.deepEqual(figures.panels[2].record, { name: 'Zebra' });
    const document = results.add({ server: 'work', tool: 'document', value: [{ heading: 'Part one', text: 'Visible', excluded: 'internal' }] });
    await json('show_view', { name: 'document', title: 'Document', panels: [{ card: 'document', from: document.id }] });
    assert.deepEqual((await next(6)).panels[0].rows, [{ heading: 'Part one', text: 'Visible' }]);
    assert(!JSON.stringify(views).includes('internal'));
  } finally {
    await mcp.close();
    ui.close();
    await vindu.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a view drilled into says so to a host that draws it itself: the way in, and the way back as the head sends it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vindu-presentation-'));
  const results = memoryResults(dir);
  results.add({ server: 'work', tool: 'list', value: [{ customer: 'North', amount: 5 }, { customer: 'North', amount: 7 }, { customer: 'South', amount: 3 }] });
  const vindu = await startVindu();
  const views: ViewPresentation[] = [];
  const ui = vindu.open({ results, dir }, { onPresentation: view => { views.push(view); } });
  const { mcp, json } = await mcpClient(ui.url);
  const until = async (f: () => boolean) => { for (let i = 0; !f() && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(f()); };
  try {
    await json('show_view', { name: 'owed', title: 'Owed', panels: [{ id: 'by-customer', card: 'bar-chart', from: 'r1', group: 'customer', value: 'sum(amount)' }] });
    assert.equal(views.at(-1)!.path, undefined); assert.equal(views.at(-1)!.back, undefined);
    assert.equal(ui.event({ type: 'drill', view: 'owed', panel: 'by-customer', row: 0 }), true);
    await until(() => views.at(-1)!.path !== undefined);
    const drilled = views.at(-1)!;
    assert.deepEqual(drilled.path, ['Owed', 'North']);
    assert.deepEqual(drilled.back, { event: 'drill_back', context: { depth: 1 } });
    assert.equal(drilled.panels[0].rows!.length, 2);
    const n = views.length; // what a host's own back control sends, as the head's button does
    assert.equal(ui.event({ type: 'action', view: 'owed', name: drilled.back.event, context: drilled.back.context }), true);
    await until(() => views.length > n);
    assert.equal(views.at(-1)!.path, undefined); assert.equal(views.at(-1)!.back, undefined);
    assert.equal(views.at(-1)!.panels[0].card, 'bar-chart');
  } finally {
    await mcp.close();
    ui.close();
    await vindu.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
