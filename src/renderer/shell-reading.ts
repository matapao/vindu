// How far the person has read each panel of the views in the window: the furthest share of it they have had in view,
// from 0 to 1 (0.985 and more is 1), for the host and never the model. A panel's share is how far down it the view of
// its pane has reached; one that fits in its pane counts once it has been in view about 2.5 s, as a glance is no read.
// A page or a PDF in a frame is as far as its frame says (page-runtime.ts), taken while the frame is in view. What grew
// goes to the UI server as one read event a view, a few times a second at most, for the showing it is of (seq).
import type { ShellEvent } from '../shell.js';
import { viewOf } from './dom.js';
import type { PaneEl } from './shell-pane.js';

/** How long a panel that fits in its pane is in view before it counts as read, and how often a view's reads go out. */
const HOLD = 2500,
  EVERY = 250;
/** A panel's own element is A2UI's for its Card, whose component id is its pid (cards.ts pidFor): p_ and its id. */
const PANEL = /^p_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/;
type Drawn = HTMLElement & { context?: { componentModel?: { id?: string } } };
type Box = { top: number; bottom: number; left: number; right: number };
/** A showing of a view, as read so far: each panel's furthest share, what was sent of it, and the panels that fit in
 *  their pane and are in view now: since when, and the least of them that has been in view all along. */
type Reading = {
  seq: number | undefined;
  best: Map<string, number>;
  sent: Map<string, number>;
  held: Map<string, { share: number; since: number }>;
  at: number;
};

/** Each panel of a pane's view, by its pid: its outermost element, the walk going no further into it. */
function panelsIn(body: HTMLElement): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  let seen = 0;
  const walk = body.ownerDocument.createTreeWalker(body, 1 /* elements */, (node: Node) => {
    const id = (node as Drawn).context?.componentModel?.id;
    if (++seen > 20_000) return 2; // reject: a pane that large is read no further
    if (id && PANEL.test(id)) {
      if (!found.has(id)) found.set(id, node as HTMLElement);
      return 2;
    }
    return 3; // skip: on into its children
  });
  walk.nextNode();
  return found;
}
/** What of a pane's body is in the window: its box, within the window's own. */
function inWindow(body: HTMLElement): Box | undefined {
  const r = body.getBoundingClientRect(),
    win = body.ownerDocument.defaultView ?? window;
  const box = {
    top: Math.max(r.top, 0),
    bottom: Math.min(r.bottom, win.innerHeight),
    left: Math.max(r.left, 0),
    right: Math.min(r.right, win.innerWidth),
  };
  return box.bottom - box.top > 0 && box.right - box.left > 0 ? box : undefined;
}
const shareOf = (n: number) => (n >= 0.985 ? 1 : Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000);

