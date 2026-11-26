// Waiting in a browser view's page (browser.ts) for what a script draws after an action or a load, and for text to be
// there; and running a function in the page on an element. Each reads the page only through its CDP connection.
import { ask, type Cdp } from './browser-protocol.js';
import { sleep } from './time.js';

/** Until what a script draws right after an action or a load is there: the page's document has had no change for
 *  quietMs, or capMs have passed (a page that keeps changing, an animation or a clock, is read as it is then). The
 *  page only counts its changes; the time is kept here, so a page in a hidden pane, whose timers run late, settles as
 *  soon, and one that is gone or does not answer ends the wait. */
export async function settled(cdp: Cdp, quietMs = 200, capMs = 2000): Promise<void> { // quiet long enough that a busy computer's late timers still count
  const end = Date.now() + capMs;
  const within = <T>(sent: Promise<T>) => Promise.race([sent.catch(() => undefined), sleep(Math.max(0, end - Date.now())).then(() => undefined)]);
  const watch = await within(ask(cdp, 'Runtime.evaluate', { expression: `(() => { const seen = { changes: 0 };
    seen.observer = new MutationObserver(records => { seen.changes += records.length; });
    seen.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); return seen; })()` }));
  const objectId = watch?.result?.objectId;
  if (!objectId) { await sleep(quietMs); return; } // nothing to watch: the quiet time, as it is
  const changes = async () => (await within(ask(cdp, 'Runtime.callFunctionOn', { objectId, functionDeclaration: 'function() { return this.changes; }', returnByValue: true })))?.result?.value;
  try {
    for (let seen = 0; Date.now() < end;) {
      await sleep(Math.min(quietMs, end - Date.now()));
      const count = await changes();
      if (typeof count !== 'number' || count === seen) return; // quiet, or the page has gone on to another document
      seen = count;
    }
  } finally {
    void cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function() { this.observer.disconnect(); }' })
      .catch(() => undefined).then(() => cdp.send('Runtime.releaseObject', { objectId })).catch(() => undefined);
  }
}
/** Wait for text to be on the page (up to timeoutMs), or for ms. */
export async function waitFor(cdp: Cdp, o: { text?: string; ms?: number; timeoutMs?: number }, signal?: AbortSignal): Promise<{ found?: boolean; waited: number }> {
  const start = Date.now();
  if (o.text === undefined) { const ms = Math.min(o.ms ?? 500, 10_000); await sleep(ms); return { waited: ms }; }
  const end = start + Math.min(o.timeoutMs ?? 10_000, 30_000);
  while (Date.now() < end) {
    signal?.throwIfAborted();
    const r = await ask(cdp, 'Runtime.evaluate', { expression: `(document.body ? document.body.innerText : '').includes(${JSON.stringify(o.text)})`, returnByValue: true }).catch(() => null); // searched in the page: only the answer comes back
    if (r?.result?.value === true) return { found: true, waited: Date.now() - start };
    await sleep(150);
  }
  return { found: false, waited: Date.now() - start };
}
/** A function run in the page with an element as this, and its value: the element resolved, then released. */
export async function callOn(cdp: Cdp, backendNodeId: number, fn: string, args: unknown[] = [], signal?: AbortSignal): Promise<unknown> {
  const { object } = await ask(cdp, 'DOM.resolveNode', { backendNodeId });
  try {
    signal?.throwIfAborted();
    const r = await ask(cdp, 'Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn, arguments: args.map(value => ({ value })), returnByValue: true });
    return r?.result?.value;
  } finally {
    await cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => undefined);
  }
}
