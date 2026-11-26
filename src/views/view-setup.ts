// What a host gives the views (views.ts): how terminals start and whether the model may run commands in them, how a
// browser page is shown and reached, and the session's side: where the views live, their panes, and the person.
import type { Cdp } from './browser-protocol.js';
import type { TerminalOptions } from './terminal.js';

export type TerminalSetup = {
  shell?: string;
  login?: boolean; // the person's own shell, by default (a login shell on macOS)
  env?: NodeJS.ProcessEnv; // its whole environment: by default only what a shell needs of the host's (terminalEnvironment)
  run?: boolean; // the model may run commands in a shared terminal, each after the person's yes
  onExit?: (name: string, code: number) => void;
  spawn?: TerminalOptions['spawn']; // where the shell runs, when not on this machine (the processor's box)
};
export type BrowserSetup = {
  /** Show a page where the person sees it (Electron: a WebContentsView over its pane) and give its CDP connection.
   *  owner: whose page it is, so the person's sign-ins never reach the model's pages. */
  open: (o: { name: string; owner: 'model' | 'person' }) => Promise<Cdp>;
  close?: (name: string) => void;
  /** The addresses the model's pages open and reach without asking: this machine's (localhost, any port), by default
   *  (isLocal). Leave out the host's own addresses that answer without a sign-in, such as its window's server. Requests
   *  are checked through the page's CDP connection, which does not reach a page's service workers or WebSockets: a host
   *  that shows the model's pages in a partition of their own can check those there too (Electron: webRequest). */
  local?: (u: URL) => boolean;
};
export type ViewsSetup = { terminal?: TerminalSetup | false; browser?: BrowserSetup };
/** What a session gives the views: where they live, their panes, and the person. */
export type ViewHost = {
  cwd: string;
  dir: string;
  pane(p: {
    name: string;
    title: string;
    subtitle?: string;
    kind: string;
    place?: unknown;
    about: () => unknown;
  }): string[];
  unpane(name: string): void;
  tell(what: string): void;
  confirm(
    q: { title: string; message?: string; details?: { label?: string; text: string }[] },
    signal?: AbortSignal,
  ): Promise<boolean>;
  log(e: Record<string, unknown>): void;
};
