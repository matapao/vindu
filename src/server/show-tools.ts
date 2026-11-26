import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { After } from '../cards.js';
import type { Place } from '../layout.js';
import { HINTS } from '../operations.js';
import { brief, type Entry, type ResultEntry } from '../results.js';
import { showView } from '../view.js';
import { Refusal } from '../view-context.js';
import { askPanes } from './asks.js';
import { showBrowser } from './browser-views.js';
import { notYet } from './gates.js';
import { DRAFTS_TEXT, type Has, offersDrafts, offersWeek, showText, WEEK_TEXT } from './instructions.js';
import { checkCtxFor } from './present.js';
import { json, log, loggedJson, text } from './records.js';
import type { Gate, Session } from './state.js';
import { fillSlot } from './template-slots.js';
import { asText } from '../format.js';

/** How long a text alone may be to count as short: what a tool answers when all it says is that it did it ("written"). */
const SHORT_TEXT = 200;
/** A result of a short text alone: no rows, value or images, no failure, and nothing the store says of how it was seen. */
const shortText = (e: Entry): e is ResultEntry =>
  e.kind === 'result' &&
  !e.rows?.length &&
  e.value === undefined &&
  !e.images.length &&
  !e.error &&
  !e.fidelity &&
  e.text.length <= SHORT_TEXT;
/** One line per entry, except that a tool's results of a short text alone, when it has more than one, share one line,
 *  where the first of them is: their ids, and their shape (any tool's: a file written, a command that said "done"). */
const resultLines = (all: readonly Entry[], since: (id: string) => string): string[] => {
  const byTool = new Map<string, ResultEntry[]>();
  for (const e of all)
    if (shortText(e) && !since(e.id)) {
      const tool = `${e.server}.${e.tool}`;
      const group = byTool.get(tool);
      if (group) group.push(e);
      else byTool.set(tool, [e]);
    }
  const together = new Map<Entry, ResultEntry[]>();
  for (const group of byTool.values()) if (group.length > 1) for (const e of group) together.set(e, group);
  return all.flatMap((e) => {
    const group = together.get(e);
    if (!group) return [brief(e) + since(e.id)];
    if (group[0] !== e) return [];
    return [
      `${ranges(group.map((x) => x.id))}: ${group[0].server}.${group[0].tool} → ${group.length} results, each a short text alone (at most ${SHORT_TEXT} characters)`,
    ];
  });
};
/** Ids as runs: r6–r9, r12. */
const ranges = (ids: string[]) => {
  const out: string[] = [];
  let a = 0;
  for (let i = 1; i <= ids.length; i++) {
    const n = (x: string) => Number(x.slice(1));
    if (i < ids.length && n(ids[i]) === n(ids[i - 1]) + 1 && ids[i][0] === ids[i - 1][0]) continue;
    out.push(i - 1 > a ? `${ids[a]}–${ids[i - 1]}` : ids[a]);
    a = i;
  }
  return out.join(', ');
};

