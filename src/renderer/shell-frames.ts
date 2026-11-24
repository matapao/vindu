import type { ShellEvent } from '../shell.js';
import { viewOf } from './dom.js';
import { pageFrameFor } from './pointing.js';
import { connectAppFrames } from './mcp-app-bridge.js';
import { checkSend, jsonLength } from '../page-send.js'; // what a page may send, as the UI server takes it
import { asText } from '../format.js';

/** How long a page's report may be, as JSON: the window's own bound, not the server's. */
const REPORT_MAX = 16_000;
/** What a page asks of the window, through its bridge: task.send, vindu.select and vindu.ask. */
const PAGE_ASKS = new Set(['send', 'select', 'ask']);
type PageMessage = { vindu: string; n?: unknown; value?: unknown; items?: unknown; note?: unknown; prompt?: unknown; report?: unknown };

/** The frames in a shell's panes: the pages the model wrote, and MCP Apps. Their messages reach the window in the
 *  shell's own document, whose window may not be the one this script runs in. */
export function connectShellFrames(root: HTMLElement, emit: (event: ShellEvent) => void) {
  const doc = root.ownerDocument, win = doc.defaultView ?? window;
  const apps = connectAppFrames(root, emit);

  // What a page asks, from a page's own frame: what it sends (task.send), what the person picked in it (vindu.select)
  // and a follow-up it proposes for the prompt box (vindu.ask). Taken only while the person is using that page (its
  // frame has focus, and they clicked or pressed a key just now), each within the limits the UI server keeps for a
  // send (page-send.ts), counted for each view and kind on its own, and carried to the UI server. A send is kept as
  // one of the person's answers, and its page hears whether it went, and why not.
  const sentAt = new Map<string, number[]>();
  const using = (frame: HTMLIFrameElement) =>
    !!(win.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive && doc.activeElement === frame;
  const fromPage = (frame: HTMLIFrameElement, ev: MessageEvent, said: PageMessage) => {
    const view = viewOf(frame) ?? '', panel = frame.dataset.pagePanel ?? '', kind = said.vindu, key = `${kind} ${view}`;
    const value = kind === 'send' ? said.value : kind === 'select' ? { items: said.items, note: said.note } : said.prompt;
    const { recent, why: limited } = checkSend(sentAt.get(key) ?? [], value);
    const why = !view || (kind === 'send' && !panel) ? 'this page is in no view'
      : !using(frame) ? 'a page sends only while the person is using it: on their click or key in it' : limited;
    if (!why) {
      recent.push(Date.now()); sentAt.set(key, recent);
      if (kind === 'send') emit({ type: 'send', view, panel, value: said.value });
      else if (kind === 'select') emit({ type: 'page', kind, view, panel, items: said.items, ...(typeof said.note === 'string' ? { note: said.note } : {}) });
      else emit({ type: 'page', kind: 'ask', view, panel, prompt: asText(said.prompt ?? '') });
    }
    if (kind === 'send') (ev.source as Window | null)?.postMessage({ vindu: 'sent', n: said.n, ok: !why, ...(why ? { why } : {}) }, ev.origin);
  };
  // What a page's own script says of how it runs here (pages.ts): the page itself, never what is in it. Carried to the UI
  // server, which keeps only that shape (page-report.ts); a page tells it at most 20 times, and a small one each.
  const reportOf = (frame: HTMLIFrameElement, said: PageMessage) => {
    const view = viewOf(frame) ?? '', panel = frame.dataset.pagePanel ?? '';
    if (view && panel && jsonLength(said.report) <= REPORT_MAX) emit({ type: 'report', view, panel, report: said.report });
  };
  const onMessage = (ev: MessageEvent) => {
    const said = ev.data as PageMessage | null;
    const kind = typeof said?.vindu === 'string' ? said.vindu : undefined;
    const page = kind && (kind === 'report' || PAGE_ASKS.has(kind)) ? pageFrameFor(root, ev) : undefined;
    if (page && kind === 'report') reportOf(page, said!);
    else if (page) fromPage(page, ev, said!);
    else apps.receive(ev);
  };
  win.addEventListener('message', onMessage);

  return {
    setFonts(variables: Record<string, string>) { apps.setFonts(variables); },
    send: (view: string, panel: string, message: unknown) => { apps.send(view, panel, message); },
    destroy() { apps.destroy(); win.removeEventListener('message', onMessage); },
  };
}
