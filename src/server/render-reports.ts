import { windowReport } from '../page-report.js';
import { log } from './records.js';
import type { Session } from './state.js';
import { asText } from '../format.js';

/** How a page panel runs in the person's window, as that window says: kept to the page itself (page-report.ts), the
 *  latest one, by view/panel and by panel as check_page names it, for the view's account and for check_page. */
export const reported = (session: Session, x: Record<string, unknown>): boolean => {
  const view = asText(x.view ?? ''),
    panel = asText(x.panel ?? '');
  if (!session.views.get(view)?.includes(panel)) return false; // a page panel of a view that was shown
  const r = windowReport(x.report);
  if (!r) return false;
  const key = `${view}/${panel}`;
  session.reports.set(key, r);
  session.reports.set(panel, r);
  log(session, { report: { view, panel, ...r } });
  hear(session.reportWait, key, r);
  return true;
};
type Waiters<T> = Map<string, Set<(v?: T) => void>>;
/** What the window has said already (now), or what it says under key within ms (the one who says it calls the waiters
 *  set here and takes them away); none, when nothing came in time or no one waits any longer (the task closed). Each
 *  call waits for itself, so a view shown twice at once has both its showings told. */
const waitFor = <T, N>(waiters: Waiters<T>, key: string, now: T | undefined, ms: number, none: N) =>
  new Promise<T | N>((resolve) => {
    if (now !== undefined) {
      resolve(now);
      return;
    }
    const waiter = (v?: T) => {
      clearTimeout(timer);
      const all = waiters.get(key);
      all?.delete(waiter);
      if (!all?.size) waiters.delete(key);
      resolve(v === undefined ? none : v);
    };
    const timer = setTimeout(waiter, ms);
    waiters.set(key, (waiters.get(key) ?? new Set()).add(waiter));
  });
/** The window said it: each who waits for key hears it, once. */
const hear = <T>(waiters: Waiters<T>, key: string, v: T) => {
  for (const waiter of waiters.get(key) ?? []) waiter(v);
  waiters.delete(key);
};
/** No one waits any longer (the task closed): each waiter has its none now. */
export const stopWaiting = (session: Session) => {
  for (const waiters of [session.waiting, session.reportWait] as Waiters<unknown>[])
    for (const all of waiters.values()) for (const waiter of all) waiter();
};
/** A page panel's report from the window, once it comes, up to ms: nothing, when none came. */
export const windowSaid = (session: Session, key: string, ms: number) =>
  waitFor(session.reportWait, key, session.reports.get(key), ms, undefined);

/** Wait for the window to say what it drew of a view, and compare it with what was sent. When it has said it already
 *  (a page check can take longer than drawing), that is the answer. */
export const readBack = (session: Session, view: string, ms: number) => {
  const want = session.probes.get(view),
    had = session.reads.get(view);
  const now = want && had?.seq === want.seq ? session.shell.verifiedOf(view) : undefined;
  return waitFor(session.waiting, view, now, ms, 'not read back yet: the window has not reported; look tells');
};
/** Wait, up to ms, until the window has read back every open pane since the panes last moved. */
export const fresh = async (session: Session, ms: number) => {
  const until = Date.now() + ms;
  while (
    Date.now() < until &&
    session.shell.open.some((v) => session.probes.has(v) && !session.shell.readSince(v))
  )
    await new Promise((r) => setTimeout(r, 40));
};
/** What the window read back of a view, merged with what it read before of the same showing: A2UI draws only the tab
 *  that is open, so a value in another tab is read when the person opens it, and is never a mismatch before. */
