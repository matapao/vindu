// Terminals and browser pages as views of the ui server, next to cards: a real bash and a real Chromium, reached over
// real MCP as a processor reaches the ui server. The model reads a view with read_view and acts with act_in_view, only
// what the person shares; a command runs only on the person's yes; another site opens only on their yes, once; what the
// model reads goes to the host's record, and the answer says its id. No tool returns a picture.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { BrowserType } from 'playwright';
import { startVindu, memoryResults, BROWSER_ACTIONS, ACTIONS, type Cdp, type Shown } from '../src/index.js';
import { cdpOf, mcpClient, nodeOf, schemaOf, sleep } from './helpers.js';

const chromium: BrowserType = createRequire(import.meta.url)('playwright').chromium; // from the machine, as in browser.test
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (f: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(20);
  }
};
const site = http.createServer((_q, res) =>
  res
    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end(
      '<!doctype html><title>Ledger (synthetic)</title><h1>Invoices</h1><p>INV-2026-0412 · 31 050 kr · overdue</p><button onclick="this.textContent=\'Paid\'">Pay INV-2026-0412</button><a href="http://elsewhere.test:' +
        '0/">elsewhere</a>',
    ),
);
await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
const port = (site.address() as { port: number }).port,
  base = `http://127.0.0.1:${port}/`,
  other = `http://other-site.test:${port}/`;
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP other-site.test 127.0.0.1'] }); // "another site", served here
const vindu = await startVindu({ waitMs: 400 });
afterAll(async () => {
  await browser.close();
  site.close();
  await vindu.close();
});

/** A window with terminals and pages: what the host gives (a shell; a page shown in a tab, its CDP), and its record. */
function window(o: { run?: boolean; slow?: number } = {}) {
  const dir = tmp('task-'),
    work = tmp('work-'),
    shown: Shown[] = [],
    kept: { tool: string; input: unknown; result: unknown }[] = [],
    opened: { name: string; owner: string }[] = [];
  const ui = vindu.open(
    { results: memoryResults(dir), dir, work },
    {
      onView: (v) => shown.push(v),
      views: {
        terminal: {
          shell: 'bash',
          login: false,
          env: { PATH: process.env.PATH, HOME: tmp('home-'), HISTFILE: '/dev/null' },
          run: o.run,
        },
        browser: {
          open: async ({ name, owner }) => {
            opened.push({ name, owner });
            const tab = await browser.newPage();
            const s = await tab.context().newCDPSession(tab);
            const delay = () => (o.slow ? sleep(o.slow) : Promise.resolve());
            const c = cdpOf(s);
            return {
              send: async (m, p) => {
                await delay();
                return c.send(m, p);
              },
              on: (e, f) => c.on(e, f),
            } satisfies Cdp;
          },
        },
      },
      record: (e) => {
        kept.push(e);
        return `r${kept.length}`;
      },
    },
  );
  const askShown = async () => {
    await until(() => shown.some((v) => v.ask));
    const a = shown
      .splice(0)
      .filter((v) => v.ask)
      .at(-1)!;
    return a;
  };
  const answer = (a: Shown, yes: boolean) =>
    ui.event({ type: 'action', view: a.name, name: yes ? 'answer' : 'decline', context: { ticket: a.ask!.ticket } });
  return { ui, views: ui.views!, shown, kept, opened, askShown, answer };
}

