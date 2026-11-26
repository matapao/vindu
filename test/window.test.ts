// The window, drawn in Chromium, as a host app runs it: what the window reads back of what it drew, an ask answered
// by typing and clicking in the binding A2UI draws, the processor's own questions answered there by clicking, and an MCP
// App in its own frame, talking to its server through the host, its call asked of the person, what it reports kept
// without its image.
import { test } from 'vitest';
import type { Frame } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type ShellEvent, type Shown, type ShellState } from '../src/index.js';
import { answerOf, mcpClient, sleep } from './helpers.js';
import type { RpcMessage } from './globals.js';
import { results, calls, provider, browser, vindu, ui, json, page, errors } from './window-session.js';

test('the window reads back what it drew, and the account says so: every value checked, and what is out of sight', async () => {
  const a = await json('show_view', {
    name: 'overdue',
    title: 'Overdue',
    panels: [
      { card: 'kpi', title: 'Total', from: 'r1', value: 'sum(amount_nok)' },
      { card: 'table', from: 'r1', columns: ['id', 'customer', 'amount_nok'] },
    ],
  });
  assert.equal(a.verified.by, 'the window');
  assert.equal(a.verified.checked, 4); // the kpi and the first row's three cells
  assert.equal(a.verified.same, 'every value checked is drawn as sent');
  assert.equal(a.verified.out_of_sight, undefined);
  const look = await json('look', {});
  assert.equal(look.panes[0].verified.checked, 4);
});

test('drawn otherwise than sent: the account names the value, what was sent and what was drawn', async () => {
  await json('show_view', {
    name: 'overdue',
    title: 'Overdue',
    panels: [{ card: 'kpi', title: 'Total', from: 'r1', value: 'sum(amount_nok)' }],
  });
  const seq = 2; // the second showing of "overdue"
  assert.equal(
    ui.event({
      type: 'rendered',
      view: 'overdue',
      seq,
      surface: 'wide',
      got: [{ i: 0, text: '97,650 kr', visible: true }],
    }),
    true,
  );
  const look = await json('look', {});
  assert.deepEqual(look.panes[0].verified.drift, [{ panel: 'total', sent: '97,650', drawn: '97,650 kr' }]);
});

test('an ask drawn by the default binding is answered by typing and clicking in the window', async () => {
  const answer = json('confirm_writeoff', { invoice: 'INV-2026-0398' });
  const pane = page.locator('.vindu-pane[data-view="ask-k1"]');
  await pane.locator('input').first().waitFor();
  await pane.locator('input').first().fill('Customer went bankrupt (synthetic)');
  await pane.getByText('Submit', { exact: true }).click();
  assert.deepEqual(await answer, {
    op: 'confirm_writeoff',
    id: 'p1',
    answer: { reason: 'Customer went bankrupt (synthetic)' },
    output: { written_off: true },
  });
  await pane.waitFor({ state: 'detached' }); // answered: its pane leaves the window, and the page
});

test("the harness's questions, drawn in the window as it asks them and answered by clicking: its options, its diff, its choices", async () => {
  const pick = ui.permission({
    title: 'Edit invoices.csv',
    tool: 'Edit',
    input: { file_path: '/work/invoices.csv' },
    content: [
      {
        type: 'diff',
        path: '/work/invoices.csv',
        oldText: 'id,amount\nINV-1,100\nINV-2,80',
        newText: 'id,amount\nINV-1,120\nINV-2,80',
      },
    ],
    options: [{ name: 'Yes' }, { name: "Yes, and don't ask again this session" }, { name: 'No' }],
  });
  const perm = page.locator('.vindu-pane[data-view^="ask-"]').last();
  await perm.getByText("Yes, and don't ask again this session", { exact: true }).waitFor();
  const drawn = await perm.innerText();
  for (const t of ['Edit invoices.csv', '- INV-1,100', '+ INV-1,120', 'change to /work/invoices.csv'])
    assert.ok(drawn.includes(t), t);
  assert.ok(!drawn.includes('INV-2,80')); // what does not change is left out
  const buttons: string[] = (await perm.locator('button').allInnerTexts()).map((b: string) => b.trim()).filter(Boolean); // the pane's own icon buttons have no text
  assert.deepEqual(buttons, ['Yes', "Yes, and don't ask again this session", 'No']); // its options, in its order
  await perm.getByText("Yes, and don't ask again this session", { exact: true }).click();
  assert.equal(await pick, 1);
  const answer = ui.ask({
    message: 'Please answer the following questions.',
    schema: {
      type: 'object',
      properties: {
        question_0: {
          type: 'string',
          title: 'Cache',
          description: 'Which cache should the service use?',
          oneOf: [
            { const: 'Redis', title: 'Redis', description: 'in memory, shared' },
            { const: 'None', title: 'None' },
          ],
        },
        question_1: {
          type: 'array',
          title: 'Checks',
          description: 'Which checks should run?',
          items: {
            anyOf: [
              { const: 'lint', title: 'Lint' },
              { const: 'unit', title: 'Unit tests' },
              { const: 'e2e', title: 'End to end' },
            ],
          },
        },
      },
    },
  });
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
  assert.equal(a.panels[0].app, 'ui://db/table');
  assert.match(a.panels[0].seen, /^opaque/);
  const frame = await (async () => {
    for (let i = 0; i < 100; i++) {
      const f = page.frames().find((x) => /^http:\/\/app-[a-f0-9]{32}\.localhost/.test(x.url()));
      if (f) return f;
      await sleep(50);
    }
    throw new Error('no app frame');
  })();
  await frame.waitForFunction(
    () => document.getElementById('rows')!.textContent === 'INV-2026-0412,INV-2026-0419,INV-2026-0398',
  );
  assert.equal(await frame.evaluate(() => document.getElementById('status')!.textContent), 'theme light');
  assert.equal(await frame.evaluate(() => document.body.dataset.limit), '3');
  assert.deepEqual(await page.evaluate(() => window.hostCspViolations), []);
  assert.equal(
    await frame.evaluate(() => {
      try {
        return window.parent.document.nodeName;
      } catch {
        return 'no access';
      }
    }),
    'no access',
  ); // no same-origin rights
  void frame.evaluate(() => window.callTool());
  const ask = page.locator('.vindu-pane[data-view^="ask-"]').last();
  await ask.getByText('Allow', { exact: true }).click();
  await frame.waitForFunction(() => document.getElementById('status')!.textContent.startsWith('called'));
  assert.equal(await frame.evaluate(() => document.getElementById('status')!.textContent), 'called: {"seen":true}');
  assert.deepEqual(calls, [['db', 'mark_seen', { id: 'INV-2026-0412' }]]);
  await frame.evaluate(() => window.tell());
  await sleep(300);
  const told = answerOf(ui.answers().at(-1));
  assert.equal(told?.by, 'app');
  assert.deepEqual(told?.values, {
    sortedBy: 'amount_nok',
    text: 'The person sorted by amount.',
    left_out: '1 non-text block',
  });
  assert.ok(!JSON.stringify(ui.answers()).includes('iVBORw0KGgo')); // no pixels for the model
  assert.deepEqual(errors, []);
});

