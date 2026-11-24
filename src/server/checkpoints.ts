import fs from 'node:fs';
import path from 'node:path';
import { FROM_ALIASES, fieldRoles, resultIds } from '../cards.js';
import type { AnswerEntry } from '../results.js';
import type { ViewCheckpoint, ViewSnapshot } from './contracts.js';
import { readForCheckpoint, restoreRead } from './read-progress.js';
import { restoreDrafts, savedDrafts } from './message-drafts.js';
import { keep, log } from './records.js';
import { setPicked } from './selection.js';
import type { Session } from './state.js';

// ── a new process from a view: the view as it is, and its entries, carried exactly ──────────────────────────────────
const ID = /^[rap]\d+$/;
/** The ids a value of a field that holds them names: a run written out (r5-r44); one longer than a panel can show is
 *  no run of ids, so it is carried as it is. */
const idsOf = (v: string): string[] => {
  try {
    return resultIds([v]);
  } catch {
    return [v.trim()];
  }
};
/** The fields of a panel that hold result ids, as the cards offered here mark them (resultRef): a panel's from (and the
 *  names show_view reads as from), a document's before, media and its marks, a page's uses, a batch's results, and any
 *  of a host's own. */
const refsOf = (session: Session) => new Set([...fieldRoles([...session.runtime.cards.values()]).refs, ...FROM_ALIASES]);
/** Every id a view points at: in each field that holds ids (a run, such as r5-r44, as each of its ids), and each ctx:
 *  reference. */
const idsIn = (x: unknown, refs: Set<string>, out = new Set<string>(), k?: string): Set<string> => {
  if (typeof x === 'string') {
    if (k && refs.has(k) && ID.test(x)) out.add(x);
    for (const m of x.matchAll(/ctx:([rap]\d+)/g)) out.add(m[1]);
  } else if (Array.isArray(x))
    for (const v of x) {
      if (k && refs.has(k) && typeof v === 'string') for (const id of idsOf(v).filter((y) => ID.test(y))) out.add(id);
      else idsIn(v, refs, out);
    }
  else if (x && typeof x === 'object') for (const [kk, v] of Object.entries(x)) idsIn(v, refs, out, kk);
  return out;
};
/** The view with each id it points at swapped for its new one: in each field that holds ids (a run written out), and
 *  in each ctx: reference. */
const swapIds = (x: unknown, refs: Set<string>, map: Record<string, string>, k?: string): unknown => {
  const now = (id: string) => (Object.hasOwn(map, id) ? map[id] : undefined); // an id's new one: never what objects inherit
  if (typeof x === 'string')
    return ((k && refs.has(k) && now(x)) || x).replace(/ctx:([rap]\d+)/g, (m, id: string) => {
      const swapped = now(id);
      return swapped ? `ctx:${swapped}` : m;
    });
  if (Array.isArray(x))
    return x.flatMap((v) => {
      if (!(k && refs.has(k) && typeof v === 'string')) return [swapIds(v, refs, map)];
      const ids = idsOf(v), run = ids.length !== 1 || ids[0] !== v.trim(); // r5-r44: each of its ids, swapped
      return run && ids.every((id) => now(id)) ? ids.map((id) => map[id]) : [now(v) ?? swapIds(v, refs, map)];
    });
  if (x && typeof x === 'object')
    return Object.fromEntries(Object.entries(x).map(([kk, v]) => [kk, swapIds(v, refs, map, kk)]));
  return x;
};
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
export const checkpoint = (session: Session): ViewCheckpoint => {
  const { views, layout, picked } = snapshotOf(session);
  const { focus, maximized, shelf, recent } = session.shell.state();
  return {
    views,
    layout,
    picked,
    arrangement: { focus, maximized, shelf, recent },
    attached: [...session.attached],
    inputs: [...session.inputs],
    steps: [...session.steps],
    gates: [...session.gates],
    fresh: [...session.fresh],
    tickets: session.tickets,
    ...(session.mode ? { mode: { ...session.mode, fills: [...session.mode.fills] } } : {}),
    read: readForCheckpoint(session), // how far the person has read each panel, like their what-ifs: their own state of the view
    ...(session.drafts.size ? { drafts: savedDrafts(session) } : {}),
  };
};
export const restore = async (session: Session, saved: ViewCheckpoint) => {
  if (session.specs.size || session.own.length || session.asks.size)
    throw new Error('Restore into a newly opened task.');
  const file = path.join(session.process.dir, 'answers.jsonl');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  // a crash while an answer was written leaves its line cut short, without its newline: it goes, so the next one is whole
  const whole = text.slice(0, text.lastIndexOf('\n') + 1);
  if (whole.length < text.length) fs.truncateSync(file, Buffer.byteLength(whole));
  for (const line of whole.split('\n').filter(Boolean)) {
    const a = JSON.parse(line) as AnswerEntry;
    if (a.kind !== 'answer' || a.id !== `p${session.own.length + 1}`)
      throw new Error('The saved task answers are inconsistent.');
    session.own.push(a);
    if (a.from) session.heard.add(a.id);
  }
  // Historical answers stay in the record. Only new submissions should appear as a new message.
  session.told = session.own.length;
  session.tickets = saved.tickets;
  session.inputs = new Map(saved.inputs);
  session.steps = new Map(saved.steps);
  session.gates = new Map(saved.gates);
  session.fresh = new Map(saved.fresh);
  if (saved.mode) session.mode = { ...saved.mode, fills: new Map(saved.mode.fills) };
  restoreDrafts(session, saved.drafts);
  const refused: string[] = [];
  for (const v of saved.views) {
    try {
      await session.present(v.args, false, true);
      if (v.mark) session.shell.mark(v.name, v.mark);
    } catch {
      refused.push(v.title);
    }
  }
  session.shell.restoreLayout(saved.layout, saved.arrangement);
  session.attached = new Set(saved.attached.filter((name) => session.shown.has(name)));
  restoreRead(session, saved.read);
  setPicked(session, saved.picked);
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
