import type { ShellEvent } from '../shell.js';
import { viewOf } from './dom.js';
import { pageFrameFor } from './pointing.js';
import { connectAppFrames } from './mcp-app-bridge.js';
import { pageMessageGuard, type PageAsk } from '../page-message-guard.js'; // what a page may send, as a host's relay takes it too
import { asText } from '../format.js';

/** What a page asks of the window, through its bridge: task.send, vindu.select and vindu.ask. */
const PAGE_ASKS = new Set(['send', 'select', 'ask']);
type PageMessage = { vindu: string; n?: unknown; value?: unknown; items?: unknown; note?: unknown; prompt?: unknown; report?: unknown };

/** The frames in a shell's panes: the pages the model wrote, and MCP Apps. Their messages reach the window in the
 *  shell's own document, whose window may not be the one this script runs in. locale: the window's language, for MCP
 *  Apps. read: how far the person has read a page, as its frame says (shell-reading.ts). */
export function connectShellFrames(root: HTMLElement, emit: (event: ShellEvent) => void, options: { locale?: string; read?: (frame: HTMLIFrameElement, share: number) => void } = {}) {
  const doc = root.ownerDocument, win = doc.defaultView ?? window;
  const apps = connectAppFrames(root, emit, options);

  // What a page asks, from a page's own frame: what it sends (task.send), what the person picked in it (vindu.select)
  // and a follow-up it proposes for the prompt box (vindu.ask). Taken only while the person is using that page (its
  // frame has focus, and they clicked or pressed a key just now), each within the limits the UI server keeps for a
  // send (page-send.ts), counted for each view and kind on its own, and carried to the UI server. A send is kept as
  // one of the person's answers, and its page hears whether it went, and why not.
  const guard = pageMessageGuard();
  const using = (frame: HTMLIFrameElement) =>
    !!(win.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive && doc.activeElement === frame;
  const fromPage = (frame: HTMLIFrameElement, ev: MessageEvent, said: PageMessage) => {
    const view = viewOf(frame) ?? '', panel = frame.dataset.pagePanel ?? '', kind = said.vindu as PageAsk;
    let value: unknown = said.prompt; // what it sends: a value, a selection, or a prompt
    if (kind === 'send') value = said.value; else if (kind === 'select') value = { items: said.items, note: said.note };
    const why = guard({ kind, view, panel, value, using: using(frame) });
    if (!why) {
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
    if (!guard({ kind: 'report', view, panel, value: said.report, using: true })) emit({ type: 'report', view, panel, report: said.report });
  };
  // How far the person has read a page, as its own script says (page-runtime.ts): a share, kept by the window, which
  // takes it while the frame is in view, and tells the UI server for the host alone.
  const readOf = (frame: HTMLIFrameElement, said: PageMessage) => {
    const view = viewOf(frame) ?? '', panel = frame.dataset.pagePanel ?? '';
    if (!guard({ kind: 'read', view, panel, value: said.value, using: true })) options.read?.(frame, said.value as number);
  };
  const onMessage = (ev: MessageEvent) => {
    const said = ev.data as PageMessage | null;
    const kind = typeof said?.vindu === 'string' ? said.vindu : undefined;
    const page = kind && (kind === 'report' || kind === 'read' || PAGE_ASKS.has(kind)) ? pageFrameFor(root, ev) : undefined;
    if (page && kind === 'report') reportOf(page, said!);
    else if (page && kind === 'read') readOf(page, said!);
    else if (page) fromPage(page, ev, said!);
    else apps.receive(ev);
  };
  win.addEventListener('message', onMessage);

  return {
    setFonts(variables: Record<string, string>) { apps.setFonts(variables); },
    themeChanged() { apps.themeChanged(); },
    setLocale: (tag?: string) => { apps.setLocale(tag); },
    send: (view: string, panel: string, message: unknown) => { apps.send(view, panel, message); },
    /** Takes element out of the window: hidden at once, and gone once each MCP App in it whose document has initialized
     *  has answered its teardown, or its wait is over; at once, when there is none. Until then its frames stay where they
     *  are, as a frame that moves loads its document again. after: what follows its going. */
    remove(element: HTMLElement, after?: () => void) {
      element.style.display = 'none';
      element.setAttribute(LEAVING, '');
      const go = () => {
        element.remove();
        after?.();
      };
      const waiting = apps.tearDown(element);
      if (waiting) void waiting.then(go);
      else go();
    },
    destroy() { apps.destroy(); win.removeEventListener('message', onMessage); },
  };
}

const LEAVING = 'data-vindu-leaving';
/** Whether element is on its way out of the window, its MCP Apps tearing down. */
export const isLeaving = (element: Element) => element.hasAttribute(LEAVING);
