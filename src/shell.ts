// The shell: the window a process's views are shown in, as Vindu keeps it for that process. The model composes it
// (show_view places a view, arrange sets the layout), the person changes it (drags a line or a pane, collapses a pane
// into the shelf and opens it again, maximizes), and the window reports its size and how tall each view's content is.
// This holds the one state all of that changes, and gives it out as what a renderer draws (state) and what the model
// reads (account). Pure: no I/O.
//
// The shelf is the bar at the bottom of the window. Every view is in it; a view without a pane is collapsed there, with
// the slot it left (layout.ts): who put it there, and whether it was shown again while there. A collapsed view opens back
// where it was, or where the person drops it. One the person collapsed stays collapsed when the model shows it again:
// its content is updated in the shelf and marked, and the model is told so. A group of panes can be a stack instead:
// one in front, the others tabs above it (layout.ts), by the person's choice, the model's, or for want of room.
import { place, insert, remove, readLayout, shorthand, where, viewsOf, nodeAt, isPane, layoutOptions, openView, slotOf, setStack, setFront, type LayoutNode, type LayoutOptions, type Place, type PlacedPane, type Size, type Slot, type Split } from './layout.js';
import { measuredFromWindow, recordResize, resizeFromWindow, type Measured, type Sight, type WindowChange } from './shell-resize.js';
import { keptFor, RESERVED, ROLES, roleFor, type ViewOwner, type ViewRole } from './shell-roles.js';
import { layoutGeometry } from './layout-geometry.js';
export type { ViewOwner, ViewRole } from './shell-roles.js';
export type { Sight } from './shell-resize.js';

/** What the shell knows of a view: its title, whether it is one page (which takes its pane's whole height), its cards
 *  (panels: their names in words; cards: the same, one by one). kind: a pane the host draws itself (a terminal, a browser
 *  page), with no surfaces of Vindu's. role: whose it is and what the window does with it (shell-roles.ts). */
export type ViewMeta = { title: string; subtitle?: string; fill: boolean; panels: string; cards?: string[]; kind?: string; ask?: boolean; mark?: ViewMark; loading?: boolean; // ask: a question to the person
  masters?: string[]; role?: ViewRole }; // masters: panels other panels follow (detail): a plain click on a row picks it (by panel id and by its components' id)
/** What changed how a view shows what it shows, and who did it, with its undo; or what the model suggests, to take or not. */
export type ViewMark = { text: string; by: 'person' | 'model'; undo?: boolean; suggestion?: boolean };
/** A view collapsed in the shelf: who put it there (the person, the model, or no room for it when another view came),
 *  when (the revision), where it was (its slot), and whether it was shown again while there. */
export type Shelved = { by: 'person' | 'model' | 'room'; at: number; slot?: Slot; updated?: boolean };
/** What a renderer draws: the layout, every view shown (in the order first shown), the shelf, the maximized and focused
 *  panes, the revision (one more on every change, whoever made it), and a layout the model suggested, for the person to take. */
export type ShellState = { tree: LayoutNode | null; views: ShownMeta[]; shelf: Record<string, Shelved>; maximized: string | null; focus: string | null; recent: string[]; options: LayoutOptions;
  rev: number; suggestion: { tree: LayoutNode | null; maximize?: string | null } | null;
  pointing?: { picked: unknown[]; attached: string[] };  // what the person points at, and the panes in the chat
  reminders?: { set: number; due: number } };          // the process's reminders: how many are set, and how many are due now (the bar's chip)
