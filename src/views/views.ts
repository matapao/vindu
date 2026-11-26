// Terminals and browser pages as views of the ui server, next to cards and pages: the same panes, the same layout, the
// same look. The person opens them from the window; the model opens a browser view with show_view, reads any view with
// read_view and acts in one with act_in_view. It reads them as JSON, never as pictures, and only what the person shares:
//   - a terminal is the person's: their own shell in the process's folder (terminal.ts). The model reads it once they
//     share it, and runs a command there only where the host allows that, each after the person's yes;
//   - a browser view the model opened is its own; one the person opened is theirs until they share it. Pages run in the
//     app, outside the processor's sandbox, so the model opens this machine's addresses freely and any other site only on
//     the person's yes, once per site; and what a page of its own reaches for on another site (a frame, a script, an
//     image, a fetch) waits for the same yes (sites.ts).
// What the model reads or does here goes to the host (record), which keeps it with the process's results.
import path from 'node:path';
import { cutText } from '../format.js';
import { Terminals, type TerminalInfo } from './terminal.js';
import { webAddress, type BrowserPage, type Outgoing } from './browser.js';
import { Browsers } from './browsers.js';
import { isLocal, Sites } from './sites.js';
import { actInPage, runInTerminal, told, type ActArgs, type ReadArgs } from './view-acts.js';
export { BROWSER_ACTIONS, type ActArgs, type ReadArgs } from './view-acts.js';
export { isLocal } from './sites.js';
import type { ViewHost, ViewsSetup } from './view-setup.js';
export type { BrowserSetup, TerminalSetup, ViewHost, ViewsSetup } from './view-setup.js';

const DRIVEN_MS = 3000; // a page the model acted on in the last 3 s: what it opens next is the model's doing

export class Views {
  readonly terminals?: Terminals;
  readonly browsers?: Browsers;
  private readonly sites: Sites;                         // other sites the person let the model's pages reach, this process
  private readonly hushed = new WeakSet<BrowserPage>();  // pages the person refused a site to, until the model acts in them again
  private readonly titles = new Map<string, string>();   // each view's title, as its pane shows it
  private readonly driven = new WeakMap<BrowserPage, { until: number; sharing: AbortSignal }>();
  private readonly placing = new Map<string, unknown>();  // where the model asked a page of its own to go
  private readonly notes = new Map<string, string[]>();   // what the layout said when a page's pane came
  private pages = 0;

  constructor(readonly setup: ViewsSetup, private readonly h: ViewHost) {
    this.sites = new Sites(setup.browser?.local ?? isLocal, (q, signal) => h.confirm(q, signal), e => h.log(e));
    if (setup.terminal !== false) {
      const t = setup.terminal ?? {};
      const terminals = new Terminals({ dir: path.join(h.dir, 'terminals'), env: t.env, shell: t.shell, login: t.login, onExit: t.onExit, ...(t.spawn ? { spawn: t.spawn } : {}),
        onCommand: (id, c) => { const i = terminals.info(id); if (i.shared && c.by !== 'model') h.tell(`ran \`${c.command}\` in ${i.title}${c.exit === null ? '' : ` (exit ${c.exit})`}`); } }); // the model's own it knows
      this.terminals = terminals;
    }
    if (setup.browser) this.browsers = new Browsers(async ({ id, owner }) => {
      const cdp = await setup.browser!.open({ name: id, owner });
      if (this.browsers!.closed) { setup.browser!.close?.(id); throw new Error('the window has closed'); }
      const title = this.titles.get(id) ?? `Browser ${++this.pages}`; this.titles.set(id, title);
      const notes = h.pane({ name: id, title, kind: 'browser', place: this.placing.get(id), about: () => this.about(id) }); // the pane shows as soon as the page does
      this.placing.delete(id); if (notes.length) this.notes.set(id, notes);
      return cdp;
    }, page => {
      page.guard = o => this.hold(page, o);
      // where a page goes: a web address only; another site of the model's waits for the person's yes
      page.leave = url => {
        if (!/^(https?:|about:blank)/i.test(url)) return Promise.resolve(false);
        const may = this.needsAsk(page.id, url) ? this.reached(page, url, 'Document', true) : undefined;
        return may === false ? Promise.resolve(false) : may;
      };
      // what a page of the model's own reaches for, in any frame: this machine, the sites allowed, or the person's yes
      if (page.owner === 'model') page.reach = (url, kind) => this.reached(page, url, kind, false);
    }, id => {
      setup.browser?.close?.(id);
      this.titles.delete(id); this.notes.delete(id); h.unpane(id);
    });
  }

