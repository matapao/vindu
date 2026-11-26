// The window the window tests share (window.test.ts, window-panes.test.ts), drawn in Chromium as a host app runs it: an
// MCP Apps provider with a real client bundled, a site of pages, and a pump that carries events and views both ways.
import { afterAll } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, type AppsProvider, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, sleep } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('win-');
export const results = memoryResults(dir);
results.add({ tool: 'query', server: 'db', input: { limit: 3 }, value: [
  { id: 'INV-2026-0412', customer: 'Havgap Media', days_overdue: 53, amount_nok: 48200 },
  { id: 'INV-2026-0419', customer: 'Fjellvik Data', days_overdue: 41, amount_nok: 31050 },
  { id: 'INV-2026-0398', customer: 'Brattli Verksted', days_overdue: 12, amount_nok: 18400 },
] });
// Bundle a real MCP Apps client as a provider would. The opaque iframe may not fetch scripts.
const guest = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { App } from '@modelcontextprotocol/ext-apps';
      const app = new App({ name: 'table', version: '1' }, {});
      const status = document.getElementById('status');
      app.ontoolinput = input => { document.body.dataset.limit = String(input.arguments.limit); };
      app.ontoolresult = result => {
        document.getElementById('rows').textContent = result.structuredContent.rows.map(row => row.id).join(',');
      };
      app.connect().then(() => { status.textContent = 'theme ' + app.getHostContext().theme; });
      window.callTool = async () => {
        const result = await app.callServerTool({ name: 'mark_seen', arguments: { id: 'INV-2026-0412' } });
        status.textContent = 'called: ' + JSON.stringify(result.structuredContent);
      };
      window.tell = () => app.updateModelContext({ content: [
        { type: 'text', text: 'The person sorted by amount.' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ], structuredContent: { sortedBy: 'amount_nok' } });
    `,
  },
  bundle: true, format: 'iife', minify: true, platform: 'browser', write: false,
});
const APP = `<!doctype html><meta charset="utf-8"><body><p id="status">starting</p><p id="rows"></p><script>${guest.outputFiles[0].text}</script>`;
export const calls: unknown[] = [];
export const provider: AppsProvider = {
  tools: server => (server === 'db' ? [{ name: 'query', _meta: { ui: { resourceUri: 'ui://db/table' } } }, { name: 'mark_seen', _meta: { ui: { visibility: ['app'] } } }] : undefined),
  read: async (_server, uri) => ({ contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: APP }] }),
  call: async (server, tool, args) => { calls.push([server, tool, args]); return { content: [{ type: 'text', text: 'seen' }], structuredContent: { seen: true } }; },
};

const site = http.createServer((req, res) => {
  const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
export const browser = await chromium.launch();
export const vindu = await startVindu({ apps: { servers: { db: 'on' } }, verifyMs: 3000, waitMs: 20_000,
  operations: [{ name: 'confirm_writeoff', description: 'Ask the person to confirm writing off an invoice; returns their reason.', effect: 'write', input: { invoice: z.string() },
    ask: { title: 'Write off?', fields: { reason: { type: 'string', title: 'Reason' } }, required: ['reason'] }, run: () => ({ written_off: true }) }] });
const views: Shown[] = []; const toApps: [string, string, unknown][] = []; let state: ShellState | undefined;
export const sends: [string, string][] = [];
export const ui = vindu.open({ results, dir }, { onView: v => views.push(v), onState: s => { state = s; }, apps: provider, onApp: (v, p, m) => toApps.push([v, p, m]), onSend: (v, e) => sends.push([v, e.id]) });
const { mcp, call, json } = await mcpClient(ui.url);
export { call, json };
export const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
export const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
await page.addInitScript(() => {
  const violations: string[] = [];
  Object.assign(window, { hostCspViolations: violations });
  addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
});
await page.goto(`http://127.0.0.1:${(site.address() as { port: number }).port}/shell.html`);
await page.evaluate(() => window.app.shell('light'));
// the host's part, all the time: views, state and app messages to the window; the window's events to the UI server
let running = true;
const pump = (async () => {
  while (running) {
    for (const e of await page.evaluate(() => window.app.events())) ui.event(e);
    for (const v of views.splice(0)) await page.evaluate((x: Shown) => window.app.view(x), v);
    if (state) { const s = state; state = undefined; await page.evaluate((x: ShellState) => window.app.state(x), s); }
    for (const [v, p, m] of toApps.splice(0)) await page.evaluate(([a, b, c]: [string, string, unknown]) => window.app.app(a, b, c), [v, p, m] as [string, string, unknown]);
    await sleep(40);
  }
})();
afterAll(async () => { running = false; await pump; await mcp.close(); ui.close(); await vindu.close(); await browser.close(); site.close(); });