test('two windows on the same task deliver each MCP App message only to its requesting mount', async () => {
  let view: Shown | undefined;
  const task = vindu.open(
    { results, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'two-windows-')) },
    {
      onView: (v) => {
        view = v;
      },
      apps: provider,
    },
  );
  const client = await mcpClient(task.url);
  const windows = await Promise.all([browser.newPage(), browser.newPage()]);
  try {
    await client.json('show_view', {
      name: 'shared',
      title: 'Shared',
      panels: [{ card: 'app', id: 'results', from: 'r1' }],
    });
    const mounts = await Promise.all(
      windows.map(async (w) => {
        await w.goto(page.url());
        await w.evaluate(
          ({ view, state }: { view: Shown; state: ShellState }) => {
            const host = window.app;
            host.shell('light');
            host.view(view);
            host.state(state);
          },
          { view: view!, state: task.shell() },
        );
        const initialized = await w.waitForFunction(() =>
          window.app
            .events()
            .find(
              (e): e is Extract<ShellEvent, { type: 'app' }> =>
                e.type === 'app' && (e.msg as RpcMessage).method === 'ui/notifications/initialized',
            ),
        );
        const event = await initialized.jsonValue();
        assert.ok(event, 'the app initialized');
        return event;
      }),
    );
    assert.notEqual(mounts[0].mount, mounts[1].mount);
    const responses: Record<string, unknown>[] = [];
    const reply = (_view: string, _panel: string, message: Record<string, unknown>) => responses.push(message);
    task.event(mounts[0], reply);
    task.event(mounts[1], reply);

    for (const [i, w] of windows.entries()) {
      const frame = w.frames().find((f) => f.url().startsWith('http://app-'))!;
      await frame.evaluate((windowOrigin: string) => {
        window.delivered = [];
        addEventListener('message', ({ data, origin }) => {
          if (origin !== windowOrigin) return; // only what the window posts
          if (data?.method === 'ui/notifications/tool-result') window.delivered.push(data.testRecipient);
          if (data === 'dispatch-finished') document.body.dataset.finished = 'true';
        });
      }, new URL(w.url()).origin);
      await w.evaluate(
        (messages: Record<string, unknown>[]) => {
          const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-app-panel]')!;
          for (const msg of messages) window.app.app('shared', 'results', msg);
          iframe.contentWindow!.postMessage('dispatch-finished', '*');
        },
        responses
          .filter((m) => m.method === 'ui/notifications/tool-result')
          .map((m, recipient) => ({ ...m, testRecipient: recipient })),
      );
      await frame.waitForFunction(() => document.body.dataset.finished === 'true');
      assert.deepEqual(await frame.evaluate(() => window.delivered), [i]);
    }

    // A provider reload can reuse its Window. It must not receive a pending response for its previous mount.
    const firstWindow = windows[0];
    const firstFrame = firstWindow.frames().find((frame: Frame) => frame.url().startsWith('http://app-'))!;
    const negotiated = await firstFrame.evaluate(
      () =>
        new Promise<string>((resolve) => {
          function received(event: MessageEvent) {
            if (event.source !== parent || event.data?.id !== 'legacy-remount') return;
            removeEventListener('message', received);
            resolve(event.data.result.protocolVersion);
          }
          addEventListener('message', received);
          parent.postMessage(
            {
              jsonrpc: '2.0',
              id: 'legacy-remount',
              method: 'ui/initialize',
              params: { protocolVersion: '2025-11-21', appInfo: { name: 'legacy', version: '1' }, appCapabilities: {} },
            },
            '*',
          );
        }),
    );
    assert.equal(negotiated, '2025-11-21');
    await firstFrame.evaluate(() => {
      delete document.body.dataset.finished;
    });
    await firstWindow.evaluate((mount: string) => {
      const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-app-panel]')!;
      window.app.app('shared', 'results', {
        vinduMount: mount,
        method: 'ui/notifications/tool-result',
        testRecipient: 'stale',
      });
      iframe.contentWindow!.postMessage('dispatch-finished', '*');
    }, mounts[0].mount);
    await firstFrame.waitForFunction(() => document.body.dataset.finished === 'true');
    assert.deepEqual(await firstFrame.evaluate(() => window.delivered), [0]);
  } finally {
    for (const w of windows) await w.close();
    await client.mcp.close();
    task.close();
  }
});
