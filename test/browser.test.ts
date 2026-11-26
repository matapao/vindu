// A page in a real Chromium, reached over CDP as Electron's own debugger would reach a pane's page: the accessibility
// tree with references, actions by reference, navigation, and what the page logged and failed to load. No pixels.
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import type { BrowserType } from 'playwright';
import { BrowserPage, Browsers, Views, webAddress, type ViewHost, type Cdp, type PageNode } from '../src/index.js';
import { cdpOf } from './helpers.js';

// playwright comes from the machine (an optional peer of vindu), so it is loaded the CommonJS way
const chromium: BrowserType = createRequire(import.meta.url)('playwright').chromium;

const PAGE = `<!doctype html><title>Invoices (synthetic)</title><h1>Invoices</h1>
<label>Customer <input id="c" name="customer"></label>
<label>Status <select id="s"><option value="open">Open</option><option value="paid">Paid</option></select></label>
<button onclick="document.getElementById('out').textContent = 'Found ' + document.getElementById('c').value + ' / ' + document.getElementById('s').value">Search</button>
<p id="out"></p><a href="/next">Next page</a><img src="/missing.png" alt="logo">
<script>console.error('a synthetic error, for the test'); console.log('ready');</script>`;
const site = http.createServer((req, res) => {
  if (req.url === '/') res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE);
  else if (req.url === '/next')
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Next</title><h2>Second page</h2>');
  else if (req.url === '/to-slow')
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<!doctype html><title>Start</title><a href="/slow">A slow page</a>');
  else if (req.url === '/slow')
    setTimeout(
      () =>
        res
          .writeHead(200, { 'Content-Type': 'text/html' })
          .end('<!doctype html><title>Slow (synthetic)</title><h1>Arrived</h1>'),
      700,
    );
  else res.writeHead(404).end();
});
await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
const browser = await chromium.launch();
afterAll(async () => {
  await browser.close();
  site.close();
});

const find = (nodes: PageNode[], f: (n: PageNode) => boolean): PageNode | undefined => {
  for (const n of nodes) {
    if (f(n)) return n;
    const c = n.children && find(n.children, f);
    if (c) return c;
  }
  return undefined;
};

test('a page as its accessibility tree says it is; actions by reference; what it logged and failed to load', async () => {
  const tab = await browser.newPage();
  const session = await tab.context().newCDPSession(tab);
  const cdp: Cdp = cdpOf(session);
  const browsers = new Browsers();
  const page = await browsers.add('b1', cdp);
  assert.deepEqual(await page.navigate(base + '/'), { url: base + '/' });
  const snap = await page.snapshot();
  assert.equal(snap.title, 'Invoices (synthetic)');
  assert.equal(snap.url, base + '/');
  assert.deepEqual(
    find(snap.tree, (n) => n.role === 'heading'),
    { role: 'heading', name: 'Invoices', level: 1 },
  );
  const box = find(snap.tree, (n) => n.role === 'textbox')!,
    status = find(snap.tree, (n) => n.role === 'combobox')!,
    search = find(snap.tree, (n) => n.role === 'button')!;
  const next = find(snap.tree, (n) => n.role === 'link')!;
  assert.equal(box.name, 'Customer');
  assert.equal(status.name, 'Status');
  assert.equal(search.name, 'Search');
  assert.deepEqual(
    [box.ref, status.ref, search.ref].every((r) => /^e\d+$/.test(r ?? '')),
    true,
  );
  assert.equal(next.url, base + '/next');
  assert.ok(find(snap.tree, (n) => n.role === 'image' && n.name === 'logo'));
  await page.type(box.ref!, 'Havgap Media');
  await page.select(status.ref!, 'Paid');
  await assert.rejects(page.select(status.ref!, 'Lost'), /no option "Lost"; options: Open, Paid/);
  await page.click(search.ref!);
  assert.equal((await page.wait({ text: 'Found Havgap Media / paid', timeoutMs: 3000 })).found, true);
  const after = await page.snapshot();
  assert.equal(find(after.tree, (n) => n.role === 'textbox')!.value, 'Havgap Media');
  const c = page.console();
  assert.ok(c.messages.some((m) => m.level === 'error' && m.text === 'a synthetic error, for the test'));
  assert.ok(c.messages.some((m) => m.level === 'log' && m.text === 'ready'));
  assert.ok(c.failures.some((f) => f.url === base + '/missing.png' && f.status === 404));
  await page.click(find(after.tree, (n) => n.role === 'link')!.ref!);
  await page.wait({ text: 'Second page' });
  assert.equal(page.url, base + '/next');
  await assert.rejects(page.click(search.ref!), /no element "e\d+" in the latest snapshot/); // references hold until the page moves
  assert.deepEqual(await page.go('back'), { url: base + '/', moved: true });
  // per load: the page's console.error, and the browser's own line for the image that failed; and the image, as failed
  assert.deepEqual(await page.describe(), { url: base + '/', title: 'Invoices (synthetic)', errors: 4, failed: 2 });
  await page.press('Control+a');
  await assert.rejects(page.press('Hyper+x'), /no modifier "Hyper"/);
  await assert.rejects(page.navigate('file:///etc/passwd'), /only http and https addresses open here, not file:/);
  await tab.close();
});

