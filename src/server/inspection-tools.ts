import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { applyAction } from '../actions.js';
import { HINTS } from '../operations.js';
import { readRef } from '../results.js';
import { askPanes } from './asks.js';
import { viewCall } from './browser-views.js';
import { actText, type Has, readText } from './instructions.js';
import { addedOps, waitingOn } from './operations.js';
import { sentNow } from './page-messages.js';
import { json, log, loggedJson, text } from './records.js';
import { remindersOf } from './reminders.js';
import { fresh, inSight } from './render-reports.js';
import type { Session } from './state.js';
import { slotsOf } from './template-slots.js';
import { act, viewAction } from './view-actions.js';
import { ActInView, actInViewFor, Arrange, cardActsFor, READ_MAX, readViewFor } from './view-schemas.js';

export function registerArrange(server: McpServer, session: Session) {
  server.registerTool(
    'arrange',
    {
      description:
        "Reserve panes before content, or lay out existing views in the person's window, with 1 px lines between: rows and columns of view names, nested (up to 12 deep), with shares. Or collapse views into the shelf at the bottom of the window and open them again (back where they were), maximize one pane, restore the layout, or point the person to a pane. Returns what the person now sees, as JSON (the same as look); a layout that does not fit the window is made to fit, and says how. A change the person made that you have not read yet comes first: the arrange then says what it was, and moves nothing.",
      inputSchema: Arrange,
      annotations: HINTS.ui,
    },
    async (args) => {
      if (session.mode) {
        const why = `this task uses the static view "${session.mode.template.name}": its layout is the template's and the person's; you fill its slots (look lists them)`;
        session.refusals.push(why);
        return text(`not arranged: ${why}`, true);
      }
      // a name the window holds for a pane of its own is not the model's to reserve, and an open ask stays in sight
      const r = session.shell.arrange({ ...args, keep: askPanes(session) });
      if (r.refusal) {
        session.refusals.push(r.refusal);
        log(session, { tool: 'arrange', ok: false, args, refusal: r.refusal });
        return text(`not arranged: ${r.refusal}`, true);
      }
      const planning = args.report === 'layout' || !!(args.reserve?.length || args.release?.length);
      if (!planning && session.runtime.options.verifyMs && !r.suggested)
        await fresh(session, Math.min(session.runtime.options.verifyMs, 1500));
      const a = session.shell.account({ full: true, notes: r.notes, planning });
      return loggedJson(session, { tool: 'arrange', ok: true, args }, 'account', a);
    },
  );
}
export function registerInspectionTools(server: McpServer, session: Session, has: Has) {
  const actInCards = async (args: Record<string, unknown>) => {
    const view = String(args.view);
    const a = viewAction(args);
    const say = (t: string, isError = false) => {
      log(session, { tool: 'act_in_view', view, action: a, ...(isError ? { refused: t } : { did: t }) });
      return text(t, isError);
    };
    if (session.shell.arranges === 'off')
      return say(
        'the person changes how views show themselves in this window; you can show a view anew with show_view',
        true,
      );
    const owner = session.shell.ownerOf(view);
    if (owner && owner !== 'model')
      return say(
        `"${view}" is one of the window's own panes (${session.shell.claimOf(view) ?? owner}): only the person changes it`,
        true,
      );
    const unseen = session.vunseen.get(view); // an undo too: the person's change comes first
    if (unseen?.length) {
      session.vunseen.delete(view);
      return say(
        `the person changed "${view}" since you were last told (${unseen.join('; ')}); nothing was changed: act again with their change in mind`,
        true,
      );
    }
    if (session.shell.arranges === 'suggest') {
      const args0 = session.specs.get(view);
      if (!args0) return say(`no view "${view}" is shown`, true);
      const title = session.shown.get(view)?.title ?? view;
      const last = session.vhistory.get(view)?.at(-1);
      const undo = (): { refusal: string } | { what: string; mark: string } => {
        if (!last) return { refusal: `nothing to undo in "${title}"` };
        if (last.by !== 'model')
          return { refusal: `the last change in "${title}" is the person's (${last.what}): only they undo it` };
        return { what: `undo "${last.what}"`, mark: `Undo ${last.what}` };
      };
      const r =
        a.action !== 'undo' ? applyAction(args0, session.data.get(view), a, title, session.runtime.cards) : undo();
      if ('refusal' in r) return say(r.refusal, true);
      session.vsuggest.set(view, { ...a, what: r.what }); // an undo, too, is the person's to take
      session.shell.mark(view, { text: r.mark, by: 'model', suggestion: true });
      return say(`suggested to the person, who takes it or not: ${r.what}; nothing changed yet`);
    }
    const r = await act(session, view, a, 'model');
    if ('refusal' in r) return say(r.refusal, true);
    log(session, { tool: 'act_in_view', view, action: a, did: r.what });
    return json({
      did: r.what,
      marked: 'on the pane, with an undo for the person',
      ...(r.account ? { view: r.account } : {}),
    });
  };

  server.registerTool(
    'look',
    {
      description:
        "What the person sees now, as JSON: the window, each pane (its view, where it is, its box, wide or compact, whether its content fits or scrolls, and what the window read back of what it drew: values, the tab open, pages' frames), the views collapsed in the shelf (by whom, and whether shown again since), which pane has focus, what the person changed since you last read an account (resized, collapsed, opened, moved, maximized, answered), what pages sent while they used them that you have not heard yet, and what is still waiting for their answer. No pixels.",
      inputSchema: z.object({}),
      annotations: HINTS.read,
    },
    async () => {
      if (session.runtime.options.verifyMs) await fresh(session, Math.min(session.runtime.options.verifyMs, 1500));
      const about = new Map(
        await Promise.all(
          [...session.abouts].map(
            async ([v, f]) =>
              [
                v,
                await Promise.resolve()
                  .then(f)
                  .catch((e) => ({ error: String((e as Error).message ?? e) })),
              ] as const,
          ),
        ),
      );
      const a = {
        ...session.shell.account({
          full: true,
          about: (v) => about.get(v),
          sight: (v, got) => inSight(session, v, got),
        }),
        ...sentNow(session),
        ...waitingOn(session),
        ...addedOps(session),
        ...slotsOf(session),
        ...remindersOf(session),
      };
      return loggedJson(session, { tool: 'look' }, 'account', a);
    },
  );

  server.registerTool(
    'read_view',
    {
      description: readText(has),
      inputSchema: readViewFor(has),
      annotations: HINTS.read,
    },
    async (args) =>
      viewCall(session, 'read_view', args, async () => {
        if (!session.live?.kindOf(args.view)) {
          const shown = session.shell.viewOf(args.view);
          if (!shown)
            throw new Error(
              `no view "${args.view}"; views: ${
                session.shell
                  .state()
                  .views.map((v) => v.name)
                  .join(', ') || 'none'
              }`,
            );
          return {
            view: args.view,
            kind: shown.kind ?? 'cards',
            ...(shown.loading ? { state: 'loading' } : {}),
            ...session.shell.account({ view: args.view }),
          };
        }
        return session.live.read(args.view, args);
      }),
  );

  server.registerTool(
    'act_in_view',
    {
      // a view of cards, the same as the person can; a terminal or page, where the window has one
      description: cardActsFor(session.runtime.cards.values()) + (has.pages || has.run ? ` ${actText(has)}` : ''),
      inputSchema: actInViewFor(has, session.runtime.cards.values()),
      annotations: HINTS.ui,
    },
    async (args, extra) => {
      if (!session.live?.kindOf(args.view)) return actInCards(args);
      const inPage = ActInView.safeParse(args); // a page's or a terminal's fields, as they take them (value a string, say)
      if (!inPage.success) {
        const why = inPage.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`);
        return text(`not done: ${why.join('; ')}`, true);
      }
      return viewCall(session, 'act_in_view', inPage.data, async () =>
        session.live!.act(inPage.data.view, inPage.data, (extra as { signal?: AbortSignal } | undefined)?.signal),
      );
    },
  );

  server.registerTool(
    'ctx_read',
    {
      description:
        'Read one value exactly, by reference: ctx:<id>#<JSON Pointer>, e.g. ctx:r3#/0/amount (a value), ctx:r3#/0 (a row) or ctx:r3 (all of it). Accounts give a reference for each value they show. Long values are cut at max characters, and say so.',
      inputSchema: z.object({
        ref: z.string(),
        max: z
          .number()
          .int()
          .positive()
          .max(READ_MAX)
          .optional()
          .describe(`characters, default 20000, at most ${READ_MAX}`),
      }),
      annotations: HINTS.read,
    },
    async ({ ref, max }) => {
      const r = readRef(session.results, ref);
      if (!r.ok) return text(`not read: ${r.why}`, true);
      const out = JSON.stringify(r.value) ?? 'null';
      const cap = max ?? 20_000;
      return json(
        out.length > cap
          ? {
              ref,
              value: out.slice(0, cap),
              cut: `${cap} of ${out.length} characters: read a narrower pointer for the rest`,
            }
          : { ref, value: r.value },
      );
    },
  );
}
