// A page check: load a page in a fresh browser page, run steps, and report what happened as JSON:
// errors, failed and blocked requests, what each chart plotted, the 3D scene, canvases, text, phone overflow,
// and numbers shown that are in no result, and an accessibility audit (axe-core, pinned: WCAG 2 A and AA rules, each
// failure with the elements it found). Never pixels: what the model gets is the report. The report is bounded, whatever
// the page does, and so is the time: a page that stops answering (a loop that never ends, a promise that never
// settles) is closed, and the check says so. The browser is the host's: a driver, which lets nothing leave the page host.
// What the page tells the check runs beside its own code, so a page that means to can tell it what it likes: the
// report describes an honest page, and proves nothing about a hostile one.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { amountsIn, unknownAmounts } from './amounts.js';
import { scriptJson } from './escape.js';
import { asText, ellipsis } from './format.js';
import { MEASURES, type Measures } from './page-runtime.js';

const need = createRequire(import.meta.url);
let AXE: { source: string; version: string } | null | undefined;
/** axe-core's script, read once: it runs in the page, as the page is. */
const axe = () => { if (AXE === undefined) { try { AXE = { source: fs.readFileSync(need.resolve('axe-core/axe.min.js'), 'utf8'), version: String((need('axe-core/package.json') as { version: string }).version) }; } catch { AXE = null; } } return AXE; };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** A browser the host provides: Playwright for headless hosts, a hidden window in Electron. A driver refuses every
 *  request that leaves the page host (pageNavigationAllowed), navigations and popups included, and says which it
 *  refused; and takes WebRTC from every frame, which no CSP covers (noWebRtc, before anything runs). */
