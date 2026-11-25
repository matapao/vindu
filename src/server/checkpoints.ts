import type { PointItem } from '../pointing.js';
import type { AnswerEntry } from '../results.js';
import { answersFor, restoreAnswers } from './checkpoint-answers.js';
import type { ViewCheckpoint, ViewSnapshot } from './contracts.js';
import { readForCheckpoint, restoreRead } from './read-progress.js';
import { restoreDrafts, savedDrafts } from './message-drafts.js';
import { keep, log } from './records.js';
import { pointersFor, refetchAll, restoredView, type Restoring, waitsSaid } from './refetch.js';
import { gateRestored, keptGates, keptPointers } from './refetch-waiting.js';
import { restoreRem } from './reminders.js';
import { setPicked } from './selection.js';
import type { Fill, Gate, Session } from './state.js';
import { idsIn, refsOf, swapIds } from './view-ids.js';

// ── a new process from a view: the view as it is, and its entries, carried exactly ──────────────────────────────────
export const snapshotOf = (session: Session): ViewSnapshot => {
  const views = session.shell
    .state()
    .views.filter((v) => session.specs.has(v.name) && v.role.checkpointed) // the model's views of cards, as their roles say
    .map((v) => ({
      name: v.name,
      title: session.shown.get(v.name)?.title ?? v.title,
      args: structuredClone(session.specs.get(v.name)!),
      ...(v.mark ? { mark: { text: v.mark.text, by: v.mark.by } } : {}),
    }));
  const ids = new Set<string>(); const refs = refsOf(session);
  for (const v of views) idsIn(v.args, refs, ids);
  const drafts = savedDrafts(session).filter((d) => views.some((v) => v.name === d.view)); // the person's, in these views
  return {
    at: new Date().toISOString(),
    views,
    layout: session.shell.layoutNow(),
    ids: [...ids].filter((id) => /^[ra]\d+$/.test(id)),
    answers: [...ids]
      .filter((id) => /^p\d+$/.test(id))
      .map((id) => session.own.find((a) => a.id === id))
      .filter((a): a is AnswerEntry => !!a),
    changes: views.flatMap((v) =>
      (session.vhistory.get(v.name) ?? []).map(
        (h) => `${h.by === 'person' ? 'the person' : 'the model'} ${h.what}`,
      ),
    ),
    picked: session.picked.filter((it) => views.some((v) => v.name === it.view)),
    ...(drafts.length ? { drafts } : {}),
  };
};
export const startFrom = async (session: Session, snap: ViewSnapshot, carried: Record<string, string>) => {
  const map: Record<string, string> = { ...carried };
  for (const a of snap.answers) {
    const e = keep(session, {
      to: a.to,
      by: a.by,
      values: a.values,
      ...(a.output !== undefined ? { output: a.output } : {}),
      ...(a.who ? { who: a.who } : {}),
    });
    map[a.id] = e.id;
  }
  restoreDrafts(session, snap.drafts); // as restore brings them back: each the person's again where its view draws the same mail
  const shown: string[] = [];
  const refused: Record<string, string> = {}; const refs = refsOf(session);
  for (const v of snap.views) {
    const missing = [...idsIn(v.args, refs)].filter((id) => !Object.hasOwn(map, id));
    if (missing.length) {
      refused[v.name] = `it points at ${missing.join(', ')}, which were not carried`;
      continue;
    }
    try {
      await session.present(swapIds(v.args, refs, map) as Record<string, unknown>);
      shown.push(v.name);
      if (v.mark) session.shell.mark(v.name, { text: v.mark.text, by: v.mark.by });
    } catch (e) {
      refused[v.name] = String((e as Error).message);
    }
  }
  if (shown.length && snap.layout) session.shell.setLayout(snap.layout);
  if (snap.picked.length)
    setPicked(
      session,
      snap.picked.filter((it) => shown.includes(it.view)),
    );
  session.branch = { views: shown, map, changes: snap.changes, refused };
  log(session, { branch: { from: snap.at, shown, refused, map } });
  return { shown, refused, map };
};
// ── a task opened again from its checkpoint: the person's own state of its views, and where their results came from ──
/** What the person points at, by where it is: what was under the pointer (a span's text, what a page reported) is read
 *  again from the view as restored, never kept. */
const placeOf = ({ text: _text, page: _page, note: _note, ...at }: PointItem): PointItem => at;
/** The gates of the views a checkpoint keeps, by view/panel (a panel's id has no "/"). */
const gatesOf = (session: Session, views: ReadonlySet<string>): [string, Gate][] =>
  [...session.gates].filter(([k]) => views.has(k.slice(0, k.lastIndexOf('/'))));
