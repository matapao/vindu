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
export type Split = {
  dir: 'row' | 'column';
  size: number;
  children: LayoutNode[];
  stack?: true;
  spread?: true;
  front?: number;
};
export type LayoutNode = Pane | Split;
export type Box = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };
export type Mode = 'empty' | 'single' | 'tiled' | 'stacked' | 'maximized';
/** A placed pane. box is null when stacked (full width, as tall as its content), or behind: in a stack, not in front.
 *  fit "content": as tall as its content, at most box.h. */
export type PlacedPane = {
  view: string;
  path: number[];
  box: Box | null;
  compact: boolean;
  fit?: 'content';
  behind?: true;
};
/** A split drawn as a stack: its strip of tabs (one per child, with the views each holds), and the child in front.
 *  auto: it is drawn so because its panes do not fit; why: what brought the front there (an ask, the person). */
type PlacedStack = {
  path: number[];
  box: Box;
  front: number;
  tabs: { index: number; views: string[]; box: Box }[];
  auto?: true;
  why?: 'ask';
};
/** The line between children index and index + 1 of the split at path. dir is the direction drawn, which may be turned. */
export type Line = { box: Box; dir: 'row' | 'column'; path: number[]; index: number };
/** A split as drawn: its box, its direction, and its children's extents and minimums along it (for dragging a line). */
export type PlacedSplit = { path: number[]; dir: 'row' | 'column'; box: Box; extents: number[]; mins: number[] };
export type Placement = {
  mode: Mode;
  window: Size;
  panes: PlacedPane[];
  lines: Line[];
  splits: PlacedSplit[];
  stacks: PlacedStack[];
  notes: string[];
};

export type LayoutOptions = {
  min: Size; // the smallest a pane is made, where the window allows
  line: number; // the line between neighbours
  single: number; // the widest a lone pane is
  margin: number; // around a lone pane
  phone: number; // below this width the panes stack
  compact: number; // a pane narrower than this gets the view's compact surface
  tab: number; // a stack's strip of tabs
};
export const LAYOUT: LayoutOptions = {
  min: { w: 300, h: 180 },
  line: 1,
  single: 1040,
  margin: 24,
  phone: 600,
  compact: 520,
  tab: 28,
};
export type Side = 'left' | 'right' | 'above' | 'below';
/** Where a new view goes: beside a view already shown, on one side, taking a share of that pane (0.5 by default); or
 *  into the stack of a view already shown (one is made of its pane, if it has none), in front. */
export type Place = { beside?: string; into?: string; side?: Side; size?: number };
/** What place() is told besides the tree: views that ask the person (never behind), and the views shown or used, least
 *  recent first (an unchosen stack shows the most recent in front). */
type Ctx = { asks?: ReadonlySet<string>; recent?: readonly string[] };

export const isPane = (n: LayoutNode): n is Pane => typeof (n as Pane).view === 'string';
export const layoutOptions = (o?: Partial<LayoutOptions>): LayoutOptions => ({
  ...LAYOUT,
  ...o,
  min: { ...LAYOUT.min, ...o?.min },
});
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const shareOf = (n: number) => Math.min(0.9, Math.max(0.1, n)); // a view's share beside another: a tenth at least, nine tenths at most
const across = (d: 'row' | 'column') => (d === 'row' ? 'across' : 'down');

/** The panes in reading order (left to right, top to bottom), with their paths. */
export function panesOf(n: LayoutNode | null, path: number[] = []): { view: string; path: number[] }[] {
  if (!n) return [];
  return isPane(n) ? [{ view: n.view, path }] : n.children.flatMap((c, i) => panesOf(c, [...path, i]));
}
export const viewsOf = (n: LayoutNode | null) => panesOf(n).map((p) => p.view);
export function nodeAt(n: LayoutNode | null, path: number[]): LayoutNode | null {
  let at: LayoutNode | null = n;
  for (const i of path) at = at && !isPane(at) ? (at.children[i] ?? null) : null;
  return at;
}
const named = (n: LayoutNode) => {
  if (isPane(n)) return `"${n.view}"`;
  return n.stack
    ? `the stack ${viewsOf(n).join(', ')}`
    : `${n.dir} ${viewsOf(n).join(n.dir === 'row' ? ' | ' : ' / ')}`;
};

/** The least a subtree takes along one axis: a pane's minimum, children in line add up (with lines), children across take the most. */
export function minExtent(n: LayoutNode, d: 'row' | 'column', o: LayoutOptions = LAYOUT): number {
  if (isPane(n)) return d === 'row' ? o.min.w : o.min.h;
  const xs = n.children.map((c) => minExtent(c, d, o));
  if (n.stack) return Math.max(...xs) + (d === 'column' ? o.tab : 0); // one child at a time, under its strip
  return n.dir === d ? sum(xs) + (xs.length - 1) * o.line : Math.max(...xs);
}
/** The smallest window a layout fits as it is, without turning a split. */
export const minWindow = (n: LayoutNode, o: LayoutOptions = LAYOUT): Size => ({
  w: minExtent(n, 'row', o),
  h: minExtent(n, 'column', o),
});
/** The least a child takes along d inside a split that gives it `cross` the other way. A child split running across d
 *  whose children do not fit in `cross` will be drawn turned, and then its children add up along d: reserve that. */
