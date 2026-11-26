// The views as cards, drawn as shell-presentation.ts says (the same rule the UI server tells the model): a card for
// each view in a grid, a list when the window is narrow, with what it is, its title, a line of what each panel holds
// and a few pictures. A click on a card, or Enter, opens it alone, as tall as the window, with Back (or Esc) to the
// cards. What is drawn whole (what waits for the person, a notice, a pane of the host's or the system's) is in its pane
// above the cards. The panes are laid out as a phone-width window lays them out, one after another and full width,
// and each card's own pane is drawn too, out of sight, so what it shows is read back and ready to open. The switch
// between cards and content is in the shelf, where the window is not narrow.
import { panesOf, type Placement, type PlacedPane } from '../layout.js';
import { PRESENTATION, showsOf, type Shows } from '../shell-presentation.js';
import type { ShellState, ShownMeta } from '../shell.js';
import type { ElementMaker } from './dom.js';
import { pictureSchemes } from './picture-sources.js';
import { isLeaving } from './shell-frames.js';
import type { ShellLabels } from './shell-options.js';
import type { PaneEl } from './shell-pane.js';
import { imageSource } from './blocks/shared.js';

type CardsHost = {
  desk: HTMLElement;
  bar: HTMLElement;
  make: ElementMaker;
  labels: ShellLabels;
  meta: (view: string) => ShownMeta | undefined;
  pane: (view: string) => PaneEl | undefined;
  /** A card opened alone, or null: back to the cards. */
  open: (view: string | null) => void;
  /** The person's switch: the views as cards, or as their content. */
  presentAs: (as: 'cards' | 'content') => void;
};
/** At most this many lines and pictures on a card. */
const LINES = 3,
  PICTURES = 3;

