// A pane put where the layout places it (shell.ts): its box in the window (or in reading order, stacked), its title and
// mark, its buttons as its view and the window allow them, and its view drawn wide or compact; a tab behind another is
// drawn and kept out of sight.
import type { Placement, PlacedPane } from '../layout.js';
import type { ShellState, ShownMeta, ViewMeta } from '../shell.js';
import { refusesFullscreen } from '../shell-presentation.js';
import { isLeaving } from './shell-frames.js';
import type { ShellLabels } from './shell-options.js';
import { placeHost, type PaneEl } from './shell-pane.js';
import { ICON } from './shell-pane-element.js';

/** What placing a pane needs of the shell: its desk, words and views, its pane elements, and how it draws a view. */
type PlaceParts = {
  desk: HTMLElement; labels: ShellLabels; meta: (name: string) => ShownMeta | undefined; paneFor: (name: string) => PaneEl;
  syncActs: (p: PaneEl, name: string) => void; drawMark: (p: PaneEl, name: string, mk: ViewMeta['mark']) => void;
  draw: (name: string, which: 'wide' | 'compact') => void; changedBehind: Set<string>; state: () => ShellState;
};

/** How the shell places each pane of a placement: i is its place in reading order; a page that fills its pane is added
 *  to fills, to be fitted once every pane's box is written. */
export function panePlacer(d: PlaceParts): (pp: PlacedPane, i: number, pl: Placement, stackAt: Set<string>, fills: PaneEl[]) => void {
  const { desk, labels: L, meta, paneFor, syncActs, drawMark, draw, changedBehind } = d;
  return (pp, i, pl, stackAt, fills) => {
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
    const st = d.state();
    p.el.toggleAttribute('data-focus', st.focus === pp.view);
    p.body.toggleAttribute('data-fill', !!m?.fill);
    const isMax = st.maximized === pp.view;
    p.max.hidden = pl.mode === 'stacked' || !!refusesFullscreen(m); // a phone-width window maximizes none, and a small view is never fullscreen
    p.el.classList.toggle('is-strip', m?.summary?.size === 'notice'); // a notice: a strip, without a title bar
    if (p.maxed !== isMax) { p.maxed = isMax; p.max.innerHTML = isMax ? ICON.restore : ICON.max; p.max.setAttribute('aria-label', isMax ? L.restore : L.maximize); p.max.title = isMax ? L.restoreHint : L.maximizeHint; }
    syncActs(p, pp.view);
    draw(pp.view, pp.compact ? 'compact' : 'wide');
    if (m?.kind) return;
    if (m?.fill) fills.push(p); else p.body.style.removeProperty('--vindu-page-h');
  
  };
}