export interface PageDriver { open(url: string, viewport: { width: number; height: number }): Promise<DriverPage> }
export interface DriverPage {
  status: number | null;   // the HTTP status of the page itself, or null when it did not load
  ms: number;              // until the load event
  refused(): string[];     // requests the driver refused because they left the page host
  eval<T = unknown>(expression: string): Promise<T>; // a promise the expression returns is awaited
  press(key: string): Promise<void>;                 // e.g. "ArrowRight", "Space", "Enter", "a": down and up at once
  down?(key: string): Promise<void>;                 // a key held down until up: what a game that reads keys each frame sees
  up?(key: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(text: string, selector?: string): Promise<void>;
  waitFor(selector: string, ms: number): Promise<boolean>;
  wait(ms: number): Promise<void>;
  close(): Promise<void>;
}

export type Step = { press?: string; times?: number; hold?: string; ms?: number; down?: string; up?: string; click?: string; type?: string; into?: string; wait?: number | string; js?: string };
export type StepResult = { step: string; ok: boolean; note?: string; errors?: string[] };
export type PageReport = {
  page: string; size?: string; loaded: boolean; status?: number | null; ms: number;
  title?: string; errors?: string[]; warnings?: string[]; failed_requests?: string[]; blocked?: string[]; pinned?: string[];
  libraries?: string[]; charts?: Record<string, unknown>[]; three?: Record<string, unknown>[]; canvases?: Record<string, unknown>[];
  /** when a list was cut to its limit: how many there were */
  totals?: Record<string, number>;
  text?: { characters: number; headings?: string[]; starts?: string };
  phone?: { width: number; overflow_px: number };
  data_fetched?: string[]; numbers_not_in_any_result?: number[]; numbers_note?: string;
  /** what the page gave task.send: a copy being checked sends nothing, so the report lists it instead */
  sent?: { values: string[]; note: string };
  accessibility?: { engine: string; rules?: string; violations?: { rule: string; impact: string | null; says: string; elements: number; at: string[] }[]; passed?: number; to_check?: number; note?: string };
  steps?: StepResult[]; read?: Record<string, string | null>;
};
export type CheckOptions = {
  label?: string;                          // how the report names the page
  steps?: Step[]; read?: string[];
  usesData?: boolean;                      // the page shows process data: list numbers it shows that are in no result
  known?: Set<number>;                     // amounts in the process's results
  misses?: (since: number) => string[];    // requests the host could not answer since then
  size?: 'desktop' | 'phone';              // where the page loads and the steps run: 1024 × 768 (default) or 390 × 844
  phone?: boolean;                         // also measure overflow at phone width (default true)
  pinned?: string[];                       // what a page can import by name, listed when it reached for the web
  accessibility?: boolean;                 // audit the page (axe-core): default true
  settleMs?: number;
};

const DESKTOP = { width: 1024, height: 768 }, PHONE = { width: 390, height: 844 };
/** How long a step may take: a wait or a held key 10 s, a step's JavaScript 5 s, all the steps 40 s; and how long the
 *  host waits for any one call to the browser (call) before it closes the page, and for the audit (audit). */
export const LIMITS = { wait: 10_000, js: 5_000, steps: 40_000, read: 2_000, call: 15_000, audit: 30_000 };
const OVERFLOW = 'Math.max(0, document.documentElement.scrollWidth - window.innerWidth)';
const first = (s: unknown) => String((s as Error)?.message ?? s).split('\n')[0].slice(0, 200);
/** Every string in a report has a length limit, and every list a count limit. */
const cut = (s: unknown, n: number) => ellipsis(asText(s ?? ''), n);
/** A long URL keeps its start and its end, where the file name is, so different files stay different. */
const cutMiddle = (s: unknown, n: number) => { const t = asText(s ?? ''); return t.length > n ? `${t.slice(0, Math.ceil(n / 2) - 1)}…${t.slice(t.length - Math.floor(n / 2))}` : t; };
const few = (xs: unknown[], count: number, chars: number, shorten = cut) => [...new Set(xs.map(x => shorten(x, chars)))].slice(0, count);

/** A page that stopped answering: the host waited for the browser, and closed the page. */
class Unanswered extends Error {}
/** A driver's page as a check uses it: an evaluation may be given longer than a call (the audit). */
type Bounded = Omit<DriverPage, 'eval'> & { eval<T = unknown>(expression: string, ms?: number): Promise<T> };
/** A driver's page, every call held to a time on this side, whatever the page does to its own timers: a call that
 *  takes longer closes the page (the driver closes its context), and every later call fails at once. */
function bounded(page: DriverPage): Bounded {
  let dead: Unanswered | undefined;
  const within = <T>(call: () => Promise<T>, ms = LIMITS.call): Promise<T> => {
    if (dead) return Promise.reject(dead);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, no) => { timer = setTimeout(() => {
      dead ??= new Unanswered(`the page stopped answering: nothing came back for ${ms / 1000} s (a script that never ends, or a promise that never settles), so it was closed`);
      void page.close().catch(() => undefined); no(dead);
    }, ms); });
    return Promise.race([call(), late]).finally(() => clearTimeout(timer));
  };
  return {
    status: page.status, ms: page.ms, refused: () => page.refused(),
    eval: <T>(js: string, ms?: number) => within(() => page.eval<T>(js), ms),
    press: key => within(() => page.press(key)),
    ...(page.down && page.up ? { down: (key: string) => within(() => page.down!(key)), up: (key: string) => within(() => page.up!(key)) } : {}),
    click: selector => within(() => page.click(selector)),
    type: (text, selector) => within(() => page.type(text, selector)),
    waitFor: (selector, ms) => within(() => page.waitFor(selector, ms), ms + LIMITS.call),
    wait: ms => within(() => page.wait(ms), ms + LIMITS.call),
    close: () => dead ? Promise.resolve() : within(() => page.close()),
  };
}
/** A page the driver opens within 60 s, bounded; one that opens later is closed at once. */
const opened = (driver: PageDriver, url: string, size: { width: number; height: number }) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const opening = driver.open(url, size);
  const late = new Promise<never>((_, no) => { timer = setTimeout(() => {
    no(new Unanswered('the browser did not open the page within 60 s'));
    opening.then(p => p.close(), () => undefined).catch(() => undefined);
  }, 60_000); });
  return Promise.race([opening, late]).finally(() => clearTimeout(timer)).then(bounded);
};