export function trackReading(root: HTMLElement, panes: ReadonlyMap<string, PaneEl>, emit: (event: ShellEvent) => void) {
  const doc = root.ownerDocument,
    win = doc.defaultView ?? window;
  const views = new Map<string, Reading>();
  const framed = new WeakMap<HTMLIFrameElement, { src: string; share: number }>(); // what each frame said, of its page then
  const due = new Set<string>();
  let all = false,
    soonTimer: ReturnType<typeof setTimeout> | undefined,
    holdTimer: ReturnType<typeof setTimeout> | undefined;
  const sendTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const grow = (r: Reading, pid: string, n: number) => {
    const share = shareOf(n);
    if (share > (r.best.get(pid) ?? 0)) r.best.set(pid, share);
  };
  /** What of a view grew since it was last sent, sent now, or once EVERY has passed since. */
  const send = (view: string, r: Reading) => {
    const read = Object.fromEntries([...r.best].filter(([pid, share]) => share > (r.sent.get(pid) ?? 0)));
    if (!Object.keys(read).length || sendTimers.has(view)) return;
    const wait = r.at + EVERY - Date.now();
    if (wait > 0) {
      sendTimers.set(
        view,
        setTimeout(() => {
          sendTimers.delete(view);
          const now = views.get(view);
          if (now) send(view, now);
        }, wait),
      );
      return;
    }
    for (const [pid, share] of Object.entries(read)) r.sent.set(pid, share);
    r.at = Date.now();
    emit({ type: 'read', view, ...(r.seq !== undefined ? { seq: r.seq } : {}), read });
  };

  /** A view's panels, read where they are now. A showing it has not read yet starts from nothing. Nothing is in view
   *  in a window that is hidden, or a pane that is not drawn: what was held in view there is let go. */
  function measure(view: string) {
    const pane = panes.get(view),
      shown = pane?.view;
    if (!pane || !shown || pane.host || doc.visibilityState === 'hidden') {
      views.get(view)?.held.clear();
      return;
    }
    let r = views.get(view);
    if (!r || r.seq !== shown.seq)
      views.set(view, (r = { seq: shown.seq, best: new Map(), sent: new Map(), held: new Map(), at: 0 }));
    const box = inWindow(pane.body);
    if (!box) {
      r.held.clear();
      return;
    }
    const now = Date.now();
    for (const [pid, el] of panelsIn(pane.body)) {
      const at = el.getBoundingClientRect();
      if (!(
        at.height > 0 &&
        at.width > 0 &&
        at.bottom > box.top &&
        at.top < box.bottom &&
        at.right > box.left &&
        at.left < box.right
      )) {
        r.held.delete(pid);
        continue;
      }
      const frame = el.querySelector<HTMLIFrameElement>('iframe[data-page-panel]');
      if (frame) {
        const said = framed.get(frame);
        if (said?.src === frame.src) grow(r, pid, said.share);
        continue;
      }
      const share = (box.bottom - at.top) / at.height;
      if (at.height > box.bottom - box.top + 1) {
        grow(r, pid, share);
        continue;
      } // taller than its pane: scrolled through
      const held = r.held.get(pid);
      if (shareOf(share) <= (r.best.get(pid) ?? 0)) r.held.delete(pid);
      else if (!held) r.held.set(pid, { share, since: now });
      else if (now - held.since >= HOLD) {
        grow(r, pid, Math.min(held.share, share));
        r.held.delete(pid);
      } else held.share = Math.min(held.share, share);
    }
    send(view, r);
  }
  /** Read again once the soonest panel held in view has been there long enough. */
  function holdOn() {
    clearTimeout(holdTimer);
    const since = [...views.values()].flatMap((r) => [...r.held.values()].map((h) => h.since));
    if (since.length) holdTimer = setTimeout(() => soon(), Math.max(0, Math.min(...since) + HOLD - Date.now()) + 20);
  }
  function run() {
    soonTimer = undefined;
    for (const view of all ? [...panes.keys()] : due) measure(view);
    for (const view of views.keys()) if (!panes.has(view)) views.delete(view);
    all = false;
    due.clear();
    holdOn();
  }
  /** Read a view again soon (it scrolled, was drawn, a frame said how far): or, with none named, every view. */
  function soon(view?: string) {
    if (view === undefined) all = true;
    else due.add(view);
    soonTimer ??= setTimeout(run, 100);
  }
  const onScroll = (e: Event) => soon(e.target instanceof win.HTMLElement ? viewOf(e.target) : undefined);
  const onVisible = () => soon();
  root.addEventListener('scroll', onScroll, { capture: true, passive: true }); // a pane, or a stacked window
  doc.addEventListener('visibilitychange', onVisible);

  return {
    soon,
    /** How far a page in a frame has been read, as its frame says: kept for the page it is now, the furthest. */
    frame: (frame: HTMLIFrameElement, share: number) => {
      const had = framed.get(frame);
      framed.set(frame, { src: frame.src, share: Math.max(had?.src === frame.src ? had.share : 0, share) });
      soon(viewOf(frame));
    },
    destroy() {
      clearTimeout(soonTimer);
      clearTimeout(holdTimer);
      for (const t of sendTimers.values()) clearTimeout(t);
      root.removeEventListener('scroll', onScroll, { capture: true });
      doc.removeEventListener('visibilitychange', onVisible);
    },
  };
}
