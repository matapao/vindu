// Runs in the page, as its first script. It must stand alone: it is sent as source. Its types say what it reads of the
// page and of the libraries the page host serves (page-libraries.ts); nothing of them is checked by the compiler.
import type { makeCompute } from './compute.js';
import type { BootParts } from './page-watch.js';
import type { Measures, TaskRecord } from './page-measures.js';

/** The arithmetic views do (compute.ts), sent to the page before the boot script, as globalThis.__vinduCompute. */
type Compute = ReturnType<typeof makeCompute>;
/** A window and what is global in it: its own constructors, as a frame's window has its own. */
type Realm = Window & typeof globalThis;
/** WebRTC taken away. Chromium applies no CSP to the STUN and TURN servers a peer connection reaches, so a page could
 *  send what it read anywhere with one. Also taken from each frame the page makes on its origin, as the page reaches
 *  into it (contentWindow, contentDocument). A frame whose own document runs a script (srcdoc, a data: URL, an SVG)
 *  still has it: only the browser can take it from there, as the check driver does. Stands alone: sent as source. */
export function noWebRtc(w: Realm) {
  const off = (x: Realm | null | undefined) => {
    try {
      if (!x || Object.getOwnPropertyDescriptor(x, 'RTCPeerConnection')?.configurable === false) return; // done already
      const refuse = function () {
        throw new x.DOMException('WebRTC is off in pages: it would reach the network', 'NotAllowedError');
      };
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection'])
        Object.defineProperty(x, name, { value: refuse, writable: false, configurable: false });
      for (const type of [x.HTMLIFrameElement, x.HTMLFrameElement, x.HTMLObjectElement])
        for (const prop of ['contentWindow', 'contentDocument']) {
          const d = type && Object.getOwnPropertyDescriptor(type.prototype, prop);
          // oxlint-disable-next-line typescript/unbound-method -- the original getter, called below with each element as this
          const get = d?.get;
          if (get)
            Object.defineProperty(type.prototype, prop, {
              ...d,
              get() {
                const v = get.call(this);
                off(prop === 'contentWindow' ? v : v?.defaultView);
                return v;
              },
            });
        }
    } catch {
      /* a frame of another origin: the page cannot reach into it either */
    }
  };
  off(w);
}

