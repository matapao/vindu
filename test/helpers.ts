// Shared by the tests: an MCP client for a process's UI server, plain HTTP to a process's page origin, Chromium, a small
// PDF, the fixtures' shell served as a host's window loads it, and the shapes the tests read of what the server writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { BrowserType, CDPSession } from 'playwright';
import type { Surface } from '../src/a2ui.js';
import type { ShellEvent, VinduSessionOptions } from '../src/index.js';
import type { LayoutNode } from '../src/layout.js';
import type { AnswerEntry, Entry } from '../src/results.js';
import type { Cdp } from '../src/views/browser.js';

export async function mcpClient(url: string, requestInit?: RequestInit) {
  const mcp = new Client({ name: 'test', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { ok: !r.isError, text: r.content[0].text };
  };
  const json = async (name: string, args: Record<string, unknown>) => {
    const r = await call(name, args);
    if (!r.ok) throw new Error(r.text);
    return JSON.parse(r.text);
  };
  return { mcp, call, json };
}

/** GET a page-host URL from Node: connect to loopback and send the URL's own Host, as a browser does for *.localhost. */
export function get(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          host: '127.0.0.1',
          port: u.port,
          method: options.method,
          path: u.pathname + u.search,
          headers: { host: u.host, ...options.headers },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        },
      )
      .on('error', reject);
  });
}

/** GET a raw path, exactly as given (no URL parsing on this side), from a page origin. */
export function getRaw(origin: string, rawPath: string, headers: Record<string, string> = {}): Promise<number> {
  const u = new URL(origin);
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: u.port, path: rawPath, headers: { host: u.host, ...headers } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on('error', reject);
  });
}

// playwright is a dev dependency here and an optional peer for hosts; it is loaded the CommonJS way
export const chromium: BrowserType = createRequire(import.meta.url)('playwright').chromium;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A small valid PDF, made here: pages of US Letter, each saying "Page n" in Helvetica (a standard font, not embedded). */
export function tinyPdf(pages: number): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let i = 0; i < pages; i++) {
    const text = `BT /F1 48 Tf 72 640 Td (Page ${i + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  let out = '%PDF-1.4\n';
  const at: number[] = [];
  objects.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  return Buffer.from(
    `${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    'latin1',
  );
}

/** The fixtures' shell (test/fixtures/shell.html, and the app bundled beside the compiled tests in out/test) served on
 *  loopback, as a host's window loads it; or its page of one view (page: 'app.html'). */
