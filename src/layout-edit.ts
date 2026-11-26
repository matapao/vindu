// Changing a layout: the canonical form (tidy), a view opened, moved, removed or stacked, a split resized, and where a
// view goes back to when it leaves the tiles for the shelf (its slot). Each change is checked against the window it is
// drawn in (place, layout.ts), so what the model is told is what is drawn.
import { clone, frontOf, isPane, layoutOptions, nodeAt, panesOf, place, shareOf, sum, tile, viewsOf, type Box, type LayoutNode, type LayoutOptions, type Pane, type Place, type Placement, type Side, type Size, type Split } from './layout.js';

/** The canonical form: no single-child splits, and shares that add up to 1 in each split. A split inside one running
 *  the same way is kept as written: it is drawn on its own, and a narrow window may turn the one and not the other. */
export function tidy(n: LayoutNode | null): LayoutNode | null {
  if (!n) return null;
  const rec = (n: LayoutNode): LayoutNode => {
    const size = Number.isFinite(n.size) && n.size > 0 ? n.size : 1;
    if (isPane(n)) return { view: n.view, size };
    const kids = n.children.map(rec);
    if (!kids.length) throw new Error('empty split');
    if (kids.length === 1) return { ...kids[0], size };
    const total = sum(kids.map(c => c.size));
    return { dir: n.dir, size, children: kids.map(c => ({ ...c, size: c.size / total })), ...(n.stack ? { stack: true as const } : {}), ...(n.spread ? { spread: true as const } : {}),
      ...(Number.isInteger(n.front) && n.front! >= 0 ? { front: Math.min(n.front!, kids.length - 1) } : {}) };
  };
  return { ...rec(n), size: 1 };
}

function splitBeside(tree: LayoutNode, target: string, view: string, side: Side, share: number): LayoutNode {
  const dir = side === 'left' || side === 'right' ? 'row' : 'column';
  const s = shareOf(Number.isFinite(share) ? share : 0.5);
  const rec = (n: LayoutNode): LayoutNode => {
    if (!isPane(n)) return { ...n, children: n.children.map(rec) };
    if (n.view !== target) return n;
    const add: Pane = { view, size: s }, keep: Pane = { view: target, size: 1 - s };
    return { dir, size: n.size, children: side === 'left' || side === 'above' ? [add, keep] : [keep, add] };
  };
  return tidy(rec(clone(tree)))!;
}

/** Take a view out; its neighbours share its room. */
export function remove(tree: LayoutNode | null, view: string): LayoutNode | null {
  const rec = (n: LayoutNode): LayoutNode | null => {
    if (isPane(n)) return n.view === view ? null : n;
    const all = n.children.map(rec); const kids = all.filter((c): c is LayoutNode => !!c);
    if (!kids.length) return null;
    if (kids.length === 1) return { ...kids[0], size: n.size };
    if (n.front === undefined) return { ...n, children: kids };
    const gone = all.slice(0, n.front).filter(c => !c).length; // the one in front keeps its place; if it went, the one before it
    return { ...n, children: kids, front: all[n.front] ? n.front - gone : Math.max(0, n.front - gone - 1) };
  };
  return tree ? tidy(rec(clone(tree))) : null;
}

/** New shares for the children of the split at path (from dragging a line). null when they do not fit the split. */
export function resize(tree: LayoutNode | null, path: number[], sizes: number[]): LayoutNode | null {
  const t = tree && clone(tree); const at = nodeAt(t, path);
  if (!t || !at || isPane(at) || sizes.length !== at.children.length || !sizes.every(s => Number.isFinite(s) && s > 0)) return null;
  at.children.forEach((c, i) => { c.size = sizes[i]; });
  return tidy(t);
}

/** Put a new view in: beside a named view, or else in the largest pane as drawn, split along its longer side (the new
 *  view right or below), where both halves keep the minimum size and no other pane moves. With no room anywhere, it
 *  joins a stack with the view shown or used longest ago (recent: least recent first), in front: nothing is hidden. */
