import { probesFor } from '../a2ui.js';
import type { Account } from '../account.js';
import { kindOf } from '../card-kinds/registry.js';
import { panelsOf, pidFor, type PanelSpec } from '../cards.js';
import type { Place } from '../layout.js';
import { presentationOf } from '../presentation.js';
import { showView } from '../view.js';
import { afterShown } from './live-panels.js';
import { check, REPORT_MS } from './page-checks.js';
import { log } from './records.js';
import { readBack, windowSaid } from './render-reports.js';
import type { Session } from './state.js';

type PageEntry = { url: string; label: string; uses: string[] };
/** A page, or a file shown in Monaco, for check_page to read: under its panel's id, and under view/panel. */
const setPage = (session: Session, view: string, id: string, pg: PageEntry) => {
  session.pages.set(id, pg);
  session.pages.set(`${view}/${id}`, pg);
};

/** Show a view from what the model sent (or sent before, shown again with the person's inputs): resolve, compile,
 *  put it before the person, check its pages, and say what rendered. redraw: the system draws a shown view again
 *  (a read that changed since), and its pane stays as it is, shown or hidden. committed: told once the view passed its
 *  checks and is shown, before anything is awaited, so whatever goes with the showing is done with it, or not at all.
 *  anew: the model's view in place of the one under its name, so what was made or allowed inside the old one goes with
 *  it once this showing passes its checks (shownAnew), and its hooks' jobs are drawn and told as off, as they then are.
 *  A showing drawn again while its checks run leaves the rest to the newer one: its account says so. */
