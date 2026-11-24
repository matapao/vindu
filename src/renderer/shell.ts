// vindu's shell, drawn: a process's views as panes, IDE-style. 1 px gray lines between panes and nothing else, a title
// bar per pane, and the shelf at the bottom: every view, the open ones first and then those collapsed into it. A lone
// view sits in the middle; a phone-width window stacks the panes. The boxes come from layout.ts's place(), the same code
// the UI server tells the model about, so what the model is told is what is drawn. A split drawn as a stack has a strip
// of tabs above the view in front: a tab marks a view that changed while behind, or that waits for the person; a click
// brings it in front, and Spread out shows them side by side again. A pane's Stack button stacks it with its neighbours.
// The person drags a line (or presses the arrow keys on a focused one; Enter or a double-click evens it), maximizes
// (double-click a title bar; Esc restores), collapses a pane into the shelf and opens it again (a click opens it where
// it was; hovering shows it, a peek, without moving anything), drags a pane by its title, or a view from the shelf, to a
// side of another pane (or a pane onto the shelf, to collapse it), and focuses panes (a click, or F6 and Shift+F6 from
// pane to pane). Each change is drawn at once and reported through onEvent, with the window's size and each view's
// content height, for the UI server (ui.event), whose state comes back. After drawing, and again when the panes move, a
// tab is opened or a pane is scrolled, the shell reads back what each view shows, for the UI server to check, and how far
// the person has read each panel, for the host alone (shell-reading.ts).
// A host makes it its own: tokens (colours, fonts, corners, for light and dark), labels (every word the shell says),
// actions (its own buttons, on panes and in the shelf) and command (the person's moves by name, for menus and keys).
// None of these reach the model: what it is told about the panes stays the same.
// A host draws panes of its own in the same layout (panes: a terminal, a browser page): the shell gives each its
// pane's body to draw in, and tells it the body's box in the window as the layout moves, or null when it is hidden, so a
// native view can lie over it.
import { mountPointing, type PointItem } from './pointing.js';
import { place, resize, remove, insert, openView, slotOf, layoutOptions, viewsOf, type Placement, type Place } from '../layout.js';
import type { ShellState, ShellEvent, ShownMeta, ViewMeta } from '../shell.js';
import { roleFor } from '../shell-roles.js';
import type { View } from './surface.js';
import { elementsOf, framesLeaving, iconOf } from './dom.js';
import { useMetricStyles, useTheme } from './theme.js';
import { appFontVariables, setMetrics, type ViewMetrics } from './metrics.js';
import { SHELL_LABELS, skinCss, type ShellLabels, type ShellOptions, type ShellHandle, type ShellSkin, type ShellCommand, type ShellAction, type ShownView } from './shell-options.js';
import { connectShellFrames, isLeaving } from './shell-frames.js';
import { measurePanes } from './shell-measurements.js';
import { trackReading } from './shell-reading.js';
import { releaseSurface, rendered } from './surface-runtime.js';
import { drawPaneSurface, fitPage, fitPages, placeHost, showLoading, tabTitle, type PaneEl } from './shell-pane.js';
import { mountDocking } from './shell-docking.js';
import { mountDividers } from './shell-dividers.js';
import { mountStacks } from './shell-stacks.js';
import { guardA2uiArrays } from './a2ui-limits.js';

export { moveLine } from './shell-dividers.js';
export * from './shell-options.js';
export { sideAt } from './shell-docking.js';

const ICON = {
  max: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/></svg>',
  restore: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3"/></svg>',
  fold: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v6.5M5.25 6.75 8 9.5l2.75-2.75M3.5 12.5h9"/></svg>',
  chat: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
  stack: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h9v8M2.5 5h9v8.5h-9z"/></svg>',
};
let skins = 0, paneIds = 0;

