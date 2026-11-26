// A request a browser view's page wants to make, paused before it leaves (CDP's Fetch.requestPaused; browser.ts): the
// page's own move to another address goes through its leave, anything else first through its reach; then reads go at
// once, and anything else goes only if its guard lets it. What waits for the person is held, and kept for the model.
import type { BrowserPage } from './browser.js';
import type { Cdp, CdpEvents } from './browser-protocol.js';
import { READS, outgoing, type Outgoing, type Sent } from './browser-requests.js';

/** What a paused request needs of its page besides its checks: its connection, its share and main frame as they are
 *  when the request comes, the secret fields it knows as they are when they are read, and where it holds and keeps. */
export type Pausing = { cdp: Cdp; sharing?: AbortSignal; main: string; knownSecret: () => string[]; holds: Set<Promise<unknown>>; keep: (sent: Sent) => void };

/** A request paused before it left. The page's own move to another address goes through leave, and anything else
 *  first through reach; then reads go at once, and anything else goes only if the guard lets it. */
export async function pausedRequest(page: BrowserPage, p: CdpEvents['Fetch.requestPaused'], own: Pausing): Promise<void> {
  const sharing = own.sharing;
  const requestId = p.requestId, req = p.request ?? {};
  const go = () => own.cdp.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
  const block = () => own.cdp.send('Fetch.failRequest', { requestId, errorReason: p.resourceType === 'Document' ? 'Aborted' : 'BlockedByClient' }).catch(() => undefined);
  if (typeof req.method !== 'string') { await block(); return; }
  const method = req.method.toUpperCase(), url = String(req.url), kind = String(p.resourceType ?? '');
  if (kind === 'Document' && (!own.main || !p.frameId || p.frameId === own.main)) {
    let may: Promise<boolean> | undefined;
    try { may = page.leave?.(url); } catch { may = Promise.resolve(false); }
    if (may) {
      await own.cdp.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => undefined); // the page stays where it was
      void may.then(yes => { if (yes && !sharing?.aborted) void own.cdp.send('Page.navigate', { url }).catch(() => undefined); }, () => undefined); // there, on a yes
      return;
    }
  } else if (page.reach) {
    let may: Promise<boolean> | boolean | undefined;
    try { may = page.reach(url, kind); } catch { may = false; }
    if (may === false) { await block(); return; }
    if (may) {
      const site = may;
      const reached = (async () => {
        let yes = false;
        try { yes = await site; } catch { yes = false; }
        if (yes && !sharing?.aborted) return true;
        if (!sharing?.aborted) own.keep({ url, method, fields: [], secret: [], kind, sent: false });
        await block();
        return false;
      })();
      own.holds.add(reached);
      let yes = false;
      try { yes = await reached; } finally { own.holds.delete(reached); }
      if (!yes) return; // nothing awaits between here and the guard's hold, so an action waits for both
    }
  }
  if (READS.has(method) || !page.guard) { await go(); return; }
  let decision: Promise<boolean> | undefined;
  let out: Outgoing;
  try {
    out = outgoing(p, own.knownSecret());
    decision = page.guard(out);
  } catch { await block(); return; }
  if (!decision) { await go(); return; }
  const hold = (async () => {
    let yes = false;
    try { yes = await decision; } catch { yes = false; }
    if (sharing?.aborted) { await block(); return; }
    own.keep({ ...out, sent: yes });
    // a no: a page load is called off (the page stays as it was, as when the person stops it); anything else is blocked
    if (yes) await go(); else await block();
  })();
  own.holds.add(hold);
  try { await hold; } finally { own.holds.delete(hold); }
}