test('a terminal is a view: the person opens it; the model reads it through read_view once shared; what the person ran is told once; each read is kept, with its id', async () => {
  const w = window();
  const { mcp, call, json } = await mcpClient(w.ui.url);
  try {
    const t = w.views.openTerminal({ cols: 80, rows: 20 });
    assert.equal(t.id, 't1');
    const look = await json('look', {});
    const pane = look.panes.find((p: { view: string }) => p.view === 't1');
    assert.equal(pane.kind, 'terminal');
    assert.deepEqual(pane.about, { shared: false }); // nothing more of a terminal not shared
    assert.match(
      (await call('read_view', { view: 't1' })).text,
      /^not done: the person has not shared Terminal 1 with you; they can, from its pane$/,
    );
    await until(() => w.views.terminals!.screen('t1').length > 0);
    w.views.terminals!.input('t1', 'echo synthetic-$((6*7))\r'); // the person, before sharing it: not told
    await until(() => w.views.terminals!.commands('t1').length === 1);
    await w.views.share('t1', true);
    w.views.terminals!.input('t1', 'ls /nope-synthetic\r');
    await until(() => w.views.terminals!.commands('t1').length === 2 && !w.views.terminals!.info('t1').busy);
    const note = w.ui.delta();
    const ls =
      process.platform === 'darwin'
        ? { exit: 1, says: 'ls: /nope-synthetic: No such file or directory' }
        : { exit: 2, says: "ls: cannot access '/nope-synthetic': No such file or directory" }; // BSD ls (macOS) and GNU ls
    assert.match(
      note,
      new RegExp(
        `the person shared Terminal 1 with you; the person ran \`ls /nope-synthetic\` in Terminal 1 \\(exit ${ls.exit}\\)`,
      ),
    );
    assert.doesNotMatch(note, /synthetic-\$/); // what ran before it was shared is not told
    const r = await json('read_view', { view: 't1', last: 2 });
    assert.equal(r.id, 'r1');
    assert.equal(r.kind, 'terminal'); // kept under an id, which a view can point at
    assert.deepEqual(
      r.commands.map((c: { command: string; exit: number; output: string }) => [c.command, c.exit, c.output]),
      [
        ['echo synthetic-$((6*7))', 0, 'synthetic-42'],
        ['ls /nope-synthetic', ls.exit, ls.says],
      ],
    );
    assert.equal(w.kept[0].tool, 'read_view');
    assert.deepEqual(w.kept[0].input, { view: 't1', last: 2 });
    assert.deepEqual((w.kept[0].result as { commands: unknown }).commands, r.commands);
    assert.match(
      (await call('act_in_view', { view: 't1', action: 'run', command: 'echo x' })).text,
      /Invalid arguments for tool act_in_view: action/,
    ); // not offered here
    assert.match(
      (await call('act_in_view', { view: 't1', action: 'click', ref: 'e1' })).text,
      /a terminal is only read here: running commands in the person's terminals is off in this app/,
    );
    await w.views.share('t1', false);
    assert.match(w.ui.delta(), /the person stopped sharing Terminal 1 with you/);
    await w.views.end('t1');
    assert.equal(
      w.ui.shell().views.some((v) => v.name === 't1'),
      false,
    );
  } finally {
    await mcp.close();
    w.ui.close();
  }
});

test('the model runs a command in a shared terminal only where the person allows it, and each only after their yes', async () => {
  const w = window({ run: true });
  const { mcp, json, call: mcpCall } = await mcpClient(w.ui.url);
  try {
    w.views.openTerminal();
    await w.views.share('t1', true);
    await until(() => w.views.terminals!.screen('t1').length > 0);
    assert.match(
      (await mcpCall('act_in_view', { view: 't1', action: 'click', ref: 'e1' })).text,
      /a terminal takes one action: run, with a command \(not "click"\)/,
    );
    const ran = json('act_in_view', { view: 't1', action: 'run', command: 'echo from-the-model' });
    const a1 = await w.askShown();
    assert.equal(a1.ask!.title, 'Run this in Terminal 1?');
    assert.deepEqual(a1.ask!.details, [{ label: 'command', text: 'echo from-the-model' }]); // the exact command, first
    w.answer(a1, true);
    const r1 = await ran;
    assert.equal(r1.ran, true);
    assert.equal(r1.done.output, 'from-the-model');
    assert.equal(r1.done.by, 'model');
    assert.ok(r1.id);
    assert.doesNotMatch(w.ui.delta(), /from-the-model/); // the model's own is not told back as the person's
    const no = json('act_in_view', { view: 't1', action: 'run', command: 'rm -rf build' });
    w.answer(await w.askShown(), false);
    assert.deepEqual(await no, { id: 'r2', view: 't1', ran: false, declined: 'the person said no' });
    assert.deepEqual(
      w.views.terminals!.commands('t1').map((c) => c.command),
      ['echo from-the-model'],
    ); // nothing else ran
  } finally {
    await mcp.close();
    w.ui.close();
  }
});