/** A view in the window, as state gives it: its name, what the shell knows of it, and always its role. */
export type ShownMeta = { name: string } & ViewMeta & { role: ViewRole };
/** How far the model arranges the window: it does (allow), it proposes and the person takes it (suggest), or never (off). */
export type ModelArrange = 'allow' | 'suggest' | 'off';
/** What the window reports: its size, what the person did, and how tall each view's content is. */
export type ShellEvent =
  | { type: 'window'; w: number; h: number }
  | { type: 'resize'; path: number[]; sizes: number[] }
  | { type: 'collapse'; view: string }                 // a pane into the shelf ("close" is read the same)
  | { type: 'open'; view: string; place?: Place }      // out of the shelf: where it was, or beside the pane it was dropped on ("show" is read the same)
  | { type: 'move'; view: string; place: Place }       // a pane dragged beside another
  | { type: 'maximize'; view: string | null }
  | { type: 'focus'; view: string }
  | { type: 'take-suggestion' }
  | { type: 'stack'; path: number[] } | { type: 'spread'; path: number[] } | { type: 'front'; path: number[]; index: number } // a split as a stack, or spread out; a tab in front
  | { type: 'view'; view: string; action: string; [k: string]: unknown } // an action inside a view (actions.ts), or its mark's undo, take or dismiss
  | { type: 'measure'; views: Record<string, { content: number; visible: number; sight?: Record<string, Sight> }> }
  // for the UI server, not the layout: a button in an ask's pane, what a view drew, an app's message, what a page sent
  // (task.send, while the person used it), an operation run by the person
  | { type: 'action'; view: string; name?: string; context?: unknown }
  | { type: 'rendered'; view: string; seq?: number; surface: 'wide' | 'compact'; tab?: number; got: { i: number; text: string | null; visible: boolean; frame?: { w: number; h: number; loaded: boolean } }[] }
  | { type: 'app'; view: string; panel: string; resource: string; mount: string; msg: unknown }
  | { type: 'send'; view: string; panel: string; value: unknown }
  | { type: 'report'; view: string; panel: string; report: unknown } // how a page runs in the window: the page itself (page-report.ts)
  | { type: 'read'; view: string; seq?: number; read: Record<string, number> } // how far each panel is read, by pid: for the host, never the model
  | { type: 'operation'; name: string }
  | { type: 'reminders' }                              // the bar's chip: show the Reminders pane
  // what the person points at (pointing.ts): marked things, a pane in the chat, a bar opened, a page's bridge
  | { type: 'select'; by?: string; items: unknown[] }
  | { type: 'attach'; view: string; on: boolean }
  | { type: 'drill'; view: string; panel?: string; pid?: string; row: number }
  | { type: 'page'; kind: 'select' | 'ask'; view: string; panel?: string; items?: unknown; note?: string; prompt?: string };

const ASSUMED: Size = { w: 1280, h: 800 };
const px = (n: number) => Math.round(n).toLocaleString('en-GB');
const quoted = (xs: string[]) => xs.map(v => `"${v}"`).join(', ');
const SIDES = new Set(['left', 'right', 'above', 'below']);
/** A place the window sent: beside a view, on a side, at a share. Anything else is no place. */
const placeIn = (x: unknown): Place | undefined => {
  const p = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  if (typeof p.beside !== 'string') return undefined;
  return { beside: p.beside, ...(typeof p.side === 'string' && SIDES.has(p.side) ? { side: p.side as Place['side'] } : {}), ...(typeof p.size === 'number' && p.size > 0 && p.size < 1 ? { size: p.size } : {}) };
};
const BY = { person: 'the person', model: 'you', room: 'no room: another view took its pane' } as const;
const names = (x: unknown): string[] => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

export class Shell {
  readonly options: LayoutOptions;
  private tree: LayoutNode | null = null;
  private meta = new Map<string, ViewMeta & { role: ViewRole }>();
  private shelf = new Map<string, Shelved>();
  private maximized: string | null = null;
  private focus: string | null = null;
  private window: Size | null = null;
  private recent: string[] = [];   // least recently shown or used first
  private claims = new Map<string, string>(); // names the window keeps for panes of its own before they are shown: what each is
  private changes: WindowChange[] = []; // what changed in the window since the model last read an account
  private elsewhere: string[] = []; // what the person did inside the host's panes (ran a command, opened a page): told once
  private measured = new Map<string, Measured>();
  private onChange?: (s: ShellState) => void;
  private rev = 0;
  private suggestion: ShellState['suggestion'] = null;
  private verified = new Map<string, { v: unknown; at: number }>(); // what the window read back from each view it drew, and when
  private laidAt = 0;              // when the panes last moved or changed size
  readonly arranges: ModelArrange;

  constructor(o: { options?: Partial<LayoutOptions>; onChange?: (s: ShellState) => void; arrange?: ModelArrange } = {}) {
    this.options = layoutOptions(o.options); this.onChange = o.onChange; this.arranges = o.arrange ?? 'allow';
  }

