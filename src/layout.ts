// The shell's layout: one pane per view, in rows and columns, and the one function that places them.
// Shared by the UI server (the boxes it tells the model) and the renderer (the boxes it draws), so the two cannot differ.
// Pure and deterministic, no DOM and no Node: the same tree and window give the same whole-pixel boxes everywhere.
//
// A layout is a tree. A pane shows one view. A split puts its children side by side (row) or top to bottom (column),
// each taking its share. Between neighbours is a 1 px line and nothing else: no gaps, no shadows.
// place() makes any tree fit any window, and notes what it changed:
//   no panes: empty · one pane: single, in the middle · a phone-width window: stacked, one pane after another ·
//   a maximized pane: the whole window · otherwise tiled. A split too small for its panes turns when turning fits.
// A split can also be a stack: its children in one place, one in front and the others as tabs on a strip above it.
// The person stacks a split or spreads it out again; the model puts a new view into a stack (place.into); a split that
// does not fit even turned is drawn as a stack until there is room (unless the person spread it out), and a new view
// with no room anywhere joins a stack instead of hiding another. What needs the person (an ask) is never behind.

export type Pane = { view: string; size: number };
/** stack: drawn as a stack (the person's or the model's choice); spread: never drawn as one, even without room (the
 *  person's); front: the child in front when it is drawn as a stack. */
export type Split = { dir: 'row' | 'column'; size: number; children: LayoutNode[]; stack?: true; spread?: true; front?: number };
export type LayoutNode = Pane | Split;
export type Box = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };
export type Mode = 'empty' | 'single' | 'tiled' | 'stacked' | 'maximized';
/** A placed pane. box is null when stacked (full width, as tall as its content), or behind: in a stack, not in front.
 *  fit "content": as tall as its content, at most box.h. */
export type PlacedPane = { view: string; path: number[]; box: Box | null; compact: boolean; fit?: 'content'; behind?: true };
/** A split drawn as a stack: its strip of tabs (one per child, with the views each holds), and the child in front.
 *  auto: it is drawn so because its panes do not fit; why: what brought the front there (an ask, the person). */
type PlacedStack = { path: number[]; box: Box; front: number; tabs: { index: number; views: string[]; box: Box }[]; auto?: true; why?: 'ask' };
/** The line between children index and index + 1 of the split at path. dir is the direction drawn, which may be turned. */
export type Line = { box: Box; dir: 'row' | 'column'; path: number[]; index: number };
/** A split as drawn: its box, its direction, and its children's extents and minimums along it (for dragging a line). */
export type PlacedSplit = { path: number[]; dir: 'row' | 'column'; box: Box; extents: number[]; mins: number[] };
export type Placement = { mode: Mode; window: Size; panes: PlacedPane[]; lines: Line[]; splits: PlacedSplit[]; stacks: PlacedStack[]; notes: string[] };

export type LayoutOptions = {
  min: Size;       // the smallest a pane is made, where the window allows
  line: number;    // the line between neighbours
  single: number;  // the widest a lone pane is
  margin: number;  // around a lone pane
  phone: number;   // below this width the panes stack
  compact: number; // a pane narrower than this gets the view's compact surface
  tab: number;     // a stack's strip of tabs
};
export const LAYOUT: LayoutOptions = { min: { w: 300, h: 180 }, line: 1, single: 1040, margin: 24, phone: 600, compact: 520, tab: 28 };
export type Side = 'left' | 'right' | 'above' | 'below';
/** Where a new view goes: beside a view already shown, on one side, taking a share of that pane (0.5 by default); or
 *  into the stack of a view already shown (one is made of its pane, if it has none), in front. */
export type Place = { beside?: string; into?: string; side?: Side; size?: number };
/** What place() is told besides the tree: views that ask the person (never behind), and the views shown or used, least
 *  recent first (an unchosen stack shows the most recent in front). */
type Ctx = { asks?: ReadonlySet<string>; recent?: readonly string[] };

