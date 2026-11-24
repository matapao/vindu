// What a panel or a view waits for, worked out by the system: a result this process does not have yet (awaits), or
// something the person does (after): an answer, a pick, a panel filled. Pure: the UI server keeps the state.
import type { Entry, ResultEntry } from './results.js';
import type { Await, Hook } from './cards.js';

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
export const firstAfter = (all: readonly Entry[], since: number, a: Await): ResultEntry | undefined => all.slice(since).find((e): e is ResultEntry => isAwaited(e, a));
/** A view and a panel, from "view/panel", or the panel of this view. */
export const panelRef = (ref: string, view: string): [string, string] => { const i = ref.indexOf('/'); return i > 0 ? [ref.slice(0, i), ref.slice(i + 1)] : [view, ref]; };

/** A hook in the person's words: "When Overdue is above 50000: tell you: …" (titleOf names a panel). */
export function hookWords(h: Hook, titleOf: (panel: string) => string): string {
  const w = h.when, d = h.do;
  const when = w.changed ? `When ${titleOf(w.changed)} changes`
    : w.crosses ? `When ${titleOf(w.crosses.panel)} is ${w.crosses.above !== undefined ? `above ${w.crosses.above}` : ''}${w.crosses.above !== undefined && w.crosses.below !== undefined ? ' or ' : ''}${w.crosses.below !== undefined ? `below ${w.crosses.below}` : ''}`
    : w.picked ? `When you pick a row in ${titleOf(w.picked)}` : w.answered ? `When you answer "${w.answered.replace(/_/g, ' ')}"` : w.due ? 'When a reminder about this comes due' : 'When';
  const what = [d.cue ? `offer "${d.cue.label}"` : '', d.notify ? `tell you: ${d.notify}` : '', d.read ? `read ${titleOf(d.read)} again` : '', d.job ? `start a job: ${d.job.prompt}` : ''].filter(Boolean).join('; ');
  return `${h.label ? `${h.label}: ` : ''}${when}, ${what || 'nothing'}`;
}
/** Whether a hook's when matches what happened. */
export function hookMatches(h: Hook, ev: HookEvent): boolean {
  const w = h.when;
  return (ev.changed !== undefined && w.changed === ev.changed) || (ev.crossed !== undefined && w.crosses?.panel === ev.crossed)
    || (ev.picked !== undefined && w.picked === ev.picked) || (ev.answered !== undefined && w.answered === ev.answered) || (ev.due === true && w.due === true);
}
export type HookEvent = { changed?: string; crossed?: string; picked?: string; answered?: string; due?: boolean };
/** Whether a kpi's value is where a crosses hook looks: above its line, or below it. */
export const across = (c: { above?: number; below?: number }, v: unknown): boolean => typeof v === 'number' && ((c.above !== undefined && v > c.above) || (c.below !== undefined && v < c.below));
