// Runs in the page, as its first script. It must stand alone: it is sent as source.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** WebRTC taken away. Chromium applies no CSP to the STUN and TURN servers a peer connection reaches, so a page could
 *  send what it read anywhere with one. Also taken from each frame the page makes on its origin, as the page reaches
 *  into it (contentWindow, contentDocument). A frame whose own document runs a script (srcdoc, a data: URL, an SVG)
 *  still has it: only the browser can take it from there, as the check driver does. Stands alone: sent as source. */
export function noWebRtc(w: any) {
  const off = (x: any) => {
    try {
      if (!x || Object.getOwnPropertyDescriptor(x, 'RTCPeerConnection')?.configurable === false) return; // done already
      const refuse = function () { throw new x.DOMException('WebRTC is off in pages: it would reach the network', 'NotAllowedError'); };
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) Object.defineProperty(x, name, { value: refuse, writable: false, configurable: false });
      for (const type of [x.HTMLIFrameElement, x.HTMLFrameElement, x.HTMLObjectElement]) for (const prop of ['contentWindow', 'contentDocument']) {
        const d = type && Object.getOwnPropertyDescriptor(type.prototype, prop), get = d?.get;
        if (get) Object.defineProperty(type.prototype, prop, { ...d, get() { const v = get.call(this); off(prop === 'contentWindow' ? v : v?.defaultView); return v; } });
      }
    } catch { /* a frame of another origin: the page cannot reach into it either */ }
  };
  off(w);
}

/** How much of a 2D canvas is painted, from about 4,096 of its pixels spread evenly: the share in percent, whether any
 *  is, and how many colours (up to 64, at 4 bits a channel). Shared by the boot script and a page check; it stands
 *  alone: sent as source. */
function canvasPaint(ctx: any, width: number, height: number): { painted: number; any: boolean; colors: number } {
  const d = ctx.getImageData(0, 0, width, height).data, colors = new Set<number>(), stride = Math.max(1, Math.floor(d.length / 4 / 4096));
  let painted = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * stride) { n++; if (d[i + 3]) { painted++; if (colors.size < 64) colors.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); } }
  return { painted: Math.round((painted / Math.max(1, n)) * 100), any: painted > 0, colors: colors.size };
}
/** A three.js renderer's main scene, the one with the most in it (a post-processing pass draws a quad of its own after
 *  it): its objects by type (up to `types` of them, each name cut to 40), up to 8 names, its camera, and the renderer's
 *  frames and last whole frame (see the wrapper in page-libraries.ts). Shared, and sent as source, as canvasPaint. */
function sceneOf(renderer: any, types: number) {
  const v = renderer.__vindu ?? { scenes: new Map(), frames: 0 };
  const scenes = [...v.scenes].map(([scene, s]: [any, any]) => { let size = 0; scene?.traverse?.(() => { size++; }); return { scene, camera: s.camera, size }; }).sort((a, b) => b.size - a.size);
  const main = scenes[0], objects: Record<string, number> = Object.create(null), named: string[] = [];
  main?.scene?.traverse?.((o: any) => {
    if (o === main.scene) return;
    const type = String(o.type).slice(0, 40);
    if (type in objects || Object.keys(objects).length < types) objects[type] = (objects[type] ?? 0) + 1;
    if (o.name && named.length < 8) named.push(String(o.name).slice(0, 40));
  });
  return { frames: v.frames as number, frame: (v.last ?? v.frame) as { calls: number; triangles: number; renders: number } | null | undefined, objects, named, camera: main?.camera, scenes: scenes.length };
}
/** Both, as the source a page is sent: the boot script's fourth argument, and a check's. */
export const MEASURES = `{ paint: ${canvasPaint.toString()}, scene: ${sceneOf.toString()} }`;
export type Measures = { paint: typeof canvasPaint; scene: typeof sceneOf };

