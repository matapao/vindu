// Each stack's strip of tabs: the titles, a mark for what changed behind or waits for the person, and Spread out beside
// them. A strip is made again only when what it says changes (its tabs, their titles and marks, the one in front); a
// layout that only moves it moves it, so a tab keeps the keyboard's focus, and a strip made again gives it to the same
// tab. The tabs are one stop for the keyboard: Tab reaches the one in front, the arrow keys (and Home, End) move between
// them, and Enter or Space brings one in front.
import type { Placement } from '../layout.js';
import type { ShellEvent } from '../shell.js';
import type { ElementMaker } from './dom.js';
import type { ShellLabels } from './shell-options.js';

type Stack = Placement['stacks'][number];
type Tab = { index: number; views: string[]; titles: string[]; changed: boolean; asks: boolean };
type StackHost = {
  desk: HTMLElement;
  make: ElementMaker;
  labels: ShellLabels;
  title: (view: string) => string;
  paneId: (view: string) => string | undefined; // the pane a tab shows, which it controls
  changed: (view: string) => boolean; // drawn again while behind
  asks: (view: string) => boolean; // waits for the person
  emit: (event: ShellEvent) => void;
};

const MOVES: Record<string, (at: number, last: number) => number> = {
  ArrowLeft: (at, last) => (at > 0 ? at - 1 : last),
  ArrowRight: (at, last) => (at < last ? at + 1 : 0),
  Home: () => 0,
  End: (_, last) => last,
};

export function mountStacks({ desk, make, labels: L, title, paneId, changed, asks, emit }: StackHost) {
  let strips = new Map<string, { key: string; el: HTMLElement }>(); // by the stack's path

  function drawStrip(sk: Stack, tabs: Tab[]) {
    const strip = make('div', 'vindu-stack');
    strip.dataset.path = sk.path.join('.');
    const list = make('div', 'vindu-stack-tabs');
    list.setAttribute('role', 'tablist');
    for (const t of tabs) {
      const front = t.index === sk.front,
        { titles } = t;
      const b = make('button', 'vindu-tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(front));
      b.dataset.index = String(t.index);
      b.tabIndex = front ? 0 : -1;
      const controls = t.views.map(paneId).filter(Boolean).join(' ');
      if (controls) b.setAttribute('aria-controls', controls);
      b.textContent = titles.length > 1 ? `${titles[0]} +${titles.length - 1}` : titles[0];
      b.title = L.tab(titles, { front, changed: t.changed, asks: t.asks });
      b.setAttribute('aria-label', b.title);
      if (t.changed) b.dataset.changed = '';
      if (t.asks) b.dataset.asks = '';
      b.addEventListener('click', () => {
        if (!front) emit({ type: 'front', path: sk.path, index: t.index });
      });
      list.append(b);
    }
    list.addEventListener('keydown', (e) => {
      const buttons = [...list.querySelectorAll<HTMLButtonElement>('.vindu-tab')],
        at = buttons.indexOf(e.target as HTMLButtonElement);
      const move = MOVES[e.key];
      if (!move || at < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const to = buttons[move(at, buttons.length - 1)];
      for (const b of buttons) b.tabIndex = b === to ? 0 : -1;
      to.focus();
    });
    const spread = make('button', 'vindu-spread');
    spread.type = 'button';
    spread.textContent = L.spread;
    spread.title = L.spreadHint;
    spread.addEventListener('click', () => emit({ type: 'spread', path: sk.path }));
    strip.append(list, spread);
    return strip;
  }

  function render(pl: Placement) {
    const next = new Map<string, { key: string; el: HTMLElement }>();
    const active = desk.ownerDocument.activeElement as HTMLElement | null;
    let refocus: HTMLElement | null = null; // a tab of a strip made again: the same tab in the new one
    for (const sk of pl.mode === 'tiled' ? pl.stacks : []) {
      const path = sk.path.join('.');
      const tabs = sk.tabs.map((t) => ({
        index: t.index,
        views: t.views,
        titles: t.views.map(title),
        changed: t.views.some(changed),
        asks: t.views.some(asks),
      }));
      const key = JSON.stringify([sk.front, tabs]);
      let strip = strips.get(path);
      if (strip?.key !== key) {
        const index = strip && active && strip.el.contains(active) ? active.dataset?.index : undefined;
        strip?.el.remove();
        strip = { key, el: drawStrip(sk, tabs) };
        if (index !== undefined) refocus = strip.el.querySelector<HTMLElement>(`.vindu-tab[data-index="${index}"]`);
      }
      Object.assign(strip.el.style, {
        left: `${sk.box.x}px`,
        top: `${sk.box.y}px`,
        width: `${sk.box.w}px`,
        height: `${sk.box.h}px`,
      });
      next.set(path, strip);
    }
    for (const [path, strip] of strips) if (!next.has(path)) strip.el.remove();
    strips = next;
    // the strips come last in the desk, after the panes and lines, in the stacks' order: moved there only when a strip
    // is new or something was added after them, and a tab moved keeps the keyboard
    const els = [...next.values()].map((strip) => strip.el),
      children = desk.children,
      from = children.length - els.length;
    if (!els.every((el, i) => children[from + i] === el)) desk.append(...els);
    const keep = refocus ?? (active && els.some((el) => el.contains(active)) ? active : null);
    if (keep && keep !== desk.ownerDocument.activeElement) keep.focus({ preventScroll: true });
  }

  return { render };
}
