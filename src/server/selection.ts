import { brief } from '../results.js';
import { panelsOf } from '../cards.js';
import { asText, decimalNumber } from '../format.js';
import { type PointItem, resolvePoint } from '../pointing.js';
import { keep, log, whoOf } from './records.js';
import type { Session } from './state.js';

/** The person set a panel's inputs in the window: the view is computed again with them, kept as theirs, and told. */
export const setInputs = (session: Session, x: Record<string, unknown>): boolean => {
  const view = asText(x.view ?? '');
  const ctx = (x.context ?? {}) as Record<string, unknown>;
  const panel = asText(ctx.panel ?? '');
  const args = session.specs.get(view);
  const spec = session.shown.get(view);
  const p = spec ? panelsOf(spec).find((q) => q.id === panel) : undefined;
  if (!args || !p?.inputs) return false;
  const vals: Record<string, number> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (!k.startsWith('in:') || !Object.hasOwn(p.inputs, k.slice(3))) continue;
    const n = decimalNumber(v);
    if (Number.isFinite(n)) vals[k.slice(3)] = n;
  }
  if (!Object.keys(vals).length) return false;
  const key = `${view}/${panel}`;
  const before = session.inputs.get(key);
  const had = before ?? { set: {}, defaults: {} };
  session.inputs.set(key, { set: { ...had.set, ...vals }, defaults: had.defaults });
  let drawn = false;
  void session
    .present(args, true, false, () => {
      drawn = true;
    }) // drawn again where it is, shown or hidden
    .then((acc) => {
      const pa = acc.panels.find((q) => q.id === panel);
      const w = whoOf(x);
      keep(session, {
        to: `the inputs of ${panel} in ${spec!.title}`,
        by: 'person',
        values: vals,
        who: [`${w.name} (${w.window})`],
      });
      session.shell.tell(
        `set ${Object.entries(vals)
          .map(([k, n]) => `${k} to ${n}`)
          .join(
            ', ',
          )} in ${spec!.title} (${panel})${pa?.shows !== undefined ? `; it shows ${asText(pa.shows)} now` : ''}`,
      );
      log(session, { person: { inputs: { view, panel, values: vals } } });
    })
    .catch((e) => {
      // what the view cannot be drawn with is not kept: its inputs stay as they were
      if (!drawn) {
        if (before) session.inputs.set(key, before);
        else session.inputs.delete(key);
      }
      session.refusals.push(String((e as Error).message));
      log(session, {
        person: { inputs: { view, panel, values: vals } },
        refusal: String((e as Error).message),
      });
    });
  return true;
};
// ── pointing ───────────────────────────────────────────────────────────────────────────────────────────────────
const kindOfView = (session: Session, view: string) =>
  session.live?.kindOf(view) ?? (session.data.has(view) ? 'cards' : session.shell.viewOf(view)?.kind);
export const resolved = (session: Session) =>
  session.picked
    .map((it) =>
      resolvePoint(it, {
        spec: session.shown.get(it.view),
        data: session.data.get(it.view),
        kind: kindOfView(session, it.view),
        cards: session.runtime.cards,
      }),
    )
    .filter((x): x is Record<string, unknown> => !!x);
/** What the person points at now: each thing in a view that can be pointed at (its role says), at most 60. */
export const setPicked = (session: Session, items: PointItem[]) => {
  session.picked = items
    .filter((it) => it && typeof it.view === 'string' && session.shell.viewOf(it.view)?.role.pointable)
    .slice(0, 60);
  session.shell.setPicked(session.picked, [...session.attached]);
};

