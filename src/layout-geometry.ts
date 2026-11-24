import { isPane, viewsOf, type Box, type LayoutNode, type Mode, type Placement } from './layout.js';

type Direction = 'row' | 'column';
type PaneGeometry = { pane: number; room?: Box; width?: number };
type GeometryNode = PaneGeometry | { direction: Direction; children: GeometryNode[] } | { tabs: GeometryNode[]; front?: number };
export type LayoutGeometry = {
  viewport: { w: number; h: number; source: 'estimated' | 'reported' };
  mode: Mode;
  paneCount: number;
  collapsedCount: number;
  tree: GeometryNode | null;
};

/** Describe the allocated space. Never use measured content bounds, renderer readback or layout notes. */
export function layoutGeometry(tree: LayoutNode | null, placed: Placement, reported: boolean, collapsedCount: number): LayoutGeometry {
  const slots = new Map(viewsOf(tree).map((name, i) => [name, i + 1]));
  const panes = new Map(placed.panes.map(p => [p.view, p]));
  const directions = new Map(placed.splits.map(s => [s.path.join('.'), s.dir]));
  const fronts = new Map(placed.stacks.map(s => [s.path.join('.'), s.front]));
  const leaf = (name: string): PaneGeometry => {
    const pane = slots.get(name)!;
    if (placed.mode === 'stacked') return { pane, width: placed.window.w };
    const box = panes.get(name)?.box;
    if (!box) return { pane }; // behind a tab
    const { x, y, w, h } = box;
    return { pane, room: { x, y, w, h } };
  };
  const branch = (node: LayoutNode, path: number[]): GeometryNode => {
    if (isPane(node)) return leaf(node.view);
    const key = path.join('.');
    const children = node.children.map((child, i) => branch(child, [...path, i]));
    const front = fronts.get(key);
    if (front !== undefined) return { tabs: children, front };
    if (node.stack) return { tabs: children }; // a nested stack within a hidden tab
    return { direction: directions.get(key) ?? node.dir, children };
  };
  let drawn: GeometryNode | null = null;
  if (placed.mode === 'maximized') drawn = leaf(placed.panes[0].view);
  else if (placed.mode === 'stacked') drawn = { direction: 'column', children: placed.panes.map(p => leaf(p.view)) };
  else if (tree) drawn = branch(tree, []);
  return {
    viewport: { w: placed.window.w, h: placed.window.h, source: reported ? 'reported' : 'estimated' },
    mode: placed.mode, paneCount: slots.size, collapsedCount, tree: drawn,
  };
}
