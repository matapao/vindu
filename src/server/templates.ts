import { CARDS } from '../cards.js';
import {
  asViewLayout,
  checkTemplate,
  fitRead,
  sourceName,
  uriWith,
  waitingPanel,
  withInputs,
} from '../templates.js';
import { openAsk } from './asks.js';
import type { OpenMore } from './contracts.js';
import { keep, log, unawaited } from './records.js';
import type { Session, StaticMode } from './state.js';
import { personSlot } from './template-slots.js';
import { keepFresh, stopWatch } from './template-updates.js';

/** Ask for inputs before replacing the active template or reading its sources. */
const startTemplate = async (
  session: Session,
  raw: unknown,
  more: OpenMore,
  given?: Record<string, unknown>,
) => {
  const cancelled = { started: false, action: 'cancel' } as const;
  if (session.closed) return cancelled;
  const checked = checkTemplate(raw, {
    cards: new Set([...CARDS, ...session.runtime.cards.keys()]),
    operations: [...session.runtime.operations, ...session.added].map((x) => x.name),
    isRead: more.isRead,
  });
  if (!checked.template) return { started: false, problems: checked.problems };
  const t = checked.template;
  let inputs = given ?? {};
  if (t.inputs && Object.keys(t.inputs).length && !given) {
    const p = openAsk(
      session,
      'operation',
      `start ${t.name}`,
      {
        title: `Start: ${t.name}`,
        ...(t.about ? { message: t.about } : {}),
        fields: t.inputs,
        required: Object.keys(t.inputs),
      },
      undefined,
      false,
    );
    const r = await p.outcome;
    if (r.action !== 'accept') return { started: false, action: r.action };
    if (session.closed) return cancelled;
    inputs = r.values;
    keep(session, {
      to: `the inputs of ${t.name}`,
      by: 'person',
      values: inputs,
      who: p.approvals.map((a) => `${a.name} (${a.window})`),
    });
  }
  const mode: StaticMode = { template: t, inputs, fills: new Map() };
  session.mode = mode;
  const inactive = () => session.closed || session.mode !== mode;
  // what the dynamic view had going stops: its sources kept fresh, and what the model wrote to be shown later
  for (const stop of session.watches.splice(0)) stop();
  session.lives.clear();
  session.slotWatches.clear();
  session.held.clear();
  session.gates.clear();
  for (const [n, sl] of Object.entries(t.slots)) {
    if (inactive()) return cancelled;
    await session.present({ name: n, title: sl.title, panels: [waitingPanel(sl)] }).catch(() => undefined);
  }
  if (inactive()) return cancelled;
  if (t.layout) session.shell.setLayout(asViewLayout(t.layout));
  const read: string[] = [],
    failed: string[] = [];
  for (const [n, sl] of Object.entries(t.slots)) {
    if (inactive()) return cancelled;
    if (!sl.source) continue;
    if (!more.source) {
      failed.push(`${n}: this host reads no sources`);
      continue;
    }
    try {
      const what =
        sl.source.resource !== undefined
          ? { resource: uriWith(sl.source.resource, inputs) }
          : { tool: sl.source.tool! };
      const id = await more.source({
        server: sl.source.server,
        ...what,
        args: withInputs(sl.source.args ?? {}, inputs),
      });
      if (inactive()) return cancelled;
      const fit = fitRead(n, sl, id);
      if ('refusal' in fit) throw new Error(fit.refusal);
      await session.present(fit.args);
      if (inactive()) return cancelled;
      mode.fills.set(n, { by: 'source', id, at: new Date().toISOString() });
      read.push(
        `${n} from ${sourceName({ ...sl.source, ...what })} (${id})${sl.source.every ? `, kept fresh${sl.source.resource !== undefined ? " (on its server's word, or" : ' (read again'} every ${sl.source.every} s)` : ''}`,
      );
      if (sl.source.every && more.watch)
        keepFresh(session, n, sl, { ...what, args: withInputs(sl.source.args ?? {}, inputs) }, id, more);
    } catch (e) {
      if (inactive()) return cancelled;
      const why = String((e as Error).message ?? e);
      failed.push(`${n}: ${why}`);
      mode.fills.set(n, { by: 'source', at: new Date().toISOString(), failed: why });
      await session
        .present({
          name: n,
          title: sl.title,
          panels: [
            waitingPanel(
              { ...sl, source: undefined },
              `Its source failed (${why.slice(0, 120)}); the model may fill it`,
            ),
          ],
        })
        .catch(() => undefined);
    }
  }
  if (inactive()) return cancelled;
  for (const [n, sl] of Object.entries(t.slots))
    if (sl.by === 'person') unawaited(session, { slot: n, person: true }, personSlot(session, n, sl, more));
  session.shell.tell(
    `started the static view "${t.name}"${read.length ? `; filled from sources: ${read.join('; ')}` : ''}${failed.length ? `; not filled: ${failed.join('; ')}` : ''}`,
  );
  log(session, { template: { name: t.name, inputs, read, failed, notes: checked.notes } });
  return { started: true, notes: checked.notes, read, failed };
};

import { pinTemplate, type Template } from '../templates.js';
import type { TemplateStart } from './contracts.js';

export function templateControls(session: Session) {
  const more = session.more;
  let startingTemplate = false;
  return {
    /** Make the view static with a template (a template file's JSON): slots get their panes, inputs are asked, sources
     *  are read through more.source, the person's slots are put before them. Refused, with why, if it does not fit. */
    async useTemplate(raw: unknown, inputs?: Record<string, unknown>): Promise<TemplateStart> {
      if (startingTemplate) return { started: false, problems: ['Another template is starting.'] };
      startingTemplate = true;
      try {
        return await startTemplate(session, raw, more, inputs);
      } finally {
        startingTemplate = false;
      }
    },
    /** Dynamic again: the model may add, move and replace panes from now on; the template stays as it was. */
    letModelChange: () => {
      if (!session.mode) return false;
      const n = session.mode.template.name;
      session.mode = undefined;
      for (const stop of session.slotWatches.values()) stopWatch(session, stop); // the slots are the model's now: no source refills them
      session.slotWatches.clear();
      session.shell.tell(
        `let you change the view: it is dynamic again (the template "${n}" stays as it was)`,
      );
      return true;
    },
    /** A template from the view as it is now (the person names it), to keep as a file and choose for a process like this. */
    pin: (name: string, about?: string) =>
      pinTemplate({
        name,
        about,
        layout: session.shell.layoutNow(),
        views: session.shell
          .state()
          .views.filter(
            (v) => session.specs.has(v.name) && v.role.checkpointed,
          )
          .map((v) => ({
            name: v.name,
            title: session.shown.get(v.name)?.title ?? v.name,
            args: session.specs.get(v.name)!,
          })),
        resultOf: (id) => {
          const e = session.results.get(id);
          return e?.kind === 'result' ? { server: e.server, tool: e.tool, input: e.input } : undefined;
        },
        isRead: more.isRead,
        cards: [...session.runtime.cards.values()],
      }),
    /** The static view's template with the layout the person has now, to keep for next time. */
    arrangement: (): Template | undefined =>
      session.mode ? { ...session.mode.template, layout: session.shell.layoutNow() } : undefined,

    /** Static (and which template) or dynamic. */
    mode: () =>
      session.mode
        ? { kind: 'static' as const, template: session.mode.template.name }
        : { kind: 'dynamic' as const },
  };
}