export async function checkPage(driver: PageDriver, url: string, o: CheckOptions = {}): Promise<PageReport> {
  const t0 = Date.now();
  const size = o.size === 'phone' ? PHONE : DESKTOP;
  const page = await opened(driver, url, size);
  try {
    const report: PageReport = { page: o.label ?? new URL(url).pathname, ...(o.size === 'phone' ? { size: `${PHONE.width}×${PHONE.height}` } : {}), loaded: page.status !== null && page.status < 400, ms: page.ms };
    if (!report.loaded) { report.status = page.status; return report; }
    await page.wait(o.settleMs ?? 500);
    const steps = await runSteps(page, o.steps ?? [], `${size.width} px wide`);
    const c = await page.eval<Collected>(`(${collect.toString()})(${o.usesData ? 'true' : 'false'}, ${MEASURES})`);
    const read: Record<string, string | null> = Object.create(null);
    for (const q of (o.read ?? []).slice(0, 20)) read[cut(q, 200)] = await readOne(page, q);
    const blocked = [...c.blocked, ...page.refused().map(u => `${u} (outside this page's origin)`)];
    const blockedUrls = new Set(blocked.map(b => b.split(' ')[0]));
    const failed = [...c.failed, ...(o.misses?.(t0) ?? []).map(p => new URL(p, url).href)].filter(f => !blockedUrls.has(f)).map(f => shortUrl(f, url));
    const totals: Record<string, number> = {};
    const limit = <T>(name: string, xs: T[], n: number): T[] => { const u = [...new Set(xs)]; if (u.length > n) totals[name] = u.length; return u.slice(0, n); };
    if (c.title) report.title = cut(c.title, 120);
    if (c.errors.length) report.errors = few(limit('errors', c.errors, 10), 10, 300);
    if (c.warnings.length) report.warnings = few(limit('warnings', c.warnings, 5), 5, 300);
    for (const [name, n, shown] of [['errors', c.counts.errors, report.errors?.length ?? 0], ['warnings', c.counts.warnings, report.warnings?.length ?? 0]] as const) if (n > shown) totals[name] = n; // each time one happened
    if (failed.length) report.failed_requests = few(limit('failed_requests', failed, 10), 10, 200, cutMiddle);
    if (blocked.length) report.blocked = few(limit('blocked', blocked, 10), 10, 240, cutMiddle);
    if (o.pinned && (blocked.some(b => /^https?:/.test(b)) || c.errors.some(e => /resolve module specifier/i.test(e)))) report.pinned = o.pinned.slice(0, 12); // the facts a page needs when it reached for the web
    if (c.libraries.length) report.libraries = few(limit('libraries', c.libraries, 8), 8, 60);
    if (c.charts.length) { if (c.counts.charts > 4) totals.charts = c.counts.charts;
      report.charts = c.charts.slice(0, 4).map(ch => ({ library: ch.library, ...(ch.type ? { type: cut(ch.type, 40) } : {}), ...(ch.error ? { error: cut(ch.error, 200) } : {}),
        ...(ch.labels ? { labels: ch.labels.slice(0, 12).map(l => cut(l, 24)) } : {}), ...(ch.series ? { series: ch.series.slice(0, 4).map(s => ({ name: cut(s.name, 40), points: s.count, values: s.values.slice(0, 12) })), ...(ch.series.length > 4 ? { series_total: ch.series.length } : {}) } : {}) })); }
    if (c.three.length) { report.three = c.three.slice(0, 2); if (c.counts.three > 2) totals.three = c.counts.three; }
    if (c.canvases.length) { report.canvases = c.canvases.slice(0, 8); if (c.counts.canvases > 8) totals.canvases = c.counts.canvases; }
    report.text = { characters: c.characters, ...(c.headings.length ? { headings: few(c.headings, 8, 80) } : {}), ...(c.text ? { starts: cut(c.text, 160) } : {}) };
    if (c.counts.headings > 8) totals.headings = c.counts.headings;
    if (o.phone !== false) report.phone = { width: PHONE.width, overflow_px: o.size === 'phone' ? await page.eval<number>(OVERFLOW) : await phoneOverflow(driver, url) };
    if (c.fetched.length) report.data_fetched = few(limit('data_fetched', c.fetched, 20), 20, 40); // this page's own fetches, from /data
    if (c.counts.sent) { report.sent = { values: c.sent.slice(0, 5).map(s => cut(s, 300)), note: 'given to task.send in this copy, which sends nothing; in the person\'s window it reaches you while they use the page' }; if (c.counts.sent > 5) totals.sent = c.counts.sent; }
    if (o.usesData) { // numbers on screen, in text or in a chart of a pinned library, that no result holds and task.value or task.group did not compute
      const known = o.known ?? new Set<number>();
      const computed = new Set(c.computed.flatMap(v => amountsIn(String(v))));
      // what the check itself measured (frames, draw calls, triangles, canvas sizes) is the page's own, not data
      const own = new Set([...c.three.flatMap(t => [t.frames, t.draw_calls, t.triangles, t.renders_per_frame]), ...c.canvases.flatMap(k => [...String(k.size).split('×'), k.draw_calls])].map(Number).filter(Number.isFinite));
      const ok = (n: number) => known.has(n) || computed.has(n) || own.has(n);
      const unknown = [...new Set([...c.texts.flatMap(t => unknownAmounts(t, ok)), ...c.charts.flatMap(ch => ch.series?.flatMap(s => s.values) ?? []).filter(Number.isFinite).flatMap(v => unknownAmounts(String(v), ok))])];
      if (unknown.length) { report.numbers_not_in_any_result = limit('numbers_not_in_any_result', unknown, 12); report.numbers_note = 'shown by the page, but in no result and not computed with task.value or task.group: typed into the page, or worked out by its own code'; }
    }
    if (o.accessibility !== false) report.accessibility = await audit(page, totals);
    if (steps.length) report.steps = steps;
    if (o.read?.length) report.read = read;
    if (Object.keys(totals).length) report.totals = totals;
    return report;
  } finally { await page.close(); }
}

