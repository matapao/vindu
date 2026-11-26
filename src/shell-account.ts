// What the model is told of the window (shell.ts): a view shown, placed by the layout code the window draws with, and
// the account of every pane, the shelf and what changed since it last read one.
import { ShellCore } from './shell-core.js';
import { BY, px, quoted } from './shell-core.js';
import { where, type Place, type PlacedPane } from './layout.js';
import { roleFor, ROLES } from './shell-roles.js';
import type { Sight } from './shell-resize.js';
import type { ViewMeta } from './shell-types.js';
import { openView } from './layout-edit.js';
import { presentationAccount } from './shell-presentation.js';
import { shorthand } from './layout-read.js';

export class ShellAccount extends ShellCore {
  /** A view was shown. A new one gets a pane (beside the view named in place, into its stack, or half of the largest
   *  pane; stacked with the view used longest ago when there is no room); one in a pane keeps it, unless place moves it;
   *  one in the shelf opens where it was, unless the person put it there: then it stays, marked as updated. Its role is
   *  meta's, or the system's for a name the window keeps, or what the view is (shell-roles.ts). Returns notes for the model. */
  show(name: string, meta: ViewMeta, place?: Place): string[] {
    const parked = this.shelf.get(name),
      inTree = this.panes().includes(name);
    const filling = this.meta.get(name)?.loading === true;
    if (filling) place = undefined; // a reserved pane keeps the person's current layout
    this.meta.set(name, { ...meta, role: meta.role ?? (this.claims.has(name) ? ROLES.system : roleFor(meta)) });
    this.used(name);
    this.measured.delete(name); // new content: its old height says nothing
    const notes: string[] = [];
    if (parked && (parked.by === 'person' || filling)) {
      this.shelf.set(name, { ...parked, updated: true });
      this.emit();
      if (filling && parked.by !== 'person') {
        return [`"${name}" was filled in the shelf. Open it to see its contents.`];
      }
      return [
        `"${name}" is collapsed in the shelf, where the person put it: it is updated there and marked as new. arrange {"open": "${name}"} opens it where it was, or the person does`,
      ];
    }
    if (!inTree || place) {
      const r = openView(this.tree, name, this.win(), {
        place,
        slot: parked?.slot,
        recent: this.recent.filter((v) => v !== name),
        options: this.options,
      });
      this.setTree(r.tree, 'room');
      notes.push(...r.notes);
      if (r.stackedWith && place?.into)
        notes.push(
          `"${name}" is in a stack with "${r.stackedWith}", in front; the person brings either to the front with its tab`,
        );
      if (parked) notes.push(`"${name}" was collapsed in the shelf; it opened ${r.how}`);
      if (this.maximized && this.maximized !== name)
        notes.push(
          `"${this.maximized}" is maximized, so "${name}" is behind it until arrange restores the layout (maximize: null) or the person does`,
        );
      this.measured.clear();
    }
    this.emit();
    return notes;
  }

