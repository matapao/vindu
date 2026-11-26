import { afterEach, expect, it, vi } from 'vitest';
import { APP_SUBMIT_OBSERVER, appSubmitDocument, observeAppSubmit } from '../src/app-submission.js';
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { chromium } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

const token = 'a'.repeat(48);
const policy = "default-src 'none'; script-src 'unsafe-inline'; form-action 'none'";

it('keeps the document mode and makes the observer the first script', () => {
  for (const prefix of ['', '\uFEFF ', '<!DOCTYPE html>', ' \n<!-- license -->\n<!DOCTYPE HTML >']) {
    const body = '<html><head><title>Search</title></head><body>Query</body></html>';
    const decorated = appSubmitDocument(prefix + body, token, policy);
    expect(decorated.startsWith(prefix + '<script>')).toBe(true);
    expect(decorated.endsWith('</script>' + body)).toBe(true);
  }
  for (const html of [
    '<p>x</p><!doctype html>',
    '<!DOCTYPE html PUBLIC "legacy">',
    '<!--> unsafe --> <!doctype html>',
    '<meta http-equiv=Content-Security-Policy content="script-src self">',
  ]) {
    expect(appSubmitDocument(html, token, policy)).toBe(html);
  }
  const html = '<!doctype html><p>Search</p>';
  for (const csp of [
    '',
    "default-src 'none'",
    "script-src 'unsafe-inline' 'nonce-known'",
    policy + "; script-src-elem 'self'",
    policy + ", default-src 'self'",
  ]) {
    expect(appSubmitDocument(html, token, csp)).toBe(html);
  }
  expect(appSubmitDocument(html, 'bad', policy)).toBe(html);
});

const observer =
  'data:text/javascript;base64,' +
  readFileSync(new URL('../src/app-submission.js', import.meta.url)).toString('base64');
const SEARCH = `document.querySelector("form").onsubmit = e => { e.preventDefault();
  parent.postMessage({ method: "search", args: { query: e.target.elements.query.value } }, "*"); };`;
/** A host page with the app in an opaque frame: each search the app calls is written down as matched or not, given
 *  the tool annotations in window.tool (none given while it is unset). */
async function hostWith(browser: Browser, body: string) {
  const page = await browser.newPage();
  await page.addScriptTag({
    type: 'module',
    content: `import { observeAppSubmit } from ${JSON.stringify(observer)}; window.observeSubmit = observeAppSubmit;`,
  });
  await page.waitForFunction(() => 'observeSubmit' in window);
  const app = appSubmitDocument(
    `<!doctype html><body style="margin:0">${body}<script>${SEARCH}</script>`,
    token,
    policy,
  );
  await page.evaluate(
    ({ app, token }: { app: string; token: string }) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.style.cssText = 'width:400px;height:200px;border:0';
      const outcomes = document.createElement('output');
      document.body.append(frame, outcomes);
      const observeSubmit = Reflect.get(window, 'observeSubmit') as typeof observeAppSubmit;
      const witness = observeSubmit(frame, token);
      addEventListener('message', (event) => {
        if (event.source === frame.contentWindow && event.data?.method === 'search') {
          const tool = Reflect.get(window, 'tool') as [{ readOnlyHint?: boolean }?] | undefined;
          outcomes.textContent += witness.matches(event.data.args, ...(tool ?? [])) ? 'yes ' : 'no ';
        }
      });
      frame.srcdoc = app;
    },
    { app, token },
  );
  await page.frameLocator('iframe').locator('form').waitFor({ state: 'attached' });
  return {
    page,
    form: page.frameLocator('iframe'),
    outcomes: (text: string) => page.getByText(text, { exact: true }).waitFor(),
  };
}

it('observes a real opaque form submit and leaves scripted submissions on ordinary approval', async () => {
  const browser = await chromium.launch();
  try {
    const { page, form, outcomes } = await hostWith(
      browser,
      '<form><input name="query" value="item"><button>Search</button></form>',
    );
    await form.locator('button').click();
    await outcomes('yes');
    await form.locator('form').evaluate((el: HTMLFormElement) => el.requestSubmit());
    await outcomes('yes no');
    await page.evaluate(() => Reflect.set(window, 'tool', [{ readOnlyHint: false }])); // a tool that may change something
    await form.locator('button').click();
    await outcomes('yes no no');
    await page.evaluate(() => Reflect.set(window, 'tool', [undefined])); // a tool whose server says nothing of it
    await form.locator('button').click();
    await outcomes('yes no no no');
    await page.evaluate(() => Reflect.set(window, 'tool', [{ readOnlyHint: true }]));
    await form.locator('button').click();
    await outcomes('yes no no no yes');
    expect(await page.locator('output').textContent()).toBe('yes no no no yes ');
  } finally {
    await browser.close();
  }
});