export function insert(tree: LayoutNode | null, view: string, window: Size, o: { place?: Place; recent?: string[]; options?: Partial<LayoutOptions> } = {}): { tree: LayoutNode; notes: string[]; stackedWith?: string } {
  const opt = layoutOptions(o.options); const notes: string[] = [];
  const base = remove(tree, view);
  if (!base) return { tree: { view, size: 1 }, notes };
  if (o.place?.into) {
    if (viewsOf(base).includes(o.place.into)) return { tree: stackInto(base, o.place.into, view), notes, stackedWith: o.place.into };
    notes.push(`there is no pane "${o.place.into}" to stack it with; placed it where there was most room`);
  } else if (o.place?.beside) {
    if (viewsOf(base).includes(o.place.beside)) return { tree: splitBeside(base, o.place.beside, view, o.place.side ?? 'right', o.place.size ?? 0.5), notes };
    notes.push(`there is no pane "${o.place.beside}" to place it beside; placed it where there was most room`);
  }
  const win = window.w >= opt.phone ? window : { w: 1280, h: 800 }; // a phone stacks panes in order; plan the tiles for a desktop
  const tiled: Placement = { mode: 'tiled', window: win, panes: [], lines: [], splits: [], stacks: [], notes: [] };
  tile(base, { x: 0, y: 0, w: Math.floor(win.w), h: Math.floor(win.h) }, [], opt, tiled);
  // the largest panes first; panes within 2 % of the largest count as equal (a pixel of rounding is no reason), and of
  // equals the last in reading order goes first, so new views fill in to the right and below
  const rooms = tiled.panes.map((p, i) => ({ p, i, area: p.box ? p.box.w * p.box.h : -1 })).filter(r => r.area >= 0); // a tab behind has no room of its own
  const top = Math.max(...rooms.map(r => r.area)) * 0.98;
  const key = (r: { area: number }) => (r.area >= top ? Infinity : r.area);
  const byRoom = rooms.sort((a, b) => descending(key(a), key(b)) || b.i - a.i);
  // a candidate counts only if, placed, it splits that one pane in two halves of at least the minimum, and every other
  // pane keeps its box: judged on the drawn picture, so a split that is drawn turned is split the way it looks
  const was = new Map(tiled.panes.map(p => [p.view, JSON.stringify(p.box)]));
  const halves = (t: LayoutNode, target: string, b: Box) => {
    const after: Placement = { mode: 'tiled', window: win, panes: [], lines: [], splits: [], stacks: [], notes: [] };
    tile(t, { x: 0, y: 0, w: Math.floor(win.w), h: Math.floor(win.h) }, [], opt, after);
    return after.panes.every(({ view: v, box: x }) => v === target || v === view
      ? !!x && x.x >= b.x && x.y >= b.y && x.x + x.w <= b.x + b.w && x.y + x.h <= b.y + b.h && x.w >= opt.min.w && x.h >= opt.min.h
      : JSON.stringify(x) === was.get(v));
  };
  for (const { p } of byRoom) {
    const b = p.box; if (!b) continue; // behind, in a stack
    for (const ax of b.w >= b.h ? (['row', 'column'] as const) : (['column', 'row'] as const)) {
      const along = ax === 'row' ? b.w : b.h, min = ax === 'row' ? opt.min.w : opt.min.h;
      if (Math.floor((along - opt.line) / 2) < min) continue;
      const t = splitBeside(base, p.view, view, ax === 'row' ? 'right' : 'below', 0.5);
      if (halves(t, p.view, b)) return { tree: t, notes };
    }
  }
  // no room anywhere: it joins a stack with the pane shown or used longest ago, in front; nothing is hidden
  const drawn = new Set(tiled.panes.filter(p => p.box).map(p => p.view));
  const old = (o.recent ?? []).find(v => drawn.has(v)) ?? tiled.panes.find(p => p.box)?.view ?? viewsOf(base)[0];
  notes.push(`no room for another pane at ${Math.floor(win.w)} × ${Math.floor(win.h)} (a pane needs ${opt.min.w} × ${opt.min.h}): stacked with "${old}", in front; "${old}" is a tab behind it`);
  return { tree: stackInto(base, old, view), notes, stackedWith: old };
}

