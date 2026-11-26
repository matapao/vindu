// A pane's element in the shell (shell.ts): its title bar, with the host's actions and the shell's own buttons, its body
// and its mark (a change inside its view, by whom, or what the model suggests); and what each part does when used.
import type { Placement } from '../layout.js';
import type { ShellEvent, ShownMeta, ViewMeta } from '../shell.js';
import { roleFor } from '../shell-roles.js';
import { iconOf, type elementsOf } from './dom.js';
import type { ShellAction, ShellHandle, ShellLabels, ShownView } from './shell-options.js';
import { fitPage, tabTitle, type PaneEl } from './shell-pane.js';
import { rendered } from './surface-runtime.js';

export const ICON = {
  max: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/></svg>',
  restore: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3"/></svg>',
  fold: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v6.5M5.25 6.75 8 9.5l2.75-2.75M3.5 12.5h9"/></svg>',
  chat: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
  stack: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h9v8M2.5 5h9v8.5h-9z"/></svg>',
};
let paneIds = 0;

/** What a pane's element needs of the shell: where it goes and how it is made, its words, and what it calls. */
type PaneParts = {
  doc: Document; make: ReturnType<typeof elementsOf>; desk: HTMLElement; skinId: string; labels: ShellLabels; paneActs: ShellAction[];
  panes: Map<string, PaneEl>; tabs: Map<string, string>; meta: (name: string) => ShownMeta | undefined; emit: (e: ShellEvent) => void;
  scheduleMeasure: (view?: string) => void; recheck: (view: string, ms?: number) => void; isStacked: () => boolean; isOpen: (name: string | null | undefined) => boolean;
  handle: () => ShellHandle; placed: () => Placement | null; peeking: () => string | null; keepPeek: () => void; unpeek: () => void;
  openPane: (name: string) => void; focusPane: (name: string) => void; collapsePane: (name: string) => void; toggleMax: (name: string) => boolean;
  startDrag: (name: string, e: PointerEvent) => void; justDragged: () => boolean;
};

