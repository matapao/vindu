// What the window reports about its panes, read against what is shown: a divider moved, and how tall each view's content
// is and what of it is in sight. Only what is well formed is kept: what a window says is checked, as all it says.
import { isPane, nodeAt, resize, viewsOf, type LayoutNode } from './layout.js';

/** What of a panel is in sight in its pane, as the window read it from the marks it drew: rows from 0, as shown. */
export type Sight = { first: number; last: number; n: number; of: number; nodes?: number };
/** How tall a view's content is, how much of it its pane shows, and what of each panel is in sight. */
export type Measured = { content: number; visible: number; sight?: Record<string, Sight> };

/** A change to the window the model has not been told of yet: what kind it is (the window's size, or what the person
 *  did: a ShellEvent's type), what it is of (a resize: the divider, by the views on each side), and its words. */
export type WindowChange = { kind: string; key?: string; text: string };

/** Resolve a reported divider movement against the currently displayed tree. */
export function resizeFromWindow(tree: LayoutNode | null, event: Record<string, unknown>) {
  const { path, sizes } = event;
  if (!Array.isArray(path) || !Array.isArray(sizes)) return null;
  if (!path.every((index: unknown) => typeof index === 'number' && Number.isInteger(index) && index >= 0))
    return null;
  const resized = resize(tree, path, sizes.map(Number));
  const split = resized && nodeAt(resized, path);
  if (!resized || !split || isPane(split)) return null;
  const sides = split.children.map((child) => viewsOf(child));
  const sizesByPane = split.children.map(
    (child, i) => `${sides[i].map((view) => `"${view}"`).join(' + ')} ${Math.round(child.size * 100)} %`,
  );
  const change: WindowChange = { kind: 'resize', key: JSON.stringify(sides), text: `resized: ${sizesByPane.join(', ')}` };
  return { tree: resized, change };
}

/** One drag or series of key presses on the same divider produces one change in the next report. */
export function recordResize(changes: WindowChange[], next: WindowChange) {
  const previous = changes.at(-1);
  if (previous?.kind === 'resize' && previous.key === next.key) changes[changes.length - 1] = next;
  else changes.push(next);
}

/** The heights and sights the window measured, for the views that have a pane (inTree). */
export function measuredFromWindow(views: unknown, inTree: (view: string) => boolean): [string, Measured][] {
  const byView = (views && typeof views === 'object' ? views : {}) as Record<string, { content?: unknown; visible?: unknown; sight?: unknown }>;
  const int = (n: unknown, min = 0) => (Number.isInteger(n) && (n as number) >= min && (n as number) < 1e7 ? (n as number) : undefined);
  const read: [string, Measured][] = [];
  for (const [view, m] of Object.entries(byView)) {
    const content = Number(m?.content), visible = Number(m?.visible);
    if (!(inTree(view) && content >= 0 && visible >= 0 && Number.isFinite(content + visible))) continue;
    const sight: Record<string, Sight> = Object.create(null); // keyed by what the window says: a panel named __proto__ is a panel
    const said = m?.sight && typeof m.sight === 'object' ? (m.sight as Record<string, Record<string, unknown>>) : {};
    for (const [panel, s] of Object.entries(said).slice(0, 50)) {
      const first = int(s?.first, -1), last = int(s?.last, -1), n = int(s?.n), of = int(s?.of);
      const nodes = s?.nodes === undefined ? undefined : int(s.nodes);
      if (panel.length <= 80 && first !== undefined && last !== undefined && n !== undefined && of !== undefined && last >= first && n <= of)
        sight[panel] = { first, last, n, of, ...(nodes !== undefined ? { nodes } : {}) };
    }
    read.push([view, { content, visible, ...(Object.keys(sight).length ? { sight } : {}) }]);
  }
  return read;
}
