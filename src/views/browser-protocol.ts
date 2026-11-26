// The Chrome DevTools Protocol as a browser view reads it: the connection a host gives (Cdp), and the parts of each
// answer and event the view uses, by the protocol's names. The browser sends them and nothing here checks them, so a
// part the protocol may leave out is read as possibly missing.
import type { ProtocolNode } from './browser-accessibility.js';
import type { Paused } from './browser-requests.js';

/** A CDP connection to one page: Electron's webContents.debugger, or a CDP session of any Chromium. */
export type Cdp = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, fn: (params: unknown) => void): () => void;
};

/** What a script run in the page gave back: its value (returnByValue), or a reference to the object it made. */
type Evaluated = { result?: { value?: unknown; objectId?: string } };
/** What a browser view reads of the answer to each command it sends. */
type Answers = {
  'Runtime.evaluate': Evaluated;
  'Runtime.callFunctionOn': Evaluated;
  'Page.getFrameTree': { frameTree?: { frame?: { id: string; url: string } } };
  'Page.navigate': { errorText?: string };
  'Page.getNavigationHistory': { currentIndex: number; entries: { id: number; url: string }[] };
  'DOM.getContentQuads': { quads?: number[][] };
  'DOM.resolveNode': { object: { objectId: string } };
  'DOM.describeNode': { node?: { nodeName?: unknown; attributes?: unknown } };
  'Accessibility.getFullAXTree': { nodes: ProtocolNode[] };
  'Accessibility.getPartialAXTree': { nodes?: ProtocolNode[] };
};
/** What a browser view reads of each event it listens to. */
export type CdpEvents = {
  'Page.frameStartedLoading': { frameId?: string };
  'Page.frameNavigated': { frame: { id: string; url: string; parentId?: string }; type?: string };
  'Page.navigatedWithinDocument': { frameId?: string; url: string };
  'Page.loadEventFired': unknown;
  'Page.frameStoppedLoading': { frameId?: string };
  'Runtime.consoleAPICalled': {
    type?: string;
    args?: { value?: string | number | boolean | null; unserializableValue?: string; description?: string }[];
  }; // a primitive's value; an object's description
  'Runtime.exceptionThrown': { exceptionDetails?: { exception?: { description?: string }; text?: string } };
  'Log.entryAdded': { entry?: { level?: string; text?: string; source?: string } };
  'Network.requestWillBeSent': { requestId: string; request: { url: string; method: string } };
  'Network.loadingFinished': { requestId: string };
  'Network.responseReceived': { requestId: string; type?: string; response: { status: number; url: string } };
  'Network.loadingFailed': {
    requestId: string;
    type?: string;
    canceled?: boolean;
    blockedReason?: string;
    errorText?: string;
  };
  'Fetch.requestPaused': Paused & { requestId: string; frameId?: string };
  'Overlay.inspectNodeRequested': { backendNodeId?: number };
};

/** A command's answer, as the protocol says it comes. */
export function ask<M extends keyof Answers>(
  cdp: Cdp,
  method: M,
  params?: Record<string, unknown>,
): Promise<Answers[M]> {
  return cdp.send(method, params) as Promise<Answers[M]>;
}
/** Each time an event comes, its params as the protocol says they come. Returns a function that stops listening. */
export function listen<E extends keyof CdpEvents>(cdp: Cdp, event: E, fn: (params: CdpEvents[E]) => void): () => void {
  return cdp.on(event, fn as (params: unknown) => void);
}