function minIn(n: LayoutNode, d: 'row' | 'column', cross: number, o: LayoutOptions): number {
  if (isPane(n) || n.dir === d || n.stack) return minExtent(n, d, o);
  return minExtent(n, n.dir, o) <= cross ? minExtent(n, d, o) : minExtent({ ...n, dir: d }, d, o);
}

/** Whole pixels that add up to avail: shares by weight, no child below its minimum where all minimums fit,
 *  leftover pixels to the largest remainders (ties: the earlier child). */
export function distribute(avail: number, weights: number[], mins: number[]): number[] {
  const n = weights.length;
  avail = Math.max(0, Math.floor(avail));
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  const fixed: (number | null)[] = Array.from({ length: n }, () => null);
  const free = () => avail - sum(fixed.map((f) => f ?? 0));
  const open = () => sum(w.map((x, i) => (fixed[i] === null ? x : 0)));
  if (sum(mins) <= avail)
    for (let changed = true; changed;) {
      changed = false;
      const f = free(),
        t = open();
      for (let i = 0; i < n; i++)
        if (fixed[i] === null && t > 0 && (f * w[i]) / t < mins[i] - 1e-9) {
          fixed[i] = mins[i];
          changed = true;
        }
    }
  const f = free(),
    t = open();
  const exact = w.map((x, i) => fixed[i] ?? (t > 0 ? (f * x) / t : 0));
  const out = exact.map(Math.floor);
  let left = avail - sum(out);
  if (t === 0 && n) {
    out[n - 1] += left;
    left = 0;
  }
  const byRest = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && n; k = (k + 1) % n, left--) out[byRest[k][1]]++;
  return out;
}

/** Place a layout in a window. maximized: a view to fill the window. fill: views that take their pane's whole height (one page). */
export function place(
  tree: LayoutNode | null,
  window: Size,
  o: { maximized?: string | null; fill?: ReadonlySet<string>; options?: Partial<LayoutOptions> } & Ctx = {},
): Placement {
  const opt = layoutOptions(o.options);
  const W = Math.max(0, Math.floor(window.w)),
    H = Math.max(0, Math.floor(window.h));
  const out: Placement = {
    mode: 'empty',
    window: { w: W, h: H },
    panes: [],
    lines: [],
    splits: [],
    stacks: [],
    notes: [],
  };
  const order = panesOf(tree);
  if (!tree || !order.length) return out;
  if (W < opt.phone) {
    out.mode = 'stacked';
    out.panes = order.map((p) => ({ view: p.view, path: p.path, box: null, compact: W < opt.compact }));
    return out;
  }
  const max = o.maximized ? order.find((p) => p.view === o.maximized) : undefined;
  if (max) {
    out.mode = 'maximized';
    out.panes = [{ view: max.view, path: max.path, box: { x: 0, y: 0, w: W, h: H }, compact: W < opt.compact }];
    return out;
  }
  if (order.length === 1) {
    const fill = !!o.fill?.has(order[0].view);
    const aw = Math.max(0, W - 2 * opt.margin),
      ah = Math.max(0, H - 2 * opt.margin);
    const w = fill ? aw : Math.min(aw, opt.single);
    out.mode = 'single';
    out.panes = [
      {
        view: order[0].view,
        path: order[0].path,
        box: { x: Math.floor((W - w) / 2), y: Math.min(opt.margin, H), w, h: ah },
        compact: w < opt.compact,
        ...(fill ? {} : { fit: 'content' as const }),
      },
    ];
    return out;
  }
  out.mode = 'tiled';
  tile(tree, { x: 0, y: 0, w: W, h: H }, [], opt, out, { asks: o.asks, recent: o.recent });
  return out;
}

/** The child in front of a split drawn as a stack: one that asks the person, never behind; else the one the person or
 *  the model put in front; else the one holding the view shown or used most recently; else the last. */
export function frontOf(n: Split, ctx: Ctx): { front: number; why?: 'ask' } {
  const asked = ctx.asks?.size ? n.children.findIndex((c) => viewsOf(c).some((v) => ctx.asks!.has(v))) : -1;
  if (asked >= 0) return { front: asked, why: 'ask' };
  if (Number.isInteger(n.front) && n.front! >= 0 && n.front! < n.children.length) return { front: n.front! };
  const rank = (c: LayoutNode) => Math.max(-1, ...viewsOf(c).map((v) => ctx.recent?.indexOf(v) ?? -1));
  let best = n.children.length - 1,
    top = -2;
  n.children.forEach((c, i) => {
    const r = rank(c);
    if (r >= top) {
      top = r;
      best = i;
    }
  });
  return { front: best };
}

