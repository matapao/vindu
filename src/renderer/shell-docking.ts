import type { Placement, Place, Side } from '../layout.js';

/** Where a drag would drop: beside a pane, on one side; or on the shelf (a pane, to collapse it). */
type Drop = { beside: string; side: Side } | { shelf: true };
/** The side of a box a point is nearest to: where a pane dropped there goes. */
export function sideAt(b: { x: number; y: number; w: number; h: number }, x: number, y: number): Side {
  const u = (x - b.x) / b.w, v = (y - b.y) / b.h;
  if (Math.min(u, 1 - u) < Math.min(v, 1 - v)) return u < 0.5 ? 'left' : 'right';
  return v < 0.5 ? 'above' : 'below';
}

type DockingOptions = {
  root: HTMLElement;
  desk: HTMLElement;
  bar: HTMLElement;
  dropBox: HTMLElement;
  placement: () => Placement | null;
  isOpen: (view: string) => boolean;
  title: (view: string) => string;
  onStart: () => void;
  onEnd: () => void;
  collapse: (view: string) => void;
  dockPane: (view: string, place: Place) => void;
};

export function mountDocking({
  root, desk, bar, dropBox, placement, isOpen, title, onStart, onEnd, collapse, dockPane,
}: DockingOptions) {
  // dragging a pane by its title, or a view from the shelf: beside another pane on the side nearest the pointer, or onto
  // the shelf to collapse it; a press that does not move is a click. Followed in the shell's own window.
  const win = root.ownerDocument.defaultView ?? window;
  type Drag = { view: string; id: number; x0: number; y0: number; on: boolean; out: boolean; ghost?: HTMLElement; drop: Drop | null }; // out: it has left the shelf
  let drag: Drag | null = null, droppedAt = 0;
  const justDragged = () => performance.now() - droppedAt < 120;
  const startDrag = (view: string, e: PointerEvent) => {
    if (e.button !== 0 || drag || placement()?.mode === 'stacked') return;
    const b = bar.getBoundingClientRect(); // a drag from the shelf counts the shelf as a place to drop only once it has left it
    drag = { view, id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, out: e.clientY < b.top || e.clientY > b.bottom, drop: null };
    win.addEventListener('pointermove', dragMove, true); win.addEventListener('pointerup', dragEnd, true); win.addEventListener('pointercancel', dragStop, true); win.addEventListener('keydown', dragKey, true);
  };
  const dropAt = (cx: number, cy: number): Drop | null => {
    const d = desk.getBoundingClientRect(), b = bar.getBoundingClientRect(), view = drag!.view;
    if (cy >= b.top && cy <= b.bottom) return isOpen(view) && drag!.out ? { shelf: true } : null;
    drag!.out = true;
    const x = cx - d.left, y = cy - d.top;
    const hit = placement()?.panes.find(p => p.box && x >= p.box.x && x < p.box.x + p.box.w && y >= p.box.y && y < p.box.y + p.box.h);
    return hit && hit.view !== view ? { beside: hit.view, side: sideAt(hit.box!, x, y) } : null;
  };
  const showDrop = (t: Drop | null) => {
    bar.classList.toggle('is-drop', !!t && 'shelf' in t);
    const hit = t && 'beside' in t ? placement()?.panes.find(p => p.view === t.beside) : undefined;
    if (!hit?.box || !t || !('beside' in t)) { dropBox.hidden = true; return; }
    const b = hit.box, half = { left: [b.x, b.y, b.w / 2, b.h], right: [b.x + b.w / 2, b.y, b.w / 2, b.h], above: [b.x, b.y, b.w, b.h / 2], below: [b.x, b.y + b.h / 2, b.w, b.h / 2] }[t.side];
    Object.assign(dropBox.style, { left: `${Math.round(half[0])}px`, top: `${Math.round(half[1])}px`, width: `${Math.round(half[2])}px`, height: `${Math.round(half[3])}px` });
    dropBox.hidden = false;
  };
  const dragMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.on = true; root.classList.add('is-docking'); onStart(); // the peek would hide where it goes, and native views would hide the drop box
      const g = drag.ghost = root.ownerDocument.createElement('div'); g.className = 'vindu-ghost'; g.textContent = title(drag.view); root.append(g);
    }
    e.preventDefault();
    const r = root.getBoundingClientRect();
    drag.ghost!.style.transform = `translate(${Math.round(e.clientX - r.left + 12)}px, ${Math.round(e.clientY - r.top - 30)}px)`; // above the pointer, in sight over the shelf
    drag.drop = dropAt(e.clientX, e.clientY); showDrop(drag.drop);
  };
  const dragStop = () => {
    win.removeEventListener('pointermove', dragMove, true); win.removeEventListener('pointerup', dragEnd, true); win.removeEventListener('pointercancel', dragStop, true); win.removeEventListener('keydown', dragKey, true);
    drag?.ghost?.remove(); root.classList.remove('is-docking'); showDrop(null); const d = drag; drag = null; onEnd(); return d;
  };
  const dragKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag?.on) { e.preventDefault(); e.stopPropagation(); dragStop(); droppedAt = performance.now(); } };
  const dragEnd = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = dragStop(); if (!d?.on) return; // a click
    droppedAt = performance.now();
    const t = d.drop; if (!t) return;
    if ('shelf' in t) { if (isOpen(d.view)) collapse(d.view); return; }
    const at: Place = { beside: t.beside, side: t.side };
    dockPane(d.view, at);
  };

  return {
    startDrag, justDragged,
    get active() { return !!drag?.on; },
    get pending() { return !!drag; },
    destroy() { dragStop(); },
  };
}
