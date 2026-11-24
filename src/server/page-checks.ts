import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { HINTS } from '../operations.js';
import { checkPage, type PageReport } from '../page-check.js';
import { amountsOf } from '../results.js';
import { pageUrl, splitPath } from '../view-files.js';
import { json, log, text } from './records.js';
import type { Page, Session } from './state.js';

const NO_DRIVER = 'not checked: this host has no page driver';
/** How long a view's account waits for the person's window to say how a page runs there, where nothing here checked it. */
export const REPORT_MS = 4000;
/** A check that could not run (the host's browser would not start, or went away): the page is shown all the same, and
 *  the account says why it was not checked, in the browser's first line. */
const unchecked = (e: unknown) =>
  `not checked: ${String((e as Error)?.message ?? e)
    .split('\n')[0]
    .trim()
    .slice(0, 300)}`;

const CheckPage = z.object({
  path: z
    .string()
    .optional()
    .describe('a page in the working folder, e.g. "index.html", "game/" or "game/index.html?level=2#start"'),
  panel: z
    .string()
    .optional()
    .describe('or a page panel already shown: its id, or the name of the view it is in'),
  html: z
    .string()
    .optional()
    .describe("or a page you write, checked before you show it (as a page panel's html)"),
  uses: z
    .array(z.string())
    .optional()
    .describe(
      "result ids the page reads as task.data[id], exactly as a page panel's uses gives them (for a page from the working folder, the only results it can read); a panel already shown has its own",
    ),
  steps: z
    .array(
      z.looseObject({
        press: z
          .string()
          .optional()
          .describe('a key, down and up at once: "ArrowRight", "Space", "Enter", "a"'),
        times: z.number().int().positive().optional().describe('with press: how many times'),
        hold: z
          .string()
          .optional()
          .describe(
            'a key held down for ms (default 500, at most 10,000): what a game that reads keys each frame needs',
          ),
        ms: z.number().int().nonnegative().optional().describe('with hold: how long'),
        down: z
          .string()
          .optional()
          .describe('a key pressed and kept down, until a step "up" (or the end of the steps)'),
        up: z.string().optional().describe('a key let go'),
        click: z.string().optional().describe('a CSS selector'),
        type: z.string().optional(),
        into: z.string().optional().describe('with type: a CSS selector'),
        js: z
          .string()
          .optional()
          .describe(
            "a JavaScript expression run in the page; a promise it gives is awaited (5 s at most), and its value is the step's note",
          ),
        wait: z
          .union([z.number(), z.string()])
          .optional()
          .describe('milliseconds (at most 10,000), or a CSS selector to wait for (10 s at most)'),
      }),
    )
    .optional()
    .describe(
      'done in order after the page loads (all of them within 40 s), e.g. [{"click": "#start"}, {"hold": "ArrowUp", "ms": 800}, {"press": "Space", "times": 3}]',
    ),
  read: z
    .array(z.string())
    .optional()
    .describe(
      'after the steps: CSS selectors whose text to report, or "js:<expression>" to evaluate in the page (a promise is awaited); each up to 2,000 characters, and said when cut',
    ),
  size: z
    .enum(['desktop', 'phone'])
    .optional()
    .describe(
      'where the page loads and the steps run: desktop, 1024 × 768 (the default), or phone, 390 × 844',
    ),
  accessibility: z
    .boolean()
    .optional()
    .describe('audit it for accessibility after the steps (axe-core: WCAG 2 A and AA); true by default'),
});

export const check = (
  session: Session,
  pg: Page,
  steps?: z.infer<typeof CheckPage>['steps'],
  read?: string[],
  size?: 'desktop' | 'phone',
  accessibility?: boolean,
): Promise<PageReport | string> =>
  session.runtime.options.driver
    ? checkPage(session.runtime.options.driver, pg.url, {
        label: pg.label,
        steps,
        read,
        size,
        accessibility,
        pinned: session.runtime.host.pinned,
        usesData: pg.uses.length > 0,
        known: amountsOf(session.results),
        misses: (since) => session.runtime.host.misses(session.key, since),
      }).catch(unchecked)
    : Promise.resolve(NO_DRIVER);

const workPage = (session: Session, rel: string, uses: string[] = []): Page | undefined => {
  const at = splitPath(rel),
    f = session.runtime.host.workFile(session.key, at.file);
  return f
    ? {
        url: session.runtime.host.workUrl(session.key, f, at.query, uses, at.hash), // as the pane loads it
        label: `work/${f}${at.query ? `?${at.query}` : ''}${at.hash}`,
        uses,
      }
    : undefined;
};

