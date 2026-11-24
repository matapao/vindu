// The layout engine on its own: no server, no browser. Whole pixels, 1 px lines, every window filled exactly.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { place, insert, remove, resize, readLayout, shorthand, distribute, where, minWindow, viewsOf, slotOf, restore, openView, fits, setStack, setFront, stackInto, type LayoutNode, type Box } from '../src/layout.js';

const W = { w: 1440, h: 876 };
const read = (x: unknown, views = 'a b c d e f g h') => readLayout(x, new Set(views.split(' ')));
const tree = (x: unknown) => read(x).tree!;
const boxes = (t: LayoutNode | null, win = W) => Object.fromEntries(place(t, win).panes.map(p => [p.view, p.box]));

test('pixels are shared by weight, whole, never below a minimum while the minimums fit, and add up exactly', () => {
  assert.deepEqual(distribute(1439, [1, 1], [300, 300]), [720, 719]);
  assert.deepEqual(distribute(1000, [0.9, 0.1], [300, 300]), [700, 300]);
  assert.deepEqual(distribute(500, [1, 1], [300, 300]), [250, 250]); // the minimums do not fit: weights alone
  assert.deepEqual(distribute(10, [1, 1, 1], [0, 0, 0]), [4, 3, 3]);  // leftover pixels go to the earlier children
  for (const [avail, ws] of [[1437, [0.33, 0.2, 0.47]], [876, [1, 2, 3, 4]], [601, [5, 1]]] as const) assert.equal(distribute(avail, [...ws], ws.map(() => 100)).reduce((a, b) => a + b), avail);
});

test('one view sits in the middle: at most 1040 px wide, as tall as its content; one page takes the room', () => {
  const p = place(tree('a'), W);
  assert.equal(p.mode, 'single');
  assert.deepEqual(p.panes[0].box, { x: 200, y: 24, w: 1040, h: 828 });
  assert.equal(p.panes[0].fit, 'content');
  const page = place(tree('a'), W, { fill: new Set(['a']) });
  assert.deepEqual(page.panes[0].box, { x: 24, y: 24, w: 1392, h: 828 });
  assert.equal(page.panes[0].fit, undefined);
  assert.equal(place(null, W).mode, 'empty');
});

test('two views split the window with a 1 px line and nothing else', () => {
  const p = place(tree(['a', 'b']), W);
  assert.equal(p.mode, 'tiled');
  assert.deepEqual(p.panes.map(x => x.box), [{ x: 0, y: 0, w: 720, h: 876 }, { x: 721, y: 0, w: 719, h: 876 }]);
  assert.deepEqual(p.lines, [{ box: { x: 720, y: 0, w: 1, h: 876 }, dir: 'row', path: [], index: 0 }]);
  assert.deepEqual(boxes(tree(['a', { column: ['b', 'c'] }])), {
    a: { x: 0, y: 0, w: 720, h: 876 }, b: { x: 721, y: 0, w: 719, h: 438 }, c: { x: 721, y: 439, w: 719, h: 437 },
  });
  assert.deepEqual(boxes(tree([{ view: 'a', size: 2 }, 'b'])).a, { x: 0, y: 0, w: 959, h: 876 }); // two thirds of 1439
});