/** WCAG 2 A and AA, by axe-core, after the steps: each rule the page fails, how bad, what it says, and where. axe-core
 *  is loaded fresh each time, and run from what its own script gives back, never from a window.axe the page set. */
async function audit(page: Bounded, totals: Record<string, number>): Promise<NonNullable<PageReport['accessibility']>> {
  const a = axe(); if (!a) return { engine: 'none', note: 'axe-core is not installed with Vindu here, so the page was not audited' };
  const engine = `axe-core ${a.version}`;
  try {
    const r = await page.eval<{ v: { id: string; impact: string | null; help: string; n: number; at: string[] }[]; passed: number; incomplete: number }>(`(() => { const module = { exports: {} }, define = undefined; ${a.source}
      ;return module.exports.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ${scriptJson(AXE_TAGS)} } }); })()
      .then(r => ({ v: r.violations.map(v => ({ id: v.id, impact: v.impact || null, help: v.help, n: v.nodes.length, at: v.nodes.slice(0, 3).map(n => [].concat(n.target).join(' ')) })), passed: r.passes.length, incomplete: r.incomplete.length }))`, LIMITS.audit);
    const order = ['critical', 'serious', 'moderate', 'minor'];
    const v = [...r.v].sort((x, y) => order.indexOf(x.impact ?? 'minor') - order.indexOf(y.impact ?? 'minor'));
    if (v.length > 10) totals.accessibility_violations = v.length;
    return { engine, rules: 'WCAG 2.0, 2.1 and 2.2, A and AA', violations: v.slice(0, 10).map(x => ({ rule: x.id, impact: x.impact, says: cut(x.help, 160), elements: x.n, at: x.at.map(t => cut(t, 120)) })), passed: r.passed, to_check: r.incomplete };
  } catch (e) { if (e instanceof Unanswered) throw e; return { engine, note: `the audit did not run: ${first(e)}` }; }
}

