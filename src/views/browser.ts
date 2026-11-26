// A browser view's page, as the model reaches it: through the Chrome DevTools Protocol, as structured JSON, never pixels. The
// same code drives a page in Electron (a WebContentsView's own debugger, which reaches that page and nothing else of
// the app) and any Chromium (a CDP session). It gives:
//   - a snapshot of the page's accessibility tree: roles, names, values and states, and a reference (e1, e2, …) for
//     each element that can be acted on;
//   - actions by reference: click, type, select; keys; navigation, back, forward, reload; waiting for text;
//   - what the page logged (console, errors) and what failed to load.
// There is no screenshot here: the model reads the page as the snapshot says it is.
// Two rules hold here as everywhere in the window:
//   - nothing leaves unasked: while the model acts in a page, what the page sends that is not a plain read (a form
//     posted, a fetch that writes) is held until the person says yes (guard); and what a page of the model's own reaches
//     on another site, in any frame, waits for the person's yes for that site (leave, reach);
//   - secrets are the person's: fields for passwords, card numbers and one-time codes show the model only whether they
//     are filled, and the model never types in them.

import { asText } from '../format.js';
import { readAccessibleTree, type Snapshot } from './browser-accessibility.js';
import { checkField, checkFocusedField, fieldPrivacy, secretFieldNames } from './browser-fields.js';
import { ask, listen, type Cdp, type CdpEvents } from './browser-protocol.js';
import { webAddress, type Outgoing, type Sent } from './browser-requests.js';
import { sleep } from './time.js';
import { keyOf } from './browser-keys.js';
import { pointedAt, type Pointed } from './browser-pointing.js';
import { callOn, settled, waitFor } from './browser-settle.js';
export type { Pointed } from './browser-pointing.js';
import { PageLog, type Failure, type LogEntry } from './browser-log.js';
import { pausedRequest } from './browser-pause.js';
export type { Failure, LogEntry } from './browser-log.js';
export type { PageNode, Snapshot } from './browser-accessibility.js';
export type { Cdp } from './browser-protocol.js';
export { SECRET_FIELDS, fieldNames, webAddress, type Outgoing, type Sent } from './browser-requests.js';

const HELD_KEPT = 100; // what the page wanted to send, kept until the model's next action reads it

/** What a page's move goes through: it starts loading, commits a new page, loads it, stops; or it is done at once. */
type Move = 'started' | 'committed' | 'load' | 'stopped' | 'done';

export class BrowserPage {
  url = '';
  private sharing: AbortController | undefined = new AbortController();
  get shared(): boolean { return this.sharing !== undefined; }
  set shared(on: boolean) {
    if (on === this.shared) return;
    if (on) this.sharing = new AbortController();
    else {
      const previous = this.sharing;
      this.sharing = undefined;
      previous?.abort(new Error(`the person stopped sharing ${this.id}`));
      this.held.length = 0;
      this.refs.clear();
      this.secretRefs.clear();
    }
  }
  /** Each operation belongs to the share under which it started, even if this pane is shared again. */
  whileShared(): AbortSignal {
    if (!this.sharing) throw new Error(`the person has not shared ${this.id}`);
    return this.sharing.signal;
  }
  owner: 'model' | 'person' = 'model';   // who opened it: the model's pages never carry the person's sign-ins
  /** Asked about each request that is not a plain read: undefined lets it go at once; otherwise it is held until the
   *  promise says whether it may go. Views sets it, and holds only while the model acts. */
  guard?: (o: Outgoing) => Promise<boolean> | undefined;
  /** Asked about each address the page itself would go to (its own document, not its frames'): undefined lets it go at
   *  once; otherwise the move is called off at once (the page stays where it is, and whoever moved it is not kept
   *  waiting), and made again if the promise says yes. Views sets it: another site of a page of the model's, or of one it
   *  just acted in, waits for the person. */
  leave?: (url: string) => Promise<boolean> | undefined;
  /** Asked about every other request the page makes, of any kind and in any frame (a frame's page, a script, an image,
   *  a fetch): undefined lets it on at once, false refuses it at once, and a promise holds it until it says whether it
   *  may go on (to the guard). Views sets it on the model's own pages: another site waits for the person's yes. */
  reach?: (url: string, kind: string) => Promise<boolean> | boolean | undefined;
  private refs = new Map<string, number>();  // reference → backend DOM node id, from the latest snapshot
  private secretRefs = new Set<string>();    // references to secret fields, from the latest snapshot
  private holds = new Set<Promise<unknown>>(); private held: Sent[] = [];
  private knownSecret: string[] = [];        // the page's secret fields by name, learnt while the page is idle (a paused page can't be read)
  private readonly logged = new PageLog(); // what it logged, and what failed to load
  private main = ''; private loaded?: (e: Move) => void; private offs: (() => void)[] = [];
  private picking?: (backendNodeId: number | null) => void;

