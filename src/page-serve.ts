// What the page host (pages.ts) answers a request with, and under which policy: a process's pages, files, data and
// media, its boot script and the events its pages wait for, and an MCP App's own document on its origin.
import fs from 'node:fs';
import { FILE_TYPES, typeOfFile } from './file-types.js';
import { GRANT_LENGTH, type PageGrants } from './page-grants.js';
import { wrapperFor, type Libraries } from './page-libraries.js';
import { boot, noWebRtc } from './page-runtime.js';
import { MEASURES } from './page-measures.js';
import { BOOT_PARTS } from './page-watch.js';
import type { PageFile } from './page-file.js';
import type { PageProcess } from './pages.js';
import { fileOf, type ResultEntry } from './results.js';
import { SEND_MAX } from './page-send.js';
import { asksStatic, insideAsync, watchFolder } from './page-workspace.js';
import { inject } from './page-inject.js';
import { makeCompute } from './compute.js';

/** Requests stay on the process's own origin, with inline code, data: and blob: URLs: a page fetches nothing from the
 *  network. (Where its frame navigates, CSP does not say: see page-guard.ts.) A blocked request is reported, never silent. */
export const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'";
export const HEADERS = { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-DNS-Prefetch-Control': 'off' };
const HTML_TYPE = FILE_TYPES.get('html')!;
const mimeOf = (file: string) => typeOfFile(file) ?? 'application/octet-stream';
/** What an attachment is served as: an image, a sound, a video, a PDF or text as what it is, anything else as bytes,
 *  so that no page can load it as a script, a style, a worker or WebAssembly (nosniff). */
const MEDIA_TYPES = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/(?:pdf|json)|text\/(?:plain|csv|markdown|html))$/;
const mediaType = (mime: string) => {
  const [essence, ...rest] = mime.split(';'), type = essence.trim().toLowerCase(), charset = rest.map(p => p.trim()).find(p => /^charset=[\w.-]{1,40}$/i.test(p));
  if (!MEDIA_TYPES.test(type)) return 'application/octet-stream';
  return charset ? `${type}; ${charset}` : type;
};
/** An attachment as a document: it loads nothing but its own images and media, and never runs. */
const MEDIA_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
/** A static page (a page panel with static): its markup, its styles, and the images, media and fonts of its own origin,
 *  and nothing that runs, connects, frames or sends a form. It is served with sandbox too, as its frame is drawn. */
const STATIC_CSP = "default-src 'self' data:; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; font-src 'self' data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'";
/** A font of the working folder, for a static page beside it: sandboxed, the page has no origin of its own, and a font
 *  loads only with CORS. A font is a font: it is given to any origin that asks for it. */
const fontsFor = (f: PageFile): PageFile => (f.headers['Content-Type'].startsWith('font/') ? { ...f, headers: { ...f.headers, 'Access-Control-Allow-Origin': '*' } } : f);
/** A page the model writes in show_view, or a page check's: a plain name, its file in the process's folder. */
const VIEW_NAME = /^[A-Za-z0-9_-]{1,200}$/;
export const viewFile = (name: string) => {
  if (!VIEW_NAME.test(name)) throw new Error(`a page's name is up to 200 letters, digits, "_" and "-": not "${name.slice(0, 60)}"`);
  return `${name}.html`;
};

export type Served = { status: number; headers: Record<string, string>; body: string | Buffer };
const ok = (type: string, body: string | Buffer): Served => ({ status: 200, headers: { ...HEADERS, 'Content-Type': type }, body });

/** The domains an MCP App declares (its resource's _meta.ui.csp), used only where the host lets apps reach the network. */
export type AppCsp = { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] };
export type App = { owner: string; load: () => Promise<{ html: string; csp?: AppCsp }>; network: boolean; got?: Promise<{ html: string; csp?: AppCsp }> };
/** A domain an app declares, as a CSP source: https, a host of two labels or more (a leading "*." for its subdomains,
 *  never "*" alone, "*.com" or a wildcard elsewhere), and a port if it names one. */
