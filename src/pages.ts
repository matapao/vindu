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
// A static page (/work or /view on the process's own origin, asked for with static=1) is served as it is written, with
// no import map and no boot script, under a policy that runs none of it and reaches nothing but its own images, styles,
// media and fonts (STATIC_CSP and sandbox); its frame is drawn with sandbox="" as well.
// Every client loads the same URLs: an Electron window, a browser, a headless check.
// A page cannot fetch from the network: its CSP keeps every request on its own origin. Its frame can still navigate
// anywhere, with what the page read in the address, and only the browser that shows it can refuse that: the host's
// window, with page-guard.ts (frame-src in its CSP, or Electron's will-frame-navigate), and the headless check's
// driver. Where the host applies no guard, a page's data can leave with it. WebRTC, which no CSP covers in Chromium,
// is taken from the page as far as a script can (noWebRtc).
import fs from 'node:fs';
import { readPageFile, sendPageFile } from './page-file.js';
import http from 'node:http';
import { listenLoopback } from './loopback.js';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pageGrants } from './page-grants.js';
import { readText, TEXT_MAX } from './page-head.js';
import type { HeadText } from './page-head.js';
import type { ResultEntry, ResultSource } from './results.js';
import { libraryTable, type Library } from './page-libraries.js';
import { href, inside, page, pagesIn } from './page-workspace.js';
import { readTextStart, type TextStart } from './text-start.js';
import { HEADERS, originOf, serve, serveApp, viewFile, type App, type Served } from './page-serve.js';

export { LIBRARIES, type Library } from './page-libraries.js';
export { watchFolder } from './page-workspace.js';
export { gitHead, type HeadText } from './page-head.js';
export { inject } from './page-inject.js';

export type PageProcess = {
  key: string;
  results: ResultSource;
  work?: string;
  head?: (rel: string) => HeadText;
  views: string; // views: its real path
  version: number;
  history: { v: number; paths: string[] }[];
  waiters: Set<() => void>;
  stop?: () => void;
  notifies?: boolean; // notifies: the host says when a result comes
  misses: { at: number; path: string }[];
  written: Map<string, number>;
  seen: { length: number; results: ResultEntry[] };
};
export type PageHost = Awaited<ReturnType<typeof startPageHost>>;

type ParentOrigins = readonly string[] | (() => readonly string[]);
/** Schemes that cannot stand alone as a window's: each names pages anyone can make (any site, any data: or blob:
 *  document), or none of a window's own. */
const SHARED_SCHEME = /^(?:https?|wss?|data|blob|javascript|about|filesystem):$/;
/** Who may frame pages and apps (frame-ancestors): exact http(s) origins, or a scheme alone for a window that has no
 *  origin to name, "file:" for an Electron window loaded from a file, or the app's own scheme ("app:"). */
