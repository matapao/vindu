// What a panel or a view waits for, worked out by the system: a result this process does not have yet (awaits), or
// something the person does (after): an answer, a pick, a panel filled. Pure: the UI server keeps the state.
import type { Entry, ResultEntry } from './results.js';
import type { Await, Hook, PanelSpec } from './cards.js';
import { VIEW_WORDS, type HookWords } from './view-words.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** "accounts.list_invoices", or the tool alone. */
export const awaitName = (a: Await) => `${a.server ? `${a.server}.` : ''}${a.tool}`;
/** Whether a result is the call a panel waits for: its tool, and its server and the input fields given, exactly. */
function isAwaited(e: Entry, a: Await): e is ResultEntry {
  if (e.kind !== 'result' || e.tool !== a.tool || (a.server !== undefined && e.server !== a.server)) return false;
  if (!a.input) return true;
  const got = (e.input && typeof e.input === 'object' ? e.input : {}) as Record<string, unknown>;
  return Object.entries(a.input).every(([k, v]) => same(got[k], v));
}
/** The first result after since (an index into the process's entries) that is the call awaited: the first that came wins. */
export const firstAfter = (all: readonly Entry[], since: number, a: Await): ResultEntry | undefined =>
  all.slice(since).find((e): e is ResultEntry => isAwaited(e, a));
/** The field of its panel that the result a wait gets fills: from, or media (the one picture a media panel shows), or one
 *  item of a gallery's media (at, counted from 0). A wait that names none fills from. */
export type Fills = { field: 'from' } | { field: 'media'; at?: number };
/** A panel with the result its wait got in the field that wait fills. */
export function fillWith(p: PanelSpec, id: string, fills: Fills = { field: 'from' }): void {
  if (fills.field === 'from') p.from = id;
  else if (fills.at === undefined) p.media = id;
  else {
    const items = [p.media ?? []].flat();
    items.splice(Math.min(fills.at, items.length), 0, id);
    p.media = items;
  }
}
/** A view and a panel, from "view/panel", or the panel of this view. */
export const panelRef = (ref: string, view: string): [string, string] => {
  const i = ref.indexOf('/');
  return i > 0 ? [ref.slice(0, i), ref.slice(i + 1)] : [view, ref];
};

/** A hook in the person's words: "When Overdue is above 50000: tell you: …" (titleOf names a panel), in English unless
 *  other words are given (view-words.ts). What the model is told of a hook is always in English. */
export function hookWords(h: Hook, titleOf: (panel: string) => string, say: HookWords = VIEW_WORDS.hook): string {
  const d = h.do,
    when = whenWords(h.when, titleOf, say);
  const what = [
    d.cue ? say.cue(d.cue.label) : '',
    d.notify ? say.notify(d.notify) : '',
    d.read ? say.read(titleOf(d.read)) : '',
    d.job ? say.job(d.job.prompt) : '',
  ]
    .filter(Boolean)
    .join('; ');
  return `${h.label ? `${h.label}: ` : ''}${when}, ${what || say.nothing}`;
}
/** A hook's when in the person's words: a panel changed or crossed a line, a pick, an answer, or a time due. */
function whenWords(w: Hook['when'], titleOf: (panel: string) => string, say: HookWords): string {
  if (w.changed) return say.changed(titleOf(w.changed));
  if (w.crosses) return say.crosses(titleOf(w.crosses.panel), w.crosses);
  if (w.picked) return say.picked(titleOf(w.picked));
  if (w.answered) return say.answered(w.answered.replace(/_/g, ' '));
  return w.due ? say.due : say.when;
}
/** Whether a hook's when matches what happened. */
export function hookMatches(h: Hook, ev: HookEvent): boolean {
  const w = h.when;
  return (
    (ev.changed !== undefined && w.changed === ev.changed) ||
    (ev.crossed !== undefined && w.crosses?.panel === ev.crossed) ||
    (ev.picked !== undefined && w.picked === ev.picked) ||
    (ev.answered !== undefined && w.answered === ev.answered) ||
    (ev.due === true && w.due === true)
  );
}
export type HookEvent = { changed?: string; crossed?: string; picked?: string; answered?: string; due?: boolean };
/** Whether a kpi's value is where a crosses hook looks: above its line, or below it. */
export const across = (c: { above?: number; below?: number }, v: unknown): boolean =>
  typeof v === 'number' && ((c.above !== undefined && v > c.above) || (c.below !== undefined && v < c.below));