  /** Nothing leaves unasked: while the model acts in a page (and just after), what the page wants to send that is not a
   *  plain read waits for the person's yes. What the person does in a page on their own is never held. */
  private hold(page: BrowserPage, o: Outgoing): Promise<boolean> | undefined {
    const drive = this.driven.get(page);
    if (!drive || drive.until <= Date.now()) return undefined;
    if (drive.sharing.aborted) return Promise.resolve(false);
    const name = page.id;
    let host = o.url; try { host = new URL(o.url).host; } catch { /* as it is */ }
    const fields = o.fields.map(f => (o.secret.includes(f) ? `${f} (secret: the model never sees it)` : f)).join(', ') || 'no fields it names';
    return (async () => {
      const yes = await this.h.confirm({ title: `Let the page send this to ${host}?`,
        message: `The model acted in ${this.title(name)}, and the page wants to send what it holds. Nothing goes until you say yes; a yes is for this once.`,
        details: [{ label: 'to', text: `${o.method} ${o.url}` }, { label: 'fields', text: fields }] }, drive.sharing) && !drive.sharing.aborted;
      this.h.log({ view: name, send: o.url, method: o.method, fields: o.fields, secret: o.secret, asked: true, yes });
      return yes;
    })();
  }

  /** What kind of view a name is, if it is a terminal or a page. */
  kindOf(name: string): 'terminal' | 'browser' | undefined {
    if (this.terminals?.has(name)) return 'terminal';
    if (this.browsers?.has(name)) return 'browser';
    return undefined;
  }

  // ── the person's side ─────────────────────────────────────────────────────────────────────────────────────────
  /** A terminal the person opens: their own shell, in the process's folder, not shared until they share it; or a
   *  program of theirs to run there (run, with its title): a harness's own sign-in, which the model never sees. */
  openTerminal(o: { cols?: number; rows?: number; title?: string; run?: { command: string; args: string[]; env?: Record<string, string> } } = {}): TerminalInfo {
    if (!this.terminals) throw new Error('this window has no terminals');
    const i = this.terminals.create({ cwd: this.h.cwd, ...o });
    this.titles.set(i.id, i.title);
    this.h.pane({ name: i.id, title: i.title, subtitle: path.basename(this.h.cwd), kind: 'terminal', about: () => this.about(i.id) });
    this.h.log({ view: i.id, opened: 'terminal', by: 'the person' });
    return i;
  }
  /** A page the person opens: theirs, with their sign-ins, not shared until they share it. */
  async openPage(url?: string): Promise<string> {
    if (!this.browsers) throw new Error('this window shows no browser pages');
    const p = await this.browsers.create(url, { owner: 'person' });
    this.h.log({ view: p.id, opened: 'browser', by: 'the person' });
    return p.id;
  }
  /** A page once it can be used: one still opening is waited for. */
  page(name: string): Promise<BrowserPage> { if (!this.browsers) throw new Error('this window shows no browser pages'); return this.browsers.ready(name); }
  /** The person points at an element of a page: the next click picks it, without reaching the page. */
  async pointAt(name: string, ms?: number): Promise<{ view: string; element?: string; role: string; name: string; secret?: boolean; url: string; shared: boolean } | null> {
    if (!this.browsers?.has(name)) throw new Error(`no page "${name}"`);
    const p = await this.browsers.ready(name);
    const it = await p.pointAt(ms);
    if (!it) return null;
    this.h.log({ view: name, pointed: { role: it.role, element: it.element ?? null }, by: 'the person' });
    return { view: name, ...it, shared: p.shared };
  }
  stopPointing(name: string): void { try { this.browsers?.get(name).stopPointing(); } catch { /* no such page */ } }
  /** Which command printed these lines of a terminal, if one did: its number and what was run. */
  commandOf(name: string, text: string): { n: number; command: string } | undefined {
    if (!this.terminals?.has(name)) return undefined;
    const first = text.split(/\r?\n/).map(l => l.trim()).find(Boolean); if (!first) return undefined;
    const c = [...this.terminals.commands(name)].reverse().find(x => x.output.includes(first) || x.command.includes(first));
    return c ? { n: c.n, command: c.command } : undefined;
  }
  /** The person shares a terminal or a page with the model, or stops: logged, and told to the model once. */
  async share(name: string, on: boolean): Promise<boolean> {
    const kind = this.kindOf(name);
    if (kind === 'terminal') this.terminals!.share(name, on);
    else if (kind === 'browser') (await this.browsers!.ready(name)).shared = on;
    else throw new Error(`no terminal or page "${name}"`);
    this.h.log({ view: name, shared: on, by: 'the person' });
    this.h.tell(on ? `shared ${this.title(name)} with you` : `stopped sharing ${this.title(name)} with you`);
    return on;
  }
  /** The person ends a view: the terminal's shell, or the page. */
  async end(name: string): Promise<void> {
    if (this.terminals?.has(name)) this.terminals.close(name);
    else if (this.browsers?.has(name)) { await this.browsers.ready(name).catch(() => undefined); this.browsers.remove(name); this.setup.browser?.close?.(name); }
    else return;
    this.titles.delete(name); this.notes.delete(name); this.h.unpane(name);
    this.h.log({ view: name, ended: true, by: 'the person' });
  }