/** A sort's order of two numbers, the larger first (Infinity too: no subtraction). */
function descending(a: number, b: number): number {
  if (b === a) return 0;
  return b > a ? 1 : -1;
}

/** A view into the stack of a view already shown, in front: the stack it is in, or one made of its pane. */
export function stackInto(tree: LayoutNode, target: string, view: string): LayoutNode {
  const rec = (n: LayoutNode): LayoutNode => {
    if (isPane(n)) return n.view === target ? { dir: 'column', size: n.size, stack: true, front: 1, children: [{ view: target, size: 0.5 }, { view, size: 0.5 }] } : n;
    const i = n.children.findIndex(c => isPane(c) && c.view === target);
    if (i >= 0 && n.stack) { const kids = [...n.children]; kids.splice(i + 1, 0, { view, size: 1 / n.children.length }); return { ...n, children: kids, front: i + 1 }; }
    return { ...n, children: n.children.map(rec) };
  };
  return tidy(rec(clone(tree)))!;
}

/** The person stacks the split at path (on), or spreads it out again (off): then it is never drawn as a stack, even
 *  without room, until they stack it again. null when there is no split there. */
export function setStack(tree: LayoutNode | null, path: number[], on: boolean, recent: readonly string[] = []): LayoutNode | null {
  const t = tree && clone(tree); const at = nodeAt(t, path);
  if (!t || !at || isPane(at)) return null;
  if (on) { at.stack = true; delete at.spread; if (at.front === undefined) at.front = frontOf({ ...at, front: undefined }, { recent }).front; }
  else { delete at.stack; at.spread = true; }
  return tidy(t);
}
/** The child at index comes in front of the split at path, drawn as a stack. null when there is none. */
export function setFront(tree: LayoutNode | null, path: number[], index: number): LayoutNode | null {
  const t = tree && clone(tree); const at = nodeAt(t, path);
  if (!t || !at || isPane(at) || !Number.isInteger(index) || index < 0 || index >= at.children.length) return null;
  at.front = index;
  return tidy(t);
}

/** Whether every pane keeps its minimum size in this window, as tiled (a phone-width window stacks, and always fits). */
export function fits(tree: LayoutNode | null, window: Size, o?: Partial<LayoutOptions>): boolean {
  const opt = layoutOptions(o);
  if (!tree || window.w < opt.phone) return true;
  const p = place(tree, window, { options: opt });
  return p.mode !== 'tiled' || (!p.stacks.some(x => x.auto) && p.panes.every(x => !x.box || (x.box.w >= opt.min.w && x.box.h >= opt.min.h))); // stacked for want of room: it does not fit
}

/** Where a view was before it left the tiles for the shelf: the views of the part of the layout beside it, the side of
 *  them it was on, its share of their split and how many shared it, and the whole layout as it was then. */
export type Slot = { by: string[]; side: Side; size: number; of?: number; tree: LayoutNode };
const sig = (n: LayoutNode | null) => JSON.stringify(n, (k, v) => (k === 'size' ? Math.round((v as number) * 1e4) : v));

/** The slot a view's pane is in now, for when it leaves; undefined when it has no pane. Its neighbour is the child of
 *  its split just before it, or else just after it. */
export function slotOf(tree: LayoutNode | null, view: string): Slot | undefined {
  const at = panesOf(tree).find(p => p.view === view);
  if (!tree || !at) return undefined;
  if (!at.path.length) return { by: [], side: 'right', size: 1, of: 1, tree: clone(tree) };
  const split = nodeAt(tree, at.path.slice(0, -1)) as Split, i = at.path[at.path.length - 1], after = i > 0;
  let side: Side;
  if (split.dir === 'row') side = after ? 'right' : 'left';
  else side = after ? 'below' : 'above';
  return { by: viewsOf(split.children[after ? i - 1 : i + 1]), side, size: split.children[i].size, of: split.children.length, tree: clone(tree) };
}

