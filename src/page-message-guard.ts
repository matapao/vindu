// What a window lets through of a page's messages to it: a send (task.send), a pick (vindu.select), a follow-up for the
// prompt box (vindu.ask), the page's report of how it runs, and how far the person has read it. The same bounds for Vindu's own shell and for a host
// that relays a page's messages itself, so a host keeps them without copying them. Shared by Node and the browser.
import { checkSend, jsonLength } from './page-send.js';

/** How long a page's report may be, as JSON: the window's own bound, not the server's. */
export const REPORT_MAX = 16_000;
/** What a page asks of the window, besides its report. */
export type PageAsk = 'send' | 'select' | 'ask';
/** One message from a page: its kind, the view and page panel it came from, what it carries, and whether the person
 *  is using that page now (its frame has focus, and they clicked or pressed a key just now). */
export type PageMessageCheck = {
  kind: PageAsk | 'report' | 'read';
  view: string;
  panel: string;
  value: unknown;
  using: boolean;
  now?: number;
};

/** A guard for one window's pages: each message, whether it may go (undefined) or why not. Sends, picks and asks are
 *  counted for each view and kind on their own, within the limits the UI server keeps for a send (page-send.ts); one
 *  that may go is counted as it is told so. A report needs its view and panel and a small size, and is not counted; so
 *  does a read, whose value is a share, from 0 to 1. */
export function pageMessageGuard(): (message: PageMessageCheck) => string | undefined {
  const sentAt = new Map<string, number[]>();
  return ({ kind, view, panel, value, using, now = Date.now() }) => {
    if ((kind === 'report' || kind === 'read') && (!view || !panel)) return 'this page is in no view';
    if (kind === 'report')
      return jsonLength(value) > REPORT_MAX ? `not a report of at most ${REPORT_MAX} characters as JSON` : undefined;
    if (kind === 'read')
      return typeof value === 'number' && value >= 0 && value <= 1
        ? undefined
        : 'a read is a share of the page, from 0 to 1';
    const key = `${kind} ${view}`;
    const { recent, why: limited } = checkSend(sentAt.get(key) ?? [], value, now);
    let why = limited;
    if (!view || (kind === 'send' && !panel)) why = 'this page is in no view';
    else if (!using) why = 'a page sends only while the person is using it: on their click or key in it';
    if (!why) {
      recent.push(now);
      sentAt.set(key, recent);
    }
    return why;
  };
}
