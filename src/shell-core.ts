// The shell's state (shell.ts): every view and its role, the layout and the shelf, what changed in the window and what
// the person did, and how the views are shown; with the small changes to it, and the helpers the model's side uses.
import { place, viewsOf, layoutOptions, type LayoutNode, type LayoutOptions, type Place, type Size } from './layout.js';
import { readLayout, shorthand } from './layout-read.js';
import { remove, slotOf } from './layout-edit.js';
import type { Measured, WindowChange } from './shell-resize.js';
import { keptFor, type ViewOwner, type ViewRole } from './shell-roles.js';
import { layoutGeometry } from './layout-geometry.js';
import type { ModelArrange, Shelved, ShellState, ShownMeta, ViewMeta, ViewMark } from './shell-types.js';
import { PRESENTATION, showsOf, type ShellPresentation, type Shows } from './shell-presentation.js';

const ASSUMED: Size = { w: 1280, h: 800 };
export const px = (n: number) => Math.round(n).toLocaleString('en-GB');
export const quoted = (xs: string[]) => xs.map(v => `"${v}"`).join(', ');
const SIDES = new Set(['left', 'right', 'above', 'below']);
/** A place the window sent: beside a view, on a side, at a share. Anything else is no place. */
export const placeIn = (x: unknown): Place | undefined => {
  const p = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  if (typeof p.beside !== 'string') return undefined;
  return { beside: p.beside, ...(typeof p.side === 'string' && SIDES.has(p.side) ? { side: p.side as Place['side'] } : {}), ...(typeof p.size === 'number' && p.size > 0 && p.size < 1 ? { size: p.size } : {}) };
};
export const BY = { person: 'the person', model: 'you', room: 'no room: another view took its pane' } as const;
export const names = (x: unknown): string[] => {
  if (typeof x === 'string') return [x];
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];
};

/** The one state of the window, and what changes it a little at a time: its views, their roles and marks, the shelf,
 *  what changed and what the person did, and how the views are shown. The model's side (shell-account.ts, shell.ts)
 *  builds on it. */
export class ShellCore {
  readonly options: LayoutOptions;
  protected tree: LayoutNode | null = null;
  protected meta = new Map<string, ViewMeta & { role: ViewRole }>();
  protected shelf = new Map<string, Shelved>();
  protected maximized: string | null = null;
  protected focus: string | null = null;
  protected window: Size | null = null;
  protected recent: string[] = [];   // least recently shown or used first
  protected claims = new Map<string, string>(); // names the window keeps for panes of its own before they are shown: what each is
  protected changes: WindowChange[] = []; // what changed in the window since the model last read an account
  protected elsewhere: string[] = []; // what the person did inside the host's panes (ran a command, opened a page): told once
  protected measured = new Map<string, Measured>();
  protected onChange?: (s: ShellState) => void;
  protected rev = 0;
  protected suggestion: ShellState['suggestion'] = null;
  protected verified = new Map<string, { v: unknown; at: number }>(); // what the window read back from each view it drew, and when
  protected laidAt = 0;              // when the panes last moved or changed size
  protected presenting: ShellPresentation = { ...PRESENTATION }; // how the views are shown: as cards or as their content
  readonly arranges: ModelArrange;

  constructor(o: { options?: Partial<LayoutOptions>; onChange?: (s: ShellState) => void; arrange?: ModelArrange } = {}) {
    this.options = layoutOptions(o.options); this.onChange = o.onChange; this.arranges = o.arrange ?? 'allow';
  }

  /** What the person did inside a host's pane, as the host tells it: told once, in the next note or account. It is not
   *  a change to the window, so it never stops the model's arrange. */
  tell(what: string): void { if (what.trim()) this.elsewhere.push(what.trim()); }
  protected said: string[] = []; // what the system says to the model, in its own words (a source read again, a receipt): told once
  /** For the next prompt's note, as it is, not as something the person did. */
  say(what: string): void { if (what.trim()) this.said.push(what.trim()); }
  takeSaid(): string[] { return this.said.splice(0); }
  /** What the person did elsewhere and the model has not been told: taken now, for the next prompt's note. */
  takeElsewhere(): string[] { return this.elsewhere.splice(0); }
  /** What the person changed in the window and did elsewhere, taken now: for an account the model reads at once. */
  takePerson(): string[] { return [...this.changes.splice(0).map(c => c.text), ...this.elsewhere.splice(0)]; }
  protected changed(kind: string, text: string) { this.changes.push({ kind, text }); }