test("a browser view: the model opens its own page with show_view, reads it and acts by reference; another site waits for the person's yes, once", async () => {
  const w = window();
  const { mcp, call, json } = await mcpClient(w.ui.url);
  try {
    const opened = await json('show_view', { name: 'ledger', title: 'Ledger', browser: { url: base } }); // this machine: no ask
    assert.equal(opened.view, 'ledger');
    assert.equal(opened.owner, 'model');
    assert.equal(opened.snapshot.title, 'Ledger (synthetic)');
    assert.ok(opened.id);
    assert.deepEqual(w.opened, [{ name: 'ledger', owner: 'model' }]);
    assert.equal(w.shown.filter((v) => v.ask).length, 0);
    const pay = opened.snapshot.tree.find((n: { role: string }) => n.role === 'button');
    const clicked = await json('act_in_view', { view: 'ledger', action: 'click', ref: pay.ref });
    assert.equal(clicked.did, 'click');
    assert.equal(clicked.snapshot.tree.find((n: { role: string }) => n.role === 'button').name, 'Paid');
    const look = (await json('look', {})).panes.find((p: { view: string }) => p.view === 'ledger');
    assert.equal(look.kind, 'browser');
    assert.equal(look.about.owner, 'model');
    assert.equal(look.about.url, base);
    // another site: asked, once per site
    const first = json('show_view', { name: 'other', title: 'Other', browser: { url: other } });
    const a1 = await w.askShown();
    assert.equal(a1.ask!.title, `Let the model open other-site.test:${port}?`);
    assert.deepEqual(a1.ask!.details, [{ label: 'address', text: other }]);
    w.answer(a1, false);
    assert.deepEqual(await first, {
      view: 'other',
      opened: false,
      declined: `the person did not let the model open other-site.test:${port}`,
      shell: (await first).shell,
    });
    assert.equal(
      w.ui.shell().views.some((v) => v.name === 'other'),
      false,
    );
    const second = json('show_view', { name: 'other', title: 'Other', browser: { url: other } });
    w.answer(await w.askShown(), true);
    assert.equal((await second).snapshot.title, 'Ledger (synthetic)');
    await json('act_in_view', { view: 'other', action: 'go_to', url: `${other}?again` }); // the same site: no second ask
    assert.equal(w.shown.filter((v) => v.ask).length, 0);
    assert.equal(w.views.needsAsk('ledger', 'http://elsewhere.test/'), true); // the host stops the model's page from opening it unasked
    assert.match(
      (await call('act_in_view', { view: 'ledger', action: 'go_to', url: 'file:///etc/passwd' })).text,
      /only http and https/,
    );
    // the person's page: theirs until shared
    const mine = await w.views.openPage(base);
    assert.equal(w.opened.at(-1)!.owner, 'person');
    assert.match((await call('read_view', { view: mine })).text, /the person has not shared Browser 1 with you/);
    assert.equal(w.views.needsAsk(mine, 'http://elsewhere.test/'), false); // the person's own browsing is theirs
    await w.views.share(mine, true);
    const read = await json('read_view', { view: mine, log: true });
    assert.equal(read.owner, 'person');
    assert.equal(read.snapshot.title, 'Ledger (synthetic)');
    assert.deepEqual(Object.keys(read.log), ['messages', 'failures']);
    const waited = await json('act_in_view', { view: mine, action: 'wait', text: 'INV-2026-0412' });
    assert.equal(waited.found, true);
    assert.equal(waited.snapshot.title, 'Ledger (synthetic)'); // the page as it is once the text came
    assert.equal(w.views.needsAsk(mine, 'http://elsewhere.test/'), true); // just after the model acted in it: its doing
    const { tools } = await mcp.listTools();
    for (const t of tools) assert.doesNotMatch(`${t.name} ${t.description}`, /screenshot|image of|picture of/i);
  } finally {
    await mcp.close();
    w.ui.close();
  }
});

