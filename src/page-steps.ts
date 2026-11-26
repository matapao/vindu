// A page check's steps (page-check.ts): keys pressed or held, clicks, typing, JavaScript run in the page, waits, and
// values read; each within its bounds, and said in a few words in the report.
import type { Bounded, Step, StepResult } from './page-check.js';
import { asText, ellipsis } from './format.js';
import { scriptJson } from './escape.js';

/** How long a step may take: a wait or a held key 10 s, a step's JavaScript 5 s, all the steps 40 s; and how long the
 *  host waits for any one call to the browser (call) before it closes the page, and for the audit (audit). */
export const LIMITS = { wait: 10_000, js: 5_000, steps: 40_000, read: 2_000, call: 15_000, audit: 30_000 };
export const first = (s: unknown) => String((s as Error)?.message ?? s).split('\n')[0].slice(0, 200);
/** Every string in a report has a length limit, and every list a count limit. */
export const cut = (s: unknown, n: number) => ellipsis(asText(s ?? ''), n);
export const few = (xs: unknown[], count: number, chars: number, shorten = cut) => [...new Set(xs.map(x => shorten(x, chars)))].slice(0, count);

/** A page that stopped answering: the host waited for the browser, and closed the page. */
export class Unanswered extends Error {}
export async function runSteps(page: Bounded, steps: Step[], at: string): Promise<StepResult[]> {
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
/** A step as its report names it: what it did, and to what. */
function describe(s: Step): string {
  if (s.press) return `press ${s.press}${(s.times ?? 1) > 1 ? ` ×${s.times}` : ''}`;
  if (s.hold !== undefined) return `hold ${s.hold} ${Math.min(Math.max(s.ms ?? 500, 0), LIMITS.wait)} ms`;
  if (s.down !== undefined) return `down ${s.down}`;
  if (s.up !== undefined) return `up ${s.up}`;
  if (s.click) return `click ${s.click}`;
  if (s.type !== undefined) return `type "${s.type.slice(0, 40)}"${s.into ? ` into ${s.into}` : ''}`;
  if (s.js !== undefined) return `js ${s.js.slice(0, 80)}`;
  if (s.wait !== undefined) return `wait ${typeof s.wait === 'number' ? `${s.wait} ms` : `for ${s.wait}`}`;
  return JSON.stringify(s);
}

/** A value as a report says it: text as it is, anything else as JSON, a long one cut and said to be. */
const said = (v: unknown, max = LIMITS.read): string | null => { if (v === undefined || v === null) return null; const t = typeof v === 'string' ? v : JSON.stringify(v) ?? asText(v); return t.length > max ? `${t.slice(0, max)}… (cut: ${max} of ${t.length} characters; read something narrower for the rest)` : t; };
/** An expression evaluated in the page, a promise it gives awaited (5 s at most): its value, or why there is none. */
async function evalIn(page: Bounded, expr: string): Promise<string> {
  const js = `(async () => { const v = await Promise.race([(async () => (${expr}))(), new Promise((_, no) => setTimeout(() => no(new Error('still pending after ${LIMITS.js / 1000} s')), ${LIMITS.js}))]); return v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v); })().catch(e => 'error: ' + (e && e.message || e))`;
  try { return said(await page.eval<string | null>(js)) ?? 'undefined'; } catch (e) { return `error: ${first(e)}`; }
}
/** A CSS selector's text (a form field's value), or "js:<expression>" evaluated in the page, a promise awaited. */
export async function readOne(page: Bounded, q: string): Promise<string | null> {
  if (q.startsWith('js:')) { const v = await evalIn(page, q.slice(3)); return v === 'undefined' ? null : v; }
  const js = `(() => { try { const els = [...document.querySelectorAll(${scriptJson(q)})]; return els.length ? els.slice(0, 5).map(e => e.matches('input, textarea, select') ? e.value : (e.textContent || '').replace(/\\s+/g, ' ').trim()).join(' | ') : null; } catch (e) { return 'error: ' + e.message; } })()`;
  try { return said(await page.eval<string | null>(js)); } catch (e) { return `error: ${first(e)}`; }
}
