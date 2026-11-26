// A browser view's pane: its own bar (back, forward, reload, the address, whose page it is and whether the model may
// use it, DevTools), and a slot for the page itself: a host that can lay a native view over it covers it exactly; a host
// that cannot (a browser) gives the pane pictures of the page as it changes, and the pane gives back what the person does
// there (the mouse, the wheel, keys, text). The drawer tells the host the slot's box as the layout moves, and null while
// the pane is hidden.
// Use: mountShell(el, { panes: { browser: browserPane(io) } }).
import type { PaneDrawer } from './shell.js';
import { elementsOf, shareToggle, type ElementMaker } from './dom.js';

export type PageState = { url: string; title: string; loading: boolean; back: boolean; forward: boolean; shared: boolean; owner: 'model' | 'person' } | null;
type Box = { x: number; y: number; w: number; h: number };
/** How the window reaches a page on the host. */
export type BrowserIO = {
  state(name: string): Promise<PageState>;
  onState(name: string, cb: (s: PageState) => void): () => void;
  navigate(name: string, address: string): Promise<PageState>;
  go(name: string, to: 'back' | 'forward' | 'reload'): Promise<PageState>;
  share(name: string, on: boolean): Promise<boolean>;
  /** Where the page goes: the slot's box in CSS pixels of the window, or null while the pane is hidden. */
  place(name: string, box: Box | null): void;
  devtools?(name: string): void;
  /** A host that pictures the page in the slot: each picture (a JPEG, in base64) as the page changes. */
  frames?(name: string, cb: (f: { data: string; width: number; height: number }) => void): () => void;
  /** What the person does in the slot, in the page's CSS pixels, to the page. modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8. */
  input?(name: string, e: PageInput): void;
  /** The person points at an element of the page: the next click there picks it (the host's inspect mode), without
   *  reaching the page; resolves when picked or called off. */
  point?(name: string): Promise<unknown>;
  stopPointing?(name: string): void;
  fail?(message: string): void;
};
export type PageInput =
  | { type: 'mouse'; event: 'mousePressed' | 'mouseReleased' | 'mouseMoved'; x: number; y: number; button?: 'none' | 'left' | 'middle' | 'right'; buttons?: number; clickCount?: number; modifiers?: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number; modifiers?: number }
  | { type: 'key'; event: 'keyDown' | 'rawKeyDown' | 'keyUp'; key: string; code: string; text?: string; keyCode?: number; modifiers?: number; location?: number; autoRepeat?: boolean }
  | { type: 'text'; text: string };
export const BROWSER_WORDS = {
  back: 'Back', forward: 'Forward', reload: 'Reload', loading: 'Loading…', devtools: 'DevTools', devtoolsTitle: 'Open DevTools for this page',
  address: 'Address', placeholder: 'localhost:8081, https://…', share: 'Shared with the model',
  yours: 'Your page', models: 'The model\'s page',
  sharedNote: 'The model reads this page and can act on it', notSharedNote: 'The model cannot read this page',
  point: 'Point', pointTitle: 'Point at something on the page: click it, and it goes with your next message (its name and role, never a picture)',
  pointing: 'Click it on the page…', pointingTitle: 'Click an element on the page, or this again to stop',
  page: 'The page',
  pageKeys: 'Keys go to the page. F6 moves to the next pane, Shift+F6 to the one before.',
};

export function browserPane(io: BrowserIO, words: Partial<typeof BROWSER_WORDS> = {}): PaneDrawer {
  const w = { ...BROWSER_WORDS, ...words };
  return ({ body, view }) => {
    const name = view.name, h = elementsOf(body.ownerDocument);
    const bar = h('form', 'vindu-viewbar');
    const fail = (e: unknown) => io.fail?.(String((e as Error)?.message ?? e));
    const btn = (text: string, title: string) => { const b = h('button', '', text); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); return b; };
    const back = btn('←', w.back), forward = btn('→', w.forward), reload = btn('↻', w.reload);
    const address = h('input', 'vindu-address'); address.type = 'text'; address.spellcheck = false; address.placeholder = w.placeholder; address.setAttribute('aria-label', w.address);
    const owner = h('span', 'vindu-note');
    const { label, box: share } = shareToggle(h, w.share);
    bar.append(back, forward, reload, address, owner, label);
    let pointing = false; // the host's inspect mode, called off when the pane goes
    if (io.point) {
      const p = btn(w.point, w.pointTitle); p.classList.add('vindu-point'); p.setAttribute('aria-pressed', 'false');
      let on = false; const set = (v: boolean) => { on = pointing = v; p.setAttribute('aria-pressed', String(v)); p.textContent = v ? w.pointing : w.point; p.title = v ? w.pointingTitle : w.pointTitle; };
      p.addEventListener('click', () => { if (on) { io.stopPointing?.(name); set(false); return; } set(true); void io.point!(name).catch(fail).finally(() => set(false)); });
      bar.append(p);
    }
    if (io.devtools) { const d = btn(w.devtools, w.devtoolsTitle); d.addEventListener('click', () => io.devtools!(name)); bar.append(d); }
    const slot = h('div', 'vindu-slot'); body.append(bar, slot);
    const offFrames = io.frames && io.input ? pictured(h, slot, name, io, w) : undefined;
    const show = (s: PageState) => {
      if (!s) return;
      if (body.ownerDocument.activeElement !== address) address.value = s.url === 'about:blank' ? '' : s.url;
      back.disabled = !s.back; forward.disabled = !s.forward; share.checked = s.shared; reload.title = s.loading ? w.loading : w.reload;
      owner.textContent = s.owner === 'model' ? w.models : w.yours;
      label.title = s.shared ? w.sharedNote : w.notSharedNote;
    };
    void io.state(name).then(show, fail);
    const off = io.onState(name, show);
    bar.addEventListener('submit', e => { e.preventDefault(); const u = address.value.trim(); if (u) { address.blur(); void io.navigate(name, u).then(show, fail); } });
    back.addEventListener('click', () => { void io.go(name, 'back').then(show, fail); });
    forward.addEventListener('click', () => { void io.go(name, 'forward').then(show, fail); });
    reload.addEventListener('click', () => { void io.go(name, 'reload').then(show, fail); });
    share.addEventListener('change', () => { void io.share(name, share.checked).catch(fail).then(() => io.state(name)).then(show, fail); });
    let visible = false, last = '';
    const send = () => {
      const r = slot.getBoundingClientRect();
      const box = visible && r.width > 0 && r.height > 0 ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
      const k = JSON.stringify(box); if (k !== last) { last = k; io.place(name, box); }
    };
    const ro = new ResizeObserver(send); ro.observe(slot);
    return {
      place: box => { visible = !!box; send(); },
      destroy: () => { off(); offFrames?.(); ro.disconnect(); if (pointing) io.stopPointing?.(name); io.place(name, null); },
    };
  };
}

