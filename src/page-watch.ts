// What the boot script (page-runtime.ts) does besides the page's own task API, in parts it is given as source, as the
// measures are: what the window that shows the page is told of it (its report, and what went wrong), and what the page
// loads (its fetches and requests, its canvases), as the check and the report count them. Each stands alone.
import type { CanvasUse, Measures, TaskRecord } from './page-measures.js';

/** An element that loads something (a script, an image, a stylesheet), as an error event's target may be. */
type Loading = EventTarget & { src?: string; href?: string; tagName?: string };

/** What the window is told of a page, as it runs there: errors, failed and blocked loads, dialogs, canvases and scenes. */
function watchPage({
  t,
  keep,
  err,
  warn,
  say,
  tellParent,
  measure,
}: {
  t: TaskRecord;
  keep: (list: string[], s: string, n?: number) => void;
  err: (s: string) => void;
  warn: (s: string) => void;
  say: (x: unknown) => string;
  tellParent: (message: unknown) => void;
  measure: Measures;
}) {
  // What the window that shows the page is told of it, as it runs there (page-report.ts keeps its shape): the page
  // itself, never what is in it. Of an error, its kind and the place in the page's own code it came from, not its
  // message, which can quote what the page was given or what the person typed; of what failed to load, its folder and
  // kind (a pinned library's path whole, as the page names it); of what was blocked, the rule and where it pointed.
  const placed: { kind: string; at?: string }[] = [],
    failedAt: Record<string, string>[] = [],
    blockedAt: { directive: string; what: string }[] = [];
  let dialogs = 0,
    posts = 0,
    ready = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const fileLine = (url: unknown, line: unknown): string | undefined => {
    try {
      const u = new URL(String(url), location.href),
        f = decodeURIComponent(u.pathname.split('/').pop() || '');
      return u.origin === location.origin &&
        !u.pathname.startsWith('/__vindu/') &&
        /^[\w.-]{1,80}$/.test(f) &&
        Number(line) > 0
        ? `${f}:${Math.floor(Number(line))}`
        : undefined;
    } catch {
      return undefined;
    }
  };
  /** The first place in a stack that is the page's own code, not this script: its file and line. */
  const firstOwn = (stack: unknown) => {
    for (const m of (typeof stack === 'string' ? stack : '').matchAll(/(https?:\/\/[^\s()@]+?):(\d+)(?::\d+)?\)?$/gm)) {
      const at = fileLine(m[1], m[2]);
      if (at) return at;
    }
    return undefined;
  };
  const kindOf = (x: unknown, fallback: string) => {
    const n = x instanceof Error ? x.name : fallback;
    return /^[A-Za-z_$][\w$]{0,40}$/.test(n) ? n : 'Error';
  };
  const report = () => {
    const doc = document.documentElement,
      nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const canvases = [...document.querySelectorAll('canvas')].slice(0, 8).map((c) => {
      const k = t.contexts.get(c),
        o: Record<string, unknown> = { context: k?.type ?? 'none', width: c.width, height: c.height };
      if (k?.draws !== undefined) o.drawn = k.draws > 0;
      else if (k?.type === '2d') {
        // whether anything is painted, read here: only the share of it leaves the page
        try {
          const p = measure.paint(k.ctx as CanvasRenderingContext2D, c.width, c.height);
          o.painted = p.painted;
          o.drawn = p.any;
        } catch {
          o.drawn = null;
        }
      }
      return o;
    });
    const three = t.three.slice(0, 4).map((r) => {
      // each renderer's main scene, by the types of what is in it
      const s = measure.scene(r, 16);
      return {
        frames: s.frames,
        draw_calls: s.frame?.calls ?? 0,
        triangles: s.frame?.triangles ?? 0,
        objects: s.objects,
      };
    });
    return {
      loaded: document.readyState === 'complete',
      ...(nav && nav.loadEventEnd > 0 ? { ms: Math.round(nav.loadEventEnd) } : {}),
      visible: document.visibilityState === 'visible',
      width: innerWidth,
      height: innerHeight,
      overflow: { x: Math.max(0, doc.scrollWidth - innerWidth), y: Math.max(0, doc.scrollHeight - innerHeight) },
      elements: document.body ? document.body.getElementsByTagName('*').length : 0,
      errors: t.counts.errors,
      places: placed.slice(0, 10),
      warnings: t.counts.warnings,
      failed: failedAt,
      blocked: blockedAt,
      canvases,
      three,
      charts: t.counts.charts + (t.chartjs ? Object.keys(t.chartjs.instances ?? {}).length : 0),
      libraries: t.libraries.slice(0, 8),
      dialogs,
    };
  };
  /** Told to the window once the page has loaded and run a little, then again a little after something changes. */
  const post = () => {
    timer = undefined;
    if (parent === window || posts >= 20) return;
    posts++;
    try {
      tellParent({ vindu: 'report', report: report() });
    } catch {
      /* the window went away */
    }
  };
  const again = () => {
    if (ready && !timer) timer = setTimeout(post, 800);
  };
  const first = () => {
    if (!ready) {
      ready = true;
      post();
    }
  };
  const place = (kind: string, at?: string) => {
    if (placed.length < 20) placed.push(at ? { kind, at } : { kind });
    again();
  };
  /** Where what failed to load came from: elsewhere, a pinned library (its path), or a folder of the page's origin. */
  const failedFrom = (u: URL, tag: string): Record<string, string> => {
    const top = u.pathname.split('/')[1] || '',
      ext = (/\.([a-z0-9]{1,8})$/i.exec(u.pathname)?.[1] ?? '').toLowerCase();
    if (u.origin !== location.origin) return { tag, in: 'elsewhere' };
    if (top === 'lib') return { tag, in: 'lib', path: u.pathname.slice(0, 160) };
    return { tag, in: ['work', 'view', 'data', 'media'].includes(top) ? top : 'page', ...(ext ? { ext } : {}) };
  };
  const failed = (el: Loading) => {
    try {
      const u = new URL(String(el.src || el.href), location.href),
        tag = String(el.tagName || 'other')
          .toLowerCase()
          .slice(0, 12);
      if (failedAt.length < 10) failedAt.push(failedFrom(u, tag));
    } catch {
      /* not an address */
    }
    again();
  };
  addEventListener(
    'error',
    (e: Event) => {
      const el: Loading | null = e.target;
      if (el && el !== window && (el.src || el.href)) {
        keep(t.failed, String(el.src || el.href), 4000);
        failed(el);
      } // whole: the report shortens URLs in the middle
      else if (e instanceof ErrorEvent) {
        err(`${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`);
        place(
          kindOf(e.error, /\b([A-Z][A-Za-z]*Error)\b/.exec(e.message)?.[1] ?? 'Error'),
          fileLine(e.filename, e.lineno),
        );
      }
    },
    true,
  );
  addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    err(`Unhandled rejection: ${say(e.reason)}`);
    place(
      e.reason instanceof Error ? `unhandled rejection: ${kindOf(e.reason, 'Error')}` : 'unhandled rejection',
      firstOwn(e.reason?.stack),
    );
  });
  /** What a rule blocked, without its address: inline code, eval, a data: or blob: URL, or the origin it was on. */
  const blockedWhat = (uri: string) => {
    if (['inline', 'eval'].includes(uri)) return uri;
    if (/^(data|blob)/.test(uri)) return uri.slice(0, 4);
    try {
      return new URL(uri).origin === location.origin ? 'its own' : 'elsewhere';
    } catch {
      return 'other';
    }
  };
  addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
    keep(t.blocked, `${e.blockedURI} (${e.effectiveDirective})`, 4000);
    if (blockedAt.length < 10)
      blockedAt.push({
        directive: /^[a-z-]{1,30}$/.test(e.effectiveDirective) ? e.effectiveDirective : 'other',
        what: blockedWhat(e.blockedURI),
      });
    again();
  });
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...a: unknown[]) => {
      (level === 'error' ? err : warn)(a.map(say).join(' '));
      if (level === 'error') place('console.error', firstOwn(new Error().stack));
      else again();
      orig(...a);
    };
  }
  window.alert = (m?: unknown) => {
    warn(`alert: ${say(m)}`);
    dialogs++;
    again();
  }; // a dialog would stop the page; it is noted instead
  window.confirm = (m?: string) => {
    warn(`confirm: ${m}`);
    dialogs++;
    again();
    return false;
  };
  window.prompt = (m?: string) => {
    warn(`prompt: ${m}`);
    dialogs++;
    again();
    return null;
  };
  addEventListener('load', () => {
    setTimeout(first, 1000);
  });
  setTimeout(first, 10_000); // a page whose load never comes: told as not loaded
}

