// The window, drawn in Chromium, as a host app runs it: what the window reads back of what it drew, an ask answered
// by typing and clicking in the binding A2UI draws, the processor's own questions answered there by clicking, and an MCP
// App in its own frame, talking to its server through the host, its call asked of the person, what it reports kept
// without its image.
import { afterAll, test } from 'vitest';
import { build } from 'esbuild';
import type { Frame } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { startVindu, memoryResults, type AppsProvider, type Shown, type ShellState } from '../src/index.js';
import { chromium, mcpClient, sleep } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('win-');
const results = memoryResults(dir);
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
const calls: unknown[] = [];
const provider: AppsProvider = {
  tools: server => (server === 'db' ? [{ name: 'query', _meta: { ui: { resourceUri: 'ui://db/table' } } }, { name: 'mark_seen', _meta: { ui: { visibility: ['app'] } } }] : undefined),
  read: async (_server, uri) => ({ contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: APP }] }),
  call: async (server, tool, args) => { calls.push([server, tool, args]); return { content: [{ type: 'text', text: 'seen' }], structuredContent: { seen: true } }; },
};

const site = http.createServer((req, res) => {
  const f = req.url === '/app.bundle.js' ? path.join(import.meta.dirname, 'fixtures', 'app.bundle.js') : path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'shell.html');
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(fs.readFileSync(f));
});
await new Promise<void>(r => site.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const vindu = await startVindu({ apps: { servers: { db: 'on' } }, verifyMs: 3000, waitMs: 20_000,
  operations: [{ name: 'confirm_writeoff', description: 'Ask the person to confirm writing off an invoice; returns their reason.', effect: 'write', input: { invoice: z.string() },
    ask: { title: 'Write off?', fields: { reason: { type: 'string', title: 'Reason' } }, required: ['reason'] }, run: () => ({ written_off: true }) }] });
const views: Shown[] = []; const toApps: [string, string, unknown][] = []; let state: ShellState | undefined;
const sends: [string, string][] = [];
const ui = vindu.open({ results, dir }, { onView: v => views.push(v), onState: s => { state = s; }, apps: provider, onApp: (v, p, m) => toApps.push([v, p, m]), onSend: (v, e) => sends.push([v, e.id]) });
const { mcp, call, json } = await mcpClient(ui.url);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
await page.addInitScript(() => {
  const violations: string[] = [];
  Object.assign(window, { hostCspViolations: violations });
  addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
});
await page.goto(`http://127.0.0.1:${(site.address() as { port: number }).port}/shell.html`);
await page.evaluate(() => (window as any).app.shell('light'));
// the host's part, all the time: views, state and app messages to the window; the window's events to the UI server
let running = true;
const pump = (async () => {
  while (running) {
    for (const e of await page.evaluate(() => (window as any).app.events())) ui.event(e);
    for (const v of views.splice(0)) await page.evaluate((x: Shown) => (window as any).app.view(x), v);
    if (state) { const s = state; state = undefined; await page.evaluate((x: ShellState) => (window as any).app.state(x), s); }
    for (const [v, p, m] of toApps.splice(0)) await page.evaluate(([a, b, c]: [string, string, unknown]) => (window as any).app.app(a, b, c), [v, p, m] as [string, string, unknown]);
    await sleep(40);
  }
})();
afterAll(async () => { running = false; await pump; await mcp.close(); ui.close(); await vindu.close(); await browser.close(); site.close(); });

test('the window reads back what it drew, and the account says so: every value checked, and what is out of sight', async () => {
  const a = await json('show_view', { name: 'overdue', title: 'Overdue', panels: [
    { card: 'kpi', title: 'Total', from: 'r1', value: 'sum(amount_nok)' }, { card: 'table', from: 'r1', columns: ['id', 'customer', 'amount_nok'] }] });
  assert.equal(a.verified.by, 'the window'); assert.equal(a.verified.checked, 4); // the kpi and the first row's three cells
  assert.equal(a.verified.same, 'every value checked is drawn as sent');
  assert.equal(a.verified.out_of_sight, undefined);
  const look = await json('look', {});
  assert.equal(look.panes[0].verified.checked, 4);
});

test('drawn otherwise than sent: the account names the value, what was sent and what was drawn', async () => {
  await json('show_view', { name: 'overdue', title: 'Overdue', panels: [{ card: 'kpi', title: 'Total', from: 'r1', value: 'sum(amount_nok)' }] });
  const seq = 2; // the second showing of "overdue"
  assert.equal(ui.event({ type: 'rendered', view: 'overdue', seq, surface: 'wide', got: [{ i: 0, text: '97,650 kr', visible: true }] }), true);
  const look = await json('look', {});
  assert.deepEqual(look.panes[0].verified.drift, [{ panel: 'total', sent: '97,650', drawn: '97,650 kr' }]);
});

test('an ask drawn by the default binding is answered by typing and clicking in the window', async () => {
  const answer = json('confirm_writeoff', { invoice: 'INV-2026-0398' });
  const pane = page.locator('.vindu-pane[data-view="ask-k1"]');
  await pane.locator('input').first().waitFor();
  await pane.locator('input').first().fill('Customer went bankrupt (synthetic)');
  await pane.getByText('Submit', { exact: true }).click();
  assert.deepEqual(await answer, { op: 'confirm_writeoff', id: 'p1', answer: { reason: 'Customer went bankrupt (synthetic)' }, output: { written_off: true } });
  await pane.waitFor({ state: 'detached' }); // answered: its pane leaves the window, and the page
});

test('the harness\'s questions, drawn in the window as it asks them and answered by clicking: its options, its diff, its choices', async () => {
  const pick = ui.permission({ title: 'Edit invoices.csv', tool: 'Edit', input: { file_path: '/work/invoices.csv' },
    content: [{ type: 'diff', path: '/work/invoices.csv', oldText: 'id,amount\nINV-1,100\nINV-2,80', newText: 'id,amount\nINV-1,120\nINV-2,80' }],
    options: [{ name: 'Yes' }, { name: "Yes, and don't ask again this session" }, { name: 'No' }] });
  const perm = page.locator('.vindu-pane[data-view^="ask-"]').last();
  await perm.getByText("Yes, and don't ask again this session", { exact: true }).waitFor();
  const drawn = await perm.innerText();
  for (const t of ['Edit invoices.csv', '- INV-1,100', '+ INV-1,120', 'change to /work/invoices.csv']) assert.ok(drawn.includes(t), t);
  assert.ok(!drawn.includes('INV-2,80')); // what does not change is left out
  const buttons: string[] = (await perm.locator('button').allInnerTexts()).map((b: string) => b.trim()).filter(Boolean); // the pane's own icon buttons have no text
  assert.deepEqual(buttons, ['Yes', "Yes, and don't ask again this session", 'No']); // its options, in its order
  await perm.getByText("Yes, and don't ask again this session", { exact: true }).click();
  assert.equal(await pick, 1);
  const answer = ui.ask({ message: 'Please answer the following questions.', schema: { type: 'object', properties: {
    question_0: { type: 'string', title: 'Cache', description: 'Which cache should the service use?', oneOf: [{ const: 'Redis', title: 'Redis', description: 'in memory, shared' }, { const: 'None', title: 'None' }] },
    question_1: { type: 'array', title: 'Checks', description: 'Which checks should run?', items: { anyOf: [{ const: 'lint', title: 'Lint' }, { const: 'unit', title: 'Unit tests' }, { const: 'e2e', title: 'End to end' }] } } } } });
  const form = page.locator('.vindu-pane[data-view^="ask-"]').last();
  await form.getByText('Which checks should run?').waitFor();
  await form.getByText('Redis — in memory, shared').click();
  await form.getByText('Lint', { exact: true }).click();
  await form.getByText('End to end', { exact: true }).click();
  await form.getByText('Submit', { exact: true }).click();
  assert.deepEqual(await answer, { action: 'accept', content: { question_0: 'Redis', question_1: ['lint', 'e2e'] } });
  assert.deepEqual(errors, []);
});

test('an MCP App: its own frame, its tool result exact, its call asked of the person, its report kept without the image', async () => {
  const a = await json('show_view', { name: 'app', title: 'Table app', panels: [{ card: 'app', from: 'r1' }] });
  assert.equal(a.panels[0].app, 'ui://db/table'); assert.match(a.panels[0].seen, /^opaque/);
  const frame = await (async () => { for (let i = 0; i < 100; i++) { const f = page.frames().find((x: any) => /^http:\/\/app-[a-f0-9]{32}\.localhost/.test(x.url())); if (f) return f; await sleep(50); } throw new Error('no app frame'); })();
  await frame.waitForFunction(() => document.getElementById('rows')!.textContent === 'INV-2026-0412,INV-2026-0419,INV-2026-0398');
  assert.equal(await frame.evaluate(() => document.getElementById('status')!.textContent), 'theme light');
  assert.equal(await frame.evaluate(() => document.body.dataset.limit), '3');
  assert.deepEqual(await page.evaluate(() => (window as any).hostCspViolations), []);
  assert.equal(await frame.evaluate(() => { try { return String((window.parent as any).document); } catch { return 'no access'; } }), 'no access'); // no same-origin rights
  void frame.evaluate(() => (window as any).callTool());
  const ask = page.locator('.vindu-pane[data-view^="ask-"]').last();
  await ask.getByText('Allow', { exact: true }).click();
  await frame.waitForFunction(() => document.getElementById('status')!.textContent.startsWith('called'));
  assert.equal(await frame.evaluate(() => document.getElementById('status')!.textContent), 'called: {"seen":true}');
  assert.deepEqual(calls, [['db', 'mark_seen', { id: 'INV-2026-0412' }]]);
  await frame.evaluate(() => (window as any).tell());
  await sleep(300);
  const told = ui.answers().at(-1) as any;
  assert.equal(told.by, 'app'); assert.deepEqual(told.values, { sortedBy: 'amount_nok', text: 'The person sorted by amount.', left_out: '1 non-text block' });
  assert.ok(!JSON.stringify(ui.answers()).includes('iVBORw0KGgo')); // no pixels for the model
  assert.deepEqual(errors, []);
});

test('two windows on the same task deliver each MCP App message only to its requesting mount', async () => {
  let view: Shown | undefined;
  const task = vindu.open({ results, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'two-windows-')) }, { onView: v => { view = v; }, apps: provider });
  const client = await mcpClient(task.url);
  const windows = await Promise.all([browser.newPage(), browser.newPage()]);
  try {
    await client.json('show_view', { name: 'shared', title: 'Shared', panels: [{ card: 'app', id: 'results', from: 'r1' }] });
    const mounts = await Promise.all(windows.map(async w => {
      await w.goto(page.url());
      await w.evaluate(({ view, state }: { view: Shown; state: ShellState }) => {
        const host = (window as any).app;
        host.shell('light'); host.view(view); host.state(state);
      }, { view: view!, state: task.shell() });
      const initialized = await w.waitForFunction(() => (window as any).app.events().find((e: any) =>
        e.type === 'app' && e.msg.method === 'ui/notifications/initialized'));
      return initialized.jsonValue();
    }));
    assert.notEqual(mounts[0].mount, mounts[1].mount);
    const responses: Record<string, unknown>[] = [];
    const reply = (_view: string, _panel: string, message: Record<string, unknown>) => responses.push(message);
    task.event(mounts[0], reply); task.event(mounts[1], reply);

    for (const [i, w] of windows.entries()) {
      const frame = w.frames().find((f: any) => f.url().startsWith('http://app-'));
      await frame.evaluate((windowOrigin: string) => {
        (window as any).delivered = [];
        addEventListener('message', ({ data, origin }) => {
          if (origin !== windowOrigin) return; // only what the window posts
          if (data?.method === 'ui/notifications/tool-result') (window as any).delivered.push(data.testRecipient);
          if (data === 'dispatch-finished') document.body.dataset.finished = 'true';
        });
      }, new URL(w.url()).origin);
      await w.evaluate((messages: Record<string, unknown>[]) => {
        const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-app-panel]')!;
        for (const msg of messages) (window as any).app.app('shared', 'results', msg);
        iframe.contentWindow!.postMessage('dispatch-finished', '*');
      }, responses.filter(m => m.method === 'ui/notifications/tool-result').map((m, recipient) => ({ ...m, testRecipient: recipient })));
      await frame.waitForFunction(() => document.body.dataset.finished === 'true');
      assert.deepEqual(await frame.evaluate(() => (window as any).delivered), [i]);
    }

    // A provider reload can reuse its Window. It must not receive a pending response for its previous mount.
    const firstWindow = windows[0];
    const firstFrame = firstWindow.frames().find((frame: Frame) => frame.url().startsWith('http://app-'))!;
    const negotiated = await firstFrame.evaluate(() => new Promise<string>(resolve => {
      function received(event: MessageEvent) {
        if (event.source !== parent || event.data?.id !== 'legacy-remount') return;
        removeEventListener('message', received);
        resolve(event.data.result.protocolVersion);
      }
      addEventListener('message', received);
      parent.postMessage({ jsonrpc: '2.0', id: 'legacy-remount', method: 'ui/initialize',
        params: { protocolVersion: '2025-11-21', appInfo: { name: 'legacy', version: '1' }, appCapabilities: {} } }, '*');
    }));
    assert.equal(negotiated, '2025-11-21');
    await firstFrame.evaluate(() => { delete document.body.dataset.finished; });
    await firstWindow.evaluate((mount: string) => {
      const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-app-panel]')!;
      (window as any).app.app('shared', 'results', { vinduMount: mount, method: 'ui/notifications/tool-result', testRecipient: 'stale' });
      iframe.contentWindow!.postMessage('dispatch-finished', '*');
    }, mounts[0].mount);
    await firstFrame.waitForFunction(() => document.body.dataset.finished === 'true');
    assert.deepEqual(await firstFrame.evaluate(() => (window as any).delivered), [0]);
  } finally { for (const w of windows) await w.close(); await client.mcp.close(); task.close(); }
});