function parentOrigins(origins: readonly string[]): string[] {
  return [
    ...new Set(
      origins.map((value) => {
        if (/^[a-z][a-z0-9+.-]*:$/.test(value)) {
          if (SHARED_SCHEME.test(value))
            throw new Error(
              `pageParentOrigins: "${value}" alone would let any such page frame pages; give exact origins`,
            );
          return value;
        }
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          url = new URL('invalid:');
        }
        if (
          !/^https?:$/.test(url.protocol) ||
          url.username ||
          url.password ||
          value.includes('*') ||
          ![url.origin, url.origin + '/'].includes(value)
        )
          throw new Error(
            'pageParentOrigins requires exact HTTP or HTTPS origins, or a scheme of the app\'s own alone, such as "file:" or "app:"',
          );
        return url.origin;
      }),
    ),
  ];
}
export async function startPageHost(o: { libraries?: Library[]; pageParentOrigins?: ParentOrigins } = {}) {
  const configured = o.pageParentOrigins;
  const fixed = typeof configured === 'function' || configured === undefined ? undefined : parentOrigins(configured);
  const parents = () => (typeof configured === 'function' ? parentOrigins(configured()) : fixed);
  const libs = libraryTable(o.libraries ?? []),
    grants = pageGrants();
  const processes = new Map<string, PageProcess>();
  const apps = new Map<string, App>(); // by the app resource URL
  const server = http.createServer((req, res) => {
    const at = originOf(req.headers.host ?? '', port); // the origin is the key: no other process's pages, data or media
    if (at && 'app' in at) {
      // an MCP App: an origin of its own
      const url = `http://app-${at.app}.localhost:${port}/`,
        resource = apps.get(url);
      void serveApp(resource, req.url ?? '/', parents).then(
        (s) => {
          if (apps.get(url) !== resource) res.writeHead(404, HEADERS).end();
          else res.writeHead(s.status, s.headers).end(s.body);
        },
        () => res.writeHead(502, HEADERS).end(),
      );
      return;
    }
    const gone = new AbortController();
    res.once('close', () => gone.abort()); // a page that leaves stops its wait
    void serve(at && processes.get(at.key), req.url ?? '/', {
      libs,
      parents,
      grants,
      work: at?.work,
      gone: gone.signal,
    })
      .then(async (result) => {
        if ('file' in result) await sendPageFile(result, req, res);
        else res.writeHead(result.status, result.headers).end(result.body);
      })
      .catch(() => {
        if (!res.headersSent && !res.destroyed) res.writeHead(500, HEADERS).end();
        else res.destroy();
      });
  });
  const port = await listenLoopback(server);
  const get = (key: string) => {
    const t = processes.get(key);
    if (!t) throw new Error(`no page task ${key}`);
    return t;
  };

  return {
    port,
    base: (key: string) => `http://${key}.localhost:${port}`,
    /** What a page can import by name, for a report that needs to say so. */
    get pinned() {
      return libs.pinned;
    },
    /** A process's pages: its results, its working folder (if it has one), and a folder for pages the model writes. */
    add(t: { results: ResultSource; dir: string; work?: string; head?: (rel: string) => HeadText }): string {
      const key = randomBytes(16).toString('hex'),
        folder = path.join(t.dir, 'views');
      fs.mkdirSync(folder, { recursive: true });
      const views = fs.realpathSync(folder); // found once: the folder never moves
      processes.set(key, {
        key,
        results: t.results,
        work: t.work,
        ...(t.head ? { head: t.head } : {}),
        views,
        version: 0,
        history: [],
        waiters: new Set(),
        misses: [],
        written: new Map(),
        seen: { length: -1, results: [] },
      });
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
      const t = get(key),
        file = viewFile(name);
      fs.writeFileSync(path.join(t.views, file), html);
      const v = (t.written.get(file) ?? 0) + 1;
      t.written.set(file, v);
      return `${file}?v=${v}`;
    },
    /** A page writeView kept, gone: a page check's own copy, once it is checked. */
    removeView(key: string, name: string): void {
      const t = processes.get(key),
        file = viewFile(name);
      if (!t) return;
      fs.rmSync(path.join(t.views, file), { force: true });
      t.written.delete(file);
    },
    workFile: (key: string, rel: string) => {
      const t = get(key);
      const f = t.work ? page(t.work, rel) : null;
      return f ? path.relative(fs.realpathSync(t.work!), f).split(path.sep).join('/') : null;
    },
    /** Any file in the working folder (an image, a sound, a model), as a path under it: what /work/ serves. */
    workAny: (key: string, rel: string) => {
      const t = get(key);
      const f = t.work ? inside(t.work, rel.replace(/^\/+/, '')) : null;
      return f ? path.relative(fs.realpathSync(t.work!), f).split(path.sep).join('/') : null;
    },
    /** Any file in the working folder, as a path under it and its real path on disk: a data file a table or a sheet reads. */
    workPath: (key: string, rel: string) => {
      const t = get(key);
      const f = t.work ? inside(t.work, rel.replace(/^\/+/, '')) : null;
      return f ? { rel: path.relative(fs.realpathSync(t.work!), f).split(path.sep).join('/'), file: f } : null;
    },
    workPages: (key: string) => {
      const t = get(key);
      return t.work ? pagesIn(t.work).sort() : [];
    },
    /** A text file in the working folder, for a code or diff panel: its path under the folder and its text, or why not. */
    workText: (key: string, rel: string): { rel: string; text: string } | { why: string } => {
      const t = get(key);
      if (!t.work) return { why: 'this task has no working folder' };
      const f = inside(t.work, rel.replace(/^\/+/, ''));
      if (!f) return { why: `no file "${rel}" in the working folder` };
      const { size, bytes } = readText(f);
      if (!bytes)
        return {
          why: `"${rel}" is ${(size / 1e6).toFixed(1)} MB; code and diff panels show files up to ${TEXT_MAX / 1e6} MB`,
        };
      if (bytes.subarray(0, 8000).includes(0)) return { why: `"${rel}" is not text` };
      return { rel: path.relative(fs.realpathSync(t.work), f).split(path.sep).join('/'), text: bytes.toString('utf8') };
    },
    /** The start of a text file in the working folder, for a document panel: its path under the folder, and at most
     *  most bytes of its text; or why not. */
    workStart: (key: string, rel: string, most: number): ({ rel: string } & TextStart) | { why: string } => {
      const t = get(key);
      if (!t.work) return { why: 'this task has no working folder' };
      const f = inside(t.work, rel.replace(/^\/+/, ''));
      if (!f) return { why: `no file "${rel}" in the working folder` };
      let start: TextStart | null;
      try {
        start = readTextStart(f, most);
      } catch {
        return { why: `"${rel}" could not be read` };
      }
      if (!start) return { why: `"${rel}" is not text` };
      return { rel: path.relative(fs.realpathSync(t.work), f).split(path.sep).join('/'), ...start };
    },
    /** A file as the last commit has it, or why there is nothing to compare with: the process's head says (a host's,
     *  or gitHead), for a file in the working folder. Vindu runs no git of its own. */
    headText: (key: string, rel: string): HeadText => {
      const t = get(key);
      if (!t.work) return { why: 'this task has no working folder' };
      if (!t.head) return { why: 'this host gives no last commit to compare with; show the file with a code panel' };
      const f = inside(t.work, rel.replace(/^\/+/, ''));
      if (!f) return { why: `no file "${rel}" in the working folder` };
      return t.head(path.relative(fs.realpathSync(t.work), f).split(path.sep).join('/'));
    },
    misses: (key: string, since: number) =>
      get(key)
        .misses.filter((m) => m.at >= since)
        .map((m) => m.path),
    /** A result came for a process: its pages that wait to hear are answered now. Once a host says so, they ask the store only every 2 s. */
    notify(key: string) {
      const t = processes.get(key);
      if (!t) return;
      t.notifies = true;
      for (const wake of t.waiters) wake();
    },
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
    close: () =>
      new Promise<void>((r) => {
        for (const k of processes.keys()) processes.get(k)?.stop?.();
        for (const t of processes.values()) for (const w of t.waiters) w();
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