test('only web addresses open', () => {
  assert.equal(webAddress('https://example.com'), 'https://example.com/');
  assert.equal(webAddress('about:blank'), 'about:blank');
  assert.throws(() => webAddress('javascript:alert(1)'), /not javascript:/);
  assert.throws(() => webAddress('nonsense'), /not an address/);
});

test('an action waits for the page it opens: what the model reads next is that page, loaded', async () => {
  const tab = await browser.newPage();
  const session = await tab.context().newCDPSession(tab);
  const cdp: Cdp = cdpOf(session);
  const page = await new Browsers().add('b1', cdp);
  await page.navigate(base + '/to-slow');
  const link = find((await page.snapshot()).tree, (n) => n.role === 'link')!;
  await page.acting(() => page.click(link.ref!)); // the next page takes 700 ms to come
  assert.equal(page.url, base + '/slow');
  assert.equal((await page.snapshot()).title, 'Slow (synthetic)');
  const t0 = Date.now();
  await page.acting(() => page.press('Tab')); // nothing opens: back after a moment
  assert.ok(Date.now() - t0 < 2000);
  await tab.close();
});

/** A page's CDP as a test drives it: the events it fires, when it fires them. */
function scripted(onSend: (method: string, emit: (event: string, p: unknown) => void) => unknown) {
  const subs = new Map<string, Set<(p: unknown) => void>>();
  const emit = (e: string, p: unknown) => {
    for (const f of subs.get(e) ?? []) f(p);
  };
  const cdp: Cdp = {
    send: async (m) => onSend(m, emit) ?? {},
    on: (e, f) => {
      let s = subs.get(e);
      if (!s) subs.set(e, (s = new Set()));
      s.add(f);
      return () => {
        s.delete(f);
      };
    },
  };
  return cdp;
}
const HISTORY = {
  currentIndex: 1,
  entries: [
    { id: 1, url: 'http://127.0.0.1/' },
    { id: 2, url: 'http://127.0.0.1/next' },
  ],
};
const later = (ms: number, f: () => void) => {
  setTimeout(f, ms);
};

