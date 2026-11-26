import type { Account } from '../account.js';
import { applyAction, type ViewAction } from '../actions.js';
import { panelsOf, pidFor } from '../cards.js';
import { Refusal } from '../view-context.js';
import { wakeWaiting } from './arrivals.js';
import { log, unawaited } from './records.js';
import type { Session } from './state.js';

/** A change inside a view (actions.ts), by the person or the model: applied, drawn again where it is, kept for undo,
 *  and marked on its pane. What it did, in words, or why not. done: told what it did as soon as it is applied, before
 *  the view is drawn again, so what is said of it never waits on the drawing; a change the view cannot be drawn with
 *  is no change: neither kept nor told. */
export const act = async (
  session: Session,
  view: string,
  a: ViewAction,
  by: 'person' | 'model',
  done?: (what: string) => void,
): Promise<{ what: string; account?: Account } | { refusal: string }> => {
  const args = session.specs.get(view);
  const title = session.shown.get(view)?.title ?? view;
  if (!args || !session.shown.has(view))
    return {
      refusal: `no view "${view}" is shown; views: ${[...session.shown.keys()].join(', ') || 'none'}`,
    };
  const h = session.vhistory.get(view) ?? [];
  try {
    if (a.action === 'undo') {
      const last = h.at(-1);
      if (!last) return { refusal: `nothing to undo in "${title}"` };
      if (by === 'model' && last.by !== 'model')
        return { refusal: `the last change in "${title}" is the person's (${last.what}): only they undo it` };
      const account = await session.present(
        last.args,
        true,
        false,
        () => {
          if (h.at(-1) === last) h.pop();
          done?.(`undid "${last.what}"`);
        },
        false,
        by,
      );
      const prev = h.at(-1);
      session.shell.mark(view, prev ? { text: markOf(prev.what), by: prev.by, undo: true } : undefined);
      return { what: `undid "${last.what}"`, account };
    }
    const r = applyAction(args, session.data.get(view), a, title, session.runtime.cards);
    if ('refusal' in r) return r;
    const account = await session.present(
      r.args,
      true,
      false,
      () => {
        h.push({ args, by, what: r.what });
        session.vhistory.set(view, h.slice(-20));
        done?.(r.what);
      },
      false,
      by,
    ); // its pane stays as it is
    if (r.mark) session.shell.mark(view, { text: r.mark, by, undo: true }); // a row picked for linked panels is no change to mark
    if (a.action === 'select') {
      wakeWaiting(session); // what waited for a pick goes on
      const sp = session.shown.get(view);
      const pid = sp && panelsOf(sp).find((p) => p.id === a.panel || pidFor(p.id) === a.panel)?.id;
      if (pid) unawaited(session, { hook: view, picked: pid }, session.fireHooks(view, { picked: pid }));
    }
    return { what: r.what, account };
  } catch (e) {
    if (e instanceof Refusal) return { refusal: e.message }; // the view as it would be cannot be drawn: it stays as it is
    throw e;
  }
};
const markOf = (what: string) => what.replace(/^(\w)/, (c) => c.toUpperCase());
/** The person's change inside a view, from its pane: done, and told to the model with the next message. */
export const personAct = (
  session: Session,
  view: string,
  a: ViewAction,
  who: { name: string; window: string },
): boolean => {
  if (!session.shown.has(view)) return false;
  const done = (what: string) => {
    const said = `${who.name === 'the person' ? 'the person' : `${who.name} (${who.window})`} ${what}`;
    session.shell.say(said);
    session.vunseen.set(view, [...(session.vunseen.get(view) ?? []), said]);
    log(session, { person: { view, action: a, did: what } });
  };
  void act(session, view, a, 'person', done)
    .then((r) => {
      if ('refusal' in r) log(session, { person: { view, action: a, refused: r.refusal } });
    })
    .catch((e) => log(session, { person: { view, action: a, failed: String((e as Error).message) } }));
  return true;
};
export const viewAction = (x: Record<string, unknown>): ViewAction => ({
  action: x.action as ViewAction['action'],
  ...Object.fromEntries(
    (['panel', 'field', 'dir', 'value', 'key', 'from', 'to', 'keys', 'start', 'end'] as const)
      .filter((k) => x[k] !== undefined)
      .map((k) => [k, x[k]]),
  ),
});