const DOMAIN = /^https:\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?$/i;
const origins = (xs?: string[]) => (xs ?? []).filter(d => typeof d === 'string' && DOMAIN.test(d) && (!d.startsWith('https://*.') || d.slice(10).split(':')[0].includes('.'))).join(' ');
/** An app's policy: no fetch from the network at all, or the domains it declared (https only), each for what it
 *  declared it for; scripts from its own document, blob: and those domains, never data:. Where its frame navigates is
 *  the guard's (page-guard.ts), and who may frame it is pageParentOrigins'. */
export function appCsp(c: AppCsp = {}, network = false): string {
  const declared = (xs?: string[]) => network ? origins(xs) : '';
  const resources = declared(c.resourceDomains), connects = declared(c.connectDomains), frames = declared(c.frameDomains), bases = declared(c.baseUriDomains);
  return [`default-src 'none'`, `script-src 'unsafe-inline' 'unsafe-eval' blob: ${resources}`, `style-src 'unsafe-inline' data: ${resources}`, `img-src data: blob: ${resources}`, `font-src data: ${resources}`, `media-src data: blob: ${resources}`,
    `connect-src ${connects || "'none'"}`, `frame-src ${frames || "'none'"}`, `object-src 'none'`, `base-uri ${bases || "'none'"}`, `form-action 'none'`].map(x => x.trim()).join('; ');
}

/** Who may frame what the host serves, as a CSP directive: nothing said when the host set no pageParentOrigins. */
const ancestorsOf = (allowed: string[] | undefined) => allowed ? `; frame-ancestors ${allowed.join(' ') || "'none'"}` : '';
export async function serveApp(a: App | undefined, url: string, parents: () => string[] | undefined): Promise<Served> {
  if (!a || new URL(url, 'http://app').pathname !== '/') return { status: 404, headers: { ...HEADERS, 'Content-Type': 'text/plain' }, body: 'not found' };
  const allowed = parents(); // a host's list that throws fails this request alone
  const got = await (a.got ??= a.load().catch((error: unknown) => { a.got = undefined; throw error; })); // a failed load is tried again on the next request
  return { status: 200, headers: { ...HEADERS, 'Content-Security-Policy': appCsp(got.csp, a.network) + ancestorsOf(allowed), 'Content-Type': HTML_TYPE }, body: got.html };
}

/** What a request's Host names: an MCP App, or a process (on a work origin, with its grant if it has one). Only on
 *  the host's own port, exactly. */