export async function shellServer(
  compiled: string,
  page: 'shell.html' | 'app.html' = 'shell.html',
): Promise<{ url: string; close: () => void }> {
  const app = http.createServer((req, res) => {
    const f =
      req.url === '/app.bundle.js'
        ? path.join(compiled, 'fixtures', 'app.bundle.js')
        : path.join(compiled, '..', '..', 'test', 'fixtures', page);
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(app.address() as { port: number }).port}/${page}`, close: () => app.close() };
}

/** A row, a field or an entry of what the server or the window wrote (a tool's JSON, a view's data model), as written. */
export type Row = Record<string, unknown>;
/** A panel's part of a view's A2UI data model, as compile() writes it (a2ui.ts): what its card puts there. */
export type PanelModel = { rows: Row[]; props: Row; [field: string]: unknown };
/** A component of a view's surface, as compile() writes it: its id, its kind and its own properties. */
export type SurfaceComponent = { id: string; component: string; [property: string]: unknown };
/** A pane as the look tool tells the model of it (shell.ts), as the tests read it. */
export type LookPane = {
  view: string;
  at: string;
  box: number[];
  surface: 'wide' | 'compact';
  content: string;
  in_sight: Record<string, string>;
  verified: { pages: Record<string, string>; [field: string]: unknown };
  [field: string]: unknown;
};
/** What the look tool tells the model of the window, as the tests read it. */
export type Look = {
  window: string;
  mode: string;
  focus: string | null;
  panes: LookPane[];
  layout: Record<string, unknown>;
  person: string[];
  shows: { as: string; chosen: string; cards: string[]; list: string; whole: string[] };
  slots: LookSlot[];
  [field: string]: unknown;
};
/** The look's pane of a view: the test fails if the look has none. */
export function paneIn(look: Look, view: string): LookPane {
  const pane = look.panes.find((p) => p.view === view);
  assert.ok(pane, `the look has no pane "${view}"`);
  return pane;
}
/** The JSON a tool answers with, through mcpClient. */
export type McpJson = Awaited<ReturnType<typeof mcpClient>>['json'];
/** What a host is asked to do for a session: a job a hook starts, a source a template reads, a notice to show. */
export type HostJob = Parameters<NonNullable<VinduSessionOptions['onJob']>>[0];
export type HostSource = Parameters<NonNullable<VinduSessionOptions['source']>>[0];
export type HostNotice = Parameters<NonNullable<VinduSessionOptions['onNotice']>>[0];
export type HostWatch = Parameters<NonNullable<VinduSessionOptions['watch']>>[0];
/** A template's slot as the look tells the model of it, as the tests read it. */
export type LookSlot = {
  slot: string;
  filled: string;
  required?: boolean;
  approved_by?: string[];
  [field: string]: unknown;
};
/** A panel of a view's account (account.ts), as the tests read it. */
export type AccountPanel = { id: string; [field: string]: unknown };

/** The panels of a surface's data model, by pid, each read as P: the panel's model as the test reads it. */
export function panelsIn<P = PanelModel>(surface: Surface): Record<string, P> {
  return (surface.find((m) => m.updateDataModel) as { updateDataModel: { value: { panels: Record<string, P> } } })
    .updateDataModel.value.panels;
}

/** The components of a surface, each read as C: the component as the test reads it. */
export function componentsIn<C = SurfaceComponent>(surface: Surface): C[] {
  return (surface.find((m) => m.updateComponents) as { updateComponents: { components: C[] } }).updateComponents
    .components;
}

/** The surface's component that `is` picks, read as C: the test fails if there is none. */
export function componentIn<C extends SurfaceComponent = SurfaceComponent>(surface: Surface, is: (c: C) => boolean): C {
  const found = componentsIn<C>(surface).find(is);
  assert.ok(found, 'the surface has the component');
  return found;
}

/** The entry if it is one of the person's answers. */
export const answerOf = (e: Entry | undefined): AnswerEntry | undefined => (e?.kind === 'answer' ? e : undefined);

/** A Playwright CDP session as Vindu's Cdp, which names each method and event by a string, as Electron's debugger does.
 *  Playwright types each by its name instead, so the session is read here as one that takes any name: the one cast. */
export function cdpOf(session: CDPSession): Cdp {
  const named = session as unknown as {
    send: Cdp['send'];
    on(event: string, fn: Parameters<Cdp['on']>[1]): void;
    off(event: string, fn: Parameters<Cdp['on']>[1]): void;
  };
  return {
    send: (m, p) => named.send(m, p),
    on: (e, f) => {
      named.on(e, f);
      return () => named.off(e, f);
    },
  };
}

/** A layout node as the tests read it: a split's direction and its children's views, or a pane's view. */
export function nodeOf(n: LayoutNode | null): {
  dir?: 'row' | 'column';
  view?: string;
  children?: (string | undefined)[];
} {
  if (!n) return {};
  return 'view' in n
    ? { view: n.view }
    : { dir: n.dir, children: n.children.map((c) => ('view' in c ? c.view : undefined)) };
}

/** A tool's input schema as the tests read it: JSON Schema, each property and item a schema of its own. */
export type Schema = {
  type?: string;
  description: string;
  enum?: unknown[];
  properties: Record<string, Schema>;
  items: Schema;
  [keyword: string]: unknown;
};
export const schemaOf = (tool: { inputSchema: object }): Schema => tool.inputSchema as Schema;

/** The window's events of one type, among those the fixtures' app kept. */
export const eventsOf = <T extends ShellEvent['type']>(
  events: ShellEvent[],
  type: T,
): Extract<ShellEvent, { type: T }>[] => events.filter((e): e is Extract<ShellEvent, { type: T }> => e.type === type);

/** A message's JSON-RPC method, where it has one. */
export const methodOf = (msg: unknown): unknown =>
  typeof msg === 'object' && msg !== null && 'method' in msg ? msg.method : undefined;
