// vindu's shell, drawn: a component a host mounts in an element of its own window, never one anything is installed in,
// that shows a process's views as panes, IDE-style. 1 px gray lines between panes and nothing else, a title
// bar per pane, and the shelf at the bottom: every view, the open ones first and then those collapsed into it. A lone
// view sits in the middle; a phone-width window stacks the panes. The boxes come from layout.ts's place(), the same code
// the UI server tells the model about, so what the model is told is what is drawn. A split drawn as a stack has a strip
// of tabs above the view in front: a tab marks a view that changed while behind, or that waits for the person; a click
// brings it in front, and Spread out shows them side by side again. A pane's Stack button stacks it with its neighbours.
// The person drags a line (or presses the arrow keys on a focused one; Enter or a double-click evens it), maximizes a
// pane, which has the focus then (double-click a title bar; Esc restores; a phone-width window, its panes stacked,
// maximizes none), collapses a pane into the shelf and opens it again (a click opens it where it was; hovering shows
// it, a peek, without moving anything), drags a pane by its title, or a view from the shelf, to a side of another pane
// (or a pane onto the shelf, to collapse it), and focuses panes (a click, or F6 and Shift+F6 from pane to pane). Each
// change is drawn at once and reported through onEvent, with the window's size and each view's content height, for
// the UI server (ui.event), whose state comes back. After drawing, and again when the panes move, a
// tab is opened or a pane is scrolled, the shell reads back what each view shows, for the UI server to check, and how far
// the person has read each panel, for the host alone (shell-reading.ts).
// A host makes it its own: tokens (colours, fonts, corners, for light and dark), labels (every word the shell says),
// actions (its own buttons, on panes and in the shelf) and command (the person's moves by name, for menus and keys).
// None of these reach the model: what it is told about the panes stays the same.
// A host draws panes of its own in the same layout (panes: a terminal, a browser page): the shell gives each its
// pane's body to draw in, and tells it the body's box in the window as the layout moves, or null when it is hidden, so a
// native view can lie over it.
import { mountPointing, type PointItem } from './pointing.js';
import { place, layoutOptions, viewsOf, type Placement } from '../layout.js';
import { resize } from '../layout-edit.js';
import type { ShellState, ShellEvent, ShownMeta} from '../shell.js';
import type { View } from './surface.js';
import { elementsOf } from './dom.js';
import { useTheme } from './theme.js';
import { SHELL_LABELS, type ShellLabels, type ShellOptions, type ShellHandle } from './shell-options.js';
import { connectShellFrames } from './shell-frames.js';
import { measurePanes } from './shell-measurements.js';
import { trackReading } from './shell-reading.js';
import { releaseSurface, rendered } from './surface-runtime.js';
import { fitPages, placeHost, type PaneEl } from './shell-pane.js';
import { mountDocking } from './shell-docking.js';
import { mountDividers } from './shell-dividers.js';
import { mountStacks } from './shell-stacks.js';
import { guardA2uiArrays } from './a2ui-limits.js';
import { checkedSources, setPictureSources } from './picture-sources.js';
import { mountCards } from './shell-cards.js';
import { paneElements } from './shell-pane-element.js';
import { mountPeek } from './shell-peek.js';
import { barButtons, barElements } from './shell-bar.js';
import { shellCommands } from './shell-commands.js';
import { paneDrawing } from './shell-draw.js';
import { shellSkin } from './shell-skin.js';
import { panePlacer } from './shell-place.js';
import { paneMoves } from './shell-moves.js';
import { PRESENTATION } from '../shell-presentation.js';

export { moveLine } from './shell-dividers.js';
export * from './shell-options.js';
export { sideAt } from './shell-docking.js';

let skins = 0;

/** Draws a process's views as panes in host, an element of the host's own window: a UI component, which installs nothing
 *  and in which nothing is installed. Give it what the UI server shows (handle.view, handle.state). */