export const isPane = (n: LayoutNode): n is Pane => typeof (n as Pane).view === 'string';
export const layoutOptions = (o?: Partial<LayoutOptions>): LayoutOptions => ({ ...LAYOUT, ...o, min: { ...LAYOUT.min, ...o?.min } });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const shareOf = (n: number) => Math.min(0.9, Math.max(0.1, n)); // a view's share beside another: a tenth at least, nine tenths at most
const across = (d: 'row' | 'column') => (d === 'row' ? 'across' : 'down');

/** The panes in reading order (left to right, top to bottom), with their paths. */
export function panesOf(n: LayoutNode | null, path: number[] = []): { view: string; path: number[] }[] {
  if (!n) return [];
  return isPane(n) ? [{ view: n.view, path }] : n.children.flatMap((c, i) => panesOf(c, [...path, i]));
}
export const viewsOf = (n: LayoutNode | null) => panesOf(n).map(p => p.view);
export function nodeAt(n: LayoutNode | null, path: number[]): LayoutNode | null {
  let at: LayoutNode | null = n;
  for (const i of path) at = at && !isPane(at) ? at.children[i] ?? null : null;
  return at;
}
const named = (n: LayoutNode) => (isPane(n) ? `"${n.view}"` : n.stack ? `the stack ${viewsOf(n).join(', ')}` : `${n.dir} ${viewsOf(n).join(n.dir === 'row' ? ' | ' : ' / ')}`);

/** The least a subtree takes along one axis: a pane's minimum, children in line add up (with lines), children across take the most. */
export function minExtent(n: LayoutNode, d: 'row' | 'column', o: LayoutOptions = LAYOUT): number {
  if (isPane(n)) return d === 'row' ? o.min.w : o.min.h;
  const xs = n.children.map(c => minExtent(c, d, o));
  if (n.stack) return Math.max(...xs) + (d === 'column' ? o.tab : 0); // one child at a time, under its strip
  return n.dir === d ? sum(xs) + (xs.length - 1) * o.line : Math.max(...xs);
}
/** The smallest window a layout fits as it is, without turning a split. */
export const minWindow = (n: LayoutNode, o: LayoutOptions = LAYOUT): Size => ({ w: minExtent(n, 'row', o), h: minExtent(n, 'column', o) });
/** The least a child takes along d inside a split that gives it `cross` the other way. A child split running across d
 *  whose children do not fit in `cross` will be drawn turned, and then its children add up along d: reserve that. */
function minIn(n: LayoutNode, d: 'row' | 'column', cross: number, o: LayoutOptions): number {
  if (isPane(n) || n.dir === d || n.stack) return minExtent(n, d, o);
  return minExtent(n, n.dir, o) <= cross ? minExtent(n, d, o) : minExtent({ ...n, dir: d }, d, o);
}

/** Whole pixels that add up to avail: shares by weight, no child below its minimum where all minimums fit,
 *  leftover pixels to the largest remainders (ties: the earlier child). */
export function distribute(avail: number, weights: number[], mins: number[]): number[] {
  const n = weights.length; avail = Math.max(0, Math.floor(avail));
  const w = weights.map(x => (Number.isFinite(x) && x > 0 ? x : 1));
  const fixed: (number | null)[] = Array.from({ length: n }, () => null);
  const free = () => avail - sum(fixed.map(f => f ?? 0));
  const open = () => sum(w.map((x, i) => (fixed[i] === null ? x : 0)));
  if (sum(mins) <= avail) for (let changed = true; changed;) {
    changed = false; const f = free(), t = open();
    for (let i = 0; i < n; i++) if (fixed[i] === null && t > 0 && (f * w[i]) / t < mins[i] - 1e-9) { fixed[i] = mins[i]; changed = true; }
  }
  const f = free(), t = open();
  const exact = w.map((x, i) => fixed[i] ?? (t > 0 ? (f * x) / t : 0));
  const out = exact.map(Math.floor);
  let left = avail - sum(out);
  if (t === 0 && n) { out[n - 1] += left; left = 0; }
  const byRest = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && n; k = (k + 1) % n, left--) out[byRest[k][1]]++;
  return out;
}