export const present = async (
  session: Session,
  args: Record<string, unknown>,
  redraw = false,
  restoring = false,
  committed?: () => void,
  anew = false,
): Promise<Account> => {
  if (session.closed) throw new Error('This task is closed');
  const mounts: (() => void)[] = [];
  const v = showView(args, ctxFor(session, mounts, args, anew));
  // Commit resources together after the entire replacement has passed validation.
  for (const panel of Object.values(session.data.get(v.spec.name) ?? {}))
    if (panel.app) session.runtime.host.removeApp(panel.app.url);
  for (const mount of mounts) mount();
  const { place: _place, ...kept } = args; // where a view goes is said once: drawn again, it stays where it is
  session.specs.set(v.spec.name, kept);
  session.shown.set(v.spec.name, v.spec);
  session.data.set(v.spec.name, v.data);
  const seq = (session.probes.get(v.spec.name)?.seq ?? 0) + 1; // which showing of the view this is
  const probes = {
    wide: probesFor(v.spec, v.data, v.wide, session.runtime.cards),
    compact: probesFor(v.spec, v.data, v.compact, session.runtime.cards),
  };
  session.probes.set(v.spec.name, { seq, ...probes, tabs: (v.spec.tabs ?? []).map((t) => t.title) });
  session.shell.setVerified(v.spec.name, undefined);
  session.onShow({ name: v.spec.name, wide: v.wide, compact: v.compact, seq, probes }); // the person sees it now; page checks follow
  const panels = panelsOf(v.spec);
  const masters = [
    ...new Set(
      panels.map((p) => (p.detail as { of?: string } | undefined)?.of).filter((x): x is string => !!x),
    ),
  ].flatMap((id) => [id, pidFor(id)]);
  const framed = (ps: PanelSpec[]) => ps.length === 1 && !!kindOf(ps[0].card, session.runtime.cards)?.framed; // one page, or one in each tab: it fills its pane
  const fill = v.spec.tabs ? v.spec.tabs.every((t) => framed(t.panels)) : framed(panels);
  const placed =
    redraw && session.shell.redrawn(v.spec.name, { title: v.spec.title, subtitle: v.spec.subtitle })
      ? []
      : session.shell.show(
          v.spec.name,
          {
            title: v.spec.title,
            subtitle: v.spec.subtitle,
            fill,
            panels: panels.map((p) => p.card).join(', '),
            cards: panels.map((p) => p.card),
            ...(masters.length ? { masters } : {}),
          },
          (args as { place?: Place }).place,
        );
  // what it draws says what it is: a page of its own, or a file in Monaco (a page of Vindu's own, which no check reads)
  const pages = panels.filter((p) => v.data[p.id].page && !v.data[p.id].code);
  const ids = pages.map((p) => p.id);
  session.views.set(v.spec.name, ids);
  if (!redraw)
    for (const id of ids) {
      session.reports.delete(`${v.spec.name}/${id}`);
      session.reports.delete(id);
    } // a page shown anew is told of anew
  for (const p of panels) {
    const d = v.data[p.id];
    if (d.page && d.code) setPage(session, v.spec.name, p.id, { url: d.page.url, label: d.page.label, uses: [] }); // check_page reads them like pages
  }
  if (anew) shownAnew(session, v.spec.name);
  committed?.();
  /** Whether this is still the view's newest showing: once another has begun, it tells the window and checks. */
  const current = () => !session.closed && session.probes.get(v.spec.name)?.seq === seq;
  const superseded = () => {
    v.account.verified = 'drawn again since, while this showing was checked: the newer showing is what the window shows; look tells';
    return v.account;
  };
  if (!current()) return superseded(); // gone as soon as it was shown (whatever went with it took it away)
  if (session.more.onPresentation) {
    // Native windows can interact as soon as they receive the resolved view, while checks are still running.
    try {
      session.more.onPresentation(presentationOf(v.spec, v.data, seq, session.runtime.cards));
    } catch (error) {
      log(session, { presentation: v.spec.name, failed: String((error as Error).message) });
    }
  }
  for (const p of pages) {
    if (!current()) return superseded();
    const d = v.data[p.id].page!;
    const pg = { url: d.url, label: d.label, uses: d.uses };
    setPage(session, v.spec.name, p.id, pg);
    const o = v.account.panels.find((x) => x.id === p.id)!;
    if (!restoring) o.page = await check(session, pg);
  }
  // Recovery only paints saved content. Checks, live reads and view hooks run on new presentations.
  if (restoring) return v.account;
  if (!current()) return superseded();
  v.account.verified = session.runtime.options.verifyMs
    ? await readBack(session, v.spec.name, session.runtime.options.verifyMs)
    : 'the window reads back what it drew; look tells';
  if (!current()) return superseded();
  // where nothing here could check a page, how it runs in the person's window instead, as the window says
  // (page-report.ts): waited for a little once a window has drawn the view
  const drawn = !!v.account.verified && typeof v.account.verified === 'object';
  const unchecked = v.account.panels.filter((p) => typeof p.page === 'string');
  const said = unchecked.map((p) => {
    const key = `${v.spec.name}/${p.id as string}`;
    return session.reports.get(key) ?? (drawn ? windowSaid(session, key, REPORT_MS) : undefined);
  });
  // waited for together, each page the same little while; with nothing to wait for, the account follows at once, as
  // what the window said in the meantime must not come before it
  // oxlint-disable-next-line typescript/await-thenable -- said holds reports already in beside promises of those to come: Promise.all waits for the promises and passes the reports through
  const seen = said.some((x) => x instanceof Promise) ? await Promise.all(said) : said;
  if (!current()) return superseded();
  unchecked.forEach((p, i) => {
    p.window =
      seen[i] ??
      (drawn
        ? 'not told yet: the page is still loading in the window; check_page with this panel tells later'
        : 'not told yet: no window has said it drew this view; check_page with this panel tells once one has');
  });
  v.account.shell = session.shell.account({
    view: v.spec.name,
    notes: placed,
    keep: true,
  }); // what the person did is told by whoever gives this account to the model, as it does (show-tools.ts)
  const live = afterShown(session, v.spec, v.data);
  if (live.length) (v.account as Account & { live?: string[] }).live = live;
  return v.account;
};

import { appHtml, appsOn, resourceOf } from '../apps.js';
import type { Hook } from '../cards.js';
import type { ViewContext } from '../view-context.js';
import { gateOf } from './gates.js';
import { hookIsOn, shownAnew } from './view-state.js';