export function mountShell(host: HTMLElement, o: ShellOptions = {}): ShellHandle {
  guardA2uiArrays();
  const sources = checkedSources(o.sources ?? []); // checked before anything is drawn
  const doc = host.ownerDocument;
  if (o.css !== false) useTheme(doc);
  const L: ShellLabels = { ...SHELL_LABELS, ...o.labels };
  const paneActs = (o.actions ?? []).filter(a => a.where === 'pane'), barActs = (o.actions ?? []).filter(a => a.where === 'bar');
  const make = elementsOf(doc);
  const root = make('div', 'vindu-shell vindu-theme'); root.tabIndex = -1; root.style.outline = 'none';
  const skinId = `s${++skins}`; root.dataset.vinduSkin = skinId; setPictureSources(root, sources);
  const skin = shellSkin({ doc, make, root, skinId, css: o.css !== false, tokens: o.tokens, metrics: o.metrics ?? {} });
  const desk = make('div', 'vindu-desk');
  const empty = make('div', 'vindu-empty'); empty.textContent = L.empty;
  const { bar, barViews, barShelf, barMode, suggest, remChip } = barElements({ doc, make, labels: L, barActs, emit: e => emit(e), handle: () => handle });
  const dropBox = make('div', 'vindu-drop'); dropBox.hidden = true; // where a dragged pane would go: over the desk, which starts at the shell's corner
  root.append(desk, empty, dropBox, bar); host.append(root);

  let st: ShellState = { tree: null, views: [], shelf: {}, maximized: null, focus: null, recent: [], options: layoutOptions(), rev: 0, suggestion: null };
  const surfaces = new Map<string, View>(), panes = new Map<string, PaneEl>(), tabs = new Map<string, string>(); // tabs: the tab the person last opened in each view, by title
  let placed: Placement | null = null;
  const changedBehind = new Set<string>(); // views drawn again while behind in a stack: their tab says so until in front
  let lastWindow = '';
  let winTimer: ReturnType<typeof setTimeout> | undefined;
  const emit = (e: ShellEvent) => o.onEvent?.(e);
  const measurements = measurePanes(panes, surfaces, () => placed, emit), reading = trackReading(root, panes, emit);
  const { verify, recheck, recheckAll } = measurements;
  // what is in sight, and so how far each panel has been read, changes with what changes the pane's measures
  const scheduleMeasure = (view?: string) => { measurements.scheduleMeasure(view); reading.soon(view); };
  // each view by name, and the views open in the layout: worked out once for each views and tree the state gives
  let byName = new Map<string, ShownMeta>(), namedFrom: ShownMeta[] | undefined;
  let openViews = new Set<string>(), openIn: ShellState['tree'] | undefined;
  const meta = (name: string) => {
    if (namedFrom !== st.views) { namedFrom = st.views; byName = new Map(); for (const v of st.views) if (!byName.has(v.name)) byName.set(v.name, v); }
    return byName.get(name);
  };
  const isOpen = (name: string | null | undefined): name is string => {
    if (openIn !== st.tree) { openIn = st.tree; openViews = new Set(viewsOf(st.tree)); }
    return !!name && openViews.has(name);
  };
  const pointer = mountPointing({ root, emit, picked: () => (st?.pointing?.picked ?? []) as PointItem[], masters: view => meta(view)?.masters ?? [] });
  const isStacked = () => placed?.mode === 'stacked';
  const deskSize = () => ({ w: desk.clientWidth, h: desk.clientHeight });
  const theme = (t: 'light' | 'dark' | 'auto' = 'auto') => { if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t; };
  theme(o.theme);

  const { paneFor, syncActs, drawMark } = paneElements({ doc, make, desk, skinId, labels: L, paneActs, panes, tabs, meta, emit, scheduleMeasure, recheck, isStacked, isOpen,
    handle: () => handle, placed: () => placed, peeking: () => peek.current(), keepPeek: () => peek.keep(), unpeek: () => unpeek(),
    openPane: name => openPane(name), focusPane: name => focusPane(name), collapsePane: name => collapsePane(name), toggleMax: name => toggleMax(name),
    startDrag: (name, e) => startDrag(name, e), justDragged: () => justDragged() });

  /** Each host's pane where it is now, for its native view, which lies over the whole window: in sight in the layout, or
   *  none while its view is collapsed, behind a maximized pane, under a peek of another, or while a pane is dragged. */
  const placeHosts = () => {
    const peeking = peek.current();
    for (const [name, p] of panes) if (p.host) placeHost(p, !p.el.hidden && !docking.active && (peeking ? peeking === name : !st.maximized || st.maximized === name));
  };
  const draw = paneDrawing({ make, labels: L, panes, surfaces, tabs, meta, emit, scheduleMeasure, verify, components: o.components, onAction: o.onAction, drawers: o.panes,
    handle: () => handle, state: () => st });
  const placePane = panePlacer({ desk, labels: L, meta, paneFor, syncActs, drawMark, draw, changedBehind, state: () => st });
  const layout = () => {
    const win = deskSize();
    placed = cards.arrange(st, place(st.tree, win, { maximized: st.maximized, fill: new Set(st.views.filter(v => v.fill).map(v => v.name)), options: st.options,
      asks: new Set(st.views.filter(v => v.ask).map(v => v.name)), recent: st.recent }), win.w); // as cards: what is drawn whole, then the cards
    const pl = placed;
    root.dataset.mode = cards.shows.as === 'cards' ? 'cards' : pl.mode;
    const shown = new Set(pl.panes.map(p => p.view));
    const peeking = peek.current();
    for (const [name, p] of panes) if (!shown.has(name) && name !== peeking) p.el.hidden = true;
    if (peeking && shown.has(peeking)) { const p = panes.get(peeking); p?.el.classList.remove('is-peek'); p?.open.remove(); peek.end(); }
    const stackAt = new Set(pl.stacks.map(x => x.path.join('.')));
    const fills: PaneEl[] = []; // pages that fill their panes: fitted once every pane's box is written
    pl.panes.forEach((pp, i) => placePane(pp, i, pl, stackAt, fills));
    fitPages(fills, isStacked);
    placeHosts();
    dividers.render(pl);
    stacks.render(pl);
    cards.render();
    empty.hidden = pl.mode !== 'empty';
    renderBar();
    scheduleMeasure();
    recheckAll();
  };
  // the views as cards: a card opened alone or the person's switch, drawn at once, then told (shell-cards.ts)
  const presenting = (p: Partial<typeof PRESENTATION>, e: ShellEvent) => { st = { ...st, presentation: { ...(st.presentation ?? PRESENTATION), ...p } }; layout(); emit(e); };
  const cards = mountCards({ desk, bar, make, labels: L, meta, pane: name => panes.get(name),
    open: view => presenting({ alone: view }, { type: 'card', view }), presentAs: as => presenting({ as, alone: null }, { type: 'presentation', as }) });
  const stacks = mountStacks({
    desk, make, labels: L, emit,
    title: view => meta(view)?.title ?? view,
    paneId: view => panes.get(view)?.el.id,
    changed: view => changedBehind.has(view),
    asks: view => !!meta(view)?.ask,
  });

  const dividers = mountDividers(root, desk, {
    title: name => meta(name)?.title ?? name,
    label: (first, second) => L.resize(first, second),
    resize(path, sizes) {
      const tree = resize(st.tree, path, sizes);
      if (!tree) return false;
      st = { ...st, tree };
      return true;
    },
    commit: (path, sizes) => emit({ type: 'resize', path, sizes }),
    layout,
  });

  const { focusPane, toggleMax, collapsePane, openPane, movePane } = paneMoves({ panes, meta, isOpen, isStacked, deskSize, emit,
    layout: () => layout(), renderBar: () => renderBar(), unpeek: now => unpeek(now), state: () => st, set: next => { st = next; } });

  const peek = mountPeek({ desk, labels: L, panes, surfaces, meta, isOpen, isStacked, paneFor, draw, placeHosts, docking: () => docking.active, placed: () => placed, compact: () => st.options.compact });
  const { soon: peekSoon, hide: unpeek } = peek;

  const docking = mountDocking({
    root, desk, bar, dropBox, placement: () => placed, isOpen,
    title: name => meta(name)?.title ?? name,
    onStart() { unpeek(true); placeHosts(); },
    onEnd: placeHosts,
    collapse: collapsePane,
    dockPane(name, at) { if (isOpen(name)) movePane(name, at); else openPane(name, at); },
  });
  const { startDrag, justDragged } = docking;

  const renderBar = barButtons({ doc, make, labels: L, barViews, barShelf, barMode, suggest, remChip, meta, isOpen, peekSoon, unpeek,
    focusPane: (name, reveal) => focusPane(name, reveal), openPane: name => openPane(name), startDrag: (name, e) => startDrag(name, e), justDragged: () => justDragged(),
    dragPending: () => docking.pending, state: () => st, placed: () => placed, cardsShown: () => cards.shows.as });

  const command = shellCommands({ root, panes, meta, isOpen, focusPane, toggleMax, collapsePane, openPane, movePane, unpeek,
    state: () => st, placed: () => placed, peeking: () => peek.current(), cardsBack: () => cards.back() });
  let laying = 0, destroyed = false; // a resize lays the panes out in the next frame, once: never inside the observer's own delivery
  const watch = new ResizeObserver(() => {
    if (!dividers.dragging && !laying) laying = (doc.defaultView ?? window).requestAnimationFrame(() => { laying = 0; if (!dividers.dragging) layout(); });
    clearTimeout(winTimer);
    winTimer = setTimeout(() => {
      const w = desk.clientWidth, h = desk.clientHeight, k = `${w}x${h}`;
      if (w > 0 && h > 0 && k !== lastWindow) { lastWindow = k; measurements.reset(); emit({ type: 'window', w, h }); }
    }, 120);
  });
  watch.observe(desk);
  root.addEventListener('scroll', placeHosts, { capture: true, passive: true }); // a stacked window scrolls: native views follow

  const frames = connectShellFrames(root, emit, { locale: o.locale, read: reading.frame });

  const handle: ShellHandle = {
    view(v) {
      surfaces.set(v.name, v); measurements.reset(); if (placed?.panes.some(x => x.view === v.name && x.behind)) changedBehind.add(v.name);
      const p = panes.get(v.name); if (p && peek.current() === v.name) draw(v.name, p.drawn ?? 'wide');
      layout();
      const drawn = panes.get(v.name); // what is picked in it is marked once A2UI has drawn its rows
      void (drawn ? rendered(drawn.body) : Promise.resolve(true)).then(() => { if (!destroyed) pointer.mark((st?.pointing?.picked ?? []) as PointItem[], st?.pointing?.attached ?? []); });
    },
    state(s) {
      const before = st.views.map(v => v.name);
      st = { ...s, shelf: s.shelf ?? {} }; measurements.reset();
      // a view that left the window (an answered ask, an ended terminal) takes its pane along, once its MCP Apps have torn
      // down; one collapsed stays, for the shelf
      for (const [name, p] of panes) { const v = meta(name); if (!v || (p.host && !v.kind)) { p.seen?.disconnect(); releaseSurface(p.body); p.host?.pane?.destroy?.(); frames.remove(p.el); panes.delete(name); } }
      for (const name of before) if (!meta(name)) surfaces.delete(name);
      if (!dividers.dragging) layout();
      pointer.mark((s.pointing?.picked ?? []) as PointItem[], s.pointing?.attached ?? []);
    },
    theme(t) { theme(t); frames.themeChanged(); },
    locale: frames.setLocale,
    tokens: skin.tokens, command,
    metrics(value) {
      const fonts = skin.metrics(value);
      if (fonts) frames.setFonts(fonts);
      layout();
    },
    placement: () => placed,
    app: frames.send,
    destroy() {
      destroyed = true; pointer.destroy(); docking.destroy(); measurements.destroy(); reading.destroy();
      watch.disconnect(); clearTimeout(winTimer); peek.clear(); (doc.defaultView ?? window).cancelAnimationFrame(laying); laying = 0;
      for (const p of panes.values()) { p.seen?.disconnect(); releaseSurface(p.body); p.host?.pane?.destroy?.(); }
      panes.clear(); surfaces.clear(); // what still waits on a pane (a read back, a tab) finds none
      frames.remove(root, () => { frames.destroy(); skin.remove(); }); // its MCP Apps hear the window go, and may answer
    },
  };
  layout();
  return handle;
}
