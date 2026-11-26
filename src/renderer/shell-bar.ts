// The shell's bar (shell.ts), along its bottom edge: a button for each open view, then each collapsed into the shelf
// (a click opens or focuses it, a drag docks it, hovering peeks at it), the host's own actions, the suggested layout to
// take, the reminders, and the window's mode.
import type { Placement } from '../layout.js';
import type { ShellEvent, ShellState, ShownMeta } from '../shell.js';
import type { elementsOf } from './dom.js';
import type { ShellAction, ShellHandle, ShellLabels } from './shell-options.js';
import { actButton } from './shell-pane-element.js';

/** The bar's elements, the host's actions in it, and the suggestion and reminder buttons, which tell the window. */
export function barElements(d: { doc: Document; make: ReturnType<typeof elementsOf>; labels: ShellLabels; barActs: ShellAction[]; emit: (e: ShellEvent) => void; handle: () => ShellHandle }) {
  const { doc, make, labels: L, barActs } = d;
  const bar = make('footer', 'vindu-bar'); const barViews = make('div', 'vindu-bar-views'), barShelf = make('div', 'vindu-bar-shelf'), barMode = make('span', 'vindu-bar-mode');
  barViews.setAttribute('role', 'toolbar'); barViews.setAttribute('aria-label', L.views);
  barShelf.setAttribute('role', 'toolbar'); barShelf.setAttribute('aria-label', L.shelf);
  bar.append(barViews, barShelf, make('span', 'vindu-bar-space')); // the open views, then those collapsed into the shelf
  if (barActs.length) {
    const box = make('div', 'vindu-bar-actions'); box.setAttribute('role', 'toolbar'); box.setAttribute('aria-label', L.actions);
    for (const a of barActs) { const b = actButton(doc, a); b.addEventListener('click', () => a.run({ view: null, body: null, shell: d.handle() })); box.append(b); }
    bar.append(box);
  }
  const suggest = make('button', 'vindu-act-text'); suggest.type = 'button'; suggest.textContent = L.suggestion; suggest.hidden = true;
  suggest.addEventListener('click', () => d.emit({ type: 'take-suggestion' }));
  const remChip = make('button', 'vindu-bar-rem'); remChip.type = 'button'; remChip.hidden = true; // only where the window keeps reminders
  remChip.addEventListener('click', () => d.emit({ type: 'reminders' }));
  bar.append(suggest, remChip, barMode);
  return { bar, barViews, barShelf, barMode, suggest, remChip };
}

/** What the bar's buttons need of the shell: its elements and words, its views, and what a button does. */
type BarParts = {
  doc: Document; make: ReturnType<typeof elementsOf>; labels: ShellLabels; barViews: HTMLElement; barShelf: HTMLElement; barMode: HTMLElement; suggest: HTMLElement; remChip: HTMLElement;
  meta: (name: string) => ShownMeta | undefined; isOpen: (name: string | null | undefined) => boolean; peekSoon: (name: string, at: HTMLElement) => void; unpeek: () => void;
  focusPane: (name: string, reveal?: boolean) => void; openPane: (name: string) => void; startDrag: (name: string, e: PointerEvent) => void; justDragged: () => boolean;
  dragPending: () => boolean; state: () => ShellState; placed: () => Placement | null; cardsShown: () => string;
};

/** The bar drawn again from the state: each view's button, kept (not remade, so it keeps the keyboard), in its place. */
export function barButtons(d: BarParts): () => void {
  const { doc, make, labels: L, barViews, barShelf, barMode, suggest, remChip, meta, isOpen, peekSoon, unpeek, focusPane, openPane, startDrag, justDragged } = d;
  const barButtons = new Map<string, HTMLButtonElement>(); // kept, not remade, so a button keeps the keyboard's focus
  const chip = (name: string): HTMLButtonElement => {
    let b = barButtons.get(name); if (b) return b;
    b = make('button', 'vindu-bar-view'); b.type = 'button'; b.append(make('span'));
    b.addEventListener('click', () => { if (justDragged()) return; if (isOpen(name)) focusPane(name, true); else openPane(name); }); // decided when clicked
    b.addEventListener('pointerdown', e => startDrag(name, e));
    b.addEventListener('pointerenter', () => { if (!isOpen(name) && !d.dragPending()) peekSoon(name, b); });
    b.addEventListener('pointerleave', () => unpeek());
    b.addEventListener('focus', () => { if (!isOpen(name) && b.matches(':focus-visible')) peekSoon(name, b); });
    b.addEventListener('blur', () => unpeek());
    barButtons.set(name, b); return b;
  };
  const renderBar = () => {
    const st = d.state();
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
    const pl = d.placed();
    barMode.textContent = pl && d.cardsShown() !== 'cards' ? L.mode(pl.mode, pl.panes.filter(x => !x.behind).length) : '';
    suggest.hidden = !st.suggestion;
    const rem = st.reminders; remChip.hidden = !rem;
    if (rem) { remChip.textContent = L.reminders(rem.set, rem.due); remChip.title = L.remindersHint; remChip.classList.toggle('is-due', rem.due > 0); remChip.setAttribute('aria-live', 'polite'); }
  };
  return renderBar;
}