async function runSteps(page: Bounded, steps: Step[], at: string): Promise<StepResult[]> {
  const out: StepResult[] = []; const until = Date.now() + LIMITS.steps; const held = new Set<string>();
  for (const s of steps.slice(0, 50)) {
    if (Date.now() > until) { out.push({ step: describe(s), ok: false, note: `not run: the steps took over ${LIMITS.steps / 1000} s` }); continue; }
    const before = await page.eval<number>('window.__task ? window.__task.errors.length : 0');
    let ok = true, note: string | undefined;
    const target = s.click ?? (s.type !== undefined ? s.into : undefined);
    const state = target === undefined ? 'there' : await page.eval<string>(`(() => { try { const e = document.querySelector(${scriptJson(target)}); if (!e) return 'missing'; return e.getClientRects().length === 0 || getComputedStyle(e).visibility === 'hidden' ? 'hidden' : 'there'; } catch { return 'missing'; } })()`);
    try {
      if (state === 'missing') { ok = false; note = `no element matches ${target}`; }
      else if (state === 'hidden') { ok = false; note = `${target} is there but not visible ${at}`; }
      else if (s.press) for (let i = 0; i < Math.min(s.times ?? 1, 100); i++) await page.press(s.press);
      else if (s.hold !== undefined || s.down !== undefined || s.up !== undefined) {
        if (!page.down || !page.up) { ok = false; note = 'this host\'s browser cannot hold keys; press is down and up at once'; }
        else if (s.hold !== undefined) { const ms = Math.min(Math.max(s.ms ?? 500, 0), LIMITS.wait); await page.down(s.hold); await page.wait(ms); await page.up(s.hold); }
        else if (s.down !== undefined) { await page.down(s.down); held.add(s.down); }
        else { await page.up(s.up!); held.delete(s.up!); }
      }
      else if (s.click) await page.click(s.click);
      else if (s.type !== undefined) await page.type(s.type, s.into);
      else if (s.js !== undefined) { const v = await evalIn(page, s.js); ok = !v.startsWith('error: '); note = v; }
      else if (typeof s.wait === 'number') await page.wait(Math.min(s.wait, LIMITS.wait));
      else if (typeof s.wait === 'string') { ok = await page.waitFor(s.wait, LIMITS.wait); if (!ok) note = `did not appear within ${LIMITS.wait / 1000} s`; }
      else { ok = false; note = 'a step is press, hold, down, up, click, type, js or wait'; }
    } catch (e) { if (e instanceof Unanswered) throw e; ok = false; note = first(e); }
    const errors = await page.eval<string[]>(`window.__task ? window.__task.errors.slice(${before}) : []`);
    out.push({ step: cut(describe(s), 120), ok, ...(note ? { note: cut(note, 300) } : {}), ...(errors.length ? { errors: few(errors, 5, 300) } : {}) });
  }
  for (const k of held) await page.up?.(k).catch(() => {}); // a key left down goes up before the page is read
  return out;
}
const describe = (s: Step) => s.press ? `press ${s.press}${(s.times ?? 1) > 1 ? ` ×${s.times}` : ''}` : s.hold !== undefined ? `hold ${s.hold} ${Math.min(Math.max(s.ms ?? 500, 0), LIMITS.wait)} ms` : s.down !== undefined ? `down ${s.down}` : s.up !== undefined ? `up ${s.up}`
  : s.click ? `click ${s.click}` : s.type !== undefined ? `type "${s.type.slice(0, 40)}"${s.into ? ` into ${s.into}` : ''}` : s.js !== undefined ? `js ${s.js.slice(0, 80)}` : s.wait !== undefined ? `wait ${typeof s.wait === 'number' ? `${s.wait} ms` : `for ${s.wait}`}` : JSON.stringify(s);