/** What a view reads as it is shown: the session's results, cards and pages, and the person's own state of it. drawing:
 *  what is being shown, whose hooks' switches are read as they are in it; anew, none is on: its yes goes with the old. */
const ctxFor = (
  session: Session,
  mounts?: (() => void)[],
  drawing?: Record<string, unknown>,
  anew = false,
): ViewContext => ({
  results: session.results,
  cards: session.runtime.cards,
  kinds: session.runtime.kinds,
  format: session.runtime.format,
  marks: session.runtime.options.marks,
  classify: session.runtime.options.classify,
  newest: (id) => session.fresh.get(id),
  holidays: session.runtime.options.holidays,
  cues: (view) => session.cues.get(view) ?? [],
  gate: (view, p, spec) => gateOf(session, view, p, spec),
  step: (view) => session.steps.get(view) ?? 1,
  hookState: (view, n) =>
    session.more.hooks === false
      ? 'idle'
      : !session.jobs
        ? 'unavailable'
        : !anew && hookIsOn(session, view, n, (drawing?.hooks as Hook[] | undefined)?.[n])
          ? 'on'
          : 'off',
  // the person's what-ifs win, until the model gives that input a new value of its own
  inputs: (view, panel, defaults) => {
    const k = `${view}/${panel}`;
    const had = session.inputs.get(k);
    if (!had) return defaults;
    for (const [n, v] of Object.entries(defaults))
      if (Object.hasOwn(had.defaults, n) && had.defaults[n] !== v) delete had.set[n];
    had.defaults = { ...defaults };
    return { ...defaults, ...Object.fromEntries(Object.entries(had.set).filter(([n]) => Object.hasOwn(defaults, n))) };
  },
  pages: {
    base: session.runtime.host.base(session.key),
    workFile: (rel) => session.runtime.host.workFile(session.key, rel),
    workUrl: (rel, query, uses, hash) => session.runtime.host.workUrl(session.key, rel, query, uses, hash),
    workAny: (rel) => session.runtime.host.workAny(session.key, rel),
    workPages: () => session.runtime.host.workPages(session.key),
    writeView: (name, html) => session.runtime.host.writeView(session.key, name, html),
    workText: (rel) => session.runtime.host.workText(session.key, rel),
    headText: (rel) => session.runtime.host.headText(session.key, rel),
  },
  ...(session.more.apps && session.runtime.options.apps && session.runtime.options.apps !== 'off'
    ? {
        apps: {
          allowed: (server) => appsOn(session.runtime.options.apps, server),
          resourceOf: (server, tool) => resourceOf(session.more.apps!.tools(server), tool),
          frame: (server, uri) => {
            const resource = session.runtime.host.prepareApp(
              session.key,
              () => appHtml(session.more.apps!, server, uri),
              !!session.runtime.options.appsNetwork,
            );
            mounts?.push(resource.mount);
            return resource.url;
          },
        },
      }
    : {}),
});
/** The same, for a view checked before it is shown (one held until what it is after): it reads what the session has
 *  and changes nothing of it: no page is written, no what-if or gate is kept, no app is made ready. */
export const checkCtxFor = (session: Session, drawing: Record<string, unknown>): ViewContext => {
  const ctx = ctxFor(session, undefined, drawing);
  return {
    ...ctx,
    gate: () => ({ wait: 'held' }),
    inputs: (view, panel, defaults) => {
      const had = session.inputs.get(`${view}/${panel}`);
      const set = Object.entries(had?.set ?? {}).filter(
        ([n]) => Object.hasOwn(defaults, n) && (!Object.hasOwn(had!.defaults, n) || had!.defaults[n] === defaults[n]),
      ); // as the view would be drawn: a what-if whose input the model gave a new value no longer holds
      return { ...defaults, ...Object.fromEntries(set) };
    },
    ...(ctx.pages ? { pages: { ...ctx.pages, writeView: (name: string) => `${name}.html` } } : {}),
  };
};
