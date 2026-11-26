import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Shell } from '../src/shell.js';

const meta = { title: 'Private title', subtitle: 'Private subtitle', panels: 'Private custom card', fill: false };

test('the layout uses the pane allocation before and after content is measured', () => {
  const shell = new Shell();
  assert.deepEqual(shell.layoutGeometry(), {
    viewport: { w: 1280, h: 800, source: 'estimated' },
    mode: 'empty',
    paneCount: 0,
    collapsedCount: 0,
    tree: null,
  });
  const name = 'Private invoice',
    panel = 'Private account';
  shell.show(name, meta);
  shell.event({ type: 'window', w: 1000, h: 600 });
  const expected = {
    viewport: { w: 1000, h: 600, source: 'reported' },
    mode: 'single',
    paneCount: 1,
    collapsedCount: 0,
    tree: { pane: 1, room: { x: 24, y: 24, w: 952, h: 552 } },
  };
  assert.deepEqual(shell.layoutGeometry(), expected);
  shell.event({
    type: 'measure',
    views: { [name]: { content: 8321, visible: 37, sight: { [panel]: { first: 7, last: 302, n: 296, of: 7456 } } } },
  });
  shell.setVerified(name, { text: 'Private value', html: '<p>Private HTML</p>', url: 'https://private.invalid' });
  shell.setPicked([{ view: name, panel, text: 'Private selection' }], [name]);
  shell.mark(name, { text: 'Private mark', by: 'person' });
  shell.setReminders({ due: 928, set: 737 });
  shell.tell('Private activity');
  assert.deepEqual(shell.layoutGeometry(), expected);
  assert.deepEqual(shell.takeElsewhere(), ['Private activity']);
});

test('anonymous geometry follows rotated splits, hidden tabs, maximization and phone flow', () => {
  const shell = new Shell();
  const names = ['private first', 'private second', 'private third'];
  for (const name of names) shell.show(name, meta);
  shell.setLayout(names);
  shell.event({ type: 'window', w: 700, h: 800 }); // the requested row fits as a column here
  assert.deepEqual(shell.layoutGeometry().tree, {
    direction: 'column',
    children: [
      { pane: 1, room: { x: 0, y: 0, w: 700, h: 266 } },
      { pane: 2, room: { x: 0, y: 267, w: 700, h: 266 } },
      { pane: 3, room: { x: 0, y: 534, w: 700, h: 266 } },
    ],
  });
  shell.event({ type: 'window', w: 700, h: 400 }); // automatic stack
  assert.deepEqual(shell.layoutGeometry().tree, {
    tabs: [{ pane: 1 }, { pane: 2 }, { pane: 3, room: { x: 0, y: 28, w: 700, h: 372 } }],
    front: 2,
  });
  shell.event({ type: 'maximize', view: names[1] });
  assert.deepEqual(shell.layoutGeometry().tree, { pane: 2, room: { x: 0, y: 0, w: 700, h: 400 } });
  assert.equal(shell.layoutGeometry().paneCount, 3);
  shell.event({ type: 'window', w: 390, h: 700 }); // content controls heights; no vertical measurements are reported
  assert.deepEqual(shell.layoutGeometry().tree, {
    direction: 'column',
    children: [
      { pane: 1, width: 390 },
      { pane: 2, width: 390 },
      { pane: 3, width: 390 },
    ],
  });
  shell.event({ type: 'collapse', view: names[0] });
  const after = shell.layoutGeometry();
  assert.equal(after.collapsedCount, 1);
  assert.equal(after.paneCount, 2);
  assert.deepEqual(after.tree, {
    direction: 'column',
    children: [
      { pane: 1, width: 390 },
      { pane: 2, width: 390 },
    ],
  });
});