export function originOf(host: string, port: number): { app: string } | { key: string; work?: { grant?: string } } | undefined {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- built from constants only: the key lengths and the host's own port
  const m = new RegExp(`^(?:app-([a-f0-9]{32})|work-([a-f0-9]{32})(?:-([a-f0-9]{${GRANT_LENGTH}}))?|([a-f0-9]{32}))\\.localhost:${port}$`).exec(host);
  if (!m) return undefined;
  if (m[1]) return { app: m[1] };
  return m[2] ? { key: m[2], work: m[3] ? { grant: m[3] } : {} } : { key: m[4] };
}
type Serving = { libs: Libraries; parents: () => string[] | undefined; grants: PageGrants; work?: { grant?: string }; gone?: AbortSignal };
export async function serve(t: PageProcess | undefined, url: string, { libs, parents, grants, work, gone }: Serving): Promise<Served | PageFile> {
  if (!t) return { status: 404, headers: { ...HEADERS, 'Content-Type': 'text/plain' }, body: 'not found' };
  const allowed = parents(), ancestors = ancestorsOf(allowed);
  const headers = { ...HEADERS, 'Content-Security-Policy': CSP + ancestors };
  const file = (file: string, mime = mimeOf(file), csp = headers['Content-Security-Policy']): PageFile => ({ file, headers: { ...headers, 'Content-Type': mime, 'Content-Security-Policy': csp } });
  const sandboxed = `${headers['Content-Security-Policy']}; sandbox`;
  const u = new URL(url, 'http://page');
  const miss = (): Served => { t.misses.push({ at: Date.now(), path: u.pathname }); if (t.misses.length > 200) t.misses.shift(); return { status: 404, headers: { ...HEADERS, 'Content-Type': 'text/plain' }, body: 'not found' }; };
  let parts: string[];
  try { parts = u.pathname.split('/').slice(1).map(decodeURIComponent); } catch { return miss(); }
  const [root, ...rest] = parts; const rel = rest.join('/');
  if (rest.some(p => p.startsWith('.') || p.includes('\\'))) return miss(); // no dotfiles (.env, .git) and no tricks
  const named = (u.searchParams.get('uses') ?? '').split(',').filter(Boolean);
  // what this page reads: on a work origin, only the uses its grant is for
  const uses = work ? grants.granted(t.key, named, work.grant) : named;
  let again: string | undefined; // what a work page names again, to read its results
  if (work) again = uses.length ? `uses=${uses.map(encodeURIComponent).join(',')}` : '';
  const num = (k: string) => { const n = Number(u.searchParams.get(k) ?? -1); return Number.isInteger(n) ? n : -1; };
  if (work && !['work', 'lib', '__vindu', 'data'].includes(root)) return miss(); // no pages the model wrote, no media
  switch (root) {
    case '__vindu':
      if (rest[0] === 'boot.js') return ok('text/javascript', bootScript(t, uses, u.searchParams.get('live') === '1', allowed, again));
      if (rest[0] === 'events') return events(t, num('v'), num('n'), u.searchParams.get('wait') !== '0', !!work, gone);
      return rest[0] === 'changes' ? changes(t, num('since'), gone) : miss();
    case 'data': { // a result, exact
      const id = rel.replace(/\.json$/, ''); const e = t.results.get(id);
      if (e?.kind !== 'result' || (work && !uses.includes(id))) return miss();
      return ok('application/json', JSON.stringify(e.rows ?? e.value ?? e.text));
    }
    case 'media': { // an attachment or a result's image: shown, never run as a page on this origin, whatever it holds
      const f = fileOf(t.results, rel), real = f && await fs.promises.realpath(f.file).catch(() => null);
      return f && real ? file(real, mediaType(f.mime), `${MEDIA_CSP}${ancestors}; sandbox`) : miss();
    }
    case 'lib': {
      const wrapper = rest[0] === '_vindu' && rest.length === 2 ? wrapperFor(rest[1]) : undefined;
      if (wrapper) return ok('text/javascript', wrapper);
      const hit = libs.dirOf(rel);
      const f = hit ? await insideAsync(hit[1], rel.slice(hit[0].length + 1), hit[2]) : null;
      return f ? file(f) : miss();
    }
    case 'work': case 'view': {
      const base = root === 'work' ? t.work : t.views;
      const f = base ? await insideAsync(base, rel || 'index.html', root === 'view' ? t.views : undefined) : null; // the working folder is found again
      if (!f) return miss();
      if (root === 'work') watch(t);
      const runs = root === 'view' || !!work; // a file of the working folder runs only on a work origin, apart from the task's data
      if (u.searchParams.get('raw') === '1') return file(f, 'text/plain; charset=utf-8', runs ? undefined : sandboxed); // as written: a code panel reads a page's source
      if (!work && /\.html?$/i.test(f) && asksStatic(u.searchParams)) return file(f, HTML_TYPE, `${STATIC_CSP}${ancestors}; sandbox`); // a static page: as written, and none of it runs
      if (!runs) return fontsFor(file(f, undefined, sandboxed)); // as a file: an image, a sound, a script a page the model wrote imports
      if (!/\.html?$/i.test(f)) return file(f);
      return { ...file(f, HTML_TYPE), inject: html => inject(html, uses, root === 'work', libs.importMap) };
    }
  }
  return miss();
}