const until = async (f: () => Promise<boolean>, ms = 4000) => { const t = Date.now() + ms; while (!(await f())) { if (Date.now() > t) throw new Error('timed out'); await sleep(60); } };
const lookAt = async (view: string) => (await json('look', {})).panes.find((p: any) => p.view === view);

test('a tab not open is drawn when the person opens it, and checked then: never a mismatch before; the tab stays open when shown again', async () => {
  const spec = { name: 'tabbed', title: 'Tabbed', tabs: [
    { title: 'Totals', panels: [{ card: 'kpi', title: 'Total', from: 'r1', value: 'sum(amount_nok)' }] },
    { title: 'Rows', panels: [{ card: 'table', id: 'rows', from: 'r1', columns: ['id', 'customer', 'amount_nok'] }] }] };
  const a = await json('show_view', spec);
  assert.equal(a.verified.tab_open, 'Totals', JSON.stringify(a.verified)); assert.equal(a.verified.checked, 1); assert.equal(a.verified.drift, undefined);
  assert.deepEqual(a.verified.in_tabs_not_open, { tabs: ['"Rows": rows'], note: 'A2UI draws only the tab that is open: these are checked when the person opens theirs' });
  await page.locator('.vindu-pane[data-view="tabbed"] .a2ui-tab-button', { hasText: 'Rows' }).click();
  await until(async () => (await lookAt('tabbed'))?.verified?.tab_open === 'Rows');
  const opened = (await lookAt('tabbed')).verified;
  assert.equal(opened.checked, 4); assert.equal(opened.same, 'every value checked is drawn as sent'); assert.equal(opened.in_tabs_not_open, undefined); // what was read in Totals stands
  const again = await json('show_view', spec); // shown again: the person's tab stays open
  assert.equal(again.verified.tab_open, 'Rows');
});

