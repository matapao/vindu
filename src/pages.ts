// The page host: web pages next to the chat, on loopback, one origin per process (http://<key>.localhost:<port>, a
// 128-bit key), served from five places only:
//   /work/<path>     the process's working folder, as files: never run here (CSP sandbox)
//   /view/<file>     pages the model wrote in show_view, and Vindu's own (code and diff panels)
//   /lib/<name>/…    pinned libraries: three.js, Apache ECharts, Chart.js
//   /data/<id>.json  a result's exact rows or value
//   /media/<id>      an attachment, or a result's image: shown, never run (CSP sandbox), and never a script or style
// and /__vindu/: the script every page loads first (its data, the hooks a check reads, task.on and task.send), and the
// events a page waits for (files changed, results come).
// A page from the working folder (a website or game the process is building, or anything a cloned repository holds)
// runs apart, live, on a work origin for the results it was given (http://work-<key>-<grant>.localhost:<port>, see
// page-grants.ts): /work, /lib and /__vindu only, and of the task's data only the results in its uses.
// Every client loads the same URLs: an Electron window, a browser, a headless check.
// A page cannot fetch from the network: its CSP keeps every request on its own origin. Its frame can still navigate
// anywhere, with what the page read in the address, and only the browser that shows it can refuse that: the host's
// window, with page-guard.ts (frame-src in its CSP, or Electron's will-frame-navigate), and the headless check's
// driver. Where the host applies no guard, a page's data can leave with it. WebRTC, which no CSP covers in Chromium,
// is taken from the page as far as a script can (noWebRtc).
import { makeCompute } from './compute.js';
import { FILE_TYPES, typeOfFile } from './file-types.js';
import fs from 'node:fs';
import { readPageFile, sendPageFile, type PageFile } from './page-file.js';
import http from 'node:http';
import { listenLoopback } from './loopback.js';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { GRANT_LENGTH, pageGrants, type PageGrants } from './page-grants.js';
import { readText, TEXT_MAX } from './page-head.js';
import type { HeadText } from './page-head.js';
import { fileOf, type ResultEntry, type ResultSource } from './results.js';
import { boot, MEASURES, noWebRtc } from './page-runtime.js';
import { libraryTable, wrapperFor, type Libraries, type Library } from './page-libraries.js';
import { inject } from './page-inject.js';
import { href, inside, insideAsync, page, pagesIn, watchFolder } from './page-workspace.js';
import { SEND_MAX } from './page-send.js';

export { LIBRARIES, type Library } from './page-libraries.js';
export { watchFolder } from './page-workspace.js';
export { gitHead, type HeadText } from './page-head.js';
export { inject } from './page-inject.js';

/** Requests stay on the process's own origin, with inline code, data: and blob: URLs: a page fetches nothing from the
 *  network. (Where its frame navigates, CSP does not say: see page-guard.ts.) A blocked request is reported, never silent. */
export const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'";
const HEADERS = { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-DNS-Prefetch-Control': 'off' };
const HTML_TYPE = FILE_TYPES.get('html')!;
const mimeOf = (file: string) => typeOfFile(file) ?? 'application/octet-stream';
/** What an attachment is served as: an image, a sound, a video, a PDF or text as what it is, anything else as bytes,
 *  so that no page can load it as a script, a style, a worker or WebAssembly (nosniff). */
const MEDIA_TYPES = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/(?:pdf|json)|text\/(?:plain|csv|markdown|html))$/;
const mediaType = (mime: string) => {
  const [essence, ...rest] = mime.split(';'), type = essence.trim().toLowerCase(), charset = rest.map(p => p.trim()).find(p => /^charset=[\w.-]{1,40}$/i.test(p));
  return MEDIA_TYPES.test(type) ? (charset ? `${type}; ${charset}` : type) : 'application/octet-stream';
};
/** An attachment as a document: it loads nothing but its own images and media, and never runs. */
const MEDIA_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
/** A page the model writes in show_view, or a page check's: a plain name, its file in the process's folder. */
const VIEW_NAME = /^[A-Za-z0-9_-]{1,200}$/;
const viewFile = (name: string) => {
  if (!VIEW_NAME.test(name)) throw new Error(`a page's name is up to 200 letters, digits, "_" and "-": not "${name.slice(0, 60)}"`);
  return `${name}.html`;
};