/** Place a layout in a window. maximized: a view to fill the window. fill: views that take their pane's whole height (one page). */
export function place(tree: LayoutNode | null, window: Size, o: { maximized?: string | null; fill?: ReadonlySet<string>; options?: Partial<LayoutOptions> } & Ctx = {}): Placement {
  const opt = layoutOptions(o.options);
  const W = Math.max(0, Math.floor(window.w)), H = Math.max(0, Math.floor(window.h));
  const out: Placement = { mode: 'empty', window: { w: W, h: H }, panes: [], lines: [], splits: [], stacks: [], notes: [] };
  const order = panesOf(tree);
  if (!tree || !order.length) return out;
  if (W < opt.phone) {
    out.mode = 'stacked';
    out.panes = order.map(p => ({ view: p.view, path: p.path, box: null, compact: W < opt.compact }));
    return out;
  }
  const max = o.maximized ? order.find(p => p.view === o.maximized) : undefined;
  if (max) {
    out.mode = 'maximized';
    out.panes = [{ view: max.view, path: max.path, box: { x: 0, y: 0, w: W, h: H }, compact: W < opt.compact }];
    return out;
  }
  if (order.length === 1) {
    const fill = !!o.fill?.has(order[0].view);
    const aw = Math.max(0, W - 2 * opt.margin), ah = Math.max(0, H - 2 * opt.margin);
    const w = fill ? aw : Math.min(aw, opt.single);
    out.mode = 'single';
    out.panes = [{ view: order[0].view, path: order[0].path, box: { x: Math.floor((W - w) / 2), y: Math.min(opt.margin, H), w, h: ah }, compact: w < opt.compact, ...(fill ? {} : { fit: 'content' as const }) }];
    return out;
  }
  out.mode = 'tiled';
  tile(tree, { x: 0, y: 0, w: W, h: H }, [], opt, out, { asks: o.asks, recent: o.recent });
  return out;
}

/** The child in front of a split drawn as a stack: one that asks the person, never behind; else the one the person or
 *  the model put in front; else the one holding the view shown or used most recently; else the last. */
function frontOf(n: Split, ctx: Ctx): { front: number; why?: 'ask' } {
  const asked = ctx.asks?.size ? n.children.findIndex(c => viewsOf(c).some(v => ctx.asks!.has(v))) : -1;
  if (asked >= 0) return { front: asked, why: 'ask' };
  if (Number.isInteger(n.front) && n.front! >= 0 && n.front! < n.children.length) return { front: n.front! };
  const rank = (c: LayoutNode) => Math.max(-1, ...viewsOf(c).map(v => ctx.recent?.indexOf(v) ?? -1));
  let best = n.children.length - 1, top = -2;
  n.children.forEach((c, i) => { const r = rank(c); if (r >= top) { top = r; best = i; } });
  return { front: best };
}

function stackIn(n: Split, box: Box, path: number[], opt: LayoutOptions, out: Placement, ctx: Ctx, auto: boolean) {
  const strip = { x: box.x, y: box.y, w: box.w, h: Math.min(opt.tab, box.h) };
  const body = { x: box.x, y: box.y + strip.h, w: box.w, h: Math.max(0, box.h - strip.h) };
  const { front, why } = frontOf(n, ctx);
  const ws = distribute(strip.w, n.children.map(() => 1), n.children.map(() => 0));
  let x = strip.x;
  const tabs = n.children.map((c, i) => { const b = { x, y: strip.y, w: ws[i], h: strip.h }; x += ws[i]; return { index: i, views: viewsOf(c), box: b }; });
  out.stacks.push({ path, box: strip, front, tabs, ...(auto ? { auto: true as const } : {}), ...(why ? { why } : {}) });
  n.children.forEach((c, i) => {
    if (i === front) tile(c, body, [...path, i], opt, out, ctx);
    else for (const p of panesOf(c, [...path, i])) out.panes.push({ view: p.view, path: p.path, box: null, compact: body.w < opt.compact, behind: true });
  });
}