test("a browser view is placed like any view: show_view's place; collapsed by the person, it stays in the shelf when shown again, until opened; open, place moves it", async () => {
  const w = window();
  const { mcp, json } = await mcpClient(w.ui.url);
  try {
    w.ui.event({ type: 'window', w: 1200, h: 800 });
    await json('show_view', { name: 'totals', title: 'Totals', panels: [{ card: 'text', text: 'Synthetic totals.' }] });
    const opened = await json('show_view', {
      name: 'docs',
      title: 'Docs',
      browser: { url: base },
      place: { beside: 'totals', side: 'below' },
    });
    assert.equal(opened.snapshot.title, 'Ledger (synthetic)');
    const where = () => nodeOf(w.ui.shell().tree);
    assert.equal(where().dir, 'column');
    assert.deepEqual(where().children, ['totals', 'docs']); // below, as asked
    assert.equal(w.ui.event({ type: 'collapse', view: 'docs' }), true); // the person puts it in the shelf
    const again = await json('show_view', {
      name: 'docs',
      title: 'Docs',
      browser: { url: `${base}?v=2` },
      place: { beside: 'totals', side: 'right' },
    });
    assert.equal(again.snapshot.url, `${base}?v=2`); // the page goes on where it is, in the shelf
    assert.equal(where().view, 'totals');
    assert.equal(w.ui.shell().shelf.docs?.updated, true); // the person's shelf holds: marked as updated, not opened
    assert.match(again.notes.join(' '), /"docs" is collapsed in the shelf, where the person put it/);
    await json('arrange', { open: 'docs' });
    assert.equal(where().dir, 'column');
    assert.deepEqual(where().children, ['totals', 'docs']); // opened: back where it was, below
    await json('show_view', {
      name: 'docs',
      title: 'Docs',
      browser: { url: `${base}?v=3` },
      place: { beside: 'totals', side: 'right' },
    });
    assert.equal(where().dir, 'row');
    assert.deepEqual(where().children, ['totals', 'docs']); // in a pane, place moves it
  } finally {
    await mcp.close();
    w.ui.close();
  }
});

test('a page the person opens is usable the moment its pane shows, while it is still opening', async () => {
  const w = window({ slow: 60 }); // each CDP call takes 60 ms: the pane shows well before the page is ready
  try {
    const opening = w.views.openPage(base);
    await until(() => w.ui.shell().views.some((v) => v.kind === 'browser'));
    const name = w.ui.shell().views.find((v) => v.kind === 'browser')!.name;
    assert.equal(await w.views.share(name, true), true); // waits for the page, rather than failing
    assert.equal((await w.views.page(name)).shared, true);
    assert.equal(await opening, name);
    await w.views.end(name);
    assert.equal(w.views.kindOf(name), undefined);
  } finally {
    w.ui.close();
  }
});

