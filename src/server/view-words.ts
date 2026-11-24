import { viewWordsOver, type PartialViewWords, type ViewWords } from '../view-words.js';
import { log } from './records.js';
import type { ServerRuntime } from './runtime.js';
import type { Session } from './state.js';

/** The words a session's views are drawn in: its own, word by word over the provider's, which are over English. */
export const sessionWords = (runtime: ServerRuntime, words?: PartialViewWords): ViewWords =>
  viewWordsOver(runtime.viewWords, words);

/** The session's own words in place of those it had (a host that switches language while the window runs): every view
 *  shown is drawn again in them at once, where it is, shown or hidden. Nothing in a view changed but its words, so it is
 *  painted again as a restored view is: no page is checked, no source read and no hook run again, and the model is told
 *  nothing, as what it is told is in English either way. */
export const setViewWords = async (session: Session, words?: PartialViewWords): Promise<void> => {
  if (session.closed) return;
  session.viewWords = sessionWords(session.runtime, words);
  await Promise.all(
    [...session.specs].map(([view, args]) =>
      session
        .present(args, true, true)
        .catch((e) => log(session, { view_words: view, failed: String((e as Error).message) })),
    ),
  );
};
