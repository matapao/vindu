// A checkpoint keeps where each result came from, never what it held: on restore, the host reads each one again
// (refetch), and the restored views are drawn from what came. A panel whose result was not read again waits for it,
// saying why: for the same call again where it showed a result, or in words where it showed something else; the rest
// of its view is drawn as it was.
import { panelIdsOf } from '../cards.js';
import type { Row } from '../results.js';
import type { ResultPointer } from './contracts.js';
import { stableJson } from './records.js';
import type { Session } from './state.js';
import { idsIn, swapIds } from './view-ids.js';

/** Where each result and attachment named here came from, as the session has it: never what it held. A result the host
 *  gave a ref of its own is named by it, in place of its input. */
export const pointersFor = (session: Session, ids: Iterable<string>): ResultPointer[] => {
  const out: ResultPointer[] = [];
  for (const id of ids) {
    const e = session.results.get(id);
    if (e?.kind === 'result')
      out.push({
        id,
        kind: 'result',
        server: e.server,
        tool: e.tool,
        ...(e.ref !== undefined ? { ref: e.ref } : e.input !== undefined ? { input: structuredClone(e.input) } : {}),
      });
    else if (e?.kind === 'attachment') out.push({ id, kind: 'attachment', name: e.name, mime: e.mime, file: e.file });
  }
  return out;
};

/** What a pointer reads, as one call: two ids of the same call are read again once. */
const callOf = (p: ResultPointer): string =>
  p.kind === 'attachment'
    ? stableJson({ file: p.file, name: p.name, mime: p.mime })
    : stableJson({
        server: p.server,
        tool: p.tool,
        ...(p.ref !== undefined ? { ref: p.ref } : { input: p.input ?? null }),
      });
const nameOf = (p: ResultPointer) => (p.kind === 'attachment' ? `the attachment ${p.name}` : `${p.server}.${p.tool}`);
const oneLine = (e: unknown) =>
  String((e as Error)?.message ?? e)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

/** One pointer, read again by the host: the new entry's id, or why there is none, as a sentence. */
async function readAgain(session: Session, p: ResultPointer): Promise<{ id: string } | { why: string }> {
  const refetch = session.more.refetch;
  if (!refetch) return { why: 'Not read again: this host reads nothing again for a task restored.' };
  if (p.kind === 'result' && p.ref === undefined && session.more.isRead?.(p.server, p.tool) === false)
    return { why: `Not called again: ${nameOf(p)} changes things, as its server says.` };
  let id: unknown;
  try {
    id = await refetch(structuredClone(p));
  } catch (e) {
    return { why: `Not read again: the host could not (${oneLine(e)}).` };
  }
  if (typeof id !== 'string' || !id) return { why: 'Not read again: the host could not.' };
  const e = session.results.get(id);
  if (e?.kind !== p.kind)
    return {
      why: `Not read again: the host gave ${id.slice(0, 40)}, which is not ${p.kind === 'result' ? 'a result' : 'an attachment'} of this task.`,
    };
  if (e.kind === 'result' && e.error) return { why: `Read again, ${nameOf(p)} failed (${id}).` };
  return { id };
}

/** Every pointer, read again by the host, each call once and all at once: the new id of each one read (map), and why
 *  each other one was not (missing). */
export async function refetchAll(session: Session, pointers: readonly ResultPointer[]) {
  const map: Record<string, string> = {};
  const missing = new Map<string, string>();
  const calls = new Map<string, ResultPointer[]>();
  for (const p of pointers) calls.set(callOf(p), [...(calls.get(callOf(p)) ?? []), p]);
  await Promise.all(
    [...calls.values()].map(async (same) => {
      const got = await readAgain(session, same[0]);
      for (const p of same)
        if ('id' in got) map[p.id] = got.id;
        else missing.set(p.id, got.why);
    }),
  );
  return { map, missing };
}

/** What restoring a view knows: the ids read again (map), why the others were not (missing), each pointer by its id,
 *  and where the view's panels that wait are told (waits). */
export type Restoring = {
  refs: Set<string>;
  map: Record<string, string>;
  missing: Map<string, string>;
  pointers: Map<string, ResultPointer>;
  waits: string[];
};
const isRecord = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
export const NOT_KEPT = 'Not shown again: what it showed is not kept once its task has closed.';
/** What a panel showed, where the checkpoint says. */
const showed = (p: ResultPointer | undefined): string => {
  if (!p) return '';
  return p.kind === 'result' ? ` It showed what ${nameOf(p)} gave.` : ` It showed ${p.name}, which the person gave.`;
};

/** A panel as restored: on the ids read again; or, where one it shows was not, waiting for it with why. */
function restoredPanel(session: Session, view: string, id: string, panel: Row, r: Restoring): Row {
  const gone = [...idsIn(panel, r.refs)].filter((x) => !Object.hasOwn(r.map, x));
  if (!gone.length) return swapIds(panel, r.refs, r.map) as Row;
  const why = r.missing.get(gone[0]) ?? NOT_KEPT;
  const p = r.pointers.get(gone[0]);
  r.waits.push(`${view} (${id}): ${why}`);
  if (gone.length === 1 && panel.from === gone[0] && p?.kind === 'result') {
    // the same call again fills it, exactly as it comes
    const { from: _from, ...rest } = swapIds(panel, r.refs, r.map) as Row;
    const awaits = {
      tool: p.tool,
      server: p.server,
      ...(p.ref === undefined && isRecord(p.input) ? { input: p.input } : {}),
    };
    const since = session.results.all().length;
    const want = JSON.stringify({ awaits, after: rest.after ?? null });
    session.gates.set(`${view}/${id}`, { want, since, sinceOwn: session.own.length, why });
    return { ...rest, id, awaits };
  }
  return {
    id,
    card: 'text',
    ...(typeof panel.title === 'string' ? { title: panel.title } : {}),
    text: `${why}${showed(p)}`,
  };
}

/** A view as restored: each id it points at swapped for the one read again, and each panel on one that was not waiting
 *  for it, saying why. */
export function restoredView(session: Session, args: Record<string, unknown>, r: Restoring): Record<string, unknown> {
  const view = String(args.name);
  const listed = (x: unknown): Row[] => (Array.isArray(x) ? x.filter(isRecord) : []);
  const tabs = listed(args.tabs);
  const all = [...listed(args.panels), ...tabs.flatMap((t) => listed(t.panels))]; // in the order show_view names them
  const ids = new Map(panelIdsOf(all).map((id, i) => [all[i], id]));
  const each = (x: unknown) =>
    Array.isArray(x)
      ? x.map((p) => (isRecord(p) && ids.has(p) ? restoredPanel(session, view, ids.get(p)!, p, r) : p))
      : x;
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => {
      if (k === 'panels') return [k, each(v)];
      if (k === 'tabs' && Array.isArray(v))
        return [
          k,
          v.map((t) =>
            isRecord(t) ? { ...(swapIds({ ...t, panels: [] }, r.refs, r.map) as Row), panels: each(t.panels) } : t,
          ),
        ];
      return [k, swapIds(v, r.refs, r.map, k)];
    }),
  );
}