  /** What the person did inside a host's pane, as the host tells it: told once, in the next note or account. It is not
   *  a change to the window, so it never stops the model's arrange. */
  tell(what: string): void { if (what.trim()) this.elsewhere.push(what.trim()); }
  private said: string[] = []; // what the system says to the model, in its own words (a source read again, a receipt): told once
  /** For the next prompt's note, as it is, not as something the person did. */
  say(what: string): void { if (what.trim()) this.said.push(what.trim()); }
  takeSaid(): string[] { return this.said.splice(0); }
  /** What the person did elsewhere and the model has not been told: taken now, for the next prompt's note. */
  takeElsewhere(): string[] { return this.elsewhere.splice(0); }
  /** What the person changed in the window and did elsewhere, taken now: for an account the model reads at once. */
  takePerson(): string[] { return [...this.changes.splice(0).map(c => c.text), ...this.elsewhere.splice(0)]; }
  private changed(kind: string, text: string) { this.changes.push({ kind, text }); }

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
  redrawn(name: string, words?: { title?: string; subtitle?: string }): boolean {
    const m = this.meta.get(name); if (!m) return false;
    if (words?.title) m.title = words.title;
    if (words) { if (words.subtitle) m.subtitle = words.subtitle; else delete m.subtitle; } // its title and subtitle as now drawn
    this.measured.delete(name); this.emit(); return true;
  }

  /** A view was shown. A new one gets a pane (beside the view named in place, into its stack, or half of the largest
   *  pane; stacked with the view used longest ago when there is no room); one in a pane keeps it, unless place moves it;
   *  one in the shelf opens where it was, unless the person put it there: then it stays, marked as updated. Its role is
   *  meta's, or the system's for a name the window keeps, or what the view is (shell-roles.ts). Returns notes for the model. */
  show(name: string, meta: ViewMeta, place?: Place): string[] {
    const parked = this.shelf.get(name), inTree = this.panes().includes(name);
    const filling = this.meta.get(name)?.loading === true;
    if (filling) place = undefined; // a reserved pane keeps the person's current layout
    this.meta.set(name, { ...meta, role: meta.role ?? (this.claims.has(name) ? ROLES.system : roleFor(meta)) }); this.used(name);
    this.measured.delete(name); // new content: its old height says nothing
    const notes: string[] = [];
    if (parked && (parked.by === 'person' || filling)) {
      this.shelf.set(name, { ...parked, updated: true }); this.emit();
      if (filling && parked.by !== 'person') {
        return [`"${name}" was filled in the shelf. Open it to see its contents.`];
      }
      return [`"${name}" is collapsed in the shelf, where the person put it: it is updated there and marked as new. arrange {"open": "${name}"} opens it where it was, or the person does`];
    }
    if (!inTree || place) {
      const r = openView(this.tree, name, this.win(), { place, slot: parked?.slot, recent: this.recent.filter(v => v !== name), options: this.options });
      this.setTree(r.tree, 'room'); notes.push(...r.notes);
      if (r.stackedWith && place?.into) notes.push(`"${name}" is in a stack with "${r.stackedWith}", in front; the person brings either to the front with its tab`);
      if (parked) notes.push(`"${name}" was collapsed in the shelf; it opened ${r.how}`);
      if (this.maximized && this.maximized !== name) notes.push(`"${this.maximized}" is maximized, so "${name}" is behind it until arrange restores the layout (maximize: null) or the person does`);
      this.measured.clear();
    }
    this.emit();
    return notes;
  }