function tile(n: LayoutNode, box: Box, path: number[], opt: LayoutOptions, out: Placement, ctx: Ctx = {}) {
  if (isPane(n)) { out.panes.push({ view: n.view, path, box, compact: box.w < opt.compact }); return; }
  if (n.stack) { stackIn(n, box, path, opt, out, ctx, false); return; }
  const k = n.children.length;
  const extent = (d: 'row' | 'column') => (d === 'row' ? box.w : box.h);
  const cross = (d: 'row' | 'column') => (d === 'row' ? box.h : box.w);
  const need = (d: 'row' | 'column') => sum(n.children.map(c => minIn(c, d, cross(d), opt))) + (k - 1) * opt.line;
  let dir = n.dir;
  if (need(dir) > extent(dir)) {
    const turned = dir === 'row' ? 'column' : 'row';
    if (need(turned) <= extent(turned)) {
      out.notes.push(`${named(n)} needs ${need(dir)} px ${across(dir)} and has ${extent(dir)}: shown ${turned === 'row' ? 'side by side' : 'top to bottom'} until there is room`);
      dir = turned;
    } else if (!n.spread) { // a stack with readable tabs, rather than panes too small to read
      const before = out.stacks.length;
      stackIn(n, box, path, opt, out, ctx, true);
      const st = out.stacks[before];
      out.notes.push(`${named(n)} needs ${need(dir)} px ${across(dir)} and has ${extent(dir)}: stacked, with ${viewsOf(n.children[st.front]).map(v => `"${v}"`).join(', ')} in front, until there is room`);
      return;
    } else out.notes.push(`${named(n)} needs ${need(dir)} px ${across(dir)} and has ${extent(dir)}: its panes are smaller than ${opt.min.w} × ${opt.min.h} (spread out by the person)`);
  }
  const mins = n.children.map(c => minIn(c, dir, cross(dir), opt));
  const extents = distribute(extent(dir) - (k - 1) * opt.line, n.children.map(c => c.size), mins);
  out.splits.push({ path, dir, box, extents, mins });
  let pos = dir === 'row' ? box.x : box.y;
  n.children.forEach((c, i) => {
    tile(c, dir === 'row' ? { x: pos, y: box.y, w: extents[i], h: box.h } : { x: box.x, y: pos, w: box.w, h: extents[i] }, [...path, i], opt, out, ctx);
    pos += extents[i];
    if (i < k - 1) {
      out.lines.push({ box: dir === 'row' ? { x: pos, y: box.y, w: opt.line, h: box.h } : { x: box.x, y: pos, w: box.w, h: opt.line }, dir, path, index: i });
      pos += opt.line;
    }
  });
}

/** Where a box is, in words the model can use with the person: "left, full height", "top right", "the whole window". */
export function where(b: Box, win: Size): string {
  const fullW = b.w >= win.w - 2, fullH = b.h >= win.h - 2;
  if (fullW && fullH) return 'the whole window';
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const h = cx < win.w / 3 ? 'left' : cx > (win.w * 2) / 3 ? 'right' : 'centre';
  const v = cy < win.h / 3 ? 'top' : cy > (win.h * 2) / 3 ? 'bottom' : 'middle';
  if (fullH) return `${h}, full height`;
  if (fullW) return `${v}, full width`;
  return v === 'middle' && h === 'centre' ? 'centre' : v === 'middle' ? `${h}, middle` : h === 'centre' ? `${v} centre` : `${v} ${h}`;
}

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
  const byRoom = rooms.sort((a, b) => (key(b) === key(a) ? 0 : key(b) > key(a) ? 1 : -1) || b.i - a.i);
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
  const side: Side = split.dir === 'row' ? (after ? 'right' : 'left') : (after ? 'below' : 'above');
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
  return { ...r, notes: [...notes, ...r.notes], how: placed ? `${side === 'left' || side === 'right' ? `${side} of` : side} "${o.place!.beside}"` : r.stackedWith ? `stacked with "${r.stackedWith}", in front` : 'where there was most room' };
}