/** Put a view back in its slot: the whole layout as it was, when nothing else has changed since it left; otherwise beside
 *  what was beside it (what is left of that), on the same side, with the same share. null when none of it is left. */
export function restore(tree: LayoutNode | null, view: string, slot: Slot): LayoutNode | null {
  const base = remove(tree, view);
  if (!base) return { view, size: 1 };
  if (sig(remove(slot.tree, view)) === sig(base)) return tidy(clone(slot.tree));
  const paths = panesOf(base).filter(p => slot.by.includes(p.view)).map(p => p.path);
  if (!paths.length) return null;
  const common = paths.reduce((a, p) => { let k = 0; while (k < a.length && k < p.length && a[k] === p[k]) k++; return a.slice(0, k); });
  const t = clone(base), dir = slot.side === 'left' || slot.side === 'right' ? 'row' : 'column', first = slot.side === 'left' || slot.side === 'above';
  const s = shareOf(slot.size), pane: Pane = { view, size: s };
  const parent = common.length ? (nodeAt(t, common.slice(0, -1)) as Split) : null, i = common[common.length - 1];
  if (parent && parent.dir === dir) { // a split running the same way: in among its children, which keep their proportions;
    const k = parent.children.length + 1, share = shareOf((s * (slot.of ?? k)) / k); // its share, for as many as share it now
    for (const c of parent.children) c.size *= 1 - share;
    const at = first ? i : i + 1; parent.children.splice(at, 0, { view, size: share });
    if (parent.front !== undefined) parent.front = parent.stack ? at : parent.front + (at <= parent.front ? 1 : 0); // a stack shows it in front
    return tidy(t);
  }
  const x = nodeAt(t, common)!;
  const pair: Split = { dir, size: x.size, children: first ? [pane, { ...x, size: 1 - s }] : [{ ...x, size: 1 - s }, pane] };
  if (parent) parent.children[i] = pair;
  return tidy(parent ? t : pair);
}

/** Where a view opens. Beside or into the view named in place; else back in its slot, where that still fits the window;
 *  else as a new view does (half of the largest pane, or stacked with the view used longest ago, in front). how says
 *  which, in words: "where it was", "right of "a"", "below "a"", "where there was most room", "stacked with "a", in front". */
export function openView(tree: LayoutNode | null, view: string, window: Size, o: { place?: Place; slot?: Slot; recent?: string[]; options?: Partial<LayoutOptions> } = {}): { tree: LayoutNode; notes: string[]; how: string; stackedWith?: string } {
  const notes: string[] = [];
  if (!o.place && o.slot) {
    const t = restore(tree, view, o.slot);
    if (t && fits(t, window, o.options)) {
      const by = o.slot.by.filter(v => viewsOf(t).includes(v));
      return { tree: t, notes, how: sig(t) === sig(tidy(o.slot.tree)) ? 'where it was' : `${o.slot.side === 'left' || o.slot.side === 'right' ? `${o.slot.side} of` : o.slot.side} ${by.slice(0, 2).map(v => `"${v}"`).join(' + ')}${by.length > 2 ? ' …' : ''}, as before` };
    }
    if (t) notes.push(`where it was does not fit the window now (${Math.floor(window.w)} × ${Math.floor(window.h)}), so it opened as a new view does`);
  }
  const placed = !!o.place?.beside && viewsOf(remove(tree, view)).includes(o.place.beside);
  const r = insert(tree, view, window, { place: o.place, recent: o.recent, options: o.options });
  const side = o.place?.side ?? 'right';
  let how = 'where there was most room';
  if (placed) how = `${side === 'left' || side === 'right' ? `${side} of` : side} "${o.place!.beside}"`;
  else if (r.stackedWith) how = `stacked with "${r.stackedWith}", in front`;
  return { ...r, notes: [...notes, ...r.notes], how };
}
