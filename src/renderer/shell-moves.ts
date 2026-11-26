// The person's moves in the shell (shell.ts): a pane focused, maximized and restored, collapsed into the shelf, opened
// from it where it was (or where it is dropped), and moved beside another. Each is made here first, with the same
// layout code the UI server runs, so it is drawn at once, and then told to the window's onEvent.
import type { Place, Size } from '../layout.js';
import { insert, openView, remove, slotOf } from '../layout-edit.js';
import type { ShellEvent, ShellState, ShownMeta } from '../shell.js';
import { refusesFullscreen } from '../shell-presentation.js';
import type { PaneEl } from './shell-pane.js';

/** What the moves need of the shell: its panes and views, its window, its state to read and set, and what follows a move. */
type MoveParts = {
  panes: Map<string, PaneEl>;
  meta: (name: string) => ShownMeta | undefined;
  isOpen: (name: string | null | undefined) => name is string;
  isStacked: () => boolean;
  deskSize: () => Size;
  emit: (e: ShellEvent) => void;
  layout: () => void;
  renderBar: () => void;
  unpeek: (now?: boolean) => void;
  state: () => ShellState;
  set: (next: ShellState) => void;
};

/** The moves, by name. */
export function paneMoves(d: MoveParts) {
  const { panes, meta, isOpen, isStacked, deskSize, emit, layout, renderBar, unpeek } = d;
  const focusPane = (name: string, reveal = false) => {
    if (!isOpen(name)) return;
    if (reveal) panes.get(name)?.el.scrollIntoView({ block: 'nearest' });
    const st = d.state();
    if (st.focus === name) return;
    d.set({ ...st, focus: name });
    for (const [n, p] of panes) p.el.toggleAttribute('data-focus', n === name);
    renderBar();
    emit({ type: 'focus', view: name });
  };
  // a pane maximized has the focus; a phone-width window stacks its panes, every one in sight, and maximizes none
  const toggleMax = (name: string): boolean => {
    const st = d.state();
    const next = st.maximized === name ? null : name;
    if (next && (isStacked() || refusesFullscreen(meta(next)))) return false;
    d.set({ ...st, maximized: next, focus: next ?? st.focus });
    layout();
    emit({ type: 'maximize', view: next });
    return true;
  };
  // each move is made here first, with the same layout code the UI server runs, so it is drawn at once
  const collapsePane = (name: string) => {
    const st = d.state();
    d.set({
      ...st,
      tree: remove(st.tree, name),
      shelf: { ...st.shelf, [name]: { by: 'person', at: st.rev, slot: slotOf(st.tree, name) } },
      maximized: st.maximized === name ? null : st.maximized,
      focus: st.focus === name ? null : st.focus,
    });
    layout();
    emit({ type: 'collapse', view: name });
  };
  const openPane = (name: string, at?: Place) => {
    unpeek(true);
    const st = d.state();
    const r = openView(st.tree, name, deskSize(), {
      place: at,
      slot: st.shelf[name]?.slot,
      recent: st.recent.filter((v) => v !== name),
      options: st.options,
    });
    const shelf = { ...st.shelf };
    delete shelf[name];
    d.set({ ...st, tree: r.tree, shelf, focus: name, maximized: at ? null : st.maximized });
    layout();
    emit({ type: 'open', view: name, ...(at ? { place: at } : {}) });
  };
  const movePane = (name: string, at: Place) => {
    const st = d.state();
    d.set({
      ...st,
      tree: insert(st.tree, name, deskSize(), { place: at, options: st.options }).tree,
      focus: name,
      maximized: null,
    });
    layout();
    emit({ type: 'move', view: name, place: at });
  };
  return { focusPane, toggleMax, collapsePane, openPane, movePane };
}