export const compare = (
  session: Session,
  e: { view?: unknown; seq?: unknown; surface?: unknown; tab?: unknown; got?: unknown },
): boolean => {
  const view = asText(e.view ?? '');
  const want = session.probes.get(view);
  if (
    !want ||
    e.seq !== want.seq ||
    (e.surface !== 'wide' && e.surface !== 'compact') ||
    !Array.isArray(e.got)
  )
    return false;
  const probes = want[e.surface],
    tab = typeof e.tab === 'number' && Number.isInteger(e.tab) ? e.tab : undefined;
  let r = session.reads.get(view);
  if (!r || r.seq !== want.seq || r.surface !== e.surface)
    session.reads.set(view, (r = { seq: want.seq, surface: e.surface, got: new Map() }));
  r.tab = tab;
  for (const g of e.got as {
    i?: unknown;
    text?: unknown;
    visible?: unknown;
    frame?: { w?: unknown; h?: unknown; loaded?: unknown };
  }[]) {
    const i = Number(g?.i),
      p = probes[i];
    if (!Number.isInteger(i) || !p) continue;
    const frame =
      g.frame && typeof g.frame === 'object'
        ? { w: Number(g.frame.w) || 0, h: Number(g.frame.h) || 0, loaded: g.frame.loaded === true }
        : undefined;
    if (typeof g.text === 'string' || frame)
      r.got.set(i, {
        text: typeof g.text === 'string' ? g.text : null,
        visible: g.visible === true,
        ...(frame ? { frame } : {}),
      });
    else if (p.tab === undefined || p.tab === tab)
      r.got.set(i, { text: null, visible: false }); // to be drawn now, and not found
    else {
      const had = r.got.get(i);
      if (had) r.got.set(i, { ...had, visible: false });
    } // in a tab not open now: as read before, out of sight
  }
  const drift: Record<string, unknown>[] = [],
    out = new Set<string>(),
    unread = new Map<number, Set<string>>(),
    pages: Record<string, string> = {};
  let checked = 0;
  probes.forEach((p, i) => {
    const g = r.got.get(i),
      at = `${p.panel}${p.field ? `/${p.field}` : ''}`;
    if (!g) {
      const k = p.tab ?? -1;
      unread.set(k, (unread.get(k) ?? new Set()).add(p.panel));
      return;
    }
    if (p.frame) {
      pages[p.panel] = g.frame
        ? `drawn ${g.frame.w} × ${g.frame.h} px, ${g.visible ? 'in sight' : 'out of sight'}, ${g.frame.loaded ? 'loaded' : 'not loaded yet'}`
        : 'no frame found';
      return;
    }
    checked++;
    if (g.text === null || norm(g.text) !== norm(p.expect))
      drift.push({
        panel: p.panel,
        ...(p.field ? { field: p.field } : {}),
        sent: p.expect,
        drawn: g.text === null ? 'nothing found' : g.text.slice(0, 80),
      });
    else if (!g.visible) out.add(at);
  });
  const tabName = (k: number) => (k < 0 ? 'not read' : `"${want.tabs[k] ?? `tab ${k + 1}`}"`);
  const v = {
    by: 'the window',
    surface: e.surface,
    ...(tab !== undefined && want.tabs.length ? { tab_open: want.tabs[tab] ?? `tab ${tab + 1}` } : {}),
    checked,
    ...(drift.length
      ? { drift }
      : checked
        ? { same: 'every value checked is drawn as sent' }
        : Object.keys(pages).length
          ? {}
          : { same: 'nothing here is text to check (charts, media)' }),
    ...(out.size
      ? {
          out_of_sight: {
            values: [...out],
            note: 'drawn as sent, but out of sight: the person scrolls to see them',
          },
        }
      : {}),
    ...(unread.size
      ? {
          in_tabs_not_open: {
            tabs: [...unread].map(([k, ps]) => `${tabName(k)}: ${[...ps].join(', ')}`),
            note: 'A2UI draws only the tab that is open: these are checked when the person opens theirs',
          },
        }
      : {}),
    ...(Object.keys(pages).length ? { pages } : {}),
  };
  session.shell.setVerified(view, v);
  log(session, { readBack: { view, ...v } });
  hear(session.waiting, view, v);
  return true;
};

import { panelsOf, pidFor } from '../cards.js';
import type { Sight } from '../shell.js';

/** What of each panel is in sight, as the window read it from its own marks: "rows 1–14 of 40 (INV-2026-0412 to
 *  INV-2026-0518)", by panel; a panel whose rows are all scrolled away says so. */
export const inSight = (session: Session, view: string, got: Record<string, Sight>) => {
  const spec = session.shown.get(view);
  if (!spec) return undefined;
  const data = session.data.get(view);
  const out: Record<string, string> = {};
  for (const p of panelsOf(spec)) {
    const g = got[p.id] ?? got[pidFor(p.id)];
    if (!g) continue;
    const rows = (data?.[p.id]?.rows ?? data?.[p.id]?.gallery ?? []) as Record<string, unknown>[]; // a gallery's items by their names
    const total = rows.length || g.of;
    const name = (i: number) => {
      const r = rows[i];
      const v = r?.title ?? r?.name ?? r?.number ?? r?.id ?? r?.key ?? r?.subject;
      return v === undefined || v === null || typeof v === 'object' ? undefined : asText(v).slice(0, 60);
    };
    const words = !g.n
      ? g.of
        ? `none of its ${total} rows: scrolled out of sight`
        : ''
      : g.n >= total
        ? `all ${total} rows`
        : `rows ${g.first + 1} to ${g.last + 1} of ${total}${g.n < g.last - g.first + 1 ? ` (${g.n} of them)` : ''}${name(g.first) && name(g.last) ? `: ${name(g.first)} to ${name(g.last)}` : ''}`;
    const all = [words, g.nodes !== undefined ? `${g.nodes} nodes` : ''].filter(Boolean).join('; ');
    if (all) out[p.id] = all;
  }
  return Object.keys(out).length ? out : undefined;
};

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