/** A page the model wrote, kept for its check only (its name, to remove it once checked). */
const writtenPage = (session: Session, html: string, uses: string[]): [Page, string] => {
  const name = `check_${++session.runtime.pageCheckCount}`;
  return [
    {
      url: pageUrl(`${session.runtime.host.base(session.key)}/view/${session.runtime.host.writeView(session.key, name, html)}`, '', uses),
      label: 'a page you wrote, not shown yet',
      uses,
    },
    name,
  ];
};

export function registerPageCheck(server: McpServer, session: Session) {
  server.registerTool(
    'check_page',
    {
      description:
        "Load a page in a fresh browser page (a copy: not the one in the person's window) and report what happened, as JSON: errors, failed or blocked requests, what charts plotted, the 3D scene and canvases, text, overflow at phone width; then do steps (press or hold keys, click, type, run JavaScript, wait) and read values. For a website or game the task is building, a page you write before showing it, or a page panel already shown. Where this host has no browser to check pages in, it says so, and for a page panel already shown, it tells how the page runs in the person's window instead: the page itself only (errors by kind and place, failed loads, canvases, the 3D scene, overflow), with no steps done.",
      inputSchema: CheckPage,
      annotations: HINTS.read,
    },
    async (args) => {
      await session.process.sync?.();
      const inView = args.panel ? session.views.get(args.panel) : undefined; // a view's name points at its page panel when it has one
      const unknown = (args.uses ?? []).filter((id) => session.results.get(id)?.kind !== 'result');
      const given = (args.panel ? 1 : 0) + (args.path ? 1 : 0) + (args.html ? 1 : 0);
      let written: string | undefined; // a page written for this check: removed once it is checked
      const pg =
        unknown.length || given !== 1
          ? undefined
          : args.panel
            ? (session.pages.get(args.panel) ??
              (inView?.length === 1 ? session.pages.get(`${args.panel}/${inView[0]}`) : undefined))
            : args.path
              ? workPage(session, args.path, args.uses ?? [])
              : (() => {
                  const [page, name] = writtenPage(session, args.html!, args.uses ?? []);
                  written = name;
                  return page;
                })();
      if (!pg) {
        const shown = [...session.views]
          .filter(([, ids]) => ids.length)
          .map(([view, ids]) => `${ids.join(', ')} (in view ${view})`)
          .join('; ');
        const why =
          given !== 1
            ? 'give one of "path" (a page in the working folder), "html" (a page you write) or "panel" (a page panel shown)'
            : unknown.length
              ? `no result ${unknown.map((x) => `"${x}"`).join(', ')} to give the page (uses)`
              : args.panel
                ? inView?.length
                  ? `view "${args.panel}" has ${inView.length} page panels: ${inView.join(', ')}; name one`
                  : `no page panel "${args.panel}" has been shown; shown: ${shown || 'none'}`
                : `no page "${splitPath(args.path ?? '').file}" in the working folder; pages there: ${session.runtime.host.workPages(session.key).slice(0, 12).join(', ') || 'none'}`;
        log(session, { tool: 'check_page', ok: false, args, refusal: why });
        return text(`not checked: ${why}`, true);
      }
      const r = await check(session, pg, args.steps, args.read, args.size, args.accessibility).finally(() => {
        if (written) session.runtime.host.removeView(session.key, written);
      });
      if (typeof r === 'string' && args.panel) {
        // not checked here: a page panel shown is told of as it runs in the person's window
        const seen =
          session.reports.get(args.panel) ??
          (inView?.length === 1 ? session.reports.get(`${args.panel}/${inView[0]}`) : undefined);
        const out = seen
          ? {
              checked: r,
              window: seen,
              ...(args.steps?.length || args.read?.length
                ? {
                    steps:
                      "not done: steps and reads run only in a browser of the host's own, never in the person's window",
                  }
                : {}),
            }
          : `${r}; the person's window has not said yet how this page runs there`;
        log(session, { tool: 'check_page', ok: true, args, report: out });
        return typeof out === 'string' ? text(out) : json(out);
      }
      if (typeof r === 'string') {
        log(session, { tool: 'check_page', ok: true, args, report: r });
        return text(r);
      }
      log(session, { tool: 'check_page', ok: true, args, report: r });
      return json(r);
    },
  );
}
