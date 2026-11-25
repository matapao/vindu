import { viewWordsOver, type PartialViewWords, type ViewWords } from '../view-words.js';
import { log } from './records.js';
import type { ServerRuntime } from './runtime.js';
import type { Session } from './state.js';

/** How a window's values are written: its locale (a BCP 47 tag) and time zone (an IANA name). */
export type ViewFormat = { locale: string; timeZone: string };

/** The words a session's views are drawn in: its own, word by word over the provider's, which are over English. */
export const sessionWords = (runtime: ServerRuntime, words?: PartialViewWords): ViewWords =>
  viewWordsOver(runtime.viewWords, words);

/** A locale and a time zone given over others: each one given in place of the one under it, checked first. Throws a
 *  RangeError for a locale that is no language tag, or a time zone that is not one. */
export function formatOver(under: ViewFormat, given: Partial<ViewFormat> = {}): ViewFormat {
  const { locale = under.locale, timeZone = under.timeZone } = given;
  try { Intl.getCanonicalLocales(locale); } catch {
    throw new RangeError(`locale: "${locale}" is not a language tag (BCP 47), e.g. "nb-NO"`);
  }
  try { new Intl.DateTimeFormat('en-GB', { timeZone }); } catch {
    throw new RangeError(`timeZone: "${timeZone}" is not a time zone (IANA), e.g. "Europe/Oslo"`);
  }
  return { locale, timeZone };
}

/** The session's own words in place of those it had (a host that switches language while the window runs), and with
 *  them, where given, its own locale and time zone in place of those it had: every view shown is drawn again in them at
 *  once, where it is, shown or hidden, its numbers and dates as the new locale writes them. Nothing in a view changed
 *  but how it reads, so it is painted again as a restored view is: no page is checked, no source read and no hook run
 *  again, and the model is told nothing, as what it is told is in English either way. The account of each view, as
 *  later read, says the locale it is drawn in. A locale or time zone that is none is refused before anything changes. */
export const setViewWords = async (session: Session, words?: PartialViewWords, format?: Partial<ViewFormat>): Promise<void> => {
  if (session.closed) return;
  const next = formatOver(session.format, format);
  session.viewWords = sessionWords(session.runtime, words);
  session.format = next;
  await Promise.all(
    [...session.specs].map(([view, args]) =>
      session
        .present(args, true, true)
        .catch((e) => log(session, { view_words: view, failed: String((e as Error).message) })),
    ),
  );
};