test('the model is told of terminals and pages only where the window has them: in words, in fields and in tools', async () => {
  const dir = tmp('task-');
  const plain = vindu.open({ results: memoryResults(dir), dir });
  const reads = vindu.open(
    { results: memoryResults(dir), dir },
    { views: { terminal: { shell: 'bash', login: false } } },
  ); // terminals the model may only read
  const both = window({ run: true }).ui;
  const told = async (url: string) => {
    const { mcp } = await mcpClient(url);
    const { tools } = await mcp.listTools();
    const r = {
      words: mcp.getInstructions() ?? '',
      tools: Object.fromEntries(tools.map((t) => [t.name, schemaOf(t)])),
      about: Object.fromEntries(tools.map((t) => [t.name, t.description ?? ''])),
    };
    await mcp.close();
    return r;
  };
  try {
    const p = await told(plain.url),
      t = await told(reads.url),
      b = await told(both.url);
    assert.doesNotMatch(p.words + plain.note, /terminal|browser page/); // a window without them: not a word of them
    assert.deepEqual(p.tools.act_in_view.properties.action.enum, [...ACTIONS]); // act_in_view acts in views of cards, as the person can
    assert.doesNotMatch(p.about.act_in_view, /terminal|browser page/);
    assert.equal(p.tools.act_in_view.properties.url, undefined);
    assert.equal(p.tools.show_view.properties.browser, undefined);
    assert.deepEqual(Object.keys(p.tools.read_view.properties), ['view']); // read_view still reads a view of cards
    assert.match(t.words, /the person opens terminals/);
    assert.doesNotMatch(t.words + reads.note, /browser page|act_in_view acts in one/);
    assert.deepEqual(t.tools.act_in_view.properties.action.enum, [...ACTIONS]); // views of cards only: the model may not run commands here
    assert.equal(t.tools.act_in_view.properties.command, undefined);
    assert.deepEqual(Object.keys(t.tools.read_view.properties).sort(), ['last', 'max', 'screen', 'view']);
    assert.match(b.words, /a terminal or a browser page/);
    assert.match(both.note, /a terminal the person shares with you, or a browser page/);
    assert.deepEqual(b.tools.act_in_view.properties.action.enum, [
      ...ACTIONS,
      ...BROWSER_ACTIONS.filter((a) => !(ACTIONS as readonly string[]).includes(a)),
      'run',
    ]);
    assert.ok(b.tools.show_view.properties.browser); // select: a row in a view of cards, an option in a page
    assert.match(b.tools.act_in_view.properties.key.description, /the row's key.*press, in a page/); // one field, both meanings said
  } finally {
    plain.close();
    reads.close();
    both.close();
  }
});

test('the person points at lines of a terminal: the text, where it is, and the command that printed it', async () => {
  const w = window();
  try {
    w.views.openTerminal({ cols: 80, rows: 20 });
    await until(() => w.views.terminals!.screen('t1').length > 0);
    w.views.terminals!.input('t1', 'printf "synthetic-total %s\\n" $((31050+17160))\r');
    await until(() => w.views.terminals!.commands('t1').length === 1 && !w.views.terminals!.info('t1').busy);
    assert.equal(
      w.ui.event({ type: 'select', by: 'pane', items: [{ view: 't1', lines: [3, 3], text: 'synthetic-total 48210' }] }),
      true,
    );
    assert.deepEqual(w.ui.selection(), [
      {
        view: 't1',
        kind: 'terminal',
        lines: [3, 3],
        text: 'synthetic-total 48210',
        command: { n: 1, command: 'printf "synthetic-total %s\\n" $((31050+17160))' },
      },
    ]);
    w.ui.event({ type: 'select', items: [{ view: 't1', text: 'not printed by any command' }] });
    assert.deepEqual(w.ui.selection(), [{ view: 't1', kind: 'terminal', text: 'not printed by any command' }]);
  } finally {
    w.ui.close();
  }
});

test('stopping terminal sharing cancels an outstanding approval even after sharing resumes', async () => {
  const w = window({ run: true });
  const { mcp, call } = await mcpClient(w.ui.url);
  try {
    const terminal = w.views.openTerminal();
    await w.views.share(terminal.id, true);
    const pending = call('act_in_view', { view: terminal.id, action: 'run', command: 'echo fixture' });
    const ask = await w.askShown();
    await w.views.share(terminal.id, false);
    await w.views.share(terminal.id, true);
    w.answer(ask, true);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.text, /stopped sharing/);
    assert.deepEqual(w.views.terminals!.commands(terminal.id), []);
  } finally {
    await mcp.close();
    w.ui.close();
  }
});