  constructor(readonly id: string, private readonly cdp: Cdp, private readonly o: { onNavigate?: (url: string) => void } = {}) {}

  /** Whether something the page wants to send is waiting for the person. */
  get holding(): boolean { return this.holds.size > 0; }
  /** What the page wanted to send while the model acted, and whether it went; read once. */
  takeHeld(): Sent[] { return this.held.splice(0); }
  /** The names (or ids) of the secret fields on the page now. */
  secretFields(): Promise<string[]> { return secretFieldNames(this.cdp); }
  private keep(sent: Sent) { this.held.push(sent); if (this.held.length > HELD_KEPT) this.held.splice(0, this.held.length - HELD_KEPT); }
  /** Until nothing is held for the person. */
  private async unheld(): Promise<void> { while (this.holds.size) await Promise.all(this.holds); }

  /** Turn on what the page reports: navigations, console and errors, requests. */
  async start(): Promise<this> {
    const on = <E extends keyof CdpEvents>(e: E, f: (p: CdpEvents[E]) => void) => this.offs.push(listen(this.cdp, e, f));
    // a move ends at the load of the page it commits, or where the frame stops loading (done, or called off); a page
    // restored from the back-forward cache, or a move within the document, fires no load, so it ends there
    on('Page.frameStartedLoading', p => { if (p.frameId === this.main) this.loaded?.('started'); });
    on('Page.frameNavigated', p => { if (!p.frame?.parentId) { this.main = p.frame.id; this.nav(p.frame.url); this.loaded?.(p.type === 'BackForwardCacheRestore' ? 'done' : 'committed'); } });
    on('Page.navigatedWithinDocument', p => { if (!this.main || p.frameId === this.main) { this.nav(p.url); this.loaded?.('done'); } });
    on('Page.loadEventFired', () => { this.loaded?.('load'); });
    on('Page.frameStoppedLoading', p => { if (p.frameId === this.main) this.loaded?.('stopped'); });
    this.logged.listen(on);
    on('Fetch.requestPaused', p => {
      void pausedRequest(this, p, { cdp: this.cdp, sharing: this.sharing?.signal, main: this.main, knownSecret: () => this.knownSecret, holds: this.holds, keep: sent => this.keep(sent) });
    });
    for (const d of ['Page', 'Runtime', 'Network', 'Log', 'DOM', 'Accessibility']) await this.cdp.send(`${d}.enable`).catch(() => undefined);
    try {
      await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    } catch (cause) {
      this.stop();
      throw new Error('The browser could not enable request checks for this page.', { cause });
    }
    const tree = await ask(this.cdp, 'Page.getFrameTree').catch(() => null);
    if (tree?.frameTree?.frame) { this.main = tree.frameTree.frame.id; this.url = tree.frameTree.frame.url; }
    return this;
  }
  stop(): void { this.shared = false; for (const f of this.offs.splice(0)) f(); }

