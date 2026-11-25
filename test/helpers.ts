// Shared by the tests: an MCP client for a process's UI server, plain HTTP to a process's page origin, Chromium, a small
// PDF, and the fixtures' shell served as a host's window loads it.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
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

/** A small valid PDF, made here: pages of US Letter, each saying "Page n" in Helvetica (a standard font, not embedded). */
export function tinyPdf(pages: number): Uint8Array {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < pages; i++) {
    const text = `BT /F1 48 Tf 72 640 Td (Page ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  let out = '%PDF-1.4\n'; const at: number[] = [];
  objects.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  return Buffer.from(`${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1');
}

/** The fixtures' shell (test/fixtures/shell.html, and the app bundled beside the compiled tests in out/test) served on
 *  loopback, as a host's window loads it; or its page of one view (page: 'app.html'). */
export async function shellServer(compiled: string, page: 'shell.html' | 'app.html' = 'shell.html'): Promise<{ url: string; close: () => void }> {
  const app = http.createServer((req, res) => {
    const f = req.url === '/app.bundle.js' ? path.join(compiled, 'fixtures', 'app.bundle.js') : path.join(compiled, '..', '..', 'test', 'fixtures', page);
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
  });
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(app.address() as { port: number }).port}/${page}`, close: () => app.close() };
}