  /** A view in the window (in a pane or in the shelf), as state gives it, without building the whole state. */
  viewOf(name: string): ShownMeta | undefined { const m = this.meta.get(name); return m && { name, ...m }; }
  /** Who holds a name: the view shown or reserved under it, or the system, for a pane of its own still to be shown. */
  ownerOf(name: string): ViewOwner | undefined { return this.meta.get(name)?.role.owner ?? (this.claimOf(name) !== undefined ? 'system' : undefined); }
  /** The window keeps a name for a pane of its own (what it is, in words): no one else shows or reserves a view under it. */
  claim(name: string, what: string): void { this.claims.set(name, what); }
  claimOf(name: string): string | undefined { return this.claims.get(name) ?? keptFor(name); }

  /** A view leaves the window for good (an ask once it is answered): no pane, not in the shelf, not the person's change. */
  drop(name: string): void {
    this.claims.delete(name);
    if (!this.meta.has(name)) return;
    this.meta.delete(name); this.setTree(remove(this.tree, name), 'model'); this.shelf.delete(name);
    this.recent = this.recent.filter(v => v !== name);
    if (this.suggestion) this.suggestion = { ...this.suggestion, tree: remove(this.suggestion.tree, name) }; // a layout suggested before keeps none of it
    this.measured.clear(); this.verified.delete(name); this.emit();
  }

  /** What the window read back from a view after drawing it (server.ts compares it with what was sent). */
  setVerified(view: string, v: unknown): void { if (v === undefined) this.verified.delete(view); else this.verified.set(view, { v, at: Date.now() }); }
  verifiedOf(view: string): unknown { return this.verified.get(view)?.v; }
  /** Whether the window has read a view back since its pane last moved or changed size. */
  readSince(view: string): boolean { const r = this.verified.get(view); return !!r && r.at >= this.laidAt; }
  get revision(): number { return this.rev; }
  /** The views that have a pane now, in reading order. */
  get open(): string[] { return this.panes(); }

  /** Mark a view's pane (actions.ts): what changed how it shows, by whom, with an undo; or a suggestion. None: unmarked. */
  mark(name: string, m: ViewMark | undefined): void {
    const v = this.meta.get(name); if (!v) return;
    if (m) v.mark = m; else delete v.mark;
    this.emit();
  }

  /** A view's content drawn again by the system (a read that has changed since, marked): its pane stays as it is, shown
   *  or hidden, and nothing moves. False if it was never shown. */
  redrawn(name: string, words?: Partial<Pick<ViewMeta, 'title' | 'subtitle' | 'summary'>>): boolean {
    const m = this.meta.get(name); if (!m) return false;
    if (words?.title) m.title = words.title;
    if (words?.summary) m.summary = words.summary; // what its card says, as now drawn
    if (words) { if (words.subtitle) m.subtitle = words.subtitle; else delete m.subtitle; } // its title and subtitle as now drawn
    this.measured.delete(name); this.emit(); return true;
  }

  /** The host lays the window out (a template's slots, a layout the person saved): not the model's arrange, so neither
   *  its switch nor the person's unread changes stop it. Views it leaves out go to the shelf. */
  setLayout(layout: unknown): string[] {
    const r = readLayout(layout, new Set(this.meta.keys()));
    if (!r.tree) return [`the layout names no view shown: ${[...this.meta.keys()].join(', ') || 'none'}`];
    this.setTree(r.tree, 'model'); this.maximized = null; this.measured.clear(); this.emit();
    return [...r.notes, ...(r.unknown.length ? [`not shown yet, so left out: ${r.unknown.join(', ')}`] : [])];
  }
  /** Recover the person's arrangement without recording another user action. Only panes reopened by the host participate. */
  restoreLayout(layout: unknown, state: Pick<ShellState, 'shelf' | 'recent' | 'focus' | 'maximized'>) {
    const { tree } = readLayout(layout, new Set(this.meta.keys()));
    this.setTree(tree, 'model');
    const visible = new Set(this.panes());
    for (const [name, slot] of Object.entries(state.shelf)) {
      if (this.meta.has(name) && !visible.has(name)) {
        this.shelf.set(name, slot);
        this.rev = Math.max(this.rev, slot.at);
      }
    }
    this.recent = state.recent.filter(name => this.meta.has(name));
    this.focus = state.focus && visible.has(state.focus) ? state.focus : null;
    this.maximized = state.maximized && visible.has(state.maximized) ? state.maximized : null;
    this.changes.length = 0;
    this.emit();
  }
  /** What the person points at and which panes are in the chat: in the state, so every window marks the same. */
  protected pointing: { picked: unknown[]; attached: string[] } = { picked: [], attached: [] };
  setPicked(picked: unknown[], attached: string[]): void { this.pointing = { picked, attached }; this.emit(); }
  /** The layout as it is now, as arrange would write it: for a template that keeps the person's arrangement. */
  layoutNow(): unknown { return shorthand(this.tree); }

