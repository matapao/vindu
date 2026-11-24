// Something came for the process: a result the host kept, or an answer the window kept. It is said where it comes in,
// once, to whatever waits for it: the pages that listen for results hear it at once; the views and panels written to
// wait, and the hooks on an answer, go on once what brought the entry is done, never inside it.
import type { HookEvent } from '../gates.js';
import type { Entry } from '../results.js';
import { log } from './record-files.js';
import type { Session } from './state.js';

/** Whether anything is written to wait: a held view, or a panel that waits. Each waiting panel has had its gate since
 *  its first showing (gateOf), and gates are never taken away, so none waits while there are none. */
const somethingWaits = (session: Session): boolean => session.held.size > 0 || session.gates.size > 0;
/** What waits goes on now, if anything waits. */
export const wakeWaiting = (session: Session): void => {
  if (somethingWaits(session))
    session.resumeWaiting().catch((e) => log(session, { waiting: 'failed', error: String((e as Error).message) }));
};

/** An entry came: the pages hear a result at once; what waits goes on, and the hooks on an answer run, after. */
export const arrived = (session: Session, e: Entry | undefined): void => {
  if (!e || session.closed) return;
  if (e.kind === 'result') session.runtime.host.notify(session.key);
  if (somethingWaits(session)) setTimeout(() => wakeWaiting(session), 0);
  if (e.kind === 'answer' && e.by === 'person' && e.values !== null)
    // the person's answers only: what a page sent or the host ran is not an answer of theirs
    for (const [view, spec] of session.shown)
      if (spec.hooks?.some((hook) => hook.when.answered === e.to)) queueHook(session, view, { answered: e.to });
};

/** A hook to run once what set it off is done: hooks run in the order they were set off, one at a time. */
export const queueHook = (session: Session, view: string, event: HookEvent, only?: number): void => {
  session.hooksDue.push({ view, event, ...(only !== undefined ? { only } : {}) });
  if (session.hooksDue.length === 1) setTimeout(() => void runHooks(session), 0);
};
const runHooks = async (session: Session) => {
  while (session.hooksDue.length) {
    const { view, event, only } = session.hooksDue[0];
    await session
      .fireHooks(view, event, only)
      .catch((e) => log(session, { hook: view, when: event, failed: String((e as Error).message) }));
    session.hooksDue.shift();
  }
};
