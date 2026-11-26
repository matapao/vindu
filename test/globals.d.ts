// What the browser tests read on their pages' windows: the fixtures' app (test/fixtures/app.ts), and what the pages and
// MCP Apps the tests write keep there for them to read back.
import type { FixtureApp } from './fixtures/app.js';

/** A JSON-RPC message, as an MCP App and its host post them to each other. */
export type RpcMessage = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

declare global {
  interface Window {
    app: FixtureApp;
    /** An MCP App's: what the window posted it, in order. */
    said: RpcMessage[];
    /** An MCP App's: asks its host to initialize, and gives the host's answer. */
    init(): Promise<{ result: { hostContext: Record<string, unknown>; [field: string]: unknown } }>;
    /** An MCP App's: asks its host something, and gives the host's answer. */
    call(method: string, params?: Record<string, unknown>): Promise<RpcMessage>;
    /** An MCP App's: tells its host something (a notification). */
    tell(method?: string, params?: Record<string, unknown>): void;
    /** An MCP App's: calls a tool through its host. */
    callTool(): Promise<unknown>;
    /** What a test keeps while it watches a page. */
    delivered: unknown[];
    errors: string[];
    gone: number | undefined;
    strip: Element | null;
    ran: unknown;
    __ran: unknown;
    hostCspViolations: unknown[];
    /** The code panel's editor, on its page. */
    monaco: { editor: { getEditors(): { setScrollTop(top: number): void; getScrollHeight(): number }[] } };
  }
}
