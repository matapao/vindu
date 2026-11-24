// Pointing in the window: the person marks anything the window drew, and the UI server gets what it is, by the marks
// the window drew itself, never by looking at the screen:
//   - Alt (Option) + click: a row, a bar, a node, a field, a value; again to take it back. Alt + drag: everything in the
//     rectangle, across panes. Alt + selecting text: that span. Esc: nothing marked. (A click per item is the keyboard-
//     and mouse-only way: no dragging is needed.) On a touch screen, a long press marks one, or takes it back;
//   - a plain click on a bar of a grouped chart, or a double-click on a grouped row: open what it stands for, in place;
//   - "In the chat" on a pane: each message carries that pane;
//   - what a block asks to do (a device's switch, a draft's Send) goes to the server too (what a page asks: shell-frames.ts).
// Blocks mark rows with data-panel and data-row; A2UI's own components carry their data path (/panels/<pid>/rows/<i>).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BLOCK_ACTION, paneOf, viewOf } from './dom.js';

import type { PointItem } from '../window-reports.js'; // one shape, the server's and the window's
export type { PointItem };

type Opts = { root: HTMLElement; emit: (e: any) => void; picked: () => PointItem[]; masters?: (view: string) => string[] };
const ROW = /^\/panels\/(p_[^/]+)\/rows\/(\d+)/;

/** What the element at hand stands for, as the window drew it. */
export function itemOf(el: Element | null): PointItem | null {
  const pane = paneOf(el); if (!el || !pane?.dataset.view) return null;
  const view = pane.dataset.view;
  const mark = el.closest<HTMLElement>('[data-row],[data-node]');
  if (mark?.dataset.panel !== undefined && pane.contains(mark)) return mark.dataset.node !== undefined ? { view, panel: mark.dataset.panel, node: mark.dataset.node } : { view, panel: mark.dataset.panel, row: Number(mark.dataset.row) };
  for (let e: any = el; e && e !== pane; e = e.parentElement) { // A2UI's own components: their data path and component id
    const path: string | undefined = e.context?.dataContext?.path; const id: string | undefined = e.context?.componentModel?.id;
    const m = path ? ROW.exec(path) : null; if (m) return { view, pid: m[1], row: Number(m[2]) };
    const v = id ? /^(p_.+)__value$/.exec(id) : null; if (v) return { view, pid: v[1], value: true };
    const f = id ? /^(p_.+)__v(\d+)$/.exec(id) : null; if (f) return { view, pid: f[1], field: Number(f[2]) };
  }
  return null;
}
/** What can be marked, each once: the marks blocks draw, and each row of an A2UI list by its item, a box of its own (the
 *  component in it may lay out as its contents). Never every element in a list, which in a long one is thousands. */
export const MARKS = ['[data-row]', '[data-node]', 'a2ui-list .a2ui-list > .a2ui-list-item-none', 'a2ui-list .a2ui-list > li'];
/** The element that says what a mark stands for: a block's mark itself, or the component in a list's item. */
export const markedBy = (mark: Element) => (mark.matches('[data-row], [data-node]') ? mark : mark.firstElementChild ?? mark);
const key = (it: PointItem) => [it.view, it.panel ?? it.pid, it.row ?? '', it.node ?? '', it.field ?? '', it.value ? 'v' : '', it.text ?? ''].join('|');
const sameAs = (a: PointItem, b: PointItem) => key(a) === key(b);

/** Match both the frame window and its configured page origin, including after a navigation. A frame whose address
 *  is not one matches nothing. */
export function pageFrameFor(root: ParentNode, event: MessageEvent) {
  return [...root.querySelectorAll<HTMLIFrameElement>('iframe[data-page-panel]')].find(frame =>
    frame.contentWindow === event.source && originOf(frame.src, frame.ownerDocument.baseURI) === event.origin);
}
const originOf = (address: string, base: string) => { try { return new URL(address, base).origin; } catch { return undefined; } };