  /** The model sets the layout, collapses views into the shelf or opens them, maximizes a pane or restores the layout,
   *  or points the person to a pane. The person comes first: a change of theirs the model has not read yet stops the
   *  arrange once, and the model gets that change. */
  arrange(a: {
    layout?: unknown; maximize?: string | null; focus?: string; collapse?: unknown; open?: unknown;
    reserve?: { name: string; title: string }[]; release?: string[]; keep?: readonly string[]; // keep: panes to stay in sight (an open ask's)
  }): { refusal?: string; notes: string[]; suggested?: boolean } {
    const notes: string[] = [];
    const reserve = a.reserve ?? [];
    const release = new Set(a.release ?? []);
    const pending = new Map(reserve.map(({ name, title }) => [name, { title, fill: false, panels: '', loading: true, role: RESERVED } satisfies ViewMeta]));
    const moves = a.layout !== undefined || a.maximize !== undefined || names(a.collapse).length > 0 || names(a.open).length > 0 || !!(pending.size || release.size);
    if (this.arranges === 'off') return { refusal: 'the person arranges this window themselves; look tells what is on screen', notes };
    if (this.arranges === 'suggest' && (pending.size || release.size)) {
      return { refusal: 'the person must allow layout changes before you can reserve or release panes', notes };
    }
    const all = [...this.meta.keys()].filter(name => !release.has(name));
    const shown = `views shown: ${all.join(', ') || 'none yet'}`;
    if (!moves && a.focus === undefined) return { refusal: `nothing to arrange: give "layout", "collapse", "open", "maximize" or "focus"; ${shown}`, notes };
    const unseen = this.changes.filter(c => c.kind !== 'window'); // a new size of the window is no change of the person's
    if (unseen.length && moves) {
      this.changes = this.changes.filter(c => c.kind === 'window'); // told now, so the next arrange goes ahead
      return { refusal: `the person changed the window since you last read it (${unseen.map(c => c.text).join('; ')}); nothing was moved: arrange again with their change in mind`, notes };
    }
    if (pending.size !== reserve.length) return { refusal: 'each reservation needs a different name', notes };
    for (const name of pending.keys()) if (this.claimOf(name) !== undefined) return { refusal: `"${name}" is one of the window's own panes (${this.claimOf(name)}); reserve another name`, notes };
    for (const name of pending.keys()) if (this.meta.has(name)) return { refusal: `view "${name}" is already shown or reserved`, notes };
    for (const name of release) if (!this.meta.get(name)?.loading) return { refusal: `view "${name}" is not a reservation`, notes };
    if (all.filter(name => this.meta.get(name)?.loading).length + pending.size > 12) {
      return { refusal: 'at most 12 reservations can wait for content', notes };
    }
    all.push(...pending.keys());
    const collapse = names(a.collapse), open = names(a.open);
    const namesInLayout = new Set(all);
    const unknown = [...collapse, ...open].filter(v => !namesInLayout.has(v));
    if (unknown.length) return { refusal: `no view ${quoted([...new Set(unknown)])} has been shown; ${shown}`, notes };
    let tree = this.tree, layout = a.layout;
    for (const name of release) tree = remove(tree, name);
    if (typeof layout === 'string' && /^\s*[[{]/.test(layout)) { // a layout sent as JSON text: read the JSON
      try { layout = JSON.parse(layout); notes.push('read the layout from a JSON string'); } catch { return { refusal: `the layout is text that is not JSON: send it as JSON itself, e.g. ["a", {"column": ["b", "c"]}]; ${shown}`, notes }; }
    }
    if (layout !== undefined) {
      const r = readLayout(layout, namesInLayout);
      if (r.unknown.length) return { refusal: `no view ${quoted(r.unknown)} has been shown; ${shown}`, notes };
      if (!r.tree) return { refusal: `the layout names no view; ${shown}`, notes };
      tree = r.tree; notes.push(...r.notes);
      const out = all.filter(v => !viewsOf(tree).includes(v));
      if (out.length) notes.push(`left out of the layout, so collapsed in the shelf: ${out.join(', ')} (open brings one back where it was; the person can too)`);
    }
    if (layout === undefined) {
      for (const name of pending.keys()) {
        const placed = openView(tree, name, this.win(), { recent: this.recent, options: this.options });
        tree = placed.tree;
        notes.push(...placed.notes);
      }
    }
    for (const v of collapse) { if (viewsOf(tree).includes(v)) tree = remove(tree, v); else notes.push(`"${v}" is collapsed already`); }
    const shelf = new Map(this.shelf); // what the shelf will be: views leaving now are in it, with the slot they leave
    for (const v of viewsOf(this.tree)) if (!viewsOf(tree).includes(v)) shelf.set(v, { by: 'model', at: this.rev, slot: slotOf(this.tree, v) });
    for (const v of open) {
      if (viewsOf(tree).includes(v)) { notes.push(`"${v}" is open already`); continue; }
      const r = openView(tree, v, this.win(), { slot: shelf.get(v)?.slot, recent: this.recent.filter(x => x !== v), options: this.options });
      tree = r.tree; notes.push(`opened "${v}" ${r.how}`, ...r.notes);
    }
    const inTree = viewsOf(tree);
    if (typeof a.maximize === 'string' && !inTree.includes(a.maximize)) return { refusal: `"${a.maximize}" has no pane to maximize; panes: ${inTree.join(', ')}`, notes };
    if (a.focus !== undefined && !inTree.includes(a.focus)) return { refusal: `"${a.focus}" has no pane to point to; panes: ${inTree.join(', ')}`, notes };
    const maximize = a.maximize !== undefined ? a.maximize : layout !== undefined && this.maximized ? null : undefined; // a new layout is to be seen
    if (maximize === null && a.maximize === undefined) notes.push(`"${this.maximized}" was maximized; the new layout is shown in its place`);
    const over = maximize === undefined ? this.maximized : maximize;
    if (over && open.some(v => v !== over && inTree.includes(v))) notes.push(`"${over}" is maximized, so what opened is behind it until the layout is restored (maximize: null)`);
    const hidden = (a.keep ?? []).filter(v => this.inSight(this.tree, this.maximized, v) && !this.inSight(tree, over, v));
    if (hidden.length) return { refusal: `${quoted(hidden)} must stay in sight while the person is asked: nothing was moved; arrange the other panes around ${hidden.length > 1 ? 'them' : 'it'}`, notes };
    if (this.arranges === 'suggest' && moves) {
      this.suggestion = { tree, ...(maximize !== undefined ? { maximize } : {}) }; this.emit();
      return { notes: [...notes, 'suggested to the person, who takes it or not: nothing moved yet'], suggested: true };
    }
    // All refusal paths above are non-mutating. Publish the whole reservation and layout in one revision.
    for (const name of release) {
      this.meta.delete(name);
      this.shelf.delete(name);
      this.verified.delete(name);
      this.recent = this.recent.filter(view => view !== name);
    }
    for (const [name, meta] of pending) {
      this.meta.set(name, meta);
      this.used(name);
      if (!inTree.includes(name)) this.shelf.set(name, { by: 'model', at: this.rev });
    }
    this.setTree(tree, 'model');
    if (maximize !== undefined) this.maximized = maximize && inTree.includes(maximize) ? maximize : null;
    if (a.focus) { this.focus = a.focus; this.used(a.focus); }
    this.measured.clear(); this.emit();
    return { notes };
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
  private pointing: { picked: unknown[]; attached: string[] } = { picked: [], attached: [] };
  setPicked(picked: unknown[], attached: string[]): void { this.pointing = { picked, attached }; this.emit(); }
  /** The layout as it is now, as arrange would write it: for a template that keeps the person's arrangement. */
  layoutNow(): unknown { return shorthand(this.tree); }

  /** The same placement the renderer computes, without view identifiers or content. */
  layoutGeometry() { return layoutGeometry(this.tree, this.placed(), this.window !== null, this.shelf.size); }

  /** Something the window reports. Anything that does not fit what is shown is ignored (false). */
  event(e: unknown): boolean {
    const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const view = typeof x.view === 'string' ? x.view : undefined;
    const inTree = (v?: string): v is string => !!v && this.panes().includes(v);
    switch (x.type) {
      case 'window': {
        const w = Math.floor(Number(x.w)), h = Math.floor(Number(x.h));
        if (!(w > 0 && h > 0 && w < 1e5 && h < 1e5)) return false;
        const before = this.window ? this.placed().mode : null;
        this.window = { w, h }; this.measured.clear(); this.laidAt = Date.now();
        const after = this.placed().mode;
        if (before && before !== after) this.changed('window', `the window is now ${w} × ${h}: ${after}`);
        return true;
      }
      case 'resize': {
        const resized = resizeFromWindow(this.tree, x);
        if (!resized) return false;
        this.setTree(resized.tree, 'person');
        this.measured.clear();
        recordResize(this.changes, resized.change);
        this.emit();
        return true;
      }
      case 'collapse': case 'close': {
        if (!inTree(view)) return false;
        this.setTree(remove(this.tree, view), 'person');
        this.changed('collapse', `collapsed "${view}" into the shelf`); this.measured.clear(); this.emit(); return true;
      }
      case 'open': case 'show': {
        if (!view || !this.meta.has(view) || this.panes().includes(view)) return false;
        const at = placeIn(x.place); if (at && !inTree(at.beside)) return false;
        const r = openView(this.tree, view, this.win(), { place: at, slot: this.shelf.get(view)?.slot, recent: this.recent.filter(v => v !== view), options: this.options });
        this.setTree(r.tree, 'room'); this.used(view); this.focus = view;
        if (at) this.maximized = null; // dropped beside a pane: to be seen there
        this.changed('open', `opened "${view}" ${r.how}`);
        this.measured.clear(); this.emit(); return true;
      }
      case 'move': {
        const at = placeIn(x.place);
        if (!inTree(view) || !at || at.beside === view || !inTree(at.beside)) return false;
        this.setTree(insert(this.tree, view, this.win(), { place: at, options: this.options }).tree, 'person'); this.used(view); this.focus = view;
        if (this.maximized) this.maximized = null;
        this.changed('move', `moved "${view}" ${at.side === 'above' || at.side === 'below' ? at.side : `to the ${at.side ?? 'right'} of`} "${at.beside}"`);
        this.measured.clear(); this.emit(); return true;
      }
      case 'maximize': {
        if (x.view === null) { if (!this.maximized) return false; this.changed('maximize', `restored the layout ("${this.maximized}" was maximized)`); this.maximized = null; }
        else { if (!inTree(view) || this.maximized === view) return false; this.maximized = view; this.changed('maximize', `maximized "${view}"`); }
        this.laidAt = Date.now(); this.measured.clear(); this.emit(); return true;
      }
      case 'focus': {
        if (!inTree(view) || this.focus === view) return false;
        this.focus = view; this.used(view); this.emit(); return true;
      }
      case 'take-suggestion': {
        const sg = this.suggestion; if (!sg) return false;
        const kept = viewsOf(sg.tree).filter(v => !this.meta.has(v)).reduce((t, v) => remove(t, v), sg.tree); // a view gone since it was suggested stays gone
        this.setTree(kept, 'model'); if (sg.maximize !== undefined) this.maximized = sg.maximize; this.suggestion = null;
        if (this.maximized && !this.panes().includes(this.maximized)) this.maximized = null;
        this.changed('take-suggestion', `took the layout you suggested: ${JSON.stringify(shorthand(this.tree))}`); this.measured.clear(); this.emit(); return true;
      }
      case 'stack': case 'spread': case 'front': { // the person stacks a split, spreads it out, or brings a tab in front
        const path = Array.isArray(x.path) && x.path.every(i => Number.isInteger(i) && i >= 0) ? (x.path as number[]) : null;
        const at = path && nodeAt(this.tree, path); if (!at || isPane(at)) return false;
        const t = x.type === 'front' ? setFront(this.tree, path, Number(x.index)) : setStack(this.tree, path, x.type === 'stack', this.recent);
        if (!t || JSON.stringify(t) === JSON.stringify(this.tree)) return false;
        this.setTree(t, 'person'); this.measured.clear();
        const now = nodeAt(t, path) as Split; const views = viewsOf(now);
        if (x.type === 'front') { const v = viewsOf(now.children[now.front!]); for (const n of v) this.used(n); this.changed('front', `brought ${quoted(v)} to the front of the stack ${views.join(', ')}`); }
        else this.changed(x.type, x.type === 'stack' ? `stacked ${quoted(views)}: one in front, the others as tabs` : `spread ${quoted(views)} out again, side by side as their split says`);
        this.emit(); return true;
      }
      case 'measure': {
        const read = measuredFromWindow(x.views, inTree);
        for (const [v, m] of read) this.measured.set(v, m);
        return read.length > 0;
      }
    }
    return false;
  }

  state(): ShellState {
    return { tree: this.tree, views: [...this.meta].map(([name, m]) => ({ name, ...m })), shelf: Object.fromEntries(this.shelf), maximized: this.maximized, focus: this.focus, recent: [...this.recent], options: this.options,
      rev: this.rev, suggestion: this.suggestion, pointing: this.pointing, ...(this.rem ? { reminders: { ...this.rem } } : {}) };
  }
  private rem: { set: number; due: number } | undefined;
  /** How many reminders are set and due (server.ts keeps them), for the bar's chip. */
  setReminders(x: { set: number; due: number } | undefined): void { if (JSON.stringify(x) === JSON.stringify(this.rem)) return; this.rem = x ? { ...x } : undefined; this.emit(); }

  /** What the model reads: the window, the mode, the layout in the form arrange takes, the panes, the views collapsed in
   *  the shelf, focus, notes, and what the person changed since the last account (each change is told once).
   *  view: a show_view account, centred on that view. full: a look, with titles, cards and measured content. */
  account(o: { view?: string; full?: boolean; notes?: string[]; about?: (view: string) => unknown; sight?: (view: string, s: Record<string, Sight>) => unknown; keep?: boolean; planning?: boolean } = {}): Record<string, unknown> {
    const win = this.win(), p = this.placed();
    const inStack = (x: PlacedPane) => p.stacks.filter(st => st.path.length < x.path.length && st.path.every((v, k) => x.path[k] === v)).at(-1);
    const titleOf = (v: string) => this.meta.get(v)?.title ?? v;
    const pane = (x: PlacedPane, i: number) => {
      const m = this.meta.get(x.view)!;
      const got = o.planning || m.loading ? undefined : this.measured.get(x.view);
      const read = o.planning || m.loading ? undefined : this.verified.get(x.view);
      const loading = m.loading ? { state: 'loading' } : {};
      const st = inStack(x);
      if (x.behind && st) { // a tab behind another in a stack: not drawn, so nothing of it is in sight
        const front = st.tabs[st.front].views, mine = st.tabs.find(t => t.views.includes(x.view))!;
        return { view: x.view, ...loading, ...(o.full ? { title: m.title, ...(m.kind ? { kind: m.kind } : { cards: m.panels }) } : {}),
          at: `behind ${quoted(front.map(titleOf))} in a stack: tab ${mine.index + 1} of ${st.tabs.length}, not drawn until it is in front`, stack: { front: front[0], tabs: st.tabs.map(t => t.views[0]) } };
      }
      // a lone view is as tall as its content and centred: its room is known now, its box once the window has measured it
      // (the title bar is 28 px and the pane has a 1 px border, as the renderer draws it)
      const lone = x.fit && x.box ? (() => { const r = x.box; if (!got) return { room: [r.x, r.y, r.w, r.h] };
        const h = Math.min(r.h, Math.round(28 + got.visible + 2)); return { box: [r.x, Math.round((win.h - h) / 2), r.w, h], room: [r.x, r.y, r.w, r.h] }; })() : null;
      return {
        view: x.view, ...loading,
        ...(o.full ? (m.kind ? { title: m.title, kind: m.kind, ...(o.about?.(x.view) !== undefined ? { about: o.about(x.view) } : {}) } : { title: m.title, cards: m.panels }) : {}),
        at: x.box ? where(x.box, win) : `${i + 1} of ${p.panes.length}, top to bottom`,
        ...(lone ?? (x.box ? { box: [x.box.x, x.box.y, x.box.w, x.box.h] } : { width: win.w })),
        surface: x.compact ? 'compact' : 'wide',
        ...(x.fit ? { height: `as tall as its content, centred, at most ${x.box!.h} px` } : {}),
        ...(o.full && got && p.mode !== 'stacked' ? { content: got.content > got.visible + 1 ? `scrolls: ${px(got.content)} px of content in ${px(got.visible)}` : 'fits' } : {}),
        ...(o.full && got?.sight && p.mode !== 'stacked' && o.sight ? (() => { const v = o.sight(x.view, got.sight); return v === undefined ? {} : { in_sight: v }; })() : {}),
        ...(o.full && read ? { verified: read.at >= this.laidAt ? read.v : { ...(read.v as object), stale: 'read before the panes last moved; the window reads it again' } } : {}),
        ...(st ? { stack: { front: st.tabs[st.front].views[0], tabs: st.tabs.map(t => t.views[0]), ...(st.auto ? { why: 'its panes do not fit side by side, so they are stacked until there is room' } : {}), ...(st.why === 'ask' ? { in_front: 'it asks the person, so it is in front' } : {}) } } : {}),
      };
    };
    const panes = this.panes(), shelved = [...this.meta.keys()].filter(v => !panes.includes(v)).sort((a, b) => (this.shelf.get(a)?.at ?? 0) - (this.shelf.get(b)?.at ?? 0));
    const self = o.view ? p.panes.findIndex(x => x.view === o.view) : -1;
    const mode = {
      empty: 'empty: no views yet',
      single: 'single: one view, in the middle',
      tiled: `tiled: ${p.panes.filter(x => !x.behind).length} panes, 1 px lines between${p.stacks.length ? `; ${p.stacks.length} stack${p.stacks.length === 1 ? '' : 's'}, with ${p.panes.filter(x => x.behind).length} behind as tabs` : ''}`,
      stacked: 'stacked: the window is phone-width, so the panes are one after another, full width',
      maximized: `maximized: "${this.maximized}" fills the window; the other panes are behind it`,
    }[p.mode];
    const notes = [...(o.notes ?? []), ...p.notes];
    const parked = (v: string) => { const s = this.shelf.get(v); return { view: v, title: this.meta.get(v)!.title, ...(this.meta.get(v)?.loading ? { state: 'loading' } : {}), by: BY[s?.by ?? 'model'], ...(s?.updated ? { updated: 'shown again while collapsed: marked as new' } : {}) }; };
    return {
      rev: this.rev,
      window: this.window ? `${win.w} × ${win.h}` : `${win.w} × ${win.h}, assumed: no window has reported its size`,
      mode,
      ...(o.planning ? { geometry: { viewport: this.window ? 'reported' : 'estimated', measurement: 'computed layout; content has not been read back' } } : {}),
      layout: shorthand(this.tree),
      ...(o.view && !o.full
        ? { this: self >= 0 ? pane(p.panes[self], self) : { view: o.view, at: panes.includes(o.view) ? 'behind the maximized pane' : `collapsed in the shelf, by ${BY[this.shelf.get(o.view)?.by ?? 'model']}` } }
        : { panes: p.panes.map(pane) }),
      ...(shelved.length ? { collapsed: o.full ? shelved.map(parked) : shelved } : {}),
      ...(this.focus ? { focus: this.focus } : {}),
      ...(notes.length ? { notes } : {}),
      ...(this.suggestion ? { suggested: `${JSON.stringify(shorthand(this.suggestion.tree))}: waiting for the person` } : {}),
      ...(this.changes.length || this.elsewhere.length ? { person: o.keep ? [...this.pending(), ...this.elsewhere] : this.takePerson() } : {}), // keep: an account no model reads now
    };
  }

  /** What the person changed that the model has not read yet, for the note that goes with the next prompt. */
  pending(): string[] { return this.changes.map(c => c.text); }

  /** The layout changes: views that leave it go to the shelf (by whom, with the slot they leave), views that come in leave it. */
  private setTree(t: LayoutNode | null, by: Shelved['by']) {
    const before = this.tree, now = new Set(viewsOf(t));
    for (const v of viewsOf(before)) if (!now.has(v) && this.meta.has(v)) this.shelf.set(v, { by, at: this.rev, slot: slotOf(before, v) });
    for (const v of now) this.shelf.delete(v);
    this.tree = t; this.laidAt = Date.now();
    if (this.maximized && !now.has(this.maximized)) this.maximized = null;
    if (this.focus && !now.has(this.focus)) this.focus = null;
  }
  private win(): Size { return this.window ?? ASSUMED; }
  private panes(): string[] { return viewsOf(this.tree); }
  /** Whether a view is in sight with this layout: in a pane, not behind a tab in its stack or a maximized pane. */
  private inSight(tree: LayoutNode | null, maximized: string | null, view: string) { return this.placed(tree, maximized).panes.some(p => p.view === view && !p.behind); }
  private placed(tree = this.tree, maximized = this.maximized) { return place(tree, this.win(), { maximized, fill: new Set([...this.meta].filter(([, m]) => m.fill).map(([v]) => v)), options: this.options, asks: this.asking(), recent: this.recent }); }
  /** The panes that ask the person, and each open ask's preview (preview-k3 beside ask-k3): never behind another. */
  private asking() { const asks = new Set([...this.meta].filter(([, m]) => m.ask).map(([v]) => v)); for (const v of this.meta.keys()) { const t = /^preview-(k\d+)$/.exec(v)?.[1]; if (t && asks.has(`ask-${t}`)) asks.add(v); } return asks; }
  private used(v: string) { this.recent = [...this.recent.filter(x => x !== v), v]; }
  private emit() { this.rev++; this.onChange?.(this.state()); }
}