export type Served = { status: number; headers: Record<string, string>; body: string | Buffer };
type PageProcess = {
  key: string; results: ResultSource; work?: string; head?: (rel: string) => HeadText; views: string; // views: its real path
  version: number; history: { v: number; paths: string[] }[]; waiters: Set<() => void>; stop?: () => void; notifies?: boolean; // notifies: the host says when a result comes
  misses: { at: number; path: string }[]; written: Map<string, number>;
  seen: { length: number; results: ResultEntry[] };
};
const ok = (type: string, body: string | Buffer): Served => ({ status: 200, headers: { ...HEADERS, 'Content-Type': type }, body });

export type PageHost = Awaited<ReturnType<typeof startPageHost>>;

/** The domains an MCP App declares (its resource's _meta.ui.csp), used only where the host lets apps reach the network. */
export type AppCsp = { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] };
type App = { owner: string; load: () => Promise<{ html: string; csp?: AppCsp }>; network: boolean; got?: Promise<{ html: string; csp?: AppCsp }> };
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

type ParentOrigins = readonly string[] | (() => readonly string[]);
/** Schemes that cannot stand alone as a window's: each names pages anyone can make (any site, any data: or blob:
 *  document), or none of a window's own. */
const SHARED_SCHEME = /^(?:https?|wss?|data|blob|javascript|about|filesystem):$/;
/** Who may frame pages and apps (frame-ancestors): exact http(s) origins, or a scheme alone for a window that has no
 *  origin to name, "file:" for an Electron window loaded from a file, or the app's own scheme ("app:"). */