  async title(): Promise<string> { return asText((await ask(this.cdp, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true }).catch(() => null))?.result?.value ?? ''); }

  /** The person points at an element: the page shows what is under the pointer, and the next click picks it without
   *  reaching the page (the browser's own inspect mode). What it is comes from the accessibility tree: its role and
   *  name, and its reference in the model's latest snapshot, which pointing never changes. Null if called off. */
  async pointAt(ms = 120_000): Promise<Pointed | null> {
    this.picking?.(null);
    await this.cdp.send('Overlay.enable').catch(() => undefined);
    const id = await new Promise<number | null>(resolve => {
      let off = () => undefined as void;
      const t = setTimeout(() => finish(null), ms);
      const finish = (v: number | null) => { clearTimeout(t); off(); if (this.picking === finish) this.picking = undefined; resolve(v); };
      off = listen(this.cdp, 'Overlay.inspectNodeRequested', p => finish(Number(p.backendNodeId) || null));
      this.picking = finish;
      const blue = { r: 35, g: 102, b: 196 };
      this.cdp.send('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: { showInfo: true, showAccessibilityInfo: true, contentColor: { ...blue, a: 0.16 }, borderColor: { ...blue, a: 0.9 } } }).catch(() => finish(null));
    });
    await this.cdp.send('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} }).catch(() => undefined);
    await this.cdp.send('Overlay.hideHighlight').catch(() => undefined);
    return id ? pointedAt(this.cdp, id, this.refs, this.secretRefs, this.url) : null;
  }
  /** The person stops pointing (Esc, or the button again). */
  stopPointing(): void { this.picking?.(null); }
  /** The page as its accessibility tree says it is, with a reference for each element that can be acted on. */
  async snapshot(max = 1500, signal?: AbortSignal): Promise<Snapshot> {
    const { nodes } = await ask(this.cdp, 'Accessibility.getFullAXTree');
    signal?.throwIfAborted();
    const inspected = await readAccessibleTree(nodes,
      id => id === undefined ? Promise.resolve('unknown') : fieldPrivacy(this.cdp, { backendNodeId: id }),
      max, signal);
    signal?.throwIfAborted();
    this.refs = inspected.references;
    this.secretRefs = inspected.secretReferences;
    const refs = inspected.references.size;
    const title = inspected.title ?? await this.title();
    const cut = inspected.cut ? { cut: `${inspected.cut} more elements left out (over ${max}); act on what is here, or narrow the page` } : {};
    return { page: this.id, url: this.url, title, tree: inspected.tree, refs, nodes: inspected.count, ...cut };
  }

  async click(ref: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const backendNodeId = this.node(ref);
    await this.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
    const q = await ask(this.cdp, 'DOM.getContentQuads', { backendNodeId }).catch(() => null);
    const quad = q?.quads?.[0];
    signal?.throwIfAborted();
    if (quad) {
      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      signal?.throwIfAborted();
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    } else await callOn(this.cdp, backendNodeId, 'function(){ this.click(); }', [], signal); // no box to click: the element's own click
  }

  /** Replace what the element holds with text, as typing would; submit presses Enter after. Never in a secret field. */
  async type(ref: string, text: string, submit = false, signal?: AbortSignal): Promise<void> {
    const backendNodeId = this.node(ref);
    await checkField(this.cdp, { backendNodeId }, this.secretRefs.has(ref));
    signal?.throwIfAborted();
    await this.cdp.send('DOM.focus', { backendNodeId });
    await callOn(this.cdp, backendNodeId, 'function(){ if (typeof this.select === "function") this.select(); else if (this.isContentEditable) { const r = document.createRange(); r.selectNodeContents(this); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }', [], signal);
    if (text) {
      await checkFocusedField(this.cdp);
      signal?.throwIfAborted();
      await this.cdp.send('Input.insertText', { text });
    } else await this.press('Backspace', signal);
    if (submit) await this.press('Enter', signal);
  }

  /** Pick an option of a select element by its value or its text. */
  async select(ref: string, value: string, signal?: AbortSignal): Promise<void> {
    await checkField(this.cdp, { backendNodeId: this.node(ref) }, this.secretRefs.has(ref));
    const ok = await callOn(this.cdp, this.node(ref), 'function(v){ if (!this.options) return "not a select"; const o = [...this.options].find(o => o.value === v || o.label === v || o.text.trim() === v); if (!o) return "no option " + JSON.stringify(v) + "; options: " + [...this.options].map(o => o.text.trim()).join(", "); this.value = o.value; this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })); return "ok"; }', [value], signal);
    if (ok !== 'ok') throw new Error(String(ok));
  }

  /** A key, or a key with modifiers: "Enter", "Control+a", "Shift+Tab". Keys go to the focused field, so only those
   *  that move on from it (Tab, Shift+Tab, Escape, Enter) go unchecked: any other key, alone or in a chord, could type,
   *  pick, select, copy or cut, and a secret field (or one that cannot be told) refuses it. */
  async press(combo: string, signal?: AbortSignal): Promise<void> {
    const { key, code, vk, text, modifiers, typing, movesOn } = keyOf(combo);
    if (!movesOn) await checkFocusedField(this.cdp);
    signal?.throwIfAborted();
    await this.cdp.send('Input.dispatchKeyEvent', { type: typing ? 'keyDown' : 'rawKeyDown', key: key === 'Space' ? ' ' : key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(typing ? { text, unmodifiedText: text } : {}) });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key === 'Space' ? ' ' : key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  }

  /** Open an address and wait for it to load (or for timeoutMs), and for what its scripts draw first (settled). */
  async navigate(address: string, timeoutMs = 15_000): Promise<{ url: string; error?: string }> {
    const url = webAddress(address);
    const w = this.waiter(timeoutMs);
    const r = await ask(this.cdp, 'Page.navigate', { url }).catch((e: unknown) => { w.done(); throw e; });
    if (r?.errorText) { w.done(); return { url, error: String(r.errorText) }; }
    await w.loaded; await this.settled(); return { url: this.url || url };
  }
  /** Back, forward or reload, as navigate waits for it. */
  async go(to: 'back' | 'forward' | 'reload', timeoutMs = 15_000, signal?: AbortSignal): Promise<{ url: string; moved: boolean }> {
    const w = this.waiter(timeoutMs);
    try {
      if (to === 'reload') { await this.cdp.send('Page.reload'); await w.loaded; await this.settled(); return { url: this.url, moved: true }; }
      const h = await ask(this.cdp, 'Page.getNavigationHistory');
      const e = h.entries[h.currentIndex + (to === 'back' ? -1 : 1)];
      if (!e) return { url: this.url, moved: false };
      signal?.throwIfAborted();
      await this.cdp.send('Page.navigateToHistoryEntry', { entryId: e.id }); await w.loaded; await this.settled();
      return { url: this.url || e.url, moved: true };
    } finally { w.done(); }
  }
  /** Until what a script draws right after an action or a load is there (browser-settle.ts). */
  settled(quietMs?: number, capMs?: number): Promise<void> { return settled(this.cdp, quietMs, capMs); }
  /** Wait for text to be on the page (up to timeoutMs), or for ms. */
  wait(o: { text?: string; ms?: number; timeoutMs?: number }, signal?: AbortSignal): Promise<{ found?: boolean; waited: number }> { return waitFor(this.cdp, o, signal); }

  /** What the page logged, and what failed to load, newest last. */
  console(o: { last?: number; errorsOnly?: boolean } = {}): { messages: LogEntry[]; failures: Failure[] } {
    return this.logged.console(o);
  }
  /** For the window's account: where the page is and how it is doing. */
  async describe(): Promise<Record<string, unknown>> {
    const url = this.url, title = await this.title();
    return { url, title, ...this.logged.counts() };
  }

  private node(ref: string): number {
    const id = this.refs.get(ref);
    if (id === undefined) throw new Error(`no element "${ref}" in the latest snapshot: take a snapshot, then use one of its references`);
    return id;
  }
  /** Do an action (a click, a key), then wait for what it starts: a page that starts loading within `quiet` ms, until
   *  it has loaded (at most ms), and then for what its scripts draw (settled). What the model reads next is then the
   *  page the action led to, not the one before it. */
  async acting<T>(f: () => Promise<T>, ms = 10_000, quiet = 400): Promise<T> {
    this.knownSecret = await this.secretFields(); // before the action: once a send is paused, the page can't be read
    const w = this.waiter(ms);
    try {
      const r = await f();
      // what the action makes the page send may wait for the person: wait for their answer, then for what it led to
      await Promise.race([w.loaded, sleep(quiet).then(async () => { await this.unheld(); if (!w.moving()) w.done(); return w.loaded; })]);
      await this.unheld();
      await this.settled();
      return r;
    } finally { w.done(); }
  }
  /** Until a move's page has loaded: a load counts only once a new page has committed, and a stop only once it has
   *  started, so what is left of an earlier page does not end the wait. One waiter at a time; one that is replaced, or
   *  times out, ends. */
  private waiter(ms: number) {
    let started = false, committed = false, settle!: () => void;
    const loaded = new Promise<void>(r => { settle = r; });
    const mine = (e: Move) => {
      if (e === 'started') started = true;
      else if (e === 'committed') committed = true;
      else if (e === 'done' || (e === 'load' && committed) || (e === 'stopped' && (started || committed))) done();
    };
    const done = () => { clearTimeout(t); if (this.loaded === mine) this.loaded = undefined; settle(); };
    // the time runs only while nothing waits for the person: a move held for their answer is not a page that hangs
    const tick = () => { if (this.holds.size) t = setTimeout(tick, 250); else done(); };
    let t = setTimeout(tick, ms);
    this.loaded?.('done'); this.loaded = mine;
    return { loaded, moving: () => started || committed, done };
  }
  private nav(url: string) { if (url === this.url) return; this.url = url; this.refs.clear(); this.o.onNavigate?.(url); }
}