test('back waits for the page it goes to: a late load of the page it leaves does not end the wait', async () => {
  const page = await new BrowserPage(
    'b1',
    scripted((m, emit) => {
      if (m === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F', url: 'http://127.0.0.1/next' } } };
      if (m === 'Page.getNavigationHistory') return HISTORY;
      if (m === 'Page.navigateToHistoryEntry') {
        later(5, () => emit('Page.loadEventFired', {})); // the page it leaves, loading late
        later(40, () =>
          emit('Page.frameNavigated', { frame: { id: 'F', url: 'http://127.0.0.1/' }, type: 'Navigation' }),
        ); // the page it goes to
        later(80, () => emit('Page.loadEventFired', {})); // and its load
      }
      return undefined;
    }),
  ).start();
  const t0 = Date.now();
  assert.deepEqual(await page.go('back'), { url: 'http://127.0.0.1/', moved: true });
  assert.ok(Date.now() - t0 >= 75, 'ended by the load of the page it went to');
});

test('back to a page kept in the back-forward cache, or within the page: no load comes, and the wait ends there', async () => {
  for (const restore of [
    (emit: (e: string, p: unknown) => void) =>
      emit('Page.frameNavigated', { frame: { id: 'F', url: 'http://127.0.0.1/' }, type: 'BackForwardCacheRestore' }),
    (emit: (e: string, p: unknown) => void) =>
      emit('Page.navigatedWithinDocument', { frameId: 'F', url: 'http://127.0.0.1/' }),
  ]) {
    const page = await new BrowserPage(
      'b1',
      scripted((m, emit) => {
        if (m === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F', url: 'http://127.0.0.1/next' } } };
        if (m === 'Page.getNavigationHistory') return HISTORY;
        if (m === 'Page.navigateToHistoryEntry') later(20, () => restore(emit));
        return undefined;
      }),
    ).start();
    const t0 = Date.now();
    assert.deepEqual(await page.go('back'), { url: 'http://127.0.0.1/', moved: true });
    assert.ok(Date.now() - t0 < 1000);
  }
});

test('a guarded page requires interception and blocks writes when the guard fails', async () => {
  const closed: string[] = [];
  const failed = new Browsers(
    async () =>
      scripted((method) => {
        if (method === 'Fetch.enable') throw new Error('driver unavailable');
      }),
    undefined,
    (id) => closed.push(id),
  );
  await assert.rejects(failed.create(undefined, { id: 'page' }), /enable request checks/);
  assert.deepEqual(closed, ['page']);
  assert.equal(failed.has('page'), false);

  let paused: ((event: unknown) => void) | undefined;
  const commands: string[] = [];
  const page = await new BrowserPage('guarded', {
    on(event, callback) {
      if (event === 'Fetch.requestPaused') paused = callback;
      return () => {};
    },
    async send(method) {
      commands.push(method);
      return {};
    },
  }).start();
  try {
    for (const guard of [
      () => {
        throw new Error('guard unavailable');
      },
      () => Promise.reject(new Error('decision unavailable')),
    ]) {
      page.guard = guard;
      commands.length = 0;
      paused!({ requestId: 'test', request: { method: 'POST', url: 'https://example.invalid' } });
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(commands, ['Fetch.failRequest']);
    }
  } finally {
    page.stop();
  }
});

test('field inspection failures hide unknown values and prevent typing', async () => {
  const nodes = [
    { nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['1', '2'] },
    ...[1, 2].map((id) => ({
      nodeId: String(id),
      parentId: 'root',
      backendDOMNodeId: id,
      role: { value: 'textbox' },
      value: { value: id === 1 ? 'public fixture' : 'private fixture' },
    })),
  ];
  let inspectable = true;
  const input: string[] = [];
  const page = new BrowserPage('fields', {
    on: () => () => {},
    async send(method, params) {
      if (method === 'Accessibility.getFullAXTree') return { nodes };
      if (method === 'DOM.describeNode') {
        if (!inspectable || params?.backendNodeId !== 1) throw new Error('field unavailable');
        return { node: { nodeName: 'INPUT', attributes: [] } };
      }
      if (method === 'Runtime.evaluate') throw new Error('focus unavailable');
      if (method.startsWith('Input.') || method === 'DOM.focus') input.push(method);
      return {};
    },
  });
  const snapshot = await page.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /private fixture/);
  const visible = find(snapshot.tree, (node) => node.value === 'public fixture');
  assert.ok(visible?.ref);
  inspectable = false;
  await assert.rejects(page.type(visible.ref, 'sample'), /could not verify/);
  await assert.rejects(page.press('x'), /could not verify/);
  assert.deepEqual(input, []);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function sharingViews(confirm: ViewHost['confirm']) {
  return new Views(
    { terminal: false, browser: { open: async () => scripted(() => ({})) } },
    {
      cwd: '.',
      dir: '.',
      confirm,
      pane: () => [],
      unpane() {},
      tell() {},
      log() {},
    },
  );
}

test('ending and replacing a pane while site approval is open cancels both the move and the site grant', async () => {
  const decision = deferred<boolean>(),
    asked = deferred<void>();
  let approval: AbortSignal | undefined;
  const views = sharingViews((_question, signal) => {
    approval = signal;
    asked.resolve();
    return decision.promise;
  });
  const navigation: string[] = [];
  const driver = scripted((method) => {
    if (method === 'Page.navigate') navigation.push(method);
  });
  await views.browsers!.add('page', driver);
  await views.share('page', true);
  const address = 'https://example.invalid/';
  const action = views.act('page', { action: 'go_to', url: address });
  await asked.promise;
  await views.end('page');
  await views.browsers!.add('page', driver);
  await views.share('page', true);
  assert.equal(approval?.aborted, true);
  decision.resolve(true);
  assert.equal((await action).did, 'nothing');
  assert.equal(views.allowedNow(address), false);
  assert.deepEqual(navigation, []);
  views.close();
});

test('a held request never resumes with an approval from a previous sharing period', async () => {
  const decision = deferred<boolean>(),
    asked = deferred<void>();
  const views = sharingViews(() => {
    asked.resolve();
    return decision.promise;
  });
  let paused!: (event: unknown) => void;
  const handled: string[] = [];
  const page = await views.browsers!.add('page', {
    on(event, callback) {
      if (event === 'Fetch.requestPaused') paused = callback;
      return () => {};
    },
    async send(method) {
      if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
      if (method === 'Fetch.continueRequest' || method === 'Fetch.failRequest') handled.push(method);
      return {};
    },
  });
  await views.share('page', true);
  await views.act('page', { action: 'wait', ms: 0 });
  paused({ requestId: 'pending', request: { method: 'POST', url: 'http://localhost/' } });
  await asked.promise;
  await views.share('page', false);
  await views.share('page', true);
  decision.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(handled, ['Fetch.failRequest']);
  assert.deepEqual(page.takeHeld(), []);
  views.close();
});

test('an in-flight snapshot cannot publish after unsharing, even when the same page is immediately shared again', async () => {
  const started = deferred<void>(),
    tree = deferred<{ nodes: never[] }>();
  const views = sharingViews(async () => true);
  await views.browsers!.add(
    'page',
    scripted((method) => {
      if (method === 'Accessibility.getFullAXTree') {
        started.resolve();
        return tree.promise;
      }
      return {};
    }),
  );
  await views.share('page', true);
  const read = views.read('page', { log: true });
  await started.promise;
  await views.share('page', false);
  await views.share('page', true);
  tree.resolve({ nodes: [] });
  await assert.rejects(read, /stopped sharing/);
  assert.ok((await views.read('page')).snapshot);
  views.close();
});