function stackIn(n: Split, box: Box, path: number[], opt: LayoutOptions, out: Placement, ctx: Ctx, auto: boolean) {
  const strip = { x: box.x, y: box.y, w: box.w, h: Math.min(opt.tab, box.h) };
  const body = { x: box.x, y: box.y + strip.h, w: box.w, h: Math.max(0, box.h - strip.h) };
  const { front, why } = frontOf(n, ctx);
  const ws = distribute(
    strip.w,
    n.children.map(() => 1),
    n.children.map(() => 0),
  );
  let x = strip.x;
  const tabs = n.children.map((c, i) => {
    const b = { x, y: strip.y, w: ws[i], h: strip.h };
    x += ws[i];
    return { index: i, views: viewsOf(c), box: b };
  });
  out.stacks.push({ path, box: strip, front, tabs, ...(auto ? { auto: true as const } : {}), ...(why ? { why } : {}) });
  n.children.forEach((c, i) => {
    if (i === front) tile(c, body, [...path, i], opt, out, ctx);
    else
      for (const p of panesOf(c, [...path, i]))
        out.panes.push({ view: p.view, path: p.path, box: null, compact: body.w < opt.compact, behind: true });
  });
}

export function tile(n: LayoutNode, box: Box, path: number[], opt: LayoutOptions, out: Placement, ctx: Ctx = {}) {
  if (isPane(n)) {
    out.panes.push({ view: n.view, path, box, compact: box.w < opt.compact });
    return;
  }
  if (n.stack) {
    stackIn(n, box, path, opt, out, ctx, false);
    return;
  }
  const k = n.children.length;
  const extent = (d: 'row' | 'column') => (d === 'row' ? box.w : box.h);
  const cross = (d: 'row' | 'column') => (d === 'row' ? box.h : box.w);
  const need = (d: 'row' | 'column') => sum(n.children.map((c) => minIn(c, d, cross(d), opt))) + (k - 1) * opt.line;
  let dir = n.dir;
  if (need(dir) > extent(dir)) {
    const turned = dir === 'row' ? 'column' : 'row';
    if (need(turned) <= extent(turned)) {
      out.notes.push(
        `${named(n)} needs ${need(dir)} px ${across(dir)} and has ${extent(dir)}: shown ${turned === 'row' ? 'side by side' : 'top to bottom'} until there is room`,
      );
      dir = turned;
    } else if (!n.spread) {
      // a stack with readable tabs, rather than panes too small to read
      const before = out.stacks.length;
      stackIn(n, box, path, opt, out, ctx, true);
      const st = out.stacks[before];
      out.notes.push(
        `${named(n)} needs ${need(dir)} px ${across(dir)} and has ${extent(dir)}: stacked, with ${viewsOf(
          n.children[st.front],
        )
          .map((v) => `"${v}"`)
          .join(', ')} in front, until there is room`,
      );
      return;
    } else
      out.notes.push(
        `${named(n)} needs ${need(dir)} px ${across(dir)} and has ${extent(dir)}: its panes are smaller than ${opt.min.w} × ${opt.min.h} (spread out by the person)`,
      );
  }
  const mins = n.children.map((c) => minIn(c, dir, cross(dir), opt));
  const extents = distribute(
    extent(dir) - (k - 1) * opt.line,
    n.children.map((c) => c.size),
    mins,
  );
  out.splits.push({ path, dir, box, extents, mins });
  let pos = dir === 'row' ? box.x : box.y;
  n.children.forEach((c, i) => {
    tile(
      c,
      dir === 'row' ? { x: pos, y: box.y, w: extents[i], h: box.h } : { x: box.x, y: pos, w: box.w, h: extents[i] },
      [...path, i],
      opt,
      out,
      ctx,
    );
    pos += extents[i];
    if (i < k - 1) {
      out.lines.push({
        box: dir === 'row' ? { x: pos, y: box.y, w: opt.line, h: box.h } : { x: box.x, y: pos, w: box.w, h: opt.line },
        dir,
        path,
        index: i,
      });
      pos += opt.line;
    }
  });
}

/** Where a box is, in words the model can use with the person: "left, full height", "top right", "the whole window". */
export function where(b: Box, win: Size): string {
  const fullW = b.w >= win.w - 2,
    fullH = b.h >= win.h - 2;
  if (fullW && fullH) return 'the whole window';
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2;
  const h = third(cx, win.w, ['left', 'centre', 'right']);
  const v = third(cy, win.h, ['top', 'middle', 'bottom']);
  if (fullH) return `${h}, full height`;
  if (fullW) return `${v}, full width`;
  if (v === 'middle') return h === 'centre' ? 'centre' : `${h}, middle`;
  return h === 'centre' ? `${v} centre` : `${v} ${h}`;
}
/** Which third of a length a point is in, named: before, in the middle of, or after. */
function third<T extends string>(at: number, length: number, [before, middle, after]: [T, T, T]): T {
  if (at < length / 3) return before;
  return at > (length * 2) / 3 ? after : middle;
}