/** Read a layout as the model sends it. The form: a view name is a pane; a list is a row; {"row": [...]} and
 *  {"column": [...]} nest; {"stack": [...], "front": name} puts its children in one place, as tabs; "size" on a pane ({"view": name, "size": …}) or a split gives its share: a weight (2 is twice 1),
 *  a fraction (0.7) or a percentage ("70%"); with fractions or percentages, children without a size share what is left.
 *  Shapes from other layout libraries are read too, each reading noted. Unknown names are returned, never guessed. */
export function readLayout(input: unknown, known: ReadonlySet<string>): { tree: LayoutNode | null; notes: string[]; unknown: string[] } {
  const notes: string[] = [], unknown: string[] = [], seen = new Set<string>();
  type Spec = { v: number; kind: 'none' | 'weight' | 'pct' };
  const sizeOf = (x: unknown): Spec => {
    const raw = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>).size : undefined;
    if (raw === undefined || raw === null) return { v: 1, kind: 'none' };
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return { v: raw, kind: 'weight' };
    const m = typeof raw === 'string' ? /^(\d+(?:\.\d+)?)\s*(%?)$/.exec(raw.trim()) : null; // trimmed: no two runs of spaces meet
    if (m && parseFloat(m[1]) > 0) return { v: parseFloat(m[1]), kind: m[2] ? 'pct' : 'weight' };
    notes.push(`read size ${JSON.stringify(raw)} as an equal share`); return { v: 1, kind: 'none' };
  };
  const shares = (specs: Spec[]): number[] => {
    const given = specs.filter(s => s.kind !== 'none'), open = specs.length - given.length;
    if (!given.length || !open) return specs.map(s => s.v);
    const total = given.some(s => s.kind === 'pct') ? 100 : given.every(s => s.v <= 1) && sum(given.map(s => s.v)) < 1 ? 1 : 0;
    if (!total) return specs.map(s => s.v); // weights: a child without a size weighs 1
    const rest = total - sum(given.map(s => s.v));
    if (rest <= 0) notes.push(`the sizes given add up to ${sum(given.map(s => s.v))}${total === 100 ? '%' : ''}, leaving nothing for the rest: shared equally`);
    return specs.map(s => (s.kind !== 'none' ? s.v : rest > 0 ? rest / open : total / specs.length));
  };
  const sized = (x: unknown, s: number): unknown => (typeof x === 'string' ? { view: x, size: s } : x && typeof x === 'object' ? { ...x, size: s } : x);
  const split = (dir: 'row' | 'column', xs: unknown[], depth: number): LayoutNode | null => {
    const kids = xs.map(c => ({ node: rec(c, depth + 1), spec: sizeOf(c) })).filter((k): k is { node: LayoutNode; spec: Spec } => !!k.node);
    const s = shares(kids.map(k => k.spec));
    const nodes = kids.map((k, i) => ({ ...k.node, size: s[i] }));
    return !nodes.length ? null : nodes.length === 1 ? nodes[0] : { dir, size: 1, children: nodes };
  };
  /** A stack: its children in one place, front named by a view it holds, or by its place from 0 (the last by default). */
  const stacked = (xs: unknown[], front: unknown, depth: number): LayoutNode | null => {
    const kids = xs.map(c => rec(c, depth + 1)).filter((k): k is LayoutNode => !!k);
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    let f = kids.length - 1;
    if (typeof front === 'string') { const i = kids.findIndex(k => viewsOf(k).includes(front)); if (i >= 0) f = i; else notes.push(`front "${front}" is not in the stack: the last is in front`); }
    else if (Number.isInteger(front) && (front as number) >= 0 && (front as number) < kids.length) f = front as number;
    return { dir: 'column', size: 1, stack: true, front: f, children: kids.map(k => ({ ...k, size: 1 / kids.length })) };
  };
  const rec = (x: unknown, depth: number): LayoutNode | null => {
    if (depth > 12) { notes.push('left out what is nested more than 12 deep'); return null; }
    if (typeof x === 'string') {
      const v = x.trim();
      if (!known.has(v)) { unknown.push(v); return null; }
      if (seen.has(v)) { notes.push(`"${v}" is in the layout twice; kept the first`); return null; }
      seen.add(v); return { view: v, size: 1 };
    }
    if (Array.isArray(x)) return split('row', x, depth);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.view === 'string') return rec(o.view, depth);
      if (Array.isArray(o.row)) return split('row', o.row, depth);
      if (Array.isArray(o.column)) return split('column', o.column, depth);
      if (Array.isArray(o.stack)) return stacked(o.stack, o.front, depth);
      const kind = o.type ?? o.direction ?? o.dir ?? o.orientation;
      const kids = o.children ?? o.content ?? o.panes ?? o.items;
      if ((kind === 'stack' || kind === 'tabs') && Array.isArray(kids)) { notes.push(`read {"type": "${String(kind)}"} as {"stack": [...]}`); return stacked(kids, o.front ?? o.activeItemIndex, depth); }
      const dir = kind === 'row' || kind === 'horizontal' ? 'row' : kind === 'column' || kind === 'vertical' ? 'column' : undefined;
      if (dir && Array.isArray(kids)) {
        notes.push(`read {"${o.type !== undefined ? 'type' : o.direction !== undefined ? 'direction' : o.dir !== undefined ? 'dir' : 'orientation'}": "${String(kind)}"} as {"${dir}": [...]}`);
        return split(dir, kids, depth);
      }
      if (dir && o.first !== undefined && o.second !== undefined) {
        const pct = typeof o.splitPercentage === 'number' && o.splitPercentage > 0 && o.splitPercentage < 100 ? o.splitPercentage : 50;
        notes.push(`read {"direction", "first", "second"} as {"${dir}": [first, second]}`);
        return split(dir, [sized(o.first, pct), sized(o.second, 100 - pct)], depth);
      }
      for (const k of ['name', 'id', 'componentName', 'title'] as const) if (typeof o[k] === 'string' && known.has(o[k])) { notes.push(`read {"${k}": "${o[k]}"} as the view "${o[k]}"`); return rec(o[k], depth); }
    }
    notes.push(`left out ${JSON.stringify(x)?.slice(0, 60)}: not a view name, a list, {"row": [...]}, {"column": [...]} or {"view": name}`);
    return null;
  };
  const tree = rec(input, 0);
  return { tree: tree && tidy(tree), notes, unknown: [...new Set(unknown)] };
}

/** A layout in the form readLayout takes, shares rounded to hundredths and left out where a split's children are equal. */
export function shorthand(n: LayoutNode | null): unknown {
  if (!n) return null;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const rec = (n: LayoutNode, withSize: boolean): unknown => {
    if (isPane(n)) return withSize ? { view: n.view, size: r2(n.size) } : n.view;
    if (n.stack) return { stack: n.children.map(c => rec(c, false)), ...(n.front !== undefined && n.children[n.front] ? { front: viewsOf(n.children[n.front])[0] } : {}), ...(withSize ? { size: r2(n.size) } : {}) };
    const even = n.children.every(c => Math.abs(c.size - 1 / n.children.length) < 0.005);
    return { [n.dir]: n.children.map(c => rec(c, !even)), ...(withSize ? { size: r2(n.size) } : {}) };
  };
  return rec(n, false);
}