  /** What the model reads: the window, the mode, the layout in the form arrange takes, the panes, the views collapsed in
   *  the shelf, focus, notes, and what the person changed since the last account (each change is told once).
   *  view: a show_view account, centred on that view. full: a look, with titles, cards and measured content. */
  account(
    o: {
      view?: string;
      full?: boolean;
      notes?: string[];
      about?: (view: string) => unknown;
      sight?: (view: string, s: Record<string, Sight>) => unknown;
      keep?: boolean;
      planning?: boolean;
    } = {},
  ): Record<string, unknown> {
    const win = this.win(),
      p = this.placed();
    const inStack = (x: PlacedPane) =>
      p.stacks.filter((st) => st.path.length < x.path.length && st.path.every((v, k) => x.path[k] === v)).at(-1);
    const titleOf = (v: string) => this.meta.get(v)?.title ?? v;
    const pane = (x: PlacedPane, i: number) => {
      const m = this.meta.get(x.view)!;
      const got = o.planning || m.loading ? undefined : this.measured.get(x.view);
      const read = o.planning || m.loading ? undefined : this.verified.get(x.view);
      const loading = m.loading ? { state: 'loading' } : {};
      const st = inStack(x);
      if (x.behind && st) {
        // a tab behind another in a stack: not drawn, so nothing of it is in sight
        const front = st.tabs[st.front].views,
          mine = st.tabs.find((t) => t.views.includes(x.view))!;
        return {
          view: x.view,
          ...loading,
          ...(o.full ? { title: m.title, ...(m.kind ? { kind: m.kind } : { cards: m.panels }) } : {}),
          at: `behind ${quoted(front.map(titleOf))} in a stack: tab ${mine.index + 1} of ${st.tabs.length}, not drawn until it is in front`,
          stack: { front: front[0], tabs: st.tabs.map((t) => t.views[0]) },
        };
      }
      // a lone view is as tall as its content and centred: its room is known now, its box once the window has measured it
      // (the title bar is 28 px and the pane has a 1 px border, as the renderer draws it)
      const lone =
        x.fit && x.box
          ? (() => {
              const r = x.box;
              if (!got) return { room: [r.x, r.y, r.w, r.h] };
              const h = Math.min(r.h, Math.round(28 + got.visible + 2));
              return { box: [r.x, Math.round((win.h - h) / 2), r.w, h], room: [r.x, r.y, r.w, r.h] };
            })()
          : null;
      // the whole of it, when asked: a view's kind and what the host says of it, or its cards
      const described = () => {
        if (!o.full) return {};
        if (m.kind)
          return {
            title: m.title,
            kind: m.kind,
            ...(o.about?.(x.view) !== undefined ? { about: o.about(x.view) } : {}),
          };
        return { title: m.title, cards: m.panels };
      };
      return {
        view: x.view,
        ...loading,
        ...described(),
        at: x.box ? where(x.box, win) : `${i + 1} of ${p.panes.length}, top to bottom`,
        ...(lone ?? (x.box ? { box: [x.box.x, x.box.y, x.box.w, x.box.h] } : { width: win.w })),
        surface: x.compact ? 'compact' : 'wide',
        ...(x.fit ? { height: `as tall as its content, centred, at most ${x.box!.h} px` } : {}),
        ...(o.full && got && p.mode !== 'stacked'
          ? {
              content:
                got.content > got.visible + 1
                  ? `scrolls: ${px(got.content)} px of content in ${px(got.visible)}`
                  : 'fits',
            }
          : {}),
        ...(o.full && got?.sight && p.mode !== 'stacked' && o.sight
          ? (() => {
              const v = o.sight(x.view, got.sight);
              return v === undefined ? {} : { in_sight: v };
            })()
          : {}),
        ...(o.full && read
          ? {
              verified:
                read.at >= this.laidAt
                  ? read.v
                  : { ...(read.v as object), stale: 'read before the panes last moved; the window reads it again' },
            }
          : {}),
        ...(st
          ? {
              stack: {
                front: st.tabs[st.front].views[0],
                tabs: st.tabs.map((t) => t.views[0]),
                ...(st.auto
                  ? { why: 'its panes do not fit side by side, so they are stacked until there is room' }
                  : {}),
                ...(st.why === 'ask' ? { in_front: 'it asks the person, so it is in front' } : {}),
              },
            }
          : {}),
      };
    };
    const panes = this.panes(),
      shelved = [...this.meta.keys()]
        .filter((v) => !panes.includes(v))
        .sort((a, b) => (this.shelf.get(a)?.at ?? 0) - (this.shelf.get(b)?.at ?? 0));
    const self = o.view ? p.panes.findIndex((x) => x.view === o.view) : -1;
    const mode = {
      empty: 'empty: no views yet',
      single: 'single: one view, in the middle',
      tiled: `tiled: ${p.panes.filter((x) => !x.behind).length} panes, 1 px lines between${p.stacks.length ? `; ${p.stacks.length} stack${p.stacks.length === 1 ? '' : 's'}, with ${p.panes.filter((x) => x.behind).length} behind as tabs` : ''}`,
      stacked: 'stacked: the window is phone-width, so the panes are one after another, full width',
      maximized: `maximized: "${this.maximized}" fills the window; the other panes are behind it`,
    }[p.mode];
    const notes = [...(o.notes ?? []), ...p.notes];
    const parked = (v: string) => {
      const s = this.shelf.get(v);
      return {
        view: v,
        title: this.meta.get(v)!.title,
        ...(this.meta.get(v)?.loading ? { state: 'loading' } : {}),
        by: BY[s?.by ?? 'model'],
        ...(s?.updated ? { updated: 'shown again while collapsed: marked as new' } : {}),
      };
    };
    return presentationAccount(
      {
        rev: this.rev,
        window: this.window ? `${win.w} × ${win.h}` : `${win.w} × ${win.h}, assumed: no window has reported its size`,
        mode,
        ...(o.planning
          ? {
              geometry: {
                viewport: this.window ? 'reported' : 'estimated',
                measurement: 'computed layout; content has not been read back',
              },
            }
          : {}),
        layout: shorthand(this.tree),
        ...(o.view && !o.full
          ? {
              this:
                self >= 0
                  ? pane(p.panes[self], self)
                  : {
                      view: o.view,
                      at: panes.includes(o.view)
                        ? 'behind the maximized pane'
                        : `collapsed in the shelf, by ${BY[this.shelf.get(o.view)?.by ?? 'model']}`,
                    },
            }
          : { panes: p.panes.map(pane) }),
        ...(shelved.length ? { collapsed: o.full ? shelved.map(parked) : shelved } : {}),
        ...(this.focus ? { focus: this.focus } : {}),
        ...(notes.length ? { notes } : {}),
        ...(this.suggestion
          ? { suggested: `${JSON.stringify(shorthand(this.suggestion.tree))}: waiting for the person` }
          : {}),
        ...(this.changes.length || this.elsewhere.length
          ? { person: o.keep ? [...this.pending(), ...this.elsewhere] : this.takePerson() }
          : {}), // keep: an account no model reads now
      },
      this.shows(),
      this.presenting,
      o.full,
    ); // said as the views are shown: as cards, or as their content
  }
}