/** What goes with the person's next message: what they point at, kept as their answer (p-id), and the panes they put in the chat. */
export const contextFor = (session: Session, budget = 4000): { text: string; id?: string } => {
  const items = resolved(session);
  const attached = [...session.attached]
    .filter((v) => session.shell.viewOf(v) !== undefined)
    .map((v) => ({
      view: v,
      ...session.shell.account({ view: v }),
      ...(session.data.has(v)
        ? {
            panels: panelsOf(session.shown.get(v)!).map((p) => ({
              id: p.id,
              card: p.card,
              ...(p.from ? { from: p.from } : {}),
              rows: session.data.get(v)![p.id]?.rows?.length,
            })),
          }
        : {}),
    }));
  if (!items.length && !attached.length) return { text: '' };
  let id: string | undefined;
  if (items.length) {
    id = keep(session, {
      to: 'what the person points at',
      by: 'person',
      values: { items },
      ...(session.pointedBy ? { who: [`${session.pointedBy.name} (${session.pointedBy.window})`] } : {}),
    }).id;
    setPicked(session, []);
  }
  let json = JSON.stringify({
    ...(items.length ? { pointed_at: id, items } : {}),
    ...(attached.length ? { in_the_chat: attached } : {}),
  });
  if (json.length > budget) json = `${json.slice(0, budget - 40)}… (ctx_read ctx:${id ?? 'p?'} reads it all)`;
  return { text: `[the window: ${json}]`, ...(id ? { id } : {}) };
};

import { pidFor } from '../cards.js';

/** The person opened a bar or a group's row: the rows behind it, in the same pane, exact (the system grouped them). */
export const drillIn = async (session: Session, x: Record<string, unknown>): Promise<boolean> => {
  const view = asText(x.view ?? '');
  const spec = session.shown.get(view);
  const args = session.specs.get(view);
  const data = session.data.get(view);
  if (!spec || !args || !data) return false;
  const all = panelsOf(spec);
  const i = all.findIndex((p) => p.id === x.panel || pidFor(p.id) === x.pid);
  const p = all[i];
  if (!p?.group || !p.from) return false;
  const r = data[p.id].rows?.[Number(x.row)];
  if (!r) return false;
  const key = String(r[p.group]);
  const raw =
    [
      ...((args.panels as Record<string, unknown>[] | undefined) ?? []),
      ...((args.tabs as { panels: Record<string, unknown>[] }[] | undefined) ?? []).flatMap((t) => t.panels),
    ][i] ?? {};
  const inner: Record<string, unknown> = {
    id: `${p.id}-${key}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40),
    card: 'table',
    title: `${p.title ?? p.group}: ${key}`,
    from: p.from,
    ...(raw.pick ? { pick: raw.pick } : {}),
    ...(raw.compute ? { compute: raw.compute } : {}),
    where: { ...(raw.where as Record<string, unknown> | undefined), [p.group]: key },
  };
  const stack = session.drills.get(view) ?? [];
  const path = [...((args.path as string[] | undefined) ?? [spec.title]), key];
  await session.present({
    name: view,
    title: spec.title,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    panels: [inner],
    path,
  });
  session.drills.set(view, [...stack, args]);
  session.shell.tell(
    `opened ${key} in ${spec.title} (${p.title ?? p.id}): the ${data[p.id].behind?.get(key)?.length ?? 'rows'} rows behind it`,
  );
  return true;
};
export const drillBack = async (session: Session, view: string): Promise<boolean> => {
  const stack = session.drills.get(view);
  if (!stack?.length) return false;
  const prev = stack.pop()!;
  await session.present(prev);
  if (!stack.length) session.drills.delete(view);
  session.shell.tell(`went back in ${session.shown.get(view)?.title ?? view}`);
  return true;
};

/** Consume queued changes and answers for the next prompt, once. */
export function consumeWindowChanges(session: Session, budget: number): string {
  const fresh = session.own.slice(session.told).filter((a) => !session.heard.has(a.id)); // what pages sent and the model already heard is not said again
  const lines = [
    ...session.shell.pending().map((c) => `the person ${c}`),
    ...session.shell.takeElsewhere().map((c) => `the person ${c}`),
    ...session.shell.takeSaid(),
    ...fresh.map((a) => brief(a)),
  ];
  session.vunseen.clear(); // told now: the model's next change inside a view goes ahead
  session.told = session.own.length;
  for (const a of fresh) if (a.from) session.heard.add(a.id);
  if (!lines.length) return '';
  let out = `[the window, revision ${session.shell.revision}: ${lines.join('; ')}]`;
  if (out.length > budget) out = `${out.slice(0, budget - 30)}… (look tells the rest)]`;
  return out;
}