/** The shell's pane elements: each view's, made once (paneFor); the host's actions on it (syncActs); its mark (drawMark). */
export function paneElements(d: PaneParts) {
  const { doc, make, desk, skinId, labels: L, paneActs, panes, tabs, meta, emit, scheduleMeasure, recheck, isStacked, isOpen, openPane, focusPane, collapsePane, toggleMax, startDrag, justDragged } = d;
  const paneFor = (name: string): PaneEl => {
    const had = panes.get(name); if (had) return had;
    const el = make('section', 'vindu-pane'); el.dataset.view = name; el.setAttribute('role', 'region'); el.id = `vindu-${skinId}-pane-${++paneIds}`; // a stack's tab names the panes it controls
    const head = make('header', 'vindu-pane-head'), title = make('span', 'vindu-pane-title'), sub = make('span', 'vindu-pane-sub'), mark = make('span', 'vindu-pane-mark'), tools = make('span', 'vindu-pane-tools');
    mark.hidden = true; mark.setAttribute('role', 'status');
    const max = make('button'), fold = make('button'), chat = make('button', 'vindu-chat'), stack = make('button', 'vindu-stack-pane'), open = make('button', 'vindu-pane-open');
    max.type = fold.type = chat.type = stack.type = open.type = 'button';
    stack.innerHTML = ICON.stack; stack.setAttribute('aria-label', L.stack); stack.title = L.stackHint; stack.hidden = true;
    stack.addEventListener('click', () => { const pp = d.placed()?.panes.find(x => x.view === name); if (pp && pp.path.length) emit({ type: 'stack', path: pp.path.slice(0, -1) }); });
    fold.innerHTML = ICON.fold; fold.setAttribute('aria-label', L.collapse); fold.title = L.collapseHint;
    chat.innerHTML = ICON.chat; chat.setAttribute('aria-label', L.chat); chat.title = `${L.chat}: ${L.chatHint}`; chat.setAttribute('aria-pressed', 'false');
    chat.addEventListener('click', () => emit({ type: 'attach', view: name, on: chat.getAttribute('aria-pressed') !== 'true' }));
    open.textContent = L.open; open.title = L.peek; open.addEventListener('click', () => { if (d.peeking() === name) openPane(name); }); // in a peek only
    tools.append(chat, stack, fold, max); head.append(title, sub, mark, tools); // open goes in only while the pane is a peek
    const body = make('div', 'vindu-pane-body'); body.tabIndex = -1; // F6 moves the keyboard here
    body.addEventListener('scroll', () => scheduleMeasure(name), { passive: true }); // what is in sight changes as it scrolls
    el.append(head, body); desk.append(el);
    el.addEventListener('pointerdown', () => focusPane(name), true);
    head.addEventListener('pointerdown', e => { if (!(e.target as Element).closest('button')) startDrag(name, e); });
    head.addEventListener('dblclick', e => { if (!(e.target as Element).closest('button') && isOpen(name)) toggleMax(name); });
    head.addEventListener('click', e => { if (d.peeking() === name && !(e.target as Element).closest('button') && !justDragged()) openPane(name); });
    max.addEventListener('click', () => { if (isOpen(name)) toggleMax(name); });
    fold.addEventListener('click', () => { if (isOpen(name)) collapsePane(name); });
    el.addEventListener('pointerenter', () => { if (d.peeking() === name) d.keepPeek(); });
    el.addEventListener('pointerleave', () => { if (d.peeking() === name) d.unpeek(); });
    // what the shell reads back changes when a tab opens (read once A2UI has drawn it), a frame loads or the pane scrolls
    body.addEventListener('click', e => {
      if (!(e.target as Element).closest?.('.a2ui-tab-button')) return;
      void rendered(body).then(() => { const t = tabTitle(body), p = panes.get(name); if (t) tabs.set(name, t); if (p && meta(name)?.fill) fitPage(p, isStacked); recheck(name); scheduleMeasure(name); });
    });
    body.addEventListener('load', e => { if (e.target instanceof HTMLIFrameElement) { e.target.dataset.loaded = '1'; recheck(name); } }, true);
    body.addEventListener('scroll', () => recheck(name, 300), { passive: true });
    const p: PaneEl = { el, head, title, sub, mark, tools, max, fold, stack, open, acts: new Map(), body, drawn: null, view: null };
    panes.set(name, p); return p;
  };
  // the host's pane actions, on the panes they are for; a view shown again may now be for others
  const syncActs = (p: PaneEl, name: string) => {
    const m = meta(name), v: ShownView = m ?? { name, title: name, fill: false, panels: '', role: roleFor({}) };
    for (const a of paneActs) {
      const want = !a.when || a.when(v), had = p.acts.get(a.id);
      if (want && !had) {
        const b = actButton(doc, a);
        b.addEventListener('click', () => a.run({ view: meta(name) ?? v, body: p.body, shell: d.handle() }));
        p.tools.insertBefore(b, p.tools.querySelector('.vindu-chat') ?? p.fold); p.acts.set(a.id, b);
      } else if (!want && had) { had.remove(); p.acts.delete(a.id); }
    }
  };

  // a change inside a view (actions.ts), marked on its pane: by whom, with an undo; or what the model suggests, to take or not
  const drawMark = (p: PaneEl, name: string, mk: ViewMeta['mark']) => {
    const key = mk ? JSON.stringify(mk) : ''; if (p.markKey === key) return;
    p.markKey = key; p.mark.replaceChildren(); p.mark.hidden = !mk; if (!mk) return;
    const t = make('span', 'vindu-mark-text'); t.textContent = mk.by === 'model' ? `${mk.suggestion ? L.suggests : L.byModel}: ${mk.text}` : mk.text; p.mark.append(t);
    const button = (label: string, action: string) => { const b = make('button', 'vindu-act-text'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => emit({ type: 'view', view: name, action } as unknown as ShellEvent)); p.mark.append(b); };
    if (mk.suggestion) { button(L.take, 'take'); button(L.dismiss, 'dismiss'); } else if (mk.undo) button(L.undo, 'undo');
  };
  return { paneFor, syncActs, drawMark };
}

/** A host action's button: its icon, drawn and nothing more (the title is then its tooltip and name), or its title as text. */
export function actButton(doc: Document, a: ShellAction): HTMLButtonElement {
  const b = doc.createElement('button'); b.type = 'button'; b.dataset.action = a.id; b.title = a.title;
  const icon = a.icon ? iconOf(doc, a.icon) : null;
  if (icon) { icon.setAttribute('aria-hidden', 'true'); b.append(icon); b.setAttribute('aria-label', a.title); } else { b.textContent = a.title; b.className = 'vindu-act-text'; }
  return b;
}
