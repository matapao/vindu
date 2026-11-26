// A view drawn in its pane (shell.ts): what A2UI draws of its surface, wide or compact, a host's own pane by its drawer
// (mounted once into the body, again if its kind changes), or what the pane says while it waits.
import type { PointItem } from '../pointing.js';
import type { ShellEvent, ShellState, ShownMeta } from '../shell.js';
import { framesLeaving, type elementsOf } from './dom.js';
import type { ShellHandle, ShellLabels, ShellOptions } from './shell-options.js';
import { drawPaneSurface, showLoading, type PaneEl } from './shell-pane.js';
import type { View } from './surface.js';
import { releaseSurface } from './surface-runtime.js';

/** What drawing a pane needs of the shell: its panes and views, its words, the host's components and drawers, and
 *  where what a view does goes (emit, onAction), measured and read back (scheduleMeasure, verify). */
type DrawParts = {
  make: ReturnType<typeof elementsOf>;
  labels: ShellLabels;
  panes: Map<string, PaneEl>;
  surfaces: Map<string, View>;
  tabs: Map<string, string>;
  meta: (name: string) => ShownMeta | undefined;
  emit: (e: ShellEvent) => void;
  scheduleMeasure: (view?: string) => void;
  verify: (name: string, v: View, which: 'wide' | 'compact') => Promise<void>;
  components: ShellOptions['components'];
  onAction: ShellOptions['onAction'];
  drawers: ShellOptions['panes'];
  handle: () => ShellHandle;
  state: () => ShellState;
};

/** How the shell draws a view in its pane, wide or compact. */
export function paneDrawing(d: DrawParts): (name: string, which: 'wide' | 'compact') => void {
  const { make, labels: L, panes, surfaces, tabs, meta, emit, scheduleMeasure, verify } = d;
  // a host's pane: its drawer, mounted once into the body (again if the kind changes)
  const drawHost = (name: string, p: PaneEl, kind: string) => {
    if (p.host?.kind === kind) return;
    releaseSurface(p.body);
    framesLeaving(p.body);
    p.host?.pane?.destroy?.();
    p.body.replaceChildren();
    p.body.dataset.host = kind;
    const drawer = d.drawers?.[kind];
    const m = meta(name)!;
    if (!drawer) {
      const w = make('p', 'vindu-pane-wait');
      w.textContent = L.noDrawer(kind);
      p.body.append(w);
      p.host = { kind, pane: null, box: '' };
      return;
    }
    p.host = {
      kind,
      pane: drawer({
        body: p.body,
        view: m,
        shell: d.handle(),
        point: (it) =>
          emit({
            type: 'select',
            by: 'pane',
            items: [...((d.state()?.pointing?.picked ?? []) as PointItem[]), { ...it, view: name }],
          }),
      }),
      box: '',
    };
  };
  const draw = (name: string, which: 'wide' | 'compact') => {
    const p = panes.get(name)!,
      v = surfaces.get(name),
      m = meta(name);
    if (m?.loading && !v) {
      showLoading(p.body, L.loading);
      return;
    }
    const kind = m?.kind;
    if (kind) {
      drawHost(name, p, kind);
      return;
    }
    if (!v) {
      if (!p.body.firstChild) {
        const w = make('p', 'vindu-pane-wait');
        w.textContent = '…';
        p.body.append(w);
      }
      return;
    }
    drawPaneSurface(p, v, which, {
      savedTab: tabs.get(name),
      components: d.components,
      missing: (component) => L.missing(component),
      measure: () => scheduleMeasure(name),
      verify: (surface) => void verify(name, v, surface),
      action(event) {
        d.onAction?.(event);
        const action = (event ?? {}) as { name?: string; context?: unknown };
        emit({ type: 'action', view: name, name: action.name, context: action.context });
      },
    });
  };
  return draw;
}
