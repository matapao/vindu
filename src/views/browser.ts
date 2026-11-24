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

import { CONTAINER, SKIP, readAccessibleTree, type Snapshot } from './browser-accessibility.js';
import { checkField, checkFocusedField, fieldPrivacy, secretFieldNames } from './browser-fields.js';
import { READS, outgoing, webAddress, type Outgoing, type Sent } from './browser-requests.js';
import { now, sleep } from './time.js';
export type { PageNode, Snapshot } from './browser-accessibility.js';
export { SECRET_FIELDS, fieldNames, webAddress, type Outgoing, type Sent } from './browser-requests.js';

/** A CDP connection to one page: Electron's webContents.debugger, or a CDP session of any Chromium. */
export type Cdp = { send(method: string, params?: Record<string, unknown>): Promise<any>; on(event: string, fn: (params: any) => void): () => void };
/** An element the person pointed at in a page: its reference in the model's latest snapshot (if it has one there), its
 *  role and name as the accessibility tree says, and whether it is a secret field (its value never goes). */
export type Pointed = { element?: string; role: string; name: string; secret?: boolean; url: string };
export type LogEntry = { at: string; level: string; text: string; source?: string };
export type Failure = { at: string; url: string; method?: string; status?: number; error?: string; type?: string };

const KEYS: Record<string, [string, number, string?]> = { // key: code, Windows key code, text it types
  Enter: ['Enter', 13, '\r'], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46], Space: ['Space', 32, ' '],
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  Home: ['Home', 36], End: ['End', 35], PageUp: ['PageUp', 33], PageDown: ['PageDown', 34],
};
const MODS: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 };
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
  private logs: LogEntry[] = []; private failed: Failure[] = []; private reqs = new Map<string, { url: string; method: string }>();
  private main = ''; private loaded?: (e: Move) => void; private offs: (() => void)[] = [];
  private picking?: (backendNodeId: number | null) => void;

  constructor(readonly id: string, private readonly cdp: Cdp, private readonly o: { onNavigate?: (url: string) => void } = {}) {}

  /** Whether something the page wants to send is waiting for the person. */
  get holding(): boolean { return this.holds.size > 0; }
  /** What the page wanted to send while the model acted, and whether it went; read once. */
  takeHeld(): Sent[] { return this.held.splice(0); }
  /** The names (or ids) of the secret fields on the page now. */
  secretFields(): Promise<string[]> { return secretFieldNames(this.cdp); }
  /** A request paused before it left. The page's own move to another address goes through leave, and anything else
   *  first through reach; then reads go at once, and anything else goes only if the guard lets it. */
  private async paused(p: any): Promise<void> {
    const sharing = this.sharing?.signal;
    const requestId = p.requestId, req = p.request ?? {};
    const go = () => this.cdp.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
    const block = () => this.cdp.send('Fetch.failRequest', { requestId, errorReason: p.resourceType === 'Document' ? 'Aborted' : 'BlockedByClient' }).catch(() => undefined);
    if (typeof req.method !== 'string') { await block(); return; }
    const method = req.method.toUpperCase(), url = String(req.url), kind = String(p.resourceType ?? '');
    if (kind === 'Document' && (!this.main || !p.frameId || p.frameId === this.main)) {
      let may: Promise<boolean> | undefined;
      try { may = this.leave?.(url); } catch { may = Promise.resolve(false); }
      if (may) {
        await this.cdp.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => undefined); // the page stays where it was
        void may.then(yes => { if (yes && !sharing?.aborted) void this.cdp.send('Page.navigate', { url }).catch(() => undefined); }, () => undefined); // there, on a yes
        return;
      }
    } else if (this.reach) {
      let may: Promise<boolean> | boolean | undefined;
      try { may = this.reach(url, kind); } catch { may = false; }
      if (may === false) { await block(); return; }
      if (may) {
        const site = may;
        const reached = (async () => {
          let yes = false;
          try { yes = await site; } catch { yes = false; }
          if (yes && !sharing?.aborted) return true;
          if (!sharing?.aborted) this.keep({ url, method, fields: [], secret: [], kind, sent: false });
          await block();
          return false;
        })();
        this.holds.add(reached);
        let yes = false;
        try { yes = await reached; } finally { this.holds.delete(reached); }
        if (!yes) return; // nothing awaits between here and the guard's hold, so an action waits for both
      }
    }
    if (READS.has(method) || !this.guard) { await go(); return; }
    let decision: Promise<boolean> | undefined;
    let out: Outgoing;
    try {
      out = outgoing(p, this.knownSecret);
      decision = this.guard(out);
    } catch { await block(); return; }
    if (!decision) { await go(); return; }
    const hold = (async () => {
      let yes = false;
      try { yes = await decision; } catch { yes = false; }
      if (sharing?.aborted) { await block(); return; }
      this.keep({ ...out, sent: yes });
      // a no: a page load is called off (the page stays as it was, as when the person stops it); anything else is blocked
      if (yes) await go(); else await block();
    })();
    this.holds.add(hold);
    try { await hold; } finally { this.holds.delete(hold); }
  }
  private keep(sent: Sent) { this.held.push(sent); if (this.held.length > HELD_KEPT) this.held.splice(0, this.held.length - HELD_KEPT); }
  /** Until nothing is held for the person. */
  private async unheld(): Promise<void> { while (this.holds.size) await Promise.all(this.holds); }

  /** Turn on what the page reports: navigations, console and errors, requests. */
  async start(): Promise<this> {
    const on = (e: string, f: (p: any) => void) => this.offs.push(this.cdp.on(e, f));
    // a move ends at the load of the page it commits, or where the frame stops loading (done, or called off); a page
    // restored from the back-forward cache, or a move within the document, fires no load, so it ends there
    on('Page.frameStartedLoading', p => { if (p.frameId === this.main) this.loaded?.('started'); });
    on('Page.frameNavigated', p => { if (!p.frame?.parentId) { this.main = p.frame.id; this.nav(p.frame.url); this.loaded?.(p.type === 'BackForwardCacheRestore' ? 'done' : 'committed'); } });
    on('Page.navigatedWithinDocument', p => { if (!this.main || p.frameId === this.main) { this.nav(p.url); this.loaded?.('done'); } });
    on('Page.loadEventFired', () => { this.loaded?.('load'); });
    on('Page.frameStoppedLoading', p => { if (p.frameId === this.main) this.loaded?.('stopped'); });
    on('Runtime.consoleAPICalled', p => this.log({ at: now(), level: p.type === 'warning' ? 'warn' : String(p.type), text: (p.args ?? []).map((a: any) => a.value ?? a.unserializableValue ?? a.description ?? '').join(' ') }));
    on('Runtime.exceptionThrown', p => this.log({ at: now(), level: 'error', text: String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'an exception') }));
    on('Log.entryAdded', p => this.log({ at: now(), level: String(p.entry?.level ?? 'info'), text: String(p.entry?.text ?? ''), source: p.entry?.source }));
    on('Network.requestWillBeSent', p => { this.reqs.set(p.requestId, { url: p.request?.url, method: p.request?.method }); if (this.reqs.size > 2000) this.reqs.delete(this.reqs.keys().next().value!); });
    on('Network.loadingFinished', p => { this.reqs.delete(p.requestId); }); // each request is kept only until it ends
    on('Network.responseReceived', p => { const s = Number(p.response?.status); if (s >= 400) this.fail({ at: now(), url: p.response.url, status: s, type: p.type, method: this.reqs.get(p.requestId)?.method }); });
    on('Network.loadingFailed', p => { const r = this.reqs.get(p.requestId); this.reqs.delete(p.requestId); if (p.canceled) return; this.fail({ at: now(), url: r?.url ?? '', method: r?.method, error: p.blockedReason ? `blocked: ${p.blockedReason}` : p.errorText, type: p.type }); });
    on('Fetch.requestPaused', p => { void this.paused(p); });
    for (const d of ['Page', 'Runtime', 'Network', 'Log', 'DOM', 'Accessibility']) await this.cdp.send(`${d}.enable`).catch(() => undefined);
    try {
      await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    } catch (cause) {
      this.stop();
      throw new Error('The browser could not enable request checks for this page.', { cause });
    }
    const tree = await this.cdp.send('Page.getFrameTree').catch(() => null);
    if (tree?.frameTree?.frame) { this.main = tree.frameTree.frame.id; this.url = tree.frameTree.frame.url; }
    return this;
  }
  stop(): void { this.shared = false; for (const f of this.offs.splice(0)) f(); }

  async title(): Promise<string> { return String((await this.cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }).catch(() => null))?.result?.value ?? ''); }

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
      off = this.cdp.on('Overlay.inspectNodeRequested', p => finish(Number(p.backendNodeId) || null));
      this.picking = finish;
      const blue = { r: 35, g: 102, b: 196 };
      this.cdp.send('Overlay.setInspectMode', { mode: 'searchForNode', highlightConfig: { showInfo: true, showAccessibilityInfo: true, contentColor: { ...blue, a: 0.16 }, borderColor: { ...blue, a: 0.9 } } }).catch(() => finish(null));
    });
    await this.cdp.send('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} }).catch(() => undefined);
    await this.cdp.send('Overlay.hideHighlight').catch(() => undefined);
    return id ? this.pointed(id) : null;
  }
  /** The person stops pointing (Esc, or the button again). */
  stopPointing(): void { this.picking?.(null); }
  private async pointed(backendNodeId: number): Promise<Pointed> {
    const ax = await this.cdp.send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: true }).catch(() => null);
    const nodes: any[] = ax?.nodes ?? []; const byId = new Map(nodes.map(n => [n.nodeId, n]));
    const refOf = new Map([...this.refs].map(([r, id]) => [id, r]));
    let at = nodes.find(n => n.backendDOMNodeId === backendNodeId) ?? nodes[0];
    let named: any; let element: string | undefined; let secret = await fieldPrivacy(this.cdp, { backendNodeId }) !== 'public';
    for (let n = at; n; n = n.parentId ? byId.get(n.parentId) : undefined) { // the element, then what holds it
      const role = String(n.role?.value ?? '');
      if (!named && !n.ignored && role && !SKIP.has(role) && role !== 'StaticText' && (String(n.name?.value ?? '').trim() || !CONTAINER.has(role))) named = n;
      if (!element && n.backendDOMNodeId && refOf.has(n.backendDOMNodeId)) { element = refOf.get(n.backendDOMNodeId); if (this.secretRefs.has(element!)) secret = true; }
      if (!secret && n.backendDOMNodeId && n.backendDOMNodeId !== backendNodeId) secret = await fieldPrivacy(this.cdp, { backendNodeId: n.backendDOMNodeId }) !== 'public';
      if (named && element) break;
    }
    at = named ?? at;
    return { ...(element ? { element } : {}), role: String(at?.role?.value ?? 'element'), name: String(at?.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), ...(secret ? { secret: true } : {}), url: this.url };
  }

  /** The page as its accessibility tree says it is, with a reference for each element that can be acted on. */
  async snapshot(max = 1500, signal?: AbortSignal): Promise<Snapshot> {
    const { nodes } = await this.cdp.send('Accessibility.getFullAXTree');
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
    const q = await this.cdp.send('DOM.getContentQuads', { backendNodeId }).catch(() => null);
    const quad: number[] | undefined = q?.quads?.[0];
    signal?.throwIfAborted();
    if (quad) {
      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      signal?.throwIfAborted();
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    } else await this.call(backendNodeId, 'function(){ this.click(); }', [], signal); // no box to click: the element's own click
  }

  /** Replace what the element holds with text, as typing would; submit presses Enter after. Never in a secret field. */
  async type(ref: string, text: string, submit = false, signal?: AbortSignal): Promise<void> {
    const backendNodeId = this.node(ref);
    await checkField(this.cdp, { backendNodeId }, this.secretRefs.has(ref));
    signal?.throwIfAborted();
    await this.cdp.send('DOM.focus', { backendNodeId });
    await this.call(backendNodeId, 'function(){ if (typeof this.select === "function") this.select(); else if (this.isContentEditable) { const r = document.createRange(); r.selectNodeContents(this); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }', [], signal);
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
    const ok = await this.call(this.node(ref), 'function(v){ if (!this.options) return "not a select"; const o = [...this.options].find(o => o.value === v || o.label === v || o.text.trim() === v); if (!o) return "no option " + JSON.stringify(v) + "; options: " + [...this.options].map(o => o.text.trim()).join(", "); this.value = o.value; this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })); return "ok"; }', [value], signal);
    if (ok !== 'ok') throw new Error(String(ok));
  }

  /** A key, or a key with modifiers: "Enter", "Control+a", "Shift+Tab". Keys go to the focused field, so only those
   *  that move on from it (Tab, Shift+Tab, Escape, Enter) go unchecked: any other key, alone or in a chord, could type,
   *  pick, select, copy or cut, and a secret field (or one that cannot be told) refuses it. */
  async press(combo: string, signal?: AbortSignal): Promise<void> {
    const parts = combo.split('+'); const key = parts.pop()!; let modifiers = 0;
    for (const m of parts) { if (!Object.hasOwn(MODS, m)) throw new Error(`no modifier "${m}": use Alt, Control, Meta or Shift`); modifiers |= MODS[m]; }
    const k = (Object.hasOwn(KEYS, key) ? KEYS[key] : undefined) ?? (key.length === 1 ? [key.toUpperCase() === key.toLowerCase() ? `Digit${key}` : `Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0), key] as [string, number, string] : undefined);
    if (!k) throw new Error(`no key "${key}": a character, or one of ${Object.keys(KEYS).join(', ')}`);
    const [code, vk, text] = k; const typing = text !== undefined && !(modifiers & (2 | 4));
    const movesOn = (key === 'Tab' && (modifiers === 0 || modifiers === MODS.Shift)) || ((key === 'Escape' || key === 'Enter') && modifiers === 0);
    if (!movesOn) await checkFocusedField(this.cdp);
    signal?.throwIfAborted();
    await this.cdp.send('Input.dispatchKeyEvent', { type: typing ? 'keyDown' : 'rawKeyDown', key: key === 'Space' ? ' ' : key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(typing ? { text, unmodifiedText: text } : {}) });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key === 'Space' ? ' ' : key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  }

  /** Open an address and wait for it to load (or for timeoutMs), and for what its scripts draw first (settled). */
  async navigate(address: string, timeoutMs = 15_000): Promise<{ url: string; error?: string }> {
    const url = webAddress(address);
    const w = this.waiter(timeoutMs);
    const r = await this.cdp.send('Page.navigate', { url }).catch(e => { w.done(); throw e; });
    if (r?.errorText) { w.done(); return { url, error: String(r.errorText) }; }
    await w.loaded; await this.settled(); return { url: this.url || url };
  }
  /** Back, forward or reload, as navigate waits for it. */
  async go(to: 'back' | 'forward' | 'reload', timeoutMs = 15_000, signal?: AbortSignal): Promise<{ url: string; moved: boolean }> {
    const w = this.waiter(timeoutMs);
    try {
      if (to === 'reload') { await this.cdp.send('Page.reload'); await w.loaded; await this.settled(); return { url: this.url, moved: true }; }
      const h = await this.cdp.send('Page.getNavigationHistory') as { currentIndex: number; entries: { id: number; url: string }[] };
      const e = h.entries[h.currentIndex + (to === 'back' ? -1 : 1)];
      if (!e) return { url: this.url, moved: false };
      signal?.throwIfAborted();
      await this.cdp.send('Page.navigateToHistoryEntry', { entryId: e.id }); await w.loaded; await this.settled();
      return { url: this.url || e.url, moved: true };
    } finally { w.done(); }
  }
  /** Until what a script draws right after an action or a load is there: the page's document has had no change for
   *  quietMs, or capMs have passed (a page that keeps changing, an animation or a clock, is read as it is then). The
   *  page only counts its changes; the time is kept here, so a page in a hidden pane, whose timers run late, settles as
   *  soon, and one that is gone or does not answer ends the wait. */
  async settled(quietMs = 200, capMs = 2000): Promise<void> { // quiet long enough that a busy computer's late timers still count
    const end = Date.now() + capMs;
    const within = <T>(sent: Promise<T>) => Promise.race([sent.catch(() => undefined), sleep(Math.max(0, end - Date.now())).then(() => undefined)]);
    const watch = await within(this.cdp.send('Runtime.evaluate', { expression: `(() => { const seen = { changes: 0 };
      seen.observer = new MutationObserver(records => { seen.changes += records.length; });
      seen.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); return seen; })()` }));
    const objectId: string | undefined = watch?.result?.objectId;
    if (!objectId) { await sleep(quietMs); return; } // nothing to watch: the quiet time, as it is
    const changes = async () => (await within(this.cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function() { return this.changes; }', returnByValue: true })))?.result?.value;
    try {
      for (let seen = 0; Date.now() < end;) {
        await sleep(Math.min(quietMs, end - Date.now()));
        const count = await changes();
        if (typeof count !== 'number' || count === seen) return; // quiet, or the page has gone on to another document
        seen = count;
      }
    } finally {
      void this.cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function() { this.observer.disconnect(); }' })
        .catch(() => undefined).then(() => this.cdp.send('Runtime.releaseObject', { objectId })).catch(() => undefined);
    }
  }
  /** Wait for text to be on the page (up to timeoutMs), or for ms. */
  async wait(o: { text?: string; ms?: number; timeoutMs?: number }, signal?: AbortSignal): Promise<{ found?: boolean; waited: number }> {
    const start = Date.now();
    if (o.text === undefined) { const ms = Math.min(o.ms ?? 500, 10_000); await sleep(ms); return { waited: ms }; }
    const end = start + Math.min(o.timeoutMs ?? 10_000, 30_000);
    while (Date.now() < end) {
      signal?.throwIfAborted();
      const r = await this.cdp.send('Runtime.evaluate', { expression: `(document.body ? document.body.innerText : '').includes(${JSON.stringify(o.text)})`, returnByValue: true }).catch(() => null); // searched in the page: only the answer comes back
      if (r?.result?.value === true) return { found: true, waited: Date.now() - start };
      await sleep(150);
    }
    return { found: false, waited: Date.now() - start };
  }

  /** What the page logged, and what failed to load, newest last. */
  console(o: { last?: number; errorsOnly?: boolean } = {}): { messages: LogEntry[]; failures: Failure[] } {
    const n = o.last ?? 50; const msgs = o.errorsOnly ? this.logs.filter(l => l.level === 'error') : this.logs;
    return { messages: msgs.slice(-n), failures: this.failed.slice(-n) };
  }
  /** For the window's account: where the page is and how it is doing. */
  async describe(): Promise<Record<string, unknown>> {
    return { url: this.url, title: await this.title(), errors: this.logs.filter(l => l.level === 'error').length, failed: this.failed.length };
  }

  private node(ref: string): number {
    const id = this.refs.get(ref);
    if (id === undefined) throw new Error(`no element "${ref}" in the latest snapshot: take a snapshot, then use one of its references`);
    return id;
  }
  private async call(backendNodeId: number, fn: string, args: unknown[] = [], signal?: AbortSignal): Promise<unknown> {
    const { object } = await this.cdp.send('DOM.resolveNode', { backendNodeId });
    try {
      signal?.throwIfAborted();
      const r = await this.cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, arguments: args.map(value => ({ value })), returnByValue: true });
      return r?.result?.value;
    } finally {
      await this.cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => undefined);
    }
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
  private log(e: LogEntry) { this.logs.push(e); if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500); }
  private fail(f: Failure) { this.failed.push(f); if (this.failed.length > 500) this.failed.splice(0, this.failed.length - 500); }
}

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
