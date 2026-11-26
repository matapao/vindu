import { listenLoopback } from './loopback.js';
import { startPageHost } from './pages.js';
import type { OpenMore, Shown, UiProcess, UiServerOptions } from './server/contracts.js';
import { NOTE } from './server/instructions.js';
import { openSession } from './server/open-session.js';
import { configureServer } from './server/runtime.js';
import type { ShellState } from './shell.js';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import http from 'node:http';

export type {
  Shown,
  ViewSnapshot,
  ViewCheckpoint,
  ResultPointer,
  KeptAnswer,
  HeadText,
  TemplateStart,
  UiProcess,
  OpenMore,
  ReadProgress,
  UiServerOptions,
  MessageDraft,
} from './server/contracts.js';
export { NOTE } from './server/instructions.js';

export async function startUiServer(options: UiServerOptions = {}) {
  // Each bearer URL selects one tool set. The host can hand out layout access independently.
  const endpoints = new Map<string, () => McpServer>();

  const settings = configureServer(options);
  const host = await startPageHost({
    libraries: options.libraries,
    pageParentOrigins: options.pageParentOrigins,
  });
  const runtime = { ...settings, host };
  const handler = createMcpHandler(({ requestInfo }) => {
    const createServer = endpoints.get(new URL(requestInfo?.url ?? 'http://x/').pathname.split('/')[2] ?? '');
    if (!createServer) throw new Error('unknown session');
    return createServer();
  });
  const node = toNodeHandler(handler);
  const mcp = http.createServer((req, res) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403).end();
      return;
    }
    if (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) {
      res.writeHead(403).end();
      return;
    }
    const target = req.url ?? '';
    if (!target.startsWith('/') || target.startsWith('//') || /[\\#]/.test(target)) {
      res.writeHead(400).end();
      return;
    }
    // the token in the path (/mcp/<token>), or on /mcp as Authorization: Bearer <token>, so it stays out of URL logs
    const inPath = /^\/mcp\/([a-f0-9]{32})(?:\?[^#]*)?$/.exec(target)?.[1];
    const bare = /^\/mcp(\?[^#]*)?$/.exec(target);
    const token =
      inPath ?? (bare ? /^Bearer ([a-f0-9]{32})$/.exec(String(req.headers.authorization ?? ''))?.[1] : undefined);
    if (!token || !endpoints.has(token)) {
      res.writeHead(404).end();
      return;
    }
    if (!inPath) req.url = `/mcp/${token}${bare?.[1] ?? ''}`; // the handler reads its session from the path
    node(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }); // a request that fails is that request's, never the process's
  });
  const port = await listenLoopback(mcp).catch(async (error) => {
    await Promise.all([handler.close(), host.close()]);
    throw error;
  });

  return {
    /** The note for a first prompt, for a window without terminals or pages; ui.note says what a process's window has. */
    note: NOTE,
    /** Serve one process: its MCP URL for the processor, and the origin its pages and media come from.
     *  onShow gets each view's surfaces (and each ask); onShell gets the shell's state on every change, for the renderer
     *  (mountShell). event takes what the window reports: its size, the person's changes and answers, what it drew. */
    open(proc: UiProcess, onShow: (v: Shown) => void, onShell?: (s: ShellState) => void, more: OpenMore = {}) {
      return openSession(runtime, endpoints, port, proc, onShow, onShell, more);
    },
    /** The page host's port, on loopback: where the pages and media the window shows come from (pageFrameSource). */
    pagesPort: host.port,
    close: async () => {
      await handler.close();
      const closed = new Promise<void>((r) => mcp.close(() => r()));
      mcp.closeAllConnections(); // a client kept alive, or waiting on a call, does not hold the close
      await closed;
      await host.close();
    },
  };
}
export type UiServer = Awaited<ReturnType<typeof startUiServer>>;