test('any layout in any window: panes and lines fill it exactly, without overlap, the same every time', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gen = (views: string[], depth: number): unknown => {
    if (views.length === 1 || depth > 3) return views[0];
    const k = Math.min(views.length, 2 + Math.floor(rnd() * 3)); const per = Math.ceil(views.length / k);
    const groups = Array.from({ length: k }, (_, i) => views.slice(i * per, (i + 1) * per)).filter(v => v.length);
    const kids = groups.map(v => { const g = gen(v, depth + 1), size = 0.5 + rnd() * 2; return typeof g === 'string' ? { view: g, size } : { ...(g as object), size }; });
    return { [rnd() < 0.5 ? 'row' : 'column']: kids };
  };
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (let n = 0; n < 300; n++) {
    const views = 'a b c d e f g h'.split(' ').slice(0, 2 + Math.floor(rnd() * 7));
    const t = read(gen(views, 0)).tree!;
    const win = { w: 600 + Math.floor(rnd() * 1400), h: 300 + Math.floor(rnd() * 900) };
    const p = place(t, win);
    // what is drawn: panes in sight, the lines between, and the strips of stacks; behind them, the other tabs' panes
    const rects = [...p.panes.filter(x => !x.behind).map(x => x.box!), ...p.lines.map(l => l.box), ...p.stacks.map(st => st.box)];
    assert.equal(rects.reduce((s, r) => s + r.w * r.h, 0), win.w * win.h, JSON.stringify({ t, win }));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.equal(overlap(rects[i], rects[j]), 0);
    assert.ok(rects.every(r => [r.x, r.y, r.w, r.h].every(Number.isInteger)));
    assert.deepEqual(place(t, win), p);
    assert.deepEqual(p.panes.map(x => x.view).sort(), viewsOf(t).sort()); // every view once, drawn or behind
    assert.ok(p.panes.every(x => (x.box === null) === !!x.behind));
    assert.equal(p.lines.length, p.splits.reduce((n, sp) => n + sp.extents.length - 1, 0));
  }
});

test('a row too narrow for its panes turns into a column when that fits, and says so', () => {
  const p = place(tree(['a', 'b', 'c']), { w: 800, h: 876 });
  assert.deepEqual(p.panes.map(x => x.box), [{ x: 0, y: 0, w: 800, h: 292 }, { x: 0, y: 293, w: 800, h: 291 }, { x: 0, y: 585, w: 800, h: 291 }]);
  assert.deepEqual(p.notes, ['row a | b | c needs 902 px across and has 800: shown top to bottom until there is room']);
  assert.deepEqual(minWindow(tree(['a', 'b', 'c'])), { w: 902, h: 180 });
  const tight = place(tree(['a', 'b', 'c']), { w: 800, h: 400 }); // neither way fits: a stack, until there is room
  assert.match(tight.notes[0], /stacked, with "c" in front, until there is room/);
  assert.match(place(setStack(tree(['a', 'b', 'c']), [], false), { w: 800, h: 400 }).notes[0], /its panes are smaller than 300 × 180/); // spread out by the person: weights alone, and noted
});

test('a phone-width window stacks the panes in reading order, each with its compact surface; a maximized pane takes the window', () => {
  const t = tree([{ column: ['a', 'b'] }, 'c']);
  const s = place(t, { w: 390, h: 844 });
  assert.equal(s.mode, 'stacked');
  assert.deepEqual(s.panes.map(p => [p.view, p.box, p.compact]), [['a', null, true], ['b', null, true], ['c', null, true]]);
  const m = place(t, W, { maximized: 'b' });
  assert.equal(m.mode, 'maximized'); assert.deepEqual(m.panes.map(p => [p.view, p.box]), [['b', { x: 0, y: 0, w: 1440, h: 876 }]]);
  assert.equal(place(t, W).panes.find(p => p.view === 'c')!.compact, false);
  assert.equal(place(tree(['a', 'b', 'c']), W).panes[0].compact, true); // 480 px wide: the compact surface
});

