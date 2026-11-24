import type { Placement } from '../layout.js';
import type { ShellEvent, Sight } from '../shell.js';
import { MARKS, itemOf, markedBy } from './pointing.js';
import { readBack, type ReadBack, type View } from './surface.js';
import { rendered } from './surface-runtime.js';
import { tabsIn, type PaneEl } from './shell-pane.js';

type Measured = { content: number; visible: number; sight?: Record<string, Sight> };

/** Report visible row ranges and node counts using the same marks as pointing: each row once, by its own box. */
function sightOf(body: HTMLElement): Record<string, Sight> | undefined {
  const box = body.getBoundingClientRect();
  if (!box.height || !box.width) return undefined;
  const rows = new Map<string, Map<number, boolean>>();
  const nodes = new Map<string, Set<string>>();
  const marks = body.querySelectorAll<HTMLElement>(MARKS.join(', '));
  let inspected = 0;
  for (const mark of marks) {
    if (++inspected > 6000) break;
    const item = itemOf(markedBy(mark));
    const panel = item?.panel ?? item?.pid;
    if (!item || !panel || (item.row === undefined && item.node === undefined)) continue;
    const bounds = mark.getBoundingClientRect();
    const visible = bounds.width > 0 && bounds.height > 0
      && bounds.bottom > box.top + 1 && bounds.top < box.bottom - 1
      && bounds.right > box.left && bounds.left < box.right;
    if (item.node !== undefined) {
      if (visible) {
        const seen = nodes.get(panel) ?? new Set<string>();
        seen.add(item.node);
        nodes.set(panel, seen);
      }
    } else if (item.row !== undefined) {
      const seen = rows.get(panel) ?? new Map<number, boolean>();
      seen.set(item.row, !!seen.get(item.row) || visible);
      rows.set(panel, seen);
    }
  }

  const result: Record<string, Sight> = {};
  for (const [panel, seen] of rows) {
    const visible = [...seen].filter(([, shown]) => shown).map(([row]) => row);
    result[panel] = {
      first: visible.length ? Math.min(...visible) : -1,
      last: visible.length ? Math.max(...visible) : -1,
      n: visible.length,
      of: seen.size,
    };
  }
  for (const [panel, seen] of nodes) {
    result[panel] = { ...(result[panel] ?? { first: -1, last: -1, n: 0, of: 0 }), nodes: seen.size };
  }
  return Object.keys(result).length ? result : undefined;
}

export function measurePanes(
  panes: ReadonlyMap<string, PaneEl>,
  surfaces: ReadonlyMap<string, View>,
  placement: () => Placement | null,
  emit: (event: ShellEvent) => void,
) {
  let lastMeasure = '';
  let measureTimer: ReturnType<typeof setTimeout> | undefined;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  const checks = new Map<string, ReturnType<typeof setTimeout>>();
  // Each pane's last measure, kept until its pane scrolls or resizes (dirty) or the panes move (all of them).
  const measured = new Map<string, Measured>(), dirty = new Set<string>();
  let allDirty = true;

  /** Read back what a pane drew, once A2UI has drawn the probes in its open tab (hidden tabs render only when opened):
   *  at most a second's wait, then what is there, the missing as null. */
  async function verify(name: string, view: View, which: 'wide' | 'compact', always = false) {
    const pane = panes.get(name);
    if (!pane) return;
    const current = () => pane === panes.get(name) && pane.view === view && pane.drawn === which;
    if (!current() || !view.probes) return;
    const probes = view.probes[which];
    let tab: number | undefined, got: ReadBack[] = [];
    const read = () => {
      const tabs = tabsIn(pane.body);
      tab = tabs ? tabs.activeIndex ?? 0 : undefined;
      got = readBack(pane.body, probes);
      return !got.some((reading, i) => {
        const probe = probes[i];
        return reading.text === null && !probe.frame
          && (probe.tab === undefined || tab === undefined || probe.tab === tab);
      });
    };
    if (!(await rendered(pane.body, read))) read();
    if (!current()) return;
    const report = JSON.stringify([tab, got]);
    if (report === pane.told && !always) return;
    pane.told = report;
    emit({ type: 'rendered', view: name, seq: view.seq, surface: which, ...(tab !== undefined ? { tab } : {}), got });
  }

  function recheck(name: string, ms = 0, always = false) {
    clearTimeout(checks.get(name));
    checks.set(name, setTimeout(() => {
      const pane = panes.get(name);
      if (pane?.view?.probes && pane.drawn && !pane.el.hidden) void verify(name, pane.view, pane.drawn, always);
    }, ms));
  }

  // Not a wait for A2UI (verify waits for that): layout() runs on every frame of a window resize and every pointer move
  // of a dragged line, and this reads back every open pane, told or not, so a burst of layouts reads back once, after.
  function recheckAll() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      for (const pane of placement()?.panes ?? []) recheck(pane.view, 0, true);
    }, 250);
  }

  /** Each open pane's content and visible heights and what of it is in sight: measured again only where it changed. */
  function measure() {
    const current = placement();
    if (!current || current.mode === 'stacked' || current.mode === 'empty') return;
    const views: Record<string, Measured> = {};
    for (const { view } of current.panes) {
      const pane = panes.get(view);
      if (!pane || !surfaces.has(view)) continue;
      let now = measured.get(view);
      if (!now || allDirty || dirty.has(view)) {
        const sight = sightOf(pane.body);
        now = { content: pane.body.scrollHeight, visible: pane.body.clientHeight, ...(sight ? { sight } : {}) };
        measured.set(view, now);
      }
      views[view] = now;
    }
    for (const view of measured.keys()) if (!Object.hasOwn(views, view)) measured.delete(view);
    allDirty = false; dirty.clear();
    const key = JSON.stringify(views);
    if (key === lastMeasure || !Object.keys(views).length) return;
    lastMeasure = key;
    emit({ type: 'measure', views });
  }

  return {
    verify, recheck, recheckAll,
    /** Measure soon: the view's pane, which scrolled or resized; or, with none named, every pane, as after a layout. */
    scheduleMeasure: (view?: string) => {
      if (view === undefined) allDirty = true; else dirty.add(view);
      clearTimeout(measureTimer);
      measureTimer = setTimeout(measure, 160);
    },
    reset() { lastMeasure = ''; allDirty = true; },
    destroy() {
      clearTimeout(measureTimer);
      clearTimeout(checkTimer);
      for (const timer of checks.values()) clearTimeout(timer);
    },
  };
}
