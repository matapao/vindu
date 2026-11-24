// A browser view's page, over a scripted CDP: no key reaches a secret field but those that move on from it, so nothing in
// it is selected, copied or cut; textareas and editable elements are fields too; the accessibility tree is read within
// bounds however the page builds it; key names the prototype has are no keys; and a page that cannot go where it was
// opened to is not left half made.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BrowserPage, Browsers, type Cdp } from '../src/index.js';
import { fieldPrivacy, SECRET_REFUSED } from '../src/views/browser-fields.js';
import { readAccessibleTree, TREE_LIMITS } from '../src/views/browser-accessibility.js';
import { SECRET_FIELDS } from '../src/views/browser-requests.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function scripted(onSend: (method: string, params: any) => unknown): Cdp {
  return { send: async (m, p) => onSend(m, p) ?? {}, on: () => () => {} };
}
/** A page whose focused element is described by `focused` (DOM.describeNode's node), and the keys that reach it. */
function focusedOn(focused: { nodeName: string; attributes: string[] }) {
  const keys: string[] = [];
  const page = new BrowserPage('p', scripted((method, params) => {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'focused' } };
    if (method === 'DOM.describeNode') return { node: focused };
    if (method === 'Input.dispatchKeyEvent') keys.push(`${params.type} ${params.key}`);
    return {};
  }));
  return { page, keys };
}

test('in a secret field only Tab, Shift+Tab, Escape and Enter go in: no select-all, copy, cut, paste, arrow or character', async () => {
  const { page, keys } = focusedOn({ nodeName: 'INPUT', attributes: ['type', 'text', 'autocomplete', 'cc-number'] });
  for (const combo of ['Control+a', 'Control+c', 'Meta+c', 'Control+x', 'Meta+x', 'Control+v', 'Shift+ArrowLeft', 'ArrowDown', 'Home', 'a', 'Space', 'Backspace', 'Alt+ArrowLeft', 'Control+Tab'])
    await assert.rejects(page.press(combo), (e: Error) => e.message === SECRET_REFUSED, combo);
  assert.deepEqual(keys, []);
  for (const combo of ['Tab', 'Shift+Tab', 'Escape', 'Enter']) await page.press(combo);
  assert.deepEqual(keys, ['rawKeyDown Tab', 'keyUp Tab', 'rawKeyDown Tab', 'keyUp Tab', 'rawKeyDown Escape', 'keyUp Escape', 'keyDown Enter', 'keyUp Enter']);
  const { page: open, keys: typed } = focusedOn({ nodeName: 'INPUT', attributes: ['name', 'customer'] }); // a public field: as before
  for (const combo of ['Control+a', 'Control+c', 'ArrowDown', 'a']) await open.press(combo);
  assert.equal(typed.length, 8);
});

test('key names the prototype has are no keys or modifiers', async () => {
  const { page } = focusedOn({ nodeName: 'BODY', attributes: [] });
  for (const combo of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) await assert.rejects(page.press(combo), /no key/, combo);
  for (const combo of ['toString+a', 'constructor+a', '__proto__+a']) await assert.rejects(page.press(combo), /no modifier/, combo);
});

test('a textarea or an editable element marked as secret is a secret field', async () => {
  const privacy = (nodeName: string, attributes: string[]) => fieldPrivacy(scripted(() => ({ node: { nodeName, attributes } })), { backendNodeId: 1 });
  assert.equal(await privacy('TEXTAREA', ['autocomplete', 'one-time-code']), 'secret');
  assert.equal(await privacy('DIV', ['contenteditable', '', 'autocomplete', 'cc-csc']), 'secret');
  assert.equal(await privacy('TEXTAREA', ['name', 'notes']), 'public');
  assert.equal(await privacy('DIV', ['autocomplete', 'cc-csc']), 'public'); // not editable: no field
  assert.equal(await privacy('TEXTAREA', ['odd']), 'unknown');
  assert.match(SECRET_FIELDS, /textarea\[autocomplete~="one-time-code"\]/);
  assert.match(SECRET_FIELDS, /\[contenteditable\]\[autocomplete~="cc-number"\]/);
});

const publicField = async () => 'public' as const;
test('the accessibility tree is read within bounds: deep, looping, wordy or wide, however the page builds it', async () => {
  // a page nested 50,000 deep, with a button at the bottom
  const deep = Array.from({ length: 50_000 }, (_, i) => ({ nodeId: String(i), ...(i ? { parentId: String(i - 1) } : {}), childIds: [String(i + 1)], role: { value: i ? 'generic' : 'RootWebArea' } }));
  deep.push({ nodeId: '50000', parentId: '49999', childIds: [], role: { value: 'button' }, name: { value: 'Deep' } } as any);
  const d = await readAccessibleTree(deep, publicField, 1500);
  assert.equal(d.references.size, 0); assert.ok(d.cut >= 1, String(d.cut)); // past the depth: left out, and said to be
  // a tree that loops back on itself
  const loop = [{ nodeId: 'a', childIds: ['b'], role: { value: 'RootWebArea' } }, { nodeId: 'b', parentId: 'a', childIds: ['a', 'b'], role: { value: 'button' }, name: { value: 'Again' }, backendDOMNodeId: 2 }];
  const l = await readAccessibleTree(loop, publicField, 1500);
  assert.equal(l.references.size, 1);
  // texts count as elements, and a long one is cut
  const long = 'x'.repeat(5_000_000);
  const texts = [{ nodeId: 'r', childIds: Array.from({ length: 3000 }, (_, i) => `t${i}`), role: { value: 'RootWebArea' } },
    ...Array.from({ length: 3000 }, (_, i) => ({ nodeId: `t${i}`, parentId: 'r', role: { value: 'StaticText' }, name: { value: i % 2 ? long : `word ${i}` } }))];
  const t = await readAccessibleTree(texts, publicField, 100);
  assert.ok(t.count <= 100, String(t.count)); assert.ok(t.cut >= 2900, String(t.cut));
  const bytes = JSON.stringify(t.tree).length;
  assert.ok(bytes <= 100 * (TREE_LIMITS.text + 40), `${bytes} bytes`);
  // and however many are asked for, at most TREE_LIMITS.nodes
  const wide = [{ nodeId: 'r', childIds: Array.from({ length: 9000 }, (_, i) => `b${i}`), role: { value: 'RootWebArea' } },
    ...Array.from({ length: 9000 }, (_, i) => ({ nodeId: `b${i}`, parentId: 'r', role: { value: 'button' }, name: { value: `B${i}` }, backendDOMNodeId: i + 1 }))];
  const w = await readAccessibleTree(wide, publicField, 1e9);
  assert.equal(w.count, TREE_LIMITS.nodes); assert.equal(w.references.size, TREE_LIMITS.nodes - 1); assert.equal(w.cut, 9000 - (TREE_LIMITS.nodes - 1)); // the page itself counts
  assert.equal(w.references.get('e1'), 1); // in document order
});

test('a page that cannot go where it was opened to is not left half made', async () => {
  const failed: string[] = [];
  const browsers = new Browsers(async () => scripted(method => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F', url: 'about:blank' } } };
    if (method === 'Page.navigate') throw new Error('the browser went away');
    return {};
  }), undefined, id => failed.push(id));
  await assert.rejects(browsers.create('https://example.invalid/', { id: 'b' }), /went away/);
  assert.equal(browsers.has('b'), false);
  assert.deepEqual(failed, ['b']);
  assert.deepEqual(browsers.list(), []);
});