export function mountPointing(o: Opts): { mark: (picked: PointItem[], attached: string[]) => void; destroy: () => void } {
  const { root } = o, doc = root.ownerDocument, win = doc.defaultView ?? window;
  let band: HTMLElement | null = null; let start: { x: number; y: number } | null = null;
  let press: { t: ReturnType<typeof setTimeout>; x: number; y: number } | null = null; let pressed = false; // a long press, on a touch screen
  const send = (items: PointItem[], by: string) => o.emit({ type: 'select', by, items });
  const toggle = (it: PointItem, by: string) => { const now = o.picked(); send(now.some(x => sameAs(x, it)) ? now.filter(x => !sameAs(x, it)) : [...now, it], by); };
  const inPanes = MARKS.map(mark => `.vindu-pane ${mark}`).join(', ');
  const candidates = () => [...root.querySelectorAll<HTMLElement>(inPanes)];
  const unpress = () => { if (press) { clearTimeout(press.t); press = null; } };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.isPrimary && (e.target as Element).closest('.vindu-pane-body') && !(e.target as Element).closest('.vindu-pane-body[data-host]')) {
      const el = e.target as Element; unpress(); pressed = false;
      press = { x: e.clientX, y: e.clientY, t: setTimeout(() => { press = null; const it = itemOf(el); if (it) { pressed = true; toggle(it, 'press'); win.navigator.vibrate?.(10); } }, 550) };
      return;
    }
    if (!e.altKey || e.button !== 0) return;
    if (!(e.target as Element).closest('.vindu-pane-body')) return;
    start = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: PointerEvent) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) unpress(); // a scroll, not a press
    if (!start) return;
    if (!band && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!band) { band = doc.createElement('div'); band.className = 'vindu-band'; root.append(band); }
    const r = rect(start, e); Object.assign(band.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    e.preventDefault();
  };
  const onUp = (e: PointerEvent) => {
    unpress();
    if (!start) return;
    const s = start; start = null;
    if (band) { // a drag: everything in the rectangle, across panes
      band.remove(); band = null;
      const r = rect(s, e); const got: PointItem[] = [];
      for (const el of candidates()) { const b = el.getBoundingClientRect(); if (b.width && b.height && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) { const it = itemOf(markedBy(el)); if (it && !got.some(x => sameAs(x, it))) got.push(it); } }
      if (got.length) send([...o.picked().filter(x => !got.some(y => sameAs(x, y))), ...got], 'drag');
      e.preventDefault(); return;
    }
    const sel = doc.getSelection(); const text = sel && !sel.isCollapsed ? sel.toString() : '';
    if (text.trim()) { const it = itemOf(sel!.anchorNode?.parentElement ?? null); if (it) { send([...o.picked(), { view: it.view, ...(it.panel ? { panel: it.panel } : { pid: it.pid }), text }], 'text'); sel!.removeAllRanges(); return; } }
    const it = itemOf(e.target as Element); if (it) { toggle(it, 'click'); e.preventDefault(); }
  };
  /** Open what a bar of a grouped chart stands for, in place: on a click, or Enter or Space on the bar. */
  const openBar = (e: Event) => {
    const strip = (e.target as Element).closest?.<HTMLElement>('.vb-strip[data-opens]'); if (!strip) return false;
    const view = viewOf(strip); if (view) o.emit({ type: 'drill', view, panel: strip.dataset.panel, row: Number(strip.dataset.row) });
    return true;
  };
  const onClick = (e: MouseEvent) => {
    if (pressed) { pressed = false; e.preventDefault(); e.stopPropagation(); return; } // the press marked it: not a tap too
    if (e.altKey) { e.preventDefault(); return; }
    if (openBar(e)) return;
    // a row of a panel others follow (linked panels): a plain click picks it, and they show what was picked
    const t = e.target as Element; if (t.closest('button, a, input, select, textarea, label, [contenteditable], .vindu-pane-head')) return;
    const it = itemOf(t); const k = it?.panel ?? it?.pid;
    if (it && k && it.row !== undefined && o.masters?.(it.view).includes(k)) o.emit({ type: 'view', view: it.view, action: 'select', panel: k, from: it.row });
  };
  const onDbl = (e: MouseEvent) => { const it = itemOf(e.target as Element); if (it && it.row !== undefined) o.emit({ type: 'drill', view: it.view, ...(it.panel ? { panel: it.panel } : { pid: it.pid }), row: it.row }); };
  const onKey = (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && openBar(e)) { e.preventDefault(); return; }
    if (e.key === 'Escape' && o.picked().length && !(e.target as Element).closest?.('.vindu-pane-body[data-host]')) send([], 'keys');
  };
  const onAction = (e: Event) => {
    const d = (e as CustomEvent).detail; if (!d || typeof d !== 'object') return;
    if (d.type === 'operation' && typeof d.name === 'string' && d.name) o.emit(d);
    else if ((d.type === 'view' || d.type === 'message') && typeof d.action === 'string') { // an action inside a view (a process moved, a slide changed), or the person's edit or Send in a mail drafted for them: for the pane it is in
      const target = e.target as Element | null, view = target?.closest ? viewOf(target) : undefined;
      if (view) o.emit({ ...d, view });
    }
  };
  root.addEventListener('pointerdown', onDown, true); win.addEventListener('pointermove', onMove, true); win.addEventListener('pointerup', onUp, true);
  root.addEventListener('click', onClick, true); root.addEventListener('dblclick', onDbl); root.addEventListener('keydown', onKey);
  root.addEventListener(BLOCK_ACTION, onAction);
  const onMenu = (e: Event) => { if (pressed || press) e.preventDefault(); }; // a long press marks; it opens no menu
  root.addEventListener('contextmenu', onMenu);
  /** Mark what is picked (from the server's state, so every window marks the same) and the panes in the chat. Each
   *  marked element of a view with something picked is read once, and its key looked up among the picked ones. */
  const mark = (picked: PointItem[], attached: string[]) => {
    for (const el of root.querySelectorAll('.vb-picked')) el.classList.remove('vb-picked');
    const wanted = new Set(picked.map(it => key({ ...it, text: undefined })));
    for (const view of new Set(picked.map(it => it.view))) {
      const pane = `.vindu-pane[data-view="${CSS.escape(view)}"]`;
      for (const el of root.querySelectorAll<HTMLElement>(`${pane} [data-row], ${pane} [data-node]`)) {
        const at = itemOf(el); if (at && wanted.has(key({ ...at, text: undefined }))) el.classList.add('vb-picked');
      }
    }
    for (const p of root.querySelectorAll<HTMLElement>('.vindu-pane')) { const b = p.querySelector<HTMLButtonElement>('.vindu-chat'); if (b) b.setAttribute('aria-pressed', String(attached.includes(p.dataset.view ?? ''))); }
  };
  const destroy = () => {
    root.removeEventListener('pointerdown', onDown, true); win.removeEventListener('pointermove', onMove, true); win.removeEventListener('pointerup', onUp, true);
    root.removeEventListener('click', onClick, true); root.removeEventListener('dblclick', onDbl); root.removeEventListener('keydown', onKey);
    root.removeEventListener(BLOCK_ACTION, onAction); root.removeEventListener('contextmenu', onMenu);
    unpress(); band?.remove(); band = null; start = null; // a drag under way when the shell goes leaves nothing behind
  };
  return { mark, destroy };
}
const rect = (a: { x: number; y: number }, b: { clientX: number; clientY: number }) => ({ left: Math.min(a.x, b.clientX), top: Math.min(a.y, b.clientY), right: Math.max(a.x, b.clientX), bottom: Math.max(a.y, b.clientY), width: Math.abs(b.clientX - a.x), height: Math.abs(b.clientY - a.y) });