export const checkpoint = (session: Session): ViewCheckpoint => {
  const { views, layout, picked } = snapshotOf(session);
  const { focus, maximized, shelf, recent } = session.shell.state();
  const gates = keptGates(session, gatesOf(session, new Set(views.map((v) => v.name))));
  const reminders = session.runtime.options.reminders ? session.reminders.map((r) => ({ ...r })) : [];
  const refs = refsOf(session), ids = new Set<string>();
  for (const v of views) idsIn(v.args, refs, ids);
  const fresh = [...session.fresh].filter(([read]) => ids.has(read)); // the newest read of each the views show
  for (const pair of fresh) for (const id of pair) ids.add(id);
  for (const [, g] of gates) if (g.got) ids.add(g.got);
  for (const [, f] of session.mode?.fills ?? []) if (f.id) ids.add(f.id);
  for (const r of reminders) if (r.about) idsIn(r.about, refs, ids);
  return {
    views,
    layout,
    picked: picked.map(placeOf),
    arrangement: { focus, maximized, shelf, recent },
    attached: [...session.attached],
    inputs: [...session.inputs],
    steps: [...session.steps],
    gates,
    fresh,
    tickets: session.tickets,
    ...(session.mode ? { mode: { ...session.mode, fills: [...session.mode.fills] } } : {}),
    read: readForCheckpoint(session), // how far the person has read each panel, like their what-ifs: their own state of the view
    ...(session.drafts.size || session.savedDrafts.size ? { drafts: savedDrafts(session) } : {}),
    pointers: pointersFor(session, ids), // where each result came from, never what it held
    answers: answersFor(session, ids, gates),
    ...(reminders.length ? { reminders } : {}),
  };
};
/** A gate as restored: on what was read again, or waiting for what comes after the restore (since), saying why, with
 *  the pointer it may be read again from (gateRestored); either way filling the same field of its panel. */
const restoredGate = (g: Gate, since: number, sinceOwn: number, r: ReturnType<typeof gateRestored>): Gate => {
  const gate: Gate = { want: g.want, since, sinceOwn, ...(g.fills ? { fills: { ...g.fills } } : {}) };
  if (r.got) gate.got = r.got;
  else if (r.why) {
    gate.why = r.why;
    if (r.pointer) gate.pointer = r.pointer;
  }
  return gate;
};
/** A template's fill, on the id read again; without one where it was not. */
const restoredFill = ({ id, ...fill }: Fill, now: (id?: string) => string | undefined): Fill => {
  const again = now(id);
  return again ? { ...fill, id: again } : fill;
};
/** The task, as the person left it: their answers kept again; each result and attachment the views show read again
 *  by the host (more.refetch), and the views drawn from what came; a panel whose result was not read again waits for
 *  it, saying why, and the model is told once. The titles of the views that could not be drawn at all. */
export const restore = async (session: Session, saved: ViewCheckpoint) => {
  if (session.specs.size || session.own.length || session.asks.size)
    throw new Error('Restore into a newly opened task.');
  const answered = restoreAnswers(session, saved.answers);
  const read = await refetchAll(session, saved.pointers ?? [], keptPointers(saved.gates));
  const map = { ...read.map, ...answered.map };
  const now = (id?: string) => (id !== undefined && Object.hasOwn(map, id) ? map[id] : undefined); // never what objects inherit
  const since = session.results.all().length; // what waits, waits for what comes after the restore
  const pointers = new Map((saved.pointers ?? []).map((p) => [p.id, p]));
  const waits: string[] = [];
  session.tickets = saved.tickets;
  session.inputs = new Map(saved.inputs);
  session.steps = new Map(saved.steps);
  session.gates = new Map(
    saved.gates.map(([k, g]) => {
      const r = gateRestored(k, g, read, now, pointers);
      if (r.told) waits.push(r.told);
      return [k, restoredGate(g, since, answered.sinceOwn(g.sinceOwn), r)];
    }),
  );
  session.fresh = new Map(saved.fresh.flatMap(([was, newest]): [string, string][] => {
    const a = now(was), b = now(newest);
    return a && b && a !== b ? [[a, b]] : [];
  }));
  if (saved.mode)
    session.mode = { ...saved.mode, fills: new Map(saved.mode.fills.map(([n, f]) => [n, restoredFill(f, now)])) };
  restoreDrafts(session, saved.drafts);
  const refs = refsOf(session);
  restoreRem(session, saved.reminders?.map((r) => (r.about ? { ...r, about: swapIds(r.about, refs, map) as string } : r)));
  const restoring: Restoring = { refs, map, missing: read.missing, again: read.again, pointers, waits };
  const refused: string[] = [];
  for (const v of saved.views) {
    try {
      await session.present(restoredView(session, v.args, restoring), false, true);
      if (v.mark) session.shell.mark(v.name, v.mark);
    } catch {
      refused.push(v.title);
    }
  }
  session.shell.restoreLayout(saved.layout, saved.arrangement);
  session.attached = new Set(saved.attached.filter((name) => session.shown.has(name)));
  restoreRead(session, saved.read);
  setPicked(session, saved.picked);
  if (waits.length)
    session.shell.say(
      `this task was opened again where the person left it, its views drawn from their results read again; ${waitsSaid(waits)}`,
    );
  log(session, { restore: { read: Object.keys(read.map), missing: [...read.missing.keys()], waits: waits.length, refused } });
  return refused;
};
export const branchNote = (session: Session) => {
  const b = session.branch;
  if (!b || !b.views.length) return '';
  const pairs = Object.entries(b.map).map(([was, now]) => `${now} (was ${was})`);
  return (
    ` This task starts from a view of an earlier task, as the person left it: ${b.views.map((v) => `"${session.shown.get(v)?.title ?? v}"`).join(', ')}, on what that task got, carried here exactly under this task's ids: ${pairs.slice(0, 24).join(', ')}${pairs.length > 24 ? ', …' : ''}.` +
    (b.changes.length ? ` Done in it: ${b.changes.slice(-10).join('; ')}.` : '') +
    " The earlier task's conversation is not part of this one: what it found is in these views and results."
  );
};
