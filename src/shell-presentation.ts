// How a window shows the views open in it: each in its pane, as laid out (content), or each as a card in a grid, a
// list when the window is narrow (cards), which the person opens alone with a click or Enter, and goes back from. auto:
// one view whole, several as cards. What waits for the person (an ask, a call that failed, a mail to send), a notice,
// and a pane of the host's or the system's are always drawn whole, above the cards. The host says which way at open
// and while the window runs, and the person switches between cards and content where the window is not narrow. The UI
// server and the renderer work it out the same way, so what the model reads is what is drawn. Pure: no I/O.
import type { ShownMeta } from './shell-types.js';

/** Which way the views are shown: as cards, as their content, or as cards once there are several. */
export type Presentation = 'auto' | 'cards' | 'content';
/** How the views are shown, as the state gives it: the way chosen (by the host, or by the person's switch), whether the
 *  window is narrow (as the host says), and the view opened alone from its card. */
export type ShellPresentation = { as: Presentation; narrow: boolean; alone: string | null };
export const PRESENTATION: ShellPresentation = { as: 'content', narrow: false, alone: null };
/** What is drawn: cards or content; the views drawn as cards and those drawn whole, in reading order; the view opened
 *  alone; whether the cards are a list (a narrow window) or a grid; and whether the switch is offered. */
export type Shows = { as: 'cards' | 'content'; cards: string[]; whole: string[]; alone: string | null; list: boolean; toggle: boolean };

/** Whether a view may be drawn as a card: a model's view of cards that neither waits for the person nor is a notice. */
const cardable = (v: ShownMeta | undefined): boolean =>
  !!v?.summary && !v.summary.waits && v.summary.size !== 'notice' && !v.ask && !v.kind && !v.loading;

/** What is drawn, from the views shown, those open in the layout (in reading order), the way chosen, and whether the
 *  window is phone-width (a narrow window too, whatever the host says). */
export function showsOf(views: readonly ShownMeta[], open: readonly string[], p: ShellPresentation = PRESENTATION, phoneWidth = false): Shows {
  const byName = new Map(views.map(v => [v.name, v]));
  const cards = open.filter(name => cardable(byName.get(name)));
  const whole = open.filter(name => !cardable(byName.get(name)));
  const narrow = p.narrow || phoneWidth;
  const asCards = cards.length > 0 && (p.as === 'cards' || (p.as === 'auto' && cards.length > 1));
  const alone = asCards && p.alone && cards.includes(p.alone) ? p.alone : null;
  return { as: asCards ? 'cards' : 'content', cards, whole, alone, list: narrow, toggle: !narrow && (asCards || cards.length > 1) };
}

/** The person's switch (cards or content) or their opening a card alone and going back, as the window reports it: the
 *  way it now is, and what the model is told; null for anything that does not fit what is drawn. */
export function presentationEvent(p: ShellPresentation, x: Record<string, unknown>, shows: Shows): { next: ShellPresentation; said: string } | null {
  if (x.type === 'presentation') {
    if ((x.as !== 'cards' && x.as !== 'content') || x.as === shows.as) return null;
    return { next: { ...p, as: x.as, alone: null }, said: x.as === 'cards' ? 'showed the views as cards' : 'showed the views as their content, each in its pane' };
  }
  if (x.type !== 'card' || shows.as !== 'cards') return null;
  if (x.view === null) return shows.alone ? { next: { ...p, alone: null }, said: `went back from "${shows.alone}" to the cards` } : null;
  if (typeof x.view !== 'string' || !shows.cards.includes(x.view) || x.view === shows.alone) return null;
  return { next: { ...p, alone: x.view }, said: `opened "${x.view}" from its card, alone in the window` };
}

/** Why a view is never shown fullscreen: it is small (a kpi, a short record, a line of text) or a notice. */
export const refusesFullscreen = (v: { summary?: ShownMeta['summary'] } | undefined): string | undefined =>
  v?.summary?.size ? `it is ${v.summary.size === 'notice' ? 'a notice, drawn as a strip' : 'small'}: never shown fullscreen` : undefined;

type Account = Record<string, unknown>;
/** The account the model reads, said as it is drawn: which way the views are shown, and, as cards, each pane as the card
 *  it is, or as drawn whole above the cards, or alone; with no box, as the layout's boxes are not what is drawn. */
export function presentationAccount(a: Account, shows: Shows, p: ShellPresentation, full = false): Account {
  const toggle = shows.toggle ? { toggle: 'the person switches between cards and content in the shelf' } : {};
  if (shows.as === 'content') return full || p.as !== 'content' ? { ...a, shows: { as: 'content', chosen: p.as, ...toggle } } : a;
  const grid = shows.list ? 'a list' : 'a grid';
  const at = (view: string) => {
    if (view === shows.alone) return 'opened alone from its card: full width, as tall as the window, below what is drawn whole';
    const i = shows.cards.indexOf(view);
    return i >= 0 ? `card ${i + 1} of ${shows.cards.length}, in ${grid}${shows.alone ? `, behind "${shows.alone}" opened alone` : ''}` : 'drawn whole, full width, above the cards';
  };
  const pane = (x: unknown) => {
    const { box: _box, room: _room, height: _height, content: _content, ...rest } = x as Account, view = String(rest.view);
    return shows.cards.includes(view) || shows.whole.includes(view) ? { ...rest, at: at(view) } : x; // one in the shelf as it is
  };
  const out: Account = { ...a, mode: `cards: ${shows.cards.length} views as cards in ${grid}${shows.whole.length ? `, ${shows.whole.length} drawn whole above them` : ''}${shows.alone ? `; "${shows.alone}" opened alone` : ''}` };
  if (Array.isArray(a.panes)) out.panes = a.panes.map(pane);
  if (a.this && typeof a.this === 'object') out.this = pane(a.this);
  return { ...out, shows: { as: 'cards', chosen: p.as, cards: shows.cards, ...(shows.whole.length ? { whole: shows.whole } : {}), ...(shows.alone ? { alone: shows.alone } : {}), ...(shows.list ? { list: 'the window is narrow: the cards are a list, and no switch is offered' } : {}), ...toggle,
    open: 'the person opens a card alone with a click or Enter, and goes back with Back or Esc' } };
}