export function boot(data: Record<string, unknown>, live: boolean, at: { v: number; n: number; most: number; parents?: string[]; work?: boolean; again?: string }, measure: Measures) {
  type Ctx = { type: string; ctx: any; draws?: number };
  const t: any = { errors: [] as string[], warnings: [] as string[], failed: [] as string[], blocked: [] as string[], charts: [] as any[], three: [] as any[], chartjs: null, computed: [] as number[], libraries: [] as string[], fetched: [] as string[], sent: [] as string[], contexts: new WeakMap<HTMLCanvasElement, Ctx>(),
    counts: { errors: 0, warnings: 0, charts: 0, three: 0, sent: 0 } }; // every one is counted, even past what is kept
  // what the check and the library wrappers share: kept, never swapped for another (the page's code runs beside it,
  // so what it holds is the page's account of itself, not proof)
  Object.defineProperty(window, '__task', { value: t, writable: false, configurable: false });
  const say = (x: unknown) => { if (typeof x === 'string') return x; if (x instanceof Error) return x.message; try { return JSON.stringify(x); } catch { return String(x); } };
  const keep = (list: string[], s: string, n = 300) => { if (list.length < 200) list.push(s.slice(0, n)); }; // a page that errors every frame stays bounded
  const err = (s: string) => { t.counts.errors++; keep(t.errors, s); };
  const warn = (s: string) => { t.counts.warnings++; keep(t.warnings, s); };
  const C = (globalThis as any).__vinduCompute; // the same arithmetic as views (compute.ts), sent before this script
  const compute = (rows: any[], expr: string, inputs: Record<string, number> = {}): number => {
    const v = C.setValue(C.parse(String(expr)), rows, inputs);
    if (v === null) throw new Error(`${expr} has no numbers to compute with`);
    return v;
  };
  const keepComputed = (v: unknown) => { if (typeof v === 'number' && t.computed.length < 10000) t.computed.push(v); };
  // the window's bridge, as MCP Apps have theirs: what the person picked in the page (vindu.select), and a follow-up it
  // proposes (vindu.ask). Neither reaches the model on its own: a chip above the prompt, and the prompt box, unsent.
  // The window is one of the host's parents (pageParentOrigins): an exact origin, or one named by its scheme alone, which
  // frame-ancestors holds the frame to; a file: window has no origin to post to, so it is posted to as "*".
  const embeddingOrigin = location.ancestorOrigins?.[0] || (document.referrer && new URL(document.referrer).origin);
  const byScheme = (parents: string[]) => {
    const scheme = parents.find(p => p.endsWith(':') && (embeddingOrigin ? embeddingOrigin.startsWith(`${p}//`) : parents.length === 1));
    return scheme === undefined ? undefined : /^[a-z][a-z0-9+.-]*:\/\/[^/]+$/.test(embeddingOrigin) ? embeddingOrigin : '*';
  };
  const target = at.parents
    ? at.parents.find(origin => origin === embeddingOrigin) ?? byScheme(at.parents) ?? (!embeddingOrigin && at.parents.length === 1 ? at.parents[0] : undefined)
    : embeddingOrigin && embeddingOrigin !== 'null' ? embeddingOrigin : '*';
  const tellParent = (message: unknown) => { if (target && parent !== window) parent.postMessage(message, target); };
  const interactions = Object.freeze({
    select(items: unknown, note?: string) { tellParent({ vindu: 'select', items: JSON.parse(JSON.stringify(items ?? [])), ...(typeof note === 'string' ? { note } : {}) }); },
    ask(prompt: string, items?: unknown) { tellParent({ vindu: 'ask', prompt: String(prompt ?? ''), ...(items !== undefined ? { items: JSON.parse(JSON.stringify(items)) } : {}) }); },
  });
  Object.assign(window, { vindu: interactions });
  const pageFetch = window.fetch.bind(window);
  const call = (f: (x: any) => void, x: unknown) => { try { f(x); } catch (e) { err(`a task.on listener: ${say(e)}`); } };

  // What the page hears: files in the working folder that changed, and results the process got after the page loaded. One
  // page of the process holds the request that waits for them (a browser holds only a few at once to one origin) and tells
  // the others, which each ask for what they have not heard.
  const hear = { change: new Set<(paths: string[]) => void>(), result: new Set<(r: { id: string; tool: string; server: string }) => void>() };
  let v = at.v, n = at.n, listening = false, full = false;
  try { performance.setResourceTimingBufferSize(5000); performance.addEventListener('resourcetimingbufferfull', () => { full = true; }); } catch { /* an old browser */ }
  /** A URL as a path in the working folder, as the host names a changed file: "game/index.html". */
  const workPath = (u: string): string | null => {
    try { const x = new URL(u, location.href); if (x.origin !== location.origin || !x.pathname.startsWith('/work/')) return null; const p = decodeURIComponent(x.pathname.slice(6)); return !p || p.endsWith('/') ? `${p}index.html` : p; } catch { return null; }
  };
  /** The files the page loaded from the working folder: itself, its scripts, styles, images, and (unless it handles
   *  changes itself) what it fetched. */
  const loaded = (fetchedToo: boolean) => {
    const files = new Map<string, { url: string; revision?: string }>();
    for (const entry of [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')] as PerformanceResourceTiming[]) {
      if (!fetchedToo && /^(fetch|xmlhttprequest|beacon)$/.test(entry.initiatorType)) continue;
      const path = workPath(entry.name);
      if (path && (!files.has(path) || entry.initiatorType === 'link')) files.set(path, { url: entry.name, revision: entry.serverTiming?.find(s => s.name === 'vindu')?.description });
    }
    const self = workPath(location.href);
    if (self && !files.has(self)) files.set(self, { url: location.href });
    return files;
  };
  const changed = async (paths: string[]) => {
    for (const f of hear.change) call(f, paths);
    if (!live) return;
    const own = loaded(hear.change.size === 0);
    const candidates = full || paths.includes('*') ? paths : paths.filter(p => own.has(p));
    // Folder notifications are debounced. Ignore a write that already supplied the bytes this page loaded.
    const mine: string[] = [];
    for (const path of candidates) {
      const loaded = own.get(path);
      if (loaded?.revision) {
        try {
          const current = await pageFetch(loaded.url, { method: 'HEAD', cache: 'no-store' });
          if (current.ok && current.headers.get('Server-Timing') === `vindu;desc="${loaded.revision}"`) continue;
        } catch { /* a removed or unavailable resource also needs a reload */ }
      }
      mine.push(path);
    }
    if (!mine.length) return;
    if (mine.some(p => p === '*' || !/\.css$/i.test(p))) { location.reload(); return; }
    for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')) if (workPath(l.href)) { const u = new URL(l.href); u.searchParams.set('v', String(v)); l.href = u.href; }
  };
  const sync = async (wait: boolean) => {
    const e: { v: number; paths: string[]; n: number; results: { id: string; tool: string; server: string }[] } = await (await pageFetch(`/__vindu/events?v=${v}&n=${n}${wait ? '' : '&wait=0'}`, { cache: 'no-store' })).json();
    if (e.v > v) { v = e.v; await changed(e.paths); }
    if (e.n > n) { n = e.n; for (const r of e.results) for (const f of hear.result) call(f, r); }
  };
  const listen = () => {
    if (listening) return; listening = true;
    let bc: BroadcastChannel | undefined;
    try { bc = new BroadcastChannel('vindu-events'); bc.onmessage = () => { sync(false).catch(() => {}); }; } catch { bc = undefined; }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel's postMessage takes no target: it reaches this origin's pages only
    const poll = async () => { for (;;) { try { await sync(true); bc?.postMessage(1); } catch { await new Promise(r => setTimeout(r, 1000)); } } };
    const locks = (navigator as any).locks;
    if (locks && bc) locks.request('vindu-events', poll); // held while this page is open; then the next page that listens polls
    else void poll();
  };
  const listenSoon = () => { if (document.readyState === 'complete') listen(); else addEventListener('load', listen); };

  // task.send: what the page sends goes to the window, which hands it to the model only while the person is using the
  // page (a click or a key in it, just now), a few at a time. A copy being checked, or a page opened on its own, has
  // nobody to send to: it keeps what it would have sent, for the check's report.
  let sends = 0; const replies = new Map<number, { ok: (x: unknown) => void; no: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  addEventListener('message', (e: MessageEvent) => {
    const d = e.data; if (e.source !== parent || parent === window || (target !== '*' && e.origin !== target) || !d || d.vindu !== 'sent') return;
    const w = replies.get(d.n); if (!w) return;
    replies.delete(d.n); clearTimeout(w.timer); if (d.ok) w.ok({ sent: true }); else w.no(new Error(String(d.why)));
  });
  const send = (value: unknown): Promise<unknown> => {
    let json: string | undefined;
    try { json = JSON.stringify(value); } catch { return Promise.reject(new Error('task.send takes a value JSON can hold')); }
    if (json === undefined) return Promise.reject(new Error('task.send takes a value: text, a number, a list or an object'));
    if (json.length > at.most) return Promise.reject(new Error(`too long to send: ${json.length} characters as JSON, ${at.most} at most`));
    if (parent === window) { t.counts.sent++; keep(t.sent, json); return Promise.resolve({ sent: false, checked: true }); }
    if (!target) return Promise.reject(new Error('This page is not embedded by an allowed host.'));
    const k = ++sends;
    return new Promise((ok, no) => {
      replies.set(k, { ok, no, timer: setTimeout(() => { replies.delete(k); no(new Error('the window did not answer')); }, 5000) });
      tellParent({ vindu: 'send', n: k, value: JSON.parse(json) });
    });
  };

  // How far the person has read the page, for the window and the host alone: the furthest share of the document they
  // have had in view (0 to 1, from 0.985 on 1), or of a box that scrolls in it and is at least half its height, told as
  // it grows, four times a second at most. A page that fits its frame, with no such box, is read once it has been in
  // view 2.5 s. A page that knows better (pdf.js's viewer, whose pages come as they load; Monaco, which scrolls itself)
  // says it itself with task.read, and from then on only that is told.
  let readSaid = 0, readOwn = false, readTimer: ReturnType<typeof setTimeout> | undefined, fitTimer: ReturnType<typeof setTimeout> | undefined;
  const readTell = (share: number) => {
    const value = share >= 0.985 ? 1 : Math.round(share * 1000) / 1000;
    if (!(value > readSaid) || parent === window) return;
    readSaid = value;
    readTimer ??= setTimeout(() => { readTimer = undefined; tellParent({ vindu: 'read', value: readSaid }); }, 250);
  };
  const tall = () => (document.scrollingElement ?? document.documentElement).scrollHeight;
  const box = (el: unknown): el is Element => el instanceof Element && el.clientHeight >= innerHeight / 2 && el.scrollHeight > el.clientHeight + 1;
  const boxes = () => { const all = document.body?.getElementsByTagName('*') ?? []; for (let i = 0; i < all.length && i < 5000; i++) if (box(all[i]) && /auto|scroll/.test(getComputedStyle(all[i]).overflowY)) return true; return false; };
  const scrolled = (e?: Event) => {
    if (readOwn || document.visibilityState !== 'visible') return;
    const inner = e?.target;
    if (box(inner)) { readTell((inner.scrollTop + inner.clientHeight) / inner.scrollHeight); return; }
    if (tall() > innerHeight + 1) { readTell((scrollY + innerHeight) / tall()); return; }
    fitTimer ??= setTimeout(() => { fitTimer = undefined; if (!readOwn && tall() <= innerHeight + 1 && document.visibilityState === 'visible' && !boxes()) readTell(1); else if (tall() > innerHeight + 1) scrolled(); }, 2500);
  };
  addEventListener('scroll', scrolled, { passive: true, capture: true }); addEventListener('resize', () => scrolled()); addEventListener('load', () => scrolled());
  document.addEventListener('visibilitychange', () => scrolled());
  try { new ResizeObserver(() => scrolled()).observe(document.documentElement); } catch { /* an old browser: scrolls and resizes still tell */ }

  // the data the page uses, exact, and arithmetic done the way views do it (values computed here are not "typed")
  (window as any).task = Object.freeze({
    data: Object.freeze(data),
    value(rows: any[], expr = 'count()', inputs: Record<string, number> = {}) { const v = compute(rows, expr, inputs); keepComputed(v); return v; },
    group(rows: any[], field: string, expr = 'count()', inputs: Record<string, number> = {}) {
      const groups = new Map<string, any[]>(); for (const r of rows) { const k = String(r?.[field] ?? ''); const xs = groups.get(k); if (xs) xs.push(r); else groups.set(k, [r]); }
      const name = C.computedName(expr);
      return [...groups].map(([k, rs]) => { const v = compute(rs, expr, inputs); keepComputed(v); return { [field]: k, [name]: v }; });
    },
    /** Fields computed for each row ({ amount: 'hours * rate' }), as views compute them; not counted as typed numbers. */
    compute(rows: any[], fields: Record<string, string>, inputs: Record<string, number> = {}) { const r = C.addFields(rows, fields, inputs).rows; for (const row of r) for (const k of Object.keys(fields)) keepComputed(row[k]); return r; },
    /** Any result of the process, exact, by its id: what /data/<id>.json serves. A page from the working folder (on
     *  a work origin, at.work) reads only the results in its uses, named again (at.again). */
    get(id: string) {
      return fetch(`/data/${encodeURIComponent(String(id))}.json${at.again ? `?${at.again}` : ''}`, { cache: 'no-store' }).then(r => {
        if (!r.ok) throw new Error(at.work ? `no result "${id}" for this page: a page from the working folder reads only the results in its uses` : `no result "${id}"`);
        return r.json();
      });
    },
    /** "result": each result the process gets from now on ({id, tool, server}; task.get(id) reads it), none for a page
     *  from the working folder. "change": the files
     *  in the working folder that change (paths in it); a live page that listens reloads only for its own files, not
     *  for what it fetched. Returns a function that stops listening. */
    on(what: string, f: (x: any) => void) {
      if (what !== 'result' && what !== 'change') throw new Error('task.on takes "result" or "change"');
      if (typeof f !== 'function') throw new Error('task.on takes a function');
      const set = hear[what] as Set<(x: any) => void>; set.add(f); listenSoon(); return () => { set.delete(f); };
    },
    send,
    /** How far the person has read the page (0 to 1), from a page that knows it better than its scroll does. */
    read(share: number) { readOwn = true; if (typeof share === 'number' && Number.isFinite(share)) readTell(Math.min(1, Math.max(0, share))); },
  });
  // What the window that shows the page is told of it, as it runs there (page-report.ts keeps its shape): the page
  // itself, never what is in it. Of an error, its kind and the place in the page's own code it came from, not its
  // message, which can quote what the page was given or what the person typed; of what failed to load, its folder and
  // kind (a pinned library's path whole, as the page names it); of what was blocked, the rule and where it pointed.
  const placed: { kind: string; at?: string }[] = [], failedAt: Record<string, string>[] = [], blockedAt: { directive: string; what: string }[] = [];
  let dialogs = 0, posts = 0, ready = false, timer: ReturnType<typeof setTimeout> | undefined;
  const fileLine = (url: unknown, line: unknown): string | undefined => {
    try {
      const u = new URL(String(url), location.href), f = decodeURIComponent(u.pathname.split('/').pop() || '');
      return u.origin === location.origin && !u.pathname.startsWith('/__vindu/') && /^[\w.-]{1,80}$/.test(f) && Number(line) > 0 ? `${f}:${Math.floor(Number(line))}` : undefined;
    } catch { return undefined; }
  };
  /** The first place in a stack that is the page's own code, not this script: its file and line. */
  const firstOwn = (stack: unknown) => { for (const m of (typeof stack === 'string' ? stack : '').matchAll(/(https?:\/\/[^\s()@]+?):(\d+)(?::\d+)?\)?$/gm)) { const at = fileLine(m[1], m[2]); if (at) return at; } return undefined; };
  const kindOf = (x: unknown, fallback: string) => { const n = x instanceof Error ? x.name : fallback; return /^[A-Za-z_$][\w$]{0,40}$/.test(n) ? n : 'Error'; };
  const report = () => {
    const doc = document.documentElement, nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const canvases = [...document.querySelectorAll('canvas')].slice(0, 8).map(c => {
      const k = t.contexts.get(c), o: Record<string, unknown> = { context: k?.type ?? 'none', width: c.width, height: c.height };
      if (k?.draws !== undefined) o.drawn = k.draws > 0;
      else if (k?.type === '2d') { // whether anything is painted, read here: only the share of it leaves the page
        try { const p = measure.paint(k.ctx, c.width, c.height); o.painted = p.painted; o.drawn = p.any; } catch { o.drawn = null; }
      }
      return o;
    });
    const three = t.three.slice(0, 4).map((r: any) => { // each renderer's main scene, by the types of what is in it
      const s = measure.scene(r, 16); return { frames: s.frames, draw_calls: s.frame?.calls ?? 0, triangles: s.frame?.triangles ?? 0, objects: s.objects };
    });
    return { loaded: document.readyState === 'complete', ...(nav && nav.loadEventEnd > 0 ? { ms: Math.round(nav.loadEventEnd) } : {}), visible: document.visibilityState === 'visible',
      width: innerWidth, height: innerHeight, overflow: { x: Math.max(0, doc.scrollWidth - innerWidth), y: Math.max(0, doc.scrollHeight - innerHeight) },
      elements: document.body ? document.body.getElementsByTagName('*').length : 0, errors: t.counts.errors, places: placed.slice(0, 10), warnings: t.counts.warnings,
      failed: failedAt, blocked: blockedAt, canvases, three, charts: t.counts.charts + (t.chartjs ? Object.keys(t.chartjs.instances ?? {}).length : 0), libraries: t.libraries.slice(0, 8), dialogs };
  };
  /** Told to the window once the page has loaded and run a little, then again a little after something changes. */
  const post = () => { timer = undefined; if (parent === window || posts >= 20) return; posts++; try { tellParent({ vindu: 'report', report: report() }); } catch { /* the window went away */ } };
  const again = () => { if (ready && !timer) timer = setTimeout(post, 800); };
  const first = () => { if (!ready) { ready = true; post(); } };
  const place = (kind: string, at?: string) => { if (placed.length < 20) placed.push(at ? { kind, at } : { kind }); again(); };
  const failed = (el: any) => {
    try {
      const u = new URL(String(el.src || el.href), location.href), tag = String(el.tagName || 'other').toLowerCase().slice(0, 12), top = u.pathname.split('/')[1] || '';
      const ext = (/\.([a-z0-9]{1,8})$/i.exec(u.pathname)?.[1] ?? '').toLowerCase();
      if (failedAt.length < 10) failedAt.push(u.origin !== location.origin ? { tag, in: 'elsewhere' } : top === 'lib' ? { tag, in: 'lib', path: u.pathname.slice(0, 160) }
        : { tag, in: ['work', 'view', 'data', 'media'].includes(top) ? top : 'page', ...(ext ? { ext } : {}) });
    } catch { /* not an address */ }
    again();
  };
  addEventListener('error', (e: Event) => {
    const el = e.target as any;
    if (el && el !== window && (el.src || el.href)) { keep(t.failed, String(el.src || el.href), 4000); failed(el); } // whole: the report shortens URLs in the middle
    else if (e instanceof ErrorEvent) {
      err(`${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`);
      place(kindOf(e.error, /\b([A-Z][A-Za-z]*Error)\b/.exec(e.message)?.[1] ?? 'Error'), fileLine(e.filename, e.lineno));
    }
  }, true);
  addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    err(`Unhandled rejection: ${say(e.reason)}`);
    place(e.reason instanceof Error ? `unhandled rejection: ${kindOf(e.reason, 'Error')}` : 'unhandled rejection', firstOwn(e.reason?.stack));
  });
  addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
    keep(t.blocked, `${e.blockedURI} (${e.effectiveDirective})`, 4000);
    const what = ['inline', 'eval'].includes(e.blockedURI) ? e.blockedURI : /^(data|blob)/.test(e.blockedURI) ? e.blockedURI.slice(0, 4)
      : (() => { try { return new URL(e.blockedURI).origin === location.origin ? 'its own' : 'elsewhere'; } catch { return 'other'; } })();
    if (blockedAt.length < 10) blockedAt.push({ directive: /^[a-z-]{1,30}$/.test(e.effectiveDirective) ? e.effectiveDirective : 'other', what });
    again();
  });
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...a: unknown[]) => { (level === 'error' ? err : warn)(a.map(say).join(' ')); if (level === 'error') place('console.error', firstOwn(new Error().stack)); else again(); orig(...a); };
  }
  window.alert = (m?: unknown) => { warn(`alert: ${say(m)}`); dialogs++; again(); }; // a dialog would stop the page; it is noted instead
  window.confirm = (m?: string) => { warn(`confirm: ${m}`); dialogs++; again(); return false; };
  window.prompt = (m?: string) => { warn(`prompt: ${m}`); dialogs++; again(); return null; };
  addEventListener('load', () => { setTimeout(first, 1000); });
  setTimeout(first, 10_000); // a page whose load never comes: told as not loaded
  const fetched = (u: string | URL) => { try { const x = new URL(String(u), location.href); const id = decodeURIComponent(x.pathname.slice(6)).replace(/\.json$/, ''); if (x.origin === location.origin && x.pathname.startsWith('/data/') && !t.fetched.includes(id)) keep(t.fetched, id); } catch { /* not a URL */ } };
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => { fetched(input instanceof Request ? input.url : String(input)); return pageFetch(input, init); };
  // oxlint-disable-next-line typescript/unbound-method -- the original, called below with each request as this
  const open = XMLHttpRequest.prototype.open;
  (XMLHttpRequest.prototype as any).open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) { fetched(url); return (open as any).call(this, method, url, ...rest); };
  // oxlint-disable-next-line typescript/unbound-method -- the original, called below with each canvas as this
  const getContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const ctx = (getContext as any).call(this, type, ...rest);
    if (ctx && !t.contexts.has(this)) {
      const k: Ctx = { type: type === 'experimental-webgl' ? 'webgl' : type, ctx };
      if (/webgl/.test(type)) {
        k.draws = 0;
        for (const f of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) if (typeof ctx[f] === 'function') {
          const orig = ctx[f].bind(ctx); ctx[f] = (...x: unknown[]) => { k.draws!++; return orig(...x); };
        }
      }
      t.contexts.set(this, k);
    }
    return ctx;
  };
  if (live) listenSoon();
}