export function boot(
  data: Record<string, unknown>,
  live: boolean,
  at: { v: number; n: number; most: number; parents?: string[]; work?: boolean; again?: string },
  measure: Measures,
  { watch, wrapLoads }: BootParts,
) {
  const t: TaskRecord = {
    errors: [],
    warnings: [],
    failed: [],
    blocked: [],
    charts: [],
    three: [],
    chartjs: null,
    computed: [],
    libraries: [],
    fetched: [],
    sent: [],
    contexts: new WeakMap(),
    counts: { errors: 0, warnings: 0, charts: 0, three: 0, sent: 0 },
  }; // every one is counted, even past what is kept
  // what the check and the library wrappers share: kept, never swapped for another (the page's code runs beside it,
  // so what it holds is the page's account of itself, not proof)
  Object.defineProperty(window, '__task', { value: t, writable: false, configurable: false });
  const say = (x: unknown) => {
    if (typeof x === 'string') return x;
    if (x instanceof Error) return x.message;
    try {
      return JSON.stringify(x);
    } catch {
      return String(x);
    }
  };
  const keep = (list: string[], s: string, n = 300) => {
    if (list.length < 200) list.push(s.slice(0, n));
  }; // a page that errors every frame stays bounded
  const err = (s: string) => {
    t.counts.errors++;
    keep(t.errors, s);
  };
  const warn = (s: string) => {
    t.counts.warnings++;
    keep(t.warnings, s);
  };
  const C = (globalThis as typeof globalThis & { __vinduCompute: Compute }).__vinduCompute; // the same arithmetic as views (compute.ts), sent before this script
  const compute = (rows: Record<string, unknown>[], expr: string, inputs: Record<string, number> = {}): number => {
    const v = C.setValue(C.parse(String(expr)), rows, inputs);
    if (v === null) throw new Error(`${expr} has no numbers to compute with`);
    return v;
  };
  const keepComputed = (v: unknown) => {
    if (typeof v === 'number' && t.computed.length < 10000) t.computed.push(v);
  };
  // the window's bridge, as MCP Apps have theirs: what the person picked in the page (vindu.select), and a follow-up it
  // proposes (vindu.ask). Neither reaches the model on its own: a chip above the prompt, and the prompt box, unsent.
  // The window is one of the host's parents (pageParentOrigins): an exact origin, or one named by its scheme alone, which
  // frame-ancestors holds the frame to; a file: window has no origin to post to, so it is posted to as "*".
  const embeddingOrigin = location.ancestorOrigins?.[0] || (document.referrer && new URL(document.referrer).origin);
  const byScheme = (parents: string[]) => {
    const scheme = parents.find(
      (p) => p.endsWith(':') && (embeddingOrigin ? embeddingOrigin.startsWith(`${p}//`) : parents.length === 1),
    );
    if (scheme === undefined) return undefined;
    return /^[a-z][a-z0-9+.-]*:\/\/[^/]+$/.test(embeddingOrigin) ? embeddingOrigin : '*';
  };
  const targetOf = (parents: string[] | undefined) => {
    if (!parents) return embeddingOrigin && embeddingOrigin !== 'null' ? embeddingOrigin : '*';
    return (
      parents.find((origin) => origin === embeddingOrigin) ??
      byScheme(parents) ??
      (!embeddingOrigin && parents.length === 1 ? parents[0] : undefined)
    );
  };
  const target = targetOf(at.parents);
  const tellParent = (message: unknown) => {
    if (target && parent !== window) parent.postMessage(message, target);
  };
  const interactions = Object.freeze({
    select(items: unknown, note?: string) {
      tellParent({
        vindu: 'select',
        items: JSON.parse(JSON.stringify(items ?? [])),
        ...(typeof note === 'string' ? { note } : {}),
      });
    },
    ask(prompt: string, items?: unknown) {
      tellParent({
        vindu: 'ask',
        prompt: String(prompt ?? ''),
        ...(items !== undefined ? { items: JSON.parse(JSON.stringify(items)) } : {}),
      });
    },
  });
  Object.assign(window, { vindu: interactions });
  const pageFetch = window.fetch.bind(window);
  const call = <T>(f: (x: T) => void, x: T) => {
    try {
      f(x);
    } catch (e) {
      err(`a task.on listener: ${say(e)}`);
    }
  };

  // What the page hears: files in the working folder that changed, and results the process got after the page loaded. One
  // page of the process holds the request that waits for them (a browser holds only a few at once to one origin) and tells
  // the others, which each ask for what they have not heard.
  const hear = {
    change: new Set<(paths: string[]) => void>(),
    result: new Set<(r: { id: string; tool: string; server: string }) => void>(),
  };
  let v = at.v,
    n = at.n,
    listening = false,
    full = false;
  try {
    performance.setResourceTimingBufferSize(5000);
    performance.addEventListener('resourcetimingbufferfull', () => {
      full = true;
    });
  } catch {
    /* an old browser */
  }
  /** A URL as a path in the working folder, as the host names a changed file: "game/index.html". */
  const workPath = (u: string): string | null => {
    try {
      const x = new URL(u, location.href);
      if (x.origin !== location.origin || !x.pathname.startsWith('/work/')) return null;
      const p = decodeURIComponent(x.pathname.slice(6));
      return !p || p.endsWith('/') ? `${p}index.html` : p;
    } catch {
      return null;
    }
  };
  /** The files the page loaded from the working folder: itself, its scripts, styles, images, and (unless it handles
   *  changes itself) what it fetched. */
  const loaded = (fetchedToo: boolean) => {
    const files = new Map<string, { url: string; revision?: string }>();
    for (const entry of [
      ...performance.getEntriesByType('navigation'),
      ...performance.getEntriesByType('resource'),
    ] as PerformanceResourceTiming[]) {
      if (!fetchedToo && /^(fetch|xmlhttprequest|beacon)$/.test(entry.initiatorType)) continue;
      const path = workPath(entry.name);
      if (path && (!files.has(path) || entry.initiatorType === 'link'))
        files.set(path, {
          url: entry.name,
          revision: entry.serverTiming?.find((s) => s.name === 'vindu')?.description,
        });
    }
    const self = workPath(location.href);
    if (self && !files.has(self)) files.set(self, { url: location.href });
    return files;
  };
  const changed = async (paths: string[]) => {
    for (const f of hear.change) call(f, paths);
    if (!live) return;
    const own = loaded(hear.change.size === 0);
    const candidates = full || paths.includes('*') ? paths : paths.filter((p) => own.has(p));
    // Folder notifications are debounced. Ignore a write that already supplied the bytes this page loaded.
    const mine: string[] = [];
    for (const path of candidates) {
      const loaded = own.get(path);
      if (loaded?.revision) {
        try {
          const current = await pageFetch(loaded.url, { method: 'HEAD', cache: 'no-store' });
          if (current.ok && current.headers.get('Server-Timing') === `vindu;desc="${loaded.revision}"`) continue;
        } catch {
          /* a removed or unavailable resource also needs a reload */
        }
      }
      mine.push(path);
    }
    if (!mine.length) return;
    if (mine.some((p) => p === '*' || !/\.css$/i.test(p))) {
      location.reload();
      return;
    }
    for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'))
      if (workPath(l.href)) {
        const u = new URL(l.href);
        u.searchParams.set('v', String(v));
        l.href = u.href;
      }
  };
  const sync = async (wait: boolean) => {
    const e: { v: number; paths: string[]; n: number; results: { id: string; tool: string; server: string }[] } =
      await (await pageFetch(`/__vindu/events?v=${v}&n=${n}${wait ? '' : '&wait=0'}`, { cache: 'no-store' })).json();
    if (e.v > v) {
      v = e.v;
      await changed(e.paths);
    }
    if (e.n > n) {
      n = e.n;
      for (const r of e.results) for (const f of hear.result) call(f, r);
    }
  };
  const listen = () => {
    if (listening) return;
    listening = true;
    let bc: BroadcastChannel | undefined;
    try {
      bc = new BroadcastChannel('vindu-events');
      bc.onmessage = () => {
        sync(false).catch(() => {});
      };
    } catch {
      bc = undefined;
    }
    const poll = async () => {
      for (;;) {
        try {
          await sync(true);
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel's postMessage takes no target: it reaches this origin's pages only
          bc?.postMessage(1);
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };
    const locks = navigator.locks as LockManager | undefined; // not in every browser
    if (locks && bc)
      void locks.request('vindu-events', poll); // held while this page is open; then the next page that listens polls
    else void poll();
  };
  const listenSoon = () => {
    if (document.readyState === 'complete') listen();
    else addEventListener('load', listen);
  };

  // task.send: what the page sends goes to the window, which hands it to the model only while the person is using the
  // page (a click or a key in it, just now), a few at a time. A copy being checked, or a page opened on its own, has
  // nobody to send to: it keeps what it would have sent, for the check's report.
  let sends = 0;
  const replies = new Map<
    number,
    { ok: (x: unknown) => void; no: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  addEventListener('message', (e: MessageEvent) => {
    const d = e.data;
    if (e.source !== parent || parent === window || (target !== '*' && e.origin !== target) || !d || d.vindu !== 'sent')
      return;
    const w = replies.get(d.n);
    if (!w) return;
    replies.delete(d.n);
    clearTimeout(w.timer);
    if (d.ok) w.ok({ sent: true });
    else w.no(new Error(String(d.why)));
  });
  const send = (value: unknown): Promise<unknown> => {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      return Promise.reject(new Error('task.send takes a value JSON can hold'));
    }
    if (json === undefined)
      return Promise.reject(new Error('task.send takes a value: text, a number, a list or an object'));
    if (json.length > at.most)
      return Promise.reject(new Error(`too long to send: ${json.length} characters as JSON, ${at.most} at most`));
    if (parent === window) {
      t.counts.sent++;
      keep(t.sent, json);
      return Promise.resolve({ sent: false, checked: true });
    }
    if (!target) return Promise.reject(new Error('This page is not embedded by an allowed host.'));
    const k = ++sends;
    return new Promise((ok, no) => {
      replies.set(k, {
        ok,
        no,
        timer: setTimeout(() => {
          replies.delete(k);
          no(new Error('the window did not answer'));
        }, 5000),
      });
      tellParent({ vindu: 'send', n: k, value: JSON.parse(json) });
    });
  };

  // How far the person has read the page, for the window and the host alone: the furthest share of the document they
  // have had in view (0 to 1, from 0.985 on 1), or of a box that scrolls in it and is at least half its height, told as
  // it grows, four times a second at most. A page that fits its frame, with no such box, is read once it has been in
  // view 2.5 s. A page that knows better (pdf.js's viewer, whose pages come as they load; Monaco, which scrolls itself)
  // says it itself with task.read, and from then on only that is told.
  let readSaid = 0,
    readOwn = false,
    readTimer: ReturnType<typeof setTimeout> | undefined,
    fitTimer: ReturnType<typeof setTimeout> | undefined;
  const readTell = (share: number) => {
    const value = share >= 0.985 ? 1 : Math.round(share * 1000) / 1000;
    if (!(value > readSaid) || parent === window) return;
    readSaid = value;
    readTimer ??= setTimeout(() => {
      readTimer = undefined;
      tellParent({ vindu: 'read', value: readSaid });
    }, 250);
  };
  const tall = () => (document.scrollingElement ?? document.documentElement).scrollHeight;
  const box = (el: unknown): el is Element =>
    el instanceof Element && el.clientHeight >= innerHeight / 2 && el.scrollHeight > el.clientHeight + 1;
  const boxes = () => {
    const all = document.body?.getElementsByTagName('*') ?? [];
    for (let i = 0; i < all.length && i < 5000; i++)
      if (box(all[i]) && /auto|scroll/.test(getComputedStyle(all[i]).overflowY)) return true;
    return false;
  };
  const scrolled = (e?: Event) => {
    if (readOwn || document.visibilityState !== 'visible') return;
    const inner = e?.target;
    if (box(inner)) {
      readTell((inner.scrollTop + inner.clientHeight) / inner.scrollHeight);
      return;
    }
    if (tall() > innerHeight + 1) {
      readTell((scrollY + innerHeight) / tall());
      return;
    }
    fitTimer ??= setTimeout(() => {
      fitTimer = undefined;
      if (!readOwn && tall() <= innerHeight + 1 && document.visibilityState === 'visible' && !boxes()) readTell(1);
      else if (tall() > innerHeight + 1) scrolled();
    }, 2500);
  };
  addEventListener('scroll', scrolled, { passive: true, capture: true });
  addEventListener('resize', () => scrolled());
  addEventListener('load', () => scrolled());
  document.addEventListener('visibilitychange', () => scrolled());
  try {
    new ResizeObserver(() => scrolled()).observe(document.documentElement);
  } catch {
    /* an old browser: scrolls and resizes still tell */
  }

  // the data the page uses, exact, and arithmetic done the way views do it (values computed here are not "typed")
  Object.assign(window, {
    task: Object.freeze({
      data: Object.freeze(data),
      value(rows: Record<string, unknown>[], expr = 'count()', inputs: Record<string, number> = {}) {
        const v = compute(rows, expr, inputs);
        keepComputed(v);
        return v;
      },
      group(rows: Record<string, unknown>[], field: string, expr = 'count()', inputs: Record<string, number> = {}) {
        const groups = new Map<string, Record<string, unknown>[]>();
        for (const r of rows) {
          // oxlint-disable-next-line typescript/no-base-to-string -- a page groups by any field: each value's own text names its group
          const k = String(r?.[field] ?? '');
          const xs = groups.get(k);
          if (xs) xs.push(r);
          else groups.set(k, [r]);
        }
        const name = C.computedName(expr);
        return [...groups].map(([k, rs]) => {
          const v = compute(rs, expr, inputs);
          keepComputed(v);
          return { [field]: k, [name]: v };
        });
      },
      /** Fields computed for each row ({ amount: 'hours * rate' }), as views compute them; not counted as typed numbers. */
      compute(rows: Record<string, unknown>[], fields: Record<string, string>, inputs: Record<string, number> = {}) {
        const r = C.addFields(rows, fields, inputs).rows;
        for (const row of r) for (const k of Object.keys(fields)) keepComputed(row[k]);
        return r;
      },
      /** Any result of the process, exact, by its id: what /data/<id>.json serves. A page from the working folder (on
       *  a work origin, at.work) reads only the results in its uses, named again (at.again). */
      get(id: string) {
        return fetch(`/data/${encodeURIComponent(String(id))}.json${at.again ? `?${at.again}` : ''}`, {
          cache: 'no-store',
        }).then((r) => {
          if (!r.ok)
            throw new Error(
              at.work
                ? `no result "${id}" for this page: a page from the working folder reads only the results in its uses`
                : `no result "${id}"`,
            );
          return r.json();
        });
      },
      /** "result": each result the process gets from now on ({id, tool, server}; task.get(id) reads it), none for a page
       *  from the working folder. "change": the files
       *  in the working folder that change (paths in it); a live page that listens reloads only for its own files, not
       *  for what it fetched. Returns a function that stops listening. */
      on(what: string, f: (x: never) => void) {
        if (what !== 'result' && what !== 'change') throw new Error('task.on takes "result" or "change"');
        if (typeof f !== 'function') throw new Error('task.on takes a function');
        const set: Set<(x: never) => void> = hear[what];
        set.add(f);
        listenSoon();
        return () => {
          set.delete(f);
        };
      },
      send,
      /** How far the person has read the page (0 to 1), from a page that knows it better than its scroll does. */
      read(share: number) {
        readOwn = true;
        if (typeof share === 'number' && Number.isFinite(share)) readTell(Math.min(1, Math.max(0, share)));
      },
    }),
  });
  watch({ t, keep, err, warn, say, tellParent, measure });
  wrapLoads({ t, keep, pageFetch });
  if (live) listenSoon();
}