export function mountShell(host: HTMLElement, o: ShellOptions = {}): ShellHandle {
  guardA2uiArrays();
  const doc = host.ownerDocument;
  if (o.css !== false) useTheme(doc);
  const L: ShellLabels = { ...SHELL_LABELS, ...o.labels };
  const paneActs = (o.actions ?? []).filter(a => a.where === 'pane'), barActs = (o.actions ?? []).filter(a => a.where === 'bar');
  const make = elementsOf(doc);
  const root = make('div', 'vindu-shell vindu-theme'); root.tabIndex = -1; root.style.outline = 'none';
  const skinId = `s${++skins}`; root.dataset.vinduSkin = skinId;
  const skin = make('style'); skin.dataset.vindu = 'skin';
  const tokens = (t: ShellSkin = {}) => { skin.textContent = skinCss(`.vindu-shell.vindu-theme[data-vindu-skin="${skinId}"]`, t); };
  tokens(o.tokens); doc.head.append(skin);
  const applyMetrics = (value: ViewMetrics) => {
    const reset = setMetrics(root, value);
    if (root.dataset.vinduMetrics && o.css !== false) useMetricStyles(doc);
    return reset;
  };
  let resetMetrics = applyMetrics(o.metrics ?? {});
  const desk = make('div', 'vindu-desk');
  const empty = make('div', 'vindu-empty'); empty.textContent = L.empty;
  const bar = make('footer', 'vindu-bar'); const barViews = make('div', 'vindu-bar-views'), barShelf = make('div', 'vindu-bar-shelf'), barMode = make('span', 'vindu-bar-mode');
  barViews.setAttribute('role', 'toolbar'); barViews.setAttribute('aria-label', L.views);
  barShelf.setAttribute('role', 'toolbar'); barShelf.setAttribute('aria-label', L.shelf);
  bar.append(barViews, barShelf, make('span', 'vindu-bar-space')); // the open views, then those collapsed into the shelf
  if (barActs.length) {
    const box = make('div', 'vindu-bar-actions'); box.setAttribute('role', 'toolbar'); box.setAttribute('aria-label', L.actions);
    for (const a of barActs) { const b = actButton(doc, a); b.addEventListener('click', () => a.run({ view: null, body: null, shell: handle })); box.append(b); }
    bar.append(box);
  }
  const suggest = make('button', 'vindu-act-text'); suggest.type = 'button'; suggest.textContent = L.suggestion; suggest.hidden = true;
  suggest.addEventListener('click', () => emit({ type: 'take-suggestion' }));
  const remChip = make('button', 'vindu-bar-rem'); remChip.type = 'button'; remChip.hidden = true; // only where the window keeps reminders
  remChip.addEventListener('click', () => emit({ type: 'reminders' }));
  const dropBox = make('div', 'vindu-drop'); dropBox.hidden = true; // where a dragged pane would go: over the desk, which starts at the shell's corner
  bar.append(suggest, remChip, barMode); root.append(desk, empty, dropBox, bar); host.append(root);

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
  const pointer = mountPointing({ root, emit: e => emit(e as ShellEvent), picked: () => (st?.pointing?.picked ?? []) as PointItem[], masters: view => meta(view)?.masters ?? [] });
  const isStacked = () => placed?.mode === 'stacked';
  const deskSize = () => ({ w: desk.clientWidth, h: desk.clientHeight });
  const theme = (t: 'light' | 'dark' | 'auto' = 'auto') => { if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t; };
  theme(o.theme);

  const paneFor = (name: string): PaneEl => {
    const had = panes.get(name); if (had) return had;
    const el = make('section', 'vindu-pane'); el.dataset.view = name; el.setAttribute('role', 'region'); el.id = `vindu-${skinId}-pane-${++paneIds}`; // a stack's tab names the panes it controls
    const head = make('header', 'vindu-pane-head'), title = make('span', 'vindu-pane-title'), sub = make('span', 'vindu-pane-sub'), mark = make('span', 'vindu-pane-mark'), tools = make('span', 'vindu-pane-tools');
    mark.hidden = true; mark.setAttribute('role', 'status');
    const max = make('button'), fold = make('button'), chat = make('button', 'vindu-chat'), stack = make('button', 'vindu-stack-pane'), open = make('button', 'vindu-pane-open');
    max.type = fold.type = chat.type = stack.type = open.type = 'button';
    stack.innerHTML = ICON.stack; stack.setAttribute('aria-label', L.stack); stack.title = L.stackHint; stack.hidden = true;
    stack.addEventListener('click', () => { const pp = placed?.panes.find(x => x.view === name); if (pp && pp.path.length) emit({ type: 'stack', path: pp.path.slice(0, -1) }); });
    fold.innerHTML = ICON.fold; fold.setAttribute('aria-label', L.collapse); fold.title = L.collapseHint;
    chat.innerHTML = ICON.chat; chat.setAttribute('aria-label', L.chat); chat.title = `${L.chat}: ${L.chatHint}`; chat.setAttribute('aria-pressed', 'false');
    chat.addEventListener('click', () => emit({ type: 'attach', view: name, on: chat.getAttribute('aria-pressed') !== 'true' }));
    open.textContent = L.open; open.title = L.peek; open.addEventListener('click', () => { if (peeking === name) openPane(name); }); // in a peek only
    tools.append(chat, stack, fold, max); head.append(title, sub, mark, tools); // open goes in only while the pane is a peek
    const body = make('div', 'vindu-pane-body'); body.tabIndex = -1; // F6 moves the keyboard here
    body.addEventListener('scroll', () => scheduleMeasure(name), { passive: true }); // what is in sight changes as it scrolls
    el.append(head, body); desk.append(el);
    el.addEventListener('pointerdown', () => focusPane(name), true);
    head.addEventListener('pointerdown', e => { if (!(e.target as Element).closest('button')) startDrag(name, e); });
    head.addEventListener('dblclick', e => { if (!(e.target as Element).closest('button') && isOpen(name)) toggleMax(name); });
    head.addEventListener('click', e => { if (peeking === name && !(e.target as Element).closest('button') && !justDragged()) openPane(name); });
    max.addEventListener('click', () => { if (isOpen(name)) toggleMax(name); });
    fold.addEventListener('click', () => { if (isOpen(name)) collapsePane(name); });
    el.addEventListener('pointerenter', () => { if (peeking === name) clearTimeout(unpeekTimer); });
    el.addEventListener('pointerleave', () => { if (peeking === name) unpeek(); });
    // what the shell reads back changes when a tab opens (read once A2UI has drawn it), a frame loads or the pane scrolls
    body.addEventListener('click', e => {
      if (!(e.target as Element).closest?.('.a2ui-tab-button')) return;
      void rendered(body).then(() => { const t = tabTitle(body), p = panes.get(name); if (t) tabs.set(name, t); if (p && meta(name)?.fill) fitPage(p, isStacked); recheck(name); scheduleMeasure(name); });
    });
    body.addEventListener('load', e => { if (e.target instanceof HTMLIFrameElement) { e.target.dataset.loaded = '1'; recheck(name); } }, true);
    body.addEventListener('scroll', () => recheck(name, 300), { passive: true });
    const p: PaneEl = { el, head, title, sub, mark, tools, max, fold, stack, open, acts: new Map(), body, drawn: null, view: null };
    panes.set(name, p); return p;
  };
  // the host's pane actions, on the panes they are for; a view shown again may now be for others
  const syncActs = (p: PaneEl, name: string) => {
    const m = meta(name), v: ShownView = m ?? { name, title: name, fill: false, panels: '', role: roleFor({}) };
    for (const a of paneActs) {
      const want = !a.when || a.when(v), had = p.acts.get(a.id);
      if (want && !had) {
        const b = actButton(doc, a);
        b.addEventListener('click', () => a.run({ view: meta(name) ?? v, body: p.body, shell: handle }));
        p.tools.insertBefore(b, p.tools.querySelector('.vindu-chat') ?? p.fold); p.acts.set(a.id, b);
      } else if (!want && had) { had.remove(); p.acts.delete(a.id); }
    }
  };

  // a change inside a view (actions.ts), marked on its pane: by whom, with an undo; or what the model suggests, to take or not
  const drawMark = (p: PaneEl, name: string, mk: ViewMeta['mark']) => {
    const key = mk ? JSON.stringify(mk) : ''; if (p.markKey === key) return;
    p.markKey = key; p.mark.replaceChildren(); p.mark.hidden = !mk; if (!mk) return;
    const t = make('span', 'vindu-mark-text'); t.textContent = mk.by === 'model' ? `${mk.suggestion ? L.suggests : L.byModel}: ${mk.text}` : mk.text; p.mark.append(t);
    const button = (label: string, action: string) => { const b = make('button', 'vindu-act-text'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => emit({ type: 'view', view: name, action } as unknown as ShellEvent)); p.mark.append(b); };
    if (mk.suggestion) { button(L.take, 'take'); button(L.dismiss, 'dismiss'); } else if (mk.undo) button(L.undo, 'undo');
  };

  // a host's pane: its drawer, mounted once into the body (again if the kind changes)
  const drawHost = (name: string, p: PaneEl, kind: string) => {
    if (p.host?.kind === kind) return;
    releaseSurface(p.body); framesLeaving(p.body); p.host?.pane?.destroy?.(); p.body.replaceChildren(); p.body.dataset.host = kind;
    const drawer = o.panes?.[kind]; const m = meta(name)!;
    if (!drawer) { const w = make('p', 'vindu-pane-wait'); w.textContent = L.noDrawer(kind); p.body.append(w); p.host = { kind, pane: null, box: '' }; return; }
    p.host = { kind, pane: drawer({ body: p.body, view: m, shell: handle, point: it => emit({ type: 'select', by: 'pane', items: [...((st?.pointing?.picked ?? []) as PointItem[]), { ...it, view: name }] }) }), box: '' };
  };
  /** Each host's pane where it is now, for its native view, which lies over the whole window: in sight in the layout, or
   *  none while its view is collapsed, behind a maximized pane, under a peek of another, or while a pane is dragged. */
  const placeHosts = () => {
    for (const [name, p] of panes) if (p.host) placeHost(p, !p.el.hidden && !docking.active && (peeking ? peeking === name : !st.maximized || st.maximized === name));
  };
  const draw = (name: string, which: 'wide' | 'compact') => {
    const p = panes.get(name)!, v = surfaces.get(name), m = meta(name);
    if (m?.loading && !v) {
      showLoading(p.body, L.loading);
      return;
    }
    const kind = m?.kind;
    if (kind) { drawHost(name, p, kind); return; }
    if (!v) { if (!p.body.firstChild) { const w = make('p', 'vindu-pane-wait'); w.textContent = '…'; p.body.append(w); } return; }
    drawPaneSurface(p, v, which, {
      savedTab: tabs.get(name),
      components: o.components,
      missing: component => L.missing(component),
      measure: () => scheduleMeasure(name),
      verify: surface => void verify(name, v, surface),
      action(event) {
        o.onAction?.(event);
        const action = (event ?? {}) as { name?: string; context?: unknown };
        emit({ type: 'action', view: name, name: action.name, context: action.context });
      },
    });
  };
  const layout = () => {
    const win = deskSize();
    placed = place(st.tree, win, { maximized: st.maximized, fill: new Set(st.views.filter(v => v.fill).map(v => v.name)), options: st.options,
      asks: new Set(st.views.filter(v => v.ask).map(v => v.name)), recent: st.recent });
    const pl = placed;
    root.dataset.mode = pl.mode;
    const shown = new Set(pl.panes.map(p => p.view));
    for (const [name, p] of panes) if (!shown.has(name) && name !== peeking) p.el.hidden = true;
    if (peeking && shown.has(peeking)) { const p = panes.get(peeking); p?.el.classList.remove('is-peek'); p?.open.remove(); peeking = null; }
    const stackAt = new Set(pl.stacks.map(x => x.path.join('.')));
    const fills: PaneEl[] = []; // pages that fill their panes: fitted once every pane's box is written
    pl.panes.forEach((pp, i) => {
      const p = paneFor(pp.view), s = p.el.style, m = meta(pp.view);
      p.stack.hidden = !pp.path.length || stackAt.has(pp.path.slice(0, -1).join('.')) || pl.mode !== 'tiled'; // stacked already, or nothing to stack with
      if (pp.behind) { // a tab behind another: drawn, ready, out of sight
        p.el.hidden = true; placeHost(p, false);
        p.title.textContent = m?.title ?? pp.view; syncActs(p, pp.view); draw(pp.view, pp.compact ? 'compact' : 'wide');
        return;
      }
      changedBehind.delete(pp.view);
      p.el.hidden = false;
      if (pl.mode === 'single') Object.assign(s, { left: '', top: '', marginLeft: `${pp.box!.x}px`, width: `${pp.box!.w}px`, height: pp.fit ? '' : `${pp.box!.h}px`, maxHeight: `${pp.box!.h}px` });
      else if (pp.box) Object.assign(s, { left: `${pp.box.x}px`, top: `${pp.box.y}px`, marginLeft: '', width: `${pp.box.w}px`, height: `${pp.box.h}px`, maxHeight: '' });
      else Object.assign(s, { left: '', top: '', marginLeft: '', width: '', height: '', maxHeight: '' });
      // reading order; a pane on its way out keeps its place until it goes, as a frame that moves loads its document again
      if (pl.mode === 'stacked') { const at = [...desk.children].filter(child => !isLeaving(child))[i] ?? null; if (at !== p.el) desk.insertBefore(p.el, at); }
      const title = m?.title ?? pp.view;
      p.title.textContent = title; p.title.title = `${title} (${pp.view})`; p.sub.textContent = m?.subtitle ?? ''; drawMark(p, pp.view, m?.mark);
      // its role says whether it has "In the chat"; a state from before roles: not an ask, a reservation, or a host's
      // pane that points its own way
      const chat = p.tools.querySelector<HTMLElement>('.vindu-chat'); if (chat) chat.hidden = !(m?.role?.chat ?? !(m?.ask || m?.loading || m?.kind === 'terminal' || m?.kind === 'browser'));
      p.el.setAttribute('aria-label', title); p.head.removeAttribute('title');
      p.el.toggleAttribute('data-focus', st.focus === pp.view);
      p.body.toggleAttribute('data-fill', !!m?.fill);
      const isMax = st.maximized === pp.view;
      if (p.maxed !== isMax) { p.maxed = isMax; p.max.innerHTML = isMax ? ICON.restore : ICON.max; p.max.setAttribute('aria-label', isMax ? L.restore : L.maximize); p.max.title = isMax ? L.restoreHint : L.maximizeHint; }
      syncActs(p, pp.view);
      draw(pp.view, pp.compact ? 'compact' : 'wide');
      if (m?.kind) return;
      if (m?.fill) fills.push(p); else p.body.style.removeProperty('--vindu-page-h');
    });
    fitPages(fills, isStacked);
    placeHosts();
    dividers.render(pl);
    stacks.render(pl);
    empty.hidden = pl.mode !== 'empty';
    renderBar();
    scheduleMeasure();
    recheckAll();
  };
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

  const focusPane = (name: string, reveal = false) => {
    if (!isOpen(name)) return;
    if (reveal) panes.get(name)?.el.scrollIntoView({ block: 'nearest' });
    if (st.focus === name) return;
    st = { ...st, focus: name };
    for (const [n, p] of panes) p.el.toggleAttribute('data-focus', n === name);
    renderBar(); emit({ type: 'focus', view: name });
  };
  const toggleMax = (name: string) => { const next = st.maximized === name ? null : name; st = { ...st, maximized: next }; layout(); emit({ type: 'maximize', view: next }); };
  // each move is made here first, with the same layout code the UI server runs, so it is drawn at once
  const collapsePane = (name: string) => {
    st = { ...st, tree: remove(st.tree, name), shelf: { ...st.shelf, [name]: { by: 'person', at: st.rev, slot: slotOf(st.tree, name) } },
      maximized: st.maximized === name ? null : st.maximized, focus: st.focus === name ? null : st.focus };
    layout(); emit({ type: 'collapse', view: name });
  };
  const openPane = (name: string, at?: Place) => {
    unpeek(true);
    const r = openView(st.tree, name, deskSize(), { place: at, slot: st.shelf[name]?.slot, recent: st.recent.filter(v => v !== name), options: st.options });
    const shelf = { ...st.shelf }; delete shelf[name];
    st = { ...st, tree: r.tree, shelf, focus: name, maximized: at ? null : st.maximized };
    layout(); emit({ type: 'open', view: name, ...(at ? { place: at } : {}) });
  };
  const movePane = (name: string, at: Place) => {
    st = { ...st, tree: insert(st.tree, name, deskSize(), { place: at, options: st.options }).tree, focus: name, maximized: null };
    layout(); emit({ type: 'move', view: name, place: at });
  };

  // a peek: a collapsed view shown above the shelf while the pointer is on its button, the layout left as it is
  let peeking: string | null = null, peekTimer: ReturnType<typeof setTimeout> | undefined, unpeekTimer: ReturnType<typeof setTimeout> | undefined;
  const peekSoon = (name: string, at: HTMLElement) => { clearTimeout(unpeekTimer); clearTimeout(peekTimer); if (peeking !== name) peekTimer = setTimeout(() => peek(name, at), peeking ? 0 : 450); };
  const peek = (name: string, at: HTMLElement) => {
    if (docking.active || isOpen(name) || (!surfaces.has(name) && !meta(name)?.kind) || placed?.mode === 'stacked') return;
    unpeek(true); peeking = name;
    const p = paneFor(name), d = desk.getBoundingClientRect(), c = at.getBoundingClientRect(), m = meta(name);
    const w = Math.round(Math.min(720, Math.max(300, d.width * 0.55))), h = Math.round(Math.min(480, Math.max(200, d.height * 0.6)));
    Object.assign(p.el.style, { left: `${Math.round(Math.max(8, Math.min(d.width - w - 8, c.left - d.left + c.width / 2 - w / 2)))}px`, top: `${Math.max(8, Math.round(d.height - h - 8))}px`, width: `${w}px`, height: `${h}px`, marginLeft: '', maxHeight: '' });
    p.el.classList.add('is-peek'); p.el.hidden = false; p.el.toggleAttribute('data-focus', false); p.head.insertBefore(p.open, p.tools);
    p.title.textContent = m?.title ?? name; p.sub.textContent = m?.subtitle ?? ''; p.head.title = L.peek;
    draw(name, w < st.options.compact ? 'compact' : 'wide');
    if (m?.fill && !m.kind) fitPage(p, isStacked);
    placeHosts(); // a host's pane in the peek shows there; the others' native views would cover it
  };
  const unpeek = (now = false) => {
    clearTimeout(peekTimer);
    const go = () => { const name = peeking; if (!name) return; peeking = null; const p = panes.get(name); if (p) { p.el.classList.remove('is-peek'); p.open.remove(); if (!isOpen(name)) p.el.hidden = true; } placeHosts(); };
    if (now) go(); else { clearTimeout(unpeekTimer); unpeekTimer = setTimeout(go, 220); }
  };

  const docking = mountDocking({
    root, desk, bar, dropBox, placement: () => placed, isOpen,
    title: name => meta(name)?.title ?? name,
    onStart() { unpeek(true); placeHosts(); },
    onEnd: placeHosts,
    collapse: collapsePane,
    dockPane(name, at) { if (isOpen(name)) movePane(name, at); else openPane(name, at); },
  });
  const { startDrag, justDragged } = docking;

  const barButtons = new Map<string, HTMLButtonElement>(); // kept, not remade, so a button keeps the keyboard's focus
  const chip = (name: string): HTMLButtonElement => {
    let b = barButtons.get(name); if (b) return b;
    b = make('button', 'vindu-bar-view'); b.type = 'button'; b.append(make('span'));
    b.addEventListener('click', () => { if (justDragged()) return; if (isOpen(name)) focusPane(name, true); else openPane(name); }); // decided when clicked
    b.addEventListener('pointerdown', e => startDrag(name, e));
    b.addEventListener('pointerenter', () => { if (!isOpen(name) && !docking.pending) peekSoon(name, b); });
    b.addEventListener('pointerleave', () => unpeek());
    b.addEventListener('focus', () => { if (!isOpen(name) && b.matches(':focus-visible')) peekSoon(name, b); });
    b.addEventListener('blur', () => unpeek());
    barButtons.set(name, b); return b;
  };
  const renderBar = () => {
    for (const [name, b] of barButtons) if (!meta(name)) { b.remove(); barButtons.delete(name); }
    const opened = st.views.filter(v => isOpen(v.name)), parked = st.views.filter(v => !isOpen(v.name)).sort((a, b) => (st.shelf[a.name]?.at ?? 0) - (st.shelf[b.name]?.at ?? 0));
    for (const [box, list] of [[barViews, opened], [barShelf, parked]] as const) list.forEach((v, i) => {
      const b = chip(v.name);
      if (box.children[i] !== b) { const had = doc.activeElement === b; box.insertBefore(b, box.children[i] ?? null); if (had) b.focus({ preventScroll: true }); } // moved, it keeps the keyboard
      const down = !isOpen(v.name), updated = down && !!st.shelf[v.name]?.updated;
      b.firstElementChild!.textContent = v.title;
      b.classList.toggle('is-collapsed', down); b.classList.toggle('is-updated', updated); b.classList.toggle('is-focus', st.focus === v.name);
      b.title = down ? L.collapsed(v.title, updated) : v.title;
      b.setAttribute('aria-pressed', String(st.focus === v.name));
    });
    const pl = placed;
    barMode.textContent = pl ? L.mode(pl.mode, pl.panes.filter(x => !x.behind).length) : '';
    suggest.hidden = !st.suggestion;
    const rem = st.reminders; remChip.hidden = !rem;
    if (rem) { remChip.textContent = L.reminders(rem.set, rem.due); remChip.title = L.remindersHint; remChip.classList.toggle('is-due', rem.due > 0); remChip.setAttribute('aria-live', 'polite'); }
  };

  const step = (back: boolean) => { // from pane to pane in reading order, as between a browser's regions: those in sight
    const order = (placed?.panes ?? []).filter(p => !p.behind).map(p => p.view);
    if (!order.length) return false;
    const at = st.focus ? order.indexOf(st.focus) : -1;
    const next = order[(at + (back ? -1 : 1) + order.length) % order.length];
    focusPane(next, true); panes.get(next)?.body.focus({ preventScroll: true });
    return true;
  };
  root.addEventListener('keydown', e => {
    const own = (e.target as Element | null)?.closest?.('.vindu-pane-body[data-host]'); // a host's pane (a terminal) gets its own Esc
    if (e.key === 'Escape' && peeking && !own) { e.preventDefault(); unpeek(true); return; }
    if (e.key === 'Escape' && st.maximized && !own) { e.preventDefault(); toggleMax(st.maximized); }
    if (e.key === 'F6' && step(e.shiftKey)) e.preventDefault();
  });
  const command = (c: ShellCommand): boolean => {
    switch (c.type) {
      case 'maximize': { const name = c.view ?? st.focus; if (!isOpen(name)) return false; toggleMax(name); return true; }
      case 'restore': if (!st.maximized) return false; toggleMax(st.maximized); return true;
      case 'collapse': case 'close': { const name = c.view ?? st.focus; if (!isOpen(name)) return false; collapsePane(name); return true; }
      case 'open': case 'show': {
        if (!meta(c.view)) return false;
        const at = c.type === 'open' ? c.place : undefined;
        if (!isOpen(c.view)) { if (at && !isOpen(at.beside)) return false; openPane(c.view, at); }
        else if (at) { if (!isOpen(at.beside) || at.beside === c.view) return false; movePane(c.view, at); }
        else focusPane(c.view, true);
        return true;
      }
      case 'next': return step(false);
      case 'previous': return step(true);
      default: return false;
    }
  };
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
      const p = panes.get(v.name); if (p && peeking === v.name) draw(v.name, p.drawn ?? 'wide');
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
    tokens, command,
    metrics(value) {
      const previous = appFontVariables(root);
      resetMetrics();
      resetMetrics = applyMetrics(value);
      const variables = appFontVariables(root);
      // An empty CSS value removes an override from an already initialized frame.
      for (const key of Object.keys(previous)) if (!(key in variables)) variables[key] = '';
      if (Object.keys(variables).some(key => variables[key] !== previous[key])) {
        frames.setFonts(variables);
      }
      layout();
    },
    placement: () => placed,
    app: frames.send,
    destroy() {
      destroyed = true; pointer.destroy(); docking.destroy(); measurements.destroy(); reading.destroy();
      watch.disconnect(); clearTimeout(winTimer); clearTimeout(peekTimer); clearTimeout(unpeekTimer); (doc.defaultView ?? window).cancelAnimationFrame(laying); laying = 0;
      for (const p of panes.values()) { p.seen?.disconnect(); releaseSurface(p.body); p.host?.pane?.destroy?.(); }
      panes.clear(); surfaces.clear(); // what still waits on a pane (a read back, a tab) finds none
      frames.remove(root, () => { frames.destroy(); skin.remove(); }); // its MCP Apps hear the window go, and may answer
    },
  };
  layout();
  return handle;
}

/** A host action's button: its icon, drawn and nothing more (the title is then its tooltip and name), or its title as text. */
function actButton(doc: Document, a: ShellAction): HTMLButtonElement {
  const b = doc.createElement('button'); b.type = 'button'; b.dataset.action = a.id; b.title = a.title;
  const icon = a.icon ? iconOf(doc, a.icon) : null;
  if (icon) { icon.setAttribute('aria-hidden', 'true'); b.append(icon); b.setAttribute('aria-label', a.title); } else { b.textContent = a.title; b.className = 'vindu-act-text'; }
  return b;
}
