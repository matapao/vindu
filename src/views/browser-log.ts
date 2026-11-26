// What a browser view's page logged (browser.ts): its console and the errors it threw, and what failed to load, newest
// last and the last 500 of each; a request is kept only until it ends, for what is said of it if it fails.
import type { CdpEvents } from './browser-protocol.js';
import { now } from './time.js';

export type LogEntry = { at: string; level: string; text: string; source?: string };
export type Failure = { at: string; url: string; method?: string; status?: number; error?: string; type?: string };

export class PageLog {
  private logs: LogEntry[] = []; private failed: Failure[] = []; private reqs = new Map<string, { url: string; method: string }>();
  /** Listens, through on, to what the page reports of its console, its errors and its requests. */
  listen(on: <E extends keyof CdpEvents>(e: E, f: (p: CdpEvents[E]) => void) => unknown): void {
    on('Runtime.consoleAPICalled', p => this.log({ at: now(), level: p.type === 'warning' ? 'warn' : String(p.type), text: (p.args ?? []).map(a => a.value ?? a.unserializableValue ?? a.description ?? '').join(' ') }));
    on('Runtime.exceptionThrown', p => this.log({ at: now(), level: 'error', text: String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'an exception') }));
    on('Log.entryAdded', p => this.log({ at: now(), level: String(p.entry?.level ?? 'info'), text: String(p.entry?.text ?? ''), source: p.entry?.source }));
    on('Network.requestWillBeSent', p => { this.reqs.set(p.requestId, { url: p.request?.url, method: p.request?.method }); if (this.reqs.size > 2000) this.reqs.delete(this.reqs.keys().next().value!); });
    on('Network.loadingFinished', p => { this.reqs.delete(p.requestId); }); // each request is kept only until it ends
    on('Network.responseReceived', p => { const s = Number(p.response?.status); if (s >= 400) this.fail({ at: now(), url: p.response.url, status: s, type: p.type, method: this.reqs.get(p.requestId)?.method }); });
    on('Network.loadingFailed', p => { const r = this.reqs.get(p.requestId); this.reqs.delete(p.requestId); if (p.canceled) return; this.fail({ at: now(), url: r?.url ?? '', method: r?.method, error: p.blockedReason ? `blocked: ${p.blockedReason}` : p.errorText, type: p.type }); });
  }
  /** What the page logged (its errors alone, if asked), and what failed to load, newest last. */
  console(o: { last?: number; errorsOnly?: boolean } = {}): { messages: LogEntry[]; failures: Failure[] } {
    const n = o.last ?? 50; const msgs = o.errorsOnly ? this.logs.filter(l => l.level === 'error') : this.logs;
    return { messages: msgs.slice(-n), failures: this.failed.slice(-n) };
  }
  /** How many errors the page logged, and how many loads failed. */
  counts(): { errors: number; failed: number } { return { errors: this.logs.filter(l => l.level === 'error').length, failed: this.failed.length }; }
  private log(e: LogEntry) { this.logs.push(e); if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500); }
  private fail(f: Failure) { this.failed.push(f); if (this.failed.length > 500) this.failed.splice(0, this.failed.length - 500); }
}