  // ── other sites ───────────────────────────────────────────────────────────────────────────────────────────────
  /** Whether an address opens without asking: this machine's, or a site the person allowed in this process. */
  allowedNow(url: string): boolean { return this.sites.allowedNow(url); }
  /** Whether the host must stop a page's navigation and ask: a page of the model's, or one it acted on just now. */
  needsAsk(name: string, url: string): boolean {
    if (this.allowedNow(url)) return false;
    const p = this.browsers?.has(name) ? this.peek(name) : undefined;
    return !!p && (p.owner === 'model' || (this.driven.get(p)?.until ?? 0) > Date.now());
  }
  /** Ask the person, once per site, before the model's page opens an address on another site. */
  allow(url: string, signal?: AbortSignal): Promise<boolean> { return this.sites.allow(url, this.opening(url), signal); }
  private opening(url: string) {
    const u = new URL(url);
    return { title: `Let the model open ${u.host}?`,
      message: 'The model wants a page on another site. Pages run in this app, outside the harness\'s sandbox, so what the address holds goes to that site. A yes holds for this site until the task ends.',
      details: [{ label: 'address', text: u.href }] };
  }
  /** What a page reaches for by itself (moves, when moving): asked once per site, and nothing more of a page the person
   *  refused a site to, until the model acts in it again. */
  private reached(page: BrowserPage, url: string, kind: string, moving: boolean): Promise<boolean> | false | undefined {
    const sharing = page.shared ? page.whileShared() : undefined;
    const question = () => {
      if (this.hushed.has(page)) return undefined;
      if (moving) return this.opening(url);
      return { title: `Let the model's page reach ${new URL(url).host}?`,
        message: `${this.title(page.id)}, a page of the model's, wants something from another site (${kind.toLowerCase() || 'a request'}). Pages run in this app, outside the harness's sandbox, so what the address holds goes to that site. A yes holds for this site until the task ends; after a no, the page asks nothing more until the model acts in it again.`,
        details: [{ label: 'address', text: cutText(url, 2000) }, { label: 'page', text: page.url }] };
    };
    const may = this.sites.reach(url, sharing && !this.hushed.has(page) ? { question, signal: sharing } : undefined);
    if (may) void may.then(yes => { if (!yes && !sharing?.aborted) this.hushed.add(page); });
    return may;
  }

