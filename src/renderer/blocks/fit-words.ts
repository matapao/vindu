// Text cut at a word's end to fit a box of a set size (an event in a week), with an ellipsis where it is cut: never
// inside a word. The parts that are cut are spans marked data-full, which hold the whole text; the box keeps the whole
// text as its title and accessible name. Measured in the window on the frame after the box is drawn, and on the frame
// after its size changes: never inside the observer's own delivery, so that a box cut there resizes no other box in it.
import { ref } from 'lit/directives/ref.js';

const ELLIPSIS = '…';
/** The observer of every box fitted in a window, the boxes it watches, and each box's size when it was last fitted. */
const observers = new WeakMap<Window, ResizeObserver>();
const watched = new WeakSet<HTMLElement>();
const fittedAt = new WeakMap<HTMLElement, string>();
/** The boxes of a window to fit on its next frame. */
const waiting = new WeakMap<Window, Set<HTMLElement>>();

/** A box's size, as the observer and the fitting compare it. */
const sizeOf = (box: HTMLElement) => `${box.clientWidth}x${box.clientHeight}`;

/** A part of a box's text: its span, and its words with the spaces between them. */
type Part = { span: HTMLElement; full: string; tokens: string[]; words: number };
const partOf = (span: HTMLElement): Part => {
  const full = span.dataset.full ?? '',
    tokens = full.split(/(\s+)/).filter(Boolean);
  return { span, full, tokens, words: tokens.filter((t) => t.trim()).length };
};

/** Whether a box's content goes past its edges. */
const overflows = (box: HTMLElement) =>
  box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1;

/** A part's first n words, as written, without a separator left at their end (" ·"), and an ellipsis. */
function cut(part: Part, n: number): string {
  let out = '',
    words = 0;
  for (const token of part.tokens) {
    if (token.trim() && ++words > n) break;
    out += token;
  }
  return `${out.replace(/[\s·,;:–—-]+$/u, '')}${ELLIPSIS}`;
}

/** The first n words of the parts, of all: the parts before the cut whole, the part it is in cut, the rest left out. */
function show(parts: Part[], n: number, all: number) {
  let left = n,
    cutDone = false;
  for (const part of parts) {
    if (cutDone) part.span.textContent = '';
    else if (n === all || left >= part.words) part.span.textContent = part.full;
    else {
      part.span.textContent = cut(part, left);
      cutDone = true;
    }
    left -= part.words;
  }
}

/** Fit a box's parts to it: as many of their words as it holds, cut at a word's end. */
function fitWords(box: HTMLElement): void {
  const parts = [...box.querySelectorAll<HTMLElement>('[data-full]')].map(partOf);
  const all = parts.reduce((n, part) => n + part.words, 0);
  show(parts, all, all);
  if (!parts.length || !overflows(box)) return;
  let fits = 0,
    over = all; // the most words known to fit (none, at worst), and the fewest known not to
  while (over - fits > 1) {
    const n = Math.floor((fits + over) / 2);
    show(parts, n, all);
    if (overflows(box)) over = n;
    else fits = n;
  }
  show(parts, fits, all);
}

/** Fit the boxes on the window's next frame, each once however often it was asked, and keep the size each has then. */
function fitSoon(win: Window, box: HTMLElement): void {
  const boxes = waiting.get(win);
  if (boxes) {
    boxes.add(box);
    return;
  }
  const next = new Set([box]);
  waiting.set(win, next);
  win.requestAnimationFrame(() => {
    waiting.delete(win);
    for (const each of next) {
      if (!each.isConnected) continue;
      fitWords(each);
      fittedAt.set(each, sizeOf(each));
    }
  });
}

/** A directive for a box to fit: fitted once it is drawn, after each drawing, and whenever its size changes. */
export const fitted = () =>
  ref((drawn) => {
    const win = drawn?.ownerDocument.defaultView;
    if (!drawn || !win) return;
    const element = drawn as HTMLElement;
    let observer = observers.get(win);
    if (!observer) {
      observer = new win.ResizeObserver((entries) => {
        for (const entry of entries) {
          const box = entry.target as HTMLElement;
          if (fittedAt.get(box) !== sizeOf(box)) fitSoon(win, box);
        }
      });
      observers.set(win, observer);
    }
    if (!watched.has(element)) {
      watched.add(element);
      observer.observe(element);
    }
    fitSoon(win, element);
  });