it('takes no evidence from a control the person could not see, a click it did not land on, or values changed under it', async () => {
  const browser = await chromium.launch();
  const field = '<input name="query" value="item">';
  // where the person clicks: somewhere in the frame (what covers it takes the click), or on the submit button
  const cases: [string, 'frame' | 'button'][] = [
    [`<form>${field}<button style="position:fixed;inset:0;opacity:.02">Search</button></form><p>Read me</p>`, 'frame'], // nearly transparent
    [`<form>${field}<button style="position:fixed;inset:0;background:none;border:0">Search</button></form>`, 'frame'], // most of the frame
    [
      `<form>${field}<button style="position:fixed;inset:0;background:none;border:0;color:transparent">Go</button></form>`,
      'frame',
    ],
    [
      `<label for="go" style="position:fixed;inset:0;z-index:1"></label><form>${field}<button id="go">Search</button></form>`,
      'frame',
    ], // a label
    [
      '<form><input name="query" value="item" style="width:1px;height:1px;padding:0;border:0"><button>Search</button></form>',
      'button',
    ], // a tiny field
    [`<div style="opacity:.3"><form>${field}<button>Search</button></form></div>`, 'button'], // faint through what holds it
    [
      `<form>${field}<button>Search</button></form><script>document.querySelector("button")
      .addEventListener("pointerdown", () => { document.querySelector("input").value = "changed"; });</script>`,
      'button',
    ], // swapped on press
    // a tiny field in an app that redefines what a box measures, and what a pattern matches, after the observer took its own
    [
      '<form><input name="query" value="item" style="width:1px;height:1px;padding:0;border:0"><button>Search</button></form><script>' +
        'for (const proto of [DOMRect.prototype, DOMRectReadOnly.prototype]) for (const k of ["width", "height", "right", "bottom"]) if (Object.getOwnPropertyDescriptor(proto, k)) Object.defineProperty(proto, k, { get() { return 100; }, configurable: true });' +
        'RegExp.prototype.exec = function () { return ["x"]; };</script>',
      'button',
    ],
  ];
  try {
    for (const [body, where] of cases) {
      const { page, form, outcomes } = await hostWith(browser, body);
      if (where === 'button') await form.locator('button').click({ force: true });
      else {
        const box = await page.locator('iframe').boundingBox();
        if (!box) throw new Error('the frame is not drawn');
        await page.mouse.click(box.x + 200, box.y + 150);
      }
      await outcomes('no');
      expect(await page.locator('output').textContent()).toBe('no ');
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

it('uses the active document’s single matching submission for the current call', () => {
  const host = new EventTarget();
  const channel = new MessageChannel();
  const source = channel.port1;
  const frame = { isConnected: true, contentWindow: source } as unknown as HTMLIFrameElement;
  vi.stubGlobal('window', host);
  vi.stubGlobal('document', { activeElement: frame });
  const bridge = observeAppSubmit(frame, 'host-provided-token');
  const key = '1-2-3-4-5-6-7-8';
  const args = { company: 'Telenor' };
  const message = (details: Record<string, unknown>) =>
    host.dispatchEvent(
      new MessageEvent('message', { origin: 'null', source, data: { tag: APP_SUBMIT_OBSERVER, key, ...details } }),
    );
  const witness = () => message({ serial: 1, values: args });
  try {
    message({ init: true, submitToken: 'different-token' });
    witness();
    expect(bridge.matches(args)).toBe(false);
    message({ init: true, submitToken: 'host-provided-token' });
    witness();
    expect(bridge.matches({ company: 'Something else' })).toBe(false);
    expect(bridge.matches(args)).toBe(false);
    witness();
    expect(bridge.matches({ ...args, extra: true })).toBe(false);
    witness();
    expect(bridge.matches(args, undefined)).toBe(false); // annotations given, but none say the tool only reads
    witness();
    expect(bridge.matches(args, { readOnlyHint: true })).toBe(true);
    witness();
    expect(bridge.matches(args)).toBe(true);
    expect(bridge.matches(args)).toBe(false);
    witness();
    message({ serial: 1, end: true });
    expect(bridge.matches(args)).toBe(false);
    witness();
    vi.stubGlobal('document', { activeElement: null });
    expect(bridge.matches(args)).toBe(false);
  } finally {
    bridge.close();
    channel.port1.close();
    channel.port2.close();
  }
});