  // ── the model's side ──────────────────────────────────────────────────────────────────────────────────────────
  /** What look says of a view: what it is, and only that it is not shared when it is not. */
  async about(name: string): Promise<unknown> {
    if (this.terminals?.has(name)) {
      const i = this.terminals.info(name);
      return i.shared ? { shared: true, cwd: i.cwd, running: i.running, busy: i.busy, ...(i.last ? { last: i.last } : {}) } : { shared: false };
    }
    const p = await this.browsers?.ready(name);
    if (!p) return undefined;
    if (!p.shared) return { shared: false, owner: p.owner };
    const sharing = p.whileShared();
    const details = await p.describe();
    return sharing.aborted ? { shared: false, owner: p.owner } : { shared: true, owner: p.owner, ...details };
  }
  /** show_view with a web address: a page of the model's own, in a pane placed like any view's, or the same view
   *  again at a new address (its pane back if the person hid it, or moved where asked). */
  async show(name: string, title: string, url: string, o: { place?: unknown; signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
    if (!this.browsers) throw new Error('this window shows no browser pages');
    const addr = webAddress(url);
    const declined = { view: name, opened: false, declined: `the person did not let the model open ${new URL(addr).host}` };
    if (this.browsers.has(name)) { // shown again: the same page, at the new address
      const p = await this.usable(name);
      const sharing = p.whileShared();
      const signal = o.signal ? AbortSignal.any([sharing, o.signal]) : sharing;
      if (!(await this.allow(addr, signal))) return declined;
      signal.throwIfAborted();
      this.hushed.delete(p); // the model acts in it again
      await p.navigate(addr);
      signal.throwIfAborted();
      this.titles.set(name, title);
      const notes = this.h.pane({ name, title, kind: 'browser', place: o.place, about: () => this.about(name) });
      return { view: name, kind: 'browser', owner: p.owner, snapshot: await this.snap(p, signal), ...(notes.length ? { notes } : {}) };
    }
    if (!(await this.allow(addr, o.signal))) return declined;
    this.titles.set(name, title); if (o.place !== undefined) this.placing.set(name, o.place);
    const p = await this.browsers.create(addr, { owner: 'model', id: name }).finally(() => this.placing.delete(name));
    this.h.log({ view: name, opened: 'browser', by: 'the model', address: addr });
    const notes = this.notes.get(name) ?? []; this.notes.delete(name);
    return { view: name, kind: 'browser', owner: 'model', snapshot: await this.snap(p), ...(notes.length ? { notes } : {}) };
  }
  /** read_view, for a terminal or a page. */
  async read(name: string, a: ReadArgs = {}): Promise<Record<string, unknown>> {
    if (this.kindOf(name) === 'terminal') {
      const i = this.shared(name); const max = a.max ?? 20_000;
      const commands = this.terminals!.commands(name, a.last ?? 5).map(c => ({ ...c, output: cutText(c.output, max) }));
      return { view: name, kind: 'terminal', title: i.title, cwd: i.cwd, running: i.running, busy: i.busy, commands,
        ...(a.screen ? { screen: this.terminals!.screen(name) } : {}),
        ...(i.marks ? {} : { note: 'this shell writes no marks, so commands are not told apart: read the screen' }) };
    }
    const p = await this.usable(name);
    return { view: name, kind: 'browser', owner: p.owner, snapshot: await this.snap(p), ...(a.log ? { log: p.console({ last: a.last, errorsOnly: a.errors_only }) } : {}) };
  }
  /** act_in_view: run a command in a terminal; or act in a page, by reference from its latest snapshot. */
  async act(name: string, a: ActArgs, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (this.kindOf(name) === 'terminal') return runInTerminal(this.terminals!, this.setup, this.h, name, a, signal);
    const p = await this.usable(name);
    const sharing = p.whileShared();
    const active = signal ? AbortSignal.any([sharing, signal]) : sharing;
    active.throwIfAborted();
    const drive = { until: Number.POSITIVE_INFINITY, sharing };
    this.driven.set(p, drive); // what the page opens while the model acts is the model's doing
    this.hushed.delete(p);     // and what it reaches for may be asked about again
    try {
      const said = await actInPage(p, name, a, active, { allow: (url, on) => this.allow(url, on), snap: on => this.snap(p, on) });
      if (said) return said;
      active.throwIfAborted(); // each action waited for what a script draws right after (BrowserPage.settled)
      const sent = p.takeHeld();
      return { view: name, did: a.action, ...(sent.length ? { sent: sent.map(told) } : {}), snapshot: await this.snap(p, active) };
    } finally { drive.until = Date.now() + DRIVEN_MS; }
  }

  close(): void {
    this.terminals?.closeAll();
    for (const id of this.browsers?.closeAll() ?? []) this.setup.browser?.close?.(id);
  }

  private title(name: string): string { return this.titles.get(name) ?? name; }
  private shared(name: string): TerminalInfo {
    const i = this.terminals!.info(name);
    if (!i.shared) throw new Error(`the person has not shared ${i.title} with you; they can, from its pane`);
    return i;
  }
  private async usable(name: string): Promise<BrowserPage> {
    if (!this.browsers?.has(name)) throw new Error(`no terminal or page "${name}"`);
    const p = await this.browsers.ready(name);
    if (!p.shared) throw new Error(`the person has not shared ${this.title(name)} with you; they can, from its pane`);
    return p;
  }
  private peek(name: string): BrowserPage | undefined { try { return this.browsers!.get(name); } catch { return undefined; } }
  private async snap(p: BrowserPage, sharing = p.whileShared()) {
    sharing.throwIfAborted();
    const { page: _page, ...snapshot } = await p.snapshot(undefined, sharing);
    sharing.throwIfAborted();
    return snapshot;
  }
}
