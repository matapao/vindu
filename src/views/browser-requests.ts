// What a browser view's page may open and what it sends, as the model's side tells them: web addresses only, and of a
// request that leaves the page, where it goes, how, and the names of the fields it holds (never their values).
import { asText } from '../format.js';

/** What a page wants to send: where, how, and the names of the fields it holds (never their values). */
export type Outgoing = { url: string; method: string; fields: string[]; secret: string[]; kind?: string };
/** What became of something a page wanted to send while the model acted. */
export type Sent = Outgoing & { sent: boolean };

/** Fields that hold secrets, by HTML's own markers: passwords, card numbers, security codes, expiry, one-time codes. */
export const SECRET_AUTOCOMPLETE = ['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year'];
export const SECRET_FIELDS = ['input[type=password]', ...SECRET_AUTOCOMPLETE
  .map(t => `input[autocomplete~="${t}"], select[autocomplete~="${t}"], textarea[autocomplete~="${t}"], [contenteditable][autocomplete~="${t}"]`)].join(', ');
/** Methods that only read. */
export const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The names of the fields in a request body: a form, JSON, or multipart; never the values. */
export function fieldNames(body: string | undefined, contentType = ''): string[] {
  if (!body) return [];
  const ct = contentType.toLowerCase();
  if (ct.includes('multipart/form-data')) return [...new Set([...body.matchAll(/(?:^|[;\s])name="([^"]+)"/g)].map(m => m[1]))];
  if (ct.includes('json') || /^\s*[{[]/.test(body)) { try { const v = JSON.parse(body); return Array.isArray(v) ? ['(a list)'] : v && typeof v === 'object' ? Object.keys(v) : ['(a value)']; } catch { /* not JSON */ } }
  if (ct.includes('x-www-form-urlencoded') || /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)) return [...new Set(body.split('&').map(kv => { try { return decodeURIComponent(kv.split('=')[0].replace(/\+/g, ' ')); } catch { return kv.split('=')[0]; } }))];
  return [`(a body of ${body.length} characters)`];
}

/** A request the browser paused (CDP's Fetch.requestPaused), as what it wants to send: the secret fields are those of
 *  the page's known secret fields that its body names. */
export function outgoing(paused: { request?: { url?: unknown; method?: unknown; headers?: Record<string, unknown>; postData?: string; postDataEntries?: { bytes?: string }[] }; resourceType?: unknown }, knownSecret: string[]): Outgoing {
  const req = paused.request ?? {};
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const body = req.postData ?? (Array.isArray(req.postDataEntries) ? req.postDataEntries.map(e => (e.bytes ? Buffer.from(e.bytes, 'base64').toString('utf8') : '')).join('') : undefined);
  const fields = fieldNames(body, headers['content-type']);
  return { url: String(req.url), method: String(req.method).toUpperCase(), fields, secret: fields.filter(f => knownSecret.includes(f)), kind: asText(paused.resourceType ?? '') };
}

/** Web addresses only: never file:, javascript: or the browser's own pages. */
export function webAddress(u: string): string {
  if (u === 'about:blank') return u;
  let url: URL; try { url = new URL(u); } catch { throw new Error(`"${u}" is not an address`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`only http and https addresses open here, not ${url.protocol}`);
  return url.href;
}