export function mountCards(h: CardsHost) {
  const { make, labels: L } = h;
  const deck = make('div', 'vindu-cards');
  deck.setAttribute('role', 'list');
  deck.hidden = true;
  h.desk.append(deck);
  const toggle = make('div', 'vindu-bar-present');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', L.showAs);
  toggle.hidden = true;
  const switchTo = (as: 'cards' | 'content', text: string) => {
    const b = make('button', 'vindu-act-text', text);
    b.type = 'button';
    b.dataset.as = as;
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-pressed') !== 'true') h.presentAs(as);
    });
    toggle.append(b);
    return b;
  };
  const asCards = switchTo('cards', L.cards),
    asContent = switchTo('content', L.content);
  h.bar.append(toggle);
  let shows: Shows = showsOf([], []),
    drawnKey = '',
    alone: PaneEl | undefined;
  const backs = new Map<string, HTMLButtonElement>();

  /** What is drawn, from the state and the desk's width. */
  const showsIn = (st: ShellState, deskWidth: number): Shows =>
    showsOf(
      st.views,
      panesOf(st.tree).map((p) => p.view),
      st.presentation ?? PRESENTATION,
      deskWidth > 0 && deskWidth < st.options.phone,
    );
  /** The panes as cards lay them out: what is drawn whole, then the card opened alone, one after another and full
   *  width; every other card's pane behind, drawn and out of sight. */
  const placement = (st: ShellState, real: Placement): Placement => {
    const paths = new Map(panesOf(st.tree).map((p) => [p.view, p.path]));
    const compact = real.window.w < st.options.compact;
    const pane = (view: string, behind: boolean): PlacedPane => ({
      view,
      path: paths.get(view) ?? [],
      box: null,
      compact,
      ...(behind ? { behind: true as const } : {}),
    });
    const inSight = [...shows.whole, ...(shows.alone ? [shows.alone] : [])];
    return {
      mode: 'stacked',
      window: real.window,
      lines: [],
      splits: [],
      stacks: [],
      notes: [],
      panes: [
        ...inSight.map((v) => pane(v, false)),
        ...shows.cards.filter((v) => v !== shows.alone).map((v) => pane(v, true)),
      ],
    };
  };

  /** One card: what it is, its title, a line of what each panel holds, a few pictures; a click opens it alone. */
  const cardOf = (view: string): HTMLElement => {
    const m = h.meta(view),
      panels = m?.summary?.panels ?? [];
    const item = make('div', 'vindu-card-item');
    item.setAttribute('role', 'listitem');
    const card = make('button', 'vindu-card');
    card.type = 'button';
    card.dataset.view = view;
    if (m?.summary?.changed) card.dataset.by = m.summary.changed.by;
    const kinds = [...new Set(panels.map((p) => p.kind))];
    card.append(make('span', 'vindu-card-kind', L.cardKind(kinds)), make('span', 'vindu-card-title', m?.title ?? view));
    const lines = make('span', 'vindu-card-lines');
    for (const p of panels.slice(0, LINES)) {
      const line = make('span', 'vindu-card-line');
      if (panels.length > 1 && p.title !== m?.title) line.append(make('b', '', p.title), ' ');
      line.append(p.line);
      lines.append(line);
    }
    card.append(lines);
    const schemes = pictureSchemes(h.desk);
    const pictures = panels
      .map((p) => imageSource(p.thumbnail, undefined, schemes))
      .filter(Boolean)
      .slice(0, PICTURES);
    if (pictures.length) {
      const strip = make('span', 'vindu-card-pictures');
      for (const src of pictures) {
        const img = make('img');
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        strip.append(img);
      }
      card.append(strip);
    }
    card.setAttribute(
      'aria-label',
      L.openCard(
        m?.title ?? view,
        panels
          .map((p) => p.line)
          .filter(Boolean)
          .join('; '),
      ),
    );
    card.addEventListener('click', () => {
      h.open(view);
      h.pane(view)?.body.focus({ preventScroll: true });
    }); // the keyboard goes with it
    item.append(card);
    return item;
  };
  const drawDeck = () => {
    const key = JSON.stringify([
      shows.cards,
      shows.list,
      shows.cards.map((v) => [h.meta(v)?.title, h.meta(v)?.summary]),
    ]);
    if (key === drawnKey) return;
    drawnKey = key;
    const focused = (deck.ownerDocument.activeElement as HTMLElement | null)?.closest?.(
      '.vindu-card',
    ) as HTMLElement | null;
    const had = focused && deck.contains(focused) ? focused.dataset.view : undefined;
    deck.replaceChildren(...shows.cards.map(cardOf));
    if (had)
      deck.querySelector<HTMLElement>(`.vindu-card[data-view="${CSS.escape(had)}"]`)?.focus({ preventScroll: true }); // drawn again, it keeps the keyboard
  };
  /** Back to the cards, the keyboard on the card of the view that was open. */
  const goBack = () => {
    const was = shows.alone;
    h.open(null);
    if (was)
      deck.querySelector<HTMLElement>(`.vindu-card[data-view="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
  };
  /** Back, in the title bar of the card opened alone, and in no other. */
  const drawBacks = () => {
    for (const [view, b] of backs)
      if (view !== shows.alone) {
        b.remove();
        backs.delete(view);
      }
    const p = shows.alone ? h.pane(shows.alone) : undefined;
    if (!shows.alone || !p || backs.has(shows.alone)) return;
    const b = make('button', 'vindu-act-text vindu-card-back', L.backToCards);
    b.type = 'button';
    b.addEventListener('click', () => goBack());
    p.head.insertBefore(b, p.head.firstChild);
    backs.set(shows.alone, b);
  };

  return {
    /** What is drawn now, worked out again from the state and the desk's width; and the panes' placement for it: the
     *  layout's own as content, or the cards' as cards. */
    arrange(st: ShellState, real: Placement, deskWidth: number): Placement {
      shows = showsIn(st, deskWidth);
      return shows.as === 'cards' ? placement(st, real) : real;
    },
    get shows() {
      return shows;
    },
    /** The cards, the way back and the switch, once the panes are where they go: the deck after the panes in sight. */
    render() {
      const cards = shows.as === 'cards';
      deck.hidden = !cards || !!shows.alone;
      deck.classList.toggle('is-list', shows.list);
      if (cards) {
        const inSight = shows.whole.length + (shows.alone ? 1 : 0);
        const at = [...h.desk.children].filter((child) => !isLeaving(child) && child !== deck)[inSight] ?? null;
        if (deck.nextElementSibling !== at || deck.parentElement !== h.desk) h.desk.insertBefore(deck, at);
        drawDeck();
      }
      alone?.el.classList.remove('is-alone');
      alone = shows.alone ? h.pane(shows.alone) : undefined;
      alone?.el.classList.add('is-alone'); // as tall as the window
      drawBacks();
      toggle.hidden = !shows.toggle;
      asCards.setAttribute('aria-pressed', String(cards));
      asContent.setAttribute('aria-pressed', String(!cards));
    },
    /** Esc in the card opened alone: back to the cards. False when none is open alone. */
    back(): boolean {
      if (!shows.alone) return false;
      goBack();
      return true;
    },
  };
}