  /** The same placement the renderer computes, without view identifiers or content. */
  layoutGeometry() { return layoutGeometry(this.tree, this.placed(), this.window !== null, this.shelf.size); }

  /** How the host would have the views shown, and whether the window is narrow: what is not given stays as it was. */
  setPresentation(p: Partial<Pick<ShellPresentation, 'as' | 'narrow'>>): void {
    const next = { ...this.presenting, ...p, alone: p.as && p.as !== this.presenting.as ? null : this.presenting.alone };
    if (JSON.stringify(next) !== JSON.stringify(this.presenting)) { this.presenting = next; this.emit(); }
  }
  /** What is drawn now: which views are cards, which are whole, and the one opened alone. */
  shows(): Shows { return showsOf([...this.meta].map(([name, m]) => ({ name, ...m })), this.panes(), this.presenting, this.stacks()); }

  state(): ShellState {
    return { tree: this.tree, views: [...this.meta].map(([name, m]) => ({ name, ...m })), shelf: Object.fromEntries(this.shelf), maximized: this.maximized, focus: this.focus, recent: [...this.recent], options: this.options,
      rev: this.rev, suggestion: this.suggestion, pointing: this.pointing, ...(this.rem ? { reminders: { ...this.rem } } : {}), presentation: { ...this.presenting } };
  }
  protected rem: { set: number; due: number } | undefined;
  /** How many reminders are set and due (server.ts keeps them), for the bar's chip. */
  setReminders(x: { set: number; due: number } | undefined): void { if (JSON.stringify(x) === JSON.stringify(this.rem)) return; this.rem = x ? { ...x } : undefined; this.emit(); }

  /** What the person changed that the model has not read yet, for the note that goes with the next prompt. */
  pending(): string[] { return this.changes.map(c => c.text); }

  /** The layout changes: views that leave it go to the shelf (by whom, with the slot they leave), views that come in leave it. */
  protected setTree(t: LayoutNode | null, by: Shelved['by']) {
    const before = this.tree, now = new Set(viewsOf(t));
    for (const v of viewsOf(before)) if (!now.has(v) && this.meta.has(v)) this.shelf.set(v, { by, at: this.rev, slot: slotOf(before, v) });
    for (const v of now) this.shelf.delete(v);
    this.tree = t; this.laidAt = Date.now();
    if (this.maximized && !now.has(this.maximized)) this.maximized = null;
    if (this.focus && !now.has(this.focus)) this.focus = null;
  }
  protected win(): Size { return this.window ?? ASSUMED; }
  protected stacks(): boolean { return this.win().w < this.options.phone; } // phone-width: panes one after another, none maximized
  protected panes(): string[] { return viewsOf(this.tree); }
  /** Whether a view is in sight with this layout: in a pane, not behind a tab in its stack or a maximized pane. */
  protected inSight(tree: LayoutNode | null, maximized: string | null, view: string) { return this.placed(tree, maximized).panes.some(p => p.view === view && !p.behind); }
  protected placed(tree = this.tree, maximized = this.maximized) { return place(tree, this.win(), { maximized, fill: new Set([...this.meta].filter(([, m]) => m.fill).map(([v]) => v)), options: this.options, asks: this.asking(), recent: this.recent }); }
  /** The panes that ask the person, and each open ask's preview (preview-k3 beside ask-k3): never behind another. */
  protected asking() { const asks = new Set([...this.meta].filter(([, m]) => m.ask).map(([v]) => v)); for (const v of this.meta.keys()) { const t = /^preview-(k\d+)$/.exec(v)?.[1]; if (t && asks.has(`ask-${t}`)) asks.add(v); } return asks; }
  protected used(v: string) { this.recent = [...this.recent.filter(x => x !== v), v]; }
  protected emit() { this.rev++; this.onChange?.(this.state()); }
}