test('a new view goes into the largest pane, split along its longer side; or beside the view named', () => {
  let t: LayoutNode | null = null; const steps: unknown[] = [];
  for (const v of ['a', 'b', 'c', 'd', 'e']) { t = insert(t, v, W).tree; steps.push(shorthand(t)); }
  assert.deepEqual(steps, [
    'a',
    { row: ['a', 'b'] },
    { row: ['a', { column: ['b', 'c'] }] },
    { row: [{ column: ['a', 'd'] }, { column: ['b', 'c'] }] },
    { row: [{ column: ['a', 'd'] }, { column: ['b', { row: ['c', 'e'] }] }] },
  ]);
  const beside = insert(tree(['a', 'b']), 'c', W, { place: { beside: 'b', side: 'left', size: 0.3 } });
  assert.deepEqual(shorthand(beside.tree), { row: ['a', { row: [{ view: 'c', size: 0.3 }, { view: 'b', size: 0.7 }] }] });
  const below = insert(tree('a'), 'b', W, { place: { beside: 'a', side: 'below', size: 0.25 } });
  assert.deepEqual(shorthand(below.tree), { column: [{ view: 'a', size: 0.75 }, { view: 'b', size: 0.25 }] });
  assert.match(insert(tree('a'), 'b', W, { place: { beside: 'zz' } }).notes[0], /no pane "zz"/);
  assert.deepEqual(viewsOf(insert(tree(['a', 'b']), 'a', W).tree), ['b', 'a']); // a view is in one pane at most
});

test('a new view splits a pane the way it is drawn, even in a row a narrow window turned, and nothing else moves', () => {
  const win = { w: 800, h: 700 };
  const t = tree(['a', 'b', 'c']); // a row, drawn top to bottom at 800 px
  const before = place(t, win);
  assert.deepEqual(before.panes.map(p => p.box), [{ x: 0, y: 0, w: 800, h: 233 }, { x: 0, y: 234, w: 800, h: 233 }, { x: 0, y: 468, w: 800, h: 232 }]);
  const r = insert(t, 'd', win);
  const after = place(r.tree, win);
  assert.deepEqual(after.panes.map(p => [p.view, p.box]), [
    ['a', { x: 0, y: 0, w: 800, h: 233 }], ['b', { x: 0, y: 234, w: 800, h: 233 }],
    ['c', { x: 0, y: 468, w: 400, h: 232 }], ['d', { x: 401, y: 468, w: 399, h: 232 }], // c's pane, split side by side
  ]);
  assert.equal(r.stackedWith, undefined);
  assert.ok(after.notes.every(n => !/smaller than/.test(n)), after.notes.join('; '));
});

test('a split counts what a child split will need when it has to turn', () => {
  const p = place(tree({ column: ['a', ['b', 'c', 'd']] }), { w: 700, h: 876 }); // the row cannot fit 700 px, so it will stack
  assert.ok(p.panes.every(x => x.box!.w >= 300 && x.box!.h >= 180), JSON.stringify(p.panes));
  assert.deepEqual(p.panes.map(x => x.box!.h), [333, 180, 180, 180]);
  assert.deepEqual(p.notes, ['row b | c | d needs 902 px across and has 700: shown top to bottom until there is room']);
});

