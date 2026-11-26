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
import { viewsOf, nodeAt, isPane, type Split } from './layout.js';
import { readLayout, shorthand } from './layout-read.js';
import { insert, remove, openView, slotOf, setStack, setFront } from './layout-edit.js';
import { measuredFromWindow, recordResize, resizeFromWindow } from './shell-resize.js';
import { RESERVED } from './shell-roles.js';
import type { ViewMeta } from './shell-types.js';
import { presentationEvent, refusesFullscreen } from './shell-presentation.js';
import { names, placeIn, quoted } from './shell-core.js';
export type { ViewOwner, ViewRole } from './shell-roles.js';
export type { Sight } from './shell-resize.js';
export type { ModelArrange, Shelved, ShellEvent, ShellState, ShownMeta, ViewMeta, ViewMark } from './shell-types.js';
import { ShellAccount } from './shell-account.js';

/** The window as the model composes it and the person changes it: what arrange does, and each event the window reports. */
export class Shell extends ShellAccount {
  /** The model sets the layout, collapses views into the shelf or opens them, maximizes a pane or restores the layout,
   *  or points the person to a pane. The person comes first: a change of theirs the model has not read yet stops the
   *  arrange once, and the model gets that change. */
  arrange(a: {
    layout?: unknown;
    maximize?: string | null;
    focus?: string;
    collapse?: unknown;
    open?: unknown;
    reserve?: { name: string; title: string }[];
    release?: string[];
    keep?: readonly string[]; // keep: panes to stay in sight (an open ask's)
  }): { refusal?: string; notes: string[]; suggested?: boolean } {
    const notes: string[] = [];
    const reserve = a.reserve ?? [];
    const release = new Set(a.release ?? []);
    const pending = new Map(
      reserve.map(({ name, title }) => [
        name,
        { title, fill: false, panels: '', loading: true, role: RESERVED } satisfies ViewMeta,
      ]),
    );
    const moves =
      a.layout !== undefined ||
      a.maximize !== undefined ||
      names(a.collapse).length > 0 ||
      names(a.open).length > 0 ||
      !!(pending.size || release.size);
    if (this.arranges === 'off')
      return { refusal: 'the person arranges this window themselves; look tells what is on screen', notes };
    if (this.arranges === 'suggest' && (pending.size || release.size)) {
      return { refusal: 'the person must allow layout changes before you can reserve or release panes', notes };
    }
    const all = [...this.meta.keys()].filter((name) => !release.has(name));
    const shown = `views shown: ${all.join(', ') || 'none yet'}`;
    if (!moves && a.focus === undefined)
      return {
        refusal: `nothing to arrange: give "layout", "collapse", "open", "maximize" or "focus"; ${shown}`,
        notes,
      };
    const unseen = this.changes.filter((c) => c.kind !== 'window'); // a new size of the window is no change of the person's
    if (unseen.length && moves) {
      this.changes = this.changes.filter((c) => c.kind === 'window'); // told now, so the next arrange goes ahead
      return {
        refusal: `the person changed the window since you last read it (${unseen.map((c) => c.text).join('; ')}); nothing was moved: arrange again with their change in mind`,
        notes,
      };
    }
    if (pending.size !== reserve.length) return { refusal: 'each reservation needs a different name', notes };
    for (const name of pending.keys())
      if (this.claimOf(name) !== undefined)
        return {
          refusal: `"${name}" is one of the window's own panes (${this.claimOf(name)}); reserve another name`,
          notes,
        };
    for (const name of pending.keys())
      if (this.meta.has(name)) return { refusal: `view "${name}" is already shown or reserved`, notes };
    for (const name of release)
      if (!this.meta.get(name)?.loading) return { refusal: `view "${name}" is not a reservation`, notes };
    if (all.filter((name) => this.meta.get(name)?.loading).length + pending.size > 12) {
      return { refusal: 'at most 12 reservations can wait for content', notes };
    }
    all.push(...pending.keys());
    const collapse = names(a.collapse),
      open = names(a.open);
    const namesInLayout = new Set(all);
    const unknown = [...collapse, ...open].filter((v) => !namesInLayout.has(v));
    if (unknown.length) return { refusal: `no view ${quoted([...new Set(unknown)])} has been shown; ${shown}`, notes };
    let tree = this.tree,
      layout = a.layout;
    for (const name of release) tree = remove(tree, name);
    if (typeof layout === 'string' && /^\s*[[{]/.test(layout)) {
      // a layout sent as JSON text: read the JSON
      try {
        layout = JSON.parse(layout);
        notes.push('read the layout from a JSON string');
      } catch {
        return {
          refusal: `the layout is text that is not JSON: send it as JSON itself, e.g. ["a", {"column": ["b", "c"]}]; ${shown}`,
          notes,
        };
      }
    }
    if (layout !== undefined) {
      const r = readLayout(layout, namesInLayout);
      if (r.unknown.length) return { refusal: `no view ${quoted(r.unknown)} has been shown; ${shown}`, notes };
      if (!r.tree) return { refusal: `the layout names no view; ${shown}`, notes };
      tree = r.tree;
      notes.push(...r.notes);
      const out = all.filter((v) => !viewsOf(tree).includes(v));
      if (out.length)
        notes.push(
          `left out of the layout, so collapsed in the shelf: ${out.join(', ')} (open brings one back where it was; the person can too)`,
        );
    }
    if (layout === undefined) {
      for (const name of pending.keys()) {
        const placed = openView(tree, name, this.win(), { recent: this.recent, options: this.options });
        tree = placed.tree;
        notes.push(...placed.notes);
      }
    }
    for (const v of collapse) {
      if (viewsOf(tree).includes(v)) tree = remove(tree, v);
      else notes.push(`"${v}" is collapsed already`);
    }
    const shelf = new Map(this.shelf); // what the shelf will be: views leaving now are in it, with the slot they leave
    for (const v of viewsOf(this.tree))
      if (!viewsOf(tree).includes(v)) shelf.set(v, { by: 'model', at: this.rev, slot: slotOf(this.tree, v) });
    for (const v of open) {
      if (viewsOf(tree).includes(v)) {
        notes.push(`"${v}" is open already`);
        continue;
      }
      const r = openView(tree, v, this.win(), {
        slot: shelf.get(v)?.slot,
        recent: this.recent.filter((x) => x !== v),
        options: this.options,
      });
      tree = r.tree;
      notes.push(`opened "${v}" ${r.how}`, ...r.notes);
    }
    const inTree = viewsOf(tree);
    if (typeof a.maximize === 'string' && !inTree.includes(a.maximize))
      return { refusal: `"${a.maximize}" has no pane to maximize; panes: ${inTree.join(', ')}`, notes };
    if (a.focus !== undefined && !inTree.includes(a.focus))
      return { refusal: `"${a.focus}" has no pane to point to; panes: ${inTree.join(', ')}`, notes };
    let maximize = a.maximize;
    if (maximize === undefined && layout !== undefined && this.maximized) maximize = null; // a new layout is to be seen
    if (maximize === null && a.maximize === undefined)
      notes.push(`"${this.maximized}" was maximized; the new layout is shown in its place`);
    const over = maximize === undefined ? this.maximized : maximize;
    if (over && open.some((v) => v !== over && inTree.includes(v)))
      notes.push(`"${over}" is maximized, so what opened is behind it until the layout is restored (maximize: null)`);
    if (maximize && this.stacks())
      notes.push(
        `the window is phone-width, so its panes are one after another: "${maximize}" fills it once it is wider`,
      );
    const hidden = (a.keep ?? []).filter(
      (v) => this.inSight(this.tree, this.maximized, v) && !this.inSight(tree, over, v),
    );
    if (hidden.length)
      return {
        refusal: `${quoted(hidden)} must stay in sight while the person is asked: nothing was moved; arrange the other panes around ${hidden.length > 1 ? 'them' : 'it'}`,
        notes,
      };
    const small = typeof a.maximize === 'string' ? refusesFullscreen(this.meta.get(a.maximize)) : undefined;
    if (small) return { refusal: `"${a.maximize}" is not maximized: ${small}`, notes };
    if (this.arranges === 'suggest' && moves) {
      this.suggestion = { tree, ...(maximize !== undefined ? { maximize } : {}) };
      this.emit();
      return { notes: [...notes, 'suggested to the person, who takes it or not: nothing moved yet'], suggested: true };
    }
    // All refusal paths above are non-mutating. Publish the whole reservation and layout in one revision.
    for (const name of release) {
      this.meta.delete(name);
      this.shelf.delete(name);
      this.verified.delete(name);
      this.recent = this.recent.filter((view) => view !== name);
    }
    for (const [name, meta] of pending) {
      this.meta.set(name, meta);
      this.used(name);
      if (!inTree.includes(name)) this.shelf.set(name, { by: 'model', at: this.rev });
    }
    this.setTree(tree, 'model');
    if (maximize !== undefined) this.maximized = maximize && inTree.includes(maximize) ? maximize : null;
    const focus = a.focus ?? maximize; // a pane maximized has the focus, unless another is named
    if (focus) {
      this.focus = focus;
      this.used(focus);
    }
    this.measured.clear();
    this.emit();
    return { notes };
  }

  /** Something the window reports. Anything that does not fit what is shown is ignored (false). */
  event(e: unknown): boolean {
    const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const view = typeof x.view === 'string' ? x.view : undefined;
    const inTree = (v?: string): v is string => !!v && this.panes().includes(v);
    switch (x.type) {
      case 'window': {
        const w = Math.floor(Number(x.w)),
          h = Math.floor(Number(x.h));
        if (!(w > 0 && h > 0 && w < 1e5 && h < 1e5)) return false;
        const before = this.window ? this.placed().mode : null;
        this.window = { w, h };
        this.measured.clear();
        this.laidAt = Date.now();
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
      case 'collapse':
      case 'close': {
        if (!inTree(view)) return false;
        this.setTree(remove(this.tree, view), 'person');
        this.changed('collapse', `collapsed "${view}" into the shelf`);
        this.measured.clear();
        this.emit();
        return true;
      }
      case 'open':
      case 'show': {
        if (!view || !this.meta.has(view) || this.panes().includes(view)) return false;
        const at = placeIn(x.place);
        if (at && !inTree(at.beside)) return false;
        const r = openView(this.tree, view, this.win(), {
          place: at,
          slot: this.shelf.get(view)?.slot,
          recent: this.recent.filter((v) => v !== view),
          options: this.options,
        });
        this.setTree(r.tree, 'room');
        this.used(view);
        this.focus = view;
        if (at) this.maximized = null; // dropped beside a pane: to be seen there
        this.changed('open', `opened "${view}" ${r.how}`);
        this.measured.clear();
        this.emit();
        return true;
      }
      case 'move': {
        const at = placeIn(x.place);
        if (!inTree(view) || !at || at.beside === view || !inTree(at.beside)) return false;
        this.setTree(insert(this.tree, view, this.win(), { place: at, options: this.options }).tree, 'person');
        this.used(view);
        this.focus = view;
        if (this.maximized) this.maximized = null;
        this.changed(
          'move',
          `moved "${view}" ${at.side === 'above' || at.side === 'below' ? at.side : `to the ${at.side ?? 'right'} of`} "${at.beside}"`,
        );
        this.measured.clear();
        this.emit();
        return true;
      }
      case 'maximize': {
        // a pane maximized has the focus; a phone-width window stacks its panes and maximizes none
        if (x.view === null) {
          if (!this.maximized) return false;
          this.changed('maximize', `restored the layout ("${this.maximized}" was maximized)`);
          this.maximized = null;
        } else {
          if (!inTree(view) || this.maximized === view || this.stacks() || refusesFullscreen(this.meta.get(view)))
            return false;
          this.maximized = this.focus = view;
          this.used(view);
          this.changed('maximize', `maximized "${view}"`);
        }
        this.laidAt = Date.now();
        this.measured.clear();
        this.emit();
        return true;
      }
      case 'presentation':
      case 'card': {
        // the person's Cards or Content, a card opened alone and the way back from it
        const r = presentationEvent(this.presenting, x, this.shows());
        if (!r) return false;
        this.presenting = r.next;
        this.changed(String(x.type), r.said);
        this.laidAt = Date.now();
        this.emit();
        return true;
      }
      case 'focus': {
        if (!inTree(view) || this.focus === view) return false;
        this.focus = view;
        this.used(view);
        this.emit();
        return true;
      }
      case 'take-suggestion': {
        const sg = this.suggestion;
        if (!sg) return false;
        const kept = viewsOf(sg.tree)
          .filter((v) => !this.meta.has(v))
          .reduce((t, v) => remove(t, v), sg.tree); // a view gone since it was suggested stays gone
        this.setTree(kept, 'model');
        if (sg.maximize !== undefined) this.maximized = sg.maximize;
        this.suggestion = null;
        if (this.maximized && !this.panes().includes(this.maximized)) this.maximized = null;
        if (sg.maximize && this.maximized) {
          this.focus = this.maximized;
          this.used(this.maximized);
        } // maximized, it has the focus
        this.changed('take-suggestion', `took the layout you suggested: ${JSON.stringify(shorthand(this.tree))}`);
        this.measured.clear();
        this.emit();
        return true;
      }
      case 'stack':
      case 'spread':
      case 'front': {
        // the person stacks a split, spreads it out, or brings a tab in front
        const path =
          Array.isArray(x.path) && x.path.every((i) => Number.isInteger(i) && i >= 0) ? (x.path as number[]) : null;
        const at = path && nodeAt(this.tree, path);
        if (!at || isPane(at)) return false;
        const t =
          x.type === 'front'
            ? setFront(this.tree, path, Number(x.index))
            : setStack(this.tree, path, x.type === 'stack', this.recent);
        if (!t || JSON.stringify(t) === JSON.stringify(this.tree)) return false;
        this.setTree(t, 'person');
        this.measured.clear();
        const now = nodeAt(t, path) as Split;
        const views = viewsOf(now);
        if (x.type === 'front') {
          const v = viewsOf(now.children[now.front!]);
          for (const n of v) this.used(n);
          this.changed('front', `brought ${quoted(v)} to the front of the stack ${views.join(', ')}`);
        } else
          this.changed(
            x.type,
            x.type === 'stack'
              ? `stacked ${quoted(views)}: one in front, the others as tabs`
              : `spread ${quoted(views)} out again, side by side as their split says`,
          );
        this.emit();
        return true;
      }
      case 'measure': {
        const read = measuredFromWindow(x.views, inTree);
        for (const [v, m] of read) this.measured.set(v, m);
        return read.length > 0;
      }
    }
    return false;
  }
}