test('a page panel is read back too: its frame\'s size as drawn, whether it is in sight, and whether it loaded', async () => {
  const a = await json('show_view', { name: 'drawn', title: 'Drawn', panels: [{ card: 'page', id: 'p', html: '<!doctype html><title>P</title><h1>Page</h1>', height: 300 }] });
  assert.equal(a.verified.by, 'the window');
  await until(async () => ((await lookAt('drawn'))?.verified?.pages?.p ?? '').endsWith('loaded'));
  assert.match((await lookAt('drawn')).verified.pages.p, /^drawn \d+ × \d+ px, in sight, loaded$/);
});

test('the shelf in the window: a pane collapsed, peeked at without moving anything, dragged back beside a pane, and a pane dragged onto the shelf', async () => {
  await json('arrange', { layout: ['tabbed', 'drawn'] });
  await sleep(400);
  await page.hover('.vindu-pane[data-view="drawn"] .vindu-pane-head'); await page.click('.vindu-pane[data-view="drawn"] button[aria-label="Collapse"]');
  const chip = page.locator('.vindu-bar-shelf .vindu-bar-view', { hasText: 'Drawn' });
  await chip.waitFor();
  await chip.hover(); // a peek: the view above the shelf, the layout as it is
  await page.locator('.vindu-pane.is-peek[data-view="drawn"]').waitFor({ timeout: 3000 });
  const peeked = await json('look', {});
  assert.deepEqual(peeked.layout, 'tabbed'); assert.equal(peeked.collapsed.at(-1).view, 'drawn'); // the views the arrange left out are there too
  assert.deepEqual(peeked.person, ['collapsed "drawn" into the shelf']);
  // dragged from the shelf onto the right edge of the pane there
  const c = (await chip.boundingBox())!, pane = (await page.locator('.vindu-pane[data-view="tabbed"]').boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.down();
  await page.mouse.move(pane.x + pane.width - 60, pane.y + pane.height / 2, { steps: 8 });
  assert.equal(await page.locator('.vindu-drop').isVisible(), true); // where it would go, shown
  await page.mouse.up();
  let docked: any; await until(async () => (docked = await json('look', {})).layout?.row !== undefined); // the look that sees it hears of it
  assert.deepEqual(docked.layout, { row: ['tabbed', 'drawn'] }); assert.deepEqual(docked.person, ['opened "drawn" right of "tabbed"']);
  // a pane dragged by its title onto the shelf
  const head = (await page.locator('.vindu-pane[data-view="tabbed"] .vindu-pane-title').boundingBox())!, bar = (await page.locator('.vindu-bar').boundingBox())!;
  await page.mouse.move(head.x + 10, head.y + head.height / 2); await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2, { steps: 8 }); await page.mouse.up();
  await until(async () => (await json('look', {})).layout === 'drawn');
  assert.deepEqual((await json('look', {})).collapsed.at(-1), { view: 'tabbed', title: 'Tabbed', by: 'the person' });
  assert.deepEqual(errors, []);
});