/** The files changed in the working folder since version v, or "*" when more changed than is remembered. */
const pathsSince = (t: PageProcess, v: number): string[] => {
  if (v < 0 || t.version <= v) return [];
  const h = t.history.filter(x => x.v > v);
  return h.length === t.version - v ? [...new Set(h.flatMap(x => x.paths))] : ['*'];
};
/** The process's results in order (answers and attachments are not results), counted again only when the store grew. */
const resultsOf = (t: PageProcess): ResultEntry[] => {
  const all = t.results.all();
  if (all.length !== t.seen.length) t.seen = { length: all.length, results: all.filter((e): e is ResultEntry => e.kind === 'result') };
  return t.seen.results;
};
/** What a page hears, since what it has heard (v: the folder's version, n: how many results): the files that changed
 *  and the results that came, at once or as soon as there is something (25 seconds at most). v or n below 0: from now.
 *  A page from the working folder (work) hears of no results: it reads only its uses, which it has. */
function events(t: PageProcess, v: number, n: number, wait: boolean, work = false, gone?: AbortSignal): Served | Promise<Served> {
  watch(t);
  const reply = (): Served => {
    const rs = work ? [] : resultsOf(t), fresh = n < 0 ? [] : rs.slice(Math.min(n, rs.length));
    return ok('application/json', JSON.stringify({ v: t.version, paths: pathsSince(t, v), n: rs.length,
      results: fresh.slice(-50).map(e => ({ id: e.id, tool: e.tool, server: e.server })), ...(fresh.length > 50 ? { missed: fresh.length - 50 } : {}) }));
  };
  const any = () => (v >= 0 && t.version > v) || (!work && n >= 0 && resultsOf(t).length > n);
  if (!wait || v < 0 || n < 0 || any() || gone?.aborted) return reply();
  return waitFor(t, reply, gone, any, t.notifies ? 2_000 : 250); // a store that says nothing is asked often; one whose host says when a result comes, now and then, for a result it did not say
}
/** Live pages asked here when something changed, before events: the answer waits until a change, or 25 seconds. */
function changes(t: PageProcess, since: number, gone?: AbortSignal): Served | Promise<Served> {
  watch(t);
  const reply = (): Served => ok('application/json', JSON.stringify({ version: t.version, paths: pathsSince(t, since) }));
  if (since < 0) return ok('application/json', JSON.stringify({ version: t.version, paths: [] }));
  if (t.version > since || gone?.aborted) return reply();
  return waitFor(t, reply, gone);
}
/** The answer to a page that waits: when the process wakes its waiters (a change, a result, the end), when ready()
 *  says so on a tick, after 25 seconds, or at once when the page goes (gone): no timer outlives the request. */
function waitFor(t: PageProcess, reply: () => Served, gone?: AbortSignal, ready?: () => boolean, every = 250): Promise<Served> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); clearInterval(tick); t.waiters.delete(done); gone?.removeEventListener('abort', done); resolve(reply()); };
    const timer = setTimeout(done, 25_000), tick = ready ? setInterval(() => { if (ready()) done(); }, every) : undefined;
    t.waiters.add(done); gone?.addEventListener('abort', done, { once: true });
  });
}
function watch(t: PageProcess) {
  if (t.stop || !t.work) return;
  t.stop = watchFolder(t.work, paths => { t.version++; t.history.push({ v: t.version, paths }); if (t.history.length > 100) t.history.shift(); for (const w of t.waiters) w(); });
}

/** The boot script for one page: WebRTC taken away, then the exact data of the results it uses, whether it reloads
 *  live, and where the process is now (the folder's version, how many results), so the page hears what comes after.
 *  again: on a work origin, the query that names its uses again (for task.get); it hears of no other results. */
function bootScript(t: PageProcess, uses: string[], live: boolean, parents?: string[], again?: string): string {
  const data = new Map<string, unknown>(); // the page names these ids (only rN find a result): a Map, so each is a key
  for (const id of uses) { const e = t.results.get(id); if (e?.kind === 'result') data.set(id, e.rows ?? e.value ?? e.text); }
  const at = { v: t.version, n: again === undefined ? resultsOf(t).length : 0, most: SEND_MAX, parents, ...(again === undefined ? {} : { work: true, again }) };
  return `(${noWebRtc.toString()})(window);\nglobalThis.__vinduCompute = (${makeCompute.toString()})();\n(${boot.toString()})(${JSON.stringify(Object.fromEntries(data))}, ${live}, ${JSON.stringify(at)}, ${MEASURES}, ${BOOT_PARTS});\n`;
}
