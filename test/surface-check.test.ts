import assert from 'node:assert/strict';
import { test } from 'vitest';
import { checkSurface } from '../src/surface-check.js';
import type { Component, Surface } from '../src/a2ui.js';

function surface(components: Component[], value: unknown = {}): Surface {
  return [
    { version: 'v0.9', updateComponents: { surfaceId: 'task', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 'task', path: '/', value } },
  ];
}

test('preflight follows the A2UI catalog for modal and tab child references', () => {
  const components = [
    { id: 'root', component: 'Modal', trigger: 'button', content: 'tabs' },
    { id: 'button', component: 'Text', text: 'Details' },
    { id: 'tabs', component: 'Tabs', tabs: [{ title: 'Overview', child: 'content' }] },
    { id: 'content', component: 'Text', text: { path: '/field~1name' } },
  ];
  assert.deepEqual(checkSurface(surface(components, { 'field/name': 'Value' })), []);
  const staticText = surface([{ id: 'root', component: 'Text', text: 'No data binding' }]);
  assert.deepEqual(checkSurface(staticText.slice(0, 1)), []);
});

test('preflight checks a shared template in each row context and retains host diagnostics', () => {
  const components = [
    { id: 'root', component: 'HostGroup', children: ['first', 'second', 'missing'] },
    { id: 'first', component: 'List', children: { path: '/first', componentId: 'row' } },
    { id: 'second', component: 'List', children: { path: '/second', componentId: 'row' } },
    { id: 'row', component: 'Text', text: { path: 'name' } },
    { id: 'orphan', component: 'Text' },
    { id: 'orphan', component: 'Text' },
  ];
  assert.deepEqual(checkSurface(surface(components, { first: [{ name: 'ok' }], second: [{}] })), [
    'duplicate id orphan',
    'row.text reads name, which is empty',
    'missing component missing',
    'unreached component orphan',
  ]);
});

test('A2UI cycles and forbidden paths return diagnostics to the host', () => {
  const cycle = [
    { id: 'root', component: 'Card', child: 'child' },
    { id: 'child', component: 'Card', child: 'root' },
  ];
  assert.match(checkSurface(surface(cycle)).join(), /circular/i);
  const privatePath = [{ id: 'root', component: 'Text', text: { path: '/constructor' } }];
  assert.match(checkSurface(surface(privatePath)).join(), /forbidden path/i);
});

test('preflight enforces the display budget before reading components', () => {
  const components = Array<Component>(8193).fill({ id: 'one', component: 'Text' });
  assert.deepEqual(checkSurface(surface(components)), ['surface exceeds the rendering limits']);
});