test('a page sends to the model only while the person uses it: their click goes, a send on its own does not; await_answer waits for it, and it is heard once', async () => {
  const html = `<!doctype html><title>Term</title><input id="cmd" value="ls -la"><button id="go">Run</button><p id="out">-</p><p id="alone">-</p><script>
task.send('on its own').then(() => { document.getElementById('alone').textContent = 'sent'; }, e => { document.getElementById('alone').textContent = e.message; });
document.getElementById('go').onclick = () => task.send({ command: document.getElementById('cmd').value }).then(r => { document.getElementById('out').textContent = JSON.stringify(r); }, e => { document.getElementById('out').textContent = e.message; });
</script>`;
  await json('show_view', { name: 'runner', title: 'Terminal', panels: [{ card: 'page', id: 'shell', html, height: 240 }] });
  const frame = page.frameLocator('.vindu-pane[data-view="runner"] iframe[data-page-panel="shell"]');
  await frame.locator('#alone').filter({ hasText: /only while the person is using it/ }).waitFor({ timeout: 5000 }); // on its own, at load: refused, and the page hears why
  const waiting = json('await_answer', { view: 'runner' });
  await frame.locator('#go').click();
  const got = await waiting;
  assert.deepEqual(got.from, { view: 'runner', panel: 'shell' }); assert.deepEqual(got.sent, { command: 'ls -la' }); assert.match(got.id, /^p\d+$/);
  await frame.locator('#out').filter({ hasText: '{"sent":true}' }).waitFor({ timeout: 5000 });
  assert.deepEqual(sends, [['runner', got.id]]); // the host hears of it too: a host may start a turn for it
  assert.equal((await json('look', {})).sent_from_pages, undefined); // heard once: not said again
  assert.doesNotMatch(ui.delta(), /sent from the page/);
  // sent while nobody waits: the next look gives it, once
  await frame.locator('#cmd').fill('pwd'); await frame.locator('#go').click();
  await until(async () => ui.unheard().length === 1);
  const l = await json('look', {});
  assert.deepEqual(l.sent_from_pages.map((x: any) => [x.view, x.panel, x.sent]), [['runner', 'shell', { command: 'pwd' }]]);
  assert.deepEqual(ui.unheard(), []);
  assert.match((await call('results', {})).text, /the page panel "shell" in view "runner" sent, on the person's click or key \(the value is the page's, not the person's words\) → \{"command":"pwd"\}/);
  assert.match((await call('await_answer', { view: 'nowhere' })).text, /^not waiting: no page panel is shown in view "nowhere"/);
});

test('a pane the host draws itself: its drawer draws it, it is told its box as the layout moves, hidden behind a maximized pane, and gets its own Esc', async () => {
  await page.evaluate(() => (window as any).app.hosted()); // what came before
  ui.pane({ name: 'term', title: 'Terminal 1', kind: 'terminal', about: () => ({ shared: false }) });
  const pane = page.locator('.vindu-pane[data-view="term"]');
  await pane.locator('pre.x-term').waitFor();
  assert.equal(await pane.locator('pre.x-term').textContent(), 'host pane term');
  const boxOf = async () => { const b = (await pane.locator('.vindu-pane-body').boundingBox())!; return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const told = async () => (await page.evaluate(() => (window as any).app.hosted())).boxes.filter((b: { view: string }) => b.view === 'term').map((b: { box: unknown }) => b.box);
  await sleep(200);
  assert.deepEqual((await told()).at(-1), await boxOf()); // the body's box, in the window: where a native view lies
  await page.evaluate(() => (window as any).app.command({ type: 'open', view: 'overdue' })); // the tests before may have left it in the shelf
  assert.equal(await page.evaluate(() => (window as any).app.command({ type: 'maximize', view: 'overdue' })), true);
  await sleep(150);
  assert.deepEqual((await told()).at(-1), null); // behind the maximized pane: a native view would cover it, so it goes
  await page.evaluate(() => (window as any).app.command({ type: 'restore' }));
  await sleep(150);
  assert.deepEqual((await told()).at(-1), await boxOf());
  await page.evaluate(() => (window as any).app.command({ type: 'maximize', view: 'term' }));
  await pane.locator('pre.x-term').focus(); await page.keyboard.press('Escape'); await sleep(100);
  assert.equal((await page.evaluate(() => (window as any).app.placement())).mode, 'maximized'); // Esc in a terminal is the terminal's (vim's, say)
  await pane.locator('.vindu-pane-head button:visible').first().focus(); await page.keyboard.press('Escape'); await sleep(150); // a terminal's pane has no "In the chat" (hidden): its first button shown
  assert.notEqual((await page.evaluate(() => (window as any).app.placement())).mode, 'maximized'); // elsewhere, the window's
  assert.deepEqual((await told()).at(-1), await boxOf());
  const look = await json('look', {});
  assert.deepEqual(look.panes.find((p: { view: string }) => p.view === 'term').about, { shared: false });
  ui.unpane('term');
  for (let i = 0; i < 50 && await pane.count(); i++) await sleep(20);
  assert.equal(await pane.count(), 0);
  assert.equal((await page.evaluate(() => (window as any).app.hosted())).destroyed, 1);
  assert.deepEqual(errors, []);
});
