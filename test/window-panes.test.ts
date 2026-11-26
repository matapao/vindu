// The window's panes, drawn in Chromium as a host app runs it: a tab not open drawn when opened, a page panel read back,
// the shelf, what a page sends while the person uses it, and a pane the host draws itself.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { paneIn, sleep, type Look, type LookPane } from './helpers.js';
import { sends, ui, call, json, page, errors } from './window-session.js';

const until = async (f: () => Promise<boolean>, ms = 4000) => {
  const t = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > t) throw new Error('timed out');
    await sleep(60);
  }
};
const lookAt = async (view: string) => (await json('look', {})).panes.find((p: LookPane) => p.view === view);

test('a tab not open is drawn when the person opens it, and checked then: never a mismatch before; the tab stays open when shown again', async () => {
  const spec = {
    name: 'tabbed',
    title: 'Tabbed',
    tabs: [
      { title: 'Totals', panels: [{ card: 'kpi', title: 'Total', from: 'r1', value: 'sum(amount_nok)' }] },
      { title: 'Rows', panels: [{ card: 'table', id: 'rows', from: 'r1', columns: ['id', 'customer', 'amount_nok'] }] },
    ],
  };
  const a = await json('show_view', spec);
  assert.equal(a.verified.tab_open, 'Totals', JSON.stringify(a.verified));
  assert.equal(a.verified.checked, 1);
  assert.equal(a.verified.drift, undefined);
  assert.deepEqual(a.verified.in_tabs_not_open, {
    tabs: ['"Rows": rows'],
    note: 'A2UI draws only the tab that is open: these are checked when the person opens theirs',
  });
  await page.locator('.vindu-pane[data-view="tabbed"] .a2ui-tab-button', { hasText: 'Rows' }).click();
  await until(async () => (await lookAt('tabbed'))?.verified?.tab_open === 'Rows');
  const opened = paneIn(await json('look', {}), 'tabbed').verified;
  assert.equal(opened.checked, 4);
  assert.equal(opened.same, 'every value checked is drawn as sent');
  assert.equal(opened.in_tabs_not_open, undefined); // what was read in Totals stands
  const again = await json('show_view', spec); // shown again: the person's tab stays open
  assert.equal(again.verified.tab_open, 'Rows');
});

test("a page panel is read back too: its frame's size as drawn, whether it is in sight, and whether it loaded", async () => {
  const a = await json('show_view', {
    name: 'drawn',
    title: 'Drawn',
    panels: [{ card: 'page', id: 'p', html: '<!doctype html><title>P</title><h1>Page</h1>', height: 300 }],
  });
  assert.equal(a.verified.by, 'the window');
  await until(async () => ((await lookAt('drawn'))?.verified?.pages?.p ?? '').endsWith('loaded'));
  assert.match(paneIn(await json('look', {}), 'drawn').verified.pages.p, /^drawn \d+ × \d+ px, in sight, loaded$/);
});

