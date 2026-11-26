// A peek in the shell (shell.ts): a collapsed view shown above the shelf while the pointer (or the keyboard) is on its
// button, the layout left as it is; it goes a moment after the pointer leaves, unless the pointer is on the peek.
import type { Placement } from '../layout.js';
import type { ShownMeta } from '../shell.js';
import type { ShellLabels } from './shell-options.js';
import { fitPage, type PaneEl } from './shell-pane.js';
import type { View } from './surface.js';

/** What a peek needs of the shell: its panes and views, how it draws one, and whether a drag or a stacked window rules it out. */
type PeekParts = {
  desk: HTMLElement; labels: ShellLabels; panes: Map<string, PaneEl>; surfaces: Map<string, View>; meta: (name: string) => ShownMeta | undefined;
  isOpen: (name: string | null | undefined) => boolean; isStacked: () => boolean; paneFor: (name: string) => PaneEl;
  draw: (name: string, which: 'wide' | 'compact') => void; placeHosts: () => void; docking: () => boolean; placed: () => Placement | null; compact: () => number;
};

/** The shell's peek: the view in it now, if any (current); one soon (soon); gone, at once or in a moment (hide); kept
 *  while the pointer is on it (keep); ended by the layout, which draws it in a pane (end); and its timers cleared (clear). */
export function mountPeek(parts: PeekParts) {
  const { desk, labels: L, panes, surfaces, meta, isOpen, isStacked, paneFor, draw, placeHosts } = parts;
  // a peek: a collapsed view shown above the shelf while the pointer is on its button, the layout left as it is
  let peeking: string | null = null, peekTimer: ReturnType<typeof setTimeout> | undefined, unpeekTimer: ReturnType<typeof setTimeout> | undefined;
  const peekSoon = (name: string, at: HTMLElement) => { clearTimeout(unpeekTimer); clearTimeout(peekTimer); if (peeking !== name) peekTimer = setTimeout(() => peek(name, at), peeking ? 0 : 450); };
  const peek = (name: string, at: HTMLElement) => {
    if (parts.docking() || isOpen(name) || (!surfaces.has(name) && !meta(name)?.kind) || parts.placed()?.mode === 'stacked') return;
    unpeek(true); peeking = name;
    const p = paneFor(name), d = desk.getBoundingClientRect(), c = at.getBoundingClientRect(), m = meta(name);
    const w = Math.round(Math.min(720, Math.max(300, d.width * 0.55))), h = Math.round(Math.min(480, Math.max(200, d.height * 0.6)));
    Object.assign(p.el.style, { left: `${Math.round(Math.max(8, Math.min(d.width - w - 8, c.left - d.left + c.width / 2 - w / 2)))}px`, top: `${Math.max(8, Math.round(d.height - h - 8))}px`, width: `${w}px`, height: `${h}px`, marginLeft: '', maxHeight: '' });
    p.el.classList.add('is-peek'); p.el.hidden = false; p.el.toggleAttribute('data-focus', false); p.head.insertBefore(p.open, p.tools);
    p.title.textContent = m?.title ?? name; p.sub.textContent = m?.subtitle ?? ''; p.head.title = L.peek;
    draw(name, w < parts.compact() ? 'compact' : 'wide');
    if (m?.fill && !m.kind) fitPage(p, isStacked);
    placeHosts(); // a host's pane in the peek shows there; the others' native views would cover it
  };
  const unpeek = (now = false) => {
    clearTimeout(peekTimer);
    const go = () => { const name = peeking; if (!name) return; peeking = null; const p = panes.get(name); if (p) { p.el.classList.remove('is-peek'); p.open.remove(); if (!isOpen(name)) p.el.hidden = true; } placeHosts(); };
    if (now) go(); else { clearTimeout(unpeekTimer); unpeekTimer = setTimeout(go, 220); }
  };
  return {
    current: () => peeking, soon: peekSoon, hide: unpeek,
    keep: () => clearTimeout(unpeekTimer), end: () => { peeking = null; }, clear: () => { clearTimeout(peekTimer); clearTimeout(unpeekTimer); },
  };
}
