// The window's browser pages (browser.ts): each opened by the host where it can show it, the model's or the person's, and
// gone when its view goes or the window closes.
import { BrowserPage } from './browser.js';
import type { Cdp } from './browser-protocol.js';
import { webAddress } from './browser-requests.js';

/** The window's browser pages. The host opens a page where it can show it (Electron: a WebContentsView in a pane)
 *  and gives its CDP connection. A page the model opens is its own to read and use; one the person opens is
 *  theirs until they share it, as a terminal is. */
export class Browsers {
  private readonly pages = new Map<string, BrowserPage>();
  private readonly starting = new Map<string, Promise<BrowserPage>>(); // pages the host shows already, not yet ready to use
  private n = 0;
  /** Set once the window closes: a page that finishes opening after that closes again. */
  closed = false;
  /** open: the host opens the page and gives its CDP connection; owner says whose it is (the model's or the
   *  person's), so the host can keep the person's sign-ins out of the model's pages. */
  constructor(private readonly open?: (o: { id: string; url?: string; owner: 'model' | 'person' }) => Promise<Cdp>, private readonly onPage?: (p: BrowserPage) => void,
    private readonly onStartFailure?: (id: string) => void) {}
  private async start(id: string, cdp: Cdp, owner: 'model' | 'person') {
    const page = new BrowserPage(id, cdp);
    page.owner = owner; page.shared = owner === 'model'; this.onPage?.(page);
    try { await page.start(); if (this.closed) throw new Error('the window has closed'); }
    catch (error) { page.stop(); this.onStartFailure?.(id); throw error; }
    this.pages.get(id)?.stop();
    this.pages.set(id, page);
    return page;
  }
  /** A new page, opened by the host, at url if one is given: the model's (shared with it), or the person's (not
   *  shared until they share it). id: the view's name, if it has one already. */
  async create(url?: string, o: { owner?: 'model' | 'person'; id?: string } = {}): Promise<BrowserPage> {
    if (!this.open) throw new Error('this host opens no browser pages');
    const owner = o.owner ?? 'model', id = o.id ?? `b${++this.n}`;
    if (this.pages.has(id) || this.starting.has(id)) throw new Error(`a page "${id}" is open already`);
    const opening = (async () => {
      const cdp = await this.open!({ id, ...(url ? { url: webAddress(url) } : {}), owner });
      return this.start(id, cdp, owner);
    })();
    this.starting.set(id, opening);
    try {
      const page = await opening;
      if (url && !page.url.startsWith('http')) {
        try { await page.navigate(url); } catch (error) { // a page that could not go there is not left half made
          if (this.pages.get(id) === page) this.remove(id);
          this.onStartFailure?.(id);
          throw error;
        }
      }
      return page;
    } finally { this.starting.delete(id); }
  }
  /** A page once it can be used: one the host shows already but that is still opening is waited for. */
  async ready(id: string): Promise<BrowserPage> { return this.pages.get(id) ?? (await this.starting.get(id)) ?? this.get(id); }
  /** Whether a page is open, or opening. */
  has(id: string): boolean { return this.pages.has(id) || this.starting.has(id); }
  /** A page the host opened itself: the person's own, not shared until they share it. */
  async add(id: string, cdp: Cdp): Promise<BrowserPage> { return this.start(id, cdp, 'person'); }
  /** Whether the model may read and use a page. The person decides, per page. */
  share(id: string, on: boolean): BrowserPage { const p = this.get(id); p.shared = on; return p; }
  get(id: string): BrowserPage { const p = this.pages.get(id); if (!p) throw new Error(`no browser page "${id}"; open: ${[...this.pages.keys()].join(', ') || 'none'}`); return p; }
  list(): BrowserPage[] { return [...this.pages.values()]; }
  remove(id: string): void { this.pages.get(id)?.stop(); this.pages.delete(id); }
  /** The window closes: every open page goes, and a page still opening goes once it is ready. The ids of the open ones. */
  closeAll(): string[] { this.closed = true; const ids = [...this.pages.keys()]; for (const id of ids) this.remove(id); return ids; }
}