export function registerShowTools(server: McpServer, session: Session, has: Has) {
  server.registerTool(
    'results',
    {
      description:
        'List what this task has got so far: one line per result, attachment or answer, with its id and the shape a view can use.',
      inputSchema: z.object({}),
      annotations: HINTS.read,
    },
    async () => {
      log(session, { tool: 'results' });
      const since = (id: string) => {
        const n = session.fresh.get(id);
        return n && n !== id ? ` (read again since: ${n} says something else)` : '';
      };
      return text(resultLines(session.results.all(), since).join('\n') || 'nothing yet');
    },
  );

  server.registerTool(
    'show_view',
    {
      description:
        showText(has) +
        (offersDrafts(session.runtime.cards) ? DRAFTS_TEXT : '') +
        (offersWeek(session.runtime.cards) ? WEEK_TEXT : ''),
      inputSchema: has.pages ? session.runtime.showView : session.runtime.showViewPlain,
      annotations: HINTS.ui, // the boundary check; each card's own check runs after the data is resolved
    },
    async (args, extra) => {
      try {
        await session.process.sync?.(); // what the processor just wrote there is here before the view reads it
        const named = asText((args as { name?: unknown }).name ?? '');
        if (session.mode) {
          // a static view: the model fills its slots, and nothing else (no browser page, no pane of the window's own)
          const slot = asText((args as { slot?: unknown }).slot ?? named);
          const kept = heldName(session, slot);
          if (kept) throw new Refusal(kept);
          return json(toldNow(session, await fillSlot(session, args as Record<string, unknown>)));
        }
        const browser = (args as { browser?: { url?: unknown } }).browser;
        if (browser)
          return await showBrowser(
            session,
            named,
            asText((args as { title?: unknown }).title ?? named),
            asText(browser.url ?? ''),
            args,
            (extra as { signal?: AbortSignal } | undefined)?.signal,
          );
        const held = heldName(session, named);
        if (held) throw new Refusal(held);
        if (!named || !(args as { title?: unknown }).title) throw new Refusal('a view needs a name and a title');
        const into = (args as { place?: Place }).place?.into;
        if (into && askPanes(session).includes(into))
          throw new Refusal(
            `"${into}" is before the person until they answer it, so nothing goes in its place: put the view beside it`,
          );
        const after = (args as { after?: After }).after;
        if (after && Object.keys(after).length) {
          // written up front: held, and shown by the system once what it is after has happened
          const ahead = args as Record<string, unknown>;
          showView(ahead, checkCtxFor(session, ahead)); // checked now, so a fault is said now; nothing is kept of it
          const g: Gate = {
            want: JSON.stringify(after),
            since: session.results.all().length,
            sinceOwn: session.own.length,
          };
          const why = notYet(session, after, named, undefined, g);
          if (why) {
            const { after: _a, ...rest } = args as Record<string, unknown>;
            session.held.set(named, {
              ...g,
              args: rest,
              title: String((args as { title?: unknown }).title),
              after,
            });
            log(session, { tool: 'show_view', ok: true, args, held: why });
            return json({
              view: named,
              held: `not shown yet: the system shows it, without you, ${why.replace(/^After/, 'after').replace(/\.$/, '')}; then you are told once`,
              place: (args as { place?: unknown }).place ?? 'where a new view goes',
            });
          }
        }
        session.held.delete(named); // shown now: no longer held
        // shown anew by the model: what was made or allowed inside the old one goes with it, as it is replaced
        const acc = await session.present(args, false, false, undefined, true);
        return loggedJson(session, { tool: 'show_view', ok: true, args }, 'account', toldNow(session, acc));
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        session.refusals.push(e.message); // every refusal is kept: a refusal that is the server's gap must show up
        log(session, { tool: 'show_view', ok: false, args, refusal: e.message });
        return text(`not shown: ${e.message}`, true);
      }
    },
  );
}

/** Why the model cannot show a view under a name that the window holds for a pane of its own, the host's or an ask's. */
const heldName = (session: Session, name: string): string | undefined => {
  const owner = session.shell.ownerOf(name);
  if (!owner || owner === 'model') return undefined;
  const what =
    session.shell.viewOf(name)?.kind ??
    session.shell.claimOf(name) ??
    { system: "the system's", host: "the host's", ask: 'it asks the person' }[owner];
  return `"${name}" is one of the window's own panes (${what}); show the view under another name`;
};
/** The account the model reads now says what the person changed and did elsewhere, taken as the reply leaves: whatever
 *  was told while the view was drawn is in it, and nothing is folded into an account the model never reads. */
const toldNow = <A extends { shell?: Record<string, unknown> }>(session: Session, acc: A): A => {
  if (!acc.shell) return acc;
  const { person: _asDrawn, ...shell } = acc.shell;
  const person = session.shell.takePerson();
  acc.shell = { ...shell, ...(person.length ? { person } : {}) };
  return acc;
};