/** A value as a report says it: text as it is, anything else as JSON, a long one cut and said to be. */
const said = (v: unknown, max = LIMITS.read): string | null => { if (v === undefined || v === null) return null; const t = typeof v === 'string' ? v : JSON.stringify(v) ?? asText(v); return t.length > max ? `${t.slice(0, max)}… (cut: ${max} of ${t.length} characters; read something narrower for the rest)` : t; };
/** An expression evaluated in the page, a promise it gives awaited (5 s at most): its value, or why there is none. */
async function evalIn(page: Bounded, expr: string): Promise<string> {
  const js = `(async () => { const v = await Promise.race([(async () => (${expr}))(), new Promise((_, no) => setTimeout(() => no(new Error('still pending after ${LIMITS.js / 1000} s')), ${LIMITS.js}))]); return v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v); })().catch(e => 'error: ' + (e && e.message || e))`;
  try { return said(await page.eval<string | null>(js)) ?? 'undefined'; } catch (e) { return `error: ${first(e)}`; }
}
/** A CSS selector's text (a form field's value), or "js:<expression>" evaluated in the page, a promise awaited. */
async function readOne(page: Bounded, q: string): Promise<string | null> {
  if (q.startsWith('js:')) { const v = await evalIn(page, q.slice(3)); return v === 'undefined' ? null : v; }
  const js = `(() => { try { const els = [...document.querySelectorAll(${scriptJson(q)})]; return els.length ? els.slice(0, 5).map(e => e.matches('input, textarea, select') ? e.value : (e.textContent || '').replace(/\\s+/g, ' ').trim()).join(' | ') : null; } catch (e) { return 'error: ' + e.message; } })()`;
  try { return said(await page.eval<string | null>(js)); } catch (e) { return `error: ${first(e)}`; }
}

async function phoneOverflow(driver: PageDriver, url: string): Promise<number> {
  const p = await opened(driver, url, PHONE);
  try { await p.wait(300); return await p.eval<number>(OVERFLOW); } finally { await p.close(); }
}

const shortUrl = (u: string, page: string) => { try { const x = new URL(u); return x.origin === new URL(page).origin ? x.pathname : x.href; } catch { return u; } };

type Collected = {
  title: string; text: string; texts: string[]; characters: number; headings: string[]; fetched: string[]; sent: string[];
  counts: { errors: number; warnings: number; charts: number; three: number; canvases: number; headings: number; sent: number }; errors: string[]; warnings: string[]; failed: string[]; blocked: string[]; computed: number[]; libraries: string[];
  charts: { library: string; type?: string; labels?: string[]; series?: { name?: string; count: number; values: number[] }[]; error?: string }[];
  three: Record<string, unknown>[]; canvases: Record<string, unknown>[];
};