function parentOrigins(origins: readonly string[]): string[] {
  return [...new Set(origins.map(value => {
    if (/^[a-z][a-z0-9+.-]*:$/.test(value)) {
      if (SHARED_SCHEME.test(value)) throw new Error(`pageParentOrigins: "${value}" alone would let any such page frame pages; give exact origins`);
      return value;
    }
    let url: URL;
    try { url = new URL(value); } catch { url = new URL('invalid:'); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || value.includes('*') || ![url.origin, url.origin + '/'].includes(value))
      throw new Error('pageParentOrigins requires exact HTTP or HTTPS origins, or a scheme of the app\'s own alone, such as "file:" or "app:"');
    return url.origin;
  }))];
}
export async function startPageHost(o: { libraries?: Library[]; pageParentOrigins?: ParentOrigins } = {}) {
  const configured = o.pageParentOrigins;
  const fixed = typeof configured === 'function' || configured === undefined ? undefined : parentOrigins(configured);
  const parents = () => typeof configured === 'function' ? parentOrigins(configured()) : fixed;
  const libs = libraryTable(o.libraries ?? []), grants = pageGrants();
  const processes = new Map<string, PageProcess>();
  const apps = new Map<string, App>(); // by the app resource URL
  const server = http.createServer((req, res) => {
    const at = originOf(req.headers.host ?? '', port); // the origin is the key: no other process's pages, data or media
    if (at && 'app' in at) { // an MCP App: an origin of its own
      const url = `http://app-${at.app}.localhost:${port}/`, resource = apps.get(url);
      void serveApp(resource, req.url ?? '/', parents).then(s => {
        if (apps.get(url) !== resource) res.writeHead(404, HEADERS).end();
        else res.writeHead(s.status, s.headers).end(s.body);
      }, () => res.writeHead(502, HEADERS).end());
      return;
    }
    const gone = new AbortController(); res.once('close', () => gone.abort()); // a page that leaves stops its wait
    void serve(at && processes.get(at.key), req.url ?? '/', { libs, parents, grants, work: at?.work, gone: gone.signal }).then(async result => {
      if ('file' in result) await sendPageFile(result, req, res);
      else res.writeHead(result.status, result.headers).end(result.body);
    }).catch(() => { if (!res.headersSent && !res.destroyed) res.writeHead(500, HEADERS).end(); else res.destroy(); });
  });
  const port = await listenLoopback(server);
  const get = (key: string) => { const t = processes.get(key); if (!t) throw new Error(`no page task ${key}`); return t; };

  return {
    port,
    base: (key: string) => `http://${key}.localhost:${port}`,
    /** What a page can import by name, for a report that needs to say so. */
    get pinned() { return libs.pinned; },
    /** A process's pages: its results, its working folder (if it has one), and a folder for pages the model writes. */
    add(t: { results: ResultSource; dir: string; work?: string; head?: (rel: string) => HeadText }): string {
      const key = randomBytes(16).toString('hex'), folder = path.join(t.dir, 'views'); fs.mkdirSync(folder, { recursive: true });
      const views = fs.realpathSync(folder); // found once: the folder never moves
      processes.set(key, { key, results: t.results, work: t.work, ...(t.head ? { head: t.head } : {}), views, version: 0, history: [], waiters: new Set(), misses: [], written: new Map(), seen: { length: -1, results: [] } });
      return key;
    },
    remove(key: string) {
      const task = processes.get(key);
      if (!task) return;
      task.stop?.();
      for (const wake of task.waiters) wake();
      for (const [url, app] of apps) if (app.owner === key) apps.delete(url);
      processes.delete(key);
    },
    /** Keep a page by a plain name (letters, digits, "_" and "-"): its path under /view/, with a version. */
    writeView(key: string, name: string, html: string): string {
      const t = get(key), file = viewFile(name); fs.writeFileSync(path.join(t.views, file), html);
      const v = (t.written.get(file) ?? 0) + 1; t.written.set(file, v); return `${file}?v=${v}`;
    },
    /** A page writeView kept, gone: a page check's own copy, once it is checked. */
    removeView(key: string, name: string): void {
      const t = processes.get(key), file = viewFile(name); if (!t) return;
      fs.rmSync(path.join(t.views, file), { force: true }); t.written.delete(file);
    },
    workFile: (key: string, rel: string) => { const t = get(key); const f = t.work ? page(t.work, rel) : null; return f ? path.relative(fs.realpathSync(t.work!), f).split(path.sep).join('/') : null; },
    /** Any file in the working folder (an image, a sound, a model), as a path under it: what /work/ serves. */
    workAny: (key: string, rel: string) => { const t = get(key); const f = t.work ? inside(t.work, rel.replace(/^\/+/, '')) : null; return f ? path.relative(fs.realpathSync(t.work!), f).split(path.sep).join('/') : null; },
    workPages: (key: string) => { const t = get(key); return t.work ? pagesIn(t.work).sort() : []; },
    /** A text file in the working folder, for a code or diff panel: its path under the folder and its text, or why not. */
    workText: (key: string, rel: string): { rel: string; text: string } | { why: string } => {
      const t = get(key); if (!t.work) return { why: 'this task has no working folder' };
      const f = inside(t.work, rel.replace(/^\/+/, ''));
      if (!f) return { why: `no file "${rel}" in the working folder` };
      const { size, bytes } = readText(f);
      if (!bytes) return { why: `"${rel}" is ${(size / 1e6).toFixed(1)} MB; code and diff panels show files up to ${TEXT_MAX / 1e6} MB` };
      if (bytes.subarray(0, 8000).includes(0)) return { why: `"${rel}" is not text` };
      return { rel: path.relative(fs.realpathSync(t.work), f).split(path.sep).join('/'), text: bytes.toString('utf8') };
    },
    /** A file as the last commit has it, or why there is nothing to compare with: the process's head says (a host's,
     *  or gitHead), for a file in the working folder. Vindu runs no git of its own. */
    headText: (key: string, rel: string): HeadText => {
      const t = get(key); if (!t.work) return { why: 'this task has no working folder' };
      if (!t.head) return { why: 'this host gives no last commit to compare with; show the file with a code panel' };
      const f = inside(t.work, rel.replace(/^\/+/, ''));
      if (!f) return { why: `no file "${rel}" in the working folder` };
      return t.head(path.relative(fs.realpathSync(t.work), f).split(path.sep).join('/'));
    },
    misses: (key: string, since: number) => get(key).misses.filter(m => m.at >= since).map(m => m.path),
    /** A result came for a process: its pages that wait to hear are answered now. Once a host says so, they ask the store only every 2 s. */
    notify(key: string) { const t = processes.get(key); if (!t) return; t.notifies = true; for (const wake of t.waiters) wake(); },
    /** An MCP App's HTML, on an origin of its own, read from its server when the frame first loads it. */
    prepareApp(owner: string, load: App['load'], network = false) {
      const url = `http://app-${randomBytes(16).toString('hex')}.localhost:${port}/`;
      return { url, mount: () => apps.set(url, { owner, load, network }) };
    },
    removeApp: (url: string) => apps.delete(url),
    /** A page in the working folder as the window and a check load it: on the work origin for the results it may read
     *  (uses). rel is a path under the folder, as workFile gives it. */
    workUrl(key: string, rel: string, query = '', uses: string[] = [], hash = ''): string {
      get(key);
      const q = [query, uses.length ? `uses=${uses.map(encodeURIComponent).join(',')}` : ''].filter(Boolean).join('&');
      return `http://${grants.name(key, uses)}.localhost:${port}/work/${href(rel)}${q ? `?${q}` : ''}${hash}`;
    },
    /** What a request for url gets, in process: on the process's own origin, or on origin (a work origin of the process,
     *  as workUrl gives it). */
    serve: async (key: string, url: string, origin?: string): Promise<Served> => {
      const at = origin === undefined ? { key } : originOf(new URL(origin).host, port);
      const mine = at && 'key' in at && at.key === key ? at : undefined;
      const result = await serve(mine && processes.get(key), url, { libs, parents, grants, work: mine?.work });
      return 'file' in result ? readPageFile(result) : result;
    },
    close: () => new Promise<void>(r => { for (const k of processes.keys()) processes.get(k)?.stop?.(); for (const t of processes.values()) for (const w of t.waiters) w(); server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** Who may frame what the host serves, as a CSP directive: nothing said when the host set no pageParentOrigins. */
const ancestorsOf = (allowed: string[] | undefined) => allowed ? `; frame-ancestors ${allowed.join(' ') || "'none'"}` : '';
async function serveApp(a: App | undefined, url: string, parents: () => string[] | undefined): Promise<Served> {
  if (!a || new URL(url, 'http://app').pathname !== '/') return { status: 404, headers: { ...HEADERS, 'Content-Type': 'text/plain' }, body: 'not found' };
  const allowed = parents(); // a host's list that throws fails this request alone
  const got = await (a.got ??= a.load().catch((error: unknown) => { a.got = undefined; throw error; })); // a failed load is tried again on the next request
  return { status: 200, headers: { ...HEADERS, 'Content-Security-Policy': appCsp(got.csp, a.network) + ancestorsOf(allowed), 'Content-Type': HTML_TYPE }, body: got.html };
}

/** What a request's Host names: an MCP App, or a process (on a work origin, with its grant if it has one). Only on
 *  the host's own port, exactly. */
function originOf(host: string, port: number): { app: string } | { key: string; work?: { grant?: string } } | undefined {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- built from constants only: the key lengths and the host's own port
  const m = new RegExp(`^(?:app-([a-f0-9]{32})|work-([a-f0-9]{32})(?:-([a-f0-9]{${GRANT_LENGTH}}))?|([a-f0-9]{32}))\\.localhost:${port}$`).exec(host);
  return !m ? undefined : m[1] ? { app: m[1] } : m[2] ? { key: m[2], work: m[3] ? { grant: m[3] } : {} } : { key: m[4] };
}
type Serving = { libs: Libraries; parents: () => string[] | undefined; grants: PageGrants; work?: { grant?: string }; gone?: AbortSignal };
async function serve(t: PageProcess | undefined, url: string, { libs, parents, grants, work, gone }: Serving): Promise<Served | PageFile> {
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
  const uses = work ? grants.granted(t.key, named, work.grant) : named, again = work ? (uses.length ? `uses=${uses.map(encodeURIComponent).join(',')}` : '') : undefined;
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
      if (!runs) return file(f, undefined, sandboxed); // as a file: an image, a sound, a script a page the model wrote imports
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
  return `(${noWebRtc.toString()})(window);\nglobalThis.__vinduCompute = (${makeCompute.toString()})();\n(${boot.toString()})(${JSON.stringify(Object.fromEntries(data))}, ${live}, ${JSON.stringify(at)}, ${MEASURES});\n`;
}
