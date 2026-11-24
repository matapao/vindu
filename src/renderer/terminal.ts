// oxlint-disable-next-line typescript/triple-slash-reference -- the stylesheet imported below is declared in a declaration file, which is referenced, not imported; preserve keeps it in dist
/// <reference path="../../types/xterm-css.d.ts" preserve="true" />
// A terminal view's pane: xterm.js over the bytes the host moves (Electron: IPC; a browser: a WebSocket), with its own
// bar: whether the model may read it, which the person decides here. Colours follow the window's theme.
// Use: mountShell(el, { panes: { terminal: terminalPane(io) } }).
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { PaneDrawer } from './shell.js';
import { elementsOf, shareToggle } from './dom.js';

/** How the window reaches a terminal on the host. */
export type TerminalIO = {
  /** Start its bytes: all it shows so far, then each byte once, to onData. Returns whether it is shared and runs. */
  attach(name: string, onData: (bytes: string) => void): Promise<{ shared: boolean; running: boolean }>;
  detach?(name: string): void;
  input(name: string, data: string): void;
  resize(name: string, cols: number, rows: number): void;
  share(name: string, on: boolean): Promise<boolean>;
  onExit?(name: string, cb: (code: number) => void): () => void;
};
export const TERMINAL_WORDS = {
  share: 'Shared with the model',
  shared: 'The model reads its commands, their output and the screen.',
  notShared: 'The model cannot read this terminal.',
  ended: (code: number) => `[the shell ended, exit ${code}]`,
  endedNote: 'The shell ended.',
  point: 'Point at these lines', pointTitle: 'What you selected goes with your next message, as text',
};

const colors = (el: HTMLElement) => {
  const cs = (el.ownerDocument.defaultView ?? window).getComputedStyle(el), v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const background = v('--v-pane', '#ffffff'), foreground = v('--v-ink', '#1f1e1b');
  return { background, foreground, cursor: foreground, cursorAccent: background, selectionBackground: 'rgba(128, 128, 128, 0.35)' };
};

export function terminalPane(io: TerminalIO, words: Partial<typeof TERMINAL_WORDS> = {}): PaneDrawer {
  const w = { ...TERMINAL_WORDS, ...words };
  return ({ body, view, point }) => {
    const name = view.name, win = body.ownerDocument.defaultView ?? window;
    const h = elementsOf(body.ownerDocument);
    const bar = h('div', 'vindu-viewbar'); const { label, box: share } = shareToggle(h, w.share); const note = h('span', 'vindu-note');
    const pick = h('button', 'vindu-point', w.point); pick.type = 'button'; pick.title = w.pointTitle; pick.disabled = true;
    bar.append(label, note, pick);
    const screen = h('div', 'vindu-term'); body.append(bar, screen);
    const said = (on: boolean) => { share.checked = on; note.textContent = on ? w.shared : w.notShared; };
    said(false);
    const term = new Terminal({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, theme: colors(body) });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(screen);
    screen.style.background = colors(body).background;
    const keys = term.onData(d => io.input(name, d));
    const picked = term.onSelectionChange(() => { pick.disabled = !term.hasSelection(); });
    pick.addEventListener('click', () => { // the selected lines, as text, with where they are in this terminal's buffer
      const r = term.getSelectionPosition(); const text = term.getSelection(); if (!r || !text.trim()) return;
      point({ lines: [r.start.y + 1, r.end.y + 1], text }); term.clearSelection();
    });
    const sized = term.onResize(({ cols, rows }) => io.resize(name, cols, rows));
    const exited = io.onExit?.(name, code => { term.write(`\r\n${w.ended(code)}\r\n`); note.textContent = w.endedNote; share.disabled = true; });
    share.addEventListener('change', () => { void io.share(name, share.checked).then(said, () => said(!share.checked)); });
    const scheme = win.matchMedia('(prefers-color-scheme: dark)'); const recolor = () => { const c = colors(body); term.options.theme = c; screen.style.background = c.background; };
    scheme.addEventListener('change', recolor);
    let attached = false, gone = false, frame = 0; // gone: destroyed, so nothing attaches or writes after
    const fitNow = () => {
      if (gone || screen.clientWidth <= 0 || screen.clientHeight <= 0) return;
      try { fit.fit(); } catch { /* not laid out yet */ }
      if (!attached) { // its size first, then all it shows so far
        attached = true; io.resize(name, term.cols, term.rows);
        void io.attach(name, d => { if (!gone) term.write(d); }).then(i => { if (gone) return; said(i.shared); if (!i.running) share.disabled = true; });
      }
    };
    const ro = new ResizeObserver(fitNow); ro.observe(screen);
    return {
      place: box => { if (box && !gone) { win.cancelAnimationFrame(frame); frame = win.requestAnimationFrame(fitNow); } },
      destroy: () => {
        gone = true; win.cancelAnimationFrame(frame);
        ro.disconnect(); scheme.removeEventListener('change', recolor); exited?.(); io.detach?.(name); keys.dispose(); picked.dispose(); sized.dispose(); term.dispose();
      },
    };
  };
}