test('with no room for another pane, the new view joins a stack with the one used longest ago, in front: nothing is hidden', () => {
  const small = { w: 700, h: 400 };
  let t: LayoutNode | null = null;
  for (const v of ['a', 'b', 'c', 'd']) t = insert(t, v, small).tree;
  const r = insert(t, 'e', small, { recent: ['b', 'a', 'c', 'd'] });
  assert.equal(r.stackedWith, 'b');
  assert.deepEqual(viewsOf(r.tree).sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.match(r.notes[0], /no room for another pane at 700 × 400 \(a pane needs 300 × 180\): stacked with "b", in front; "b" is a tab behind it/);
  const p = place(r.tree, small);
  assert.deepEqual(p.stacks.map(st => [st.tabs.map(x => x.views), st.front]), [[[['b'], ['e']], 1]]);
  assert.deepEqual(p.panes.filter(x => x.behind).map(x => x.view), ['b']);
  const e = p.panes.find(x => x.view === 'e')!, strip = p.stacks[0].box;
  assert.deepEqual([e.box!.y - strip.y, strip.h, e.box!.w], [28, 28, strip.w]); // under its strip of tabs, the stack's whole width
});

test('a stack: one child in front under a strip of tabs, the others behind and not drawn; its tabs share the strip', () => {
  const t = tree(['a', { stack: ['b', 'c', 'd'], front: 'c' }]);
  assert.deepEqual(shorthand(t), { row: ['a', { stack: ['b', 'c', 'd'], front: 'c' }] });
  const p = place(t, W);
  assert.deepEqual(p.stacks, [{ path: [1], box: { x: 721, y: 0, w: 719, h: 28 }, front: 1, tabs: [
    { index: 0, views: ['b'], box: { x: 721, y: 0, w: 240, h: 28 } }, { index: 1, views: ['c'], box: { x: 961, y: 0, w: 240, h: 28 } }, { index: 2, views: ['d'], box: { x: 1201, y: 0, w: 239, h: 28 } }] }]);
  assert.deepEqual(p.panes.map(x => [x.view, x.box, x.behind ?? false]), [['a', { x: 0, y: 0, w: 720, h: 876 }, false], ['b', null, true], ['c', { x: 721, y: 28, w: 719, h: 848 }, false], ['d', null, true]]);
  assert.deepEqual(minWindow(tree({ stack: ['a', 'b'] })), { w: 300, h: 208 }); // one at a time, and its strip
  assert.equal(place(tree({ stack: ['a', 'b'] }), W, { asks: new Set(['a']) }).stacks[0].front, 0); // what asks the person is never behind
  assert.equal(place(tree({ stack: ['a', 'b'] }), W, { asks: new Set(['a']) }).stacks[0].why, 'ask');
  // other libraries' tabbed stacks are read as stacks
  const g = read({ type: 'stack', content: [{ type: 'component', componentName: 'a' }, { type: 'component', componentName: 'b' }], activeItemIndex: 0 });
  assert.deepEqual(shorthand(g.tree), { stack: ['a', 'b'], front: 'a' });
  assert.ok(g.notes.includes('read {"type": "stack"} as {"stack": [...]}'), g.notes.join('; '));
});

test('a split that does not fit even turned is drawn as a stack until there is room, the most recent in front; spread out by the person, it is not', () => {
  const t = tree(['a', 'b', 'c', 'd']);
  const p = place(t, { w: 700, h: 500 }, { recent: ['a', 'c', 'd', 'b'] });
  assert.deepEqual(p.stacks.map(st => [st.auto, st.front, st.tabs.length]), [[true, 1, 4]]); // b, used last
  assert.deepEqual(p.notes, ['row a | b | c | d needs 1203 px across and has 700: stacked, with "b" in front, until there is room']);
  assert.equal(place(t, W).stacks.length, 0); // room: spread as written
  const spread = setStack(t, [], false)!;
  const q = place(spread, { w: 700, h: 500 });
  assert.equal(q.stacks.length, 0); assert.match(q.notes[0], /its panes are smaller than 300 × 180 \(spread out by the person\)/);
  // the person stacks a split, brings a tab in front, spreads it out; a view that leaves keeps the one in front
  const s1 = setStack(tree(['a', ['b', 'c']]), [1], true, ['b', 'c'])!;
  assert.deepEqual(shorthand(s1), { row: ['a', { stack: ['b', 'c'], front: 'c' }] });
  assert.deepEqual(shorthand(setFront(s1, [1], 0)), { row: ['a', { stack: ['b', 'c'], front: 'b' }] });
  assert.equal(setFront(s1, [1], 5), null); assert.equal(setStack(s1, [0], true), null);
  assert.deepEqual(shorthand(remove(tree({ stack: ['a', 'b', 'c'], front: 'c' }), 'a')), { stack: ['b', 'c'], front: 'c' });
  assert.deepEqual(shorthand(remove(tree({ stack: ['a', 'b', 'c'], front: 'b' }), 'b')), { stack: ['a', 'c'], front: 'a' });
  // into: the model puts a new view in a view's stack, in front: one is made of its pane, or it joins the one there is
  const into = insert(tree(['a', 'b']), 'c', W, { place: { into: 'b' } });
  assert.deepEqual([shorthand(into.tree), into.stackedWith], [{ row: ['a', { stack: ['b', 'c'], front: 'c' }] }, 'b']);
  assert.deepEqual(shorthand(stackInto(into.tree, 'b', 'd')), { row: ['a', { stack: ['b', 'd', 'c'], front: 'd' }] });
  assert.match(insert(tree(['a', 'b']), 'c', W, { place: { into: 'x' } }).notes[0], /there is no pane "x" to stack it with/);
});

test('removing a view gives its room to its neighbours; resizing sets shares', () => {
  assert.deepEqual(shorthand(remove(tree(['a', { column: ['b', 'c'] }]), 'b')), { row: ['a', 'c'] });
  assert.deepEqual(shorthand(remove(tree([{ view: 'a', size: 2 }, 'b', 'c']), 'c')), { row: [{ view: 'a', size: 0.67 }, { view: 'b', size: 0.33 }] });
  assert.equal(remove(tree('a'), 'a'), null);
  assert.deepEqual(shorthand(resize(tree(['a', 'b']), [], [0.7, 0.3])), { row: [{ view: 'a', size: 0.7 }, { view: 'b', size: 0.3 }] });
  assert.equal(resize(tree(['a', 'b']), [], [1]), null);
  assert.equal(resize(tree(['a', 'b']), [0], [1, 1]), null); // a pane is not a split
});

test('the layout form: names, lists, rows and columns, shares; other libraries\' shapes are read and noted', () => {
  assert.deepEqual(shorthand(tree({ row: ['a', { column: ['b', 'c'], size: '40%' }], size: 3 })), { row: [{ view: 'a', size: 0.6 }, { column: ['b', 'c'], size: 0.4 }] });
  assert.deepEqual(shorthand(tree([{ view: 'a', size: 0.7 }, 'b'])), { row: [{ view: 'a', size: 0.7 }, { view: 'b', size: 0.3 }] }); // what is left
  assert.deepEqual(shorthand(tree([{ view: 'a', size: 2 }, 'b'])), { row: [{ view: 'a', size: 0.67 }, { view: 'b', size: 0.33 }] }); // weights
  assert.deepEqual(shorthand(tree(['a', ['b', 'c']])), { row: ['a', { row: ['b', 'c'] }] }); // a row in a row stays as written
  const gl = read({ type: 'row', content: [{ type: 'column', content: ['a', 'b'] }, 'c'] });
  assert.deepEqual(shorthand(gl.tree), { row: [{ column: ['a', 'b'] }, 'c'] });
  assert.deepEqual(gl.notes, ['read {"type": "row"} as {"row": [...]}', 'read {"type": "column"} as {"column": [...]}']);
  const mosaic = read({ direction: 'column', first: 'a', second: { direction: 'row', first: 'b', second: 'c' }, splitPercentage: 70 });
  assert.deepEqual(shorthand(mosaic.tree), { column: [{ view: 'a', size: 0.7 }, { row: ['b', 'c'], size: 0.3 }] });
  const bad = read(['a', 'zz', 'a', { view: 'b', size: 'big' }, 42]);
  assert.deepEqual(bad.unknown, ['zz']);
  assert.deepEqual(bad.notes, ['"a" is in the layout twice; kept the first', 'read size "big" as an equal share', 'left out 42: not a view name, a list, {"row": [...]}, {"column": [...]} or {"view": name}']);
  for (const x of [['a', { column: ['b', { row: ['c', 'd'], size: 2 }] }], { column: [{ view: 'a', size: 0.2 }, 'b'] }]) {
    const t = tree(x); assert.deepEqual(shorthand(tree(shorthand(t))), shorthand(t), 'the account\'s layout reads back as the same layout');
  }
});

test('where a pane is, in words', () => {
  assert.equal(where({ x: 0, y: 0, w: 720, h: 876 }, W), 'left, full height');
  assert.equal(where({ x: 721, y: 0, w: 719, h: 438 }, W), 'top right');
  assert.equal(where({ x: 0, y: 600, w: 1440, h: 276 }, W), 'bottom, full width');
  assert.equal(where({ x: 0, y: 0, w: 1440, h: 876 }, W), 'the whole window');
  assert.equal(where({ x: 480, y: 300, w: 480, h: 276 }, W), 'centre');
});

test('a view collapsed into the shelf opens where it was: the layout as it was, or beside what was beside it', () => {
  const t = tree([{ view: 'a', size: 0.7 }, { column: ['b', 'c'], size: 0.3 }]);
  const slot = slotOf(t, 'b')!;
  assert.deepEqual([slot.by, slot.side, slot.size], [['c'], 'above', 0.5]); // b was above c, half of their column
  const without = remove(t, 'b');
  assert.deepEqual(shorthand(restore(without, 'b', slot)), shorthand(t)); // nothing else changed: exactly as it was
  // the layout changed since: b goes back above what was beside it, at its share
  const moved = resize(without, [], [0.5, 0.5])!;
  assert.deepEqual(shorthand(restore(moved, 'b', slot)), { row: ['a', { column: ['b', 'c'] }] });
  // in a row of three, the middle one goes back between the two, and the others keep their proportions
  const row = tree(['a', 'b', 'c']), mid = slotOf(row, 'b')!;
  assert.deepEqual([mid.by, mid.side], [['a'], 'right']);
  const r = restore(resize(remove(row, 'b'), [], [0.6, 0.4]), 'b', mid)!;
  assert.deepEqual(viewsOf(r), ['a', 'b', 'c']);
  assert.deepEqual(shorthand(r), { row: [{ view: 'a', size: 0.4 }, { view: 'b', size: 0.33 }, { view: 'c', size: 0.27 }] });
  assert.equal(restore(tree(['d', 'e']), 'b', slotOf(tree(['b', 'c']), 'b')!), null); // nothing it was beside is left
  assert.deepEqual(restore(null, 'b', mid), { view: 'b', size: 1 });
});

test('a view put back beside a tab of a stack comes in front, and the tab that was in front stays a tab', () => {
  const stack = tree({ stack: ['a', 'b'], front: 'a' });
  const slot = slotOf(tree({ column: ['a', 'c'] }), 'c')!; // c was below a, before a was stacked with b
  assert.deepEqual(shorthand(restore(stack, 'c', slot)), { stack: ['a', 'c', 'b'], front: 'c' });
  const above = slotOf(tree({ column: ['c', 'b'] }), 'c')!; // above b, the tab behind
  assert.deepEqual(shorthand(restore(stack, 'c', above)), { stack: ['a', 'c', 'b'], front: 'c' });
});

test('where a view opens: beside a view named, back in its slot when that fits, or as a new view does', () => {
  const t = tree(['a', 'b']), slot = slotOf(t, 'b')!;
  const back = openView(remove(t, 'b'), 'b', W, { slot });
  assert.equal(back.how, 'where it was'); assert.deepEqual(shorthand(back.tree), { row: ['a', 'b'] });
  const dropped = openView(remove(t, 'b'), 'b', W, { slot, place: { beside: 'a', side: 'below' } });
  assert.equal(dropped.how, 'below "a"'); assert.deepEqual(shorthand(dropped.tree), { column: ['a', 'b'] });
  const fresh = openView(tree(['a', 'c']), 'b', W);
  assert.equal(fresh.how, 'where there was most room');
  // where it was does not fit a window this small any more: it opens as a new view does, and says so
  const small = { w: 640, h: 400 }, six = tree([{ column: ['a', 'c'] }, { column: ['d', { row: ['b', 'e'] }] }]);
  assert.equal(fits(six, small), false);
  const tight = openView(remove(six, 'b'), 'b', small, { slot: slotOf(six, 'b')! });
  assert.match(tight.notes[0], /where it was does not fit the window now \(640 × 400\), so it opened as a new view does/);
});