/** The page as pictures in its slot, and what the person does there back to it: the slot takes the focus on a click or
 *  Tab (and shows it has it), and while it has it, keys and text go to the page; the window's own shortcuts wait until
 *  the focus leaves it, and F6 (Shift+F6) always moves it on, to the next pane (the one before), as everywhere in the shell. */
function pictured(h: ElementMaker, slot: HTMLElement, name: string, io: BrowserIO, w: typeof BROWSER_WORDS): () => void {
  const img = h('img'); img.alt = ''; img.draggable = false;
  img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;object-position:0 0;pointer-events:none;user-select:none';
  slot.append(img); slot.tabIndex = 0; slot.setAttribute('role', 'application'); slot.setAttribute('aria-label', w.page); slot.setAttribute('aria-description', w.pageKeys);
  const off = io.frames!(name, f => { img.src = `data:image/jpeg;base64,${f.data}`; });
  const send = (e: PageInput) => io.input!(name, e);
  const mods = (e: MouseEvent | KeyboardEvent) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  const at = (e: MouseEvent) => { const r = slot.getBoundingClientRect(); return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) }; };
  const button = (b: number) => (['left', 'middle', 'right'] as const)[b] ?? 'none';
  const held = (buttons: number) => { if (buttons & 1) return 'left'; return buttons & 2 ? 'right' : 'none'; }; // the button a move drags with
  slot.addEventListener('mousedown', e => { slot.focus(); e.preventDefault(); send({ type: 'mouse', event: 'mousePressed', ...at(e), button: button(e.button), buttons: e.buttons, clickCount: e.detail || 1, modifiers: mods(e) }); });
  slot.addEventListener('mouseup', e => { e.preventDefault(); send({ type: 'mouse', event: 'mouseReleased', ...at(e), button: button(e.button), buttons: e.buttons, clickCount: e.detail || 1, modifiers: mods(e) }); });
  const view = slot.ownerDocument.defaultView ?? window;
  let moving: MouseEvent | undefined, frame = 0; // one move a frame, the latest
  slot.addEventListener('mousemove', e => {
    if (!moving) frame = view.requestAnimationFrame(() => { const m = moving!; moving = undefined; send({ type: 'mouse', event: 'mouseMoved', ...at(m), button: held(m.buttons), buttons: m.buttons, modifiers: mods(m) }); });
    moving = e;
  });
  const leaves = (e: KeyboardEvent) => e.key === 'F6' && !e.altKey && !e.ctrlKey && !e.metaKey; // the shell's, never the page's
  const pixels = (mode: number) => { if (mode === 1) return 16; return mode === 2 ? slot.clientHeight : 1; }; // a wheel's lines or pages, in pixels
  slot.addEventListener('wheel', e => { e.preventDefault(); const k = pixels(e.deltaMode); send({ type: 'wheel', ...at(e), deltaX: e.deltaX * k, deltaY: e.deltaY * k, modifiers: mods(e) }); }, { passive: false });
  slot.addEventListener('contextmenu', e => e.preventDefault());
  slot.addEventListener('keydown', e => {
    if (leaves(e)) return;
    e.stopPropagation();
    if (e.isComposing) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return; // the browser pastes: the text goes to the page from there
    e.preventDefault();
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey;
    let typed: { text?: string } = {}; // what the key types: its character, or a return for Enter
    if (printable) typed = { text: e.key }; else if (e.key === 'Enter') typed = { text: '\r' };
    send({ type: 'key', event: printable ? 'keyDown' : 'rawKeyDown', key: e.key, code: e.code, keyCode: e.keyCode, modifiers: mods(e), location: e.location, autoRepeat: e.repeat, ...typed });
  });
  slot.addEventListener('keyup', e => { if (leaves(e)) return; e.stopPropagation(); e.preventDefault(); send({ type: 'key', event: 'keyUp', key: e.key, code: e.code, keyCode: e.keyCode, modifiers: mods(e), location: e.location }); });
  slot.addEventListener('paste', e => { const t = e.clipboardData?.getData('text/plain'); if (t) { e.preventDefault(); send({ type: 'text', text: t }); } });
  slot.addEventListener('compositionend', e => { if (e.data) send({ type: 'text', text: e.data }); });
  return () => { off(); view.cancelAnimationFrame(frame); moving = undefined; };
}