test('the shelf in the window: a pane collapsed, peeked at without moving anything, dragged back beside a pane, and a pane dragged onto the shelf', async () => {
  await json('arrange', { layout: ['tabbed', 'drawn'] });
  await sleep(400);
  await page.hover('.vindu-pane[data-view="drawn"] .vindu-pane-head');
  await page.click('.vindu-pane[data-view="drawn"] button[aria-label="Collapse"]');
  const chip = page.locator('.vindu-bar-shelf .vindu-bar-view', { hasText: 'Drawn' });
  await chip.waitFor();
  await chip.hover(); // a peek: the view above the shelf, the layout as it is
  await page.locator('.vindu-pane.is-peek[data-view="drawn"]').waitFor({ timeout: 3000 });
  const peeked = await json('look', {});
  assert.deepEqual(peeked.layout, 'tabbed');
  assert.equal(peeked.collapsed.at(-1).view, 'drawn'); // the views the arrange left out are there too
  assert.deepEqual(peeked.person, ['collapsed "drawn" into the shelf']);
  // dragged from the shelf onto the right edge of the pane there
  const c = (await chip.boundingBox())!,
    pane = (await page.locator('.vindu-pane[data-view="tabbed"]').boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(pane.x + pane.width - 60, pane.y + pane.height / 2, { steps: 8 });
  assert.equal(await page.locator('.vindu-drop').isVisible(), true); // where it would go, shown
  await page.mouse.up();
  let docked: Look | undefined;
  await until(async () => (docked = await json('look', {})).layout?.row !== undefined); // the look that sees it hears of it
  assert.ok(docked);
  assert.deepEqual(docked.layout, { row: ['tabbed', 'drawn'] });
  assert.deepEqual(docked.person, ['opened "drawn" right of "tabbed"']);
  // a pane dragged by its title onto the shelf
  const head = (await page.locator('.vindu-pane[data-view="tabbed"] .vindu-pane-title').boundingBox())!,
    bar = (await page.locator('.vindu-bar').boundingBox())!;
  await page.mouse.move(head.x + 10, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2, { steps: 8 });
  await page.mouse.up();
  await until(async () => (await json('look', {})).layout === 'drawn');
  assert.deepEqual((await json('look', {})).collapsed.at(-1), { view: 'tabbed', title: 'Tabbed', by: 'the person' });
  assert.deepEqual(errors, []);
});

test('a page sends to the model only while the person uses it: their click goes, a send on its own does not; await_answer waits for it, and it is heard once', async () => {
  const html = `<!doctype html><title>Term</title><input id="cmd" value="ls -la"><button id="go">Run</button><p id="out">-</p><p id="alone">-</p><script>
task.send('on its own').then(() => { document.getElementById('alone').textContent = 'sent'; }, e => { document.getElementById('alone').textContent = e.message; });
document.getElementById('go').onclick = () => task.send({ command: document.getElementById('cmd').value }).then(r => { document.getElementById('out').textContent = JSON.stringify(r); }, e => { document.getElementById('out').textContent = e.message; });
</script>`;
  await json('show_view', {
    name: 'runner',
    title: 'Terminal',
    panels: [{ card: 'page', id: 'shell', html, height: 240 }],
  });
  const frame = page.frameLocator('.vindu-pane[data-view="runner"] iframe[data-page-panel="shell"]');
  await frame
    .locator('#alone')
    .filter({ hasText: /only while the person is using it/ })
    .waitFor({ timeout: 5000 }); // on its own, at load: refused, and the page hears why
  const waiting = json('await_answer', { view: 'runner' });
  await frame.locator('#go').click();
  const got = await waiting;
  assert.deepEqual(got.from, { view: 'runner', panel: 'shell' });
  assert.deepEqual(got.sent, { command: 'ls -la' });
  assert.match(got.id, /^p\d+$/);
  await frame.locator('#out').filter({ hasText: '{"sent":true}' }).waitFor({ timeout: 5000 });
  assert.deepEqual(sends, [['runner', got.id]]); // the host hears of it too: a host may start a turn for it
  assert.equal((await json('look', {})).sent_from_pages, undefined); // heard once: not said again
  assert.doesNotMatch(ui.delta(), /sent from the page/);
  // sent while nobody waits: the next look gives it, once
  await frame.locator('#cmd').fill('pwd');
  await frame.locator('#go').click();
  await until(async () => ui.unheard().length === 1);
  const l: { sent_from_pages: { view: string; panel: string; sent: unknown }[] } = await json('look', {});
  assert.deepEqual(
    l.sent_from_pages.map((x) => [x.view, x.panel, x.sent]),
    [['runner', 'shell', { command: 'pwd' }]],
  );
  assert.deepEqual(ui.unheard(), []);
  assert.match(
    (await call('results', {})).text,
    /the page panel "shell" in view "runner" sent, on the person's click or key \(the value is the page's, not the person's words\) → \{"command":"pwd"\}/,
  );
  assert.match(
    (await call('await_answer', { view: 'nowhere' })).text,
    /^not waiting: no page panel is shown in view "nowhere"/,
  );
});

test('a pane the host draws itself: its drawer draws it, it is told its box as the layout moves, hidden behind a maximized pane, and gets its own Esc', async () => {
  await page.evaluate(() => window.app.hosted()); // what came before
  ui.pane({ name: 'term', title: 'Terminal 1', kind: 'terminal', about: () => ({ shared: false }) });
  const pane = page.locator('.vindu-pane[data-view="term"]');
  await pane.locator('pre.x-term').waitFor();
  assert.equal(await pane.locator('pre.x-term').textContent(), 'host pane term');
  const boxOf = async () => {
    const b = (await pane.locator('.vindu-pane-body').boundingBox())!;
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const told = async () =>
    (await page.evaluate(() => window.app.hosted())).boxes
      .filter((b: { view: string }) => b.view === 'term')
      .map((b: { box: unknown }) => b.box);
  const placedMode = async () => {
    const placed = await page.evaluate(() => window.app.placement());
    assert.ok(placed, 'the window is placed');
    return placed.mode;
  };
  await sleep(200);
  assert.deepEqual((await told()).at(-1), await boxOf()); // the body's box, in the window: where a native view lies
  await page.evaluate(() => window.app.command({ type: 'open', view: 'runner' })); // the tests before may have left it in the shelf
  assert.equal(await page.evaluate(() => window.app.command({ type: 'maximize', view: 'overdue' })), false); // a kpi alone is small: never fullscreen
  assert.equal(await page.evaluate(() => window.app.command({ type: 'maximize', view: 'runner' })), true);
  await sleep(150);
  assert.deepEqual((await told()).at(-1), null); // behind the maximized pane: a native view would cover it, so it goes
  await page.evaluate(() => window.app.command({ type: 'restore' }));
  await sleep(150);
  assert.deepEqual((await told()).at(-1), await boxOf());
  await page.evaluate(() => window.app.command({ type: 'maximize', view: 'term' }));
  await pane.locator('pre.x-term').focus();
  await page.keyboard.press('Escape');
  await sleep(100);
  assert.equal(await placedMode(), 'maximized'); // Esc in a terminal is the terminal's (vim's, say)
  await pane.locator('.vindu-pane-head button:visible').first().focus();
  await page.keyboard.press('Escape');
  await sleep(150); // a terminal's pane has no "In the chat" (hidden): its first button shown
  assert.notEqual(await placedMode(), 'maximized'); // elsewhere, the window's
  assert.deepEqual((await told()).at(-1), await boxOf());
  const look = await json('look', {});
  assert.deepEqual(look.panes.find((p: { view: string }) => p.view === 'term').about, { shared: false });
  ui.unpane('term');
  for (let i = 0; i < 50 && (await pane.count()); i++) await sleep(20);
  assert.equal(await pane.count(), 0);
  assert.equal((await page.evaluate(() => window.app.hosted())).destroyed, 1);
  assert.deepEqual(errors, []);
});
