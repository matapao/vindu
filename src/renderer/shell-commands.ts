// The person's moves by name in the shell (shell.ts): a host's menu or keys (command), and the shell's own keys: Esc
// ends a peek, takes a card back to the cards or restores a maximized pane; F6 and Shift+F6 go from pane to pane.
import type { Place, Placement } from '../layout.js';
import type { ShellState, ShownMeta } from '../shell.js';
import type { ShellCommand } from './shell-options.js';
import type { PaneEl } from './shell-pane.js';

/** What the moves need of the shell: its panes, its state, and the moves themselves. */
type CommandParts = {
  root: HTMLElement;
  panes: Map<string, PaneEl>;
  meta: (name: string) => ShownMeta | undefined;
  isOpen: (name: string | null | undefined) => name is string;
  focusPane: (name: string, reveal?: boolean) => void;
  toggleMax: (name: string) => boolean;
  collapsePane: (name: string) => void;
  openPane: (name: string, at?: Place) => void;
  movePane: (name: string, at: Place) => void;
  unpeek: (now?: boolean) => void;
  state: () => ShellState;
  placed: () => Placement | null;
  peeking: () => string | null;
  cardsBack: () => boolean;
};

/** The shell's keys, listened to on its root; and the command a host gives by name, done if it can be (true). */
export function shellCommands(d: CommandParts): (c: ShellCommand) => boolean {
  const { root, panes, meta, isOpen, focusPane, toggleMax, collapsePane, openPane, movePane, unpeek } = d;
  const step = (back: boolean) => {
    // from pane to pane in reading order, as between a browser's regions: those in sight
    const st = d.state();
    const order = (d.placed()?.panes ?? []).filter((p) => !p.behind).map((p) => p.view);
    if (!order.length) return false;
    const at = st.focus ? order.indexOf(st.focus) : -1;
    const next = order[(at + (back ? -1 : 1) + order.length) % order.length];
    focusPane(next, true);
    panes.get(next)?.body.focus({ preventScroll: true });
    return true;
  };
  root.addEventListener('keydown', (e) => {
    const st = d.state();
    const own = (e.target as Element | null)?.closest?.('.vindu-pane-body[data-host]'); // a host's pane (a terminal) gets its own Esc
    if (e.key === 'Escape' && d.peeking() && !own) {
      e.preventDefault();
      unpeek(true);
      return;
    }
    if (e.key === 'Escape' && !own && d.cardsBack()) {
      e.preventDefault();
      return;
    } // a card opened alone: back to the cards
    if (e.key === 'Escape' && st.maximized && !own) {
      e.preventDefault();
      toggleMax(st.maximized);
    }
    if (e.key === 'F6' && step(e.shiftKey)) e.preventDefault();
  });
  const command = (c: ShellCommand): boolean => {
    const st = d.state();
    switch (c.type) {
      case 'maximize': {
        const name = c.view ?? st.focus;
        return isOpen(name) && toggleMax(name);
      }
      case 'restore':
        if (!st.maximized) return false;
        toggleMax(st.maximized);
        return true;
      case 'collapse':
      case 'close': {
        const name = c.view ?? st.focus;
        if (!isOpen(name)) return false;
        collapsePane(name);
        return true;
      }
      case 'open':
      case 'show': {
        if (!meta(c.view)) return false;
        const at = c.type === 'open' ? c.place : undefined;
        if (!isOpen(c.view)) {
          if (at && !isOpen(at.beside)) return false;
          openPane(c.view, at);
        } else if (at) {
          if (!isOpen(at.beside) || at.beside === c.view) return false;
          movePane(c.view, at);
        } else focusPane(c.view, true);
        return true;
      }
      case 'next':
        return step(false);
      case 'previous':
        return step(true);
      default:
        return false;
    }
  };
  return command;
}
