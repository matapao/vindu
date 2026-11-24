// Where a page's frame may go. A page cannot fetch from the network (its CSP), but CSP does not say where a frame may
// navigate, so a page could put what it read into an address elsewhere and go there. Only the browser that shows the
// page can stop that, so the host does it with these: the window's own CSP (frame-src), and in Electron its
// will-frame-navigate. The headless check driver uses the same rule. Shared by Node and the browser, so nothing else here.

/** The origins the page host serves on its port, as the names it gives them: a process (<key>.localhost), its pages
 *  from the working folder (work-<key>.localhost, or work-<key>-<grant>.localhost for those given results), or an MCP
 *  App (app-<key>.localhost). A key is 128 bits (32 hex digits), a grant 96 (24, see page-grants.ts). */
const PAGE_NAME = /^(?:app-[a-f0-9]{32}|work-[a-f0-9]{32}(?:-[a-f0-9]{24})?|[a-f0-9]{32})\.localhost$/;

const TASK_PAGE = /^(?:work-[a-f0-9]{32}(?:-[a-f0-9]{24})?|[a-f0-9]{32})\.localhost$/;
const APP_PAGE = /^app-[a-f0-9]{32}\.localhost$/;
const named = (url: string | URL, name: RegExp, port?: number): URL | null => {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' && name.test(u.hostname) && !u.username && !u.password && (port === undefined || u.port === String(port)) ? u : null;
  } catch { return null; }
};
/** A URL on one of a task's page origins (the task's own, or one of its working folder's), parsed; else null. A host
 *  that recognises Vindu's pages asks this, so the shape of the names stays Vindu's. With port, only on that port. */
export const pageHost = (url: string | URL, port?: number): URL | null => named(url, TASK_PAGE, port);
/** A URL on an MCP App's origin (app-<key>.localhost), parsed; else null. With port, only on that port. */
export const appHost = (url: string | URL, port?: number): URL | null => named(url, APP_PAGE, port);

/** Whether a URL is on one of the page host's origins. */
function onPageHost(url: string, port: number): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && PAGE_NAME.test(u.hostname) && u.port === String(port) && !u.username && !u.password;
  } catch { return false; }
}

/** The page host's origins as one CSP source, for the frame-src of the window's own document: the browser then refuses
 *  any navigation of a page's frame to anywhere else (*.localhost is always this machine, and the port is the page
 *  host's). */
export const pageFrameSource = (port: number) => `http://*.localhost:${port}`;

/** Whether a frame may go to url: a navigation, a redirect or a frame's request, in the browser that shows the pages.
 *  from is the URL the frame shows now. A frame that shows a page or an app stays on the page host (any of its
 *  origins: a window may show several processes, and reuse a frame for another); a frame that shows anything else is
 *  not the page host's to judge (true). Without from, url must be on the page host. */
export function pageNavigationAllowed(url: string, o: { port: number; from?: string }): boolean {
  if (o.from !== undefined && !onPageHost(o.from, o.port)) return true;
  return onPageHost(url, o.port);
}