// Runs in the page after it settles. It must stand alone: it is sent as source.
/* eslint-disable @typescript-eslint/no-explicit-any */
function collect(withTexts: boolean, measure: Measures): Collected {
  const t: any = (window as any).__task ?? { errors: [], warnings: [], failed: [], blocked: [], charts: [], three: [], computed: [], libraries: [], fetched: [], contexts: new WeakMap(), counts: { errors: 0, warnings: 0, charts: 0, three: 0 } };
  const num = (v: any): number => typeof v === 'number' ? v : Array.isArray(v) ? num(v[v.length - 1]) : v && typeof v === 'object' ? num(v.value ?? v.y) : Number(v);
  const charts: any[] = [];
  for (const { chart } of t.charts.slice(0, 12)) {
    try {
      const o = chart.getOption();
      const axis = o.xAxis?.[0]?.data ? o.xAxis[0] : o.yAxis?.[0]?.data ? o.yAxis[0] : undefined;
      charts.push({ library: 'echarts', type: [...new Set((o.series ?? []).map((s: any) => s.type))].join(', '), labels: (axis?.data ?? []).slice(0, 12).map((x: any) => String(x?.value ?? x)), series: (o.series ?? []).slice(0, 12).map((s: any) => ({ name: s.name, count: (s.data ?? []).length, values: (s.data ?? []).slice(0, 5000).map(num) })) });
    } catch (e) { charts.push({ library: 'echarts', error: String(e) }); }
  }
  if (t.chartjs) for (const c of Object.values<any>(t.chartjs.instances).slice(0, 12)) charts.push({ library: 'chart.js', type: c.config.type, labels: (c.data.labels ?? []).slice(0, 12).map(String), series: c.data.datasets.slice(0, 12).map((d: any) => ({ name: d.label, count: (d.data ?? []).length, values: (d.data ?? []).slice(0, 5000).map(num) })) });
  // each renderer's main scene, the one with the most in it: a post-processing pass draws a quad of its own after it
  const three = t.three.slice(0, 4).map((r: any) => {
    const s = measure.scene(r, 12), f: any = s.frame;
    return { frames: s.frames, draw_calls: f?.calls ?? r.info.render.calls, triangles: f?.triangles ?? r.info.render.triangles, objects: s.objects, ...(s.named.length ? { named: s.named } : {}), ...(s.camera ? { camera: String(s.camera.type).slice(0, 40) } : {}),
      ...(f?.renders > 1 ? { renders_per_frame: f.renders } : {}), ...(s.scenes > 1 ? { scenes: s.scenes, note: 'the scene with the most objects is described; the others are drawn too, such as post-processing passes. draw_calls and triangles are for one frame, all renders together' } : {}) };
  });
  const all = [...document.querySelectorAll('canvas')];
  const canvases = all.slice(0, 8).map(c => {
    const k = t.contexts.get(c); const o: any = { size: `${c.width}×${c.height}`, context: k?.type ?? 'none' };
    if (k?.type === '2d') {
      try { const p = measure.paint(k.ctx, c.width, c.height); o.painted = `${p.painted}%`; o.colors = p.colors; } catch { o.painted = 'unreadable'; }
    }
    if (k?.draws !== undefined) o.draw_calls = k.draws;
    return o;
  });
  const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
  // the text of each element on its own, as drawn, for its numbers: labels side by side are separate numbers
  const texts: string[] = []; let total = 0;
  const walk = withTexts && document.body ? document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT) : null; // only a check of the data reads them
  for (let n = walk?.nextNode(); n && total < 200_000; n = walk!.nextNode()) {
    const el = n.parentElement, t = (n.textContent ?? '').trim();
    if (!t || !el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || ((el as any).checkVisibility && !(el as any).checkVisibility())) continue;
    texts.push(t.slice(0, 4000)); total += t.length;
  }
  return {
    title: document.title.slice(0, 200), text: text.slice(0, 161), texts, characters: text.length, // the report shows the first 160; the numbers in up to 200,000 characters of texts are checked
    headings: [...document.querySelectorAll('h1, h2, h3')].map(h => (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean).slice(0, 8), fetched: t.fetched,
    errors: t.errors, warnings: t.warnings, failed: t.failed, blocked: t.blocked, computed: t.computed, libraries: t.libraries, charts, three, canvases, sent: t.sent ?? [],
    counts: { errors: t.counts.errors, warnings: t.counts.warnings, charts: t.counts.charts + (t.chartjs ? Object.keys(t.chartjs.instances).length : 0), three: t.counts.three, canvases: all.length, headings: [...document.querySelectorAll('h1, h2, h3')].filter(h => (h.textContent ?? '').trim()).length, sent: t.counts.sent ?? 0 },
  };
}
