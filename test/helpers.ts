// Shared by the tests: an MCP client for a process's UI server, plain HTTP to a process's page origin, and Chromium.
import http from 'node:http';
import { createRequire } from 'node:module';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export async function mcpClient(url: string, requestInit?: RequestInit) {
  const mcp = new Client({ name: 'test', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    return { ok: !r.isError, text: r.content[0].text };
  };
  const json = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); if (!r.ok) throw new Error(r.text); return JSON.parse(r.text); };
  return { mcp, call, json };
}

/** GET a page-host URL from Node: connect to loopback and send the URL's own Host, as a browser does for *.localhost. */
export function get(url: string, options: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: u.port, method: options.method, path: u.pathname + u.search, headers: { host: u.host, ...options.headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    }).on('error', reject);
  });
}

/** GET a raw path, exactly as given (no URL parsing on this side), from a page origin. */
export function getRaw(origin: string, rawPath: string, headers: Record<string, string> = {}): Promise<number> {
  const u = new URL(origin);
  return new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port: u.port, path: rawPath, headers: { host: u.host, ...headers } }, res => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', reject); });
}

// playwright is a dev dependency here and an optional peer for hosts; it is loaded the CommonJS way
/* eslint-disable @typescript-eslint/no-explicit-any */
export const chromium: any = createRequire(import.meta.url)('playwright').chromium;

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
