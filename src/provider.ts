// Compose a task's UI provider with the MCP endpoint and lifecycle used by Vindu hosts.
import { startUiServer, type OpenMore, type Shown, type UiProcess, type UiServer, type UiServerOptions } from './server.js';
import type { ShellState } from './shell.js';

export type VinduOptions = UiServerOptions;
export type VinduProcess = UiProcess;
export type VinduSessionOptions = OpenMore & {
  onView?: (view: Shown) => void;
  onState?: (state: ShellState) => void;
};
export type UiEndpoint<Name extends 'ui' | 'ui_layout' = 'ui'> = { name: Name; transport: 'http'; url: string; headers: Record<string, string> };
export type VinduSession = ReturnType<UiServer['open']> & {
  readonly mcpServer: UiEndpoint;
  /** A separate read-only capability for giving a layout coordinator the task's pane geometry. */
  readonly layoutMcpServer: UiEndpoint<'ui_layout'>;
};
export type Vindu = Omit<UiServer, 'open'> & {
  open(process: VinduProcess, options?: VinduSessionOptions): VinduSession;
};

/** A session's endpoint: its token in the URL, or in an Authorization header on the bare /mcp URL. */
function endpoint(url: string, tokenIn: 'path' | 'header' = 'path'): { url: string; headers: Record<string, string> } {
  const at = /^(.*\/mcp)\/([a-f0-9]{32})$/.exec(url);
  return tokenIn === 'header' && at ? { url: at[1], headers: { Authorization: `Bearer ${at[2]}` } } : { url, headers: {} };
}

function release(errors: unknown[], dispose: () => void) {
  try { dispose(); } catch (error) { errors.push(error); }
}

/** Register an app's cards and operations, then open an isolated UI session for each task. */
export async function startVindu(options: VinduOptions = {}): Promise<Vindu> {
  const provider = await startUiServer(options);
  const tokenIn = options.mcpTokenIn;
  const sessions = new Set<VinduSession>();
  let closing: Promise<void> | undefined;
  return {
    ...provider,
    open(process, { onView = () => {}, onState, ...options } = {}) {
      if (closing) throw new Error('The Vindu provider has closed.');
      // During teardown, revoke the session before calling the app's disposers.
      let deferred: (() => void)[] | undefined;
      const dispose = (stop: () => void) => { if (deferred) deferred.push(stop); else stop(); };
      const watch = options.watch;
      if (watch) options.watch = (...args) => {
        const unsubscribe = watch(...args);
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          dispose(unsubscribe);
        };
      };
      const browser = options.views?.browser;
      if (browser?.close) {
        const closePage = browser.close.bind(browser);
        options.views = { terminal: options.views?.terminal, browser: {
          open: browser.open.bind(browser), local: browser.local?.bind(browser),
          close: page => dispose(() => closePage(page)),
        } };
      }
      const ui = provider.open(process, onView, onState, options);
      const mcpServer: UiEndpoint = { name: 'ui', transport: 'http', ...endpoint(ui.url, tokenIn) };
      const layoutMcpServer: UiEndpoint<'ui_layout'> = { name: 'ui_layout', transport: 'http', ...endpoint(ui.layoutUrl, tokenIn) };
      const close = ui.close;
      // Extend the session in place so its live getters (including the context note) stay live.
      const session = Object.assign(ui, {
        mcpServer, layoutMcpServer,
        close() {
          if (!sessions.delete(session)) return;
          const errors: unknown[] = [];
          deferred = [];
          release(errors, close);
          for (const stop of deferred) release(errors, stop);
          deferred = undefined;
          if (errors.length) throw new AggregateError(errors, 'Failed to clean up Vindu session resources');
        },
      });
      sessions.add(session);
      return session;
    },
    close() {
      // Set the promise first so a disposer cannot open a new session or start a second shutdown.
      return closing ??= Promise.resolve().then(async () => {
        const errors: unknown[] = [];
        for (const session of sessions) release(errors, () => session.close());
        try { await provider.close(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Failed to clean up Vindu provider resources');
      });
    },
  };
}
