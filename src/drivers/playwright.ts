// A page driver over Playwright, for headless hosts: tests, servers, CI. playwright is an optional peer:
// the host passes its own browser in. Each check gets a fresh context, so no storage carries over, and the context
// refuses every request that leaves the page host (pageNavigationAllowed, the rule a window applies too): a navigation
// away gets "no content" and the page stays put. So does every WebSocket (which context.route does not see), and no
// service worker starts. WebRTC, which no CSP covers, is taken from every frame of the context before anything in it
// runs, srcdoc and data: frames included. A check closes the context when a call takes too long (page-check.ts), which
// ends a page in a loop too. What the browser resolves before a request (a <link rel="dns-prefetch">) is the browser's:
// a host that must keep even names in launches Chromium with its own resolver rules.
import type { PageDriver } from '../page-check.js';
import { pageNavigationAllowed } from '../page-guard.js';
import { noWebRtc } from '../page-runtime.js';

type Route = { request(): { url(): string; isNavigationRequest(): boolean }; abort(code?: string): Promise<void>; fulfill(o: { status: number }): Promise<void> };
type Page = {
  goto(url: string, o: { waitUntil: 'load'; timeout: number }): Promise<{ status(): number } | null>;
  evaluate<T>(expression: string): Promise<T>;
  keyboard: { press(key: string): Promise<void>; down(key: string): Promise<void>; up(key: string): Promise<void>; type(text: string): Promise<void> };
  click(selector: string, o: { timeout: number }): Promise<void>;
  fill(selector: string, text: string, o: { timeout: number }): Promise<void>;
  waitForSelector(selector: string, o: { timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
};
type SocketRoute = { url(): string; close(o?: { code?: number; reason?: string }): Promise<void> };
type Context = {
  newPage(): Promise<Page>; close(): Promise<void>; addInitScript(script: string): Promise<unknown>; // Playwright 1.65 and later give a Disposable
  route(match: (url: URL) => boolean, handler: (route: Route) => Promise<void>): Promise<unknown>;
  routeWebSocket?(match: (url: URL) => boolean, handler: (socket: SocketRoute) => Promise<void> | void): Promise<unknown>; // Playwright 1.48 and later
};
type Browser = { newContext(o: { viewport: { width: number; height: number }; serviceWorkers?: 'allow' | 'block' }): Promise<Context> };

export function playwrightDriver(browser: Browser): PageDriver {
  return {
    async open(url, viewport) {
      const port = Number(new URL(url).port); const refused: string[] = [];
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      await context.addInitScript(`(${noWebRtc.toString()})(window);`);
      await context.route(u => !pageNavigationAllowed(u.href, { port }), route => { // every page of the context, popups included
        refused.push(route.request().url());
        return route.request().isNavigationRequest() ? route.fulfill({ status: 204 }) : route.abort('blockedbyclient');
      });
      await context.routeWebSocket?.(() => true, socket => { refused.push(socket.url()); return socket.close({ code: 1008, reason: 'nothing leaves the page host' }); }); // the page host has none
      const page = await context.newPage();
      const t0 = Date.now(); let status: number | null = null;
      try { status = (await page.goto(url, { waitUntil: 'load', timeout: 15_000 }))?.status() ?? null; } catch { status = null; }
      return {
        status, ms: Date.now() - t0, refused: () => [...refused],
        eval: <T>(js: string) => page.evaluate<T>(js),
        press: key => page.keyboard.press(key),
        down: key => page.keyboard.down(key),
        up: key => page.keyboard.up(key),
        click: selector => page.click(selector, { timeout: 2000 }),
        type: (text, selector) => selector ? page.fill(selector, text, { timeout: 2000 }) : page.keyboard.type(text),
        waitFor: (selector, ms) => page.waitForSelector(selector, { timeout: ms }).then(() => true, () => false),
        wait: ms => page.waitForTimeout(ms),
        close: () => context.close(),
      };
    },
  };
}