/** What the page loads, kept for the check: the results it fetched, and the canvases it draws on (and, for WebGL, how
 *  often). The originals are taken here and called with each request or canvas as this. */
function wrapLoads({
  t,
  keep,
  pageFetch,
}: {
  t: TaskRecord;
  keep: (list: string[], s: string, n?: number) => void;
  pageFetch: typeof fetch;
}) {
  const fetched = (u: string | URL) => {
    try {
      const x = new URL(String(u), location.href);
      const id = decodeURIComponent(x.pathname.slice(6)).replace(/\.json$/, '');
      if (x.origin === location.origin && x.pathname.startsWith('/data/') && !t.fetched.includes(id))
        keep(t.fetched, id);
    } catch {
      /* not a URL */
    }
  };
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    fetched(input instanceof Request ? input.url : String(input));
    return pageFetch(input, init);
  };
  // oxlint-disable-next-line typescript/unbound-method -- the original, called below with each request as this
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    fetched(url);
    return Reflect.apply(open, this, [method, url, ...rest]);
  };
  // oxlint-disable-next-line typescript/unbound-method -- the original, called below with each canvas as this
  const getContext = HTMLCanvasElement.prototype.getContext;
  // the wrapper stands in for every form of getContext: it gives what the original gives
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const ctx: RenderingContext | null = Reflect.apply(getContext, this, [type, ...rest]);
    if (ctx && !t.contexts.has(this)) {
      const k: CanvasUse = { type: type === 'experimental-webgl' ? 'webgl' : type, ctx };
      if (/webgl/.test(type)) {
        k.draws = 0;
        const gl = ctx as WebGL2RenderingContext; // WebGL 1 has some of its draw calls, and is wrapped for those
        for (const f of [
          'drawArrays',
          'drawElements',
          'drawArraysInstanced',
          'drawElementsInstanced',
          'drawRangeElements',
        ] as const)
          if (typeof gl[f] === 'function') {
            const orig = gl[f];
            gl[f] = (...x: unknown[]) => {
              k.draws!++;
              return Reflect.apply(orig, gl, x);
            };
          }
      }
      t.contexts.set(this, k);
    }
    return ctx;
  } as typeof getContext;
}
/** Both, as the source a page is sent: the boot script's fifth argument. */
export const BOOT_PARTS = `{ watch: ${watchPage.toString()}, wrapLoads: ${wrapLoads.toString()} }`;
export type BootParts = { watch: typeof watchPage; wrapLoads: typeof wrapLoads };
