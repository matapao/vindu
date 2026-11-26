// Reading a layout as the model sends it (its own form, and the shapes other layout libraries give, each reading noted),
// and writing one back in its shortest form, as the model is told it.
import { isPane, sum, viewsOf, type LayoutNode } from './layout.js';
import { tidy } from './layout-edit.js';

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
    let total = 0; // percentages add up to 100, fractions to 1; weights to nothing in particular
    if (given.some(s => s.kind === 'pct')) total = 100;
    else if (given.every(s => s.v <= 1) && sum(given.map(s => s.v)) < 1) total = 1;
    if (!total) return specs.map(s => s.v); // weights: a child without a size weighs 1
    const rest = total - sum(given.map(s => s.v));
    if (rest <= 0) notes.push(`the sizes given add up to ${sum(given.map(s => s.v))}${total === 100 ? '%' : ''}, leaving nothing for the rest: shared equally`);
    const unsized = rest > 0 ? rest / open : total / specs.length; // the share of each child without a size
    return specs.map(s => (s.kind !== 'none' ? s.v : unsized));
  };
  const sized = (x: unknown, s: number): unknown => {
    if (typeof x === 'string') return { view: x, size: s };
    return x && typeof x === 'object' ? { ...x, size: s } : x;
  };
  const split = (dir: 'row' | 'column', xs: unknown[], depth: number): LayoutNode | null => {
    const kids = xs.map(c => ({ node: rec(c, depth + 1), spec: sizeOf(c) })).filter((k): k is { node: LayoutNode; spec: Spec } => !!k.node);
    const s = shares(kids.map(k => k.spec));
    const nodes = kids.map((k, i) => ({ ...k.node, size: s[i] }));
    if (!nodes.length) return null;
    return nodes.length === 1 ? nodes[0] : { dir, size: 1, children: nodes };
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
      let dir: 'row' | 'column' | undefined;
      if (kind === 'row' || kind === 'horizontal') dir = 'row';
      else if (kind === 'column' || kind === 'vertical') dir = 'column';
      if (dir && Array.isArray(kids)) {
        const said = ['type', 'direction', 'dir'].find(k => o[k] !== undefined) ?? 'orientation'; // the key the kind was read from
        notes.push(`read {"${said}": "${String(kind)}"} as {"${dir}": [...]}`);
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
